/**
 * Transform-ER · "Guess the Archetype" — Apps Script backend
 * ----------------------------------------------------------
 * Deploy this as a Web App (see README.md). It powers two endpoints on a single URL:
 *
 *   POST  {JSON payload from app.js}            → appends to "Submissions", "Portfolio", "Leaderboard" sheets
 *   GET   ?action=leaderboard&n=10              → returns [{name, org, score, total, playedAt}, ...]
 *
 * Contact details (email, phone) are only written to "Submissions", which you keep private.
 * The "Leaderboard" sheet contains only name + org + score, safe to expose via GET.
 *
 * SHEET NAMES (will be created automatically if missing):
 *   - "Submissions" : one row per play, includes contact details. KEEP PRIVATE.
 *   - "Portfolio"   : one row per traditional-card answer (stock data). Use for analysis.
 *   - "Leaderboard" : name, org, score, total, playedAt. Safe to read publicly.
 */

const SHEET_SUBMISSIONS = 'Submissions';
const SHEET_PORTFOLIO = 'Portfolio';
const SHEET_LEADERBOARD = 'Leaderboard';

/** Entry point for POST — record a play. */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.action !== 'submit') {
      return jsonOut({ ok: false, error: 'unknown action' });
    }
    writeSubmission(payload);
    writePortfolio(payload);
    writeLeaderboard(payload);
    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/** Entry point for GET — public leaderboard. */
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'leaderboard';
  if (action === 'leaderboard') {
    const n = parseInt((e.parameter && e.parameter.n) || '10', 10);
    return jsonOut(getLeaderboard(isNaN(n) ? 10 : Math.min(n, 100)));
  }
  return jsonOut({ ok: false, error: 'unknown action' });
}

/* ---------------- writers ---------------- */

function writeSubmission(payload) {
  const sheet = ensureSheet(SHEET_SUBMISSIONS, [
    'playedAt', 'name', 'org', 'role', 'orgLocation', 'email', 'phone',
    'score', 'total', 'durationMs', 'answersJson', 'version'
  ]);
  const p = payload.player || {};
  const r = payload.result || {};
  sheet.appendRow([
    payload.submittedAt || new Date().toISOString(),
    p.name || '', p.org || '', p.role || '', p.orgLocation || '',
    p.email || '', p.phone || '',
    r.score || 0, r.total || 0, r.durationMs || 0,
    JSON.stringify(r.answers || []),
    payload.version || ''
  ]);
}

function writePortfolio(payload) {
  const sheet = ensureSheet(SHEET_PORTFOLIO, [
    'playedAt', 'org', 'orgLocation', 'contactEmail',
    'archetypeCode', 'archetypeName', 'has', 'count', 'bespokeName', 'propertyLocations'
  ]);
  const p = payload.player || {};
  const when = payload.submittedAt || new Date().toISOString();
  (payload.portfolio || []).forEach(function (row) {
    sheet.appendRow([
      when, p.org || '', p.orgLocation || '', p.email || '',
      row.code || '', row.name || '',
      row.has || '', row.count || '', row.bespokeName || '', row.locations || ''
    ]);
  });
}

function writeLeaderboard(payload) {
  const sheet = ensureSheet(SHEET_LEADERBOARD, [
    'playedAt', 'name', 'org', 'score', 'total'
  ]);
  const p = payload.player || {};
  const r = payload.result || {};
  sheet.appendRow([
    payload.submittedAt || new Date().toISOString(),
    p.name || '', p.org || '',
    r.score || 0, r.total || 0
  ]);
}

/* ---------------- readers ---------------- */

function getLeaderboard(n) {
  const sheet = ensureSheet(SHEET_LEADERBOARD, [
    'playedAt', 'name', 'org', 'score', 'total'
  ]);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, 5).getValues();

  // Collapse to best score per (name, org), ties broken by most recent play.
  const best = {};
  rows.forEach(function (row) {
    const playedAt = row[0];
    const name = String(row[1] || '').trim();
    const org = String(row[2] || '').trim();
    const score = Number(row[3] || 0);
    const total = Number(row[4] || 0);
    if (!name && !org) return;
    const key = (name + '|' + org).toLowerCase();
    const prev = best[key];
    if (!prev
        || score > prev.score
        || (score === prev.score && new Date(playedAt) > new Date(prev.playedAt))) {
      best[key] = { name: name, org: org, score: score, total: total, playedAt: playedAt };
    }
  });

  return Object.keys(best)
    .map(function (k) { return best[k]; })
    .sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.playedAt) - new Date(a.playedAt);
    })
    .slice(0, n);
}

/* ---------------- helpers ---------------- */

function ensureSheet(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // If the sheet is empty, write the header.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- optional: CSV/one-off testing ---------------- */

/** Manual test — run once from the Apps Script editor to check permissions. */
function test_writeFakeRow() {
  doPost({
    postData: {
      contents: JSON.stringify({
        action: 'submit',
        version: 'test',
        submittedAt: new Date().toISOString(),
        player: { name: 'Test User', org: 'Test Org', role: 'Tester', orgLocation: 'London', email: 't@example.com', phone: '' },
        result: { score: 12, total: 16, durationMs: 60000, answers: [] },
        portfolio: [
          { code: 'TRAD-VT-TER', name: 'Victorian terrace', has: 'yes', count: '1-50', bespokeName: 'VT-A', locations: 'Salford' }
        ]
      })
    }
  });
}
