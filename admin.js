/* Transform-ER admin (v2) — types CRUD, photo upload + captions, game settings, JSON export.
   Storage model:
     LS 'ter_admin_data_v1'      : { nonStandard, traditional, settings, version }
     LS 'ter_admin_photos_v1'    : { [code]: ['data:image/...;base64,...', ...] }
     LS 'ter_admin_captions_v1'  : { [code]: ['caption 1', 'caption 2', ...] }   // NEW
   The game (app.js) prefers the localStorage copy over the shipped types.json when present.
*/
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const LS = {
    data:     'ter_admin_data_v1',
    photos:   'ter_admin_photos_v1',
    captions: 'ter_admin_captions_v1',
    fileIds:  'ter_admin_photo_fileids_v1'   // parallel array per code: Drive fileIds
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.from((r || document).querySelectorAll(s)); }
  function load(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  // Best-effort localStorage write. Quota errors are silent — in-memory state still works.
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) {
      try { localStorage.removeItem(k); } catch (e2) {}
      return false;
    }
  }
  // Photos are NEVER persisted to localStorage anymore — they live on the backend
  // (Drive + Photos sheet) and are fetched fresh by admin and game on every load.
  // This wrapper exists so existing call sites stay compact.
  function savePhotosLocal() { /* intentionally no-op */ }
  // Strip photo blobs out of a types-shaped object so it can be persisted to localStorage.
  function stripPhotosFromTypeData(d) {
    if (!d) return d;
    delete d.photos;
    delete d.photoCaptions;
    ['nonStandard', 'traditional'].forEach(k => {
      d[k] = (d[k] || []).map(t => {
        const { photos, photoCaptions, ...rest } = t;
        return rest;
      });
    });
    return d;
  }
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(c => {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  /* ==========================================================
     State
     ========================================================== */
  const state = {
    data: null,
    photos: null,
    captions: null,
    fileIds: null,        // { code: [fileId, fileId, ...] } parallel to photos[]
    filter: 'all',
    search: '',
    selectedCode: null
  };

  /* ---------- backend helpers ---------- */
  async function backendPost(payload) {
    if (!CFG.APPS_SCRIPT_URL) throw new Error('APPS_SCRIPT_URL not configured');
    let res;
    try {
      res = await fetch(CFG.APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ password: CFG.ADMIN_PASSWORD }, payload))
      });
    } catch (e) {
      throw new Error('network error reaching Apps Script: ' + (e && e.message ? e.message : e));
    }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) {
      const snippet = text.slice(0, 240).replace(/\s+/g, ' ').trim();
      throw new Error('non-JSON response (likely script not redeployed or unauthorized): ' + snippet);
    }
    if (parsed && parsed.ok === false) {
      throw new Error('server: ' + (parsed.error || 'unknown error'));
    }
    return parsed;
  }
  async function backendUploadPhoto(code, dataUri, filename, caption) {
    return backendPost({ action: 'uploadPhoto', code, dataUri, filename, caption: caption || '' });
  }
  async function backendDeletePhoto(fileId) {
    if (!fileId) return { ok: true };
    return backendPost({ action: 'deletePhoto', fileId });
  }
  async function backendUpdateCaption(fileId, caption) {
    if (!fileId) return { ok: false };
    return backendPost({ action: 'updateCaption', fileId, caption: caption || '' });
  }
  async function backendSaveType(type, bucket) {
    return backendPost({ action: 'saveType', type, bucket });
  }
  async function backendDeleteType(code) {
    return backendPost({ action: 'deleteType', code });
  }
  async function backendSaveTypesBulk(types) {
    return backendPost({ action: 'saveTypesBulk', types });
  }
  function isDataUri(s) { return typeof s === 'string' && s.indexOf('data:') === 0; }

  function defaultSettings() {
    const easyDefaults = { totalCards: 15, traditionalCount: 3, mcqOptions: 3, distractorScope: 'sameClass', showHint: true };
    const hardDefaults = { totalCards: 25, traditionalCount: 4, mcqOptions: 5, distractorScope: 'mixed',     showHint: false };
    return {
      difficulty: {
        easy: Object.assign({}, easyDefaults, (CFG.DIFFICULTY && CFG.DIFFICULTY.easy) || {}),
        hard: Object.assign({}, hardDefaults, (CFG.DIFFICULTY && CFG.DIFFICULTY.hard) || {})
      }
    };
  }

  async function boot() {
    $('#pwd-go').addEventListener('click', onUnlock);
    $('#pwd').addEventListener('keydown', e => { if (e.key === 'Enter') onUnlock(); });

    if (sessionStorage.getItem('ter_admin_ok') === '1') {
      reveal();
      await initData();
      renderAll();
    } else {
      $('#pwd').focus();
    }
  }

  function onUnlock() {
    const pwd = $('#pwd').value;
    if (pwd && pwd === CFG.ADMIN_PASSWORD) {
      sessionStorage.setItem('ter_admin_ok', '1');
      reveal();
      initData().then(renderAll);
    } else {
      const err = $('#pwd-err');
      err.textContent = 'Wrong password.';
      err.style.display = '';
    }
  }

  function reveal() {
    $('#login').style.display = 'none';
    $('#admin').style.display = '';
  }

  async function initData() {
    state.photos = load(LS.photos, {});
    state.captions = load(LS.captions, {});
    state.fileIds = load(LS.fileIds, {});
    const existing = load(LS.data, null);
    if (existing && existing.nonStandard) {
      // Strip any photo blobs that previous admin builds may have stored here.
      state.data = stripPhotosFromTypeData(existing);
    } else {
      try {
        const res = await fetch('types.json?v=' + encodeURIComponent(CFG.DATA_VERSION), { cache: 'no-store' });
        const parsed = await res.json();
        parsed.traditional = parsed.traditional || [];
        parsed.version = parsed.version || CFG.DATA_VERSION;
        // Pull photos/captions out of state.data — they'll be hydrated into state.photos / state.captions below.
        state.data = stripPhotosFromTypeData(parsed);
      } catch (e) {
        state.data = { nonStandard: [], traditional: [], version: CFG.DATA_VERSION };
        toast('Could not load types.json — starting blank.');
      }
    }
    state.data.settings = state.data.settings || defaultSettings();

    // Pull live settings from Apps Script.
    try {
      if (CFG.APPS_SCRIPT_URL) {
        const res = await fetch(CFG.APPS_SCRIPT_URL + '?action=settings&t=' + Date.now());
        const remote = await res.json();
        if (remote && remote.difficulty) state.data.settings.difficulty = remote.difficulty;
      }
    } catch (e) { /* fall through to local defaults */ }

    // Pull live types from Apps Script. Backend wins over local types when present.
    try {
      if (CFG.APPS_SCRIPT_URL) {
        const res = await fetch(CFG.APPS_SCRIPT_URL + '?action=types&t=' + Date.now());
        const liveTypes = await res.json();
        if (liveTypes && (Array.isArray(liveTypes.nonStandard) || Array.isArray(liveTypes.traditional))) {
          // Use backend version verbatim.
          state.data.nonStandard = liveTypes.nonStandard || [];
          state.data.traditional = liveTypes.traditional || [];
          persistData();
        }
      }
    } catch (e) { /* fall through to local types */ }

    // Pull live photos from Apps Script — these are Drive-hosted URLs. Live photos win
    // over locally-cached copies so what admin sees == what players see.
    try {
      if (CFG.APPS_SCRIPT_URL) {
        const res = await fetch(CFG.APPS_SCRIPT_URL + '?action=photos&t=' + Date.now());
        const live = await res.json();
        if (live && live.photos) {
          // Replace each code's array with the backend version.
          Object.keys(live.photos).forEach(code => {
            state.photos[code] = (live.photos[code] || []).slice();
            state.captions[code] = (live.photoCaptions && live.photoCaptions[code]) || [];
            state.fileIds[code] = (live.photoFileIds && live.photoFileIds[code]) || [];
          });
          savePhotosLocal();
          save(LS.captions, state.captions);
          save(LS.fileIds, state.fileIds);
        }
      }
    } catch (e) { /* fall through */ }

    // Auto-load photos + captions from types.json into memory if localStorage was empty.
    // We do NOT persist the bulk photos to localStorage here — they're already in types.json
    // and most browsers cap localStorage at 5–10 MB which Beck's photos can exceed.
    // Persistence only kicks in when admin actually edits a photo (see onPhotoUpload).
    if (Object.keys(state.photos).length === 0) {
      try {
        const res = await fetch('types.json?v=' + encodeURIComponent(CFG.DATA_VERSION), { cache: 'no-store' });
        const parsed = await res.json();
        const topPhotos = parsed.photos || {};
        const topCaps = parsed.photoCaptions || {};
        const mergedPhotos = Object.assign({}, topPhotos);
        const mergedCaps = Object.assign({}, topCaps);
        ['nonStandard', 'traditional'].forEach(key => {
          (parsed[key] || []).forEach(t => {
            if (t.photos && t.photos.length) {
              mergedPhotos[t.code] = (mergedPhotos[t.code] || []).concat(
                t.photos.filter(p => !(mergedPhotos[t.code] || []).includes(p))
              );
            }
            if (t.photoCaptions && t.photoCaptions.length) {
              mergedCaps[t.code] = (mergedCaps[t.code] || []).concat(t.photoCaptions);
            }
          });
        });
        if (Object.keys(mergedPhotos).length > 0) state.photos = mergedPhotos;
        // Merge — user-edited captions in localStorage win over anything in types.json.
        if (Object.keys(mergedCaps).length > 0) {
          state.captions = Object.assign({}, mergedCaps, state.captions);
        }
        save(LS.captions, state.captions);
      } catch (e) { /* silent */ }
    }

    // Wire UI
    $all('#filter .chip').forEach(c => c.addEventListener('click', () => {
      $all('#filter .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      state.filter = c.dataset.filter;
      renderList();
    }));
    $('#search').addEventListener('input', e => { state.search = e.target.value.trim().toLowerCase(); renderList(); });
    $('#btn-new-nonstd').addEventListener('click', () => newType('nonStandard'));
    $('#btn-new-trad').addEventListener('click', () => newType('traditional'));
    $('#btn-save').addEventListener('click', saveCurrent);
    $('#btn-delete').addEventListener('click', deleteCurrent);
    $('#btn-export').addEventListener('click', exportJson);
    $('#btn-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', onImport);
    $('#btn-reset').addEventListener('click', resetToShipped);
    $('#e-photo-file').addEventListener('change', onPhotoUpload);
    $('#btn-save-settings').addEventListener('click', saveSettings);
    const migBtn = $('#btn-migrate');
    if (migBtn) migBtn.addEventListener('click', migratePhotosToDrive);
    const syncBtn = $('#btn-sync-types');
    if (syncBtn) syncBtn.addEventListener('click', syncTypesToBackend);

    fillSettingsForm();
    refreshMigrationPanel();
  }

  /* ==========================================================
     Settings panel
     ========================================================== */
  function fillSettingsForm() {
    const s = state.data.settings || defaultSettings();
    const e = (s.difficulty && s.difficulty.easy) || {};
    const h = (s.difficulty && s.difficulty.hard) || {};
    $('#s-easy-total').value = e.totalCards || 15;
    $('#s-easy-trad').value  = e.traditionalCount != null ? e.traditionalCount : 3;
    $('#s-easy-mcq').value   = e.mcqOptions || 3;
    $('#s-easy-scope').value = e.distractorScope || 'sameClass';
    $('#s-easy-hint').checked = !!e.showHint;
    $('#s-hard-total').value = h.totalCards || 25;
    $('#s-hard-trad').value  = h.traditionalCount != null ? h.traditionalCount : 4;
    $('#s-hard-mcq').value   = h.mcqOptions || 5;
    $('#s-hard-scope').value = h.distractorScope || 'mixed';
    $('#s-hard-hint').checked = !!h.showHint;
  }

  function readDiffProfileFromForm(prefix, defaults) {
    const total = Math.max(1, parseInt($('#s-' + prefix + '-total').value, 10) || defaults.totalCards);
    const trad = Math.max(0, Math.min(total, parseInt($('#s-' + prefix + '-trad').value, 10) || 0));
    return {
      totalCards: total,
      traditionalCount: trad,
      mcqOptions: Math.max(2, parseInt($('#s-' + prefix + '-mcq').value, 10) || defaults.mcqOptions),
      distractorScope: $('#s-' + prefix + '-scope').value,
      showHint: $('#s-' + prefix + '-hint').checked
    };
  }

  async function saveSettings() {
    const settings = {
      difficulty: {
        easy: readDiffProfileFromForm('easy', { totalCards: 15, mcqOptions: 3 }),
        hard: readDiffProfileFromForm('hard', { totalCards: 25, mcqOptions: 5 })
      }
    };
    state.data.settings = settings;
    persistData();
    setSettingsStatus('Saving…');

    if (!CFG.APPS_SCRIPT_URL) {
      setSettingsStatus('Saved locally (no backend URL configured).');
      return;
    }

    try {
      const res = await fetch(CFG.APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'saveSettings', password: CFG.ADMIN_PASSWORD, settings })
      });
      // Apps Script POST follows a 302 -> response body — we can't read it cross-origin.
      // Treat a non-network-error as success.
      setSettingsStatus('Saved · live across all players');
      toast('Settings saved to server.');
    } catch (e) {
      setSettingsStatus('Saved locally — server unreachable.');
      toast('Couldn\'t reach server. Settings saved locally only.');
    }
  }

  function setSettingsStatus(msg) {
    const el = $('#settings-status');
    if (el) el.textContent = msg;
  }
  function setMigrationStatus(msg) {
    const el = $('#migrate-status');
    if (el) el.textContent = msg || '';
  }

  /* ---------- sync types to backend ---------- */
  async function syncTypesToBackend() {
    if (!CFG.APPS_SCRIPT_URL) { toast('Backend URL not configured.'); return; }
    const total = (state.data.nonStandard || []).length + (state.data.traditional || []).length;
    if (!confirm('Push all ' + total + ' types to the server? Existing server-side types will be replaced with this list.')) return;
    try {
      await backendSaveTypesBulk({
        nonStandard: state.data.nonStandard || [],
        traditional: state.data.traditional || []
      });
      toast('Synced ' + total + ' types to the server. Players see them on next reload.');
    } catch (e) {
      toast('Sync failed: ' + e.message);
    }
  }

  /* ---------- migration: base64 photos -> Drive ---------- */
  function countLegacyPhotos() {
    let n = 0;
    Object.keys(state.photos || {}).forEach(code => {
      (state.photos[code] || []).forEach(p => { if (isDataUri(p)) n++; });
    });
    return n;
  }
  function refreshMigrationPanel() {
    const panel = $('#migrate-panel');
    if (!panel) return;
    const n = countLegacyPhotos();
    if (n > 0) {
      panel.hidden = false;
      $('#migrate-count').textContent = String(n);
    } else {
      panel.hidden = true;
    }
  }
  async function migratePhotosToDrive() {
    if (!CFG.APPS_SCRIPT_URL) { toast('Backend URL not configured.'); return; }
    const todo = [];
    Object.keys(state.photos || {}).forEach(code => {
      (state.photos[code] || []).forEach((p, i) => {
        if (isDataUri(p)) todo.push({ code, idx: i, dataUri: p });
      });
    });
    if (!todo.length) { toast('Nothing to migrate.'); return; }
    if (!confirm('Upload ' + todo.length + ' photos to your Drive folder? This may take a minute or two.')) return;

    setMigrationStatus('Migrating 0 / ' + todo.length + '…');
    let ok = 0;
    let lastErr = null;
    for (let i = 0; i < todo.length; i++) {
      setMigrationStatus('Migrating ' + (i + 1) + ' / ' + todo.length + '…');
      const item = todo[i];
      try {
        const filename = item.code + '_' + item.idx + '.jpg';
        const captionExisting = ((state.captions[item.code] || [])[item.idx]) || '';
        const result = await backendUploadPhoto(item.code, item.dataUri, filename, captionExisting);
        if (result && result.ok && result.url) {
          state.photos[item.code][item.idx] = result.url;
          if (!state.fileIds[item.code]) state.fileIds[item.code] = [];
          state.fileIds[item.code][item.idx] = result.fileId;
          ok++;
        } else {
          lastErr = (result && result.error) ? result.error : 'unknown error';
          console.warn('Upload returned non-ok for ' + item.code + '#' + item.idx, result);
          // Stop at the first failure — running 37 fails in a row is wasteful.
          // Show the error so the user can see what's wrong.
          setMigrationStatus('Failed at ' + (i + 1) + ' / ' + todo.length + ' — ' + lastErr);
          break;
        }
      } catch (e) {
        lastErr = (e && e.message) ? e.message : String(e);
        console.warn('Migration error for ' + item.code + '#' + item.idx, e);
        setMigrationStatus('Failed at ' + (i + 1) + ' / ' + todo.length + ' — ' + lastErr);
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    savePhotosLocal();
    save(LS.fileIds, state.fileIds);
    if (ok === todo.length) {
      setMigrationStatus(ok + ' / ' + todo.length + ' migrated.');
      toast('All photos migrated. Export types.json and push so visitors stop loading the old base64 blob.');
    } else if (ok > 0) {
      toast(ok + ' uploaded before the run stopped. ' + (lastErr ? '(' + lastErr + ')' : ''));
    } else {
      toast('Migration failed — ' + (lastErr || 'see console') + '. Check the script is redeployed.');
    }
    refreshMigrationPanel();
    renderPhotos();
    renderList();
  }

  /* ==========================================================
     Type list + editor
     ========================================================== */
  function renderAll() { renderList(); clearEditor(); }

  function allTypes() {
    const ns = (state.data.nonStandard || []).map(t => ({ ...t, _bucket: 'nonStandard' }));
    const tr = (state.data.traditional || []).map(t => ({ ...t, _bucket: 'traditional' }));
    return ns.concat(tr);
  }

  function renderList() {
    const mount = $('#list');
    mount.innerHTML = '';
    let rows = allTypes();
    if (state.filter === 'nonstd') rows = rows.filter(r => r._bucket === 'nonStandard');
    if (state.filter === 'trad') rows = rows.filter(r => r._bucket === 'traditional');
    if (state.search) {
      const q = state.search;
      rows = rows.filter(r =>
        (r.name || '').toLowerCase().includes(q) ||
        (r.code || '').toLowerCase().includes(q) ||
        (r.class || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (rows.length === 0) {
      mount.appendChild(el('div', { class: 'empty', style: 'padding:16px;color:var(--muted);font-size:13px;' }, 'No types match.'));
      return;
    }

    rows.forEach(r => {
      const photoCount = (state.photos[r.code] || []).length;
      const row = el('div', {
        class: 'type-row' + (state.selectedCode === r.code ? ' active' : ''),
        onclick: () => selectType(r.code)
      }, [
        el('div', {}, [
          el('div', { class: 'nm' }, r.name || '(unnamed)'),
          el('div', { class: 'cls' }, [
            r.code || '—', ' · ', r.class_full || r.class || '—',
            photoCount ? ` · ${photoCount} photo${photoCount > 1 ? 's' : ''}` : ''
          ].join(''))
        ])
      ]);
      mount.appendChild(row);
    });
  }

  function classFullFor(cls) {
    return {
      MET: 'Metal Frame', PCC: 'Precast Concrete', ISC: 'In-Situ Concrete',
      TIM: 'Timber Frame', TRAD: 'Traditional', OTH: 'Other'
    }[cls] || cls || '—';
  }

  function findType(code) {
    let t = (state.data.nonStandard || []).find(x => x.code === code);
    if (t) return { t, bucket: 'nonStandard' };
    t = (state.data.traditional || []).find(x => x.code === code);
    if (t) return { t, bucket: 'traditional' };
    return null;
  }

  function selectType(code) {
    state.selectedCode = code;
    renderList();
    const found = findType(code);
    if (!found) return clearEditor();
    const t = found.t;
    $('#editor').style.display = '';
    $('#editor-title').textContent = (found.bucket === 'traditional' ? 'Traditional · ' : 'Non‑standard · ') + (t.name || '(new)');
    $('#e-code').value = t.code || '';
    $('#e-name').value = t.name || '';
    $('#e-class').value = t.class || (found.bucket === 'traditional' ? 'TRAD' : 'MET');
    $('#e-built').value = t.built || '';
    $('#e-from').value = t.period_from || '';
    $('#e-to').value = t.period_to || '';
    $('#e-defective').checked = !!t.defective;
    $('#e-desc').value = t.description || '';
    renderPhotos();
  }

  function clearEditor() {
    state.selectedCode = null;
    $('#editor').style.display = 'none';
    $('#editor-title').textContent = 'Select a type to edit';
  }

  function renderPhotos() {
    const mount = $('#e-photos');
    mount.innerHTML = '';
    const code = state.selectedCode;
    if (!code) return;
    const photos = state.photos[code] || [];
    const captions = state.captions[code] || [];
    photos.forEach((src, i) => {
      const captionInput = el('input', {
        type: 'text',
        class: 'caption-input',
        placeholder: 'Photo credit / caption',
        value: captions[i] || ''
      });
      // Set .value via DOM property too, just in case the attribute path is unreliable
      captionInput.value = captions[i] || '';

      const tick = el('span', { class: 'caption-saved' }, '✓');

      const persistThis = () => {
        const arr = state.captions[code] ? state.captions[code].slice() : [];
        while (arr.length < i) arr.push('');
        const newVal = captionInput.value.trim();
        const changed = arr[i] !== newVal;
        arr[i] = newVal;
        state.captions[code] = arr;
        save(LS.captions, state.captions);
        // flash the tick (locally saved)
        tick.classList.add('show');
        clearTimeout(captionInput._t);
        captionInput._t = setTimeout(() => tick.classList.remove('show'), 1200);

        // Push the change to the backend (debounced) if this photo is Drive-hosted.
        const fileId = (state.fileIds[code] || [])[i];
        if (changed && fileId && CFG.APPS_SCRIPT_URL) {
          clearTimeout(captionInput._netT);
          captionInput._netT = setTimeout(() => {
            backendUpdateCaption(fileId, newVal).catch(err => {
              console.warn('Caption sync failed', err);
            });
          }, 500);
        }
      };
      captionInput.addEventListener('input',  persistThis);
      captionInput.addEventListener('change', persistThis);
      captionInput.addEventListener('blur',   persistThis);

      const ph = el('div', { class: 'ph' }, [
        el('img', { src, alt: 'photo ' + (i + 1) }),
        captionInput,
        tick,
        el('button', { type: 'button', title: 'Delete photo', onclick: () => removePhoto(code, i) }, '×')
      ]);
      mount.appendChild(ph);
    });
  }

  /* ==========================================================
     CRUD
     ========================================================== */
  async function newType(bucket) {
    const code = bucket === 'traditional'
      ? 'TRAD-' + Math.random().toString(36).slice(2, 6).toUpperCase()
      : 'NEW-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const t = {
      code,
      name: bucket === 'traditional' ? 'New traditional archetype' : 'New non-standard system',
      class: bucket === 'traditional' ? 'TRAD' : 'MET',
      class_full: bucket === 'traditional' ? 'Traditional' : 'Metal Frame',
      built: null,
      period_from: null,
      period_to: null,
      period_range: '',
      defective: false,
      description: ''
    };
    (state.data[bucket] = state.data[bucket] || []).push(t);
    persistData();
    state.selectedCode = code;
    renderList();
    selectType(code);

    // Sync to backend so the type appears for the game on next reload.
    if (CFG.APPS_SCRIPT_URL) {
      try { await backendSaveType(t, bucket); }
      catch (e) { toast('New type saved locally — couldn\'t reach server: ' + e.message); }
    }
  }

  async function saveCurrent() {
    if (!state.selectedCode) return;
    const found = findType(state.selectedCode);
    if (!found) return;
    const t = found.t;
    const oldCode = t.code;
    const newCode = $('#e-code').value.trim();
    const cls = $('#e-class').value;
    const targetBucket = cls === 'TRAD' ? 'traditional' : 'nonStandard';

    t.name = $('#e-name').value.trim();
    t.class = cls;
    t.class_full = classFullFor(cls);
    t.built = $('#e-built').value ? Number($('#e-built').value) : null;
    t.period_from = $('#e-from').value ? Number($('#e-from').value) : null;
    t.period_to = $('#e-to').value ? Number($('#e-to').value) : null;
    t.defective = $('#e-defective').checked;
    t.description = $('#e-desc').value.trim();

    if (newCode && newCode !== t.code) {
      if (state.photos[t.code]) {
        state.photos[newCode] = state.photos[t.code];
        delete state.photos[t.code];
        savePhotosLocal();
      }
      if (state.captions[t.code]) {
        state.captions[newCode] = state.captions[t.code];
        delete state.captions[t.code];
        save(LS.captions, state.captions);
      }
      t.code = newCode;
      state.selectedCode = newCode;
    }

    if (targetBucket !== found.bucket) {
      state.data[found.bucket] = state.data[found.bucket].filter(x => x.code !== t.code);
      (state.data[targetBucket] = state.data[targetBucket] || []).push(t);
    }

    persistData();
    renderList();
    selectType(state.selectedCode);

    // Sync to backend
    let synced = true;
    if (CFG.APPS_SCRIPT_URL) {
      try {
        // If the code changed, delete the old row first so we don't leave a stale record.
        if (oldCode && oldCode !== t.code) await backendDeleteType(oldCode);
        await backendSaveType(t, targetBucket);
      } catch (e) {
        synced = false;
        toast('Saved locally — server didn\'t accept the change: ' + e.message);
      }
    }
    if (synced) toast('Saved.');
  }

  async function deleteCurrent() {
    if (!state.selectedCode) return;
    if (!confirm('Delete this type? This cannot be undone.')) return;
    const found = findType(state.selectedCode);
    if (!found) return;
    const code = state.selectedCode;
    state.data[found.bucket] = state.data[found.bucket].filter(x => x.code !== code);
    if (state.photos[code]) {
      delete state.photos[code];
      savePhotosLocal();
    }
    if (state.captions[code]) {
      delete state.captions[code];
      save(LS.captions, state.captions);
    }
    persistData();
    clearEditor();
    renderList();

    if (CFG.APPS_SCRIPT_URL) {
      try { await backendDeleteType(code); toast('Deleted.'); }
      catch (e) { toast('Deleted locally — server unreachable: ' + e.message); }
    } else {
      toast('Deleted.');
    }
  }

  function persistData() {
    state.data.version = state.data.version || CFG.DATA_VERSION;
    // Defensive: strip any photo blobs that may have leaked into state.data so the
    // localStorage write stays small and never blows quota.
    stripPhotosFromTypeData(state.data);
    save(LS.data, state.data);
  }

  /* ==========================================================
     Photos + captions — Drive-hosted via Apps Script
     ========================================================== */
  async function onPhotoUpload(e) {
    const code = state.selectedCode;
    if (!code) return;
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (!CFG.APPS_SCRIPT_URL) {
      toast('Backend URL not configured — cannot upload.');
      return;
    }

    setMigrationStatus('');
    let okCount = 0;
    for (let i = 0; i < files.length; i++) {
      toast('Uploading ' + (i + 1) + '/' + files.length + '…');
      try {
        const dataUri = await fileToDataUri(files[i]);
        const result = await backendUploadPhoto(code, dataUri, files[i].name, '');
        if (result && result.ok && result.url) {
          state.photos[code]   = (state.photos[code] || []).concat(result.url);
          state.captions[code] = (state.captions[code] || []).concat('');
          state.fileIds[code]  = (state.fileIds[code] || []).concat(result.fileId);
          savePhotosLocal();
          save(LS.captions, state.captions);
          save(LS.fileIds, state.fileIds);
          okCount++;
          renderPhotos();
          renderList();
        } else {
          console.warn('Upload returned non-ok', result);
        }
      } catch (err) {
        console.error('Upload failed for ' + files[i].name, err);
      }
    }
    toast(okCount + '/' + files.length + ' uploaded to Drive.');
  }

  async function removePhoto(code, idx) {
    const fileId = (state.fileIds[code] || [])[idx];

    // Optimistic local removal so the UI is instant
    (state.photos[code] || []).splice(idx, 1);
    if (state.captions[code]) state.captions[code].splice(idx, 1);
    if (state.fileIds[code]) state.fileIds[code].splice(idx, 1);
    savePhotosLocal();
    save(LS.captions, state.captions);
    save(LS.fileIds, state.fileIds);
    renderPhotos();
    renderList();

    // Best-effort backend cleanup
    if (fileId && CFG.APPS_SCRIPT_URL) {
      try { await backendDeletePhoto(fileId); }
      catch (e) { console.warn('Backend delete failed', e); }
    }
  }

  function fileToDataUri(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            const scale = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ==========================================================
     Import / Export / Reset
     ========================================================== */
  function exportJson() {
    const payload = JSON.parse(JSON.stringify(state.data));
    // Only embed photos that aren't on Drive (i.e. legacy base64). Drive-hosted
    // photos live on the backend Photos sheet — players GET them at runtime.
    const legacyPhotos = {};
    Object.keys(state.photos || {}).forEach(code => {
      const arr = (state.photos[code] || []).filter(isDataUri);
      if (arr.length) legacyPhotos[code] = arr;
    });
    if (Object.keys(legacyPhotos).length) payload.photos = legacyPhotos;
    payload.photoCaptions = state.captions;  // captions stay portable; backend is also source of truth
    payload.exportedAt = new Date().toISOString();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'types.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported types.json');
  }

  function onImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.nonStandard && !parsed.traditional) throw new Error('Missing nonStandard/traditional keys');

        // Merge photos from three sources (top-level, inline, existing localStorage)
        const mergedPhotos = Object.assign({}, state.photos);
        const mergedCaps = Object.assign({}, state.captions);
        if (parsed.photos) Object.assign(mergedPhotos, parsed.photos);
        if (parsed.photoCaptions) Object.assign(mergedCaps, parsed.photoCaptions);

        ['nonStandard', 'traditional'].forEach(k => {
          (parsed[k] || []).forEach(t => {
            if (t.photos && t.photos.length) {
              mergedPhotos[t.code] = (mergedPhotos[t.code] || []).concat(
                t.photos.filter(p => !(mergedPhotos[t.code] || []).includes(p))
              );
            }
            if (t.photoCaptions && t.photoCaptions.length) {
              mergedCaps[t.code] = (mergedCaps[t.code] || []).concat(t.photoCaptions);
            }
          });
        });

        state.photos = mergedPhotos;
        state.captions = mergedCaps;

        const stripInline = arr => (arr || []).map(t => {
          const { photos, photoCaptions, ...rest } = t;
          return rest;
        });

        state.data = {
          nonStandard: stripInline(parsed.nonStandard),
          traditional: stripInline(parsed.traditional),
          settings: parsed.settings || state.data.settings || defaultSettings(),
          version: parsed.version || CFG.DATA_VERSION
        };

        persistData();
        savePhotosLocal();
        save(LS.captions, state.captions);
        renderList();
        clearEditor();
        fillSettingsForm();

        const photoCount = Object.values(state.photos).reduce((n, arr) => n + arr.length, 0);
        toast('Imported — ' + photoCount + ' photo' + (photoCount !== 1 ? 's' : '') + ' loaded.');
      } catch (err) {
        toast('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function resetToShipped() {
    if (!confirm('Reset to the shipped types.json? This clears local edits but keeps photos.')) return;
    try {
      const res = await fetch('types.json?v=' + encodeURIComponent(CFG.DATA_VERSION) + '&r=' + Date.now(), { cache: 'no-store' });
      const parsed = await res.json();
      state.data = {
        nonStandard: parsed.nonStandard || [],
        traditional: parsed.traditional || [],
        settings: parsed.settings || defaultSettings(),
        version: parsed.version || CFG.DATA_VERSION
      };
      persistData();
      renderList();
      clearEditor();
      fillSettingsForm();
      toast('Reset to shipped.');
    } catch (e) {
      toast('Reset failed: ' + e.message);
    }
  }

  /* ==========================================================
     Boot
     ========================================================== */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
