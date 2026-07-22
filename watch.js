// Odyssey IMAX Watcher — cloud version
// Runs headless in GitHub Actions on a schedule, independent of any laptop.
// Renders the Vue booking page (it's JS-rendered, so a plain HTTP fetch won't
// show showtimes), diffs against the last known snapshot, and if a screening
// appears that wasn't there before, sends a push notification (ntfy.sh) and
// an email (via Gmail SMTP). Sold-out/bookable status changes on screenings
// we've already seen are ignored — only brand-new screenings trigger alerts.

const { chromium } = require("playwright");
const fs = require("fs");
const https = require("https");
const nodemailer = require("nodemailer");

const TARGET_URL =
  process.env.TARGET_URL ||
  "https://www.myvue.com/cinema/manchester-printworks/film/the-odyssey-70mm-imax";
const STATE_FILE = "state.json";

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { items: [] };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function scrape(url) {
  // Sites like this often fingerprint headless/datacenter browsers and quietly
  // serve a stripped page instead of erroring, so we make this look like an
  // ordinary desktop Chrome session rather than default Playwright.
  const browser = await chromium.launch({
    args: ["--disable-blink-features=AutomationControlled"]
  });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      locale: "en-GB"
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    // "networkidle" times out on this site — it never goes fully quiet
    // (analytics/polling keep firing), so wait for the DOM instead and
    // give the client-side render its own settle time below.
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("Navigation status:", response && response.status());
    await page.waitForTimeout(5000); // let client-side rendering settle

    // The cookie-consent banner sits on top of the showtimes; dismiss it in
    // case it's intercepting anything or the site defers content behind it.
    const rejectCookies = page.getByRole("button", { name: /reject all/i });
    if (await rejectCookies.isVisible().catch(() => false)) {
      await rejectCookies.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Always saved so a bad run can be inspected as a workflow artifact
    // instead of guessing blind at why the item count is 0.
    await page.screenshot({ path: "debug.png" }).catch(() => {});

    const items = await page.evaluate(() => {
      const timeRegex = /\b([01]?\d|2[0-3])[:.]\d{2}\s?(am|pm)?\b/i;
      const soldOutWords = /(sold out|not available|waiting list)/i;
      const all = document.querySelectorAll(
        "button, a, li, div[role='button'], span"
      );
      const seen = new Set();
      const results = [];
      for (const el of all) {
        const txt = (el.textContent || "").trim().replace(/\s+/g, " ");
        if (!txt || txt.length > 40 || el.children.length > 2) continue;
        if (!timeRegex.test(txt) || seen.has(txt)) continue;
        seen.add(txt);
        const nearby = (el.closest("li,div,section")?.textContent || "").slice(0, 200);
        const bookable = !soldOutWords.test(txt) && !soldOutWords.test(nearby);
        results.push({ label: txt, bookable });
      }
      return results;
    });

    return items;
  } finally {
    await browser.close();
  }
}

function diff(prevItems, currItems) {
  const prevLabels = new Set(prevItems.map((p) => p.label));
  return currItems
    .filter((item) => !prevLabels.has(item.label))
    .map((item) => item.label);
}

async function sendPush(message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.log("No NTFY_TOPIC set — skipping push notification.");
    return;
  }
  await new Promise((resolve, reject) => {
    const req = https.request(
      `https://ntfy.sh/${encodeURIComponent(topic)}`,
      {
        method: "POST",
        headers: {
          Title: "Odyssey IMAX - new screening added!",
          Priority: "urgent",
          Tags: "ticket"
        }
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", resolve);
      }
    );
    req.on("error", reject);
    req.write(message);
    req.end();
  });
}

async function sendEmail(message) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_EMAIL_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !ALERT_EMAIL_TO) {
    console.log("Gmail env vars not fully set — skipping email.");
    return;
  }
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });
  await transporter.sendMail({
    from: GMAIL_USER,
    to: ALERT_EMAIL_TO,
    subject: "Odyssey IMAX - new screening added!",
    text: `${message}\n\n${TARGET_URL}`
  });
}

(async () => {
  const state = loadState();
  const items = await scrape(TARGET_URL);
  const newScreenings = diff(state.items, items);

  console.log(`Scraped ${items.length} showtime item(s).`);

  if (newScreenings.length > 0) {
    const message = `New screening(s) added: ${newScreenings.join(", ")}`;
    console.log("ALERT:", message);
    await Promise.all([sendPush(message), sendEmail(message)]);
  } else {
    console.log("No new screenings since last check.");
  }

  saveState({ items, checkedAt: new Date().toISOString() });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
