/* Transform-ER "Guess the Archetype" — main game logic
   ---------------------------------------------------
   Flow:
     intro form  ->  20-card game (16 non-standard MCQ + 4 traditional portfolio-data, interspersed)
                  ->  end screen (score + leaderboard)  ->  replay
   Backend: Google Apps Script web app (config.js APPS_SCRIPT_URL).
*/
(function () {
  'use strict';

  const CFG = window.APP_CONFIG;
  const LS = {
    seenNonStd:   'ter_seen_nonstd_v1',   // codes the user has seen (for sample-without-replacement across plays)
    seenTrad:     'ter_seen_trad_v1',
    adminData:    'ter_admin_data_v1',    // admin-edited types.json (overrides remote file if present)
    adminPhotos:  'ter_admin_photos_v1',  // { code: [dataUri, ...] }
    lastPlayer:   'ter_last_player_v1'
  };

  /* ==========================================================
     Utilities
     ========================================================== */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    if (children) (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function show(screenId) {
    $all('.screen').forEach(s => s.classList.remove('active'));
    $('#' + screenId).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), ms || 2800);
  }
  function loadJSON(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota */ }
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sampleWithoutReplacement(pool, n, seenKey) {
    if (pool.length === 0) return [];
    const seen = new Set(loadJSON(seenKey, []));
    // Prefer unseen first; if we exhaust unseen, reset and continue.
    const unseen = pool.filter(p => !seen.has(p.code));
    let picks = shuffle(unseen).slice(0, n);
    if (picks.length < n) {
      // Exhausted: reset seen list, refill from full shuffled pool excluding picks.
      seen.clear();
      const remainder = shuffle(pool.filter(p => !picks.includes(p)));
      picks = picks.concat(remainder.slice(0, n - picks.length));
    }
    picks.forEach(p => seen.add(p.code));
    saveJSON(seenKey, Array.from(seen));
    return picks;
  }
  function interleave(nonStdCards, tradCards, total) {
    // Place trad cards at roughly even positions (never first, never last).
    const slots = [];
    for (let i = 0; i < total; i++) slots.push(null);
    const tradSlots = [];
    const gap = Math.floor(total / (tradCards.length + 1));
    for (let i = 1; i <= tradCards.length; i++) tradSlots.push(i * gap);
    tradSlots.forEach((slot, i) => { slots[Math.min(slot, total - 2)] = tradCards[i]; });
    let ns = 0;
    for (let i = 0; i < total; i++) {
      if (slots[i] === null) { slots[i] = nonStdCards[ns++]; }
    }
    return slots.filter(Boolean);
  }
  function fmtInt(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-GB');
  }

  /* ==========================================================
     Data loading — prefer admin-edited version in localStorage
     ========================================================== */
  async function loadTypes() {
    const local = loadJSON(LS.adminData, null);
    if (local && local.nonStandard) return local;
    const res = await fetch('types.json?v=' + encodeURIComponent(CFG.DATA_VERSION), { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load types.json (' + res.status + ')');
    return res.json();
  }

  function getPhotosFor(code) {
    const store = loadJSON(LS.adminPhotos, {});
    return store[code] || [];
  }

  /* ==========================================================
     Non-standard MCQ card
     ========================================================== */
  function buildMcqCard(pick, allNonStd) {
    const tpl = $('#tpl-card-mcq').content.cloneNode(true);
    const root = tpl.firstElementChild;

    // Photo (if admin uploaded any)
    const photos = getPhotosFor(pick.code);
    const photoHolder = $('.photo', root);
    if (photos.length > 0) {
      const idx = Math.floor(Math.random() * photos.length);
      photoHolder.innerHTML = '';
      photoHolder.appendChild(el('img', { src: photos[idx], alt: pick.name }));
      photoHolder.appendChild(el('span', { class: 'tag' }, [
        'Non‑standard · ', el('span', { class: 'cls' }, pick.class_full || pick.class)
      ]));
    } else {
      $('.cls', root).textContent = pick.class_full || pick.class;
    }

    // Options: correct + 3 distractors from same class where possible
    const sameClass = allNonStd.filter(t => t.code !== pick.code && t.class === pick.class);
    const otherClass = allNonStd.filter(t => t.code !== pick.code && t.class !== pick.class);
    const wanted = Math.max(1, (CFG.MCQ_OPTIONS || 4) - 1);
    let distractors = shuffle(sameClass).slice(0, wanted);
    if (distractors.length < wanted) {
      distractors = distractors.concat(shuffle(otherClass).slice(0, wanted - distractors.length));
    }
    const options = shuffle([pick].concat(distractors));
    const letters = ['A','B','C','D','E','F'];
    const optionsMount = $('.options', root);
    const revealEl = $('.reveal', root);
    const factEl = $('.fact', revealEl);
    const metaEl = $('.meta', revealEl);
    const actions = $('.actions', root);

    let answered = false;
    options.forEach((opt, i) => {
      const btn = el('button', { class: 'option', type: 'button' }, [
        el('span', { class: 'lbl' }, letters[i]),
        opt.name
      ]);
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const correct = opt.code === pick.code;
        // Mark all
        $all('.option', root).forEach((b, j) => {
          b.disabled = true;
          if (options[j].code === pick.code) b.classList.add('correct');
          else if (j === i) b.classList.add('incorrect');
        });
        // Reveal facts
        const parts = [];
        if (pick.built) parts.push(el('span', {}, fmtInt(pick.built) + ' built'));
        if (pick.period_from || pick.period_to) {
          const range = [pick.period_from, pick.period_to].filter(Boolean).join('–');
          if (range) parts.push(el('span', {}, 'Built ' + range));
        }
        if (pick.defective) parts.push(el('span', { class: 'defective' }, 'Designated defective'));
        parts.push(el('span', {}, pick.class_full || pick.class));
        metaEl.innerHTML = '';
        parts.forEach(p => metaEl.appendChild(p));

        factEl.textContent = correct
          ? `Correct — that's ${pick.name}.`
          : `Not quite. The answer was ${pick.name}.`;
        $('#reveal-title', revealEl) && ($('#reveal-title', revealEl).textContent = correct ? 'Correct' : 'Revealed');
        revealEl.classList.add('show');
        actions.style.display = 'flex';

        // Store result on the card for the engine to read
        root._result = { correct: correct, chosen: opt.code };
      });
      optionsMount.appendChild(btn);
    });

    return { node: root, getResult: () => root._result || { correct: false, skipped: true } };
  }

  /* ==========================================================
     Traditional (portfolio data) card
     ========================================================== */
  function buildTradCard(pick) {
    const tpl = $('#tpl-card-trad').content.cloneNode(true);
    const root = tpl.firstElementChild;

    $('.prompt', root).textContent = pick.name;
    $('.fact', root).textContent = pick.description || pick.prompt || 'Does your organisation own properties of this traditional archetype?';
    $('.placeholder-label', root).textContent = pick.name;

    // Admin-uploaded photos?
    const photos = getPhotosFor(pick.code);
    if (photos.length > 0) {
      const photoHolder = $('.photo', root);
      const tag = photoHolder.querySelector('.tag');
      photoHolder.innerHTML = '';
      photoHolder.appendChild(el('img', { src: photos[Math.floor(Math.random() * photos.length)], alt: pick.name }));
      photoHolder.appendChild(tag || el('span', { class: 'tag trad' }, 'Traditional'));
    }

    const state = { has: null, count: null, bespoke: '', locations: '' };

    const hasRow = $('.has', root);
    const countRow = $('.how-many', root);
    const bespokeRow = $('.bespoke', root);
    const locationsRow = $('.locations', root);
    const bespokeInput = $('.bespoke-input', root);
    const locationsInput = $('.locations-input', root);

    hasRow.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      hasRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.has = chip.dataset.value;
      if (state.has === 'yes') {
        countRow.style.display = '';
        bespokeRow.style.display = '';
        locationsRow.style.display = '';
      } else {
        countRow.style.display = 'none';
        bespokeRow.style.display = 'none';
        locationsRow.style.display = 'none';
        state.count = null;
        state.bespoke = '';
        state.locations = '';
        countRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        bespokeInput.value = '';
        locationsInput.value = '';
      }
    });

    countRow.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      countRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.count = chip.dataset.value;
    });

    bespokeInput.addEventListener('input', () => { state.bespoke = bespokeInput.value.trim(); });
    locationsInput.addEventListener('input', () => { state.locations = locationsInput.value.trim(); });

    return {
      node: root,
      getResult: () => ({
        correct: null, // not scored
        portfolio: {
          code: pick.code,
          name: pick.name,
          has: state.has,
          count: state.count,
          bespokeName: state.bespoke,
          locations: state.locations
        }
      })
    };
  }

  /* ==========================================================
     Game engine
     ========================================================== */
  const game = {
    types: null,
    player: null,
    cards: [],          // [{kind: 'mcq'|'trad', pick, builder}]
    currentIdx: 0,
    score: 0,
    answers: [],        // per-card results
    portfolioAnswers: [],
    startedAt: null
  };

  async function start() {
    try {
      game.types = await loadTypes();
    } catch (e) {
      toast('Data load failed — check types.json');
      console.error(e);
      return;
    }

    // Wire up intro
    $('#intro-form').addEventListener('submit', onIntroSubmit);
    // Prefill if returning
    const last = loadJSON(LS.lastPlayer, null);
    if (last) {
      $('#f-name').value = last.name || '';
      $('#f-org').value = last.org || '';
      $('#f-role').value = last.role || '';
      $('#f-org-location').value = last.orgLocation || '';
      $('#f-email').value = last.email || '';
      $('#f-phone').value = last.phone || '';
    }

    // End-screen buttons
    $('#btn-replay').addEventListener('click', () => { buildDeck(); show('screen-game'); renderCurrent(); });
    $('#btn-share').addEventListener('click', shareResult);
  }

  function onIntroSubmit(e) {
    e.preventDefault();
    const f = e.target;
    const player = {
      name: f.name.value.trim(),
      org: f.org.value.trim(),
      role: f.role.value.trim(),
      orgLocation: f.orgLocation.value.trim(),
      email: f.email.value.trim(),
      phone: f.phone.value.trim()
    };
    const err = validatePlayer(player);
    const errEl = $('#intro-error');
    if (err) { errEl.textContent = err; errEl.style.display = ''; return; }
    errEl.style.display = 'none';
    game.player = player;
    saveJSON(LS.lastPlayer, player);

    buildDeck();
    show('screen-game');
    renderCurrent();
  }

  function validatePlayer(p) {
    if (!p.name) return 'Please enter your name.';
    if (!p.org) return 'Please enter your organisation.';
    if (!p.orgLocation) return 'Please enter your organisation\'s primary location.';
    if (!p.email) return 'Please enter an email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) return 'That email doesn\'t look right.';
    return null;
  }

  function buildDeck() {
    const total = CFG.CARDS_PER_GAME || 20;
    const tradTarget = CFG.TRADITIONAL_PER_GAME || 4;
    const nsTarget = total - tradTarget;

    const tradPool = (game.types.traditional || []).filter(Boolean);
    const nsPool = (game.types.nonStandard || []).filter(Boolean);

    // If the user hasn't uploaded traditional types yet, fall back to built-in defaults so the game still runs.
    const tradAvail = tradPool.length > 0 ? tradPool : DEFAULT_TRAD_TYPES;

    const tradPicks = sampleWithoutReplacement(tradAvail, Math.min(tradTarget, tradAvail.length), LS.seenTrad);
    const nsPicks = sampleWithoutReplacement(nsPool, nsTarget, LS.seenNonStd);

    // If traditional pool too small, pad with more non-standards
    let nsFinalCount = nsPicks.length + Math.max(0, tradTarget - tradPicks.length);
    if (nsFinalCount > nsPicks.length) {
      const extra = sampleWithoutReplacement(nsPool.filter(p => !nsPicks.includes(p)), nsFinalCount - nsPicks.length, LS.seenNonStd);
      nsPicks.push(...extra);
    }

    const ordered = interleave(
      nsPicks.map(p => ({ kind: 'mcq', pick: p })),
      tradPicks.map(p => ({ kind: 'trad', pick: p })),
      total
    );

    game.cards = ordered;
    game.currentIdx = 0;
    game.score = 0;
    game.answers = [];
    game.portfolioAnswers = [];
    game.startedAt = Date.now();

    $('#counter-total').textContent = total;
    $('#score-now').textContent = '0';
    $('#progress-bar').style.width = '0%';
  }

  function renderCurrent() {
    const i = game.currentIdx;
    const total = game.cards.length;
    $('#counter-current').textContent = (i + 1);
    $('#progress-bar').style.width = ((i) / total * 100).toFixed(1) + '%';

    const mount = $('#card-mount');
    mount.innerHTML = '';

    const card = game.cards[i];
    const builder = card.kind === 'mcq'
      ? buildMcqCard(card.pick, game.types.nonStandard)
      : buildTradCard(card.pick);

    card._builder = builder;

    const nextBtn = builder.node.querySelector('.next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => advance());
    }
    mount.appendChild(builder.node);

    // For trad cards, show the Next button immediately; for MCQ we hide it until they've answered.
    const actions = builder.node.querySelector('.actions');
    if (card.kind === 'trad') actions.style.display = 'flex';
  }

  function advance() {
    const card = game.cards[game.currentIdx];
    const result = card._builder.getResult();

    if (card.kind === 'mcq') {
      if (result.correct) game.score += 1;
      game.answers.push({ code: card.pick.code, name: card.pick.name, correct: !!result.correct, chosen: result.chosen });
      $('#score-now').textContent = String(game.score);
    } else {
      game.portfolioAnswers.push(result.portfolio);
    }

    game.currentIdx += 1;
    if (game.currentIdx >= game.cards.length) {
      finish();
    } else {
      renderCurrent();
      $('#progress-bar').style.width = (game.currentIdx / game.cards.length * 100).toFixed(1) + '%';
    }
  }

  /* ==========================================================
     End screen + leaderboard
     ========================================================== */
  function finish() {
    $('#progress-bar').style.width = '100%';
    const nsTotal = game.cards.filter(c => c.kind === 'mcq').length;
    $('#end-score').textContent = String(game.score);
    $('#end-total').textContent = String(nsTotal);
    const pct = nsTotal ? game.score / nsTotal : 0;
    let verdict = 'Nicely done';
    if (pct >= 0.9) verdict = 'Retrofit legend';
    else if (pct >= 0.7) verdict = 'Impressive';
    else if (pct >= 0.5) verdict = 'Solid';
    else if (pct >= 0.25) verdict = 'Getting started';
    else verdict = 'Room to learn';
    $('#end-verdict').textContent = verdict;
    $('#end-title').textContent = pct >= 0.8 ? 'Excellent work.' : pct >= 0.5 ? 'Good work.' : 'Thanks for playing.';
    show('screen-end');

    submitResults().finally(() => loadLeaderboard());
  }

  async function submitResults() {
    const payload = {
      action: 'submit',
      version: CFG.DATA_VERSION,
      submittedAt: new Date().toISOString(),
      player: game.player,
      result: {
        score: game.score,
        total: game.cards.filter(c => c.kind === 'mcq').length,
        durationMs: Date.now() - game.startedAt,
        answers: game.answers
      },
      portfolio: game.portfolioAnswers
    };
    if (!CFG.APPS_SCRIPT_URL) {
      console.warn('APPS_SCRIPT_URL not set; submission skipped. Payload:', payload);
      return;
    }
    try {
      await fetch(CFG.APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        // text/plain avoids a preflight OPTIONS request that Apps Script can't handle cleanly.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Submission failed', e);
      toast('Couldn\'t reach the server — your score still shows locally.');
    }
  }

  async function loadLeaderboard() {
    const mount = $('#leaderboard-mount');
    if (!CFG.APPS_SCRIPT_URL) {
      mount.innerHTML = '<div class="empty">Leaderboard will appear once the backend is configured.</div>';
      return;
    }
    try {
      const url = CFG.APPS_SCRIPT_URL + '?action=leaderboard&n=' + (CFG.LEADERBOARD_ROWS || 10);
      const res = await fetch(url, { method: 'GET' });
      const rows = await res.json();
      renderLeaderboard(rows);
    } catch (e) {
      console.warn(e);
      mount.innerHTML = '<div class="empty">Leaderboard unavailable. Try again later.</div>';
    }
  }

  function renderLeaderboard(rows) {
    const mount = $('#leaderboard-mount');
    if (!rows || !rows.length) {
      mount.innerHTML = '<div class="empty">No scores yet — you\'re the first.</div>';
      return;
    }
    const me = game.player;
    const table = el('table');
    const thead = el('thead', {}, el('tr', {}, [
      el('th', {}, '#'),
      el('th', {}, 'Name'),
      el('th', {}, 'Organisation'),
      el('th', { style: 'text-align:right;' }, 'Score')
    ]));
    const tbody = el('tbody');
    rows.forEach((r, i) => {
      const isMe = me && r.name === me.name && r.org === me.org;
      const tr = el('tr', { class: isMe ? 'you' : '' }, [
        el('td', { class: 'rank' }, String(i + 1)),
        el('td', {}, r.name || '—'),
        el('td', {}, r.org || '—'),
        el('td', { class: 'score' }, (r.score || 0) + ' / ' + (r.total || CFG.CARDS_PER_GAME - CFG.TRADITIONAL_PER_GAME))
      ]);
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    mount.innerHTML = '';
    mount.appendChild(table);
  }

  function shareResult() {
    const nsTotal = game.cards.filter(c => c.kind === 'mcq').length;
    const line = `I scored ${game.score}/${nsTotal} on Transform-ER's "Guess the Archetype" — how well do you know UK non-traditional housing?`;
    navigator.clipboard.writeText(line).then(
      () => toast('Copied to clipboard'),
      () => toast('Copy failed')
    );
  }

  /* ==========================================================
     Fallback traditional types (used only if admin hasn't added any)
     Named broadly so admin can replace / augment.
     ========================================================== */
  const DEFAULT_TRAD_TYPES = [
    {
      code: 'TRAD-VT-TER',
      name: 'Victorian / Edwardian terrace',
      class: 'TRAD',
      class_full: 'Traditional',
      description: 'Solid-wall brick terraced housing, typically built 1850–1914. Common retrofit challenges: solid-wall insulation and original suspended timber floors.'
    },
    {
      code: 'TRAD-IW-SEMI',
      name: 'Inter-war semi-detached',
      class: 'TRAD',
      class_full: 'Traditional',
      description: 'Cavity-walled semi-detached homes, typically 1919–1939. Usually cavity-wall and loft insulation candidates; often mixed tenure on estates.'
    },
    {
      code: 'TRAD-PW-COUNCIL',
      name: 'Post-war council terrace/semi',
      class: 'TRAD',
      class_full: 'Traditional',
      description: 'Brick or block cavity wall, 1945–1965. Often mixed with non-traditional types on the same estate.'
    },
    {
      code: 'TRAD-LP-FLAT',
      name: 'Low-rise masonry flats',
      class: 'TRAD',
      class_full: 'Traditional',
      description: 'Brick/block 2–4 storey flat blocks, typically 1960s–1980s. Common communal heating, flat roofs, varied cladding.'
    }
  ];

  /* ==========================================================
     Boot
     ========================================================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
