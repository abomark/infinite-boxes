// Galleries for data scientists and analysts, one per category (see SOURCES
// at the bottom). Fully offline. decks.js adds static code and text cards.
// Each box picks a type from its coordinate and draws it with fresh synthetic
// data seeded by that coordinate, so it's stable per box.
const { makeGallery, addTypes, galleries: GALLERIES } = (() => {
  const W = 260, H = 150;
  const L = 10, R = 250, T = 12, B = 138; // plot area

  // ---- maths ----------------------------------------------------------------
  function rng(seed) {
    return () => {
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const normal = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const scale = (d0, d1, r0, r1) => v => r0 + (v - d0) / (d1 - d0) * (r1 - r0);
  const range = n => Array.from({ length: n }, (_, i) => i);
  const sum = a => a.reduce((s, v) => s + v, 0);
  const mean = a => sum(a) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(sum(a.map(v => (v - m) ** 2)) / (a.length - 1)); };
  const quantile = (s, q) => { const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
  const sorted = a => [...a].sort((x, y) => x - y);
  const kde = (data, bw) => x => sum(data.map(d => Math.exp(-0.5 * ((x - d) / bw) ** 2))) / (data.length * bw * Math.sqrt(2 * Math.PI));
  const silverman = a => 1.06 * sd(a) * a.length ** -0.2;
  const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function probit(p) { // Abramowitz & Stegun 26.2.23
    const q = Math.min(p, 1 - p), t = Math.sqrt(-2 * Math.log(q));
    const z = t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t ** 3);
    return p < 0.5 ? -z : z;
  }
  function ols(xs, ys) {
    const mx = mean(xs), my = mean(ys);
    const sxx = sum(xs.map(x => (x - mx) ** 2)), syy = sum(ys.map(y => (y - my) ** 2));
    const sxy = sum(xs.map((x, i) => (x - mx) * (ys[i] - my)));
    const b = sxy / sxx, a = my - b * mx;
    const s = Math.sqrt(sum(xs.map((x, i) => (ys[i] - a - b * x) ** 2)) / (xs.length - 2));
    return { a, b, r: sxy / Math.sqrt(sxx * syy), s, mx, sxx, n: xs.length };
  }

  // ---- SVG strings. Colours are CSS tokens so charts follow light/dark. ---
  const col = c => (c.startsWith('#') || c.includes('(')) ? c : `var(--${c})`;
  const tint = (c, p) => `color-mix(in oklab, ${col(c)} ${Math.round(p)}%, var(--card))`;
  const n1 = v => Math.round(v * 10) / 10;
  const pts = p => p.map(([x, y]) => `${n1(x)},${n1(y)}`).join(' ');
  const line = (x1, y1, x2, y2, c = 'grid', w = 1, dash = '') =>
    `<line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}" style="stroke:${col(c)};stroke-width:${w}${dash ? `;stroke-dasharray:${dash}` : ''};stroke-linecap:round"/>`;
  const poly = (p, c, w = 2, dash = '') =>
    `<polyline points="${pts(p)}" style="fill:none;stroke:${col(c)};stroke-width:${w};stroke-linejoin:round;stroke-linecap:round${dash ? `;stroke-dasharray:${dash}` : ''}"/>`;
  const area = (p, c, stroke = '', w = 1) =>
    `<polygon points="${pts(p)}" style="fill:${col(c)}${stroke ? `;stroke:${col(stroke)};stroke-width:${w};stroke-linejoin:round` : ''}"/>`;
  const dot = (x, y, c, r = 2.5, ring = false) =>
    `<circle cx="${n1(x)}" cy="${n1(y)}" r="${r}" style="fill:${col(c)}${ring ? ';stroke:var(--card);stroke-width:1' : ''}"/>`;
  const ring = (x, y, c, r = 3) =>
    `<circle cx="${n1(x)}" cy="${n1(y)}" r="${r}" style="fill:none;stroke:${col(c)};stroke-width:1.5"/>`;
  const rect = (x, y, w, h, c, rx = 0) =>
    `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(Math.max(0, w))}" height="${n1(Math.max(0, h))}" rx="${rx}" style="fill:${col(c)}"/>`;
  const text = (x, y, s, anchor = 'start', c = 'muted', size = 9, weight = 400) =>
    `<text x="${n1(x)}" y="${n1(y)}" text-anchor="${anchor}" style="fill:${col(c)};font-size:${size}px;font-weight:${weight}">${s}</text>`;
  // Vertical bar with rounded top, anchored to the baseline.
  function bar(x, yTop, w, yBase, c) {
    const h = yBase - yTop, rr = Math.min(2.5, w / 2, h);
    if (h <= 0) return '';
    return `<path d="M${n1(x)} ${n1(yBase)}V${n1(yTop + rr)}Q${n1(x)} ${n1(yTop)} ${n1(x + rr)} ${n1(yTop)}H${n1(x + w - rr)}Q${n1(x + w)} ${n1(yTop)} ${n1(x + w)} ${n1(yTop + rr)}V${n1(yBase)}Z" style="fill:${col(c)}"/>`;
  }
  const grid = (n = 3, x0 = L, x1 = R, y0 = T, y1 = B) => range(n).map(i => line(x0, y0 + (y1 - y0) * i / n, x1, y0 + (y1 - y0) * i / n)).join('');
  const baseline = (y = B, x0 = L, x1 = R) => line(x0, y, x1, y, 'axis');
  const legend = (items, x, y) => items.map(([c, label], i) => {
    const yy = y + i * 11;
    return line(x, yy - 3, x + 10, yy - 3, c, 2.5) + text(x + 14, yy, label);
  }).join('');
  const SER = ['s1', 's2', 's3', 's4', 's5'];
  const hlegend = (items, x, y, gap = 52) => items.map(([c, label], i) =>
    line(x + i * gap, y - 3, x + i * gap + 10, y - 3, c, 2.5) + text(x + i * gap + 14, y, label)).join('');
  const frameRect = (x, y, w, h) => `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" style="fill:none;stroke:var(--grid)"/>`;
  const path = (d, fillC = 'none', stroke = '', w = 1) =>
    `<path d="${d}" style="fill:${fillC === 'none' ? 'none' : col(fillC)}${stroke ? `;stroke:${col(stroke)};stroke-width:${w};stroke-linejoin:round` : ''}"/>`;
  const polar = (cx, cy, rad, a) => [cx + rad * Math.cos(a - Math.PI / 2), cy + rad * Math.sin(a - Math.PI / 2)];
  // Annular sector from angle a0 to a1 (radians, clockwise from 12 o'clock).
  function arc(cx, cy, r0, r1, a0, a1) {
    const big = a1 - a0 > Math.PI ? 1 : 0, p = (rr, a) => polar(cx, cy, rr, a).map(n1).join(' ');
    return `M${p(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${p(r0, a0)}Z`;
  }
  // Beeswarm layout: pack dots along a row without overlap. Returns [x, y, index].
  function swarm(xs, cy, rad, maxOff = Infinity) {
    const placed = [];
    xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]).forEach(([x, i]) => {
      let y = cy;
      for (let o = 0; o < 80; o++) {
        const dy = (o % 2 ? 1 : -1) * Math.ceil(o / 2) * rad * 1.05;
        if (Math.abs(dy) > maxOff) break;
        if (!placed.some(([px, py]) => (px - x) ** 2 + (py - cy - dy) ** 2 < (2 * rad + 0.3) ** 2)) { y = cy + dy; break; }
      }
      placed.push([x, y, i]);
    });
    return placed;
  }
  function inPoly([x, y], poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Simulated classifier scores, highest first: positives are shifted by d.
  const scored = (r, d, np, nn) => [...range(np).map(() => [normal(r) + d, 1]), ...range(nn).map(() => [normal(r), 0])].sort((a, b) => b[0] - a[0]);
  // Least-squares polynomial fit via the normal equations (Gauss–Jordan).
  function polyfit(xs, ys, deg) {
    const m = deg + 1;
    const A = range(m).map(i => range(m + 1).map(j => j < m ? sum(xs.map(x => x ** (i + j))) : sum(xs.map((x, k) => ys[k] * x ** i))));
    for (let c = 0; c < m; c++) {
      let p = c;
      for (let q = c + 1; q < m; q++) if (Math.abs(A[q][c]) > Math.abs(A[p][c])) p = q;
      [A[c], A[p]] = [A[p], A[c]];
      for (let q = 0; q < m; q++) if (q !== c) { const f = A[q][c] / A[c][c]; for (let k = c; k <= m; k++) A[q][k] -= f * A[c][k]; }
    }
    const coef = A.map((row, i) => row[m] / row[i]);
    return x => sum(coef.map((c, i) => c * x ** i));
  }
  // Marching squares: iso-lines of f(px, py) over the plot area, one SVG path per level.
  // levels may be an array or a function of the maximum value.
  const MS = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 1], [3, 2]], 6: [[0, 2]], 7: [[3, 0]], 8: [[3, 0]], 9: [[0, 2]], 10: [[3, 0], [2, 1]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };
  function contours(f, nx, ny, levels, x0 = L, x1 = R, y0 = T, y1 = B) {
    const gx = i => x0 + i * (x1 - x0) / (nx - 1), gy = j => y0 + j * (y1 - y0) / (ny - 1);
    const v = range(ny).map(j => range(nx).map(i => f(gx(i), gy(j))));
    if (typeof levels === 'function') levels = levels(Math.max(...v.flat()));
    return levels.map(lvl => {
      let d = '';
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = v[j][i], b = v[j][i + 1], c = v[j + 1][i + 1], e = v[j + 1][i];
        const cases = MS[(a > lvl) * 8 + (b > lvl) * 4 + (c > lvl) * 2 + (e > lvl)];
        if (!cases) continue;
        const t = (p, q) => (lvl - p) / (q - p);
        const edge = k => [() => [gx(i + t(a, b)), gy(j)], () => [gx(i + 1), gy(j + t(b, c))], () => [gx(i + t(e, c)), gy(j + 1)], () => [gx(i), gy(j + t(a, e))]][k]();
        cases.forEach(([p, q]) => { const A = edge(p), Q = edge(q); d += `M${n1(A[0])} ${n1(A[1])}L${n1(Q[0])} ${n1(Q[1])}`; });
      }
      return d;
    });
  }
  const covOf = pts => {
    const mx = mean(pts.map(p => p[0])), my = mean(pts.map(p => p[1])), n = pts.length - 1;
    const a = sum(pts.map(p => (p[0] - mx) ** 2)) / n, c = sum(pts.map(p => (p[1] - my) ** 2)) / n, b = sum(pts.map(p => (p[0] - mx) * (p[1] - my))) / n;
    return [[mx, my], [[a, b], [b, c]]];
  };
  // Outline of the k-sigma ellipse of a 2D covariance, in pixel space.
  function ellipsePts([mx, my], [[a, b], [, c]], k, xs, ys) {
    const tr = (a + c) / 2, det = Math.sqrt(((a - c) / 2) ** 2 + b * b), l1 = tr + det, l2 = Math.max(1e-9, tr - det), th = 0.5 * Math.atan2(2 * b, a - c);
    return range(49).map(i => {
      const t = i / 48 * 2 * Math.PI, u = k * Math.sqrt(l1) * Math.cos(t), w = k * Math.sqrt(l2) * Math.sin(t);
      return [xs(mx + u * Math.cos(th) - w * Math.sin(th)), ys(my + u * Math.sin(th) + w * Math.cos(th))];
    });
  }
  // Regression tree on [x, y] pairs; returns a step function.
  function tree1d(pts, depth) {
    const m = mean(pts.map(p => p[1]));
    if (depth === 0 || pts.length < 4) return () => m;
    const s = [...pts].sort((a, b) => a[0] - b[0]), sse = a => { const mm = mean(a.map(p => p[1])); return sum(a.map(p => (p[1] - mm) ** 2)); };
    let best = null;
    for (let i = 2; i < s.length - 1; i++) { const v = sse(s.slice(0, i)) + sse(s.slice(i)); if (!best || v < best.v) best = { v, i, t: (s[i - 1][0] + s[i][0]) / 2 }; }
    const fl = tree1d(s.slice(0, best.i), depth - 1), fr = tree1d(s.slice(best.i), depth - 1);
    return x => x <= best.t ? fl(x) : fr(x);
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);
  // Labelled boxes joined by arrows. nodes: { key: [x, y, label, colour?, dashed?] }, edges: [[from, to, dashed?, label?]].
  function dag(nodes, edges) {
    const half = k => [nodes[k][2].length * 2.75 + 7, 9];
    const exit = (k, ux, uy) => { const [hw, hh] = half(k); return Math.min(hw / Math.max(Math.abs(ux), 1e-6), hh / Math.max(Math.abs(uy), 1e-6)); };
    let s = '';
    edges.forEach(([a, b, dash, label]) => {
      const [x1, y1] = nodes[a], [x2, y2] = nodes[b], d = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / d, uy = (y2 - y1) / d;
      const ea = exit(a, ux, uy) + 2, eb = exit(b, ux, uy) + 2, ex = x2 - ux * eb, ey = y2 - uy * eb;
      s += line(x1 + ux * ea, y1 + uy * ea, ex - ux * 4, ey - uy * 4, 'muted', 1.4, dash ? '3 3' : '') +
        area([[ex, ey], [ex - ux * 7 - uy * 3.5, ey - uy * 7 + ux * 3.5], [ex - ux * 7 + uy * 3.5, ey - uy * 7 - ux * 3.5]], 'muted') +
        (label ? text((x1 + x2) / 2 + uy * 7, (y1 + y2) / 2 - ux * 7 + 3, label, 'middle', 'muted', 7.5) : '');
    });
    Object.keys(nodes).forEach(k => {
      const [x, y, label, c, dash] = nodes[k], [hw, hh] = half(k);
      s += `<rect x="${n1(x - hw)}" y="${n1(y - hh)}" width="${n1(2 * hw)}" height="${2 * hh}" rx="5" style="fill:${c ? tint(c, 25) : 'var(--card-2)'};stroke:${col(c || 'axis')};stroke-width:1.3${dash ? ';stroke-dasharray:3 2' : ''}"/>` +
        text(x, y + 3, label, 'middle', 'text', 9, 600);
    });
    return s;
  }
  // Force-directed layout, scaled into the plot area. Returns [x, y] per node.
  function layoutGraph(n, edges, r, box = [L + 20, R - 20, T + 4, B - 4]) {
    const p = range(n).map(() => [r() * 2 - 1, r() * 2 - 1]), deg = range(n).fill(0);
    edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
    for (let it = 0; it < 200; it++) {
      const f = p.map(() => [0, 0]), temp = 0.1 * (1 - it / 200) + 0.005;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { const dx = p[i][0] - p[j][0], dy = p[i][1] - p[j][1], d2 = dx * dx + dy * dy + 0.01; f[i][0] += 0.02 * dx / d2; f[i][1] += 0.02 * dy / d2; }
      edges.forEach(([a, b]) => { const dx = p[b][0] - p[a][0], dy = p[b][1] - p[a][1]; f[a][0] += dx * 0.5; f[a][1] += dy * 0.5; f[b][0] -= dx * 0.5; f[b][1] -= dy * 0.5; });
      p.forEach((q, i) => { const gr = deg[i] ? 0.05 : 0.6; f[i][0] -= q[0] * gr; f[i][1] -= q[1] * gr; const mag = Math.hypot(...f[i]); if (mag > 0) { q[0] += f[i][0] / mag * Math.min(mag, temp); q[1] += f[i][1] / mag * Math.min(mag, temp); } });
    }
    const px = p.map(q => q[0]), py = p.map(q => q[1]);
    const xs = scale(Math.min(...px), Math.max(...px), box[0], box[1]), ys = scale(Math.min(...py), Math.max(...py), box[3], box[2]);
    return p.map(([x, y]) => [xs(x), ys(y)]);
  }
  const adjacency = (n, edges) => { const adj = range(n).map(() => []); edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); }); return adj; };
  // Brandes' algorithm: betweenness centrality of every node in an unweighted graph.
  function betweenness(adj) {
    const n = adj.length, cb = range(n).fill(0);
    for (let s0 = 0; s0 < n; s0++) {
      const stack = [], P = range(n).map(() => []), sigma = range(n).fill(0), d = range(n).fill(-1), delta = range(n).fill(0), queue = [s0];
      sigma[s0] = 1; d[s0] = 0;
      while (queue.length) { const v = queue.shift(); stack.push(v); adj[v].forEach(w => { if (d[w] < 0) { queue.push(w); d[w] = d[v] + 1; } if (d[w] === d[v] + 1) { sigma[w] += sigma[v]; P[w].push(v); } }); }
      while (stack.length) { const w = stack.pop(); P[w].forEach(v => { delta[v] += sigma[v] / sigma[w] * (1 + delta[w]); }); if (w !== s0) cb[w] += delta[w]; }
    }
    return cb.map(v => v / 2);
  }
  // Breadth-first distances from one node (-1 = unreachable).
  function bfs(adj, s0) {
    const d = range(adj.length).fill(-1), queue = [s0];
    d[s0] = 0;
    while (queue.length) { const v = queue.shift(); adj[v].forEach(w => { if (d[w] < 0) { d[w] = d[v] + 1; queue.push(w); } }); }
    return d;
  }
  // Arrow between two circles of radius r1 and r2.
  function arrow(x1, y1, x2, y2, r1, r2, c = 'muted', w = 1.3) {
    const d = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / d, uy = (y2 - y1) / d, ex = x2 - ux * (r2 + 1.5), ey = y2 - uy * (r2 + 1.5);
    return line(x1 + ux * r1, y1 + uy * r1, ex - ux * 4, ey - uy * 4, c, w) + area([[ex, ey], [ex - ux * 6 - uy * 3, ey - uy * 6 + ux * 3], [ex - ux * 6 + uy * 3, ey - uy * 6 - ux * 3]], c);
  }
  const npdf = z => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  function normCdf(z) { // Zelen & Severo
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const p = npdf(z) * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // ---- the gallery ----------------------------------------------------------
  const TYPES = [
    {
      name: 'Histogram + density', family: 'Distribution', wiki: 'Histogram',
      tip: 'Shows how one variable is distributed. The density curve exposes two peaks that a single mean would hide.',
      draw(r) {
        const data = range(320).map(() => r() < 0.6 ? normal(r) * 0.8 - 1 : normal(r) * 0.6 + 1.6);
        const lo = -4, hi = 4, nb = 26, bw = (hi - lo) / nb;
        const counts = range(nb).map(i => data.filter(d => d >= lo + i * bw && d < lo + (i + 1) * bw).length);
        const xs = scale(lo, hi, L, R), ys = scale(0, Math.max(...counts) * 1.1, B, T);
        const dens = kde(data, 0.3), step = xs(lo + bw) - xs(lo);
        const curve = range(81).map(i => { const x = lo + i * (hi - lo) / 80; return [xs(x), ys(dens(x) * data.length * bw)]; });
        return grid() + counts.map((c, i) => bar(xs(lo + i * bw) + 1, ys(c), step - 2, B, tint('s1', 60))).join('') + poly(curve, 'text', 1.5) + baseline();
      },
    },
    {
      name: 'Violin plot', family: 'Distribution', wiki: 'Violin_plot',
      tip: 'Compares the full shape of distributions across groups. Group C has two peaks, which a box plot would flatten.',
      draw(r) {
        const groups = [
          range(80).map(() => normal(r) * 0.8 + 0.5 * r()),
          range(80).map(() => normal(r) * 1.2 + 1),
          range(80).map(() => r() < 0.5 ? normal(r) * 0.5 - 1 : normal(r) * 0.5 + 1.8),
        ];
        const all = groups.flat(), lo = Math.min(...all) - 0.5, hi = Math.max(...all) + 0.5;
        const ys = scale(lo, hi, B, T), gw = (R - L) / 3;
        const shapes = groups.map(g => { const d = kde(g, silverman(g) * 0.8); return range(50).map(i => { const y = lo + (hi - lo) * i / 49; return [y, d(y)]; }); });
        const maxD = Math.max(...shapes.flat().map(p => p[1]));
        return grid() + groups.map((g, i) => {
          const cx = L + gw * (i + 0.5), wscale = gw * 0.42 / maxD, s = sorted(g);
          const pts2 = shapes[i].filter(p => p[1] > maxD * 0.01);
          const outline = [...pts2.map(([y, d]) => [cx - d * wscale, ys(y)]), ...pts2.reverse().map(([y, d]) => [cx + d * wscale, ys(y)])];
          return area(outline, tint(SER[i], 55), SER[i], 1.5) +
            line(cx, ys(quantile(s, 0.25)), cx, ys(quantile(s, 0.75)), 'text', 3) +
            dot(cx, ys(quantile(s, 0.5)), 'card', 2) + text(cx, H - 1, 'ABC'[i], 'middle');
        }).join('');
      },
    },
    {
      name: 'Box plot', family: 'Distribution', wiki: 'Box_plot',
      tip: 'The five-number summary per group: median, quartiles and whiskers. Dots beyond 1.5 × IQR are outliers.',
      draw(r) {
        const groups = range(5).map(i => {
          const m = normal(r) * 1.2, s = 0.5 + r();
          const g = range(40).map(() => m + normal(r) * s);
          if (r() < 0.7) g.push(m + (r() < 0.5 ? -1 : 1) * s * (3 + r() * 1.5));
          return sorted(g);
        });
        const all = groups.flat(), ys = scale(Math.min(...all) - 0.3, Math.max(...all) + 0.3, B, T), gw = (R - L) / 5;
        return grid() + groups.map((g, i) => {
          const cx = L + gw * (i + 0.5), q1 = quantile(g, 0.25), q3 = quantile(g, 0.75), iqr = q3 - q1;
          const inside = g.filter(v => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
          const lo = inside[0], hi = inside[inside.length - 1], bw = 26;
          return line(cx, ys(lo), cx, ys(q1), 's1', 1.5) + line(cx, ys(q3), cx, ys(hi), 's1', 1.5) +
            line(cx - 6, ys(lo), cx + 6, ys(lo), 's1', 1.5) + line(cx - 6, ys(hi), cx + 6, ys(hi), 's1', 1.5) +
            `<rect x="${n1(cx - bw / 2)}" y="${n1(ys(q3))}" width="${bw}" height="${n1(ys(q1) - ys(q3))}" rx="2" style="fill:${tint('s1', 30)};stroke:var(--s1);stroke-width:1.5"/>` +
            line(cx - bw / 2, ys(quantile(g, 0.5)), cx + bw / 2, ys(quantile(g, 0.5)), 'text', 2) +
            g.filter(v => !inside.includes(v)).map(v => ring(cx, ys(v), 's1', 2.5)).join('');
        }).join('');
      },
    },
    {
      name: 'Scatter + regression', family: 'Relationship', wiki: 'Linear_regression',
      draw(r) {
        const slope = (0.4 + r() * 1.2) * (r() < 0.25 ? -1 : 1);
        const xsD = range(50).map(() => r() * 10), ysD = xsD.map(x => 2 + slope * x + normal(r) * 2.2);
        const f = ols(xsD, ysD), xs = scale(0, 10, L, R);
        const lo = Math.min(...ysD) - 1, hi = Math.max(...ysD) + 1, ys = scale(lo, hi, B, T);
        const band = range(31).map(i => { const x = i / 3, se = 1.96 * f.s * Math.sqrt(1 / f.n + (x - f.mx) ** 2 / f.sxx); return [x, f.a + f.b * x, se]; });
        const bandPoly = [...band.map(([x, y, e]) => [xs(x), ys(y + e)]), ...band.reverse().map(([x, y, e]) => [xs(x), ys(y - e)])];
        return {
          svg: grid() + area(bandPoly, tint('s1', 25)) + xsD.map((x, i) => dot(xs(x), ys(ysD[i]), 's1', 2.6, true)).join('') +
            line(xs(0), ys(f.a), xs(10), ys(f.a + f.b * 10), 'text', 1.5) + baseline(),
          tip: `Pearson r = ${f.r.toFixed(2)}. The band is the 95% confidence interval of the fitted line, narrowest at the mean of x.`,
        };
      },
    },
    {
      name: 'Correlation matrix', family: 'Relationship', wiki: 'Correlation',
      tip: 'Pairwise correlations between features: blue is positive, red is negative. Look for clusters before modelling.',
      draw(r) {
        const n = 7, load = range(n).map(() => [normal(r), normal(r)]);
        const cov = range(n).map(i => range(n).map(j => load[i][0] * load[j][0] + load[i][1] * load[j][1] + (i === j ? 0.3 + r() * 0.7 : 0)));
        const corr = cov.map((row, i) => row.map((v, j) => v / Math.sqrt(cov[i][i] * cov[j][j])));
        const cell = (B - T + 6) / n, x0 = 70, y0 = T - 4;
        const color = v => `color-mix(in oklab, var(${v >= 0 ? '--pos' : '--neg'}) ${Math.round(Math.abs(v) * 100)}%, var(--mid))`;
        let s = '';
        corr.forEach((row, i) => row.forEach((v, j) => { s += rect(x0 + j * cell + 1, y0 + i * cell + 1, cell - 2, cell - 2, color(v), 2); }));
        range(n).forEach(i => { s += text(x0 - 5, y0 + (i + 0.5) * cell + 3, 'ABCDEFG'[i], 'end'); });
        const lx = x0 + n * cell + 22;
        [1, 0.5, 0, -0.5, -1].forEach((v, i) => { s += rect(lx, y0 + 18 + i * 18, 12, 16, color(v), 2); });
        return s + text(lx + 16, y0 + 29, '+1') + text(lx + 16, y0 + 65, '0') + text(lx + 16, y0 + 101, '−1');
      },
    },
    {
      name: 'Ridgeline plot', family: 'Distribution',
      tip: 'Stacked density curves show how a distribution drifts over time. The look is famous from Joy Division’s “Unknown Pleasures” cover.',
      draw(r) {
        const rows = 7, ph = r() * 6, lo = -4, hi = 5, xs = scale(lo, hi, L + 26, R);
        const step = (B - T) / (rows + 1);
        let s = '';
        range(rows).forEach(i => {
          const m = Math.sin(i / 2 + ph) * 1.5 + i * 0.15, data = range(120).map(() => r() < 0.75 ? m + normal(r) * 0.7 : m + 2 + normal(r) * 0.5);
          const d = kde(data, 0.3), base = T + step * (i + 1.6);
          const curve = range(70).map(k => { const x = lo + (hi - lo) * k / 69; return [xs(x), base - d(x) * step * 3.2]; });
          s += area([[xs(lo), base], ...curve, [xs(hi), base]], tint('s1', 30 + i * 8), 's1', 1.3);
          s += text(L, base, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'][i]);
        });
        return s;
      },
    },
    {
      cat: 'ts', name: 'Forecast with uncertainty', family: 'Forecasting', wiki: 'Prediction_interval',
      tip: 'History in solid ink, forecast dashed. The fan shows the 80% and 95% prediction intervals widening with the horizon.',
      draw(r) {
        const nh = 48, nf = 18, trend = normal(r) * 0.08, amp = 1 + r() * 2, noise = 0.5 + r() * 0.4;
        let lvl = 10;
        const hist = range(nh).map(i => { lvl += trend + normal(r) * 0.25; return lvl + amp * Math.sin(i / 12 * 2 * Math.PI) + normal(r) * noise; });
        const fc = range(nf + 1).map(h => { const i = nh - 1 + h; return [i, lvl + trend * h + amp * Math.sin(i / 12 * 2 * Math.PI), noise * Math.sqrt(1 + h * 0.6)]; });
        const all = [...hist, ...fc.map(([, y, e]) => y + 2 * e), ...fc.map(([, y, e]) => y - 2 * e)];
        const xs = scale(0, nh + nf, L, R), ys = scale(Math.min(...all), Math.max(...all), B, T);
        const fan = z => [...fc.map(([i, y, e]) => [xs(i), ys(y + z * e)]), ...[...fc].reverse().map(([i, y, e]) => [xs(i), ys(y - z * e)])];
        return grid() + area(fan(1.96), tint('s1', 22)) + area(fan(1.28), tint('s1', 45)) +
          line(xs(nh - 1), T, xs(nh - 1), B, 'axis', 1, '2 3') + text(xs(nh - 1) + 4, T + 8, 'now') +
          poly(hist.map((y, i) => [xs(i), ys(y)]), 'text', 1.5) + poly(fc.map(([i, y]) => [xs(i), ys(y)]), 's1', 2, '4 3') + baseline();
      },
    },
    {
      name: 'Slope chart', family: 'Comparison', wiki: 'Slopegraph',
      tip: 'Change between two points in time for many items at once. Steep lines jump out, and crossings show reordering.',
      draw(r) {
        const items = range(8).map(() => { const a = 20 + r() * 60; return [a, Math.max(5, Math.min(95, a + normal(r) * 18))]; });
        const ys = scale(0, 100, B - 4, T + 10), xa = L + 50, xb = R - 50;
        return legend([['s1', 'rose'], ['s2', 'fell']], R - 44, T + 2) +
          line(xa, T + 6, xa, B - 2, 'axis') + line(xb, T + 6, xb, B - 2, 'axis') +
          items.map(([a, b]) => { const c = b >= a ? 's1' : 's2'; return line(xa, ys(a), xb, ys(b), c, 2) + dot(xa, ys(a), c, 3) + dot(xb, ys(b), c, 3); }).join('') +
          text(xa, H - 1, '2024', 'middle') + text(xb, H - 1, '2025', 'middle');
      },
    },
    {
      name: 'Dumbbell chart', family: 'Comparison',
      tip: 'The gap between two values per category, such as before and after. Cleaner than paired bars.',
      draw(r) {
        const rows = range(7).map(() => { const a = 15 + r() * 50; return [a, Math.min(98, a + (r() * 45 - 10))]; }).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
        const xs = scale(0, 100, L + 18, R - 4), step = (B - T - 6) / rows.length;
        return legend([['s1', 'before'], ['s2', 'after']], L + 18, T) +
          rows.map(([a, b], i) => { const y = T + 22 + i * step * 0.95; return line(xs(0), y, xs(100), y, 'grid') + line(xs(a), y, xs(b), y, 'axis', 2.5) + dot(xs(a), y, 's1', 3.8, true) + dot(xs(b), y, 's2', 3.8, true) + text(L, y + 3, 'ABCDEFG'[i]); }).join('');
      },
    },
    {
      name: 'Lollipop chart', family: 'Ranking',
      tip: 'A lighter alternative to a bar chart for many sorted values. Less ink, the same information.',
      draw(r) {
        const vals = range(12).map(() => 10 + r() * 90).sort((a, b) => b - a), xs = scale(0, 100, L + 18, R), step = (B - T + 4) / 12;
        return vals.map((v, i) => { const y = T + step * (i + 0.5); return line(xs(0), y, xs(v), y, 'axis', 1.5) + dot(xs(v), y, 's1', 3.2) + text(L + 12, y + 3, i + 1, 'end', 'muted', 8); }).join('') + line(xs(0), T, xs(0), B, 'axis');
      },
    },
    {
      name: 'Waterfall chart', family: 'Comparison', wiki: 'Waterfall_chart',
      tip: 'How a starting value becomes an ending value through positive (blue) and negative (red) contributions.',
      draw(r) {
        const start = 80 + r() * 40, deltas = range(6).map(() => normal(r) * 22 + 4);
        let run = start;
        const steps = deltas.map(d => { const s0 = run; run += d; return [s0, run]; });
        const end = run, vmax = Math.max(start, end, ...steps.flat()) * 1.1;
        const ys = scale(0, vmax, B, T), n = 8, bw = (R - L) / n;
        let s = grid() + bar(L + 3, ys(start), bw - 6, B, 'muted');
        steps.forEach(([a, b], i) => {
          const x = L + bw * (i + 1);
          s += line(x - 3, ys(a), x + 3, ys(a), 'axis', 1, '2 2');
          s += rect(x + 3, ys(Math.max(a, b)), bw - 6, Math.abs(ys(a) - ys(b)), b >= a ? 'pos' : 'neg', 2);
        });
        return s + line(L + bw * 7 - 3, ys(end), L + bw * 7 + 3, ys(end), 'axis', 1, '2 2') + bar(L + bw * 7 + 3, ys(end), bw - 6, B, 'muted') + baseline();
      },
    },
    {
      name: 'Small multiples', family: 'Time series', wiki: 'Small_multiple',
      tip: 'One small chart per series on a shared scale. Comparable at a glance, and no spaghetti of overlapping lines.',
      draw(r) {
        const series = range(12).map(() => { let v = normal(r) * 2; const d = normal(r) * 0.12; return range(30).map(() => (v += d + normal(r) * 0.35)); });
        const all = series.flat(), lo = Math.min(...all), hi = Math.max(...all);
        const pw = (R - L) / 4, ph = (B - T + 8) / 3;
        return series.map((sr, k) => {
          const px = L + (k % 4) * pw, py = T - 4 + Math.floor(k / 4) * ph;
          const xs = scale(0, 29, px + 4, px + pw - 6), ys = scale(lo, hi, py + ph - 6, py + 4);
          return line(px + 4, py + ph - 4, px + pw - 6, py + ph - 4, 'axis') + poly(sr.map((v, i) => [xs(i), ys(v)]), 's1', 1.5) + dot(xs(29), ys(sr[29]), 's1', 2.2);
        }).join('');
      },
    },
    {
      name: '2D density heatmap', family: 'Relationship', wiki: 'Histogram',
      tip: 'A scatter plot with too many points turns into a blob. Binning into a grid shows where the data really is.',
      draw(r) {
        const centers = range(3).map(() => [r() * 6 - 3, r() * 4 - 2, 0.4 + r() * 0.8]);
        const pts2 = range(1400).map(() => { const [cx, cy, s] = centers[Math.floor(r() * 3)]; return [cx + normal(r) * s * 1.4, cy + normal(r) * s]; });
        const nx = 30, ny = 16, cnt = range(nx * ny).fill(0);
        pts2.forEach(([x, y]) => { const i = Math.floor((x + 5) / 10 * nx), j = Math.floor((3.5 - y) / 7 * ny); if (i >= 0 && i < nx && j >= 0 && j < ny) cnt[j * nx + i]++; });
        const max = Math.max(...cnt), cw = (R - L) / nx, chh = (B - T + 6) / ny;
        return cnt.map((c, k) => c ? rect(L + (k % nx) * cw + 0.5, T - 3 + Math.floor(k / nx) * chh + 0.5, cw - 1, chh - 1, tint('s1', 12 + 88 * Math.sqrt(c / max)), 1.2) : '').join('');
      },
    },
    {
      cat: 'stats', name: 'Q–Q plot', family: 'Diagnostics', wiki: 'Q%E2%80%93Q_plot',
      draw(r) {
        const kind = Math.floor(r() * 3);
        const raw = range(70).map(() => kind === 0 ? normal(r) : kind === 1 ? normal(r) / Math.sqrt((normal(r) ** 2 + normal(r) ** 2 + normal(r) ** 2) / 3) : -Math.log(1 - r()));
        const m = mean(raw), s = sd(raw), z = sorted(raw.map(v => (v - m) / s));
        const th = z.map((_, i) => probit((i + 0.5) / z.length));
        const lim = Math.max(3, ...z.map(Math.abs)), xs = scale(-3, 3, L + 50, R - 50), ys = scale(-lim, lim, B, T);
        return {
          svg: line(xs(-3), ys(-3), xs(3), ys(3), 'muted', 1.2, '3 3') + z.map((v, i) => dot(xs(th[i]), ys(v), 's1', 2.4, true)).join('') + baseline(B, L + 50, R - 50) +
            text(R - 50, H - 1, 'theoretical', 'end') + text(L + 46, T + 6, 'sample', 'end'),
          tip: ['Points hug the line: the sample is consistent with a normal distribution.',
            'An S-shape away from the line: heavier tails than normal, so extreme values are more common.',
            'A curve bending upward: the data is right-skewed. Consider a log transform.'][kind],
        };
      },
    },
    {
      cat: 'ml', name: 'ROC curve', family: 'Model evaluation', wiki: 'Receiver_operating_characteristic',
      tip: 'True-positive rate against false-positive rate across thresholds. The bigger the area under the curve, the better.',
      draw(r) {
        const ks = [1.4 + r(), 3 + r() * 2, 7 + r() * 6], x0 = L + 14, size = B - T, xs = scale(0, 1, x0, x0 + size), ys = scale(0, 1, B, T);
        let s = `<rect x="${x0}" y="${T}" width="${size}" height="${size}" style="fill:none;stroke:var(--grid)"/>` + line(xs(0), ys(0), xs(1), ys(1), 'muted', 1, '3 3');
        ks.forEach((k, i) => { s += poly(range(41).map(t => { const f = t / 40; return [xs(f), ys(1 - (1 - f) ** k)]; }), SER[i], 2); });
        return s + legend(ks.map((k, i) => [SER[i], `AUC ${(k / (k + 1)).toFixed(2)}`]), x0 + size + 14, T + 60) + text(x0 + size / 2, H - 1, 'false positive rate', 'middle');
      },
    },
    {
      name: 'Calendar heatmap', family: 'Time series',
      tip: 'Daily activity laid out like a calendar, which makes weekly rhythm, holidays and streaks visible.',
      draw(r) {
        const weeks = 17, cell = 13, x0 = L + 22, y0 = T + 2, trend = r() * 0.6;
        let s = '';
        range(weeks).forEach(w => range(7).forEach(d => {
          const v = (d < 5 ? 1 : 0.25) * (0.4 + trend * w / weeks + r() * 0.8) * (r() < 0.06 ? 0 : 1);
          const lvl = Math.min(4, Math.floor(v * 3.2));
          s += rect(x0 + w * cell, y0 + d * cell, cell - 2.5, cell - 2.5, lvl ? tint('s1', [0, 30, 55, 80, 100][lvl]) : 'grid', 2);
        }));
        ['Mon', 'Wed', 'Fri'].forEach((l, i) => { s += text(x0 - 4, y0 + i * 2 * cell + 9, l, 'end', 'muted', 8); });
        const ly = y0 + 7 * cell + 12;
        s += text(x0, ly + 8, 'less', 'start', 'muted', 8);
        [0, 30, 55, 80, 100].forEach((p, i) => { s += rect(x0 + 24 + i * 12, ly, 10, 10, p ? tint('s1', p) : 'grid', 2); });
        return s + text(x0 + 88, ly + 8, 'more', 'start', 'muted', 8);
      },
    },
    {
      name: 'Bump chart', family: 'Ranking',
      tip: 'Rank over time instead of raw values. Ideal for leaderboards where the order matters more than the gap.',
      draw(r) {
        const n = 5, periods = 8, order = shuffle(range(n), r), ranks = [order.slice()];
        for (let p = 1; p < periods; p++) { const o = ranks[p - 1].slice(); for (let k = 0; k < 2; k++) if (r() < 0.6) { const i = Math.floor(r() * (n - 1)); [o[i], o[i + 1]] = [o[i + 1], o[i]]; } ranks.push(o); }
        const xs = scale(0, periods - 1, L + 6, R - 22), ys = scale(0, n - 1, T + 6, B - 6);
        let s = '';
        range(n).forEach(team => {
          const p = ranks.map((o, t) => [xs(t), ys(o.indexOf(team))]);
          s += poly(p, SER[team], 2.5) + p.map(([x, y]) => dot(x, y, SER[team], 3.4, true)).join('') + text(R - 14, p[periods - 1][1] + 3, 'ABCDE'[team]);
        });
        return s;
      },
    },
    {
      name: 'Streamgraph', family: 'Part-to-whole', wiki: 'Streamgraph',
      tip: 'Stacked areas around a centred baseline. It shows how the overall total and each layer’s share ebb and flow.',
      draw(r) {
        const n = 4, len = 50;
        const layers = range(n).map(() => { const bumps = range(3).map(() => [r() * len, 4 + r() * 10, 0.5 + r() * 1.5]); return range(len).map(t => 0.2 + sum(bumps.map(([c, w, h]) => h * Math.exp(-(((t - c) / w) ** 2))))); });
        const tot = range(len).map(t => sum(layers.map(l => l[t]))), maxT = Math.max(...tot);
        const xs = scale(0, len - 1, L, R), ys = scale(-maxT / 2, maxT / 2, B, T);
        let base = tot.map(v => -v / 2), s = '';
        layers.forEach((l, i) => {
          const top = base.map((b, t) => b + l[t]);
          s += area([...top.map((v, t) => [xs(t), ys(v)]), ...base.map((v, t) => [xs(t), ys(v)]).reverse()], SER[i], 'card', 1);
          base = top;
        });
        return s;
      },
    },
    {
      cat: 'stats', name: 'ECDF + KS test', family: 'Hypothesis testing', wiki: 'Empirical_distribution_function',
      draw(r) {
        const a = sorted(range(50).map(() => normal(r))), b = sorted(range(50).map(() => 0.3 + r() * 0.6 + normal(r) * (0.8 + r() * 0.8)));
        const lo = Math.min(a[0], b[0]) - 0.3, hi = Math.max(a[49], b[49]) + 0.3, xs = scale(lo, hi, L, R), ys = scale(0, 1, B, T);
        const F = (s, x) => s.filter(v => v <= x).length / s.length;
        const steps = s => { const p = [[xs(lo), ys(0)]]; s.forEach((v, i) => { p.push([xs(v), ys(i / s.length)], [xs(v), ys((i + 1) / s.length)]); }); p.push([xs(hi), ys(1)]); return p; };
        let D = 0, at = 0;
        [...a, ...b].forEach(x => { const d = Math.abs(F(a, x) - F(b, x)); if (d > D) { D = d; at = x; } });
        return {
          svg: grid(4) + poly(steps(a), 's1', 2) + poly(steps(b), 's2', 2) + line(xs(at), ys(F(a, at)), xs(at), ys(F(b, at)), 'text', 2) +
            text(xs(at) + 5, (ys(F(a, at)) + ys(F(b, at))) / 2 + 3, `D = ${D.toFixed(2)}`, 'start', 'text', 9, 600) + legend([['s1', 'A'], ['s2', 'B']], L + 4, T + 6) + baseline(),
          tip: `Cumulative distributions of two samples. The Kolmogorov–Smirnov statistic is the largest vertical gap, here D = ${D.toFixed(2)}.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Lorenz curve', family: 'Inequality', wiki: 'Lorenz_curve',
      draw(r) {
        const sigma = 0.4 + r() * 0.9, inc = sorted(range(200).map(() => Math.exp(normal(r) * sigma))), tot = sum(inc);
        let c = 0;
        const curve = [[0, 0], ...inc.map((v, i) => [(i + 1) / inc.length, (c += v) / tot])];
        const auc = sum(curve.slice(1).map(([x, y], i) => (x - curve[i][0]) * (y + curve[i][1]) / 2)), gini = 1 - 2 * auc;
        const x0 = L + 50, size = B - T, xs = scale(0, 1, x0, x0 + size), ys = scale(0, 1, B, T);
        return {
          svg: `<rect x="${x0}" y="${T}" width="${size}" height="${size}" style="fill:none;stroke:var(--grid)"/>` +
            area([...curve.map(([x, y]) => [xs(x), ys(y)])], tint('s1', 35)) + line(xs(0), ys(0), xs(1), ys(1), 'muted', 1, '3 3') +
            poly(curve.map(([x, y]) => [xs(x), ys(y)]), 's1', 2) + text(x0 + size + 10, T + size / 2, `Gini ${gini.toFixed(2)}`, 'start', 'text', 11, 600),
          tip: `Share of total income held by the poorest x% of people. The shaded gap from equality is the Gini coefficient, here ${gini.toFixed(2)}.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Anscombe’s quartet', family: 'Pitfalls', wiki: 'Anscombe%27s_quartet',
      tip: 'Four datasets with the same mean, variance, correlation and regression line, yet nothing alike. Always plot your data.',
      draw() {
        const x = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5], x4 = [8, 8, 8, 8, 8, 8, 8, 19, 8, 8, 8];
        const sets = [[x, [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68]],
          [x, [9.14, 8.14, 8.74, 8.77, 9.26, 8.10, 6.13, 3.10, 9.13, 7.26, 4.74]],
          [x, [7.46, 6.77, 12.74, 7.11, 7.81, 8.84, 6.08, 5.39, 8.15, 6.42, 5.73]],
          [x4, [6.58, 5.76, 7.71, 8.84, 8.47, 7.04, 5.25, 12.50, 5.56, 7.91, 6.89]]];
        const pw = (R - L) / 2, ph = (B - T + 8) / 2;
        return sets.map(([xv, yv], k) => {
          const px = L + (k % 2) * pw, py = T - 4 + Math.floor(k / 2) * ph;
          const xs = scale(2, 20, px + 6, px + pw - 8), ys = scale(2, 14, py + ph - 6, py + 4);
          return line(px + 6, py + ph - 6, px + pw - 8, py + ph - 6, 'axis') + line(xs(3), ys(4.5), xs(19), ys(12.5), 'muted', 1.2) +
            xv.map((v, i) => dot(xs(v), ys(yv[i]), 's1', 2.6, true)).join('') + text(px + 8, py + 12, 'I II III IV'.split(' ')[k], 'start', 'muted', 8);
        }).join('');
      },
    },
    {
      cat: 'stats', name: 'Simpson’s paradox', family: 'Pitfalls', wiki: 'Simpson%27s_paradox',
      tip: 'Within every group the trend goes down, yet pooling the groups makes it go up. Watch out for confounders.',
      draw(r) {
        const xsD = [], ysD = [], g = [];
        range(3).forEach(k => { const cx = 2 + 3 * k, cy = 3 + 3 * k; range(18).forEach(() => { const x = cx + normal(r) * 0.8; xsD.push(x); ysD.push(cy - 0.8 * (x - cx) + normal(r) * 0.5); g.push(k); }); });
        const xs = scale(-0.5, 11.5, L, R), ys = scale(Math.min(...ysD) - 0.5, Math.max(...ysD) + 0.5, B, T), all = ols(xsD, ysD);
        let s = grid() + line(xs(-0.5), ys(all.a + all.b * -0.5), xs(11.5), ys(all.a + all.b * 11.5), 'text', 1.5, '5 3');
        range(3).forEach(k => {
          const ix = g.map((v, i) => v === k ? i : -1).filter(i => i >= 0), f = ols(ix.map(i => xsD[i]), ix.map(i => ysD[i]));
          const x0 = 2 + 3 * k - 1.6, x1 = 2 + 3 * k + 1.6;
          s += ix.map(i => dot(xs(xsD[i]), ys(ysD[i]), SER[k], 2.5, true)).join('') + line(xs(x0), ys(f.a + f.b * x0), xs(x1), ys(f.a + f.b * x1), SER[k], 2);
        });
        return s + baseline();
      },
    },
    {
      cat: 'ml', name: 'Elbow method', family: 'Clustering', wiki: 'Elbow_method_(clustering)',
      draw(r) {
        const ks = 3 + Math.floor(r() * 3), xs = scale(1, 10, L + 10, R - 6), ys = scale(0, 105, B, T);
        const pts2 = range(10).map(i => { const k = i + 1, v = k <= ks ? 100 * Math.exp(-(k - 1) * Math.log(4) / (ks - 1)) : 25 * Math.exp(-(k - ks) * 0.13); return [xs(k), ys(v * (1 + normal(r) * 0.02))]; });
        return {
          svg: grid() + poly(pts2, 's1', 2) + pts2.map(([x, y]) => dot(x, y, 's1', 3, true)).join('') + ring(pts2[ks - 1][0], pts2[ks - 1][1], 'text', 7) +
            text(pts2[ks - 1][0] + 10, pts2[ks - 1][1] - 8, `k = ${ks}`, 'start', 'text', 10, 600) + baseline() + text(R, H - 1, 'clusters k', 'end'),
          tip: `Within-cluster error for each number of clusters. Past the elbow at k = ${ks}, extra clusters barely help.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Confusion matrix', family: 'Model evaluation', wiki: 'Confusion_matrix',
      draw(r) {
        const names = ['cat', 'dog', 'fox'], m = range(3).map(i => range(3).map(j => i === j ? 40 + Math.floor(r() * 25) : Math.floor(r() * r() * 16)));
        const max = Math.max(...m.flat()), cell = 36, x0 = 90, y0 = T + 8;
        const acc = sum(range(3).map(i => m[i][i])) / sum(m.flat());
        let s = text(x0 + cell * 1.5, T + 2, 'predicted', 'middle');
        m.forEach((row, i) => row.forEach((v, j) => {
          const p = 8 + 92 * v / max;
          s += rect(x0 + j * cell + 1, y0 + i * cell + 1, cell - 2, cell - 2, tint('s1', p), 3) + text(x0 + (j + 0.5) * cell, y0 + (i + 0.5) * cell + 4, v, 'middle', p > 55 ? '#fff' : 'text', 11, 600);
        }));
        names.forEach((nm, i) => { s += text(x0 - 6, y0 + (i + 0.5) * cell + 3, nm, 'end') + text(x0 + (i + 0.5) * cell, y0 + 3 * cell + 11, nm, 'middle'); });
        return { svg: s + text(x0 - 34, y0 - 3, 'actual', 'end'), tip: `Rows are true classes and columns are predictions; off-diagonal cells are mistakes. Accuracy here is ${(acc * 100).toFixed(0)}%.` };
      },
    },
    {
      name: 'Waffle chart', family: 'Part-to-whole',
      draw(r) {
        const p = 12 + Math.floor(r() * 80), cell = 12.6, x0 = L + 20, y0 = T;
        let s = '';
        range(100).forEach(k => { const col2 = k % 10, row = 9 - Math.floor(k / 10); s += rect(x0 + col2 * cell, y0 + row * cell, cell - 2, cell - 2, k < p ? 's1' : 'grid', 2); });
        return { svg: s + text(x0 + 10 * cell + 20, T + 62, `${p}%`, 'start', 'text', 30, 650), tip: `100 squares where each one is 1%. Easier to read than a pie for a single share, here ${p} out of 100.` };
      },
    },
    {
      name: 'Treemap', family: 'Part-to-whole', wiki: 'Treemapping',
      tip: 'Nested rectangles sized by value. Shows hierarchy and proportion at once, for example disk usage or budget lines.',
      draw(r) {
        function layout(items, x, y, w, h, out) {
          if (items.length === 1) { out.push([items[0], x, y, w, h]); return; }
          const tot = sum(items.map(i => i.v));
          let acc = 0, k = 0;
          while (k < items.length - 1 && acc + items[k].v < tot / 2) acc += items[k++].v;
          if (k === 0) acc = items[k++].v;
          const f = acc / tot;
          if (w >= h) { layout(items.slice(0, k), x, y, w * f, h, out); layout(items.slice(k), x + w * f, y, w * (1 - f), h, out); }
          else { layout(items.slice(0, k), x, y, w, h * f, out); layout(items.slice(k), x, y + h * f, w, h * (1 - f), out); }
        }
        const parents = range(3).map(i => { const kids = range(3 + Math.floor(r() * 4)).map(() => ({ v: 1 + r() * r() * 10 })).sort((a, b) => b.v - a.v); return { i, kids, v: sum(kids.map(c => c.v)) }; }).sort((a, b) => b.v - a.v);
        const top = [];
        layout(parents, L, T - 4, R - L, B - T + 8, top);
        return top.map(([p, x, y, w, h]) => {
          const out = [];
          layout(p.kids, x + 1.5, y + 1.5, w - 3, h - 3, out);
          return out.map(([c, cx, cy, cw, chh], j) => rect(cx + 1, cy + 1, cw - 2, chh - 2, tint(SER[p.i], 100 - j * 9), 2)).join('');
        }).join('');
      },
    },
    {
      cat: 'stats', name: 'Residual plot', family: 'Diagnostics', wiki: 'Heteroscedasticity',
      tip: 'Residuals that fan out as fitted values grow signal heteroscedasticity. A log transform or weighted regression can help.',
      draw(r) {
        const pts2 = range(80).map(() => { const x = 1 + r() * 9; return [x, normal(r) * (0.15 + 0.22 * x)]; });
        const xs = scale(0.5, 10.5, L, R), lim = Math.max(...pts2.map(p => Math.abs(p[1]))) * 1.1, ys = scale(-lim, lim, B, T);
        return grid(4) + line(L, ys(0), R, ys(0), 'muted', 1.2, '4 3') + pts2.map(([x, y]) => dot(xs(x), ys(y), 's1', 2.5, true)).join('') + text(R, H - 1, 'fitted value', 'end') + text(L, T - 3, 'residual');
      },
    },
    {
      name: 'Beeswarm plot', family: 'Distribution',
      tip: 'Every observation as a dot, nudged so none overlap. You see the distribution and the sample size together.',
      draw(r) {
        const groups = range(3).map(i => range(45).map(() => normal(r) * (0.6 + r() * 0.5) + (i - 1) * 0.8 + normal(r) * 0.2));
        const all = groups.flat(), xs = scale(Math.min(...all) - 0.2, Math.max(...all) + 0.2, L + 14, R), rad = 2.4, gh = (B - T) / 3;
        return groups.map((g, k) => {
          const cy = T + gh * (k + 0.5);
          return swarm(g.map(xs), cy, rad).map(([x, y]) => dot(x, y, SER[k], rad)).join('') + text(L, cy + 3, 'ABC'[k]);
        }).join('');
      },
    },

    // ---- more chart types ----------------------------------------------------
    {
      name: 'Raincloud plot', family: 'Distribution',
      tip: 'The density (the cloud), a box plot and every raw point (the rain) in one chart. Nothing about the data is hidden.',
      draw(r) {
        const groups = range(3).map(i => range(50).map(() => (r() < 0.2 ? 1.8 : 0) + i * 0.5 + normal(r) * (0.5 + r() * 0.4)));
        const all = groups.flat(), lo = Math.min(...all) - 0.3, hi = Math.max(...all) + 0.3, xs = scale(lo, hi, L + 14, R), gh = (B - T + 6) / 3;
        return groups.map((g, k) => {
          const base = T - 2 + gh * k + gh * 0.5, d = kde(g, silverman(g) * 0.8), s = sorted(g);
          const curve = range(60).map(i => { const x = lo + (hi - lo) * i / 59; return [xs(x), d(x)]; });
          const maxD = Math.max(...curve.map(p => p[1]));
          return area([[xs(lo), base], ...curve.map(([x, v]) => [x, base - v / maxD * gh * 0.45]), [xs(hi), base]], tint(SER[k], 55), SER[k], 1.2) +
            line(xs(quantile(s, 0.25)), base + 4, xs(quantile(s, 0.75)), base + 4, 'text', 3) + dot(xs(quantile(s, 0.5)), base + 4, 'card', 1.6) +
            g.map(v => dot(xs(v), base + 8 + r() * gh * 0.28, SER[k], 1.5)).join('') + text(L, base + 3, 'ABC'[k]);
        }).join('');
      },
    },
    {
      name: 'Strip plot with jitter', family: 'Distribution',
      tip: 'Every point, nudged sideways at random so they don’t pile up. Group D’s tiny sample is obvious here but would be invisible in a bar chart of means.',
      draw(r) {
        const groups = [40, 35, 45, 6].map((n, i) => range(n).map(() => normal(r) * (0.6 + r() * 0.4) + i * 0.2));
        const all = groups.flat(), ys = scale(Math.min(...all) - 0.3, Math.max(...all) + 0.3, B, T), gw = (R - L) / 4;
        return grid() + groups.map((g, i) => {
          const cx = L + gw * (i + 0.5), m = mean(g);
          return g.map(v => dot(cx + (r() - 0.5) * gw * 0.5, ys(v), 's1', 2.2, true)).join('') + line(cx - gw * 0.32, ys(m), cx + gw * 0.32, ys(m), 'text', 2) + text(cx, H - 1, `${'ABCD'[i]} (n=${g.length})`, 'middle');
        }).join('');
      },
    },
    {
      name: 'Contour plot', family: 'Relationship', wiki: 'Contour_line',
      tip: 'Lines of equal density, like a topographic map. The tight rings mark where observations cluster most.',
      draw(r) {
        const bumps = range(3).map(() => [L + 30 + r() * (R - L - 60), T + 25 + r() * (B - T - 50), 18 + r() * 25, 12 + r() * 18, 0.5 + r()]);
        const f = (x, y) => sum(bumps.map(([cx, cy, sx, sy, h]) => h * Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2) / 2)));
        return contours(f, 52, 28, max => range(8).map(k => max * (k + 1) / 9)).map((d, k) => path(d, 'none', tint('s1', 30 + k * 10), 1.3)).join('');
      },
    },
    {
      name: 'Hexbin plot', family: 'Relationship', wiki: 'Hexagonal_binning',
      tip: 'Like a 2D histogram, but hexagons tile more evenly than squares: every neighbour is the same distance away.',
      draw(r) {
        const s0 = 6.5, hw = Math.sqrt(3) * s0, hh = 1.5 * s0, counts = new Map();
        const centers = range(3).map(() => [L + 40 + r() * (R - L - 80), T + 30 + r() * (B - T - 60), 12 + r() * 20]);
        range(1500).forEach(() => {
          const [cx, cy, sp] = centers[Math.floor(r() * 3)], px = cx + normal(r) * sp * 1.5, py = cy + normal(r) * sp;
          if (px < L || px > R || py < T || py > B) return;
          const j0 = Math.round((py - T) / hh);
          let best = null, bd = Infinity;
          for (let j = j0 - 1; j <= j0 + 1; j++) {
            const off = (j & 1) ? hw / 2 : 0, i0 = Math.round((px - L - off) / hw);
            for (let i = i0 - 1; i <= i0 + 1; i++) { const hx = L + off + i * hw, hy = T + j * hh, d = (px - hx) ** 2 + (py - hy) ** 2; if (d < bd) { bd = d; best = `${n1(hx)},${n1(hy)}`; } }
          }
          counts.set(best, (counts.get(best) || 0) + 1);
        });
        const max = Math.max(...counts.values());
        return [...counts].map(([k, c]) => { const [hx, hy] = k.split(',').map(Number); return area(range(6).map(a => polar(hx, hy, s0 - 0.6, a * Math.PI / 3)), tint('s1', 12 + 88 * Math.sqrt(c / max))); }).join('');
      },
    },
    {
      name: 'Bubble chart', family: 'Relationship', wiki: 'Bubble_chart',
      tip: 'A scatter plot with a third variable as bubble area. Scale the area, not the radius, or big values look far bigger than they are.',
      draw(r) {
        const items = range(16).map(() => { const g = Math.floor(r() * 3), x = r(); return { g, x, y: 0.2 + 0.6 * x + normal(r) * 0.12 + g * 0.05, v: r() * r() }; }).sort((a, b) => b.v - a.v);
        const xs = scale(0, 1, L + 12, R - 12), ys = scale(-0.1, 1.2, B, T + 10);
        return grid() + items.map(it => `<circle cx="${n1(xs(it.x))}" cy="${n1(ys(it.y))}" r="${n1(3 + Math.sqrt(it.v) * 16)}" style="fill:${tint(SER[it.g], 65)};stroke:${col(SER[it.g])};stroke-width:1.2"/>`).join('') +
          hlegend([['s1', 'A'], ['s2', 'B'], ['s3', 'C']], L + 4, T + 2, 34) + baseline();
      },
    },
    {
      name: 'Pair plot', family: 'Relationship',
      tip: 'Every pair of variables as a scatter, with each variable’s histogram on the diagonal. Often the first plot to make on a new dataset.',
      draw(r) {
        const n = 70, z = range(n).map(() => normal(r)), rho = [0.3 + r() * 0.6, -(0.2 + r() * 0.6)];
        const vars = [z, z.map(v => rho[0] * v + Math.sqrt(1 - rho[0] ** 2) * normal(r)), z.map(v => rho[1] * v + Math.sqrt(1 - rho[1] ** 2) * normal(r) ** 2)];
        const size = (B - T + 10) / 3, x0 = (W - 3 * size) / 2 + 8, y0 = T - 6;
        const sc = vars.map(v => { const lo = Math.min(...v), hi = Math.max(...v); return t => (t - lo) / (hi - lo); });
        let s = '';
        range(3).forEach(i => range(3).forEach(j => {
          const px = x0 + j * size, py = y0 + i * size, inner = size - 9;
          s += frameRect(px, py, size - 3, size - 3);
          if (i === j) {
            const bins = range(8).fill(0);
            vars[i].forEach(v => bins[Math.min(7, Math.floor(sc[i](v) * 8))]++);
            const mx = Math.max(...bins);
            bins.forEach((c, k) => { s += bar(px + 3 + k * inner / 8, py + size - 6 - c / mx * (inner - 4), inner / 8 - 1.2, py + size - 6, tint('s1', 60)); });
          } else vars[j].forEach((v, k) => { s += dot(px + 3 + sc[j](v) * inner, py + size - 6 - sc[i](vars[i][k]) * (inner - 2), 's1', 1.3); });
        }));
        return s + ['x', 'y', 'z'].map((nm, i) => text(x0 - 6, y0 + (i + 0.5) * size + 3, nm, 'end')).join('');
      },
    },
    {
      name: 'Parallel coordinates', family: 'Relationship', wiki: 'Parallel_coordinates',
      tip: 'Each line is one observation across many dimensions. Classes that separate show up as bundles of same-coloured lines.',
      draw(r) {
        const dims = 5, means = range(3).map(() => range(dims).map(() => 0.2 + r() * 0.6));
        const xs = scale(0, dims - 1, L + 8, R - 8), ys = scale(0, 1, B - 4, T + 2);
        let s = range(dims).map(d => line(xs(d), T, xs(d), B - 2, 'axis') + text(xs(d), H - 1, 'ABCDE'[d], 'middle')).join('');
        range(36).forEach(k => { const g = k % 3; s += poly(means[g].map((m, d) => [xs(d), ys(Math.max(0, Math.min(1, m + normal(r) * 0.08)))]), tint(SER[g], 75), 1.1); });
        return s;
      },
    },
    {
      cat: 'ts', name: 'Seasonal decomposition', family: 'Decomposition', wiki: 'Decomposition_of_time_series',
      tip: 'Splits a series into a trend, a repeating seasonal pattern and leftover noise, so each can be studied on its own.',
      draw(r) {
        const n = 72, slope = 0.03 + r() * 0.05, amp = 1 + r() * 1.5, ph = r() * 6;
        const trend = range(n).map(i => 5 + slope * i + Math.sin(i / 20 + ph) * 0.6);
        const seas = range(n).map(i => amp * Math.sin(i / 12 * 2 * Math.PI + ph) + 0.4 * amp * Math.sin(i / 6 * 2 * Math.PI));
        const res = range(n).map(() => normal(r) * 0.35), obs = trend.map((t, i) => t + seas[i] + res[i]);
        const panels = [['observed', obs, 'text'], ['trend', trend, 's1'], ['seasonal', seas, 's2'], ['residual', res, 'muted']];
        const pH = (B - T + 8) / 4, xs = scale(0, n - 1, L + 44, R);
        return panels.map(([label, data, c], k) => {
          const y0 = T - 4 + k * pH, ys = scale(Math.min(...data), Math.max(...data), y0 + pH - 5, y0 + 3);
          return text(L, y0 + pH / 2 + 3, label, 'start', 'muted', 8) + line(L + 44, y0 + pH - 2, R, y0 + pH - 2, 'grid') +
            (k === 3 ? data.map((v, i) => line(xs(i), ys(0), xs(i), ys(v), 'muted', 1.2)).join('') : poly(data.map((v, i) => [xs(i), ys(v)]), c, 1.5));
        }).join('');
      },
    },
    {
      cat: 'ts', name: 'Anomaly detection', family: 'Anomalies', wiki: 'Anomaly_detection',
      draw(r) {
        const n = 90;
        let lvl = 0;
        const x = range(n).map(i => (lvl += normal(r) * 0.15) + Math.sin(i / 8) * 0.8 + normal(r) * 0.3);
        range(2 + Math.floor(r() * 3)).forEach(() => { x[8 + Math.floor(r() * (n - 16))] += (r() < 0.5 ? -1 : 1) * (2 + r() * 1.5); });
        const stats = x.map((_, i) => { const win = x.slice(Math.max(0, i - 6), i).concat(x.slice(i + 1, i + 7)); return [mean(win), sd(win)]; });
        const flagged = x.map((v, i) => Math.abs(v - stats[i][0]) > 3 * stats[i][1]), cnt = flagged.filter(Boolean).length;
        const all = x.concat(stats.map(([m, s]) => m + 3 * s), stats.map(([m, s]) => m - 3 * s));
        const xs = scale(0, n - 1, L, R), ys = scale(Math.min(...all), Math.max(...all), B, T);
        const band = [...stats.map(([m, s], i) => [xs(i), ys(m + 3 * s)]), ...stats.map(([m, s], i) => [xs(i), ys(m - 3 * s)]).reverse()];
        return {
          svg: grid() + area(band, tint('s1', 22)) + poly(x.map((v, i) => [xs(i), ys(v)]), 'text', 1.3) +
            x.map((v, i) => flagged[i] ? ring(xs(i), ys(v), 'neg', 4.5) + dot(xs(i), ys(v), 'neg', 2) : '').join('') + baseline(),
          tip: `The band is ±3 standard deviations around the neighbouring points. ${cnt} point${cnt === 1 ? '' : 's'} fall outside it and are flagged.`,
        };
      },
    },
    {
      name: 'Candlestick chart', family: 'Time series', wiki: 'Candlestick_chart',
      tip: 'One candle per day: the body runs from open to close, the wicks to the high and low. Green closed higher than it opened.',
      draw(r) {
        let p = 100;
        const days = range(32).map(() => { const o = p, c = o * (1 + normal(r) * 0.025 + 0.002), hi = Math.max(o, c) * (1 + r() * 0.015), lo = Math.min(o, c) * (1 - r() * 0.015); p = c; return [o, c, hi, lo]; });
        const xs = scale(-0.5, 31.5, L, R), ys = scale(Math.min(...days.map(d => d[3])), Math.max(...days.map(d => d[2])), B, T), bw = (R - L) / 32 * 0.6;
        return grid() + days.map(([o, c, hi, lo], i) => {
          const cc = c >= o ? 's3' : 'neg';
          return line(xs(i), ys(hi), xs(i), ys(lo), cc, 1) + rect(xs(i) - bw / 2, ys(Math.max(o, c)), bw, Math.max(1, Math.abs(ys(o) - ys(c))), cc, 1);
        }).join('');
      },
    },
    {
      name: 'Sankey diagram', family: 'Flow', wiki: 'Sankey_diagram',
      tip: 'Flows between stages, with each band’s width proportional to volume. A classic for customer journeys, energy and budgets.',
      draw(r) {
        const m = range(3).map(() => range(3).map(() => 1 + r() * r() * 10)), tot = sum(m.flat()), pad = 8, k = (B - T + 4 - pad * 2) / tot;
        const srcT = m.map(row => sum(row)), dstT = range(3).map(j => sum(m.map(row => row[j])));
        const xL = L + 14, xR = R - 22, nw = 8, xm = (xL + nw + xR) / 2;
        const stack = arr => { let y = T - 2; return arr.map(v => { const y0 = y; y += v * k + pad; return y0; }); };
        const sy = stack(srcT), dy = stack(dstT), so = [...sy], dof = [...dy];
        let s = '';
        m.forEach((row, i) => row.forEach((v, j) => {
          const hh = v * k, a = so[i], b = dof[j];
          so[i] += hh; dof[j] += hh;
          s += path(`M${n1(xL + nw)} ${n1(a)}C${n1(xm)} ${n1(a)} ${n1(xm)} ${n1(b)} ${n1(xR)} ${n1(b)}L${n1(xR)} ${n1(b + hh)}C${n1(xm)} ${n1(b + hh)} ${n1(xm)} ${n1(a + hh)} ${n1(xL + nw)} ${n1(a + hh)}Z`, tint(SER[i], 40));
        }));
        sy.forEach((y, i) => { s += rect(xL, y, nw, srcT[i] * k, SER[i], 1.5) + text(xL - 4, y + srcT[i] * k / 2 + 3, 'ABC'[i], 'end'); });
        dy.forEach((y, j) => { s += rect(xR, y, nw, dstT[j] * k, 'muted', 1.5) + text(xR + nw + 4, y + dstT[j] * k / 2 + 3, 'XYZ'[j]); });
        return s;
      },
    },
    {
      name: 'Chord diagram', family: 'Flow', wiki: 'Chord_diagram_(information_visualization)',
      tip: 'Flows between groups around a circle. Each ribbon’s ends show how much moves between two groups in each direction.',
      draw(r) {
        const n = 4, m = range(n).map(i => range(n).map(j => i === j ? 0 : r() * r() * 10 + 0.5));
        const pad = 0.06, k = (2 * Math.PI - pad * n) / sum(m.flat()), cx = W / 2, cy = H / 2, rad = 60;
        const groups = [];
        let a = 0;
        const sub = m.map(row => { const g0 = a; const parts = row.map(v => { const p0 = a; a += v * k; return [p0, a]; }); groups.push([g0, a]); a += pad; return parts; });
        const P = ang => polar(cx, cy, rad, ang).map(n1).join(' ');
        let s = '';
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const [a0, a1] = sub[i][j], [b0, b1] = sub[j][i];
          s += path(`M${P(a0)}A${rad} ${rad} 0 0 1 ${P(a1)}Q${cx} ${cy} ${P(b0)}A${rad} ${rad} 0 0 1 ${P(b1)}Q${cx} ${cy} ${P(a0)}Z`, tint(SER[m[i][j] >= m[j][i] ? i : j], 55));
        }
        return s + groups.map(([g0, g1], i) => path(arc(cx, cy, rad + 2, rad + 9, g0, g1), SER[i])).join('');
      },
    },
    {
      name: 'Sunburst', family: 'Part-to-whole',
      tip: 'A hierarchy drawn as rings: the centre is the top level and each outer ring splits it further. A radial treemap.',
      draw(r) {
        const parents = range(4).map(i => { const kids = range(2 + Math.floor(r() * 4)).map(() => 1 + r() * 5); return { i, kids, v: sum(kids) }; });
        const tot = sum(parents.map(p => p.v)), cx = W / 2, cy = H / 2, gap = 0.012;
        let a = 0, s = '';
        parents.forEach(p => {
          const span = p.v / tot * 2 * Math.PI;
          s += path(arc(cx, cy, 22, 44, a + gap, a + span - gap), SER[p.i]);
          let b = a;
          p.kids.forEach((v, j) => { const sp = v / tot * 2 * Math.PI; s += path(arc(cx, cy, 46, 70, b + gap, b + sp - gap), tint(SER[p.i], 85 - j * 14)); b += sp; });
          a += span;
        });
        return s;
      },
    },
    {
      name: 'Marimekko chart', family: 'Part-to-whole', wiki: 'Mosaic_plot',
      tip: 'Both axes are shares: column width is each segment’s size and the stack shows its split, so every area is a share of the total.',
      draw(r) {
        const colsD = range(5).map(() => { const a = range(3).map(() => 0.2 + r()), t = sum(a); return { w: 0.3 + r(), split: a.map(v => v / t) }; });
        const tw = sum(colsD.map(c => c.w)), hh = B - T - 18;
        let x = L, s = hlegend([['s1', 'A'], ['s2', 'B'], ['s3', 'C']], L, T + 2, 34);
        colsD.forEach(c => {
          const w = c.w / tw * (R - L);
          let y = T + 14;
          c.split.forEach((p, k) => { s += rect(x + 1, y + 1, w - 2, p * hh - 2, SER[k], 2); y += p * hh; });
          x += w;
        });
        return s;
      },
    },
    {
      name: 'Funnel chart', family: 'Part-to-whole', wiki: 'Funnel_chart',
      draw(r) {
        const stages = ['Visit', 'Sign-up', 'Trial', 'Paid', 'Renew'];
        let v = 10000;
        const vals = stages.map((_, i) => i === 0 ? v : (v = Math.round(v * (0.25 + r() * 0.6))));
        const rates = vals.slice(1).map((x, i) => x / vals[i]), worst = rates.indexOf(Math.min(...rates));
        const cx = 135, maxW = 130, step = (B - T + 6) / 5;
        return {
          svg: vals.map((x, i) => {
            const w = Math.max(3, x / vals[0] * maxW), y = T - 3 + i * step;
            return rect(cx - w / 2, y + 2, w, step - 5, i === worst + 1 ? 's2' : 's1', 2) + text(L, y + step / 2 + 3, stages[i]) + text(R, y + step / 2 + 3, x.toLocaleString('en-US'), 'end', 'text', 9, 600);
          }).join(''),
          tip: `Users dropping out stage by stage. The biggest leak is ${stages[worst]} → ${stages[worst + 1]}, where only ${Math.round(rates[worst] * 100)}% continue.`,
        };
      },
    },
    {
      name: '100% stacked bar', family: 'Part-to-whole',
      tip: 'Survey answers per question as shares of 100%. The outer segments are easy to compare; the middle ones are harder.',
      draw(r) {
        const rows = range(6).map(() => { const a = range(3).map(() => 0.15 + r()), t = sum(a); return a.map(v => v / t); });
        const xs = scale(0, 1, L + 22, R), step = (B - T - 4) / 6, cs = ['s1', 'muted', 's2'];
        let s = hlegend([['s1', 'agree'], ['muted', 'neutral'], ['s2', 'disagree']], L + 22, T + 2, 62);
        rows.forEach((row, i) => {
          const y = T + 10 + i * step;
          let acc = 0;
          row.forEach((p, k) => { s += rect(xs(acc) + 1, y + 2, xs(acc + p) - xs(acc) - 2, step - 5, cs[k], 2); acc += p; });
          s += text(L, y + step / 2 + 3, `Q${i + 1}`);
        });
        return s;
      },
    },
    {
      name: 'Radar chart', family: 'Comparison', wiki: 'Radar_chart',
      tip: 'Popular but hard to read: the shape changes with axis order, and people misjudge angles and areas. A dot plot is usually clearer.',
      draw(r) {
        const axes = ['speed', 'power', 'range', 'cost', 'safety', 'comfort'], k = axes.length, cx = W / 2, cy = H / 2 + 2, rad = 56;
        const pt = (i, v) => polar(cx, cy, rad * v, i / k * 2 * Math.PI);
        let s = [0.33, 0.66, 1].map(v => `<polygon points="${pts(range(k).map(i => pt(i, v)))}" style="fill:none;stroke:var(--grid)"/>`).join('') + range(k).map(i => line(cx, cy, ...pt(i, 1), 'grid')).join('');
        range(2).forEach(si => { s += area(range(k).map(i => pt(i, 0.25 + r() * 0.75)), tint(SER[si], 30), SER[si], 1.8); });
        return s + axes.map((a, i) => { const [x, y] = pt(i, 1.18); return text(x, y + 3, a, 'middle', 'muted', 8); }).join('') + legend([['s1', 'A'], ['s2', 'B']], L, T + 2);
      },
    },
    {
      cat: 'graph', name: 'Community detection', family: 'Communities', wiki: 'Community_structure',
      tip: 'Densely connected groups in a network, such as customer segments, teams or fraud rings. A force layout pulls each community together; node size shows how connected a node is.',
      draw(r) {
        const n = 24, comm = range(n).map(i => i % 3), edges = [], deg = range(n).fill(0);
        range(n).forEach(i => range(i).forEach(j => { if (r() < (comm[i] === comm[j] ? 0.32 : 0.025)) edges.push([i, j]); }));
        edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
        const pos = layoutGraph(n, edges, r);
        return edges.map(([a, b]) => line(...pos[a], ...pos[b], 'axis', 1)).join('') +
          range(n).map(i => dot(...pos[i], SER[comm[i]], 2.5 + Math.sqrt(deg[i]) * 1.2, true)).join('');
      },
    },
    {
      name: 'Hex tile map', family: 'Comparison', wiki: 'Choropleth_map',
      tip: 'A choropleth where every region is an equal-sized hexagon, so small but important areas aren’t drowned out by large empty ones.',
      draw(r) {
        const s0 = 10.5, hw = Math.sqrt(3) * s0, hh = 1.5 * s0, nc = 11, nr = 8, hot = range(2).map(() => [r() * nc, r() * nr]);
        let s = '';
        for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
          const ex = (i - nc / 2 + 0.5) / (nc / 2), ey = (j - nr / 2 + 0.5) / (nr / 2);
          if (ex * ex + ey * ey > 0.95 + r() * 0.3) continue;
          const cx = 30 + i * hw + (j & 1 ? hw / 2 : 0), cy = T + 2 + j * hh;
          const v = Math.min(1, sum(hot.map(([hx, hy]) => Math.exp(-((i - hx) ** 2 + (j - hy) ** 2) / 8))) * 0.8 + r() * 0.2);
          s += area(range(6).map(a => polar(cx, cy, s0 - 1, a * Math.PI / 3)), tint('s1', 15 + Math.min(4, Math.floor(v * 5)) * 21));
        }
        return s + range(5).map(k => rect(L + k * 9, B - 6, 8, 8, tint('s1', 15 + k * 21), 1)).join('') + text(L, B - 10, 'low → high', 'start', 'muted', 7);
      },
    },

    // ---- machine learning ----------------------------------------------------
    {
      cat: 'ml', name: 'k-means clustering', family: 'Clustering', wiki: 'K-means_clustering',
      tip: 'Assign each point to its nearest centre, move each centre to the mean of its points, repeat. The trails show the centres converging.',
      draw(r) {
        const k = 3, truth = range(k).map(() => [0.15 + r() * 0.7, 0.15 + r() * 0.7]);
        const data = range(150).map(i => { const [cx, cy] = truth[i % k]; return [cx + normal(r) * 0.08, cy + normal(r) * 0.08]; });
        let cents = range(k).map(() => data[Math.floor(r() * data.length)].slice()), assign = [];
        const trails = cents.map(c => [c.slice()]);
        for (let it = 0; it < 8; it++) {
          assign = data.map(p => { let b = 0, bd = Infinity; cents.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd) { bd = d; b = j; } }); return b; });
          cents = cents.map((c, j) => { const mine = data.filter((_, i) => assign[i] === j); return mine.length ? [mean(mine.map(p => p[0])), mean(mine.map(p => p[1]))] : c; });
          cents.forEach((c, j) => trails[j].push(c.slice()));
        }
        const xs = scale(-0.1, 1.1, L, R), ys = scale(-0.1, 1.1, B, T);
        return data.map((p, i) => dot(xs(p[0]), ys(p[1]), tint(SER[assign[i]], 60), 2)).join('') + trails.map((t, j) =>
          poly(t.map(([x, y]) => [xs(x), ys(y)]), 'text', 1.2, '2 2') + dot(xs(t[0][0]), ys(t[0][1]), 'text', 1.8) +
          `<path d="M${n1(xs(cents[j][0]))} ${n1(ys(cents[j][1]) - 6)}l6 6l-6 6l-6 -6z" style="fill:var(--${SER[j]});stroke:var(--card);stroke-width:1.5"/>`).join('');
      },
    },
    {
      cat: 'ml', name: 'DBSCAN clustering', family: 'Clustering', wiki: 'DBSCAN',
      draw(r) {
        const data = [];
        range(70).forEach(() => { const t = r() * Math.PI; data.push([Math.cos(t) * 0.8 + normal(r) * 0.06, Math.sin(t) * 0.8 + normal(r) * 0.06 - 0.3]); });
        range(60).forEach(() => { const t = r() * Math.PI; data.push([0.8 - Math.cos(t) * 0.8 + normal(r) * 0.06, -Math.sin(t) * 0.8 + normal(r) * 0.06 + 0.1]); });
        range(40).forEach(() => data.push([2.2 + normal(r) * 0.1, 0.3 + normal(r) * 0.1]));
        range(25).forEach(() => data.push([-1.1 + r() * 3.6, -0.95 + r() * 1.7]));
        const eps = 0.16, minPts = 5, lab = data.map(() => -2); // -2 unvisited, -1 noise
        const nb = i => range(data.length).filter(j => (data[i][0] - data[j][0]) ** 2 + (data[i][1] - data[j][1]) ** 2 <= eps * eps);
        let c = 0;
        data.forEach((_, i) => {
          if (lab[i] !== -2) return;
          const N = nb(i);
          if (N.length < minPts) { lab[i] = -1; return; }
          lab[i] = c;
          const queue = [...N];
          while (queue.length) {
            const j = queue.pop();
            if (lab[j] === -1) lab[j] = c;
            if (lab[j] !== -2) continue;
            lab[j] = c;
            const Nj = nb(j);
            if (Nj.length >= minPts) queue.push(...Nj);
          }
          c++;
        });
        const xs = scale(-1.2, 2.6, L, R), ys = scale(-1, 0.8, B, T);
        return {
          svg: data.map(([x, y], i) => lab[i] < 0 ? `<path d="M${n1(xs(x) - 2)} ${n1(ys(y) - 2)}l4 4m0 -4l-4 4" style="stroke:var(--muted);stroke-width:1.2"/>` : dot(xs(x), ys(y), SER[lab[i] % 5], 2.3, true)).join(''),
          tip: `Groups points in dense regions and marks isolated ones as noise (×). It found ${c} clusters of arbitrary shape without being told how many.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Hierarchical clustering', family: 'Clustering', wiki: 'Hierarchical_clustering',
      tip: 'Repeatedly merges the two closest clusters. The height of each join is their distance; cutting the tree (dashed) gives the clusters.',
      draw(r) {
        const centers = range(3).map(() => [r() * 4, r() * 4]);
        const p = range(15).map(i => { const [cx, cy] = centers[i % 3]; return [cx + normal(r) * 0.45, cy + normal(r) * 0.45]; });
        const dist = (a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]);
        let nodes = p.map((_, i) => ({ members: [i], h: 0 }));
        while (nodes.length > 1) {
          let best = null;
          for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
            const d = mean(nodes[i].members.flatMap(a => nodes[j].members.map(b => dist(a, b))));
            if (!best || d < best.d) best = { i, j, d };
          }
          const a = nodes[best.i], b = nodes[best.j];
          nodes = nodes.filter(nd => nd !== a && nd !== b).concat({ members: [...a.members, ...b.members], h: best.d, left: a, right: b });
        }
        const root = nodes[0], hs = [];
        let leaf = 0;
        const lay = nd => (nd.x = nd.left ? (lay(nd.left) + lay(nd.right)) / 2 : leaf++);
        const collect = nd => { if (nd.left) { hs.push(nd.h); collect(nd.left); collect(nd.right); } };
        lay(root);
        collect(root);
        hs.sort((a, b) => b - a);
        const cut = (hs[1] + hs[2]) / 2, xs = scale(0, 14, L + 10, R - 10), ys = scale(0, root.h * 1.05, B - 6, T);
        let s = '', ci = 0;
        const draw = (nd, c) => {
          if (!nd.left) { s += dot(xs(nd.x), ys(0) + 3, c || 'muted', 2.2); return; }
          const pc = c || 'muted', lc = c || (nd.left.h <= cut ? SER[ci++] : null), rc = c || (nd.right.h <= cut ? SER[ci++] : null);
          s += line(xs(nd.left.x), ys(nd.left.h), xs(nd.left.x), ys(nd.h), pc, 1.5) + line(xs(nd.right.x), ys(nd.right.h), xs(nd.right.x), ys(nd.h), pc, 1.5) + line(xs(nd.left.x), ys(nd.h), xs(nd.right.x), ys(nd.h), pc, 1.5);
          draw(nd.left, lc);
          draw(nd.right, rc);
        };
        draw(root, null);
        return s + line(L, ys(cut), R, ys(cut), 'text', 1, '4 3');
      },
    },
    {
      cat: 'ml', name: 'Gaussian mixture model', family: 'Clustering', wiki: 'Mixture_model',
      tip: 'Models the data as overlapping bell-shaped blobs. Unlike k-means, clusters can be stretched and tilted. Ellipses show 1σ and 2σ.',
      draw(r) {
        const comps = range(3).map(() => ({ m: [r() * 4 - 2, r() * 2 - 1], a: r() * Math.PI, sa: 0.3 + r() * 0.5, sb: 0.1 + r() * 0.2 }));
        const groups = comps.map(({ m, a, sa, sb }) => range(50).map(() => { const u = normal(r) * sa, v = normal(r) * sb; return [m[0] + u * Math.cos(a) - v * Math.sin(a), m[1] + u * Math.sin(a) + v * Math.cos(a)]; }));
        const xs = scale(-3.2, 3.2, L, R), ys = scale(-1.7, 1.7, B, T);
        return groups.map((g, k) => {
          const [m, cov] = covOf(g);
          return g.map(([x, y]) => dot(xs(x), ys(y), tint(SER[k], 70), 1.8)).join('') + [1, 2].map(z => poly(ellipsePts(m, cov, z, xs, ys), SER[k], z === 1 ? 2 : 1.2, z === 2 ? '3 3' : '')).join('');
        }).join('');
      },
    },
    {
      cat: 'ml', name: 'Principal component analysis', family: 'Dimensionality reduction', wiki: 'Principal_component_analysis',
      draw(r) {
        const a = (r() - 0.5) * 1.6, sa = 0.7 + r() * 0.3, sb = 0.15 + r() * 0.2;
        const data = range(120).map(() => { const u = normal(r) * sa, v = normal(r) * sb; return [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)]; });
        const [m, [[ca, cb], [, cc]]] = covOf(data), tr = (ca + cc) / 2, det = Math.sqrt(((ca - cc) / 2) ** 2 + cb * cb), l1 = tr + det, l2 = tr - det, th = 0.5 * Math.atan2(2 * cb, ca - cc);
        const xs = scale(-2.2, 2.2, L, R), ys = scale(-1.15, 1.15, B, T);
        const arrow = (len, ang, c, label) => { const x2 = m[0] + len * Math.cos(ang), y2 = m[1] + len * Math.sin(ang); return line(xs(m[0]), ys(m[1]), xs(x2), ys(y2), c, 2.5) + dot(xs(x2), ys(y2), c, 3) + text(xs(x2) + 5, ys(y2) - 4, label, 'start', 'text', 9, 600); };
        return {
          svg: data.map(([x, y]) => dot(xs(x), ys(y), tint('s1', 55), 2)).join('') + arrow(2 * Math.sqrt(l1), th, 's2', 'PC1') + arrow(2 * Math.sqrt(l2), th + Math.PI / 2, 's3', 'PC2'),
          tip: `Finds the directions of greatest spread. PC1 alone captures ${(l1 / (l1 + l2) * 100).toFixed(0)}% of the variance, so one number per point loses little.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Logistic regression', family: 'Classification', wiki: 'Logistic_regression',
      draw(r) {
        const c = 0.35 + r() * 0.3, k = 8 + r() * 10, data = range(70).map(() => { const x = r(); return [x, r() < 1 / (1 + Math.exp(-k * (x - c))) ? 1 : 0]; });
        let w = 0, b0 = 0;
        for (let it = 0; it < 2000; it++) {
          let gw = 0, gb = 0;
          data.forEach(([x, y]) => { const p = 1 / (1 + Math.exp(-(w * x + b0))); gw += (y - p) * x; gb += y - p; });
          w += 5 * gw / data.length; b0 += 5 * gb / data.length;
        }
        const thr = -b0 / w, xs = scale(0, 1, L, R), ys = scale(-0.1, 1.1, B, T);
        return {
          svg: line(L, ys(0.5), R, ys(0.5), 'grid', 1, '3 3') + line(xs(thr), T, xs(thr), B, 'muted', 1, '3 3') +
            data.map(([x, y]) => dot(xs(x), ys(y) + (y ? 1 : -1) * r() * 6, SER[y], 2.4, true)).join('') +
            poly(range(81).map(i => [xs(i / 80), ys(1 / (1 + Math.exp(-(w * i / 80 + b0))))]), 'text', 2) + text(xs(thr) + 4, ys(0.5) - 4, 'p = 0.5', 'start', 'muted', 8) + baseline(),
          tip: `Fits an S-shaped curve giving the probability of class 1. Where it crosses 50% (x ≈ ${thr.toFixed(2)}) is the decision boundary.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Decision tree', family: 'Classification', wiki: 'Decision_tree_learning',
      tip: 'Splits the space with one yes/no question about one feature at a time, so it can only draw boxes. Here a depth-4 tree approximates a round region.',
      draw(r) {
        const cx = 0.35 + r() * 0.3, cy = 0.35 + r() * 0.3, rad = 0.22 + r() * 0.1;
        const data = range(160).map(() => { const x = r(), y = r(), inside = (x - cx) ** 2 + (y - cy) ** 2 < rad * rad; return [x, y, (r() < 0.06) !== inside ? 1 : 0]; });
        const leaves = [], splits = [];
        const gini = a => { const p = mean(a.map(i => data[i][2])); return a.length * p * (1 - p); };
        const grow = (idx, box, depth) => {
          const p1 = mean(idx.map(i => data[i][2]));
          if (depth === 0 || p1 === 0 || p1 === 1 || idx.length < 8) { leaves.push([box, p1]); return; }
          let best = null;
          for (const f of [0, 1]) {
            const vals = sorted(idx.map(i => data[i][f]));
            for (let q = 1; q < 16; q++) {
              const t = quantile(vals, q / 16), lo = idx.filter(i => data[i][f] <= t), hi = idx.filter(i => data[i][f] > t);
              if (!lo.length || !hi.length) continue;
              const sc = gini(lo) + gini(hi);
              if (!best || sc < best.sc) best = { f, t, lo, hi, sc };
            }
          }
          if (!best) { leaves.push([box, p1]); return; }
          splits.push([best.f, best.t, box]);
          const a = box.slice(), b = box.slice();
          if (best.f === 0) { a[1] = best.t; b[0] = best.t; } else { a[3] = best.t; b[2] = best.t; }
          grow(best.lo, a, depth - 1);
          grow(best.hi, b, depth - 1);
        };
        grow(range(data.length), [0, 1, 0, 1], 4);
        const xs = scale(0, 1, L, R), ys = scale(0, 1, B, T);
        return leaves.map(([[x0, x1, y0, y1], p]) => rect(xs(x0), ys(y1), xs(x1) - xs(x0), ys(y0) - ys(y1), tint(p > 0.5 ? 's2' : 's1', 12 + Math.abs(p - 0.5) * 36))).join('') +
          splits.map(([f, t, [x0, x1, y0, y1]]) => f === 0 ? line(xs(t), ys(y0), xs(t), ys(y1), 'text', 1) : line(xs(x0), ys(t), xs(x1), ys(t), 'text', 1)).join('') +
          data.map(([x, y, c]) => dot(xs(x), ys(y), SER[c], 2, true)).join('');
      },
    },
    {
      cat: 'ml', name: 'Support vector machine', family: 'Classification', wiki: 'Support_vector_machine',
      tip: 'Finds the boundary with the widest possible margin between the classes. Only the circled points on the margin, the support vectors, define it.',
      draw(r) {
        const ang = r() * Math.PI, dir = [Math.cos(ang), Math.sin(ang)];
        const data = range(60).map(i => { const c = i % 2 ? 1 : -1, t = normal(r) * 0.18, s = 0.12 + Math.abs(normal(r)) * 0.12; return [0.5 + dir[0] * s * c - dir[1] * t, 0.5 + dir[1] * s * c + dir[0] * t, c]; }).filter(([, y]) => y > 0.02 && y < 0.98);
        let best = { m: -Infinity };
        for (let k = 0; k < 720; k++) { // brute-force the max-margin direction
          const a = k / 720 * 2 * Math.PI, n = [Math.cos(a), Math.sin(a)], pr = data.map(([x, y, c]) => [x * n[0] + y * n[1], c]);
          const lo = Math.min(...pr.filter(p => p[1] > 0).map(p => p[0])), hi = Math.max(...pr.filter(p => p[1] < 0).map(p => p[0]));
          if ((lo - hi) / 2 > best.m) best = { m: (lo - hi) / 2, n, c: (lo + hi) / 2 };
        }
        const xs = scale(-0.45, 1.45, L, R), ys = scale(0, 1, B, T), { n, c, m } = best, d = [-n[1], n[0]];
        const at = off => line(xs(n[0] * (c + off) - d[0] * 2), ys(n[1] * (c + off) - d[1] * 2), xs(n[0] * (c + off) + d[0] * 2), ys(n[1] * (c + off) + d[1] * 2), off ? 'muted' : 'text', off ? 1 : 2, off ? '4 3' : '');
        const sv = data.filter(([x, y]) => Math.abs(Math.abs(x * n[0] + y * n[1] - c) - m) < 0.004);
        return at(m) + at(-m) + at(0) + data.map(([x, y, cl]) => dot(xs(x), ys(y), cl > 0 ? 's1' : 's2', 2.6, true)).join('') + sv.map(([x, y]) => ring(xs(x), ys(y), 'text', 5)).join('');
      },
    },
    {
      cat: 'ml', name: 'Random forest', family: 'Ensembles', wiki: 'Random_forest',
      tip: 'Many decision trees, each trained on a random resample of the data. Every tree is jagged (thin lines); their average (thick) is smooth and robust.',
      draw(r) {
        const ph = r() * 3, data = range(45).map(() => { const x = r(); return [x, Math.sin(x * 6 + ph) + normal(r) * 0.3]; });
        const trees = range(10).map(() => tree1d(range(data.length).map(() => data[Math.floor(r() * data.length)]), 3));
        const xs = scale(0, 1, L, R), ys = scale(-2, 2, B, T), g = range(121).map(i => i / 120);
        return grid() + trees.map(t => poly(g.map(x => [xs(x), ys(t(x))]), tint('s1', 35), 1)).join('') + poly(g.map(x => [xs(x), ys(mean(trees.map(t => t(x))))]), 's1', 2.5) +
          data.map(([x, y]) => dot(xs(x), ys(y), 'text', 2.2, true)).join('') + baseline();
      },
    },
    {
      cat: 'ml', name: 'Gradient boosting', family: 'Ensembles', wiki: 'Gradient_boosting',
      tip: 'Small trees added one at a time, each fitting what the previous ones got wrong. After 1, 5 and 50 rounds the fit sharpens step by step.',
      draw(r) {
        const ph = r() * 3, data = range(45).map(() => { const x = r(); return [x, Math.sin(x * 6 + ph) + 0.5 * x + normal(r) * 0.25]; });
        const base = mean(data.map(p => p[1])), models = [], stages = [];
        const predictWith = ms => x => base + sum(ms.map(m => 0.3 * m(x)));
        for (let k = 1; k <= 50; k++) {
          const f = predictWith(models);
          models.push(tree1d(data.map(([x, y]) => [x, y - f(x)]), 2));
          if (k === 1 || k === 5 || k === 50) stages.push(predictWith(models.slice()));
        }
        const ysD = data.map(p => p[1]), xs = scale(0, 1, L, R), ys = scale(Math.min(...ysD) - 0.3, Math.max(...ysD) + 0.3, B, T), g = range(121).map(i => i / 120);
        return grid() + data.map(([x, y]) => dot(xs(x), ys(y), 'muted', 2, true)).join('') +
          stages.map((f, i) => poly(g.map(x => [xs(x), ys(f(x))]), ['s3', 's2', 's1'][i], i === 2 ? 2.2 : 1.6)).join('') +
          hlegend([['s3', '1 tree'], ['s2', '5'], ['s1', '50']], L + 4, T + 2, 46) + baseline();
      },
    },
    {
      cat: 'ml', name: 'Neural network', family: 'Deep learning', wiki: 'Neural_network_(machine_learning)',
      tip: 'Layers of simple units, each a weighted sum passed through a non-linearity. Line thickness shows weight size: blue positive, red negative.',
      draw(r) {
        const layers = [3, 5, 5, 2], xs = scale(0, 3, L + 30, R - 30), pos = layers.map((n, l) => range(n).map(i => [xs(l), T + 6 + (B - T - 14) * (i + 0.5) / n]));
        let s = '';
        for (let l = 0; l < 3; l++) pos[l].forEach(a => pos[l + 1].forEach(b => {
          const w = normal(r);
          s += line(a[0], a[1], b[0], b[1], `color-mix(in oklab, var(${w > 0 ? '--pos' : '--neg'}) ${Math.round(Math.min(1, Math.abs(w)) * 75 + 10)}%, var(--card))`, 0.4 + Math.min(2, Math.abs(w)) * 1.1);
        }));
        pos.forEach(lay => lay.forEach(([x, y]) => { s += `<circle cx="${n1(x)}" cy="${n1(y)}" r="6" style="fill:var(--card);stroke:var(--text);stroke-width:1.5"/>`; }));
        return s + ['input', 'hidden', 'hidden', 'output'].map((t, l) => text(xs(l), H - 1, t, 'middle')).join('');
      },
    },
    {
      cat: 'ml', name: 'Gradient descent', family: 'Optimisation', wiki: 'Gradient_descent',
      tip: 'Walking downhill on a loss surface. Plain gradient descent zig-zags across the narrow valley; momentum smooths the path to the minimum.',
      draw(r) {
        const th = r() * Math.PI, ct = Math.cos(th), st = Math.sin(th), a = 1, b = 8 + r() * 6;
        const rot = (x, y) => [x * ct + y * st, -x * st + y * ct];
        const f = (x, y) => { const [u, v] = rot(x, y); return 0.5 * (a * u * u + b * v * v); };
        const grad = (x, y) => { const [u, v] = rot(x, y), gu = a * u, gv = b * v; return [gu * ct - gv * st, gu * st + gv * ct]; };
        const xs = scale(-1.6, 1.6, L, R), ys = scale(-0.85, 0.85, B, T), ix = scale(L, R, -1.6, 1.6), iy = scale(B, T, -0.85, 0.85);
        const start = [-1.4 + r() * 0.3, (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.2)];
        const run = (lr, beta) => {
          let p = start.slice(), vel = [0, 0];
          const out = [p.slice()];
          for (let i = 0; i < 30; i++) { const g = grad(...p); vel = [beta * vel[0] - lr * g[0], beta * vel[1] - lr * g[1]]; p = [p[0] + vel[0], p[1] + vel[1]]; out.push(p.slice()); }
          return out;
        };
        const plain = run(1.75 / b, 0), mom = run(0.5 / b, 0.85), toPx = q => q.map(([x, y]) => [xs(x), ys(y)]);
        return contours((px, py) => f(ix(px), iy(py)), 50, 28, range(7).map(i => 0.02 * 2.2 ** i)).map((d, i) => path(d, 'none', tint('muted', 25 + i * 8), 1)).join('') +
          poly(toPx(plain), 's2', 1.5) + toPx(plain).map(([x, y]) => dot(x, y, 's2', 1.8)).join('') + poly(toPx(mom), 's1', 2) + dot(xs(0), ys(0), 'text', 3) +
          hlegend([['s2', 'gradient descent'], ['s1', 'with momentum']], L + 2, T + 2, 100);
      },
    },
    {
      cat: 'ml', name: 'Choosing a learning rate', family: 'Optimisation', wiki: 'Learning_rate',
      tip: 'Gradient descent on the same curve with three step sizes. Too small crawls, just right converges fast, too large overshoots and diverges.',
      draw(r) {
        const start = 0.85 + r() * 0.1, pw = (R - L) / 3;
        return [[0.06, 'too small', 's1'], [0.35, 'just right', 's1'], [1.06, 'too large', 'neg']].map(([lr, label, c], k) => {
          const x0 = L + k * pw, xs = scale(-1.3, 1.3, x0 + 4, x0 + pw - 4), ys = scale(0, 1.69, B - 6, T + 6), p = [];
          let w = start;
          for (let i = 0; i < 12 && Math.abs(w) <= 1.3; i++) { p.push([xs(w), ys(w * w)]); w -= lr * 2 * w; }
          return poly(range(41).map(i => { const x = -1.3 + i * 2.6 / 40; return [xs(x), ys(x * x)]; }), 'axis', 1.5) + poly(p, c, 1.2) + p.map(([x, y]) => dot(x, y, c, 2.4, true)).join('') + text(x0 + pw / 2, H - 1, label, 'middle');
        }).join('');
      },
    },
    {
      cat: 'ml', name: 'Lasso regularisation path', family: 'Regularisation', wiki: 'Lasso_(statistics)',
      tip: 'As the penalty grows, Lasso shrinks every coefficient and sets weak ones to exactly zero, one by one: built-in feature selection.',
      draw(r) {
        const coefs = range(5).map(() => (r() < 0.5 ? -1 : 1) * (0.2 + r() * 1.6)), lmax = Math.max(...coefs.map(Math.abs)) * 1.05;
        const xs = scale(0, lmax, L + 20, R), ys = scale(-lmax, lmax, B, T), g = range(61).map(i => i / 60 * lmax);
        return grid(4) + line(L + 20, ys(0), R, ys(0), 'axis') + coefs.map((b, i) => poly(g.map(l => [xs(l), ys(Math.sign(b) * Math.max(0, Math.abs(b) - l))]), SER[i], 2) + text(L + 16, ys(b) + 3, `x${i + 1}`, 'end', 'muted', 8)).join('') + text(R, H - 1, 'penalty λ →', 'end');
      },
    },
    {
      cat: 'ml', name: 'Bias–variance trade-off', family: 'Model complexity', wiki: 'Bias%E2%80%93variance_tradeoff',
      tip: 'Simple models miss the pattern (bias); complex ones memorise noise (variance). Total error is lowest in between, at the dotted line.',
      draw(r) {
        const a = 0.6 + r() * 0.4, b = 0.004 + r() * 0.006, xs = scale(1, 20, L, R), g = range(77).map(i => 1 + i / 4);
        const bias = c => a / c, vari = c => b * c * c / 2, tot = c => bias(c) + vari(c) + 0.1;
        const best = g.reduce((p, c) => tot(c) < tot(p) ? c : p), ys = scale(0, Math.max(tot(1), tot(20)) * 1.05, B, T), curve = f => g.map(c => [xs(c), ys(f(c))]);
        return grid() + poly(curve(bias), 's1', 2) + poly(curve(vari), 's2', 2) + poly(curve(tot), 'text', 2.5) + line(xs(best), T, xs(best), B, 'muted', 1, '3 3') + dot(xs(best), ys(tot(best)), 'text', 3.5) +
          hlegend([['s1', 'bias²'], ['s2', 'variance'], ['text', 'total error']], L + 30, T + 2, 58) + baseline() + text(R, H - 1, 'model complexity →', 'end');
      },
    },
    {
      cat: 'ml', name: 'k-fold cross-validation', family: 'Model evaluation', wiki: 'Cross-validation_(statistics)',
      draw(r) {
        const k = 5, base = 0.78 + r() * 0.12, scores = range(k).map(() => base + normal(r) * 0.025), x0 = L + 30, x1 = R - 40, w = (x1 - x0) / k, step = (B - T - 10) / k;
        let s = hlegend([[tint('s1', 40), 'train'], ['s2', 'validate']], x0, T + 2, 50);
        range(k).forEach(f => {
          const y = T + 10 + f * step;
          s += text(L, y + step / 2 + 2, `fold ${f + 1}`, 'start', 'muted', 8) + range(k).map(j => rect(x0 + j * w + 1, y + 2, w - 2, step - 6, j === f ? 's2' : tint('s1', 40), 2)).join('') + text(R, y + step / 2 + 2, scores[f].toFixed(2), 'end', 'text', 9, 600);
        });
        return { svg: s, tip: `Split the data into ${k} parts, train on four and test on the fifth, and rotate. The average, ${mean(scores).toFixed(2)} ± ${sd(scores).toFixed(2)}, is far more reliable than one split.` };
      },
    },
    {
      cat: 'ml', name: 'Partial dependence (PDP + ICE)', family: 'Explainability',
      tip: 'How a model’s prediction changes as one feature varies. Thin lines are single observations (ICE); the thick line is their average (PDP).',
      draw(r) {
        const c = 0.3 + r() * 0.4, k = 6 + r() * 8;
        const fs = range(18).map(() => { const b = 0.15 + r() * 0.25, a = 0.25 + r() * 0.35, t = normal(r) * 0.1; return x => b + a / (1 + Math.exp(-k * (x - c))) + t * x; });
        const xs = scale(0, 1, L, R), ys = scale(0, 1, B - 8, T), g = range(41).map(i => i / 40);
        return grid() + fs.map(f => poly(g.map(x => [xs(x), ys(f(x))]), 'axis', 1)).join('') + poly(g.map(x => [xs(x), ys(mean(fs.map(f => f(x))))]), 's1', 2.5) +
          range(40).map(() => { const x = Math.min(1, Math.max(0, c + normal(r) * 0.25)); return line(xs(x), B - 4, xs(x), B, 'muted', 1); }).join('') + text(R, H - 1, 'feature value', 'end');
      },
    },
    {
      cat: 'ml', name: 'Feature importance', family: 'Explainability', wiki: 'Feature_selection',
      tip: 'Which features drive the model: how much accuracy drops when each one is randomly shuffled (permutation importance).',
      draw(r) {
        const names = shuffle(['age', 'income', 'tenure', 'visits', 'region', 'device', 'plan', 'clicks', 'season'], r).slice(0, 8);
        const vals = names.map((_, i) => Math.exp(-i * (0.25 + r() * 0.3)) * (0.9 + r() * 0.2)).sort((a, b) => b - a);
        const xs = scale(0, vals[0] * 1.05, L + 44, R), step = (B - T + 6) / 8;
        return names.map((nm, i) => { const y = T - 3 + i * step; return text(L + 38, y + step / 2 + 3, nm, 'end') + rect(xs(0), y + 2, xs(vals[i]) - xs(0), step - 4, i < 3 ? 's1' : tint('s1', 50), 2); }).join('') + line(xs(0), T - 3, xs(0), B + 3, 'axis');
      },
    },
    {
      cat: 'ml', name: 'SHAP summary plot', family: 'Explainability',
      tip: 'Each dot is one prediction: how far this feature pushed it up or down. Colour is the feature’s own value, red high and blue low.',
      draw(r) {
        const names = shuffle(['age', 'income', 'tenure', 'visits', 'device', 'plan', 'clicks'], r).slice(0, 6);
        const rows = range(6).map(i => { const bt = (1.6 - i * 0.22) * (r() < 0.3 ? -1 : 1); return range(40).map(() => { const v = r(); return [bt * (v - 0.5) * 2 + normal(r) * 0.15 * Math.abs(bt), v]; }); });
        const lim = Math.max(...rows.flat().map(p => Math.abs(p[0]))) * 1.05, xs = scale(-lim, lim, L + 46, R - 26), step = (B - T + 4) / 6;
        const heat = v => `color-mix(in oklab, var(--neg) ${Math.round(v * 100)}%, var(--pos))`;
        let s = line(xs(0), T - 4, xs(0), B + 2, 'axis');
        rows.forEach((row, i) => {
          const cy = T - 2 + step * (i + 0.5);
          s += text(L + 40, cy + 3, names[i], 'end') + swarm(row.map(p => xs(p[0])), cy, 1.7, step * 0.45).map(([x, y, k]) => dot(x, y, heat(row[k][1]), 1.7)).join('');
        });
        return s + range(5).map(k => rect(R - 12, T + 20 + k * 12, 8, 11, heat(1 - k / 4), 1)).join('') + text(R - 8, T + 16, 'high', 'middle', 'muted', 7) + text(R - 8, T + 88, 'low', 'middle', 'muted', 7);
      },
    },
    {
      cat: 'ml', name: 'Learning curve', family: 'Model evaluation', wiki: 'Learning_curve_(machine_learning)',
      draw(r) {
        const highVar = r() < 0.5, n = 10, xs = scale(1, n, L + 6, R - 6), ys = scale(0.5, 1, B, T + 14);
        const train = range(n).map(i => highVar ? 0.99 - i * 0.004 : 0.97 - 0.1 * (1 - Math.exp(-i / 3)));
        const val = range(n).map(i => (highVar ? 0.6 + 0.18 * (1 - Math.exp(-i / 4)) : 0.62 + 0.24 * (1 - Math.exp(-i / 2.5))) + normal(r) * 0.006);
        const sdv = range(n).map(i => 0.05 * Math.exp(-i / 5) + 0.01);
        const band = arr => [...arr.map((v, i) => [xs(i + 1), ys(v + sdv[i])]), ...arr.map((v, i) => [xs(i + 1), ys(v - sdv[i])]).reverse()];
        const ln = arr => arr.map((v, i) => [xs(i + 1), ys(v)]);
        return {
          svg: grid() + area(band(train), tint('s1', 20)) + area(band(val), tint('s2', 20)) + poly(ln(train), 's1', 2) + poly(ln(val), 's2', 2) + hlegend([['s1', 'training'], ['s2', 'validation']], L + 6, T + 4, 62) + baseline() + text(R, H - 1, 'training set size', 'end'),
          tip: highVar ? 'A persistent gap between training and validation scores means high variance (overfitting). More data or regularisation should help.' : 'Training and validation scores converge at a good level: the model generalises well, and more data won’t change much.',
        };
      },
    },
    {
      cat: 'ml', name: 'Loss curve + early stopping', family: 'Model evaluation', wiki: 'Early_stopping',
      draw(r) {
        const n = 60, turn = 15 + Math.floor(r() * 25), xs = scale(0, n - 1, L, R);
        const train = range(n).map(i => 0.1 + 1.6 * Math.exp(-i / 9) + normal(r) * 0.012);
        const val = range(n).map(i => 0.25 + 1.5 * Math.exp(-i / 9) + 0.0006 * Math.max(0, i - turn) ** 1.6 + normal(r) * 0.02);
        const best = val.indexOf(Math.min(...val)), ys = scale(0, Math.max(...train, ...val) * 1.05, B, T), ln = a => a.map((v, i) => [xs(i), ys(v)]);
        return {
          svg: grid() + line(xs(best), T, xs(best), B, 'muted', 1, '3 3') + text(xs(best) + 3, T + 6, 'stop here', 'start', 'text', 8, 600) + poly(ln(train), 's1', 1.8) + poly(ln(val), 's2', 1.8) + dot(xs(best), ys(val[best]), 's2', 3.5, true) +
            legend([['s1', 'train loss'], ['s2', 'validation loss']], R - 74, T + 22) + baseline() + text(R, H - 1, 'epoch', 'end'),
          tip: `Validation loss bottoms out at epoch ${best} and then rises while training loss keeps falling: the model has started to memorise. Stop there.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Decision boundary (k-NN)', family: 'Classification', wiki: 'K-nearest_neighbors_algorithm',
      tip: 'A k-nearest-neighbours classifier (k = 7) on the classic “two moons” data. The shading shows which class it would predict anywhere.',
      draw(r) {
        const noise = 0.12 + r() * 0.1;
        const data = range(120).map(i => { const c = i % 2, t = r() * Math.PI; return c ? [1 - Math.cos(t) + normal(r) * noise, 0.5 - Math.sin(t) + normal(r) * noise, 1] : [Math.cos(t) + normal(r) * noise, Math.sin(t) + normal(r) * noise, 0]; });
        const xs = scale(-1.5, 2.5, L, R), ys = scale(-1, 1.5, B, T), nx = 48, ny = 24, cw = (R - L) / nx, chh = (B - T) / ny;
        let s = '';
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const px = -1.5 + (i + 0.5) / nx * 4, py = 1.5 - (j + 0.5) / ny * 2.5;
          const vote = mean(data.map(([x, y, c]) => [(x - px) ** 2 + (y - py) ** 2, c]).sort((a, b) => a[0] - b[0]).slice(0, 7).map(q => q[1]));
          s += rect(L + i * cw, T + j * chh, cw + 0.3, chh + 0.3, tint(vote > 0.5 ? 's2' : 's1', 10 + Math.abs(vote - 0.5) * 30));
        }
        return s + data.map(([x, y, c]) => dot(xs(x), ys(y), SER[c], 2.4, true)).join('');
      },
    },
    {
      cat: 'ml', name: 'Precision–recall curve', family: 'Model evaluation', wiki: 'Precision_and_recall',
      draw(r) {
        const np = 40, nn = 200, x0 = L + 14, size = B - T, xs = scale(0, 1, x0, x0 + size), ys = scale(0, 1, B, T), base = np / (np + nn);
        const curves = [0.8 + r() * 0.4, 1.6 + r() * 0.6, 2.6 + r() * 0.8].map(d => {
          let tp = 0, fp = 0, ap = 0, prevR = 0;
          const p = [[0, 1]];
          scored(r, d, np, nn).forEach(([, y]) => { y ? tp++ : fp++; const rec = tp / np, prec = tp / (tp + fp); if (y) { ap += (rec - prevR) * prec; prevR = rec; } p.push([rec, prec]); });
          return { p, ap };
        });
        return {
          svg: frameRect(x0, T, size, size) + line(xs(0), ys(base), xs(1), ys(base), 'muted', 1, '3 3') + curves.map(({ p }, i) => poly(p.map(([a, b]) => [xs(a), ys(b)]), SER[i], 1.8)).join('') +
            legend(curves.map(({ ap }, i) => [SER[i], `AP ${ap.toFixed(2)}`]), x0 + size + 14, T + 60) + text(x0 + size / 2, H - 1, 'recall', 'middle'),
          tip: `Precision against recall as the threshold moves. With only ${Math.round(base * 100)}% positives this is more honest than ROC; the dashed line is random guessing.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Calibration curve', family: 'Model evaluation', wiki: 'Probabilistic_classification',
      tip: 'Do predicted probabilities match reality? The overconfident model bends away from the diagonal: its 90% means far less than 90%.',
      draw(r) {
        const x0 = L + 14, size = B - T, xs = scale(0, 1, x0, x0 + size), ys = scale(0, 1, B, T), sig = z => 1 / (1 + Math.exp(-z));
        const models = [1, 0.45 + r() * 0.2].map(temp => {
          const bins = range(10).map(() => [0, 0]);
          range(1500).forEach(() => { const z = normal(r) * 2, b = Math.min(9, Math.floor(sig(z) * 10)); bins[b][0]++; bins[b][1] += r() < sig(z * temp) ? 1 : 0; });
          return bins.map(([n, k], i) => n > 8 ? [(i + 0.5) / 10, k / n] : null).filter(Boolean);
        });
        return frameRect(x0, T, size, size) + line(xs(0), ys(0), xs(1), ys(1), 'muted', 1, '3 3') +
          models.map((m, i) => poly(m.map(([a, b]) => [xs(a), ys(b)]), SER[i], 1.8) + m.map(([a, b]) => dot(xs(a), ys(b), SER[i], 2.8, true)).join('')).join('') +
          legend([['s1', 'calibrated'], ['s2', 'overconfident']], x0 + size + 14, T + 60) + text(x0 + size / 2, H - 1, 'predicted probability', 'middle');
      },
    },
    {
      cat: 'ml', name: 'Cumulative gains chart', family: 'Model evaluation', wiki: 'Lift_(data_mining)',
      draw(r) {
        const np = 50, sc = scored(r, 1.2 + r() * 1.2, np, 450);
        let tp = 0;
        const p = [[0, 0], ...sc.map(([, y], i) => { tp += y; return [(i + 1) / sc.length, tp / np]; })];
        const at20 = p[Math.round(sc.length * 0.2)][1], x0 = L + 14, size = B - T, xs = scale(0, 1, x0, x0 + size), ys = scale(0, 1, B, T);
        return {
          svg: frameRect(x0, T, size, size) + line(xs(0), ys(0), xs(1), ys(1), 'muted', 1, '3 3') + poly([[0, 0], [np / sc.length, 1], [1, 1]].map(([a, b]) => [xs(a), ys(b)]), 'axis', 1.5, '2 3') +
            poly(p.map(([a, b]) => [xs(a), ys(b)]), 's1', 2) + line(xs(0.2), ys(0), xs(0.2), ys(at20), 'text', 1, '2 2') + dot(xs(0.2), ys(at20), 's1', 3.5, true) + text(xs(0.2) + 5, ys(at20) + 10, `${Math.round(at20 * 100)}%`, 'start', 'text', 10, 600) +
            legend([['s1', 'model'], ['muted', 'random'], ['axis', 'perfect']], x0 + size + 14, T + 55) + text(x0 + size / 2, H - 1, 'share of customers contacted', 'middle'),
          tip: `Customers ranked by model score. Contacting the top 20% reaches ${Math.round(at20 * 100)}% of everyone who would respond, versus 20% at random.`,
        };
      },
    },
    {
      cat: 'ml', name: 'PCA scree plot', family: 'Dimensionality reduction', wiki: 'Scree_plot',
      draw(r) {
        const k = 8, raw = range(k).map(i => Math.exp(-i * (0.5 + r() * 0.5)) + 0.02), tot = sum(raw), ev = raw.map(v => v / tot * 100);
        let c = 0;
        const cum = ev.map(v => (c += v)), n90 = cum.findIndex(v => v >= 90) + 1, bw = (R - L) / k, ys = scale(0, 100, B, T), cx = i => L + (i + 0.5) * bw;
        return {
          svg: grid(4) + line(L, ys(90), R, ys(90), 'muted', 1, '3 3') + text(L + 2, ys(90) - 3, '90%', 'start', 'muted', 8) + ev.map((v, i) => bar(L + i * bw + 4, ys(v), bw - 8, B, tint('s1', 55))).join('') +
            poly(cum.map((v, i) => [cx(i), ys(v)]), 's1', 2) + cum.map((v, i) => dot(cx(i), ys(v), 's1', 3, true)).join('') + baseline() + range(k).map(i => text(cx(i), H - 1, `PC${i + 1}`, 'middle', 'muted', 7.5)).join(''),
          tip: `Variance explained by each principal component (bars) and cumulatively (line). The first ${n90} components capture 90% of the information.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Overfitting', family: 'Model complexity', wiki: 'Overfitting',
      tip: 'The same 12 points fitted with polynomials of degree 1, 3 and 9. The line underfits; degree 9 chases the noise and would fail on new data.',
      draw(r) {
        const ph = r() * 2, xsD = range(12).map(i => -1 + 2 * (i + 0.2 + r() * 0.6) / 12), ysD = xsD.map(x => Math.sin(2.4 * x + ph) + normal(r) * 0.25);
        const xs = scale(-1, 1, L, R), ys = scale(-2, 2, B, T), clamp = y => Math.max(T - 4, Math.min(B + 4, ys(y))), g = range(121).map(i => -1 + i / 60);
        return grid() + [1, 3, 9].map((d, i) => { const f = polyfit(xsD, ysD, d); return poly(g.map(x => [xs(x), clamp(f(x))]), ['s2', 's1', 's3'][i], i === 1 ? 2.2 : 1.6); }).join('') +
          xsD.map((x, i) => dot(xs(x), ys(ysD[i]), 'text', 2.8, true)).join('') + hlegend([['s2', 'degree 1'], ['s1', 'degree 3'], ['s3', 'degree 9']], L + 4, T + 2, 64) + baseline();
      },
    },

    // ---- statistics ----------------------------------------------------------
    {
      cat: 'stats', name: 'p-value', family: 'Hypothesis testing', wiki: 'P-value',
      draw(r) {
        const z = 1.3 + r() * 1.7, p = 2 * (1 - normCdf(z)), xs = scale(-4, 4, L, R), ys = scale(0, 0.45, B, T), g = range(161).map(i => -4 + i / 20);
        const tail = (a, b) => area([[xs(a), B], ...g.filter(x => x >= a && x <= b).map(x => [xs(x), ys(npdf(x))]), [xs(b), B]], tint(p < 0.05 ? 'neg' : 's2', 80));
        return {
          svg: tail(-4, -z) + tail(z, 4) + poly(g.map(x => [xs(x), ys(npdf(x))]), 'text', 1.8) + line(xs(z), T + 14, xs(z), B, 'text', 1.5, '3 2') +
            text(xs(z) - 3, T + 22, `observed z = ${z.toFixed(2)}`, 'end', 'text', 8.5, 600) + text(R, T + 4, `p = ${p.toFixed(3)}`, 'end', 'text', 10, 650) + baseline(),
          tip: `If there were truly no effect, results at least this extreme would happen ${(p * 100).toFixed(1)}% of the time (shaded tails). ${p < 0.05 ? 'Below 0.05, so conventionally “significant”.' : 'Above 0.05, so not conventionally significant.'}`,
        };
      },
    },
    {
      cat: 'stats', name: 'Confidence intervals', family: 'Estimation', wiki: 'Confidence_interval',
      draw(r) {
        const mu = 50, n = 20, ivs = range(25).map(() => { const s = range(n).map(() => mu + normal(r) * 10), m = mean(s), e = 2.093 * sd(s) / Math.sqrt(n); return [m - e, m + e]; });
        const hits = ivs.filter(([a, b]) => a <= mu && mu <= b).length, xs = scale(38, 62, L, R), step = (B - T + 4) / 25;
        return {
          svg: line(xs(mu), T - 4, xs(mu), B + 2, 'text', 1.2, '3 2') + ivs.map(([a, b], i) => { const y = T - 1 + i * step, c = a <= mu && mu <= b ? 's1' : 'neg'; return line(xs(a), y, xs(b), y, c, 2) + dot(xs((a + b) / 2), y, c, 1.8); }).join('') + text(xs(mu) + 4, H - 1, 'true mean'),
          tip: `25 samples, each with its own 95% interval. ${hits} of 25 capture the true mean (dashed). The “95%” describes the method, not any single interval.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Statistical power', family: 'Hypothesis testing', wiki: 'Power_(statistics)',
      draw(r) {
        const d = 1.2 + r() * 1.8, crit = 1.645, power = 1 - normCdf(crit - d), xs = scale(-3.5, d + 3.5, L, R), ys = scale(0, 0.45, B, T + 12);
        const g = range(161).map(i => -3.5 + i * (d + 7) / 160);
        const under = (m, a, b, c) => area([[xs(a), B], ...g.filter(x => x >= a && x <= b).map(x => [xs(x), ys(npdf(x - m))]), [xs(b), B]], c);
        return {
          svg: under(d, crit, d + 3.5, tint('s1', 45)) + under(0, crit, d + 3.5, tint('neg', 70)) + poly(g.map(x => [xs(x), ys(npdf(x))]), 'muted', 1.8) + poly(g.map(x => [xs(x), ys(npdf(x - d))]), 's1', 2) +
            line(xs(crit), T + 6, xs(crit), B, 'text', 1.2, '3 2') + hlegend([['muted', 'no effect (H₀)'], ['s1', 'real effect']], L, T + 2, 80) + baseline(),
          tip: `Blue: the chance of detecting a real effect of this size, the power, here ${(power * 100).toFixed(0)}%. Red: false alarms (α = 5%). Bigger samples pull the curves apart.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Multiple comparisons', family: 'Hypothesis testing', wiki: 'Multiple_comparisons_problem',
      draw(r) {
        const est = range(20).map(() => normal(r));
        if (!est.some(e => Math.abs(e) > 1.96)) est[Math.floor(r() * 20)] = (r() < 0.5 ? -1 : 1) * (2.1 + r() * 0.5);
        const hits = est.filter(e => Math.abs(e) > 1.96).length, xs = scale(-4, 4, L + 6, R - 6), step = (B - T + 6) / 20;
        return {
          svg: line(xs(0), T - 4, xs(0), B + 2, 'axis') + est.map((e, i) => { const y = T - 1 + i * step, c = Math.abs(e) > 1.96 ? 'neg' : 's1'; return line(xs(e - 1.96), y, xs(e + 1.96), y, c, 1.5) + dot(xs(e), y, c, 2.4); }).join('') + text(R - 6, H - 1, 'effect estimate ± 95% CI', 'end'),
          tip: `20 experiments where nothing real is going on. At p < 0.05, ${hits} still look “significant” (red) by chance alone. Correct for multiple tests.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Central limit theorem', family: 'Sampling', wiki: 'Central_limit_theorem',
      tip: 'Draw samples from a skewed population (left) and plot their means (right). The means form a bell curve, whatever the original shape.',
      draw(r) {
        const pop = range(800).map(() => -Math.log(1 - r())), n = 30;
        const means = range(400).map(() => mean(range(n).map(() => pop[Math.floor(r() * pop.length)])));
        const hist = (data, lo, hi, nb, x0, x1, c) => {
          const counts = range(nb).fill(0);
          data.forEach(v => { const b = Math.floor((v - lo) / (hi - lo) * nb); if (b >= 0 && b < nb) counts[b]++; });
          const w = (x1 - x0) / nb, ys = scale(0, Math.max(...counts) * 1.1, B, T + 14);
          return counts.map((k, i) => bar(x0 + i * w + 0.5, ys(k), w - 1, B, c)).join('') + baseline(B, x0, x1);
        };
        return hist(pop, 0, 5, 20, L, 118, tint('s2', 70)) + hist(means, 0.5, 1.5, 20, 142, R, tint('s1', 70)) + text(L, T + 4, 'population (skewed)') + text(142, T + 4, `means of n = ${n}`) + text(130, 80, '→', 'middle', 'muted', 14);
      },
    },
    {
      cat: 'stats', name: 'Law of large numbers', family: 'Probability', wiki: 'Law_of_large_numbers',
      tip: 'Running average of die rolls in three experiments. Early averages swing wildly; with more rolls each settles on the expected 3.5.',
      draw(r) {
        const n = 500, xs = scale(0, Math.log(n), L, R), ys = scale(1, 6, B, T);
        return grid(5) + line(L, ys(3.5), R, ys(3.5), 'text', 1, '4 3') + range(3).map(k => { let s = 0; return poly(range(n).map(i => { s += 1 + Math.floor(r() * 6); return [xs(Math.log(i + 1)), ys(s / (i + 1))]; }), SER[k], 1.6); }).join('') +
          text(R, ys(3.5) - 4, '3.5', 'end', 'text', 9, 600) + text(R, H - 1, 'number of rolls (log scale)', 'end');
      },
    },
    {
      cat: 'stats', name: 'The 68–95–99.7 rule', family: 'Distributions', wiki: '68%E2%80%9395%E2%80%9399.7_rule',
      tip: 'In a normal distribution, 68% of values fall within one standard deviation of the mean, 95% within two and 99.7% within three.',
      draw() {
        const base = B - 10, xs = scale(-3.6, 3.6, L, R), ys = scale(0, 0.45, base, T + 14), g = range(145).map(i => -3.6 + i / 20);
        const band = (a, b, p) => area([[xs(a), base], ...g.filter(x => x >= a && x <= b).map(x => [xs(x), ys(npdf(x))]), [xs(b), base]], tint('s1', p));
        return band(-3, 3, 25) + band(-2, 2, 50) + band(-1, 1, 85) + poly(g.map(x => [xs(x), ys(npdf(x))]), 'text', 1.6) + baseline(base) +
          [-3, -2, -1, 0, 1, 2, 3].map(k => text(xs(k), H - 2, k ? `${k > 0 ? '+' : '−'}${Math.abs(k)}σ` : 'μ', 'middle')).join('') +
          [[1, '68%'], [2, '95%'], [3, '99.7%']].map(([k, l], i) => line(xs(-k), 30 - i * 8, xs(k), 30 - i * 8, 'muted', 1) + text(xs(k) + 3, 33 - i * 8, l, 'start', 'text', 8, 600)).join('');
      },
    },
    {
      cat: 'stats', name: 'Common distributions', family: 'Distributions', wiki: 'List_of_probability_distributions',
      tip: 'Normal for sums of many small effects, uniform for equal chances, exponential for waiting times, Poisson for counts, binomial for successes, beta for rates.',
      draw(r) {
        const lam = 2 + Math.floor(r() * 4), pB = 0.2 + r() * 0.5, fact = n => n ? n * fact(n - 1) : 1, choose = (n, k) => fact(n) / (fact(k) * fact(n - k));
        const panels = [
          ['Normal', range(41).map(i => [i / 40, npdf(-3 + i * 0.15)]), false],
          ['Uniform', [[0, 0], [0.1, 0], [0.1, 1], [0.9, 1], [0.9, 0], [1, 0]], false],
          ['Exponential', range(41).map(i => [i / 40, Math.exp(-i / 8)]), false],
          [`Poisson λ=${lam}`, range(11).map(k => [k / 10, Math.exp(-lam) * lam ** k / fact(k)]), true],
          ['Binomial n=10', range(11).map(k => [k / 10, choose(10, k) * pB ** k * (1 - pB) ** (10 - k)]), true],
          ['Beta(2, 5)', range(41).map(i => [i / 40, (i / 40) * (1 - i / 40) ** 4]), false],
        ];
        const pw = (R - L) / 3, ph = (B - T + 8) / 2;
        return panels.map(([name, p, discrete], k) => {
          const px = L + (k % 3) * pw, py = T - 4 + Math.floor(k / 3) * ph, mx = Math.max(...p.map(q => q[1]));
          const sx = v => px + 6 + v * (pw - 12), sy = v => py + ph - 14 - v / mx * (ph - 30);
          const shape = discrete ? p.map(([x, y]) => bar(sx(x) - 3, sy(y), 6, sy(0), tint('s1', 70))).join('') : area([[sx(p[0][0]), sy(0)], ...p.map(([x, y]) => [sx(x), sy(y)]), [sx(p[p.length - 1][0]), sy(0)]], tint('s1', 45), 's1', 1.5);
          return shape + line(px + 4, sy(0), px + pw - 4, sy(0), 'axis') + text(px + pw / 2, py + ph - 3, name, 'middle', 'text', 8.5, 600);
        }).join('');
      },
    },
    {
      cat: 'stats', name: 'What r looks like', family: 'Correlation', wiki: 'Pearson_correlation_coefficient',
      tip: 'Scatter plots with their Pearson correlation. The last panel is a perfect relationship, yet r ≈ 0: r only measures straight-line association.',
      draw(r) {
        const targets = [-0.9, -0.5, 0, 0.3, 0.6, 0.8, 0.95, null], pw = (R - L) / 4, ph = (B - T + 8) / 2;
        return targets.map((t, k) => {
          const xsD = range(40).map(() => normal(r)), ysD = t === null ? xsD.map(x => x * x + normal(r) * 0.15) : xsD.map(x => t * x + Math.sqrt(1 - t * t) * normal(r));
          const rr = ols(xsD, ysD).r, px = L + (k % 4) * pw, py = T - 4 + Math.floor(k / 4) * ph;
          const sx = scale(Math.min(...xsD), Math.max(...xsD), px + 5, px + pw - 5), sy = scale(Math.min(...ysD), Math.max(...ysD), py + ph - 14, py + 4);
          return xsD.map((x, i) => dot(sx(x), sy(ysD[i]), 's1', 1.5)).join('') + text(px + pw / 2, py + ph - 2, `r = ${rr.toFixed(2)}`, 'middle', 'text', 8.5, 600);
        }).join('');
      },
    },
    {
      cat: 'stats', name: 'Spurious correlation', family: 'Correlation', wiki: 'Spurious_relationship',
      draw(r) {
        let a, b, rr = 0;
        for (let t = 0; t < 40 && rr < 0.75; t++) { let u = 0, v = 0; a = range(40).map(() => (u += normal(r))); b = range(40).map(() => (v += normal(r))); rr = ols(a, b).r; }
        const z = s => { const m = mean(s), d = sd(s); return s.map(v => (v - m) / d); }, za = z(a), zb = z(b);
        const lim = Math.max(...za.map(Math.abs), ...zb.map(Math.abs)) * 1.1, xs = scale(0, 39, L, R), ys = scale(-lim, lim, B, T + 10), ln = s => s.map((v, i) => [xs(i), ys(v)]);
        return {
          svg: grid() + poly(ln(za), 's1', 2) + poly(ln(zb), 's2', 2) + hlegend([['s1', 'series A'], ['s2', 'series B']], L, T + 2, 60) + baseline(),
          tip: `Two completely independent random walks, yet r = ${rr.toFixed(2)}. Trending series correlate by accident all the time: correlation is not causation.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Base rate fallacy', family: 'Probability', wiki: 'Base_rate_fallacy',
      draw(r) {
        const prev = 0.005 + r() * 0.025, fpr = 0.05 + r() * 0.05, N = 1000, sick = Math.round(N * prev), tp = Math.round(sick * 0.9), fp = Math.round((N - sick) * fpr);
        const ncol = 40, cell = 5, x0 = (W - ncol * cell) / 2, y0 = T - 6, order = shuffle(range(N), r), kind = range(N).fill(0);
        order.slice(0, tp).forEach(i => { kind[i] = 1; });
        order.slice(tp, sick).forEach(i => { kind[i] = 3; });
        order.slice(sick, sick + fp).forEach(i => { kind[i] = 2; });
        return {
          svg: range(N).map(i => rect(x0 + (i % ncol) * cell, y0 + Math.floor(i / ncol) * cell, cell - 1, cell - 1, ['grid', 's1', 's2', 'text'][kind[i]], 0.5)).join('') +
            rect(x0, 140, 7, 7, 's1', 1) + text(x0 + 10, 146.5, 'sick, positive') + rect(x0 + 90, 140, 7, 7, 's2', 1) + text(x0 + 100, 146.5, 'healthy, positive'),
          tip: `1,000 people, ${sick} sick. The test catches 90% of cases but also flags ${(fpr * 100).toFixed(0)}% of healthy people. Only ${(tp / (tp + fp) * 100).toFixed(0)}% of positives are actually sick.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Benford’s law', family: 'Probability', wiki: 'Benford%27s_law',
      tip: 'In many real-world datasets about 30% of numbers start with 1 and under 5% with 9 (dots). Deviations can be a red flag for made-up data.',
      draw(r) {
        const counts = range(9).fill(0), N = 2000;
        range(N).forEach(() => { const v = Math.exp(normal(r) * 3 + 5); counts[Math.floor(v / 10 ** Math.floor(Math.log10(v))) - 1]++; });
        const bw = (R - L) / 9, ys = scale(0, 0.35, B - 10, T), cx = i => L + (i + 0.5) * bw, ben = i => Math.log10(1 + 1 / (i + 1));
        return grid() + counts.map((c, i) => bar(L + i * bw + 4, ys(c / N), bw - 8, B - 10, tint('s1', 60))).join('') + poly(range(9).map(i => [cx(i), ys(ben(i))]), 'text', 1.5) +
          range(9).map(i => dot(cx(i), ys(ben(i)), 'text', 2.6) + text(cx(i), H - 2, i + 1, 'middle')).join('') + baseline(B - 10);
      },
    },
    {
      cat: 'stats', name: 'Birthday paradox', family: 'Probability', wiki: 'Birthday_problem',
      tip: 'With just 23 people in a room, there’s a better-than-even chance that two share a birthday. With 70 people it’s 99.9%.',
      draw() {
        const P = n => { let q = 1; for (let i = 0; i < n; i++) q *= (365 - i) / 365; return 1 - q; };
        const xs = scale(1, 70, L, R), ys = scale(0, 1, B, T);
        return grid(4) + line(L, ys(0.5), R, ys(0.5), 'muted', 1, '3 3') + line(xs(23), ys(0.5), xs(23), B, 'muted', 1, '3 3') + poly(range(70).map(i => [xs(i + 1), ys(P(i + 1))]), 's1', 2.2) +
          dot(xs(23), ys(P(23)), 's1', 4, true) + text(xs(23) + 7, ys(P(23)) + 12, '23 people → 50.7%', 'start', 'text', 9, 600) + baseline() + text(R, H - 1, 'people in the room', 'end');
      },
    },
    {
      cat: 'stats', name: 'Monty Hall problem', family: 'Probability', wiki: 'Monty_Hall_problem',
      tip: 'Pick one of three doors; the host opens a losing one. Switching wins 2/3 of the time, as these simulated games show. Intuition says 50/50.',
      draw(r) {
        const n = 300, xs = scale(1, n, L, R), ys = scale(0, 1, B, T), stay = [], sw = [];
        let ws = 0, wk = 0;
        range(n).forEach(i => { if (Math.floor(r() * 3) === Math.floor(r() * 3)) ws++; else wk++; stay.push([xs(i + 1), ys(ws / (i + 1))]); sw.push([xs(i + 1), ys(wk / (i + 1))]); });
        return grid(3) + line(L, ys(2 / 3), R, ys(2 / 3), 'muted', 1, '3 3') + line(L, ys(1 / 3), R, ys(1 / 3), 'muted', 1, '3 3') + poly(sw, 's1', 2) + poly(stay, 's2', 2) +
          text(R, ys(2 / 3) - 4, 'switch → 2/3', 'end', 'text', 9, 600) + text(R, ys(1 / 3) + 12, 'stay → 1/3', 'end', 'text', 9, 600) + baseline() + text(L, H - 1, 'games played');
      },
    },
    {
      cat: 'stats', name: 'Mean vs median', family: 'Descriptive', wiki: 'Skewness',
      draw(r) {
        const sg = 0.6 + r() * 0.3, data = sorted(range(500).map(() => 30 * Math.exp(normal(r) * sg))), med = quantile(data, 0.5), mu = mean(data), hi = quantile(data, 0.98), nb = 30, counts = range(nb).fill(0);
        data.forEach(v => { const b = Math.floor(v / hi * nb); if (b < nb) counts[b]++; });
        const xs = scale(0, hi, L, R), ys = scale(0, Math.max(...counts) * 1.2, B, T), w = (R - L) / nb;
        return {
          svg: grid() + counts.map((c, i) => bar(L + i * w + 0.5, ys(c), w - 1, B, tint('s1', 45))).join('') + line(xs(med), T + 4, xs(med), B, 's1', 2) + line(xs(mu), T + 4, xs(mu), B, 's2', 2) +
            text(xs(med) - 3, T + 10, `median ${med.toFixed(0)}k`, 'end', 'text', 8.5, 600) + text(xs(mu) + 3, T + 10, `mean ${mu.toFixed(0)}k`, 'start', 'text', 8.5, 600) + baseline() + text(R, H - 1, 'income', 'end'),
          tip: `In skewed data like incomes, a few very large values pull the mean (${mu.toFixed(0)}k) above the median (${med.toFixed(0)}k). The median better describes a typical person.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Standard error', family: 'Estimation', wiki: 'Standard_error',
      tip: 'Means of repeated samples at each sample size. The spread shrinks with √n, so four times the data only halves the uncertainty.',
      draw(r) {
        const ns = [2, 5, 10, 20, 50, 100], xs = scale(0, ns.length - 1, L + 18, R - 10), ys = scale(-2.2, 2.2, B, T);
        let s = grid(4) + line(L, ys(0), R, ys(0), 'axis') + [1, -1].map(sg => poly(ns.map((n, i) => [xs(i), ys(sg * 1.96 / Math.sqrt(n))]), 's2', 1.5, '4 3')).join('');
        ns.forEach((n, i) => range(30).forEach(() => { s += dot(xs(i) + (r() - 0.5) * 16, ys(mean(range(n).map(() => normal(r)))), tint('s1', 70), 1.8); }));
        return s + ns.map((n, i) => text(xs(i), H - 1, `n=${n}`, 'middle')).join('');
      },
    },
    {
      cat: 'stats', name: 'Bootstrap distribution', family: 'Resampling', wiki: 'Bootstrapping_(statistics)',
      draw(r) {
        const sample = range(30).map(() => Math.exp(normal(r) * 0.6) * 10), boots = sorted(range(1000).map(() => mean(range(30).map(() => sample[Math.floor(r() * 30)]))));
        const lo = quantile(boots, 0.025), hi = quantile(boots, 0.975), a = boots[0], b = boots[999], nb = 30, counts = range(nb).fill(0);
        boots.forEach(v => { counts[Math.min(nb - 1, Math.floor((v - a) / (b - a) * nb))]++; });
        const xs = scale(a, b, L, R), ys = scale(0, Math.max(...counts) * 1.15, B, T), w = (R - L) / nb;
        return {
          svg: grid() + counts.map((c, i) => { const mid = a + (i + 0.5) * (b - a) / nb; return bar(L + i * w + 0.5, ys(c), w - 1, B, tint('s1', mid >= lo && mid <= hi ? 75 : 30)); }).join('') +
            line(xs(lo), T, xs(lo), B, 's2', 1.5, '3 2') + line(xs(hi), T, xs(hi), B, 's2', 1.5, '3 2') + text(xs(lo) - 3, T + 7, lo.toFixed(1), 'end', 'text', 8, 600) + text(xs(hi) + 3, T + 7, hi.toFixed(1), 'start', 'text', 8, 600) + baseline(),
          tip: `Resample the 30 observations with replacement 1,000 times and recompute the mean. The middle 95% gives a confidence interval of ${lo.toFixed(1)}–${hi.toFixed(1)}, no formulas needed.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Bayesian update', family: 'Bayesian statistics', wiki: 'Bayesian_inference',
      draw(r) {
        const a0 = 1 + Math.floor(r() * 6), b0 = 1 + Math.floor(r() * 6), n = 10 + Math.floor(r() * 30), pr = 0.15 + r() * 0.7, k = range(n).filter(() => r() < pr).length;
        const xs = scale(0, 1, L, R), g = range(101).map(i => i / 100);
        const dens = (a, b) => { const v = g.map(x => Math.exp((a - 1) * Math.log(Math.max(x, 1e-9)) + (b - 1) * Math.log(Math.max(1 - x, 1e-9)))), t = sum(v); return v.map(y => y / t); };
        const prior = dens(a0, b0), post = dens(a0 + k, b0 + n - k), ys = scale(0, Math.max(...post, ...prior) * 1.1, B, T), mode = (a0 + k - 1) / (a0 + b0 + n - 2);
        return {
          svg: grid() + area([[xs(0), B], ...g.map((x, i) => [xs(x), ys(post[i])]), [xs(1), B]], tint('s1', 35)) + poly(g.map((x, i) => [xs(x), ys(post[i])]), 's1', 2) + poly(g.map((x, i) => [xs(x), ys(prior[i])]), 's2', 1.8, '4 3') +
            hlegend([['s2', 'prior'], ['s1', 'posterior']], R - 110, T + 4, 50) + baseline() + text(R, H - 1, 'success rate', 'end'),
          tip: `A prior belief (dashed) updated with ${k} successes in ${n} trials becomes the posterior (filled), now centred near ${(mode * 100).toFixed(0)}%. More data, narrower belief.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Kaplan–Meier curve', family: 'Survival analysis', wiki: 'Kaplan%E2%80%93Meier_estimator',
      tip: 'Survival over time for two groups, handling patients who left the study early (tick marks). The gap between the curves is the treatment effect.',
      draw(r) {
        const tmax = 36, xs = scale(0, tmax, L, R), ys = scale(0, 1, B, T + 10);
        let s = grid(4);
        [0.05 + r() * 0.03, 0.025 + r() * 0.02].forEach((rate, gi) => {
          const obs = range(40).map(() => { const t = -Math.log(1 - r()) / rate, c = r() * tmax * 1.4; return t <= c ? [Math.min(t, tmax), t <= tmax ? 1 : 0] : [Math.min(c, tmax), 0]; }).sort((a, b) => a[0] - b[0]);
          let surv = 1, atRisk = obs.length;
          const p = [[xs(0), ys(1)]], ticks = [];
          obs.forEach(([t, ev]) => { if (ev) { p.push([xs(t), ys(surv)]); surv *= 1 - 1 / atRisk; p.push([xs(t), ys(surv)]); } else if (t < tmax) ticks.push([xs(t), ys(surv)]); atRisk--; });
          p.push([xs(tmax), ys(surv)]);
          s += poly(p, SER[gi], 2) + ticks.map(([x, y]) => line(x, y - 3, x, y + 3, SER[gi], 1.2)).join('');
        });
        return s + hlegend([['s1', 'control'], ['s2', 'treatment']], L + 4, T + 2, 60) + baseline() + text(R, H - 1, 'months', 'end');
      },
    },
    {
      cat: 'stats', name: 'Regression to the mean', family: 'Pitfalls', wiki: 'Regression_toward_the_mean',
      draw(r) {
        const n = 140, skill = range(n).map(() => normal(r)), clamp = v => Math.max(1, Math.min(99, v));
        const t1 = skill.map(s => clamp(50 + 10 * (s + normal(r)))), t2 = skill.map(s => clamp(50 + 10 * (s + normal(r))));
        const cut = sorted(t1)[Math.floor(n * 0.9)], top = new Set(range(n).filter(i => t1[i] >= cut));
        const m1 = mean([...top].map(i => t1[i])), m2 = mean([...top].map(i => t2[i])), xs = scale(0, 100, L, R), ys = scale(0, 100, B, T);
        return {
          svg: grid() + line(xs(0), ys(0), xs(100), ys(100), 'muted', 1, '3 3') + range(n).map(i => dot(xs(t1[i]), ys(t2[i]), top.has(i) ? 's2' : tint('s1', 55), 2.2, top.has(i))).join('') +
            ring(xs(m1), ys(m2), 'text', 5) + baseline() + text(R, H - 1, 'test 1', 'end') + text(L, T - 3, 'test 2'),
          tip: `The top 10% on test 1 averaged ${m1.toFixed(0)}, but only ${m2.toFixed(0)} on test 2. They didn’t get worse: part of their first score was luck, and luck doesn’t repeat.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Survivorship bias', family: 'Pitfalls', wiki: 'Survivorship_bias',
      tip: 'Bullet holes on bombers that made it home (Abraham Wald, WWII). The armour belongs where there are no holes: planes hit there never came back.',
      draw(r) {
        const wing = [[137, 56], [245, 72], [245, 82], [137, 80], [123, 80], [15, 82], [15, 72], [123, 56]];
        const tail = [[137, 118], [178, 128], [178, 135], [137, 133], [123, 133], [82, 135], [82, 128], [123, 118]];
        const engines = [[78, 66], [182, 66]];
        let s = area(wing, 'grid', 'axis') + area(tail, 'grid', 'axis') + '<rect x="122" y="12" width="16" height="128" rx="8" style="fill:var(--grid);stroke:var(--axis)"/>' +
          engines.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="10" style="fill:var(--grid);stroke:var(--axis)"/>`).join('');
        const ok = (x, y) => {
          if (engines.some(([ex, ey]) => (x - ex) ** 2 + (y - ey) ** 2 < 200)) return false;
          if (x > 121 && x < 139) return (y > 86 && y < 116) || (y > 120 && y < 132);
          return (inPoly([x, y], wing) && Math.abs(x - 130) > 14) || inPoly([x, y], tail);
        };
        let hits = 0;
        for (let k = 0; k < 4000 && hits < 70; k++) { const x = 15 + r() * 230, y = 12 + r() * 128; if (ok(x, y)) { s += dot(x, y, 'neg', 1.6); hits++; } }
        return s;
      },
    },

    // ---- causal inference & experimentation ----------------------------------
    {
      cat: 'causal', name: 'Reading an A/B test', family: 'A/B testing', wiki: 'A/B_testing',
      draw(r) {
        const n = 4000 + Math.floor(r() * 6000), pA = 0.04 + r() * 0.04, pB = pA * (1 + (r() - 0.3) * 0.25);
        const conv = p => Math.max(1, Math.round(n * p + normal(r) * Math.sqrt(n * p * (1 - p))));
        const rA = conv(pA) / n, rB = conv(pB) / n, se = p => Math.sqrt(p * (1 - p) / n), dse = Math.hypot(se(rA), se(rB)), diff = rB - rA, p = 2 * (1 - normCdf(Math.abs(diff / dse)));
        const spread = 3 * Math.max(se(rA), se(rB)), xs = scale(Math.min(rA, rB) - spread, Math.max(rA, rB) + spread, L + 56, R - 6);
        const m = Math.abs(diff) + 2.6 * dse, xd = scale(-m, m, L + 56, R - 6), sig = p < 0.05;
        const row = (y, label, v, e, c, sx) => text(L, y + 3, label) + line(sx(v - 1.96 * e), y, sx(v + 1.96 * e), y, c, 2.5) + dot(sx(v), y, c, 4, true);
        return {
          svg: row(T + 16, 'control', rA, se(rA), 's2', xs) + text(xs(rA), T + 7, `${(rA * 100).toFixed(2)}%`, 'middle', 'text', 8.5, 600) +
            row(T + 52, 'variant', rB, se(rB), 's1', xs) + text(xs(rB), T + 43, `${(rB * 100).toFixed(2)}%`, 'middle', 'text', 8.5, 600) +
            line(L, T + 72, R, T + 72, 'grid') + line(xd(0), T + 82, xd(0), B, 'axis', 1, '3 3') + row(T + 104, 'difference', diff, dse, sig ? 's1' : 'muted', xd) + text(xd(0), H - 1, '0', 'middle'),
          tip: `${n.toLocaleString('en-US')} users per arm. The variant converts ${diff >= 0 ? 'better' : 'worse'} by ${Math.abs(diff / rA * 100).toFixed(1)}% relative (p = ${p.toFixed(3)}). ${sig ? 'The difference’s 95% interval excludes zero.' : 'The difference’s 95% interval includes zero, so it could be noise.'}`,
        };
      },
    },
    {
      cat: 'causal', name: 'How many users do I need?', family: 'Experiment design', wiki: 'Sample_size_determination',
      draw(r) {
        const p = 0.02 + r() * 0.1, need = mde => 2 * (1.96 + 0.84) ** 2 * p * (1 - p) / (p * mde) ** 2;
        const xs = scale(0.01, 0.2, L + 26, R), ys = scale(Math.log10(500), Math.log10(1e8), B, T), yl = v => ys(Math.log10(v));
        const n5 = need(0.05), fmt = v => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1000)}k`;
        return {
          svg: [1e3, 1e4, 1e5, 1e6, 1e7].map(v => line(L + 26, yl(v), R, yl(v), 'grid') + text(L + 22, yl(v) + 3, fmt(v), 'end', 'muted', 8)).join('') +
            poly(range(77).map(i => { const m = 0.01 + i * 0.0025; return [xs(m), yl(need(m))]; }), 's1', 2.2) + dot(xs(0.05), yl(n5), 's1', 4, true) +
            text(xs(0.05) + 7, yl(n5) - 5, `${fmt(n5)} per arm`, 'start', 'text', 9, 600) + baseline(B, L + 26, R) +
            [0.05, 0.1, 0.15, 0.2].map(v => text(xs(v), H - 1, `${Math.round(v * 100)}%`, 'middle')).join('') + text(L + 26, H - 1, 'lift'),
          tip: `Users per arm to detect a relative lift with 80% power from a ${(p * 100).toFixed(1)}% baseline. A 5% lift needs ~${fmt(n5)}; halving the effect quadruples the sample.`,
        };
      },
    },
    {
      cat: 'causal', name: 'The peeking problem', family: 'Pitfalls',
      tip: 'An A/A test, where nothing differs. Checking every day and stopping at the first p < 0.05 would crown a false winner. Fix the sample size in advance, or use a sequential test.',
      draw(r) {
        let ps;
        for (let t = 0; t < 40; t++) {
          let a = 0, b = 0, n = 0;
          ps = range(60).map(() => {
            n += 300; a += 15 + normal(r) * Math.sqrt(14.25); b += 15 + normal(r) * Math.sqrt(14.25);
            const pp = (a + b) / (2 * n);
            return 2 * (1 - normCdf(Math.abs(b - a) / n / Math.sqrt(2 * pp * (1 - pp) / n)));
          });
          if (Math.min(...ps) < 0.05) break;
        }
        const xs = scale(0, 59, L, R), ys = scale(0, 1, B, T), first = ps.findIndex(p => p < 0.05);
        return grid() + rect(L, ys(0.05), R - L, B - ys(0.05), tint('neg', 30)) + poly(ps.map((p, i) => [xs(i), ys(p)]), 's1', 1.8) +
          (first >= 0 ? ring(xs(first), ys(ps[first]), 'neg', 5) + text(Math.min(xs(first) + 7, R - 70), ys(ps[first]) - 8, '“significant”!', 'start', 'text', 8.5, 600) : '') +
          text(R, ys(0.05) - 3, 'p < 0.05', 'end', 'muted', 8) + baseline() + text(R, H - 1, 'days', 'end') + text(L, T - 2, 'p-value');
      },
    },
    {
      cat: 'causal', name: 'Covariate balance', family: 'Observational studies', wiki: 'Propensity_score_matching',
      tip: 'Standardised differences between treated and control groups before and after matching. Within ±0.1 (dashed) they look comparable on what we measured, but not necessarily on what we didn’t.',
      draw(r) {
        const vars = ['age', 'income', 'tenure', 'visits', 'mobile', 'region', 'prior buy'], xs = scale(-0.7, 0.7, L + 46, R - 4), step = (B - T - 16) / vars.length;
        let s = [-0.1, 0.1].map(v => line(xs(v), T + 10, xs(v), B, 'muted', 1, '3 3')).join('') + line(xs(0), T + 10, xs(0), B, 'axis') + hlegend([['s2', 'before'], ['s1', 'after']], L + 46, T + 2, 54);
        vars.forEach((v, i) => {
          const y = T + 16 + i * step + step / 2, b = (r() < 0.5 ? -1 : 1) * (0.08 + r() * 0.5), a = b * 0.1 + normal(r) * 0.03;
          s += text(L + 40, y + 3, v, 'end') + line(xs(0), y, xs(b), y, 'grid') + ring(xs(b), y, 's2', 3.5) + dot(xs(a), y, 's1', 3.5);
        });
        return s;
      },
    },
    {
      cat: 'causal', name: 'Confounding', family: 'Causal graphs', wiki: 'Confounding',
      draw(r) {
        const ex = [['summer', 'ice cream sales', 'drownings'], ['ability', 'education', 'income'], ['age', 'grey hair', 'blood pressure'], ['fire size', 'firefighters', 'damage']][Math.floor(r() * 4)];
        return {
          svg: dag({ z: [W / 2, T + 18, ex[0], 's2'], x: [L + 52, B - 22, ex[1], 's1'], y: [R - 52, B - 22, ex[2], 's3'] }, [['z', 'x'], ['z', 'y'], ['x', 'y', true]]) + text(W / 2, B - 28, '?', 'middle', 'text', 13, 700),
          tip: `${cap(ex[1])} and ${ex[2]} move together partly because ${ex[0]} drives both. Control for the confounder, and the apparent effect of ${ex[1]} shrinks or vanishes.`,
        };
      },
    },
    {
      cat: 'causal', name: 'Collider bias', family: 'Causal graphs', wiki: 'Berkson%27s_paradox',
      draw(r) {
        const p = range(220).map(() => [normal(r), normal(r)]), cut = 1 + r() * 0.5, sel = p.filter(([x, y]) => x + y > cut), f = ols(sel.map(q => q[0]), sel.map(q => q[1]));
        const xs = scale(-3, 3, L, R), ys = scale(-3, 3, B, T);
        return {
          svg: grid() + p.map(([x, y]) => dot(xs(x), ys(y), x + y > cut ? 's1' : tint('muted', 45), 2.2)).join('') + line(xs(-1), ys(f.a - f.b), xs(3), ys(f.a + 3 * f.b), 's1', 2) +
            text(L, T - 2, 'looks') + text(R, H - 1, 'talent', 'end') + baseline(),
          tip: `Talent and looks are unrelated in the population. Fame needs enough of either, so among the famous (blue) they look negatively correlated (r = ${f.r.toFixed(2)}). Conditioning on a common effect creates bias.`,
        };
      },
    },
    {
      cat: 'causal', name: 'Instrumental variables', family: 'Causal graphs', wiki: 'Instrumental_variables_estimation',
      tip: 'Unobserved ability affects both education and earnings, so a plain regression is biased. Distance to college shifts education but affects earnings only through it, which isolates the causal effect.',
      draw() {
        return dag({ z: [68, T + 26, 'distance to college', 's2'], x: [80, B - 24, 'education', 's1'], y: [R - 36, B - 24, 'earnings', 's3'], u: [R - 50, T + 26, 'ability', null, true] },
          [['z', 'x'], ['x', 'y'], ['u', 'x', true], ['u', 'y', true]]) + text(R - 50, T + 46, 'unobserved', 'middle', 'muted', 8);
      },
    },
    {
      cat: 'causal', name: 'Difference-in-differences', family: 'Quasi-experiments', wiki: 'Difference_in_differences',
      draw(r) {
        const n = 12, t0 = 6, eff = 2 + r() * 3, trend = 0.3 + r() * 0.4, gap = 2 + r() * 2;
        const ctrl = range(n).map(i => 10 + trend * i + normal(r) * 0.35), trt = range(n).map(i => 10 + gap + trend * i + (i >= t0 ? eff : 0) + normal(r) * 0.35), cf = ctrl.map(v => v + gap);
        const all = [...ctrl, ...trt], xs = scale(0, n - 1, L, R - 38), ys = scale(Math.min(...all) - 1, Math.max(...all) + 1, B, T + 8), ln = a => a.map((v, i) => [xs(i), ys(v)]);
        return {
          svg: grid() + line(xs(t0 - 0.5), T + 8, xs(t0 - 0.5), B, 'muted', 1, '3 3') + text(xs(t0 - 0.5) + 4, B - 4, 'policy starts') + poly(ln(ctrl), 's2', 2) + poly(ln(trt), 's1', 2) + poly(ln(cf).slice(t0 - 1), 's1', 1.5, '4 3') +
            line(xs(n - 1) + 8, ys(cf[n - 1]), xs(n - 1) + 8, ys(trt[n - 1]), 'text', 1.5) + text(xs(n - 1) + 11, ys((cf[n - 1] + trt[n - 1]) / 2) + 3, 'effect', 'start', 'text', 8, 600) +
            hlegend([['s1', 'treated'], ['s2', 'control']], L, T + 2, 56) + baseline(),
          tip: `Compare how much the treated group changed with how much the control group changed. Assuming parallel trends (dashed), the extra change of about ${eff.toFixed(1)} is the effect.`,
        };
      },
    },
    {
      cat: 'causal', name: 'Regression discontinuity', family: 'Quasi-experiments', wiki: 'Regression_discontinuity_design',
      tip: 'Students just above and just below the cutoff are nearly identical, except that only those above got the scholarship. So the jump at the line estimates its causal effect.',
      draw(r) {
        const jump = 4 + r() * 6, slope = 0.15 + r() * 0.2;
        const data = range(120).map(() => { const x = r() * 100; return [x, 20 + slope * x + (x >= 50 ? jump : 0) + normal(r) * 3]; });
        const lt = data.filter(p => p[0] < 50), rt = data.filter(p => p[0] >= 50), fl = ols(lt.map(p => p[0]), lt.map(p => p[1])), fr = ols(rt.map(p => p[0]), rt.map(p => p[1]));
        const yl = fl.a + fl.b * 50, yr = fr.a + fr.b * 50, ysD = data.map(p => p[1]), xs = scale(0, 100, L, R), ys = scale(Math.min(...ysD) - 2, Math.max(...ysD) + 2, B, T);
        return grid() + line(xs(50), T, xs(50), B, 'muted', 1, '3 3') + data.map(([x, y]) => dot(xs(x), ys(y), tint(x >= 50 ? 's1' : 's2', 70), 2)).join('') +
          line(xs(0), ys(fl.a), xs(50), ys(yl), 's2', 2.2) + line(xs(50), ys(yr), xs(100), ys(fr.a + fr.b * 100), 's1', 2.2) + line(xs(50), ys(yl), xs(50), ys(yr), 'text', 2.5) +
          text(xs(50) + 5, ys((yl + yr) / 2) + 3, `jump ≈ ${(yr - yl).toFixed(1)}`, 'start', 'text', 9, 600) + baseline() + text(R, H - 1, 'test score (cutoff 50)', 'end');
      },
    },
    {
      cat: 'causal', name: 'Synthetic control', family: 'Quasi-experiments', wiki: 'Synthetic_control_method',
      tip: 'No single region resembles the treated one, so a weighted blend of untreated regions (grey) is built to match it before the intervention. The gap afterwards is the estimated effect.',
      draw(r) {
        const n = 30, t0 = 20, eff = -(2 + r() * 3);
        let v = 10;
        const synth = range(n).map(i => (v += normal(r) * 0.5 + 0.1) + Math.sin(i / 3) * 0.6), real = synth.map((s, i) => s + normal(r) * 0.25 + (i >= t0 ? eff * Math.min(1, (i - t0 + 1) / 3) : 0));
        const donors = range(4).map(() => { const off = normal(r) * 2.5, sc = 0.7 + r() * 0.6; return synth.map(s => 10 + (s - 10) * sc + off + normal(r) * 0.4); });
        const all = [...synth, ...real, ...donors.flat()], xs = scale(0, n - 1, L, R), ys = scale(Math.min(...all), Math.max(...all), B, T + 12), ln = a => a.map((y, i) => [xs(i), ys(y)]);
        return grid() + donors.map(d => poly(ln(d), 'axis', 1)).join('') + line(xs(t0 - 0.5), T + 12, xs(t0 - 0.5), B, 'muted', 1, '3 3') + poly(ln(synth), 's1', 2, '4 3') + poly(ln(real), 'text', 2) +
          hlegend([['text', 'treated'], ['s1', 'synthetic'], ['axis', 'donors']], L, T + 2, 64) + baseline();
      },
    },
    {
      cat: 'causal', name: 'Propensity score overlap', family: 'Observational studies', wiki: 'Propensity_score_matching',
      tip: 'Each unit’s estimated probability of being treated. Fair comparisons are only possible where both groups appear (common support); outside it there is no one comparable.',
      draw(r) {
        const sep = 0.6 + r() * 0.8, sig = z => 1 / (1 + Math.exp(-z)), tr = range(200).map(() => sig(normal(r) + sep)), co = range(200).map(() => sig(normal(r) - sep));
        const dt = kde(tr, 0.05), dc = kde(co, 0.05), g = range(101).map(i => i / 100), mx = Math.max(...g.map(dt), ...g.map(dc));
        const lo = Math.max(Math.min(...tr), Math.min(...co)), hi = Math.min(Math.max(...tr), Math.max(...co)), xs = scale(0, 1, L, R), ys = scale(0, mx * 1.15, B, T + 10);
        const curve = d => [[xs(0), B], ...g.map(x => [xs(x), ys(d(x))]), [xs(1), B]];
        return rect(xs(lo), T + 10, xs(hi) - xs(lo), B - T - 10, tint('s3', 15)) + text((xs(lo) + xs(hi)) / 2, T + 20, 'common support', 'middle', 'muted', 8) +
          area(curve(dc), tint('s2', 40), 's2', 1.5) + area(curve(dt), tint('s1', 40), 's1', 1.5) + hlegend([['s1', 'treated'], ['s2', 'control']], L, T + 2, 56) + baseline() + text(R, H - 1, 'propensity score', 'end');
      },
    },
    {
      cat: 'causal', name: 'CUPED variance reduction', family: 'A/B testing',
      draw(r) {
        const rho = 0.5 + r() * 0.35, pre = range(600).map(() => normal(r)), post = pre.map(p => rho * p + Math.sqrt(1 - rho * rho) * normal(r) + 5);
        const th = ols(pre, post).b, mp = mean(pre), adj = post.map((y, i) => y - th * (pre[i] - mp)), red = 1 - sd(adj) ** 2 / sd(post) ** 2;
        const g = range(101).map(i => 1.5 + i * 0.07), d1 = kde(post, 0.25), d2 = kde(adj, 0.25), xs = scale(1.5, 8.5, L, R), ys = scale(0, Math.max(...g.map(d2)) * 1.15, B, T + 10);
        const curve = d => [[xs(1.5), B], ...g.map(x => [xs(x), ys(d(x))]), [xs(8.5), B]];
        return {
          svg: area(curve(d1), tint('muted', 30), 'muted', 1.5) + area(curve(d2), tint('s1', 40), 's1', 1.8) + hlegend([['muted', 'raw metric'], ['s1', 'CUPED-adjusted']], L, T + 2, 72) + baseline(),
          tip: `CUPED subtracts what each user’s pre-experiment behaviour predicts. Same average, ${(red * 100).toFixed(0)}% less variance, so the test needs ${(red * 100).toFixed(0)}% fewer users for the same power.`,
        };
      },
    },
    {
      cat: 'causal', name: 'Heterogeneous effects', family: 'A/B testing', wiki: 'Average_treatment_effect',
      tip: 'The average effect can hide segments that respond very differently. But slicing many segments invites false discoveries, so decide which ones matter before you look.',
      draw(r) {
        const segs = ['new users', 'returning', 'mobile', 'desktop', 'Norway', 'Sweden', 'Denmark'], base = 1 + r() * 2;
        const rows = segs.map(() => [base + normal(r) * 1.8, 0.8 + r() * 1.2]), xs = scale(-4, 7, L + 56, R - 4), step = (B - T - 16) / (segs.length + 1);
        const yo = T + 6 + segs.length * step + 4;
        return line(xs(0), T, xs(0), B, 'axis') + rows.map(([e, w], i) => { const y = T + 6 + i * step; return text(L + 50, y + 3, segs[i], 'end') + line(xs(e - w), y, xs(e + w), y, 's1', 1.8) + rect(xs(e) - 3, y - 3, 6, 6, 's1', 1); }).join('') +
          line(L, yo - 8, R, yo - 8, 'grid') + text(L + 50, yo + 3, 'overall', 'end', 'text', 9, 600) + area([[xs(base - 0.5), yo], [xs(base), yo - 5], [xs(base + 0.5), yo], [xs(base), yo + 5]], 'text') + text(R, H - 1, 'effect (%)', 'end');
      },
    },
    {
      cat: 'causal', name: 'Novelty effect', family: 'Pitfalls', wiki: 'Novelty_effect',
      draw(r) {
        const steady = 0.5 + r() * 2, spike = 4 + r() * 6, tau = 3 + r() * 4, n = 28, lift = range(n).map(i => steady + spike * Math.exp(-i / tau) + normal(r) * 0.5);
        const xs = scale(0, n - 1, L, R), ys = scale(Math.min(0, ...lift) - 1, Math.max(...lift) + 1, B, T);
        const band = [...lift.map((v, i) => [xs(i), ys(v + 1.5)]), ...lift.map((v, i) => [xs(i), ys(v - 1.5)]).reverse()];
        return {
          svg: grid() + area(band, tint('s1', 20)) + line(L, ys(0), R, ys(0), 'axis') + line(L, ys(steady), R, ys(steady), 'text', 1, '4 3') + poly(lift.map((v, i) => [xs(i), ys(v)]), 's1', 2) +
            text(R, ys(steady) - 4, 'long-run lift', 'end', 'text', 8.5, 600) + text(R, H - 1, 'days since launch', 'end') + text(L, T - 2, 'lift %'),
          tip: `Users click on anything new at first. The lift started near ${(steady + spike).toFixed(0)}% but settles around ${steady.toFixed(1)}%. Run tests for full weeks and look at the effect over time.`,
        };
      },
    },
    {
      cat: 'causal', name: 'Sample ratio mismatch', family: 'Pitfalls',
      draw(r) {
        const N = 40000 + Math.floor(r() * 80000), off = r() < 0.65 ? (0.004 + r() * 0.01) * (r() < 0.5 ? -1 : 1) : normal(r) * 0.5 / Math.sqrt(N);
        const nA = Math.round(N * (0.5 + off)), nB = N - nA, z = (nA - N / 2) / Math.sqrt(N / 4), p = 2 * (1 - normCdf(Math.abs(z))), srm = p < 0.001, c = srm ? 'neg' : 's1';
        const xs = scale(0.47, 0.53, L + 50, R - 10);
        return {
          svg: line(xs(0.5), T + 8, xs(0.5), B, 'muted', 1, '3 3') + text(xs(0.5), T + 4, 'expected 50%', 'middle', 'muted', 8) +
            [['control', nA], ['variant', nB]].map(([lab, k], i) => { const y = T + 44 + i * 44; return text(L, y + 3, lab) + line(xs(0.5), y, xs(k / N), y, c, 2.5) + dot(xs(k / N), y, c, 5, true) + text(xs(k / N), y - 9, `${(k / N * 100).toFixed(1)}%`, 'middle', 'text', 9, 600); }).join('') +
            [0.48, 0.49, 0.51, 0.52].map(v => text(xs(v), H - 1, `${Math.round(v * 100)}%`, 'middle', 'muted', 8)).join(''),
          tip: `Expected a 50/50 split; got ${(nA / N * 100).toFixed(1)}/${(nB / N * 100).toFixed(1)} from ${N.toLocaleString('en-US')} users (p ${p < 0.0001 ? '< 0.0001' : `= ${p.toFixed(3)}`}). ${srm ? 'Something in assignment or logging is broken, so don’t trust the results.' : 'Within chance: no sign of a problem.'}`,
        };
      },
    },
    {
      cat: 'causal', name: 'Multi-armed bandit', family: 'Adaptive experiments', wiki: 'Multi-armed_bandit',
      draw(r) {
        const rates = shuffle([0.05, 0.06 + r() * 0.01, 0.08 + r() * 0.02], r), wins = [1, 1, 1], losses = [1, 1, 1], batches = 30, shares = [];
        for (let b = 0; b < batches; b++) {
          const cnt = [0, 0, 0];
          for (let u = 0; u < 200; u++) {
            // Thompson sampling, with a normal approximation to each arm's Beta posterior
            const draws = range(3).map(j => { const a = wins[j], c = losses[j], m = a / (a + c); return m + Math.sqrt(a * c / ((a + c) ** 2 * (a + c + 1))) * normal(r); });
            const j = draws.indexOf(Math.max(...draws));
            cnt[j]++;
            if (r() < rates[j]) wins[j]++; else losses[j]++;
          }
          shares.push(cnt.map(c => c / 200));
        }
        const xs = scale(0, batches - 1, L, R), ys = scale(0, 1, B, T + 10), best = rates.indexOf(Math.max(...rates));
        let base = range(batches).fill(0), s = '';
        range(3).forEach(j => { const top = base.map((b, t) => b + shares[t][j]); s += area([...top.map((v, t) => [xs(t), ys(v)]), ...base.map((v, t) => [xs(t), ys(v)]).reverse()], SER[j], 'card', 1); base = top; });
        return {
          svg: s + hlegend(rates.map((p, j) => [SER[j], `${(p * 100).toFixed(1)}%`]), L, T + 2, 56) + text(R, H - 1, 'share of traffic over time', 'end'),
          tip: `Thompson sampling moves traffic towards whichever variant is winning while the test runs, here the ${(rates[best] * 100).toFixed(1)}% arm. Fewer users see losers, at the cost of weaker inference.`,
        };
      },
    },
    { cat: 'causal', name: 'The fundamental problem', family: 'Foundations', wiki: 'Rubin_causal_model', tip: 'We never see the same person both treated and untreated, so one of the two outcomes is always missing. Every causal method is a way of estimating that missing counterfactual.' },
    { cat: 'causal', name: 'Randomisation beats adjustment', family: 'Foundations', wiki: 'Randomized_controlled_trial', tip: 'Random assignment balances everything between groups, measured or not. Statistical adjustment can only fix the confounders you thought of and managed to measure.' },
    { cat: 'causal', name: 'Interference between units', family: 'Foundations', tip: 'A/B tests assume one user’s treatment doesn’t affect another’s outcome. In marketplaces and social networks it does, so randomise by region, time slot or cluster instead.' },
    { cat: 'causal', name: 'Guardrail metrics', family: 'Experiment design', tip: 'Besides the metric you hope to move, track the ones that must not get worse: revenue, latency, complaints, unsubscribes. A win that breaks a guardrail isn’t a win.' },
    { cat: 'causal', name: 'Pre-register the analysis', family: 'Experiment design', wiki: 'Preregistration_(science)', tip: 'Write down the hypothesis, primary metric, sample size and analysis plan before launch. It protects you from fooling yourself once you’ve seen the data.' },
    { cat: 'causal', name: 'Twyman’s law', family: 'Pitfalls', tip: '“Any figure that looks interesting or different is usually wrong.” Before celebrating a surprisingly large effect, check the data pipeline, logging and assignment.' },

    // ---- AI ------------------------------------------------------------------
    {
      cat: 'ai', name: 'Tokenization', family: 'LLM basics', wiki: 'Large_language_model',
      tip: 'Models read tokens, not words. Common words are one token; rare, long or non-English words split into pieces and cost more. (Illustrative split; real tokenizers differ.)',
      draw(r) {
        const sentences = ['Data scientists love unexpectedly long words', 'Tokenization splits text into subword pieces', 'Snowflake warehouses autoscale on demand', 'Personvernerklæringen ble oppdatert i går'];
        const words = sentences[Math.floor(r() * sentences.length)].split(' ');
        const toks = words.flatMap(w => { if (w.length <= 6) return [w]; const c = w.match(/.{1,4}/gu); if (c[c.length - 1].length === 1) c[c.length - 2] += c.pop(); return c; });
        let x = L, y = T + 10, s = '';
        toks.forEach((t, i) => {
          const w = t.length * 6.1 + 8;
          if (x + w > R) { x = L; y += 24; }
          s += rect(x, y - 12, w, 18, tint(SER[i % 5], 30), 3) + `<text x="${n1(x + w / 2)}" y="${n1(y + 1)}" text-anchor="middle" style="fill:var(--text);font:10px ui-monospace,SFMono-Regular,Menlo,monospace">${t}</text>`;
          x += w + 3;
        });
        return s + text(L, B, `${toks.length} tokens · ${words.length} words`, 'start', 'text', 10, 600);
      },
    },
    {
      cat: 'ai', name: 'Attention', family: 'Transformers', wiki: 'Attention_(machine_learning)',
      tip: 'Each row shows where one word “looks” while building its meaning; here “it” attends mostly to “cat”. Later words are masked, because a language model can only look back.',
      draw(r) {
        const words = ['The', 'cat', 'sat', 'on', 'the', 'mat', 'because', 'it', 'was', 'tired'], n = words.length, cell = 11, x0 = 80, y0 = T + 22;
        let s = '';
        words.forEach((w, i) => {
          const raw = range(i + 1).map(j => Math.exp(normal(r) * 0.4 + (j === i ? 1.2 : 0) + (j === i - 1 ? 0.6 : 0) + (i === 7 && j === 1 ? 3.2 : 0) + (i === 9 && j === 1 ? 1.5 : 0))), t = sum(raw);
          range(n).forEach(j => { s += rect(x0 + j * cell, y0 + i * cell, cell - 1, cell - 1, j <= i ? tint('s1', Math.min(100, 8 + raw[j] / t * 140)) : 'grid', 1.5); });
          s += text(x0 - 4, y0 + i * cell + 8, w, 'end', i === 7 ? 'text' : 'muted', 8, i === 7 ? 700 : 400) +
            `<text transform="translate(${x0 + i * cell + 7} ${y0 - 3}) rotate(-55)" style="fill:var(--muted);font-size:8px">${w}</text>`;
        });
        return s;
      },
    },
    {
      cat: 'ai', name: 'Embeddings', family: 'Representations', wiki: 'Word_embedding',
      tip: 'Embeddings place words or documents as points so that similar meanings land close together. Directions carry meaning too: king − man + woman ≈ queen.',
      draw(r) {
        const jit = () => normal(r) * 5;
        let s = '';
        [[['cat', 'dog', 'horse', 'cow'], [52, 42], 's3'], [['apple', 'banana', 'pear'], [62, 112], 's4'], [['Norway', 'Sweden', 'Japan'], [190, 115], 's5']].forEach(([ws, [cx, cy], c]) =>
          ws.forEach((w, i) => { const a = i / ws.length * 2 * Math.PI, x = cx + Math.cos(a) * 18 + jit(), y = cy + Math.sin(a) * 12 + jit(); s += dot(x, y, c, 3) + text(x + 5, y + 3, w, 'start', 'text', 8); }));
        const o = [jit(), jit() / 2], P = { man: [128, 64], woman: [156, 86], king: [178, 26], queen: [206, 48] }, at = k => [P[k][0] + o[0], P[k][1] + o[1]];
        Object.keys(P).forEach(k => { const [x, y] = at(k); s += dot(x, y, 's1', 3) + text(x + 5, y + 3, k, 'start', 'text', 8); });
        return s + [['man', 'woman'], ['king', 'queen']].map(([a, b]) => line(...at(a), ...at(b), 's1', 1.2, '3 2')).join('');
      },
    },
    {
      cat: 'ai', name: 'Temperature', family: 'Sampling',
      tip: 'Temperature rescales the model’s scores before it picks the next word. Low values make output predictable; high values flatten the odds, so unlikely words (“purple”) get picked.',
      draw(r) {
        const words = ['sunny', 'cloudy', 'rainy', 'nice', 'cold', 'purple'], logits = [2.2, 1.6, 1.2, 0.9, 0.4, -1.5].map(v => v + normal(r) * 0.15);
        const lw = 40, pw = (R - L - lw) / 3, step = (B - T - 22) / words.length, yOf = i => T + 14 + i * step;
        return text(L, T + 2, '“The weather today is …”', 'start', 'text', 9, 600) + words.map((w, i) => text(L + lw - 4, yOf(i) + step / 2 + 3, w, 'end', 'muted', 8)).join('') +
          [0.3, 1, 2].map((t, k) => {
            const e = logits.map(l => Math.exp(l / t)), z = sum(e), x0 = L + lw + k * pw, xs = scale(0, 1, x0 + 2, x0 + pw - 6);
            return e.map((v, i) => rect(xs(0), yOf(i) + 2, Math.max(1, xs(v / z) - xs(0)), step - 4, i === 5 ? 's2' : 's1', 1.5)).join('') + text(x0 + pw / 2, H - 1, `T = ${t}`, 'middle', 'text', 9, 600);
          }).join('');
      },
    },
    {
      cat: 'ai', name: 'Top-p (nucleus) sampling', family: 'Sampling',
      draw(r) {
        const raw = range(12).map(i => Math.exp(-i * (0.3 + r() * 0.3) + normal(r) * 0.2)), z = sum(raw), ps = raw.map(v => v / z).sort((a, b) => b - a);
        let c = 0;
        const k = ps.findIndex(p => (c += p) >= 0.9) + 1, bw = (R - L) / 12, ys = scale(0, ps[0] * 1.15, B, T + 12);
        return {
          svg: grid() + ps.map((p, i) => bar(L + i * bw + 3, ys(p), bw - 6, B, i < k ? 's1' : tint('muted', 40))).join('') + text(L, T + 4, `nucleus: top ${k} tokens = 90% of probability`, 'start', 'text', 8.5, 600) + baseline() + text(R, H - 1, 'candidate tokens, most likely first', 'end'),
          tip: `Top-p sampling keeps the smallest set of likely tokens that covers p = 90% of the probability (here ${k} of 12) and samples among them, cutting off the long tail of nonsense.`,
        };
      },
    },
    {
      cat: 'ai', name: 'Softmax', family: 'LLM basics', wiki: 'Softmax_function',
      tip: 'A model outputs raw scores (logits) for every possible next token. Softmax turns them into probabilities that are positive and sum to 1, exaggerating the gaps between scores.',
      draw(r) {
        const k = 6, logits = range(k).map(() => normal(r) * 1.5), e = logits.map(Math.exp), z = sum(e), pw = (R - L - 24) / 2, bw = pw / k, x2 = L + pw + 24;
        const lim = Math.max(...logits.map(Math.abs)) * 1.1, ysL = scale(-lim, lim, B, T + 14), ysP = scale(0, Math.max(...e) / z * 1.1, B, T + 14);
        return text(L, T + 4, 'logits') + text(x2, T + 4, 'probabilities') + line(L, ysL(0), L + pw, ysL(0), 'axis') + text(L + pw + 12, (T + B) / 2 + 6, '→', 'middle', 'muted', 14) +
          logits.map((v, i) => rect(L + i * bw + 2, Math.min(ysL(0), ysL(v)), bw - 4, Math.abs(ysL(v) - ysL(0)), v >= 0 ? 'pos' : 'neg', 2)).join('') +
          e.map((v, i) => bar(x2 + i * bw + 2, ysP(v / z), bw - 4, B, 's1')).join('') + baseline(B, x2, x2 + pw);
      },
    },
    {
      cat: 'ai', name: 'Semantic similarity', family: 'Representations', wiki: 'Cosine_similarity',
      tip: 'Embedding similarity matches meaning, not keywords: “money back” sits close to “refund policy” with no words in common, while the login questions form their own cluster.',
      draw(r) {
        const labels = ['refund policy', 'money back', 'return an item', 'reset password', 'can’t log in'], grp = [0, 0, 0, 1, 1], cell = 22, x0 = 100, y0 = T + 4;
        return labels.map((lab, i) => text(x0 - 5, y0 + (i + 0.5) * cell + 3, lab, 'end') + labels.map((_, j) => {
          const v = i === j ? 1 : grp[i] === grp[j] ? 0.72 + r() * 0.18 : 0.08 + r() * 0.18;
          return rect(x0 + j * cell + 1, y0 + i * cell + 1, cell - 2, cell - 2, tint('s1', v * 100), 2) + text(x0 + (j + 0.5) * cell, y0 + (i + 0.5) * cell + 3, v.toFixed(1), 'middle', v > 0.55 ? '#fff' : 'text', 7.5);
        }).join('')).join('');
      },
    },
    {
      cat: 'ai', name: 'Scaling laws', family: 'Training', wiki: 'Neural_scaling_law',
      tip: 'Loss falls as a smooth power law as training compute grows, which lets labs predict a large model’s performance from small runs. It flattens towards an irreducible floor.',
      draw(r) {
        const E = 1.6 + r() * 0.3, A = 8 + r() * 4, alpha = 0.045 + r() * 0.02, loss = lc => E + A * 10 ** (-alpha * lc);
        const xs = scale(18, 26, L + 24, R), ys = scale(E - 0.05, loss(18) + 0.1, B, T + 6), pts2 = range(9).map(i => { const lc = 18 + i * 0.75 + r() * 0.3; return [lc, loss(lc) + normal(r) * 0.02]; });
        return grid() + line(L + 24, ys(E), R, ys(E), 'muted', 1, '3 3') + text(R, ys(E) - 3, 'irreducible loss', 'end', 'muted', 8) +
          poly(range(41).map(i => { const lc = 18 + i * 0.2; return [xs(lc), ys(loss(lc))]; }), 's1', 2) + pts2.map(([lc, l]) => dot(xs(lc), ys(l), 's1', 3.2, true)).join('') +
          ['¹⁸', '²⁰', '²²', '²⁴', '²⁶'].map((e, i) => text(xs(18 + 2 * i), H - 1, `10${e}`, 'middle')).join('') + text(L, T + 4, 'loss') + baseline(B, L + 24, R);
      },
    },
    {
      cat: 'ai', name: 'Transformer architecture', family: 'Transformers', wiki: 'Transformer_(deep_learning_architecture)',
      tip: 'Tokens become vectors, then pass through many identical blocks: attention mixes information between tokens and feed-forward layers process each one, with residual connections around both.',
      draw() {
        const boxes = [['next-token probabilities', 'muted'], ['add & norm'], ['feed-forward', 's2'], ['add & norm'], ['multi-head attention', 's1'], ['token + position embedding', 'muted']];
        const cx = W / 2 - 6, bw = 150, bh = 16, gap = 6, yt = i => T - 4 + i * (bh + gap), xl = cx - bw / 2 - 10, xr = cx + bw / 2 + 8;
        let s = boxes.map(([label, c], i) => `<rect x="${cx - bw / 2}" y="${yt(i)}" width="${bw}" height="${bh}" rx="4" style="fill:${c ? tint(c, 30) : 'var(--card-2)'};stroke:${col(c || 'axis')};stroke-width:1.2"/>` +
          text(cx, yt(i) + 11.5, label, 'middle', 'text', 8.5, 600) + (i < boxes.length - 1 ? line(cx, yt(i + 1), cx, yt(i) + bh, 'muted', 1.2) : '')).join('');
        s += [5, 3].map(i => poly([[cx, yt(i) - gap / 2], [xl, yt(i) - gap / 2], [xl, yt(i - 2) + bh / 2], [cx - bw / 2, yt(i - 2) + bh / 2]], 'muted', 1)).join('');
        return s + line(xr, yt(1), xr, yt(4) + bh, 'text', 1.2) + line(xr - 4, yt(1), xr, yt(1), 'text', 1.2) + line(xr - 4, yt(4) + bh, xr, yt(4) + bh, 'text', 1.2) + text(xr + 5, (yt(1) + yt(4) + bh) / 2 + 4, '× N', 'start', 'text', 10, 700);
      },
    },
    {
      cat: 'ai', name: 'Retrieval-augmented generation', family: 'LLM systems', wiki: 'Retrieval-augmented_generation',
      tip: 'Instead of relying on what the model memorised, RAG searches your documents for relevant passages and adds them to the prompt, so answers are grounded in your data and can cite sources.',
      draw() {
        return dag({ q: [40, T + 14, 'question', 's2'], ret: [150, T + 14, 'search'], docs: [225, T + 14, 'docs'], top: [150, T + 63, 'top-k passages', 's3'], llm: [150, B - 14, 'LLM', 's1'], ans: [225, B - 14, 'answer', 's2'] },
          [['q', 'ret'], ['docs', 'ret'], ['ret', 'top'], ['top', 'llm'], ['q', 'llm'], ['llm', 'ans']]);
      },
    },
    {
      cat: 'ai', name: 'AI agents', family: 'LLM systems', wiki: 'Intelligent_agent',
      tip: 'An agent is an LLM in a loop: it plans, calls a tool (search, code, an API), reads the result and decides what to do next until the goal is met.',
      draw() {
        return dag({ goal: [38, 75, 'goal'], llm: [118, 75, 'LLM', 's1'], act: [205, 28, 'tool call', 's2'], obs: [205, 122, 'result', 's3'], ans: [70, 128, 'final answer'] },
          [['goal', 'llm'], ['llm', 'act'], ['act', 'obs'], ['obs', 'llm'], ['llm', 'ans']]) + text(232, 79, 'loop', 'middle', 'muted', 8);
      },
    },
    {
      cat: 'ai', name: 'How chat models are trained', family: 'Training', wiki: 'Reinforcement_learning_from_human_feedback',
      tip: 'A pretrained model is fine-tuned on example conversations, people rank its answers, a reward model learns those preferences, and reinforcement learning optimises the model towards them.',
      draw() {
        return dag({ pre: [62, T + 14, 'pretraining'], sft: [62, 75, 'fine-tuning'], rl: [62, B - 14, 'RL from feedback', 's1'], hum: [195, T + 14, 'human rankings', 's2'], rm: [195, 75, 'reward model', 's3'] },
          [['pre', 'sft'], ['sft', 'rl'], ['sft', 'hum'], ['hum', 'rm'], ['rm', 'rl']]) + text(62, T + 30, 'predict the next token', 'middle', 'muted', 7.5);
      },
    },
    {
      cat: 'ai', name: 'LoRA fine-tuning', family: 'Training', wiki: 'Fine-tuning_(deep_learning)',
      draw(r) {
        const d = 4096, rank = [4, 8, 16, 32][Math.floor(r() * 4)], full = d * d, lora = 2 * d * rank, S = 90, y0 = T + 14, x0 = L, rw = Math.max(4, rank / 32 * 14);
        const bx = x0 + S + 26, ax = bx + rw + 18;
        return {
          svg: rect(x0, y0, S, S, tint('muted', 30), 3) + text(x0 + S / 2, y0 + S / 2 + 4, 'W (frozen)', 'middle', 'text', 9, 600) + text(x0 + S / 2, y0 - 4, `${d} × ${d}`, 'middle', 'muted', 8) +
            text(x0 + S + 13, y0 + S / 2 + 5, '+', 'middle', 'text', 16, 600) + rect(bx, y0, rw, S, 's1', 2) + text(bx + rw / 2, y0 + S + 12, 'B', 'middle', 'text', 9, 600) +
            text(bx + rw + 9, y0 + S / 2 + 4, '×', 'middle', 'text', 12) + rect(ax, y0, S, rw, 's1', 2) + text(ax + S / 2, y0 + rw + 12, `A (rank ${rank})`, 'middle', 'text', 9, 600),
          tip: `Instead of updating a ${d}×${d} weight matrix (${(full / 1e6).toFixed(1)}M numbers), LoRA trains two thin matrices with ${Math.round(lora / 1e3)}k numbers, ${(lora / full * 100).toFixed(2)}% as many. Cheap fine-tuning, swappable adapters.`,
        };
      },
    },
    {
      cat: 'ai', name: 'Quantization', family: 'Efficiency', wiki: 'Quantization_(signal_processing)',
      tip: 'Storing weights in 4 bits instead of 16 makes a model 4× smaller and faster, with little quality loss. Each weight snaps to the nearest of 16 levels (lines); a few outliers make the levels coarser.',
      draw(r) {
        const w = range(3000).map(() => normal(r) * (r() < 0.02 ? 3 : 1)), lim = Math.max(...w.map(Math.abs)), nb = 60, counts = range(nb).fill(0);
        w.forEach(v => { counts[Math.min(nb - 1, Math.floor((v + lim) / (2 * lim) * nb))]++; });
        const xs = scale(-lim, lim, L, R), ys = scale(0, Math.max(...counts) * 1.1, B, T + 12), bw = (R - L) / nb, lv = k => xs(-lim + (k + 0.5) * 2 * lim / 16);
        return counts.map((c, i) => bar(L + i * bw + 0.3, ys(c), bw - 0.6, B, tint('s1', 60))).join('') + range(16).map(k => line(lv(k), T + 12, lv(k), B, 's2', 1)).join('') + baseline() + text(L, T + 4, 'weight values and the 16 int4 levels');
      },
    },
    {
      cat: 'ai', name: 'Mixture of experts', family: 'Efficiency', wiki: 'Mixture_of_experts',
      tip: 'A router sends each token to only a few of many expert sub-networks. The model holds many parameters but uses a fraction of them per token, so it’s much cheaper to run.',
      draw(r) {
        const n = 8, pick = shuffle(range(n), r).slice(0, 2), ew = (R - L) / n;
        const box = (y, label, c) => `<rect x="${W / 2 - 34}" y="${y}" width="68" height="18" rx="5" style="fill:${c ? tint(c, 30) : 'var(--card-2)'};stroke:${col(c || 'axis')}"/>` + text(W / 2, y + 12.5, label, 'middle', 'text', 9, 600);
        return box(T, 'token', 's2') + line(W / 2, T + 18, W / 2, T + 36, 'muted', 1.4) + box(T + 36, 'router') + range(n).map(i => {
          const on = pick.includes(i), x = L + ew * (i + 0.5);
          return line(W / 2, T + 54, x, B - 40, on ? 's1' : 'grid', on ? 2 : 1) + rect(x - ew / 2 + 3, B - 40, ew - 6, 30, on ? 's1' : tint('muted', 25), 3) + text(x, B - 21, `E${i + 1}`, 'middle', on ? '#fff' : 'muted', 8.5, 600);
        }).join('') + text(W / 2, H - 1, '2 of 8 experts active for this token', 'middle');
      },
    },
    {
      cat: 'ai', name: 'Diffusion models', family: 'Generative models', wiki: 'Diffusion_model',
      tip: 'A diffusion model learns to remove noise step by step. To generate, it starts from pure noise and denoises towards something resembling its training data, here a 2D shape.',
      draw(r) {
        const shape = Math.floor(r() * 3), n = 140;
        const target = range(n).map(i => {
          const t = i / n * 2 * Math.PI;
          if (shape === 0) return [16 * Math.sin(t) ** 3 / 17, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17];
          if (shape === 1) { const a = i / n * 4 * Math.PI, rad = 0.15 + 0.85 * i / n; return [rad * Math.cos(a), rad * Math.sin(a)]; }
          const rad = 0.72 + 0.25 * Math.cos(5 * t); return [rad * Math.cos(t), rad * Math.sin(t)];
        });
        const noise = target.map(() => [normal(r) * 0.8, normal(r) * 0.8]), pw = (R - L) / 5, k = 17;
        return [0, 0.3, 0.7, 0.93, 1].map((a, j) => {
          const cx = L + pw * (j + 0.5), cy = 70;
          return target.map(([x, y], i) => dot(cx + (Math.sqrt(a) * x + Math.sqrt(1 - a) * noise[i][0]) * k, cy - (Math.sqrt(a) * y + Math.sqrt(1 - a) * noise[i][1]) * k, 's1', 1.2)).join('') +
            text(cx, B, ['noise', 'step 1', 'step 2', 'step 3', 'sample'][j], 'middle', j === 4 ? 'text' : 'muted', 8, j === 4 ? 600 : 400) + (j < 4 ? text(cx + pw / 2, cy + 4, '→', 'middle', 'muted', 10) : '');
        }).join('');
      },
    },
    {
      cat: 'ai', name: 'Lost in the middle', family: 'Context',
      tip: 'Models use information at the start and end of a long prompt better than information in the middle. Put the key instructions and facts at the edges.',
      draw(r) {
        const xs = scale(0, 1, L + 20, R), ys = scale(0.4, 1, B, T + 8), dip = 0.2 + r() * 0.15, f = x => 0.92 - dip * Math.sin(Math.PI * x) ** 1.5 - 0.04 * x;
        return grid() + poly(range(41).map(i => [xs(i / 40), ys(f(i / 40))]), tint('s1', 50), 1.5) + range(7).map(i => dot(xs(i / 6), ys(f(i / 6) + normal(r) * 0.015), 's1', 3.5, true)).join('') +
          text(L + 20, H - 1, 'position of the key fact: start') + text(R, H - 1, 'end', 'end') + text(L, T + 4, 'accuracy') + baseline(B, L + 20, R);
      },
    },
    {
      cat: 'ai', name: 'Thinking longer helps', family: 'Reasoning',
      tip: 'Letting a model reason before it answers improves accuracy on hard problems, growing roughly with the log of the thinking budget before it plateaus.',
      draw(r) {
        const xs = scale(0, 5, L + 20, R), ys = scale(0, 100, B, T + 8), lo = 15 + r() * 15, hi = 70 + r() * 20, mid = 2.5 + r(), f = x => lo + (hi - lo) / (1 + Math.exp(-(x - mid) * 1.6));
        return grid(4) + poly(range(51).map(i => [xs(i / 10), ys(f(i / 10))]), 's1', 2.2) + range(6).map(i => dot(xs(i), ys(f(i) + normal(r) * 2), 's1', 3.5, true)).join('') +
          ['100', '1k', '10k', '100k', '1M', '10M'].map((l, i) => text(xs(i), H - 1, l, 'middle', 'muted', 8)).join('') + text(L, T + 4, 'accuracy %') + text(R, T + 4, 'thinking tokens →', 'end') + baseline(B, L + 20, R);
      },
    },
    {
      cat: 'ai', name: 'Benchmarks need error bars', family: 'Evaluation',
      draw(r) {
        const n = 500, models = ['model A', 'model B', 'model C', 'model D'], sc = models.map(() => 0.6 + r() * 0.25).sort((a, b) => b - a), xs = scale(0.5, 0.95, L + 50, R - 4), step = (B - T - 10) / 4;
        const e0 = 1.96 * Math.sqrt(sc[0] * (1 - sc[0]) / n), ties = sc.filter(p => sc[0] - p < 2 * e0).length - 1;
        return {
          svg: [0.5, 0.6, 0.7, 0.8, 0.9].map(v => line(xs(v), T, xs(v), B - 8, 'grid') + text(xs(v), H - 1, `${Math.round(v * 100)}%`, 'middle', 'muted', 8)).join('') +
            sc.map((p, i) => { const e = 1.96 * Math.sqrt(p * (1 - p) / n), y = T + 8 + i * step + step / 2; return text(L + 44, y + 3, models[i], 'end') + line(xs(p - e), y, xs(p + e), y, 's1', 2) + dot(xs(p), y, 's1', 4, true); }).join(''),
          tip: `On a ${n}-question benchmark each score is uncertain by about ±${(e0 * 100).toFixed(0)} points. ${ties ? `Model A isn’t clearly better than ${ties === 1 ? 'model B' : `${ties} of the others`}.` : 'Here model A’s lead is clear.'} Test on your own task before choosing.`,
        };
      },
    },
    { cat: 'ai', name: 'Next-token prediction', family: 'LLM basics', wiki: 'Large_language_model', tip: 'At its core, an LLM repeatedly predicts a plausible next token given everything before it. Following instructions, writing code and reasoning are all built on top of that one skill.' },
    { cat: 'ai', name: 'Hallucinations', family: 'Reliability', wiki: 'Hallucination_(artificial_intelligence)', tip: 'LLMs generate fluent, plausible text, not verified facts. Ground answers in retrieved sources, ask for citations, and check anything that matters before you use it.' },
    { cat: 'ai', name: 'Show, don’t tell', family: 'Prompting', wiki: 'Prompt_engineering', tip: 'Two or three examples of the input and the output you want (few-shot prompting) often work better than a page of instructions.' },
    { cat: 'ai', name: 'Context is everything', family: 'Prompting', tip: 'What the model sees decides what it can do. Give it the relevant data, the goal, constraints, the output format and examples, and leave out noise.' },
    { cat: 'ai', name: 'Evals before vibes', family: 'Evaluation', tip: 'Build a small test set of real cases with expected outputs before you tweak prompts or switch models. Otherwise you can’t tell whether a change actually helped.' },
    { cat: 'ai', name: 'LLM-as-judge', family: 'Evaluation', tip: 'A strong model can grade outputs against a rubric at scale. Check its grades against human ratings first, and watch for its bias towards long or confident answers.' },
    { cat: 'ai', name: 'Structured outputs', family: 'LLM systems', tip: 'When code consumes the answer, ask for JSON that matches a schema. Many APIs can enforce the schema directly, so parsing never fails on a stray sentence.' },
    { cat: 'ai', name: 'Tokens cost money and time', family: 'LLM basics', tip: 'Price and latency scale with tokens in and out. Prompt caching, shorter prompts and smaller models for easy subtasks cut both.' },
    { cat: 'ai', name: 'Prompt, RAG or fine-tune?', family: 'LLM systems', tip: 'Start with prompting. Add retrieval when the model needs your facts. Fine-tune only when it needs a new behaviour or style that prompting and examples can’t reach.' },
    { cat: 'ai', name: 'LLMs for analytics', family: 'Use cases', tip: 'Classify, tag and summarise free text such as reviews, support tickets and survey answers at scale, then analyse the labels like any other column. Spot-check a sample by hand.' },
    { cat: 'ai', name: 'Know where your data goes', family: 'Responsible AI', tip: 'Prompts are data leaving your system. Don’t send personal or confidential information to a model or tool your organisation hasn’t approved for it.' },

    // ---- time series -----------------------------------------------------------
    {
      cat: 'ts', name: 'Autocorrelation (ACF)', family: 'Diagnostics', wiki: 'Autocorrelation',
      draw(r) {
        const seasonal = r() < 0.5, phi = 0.4 + r() * 0.5, n = 200;
        let v = 0;
        const x = range(n).map(i => (v = phi * v + normal(r)) + (seasonal ? 2 * Math.sin(i / 12 * 2 * Math.PI) : 0));
        const m = mean(x), c0 = sum(x.map(a => (a - m) ** 2)), acf = range(25).map(k => sum(range(n - k).map(i => (x[i] - m) * (x[i + k] - m))) / c0);
        const xs = scale(0, 24, L + 10, R - 4), ys = scale(-1, 1, B, T), ci = 1.96 / Math.sqrt(n), c = a => Math.abs(a) > ci ? 's1' : 'muted';
        return {
          svg: rect(L + 4, ys(ci), R - L - 4, ys(-ci) - ys(ci), tint('s1', 18)) + line(L + 4, ys(0), R, ys(0), 'axis') + acf.map((a, k) => line(xs(k), ys(0), xs(k), ys(a), c(a), 2) + dot(xs(k), ys(a), c(a), 2.4)).join('') + text(R, H - 1, 'lag', 'end'),
          tip: seasonal ? 'Correlation of a series with its own past at each lag. The bumps every 12 lags reveal a yearly cycle in monthly data. Bars outside the band are significant.' : `Correlation of a series with its own past at each lag. The slow geometric decay is the fingerprint of an AR(1) process (φ ≈ ${phi.toFixed(1)}).`,
        };
      },
    },
    {
      cat: 'ts', name: 'Stationarity and differencing', family: 'Diagnostics', wiki: 'Stationary_process',
      tip: 'Many models assume a stationary series: constant mean and variance. A trending series (top) isn’t; taking differences, today minus yesterday (bottom), usually fixes that.',
      draw(r) {
        let v = 0;
        const drift = 0.15 + r() * 0.2, x = range(80).map(() => (v += drift + normal(r))), d = x.slice(1).map((a, i) => a - x[i]);
        const xs = scale(0, 79, L + 40, R), ph = (B - T) / 2, panel = (data, y0, c) => { const ys = scale(Math.min(...data), Math.max(...data), y0 + ph - 8, y0 + 4); return line(L + 40, y0 + ph - 4, R, y0 + ph - 4, 'grid') + poly(data.map((a, i) => [xs(i + 80 - data.length), ys(a)]), c, 1.5); };
        return panel(x, T, 'text') + panel(d, T + ph, 's1') + text(L, T + ph / 2, 'raw') + text(L, T + ph * 1.5, 'diff');
      },
    },
    {
      cat: 'ts', name: 'Moving averages', family: 'Smoothing', wiki: 'Moving_average',
      tip: 'Averaging over a sliding window smooths out noise to reveal the trend. A 7-day window removes the weekly pattern; a 28-day window shows the slower movement, but reacts later.',
      draw(r) {
        const n = 120, ph = r() * 6, x = range(n).map(i => 10 + 2 * Math.sin(i / 25 + ph) + (i % 7 >= 5 ? -1.5 : 0.5) + normal(r) * 0.8);
        const ma = w => x.map((_, i) => i < w - 1 ? null : mean(x.slice(i - w + 1, i + 1)));
        const xs = scale(0, n - 1, L, R), ys = scale(Math.min(...x), Math.max(...x), B, T + 12), ln = a => a.map((v, i) => v == null ? null : [xs(i), ys(v)]).filter(Boolean);
        return grid() + poly(ln(x), tint('muted', 50), 1) + poly(ln(ma(7)), 's1', 2) + poly(ln(ma(28)), 's2', 2.2) + hlegend([[tint('muted', 50), 'daily'], ['s1', '7-day'], ['s2', '28-day']], L, T + 2, 58) + baseline();
      },
    },
    {
      cat: 'ts', name: 'Exponential smoothing', family: 'Smoothing', wiki: 'Exponential_smoothing',
      tip: 'Each smoothed value is a weighted mix of today’s observation and yesterday’s smoothed value. A small α is smooth but slow; a large α follows every wiggle.',
      draw(r) {
        const n = 90, shift = 30 + Math.floor(r() * 30), x = range(n).map(i => 10 + (i >= shift ? 3 : 0) + normal(r));
        const ses = a => { let s0 = x[0]; return x.map(v => (s0 = a * v + (1 - a) * s0)); };
        const xs = scale(0, n - 1, L, R), ys = scale(Math.min(...x), Math.max(...x), B, T + 12), ln = a => a.map((v, i) => [xs(i), ys(v)]);
        return grid() + x.map((v, i) => dot(xs(i), ys(v), tint('muted', 55), 1.6)).join('') + poly(ln(ses(0.1)), 's2', 2.2) + poly(ln(ses(0.5)), 's1', 1.8) + hlegend([['s2', 'α = 0.1'], ['s1', 'α = 0.5']], L, T + 2, 58) + baseline();
      },
    },
    {
      cat: 'ts', name: 'Backtesting', family: 'Evaluation', wiki: 'Backtesting',
      tip: 'Evaluate a forecast the way it will be used: train on the past, test on the next period, then roll forward and repeat. Never shuffle time series into random folds.',
      draw() {
        const k = 5, x0 = L + 34, step = (B - T - 14) / k, unit = (R - x0) / 10;
        let s = hlegend([[tint('s1', 45), 'train'], ['s2', 'test'], ['grid', 'unused']], x0, T + 2, 54);
        range(k).forEach(f => {
          const y = T + 12 + f * step, tr = 4 + f;
          s += text(L, y + step / 2 + 2, `fold ${f + 1}`, 'start', 'muted', 8) + rect(x0, y + 2, unit * tr - 2, step - 6, tint('s1', 45), 2) + rect(x0 + unit * tr, y + 2, unit - 2, step - 6, 's2', 2) +
            (tr + 1 < 10 ? rect(x0 + unit * (tr + 1), y + 2, unit * (9 - tr) - 2, step - 6, 'grid', 2) : '');
        });
        return s + text(R, H - 1, 'time →', 'end');
      },
    },
    {
      cat: 'ts', name: 'Beat the naive baseline', family: 'Evaluation', wiki: 'Forecasting',
      draw(r) {
        const season = 12, n = 48, amp = 2 + r() * 2, trend = 0.03 + r() * 0.08;
        const y = range(n + season).map(i => 10 + trend * i + amp * Math.sin(i / season * 2 * Math.PI) + normal(r) * 0.6);
        const naive = range(season).map(h => y[n - season + h]), flat = mean(y.slice(n - season, n)), actual = y.slice(n);
        const mae = f => mean(actual.map((a, i) => Math.abs(a - f(i))));
        const m1 = mae(i => naive[i]), m0 = mae(() => flat), xs = scale(0, n + season - 1, L, R), ys = scale(Math.min(...y) - 0.5, Math.max(...y) + 0.5, B, T + 12);
        return {
          svg: grid() + line(xs(n - 0.5), T + 12, xs(n - 0.5), B, 'muted', 1, '3 3') + poly(y.map((v, i) => [xs(i), ys(v)]), 'text', 1.5) +
            poly(naive.map((v, i) => [xs(n + i), ys(v)]), 's1', 2, '4 3') + line(xs(n), ys(flat), xs(n + season - 1), ys(flat), 's2', 2, '4 3') +
            hlegend([['text', 'actual'], ['s1', 'seasonal naive'], ['s2', 'mean']], L, T + 2, 76) + baseline(),
          tip: `Copying last year’s values (seasonal naive) gives a mean absolute error of ${m1.toFixed(2)}, versus ${m0.toFixed(2)} for a flat average. Any fancy model must beat these baselines to earn its keep.`,
        };
      },
    },
    {
      cat: 'ts', name: 'Lag plot', family: 'Diagnostics',
      draw(r) {
        const phi = (r() < 0.25 ? -1 : 1) * (0.3 + r() * 0.6);
        let v = 0;
        const x = range(200).map(() => (v = phi * v + normal(r))), f = ols(x.slice(0, -1), x.slice(1)), lim = Math.max(...x.map(Math.abs)) * 1.05;
        const xs = scale(-lim, lim, L + 50, R - 50), ys = scale(-lim, lim, B, T);
        return {
          svg: frameRect(L + 50, T, R - L - 100, B - T) + x.slice(1).map((a, i) => dot(xs(x[i]), ys(a), tint('s1', 70), 1.8)).join('') + line(xs(-lim), ys(f.a - f.b * lim), xs(lim), ys(f.a + f.b * lim), 'text', 1.5) +
            text(L + 50, H - 1, 'value yesterday') + text(L + 46, T + 8, 'today', 'end'),
          tip: `Each point plots a value against the one before it. The slope reveals memory in the series (r = ${f.r.toFixed(2)}); a shapeless cloud would mean yesterday tells you nothing about today.`,
        };
      },
    },
    {
      cat: 'ts', name: 'Periodogram', family: 'Seasonality', wiki: 'Periodogram',
      tip: 'A Fourier transform shows how much of the variation repeats at each period. Peaks reveal cycles you may not have known about, here weekly and monthly.',
      draw(r) {
        const n = 360, a7 = 1 + r(), a30 = 0.6 + r() * 1.2, x = range(n).map(i => a7 * Math.sin(2 * Math.PI * i / 7) + a30 * Math.sin(2 * Math.PI * i / 30 + 1) + normal(r) * 1.2);
        const pw = range(n / 2 - 1).map(i => { const k = i + 1; let re = 0, im = 0; x.forEach((v, t) => { re += v * Math.cos(2 * Math.PI * k * t / n); im -= v * Math.sin(2 * Math.PI * k * t / n); }); return [n / k, (re * re + im * im) / n]; }).filter(([p]) => p >= 2 && p <= 90);
        const xs = scale(Math.log(2), Math.log(90), L, R), ys = scale(0, Math.max(...pw.map(p => p[1])) * 1.15, B, T), pk = per => pw.reduce((b, p) => Math.abs(p[0] - per) < Math.abs(b[0] - per) ? p : b);
        return grid() + pw.map(([p, v]) => line(xs(Math.log(p)), B, xs(Math.log(p)), ys(v), 's1', 1.5)).join('') + [[7, 'weekly'], [30, 'monthly']].map(([p, l]) => { const [pp, v] = pk(p); return text(xs(Math.log(pp)), ys(v) - 4, l, 'middle', 'text', 8.5, 600); }).join('') +
          baseline() + [2, 7, 14, 30, 90].map(p => text(xs(Math.log(p)), H - 1, p, 'middle', 'muted', 8)).join('') + text(R, T + 4, 'period (days)', 'end');
      },
    },
    {
      cat: 'ts', name: 'Changepoint detection', family: 'Anomalies', wiki: 'Change_detection',
      draw(r) {
        const n = 120, cps = [25 + Math.floor(r() * 20), 70 + Math.floor(r() * 25)], levels = [0, 2 + r() * 2, 0.5 + r() * 2];
        const x = range(n).map(i => levels[i < cps[0] ? 0 : i < cps[1] ? 1 : 2] + normal(r) * 0.7);
        // Binary segmentation: split where the two halves' means differ most, twice.
        const cost = (a, b) => { const seg = x.slice(a, b), m = mean(seg); return sum(seg.map(v => (v - m) ** 2)); };
        let segs = [[0, n]], found = [];
        for (let k = 0; k < 2; k++) {
          let best = null;
          segs.forEach(([a, b]) => { for (let t = a + 5; t < b - 5; t++) { const gain = cost(a, b) - cost(a, t) - cost(t, b); if (!best || gain > best.gain) best = { a, b, t, gain }; } });
          found.push(best.t);
          segs = segs.flatMap(([a, b]) => a === best.a ? [[a, best.t], [best.t, b]] : [[a, b]]);
        }
        found.sort((a, b) => a - b);
        const xs = scale(0, n - 1, L, R), ys = scale(Math.min(...x) - 0.5, Math.max(...x) + 0.5, B, T), bounds = [0, ...found, n];
        return {
          svg: grid() + x.map((v, i) => dot(xs(i), ys(v), tint('s1', 55), 1.7)).join('') + found.map(t => line(xs(t - 0.5), T, xs(t - 0.5), B, 'text', 1, '3 3')).join('') +
            bounds.slice(1).map((b, i) => { const a = bounds[i], m = mean(x.slice(a, b)); return line(xs(a), ys(m), xs(b - 1), ys(m), 's2', 2.5); }).join('') + baseline(),
          tip: `Finds the moments a series’ behaviour shifts, such as a pricing change, an outage or a new logging version. Here the algorithm found shifts at t = ${found.join(' and t = ')}; the true ones were ${cps.join(' and ')}.`,
        };
      },
    },
    {
      cat: 'ts', name: 'Weekday profile', family: 'Seasonality',
      tip: 'Splitting by day of week exposes weekly seasonality and how stable it is. Each dot is one week; the bar is the average. Model it explicitly, or compare like with like.',
      draw(r) {
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], eff = [1, 1.05, 1.08, 1.04, 0.95, 0.6 + r() * 0.2, 0.5 + r() * 0.2], base = 100;
        const data = days.map((_, d) => range(12).map(() => base * eff[d] * (1 + normal(r) * 0.07))), all = data.flat(), ys = scale(0, Math.max(...all) * 1.05, B, T), w = (R - L) / 7;
        return grid() + data.map((vals, d) => { const cx = L + w * (d + 0.5), m = mean(vals); return line(cx - w * 0.32, ys(m), cx + w * 0.32, ys(m), 'text', 2.5) + vals.map(v => dot(cx + (r() - 0.5) * w * 0.4, ys(v), d >= 5 ? 's2' : 's1', 2, true)).join('') + text(cx, H - 1, days[d], 'middle'); }).join('') + baseline();
      },
    },
    {
      cat: 'ts', name: 'Forecast error metrics', family: 'Evaluation', wiki: 'Forecast_error',
      draw(r) {
        const n = 20, actual = range(n).map(i => 50 + 10 * Math.sin(i / 3) + normal(r) * 4), fc = actual.map((a, i) => 50 + 10 * Math.sin(i / 3 + 0.2) + normal(r) * 1);
        const err = actual.map((a, i) => a - fc[i]), mae = mean(err.map(Math.abs)), rmse = Math.sqrt(mean(err.map(e => e * e))), mape = mean(err.map((e, i) => Math.abs(e / actual[i]))) * 100;
        const xs = scale(0, n - 1, L + 4, R - 4), ys = scale(Math.min(...actual, ...fc) - 3, Math.max(...actual, ...fc) + 3, B, T + 12);
        return {
          svg: grid() + err.map((e, i) => line(xs(i), ys(actual[i]), xs(i), ys(fc[i]), 'neg', 1.5)).join('') + poly(fc.map((v, i) => [xs(i), ys(v)]), 's1', 2) + actual.map((v, i) => dot(xs(i), ys(v), 'text', 2.5)).join('') +
            hlegend([['text', 'actual'], ['s1', 'forecast'], ['neg', 'error']], L, T + 2, 58) + baseline(),
          tip: `MAE ${mae.toFixed(1)} (average miss, in units), RMSE ${rmse.toFixed(1)} (punishes big misses), MAPE ${mape.toFixed(1)}% (relative, but explodes near zero). Choose the one that matches the business cost.`,
        };
      },
    },

    // ---- graph analytics --------------------------------------------------------
    {
      cat: 'graph', name: 'Degree distribution', family: 'Network structure', wiki: 'Scale-free_network',
      tip: 'In many real networks a few hubs have most of the links. The degree distribution then follows a power law: a roughly straight line on log–log axes.',
      draw(r) {
        const n = 500, ends = [0, 1, 1, 2, 2, 0], deg = range(n).fill(0);
        deg[0] = deg[1] = deg[2] = 2;
        for (let v = 3; v < n; v++) { // preferential attachment: link to 2 nodes, proportional to degree
          const picks = new Set();
          while (picks.size < 2) picks.add(ends[Math.floor(r() * ends.length)]);
          picks.forEach(u => { ends.push(u, v); deg[u]++; deg[v]++; });
        }
        const freq = new Map();
        deg.forEach(d => freq.set(d, (freq.get(d) || 0) + 1));
        const pts2 = [...freq].map(([d, c]) => [Math.log10(d), Math.log10(c / n)]), xs = scale(Math.log10(2), Math.log10(Math.max(...deg)) + 0.1, L + 24, R), ys = scale(Math.min(...pts2.map(p => p[1])) - 0.2, 0, B, T);
        return grid() + pts2.map(([d, c]) => dot(xs(d), ys(c), 's1', 2.8, true)).join('') + [2, 10, 100].filter(v => Math.log10(v) <= Math.log10(Math.max(...deg)) + 0.1).map(v => text(xs(Math.log10(v)), H - 1, v, 'middle', 'muted', 8)).join('') +
          text(R, T + 6, `max degree ${Math.max(...deg)}`, 'end', 'text', 8.5, 600) + text(L, T + 6, 'share') + baseline(B, L + 24, R) + text(L + 30, H - 1, 'links', 'start', 'muted', 8);
      },
    },
    {
      cat: 'graph', name: 'Betweenness centrality', family: 'Centrality', wiki: 'Betweenness_centrality',
      tip: 'Betweenness counts how many shortest paths run through a node. The bridge between two groups scores highest even with few links: a broker, a bottleneck or a single point of failure.',
      draw(r) {
        const n = 17, edges = [];
        range(16).forEach(i => range(i).forEach(j => { if (Math.floor(i / 8) === Math.floor(j / 8) && r() < 0.42) edges.push([i, j]); }));
        edges.push([16, Math.floor(r() * 8)], [16, Math.floor(r() * 8)], [16, 8 + Math.floor(r() * 8)], [16, 8 + Math.floor(r() * 8)]);
        const uniq = [...new Map(edges.filter(([a, b]) => a !== b).map(e => [`${Math.min(...e)}-${Math.max(...e)}`, e])).values()];
        const bc = betweenness(adjacency(n, uniq)), mx = Math.max(...bc), pos = layoutGraph(n, uniq, r);
        return uniq.map(([a, b]) => line(...pos[a], ...pos[b], 'axis', 1)).join('') + range(n).map(i => dot(...pos[i], bc[i] === mx ? 's2' : tint('s1', 70), 2.5 + Math.sqrt(bc[i] / mx) * 7, true)).join('');
      },
    },
    {
      cat: 'graph', name: 'PageRank', family: 'Centrality', wiki: 'PageRank',
      tip: 'A node is important if important nodes link to it. Built to rank web pages, PageRank also finds influential accounts, key suppliers or critical systems. Size and label show each score.',
      draw(r) {
        const n = 8, edges = [];
        range(n).forEach(i => range(n).forEach(j => { if (i !== j && r() < (j === 0 ? 0.6 : 0.18)) edges.push([i, j]); }));
        range(n).forEach(i => { if (!edges.some(e => e[0] === i)) edges.push([i, (i + 1) % n]); });
        const out = range(n).map(i => edges.filter(e => e[0] === i).map(e => e[1]));
        let pr = range(n).fill(1 / n);
        for (let it = 0; it < 50; it++) { const nx = range(n).fill(0.15 / n); out.forEach((o, i) => o.forEach(j => { nx[j] += 0.85 * pr[i] / o.length; })); pr = nx; }
        const pos = range(n).map(i => polar(W / 2, H / 2 + 2, 56, i / n * 2 * Math.PI)), rad = pr.map(p => 5 + Math.sqrt(p) * 22), mx = Math.max(...pr);
        return edges.map(([a, b]) => arrow(...pos[a], ...pos[b], rad[a], rad[b], 'axis', 1)).join('') +
          range(n).map(i => dot(...pos[i], pr[i] === mx ? 's2' : tint('s1', 75), rad[i], true) + text(pos[i][0], pos[i][1] + 3, (pr[i] * 100).toFixed(0), 'middle', pr[i] === mx || rad[i] > 11 ? '#fff' : 'text', 8, 700)).join('');
      },
    },
    {
      cat: 'graph', name: 'Shortest path', family: 'Paths', wiki: 'Shortest_path_problem',
      draw(r) {
        const nx = 13, ny = 6, id = (i, j) => j * nx + i, blocked = new Set(range(nx * ny).filter(k => r() < 0.22 && k % nx > 0 && k % nx < nx - 1)), edges = [];
        range(ny).forEach(j => range(nx).forEach(i => { if (blocked.has(id(i, j))) return; if (i + 1 < nx && !blocked.has(id(i + 1, j))) edges.push([id(i, j), id(i + 1, j)]); if (j + 1 < ny && !blocked.has(id(i, j + 1))) edges.push([id(i, j), id(i, j + 1)]); }));
        const adj = adjacency(nx * ny, edges), s0 = id(0, Math.floor(r() * ny)), t0 = id(nx - 1, Math.floor(r() * ny)), d = bfs(adj, s0), xy = k => [L + 10 + (k % nx) * (R - L - 20) / (nx - 1), T + 8 + Math.floor(k / nx) * (B - T - 16) / (ny - 1)];
        const path = [];
        if (d[t0] >= 0) { let k = t0; while (k !== s0) { path.push(k); k = adj[k].find(w => d[w] === d[k] - 1); } path.push(s0); }
        return {
          svg: edges.map(([a, b]) => line(...xy(a), ...xy(b), 'grid', 1.2)).join('') + range(nx * ny).map(k => blocked.has(k) ? '' : dot(...xy(k), 'axis', 2)).join('') +
            (path.length ? poly(path.map(xy), 's1', 3) : '') + dot(...xy(s0), 's2', 5, true) + dot(...xy(t0), 's3', 5, true),
          tip: path.length ? `Breadth-first search finds the fewest hops between two nodes, here ${d[t0]}. Dijkstra’s algorithm adds weights such as distance or cost. Used in routing, logistics and “degrees of separation”.` : 'Breadth-first search finds the fewest hops between two nodes, or proves there is no path at all, as here. Dijkstra’s algorithm adds weights such as distance or cost.',
        };
      },
    },
    {
      cat: 'graph', name: 'Adjacency matrix', family: 'Network structure', wiki: 'Adjacency_matrix',
      tip: 'The same network as a matrix, where a filled cell means two nodes are linked. In random order it looks like noise; sorted by community, dense blocks appear on the diagonal.',
      draw(r) {
        const n = 24, comm = range(n).map(i => i % 3), A = range(n).map(() => range(n).fill(0));
        range(n).forEach(i => range(i).forEach(j => { if (r() < (comm[i] === comm[j] ? 0.45 : 0.05)) A[i][j] = A[j][i] = 1; }));
        const shuffled = shuffle(range(n), r), sortedOrd = range(n).sort((a, b) => comm[a] - comm[b] || a - b), cell = 4.6;
        const draw = (ord, x0, label) => frameRect(x0 - 1, T + 9, n * cell + 2, n * cell + 2) + ord.map((a, i) => ord.map((b, j) => A[a][b] ? rect(x0 + j * cell, T + 10 + i * cell, cell - 0.6, cell - 0.6, SER[comm[a]] && comm[a] === comm[b] && label === 'sorted' ? SER[comm[a]] : 's1', 0.5) : '').join('')).join('') + text(x0 + n * cell / 2, H - 1, label, 'middle');
        return draw(shuffled, L + 4, 'random order') + draw(sortedOrd, R - n * cell - 4, 'sorted');
      },
    },
    {
      cat: 'graph', name: 'Six degrees of separation', family: 'Paths', wiki: 'Small-world_network',
      draw(r) {
        const n = 300, k = 4, edges = [];
        range(n).forEach(i => range(k / 2).forEach(o0 => { const o = o0 + 1; const j = r() < 0.1 ? Math.floor(r() * n) : (i + o) % n; if (j !== i) edges.push([i, j]); }));
        const adj = adjacency(n, edges), counts = new Map();
        range(30).forEach(() => bfs(adj, Math.floor(r() * n)).forEach(d => { if (d > 0) counts.set(d, (counts.get(d) || 0) + 1); }));
        const ds = [...counts.keys()].sort((a, b) => a - b), tot = sum([...counts.values()]), avg = sum(ds.map(d => d * counts.get(d))) / tot;
        const bw = (R - L) / (ds[ds.length - 1] + 1), ys = scale(0, Math.max(...counts.values()) / tot * 1.15, B, T);
        return {
          svg: grid() + ds.map(d => bar(L + d * bw + 2, ys(counts.get(d) / tot), bw - 4, B, tint('s1', 70)) + text(L + (d + 0.5) * bw, H - 1, d, 'middle', 'muted', 8)).join('') + baseline() + text(R, T + 6, `average ${avg.toFixed(1)} hops`, 'end', 'text', 9, 600),
          tip: `In a 300-person network where people mostly know their neighbours, a few random long-range links shrink the average distance to ${avg.toFixed(1)} hops. That’s the small-world effect.`,
        };
      },
    },
    {
      cat: 'graph', name: 'Recommendations from a bipartite graph', family: 'Applications', wiki: 'Bipartite_graph',
      tip: 'Customers on the left, products on the right. To recommend for Ada (orange), find customers who bought the same things and suggest what they bought that she hasn’t (green).',
      draw(r) {
        const users = ['Ada', 'Ben', 'Cy', 'Dag', 'Eva'], items = ['coffee', 'tea', 'mug', 'beans', 'grinder', 'kettle'], buys = users.map(() => items.map(() => r() < 0.38));
        buys[0] = items.map((_, j) => j < 2); buys[1][0] = buys[1][3] = true; buys[2][1] = buys[2][3] = true; buys[1][1] = false;
        const ux = L + 40, ix = R - 48, uy = i => T + 8 + i * (B - T - 16) / 4, iy = j => T + 6 + j * (B - T - 12) / 5;
        const peers = users.map((_, i) => i > 0 && items.some((_, j) => buys[0][j] && buys[i][j]));
        const recs = items.map((_, j) => !buys[0][j] && users.some((_, i) => peers[i] && buys[i][j]));
        let s = '';
        users.forEach((_, i) => items.forEach((_, j) => { if (buys[i][j]) s += line(ux, uy(i), ix, iy(j), i === 0 ? 's2' : peers[i] && recs[j] ? 's3' : 'grid', i === 0 || (peers[i] && recs[j]) ? 1.8 : 1); }));
        return s + users.map((u, i) => dot(ux, uy(i), i === 0 ? 's2' : peers[i] ? 's1' : 'axis', 4.5, true) + text(ux - 8, uy(i) + 3, u, 'end')).join('') + items.map((it, j) => dot(ix, iy(j), recs[j] ? 's3' : 'axis', 4.5, true) + text(ix + 8, iy(j) + 3, it, 'start', recs[j] ? 'text' : 'muted', 8.5, recs[j] ? 700 : 400)).join('');
      },
    },
    {
      cat: 'graph', name: 'Knowledge graph', family: 'Applications', wiki: 'Knowledge_graph',
      tip: 'Facts stored as entities and typed relationships. You can answer multi-hop questions (“which data scientists work for companies in Norway?”) and give LLMs grounded context (GraphRAG).',
      draw() {
        return dag({ ada: [52, T + 22, 'Ada', 's2'], acme: [180, T + 22, 'Acme AS', 's1'], role: [52, B - 20, 'data scientist', 's3'], oslo: [180, 78, 'Oslo'], no: [180, B - 14, 'Norway'] },
          [['ada', 'acme', false, 'works at'], ['ada', 'role', false, 'has role'], ['acme', 'oslo', false, 'located in'], ['oslo', 'no', false, 'in'], ['ada', 'oslo', true, 'lives in']]);
      },
    },

    // ---- EDA (in Charts & EDA) ------------------------------------------------
    {
      tool: 'EDA', name: 'Missing values matrix', family: 'Data quality', wiki: 'Missing_data',
      tip: 'Each column is a variable, each thin row a record, and gaps are missing values. Gaps that line up across columns mean the values go missing together, usually for one shared reason.',
      draw(r) {
        const colsN = ['id', 'age', 'income', 'email', 'phone', 'city', 'signup', 'churn'], n = 90, rate = [0, 0.05, 0.3, 0.12, 0.45, 0.08, 0, 0.02].map(v => v * (0.6 + r() * 0.8));
        const block = Math.floor(r() * 50), cw = (R - L - 8) / colsN.length, rh = (B - T - 20) / n;
        let s = '';
        colsN.forEach((c, j) => {
          const x = L + 4 + j * cw, miss = range(n).map(i => r() < rate[j] || ((j === 2 || j === 4) && i >= block && i < block + 25));
          s += rect(x + 1, T + 10, cw - 2, n * rh, tint('s1', 60), 1);
          let i = 0;
          while (i < n) { if (!miss[i]) { i++; continue; } let k = i; while (k < n && miss[k]) k++; s += rect(x + 1, T + 10 + i * rh, cw - 2, (k - i) * rh, 'card'); i = k; }
          s += text(x + cw / 2, T + 6, c, 'middle', 'muted', 7.5) + text(x + cw / 2, H - 1, `${Math.round(miss.filter(Boolean).length / n * 100)}%`, 'middle', 'text', 8, 600);
        });
        return s;
      },
    },
    {
      tool: 'EDA', name: 'Profile every column', family: 'Data quality',
      tip: 'Before any analysis, get one line per column: type, missing share, distinct values and an example. It catches wrong types, constant columns and surprise nulls in seconds.',
      draw(r) {
        const rows = [['customer_id', 'int', 0, '48 210', '10042'], ['signup_date', 'string', 0, '1 412', '2026-03-01'], ['country', 'string', 0.2 + r() * 2, '14', 'NO'], ['age', 'float', 3 + r() * 6, '71', '34.0'], ['plan', 'string', 0, '1', 'basic'], ['revenue', 'float', 10 + r() * 20, '9 380', '129.5']];
        const xc = [L, L + 72, L + 112, L + 156, L + 196], y0 = T + 8, step = 19;
        let s = ['column', 'type', 'missing', 'distinct', 'example'].map((h, i) => text(xc[i], y0, h, 'start', 'muted', 8, 600)).join('') + line(L, y0 + 5, R, y0 + 5, 'axis');
        rows.forEach((row, k) => {
          const y = y0 + 18 + k * step, flags = [false, row[0] === 'signup_date', row[2] > 5, row[3] === '1', false];
          row.forEach((v, i) => { s += text(xc[i], y, i === 2 ? `${v.toFixed(1)}%` : v, 'start', flags[i] ? 'neg' : 'text', 8.5, flags[i] ? 700 : 400); });
          s += line(L, y + 6, R, y + 6, 'grid');
        });
        return s;
      },
    },
    {
      tool: 'EDA', name: 'Suspicious values', family: 'Data quality',
      tip: 'Spikes at round or impossible values (an age of 0 or 99, a date of 1900-01-01, 9999) usually mean defaults or placeholders, not real data. Find out what they mean before you average them.',
      draw(r) {
        const ages = range(800).map(() => Math.round(Math.max(16, Math.min(90, 40 + normal(r) * 13))));
        range(40 + Math.floor(r() * 40)).forEach(() => ages.push(0));
        range(20 + Math.floor(r() * 30)).forEach(() => ages.push(99));
        const counts = range(100).fill(0);
        ages.forEach(a => counts[a]++);
        const xs = scale(0, 100, L, R), ys = scale(0, Math.max(...counts) * 1.1, B, T + 8), bw = (R - L) / 100;
        return grid() + counts.map((c, i) => c ? bar(L + i * bw + 0.2, ys(c), bw - 0.4, B, i === 0 || i === 99 ? 'neg' : tint('s1', 60)) : '').join('') +
          text(xs(0) + 6, ys(counts[0]) + 4, '0 = unknown?', 'start', 'text', 8, 600) + text(xs(99) - 4, ys(counts[99]) - 4, '99 = default?', 'end', 'text', 8, 600) + baseline() + text(R, H - 1, 'age', 'end');
      },
    },
    {
      tool: 'EDA', name: 'Cardinality check', family: 'Data quality',
      tip: 'Count distinct values per column (log scale). A single value is a useless constant; as many values as rows means an ID, not a feature. Both should be dropped before modelling.',
      draw(r) {
        const n = 50000, colsN = [['user_id', n], ['email', n - Math.floor(r() * 50)], ['zip', 4000 + Math.floor(r() * 2000)], ['city', 300 + Math.floor(r() * 200)], ['plan', 4], ['country', 1], ['churn', 2]];
        const xs = scale(0, Math.log10(n) * 1.05, L + 44, R - 4), step = (B - T - 4) / colsN.length;
        return colsN.map(([c, k], i) => { const y = T + i * step, flag = k === 1 ? 'neg' : k >= n * 0.99 ? 's2' : 's1'; return text(L + 40, y + step / 2 + 3, c, 'end') + rect(xs(0), y + 3, Math.max(2, xs(Math.log10(k)) - xs(0)), step - 6, flag, 2) + text(Math.max(xs(Math.log10(k)), xs(0) + 2) + 4, y + step / 2 + 3, k === 1 ? 'constant' : k >= n * 0.99 ? 'ID-like' : k.toLocaleString('en-US'), 'start', flag === 's1' ? 'muted' : 'text', 8, flag === 's1' ? 400 : 700); }).join('');
      },
    },
    {
      tool: 'EDA', name: 'Log transform', family: 'Distributions', wiki: 'Data_transformation_(statistics)',
      tip: 'Revenue, prices and counts are often heavily right-skewed: most values are small and a few are huge. On a log scale the shape becomes readable, and many models behave better.',
      draw(r) {
        const data = range(600).map(() => Math.exp(normal(r) * (0.9 + r() * 0.2) + 3)), hist = (vals, x0, x1, c, label) => {
          const lo = Math.min(...vals), hi = quantile(sorted(vals), 0.995), nb = 24, counts = range(nb).fill(0);
          vals.forEach(v => { const b = Math.floor((v - lo) / (hi - lo) * nb); if (b >= 0 && b < nb) counts[b]++; });
          const w = (x1 - x0) / nb, ys = scale(0, Math.max(...counts) * 1.1, B, T + 14);
          return counts.map((k, i) => bar(x0 + i * w + 0.4, ys(k), w - 0.8, B, c)).join('') + baseline(B, x0, x1) + text(x0, T + 4, label);
        };
        return hist(data, L, 122, tint('s2', 70), 'revenue') + hist(data.map(Math.log), 138, R, tint('s1', 70), 'log(revenue)');
      },
    },
    {
      tool: 'EDA', name: 'Target rate by segment', family: 'Relationships',
      draw(r) {
        const bands = ['18–24', '25–34', '35–44', '45–54', '55–64', '65+'], ns = bands.map((_, i) => [400, 900, 800, 600, 300, 60][i] + Math.floor(r() * 100)), base = 0.05 + r() * 0.05, shape = [1.6, 1.3, 1, 0.8, 0.7, 0.9];
        const rates = ns.map((n, i) => Math.max(0.005, base * shape[i] + normal(r) * Math.sqrt(base * shape[i] * (1 - base * shape[i]) / n))), ys = scale(0, Math.max(...rates) * 1.6, B, T + 10), w = (R - L) / bands.length;
        return {
          svg: grid() + rates.map((p, i) => { const e = 1.96 * Math.sqrt(p * (1 - p) / ns[i]), cx = L + w * (i + 0.5); return bar(cx - w * 0.3, ys(p), w * 0.6, B, tint('s1', 60)) + line(cx, ys(Math.max(0, p - e)), cx, ys(p + e), 'text', 1.5) + text(cx, H - 1, bands[i], 'middle', 'muted', 8) + text(cx, ys(p + e) - 4, `n=${ns[i]}`, 'middle', 'muted', 7); }).join('') + baseline() + text(L, T + 4, 'churn rate'),
          tip: 'Plot the outcome rate per segment with error bars and sample sizes. The 65+ group looks different, but with so few customers its interval is wide; don’t read too much into small bins.',
        };
      },
    },
    {
      tool: 'EDA', name: 'Check time coverage', family: 'Data quality',
      tip: 'Plot row counts per day before anything else. Gaps, sudden drops and step changes usually come from pipelines and logging changes, not from customers, and they quietly break your analysis.',
      draw(r) {
        const n = 120, gap = 30 + Math.floor(r() * 30), drop = gap + 25 + Math.floor(r() * 30), x = range(n).map(i => (i >= gap && i < gap + 5) ? 0 : (1000 + i * 3) * (i >= drop ? 0.62 : 1) * (i % 7 >= 5 ? 0.75 : 1) * (1 + normal(r) * 0.04));
        const xs = scale(0, n - 1, L, R), ys = scale(0, Math.max(...x) * 1.2, B, T);
        return grid() + poly(x.map((v, i) => [xs(i), ys(v)]), 's1', 1.5) + rect(xs(gap - 0.5), T + 4, xs(gap + 4.5) - xs(gap - 0.5), B - T - 4, tint('neg', 25)) + text(xs(gap + 2), T + 2, 'no data', 'middle', 'text', 8, 600) +
          line(xs(drop - 0.5), T + 16, xs(drop - 0.5), B, 'text', 1, '3 3') + text(xs(drop) + 4, T + 22, 'logging change?', 'start', 'text', 8, 600) + baseline() + text(L, T - 2, 'rows per day');
      },
    },
    {
      tool: 'EDA', name: 'The long tail of categories', family: 'Distributions', wiki: 'Long_tail',
      draw(r) {
        const k = 60, raw = range(k).map(i => Math.exp(-i * (0.12 + r() * 0.1)) * (0.8 + r() * 0.4)).sort((a, b) => b - a), tot = sum(raw), top = 7;
        const shares = [...raw.slice(0, top).map(v => v / tot), sum(raw.slice(top)) / tot], labels = [...range(top).map(i => `cat ${String.fromCharCode(65 + i)}`), `other ${k - top}`];
        const xs = scale(0, Math.max(...shares) * 1.15, L + 44, R), step = (B - T + 4) / shares.length;
        return {
          svg: shares.map((p, i) => { const y = T - 2 + i * step; return text(L + 40, y + step / 2 + 3, labels[i], 'end', i === top ? 'text' : 'muted', 8, i === top ? 700 : 400) + rect(xs(0), y + 2, xs(p) - xs(0), step - 4, i === top ? 's2' : 's1', 2) + text(xs(p) + 4, y + step / 2 + 3, `${(p * 100).toFixed(0)}%`, 'start', 'muted', 8); }).join(''),
          tip: `The top ${top} of ${k} categories cover ${(sum(shares.slice(0, top)) * 100).toFixed(0)}% of rows. Group the rest into “other” for charts and for one-hot encoding, and decide deliberately what to do with rare values.`,
        };
      },
    },

    // ---- engineering & MLOps -------------------------------------------------
    {
      cat: 'eng', tool: 'MLOps', name: 'The ML lifecycle', family: 'Lifecycle', wiki: 'MLOps',
      tip: 'A model is never “done”. Data feeds training, the best model is evaluated and deployed, monitoring catches drift, and that triggers retraining. MLOps automates this loop.',
      draw() {
        const names = ['data', 'train', 'evaluate', 'deploy', 'monitor', 'retrain'], cs = ['s3', 's1', 's1', 's2', 's2', 's3'], nodes = {};
        names.forEach((nm, i) => { const a = i / 6 * 2 * Math.PI; nodes[nm] = [W / 2 + Math.sin(a) * 95, H / 2 + 2 - Math.cos(a) * 52, nm, cs[i]]; });
        return dag(nodes, names.map((nm, i) => [nm, names[(i + 1) % 6]]));
      },
    },
    {
      cat: 'eng', tool: 'MLOps', name: 'Data drift', family: 'Monitoring', wiki: 'Concept_drift',
      draw(r) {
        const shift = r() * 1.2, spread = 1 + r() * 0.4, tr = range(800).map(() => normal(r)), pr = range(800).map(() => normal(r) * spread + shift);
        const edges = range(11).map(i => quantile(sorted(tr), i / 10)), bin = v => { let i = 0; while (i < 9 && v >= edges[i + 1]) i++; return i; };
        const share = d => { const c = range(10).fill(0); d.forEach(v => c[bin(v)]++); return c.map(k => Math.max(k / d.length, 1e-4)); }, a = share(tr), b = share(pr);
        const psi = sum(a.map((p, i) => (b[i] - p) * Math.log(b[i] / p))), g = range(101).map(i => -4 + i * 0.09), d1 = kde(tr, 0.3), d2 = kde(pr, 0.3);
        const xs = scale(-4, 5, L, R), ys = scale(0, Math.max(...g.map(d1), ...g.map(d2)) * 1.15, B, T + 10), curve = d => [[xs(-4), B], ...g.map(x => [xs(x), ys(d(x))]), [xs(5), B]];
        const verdict = psi < 0.1 ? 'stable' : psi < 0.25 ? 'moderate drift: investigate' : 'major drift: retrain or fix the pipeline';
        return {
          svg: area(curve(d1), tint('s1', 35), 's1', 1.5) + area(curve(d2), tint('s2', 35), 's2', 1.5) + hlegend([['s1', 'training'], ['s2', 'production']], L, T + 2, 66) + text(R, T + 4, `PSI ${psi.toFixed(2)}`, 'end', 'text', 10, 700) + baseline(),
          tip: `Compare each feature’s live distribution with what the model was trained on. The Population Stability Index here is ${psi.toFixed(2)}: ${verdict}. Rules of thumb: < 0.1 stable, > 0.25 major.`,
        };
      },
    },
    {
      cat: 'eng', tool: 'MLOps', name: 'Performance decay', family: 'Monitoring',
      tip: 'Models get worse as the world changes. Track a live quality metric against a threshold, and retrain (dashed lines) when it crosses, ideally automatically.',
      draw(r) {
        const n = 52, thr = 0.8, rate = 0.004 + r() * 0.004, acc = [], retrains = [];
        let a = 0.9;
        range(n).forEach(i => { a -= rate * (1 + r()); if (a < thr) { retrains.push(i); a = 0.9 + normal(r) * 0.01; } acc.push(a + normal(r) * 0.006); });
        const xs = scale(0, n - 1, L, R), ys = scale(0.74, 0.94, B, T + 10);
        return grid() + line(L, ys(thr), R, ys(thr), 'neg', 1.2, '4 3') + text(R, ys(thr) + 11, 'threshold', 'end', 'muted', 8) + retrains.map(i => line(xs(i - 0.5), T + 10, xs(i - 0.5), B, 'muted', 1, '2 3')).join('') +
          poly(acc.map((v, i) => [xs(i), ys(v)]), 's1', 2) + baseline() + text(L, T + 4, 'accuracy') + text(R, H - 1, 'weeks', 'end');
      },
    },
    {
      cat: 'eng', tool: 'MLOps', name: 'Canary release', family: 'Deployment', wiki: 'Feature_toggle',
      tip: 'Roll a new model out to a small share of traffic first, check its error rate and business metrics, then ramp up step by step. If anything looks wrong, roll back instantly.',
      draw() {
        const steps = [[0, 0], [2, 1], [4, 5], [6, 25], [8, 50], [10, 100]], xs = scale(0, 12, L + 20, R), ys = scale(0, 100, B, T + 10);
        const pts2 = [];
        steps.forEach(([t, p], i) => { pts2.push([xs(t), ys(p)]); pts2.push([xs(i < steps.length - 1 ? steps[i + 1][0] : 12), ys(p)]); });
        return grid(4) + area([[xs(0), B], ...pts2, [xs(12), B]], tint('s1', 30)) + poly(pts2, 's1', 2) + steps.slice(1).map(([t, p]) => text(xs(t) + 3, ys(p) - 4, `${p}%`, 'start', 'text', 8.5, 600)).join('') +
          baseline(B, L + 20, R) + text(L, T + 4, 'traffic to new model') + text(R, H - 1, 'time →', 'end');
      },
    },
    {
      cat: 'eng', tool: 'MLOps', name: 'Latency percentiles', family: 'Monitoring', wiki: 'Service-level_objective',
      draw(r) {
        const n = 60, spike = 20 + Math.floor(r() * 25), p = q => range(n).map(i => (40 * q + normal(r) * 3 * q) * (i >= spike && i < spike + 6 ? 1 + q * 1.2 : 1));
        const p50 = p(1), p95 = p(2.4), p99 = p(4), slo = 180, xs = scale(0, n - 1, L, R), ys = scale(0, Math.max(...p99, slo) * 1.1, B, T + 10), ln = a => a.map((v, i) => [xs(i), ys(v)]);
        return {
          svg: grid() + line(L, ys(slo), R, ys(slo), 'neg', 1.2, '4 3') + text(L + 2, ys(slo) - 3, `SLO ${slo} ms`, 'start', 'muted', 8) + poly(ln(p50), 's1', 1.8) + poly(ln(p95), 's2', 1.8) + poly(ln(p99), 's5', 1.8) + hlegend([['s1', 'p50'], ['s2', 'p95'], ['s5', 'p99']], R - 128, T + 2, 44) + baseline(),
          tip: 'Averages hide the slow requests your users notice. Track high percentiles: the median (p50) barely moved during this incident, while p99 broke the service-level objective.',
        };
      },
    },
    {
      cat: 'eng', tool: 'MLOps', name: 'Shadow deployment', family: 'Deployment',
      tip: 'Send live requests to the new model in parallel, but only return the current model’s answers. You compare both on real traffic with zero risk to users before switching.',
      draw() {
        return dag({ req: [40, 75, 'request'], cur: [140, T + 22, 'current model', 's1'], nw: [140, B - 22, 'new model', 's2', true], res: [225, T + 22, 'response'], log: [225, B - 22, 'logs only'] },
          [['req', 'cur'], ['req', 'nw', true], ['cur', 'res'], ['nw', 'log', true], ['cur', 'log', true]]);
      },
    },
    {
      cat: 'eng', name: 'CI/CD pipeline', family: 'Automation', wiki: 'CI/CD',
      tip: 'Every push runs the same checks automatically: lint, tests and a build. Only green changes get merged and deployed. Catching mistakes in minutes beats finding them in production.',
      draw() {
        return dag({ c: [36, 50, 'push', 's2'], l: [96, 50, 'lint'], t: [160, 50, 'tests'], b: [222, 50, 'build'], d: [190, 112, 'deploy', 's3'], f: [70, 112, 'fix it', 'neg', true] },
          [['c', 'l'], ['l', 't'], ['t', 'b'], ['b', 'd'], ['t', 'f', true, 'fails'], ['f', 'c', true]]);
      },
    },
    {
      cat: 'eng', name: 'The testing pyramid', family: 'Testing', wiki: 'Test_automation',
      tip: 'Write many fast unit tests for functions, fewer integration tests for how pieces fit together, and a handful of slow end-to-end tests. For data work, add data tests at every layer.',
      draw() {
        const cx = 120, layers = [['end-to-end', 's2', 0.35], ['integration', 's4', 0.65], ['unit', 's1', 1]], h = 36, top = T + 8;
        return layers.map(([label, c, w], i) => { const y = top + i * (h + 3), w0 = 190 * (i === 0 ? 0.08 : layers[i - 1][2]), w1 = 190 * w; return area([[cx - w0 / 2, y], [cx + w0 / 2, y], [cx + w1 / 2, y + h], [cx - w1 / 2, y + h]], tint(c, 55), c, 1.2) + text(cx, y + h / 2 + 7, label, 'middle', 'text', 9, 700); }).join('') +
          text(R - 2, top + 10, 'slow, few', 'end', 'muted', 8) + text(R - 2, top + 3 * (h + 3) - 6, 'fast, many', 'end', 'muted', 8);
      },
    },
    {
      cat: 'eng', tool: 'MLOps', name: 'Hidden technical debt in ML', family: 'Systems', wiki: 'Technical_debt',
      tip: 'In a real ML system the model code is a small box surrounded by much larger ones: data collection, validation, features, serving, monitoring and configuration. Plan and staff for those.',
      draw() {
        const labels = ['configuration', 'data collection', 'feature extraction', 'data verification', null, 'monitoring', 'serving infrastructure', 'analysis tools', 'process management'];
        const cw = (R - L) / 3, chh = (B - T + 8) / 3;
        return labels.map((label, k) => {
          const x = L + (k % 3) * cw, y = T - 4 + Math.floor(k / 3) * chh;
          if (!label) return rect(x + cw / 2 - 24, y + chh / 2 - 11, 48, 22, 's1', 3) + text(x + cw / 2, y + chh / 2 + 3, 'ML code', 'middle', '#fff', 8, 700);
          const words = label.split(' ');
          return `<rect x="${n1(x + 2)}" y="${n1(y + 2)}" width="${n1(cw - 4)}" height="${n1(chh - 4)}" rx="4" style="fill:var(--card-2);stroke:var(--axis)"/>` +
            words.map((w, i) => text(x + cw / 2, y + chh / 2 + 3 + (i - (words.length - 1) / 2) * 10, w, 'middle', 'muted', 8)).join('');
        }).join('');
      },
    },

    // ---- analytics & metrics -------------------------------------------------
    {
      cat: 'biz', name: 'Metric tree', family: 'Metric design',
      tip: 'Break a top-level metric into the drivers that multiply or add up to it. When revenue moves, you see which branch moved, and each team can own a branch.',
      draw() {
        return dag({ rev: [W / 2, T + 12, 'revenue', 's1'], users: [50, 72, 'active users', 's2'], conv: [W / 2, 72, 'conversion', 's2'], aov: [R - 40, 72, 'order value', 's2'],
          newu: [28, B - 12, 'new'], ret: [86, B - 12, 'returning'], items: [178, B - 12, 'items'], price: [228, B - 12, 'price'] },
          [['users', 'rev'], ['conv', 'rev'], ['aov', 'rev'], ['newu', 'users'], ['ret', 'users'], ['items', 'aov'], ['price', 'aov']]) +
          text(92.5, 75, '×', 'middle', 'text', 11, 700) + text(169, 75, '×', 'middle', 'text', 11, 700) + text(48.5, B - 9, '+', 'middle', 'text', 11, 700) + text(203, B - 9, '×', 'middle', 'text', 11, 700);
      },
    },
    {
      cat: 'biz', name: 'Cohort retention table', family: 'Retention', wiki: 'Cohort_analysis',
      tip: 'Each row is a signup cohort, each column months since signup. Read across to see how a cohort decays, and down a column to see whether newer cohorts retain better.',
      draw(r) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'], n = 8, cw = 26, ch2 = 14.5, x0 = L + 30, y0 = T + 10, floor = 0.2 + r() * 0.15, tau = 1.2 + r();
        let s = range(n).map(m => text(x0 + (m + 0.5) * cw, y0 - 3, `M${m}`, 'middle', 'muted', 7.5)).join('');
        range(n).forEach(i => {
          s += text(x0 - 5, y0 + (i + 0.5) * ch2 + 3, months[i], 'end', 'muted', 8);
          range(n - i).forEach(m => {
            const v = m === 0 ? 1 : Math.min(1, (floor + i * 0.012) + (1 - floor) * Math.exp(-m / tau) + normal(r) * 0.015);
            s += rect(x0 + m * cw + 0.5, y0 + i * ch2 + 0.5, cw - 1, ch2 - 1, tint('s1', 12 + v * 88), 1.5) + text(x0 + (m + 0.5) * cw, y0 + (i + 0.5) * ch2 + 3, Math.round(v * 100), 'middle', v > 0.55 ? '#fff' : 'text', 7.5);
          });
        });
        return s;
      },
    },
    {
      cat: 'biz', name: 'Retention curves', family: 'Retention',
      tip: 'Share of each cohort still active over time. What matters is whether the curve flattens: a stable plateau means a core of users who stay. Curves that decay to zero mean a leaky product.',
      draw(r) {
        const xs = scale(0, 12, L + 20, R), ys = scale(0, 1, B, T + 12), cohorts = [[0.08, 'Q1'], [0.2, 'Q2'], [0.32, 'Q3']];
        return grid(4) + cohorts.map(([fl, lab], k) => { const floor = fl + r() * 0.05, tau = 1 + r(); return poly(range(13).map(m => [xs(m), ys(m === 0 ? 1 : floor + (1 - floor) * Math.exp(-m / tau))]), SER[k], 2); }).join('') +
          hlegend(cohorts.map(([, lab], k) => [SER[k], `${lab} cohort`]), L + 20, T + 2, 66) + baseline(B, L + 20, R) + text(R, H - 1, 'months since signup', 'end') + text(L, T + 18, '100%', 'start', 'muted', 8);
      },
    },
    {
      cat: 'biz', name: 'LTV and payback', family: 'Unit economics', wiki: 'Customer_lifetime_value',
      draw(r) {
        const arpu = 20 + r() * 20, cac = 120 + r() * 120, floor = 0.3 + r() * 0.2, n = 24;
        let cum = 0;
        const ltv = range(n + 1).map(m => (cum += m === 0 ? 0 : arpu * (floor + (1 - floor) * Math.exp(-m / 3))));
        const pb = ltv.findIndex(v => v >= cac), xs = scale(0, n, L + 6, R), ys = scale(0, Math.max(ltv[n], cac) * 1.12, B, T + 10);
        return {
          svg: grid(4) + line(L + 6, ys(cac), R, ys(cac), 's2', 1.5, '4 3') + text(R, ys(cac) - 4, `CAC ${Math.round(cac)}`, 'end', 'text', 8.5, 600) + poly(ltv.map((v, m) => [xs(m), ys(v)]), 's1', 2.2) +
            (pb > 0 ? dot(xs(pb), ys(ltv[pb]), 's1', 4, true) + text(xs(pb) + 6, ys(ltv[pb]) + 12, `payback ${pb} mo`, 'start', 'text', 8.5, 600) : '') + baseline() + text(R, H - 1, 'months', 'end') + text(L + 6, T + 4, 'cumulative margin per customer'),
          tip: `Margin a customer generates over time against what it cost to acquire them. ${pb > 0 ? `This cohort pays back after ${pb} months` : 'This cohort never pays back within 24 months'}, and LTV/CAC after two years is ${(ltv[n] / cac).toFixed(1)}. Aim for well above 1.`,
        };
      },
    },
    {
      cat: 'biz', name: 'The 80/20 curve', family: 'Customers', wiki: 'Pareto_principle',
      draw(r) {
        const rev = sorted(range(1000).map(() => Math.exp(normal(r) * (1 + r() * 0.6)))).reverse(), tot = sum(rev);
        let c = 0;
        const cum = rev.map(v => (c += v) / tot), top20 = cum[199], xs = scale(0, 1, L + 24, R), ys = scale(0, 1, B, T);
        return {
          svg: grid(4) + area([[xs(0), B], ...cum.map((v, i) => [xs((i + 1) / 1000), ys(v)]), [xs(1), B]], tint('s1', 25)) + poly([[xs(0), ys(0)], ...cum.filter((_, i) => i % 5 === 0).map((v, i) => [xs((i * 5 + 1) / 1000), ys(v)])], 's1', 2) +
            line(xs(0.2), B, xs(0.2), ys(top20), 'text', 1, '3 2') + line(L + 24, ys(top20), xs(0.2), ys(top20), 'text', 1, '3 2') + dot(xs(0.2), ys(top20), 's1', 4, true) +
            text(xs(0.2) + 6, ys(top20) + 12, `top 20% → ${Math.round(top20 * 100)}% of revenue`, 'start', 'text', 8.5, 600) + baseline(B, L + 24, R) + text(R, H - 1, 'share of customers, biggest first', 'end'),
          tip: `The top 20% of customers bring in ${Math.round(top20 * 100)}% of revenue. Know who they are, protect them, and don’t let averages across all customers drive decisions about them.`,
        };
      },
    },
    {
      cat: 'biz', name: 'Attribution models disagree', family: 'Marketing', wiki: 'Attribution_(marketing)',
      draw(r) {
        const ch = ['social', 'display', 'email', 'search'], early = [0.45, 0.3, 0.15, 0.1], late = [0.1, 0.1, 0.3, 0.5];
        const pick = w => { let u = r(), i = 0; while (u > w[i] && i < 3) { u -= w[i]; i++; } return i; };
        const credit = range(3).map(() => range(4).fill(0));
        range(600).forEach(() => {
          const k = 1 + Math.floor(r() * 4), path = range(k).map(i => pick(k === 1 ? late : i < k / 2 ? early : late));
          credit[0][path[k - 1]]++; credit[1][path[0]]++; path.forEach(c => { credit[2][c] += 1 / k; });
        });
        const shares = credit.map(row => row.map(v => v / sum(row))), models = ['last click', 'first click', 'linear'], gw = (R - L - 30) / 4, bw = gw / 3.6, ys = scale(0, 0.7, B, T + 12);
        return {
          svg: grid() + ch.map((c, j) => shares.map((row, m) => bar(L + 30 + j * gw + 4 + m * bw, ys(row[j]), bw - 1.5, B, SER[m])).join('') + text(L + 30 + (j + 0.5) * gw, H - 1, c, 'middle')).join('') + hlegend(models.map((m, i) => [SER[i], m]), L + 30, T + 2, 66) + baseline(B, L + 30, R),
          tip: `The same 600 customer journeys, credited three ways. Last-click gives search ${Math.round(shares[0][3] * 100)}% of the credit; first-click gives it ${Math.round(shares[1][3] * 100)}%. Budget decisions depend on a modelling choice, so test with experiments where you can.`,
        };
      },
    },
    {
      cat: 'biz', name: 'Diminishing returns', family: 'Marketing', wiki: 'Marketing_mix_modeling',
      draw(r) {
        const chans = [[60 + r() * 40, 30 + r() * 30, 's1', 'TV'], [30 + r() * 20, 10 + r() * 10, 's2', 'search']], cur = [55 + r() * 25, 30 + r() * 20];
        const hill = (x, top, half) => top * x / (x + half), xs = scale(0, 100, L + 6, R - 4), ys = scale(0, 100, B, T + 12);
        const marg = chans.map(([top, half], i) => (hill(cur[i] + 1, top, half) - hill(cur[i], top, half)));
        return {
          svg: grid() + chans.map(([top, half, c], i) => poly(range(51).map(k => [xs(k * 2), ys(hill(k * 2, top, half))]), c, 2) + dot(xs(cur[i]), ys(hill(cur[i], top, half)), c, 4.5, true)).join('') +
            hlegend(chans.map(([, , c, l]) => [c, l]), L + 6, T + 2, 50) + baseline() + text(R, H - 1, 'spend', 'end') + text(R, T + 4, 'dots = current spend', 'end', 'muted', 8),
          tip: `Each extra krone of spend brings less than the one before. At current levels, one more unit on TV returns ${marg[0].toFixed(2)} and on search ${marg[1].toFixed(2)}. Shift budget to where the curve is still steep.`,
        };
      },
    },
    {
      cat: 'biz', name: 'Mix shift', family: 'Explaining changes', wiki: 'Simpson%27s_paradox',
      draw(r) {
        const r1 = [0.06, 0.02], r2 = [0.065 + r() * 0.01, 0.022 + r() * 0.004], w1 = [0.6, 0.4], w2 = [0.35 + r() * 0.1, 0]; w2[1] = 1 - w2[0];
        const tot1 = w1[0] * r1[0] + w1[1] * r1[1], tot2 = w2[0] * r2[0] + w2[1] * r2[1], rate = sum(w1.map((w, i) => w * (r2[i] - r1[i]))), mix = sum(w2.map((w, i) => (w - w1[i]) * r2[i]));
        const lo = Math.min(tot1, tot2, tot1 + rate) * 0.9, hi = Math.max(tot1, tot2, tot1 + rate) * 1.05, ys = scale(lo, hi, B, T + 10), bw = (R - L) / 4, pct = v => `${(v * 100).toFixed(2)}%`;
        const step = (i, a, b, c, lab) => rect(L + i * bw + 8, ys(Math.max(a, b)), bw - 16, Math.max(1, Math.abs(ys(a) - ys(b))), c, 2) + text(L + (i + 0.5) * bw, H - 1, lab, 'middle') + text(L + (i + 0.5) * bw, ys(Math.max(a, b)) - 4, i === 0 || i === 3 ? pct(b) : `${b >= a ? '+' : '−'}${(Math.abs(b - a) * 100).toFixed(2)}`, 'middle', 'text', 8.5, 600);
        return {
          svg: grid() + step(0, lo, tot1, 'muted', 'last month') + step(1, tot1, tot1 + rate, 'pos', 'rates') + step(2, tot1 + rate, tot2, 'neg', 'mix') + step(3, lo, tot2, 'muted', 'this month'),
          tip: `Conversion improved on both desktop and mobile, yet the total ${tot2 < tot1 ? 'fell' : 'barely rose'}, because traffic shifted towards mobile, which converts lower. Splitting a change into rate and mix effects stops the wrong team getting the blame.`,
        };
      },
    },
    {
      cat: 'biz', name: 'Price elasticity', family: 'Pricing', wiki: 'Price_elasticity_of_demand',
      draw(r) {
        const a = 900 + r() * 400, b = 4 + r() * 4, prices = range(14).map(() => 40 + r() * 100), q = prices.map(p => Math.max(5, a - b * p + normal(r) * 40)), f = ols(prices, q);
        const pStar = -f.a / (2 * f.b), pm = mean(prices), el = f.b * pm / (f.a + f.b * pm), xs = scale(30, 150, L + 6, R), ys = scale(0, Math.max(...q) * 1.1, B, T + 10);
        return {
          svg: grid() + prices.map((p, i) => dot(xs(p), ys(q[i]), tint('s1', 75), 3, true)).join('') + line(xs(30), ys(f.a + f.b * 30), xs(150), ys(f.a + f.b * 150), 's1', 2) +
            (pStar > 30 && pStar < 150 ? line(xs(pStar), T + 10, xs(pStar), B, 's2', 1.5, '4 3') + text(xs(pStar) + 4, T + 18, `revenue peaks at ${Math.round(pStar)}`, 'start', 'text', 8.5, 600) : '') + baseline() + text(R, H - 1, 'price', 'end') + text(L + 6, T + 4, 'units sold'),
          tip: `Units sold at different price points from tests. At the average price the elasticity is ${el.toFixed(1)}: a 1% price rise changes volume by ${el.toFixed(1)}%. Beyond |1|, raising prices loses revenue.`,
        };
      },
    },
    {
      cat: 'biz', name: 'RFM segmentation', family: 'Customers', wiki: 'RFM_(market_research)',
      tip: 'Score customers on recency and frequency (and monetary value), then name the segments. Each one gets a different action: reward the champions, win back the at-risk, let the lost go.',
      draw(r) {
        const n = 5, cell = 22, x0 = L + 50, y0 = T + 6;
        let s = '';
        range(n).forEach(f => range(n).forEach(rc => { const v = Math.exp(-((rc - 2) ** 2 + (f - 1.5) ** 2) / 6) * (0.6 + r() * 0.4); s += rect(x0 + rc * cell, y0 + (n - 1 - f) * cell, cell - 1.5, cell - 1.5, tint('s1', 10 + v * 70), 2); }));
        const seg = (x, y, w, h, lab, c) => `<rect x="${x0 + x * cell - 1}" y="${y0 + y * cell - 1}" width="${w * cell}" height="${h * cell}" rx="3" style="fill:none;stroke:var(--${c});stroke-width:2"/>` + text(x0 + (x + w / 2) * cell - 1, y0 + (y + h / 2) * cell + 3, lab, 'middle', 'text', 8, 700);
        return s + seg(3, 0, 2, 2, 'champions', 's3') + seg(0, 0, 2, 2, 'at risk', 's2') + seg(0, 3, 2, 2, 'lost', 'neg') + seg(3, 3, 2, 2, 'new', 's4') +
          text(x0 + n * cell / 2, H - 1, 'recency → recent', 'middle') + `<text transform="translate(${x0 - 8} ${y0 + n * cell / 2}) rotate(-90)" text-anchor="middle" style="fill:var(--muted);font-size:9px">frequency →</text>`;
      },
    },

    // ---- data modelling, orchestration & Snowflake (code source) -------------
    {
      cat: 'code', tool: 'Modelling', name: 'Star schema', family: 'Data modelling', wiki: 'Star_schema',
      tip: 'A central fact table of events (orders, with numbers you add up) joined to dimension tables that describe them (who, what, when, where). Simple joins, fast queries, easy for BI tools.',
      draw() {
        return dag({ f: [W / 2, 75, 'fct_orders', 's1'], c: [52, T + 16, 'dim_customer', 's2'], p: [R - 44, T + 16, 'dim_product', 's2'], d: [52, B - 14, 'dim_date', 's2'], st: [R - 44, B - 14, 'dim_store', 's2'] },
          [['f', 'c'], ['f', 'p'], ['f', 'd'], ['f', 'st']]) + text(W / 2, 98, 'keys + measures', 'middle', 'muted', 8);
      },
    },
    {
      cat: 'code', tool: 'Modelling', name: 'Slowly changing dimension (type 2)', family: 'Data modelling', wiki: 'Slowly_changing_dimension',
      tip: 'Instead of overwriting a customer’s plan, close the old row and add a new one with validity dates. Joins on date then show the plan that was true at the time of each order.',
      draw() {
        const head = ['customer', 'plan', 'valid_from', 'valid_to', 'current'], xc = [L, L + 46, L + 92, L + 152, L + 210];
        const rows = [['42', 'basic', '2025-01-03', '2025-09-14', 'false'], ['42', 'pro', '2025-09-14', '2026-05-02', 'false'], ['42', 'business', '2026-05-02', '—', 'true'], ['43', 'basic', '2025-11-20', '—', 'true']];
        let s = head.map((h, i) => text(xc[i], T + 10, h, 'start', 'muted', 8, 600)).join('') + line(L, T + 15, R, T + 15, 'axis');
        rows.forEach((row, k) => {
          const y = T + 33 + k * 24;
          if (k < 3) s += rect(L - 4, y - 13, R - L + 8, 19, tint('s1', k === 2 ? 22 : 8), 3);
          row.forEach((v, i) => { s += text(xc[i], y, v, 'start', i === 1 && k < 3 ? 's1' : 'text', 8.5, i === 1 || (i === 4 && v === 'true') ? 700 : 400); });
        });
        return s;
      },
    },
    {
      cat: 'code', tool: 'Modelling', name: 'Layers from raw to marts', family: 'Architecture', wiki: 'Extract,_load,_transform',
      tip: 'Land data raw and untouched (ELT), clean it into staging, combine it into business-ready marts, then serve BI and ML from marts only. Each layer has one job and can be rebuilt from the one before.',
      draw() {
        return dag({ src: [30, 40, 'apps'], src2: [30, 110, 'files'], raw: [86, 75, 'raw', 'muted'], stg: [140, 75, 'staging', 's2'], mart: [200, 75, 'marts', 's1'], bi: [232, 30, 'BI', 's3'], ml: [232, 120, 'ML', 's3'] },
          [['src', 'raw'], ['src2', 'raw'], ['raw', 'stg'], ['stg', 'mart'], ['mart', 'bi'], ['mart', 'ml']]) + text(86, 100, 'bronze', 'middle', 'muted', 7.5) + text(140, 100, 'silver', 'middle', 'muted', 7.5) + text(200, 100, 'gold', 'middle', 'muted', 7.5);
      },
    },
    {
      cat: 'code', tool: 'Orchestration', name: 'A pipeline as a DAG', family: 'Pipelines', wiki: 'Directed_acyclic_graph',
      draw(r) {
        const names = ['orders', 'customers', 'stg', 'fct', 'tests', 'dashboard'], pos = [[34, 40], [34, 110], [100, 75], [158, 75], [205, 40], [205, 110]];
        const edges = [[0, 2], [1, 2], [2, 3], [3, 4], [3, 5]], fail = 2 + Math.floor(r() * 3);
        const down = new Set([fail]); edges.forEach(([a, b]) => { if (down.has(a)) down.add(b); }); edges.forEach(([a, b]) => { if (down.has(a)) down.add(b); });
        const status = i => i === fail ? ['neg', 'failed'] : down.has(i) ? ['muted', 'skipped'] : i < fail ? ['s3', 'success'] : ['s3', 'success'];
        const nodes = {};
        names.forEach((nm, i) => { const [c, st] = status(i); nodes[nm] = [...pos[i], nm, c, st === 'skipped']; });
        return {
          svg: dag(nodes, edges.map(([a, b]) => [names[a], names[b], down.has(b) && b !== fail])) + hlegend([['s3', 'success'], ['neg', 'failed'], ['muted', 'skipped']], L, B + 8, 62),
          tip: `An orchestrator (Airflow, Dagster, Snowflake tasks) runs steps in dependency order, retries failures and stops what depends on them. Here “${names[fail]}” failed, so everything downstream was skipped instead of building on bad data.`,
        };
      },
    },
    {
      cat: 'code', tool: 'Snowflake', name: 'Warehouse size vs cost', family: 'Cost & performance',
      tip: 'Each size up doubles the credits per hour, but a query that parallelises well also finishes in about half the time, so it costs about the same and you wait less. Scale until the speed-up stops.',
      draw(r) {
        const sizes = ['XS', 'S', 'M', 'L', 'XL'], base = 16 + r() * 8, eff = 0.92 - r() * 0.15, mins = sizes.map((_, i) => base / (2 ** i) ** eff + 0.4), credits = sizes.map((_, i) => 2 ** i);
        const xs = scale(0, 5, L + 20, R), ys = scale(0, mins[0] * 1.25, B, T + 12), bw = (R - L - 20) / 5;
        return grid() + mins.map((m, i) => bar(L + 20 + i * bw + 6, ys(m), bw - 12, B, tint('s1', 70)) + text(L + 20 + (i + 0.5) * bw, ys(m) - 10, `${m.toFixed(1)} min`, 'middle', 'text', 8, 600) +
          text(L + 20 + (i + 0.5) * bw, ys(m) - 2, `${(credits[i] * m / 60).toFixed(2)} cr`, 'middle', 'muted', 7.5) + text(L + 20 + (i + 0.5) * bw, H - 1, sizes[i], 'middle')).join('') + baseline(B, L + 20, R) + text(L, T + 4, 'runtime and credits per query');
      },
    },
    {
      cat: 'code', tool: 'Snowflake', name: 'Partition pruning', family: 'Cost & performance', url: 'https://docs.snowflake.com/en/user-guide/tables-clustering-micropartitions',
      draw(r) {
        const n = 14, f0 = 0.55, f1 = 0.65, panel = (x0, w, ranges, label) => {
          const xs = scale(0, 1, x0, x0 + w), step = (B - T - 16) / n;
          let scanned = 0;
          const s = ranges.map(([a, b], i) => { const hit = b >= f0 && a <= f1; if (hit) scanned++; return line(xs(a), T + 12 + i * step, xs(b), T + 12 + i * step, hit ? 's1' : tint('muted', 45), 3.5); }).join('');
          return rect(xs(f0), T + 6, xs(f1) - xs(f0), B - T - 10, tint('s2', 22)) + s + text(x0 + w / 2, H - 1, `${label}: ${scanned}/${n} read`, 'middle', 'text', 8.5, 600);
        };
        const messy = range(n).map(() => { const a = r() * 0.6, b = a + 0.25 + r() * 0.4; return [a, Math.min(1, b)]; }), tidy = range(n).map(i => [i / n, (i + 1) / n + 0.01]);
        return {
          svg: panel(L, 112, messy, 'unclustered') + panel(L + 128, 112, tidy, 'clustered') + text(W / 2, T + 2, 'shaded = WHERE date filter', 'middle', 'muted', 7.5),
          tip: 'Snowflake stores tables in micro-partitions and keeps each one’s min and max values. If data is ordered by the column you filter on, most partitions are skipped without being read: faster and cheaper.',
        };
      },
    },

    // ---- practical ML --------------------------------------------------------
    {
      cat: 'ml', name: 'Spotting target leakage', family: 'Pitfalls', wiki: 'Leakage_(machine_learning)',
      tip: 'When one feature dominates and the model looks too good, suspect leakage: here “refund_issued” only exists after a customer has already churned. Ask for every feature: was this known at prediction time?',
      draw(r) {
        const names = ['refund_issued', 'tenure', 'support_calls', 'plan', 'last_login', 'discount', 'region'], vals = [0.6 + r() * 0.2, ...range(6).map(i => 0.12 * Math.exp(-i * 0.35) * (0.8 + r() * 0.4))];
        const xs = scale(0, vals[0] * 1.05, L + 60, R), step = (B - T + 4) / names.length;
        return names.map((nm, i) => { const y = T - 2 + i * step; return text(L + 56, y + step / 2 + 3, nm, 'end', i === 0 ? 'text' : 'muted', 8, i === 0 ? 700 : 400) + rect(xs(0), y + 2, xs(vals[i]) - xs(0), step - 4, i === 0 ? 'neg' : 's1', 2); }).join('') + text(R, T + step / 2 + 2, 'too good to be true?', 'end', '#fff', 8, 700);
      },
    },
    {
      cat: 'ml', name: 'Pick the threshold', family: 'Imbalanced data', wiki: 'Precision_and_recall',
      draw(r) {
        const sc = scored(r, 1.6 + r() * 0.8, 50, 950), np = 50, ths = range(41).map(i => -1 + i * 0.085);
        const m = ths.map(t => { const tp = sc.filter(([s, y]) => s >= t && y).length, fp = sc.filter(([s, y]) => s >= t && !y).length, p = tp + fp ? tp / (tp + fp) : 1, rc = tp / np; return [t, p, rc, p + rc ? 2 * p * rc / (p + rc) : 0]; });
        const best = m.reduce((a, b) => b[3] > a[3] ? b : a), xs = scale(-1, 2.4, L, R), ys = scale(0, 1, B, T + 12), ln = k => m.map(row => [xs(row[0]), ys(row[k])]);
        return {
          svg: grid(4) + line(xs(best[0]), T + 12, xs(best[0]), B, 'muted', 1, '3 3') + poly(ln(1), 's1', 2) + poly(ln(2), 's2', 2) + poly(ln(3), 'text', 2.2) + dot(xs(best[0]), ys(best[3]), 'text', 3.5) +
            hlegend([['s1', 'precision'], ['s2', 'recall'], ['text', 'F1']], L, T + 2, 64) + baseline() + text(R, H - 1, 'decision threshold →', 'end'),
          tip: `With only 5% positives, the default 0.5 cut-off is rarely right. Raising the threshold trades recall for precision; here F1 peaks at ${best[3].toFixed(2)}. Better still: pick the threshold from the real cost of each mistake.`,
        };
      },
    },
    {
      cat: 'ml', name: 'Grid vs random search', family: 'Tuning', wiki: 'Hyperparameter_optimization',
      tip: 'When only some hyperparameters matter (horizontal here), random search tries 9 different values of the important one, while a 3×3 grid tests only 3. Same budget, much better coverage.',
      draw(r) {
        const f = x => Math.exp(-((x - 0.62) ** 2) / 0.01) * 0.8 + Math.exp(-((x - 0.25) ** 2) / 0.02) * 0.35, pw = 104, gap = 22, top = T + 26;
        const panel = (x0, ptsP, label) => {
          const xs = scale(0, 1, x0, x0 + pw), ys = scale(0, 1, B - 10, top);
          return poly(range(51).map(i => [xs(i / 50), top - 4 - f(i / 50) * 20]), 's2', 1.5) + frameRect(x0, top, pw, B - 10 - top) + ptsP.map(([x, y]) => dot(xs(x), ys(y), 's1', 3.2, true) + line(xs(x), top - 2, xs(x), top - 6, 's1', 1.5)).join('') + text(x0 + pw / 2, H - 1, label, 'middle');
        };
        const gridP = [0.2, 0.5, 0.8].flatMap(x => [0.2, 0.5, 0.8].map(y => [x, y])), randP = range(9).map(() => [0.05 + r() * 0.9, 0.05 + r() * 0.9]);
        return panel(L + 4, gridP, 'grid search') + panel(L + 4 + pw + gap, randP, 'random search') + text(L + 4, T + 4, 'score along the important parameter', 'start', 'muted', 8);
      },
    },
    {
      cat: 'ml', name: 'Matrix factorisation for recommendations', family: 'Recommenders', wiki: 'Matrix_factorization_(recommender_systems)',
      tip: 'Users × items, mostly empty. Factorising the matrix learns a few hidden “taste” dimensions for every user and item, which fills in the blanks (outlined) with predicted ratings to recommend from.',
      draw(r) {
        const nu = 6, ni = 9, k = 2, U = range(nu).map(() => range(k).map(() => normal(r))), V = range(ni).map(() => range(k).map(() => normal(r))), cell = 16, x0 = L + 40, y0 = T + 14;
        let s = range(ni).map(j => text(x0 + (j + 0.5) * cell, y0 - 4, `i${j + 1}`, 'middle', 'muted', 7)).join('');
        range(nu).forEach(i => {
          s += text(x0 - 5, y0 + (i + 0.5) * cell + 3, `user ${i + 1}`, 'end', 'muted', 7.5);
          range(ni).forEach(j => {
            const v = 1 / (1 + Math.exp(-(U[i][0] * V[j][0] + U[i][1] * V[j][1]))), known = r() < 0.35, x = x0 + j * cell, y = y0 + i * cell;
            s += known ? rect(x + 1, y + 1, cell - 2, cell - 2, tint('s1', 15 + v * 85), 2) : `<rect x="${n1(x + 1.5)}" y="${n1(y + 1.5)}" width="${cell - 3}" height="${cell - 3}" rx="2" style="fill:${tint('s2', 6 + v * 40)};stroke:${tint('s2', 60)};stroke-dasharray:2 1.5"/>`;
          });
        });
        return s + hlegend([['s1', 'known rating'], ['s2', 'predicted']], x0, B + 6, 80);
      },
    },
    {
      cat: 'ml', name: 'Encoding cyclical features', family: 'Feature engineering',
      tip: 'Hour 23 and hour 0 are neighbours, but as numbers they’re 23 apart. Encoding time of day (or month, or weekday) as sine and cosine puts it on a circle, so models see the wrap-around.',
      draw() {
        const cx = 160, cy = H / 2 + 4, rad = 52;
        let s = `<circle cx="${cx}" cy="${cy}" r="${rad}" style="fill:none;stroke:var(--grid)"/>` + line(cx - rad - 8, cy, cx + rad + 8, cy, 'grid') + line(cx, cy - rad - 8, cx, cy + rad + 8, 'grid');
        range(24).forEach(h => { const [x, y] = polar(cx, cy, rad, h / 24 * 2 * Math.PI), hot = h === 23 || h === 0; s += dot(x, y, hot ? 's2' : 's1', hot ? 4.5 : 3, true) + (h % 6 === 0 || h === 23 ? text(...polar(cx, cy, rad + 13, h / 24 * 2 * Math.PI).map((v, i) => i ? v + 3 : v), h, 'middle', hot ? 'text' : 'muted', 8, hot ? 700 : 400) : ''); });
        return s + text(L, T + 20, 'x = sin(2π·h/24)', 'start', 'text', 8.5) + text(L, T + 34, 'y = cos(2π·h/24)', 'start', 'text', 8.5) + text(L, B - 10, '23 and 0 are now', 'start', 'muted', 8) + text(L, B, 'next to each other', 'start', 'muted', 8);
      },
    },

    // ---- statistical models, simulation & optimisation ---------------------
    {
      cat: 'stats', name: 'Poisson regression', family: 'GLMs', wiki: 'Poisson_regression',
      draw(r) {
        const b0 = 0.2 + r() * 0.5, b1 = 0.15 + r() * 0.15, xsD = range(80).map(() => r() * 10), ysD = xsD.map(x => { const lam = Math.exp(b0 + b1 * x); let k = 0, p = Math.exp(-lam), c = p; const u = r(); while (u > c && k < 200) { k++; p *= lam / k; c += p; } return k; });
        let a = Math.log(mean(ysD) + 0.1), b = 0;
        for (let it = 0; it < 25; it++) { // Newton–Raphson on the Poisson log-likelihood
          let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
          xsD.forEach((x, i) => { const m = Math.exp(a + b * x), e = ysD[i] - m; ga += e; gb += e * x; haa += m; hab += m * x; hbb += m * x * x; });
          const det = haa * hbb - hab * hab;
          a += (hbb * ga - hab * gb) / det; b += (haa * gb - hab * ga) / det;
        }
        const xs = scale(0, 10, L, R), ys = scale(0, Math.max(...ysD) * 1.1 + 1, B, T + 4);
        return {
          svg: grid() + xsD.map((x, i) => dot(xs(x), ys(ysD[i]), tint('s1', 65), 2.4, true)).join('') + poly(range(41).map(i => [xs(i / 4), ys(Math.exp(a + b * i / 4))]), 'text', 2) + baseline() + text(R, H - 1, 'x', 'end') + text(L, T, 'count'),
          tip: `For counts (orders, calls, defects) use Poisson regression: the log of the expected count is linear in x. Each unit of x multiplies the expected count by ${Math.exp(b).toFixed(2)}. If variance exceeds the mean, switch to negative binomial.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Reading odds ratios', family: 'GLMs', wiki: 'Odds_ratio',
      tip: 'Logistic regression coefficients are easiest to read as odds ratios: above 1 raises the odds of the outcome, below 1 lowers it. The log scale makes ×2 and ×½ equally far from 1.',
      draw(r) {
        const vars = ['support calls', 'monthly plan', 'tenure (yrs)', 'discount', 'app user', 'age 60+'], xs = scale(Math.log(0.25), Math.log(4), L + 66, R - 4), step = (B - T - 10) / vars.length;
        let s = [0.25, 0.5, 1, 2, 4].map(v => line(xs(Math.log(v)), T, xs(Math.log(v)), B - 8, v === 1 ? 'axis' : 'grid', v === 1 ? 1.5 : 1) + text(xs(Math.log(v)), H - 1, `×${v}`, 'middle', 'muted', 8)).join('');
        vars.forEach((v, i) => {
          const lo = normal(r) * 0.6 + [0.6, 0.4, -0.5, 0.1, -0.3, 0][i], e = 0.15 + r() * 0.25, y = T + 6 + i * step + step / 2, c = Math.abs(lo) > e ? (lo > 0 ? 's2' : 's1') : 'muted';
          s += text(L + 60, y + 3, v, 'end') + line(xs(Math.max(Math.log(0.25), lo - e)), y, xs(Math.min(Math.log(4), lo + e)), y, c, 2) + dot(xs(Math.max(Math.log(0.25), Math.min(Math.log(4), lo))), y, c, 3.5, true);
        });
        return s;
      },
    },
    {
      cat: 'stats', name: 'Partial pooling', family: 'Multilevel models', wiki: 'Multilevel_model',
      tip: 'Estimating each store separately overreacts to small samples; one average ignores real differences. A multilevel model shrinks each estimate towards the overall mean, most strongly for the smallest groups.',
      draw(r) {
        const k = 9, tau = 0.05, sigma = 0.25, grand = 0.3, groups = range(k).map(() => { const n = Math.round(5 + r() * r() * 200), mu = grand + normal(r) * tau, raw = mu + normal(r) * sigma / Math.sqrt(n); return { n, raw }; }).sort((a, b) => a.n - b.n);
        const xs = scale(0.05, 0.55, L + 46, R - 4), step = (B - T - 6) / k;
        let s = line(xs(grand), T, xs(grand), B, 'text', 1, '3 3') + text(xs(grand) + 3, T + 6, 'overall mean', 'start', 'muted', 8);
        groups.forEach((g, i) => {
          const wgt = g.n / (g.n + sigma ** 2 / tau ** 2), shrunk = wgt * g.raw + (1 - wgt) * grand, y = T + 10 + i * step + step / 2, rx = xs(Math.max(0.05, Math.min(0.55, g.raw)));
          s += text(L + 40, y + 3, `n=${g.n}`, 'end', 'muted', 8) + line(rx, y, xs(shrunk), y, 'muted', 1) + ring(rx, y, 's2', 3.5) + dot(xs(shrunk), y, 's1', 3.5);
        });
        return s + hlegend([['s2', 'separate'], ['s1', 'pooled']], R - 120, B + 8, 60);
      },
    },
    {
      cat: 'stats', name: 'Bayesian A/B test', family: 'Bayesian statistics', wiki: 'Bayesian_inference',
      draw(r) {
        const n = 2000 + Math.floor(r() * 3000), pa = 0.05 + r() * 0.03, pb = pa * (1 + (r() - 0.3) * 0.3), ka = Math.round(n * pa + normal(r) * Math.sqrt(n * pa)), kb = Math.round(n * pb + normal(r) * Math.sqrt(n * pb));
        const post = k => [(k + 1) / (n + 2), Math.sqrt((k + 1) * (n - k + 1) / ((n + 2) ** 2 * (n + 3)))], [ma, sa] = post(ka), [mb, sb] = post(kb), pBetter = normCdf((mb - ma) / Math.hypot(sa, sb));
        const lo = Math.min(ma, mb) - 4 * Math.max(sa, sb), hi = Math.max(ma, mb) + 4 * Math.max(sa, sb), g = range(121).map(i => lo + (hi - lo) * i / 120), d = (m, s0) => x => npdf((x - m) / s0) / s0;
        const xs = scale(lo, hi, L, R), ys = scale(0, Math.max(d(ma, sa)(ma), d(mb, sb)(mb)) * 1.15, B, T + 12), curve = f => [[xs(lo), B], ...g.map(x => [xs(x), ys(f(x))]), [xs(hi), B]];
        return {
          svg: area(curve(d(ma, sa)), tint('s2', 35), 's2', 1.5) + area(curve(d(mb, sb)), tint('s1', 35), 's1', 1.5) + hlegend([['s2', 'A'], ['s1', 'B']], L, T + 2, 36) + text(R, T + 4, `P(B > A) = ${(pBetter * 100).toFixed(0)}%`, 'end', 'text', 10, 700) + baseline() + text(R, H - 1, 'conversion rate', 'end'),
          tip: `Instead of a p-value, a Bayesian analysis gives the probability that B beats A, here ${(pBetter * 100).toFixed(0)}%, plus how much you’d lose if you pick the wrong one. That maps directly onto the business decision.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Interaction effects', family: 'Regression', wiki: 'Interaction_(statistics)',
      tip: 'The discount lifts sales for new customers but barely moves returning ones: the effect depends on the segment. Non-parallel lines signal an interaction, which a model needs an explicit term for.',
      draw(r) {
        const xs = scale(0, 1, L + 50, R - 50), base = [20 + r() * 5, 35 + r() * 5], lift = [10 + r() * 6, 1 + r() * 2], ys = scale(10, 50, B, T + 12);
        return grid() + [0, 1].map(k => { const a = base[k], b = base[k] + lift[k], c = SER[k]; return line(xs(0), ys(a), xs(1), ys(b), c, 2.5) + dot(xs(0), ys(a), c, 4, true) + dot(xs(1), ys(b), c, 4, true); }).join('') +
          text(xs(0), H - 1, 'no discount', 'middle') + text(xs(1), H - 1, 'discount', 'middle') + hlegend([['s1', 'new customers'], ['s2', 'returning']], L, T + 2, 86) + baseline(B, L + 30, R - 30);
      },
    },
    {
      cat: 'stats', name: 'Monte Carlo simulation', family: 'Simulation', wiki: 'Monte_Carlo_method',
      draw(r) {
        const tasks = range(5).map(() => { const m = 3 + r() * 6; return [m * 0.8, m, m * (1.5 + r())]; });
        const tri = ([a, c, b]) => { const u = r(), f = (c - a) / (b - a); return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c)); };
        const sims = sorted(range(4000).map(() => sum(tasks.map(tri)))), plan = sum(tasks.map(t => t[1])), p80 = quantile(sims, 0.8), pOn = sims.filter(v => v <= plan).length / sims.length;
        const lo = sims[0], hi = sims[sims.length - 1], nb = 34, counts = range(nb).fill(0);
        sims.forEach(v => { counts[Math.min(nb - 1, Math.floor((v - lo) / (hi - lo) * nb))]++; });
        const xs = scale(lo, hi, L, R), ys = scale(0, Math.max(...counts) * 1.2, B, T + 8), w = (R - L) / nb;
        return {
          svg: grid() + counts.map((c, i) => bar(L + i * w + 0.5, ys(c), w - 1, B, tint(lo + (i + 0.5) * (hi - lo) / nb <= plan ? 's3' : 's2', 65))).join('') + line(xs(plan), T + 8, xs(plan), B, 'text', 1.5, '3 2') + text(xs(plan) - 3, T + 14, `plan ${plan.toFixed(0)} days`, 'end', 'text', 8.5, 600) +
            line(xs(p80), T + 8, xs(p80), B, 's2', 1.5, '3 2') + text(xs(p80) + 3, T + 14, `80%: ${p80.toFixed(0)}`, 'start', 'text', 8.5, 600) + baseline(),
          tip: `Five tasks with uncertain durations, simulated 4,000 times. Adding up the most likely estimates gives ${plan.toFixed(0)} days, but that’s met only ${Math.round(pOn * 100)}% of the time. Promise ${p80.toFixed(0)} days for 80% confidence.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Linear programming', family: 'Optimisation', wiki: 'Linear_programming',
      draw(r) {
        const pa = 3 + Math.floor(r() * 3), pb = 4 + Math.floor(r() * 3), cons = [[1, 2, 14 + Math.floor(r() * 4)], [3, 1, 18 + Math.floor(r() * 4)], [1, 0, 5 + Math.floor(r() * 2)]];
        const lines = [...cons, [-1, 0, 0], [0, -1, 0]], ok = ([x, y]) => lines.every(([a, b, c]) => a * x + b * y <= c + 1e-9);
        const verts = [];
        lines.forEach((l1, i) => lines.forEach((l2, j) => { if (j <= i) return; const det = l1[0] * l2[1] - l1[1] * l2[0]; if (Math.abs(det) < 1e-9) return; const v = [(l1[2] * l2[1] - l1[1] * l2[2]) / det, (l1[0] * l2[2] - l1[2] * l2[0]) / det]; if (ok(v)) verts.push(v); }));
        const c0 = [mean(verts.map(v => v[0])), mean(verts.map(v => v[1]))], poly2 = verts.sort((a, b) => Math.atan2(a[1] - c0[1], a[0] - c0[0]) - Math.atan2(b[1] - c0[1], b[0] - c0[0]));
        const best = verts.reduce((a, b) => pa * b[0] + pb * b[1] > pa * a[0] + pb * a[1] ? b : a), z = pa * best[0] + pb * best[1];
        const xs = scale(0, 10, L + 20, R - 70), ys = scale(0, 10, B, T + 4), P = ([x, y]) => [xs(x), ys(y)];
        return {
          svg: grid() + area(poly2.map(P), tint('s1', 30), 's1', 1.5) + (() => { const d = Math.hypot(pa, pb), u = [pb / d * 2.5, -pa / d * 2.5]; return line(...P([best[0] - u[0], best[1] - u[1]]), ...P([best[0] + u[0], best[1] + u[1]]), 's2', 1.5, '5 3'); })() + dot(...P(best), 's2', 5, true) +
            text(R - 66, T + 20, `max ${pa}a + ${pb}b`, 'start', 'text', 8.5, 600) + text(R - 66, T + 34, `best: a=${+best[0].toFixed(1)},`, 'start', 'text', 8.5) + text(R - 66, T + 46, `b=${+best[1].toFixed(1)}`, 'start', 'text', 8.5) + text(R - 66, T + 60, `profit ${z.toFixed(1)}`, 'start', 's2', 8.5, 700) + baseline(B, L + 20, R - 70),
          tip: 'Choose how much of two products to make given limited machine hours and materials (the shaded feasible region). The best plan is always at a corner, where the profit line (dashed) last touches the region.',
        };
      },
    },
    {
      cat: 'stats', name: 'The newsvendor problem', family: 'Optimisation', wiki: 'Newsvendor_model',
      draw(r) {
        const mu = 100, sd0 = 20 + r() * 15, price = 10, cost = 3 + r() * 4, salvage = 1, demand = range(3000).map(() => Math.max(0, mu + normal(r) * sd0));
        const profit = q => mean(demand.map(d => price * Math.min(q, d) - cost * q + salvage * Math.max(0, q - d))), qs = range(41).map(i => 40 + i * 4), ps = qs.map(profit);
        const crit = (price - cost) / (price - salvage), qStar = mu + probit(crit) * sd0, xs = scale(40, 200, L + 6, R), ys = scale(Math.min(...ps), Math.max(...ps) * 1.08, B, T + 12);
        return {
          svg: grid() + poly(qs.map((q, i) => [xs(q), ys(ps[i])]), 's1', 2.2) + line(xs(mu), T + 12, xs(mu), B, 'muted', 1, '3 3') + text(xs(mu) - 3, B - 4, 'mean demand', 'end', 'muted', 8) +
            dot(xs(qStar), ys(profit(qStar)), 's2', 4.5, true) + text(xs(qStar) + 6, ys(profit(qStar)) - 6, `order ${Math.round(qStar)}`, 'start', 'text', 8.5, 600) + baseline() + text(R, H - 1, 'units ordered', 'end') + text(L + 6, T + 4, 'expected profit'),
          tip: `How much to stock when demand is uncertain? Running out costs margin, leftovers cost money. With these prices the best order is the ${Math.round(crit * 100)}th percentile of demand: ${Math.round(qStar)} units, not the average of 100.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Decision analysis', family: 'Decisions', wiki: 'Decision_tree',
      draw(r) {
        const p = 0.3 + r() * 0.3, win = 8 + Math.round(r() * 6), loss = -(2 + Math.round(r() * 3)), ev = p * win + (1 - p) * loss;
        return {
          svg: dag({ d: [34, 75, 'launch?', 's1'], c: [120, 42, 'outcome', 's4'], no: [120, 122, `don’t: 0`], s: [204, 20, `success: +${win}M`, 's3'], f: [204, 70, `flop: ${loss}M`, 'neg'] },
            [['d', 'c', false, 'launch'], ['d', 'no', false, 'wait'], ['c', 's', false, `p=${p.toFixed(2)}`], ['c', 'f', false, `${(1 - p).toFixed(2)}`]]) + text(120, 60, `EV ${ev >= 0 ? '+' : ''}${ev.toFixed(1)}M`, 'middle', 'text', 8.5, 700),
          tip: `Lay out choices, chance events and payoffs, then work backwards. Launching has an expected value of ${ev.toFixed(1)}M versus 0 for waiting, so ${ev > 0 ? 'launch' : 'wait'}, unless the downside would hurt more than the expected value suggests.`,
        };
      },
    },
    {
      cat: 'stats', name: 'Tornado chart', family: 'Decisions', wiki: 'Tornado_diagram',
      tip: 'Vary each uncertain input between its low and high case, one at a time, and see how far the result moves. The widest bars are where better information or risk reduction is worth the most.',
      draw(r) {
        const inputs = ['conversion', 'price', 'churn', 'CAC', 'market size', 'COGS'], base = 10, sw = inputs.map(() => [-(0.5 + r() * 4), 0.5 + r() * 4]).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
        const xs = scale(base - 5, base + 5, L + 56, R - 4), step = (B - T - 6) / inputs.length;
        return line(xs(base), T, xs(base), B, 'text', 1.2) + text(xs(base), T - 2, `base ${base}M`, 'middle', 'muted', 8) + sw.map(([lo, hi], i) => { const y = T + 4 + i * step; return text(L + 50, y + step / 2 + 3, inputs[i], 'end') + rect(xs(base + lo), y + 2, xs(base) - xs(base + lo), step - 4, 'neg', 2) + rect(xs(base), y + 2, xs(base + hi) - xs(base), step - 4, 'pos', 2); }).join('') +
          text(xs(base - 5), H - 1, 'low case', 'start', 'muted', 8) + text(xs(base + 5), H - 1, 'high case', 'end', 'muted', 8);
      },
    },

    // ---- NLP (in AI) ---------------------------------------------------------
    {
      cat: 'ai', tool: 'NLP', name: 'Zipf’s law', family: 'Text basics', wiki: 'Zipf%27s_law',
      tip: 'In any large text, the second most common word appears about half as often as the first, the third a third as often, and so on: a straight line on log–log axes. A few words dominate; most are rare.',
      draw(r) {
        const words = ['the', 'of', 'and', 'to', 'a', 'in', 'is', 'data'], s0 = 1 + normal(r) * 0.05, ranks = range(60).map(i => i + 1), f = k => 1 / k ** s0 * (1 + normal(r) * 0.08);
        const xs = scale(0, Math.log10(60), L + 20, R), ys = scale(Math.log10(1 / 60) - 0.3, 0.1, B, T + 4);
        return grid() + ranks.map(k => dot(xs(Math.log10(k)), ys(Math.log10(f(k))), 's1', 2.4, true)).join('') + words.slice(0, 4).map((w, i) => text(xs(Math.log10(i + 1)) + 6, ys(Math.log10(1 / (i + 1))) + 3, w, 'start', 'text', 8)).join('') +
          [1, 10, 50].map(v => text(xs(Math.log10(v)), H - 1, v, 'middle', 'muted', 8)).join('') + text(R, H - 1, 'rank', 'end') + text(L, T + 4, 'frequency') + baseline(B, L + 20, R);
      },
    },
    {
      cat: 'ai', tool: 'NLP', name: 'Most telling words (TF-IDF)', family: 'Text basics', wiki: 'Tf%E2%80%93idf',
      tip: 'TF-IDF scores a word high when it’s frequent in one group of texts but rare overall, so “the” scores near zero while “refund” stands out. A strong, explainable baseline for text classification.',
      draw(r) {
        const pos = ['fast', 'friendly', 'easy', 'love', 'recommend', 'smooth'], neg = ['refund', 'waiting', 'broken', 'never', 'cancel', 'rude'], step = (B - T - 10) / 6, half = (R - L) / 2;
        const col2 = (words, x0, c, label) => text(x0, T + 4, label, 'start', 'text', 9, 700) + words.map((w, i) => { const v = 0.9 - i * 0.12 + r() * 0.06, y = T + 12 + i * step; return text(x0 + 46, y + step / 2 + 3, w, 'end', 'muted', 8) + rect(x0 + 50, y + 2, v * (half - 60), step - 5, c, 2); }).join('');
        return col2(pos, L, 's1', '5-star reviews') + col2(neg, L + half, 's2', '1-star reviews');
      },
    },
    {
      cat: 'ai', tool: 'NLP', name: 'Topic modelling', family: 'Text basics', wiki: 'Topic_model',
      tip: 'Topic models describe each document as a mix of themes, each theme a set of words that tend to appear together. Good for exploring thousands of comments; label and sanity-check the topics yourself.',
      draw(r) {
        const topics = [['delivery', 'late, shipping, days'], ['price', 'cost, expensive, deal'], ['app', 'login, crash, update']], n = 8, bw = (R - L - 4) / n, ys = scale(0, 1, B - 4, T + 30);
        let s = topics.map(([t, w], k) => text(L + k * 82, T + 4, t, 'start', SER[k], 9, 700) + text(L + k * 82, T + 15, w, 'start', 'muted', 7)).join('');
        range(n).forEach(i => {
          const raw = range(3).map(() => Math.exp(normal(r) * 1.3)), tot = sum(raw);
          let acc = 0;
          raw.forEach((v, k) => { const p = v / tot; s += rect(L + i * bw + 3, ys(acc + p), bw - 6, ys(acc) - ys(acc + p), SER[k], 1.5); acc += p; });
          s += text(L + (i + 0.5) * bw, H - 1, `doc ${i + 1}`, 'middle', 'muted', 7);
        });
        return s;
      },
    },

    // ---- geo (in Charts, EDA & geo) ------------------------------------------
    {
      tool: 'Geo', name: 'Normalise your maps', family: 'Maps', wiki: 'Choropleth_map',
      tip: 'A map of raw counts is usually just a population map. Divide by population (or customers, or area) and the real hot spots appear somewhere else entirely.',
      draw(r) {
        const s0 = 7.2, hw = Math.sqrt(3) * s0, hh = 1.5 * s0, nc = 7, nr = 9, city = [2 + r() * 3, 2 + r() * 2], hot = [2 + r() * 3, 5 + r() * 2];
        const map = (x0, val, label) => {
          let s = '', mx = 0;
          range(nr).forEach(j => range(nc).forEach(i => { mx = Math.max(mx, val(i, j)); }));
          for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
            const ex = (i - nc / 2 + 0.5) / (nc / 2), ey = (j - nr / 2 + 0.5) / (nr / 2);
            if (ex * ex + ey * ey > 1.05) continue;
            s += area(range(6).map(a => polar(x0 + i * hw + (j & 1 ? hw / 2 : 0), T + 10 + j * hh, s0 - 0.8, a * Math.PI / 3)), tint('s1', 10 + val(i, j) / mx * 90));
          }
          return s + text(x0 + nc * hw / 2, H - 1, label, 'middle', 'text', 8.5, 600);
        };
        const pop = (i, j) => 0.05 + Math.exp(-((i - city[0]) ** 2 + (j - city[1]) ** 2) / 3), rate = (i, j) => 0.3 + Math.exp(-((i - hot[0]) ** 2 + (j - hot[1]) ** 2) / 2.5);
        return map(L + 6, (i, j) => pop(i, j) * rate(i, j), 'claims (count)') + map(L + 132, rate, 'claims per 1,000');
      },
    },
    {
      tool: 'Geo', name: 'Hexagon grids (H3)', family: 'Spatial aggregation', wiki: 'Discrete_global_grid',
      tip: 'Aggregate points into a global hexagon grid such as H3 instead of postcodes or municipalities: cells have equal size and stable IDs, nest at several resolutions, and join easily in SQL.',
      draw(r) {
        const pts2 = range(700).map(() => { const c = r() < 0.6 ? [0.35, 0.5, 0.12] : [0.7, 0.4, 0.08]; return [c[0] + normal(r) * c[2], c[1] + normal(r) * c[2]]; });
        const panel = (x0, w, s0, label) => {
          const hw = Math.sqrt(3) * s0, hh = 1.5 * s0, counts = new Map(), xs = scale(0, 1, x0, x0 + w), ys = scale(0, 1, B - 8, T + 4);
          pts2.forEach(([x, y]) => { const px = xs(x), py = ys(y); if (px < x0 || px > x0 + w || py < T || py > B) return; const j = Math.round((py - T) / hh), off = (j & 1) ? hw / 2 : 0, i = Math.round((px - x0 - off) / hw), k = `${i},${j}`; counts.set(k, (counts.get(k) || 0) + 1); });
          const mx = Math.max(...counts.values());
          return [...counts].map(([k, c]) => { const [i, j] = k.split(',').map(Number); return area(range(6).map(a => polar(x0 + i * hw + ((j & 1) ? hw / 2 : 0), T + j * hh, s0 - 0.5, a * Math.PI / 3)), tint('s1', 12 + 88 * Math.sqrt(c / mx))); }).join('') + text(x0 + w / 2, H - 1, label, 'middle', 'text', 8.5, 600);
        };
        return panel(L, 112, 9, 'coarse resolution') + panel(L + 128, 112, 4.5, 'fine resolution');
      },
    },
    {
      tool: 'Geo', name: 'Catchment areas', family: 'Spatial analysis', wiki: 'Catchment_area_(human_geography)',
      draw(r) {
        const cx = 118, cy = H / 2 + 4, rings = [22, 42, 62], cs = ['s1', 's2', 's4'], counts = [0, 0, 0, 0];
        let s = rings.slice().reverse().map((rr, i) => `<circle cx="${cx}" cy="${cy}" r="${rr}" style="fill:${tint(cs[2 - i], 10)};stroke:${tint(cs[2 - i], 60)};stroke-dasharray:3 2"/>`).join('');
        range(160).forEach(() => { const a = r() * 2 * Math.PI, d = Math.abs(normal(r)) * 34, x = cx + Math.cos(a) * d * 1.3, y = cy + Math.sin(a) * d * 0.9, dist = Math.hypot(x - cx, y - cy), k = rings.findIndex(rr => dist <= rr); counts[k < 0 ? 3 : k]++; if (y > T && y < B + 6 && x > L && x < 196) s += dot(x, y, k < 0 ? 'muted' : cs[k], 1.8); });
        s += rect(cx - 4, cy - 4, 8, 8, 'text', 1.5);
        const tot = sum(counts);
        return {
          svg: s + ['10 min', '20 min', '30 min', 'further'].map((l, i) => dot(206, T + 30 + i * 16, i < 3 ? cs[i] : 'muted', 4) + text(214, T + 33 + i * 16, `${l} ${Math.round(counts[i] / tot * 100)}%`, 'start', 'text', 8)).join(''),
          tip: `Who lives within reach of a store? Rings by travel time (here simplified as distance) show that ${Math.round((counts[0] + counts[1]) / tot * 100)}% of customers are within 20 minutes. Use real travel-time isochrones for decisions.`,
        };
      },
    },

    // ---- BI & dashboards (in Communication & BI) ----------------------------
    {
      cat: 'comm', tool: 'BI', name: 'Dashboard layout', family: 'Dashboards',
      tip: 'Put the few numbers that matter on top, the trend in the middle and breakdowns below: the reader goes from “how are we doing?” to “why?” Top-left gets the most attention.',
      draw(r) {
        const kpis = [['revenue', '4.2M', '+6%'], ['orders', '18.4k', '+2%'], ['conversion', '2.9%', '−0.3pt'], ['NPS', '41', '+3']];
        let s = kpis.map(([l, v, d], i) => { const x = L + i * 61; return rect(x, T - 4, 56, 36, 'card-2', 4) + text(x + 5, T + 6, l, 'start', 'muted', 7) + text(x + 5, T + 21, v, 'start', 'text', 11, 700) + text(x + 5, T + 29, d, 'start', d.startsWith('−') ? 'neg' : 's3', 7, 700); }).join('');
        const tr = range(30).map(i => 50 + i + Math.sin(i / 3) * 6 + normal(r) * 3), xs = scale(0, 29, L + 4, L + 150), ys = scale(Math.min(...tr), Math.max(...tr), T + 86, T + 44);
        s += rect(L, T + 38, 156, 54, 'card-2', 4) + poly(tr.map((v, i) => [xs(i), ys(v)]), 's1', 1.5) + rect(L + 162, T + 38, 78, 54, 'card-2', 4) + range(4).map(i => rect(L + 168, T + 46 + i * 11, 60 - i * 12, 7, 's1', 1.5)).join('');
        s += rect(L, T + 98, 240, 30, 'card-2', 4) + range(3).map(i => rect(L + 6, T + 104 + i * 7, 228, 4, 'grid', 1)).join('');
        return s + text(R, B + 9, 'overview → trend → detail', 'end', 'muted', 7.5);
      },
    },
    {
      cat: 'comm', tool: 'BI', name: 'Pie chart or bar chart?', family: 'Dashboards', wiki: 'Pie_chart',
      tip: 'People compare lengths far more accurately than angles. With more than two or three slices, a sorted bar chart shows the same shares and lets readers actually rank them.',
      draw(r) {
        const raw = range(7).map(() => 0.5 + r()), tot = sum(raw), sh = raw.map(v => v / tot).sort((a, b) => b - a), names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
        const pal = ['s1', 's2', 's3', 's4', 's5', 'muted', 'axis'], cx = L + 52, cy = H / 2 + 2;
        let a = 0, s = '';
        shuffle(range(7), r).forEach(i => { const sp = sh[i] * 2 * Math.PI; s += path(arc(cx, cy, 0.01, 50, a, a + sp - 0.002), pal[i]); a += sp; });
        const step = (B - T + 2) / 7, xs = scale(0, sh[0] * 1.1, 150, R);
        return s + sh.map((p, i) => text(146, T + i * step + step / 2 + 2, names[i], 'end', 'muted', 8) + rect(150, T - 2 + i * step + 2, xs(p) - 150, step - 4, 's1', 2)).join('') + text(cx, H - 1, 'which is bigger, C or D?', 'middle', 'muted', 7.5);
      },
    },
    {
      cat: 'comm', tool: 'BI', name: 'A KPI tile with context', family: 'Dashboards',
      draw(r) {
        const v = 2.4 + r() * 0.8, target = 3, prev = v * (1 + normal(r) * 0.08), tr = range(26).map(i => v * (0.85 + i * 0.006) + normal(r) * 0.06);
        tr[25] = v;
        const xs = scale(0, 25, L + 120, R), ys = scale(Math.min(...tr, target) - 0.1, Math.max(...tr, target) + 0.1, B - 10, T + 22), d = (v - prev) / prev * 100;
        return {
          svg: text(L, T + 6, 'Conversion rate · last 7 days', 'start', 'muted', 9) + text(L, T + 52, `${v.toFixed(2)}%`, 'start', 'text', 30, 700) +
            text(L, T + 72, `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}% vs prior week`, 'start', d >= 0 ? 's3' : 'neg', 9, 700) + text(L, T + 88, `target ${target.toFixed(1)}%`, 'start', 'muted', 9) +
            line(L + 120, ys(target), R, ys(target), 'muted', 1, '3 3') + poly(tr.map((y, i) => [xs(i), ys(y)]), 's1', 1.8) + dot(xs(25), ys(v), 's1', 3.5, true) + text(R, ys(target) - 3, 'target', 'end', 'muted', 7.5) + text(L, B + 8, 'updated today 07:00', 'start', 'muted', 7.5),
          tip: 'A number alone means nothing. Show its comparison (previous period), the goal, the recent trend and when the data was last refreshed: then the tile answers “is this good?” on its own.',
        };
      },
    },
  ];

  // A gallery is a source that picks one type per box. Types can draw an SVG
  // (draw), show code (code + lang), or be text only (just tip). The kicker
  // shows the tool (Git, dbt, EDA…) or language if given, else the category.
  const CATS = { chart: 'Chart', biz: 'Analytics', stats: 'Statistics', ts: 'Time series', causal: 'Causal', ml: 'ML', graph: 'Graphs', ai: 'AI', eng: 'Engineering', comm: 'Communication' };
  const LANGS = { sql: 'SQL', python: 'Python' };
  const kicker = type => `${type.tool || LANGS[type.lang] || CATS[type.cat || 'chart']} · ${type.family}`;
  // Types sit on a lattice: index = (x + k·y) mod n, so each one repeats on a
  // regular grid. latticeStep picks the k whose shortest repeat is longest
  // (about √n boxes in every direction).
  function latticeStep(n) {
    let best = 1, bestD = -1, bestE = 0;
    for (let k = 1; k < n; k++) {
      let d = n, e = n * n;
      for (let dy = 1; dy <= d; dy++) {
        let dx = ((-k * dy) % n + n) % n;
        if (dx > n / 2) dx -= n;
        const c = Math.max(Math.abs(dx), dy), e2 = dx * dx + dy * dy;
        if (c < d || (c === d && e2 < e)) { d = c; e = e2; }
      }
      if (d > bestD || (d === bestD && e > bestE)) { best = k; bestD = d; bestE = e; }
    }
    return best;
  }
  function makeGallery(id, label, types) {
    // Built lazily: decks.js adds types after the galleries exist. The shuffle
    // keeps related topics from lining up side by side.
    let n = 0, k = 1, order = [];
    const seed = [...id].reduce((h, c) => cellHash(h, c.charCodeAt(0), 13), 0);
    const typeAt = (x, y) => {
      if (n !== types.length) { n = types.length; k = latticeStep(n); order = shuffle(types.slice(), rng(seed)); }
      return order[((x + k * y) % n + n) % n];
    };
    return {
      id,
      label,
      types,
      typeAt,
      kicker,
      async load(x, y) {
        await new Promise(res => setTimeout(res, 80 + cellHash(x, y, 3) % 250)); // pretend it's remote
        const type = typeAt(x, y);
        const out = type.draw ? type.draw(rng(cellHash(x, y, 12))) : null;
        const { svg, tip } = out == null ? { tip: type.tip } : typeof out === 'string' ? { svg: out, tip: type.tip } : out;
        return {
          kicker: kicker(type),
          title: type.name,
          svg: svg && `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${type.name}">${svg}</svg>`,
          code: type.code,
          lang: type.lang,
          body: tip,
          url: type.url || (type.wiki && `https://en.wikipedia.org/wiki/${type.wiki}`),
        };
      },
    };
  }

  // One source per category, in picker order. decks.js adds static cards via addTypes.
  const SOURCES = [
    ['charts', 'Charts, EDA & geo', 'chart'], ['biz', 'Analytics & metrics', 'biz'], ['stats', 'Statistics & decisions', 'stats'],
    ['ts', 'Time series', 'ts'], ['causal', 'Causal & experiments', 'causal'], ['ml', 'Machine learning', 'ml'],
    ['graph', 'Graph analytics', 'graph'], ['ai', 'AI & NLP', 'ai'], ['code', 'Code & data engineering', 'code'],
    ['eng', 'Engineering & MLOps', 'eng'], ['comm', 'Communication & BI', 'comm'],
  ];
  const byCat = {};
  const galleries = SOURCES.map(([id, label, cat]) => makeGallery(id, label, (byCat[cat] = [])));
  const addTypes = list => list.forEach(t => byCat[t.cat || 'chart'].push(t));
  addTypes(TYPES);
  return { makeGallery, addTypes, galleries };
})();
