// Odyssey IMAX Watcher — cloud version
// Runs headless in GitHub Actions on a schedule, independent of any laptop.
// Renders the Vue booking page (it's JS-rendered, so a plain HTTP fetch won't
// show showtimes), diffs against the last known snapshot, and if something
// new or newly-bookable appears, sends a push notification (ntfy.sh) and an
// email (via Gmail SMTP).

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
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000); // let client-side rendering settle

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
  const newlyBookable = [];
  for (const item of currItems) {
    const prevMatch = prevItems.find((p) => p.label === item.label);
    const wasBookableBefore = prevMatch ? prevMatch.bookable : false;
    if (item.bookable && !wasBookableBefore) newlyBookable.push(item.label);
  }
  return newlyBookable;
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
          Title: "Odyssey IMAX - new tickets!",
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
    subject: "Odyssey IMAX - new tickets available!",
    text: `${message}\n\n${TARGET_URL}`
  });
}

(async () => {
  const state = loadState();
  const items = await scrape(TARGET_URL);
  const newlyBookable = diff(state.items, items);

  console.log(`Scraped ${items.length} showtime item(s).`);

  if (newlyBookable.length > 0) {
    const message = `New/bookable: ${newlyBookable.join(", ")}`;
    console.log("ALERT:", message);
    await Promise.all([sendPush(message), sendEmail(message)]);
  } else {
    console.log("No change since last check.");
  }

  saveState({ items, checkedAt: new Date().toISOString() });
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
