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

const SHEET_SUBMISSIONS   = 'Submissions';
const SHEET_PORTFOLIO     = 'Portfolio';
const SHEET_LEADERBOARD   = 'Leaderboard';
const SHEET_SETTINGS      = 'Settings';
const SHEET_DISAGREEMENTS = 'Disagreements';
const SHEET_PHOTOS        = 'Photos';
const SHEET_TYPES         = 'Types';
const PHOTO_FOLDER_NAME   = 'Guess the Archetype photos';
// Pre-configured Drive folder for photo uploads. Leave blank ('') to auto-create
// a folder in the deploying user's Drive on first upload — that's the simplest
// path because the user automatically gets Editor access.
const PHOTO_FOLDER_ID     = '';

// Must match config.js ADMIN_PASSWORD. Used to gate /saveSettings.
// Public-by-design (config.js is also public), but stops random spam.
const ADMIN_PASSWORD = 'transform-er-admin-2026';

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
const HEADER_DISAGREEMENTS = [
  'playedAt', 'name', 'org', 'orgLocation', 'contactEmail',
  'archetypeCode', 'officialName', 'suggestedName'
];
const HEADER_PHOTOS = [
  'code', 'fileId', 'url', 'caption', 'order', 'uploadedAt'
];
const HEADER_TYPES = [
  'bucket', 'code', 'name', 'class', 'class_full', 'built',
  'period_from', 'period_to', 'period_range', 'defective',
  'description', 'updatedAt'
];

/** Entry point for POST. */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.action === 'submit') {
      writeSubmission(payload);
      writePortfolio(payload);
      writeLeaderboard(payload);
      writeDisagreements(payload);
      return jsonOut({ ok: true });
    }
    if (payload.action === 'saveSettings') {
      if (payload.password !== ADMIN_PASSWORD) return jsonOut({ ok: false, error: 'auth failed' });
      saveSettingsToSheet(payload.settings || {});
      return jsonOut({ ok: true });
    }
    if (payload.action === 'uploadPhoto') {
      if (payload.password !== ADMIN_PASSWORD) return jsonOut({ ok: false, error: 'auth failed' });
      const r = uploadPhotoToDrive(payload.dataUri, payload.filename || (payload.code + '.jpg'));
      addPhotoToSheet(payload.code, r.fileId, r.url, payload.caption || '');
      return jsonOut({ ok: true, fileId: r.fileId, url: r.url });
    }
    if (payload.action === 'deletePhoto') {
      if (payload.password !== ADMIN_PASSWORD) return jsonOut({ ok: false, error: 'auth failed' });
      try { DriveApp.getFileById(payload.fileId).setTrashed(true); } catch (e) { /* already gone */ }
      removePhotoFromSheet(payload.fileId);
      return jsonOut({ ok: true });
    }
    if (payload.action === 'updateCaption') {
      if (payload.password !== ADMIN_PASSWORD) return jsonOut({ ok: false, error: 'auth failed' });
      updateCaptionInSheet(payload.fileId, payload.caption || '');
      return jsonOut({ ok: true });
    }
    if (payload.action === 'saveType') {
      if (payload.password !== ADMIN_PASSWORD) return jsonOut({ ok: false, error: 'auth failed' });
      upsertTypeInSheet(payload.type || {}, payload.bucket || 'nonStandard');
      return jsonOut({ ok: true });
    }
    if (payload.action === 'deleteType') {
      if (payload.password !== ADMIN_PASSWORD) return jsonOut({ ok: false, error: 'auth failed' });
      deleteTypeFromSheet(payload.code || '');
      return jsonOut({ ok: true });
    }
    if (payload.action === 'saveTypesBulk') {
      if (payload.password !== ADMIN_PASSWORD) return jsonOut({ ok: false, error: 'auth failed' });
      bulkReplaceTypes(payload.types || { nonStandard: [], traditional: [] });
      return jsonOut({ ok: true });
    }
    return jsonOut({ ok: false, error: 'unknown action' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/** Entry point for GET — public leaderboard or settings. */
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'leaderboard';
  if (action === 'leaderboard') {
    const n = parseInt((e.parameter && e.parameter.n) || '10', 10);
    return jsonOut(getLeaderboard(isNaN(n) ? 10 : Math.min(n, 200)));
  }
  if (action === 'settings') {
    return jsonOut(readSettingsFromSheet());
  }
  if (action === 'photos') {
    return jsonOut(readPhotosFromSheet());
  }
  if (action === 'types') {
    return jsonOut(readTypesFromSheet());
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

function writeDisagreements(payload) {
  if (!payload.disagreements || !payload.disagreements.length) return;
  const sheet = ensureSheet(SHEET_DISAGREEMENTS, HEADER_DISAGREEMENTS);
  const p = payload.player || {};
  const when = payload.submittedAt || new Date().toISOString();
  payload.disagreements.forEach(function (row) {
    appendKeyedRow(sheet, {
      playedAt:       when,
      name:           p.name || '',
      org:            p.org || '',
      orgLocation:    p.orgLocation || '',
      contactEmail:   p.email || '',
      archetypeCode:  row.code || '',
      officialName:   row.officialName || '',
      suggestedName:  row.suggestedName || ''
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

/* ---------------- settings storage ----------------
   Settings tab: two rows
     A1=key            B1=value
     A2=settings       B2=<JSON string of the settings object>
     A3=updatedAt      B3=ISO timestamp
*/

function ensureSettingsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_SETTINGS);
    sheet.getRange(1, 1, 1, 2).setValues([['key', 'value']]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 2, 1, 1).setNote('Stores the live game configuration (JSON). Edited by admin.html — do not edit by hand unless you know what you\'re doing.');
  }
  return sheet;
}

function saveSettingsToSheet(settings) {
  const sheet = ensureSettingsSheet();
  const json = JSON.stringify(settings);
  // Wipe existing rows (except header) and rewrite to keep things clean.
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
  sheet.getRange(2, 1, 2, 2).setValues([
    ['settings',  json],
    ['updatedAt', new Date().toISOString()]
  ]);
}

function readSettingsFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) return null;
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const rows = sheet.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][0] === 'settings' && rows[i][1]) {
      try { return JSON.parse(rows[i][1]); } catch (e) { return null; }
    }
  }
  return null;
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
  // Header upgrade: any column from the desired header that doesn't appear in the
  // current header gets appended at the end. Existing data is left untouched.
  const existingCols = sheet.getLastColumn();
  const existingHeader = sheet.getRange(1, 1, 1, existingCols).getValues()[0]
                              .map(function (v) { return String(v).trim(); });
  const missing = header.filter(function (h) { return existingHeader.indexOf(h) === -1; });
  if (missing.length > 0) {
    sheet.getRange(1, existingCols + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- Drive-hosted photos ---------------- */

/** Get or create the Drive folder where uploaded photos go.
   Resolution order:
     1. PHOTO_FOLDER_ID const at the top of this file
     2. PHOTO_FOLDER_ID stored in Script Properties (set automatically once we create one)
     3. Auto-create a new folder named PHOTO_FOLDER_NAME and remember its ID
*/
function getOrCreatePhotoFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = PHOTO_FOLDER_ID || props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* fall through to create */ }
  }
  const folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

/** Decode a data: URI and create a Drive file. Returns { fileId, url }. */
function uploadPhotoToDrive(dataUri, filename) {
  const m = String(dataUri || '').match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new Error('not a data URI');
  const contentType = m[1];
  const bytes = Utilities.base64Decode(m[2]);
  const blob = Utilities.newBlob(bytes, contentType, filename || 'photo.jpg');
  const folder = getOrCreatePhotoFolder();
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const fileId = file.getId();
  // Stable image-embed URL that returns the bytes directly (not a download warning page).
  const url = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600';
  return { fileId: fileId, url: url };
}

function addPhotoToSheet(code, fileId, url, caption) {
  const sheet = ensureSheet(SHEET_PHOTOS, HEADER_PHOTOS);
  // Determine the next 'order' for this code
  const last = sheet.getLastRow();
  let nextOrder = 0;
  if (last >= 2) {
    const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const iCode = header.indexOf('code');
    const iOrder = header.indexOf('order');
    rows.forEach(function (row) {
      if (String(row[iCode] || '').trim() === code) {
        const o = Number(row[iOrder]) || 0;
        if (o >= nextOrder) nextOrder = o + 1;
      }
    });
  }
  appendKeyedRow(sheet, {
    code: code,
    fileId: fileId,
    url: url,
    caption: caption || '',
    order: nextOrder,
    uploadedAt: new Date().toISOString()
  });
}

function removePhotoFromSheet(fileId) {
  const sheet = ensureSheet(SHEET_PHOTOS, HEADER_PHOTOS);
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const iFid = header.indexOf('fileId');
  const rows = sheet.getRange(2, iFid + 1, last - 1, 1).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === fileId) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function updateCaptionInSheet(fileId, caption) {
  const sheet = ensureSheet(SHEET_PHOTOS, HEADER_PHOTOS);
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const iFid = header.indexOf('fileId');
  const iCap = header.indexOf('caption');
  const rows = sheet.getRange(2, iFid + 1, last - 1, 1).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === fileId) {
      sheet.getRange(i + 2, iCap + 1).setValue(caption || '');
      return true;
    }
  }
  return false;
}

function readPhotosFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_PHOTOS);
  if (!sheet) return { photos: {}, photoCaptions: {}, photoFileIds: {} };
  const last = sheet.getLastRow();
  if (last < 2) return { photos: {}, photoCaptions: {}, photoFileIds: {} };
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const iCode    = header.indexOf('code');
  const iFileId  = header.indexOf('fileId');
  const iUrl     = header.indexOf('url');
  const iCaption = header.indexOf('caption');
  const iOrder   = header.indexOf('order');
  const rows = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
  rows.sort(function (a, b) { return (Number(a[iOrder]) || 0) - (Number(b[iOrder]) || 0); });
  const photos = {};
  const captions = {};
  const fileIds = {};
  rows.forEach(function (row) {
    const code = String(row[iCode] || '').trim();
    const url = String(row[iUrl] || '').trim();
    const cap = String(row[iCaption] || '').trim();
    const fid = String(row[iFileId] || '').trim();
    if (!code || !url) return;
    if (!photos[code])   photos[code] = [];
    if (!captions[code]) captions[code] = [];
    if (!fileIds[code])  fileIds[code] = [];
    photos[code].push(url);
    captions[code].push(cap);
    fileIds[code].push(fid);
  });
  return { photos: photos, photoCaptions: captions, photoFileIds: fileIds };
}

/* ---------------- Types tab (live archetype catalog) ---------------- */

function typeFieldsRow(bucket, type) {
  return {
    bucket:        bucket || 'nonStandard',
    code:          String(type.code || '').trim(),
    name:          String(type.name || '').trim(),
    'class':       String(type['class'] || '').trim(),
    class_full:    String(type.class_full || '').trim(),
    built:         (type.built === '' || type.built == null) ? '' : Number(type.built),
    period_from:   (type.period_from === '' || type.period_from == null) ? '' : Number(type.period_from),
    period_to:     (type.period_to === '' || type.period_to == null) ? '' : Number(type.period_to),
    period_range:  String(type.period_range || '').trim(),
    defective:     type.defective ? 'true' : 'false',
    description:   String(type.description || '').trim(),
    updatedAt:     new Date().toISOString()
  };
}

function findTypeRow(sheet, code) {
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const iCode = header.indexOf('code');
  if (iCode < 0) return -1;
  const codes = sheet.getRange(2, iCode + 1, last - 1, 1).getValues();
  for (var i = 0; i < codes.length; i++) {
    if (String(codes[i][0]).trim() === String(code).trim()) return i + 2; // 1-based row, header is row 1
  }
  return -1;
}

function upsertTypeInSheet(type, bucket) {
  if (!type.code) return;
  const sheet = ensureSheet(SHEET_TYPES, HEADER_TYPES);
  const fields = typeFieldsRow(bucket, type);
  const existingRow = findTypeRow(sheet, type.code);
  if (existingRow > 0) {
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = header.map(function (col) {
      return Object.prototype.hasOwnProperty.call(fields, col) ? fields[col] : '';
    });
    sheet.getRange(existingRow, 1, 1, header.length).setValues([row]);
  } else {
    appendKeyedRow(sheet, fields);
  }
}

function deleteTypeFromSheet(code) {
  const sheet = ensureSheet(SHEET_TYPES, HEADER_TYPES);
  const row = findTypeRow(sheet, code);
  if (row > 0) sheet.deleteRow(row);
}

function bulkReplaceTypes(typesObj) {
  const sheet = ensureSheet(SHEET_TYPES, HEADER_TYPES);
  // Wipe all rows except the header
  const last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
  // Stage rows for both buckets
  const fieldsList = [];
  (typesObj.nonStandard || []).forEach(function (t) { fieldsList.push(typeFieldsRow('nonStandard', t)); });
  (typesObj.traditional || []).forEach(function (t) { fieldsList.push(typeFieldsRow('traditional', t)); });
  if (!fieldsList.length) return;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows = fieldsList.map(function (fields) {
    return header.map(function (col) {
      return Object.prototype.hasOwnProperty.call(fields, col) ? fields[col] : '';
    });
  });
  sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
}

function readTypesFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_TYPES);
  if (!sheet) return null;
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idx = function (h) { return header.indexOf(h); };
  const iBucket    = idx('bucket');
  const iCode      = idx('code');
  const iName      = idx('name');
  const iClass     = idx('class');
  const iClassFull = idx('class_full');
  const iBuilt     = idx('built');
  const iFrom      = idx('period_from');
  const iTo        = idx('period_to');
  const iRange     = idx('period_range');
  const iDefective = idx('defective');
  const iDesc      = idx('description');
  const rows = sheet.getRange(2, 1, last - 1, header.length).getValues();
  const out = { nonStandard: [], traditional: [] };
  rows.forEach(function (row) {
    const code = String(row[iCode] || '').trim();
    if (!code) return;
    const bucket = String(row[iBucket] || 'nonStandard').trim() || 'nonStandard';
    const t = {
      code: code,
      name: String(row[iName] || '').trim(),
      'class': String(row[iClass] || '').trim(),
      class_full: String(row[iClassFull] || '').trim(),
      built:        (row[iBuilt] === '' || row[iBuilt] == null) ? null : Number(row[iBuilt]),
      period_from:  (row[iFrom]  === '' || row[iFrom]  == null) ? null : Number(row[iFrom]),
      period_to:    (row[iTo]    === '' || row[iTo]    == null) ? null : Number(row[iTo]),
      period_range: String(row[iRange] || '').trim(),
      defective:    String(row[iDefective] || '').toLowerCase() === 'true',
      description:  String(row[iDesc] || '').trim()
    };
    if (bucket === 'traditional') out.traditional.push(t);
    else out.nonStandard.push(t);
  });
  return out;
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
        ],
        disagreements: [
          { code: 'S062', officialName: 'Wimpey No-Fines', suggestedName: 'we always called these "Butterfly" round here' }
        ]
      })
    }
  });
}
