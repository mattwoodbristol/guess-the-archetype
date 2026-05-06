# Guess the Archetype — handover notes for Beck

Hi Beck — these notes catch you up on where Matt and I have got to with the Transform‑ER "Guess the Archetype" game. The build is functional end‑to‑end but there's a list of feedback items still outstanding. Pick up wherever it's most useful.

Last updated: 2026‑05‑01.

## 1. What this is

A web flashcard game for Transform‑ER (Innovate UK retrofit consortium, 13 partners). The audience is social housing asset managers and LA retrofit teams.

A round is **20 cards**:
- **16 multiple‑choice cards** showing a non‑traditional (system‑built) BRE archetype. Player picks the right name from 4 options. Distractors are drawn from the same construction class (MET / PCC / ISC / TIM) so it's not a giveaway.
- **4 traditional‑archetype cards**, interspersed at fixed positions (5, 9, 13, 17). These don't score — they ask the player whether their organisation has any in their portfolio, roughly how many, and what they call them locally. **This portfolio data is the real point of the exercise.**

After the round: score + leaderboard + replay button. Replay re‑rolls a fresh sample using sample‑without‑replacement tracked in the player's browser, so back‑to‑back rounds don't repeat cards.

## 2. Architecture in one paragraph

Static SPA (HTML/CSS/JS, no build step) on the front end. Backend is a Google Apps Script Web App bound to a Google Sheet (`T‑ER Archetypes Game`). The page POSTs JSON to the Apps Script URL on round completion; the script appends rows to three tabs (`Submissions` — private, includes contact details; `Portfolio` — one row per traditional answer; `Leaderboard` — name+org+score, public). The page also GETs the leaderboard from the same script. There is no auth on the backend — the Sheet is the source of truth and Matt controls it.

## 3. File map

```
Archetype flashcard app/
├── index.html          Game SPA (intro form, game flow, end screen)
├── admin.html          Password‑gated admin (manage types, upload photos, JSON export/import)
├── app.css             Brand‑driven stylesheet (Transform‑ER palette + circle motif)
├── app.js              Game logic — sampling, card flow, MCQ, scoring, submission, leaderboard
├── admin.js            Admin CRUD (localStorage), photo handling (resize+base64), import/export
├── config.js           Apps Script URL + admin password + a few tunables
├── types.json          Source data — 116 BRE non‑traditional types after filtering
├── HANDOVER.md         This file
└── apps-script/
    ├── Code.gs         Backend script — paste this into the Apps Script editor
    └── README.md       Deployment guide (how to wire up the Sheet + deploy as Web App)
```

## 4. Data model

`types.json` shape:

```jsonc
{
  "nonStandard": [
    {
      "code": "S062",                    // BRE code (stable identifier)
      "name": "Wimpey No-Fines",         // primary name shown in MCQ
      "class": "ISC",                    // MET | PCC | ISC | TIM
      "class_full": "In-Situ Concrete",
      "defective": false,                // Designated Defective under Housing Defects Act 1984
      "built": 300000,                   // estimated number built (UK)
      "period_from": 1940,
      "period_to":   1979,
      "period_range": "1930-1949"
    }, ...
  ],
  "traditional": [],                     // empty in shipped JSON; admin uploads them. Hard‑coded fallback in app.js if empty.
  "version": "2026-04-22-v1"
}
```

Pool was built from the source spreadsheet (`/sessions/.../uploads/Non-traditional spreadsheet tool (new draft version) MW edits.xlsx`) by filtering 683 BRE systems down to those with **≥1,000 built OR Designated Defective**. That left **116 systems**: ISC 13, MET 22, TIM 36, PCC 45.

The source spreadsheet has additional sheets we may want to use:
- **Alternative names** (5,556 rows) — aliases per code (Wimpey No‑Fines = Butterfly = Formwall = Gateshead No‑Fines, etc.). Backlog item #8 surfaces these.
- **Location** (4,622 rows) — LA / country where each system was built. Not yet used.
- **Characteristics** (695 × 68) — construction attributes. Not yet used; could power a "filter / hint" feature later.

## 5. Backend — Apps Script

Bound to Sheet **`T‑ER Archetypes Game`** (Matt's Drive). Three tabs created on first write:

| Sheet | Columns | Sensitivity |
|---|---|---|
| `Submissions` | playedAt, name, org, role, orgLocation, email, phone, score, total, durationMs, answersJson, version | **Private** — keep Sheet‑level sharing minimal |
| `Portfolio` | playedAt, org, orgLocation, contactEmail, archetypeCode, archetypeName, has, count, bespokeName, propertyLocations | Internal — main analytic output |
| `Leaderboard` | playedAt, name, org, score, total | Public via GET endpoint |

**Web App URL** (lives in `config.js`):
```
https://script.google.com/macros/s/AKfycbwvP7zRn8k3pqZXUFQh7_LTq2FttYs-qE1PxhGcoKpaChOjri3KCTeI0zyEoTIPIGwb/exec
```

**Endpoints:**
- `POST /` with JSON body → records a play (Code.gs `doPost`)
- `GET /?action=leaderboard&n=10` → `[{name, org, score, total, playedAt}, ...]` (`doGet`)

**Re‑deploying after Code.gs changes:** in the Apps Script editor, *Deploy → Manage deployments → ✏️ → Version: New version → Deploy*. URL stays the same. Don't create a new deployment unless you want a new URL.

## 6. Local dev

It's a static folder — open `index.html` in a browser to test. Two file:// gotchas:

- Chrome blocks `fetch()` from `file://` (so `types.json` won't load). Run a tiny HTTP server instead: `python3 -m http.server 8765` from the folder, then visit `http://localhost:8765/`.
- `localStorage` is shared across `file://` URLs and you'll get cross‑contamination if you've ever opened any other local HTML file. Use a private window or `localStorage.clear()` in dev tools.

To fully reset a player's state in browser, in dev tools console:
```js
['ter_seen_nonstd_v1','ter_seen_trad_v1','ter_admin_data_v1','ter_admin_photos_v1','ter_last_player_v1']
  .forEach(k => localStorage.removeItem(k));
```

Admin storage keys:
- `ter_admin_data_v1` — full types object (overrides shipped types.json when present in the player's browser)
- `ter_admin_photos_v1` — `{ code: [dataUri, ...] }`

## 7. Deployment / hosting

The folder is plain static. Three sensible hosts:

- **GitHub Pages** — public repo, drag‑and‑drop the folder, enable Pages on `main` / root. Folder name with spaces ("Archetype flashcard app") will URL‑encode awkwardly; rename to `guess-the-archetype` before pushing.
- **Netlify Drop** — `app.netlify.com/drop`, drag folder, instant URL.
- **Cloudflare Pages / Vercel** — same idea, both work.

Because the repo would be public and `config.js` contains the admin password, change the admin password to something dedicated for the public deployment and rotate it if leaked. The "admin" only writes to that visitor's localStorage — there's no server‑side admin auth — so a leaked password lets someone fiddle with their own browser's view of the game and export a JSON, nothing more dangerous than that.

## 8. Outstanding work — feedback backlog

These are ordered so each builds on the previous. Tasks #6–#10 in our task list.

### #6 Admin pool‑size setting (top‑N by build count)
Matt feels 116 types is too many. Add a numeric setting in admin (default 30 say) — the game samples both the correct cards and the MCQ distractors from the top‑N by `built`. Defective systems should be force‑included regardless of N (Matt confirmed). Implementation: add `poolSize` to `state.data` in admin (and to types.json export); in `app.js`, build the working pool inside `buildDeck()` by sorting non‑standards by `built` desc, taking the first N, then `.concat()` any defective systems not already in that slice, then dedupe.

### #7 De‑duplicate near‑sibling types in a single MCQ
Don't show e.g. "Unity Type 1" + "Unity Type 2" as options in the same question — players can't tell them apart. Rule we agreed on: two names share a *root* if they differ only by trailing numerals, Roman numerals, or a `Type X` / `Mk N` / single‑letter suffix. When picking 3 distractors, exclude any whose root matches the correct answer's root **or** any already‑picked distractor's root. Probably a `rootName(name)` helper that strips trailing tokens via regex.

### #8 Surface alternative names
Pull the **Alternative names** sheet (5,556 rows) into types.json as `alt_names: [...]` per code. Two places to use them:
- **Reveal screen** in the game: "Also known as: Butterfly, Formwall, Gateshead No‑Fines" beneath the answer fact.
- **Admin search**: when the admin types a query, match against name *and* alt_names so people can find a system by their local name.

Top alias counts for sanity (so you know it'll be useful): P014 has 12 names, T052 has 11, S062 has 9, M002 has 8. Plenty of systems with 3–5.

### #9 Leaderboard placement
- Top‑10 leaderboard table **below the intro form** on `index.html`. Same data source as the end‑screen leaderboard (`?action=leaderboard&n=10`). Style it lighter than the end‑screen version since it's secondary on first load.
- New `leaderboard.html` — full leaderboard (n=100 or so), styled like the admin shell, with a prominent "Play the game" button linking back to `index.html`.

### #10 Photo acknowledgment captions
Each uploaded photo needs an attribution caption (photographer / source / "© XYZ Council 2024" / etc.). Admin currently uploads photos with no metadata — needs to capture a caption per photo at upload time and allow editing. On the card photo, render a small overlay (bottom right, low‑opacity) showing the caption. Ditto on the admin preview thumbnails.

## 9. Possible future work mentioned in conversation

- **Street View image bulk fetch** — Matt may give us a dataset of known non‑traditional property addresses; we'd run them through the Google Street View Static API (~$7 / 1,000 images, requires a GCP key and billing on) to populate photos automatically. Mapillary is the free fallback. *Don't run this without explicit go‑ahead — it touches Matt's GCP billing.*
- **Filter / hint feature** powered by the `Characteristics` sheet (68 attributes per system) — could let the player narrow options by clicking obvious give‑aways.
- **Locations** sheet could feed a "where in the UK was this built?" hint or a map view.

## 10. Brand & assets

Design system pulled from `Transform-ER Brand Guidelines 2025_latest.pdf` (in the uploads folder).

**Palette** (CSS vars in `app.css`):
- `--navy` #2D303F (primary dark / page bg)
- `--ter-pink` #FF0080 (signature accent — buttons, highlights, score)
- `--mid-blue` #017FAD (links, secondary headings)
- `--light-blue` #73D7FF, `--wheat` #F7E4CA, `--mint` #B2EDD1, `--light-pink` #FF7BC7, `--mid-pink` #9A4A78

**Type:** Proxima Nova (brand spec); Montserrat as the free web fallback (loaded from Google Fonts in `app.css`).

**Motif:** "Circle of circles" — outlined circular frames. Brand rule: max 3 circle elements per design, never overlap circles on themselves. Hero, end‑hero, and admin login screens follow this.

## 11. Things I'd suggest noticing on day one

- Open `admin.html`, password is in `config.js`. Add a couple of traditional types (Victorian terrace, inter‑war semi etc.) so the game stops falling back to its hard‑coded defaults.
- In the Sheet, delete any test rows still hanging around in `Submissions` / `Portfolio` / `Leaderboard` (Matt and I left a couple while smoke‑testing the backend).
- Run a full round end‑to‑end before changing anything, just to feel the flow.

## 12. Where to look when stuck

- `apps-script/README.md` — the deployment runbook for the backend.
- Auto‑memory at `/sessions/.../mnt/.auto-memory/` — short reference notes Claude has built up about the project, brand, and BRE spreadsheet schema.
- Source spreadsheet for any data Q: `/sessions/.../uploads/Non-traditional spreadsheet tool (new draft version) MW edits.xlsx`. Sheet "Non-traditional" is the master list; "Alternative names", "Location", "Characteristics" are the secondary data sources.

Welcome aboard, and good luck.
