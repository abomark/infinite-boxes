// Infinite pannable grid. Only the boxes in view (plus a one-box margin) exist
// in the DOM; content is requested for them on the fly, nearest-to-centre first.
(() => {
  const BUFFER = 1;        // extra ring of boxes mounted and preloaded around the view
  const CONCURRENCY = 6;   // max loads in flight
  const TIMEOUT = 10000;   // ms before a load counts as failed
  const FRICTION = 0.93;   // momentum decay per frame after a drag
  const MAX_CACHE = 3000;

  const viewport = document.getElementById('viewport');
  const world = document.getElementById('world');
  const sourceSel = document.getElementById('source');
  const coordEl = document.getElementById('coord');
  const hint = document.getElementById('hint');

  let vw, vh, cols, rows, cw, ch;
  let center = { x: 0.5, y: 0.5 };     // view centre, in box units
  let camX = 0, camY = 0;              // world pixel at the viewport's top-left
  let vx = 0, vy = 0;                  // momentum, px per frame
  let target = null;                   // { x, y } camera tween target
  let range = { x0: 0, x1: -1, y0: 0, y1: -1 };
  let dirty = true;

  let provider = PROVIDERS[0];
  const cells = new Map();   // "x,y" -> { el, x, y }   mounted boxes
  const pool = [];           // recycled box elements
  const cache = new Map();   // "provider:x,y" -> { state, x, y, provider, card }
  const pending = new Set(); // cache keys waiting for a load slot
  let active = 0;

  const key = (x, y) => `${x},${y}`;
  const ckey = (x, y, p = provider) => `${p.id}:${x},${y}`;
  const inRange = (x, y) => x >= range.x0 && x <= range.x1 && y >= range.y0 && y <= range.y1;

  // ---- layout ---------------------------------------------------------------

  function layout() {
    if (cw) center = { x: (camX + vw / 2) / cw, y: (camY + vh / 2) / ch };
    vw = innerWidth;
    vh = innerHeight;
    const portrait = vw < vh;
    cols = portrait ? 3 : 5;
    rows = portrait ? 5 : 3;
    cw = vw / cols;
    ch = vh / rows;
    camX = center.x * cw - vw / 2;
    camY = center.y * ch - vh / 2;
    target = null;
    world.style.setProperty('--cw', `${cw}px`);
    world.style.setProperty('--ch', `${ch}px`);
    for (const c of cells.values()) place(c);
    dirty = true;
  }

  function place(c) {
    c.el.style.transform = `translate(${c.x * cw}px, ${c.y * ch}px)`;
  }

  function render() {
    range = {
      x0: Math.floor(camX / cw) - BUFFER,
      x1: Math.floor((camX + vw) / cw) + BUFFER,
      y0: Math.floor(camY / ch) - BUFFER,
      y1: Math.floor((camY + vh) / ch) + BUFFER,
    };
    for (const [k, c] of cells) {
      if (!inRange(c.x, c.y)) {
        cells.delete(k);
        c.el.remove();
        pool.push(c.el);
      }
    }
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        if (!cells.has(key(x, y))) mount(x, y);
      }
    }
    world.style.transform = `translate3d(${-camX}px, ${-camY}px, 0)`;
    coordEl.textContent = `${Math.floor((camX + vw / 2) / cw)}, ${Math.floor((camY + vh / 2) / ch)}`;
    pump();
  }

  function mount(x, y) {
    const el = pool.pop() || Object.assign(document.createElement('div'), { className: 'cell' });
    el.dataset.key = key(x, y);
    const c = { el, x, y };
    cells.set(el.dataset.key, c);
    place(c);
    world.appendChild(el);
    fill(c, false);
  }

  // ---- content --------------------------------------------------------------

  function fill(c, animate) {
    const entry = cache.get(ckey(c.x, c.y));
    if (!entry) request(c.x, c.y);
    if (!entry || entry.state === 'queued' || entry.state === 'loading') drawSkeleton(c);
    else if (entry.state === 'error') drawError(c, animate);
    else drawCard(c, entry.card, animate);
  }

  function request(x, y) {
    const k = ckey(x, y);
    cache.set(k, { state: 'queued', x, y, provider });
    pending.add(k);
  }

  // Start queued loads, nearest to the view centre first. Anything that scrolled
  // out of range (or belongs to a previous source) is dropped, not fetched.
  function pump() {
    const cx = (camX + vw / 2) / cw - 0.5;
    const cy = (camY + vh / 2) / ch - 0.5;
    while (active < CONCURRENCY && pending.size) {
      let bestK = null, bestD = Infinity;
      for (const k of pending) {
        const e = cache.get(k);
        if (e.provider !== provider || !inRange(e.x, e.y)) {
          pending.delete(k);
          cache.delete(k);
          continue;
        }
        const d = (e.x - cx) ** 2 + (e.y - cy) ** 2;
        if (d < bestD) { bestD = d; bestK = k; }
      }
      if (!bestK) break;
      pending.delete(bestK);
      start(cache.get(bestK));
    }
  }

  function start(e) {
    active++;
    e.state = 'loading';
    e.provider.load(e.x, e.y, AbortSignal.timeout(TIMEOUT))
      .then(card => { e.state = 'done'; e.card = card; },
            err => { e.state = 'error'; console.warn(`Box ${e.x},${e.y}:`, err); })
      .finally(() => {
        active--;
        const c = cells.get(key(e.x, e.y));
        if (c && e.provider === provider) fill(c, true);
        trimCache();
        pump();
      });
  }

  function trimCache() {
    if (cache.size <= MAX_CACHE) return;
    for (const [k, e] of cache) {
      if (e.state === 'done' || e.state === 'error') cache.delete(k);
      if (cache.size <= MAX_CACHE * 0.8) break;
    }
  }

  // ---- drawing --------------------------------------------------------------

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function frame(c, className, animate) {
    const card = el('div', `card ${className}${animate ? ' fade' : ''}`);
    c.el.replaceChildren(card);
    return card;
  }

  function coordLabel(c) {
    return el('span', 'coord', `${c.x}, ${c.y}`);
  }

  function drawSkeleton(c) {
    const card = frame(c, 'skeleton', false);
    const text = el('div', 'text');
    for (const w of [30, 80, 95, 90, 60]) {
      const b = el('div', 'bar');
      b.style.width = `${w}%`;
      text.appendChild(b);
    }
    card.append(text, coordLabel(c));
  }

  function drawError(c, animate) {
    const card = frame(c, 'error', animate);
    const text = el('div', 'text');
    text.append(el('div', 'kicker', 'Could not load'), el('div', 'title', 'Tap to retry'));
    card.append(text, coordLabel(c));
  }

  function drawCard(c, d, animate) {
    const card = frame(c, d.url ? 'link' : '', animate);
    if (d.image) {
      const media = el('div', 'media');
      media.style.backgroundImage = `url(${JSON.stringify(d.image)})`;
      card.appendChild(media);
    }
    const text = el('div', 'text');
    if (d.kicker) text.appendChild(el('div', 'kicker', d.kicker));
    if (d.title) text.appendChild(el('div', `title${d.body ? '' : ' solo'}`, d.title));
    if (d.svg) {
      const fig = el('div', 'figure');
      fig.innerHTML = d.svg; // built locally by charts.js, never from the network
      text.appendChild(fig);
    }
    if (d.code) {
      const pre = el('pre', 'code');
      pre.appendChild(highlight(d.code, d.lang));
      text.appendChild(pre);
    }
    if (d.body) text.appendChild(el('div', d.svg || d.code ? 'body caption' : 'body', d.body));
    card.append(text, coordLabel(c));
  }

  // Minimal syntax highlighting for code cards. Each language is a list of
  // [pattern, class] rules; other identifiers are checked against keywords.
  const NUM = /\b\d+(?:\.\d+)?\b/, JINJA = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/;
  const SQL_KW = /^(select|from|where|group|by|order|having|join|left|inner|on|as|with|recursive|over|partition|qualify|and|or|not|in|exists|is|null|case|when|then|else|end|distinct|limit|rows|between|preceding|current|row|desc|asc|pivot|for|lateral|at|table|undrop|within|sample|seed|all|union|using)$/i;
  const HL = {
    sql: { rules: [[/--[^\n]*/, 'tk-c'], [/'(?:[^'\n]|'')*'/, 'tk-s'], [NUM, 'tk-n']], kw: SQL_KW },
    dbt: { rules: [[/--[^\n]*/, 'tk-c'], [JINJA, 'tk-j'], [/'(?:[^'\n]|'')*'/, 'tk-s'], [NUM, 'tk-n']], kw: SQL_KW },
    python: { rules: [[/#[^\n]*/, 'tk-c'], [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/, 'tk-s'], [NUM, 'tk-n']],
      kw: /^(import|from|as|def|return|for|in|if|else|elif|and|or|not|lambda|with|class|None|True|False|is|yield|assert|try|except)$/ },
    shell: { rules: [[/#[^\n]*/, 'tk-c'], [/"[^"\n]*"|'[^'\n]*'/, 'tk-s'], [/(?<![\w-])--?[A-Za-z][\w-]*/, 'tk-n']],
      kw: /^(git|dbt|uv|pip|ruff|pytest|nbstripout|jupytext|echo|FROM|RUN|COPY|WORKDIR|CMD|ENV)$/ },
    yaml: { rules: [[/#[^\n]*/, 'tk-c'], [JINJA, 'tk-j'], [/"[^"\n]*"|'[^'\n]*'/, 'tk-s'], [/^[ \t-]*[\w.-]+(?=:)/m, 'tk-k'], [NUM, 'tk-n']] },
    cypher: { rules: [[/\/\/[^\n]*/, 'tk-c'], [/'[^'\n]*'|"[^"\n]*"/, 'tk-s'], [/:[A-Z]\w*/, 'tk-j'], [NUM, 'tk-n']],
      kw: /^(match|optional|where|return|with|order|by|limit|create|merge|set|delete|as|and|or|not|desc|asc|distinct|count)$/i },
    text: { rules: [[/#[^\n]*/, 'tk-c']] },
  };
  for (const l of Object.values(HL)) l.re = new RegExp([...l.rules.map(([r]) => `(${r.source})`), '([A-Za-z_][\\w-]*)'].join('|'), 'gm');

  function highlight(code, lang) {
    const { rules, re, kw } = HL[lang] || HL.text, frag = document.createDocumentFragment();
    let last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      if (m.index > last) frag.append(code.slice(last, m.index));
      const g = m.findIndex((v, i) => i > 0 && v !== undefined);
      const cls = g <= rules.length ? rules[g - 1][1] : kw && kw.test(m[0]) ? 'tk-k' : null;
      frag.append(cls ? el('span', cls, m[0]) : m[0]);
      last = re.lastIndex;
    }
    frag.append(code.slice(last));
    return frag;
  }

  function activate(cellEl) {
    const c = cells.get(cellEl.dataset.key);
    if (!c) return;
    const k = ckey(c.x, c.y);
    const e = cache.get(k);
    if (e?.state === 'done' && e.card.url) window.open(e.card.url, '_blank', 'noopener');
    if (e?.state === 'error') {
      cache.delete(k);
      fill(c, false);
      pump();
    }
  }

  // ---- input ----------------------------------------------------------------

  let drag = null;

  function interacted() {
    hint.classList.add('gone');
    target = null;
  }

  viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    viewport.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
    vx = vy = 0;
    interacted();
    viewport.classList.add('dragging');
  });

  viewport.addEventListener('pointermove', e => {
    if (!drag) return;
    const now = performance.now();
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const dt = Math.max(1, now - drag.t);
    camX -= dx;
    camY -= dy;
    vx = 0.8 * vx + 0.2 * (-dx / dt * 16);
    vy = 0.8 * vy + 0.2 * (-dy / dt * 16);
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    dirty = true;
  });

  function endDrag(e) {
    if (!drag) return;
    if (performance.now() - drag.t > 80) vx = vy = 0; // paused before release: no fling
    if (e.type === 'pointerup' && drag.moved < 6) {
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell');
      if (hit) activate(hit);
    }
    drag = null;
    viewport.classList.remove('dragging');
  }
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const m = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh : 1;
    let dx = e.deltaX * m, dy = e.deltaY * m;
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    camX += dx;
    camY += dy;
    vx = vy = 0;
    interacted();
    dirty = true;
  }, { passive: false });

  // Arrow keys step one box, snapped to the grid.
  addEventListener('keydown', e => {
    if (e.target.closest?.('select, input')) return;
    if (e.key === '/') { e.preventDefault(); searchEl.focus(); return; }
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (e.key === 'Home') { e.preventDefault(); goHome(); return; }
    const d = dirs[e.key];
    if (!d) return;
    e.preventDefault();
    const base = target || { x: camX, y: camY };
    hint.classList.add('gone');
    vx = vy = 0;
    target = {
      x: (Math.round(base.x / cw) + d[0]) * cw,
      y: (Math.round(base.y / ch) + d[1]) * ch,
    };
  });

  function goHome() {
    vx = vy = 0;
    target = { x: cw / 2 - vw / 2, y: ch / 2 - vh / 2 };
  }
  document.getElementById('home').addEventListener('click', goHome);

  // ---- source picker --------------------------------------------------------

  for (const p of PROVIDERS) sourceSel.appendChild(new Option(p.label, p.id));
  try {
    const saved = PROVIDERS.find(p => p.id === localStorage.getItem('source'));
    if (saved) provider = saved;
  } catch {}
  sourceSel.value = provider.id;
  sourceSel.addEventListener('change', () => {
    clearFilter();
    setProvider(PROVIDERS.find(p => p.id === sourceSel.value));
    sourceSel.blur();
  });

  function setProvider(p) {
    provider = p;
    if (PROVIDERS.includes(p)) try { localStorage.setItem('source', p.id); } catch {}
    for (const c of cells.values()) fill(c, false);
    pump();
  }

  // ---- search ---------------------------------------------------------------
  // Every topic from every gallery, searchable by title, category, tip and code.

  const searchEl = document.getElementById('search');
  const resultsEl = document.getElementById('results');
  const INDEX = GALLERIES.flatMap(g => g.types.map(t => ({
    g, t, kicker: g.kicker(t), name: t.name.toLowerCase(),
    hay: [t.name, g.kicker(t), g.label, t.tip, t.code].filter(Boolean).join(' ').toLowerCase(),
  })));
  let results = [], selected = 0, filterOption = null;

  function search(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const score = e => words.every(w => e.hay.includes(w)) ?
      (e.name.startsWith(words[0]) ? 0 : words.every(w => e.name.includes(w)) ? 1 : words.every(w => e.kicker.toLowerCase().includes(w)) ? 2 : 3) : -1;
    return INDEX.map(e => [score(e), e]).filter(([sc]) => sc >= 0).sort((a, b) => a[0] - b[0]).map(([, e]) => e);
  }

  function renderResults() {
    resultsEl.replaceChildren();
    const q = searchEl.value.trim();
    if (!q) { resultsEl.hidden = true; return; }
    const shown = results.slice(0, 8);
    const rows = [];
    if (results.length) {
      const all = el('div', 'result all');
      all.append(el('div', 'r-title', `Show all ${results.length} matches in the grid`), el('div', 'r-kicker', 'Enter'));
      rows.push([all, showAll]);
    }
    shown.forEach(e => {
      const row = el('div', 'result');
      row.append(el('div', 'r-kicker', e.kicker), el('div', 'r-title', e.t.name));
      rows.push([row, () => jumpTo(e)]);
    });
    if (!rows.length) resultsEl.appendChild(el('div', 'result empty', `No topics match “${q}”`));
    rows.forEach(([row, act], i) => {
      row.classList.toggle('active', i === selected);
      row.addEventListener('mousedown', ev => { ev.preventDefault(); act(); });
      resultsEl.appendChild(row);
    });
    resultsEl.hidden = false;
    resultsEl._rows = rows;
  }

  searchEl.addEventListener('input', () => { hint.classList.add('gone'); results = search(searchEl.value); selected = 0; renderResults(); });
  searchEl.addEventListener('focus', () => { hint.classList.add('gone'); renderResults(); });
  searchEl.addEventListener('blur', () => { resultsEl.hidden = true; });
  searchEl.addEventListener('keydown', e => {
    const rows = resultsEl._rows || [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) selected = (selected + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[selected]?.[1]();
    } else if (e.key === 'Escape') {
      if (searchEl.value) { searchEl.value = ''; results = []; renderResults(); } else searchEl.blur();
    }
  });

  // Switch to the topic's gallery and glide to the nearest box that shows it.
  function jumpTo(e) {
    clearFilter();
    if (provider !== e.g) { setProvider(e.g); sourceSel.value = e.g.id; }
    flyToNearest(e.g, e.t);
    searchEl.blur();
  }

  // Fill the whole grid with matching topics only.
  function showAll() {
    const q = searchEl.value.trim(), g = makeGallery(`search:${q.toLowerCase()}`, `“${q}”`, results.map(e => e.t));
    if (!filterOption) { filterOption = new Option('', 'search'); sourceSel.add(filterOption, 1); }
    filterOption.text = `Search: “${q}” (${results.length})`;
    sourceSel.value = 'search';
    setProvider(g);
    searchEl.blur();
  }

  function clearFilter() {
    if (filterOption) { filterOption.remove(); filterOption = null; }
  }

  function flyToNearest(g, type) {
    const cx = Math.floor((camX + vw / 2) / cw), cy = Math.floor((camY + vh / 2) / ch);
    for (let rad = 0; rad < 80; rad++) {
      let best = null, bd = Infinity;
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad || g.typeAt(cx + dx, cy + dy) !== type) continue;
        if (dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = [cx + dx, cy + dy]; }
      }
      if (best) {
        const [x, y] = best;
        vx = vy = 0;
        target = { x: (x + 0.5) * cw - vw / 2, y: (y + 0.5) * ch - vh / 2 };
        flashKey = key(x, y);
        return;
      }
    }
  }

  // Highlight the found box once the camera has arrived.
  let flashKey = null;
  function flash() {
    const c = flashKey && cells.get(flashKey);
    if (!c) return;
    c.el.classList.remove('flash');
    void c.el.offsetWidth; // restart the animation
    c.el.classList.add('flash');
    setTimeout(() => c.el.classList.remove('flash'), 1700); // elements are recycled
    flashKey = null;
  }

  // ---- loop -----------------------------------------------------------------

  function tick() {
    if (!drag) {
      if (target) {
        const dx = target.x - camX, dy = target.y - camY;
        if (Math.abs(dx) + Math.abs(dy) < 0.5) { camX = target.x; camY = target.y; target = null; flash(); }
        else { camX += dx * 0.18; camY += dy * 0.18; }
        dirty = true;
      } else if (Math.abs(vx) + Math.abs(vy) > 0.1) {
        camX += vx;
        camY += vy;
        vx *= FRICTION;
        vy *= FRICTION;
        dirty = true;
      }
    }
    if (dirty) { dirty = false; render(); }
    requestAnimationFrame(tick);
  }

  addEventListener('resize', layout);
  layout();
  tick();
})();
