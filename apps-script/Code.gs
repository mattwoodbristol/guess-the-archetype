/**
 * Transform-ER · "Guess the Archetype" — Apps Script backend (v2)
 * ----------------------------------------------------------
 *   POST  {JSON payload from app.js}            → appends to "Submissions", "Portfolio", "Leaderboard"
 *   GET   ?action=leaderboard&n=10              → [{name, org, score, total, difficulty, playedAt}, ...]
 *
 * Contact details (email, phone) live only in "Submissions" — keep that tab private.
 * "Leaderboard" only contains name, org, score, total, difficulty — safe to expose.
 *
 * If you previously deployed v1: ADD these columns to existing sheets
 *   Submissions  — append column 'difficulty' to header row
 *   Leaderboard  — append column 'difficulty'
 *   Portfolio    — append columns 'kind', 'skipped'
 * Or simply: rename the existing sheets out of the way (e.g. add suffix '_v1') and let v2 create fresh ones.
 */

const SHEET_SUBMISSIONS = 'Submissions';
const SHEET_PORTFOLIO   = 'Portfolio';
const SHEET_LEADERBOARD = 'Leaderboard';

const HEADER_SUBMISSIONS = [
  'playedAt', 'name', 'org', 'role', 'orgLocation', 'email', 'phone',
  'difficulty', 'score', 'total', 'durationMs', 'answersJson', 'version'
];
const HEADER_PORTFOLIO = [
  'playedAt', 'org', 'orgLocation', 'contactEmail',
  'kind', 'archetypeCode', 'archetypeName',
  'has', 'count', 'bespokeName', 'propertyLocations', 'skipped'
];
const HEADER_LEADERBOARD = [
  'playedAt', 'name', 'org', 'difficulty', 'score', 'total'
];

/** Entry point for POST — record a play. */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.action !== 'submit') return jsonOut({ ok: false, error: 'unknown action' });
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
    return jsonOut(getLeaderboard(isNaN(n) ? 10 : Math.min(n, 200)));
  }
  return jsonOut({ ok: false, error: 'unknown action' });
}

/* ---------------- writers ----------------
   Writes are column-by-column against the LIVE sheet header so that v1 sheets
   without 'difficulty' continue to fill the right cells; missing columns just
   stay empty. New columns appear automatically when ensureSheet upgrades the
   header (see helpers below). */

function writeSubmission(payload) {
  const sheet = ensureSheet(SHEET_SUBMISSIONS, HEADER_SUBMISSIONS);
  const p = payload.player || {};
  const r = payload.result || {};
  const fields = {
    playedAt:    payload.submittedAt || new Date().toISOString(),
    name:        p.name || '',
    org:         p.org || '',
    role:        p.role || '',
    orgLocation: p.orgLocation || '',
    email:       p.email || '',
    phone:       p.phone || '',
    difficulty:  payload.difficulty || '',
    score:       r.score || 0,
    total:       r.total || 0,
    durationMs:  r.durationMs || 0,
    answersJson: JSON.stringify(r.answers || []),
    version:     payload.version || ''
  };
  appendKeyedRow(sheet, fields);
}

function writePortfolio(payload) {
  const sheet = ensureSheet(SHEET_PORTFOLIO, HEADER_PORTFOLIO);
  const p = payload.player || {};
  const when = payload.submittedAt || new Date().toISOString();
  (payload.portfolio || []).forEach(function (row) {
    appendKeyedRow(sheet, {
      playedAt:           when,
      org:                p.org || '',
      orgLocation:        p.orgLocation || '',
      contactEmail:       p.email || '',
      kind:               row.kind || '',
      archetypeCode:      row.code || '',
      archetypeName:      row.name || '',
      has:                row.has || '',
      count:              row.count || '',
      bespokeName:        row.bespokeName || '',
      propertyLocations:  row.locations || '',
      skipped:            row.skipped ? 'true' : ''
    });
  });
}

function writeLeaderboard(payload) {
  const sheet = ensureSheet(SHEET_LEADERBOARD, HEADER_LEADERBOARD);
  const p = payload.player || {};
  const r = payload.result || {};
  appendKeyedRow(sheet, {
    playedAt:   payload.submittedAt || new Date().toISOString(),
    name:       p.name || '',
    org:        p.org || '',
    difficulty: payload.difficulty || '',
    score:      r.score || 0,
    total:      r.total || 0
  });
}

/** Append a row to the sheet in whatever column order the live header has. */
function appendKeyedRow(sheet, fields) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = header.map(function (col) {
    return Object.prototype.hasOwnProperty.call(fields, col) ? fields[col] : '';
  });
  sheet.appendRow(row);
}

/* ---------------- readers ---------------- */

function getLeaderboard(n) {
  const sheet = ensureSheet(SHEET_LEADERBOARD, HEADER_LEADERBOARD);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  // Read all six columns, but be tolerant of older rows that might have only five.
  const colCount = Math.min(sheet.getLastColumn(), HEADER_LEADERBOARD.length);
  const rows = sheet.getRange(2, 1, last - 1, colCount).getValues();
  const headerRow = sheet.getRange(1, 1, 1, colCount).getValues()[0];
  const idx = (h) => headerRow.indexOf(h);

  const iAt    = idx('playedAt');
  const iName  = idx('name');
  const iOrg   = idx('org');
  const iDiff  = idx('difficulty');
  const iScore = idx('score');
  const iTotal = idx('total');

  // Best score per (name, org, difficulty) — ties broken by most recent.
  const best = {};
  rows.forEach(function (row) {
    const playedAt = iAt    >= 0 ? row[iAt]    : '';
    const name     = iName  >= 0 ? String(row[iName]  || '').trim() : '';
    const org      = iOrg   >= 0 ? String(row[iOrg]   || '').trim() : '';
    const diff     = iDiff  >= 0 ? String(row[iDiff]  || '').trim().toLowerCase() : '';
    const score    = iScore >= 0 ? Number(row[iScore] || 0) : 0;
    const total    = iTotal >= 0 ? Number(row[iTotal] || 0) : 0;
    if (!name && !org) return;
    const key = (name + '|' + org + '|' + diff).toLowerCase();
    const prev = best[key];
    if (!prev
        || score > prev.score
        || (score === prev.score && new Date(playedAt) > new Date(prev.playedAt))) {
      best[key] = { name: name, org: org, difficulty: diff, score: score, total: total, playedAt: playedAt };
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
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Best-effort header upgrade: if the sheet has fewer columns than the new header,
  // append the missing columns onto the header row so doPost can write to them.
  const existingCols = sheet.getLastColumn();
  if (existingCols < header.length) {
    const existingHeader = sheet.getRange(1, 1, 1, existingCols).getValues()[0];
    const missing = header.slice(existingCols);
    sheet.getRange(1, existingCols + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- testing ---------------- */

function test_writeFakeRow() {
  doPost({
    postData: {
      contents: JSON.stringify({
        action: 'submit',
        version: 'test',
        submittedAt: new Date().toISOString(),
        difficulty: 'hard',
        player: { name: 'Test User', org: 'Test Org', role: 'Tester', orgLocation: 'London', email: 't@example.com', phone: '' },
        result: { score: 12, total: 16, durationMs: 60000, answers: [] },
        portfolio: [
          { kind: 'trad', code: 'TRAD-VT-TER', name: 'Victorian terrace', has: 'yes', count: '1-50', bespokeName: 'VT-A', locations: 'Salford' },
          { kind: 'nonStd', code: 'P003', name: 'Airey', has: 'yes', count: '1-50', locations: 'Manchester' },
          { kind: 'trad', code: 'TRAD-IW-SEMI', name: 'Inter-war semi', skipped: true }
        ]
      })
    }
  });
}
