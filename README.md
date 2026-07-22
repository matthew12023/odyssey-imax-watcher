# Odyssey IMAX Watcher — Cloud version (push + email, works with your laptop off)

This runs on GitHub's servers on a schedule, so it keeps checking even when
your laptop is closed. When it spots a new or newly-bookable showtime for
The Odyssey 70mm IMAX at Vue Printworks, it:

- Sends a push notification to your phone (via the free **ntfy** app)
- Emails you (via your own Gmail account)

It does not log in, store payment details, or book anything — same as the
browser extension. This is purely the "phone alert while I'm out" piece;
keep using the extension too for instant desktop alerts when your laptop's open.

## One-time setup (~10 minutes)

### 1. Create the repo
- Go to github.com → **New repository** → name it e.g. `odyssey-imax-watcher`.
- Make it **Public**. GitHub Actions minutes are unlimited for public repos;
  a private repo only gets 2,000 free minutes/month, and this job (which
  launches a real browser each run) would burn through that fast at a 5-minute
  interval. Nothing in this code is sensitive — the credentials below are
  stored as encrypted Secrets, never in the code itself.
- Upload all the files in this folder, keeping the `.github/workflows/watch.yml`
  path intact.

### 2. Get a push notification channel (ntfy — free, no account needed)
- Install the **ntfy** app: [iOS](https://apps.apple.com/app/ntfy/id1625396347) /
  [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy).
- In the app, tap **+** → **Subscribe to topic** → make up a random, hard-to-guess
  topic name (e.g. `matthew-odyssey-7f3k2`) — anyone who knows this exact
  string could see your alerts, since ntfy's free tier is public-by-topic-name,
  so pick something unguessable, not just "odyssey".
- Remember that exact string — you'll add it as a secret below.

### 3. Get a Gmail app password (for the email alert)
- Turn on 2-Step Verification on your Google account if it isn't already:
  myaccount.google.com/security
- Go to myaccount.google.com/apppasswords → create one (name it "Odyssey Watcher")
  → copy the 16-character password it gives you.

### 4. Add secrets to the repo
In your new repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add these four:

| Name | Value |
|---|---|
| `NTFY_TOPIC` | the topic string from step 2 |
| `GMAIL_USER` | your Gmail address |
| `GMAIL_APP_PASSWORD` | the 16-character app password from step 3 |
| `ALERT_EMAIL_TO` | where you want the alert emailed (can be the same Gmail address) |

Optional: **Settings → Secrets and variables → Actions → Variables tab** → add
`TARGET_URL` if you ever want to point this at a different film/cinema page.
Leave it out and it defaults to the Printworks Odyssey IMAX page.

### 5. Test it
- Go to the **Actions** tab in your repo → **Odyssey IMAX Watcher** →
  **Run workflow** → Run. Watch it go — click into the run to see the logs.
- You should see "Scraped N showtime item(s)" in the log. If N is 0, the
  scraper isn't matching the real page's markup — see "If it's not detecting
  showtimes correctly" below.
- It'll now also run automatically every 5 minutes.

## If it's not detecting showtimes correctly

Same situation as the browser extension: I built the scraper against a
generic "small clickable element containing a time" pattern since I can't
render and inspect the live, logged-in booking flow myself. If the log
keeps showing 0 items:

1. Open the real page in your own browser, right-click a showtime → **Inspect**.
2. Note the tag/class it's using.
3. Edit the `page.evaluate(...)` block in `watch.js` — swap the generic
   `document.querySelectorAll(...)` line for a selector that matches what
   you found (e.g. `document.querySelectorAll('button.showtime')`).
4. Commit the change — the next scheduled run will use it.

## A few honest caveats

- **Timing isn't split-second.** Cron schedules on GitHub's free tier can
  slip by a few minutes during busy periods, and GitHub auto-disables
  scheduled workflows after 60 days with no repo activity (just re-enable
  it from the Actions tab, or make any small commit occasionally).
- **Each run spins up a real headless browser**, so it's slower and heavier
  than the local extension's check — that's the tradeoff for not needing
  your laptop on.
- ntfy's free tier delivers to a topic name; treat your topic string like a
  lightweight password (don't post it publicly).
