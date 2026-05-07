/* Transform-ER "Guess the Archetype" — main game logic (v2)
   ----------------------------------------------------------
   Flow:
     intro form (+ difficulty + top-10 leaderboard)
        ->  N-card game: non-standard MCQ (with post-MCQ portfolio prompt)
            interspersed with traditional portfolio-data cards (skippable)
        ->  end screen (score + leaderboard, tagged easy/hard)  ->  replay
   Backend: Google Apps Script web app (config.js APPS_SCRIPT_URL).
*/
(function () {
  'use strict';

  const CFG = window.APP_CONFIG;
  const LS = {
    seenNonStd:   'ter_seen_nonstd_v1',
    seenTrad:     'ter_seen_trad_v1',
    adminData:    'ter_admin_data_v1',
    adminPhotos:  'ter_admin_photos_v1',
    lastPlayer:   'ter_last_player_v1',
    lastDiff:     'ter_last_difficulty_v1'
  };

  /* ==========================================================
     Tiny DOM helpers
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
    if (!t) return;
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
    const unseen = pool.filter(p => !seen.has(p.code));
    let picks = shuffle(unseen).slice(0, n);
    if (picks.length < n) {
      seen.clear();
      const remainder = shuffle(pool.filter(p => !picks.includes(p)));
      picks = picks.concat(remainder.slice(0, n - picks.length));
    }
    picks.forEach(p => seen.add(p.code));
    saveJSON(seenKey, Array.from(seen));
    return picks;
  }
  function interleave(nonStdCards, tradCards, total) {
    const slots = [];
    for (let i = 0; i < total; i++) slots.push(null);
    if (tradCards.length > 0) {
      const gap = Math.max(1, Math.floor(total / (tradCards.length + 1)));
      for (let i = 0; i < tradCards.length; i++) {
        const idx = Math.min((i + 1) * gap, total - 2);
        slots[idx] = tradCards[i];
      }
    }
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
     Settings — live (Apps Script) overrides types.json overrides config.js
     Each difficulty profile carries its own totalCards / traditionalCount.
     ========================================================== */
  function mergeProfile(level, ...sources) {
    const base = Object.assign({}, (CFG.DIFFICULTY && CFG.DIFFICULTY[level]) || {});
    sources.forEach(s => { if (s) Object.assign(base, s); });
    // Sanitise
    base.totalCards = Math.max(1, Number(base.totalCards) || 20);
    base.traditionalCount = Math.max(0, Math.min(base.totalCards, Number(base.traditionalCount) || 0));
    base.mcqOptions = Math.max(2, Number(base.mcqOptions) || 4);
    base.distractorScope = base.distractorScope || 'sameClass';
    base.showHint = !!base.showHint;
    return base;
  }

  function effectiveSettings(data, remote) {
    const localS = (data && data.settings && data.settings.difficulty) || {};
    const remoteS = (remote && remote.difficulty) || {};
    return {
      difficulty: {
        easy: mergeProfile('easy', localS.easy, remoteS.easy),
        hard: mergeProfile('hard', localS.hard, remoteS.hard)
      }
    };
  }

  async function loadRemoteSettings() {
    if (!CFG.APPS_SCRIPT_URL) return null;
    try {
      const url = CFG.APPS_SCRIPT_URL + '?action=settings&t=' + Date.now();
      const res = await fetch(url, { method: 'GET' });
      const j = await res.json();
      if (j && j.difficulty) {
        saveJSON('ter_remote_settings_v1', j);
        return j;
      }
    } catch (e) { /* fall through */ }
    return loadJSON('ter_remote_settings_v1', null);
  }

  /* ==========================================================
     Data loading
     ========================================================== */
  async function loadTypes() {
    const local = loadJSON(LS.adminData, null);
    let data;
    if (local && local.nonStandard) {
      data = local;
    } else {
      const res = await fetch('types.json?v=' + encodeURIComponent(CFG.DATA_VERSION), { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load types.json (' + res.status + ')');
      data = await res.json();
    }
    // Live-fetch types from backend (Types sheet). Backend wins over types.json.
    if (CFG.APPS_SCRIPT_URL) {
      try {
        const res = await fetch(CFG.APPS_SCRIPT_URL + '?action=types&t=' + Date.now());
        const liveTypes = await res.json();
        if (liveTypes && (Array.isArray(liveTypes.nonStandard) || Array.isArray(liveTypes.traditional))) {
          if ((liveTypes.nonStandard || []).length || (liveTypes.traditional || []).length) {
            data.nonStandard = liveTypes.nonStandard || [];
            data.traditional = liveTypes.traditional || [];
          }
        }
      } catch (e) { /* fall back to types.json */ }
    }

    // Live-fetch Drive-hosted photos from backend; merged onto types.json (live wins).
    if (CFG.APPS_SCRIPT_URL) {
      try {
        const res = await fetch(CFG.APPS_SCRIPT_URL + '?action=photos&t=' + Date.now());
        const live = await res.json();
        if (live && live.photos) {
          data.photos = Object.assign({}, data.photos || {}, live.photos);
          data.photoCaptions = Object.assign({}, data.photoCaptions || {}, live.photoCaptions || {});
        }
      } catch (e) { /* fall back to whatever's in types.json */ }
    }
    return normalisePhotos(data);
  }

  function normalisePhotos(data) {
    const topLevel = data.photos || {};
    const captions = data.photoCaptions || {};
    const decorate = list => (list || []).map(t => ({
      ...t,
      photos: t.photos && t.photos.length ? t.photos : (topLevel[t.code] || []),
      photoCaptions: t.photoCaptions && t.photoCaptions.length ? t.photoCaptions : (captions[t.code] || [])
    }));
    data.nonStandard = decorate(data.nonStandard);
    data.traditional = decorate(data.traditional);
    return data;
  }

  function getPhotosFor(typeObj) {
    const localStore = loadJSON(LS.adminPhotos, {});
    const localCaps = loadJSON('ter_admin_captions_v1', {});
    if (typeObj && localStore[typeObj.code]) {
      return {
        photos: localStore[typeObj.code],
        captions: localCaps[typeObj.code] || []
      };
    }
    return {
      photos: (typeObj && typeObj.photos) || [],
      captions: (typeObj && typeObj.photoCaptions) || []
    };
  }

  /* ==========================================================
     Card photo painter (shared between MCQ + trad)
     ========================================================== */
  function paintPhoto(photoHolder, typeObj, baseTagHTML) {
    const { photos, captions } = getPhotosFor(typeObj);
    if (photos.length === 0) return false;
    const idx = Math.floor(Math.random() * photos.length);
    photoHolder.innerHTML = '';
    photoHolder.appendChild(el('img', { src: photos[idx], alt: typeObj.name }));
    photoHolder.appendChild(el('span', { class: 'tag' + (baseTagHTML.trad ? ' trad' : '') }, baseTagHTML.label));
    if (captions[idx]) {
      photoHolder.appendChild(el('div', { class: 'caption', title: captions[idx] }, captions[idx]));
    }
    return true;
  }

  /* ==========================================================
     Non-standard MCQ card
     ========================================================== */
  function buildMcqCard(pick, allNonStd, diffSettings) {
    const tpl = $('#tpl-card-mcq').content.cloneNode(true);
    const root = tpl.firstElementChild;

    // Photo
    const photoHolder = $('.photo', root);
    const tagSpan = $('.tag', photoHolder);
    if (diffSettings.showHint) {
      tagSpan.innerHTML = '';
      tagSpan.appendChild(document.createTextNode('Non‑standard · '));
      tagSpan.appendChild(el('span', { class: 'cls' }, pick.class_full || pick.class));
    } else {
      tagSpan.textContent = 'Non‑standard';
    }
    paintPhoto(photoHolder, pick, {
      label: diffSettings.showHint
        ? ['Non‑standard · ', el('span', { class: 'cls' }, pick.class_full || pick.class)]
        : 'Non‑standard'
    });

    // Distractors
    const others = allNonStd.filter(t => t.code !== pick.code);
    const sameClass = others.filter(t => t.class === pick.class);
    const otherClass = others.filter(t => t.class !== pick.class);
    const wanted = Math.max(1, (diffSettings.mcqOptions || 4) - 1);
    let distractors;
    if (diffSettings.distractorScope === 'mixed') {
      distractors = shuffle(others).slice(0, wanted);
    } else {
      distractors = shuffle(sameClass).slice(0, wanted);
      if (distractors.length < wanted) {
        distractors = distractors.concat(shuffle(otherClass).slice(0, wanted - distractors.length));
      }
    }
    const options = shuffle([pick].concat(distractors));
    const letters = ['A','B','C','D','E','F','G','H'];
    const optionsMount = $('.options', root);
    const revealEl = $('.reveal', root);
    const factEl = $('.fact', revealEl);
    const metaEl = $('.meta', revealEl);
    const revealTitle = $('.reveal-title', revealEl);
    const portfolioPrompt = $('.portfolio-prompt', root);
    const disagreePrompt = $('.disagree-prompt', root);
    const disagreeInput = disagreePrompt && disagreePrompt.querySelector('.disagree-input');
    const actions = $('.actions', root);
    const skipBtn = $('.skip', actions);
    if (skipBtn) skipBtn.style.display = 'none'; // MCQ uses Next, not Skip

    let answered = false;
    let correctAnswer = false;
    let chosenCode = null;

    options.forEach((opt, i) => {
      const btn = el('button', { class: 'option', type: 'button' }, [
        el('span', { class: 'lbl' }, letters[i] || ('#' + (i+1))),
        opt.name
      ]);
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        correctAnswer = opt.code === pick.code;
        chosenCode = opt.code;

        $all('.option', root).forEach((b, j) => {
          b.disabled = true;
          if (options[j].code === pick.code) b.classList.add('correct');
          else if (j === i) b.classList.add('incorrect');
        });

        // Reveal
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

        factEl.textContent = correctAnswer
          ? `Correct — that's ${pick.name}.`
          : `Not quite. The answer was ${pick.name}.`;
        if (revealTitle) revealTitle.textContent = correctAnswer ? 'Correct' : 'Revealed';
        revealEl.classList.add('show');

        // Surface portfolio + disagree prompts
        portfolioPrompt.classList.add('show');
        if (disagreePrompt) disagreePrompt.classList.add('show');
        // Show Next button
        actions.style.display = 'flex';
      });
      optionsMount.appendChild(btn);
    });

    // Wire portfolio prompt (do you have any of these?)
    const ppState = { has: null, count: null, locations: '' };
    const hasRow = $('.has', portfolioPrompt);
    const extraRow = $('.pp-extra', portfolioPrompt);
    const countRow = $('.count-chips', portfolioPrompt);
    const locationsInput = $('.locations-input', portfolioPrompt);

    hasRow.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      hasRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ppState.has = chip.dataset.value;
      if (ppState.has === 'yes') {
        extraRow.classList.add('show');
      } else {
        extraRow.classList.remove('show');
        ppState.count = null;
        ppState.locations = '';
        countRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        if (locationsInput) locationsInput.value = '';
      }
    });
    countRow.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      countRow.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      ppState.count = chip.dataset.value;
    });
    if (locationsInput) {
      locationsInput.addEventListener('input', () => { ppState.locations = locationsInput.value.trim(); });
    }

    return {
      node: root,
      getResult: () => {
        const suggested = disagreeInput ? disagreeInput.value.trim() : '';
        return {
          kind: 'mcq',
          correct: !!correctAnswer,
          chosen: chosenCode,
          portfolio: (ppState.has && ppState.has !== 'no') || ppState.count || ppState.locations
            ? {
                kind: 'nonStd',
                code: pick.code,
                name: pick.name,
                has: ppState.has,
                count: ppState.count,
                locations: ppState.locations
              }
            : (ppState.has === 'no'
                ? { kind: 'nonStd', code: pick.code, name: pick.name, has: 'no' }
                : null),
          disagreement: suggested
            ? { code: pick.code, officialName: pick.name, suggestedName: suggested }
            : null
        };
      }
    };
  }

  /* ==========================================================
     Traditional (portfolio data) card — with Skip
     ========================================================== */
  function buildTradCard(pick) {
    const tpl = $('#tpl-card-trad').content.cloneNode(true);
    const root = tpl.firstElementChild;

    $('.prompt', root).textContent = pick.name;
    $('.fact', root).textContent = pick.description || pick.prompt || 'Does your organisation own properties of this traditional archetype?';
    const placeholderLabel = $('.placeholder-label', root);
    if (placeholderLabel) placeholderLabel.textContent = pick.name;

    const photoHolder = $('.photo', root);
    paintPhoto(photoHolder, pick, { label: 'Traditional', trad: true });

    const state = { has: null, count: null, bespoke: '', locations: '', skipped: false };
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

    // Wire Skip button: marks the card skipped + advances via the engine listener
    const skipBtn = $('.skip', root);
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        state.skipped = true;
        // advance() reads getResult(); fire a click on Next to keep one path through
        const nextBtn = $('.next', root);
        if (nextBtn) nextBtn.click();
      });
    }

    return {
      node: root,
      getResult: () => ({
        kind: 'trad',
        correct: null,
        portfolio: state.skipped
          ? { kind: 'trad', code: pick.code, name: pick.name, skipped: true }
          : {
              kind: 'trad',
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
     Game state + flow
     ========================================================== */
  const game = {
    types: null,
    settings: null,
    player: null,
    difficulty: 'easy',
    cards: [],
    currentIdx: 0,
    score: 0,
    answers: [],
    portfolioAnswers: [],
    disagreements: [],
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
    const remote = await loadRemoteSettings();
    game.settings = effectiveSettings(game.types, remote);

    // Wire up intro form
    $('#intro-form').addEventListener('submit', onIntroSubmit);
    // Difficulty picker
    $all('#difficulty-options .difficulty-card').forEach(c => {
      c.addEventListener('click', () => {
        $all('#difficulty-options .difficulty-card').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        game.difficulty = c.dataset.difficulty;
      });
    });
    const lastDiff = loadJSON(LS.lastDiff, 'easy');
    const target = $('#difficulty-options .difficulty-card[data-difficulty="' + lastDiff + '"]');
    if (target) {
      $all('#difficulty-options .difficulty-card').forEach(x => x.classList.remove('active'));
      target.classList.add('active');
      game.difficulty = lastDiff;
    }

    // Update the description text under each difficulty button with live numbers.
    $all('[data-diff-desc]').forEach(node => {
      const level = node.dataset.diffDesc;
      const p = game.settings.difficulty[level];
      if (!p) return;
      const bits = [
        p.totalCards + ' cards',
        p.mcqOptions + ' options',
        p.showHint ? 'class hint shown' : 'no class hint'
      ];
      node.textContent = bits.join(' · ');
    });

    // Prefill returning player
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
    $('#btn-replay').addEventListener('click', () => {
      buildDeck(); show('screen-game'); renderCurrent();
    });
    $('#btn-share').addEventListener('click', shareResult);

    // Top-10 leaderboard on intro screen
    loadIntroLeaderboard();
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
    saveJSON(LS.lastDiff, game.difficulty);

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
    const profile = game.settings.difficulty[game.difficulty] || game.settings.difficulty.easy;
    const total = profile.totalCards;
    const tradTarget = profile.traditionalCount;
    const nsTarget = total - tradTarget;

    const tradPool = (game.types.traditional || []).filter(Boolean);
    const nsPool = (game.types.nonStandard || []).filter(Boolean);
    const tradAvail = tradPool.length > 0 ? tradPool : DEFAULT_TRAD_TYPES;

    const tradPicks = tradTarget > 0
      ? sampleWithoutReplacement(tradAvail, Math.min(tradTarget, tradAvail.length), LS.seenTrad)
      : [];
    const nsPicks = sampleWithoutReplacement(nsPool, nsTarget, LS.seenNonStd);

    // Pad with extra non-standards if traditional pool is too small.
    const shortBy = tradTarget - tradPicks.length;
    if (shortBy > 0) {
      const extra = sampleWithoutReplacement(
        nsPool.filter(p => !nsPicks.includes(p)),
        shortBy,
        LS.seenNonStd
      );
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
    game.disagreements = [];
    game.startedAt = Date.now();

    $('#counter-total').textContent = total;
    $('#score-now').textContent = '0';
    $('#progress-bar').style.width = '0%';
  }

  function renderCurrent() {
    const i = game.currentIdx;
    const total = game.cards.length;
    $('#counter-current').textContent = (i + 1);
    $('#progress-bar').style.width = (i / total * 100).toFixed(1) + '%';

    const mount = $('#card-mount');
    mount.innerHTML = '';

    const card = game.cards[i];
    const diffSettings = game.settings.difficulty[game.difficulty] || game.settings.difficulty.easy;
    const builder = card.kind === 'mcq'
      ? buildMcqCard(card.pick, game.types.nonStandard, diffSettings)
      : buildTradCard(card.pick);

    card._builder = builder;
    const nextBtn = builder.node.querySelector('.next');
    if (nextBtn) nextBtn.addEventListener('click', () => advance());
    mount.appendChild(builder.node);

    // For trad cards, actions area is visible from the start (Skip + Next).
    // For MCQ, we show actions only after the player answers.
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
      if (result.portfolio) game.portfolioAnswers.push(result.portfolio);
      if (result.disagreement) game.disagreements.push(result.disagreement);
    } else {
      if (result.portfolio) game.portfolioAnswers.push(result.portfolio);
    }

    game.currentIdx += 1;
    if (game.currentIdx >= game.cards.length) {
      finish();
    } else {
      renderCurrent();
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
    $('#end-verdict').textContent = verdict + ' · ' + game.difficulty.toUpperCase();
    $('#end-title').textContent = pct >= 0.8 ? 'Excellent work.' : pct >= 0.5 ? 'Good work.' : 'Thanks for playing.';
    show('screen-end');

    submitResults().finally(() => loadEndLeaderboard());
  }

  async function submitResults() {
    const payload = {
      action: 'submit',
      version: CFG.DATA_VERSION,
      submittedAt: new Date().toISOString(),
      player: game.player,
      difficulty: game.difficulty,
      result: {
        score: game.score,
        total: game.cards.filter(c => c.kind === 'mcq').length,
        durationMs: Date.now() - game.startedAt,
        answers: game.answers
      },
      portfolio: game.portfolioAnswers,
      disagreements: game.disagreements
    };
    if (!CFG.APPS_SCRIPT_URL) {
      console.warn('APPS_SCRIPT_URL not set; submission skipped. Payload:', payload);
      return;
    }
    try {
      await fetch(CFG.APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Submission failed', e);
      toast('Couldn\'t reach the server — your score still shows locally.');
    }
  }

  async function fetchLeaderboard(n) {
    if (!CFG.APPS_SCRIPT_URL) return null;
    try {
      const url = CFG.APPS_SCRIPT_URL + '?action=leaderboard&n=' + n;
      const res = await fetch(url, { method: 'GET' });
      return await res.json();
    } catch (e) {
      console.warn(e);
      return null;
    }
  }

  async function loadIntroLeaderboard() {
    const mount = $('#intro-leaderboard-mount');
    if (!mount) return;
    const rows = await fetchLeaderboard(CFG.LEADERBOARD_ROWS || 10);
    if (rows == null) {
      mount.innerHTML = '<div class="empty">Leaderboard unavailable right now.</div>';
      return;
    }
    if (!rows.length) {
      mount.innerHTML = '<div class="empty">No scores yet — be the first.</div>';
      return;
    }
    renderLeaderboardTable(mount, rows, { compact: true });
  }

  async function loadEndLeaderboard() {
    const mount = $('#leaderboard-mount');
    if (!mount) return;
    const rows = await fetchLeaderboard(CFG.LEADERBOARD_ROWS || 10);
    if (rows == null) {
      mount.innerHTML = '<div class="empty">Leaderboard unavailable. Try again later.</div>';
      return;
    }
    if (!rows.length) {
      mount.innerHTML = '<div class="empty">No scores yet — you\'re the first.</div>';
      return;
    }
    renderLeaderboardTable(mount, rows, { compact: false });
  }

  function renderLeaderboardTable(mount, rows, opts) {
    const me = game.player;
    const table = el('table');
    const thead = el('thead', {}, el('tr', {}, [
      el('th', {}, '#'),
      el('th', {}, 'Name'),
      el('th', {}, 'Organisation'),
      el('th', {}, 'Mode'),
      el('th', { style: 'text-align:right;' }, 'Score')
    ]));
    const tbody = el('tbody');
    rows.forEach((r, i) => {
      const isMe = me && r.name === me.name && r.org === me.org;
      const diff = (r.difficulty || '').toLowerCase();
      const pillClass = diff === 'hard' ? 'diff-pill hard' : 'diff-pill easy';
      const pillText = diff ? diff.toUpperCase() : '—';
      const profile = (game.settings && game.settings.difficulty && r.difficulty)
        ? game.settings.difficulty[String(r.difficulty).toLowerCase()] : null;
      const fallbackTotal = profile ? (profile.totalCards - profile.traditionalCount) : '—';
      const scoreText = (r.score || 0) + ' / ' + (r.total || fallbackTotal);
      const tr = el('tr', { class: isMe ? 'you' : '' }, [
        el('td', { class: 'rank' }, String(i + 1)),
        el('td', {}, r.name || '—'),
        el('td', {}, r.org || '—'),
        el('td', { class: 'diff' }, el('span', { class: pillClass }, pillText)),
        el('td', { class: 'score' }, scoreText)
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
    const line = `I scored ${game.score}/${nsTotal} on Transform-ER's "Guess the Archetype" (${game.difficulty.toUpperCase()}). How well do you know UK non-traditional housing?`;
    navigator.clipboard.writeText(line).then(
      () => toast('Copied to clipboard'),
      () => toast('Copy failed')
    );
  }

  /* ==========================================================
     Fallback traditional types (used only when admin hasn't added any)
     ========================================================== */
  const DEFAULT_TRAD_TYPES = [
    { code: 'TRAD-VT-TER', name: 'Victorian / Edwardian terrace', class: 'TRAD', class_full: 'Traditional',
      description: 'Solid-wall brick terraced housing, typically built 1850–1914. Common retrofit challenges: solid-wall insulation and original suspended timber floors.' },
    { code: 'TRAD-IW-SEMI', name: 'Inter-war semi-detached', class: 'TRAD', class_full: 'Traditional',
      description: 'Cavity-walled semi-detached homes, typically 1919–1939. Usually cavity-wall and loft insulation candidates; often mixed tenure on estates.' },
    { code: 'TRAD-PW-COUNCIL', name: 'Post-war council terrace/semi', class: 'TRAD', class_full: 'Traditional',
      description: 'Brick or block cavity wall, 1945–1965. Often mixed with non-traditional types on the same estate.' },
    { code: 'TRAD-LP-FLAT', name: 'Low-rise masonry flats', class: 'TRAD', class_full: 'Traditional',
      description: 'Brick/block 2–4 storey flat blocks, typically 1960s–1980s. Common communal heating, flat roofs, varied cladding.' }
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
