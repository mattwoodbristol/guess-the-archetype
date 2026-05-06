/* Transform-ER admin — CRUD for archetypes, photo upload, JSON export/import.
   Storage model:
     LS 'ter_admin_data_v1'   : { nonStandard: [...], traditional: [...], version: '...' }
     LS 'ter_admin_photos_v1' : { [code]: ['data:image/...;base64,...', ...] }
   The game (app.js) prefers the localStorage copy over the shipped types.json when present.
*/
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const LS = { data: 'ter_admin_data_v1', photos: 'ter_admin_photos_v1' };

  function $(s, r) { return (r || document).querySelector(s); }
  function $all(s, r) { return Array.from((r || document).querySelectorAll(s)); }
  function load(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('Storage full — export JSON then clear older photos.'); } }
  function toast(msg) {
    const t = $('#toast');
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
    data: null,         // { nonStandard, traditional, version }
    photos: null,       // { code: [dataUri] }
    filter: 'all',
    search: '',
    selectedCode: null,
    dirtyPhotos: false
  };

  async function boot() {
    // Login
    $('#pwd-go').addEventListener('click', onUnlock);
    $('#pwd').addEventListener('keydown', e => { if (e.key === 'Enter') onUnlock(); });

    // Try auto-unlock if a session flag exists
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
    const existing = load(LS.data, null);
    if (existing && existing.nonStandard) {
      state.data = existing;
    } else {
      // Load shipped version
      try {
        const res = await fetch('types.json?v=' + encodeURIComponent(CFG.DATA_VERSION), { cache: 'no-store' });
        state.data = await res.json();
        // Ensure structure
        state.data.traditional = state.data.traditional || [];
        state.data.version = state.data.version || CFG.DATA_VERSION;
      } catch (e) {
        state.data = { nonStandard: [], traditional: [], version: CFG.DATA_VERSION };
        toast('Could not load types.json — starting blank.');
      }
    }

    // Wire up buttons
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
  }

  /* ==========================================================
     Rendering
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
            r.code || '—',
            ' · ',
            r.class_full || r.class || '—',
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
      TIM: 'Timber Frame', TRAD: 'Traditional'
    }[cls] || cls || '—';
  }

  function findType(code) {
    let t = (state.data.nonStandard || []).find(x => x.code === code);
    if (t) return { t: t, bucket: 'nonStandard' };
    t = (state.data.traditional || []).find(x => x.code === code);
    if (t) return { t: t, bucket: 'traditional' };
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
    photos.forEach((src, i) => {
      const ph = el('div', { class: 'ph' }, [
        el('img', { src: src, alt: 'photo ' + (i + 1) }),
        el('button', { type: 'button', title: 'Delete photo', onclick: () => removePhoto(code, i) }, '×')
      ]);
      mount.appendChild(ph);
    });
  }

  /* ==========================================================
     CRUD
     ========================================================== */
  function newType(bucket) {
    const code = bucket === 'traditional'
      ? 'TRAD-' + Math.random().toString(36).slice(2, 6).toUpperCase()
      : 'NEW-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const t = {
      code: code,
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
  }

  function saveCurrent() {
    if (!state.selectedCode) return;
    const found = findType(state.selectedCode);
    if (!found) return;
    const t = found.t;
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

    // Code change: migrate photo storage + stored code
    if (newCode && newCode !== t.code) {
      if (state.photos[t.code]) {
        state.photos[newCode] = state.photos[t.code];
        delete state.photos[t.code];
        save(LS.photos, state.photos);
      }
      t.code = newCode;
      state.selectedCode = newCode;
    }

    // Bucket migration (TRAD ↔ non-standard)
    if (targetBucket !== found.bucket) {
      state.data[found.bucket] = state.data[found.bucket].filter(x => x.code !== t.code);
      (state.data[targetBucket] = state.data[targetBucket] || []).push(t);
    }

    persistData();
    renderList();
    selectType(state.selectedCode);
    toast('Saved.');
  }

  function deleteCurrent() {
    if (!state.selectedCode) return;
    if (!confirm('Delete this type? This cannot be undone in this browser (but your last export still has it).')) return;
    const found = findType(state.selectedCode);
    if (!found) return;
    state.data[found.bucket] = state.data[found.bucket].filter(x => x.code !== state.selectedCode);
    if (state.photos[state.selectedCode]) {
      delete state.photos[state.selectedCode];
      save(LS.photos, state.photos);
    }
    persistData();
    clearEditor();
    renderList();
    toast('Deleted.');
  }

  function persistData() {
    state.data.version = state.data.version || CFG.DATA_VERSION;
    save(LS.data, state.data);
  }

  /* ==========================================================
     Photos
     ========================================================== */
  function onPhotoUpload(e) {
    const code = state.selectedCode;
    if (!code) return;
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;

    Promise.all(files.map(fileToDataUri)).then(uris => {
      state.photos[code] = (state.photos[code] || []).concat(uris);
      save(LS.photos, state.photos);
      renderPhotos();
      renderList();
      toast(`Added ${uris.length} photo${uris.length > 1 ? 's' : ''}.`);
    }).catch(err => {
      console.error(err);
      toast('Photo upload failed.');
    });
  }

  function removePhoto(code, idx) {
    (state.photos[code] || []).splice(idx, 1);
    save(LS.photos, state.photos);
    renderPhotos();
    renderList();
  }

  function fileToDataUri(file) {
    return new Promise((resolve, reject) => {
      // Downscale large images to keep localStorage reasonable
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
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
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
    // Embed photos as a separate top-level key so types.json stays readable.
    payload.photos = state.photos;
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

        // Extract photos from three possible locations and merge them all:
        //   1. Top-level photos key  { code: [dataUri, ...] }
        //   2. Inline photos field on each type object
        //   3. Existing localStorage photos (don't wipe photos for types not in this import)
        const merged = Object.assign({}, state.photos);

        if (parsed.photos) {
          Object.assign(merged, parsed.photos);
        }

        (parsed.nonStandard || []).forEach(t => {
          if (t.photos && t.photos.length) {
            merged[t.code] = (merged[t.code] || []).concat(
              t.photos.filter(p => !(merged[t.code] || []).includes(p))
            );
          }
        });

        state.photos = merged;

        // Strip inline photos from the data objects so they aren't double-stored
        const cleanNonStandard = (parsed.nonStandard || []).map(t => {
          const { photos, ...rest } = t;
          return rest;
        });

        state.data = {
          nonStandard: cleanNonStandard,
          traditional: parsed.traditional || [],
          version: parsed.version || CFG.DATA_VERSION
        };

        persistData();
        save(LS.photos, state.photos);
        renderList();
        clearEditor();

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
      state.data = await res.json();
      state.data.traditional = state.data.traditional || [];
      persistData();
      renderList();
      clearEditor();
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
