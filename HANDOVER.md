# Guess the Archetype — handover notes for Beck

Hi Beck — these notes catch you up on the Transform‑ER "Guess the Archetype" game. The build runs end‑to‑end. Pick up wherever it's most useful.

Last updated: 2026‑05‑06 (v2.2).

## 1. What this is

A web flashcard game for Transform‑ER (Innovate UK retrofit consortium, 13 partners). The audience is social housing asset managers and LA retrofit teams.

A round is **N flashcards** (configurable per‑difficulty in admin — Easy and Hard have separate card counts, e.g. Easy 15 / Hard 25):

- **Non‑traditional MCQ cards** — show a BRE system‑built archetype, player picks the name from a list. The number of options and how distractors are chosen depends on the **difficulty mode** (Easy / Hard) the player chose at the start.
- **Traditional cards** — interspersed at roughly even positions. They ask whether the player has the archetype in their portfolio, count, bespoke local name, and locations. They're skippable. **This portfolio data is the real point of the exercise.**
- **Post‑MCQ portfolio prompt** — after the player answers a non‑traditional MCQ, a "Do you have any of these in your portfolio?" panel appears below the reveal. Yes branches to count + locations; no/not‑sure are recorded as well. So *every* card is a portfolio data‑capture opportunity, not just the traditional ones.
- **Disagree? prompt** — alongside the portfolio prompt on non‑traditional cards, a wheat‑tinted text box invites the player to suggest what they think the archetype should be called. Captured separately and written to a `Disagreements` tab.

After the round: score + leaderboard with EASY/HARD pills, plus a Play again button.

## 2. Architecture in one paragraph

Static SPA (HTML/CSS/JS, no build step) on the front end. Backend is a Google Apps Script Web App bound to a Google Sheet (`T‑ER Archetypes Game`). The page POSTs JSON to the Apps Script on round completion; the script appends rows to five tabs (`Submissions` — private, contact details; `Portfolio` — one row per portfolio answer of either kind; `Leaderboard` — name+org+score+difficulty, public; `Settings` — single JSON blob with the live game configuration; `Disagreements` — one row per "I think this type is actually X" suggestion). The page also GETs the leaderboard and the live settings from the same script. There is no public auth on the backend; the *saveSettings* endpoint is gated by a shared password that lives in both `config.js` and `Code.gs`.

## 3. File map

```
guess-the-archetype/
├── index.html          Game SPA (intro form + difficulty + intro leaderboard, game flow, end screen)
├── leaderboard.html    Standalone full leaderboard with All / Easy / Hard filter
├── admin.html          Password‑gated admin (CRUD, photo+caption upload, settings, JSON export)
├── app.css             Brand‑driven stylesheet (Transform‑ER palette + circle motif)
├── app.js              Game logic — sampling, card flow, MCQ, scoring, submission, leaderboard
├── admin.js            Admin CRUD (localStorage), photo handling (resize+base64), captions, settings
├── config.js           Apps Script URL + admin password + fallback defaults
├── types.json          Source data — 37 curated BRE non‑traditional types + photos + captions + settings
├── README.md           One‑liner placeholder
├── HANDOVER.md         This file
└── apps-script/
    ├── Code.gs         Backend script — paste into the Apps Script editor
    └── README.md       Deployment guide
```

## 4. Data model

`types.json` shape (v2):

```jsonc
{
  "nonStandard": [
    {
      "code": "S062",                    // BRE code (stable identifier)
      "name": "Wimpey No-Fines",         // primary name shown in MCQ
      "class": "ISC",                    // MET | PCC | ISC | TIM
      "class_full": "In-Situ Concrete",
      "defective": false,                // Designated Defective under Housing Defects Act 1984
      "built": 300000,
      "period_from": 1940,
      "period_to":   1979,
      "period_range": "1930-1949",
      "description": "..."               // optional, shown on the reveal screen
    }, ...
  ],
  "traditional": [],                     // empty in shipped JSON; admin uploads them. Hard‑coded fallback in app.js.
  "settings": {                          // optional snapshot — live values come from the Apps Script Settings tab
    "difficulty": {
      "easy": { "totalCards": 15, "traditionalCount": 3, "mcqOptions": 3, "distractorScope": "sameClass", "showHint": true  },
      "hard": { "totalCards": 25, "traditionalCount": 4, "mcqOptions": 5, "distractorScope": "mixed",     "showHint": false }
    }
  },
  "photos":         { "S062": ["data:image/jpeg;base64,...", ...] },     // baked-in photos per code
  "photoCaptions":  { "S062": ["Photo: Architectural Press 1973", ...] }, // parallel array of credits
  "version": "2026-05-06-v2"
}
```

Beck's curated pool: **37 non‑traditional systems** (was 116 in v1). Sorted by build count, all designated‑defective systems kept regardless, near‑sibling families collapsed (e.g. Easiform Type I & II merged into "Easiform (Type I & II)") so the MCQ never pits "Type 1" against "Type 2".

The original BRE source spreadsheet is at `/sessions/.../uploads/Non-traditional spreadsheet tool (new draft version) MW edits.xlsx`. Sheet "Non-traditional" is the master list (683 systems). Sheets "Alternative names" (5,556 alias rows), "Location" (4,622 rows), and "Characteristics" (695 × 68) are unused for now but available if you ever want to add an aliases section, location-based hints, or a filter feature.

## 5. Admin UI

`admin.html`, password from `config.js` (`ADMIN_PASSWORD`).

Three sections:

- **Types** (left rail + editor) — add / edit / delete non‑traditional and traditional archetypes, upload photos, write per‑photo captions. Photos are downscaled client‑side to ≤1600px and stored as JPEG data URIs.
- **Game settings** — Easy and Hard each have their own *Total flashcards*, *Traditional cards*, *MCQ options*, *Distractor scope*, and *Show class hint*. Saving POSTs to the Apps Script `saveSettings` action, which writes the JSON to the `Settings` tab on the bound Sheet. Players' next page load picks up the new values automatically — no export/upload needed for settings changes.
- **Data** — Reset / Import / Export. Used when types or photos change. Export bundles types + photos + captions + settings into a single `types.json`; replace the file in the repo and push for the change to go live.

`localStorage` keys (only relevant for admin browser):

- `ter_admin_data_v1` — full types object (types + settings)
- `ter_admin_photos_v1` — `{ code: [dataUri, ...] }`
- `ter_admin_captions_v1` — `{ code: [caption, caption, ...] }`

## 6. Backend (Apps Script)

Bound to Sheet **`T‑ER Archetypes Game`**. Five tabs (created on first write):

| Sheet | Columns (v2.2) | Sensitivity |
|---|---|---|
| `Submissions` | playedAt, name, org, role, orgLocation, email, phone, **difficulty**, score, total, durationMs, answersJson, version | **Private** |
| `Portfolio` | playedAt, org, orgLocation, contactEmail, **kind**, archetypeCode, archetypeName, has, count, bespokeName, propertyLocations, **skipped** | Internal — main analytic output |
| `Leaderboard` | playedAt, name, org, **difficulty**, score, total | Public via GET |
| `Settings` | key / value (rows: `settings` → JSON blob; `updatedAt` → timestamp) | Backend‑managed |
| `Disagreements` | playedAt, name, org, orgLocation, contactEmail, archetypeCode, officialName, suggestedName | Internal |

Bold = added in v2. `Settings` was added in v2.1, `Disagreements` in v2.2.

`ensureSheet` performs a header upgrade by **set difference**: any column in the desired header that isn't in the live header gets appended at the end. Existing rows stay put. Writers (`appendKeyedRow`) then map values to columns *by name*, so a v1 sheet missing `difficulty` will get the column added on first POST after redeploy and start populating it on subsequent rows.

Note: the v2.0 deployment had a bug in this logic (it sliced `header.slice(existingCols)` instead of doing a set diff), so any v1 sheet that received POSTs between the v2.0 and v2.2 deployments may have a duplicate `total` column on Leaderboard or duplicate `version` column on Submissions. Delete those manually if you spot them — the v2.2 logic doesn't compound the issue.

`kind` on Portfolio is `'trad'` or `'nonStd'` so you can analyse non‑traditional portfolio answers (from the post‑MCQ prompt) separately from the traditional cards.

Endpoints:

- `POST /` with `{action: 'submit', ...}` → records a play (Submissions + Portfolio + Leaderboard + Disagreements as applicable).
- `POST /` with `{action: 'saveSettings', password, settings}` → writes the JSON blob to the Settings tab. Password must match `ADMIN_PASSWORD` at the top of `Code.gs` (which itself must match `CFG.ADMIN_PASSWORD` in `config.js`).
- `GET /?action=leaderboard&n=10` → `[{name, org, score, total, difficulty, playedAt}, ...]`
- `GET /?action=settings` → live settings JSON (or `null` if the Settings tab is empty).

Web App URL lives in `config.js`. Re‑deploying after Code.gs changes: in the Apps Script editor, *Deploy → Manage deployments → ✏️ → Version: New version → Deploy*. URL stays the same.

The writers in `Code.gs` use **column‑by‑column lookups against the live header** (see `appendKeyedRow`). That means upgrading on top of a v1 sheet without `difficulty` won't shuffle existing data — it just leaves the old rows blank in the new column. New rows get the new column populated automatically once `ensureSheet` adds it to the header.

**Settings precedence at runtime** (highest wins):

1. Live JSON read from the `Settings` tab via `GET ?action=settings`.
2. `data.settings` inside `types.json` (snapshot from the last admin export).
3. `CFG.DIFFICULTY` defaults in `config.js`.

This means changes saved through the admin UI go live for *all* players on their next page load, with no Git push or file upload required. The static deploy still has a meaningful copy of the settings inside `types.json` as a fallback for when the backend is unreachable.

## 7. Local dev

It's a static folder — open `index.html` in a browser to test. Two `file://` gotchas:

- Chrome blocks `fetch()` from `file://` (so `types.json` won't load). Run a tiny HTTP server: `python3 -m http.server 8765` from the folder, then visit `http://localhost:8765/`.
- `localStorage` is shared across `file://` URLs — use a private window or `localStorage.clear()` to avoid cross‑contamination.

To fully reset a player's state in browser, in dev tools console:

```js
['ter_seen_nonstd_v1','ter_seen_trad_v1','ter_admin_data_v1','ter_admin_photos_v1',
 'ter_admin_captions_v1','ter_last_player_v1','ter_last_difficulty_v1']
  .forEach(k => localStorage.removeItem(k));
```

## 8. Deployment

The repo is hosted on GitHub at `github.com/mattwoodbristol/guess-the-archetype` and serves via GitHub Pages. The flow:

1. Edit files locally (this folder is a Git working copy).
2. Commit & push via GitHub Desktop. GitHub Pages redeploys within ~30 seconds.
3. If `types.json` or `Code.gs` changed in a structural way, also bump `DATA_VERSION` in `config.js` so cached browsers refetch.

The `config.js` admin password is in the public repo — don't put anything actually secret in there. The "admin" only writes to the visitor's own localStorage, then exports a JSON; there's no server-side admin authority.

## 9. Game flow in code

`app.js` boot order:

1. `start()` — `loadTypes()` → `effectiveSettings(data)` → wire intro form + difficulty picker + intro leaderboard.
2. Player submits intro form → `onIntroSubmit()` → `buildDeck()` → `show('screen-game')` → `renderCurrent()`.
3. Each card render uses `buildMcqCard()` or `buildTradCard()`. MCQ shows the portfolio prompt after answer. Trad shows Skip + Next from the start.
4. Click Next → `advance()` reads `getResult()` from the card builder, pushes results, increments index. On last card → `finish()`.
5. `finish()` → `submitResults()` (POST) → `loadEndLeaderboard()` (GET).
6. Replay button reruns `buildDeck()` → fresh sample (sample‑without‑replacement honours `ter_seen_*` localStorage keys so back‑to‑back rounds don't repeat cards).

`effectiveSettings(data)` is the single source of truth for runtime config — pulls from `data.settings` first, falls back to `config.js` constants. So updating `types.json` settings is enough to roll out new game sizes without touching code.

## 10. Brand & assets

Design system pulled from `Transform-ER Brand Guidelines 2025_latest.pdf` (Matt's uploads folder).

**Palette** (CSS vars in `app.css`):
- `--navy` #2D303F (primary dark / page bg)
- `--ter-pink` #FF0080 (signature accent — buttons, score, EASY/HARD pills)
- `--mid-blue` #017FAD (links, secondary headings)
- `--light-blue` #73D7FF, `--wheat` #F7E4CA, `--mint` #B2EDD1, `--light-pink` #FF7BC7, `--mid-pink` #9A4A78

**Type:** Proxima Nova (brand spec); Montserrat as the free web fallback (loaded from Google Fonts in `app.css`).

**Motif:** "Circle of circles" — outlined circular frames. Brand rule: max 3 circle elements per design, never overlap circles on themselves. Hero, end‑hero, leaderboard hero, and admin login screens follow this.

## 11. Tasks shipped (v2)

These came in as a feedback batch from Matt and shipped on 2026‑05‑06:

- ✅ Verify Beck's photo‑baking flow works end-to-end (no changes needed).
- ✅ Admin Settings panel: per‑difficulty card counts + tunables.
- ✅ Easy / Hard mode at game start. Each profile carries its own totalCards, traditionalCount, mcqOptions, distractorScope, and showHint.
- ✅ Top‑10 leaderboard below the intro form.
- ✅ Standalone `leaderboard.html` with All / Easy / Hard filter.
- ✅ EASY/HARD pill on every leaderboard row.
- ✅ Photo acknowledgment captions per upload, rendered as a bottom‑right overlay on card photos.
- ✅ Skip button on traditional cards.
- ✅ "Do you have any of these?" prompt on non‑traditional cards after MCQ reveal.
- ✅ Apps Script schema upgrade (difficulty + portfolio kind/skipped) with safe column‑by‑column writes.
- ✅ Verified Play again at end screen still resets state cleanly.

**v2.1 (same day) follow‑up:**

- ✅ Settings save direct to the Sheet via Apps Script — no Git push or types.json export needed for settings changes.
- ✅ totalCards / traditionalCount moved into each difficulty profile so Hard can be longer than Easy.

**v2.2 (same day) polish:**

- ✅ Fixed `ensureSheet` header upgrade — was appending duplicate columns instead of inserting missing named columns, which is why difficulty wasn't being recorded on Leaderboard.
- ✅ Top‑left logo wraps to a homepage link on all three pages (`brand-link` class).
- ✅ End‑screen leaderboard now has a "View full board →" link mirroring the intro.
- ✅ "Disagree?" prompt on non‑traditional cards — wheat‑tinted text input alongside the portfolio prompt; suggestions land in a new `Disagreements` Sheet tab.
- ✅ localStorage quota fix — `state.data` is stripped of photo blobs on load so admin saves don't blow the 5–10 MB browser quota; quota errors are now silent (admin's in‑memory state still works and exports correctly).

## 12. Possible future work

- **Update admin "Data" section copy** — the existing prose says "Admin edits live in this browser's local storage" / "Export a JSON snapshot to bake it into the deployed app". Since v2.1 that's only true for types and photos; settings now save direct to the Sheet. Reword to make the split explicit. *(Logged as task #22.)*
- **Replace difficulty's "showHint"** — currently just toggles the construction class label on the photo tag. Could expand to e.g. show period or build count as additional hints in Easy mode.
- **Surface alt_names** — pull the 5,556 alias rows from the BRE Alternative names sheet, store as `alt_names[]` per code, show on the reveal screen ("Also known as: …"), let admin search match aliases. Pulled from backlog before v2 to keep things simple.
- **Street View image bulk fetch** — Matt may give a dataset of known non‑traditional property addresses; we'd run them through the Google Street View Static API (~$7 / 1,000 images, requires GCP key + billing). Mapillary as a free fallback. *Don't run without explicit go-ahead — touches Matt's GCP billing.*
- **Filter / hint feature** powered by the BRE `Characteristics` sheet (68 attributes per system) — could let the player narrow options by clicking obvious give‑aways.
- **End‑screen "switch difficulty"** — currently Play again uses the same difficulty as the previous round; a small chip to flip would save a page reload.

## 13. Where to look when stuck

- `apps-script/README.md` — deployment runbook for the backend.
- `effectiveSettings(data)` in `app.js` — single source of truth for runtime config.
- Auto‑memory at `/sessions/.../mnt/.auto-memory/` — short reference notes Claude has built up about the project, brand, and BRE spreadsheet schema.
- Source spreadsheet for any data Q: `/sessions/.../uploads/Non-traditional spreadsheet tool (new draft version) MW edits.xlsx`. Sheet "Non-traditional" is the master list; "Alternative names", "Location", "Characteristics" are the secondary data sources.

## 14. Things worth noticing on day one

- Open `admin.html`, password is in `config.js`. Take a look at the Settings panel to see what's tunable, and add a couple of traditional types if you have any to hand (until the admin populates them, the game falls back to four hard‑coded defaults: Victorian terrace, inter‑war semi, post‑war council terrace/semi, low‑rise masonry flats).
- Open `leaderboard.html` to see the standalone view.
- Run a full Easy round, then a Hard round, end‑to‑end. Watch the post‑MCQ prompt and the Skip flow on the traditional cards.

Welcome aboard, and good luck.
