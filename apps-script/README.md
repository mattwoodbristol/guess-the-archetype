# Transform-ER "Guess the Archetype" — backend deployment

The game is a static site, but the leaderboard and portfolio-data capture need a lightweight backend. This uses **Google Apps Script** bound to a Google Sheet, deployed as a public **Web App**. No server, no hosting bill, no keys in the client.

## What you end up with

A single URL of the form `https://script.google.com/macros/s/XXXXX/exec` that handles:

- **`POST`** — the game submits the player's result and portfolio answers as JSON. Rows are appended to three sheets.
- **`GET ?action=leaderboard&n=10`** — returns the top N leaderboard rows as JSON.

Three tabs are created automatically:

| Sheet         | What goes in it                                                                 | Sensitivity  |
| ------------- | ------------------------------------------------------------------------------- | ------------ |
| `Submissions` | One row per play: name, org, role, org location, email, phone, score, answers  | **Private**  |
| `Portfolio`   | One row per *traditional* card answer: archetype, have/count/bespoke/locations | Internal use |
| `Leaderboard` | name, org, score, total, playedAt                                               | Publicly readable via the `GET` endpoint |

Contact details never leave `Submissions`. The `Leaderboard` tab is what the game's end screen reads from.

## One-time setup

1. **Create a Google Sheet** that will hold the data. Any name is fine (e.g. *Transform-ER — Guess the Archetype backend*). Keep the default `Sheet1` tab — the script will add its own tabs on first write.
2. **Extensions → Apps Script**. Delete the placeholder `Code.gs` stub.
3. **Paste in the contents of `Code.gs` from this folder** (the file next to this README). Save.
4. Optional sanity check: run the `test_writeFakeRow` function once (button bar → pick `test_writeFakeRow` → Run). The first time, Apps Script asks you to authorise it to access your Sheet — approve. After it runs, open the Sheet: you should see the three new tabs, populated with a test row. Delete that test row.
5. **Deploy → New deployment**.
   - Type: **Web app**
   - Description: `Guess the Archetype backend`
   - Execute as: **Me**
   - Who has access: **Anyone** (the game is public-facing; the script is the only thing that touches the Sheet)
   - Click **Deploy**. Accept any permission prompts.
6. Copy the **Web app URL** shown at the end. It looks like `https://script.google.com/macros/s/AKfy.../exec`.
7. Open `config.js` in the game folder and paste the URL into `APPS_SCRIPT_URL`. Save.

That's it — open `index.html` and play a round. The end screen should show your score, and the leaderboard will populate within a second.

## Re-deploying after code changes

Apps Script pins a deployment to a specific version. When you edit `Code.gs` and want the changes to take effect at the existing URL:

- **Deploy → Manage deployments** → hover the existing deployment → pencil icon → **Version: New version** → Deploy.
- The URL stays the same, so nothing in `config.js` needs to change.

(Creating a *new deployment* instead gives you a fresh URL, which is fine for testing but means you'd need to update `config.js`.)

## Notes & gotchas

- **CORS.** The game POSTs as `text/plain` on purpose — this avoids the `OPTIONS` preflight that Apps Script doesn't respond to cleanly. Don't change it to `application/json` in `app.js`.
- **Write contention.** Apps Script sheets serialise writes. This is fine at event-speed traffic (dozens-per-minute). If you expect a burst of hundreds of concurrent plays, use a queue/buffer or move to a proper backend.
- **Privacy.** Share the *Sheet itself* only with Transform-ER project staff. The `Submissions` tab contains email/phone. Don't publish the Sheet to the web.
- **Deleting test data.** Before you go live, delete your warm-up rows from all three tabs (leave the header row).
- **Exports.** Any Transform-ER analyst can `File → Download → CSV` from a tab, or use `=QUERY(Submissions!A:L, …)` in another tab. The `Portfolio` tab is designed to be the headline analytic output — one row per (org, traditional-archetype) answer.

## If the leaderboard doesn't show

- Open the browser devtools Network tab and hit **Play again** to finish a round. Look for a GET to your Apps Script URL.
  - **403 / HTML login page?** The deployment is set to the wrong access level — redeploy with *Who has access: Anyone*.
  - **Empty body?** Check the Apps Script **Executions** tab for errors. The most common cause is forgetting to authorise the script on first run.
- POSTs don't return any body to the page (the game doesn't need one). To confirm writes are landing, open the Sheet and look at the `Submissions` tab timestamp.

## If you lose the URL

Apps Script editor → **Deploy → Manage deployments** → copy the Web app URL from the active deployment.
