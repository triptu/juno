/*
 * Channel marks: a deterministic generative SVG system for Juno.
 *
 * Reference implementation. Plain JS, no dependencies. The real
 * implementation ports this; keep it readable rather than clever.
 *
 *   mark({ id, name, purpose, topic }, { style, theme, size, semantic, seed })
 *     -> SVG string
 *
 * - id       Slack channel id. The only thing the random stream depends on.
 * - name     channel name. Only read by the semantic layer.
 * - style    one of STYLES (a letter).
 * - theme    'light' | 'dark'. Same shapes, different tonal direction.
 * - size     pixel size of the output (40 for the tile, 14 to 16 on the meta line).
 *            Below 20px the mark drops its smallest details.
 * - semantic true to let keywords in the name bias the palette and motif.
 * - seed     optional override, used by Shuffle. Default is the id.
 *
 * Same inputs always give the same string, so the caller can memoise on
 * `${style}:${theme}:${size}:${seed}`.
 */
(function (factory) {
  const api = factory();
  globalThis.ChannelMarks = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Random stream
  // ---------------------------------------------------------------------

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
    };
  }

  // ---------------------------------------------------------------------
  // Colour. Everything is defined in OKLCH and converted to sRGB hex.
  // ---------------------------------------------------------------------

  function oklchToRgb(L, C, h) {
    const hr = (h * Math.PI) / 180;
    const a = C * Math.cos(hr);
    const b = C * Math.sin(hr);
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    return [r, g, bb];
  }

  function inGamut(rgb) {
    return rgb.every((v) => v >= -0.0005 && v <= 1.0005);
  }

  function toSrgb(v) {
    v = Math.min(1, Math.max(0, v));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function hex(rgb) {
    return (
      '#' +
      rgb
        .map((v) => Math.round(toSrgb(v) * 255).toString(16).padStart(2, '0'))
        .join('')
    );
  }

  // Reduce chroma until the colour fits sRGB. Keeps lightness, which is
  // what matters for the tonal relationships below.
  function oklch(L, C, h) {
    let c = C;
    let rgb = oklchToRgb(L, c, h);
    while (!inGamut(rgb) && c > 0) {
      c -= 0.005;
      rgb = oklchToRgb(L, c, h);
    }
    return hex(rgb);
  }

  // Eight hue anchors. They sit a little warm so they agree with the paper
  // surfaces and the Coral accent (Coral itself is about hue 30).
  const HUES = {
    coral: 32,
    amber: 72,
    olive: 112,
    sage: 150,
    teal: 185,
    sky: 235,
    periwinkle: 275,
    plum: 320,
  };
  const HUE_NAMES = Object.keys(HUES);

  // Tonal roles for one hue. Light theme: a pale base with deeper shapes.
  // Dark theme: a deep base with brighter shapes. The silhouette is the
  // same in both, only the direction of contrast flips, so a mark stays
  // recognisable when the theme changes.
  const RAMP = {
    light: {
      base: [0.88, 0.045],
      soft: [0.8, 0.08],
      mid: [0.7, 0.11],
      deep: [0.55, 0.12],
      pale: [0.95, 0.025],
    },
    dark: {
      base: [0.36, 0.06],
      soft: [0.46, 0.085],
      mid: [0.6, 0.11],
      deep: [0.74, 0.1],
      pale: [0.28, 0.04],
    },
  };

  function tones(hue, theme) {
    const r = RAMP[theme];
    const t = {};
    for (const k of Object.keys(r)) t[k] = oklch(r[k][0], r[k][1], hue);
    return t;
  }

  // ---------------------------------------------------------------------
  // Semantic layer. Keywords in the channel name bias the hue and, for
  // families that have one, the motif. A later version can let an AI pick
  // the same fields from name and purpose; the shape of the bias stays.
  // ---------------------------------------------------------------------

  const KEYWORDS = [
    { re: /alert|incident|oncall|on-call|pager|outage|sev/, hue: 'coral', energy: 1, motif: 'rise' },
    { re: /deploy|release|ship|ci\b|build|pipeline/, hue: 'amber', energy: 0.7, motif: 'rise' },
    { re: /design|ux|brand|visual|figma/, hue: 'plum', energy: 0.5, motif: 'soft' },
    { re: /hiring|recruit|people|hr\b|culture|team/, hue: 'sage', energy: 0.4, motif: 'soft' },
    { re: /eng|platform|infra|backend|frontend|dev|api|data|sre|ops/, hue: 'teal', energy: 0.3, motif: 'grid' },
    { re: /product|roadmap|planning|q[1-4]|okr|strategy/, hue: 'periwinkle', energy: 0.4, motif: 'grid' },
    { re: /random|social|fun|watercooler|pets|music|food|lunch/, hue: 'amber', energy: 1, motif: 'scatter' },
    { re: /sales|revenue|deal|customer|growth|marketing|launch/, hue: 'coral', energy: 0.7, motif: 'rise' },
    { re: /leader|exec|board|staff|founders/, hue: 'periwinkle', energy: 0.2, motif: 'calm' },
    { re: /support|help|success|community/, hue: 'olive', energy: 0.4, motif: 'soft' },
    { re: /finance|legal|security|compliance|admin/, hue: 'olive', energy: 0.2, motif: 'calm' },
    { re: /announce|general|all-hands|company/, hue: 'sky', energy: 0.3, motif: 'calm' },
  ];

  function semantics(name) {
    const n = (name || '').toLowerCase();
    for (const k of KEYWORDS) if (k.re.test(n)) return k;
    return null;
  }

  // ---------------------------------------------------------------------
  // Shared scaffolding
  // ---------------------------------------------------------------------

  const SIZE = 40; // design space; every family draws in a 40 x 40 box
  const RADIUS = 16; // tile radius at 40px; scales with the viewBox

  function f(n) {
    return Math.round(n * 100) / 100;
  }

  function wrap(inner, defs, ctx) {
    const { size, theme, uid } = ctx;
    const edge =
      theme === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">` +
      `<defs><clipPath id="${uid}c"><rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}"/></clipPath>${defs || ''}</defs>` +
      `<g clip-path="url(#${uid}c)">${inner}</g>` +
      `<rect x="0.5" y="0.5" width="${SIZE - 1}" height="${SIZE - 1}" rx="${RADIUS - 0.5}" fill="none" stroke="${edge}"/>` +
      `</svg>`
    );
  }

  // Pick the hue pair for a mark: a main hue and a partner. Partners are
  // usually analogous (one step round the wheel) so a list of marks stays
  // calm; with higher energy the partner sits further away.
  function chooseHues(r, sem, energy) {
    let mainName = sem ? sem.hue : r.pick(HUE_NAMES);
    const i = HUE_NAMES.indexOf(mainName);
    const step = energy > 0.8 ? r.pick([2, 3, 5, 6]) : energy > 0.5 ? r.pick([1, 2, 7]) : r.pick([1, 7]);
    const partnerName = HUE_NAMES[(i + step) % HUE_NAMES.length];
    return { main: HUES[mainName], partner: HUES[partnerName], mainName, partnerName };
  }

  // ---------------------------------------------------------------------
  // A. Bloom: two or three soft radial blobs on a tinted base.
  // ---------------------------------------------------------------------

  function bloom(ctx) {
    const { r, theme, uid, small, hues } = ctx;
    const a = tones(hues.main, theme);
    const b = tones(hues.partner, theme);
    // Blob centres sit near or past the edge so the tile reads as a wash
    // of colour, not a ball. Six placements, mirrored by the random stream.
    const T = [
      { big: [34, 34], part: [4, 8], third: [30, 4] },
      { big: [6, 34], part: [34, 6], third: [4, 4] },
      { big: [36, 8], part: [6, 34], third: [36, 36] },
      { big: [6, 6], part: [36, 32], third: [6, 38] },
      { big: [20, 40], part: [20, -2], third: [42, 20] },
      { big: [40, 20], part: [-2, 20], third: [20, 42] },
    ];
    const t = r.pick(T);
    const bigR = r.range(26, 32);
    const partR = r.range(18, 24);
    const defs =
      `<linearGradient id="${uid}w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a.base}"/><stop offset="1" stop-color="${a.soft}"/></linearGradient>` +
      `<radialGradient id="${uid}a"><stop offset="0" stop-color="${a.mid}"/><stop offset="0.45" stop-color="${a.mid}"/><stop offset="1" stop-color="${a.mid}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${uid}b"><stop offset="0" stop-color="${b.mid}"/><stop offset="0.35" stop-color="${b.mid}"/><stop offset="1" stop-color="${b.mid}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${uid}d"><stop offset="0" stop-color="${a.deep}"/><stop offset="1" stop-color="${a.deep}" stop-opacity="0"/></radialGradient>`;
    let inner = `<rect width="40" height="40" fill="url(#${uid}w)"/>`;
    inner += `<circle cx="${f(t.big[0])}" cy="${f(t.big[1])}" r="${f(bigR)}" fill="url(#${uid}a)"/>`;
    inner += `<circle cx="${f(t.part[0])}" cy="${f(t.part[1])}" r="${f(partR)}" fill="url(#${uid}b)"/>`;
    // a deeper pool inside the big blob gives it a focal point
    inner += `<circle cx="${f(t.big[0] * 0.8 + 4)}" cy="${f(t.big[1] * 0.8 + 4)}" r="${f(small ? 14 : r.range(10, 14))}" fill="url(#${uid}d)" opacity="0.6"/>`;
    if (!small && r.chance(0.35)) {
      inner += `<circle cx="${f(t.third[0])}" cy="${f(t.third[1])}" r="${f(r.range(3, 4))}" fill="${a.pale}" opacity="0.9"/>`;
    }
    return wrap(inner, defs, ctx);
  }

  // ---------------------------------------------------------------------
  // B. Blocks: Bauhaus compositions on a 2 x 2 grid, flat colour.
  // ---------------------------------------------------------------------

  function blocks(ctx) {
    const { r, theme, small, hues, sem } = ctx;
    const a = tones(hues.main, theme);
    const b = tones(hues.partner, theme);
    let rot = r.pick([0, 90, 180, 270]);
    // Each template is drawn once, then rotated. Shapes are quarter and
    // half discs, full discs and bars, all snapped to the grid.
    const T = [
      // quarter disc in a corner, small disc opposite
      () =>
        `<path d="M0 40 A40 40 0 0 1 40 0 L40 40 Z" fill="${a.mid}"/>` +
        `<circle cx="11" cy="11" r="7" fill="${b.mid}"/>`,
      // half disc on top, bar below
      () =>
        `<path d="M0 20 A20 20 0 0 1 40 20 Z" fill="${a.mid}"/>` +
        `<rect x="0" y="26" width="40" height="14" fill="${b.soft}"/>` +
        (small ? '' : `<circle cx="20" cy="20" r="5" fill="${a.deep}"/>`),
      // big disc with a quarter behind
      () =>
        `<path d="M40 0 L40 40 L0 40 A40 40 0 0 0 40 0 Z" fill="${b.soft}"/>` +
        `<circle cx="17" cy="17" r="12" fill="${a.mid}"/>`,
      // two stacked half discs
      () =>
        `<path d="M0 20 A20 20 0 0 1 40 20 Z" fill="${a.mid}"/>` +
        `<path d="M0 40 A20 20 0 0 1 40 40 Z" fill="${b.mid}"/>`,
      // diagonal split plus a dot
      () =>
        `<path d="M0 0 L40 0 L0 40 Z" fill="${a.mid}"/>` +
        `<circle cx="27" cy="27" r="8" fill="${b.mid}"/>`,
      // tall bar and a disc
      () =>
        `<rect x="0" y="0" width="16" height="40" fill="${a.mid}"/>` +
        `<circle cx="28" cy="14" r="9" fill="${b.mid}"/>` +
        (small ? '' : `<rect x="20" y="30" width="20" height="10" fill="${a.deep}"/>`),
      // arch: a half disc standing on a bar
      () =>
        `<path d="M8 40 L8 22 A12 12 0 0 1 32 22 L32 40 Z" fill="${a.mid}"/>` +
        `<rect x="0" y="0" width="40" height="8" fill="${b.soft}"/>`,
      // two bars and a dot
      () =>
        `<rect x="0" y="6" width="40" height="10" fill="${a.mid}"/>` +
        `<rect x="0" y="24" width="40" height="10" fill="${b.soft}"/>` +
        (small ? '' : `<circle cx="30" cy="11" r="5" fill="${a.deep}"/>`),
    ];
    // The semantic motif narrows which templates a channel can get.
    const BY_MOTIF = { rise: [1, 6], grid: [0, 5], soft: [2, 3], scatter: [0, 2], calm: [7, 5] };
    const pool = sem && BY_MOTIF[sem.motif] ? BY_MOTIF[sem.motif] : T.map((_, i) => i);
    const i = r.pick(pool);
    if (i === 7) rot = r.pick([0, 180]); // bars stay horizontal
    const inner =
      `<rect width="40" height="40" fill="${a.base}"/>` +
      `<g transform="rotate(${rot} 20 20)">${T[i]()}</g>`;
    return wrap(inner, '', ctx);
  }

  // ---------------------------------------------------------------------
  // C. Sunset: concentric bands rising from an edge, hue stepping.
  // ---------------------------------------------------------------------

  function sunset(ctx) {
    const { r, theme, small, hues, sem } = ctx;
    const a = tones(hues.main, theme);
    const b = tones(hues.partner, theme);
    // A sun on a horizon. The sky is the base, the ground the deep tone,
    // the sun the partner hue with one or two halos in the main hue.
    const flip = sem && sem.motif === 'rise' ? false : r.chance(0.3);
    const horizon = r.range(20, 31);
    const sx = r.pick([12, 16, 20, 24, 28]);
    const sr = r.range(6, 9);
    const halos = small ? 1 : r.int(1, 2);
    let inner = `<rect width="40" height="40" fill="${a.base}"/>`;
    for (let i = halos; i >= 1; i--) {
      inner += `<circle cx="${sx}" cy="${f(horizon)}" r="${f(sr + i * 5)}" fill="${i === 2 ? a.soft : a.mid}"/>`;
    }
    inner += `<circle cx="${sx}" cy="${f(horizon)}" r="${f(sr)}" fill="${b.mid}"/>`;
    inner += `<rect x="0" y="${f(horizon)}" width="40" height="40" fill="${a.deep}"/>`;
    if (flip) inner = `<g transform="rotate(180 20 20)">${inner}</g>`;
    return wrap(inner, '', ctx);
  }

  // ---------------------------------------------------------------------
  // D. Terrazzo: a few rounded chips in three tones on a tinted base.
  // ---------------------------------------------------------------------

  function terrazzo(ctx) {
    const { r, theme, small, hues } = ctx;
    const a = tones(hues.main, theme);
    const b = tones(hues.partner, theme);
    const fills = [a.mid, a.deep, b.mid, a.soft];
    let inner = `<rect width="40" height="40" fill="${a.base}"/>`;
    // Chips sit on a jittered 3 x 3 grid so they never clump.
    const cells = [];
    for (let gy = 0; gy < 2; gy++) for (let gx = 0; gx < 2; gx++) cells.push([gx, gy]);
    const count = small ? 3 : r.int(3, 4);
    // shuffle cells deterministically
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(r.next() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (let i = 0; i < count; i++) {
      const [gx, gy] = cells[i];
      const cx = 11 + gx * 18 + r.range(-3, 3);
      const cy = 11 + gy * 18 + r.range(-3, 3);
      const w = r.range(14, 20);
      const h = w * r.range(0.6, 0.9);
      const rot = r.int(0, 180);
      inner += `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${f(Math.min(w, h) * 0.45)}" fill="${fills[i % fills.length]}" transform="rotate(${rot} ${f(cx)} ${f(cy)})"/>`;
    }
    return wrap(inner, '', ctx);
  }

  // ---------------------------------------------------------------------
  // E. Tide: three bands with wavy edges, optional tilt.
  // ---------------------------------------------------------------------

  function wavePath(y, amp, phase, wavelength) {
    // one smooth wave across the 40px box, closed to the bottom
    let d = `M-10 ${f(y)}`;
    const seg = wavelength / 2;
    for (let x = -10; x < 50; x += wavelength) {
      const up = Math.sin(phase) >= 0 ? -amp : amp;
      d += ` q ${f(seg / 2)} ${f(up * 2)} ${f(seg)} 0 q ${f(seg / 2)} ${f(-up * 2)} ${f(seg)} 0`;
    }
    d += ' L50 60 L-10 60 Z';
    return d;
  }

  function tide(ctx) {
    const { r, theme, small, hues, sem } = ctx;
    const a = tones(hues.main, theme);
    const b = tones(hues.partner, theme);
    const calm = sem && sem.motif === 'calm';
    const tilt = calm ? 0 : r.pick([0, 0, -18, 18]);
    const amp = calm ? 1.5 : r.range(1.5, 4);
    const wavelength = r.pick([20, 26, 32, 40]);
    const two = r.chance(0.4);
    const layers = two
      ? [
          { y: r.range(16, 22), fill: a.mid },
          { y: r.range(28, 34), fill: b.mid },
        ]
      : [
          { y: r.range(11, 16), fill: b.soft },
          { y: r.range(22, 27), fill: a.mid },
          { y: r.range(31, 35), fill: a.deep },
        ];
    let inner = `<rect width="40" height="40" fill="${a.base}"/>`;
    inner += `<g transform="rotate(${tilt} 20 20)">`;
    layers.forEach((l, i) => {
      if (small && !two && i === 0) return;
      inner += `<path d="${wavePath(l.y, amp, i * Math.PI, wavelength)}" fill="${l.fill}"/>`;
    });
    inner += '</g>';
    if (!small && (r.chance(0.4) || (sem && sem.motif === 'rise'))) {
      inner += `<circle cx="${r.pick([10, 30])}" cy="8" r="4" fill="${theme === 'dark' ? a.deep : a.pale}"/>`;
    }
    return wrap(inner, '', ctx);
  }

  // ---------------------------------------------------------------------
  // F. Hills: a tiny landscape. Sky, a sun or moon, two hills.
  // ---------------------------------------------------------------------

  function hills(ctx) {
    const { r, theme, uid, small, hues, sem } = ctx;
    const a = tones(hues.main, theme);
    const b = tones(hues.partner, theme);
    const light = theme === 'dark' ? a.deep : a.pale; // the sun is always the lightest tone
    const defs = `<linearGradient id="${uid}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.soft}"/><stop offset="1" stop-color="${a.base}"/></linearGradient>`;
    let inner = `<rect width="40" height="40" fill="url(#${uid}s)"/>`;
    const scene = sem && sem.motif === 'calm' ? 'one' : r.pick(['two', 'two', 'valley', 'one', 'ridge']);
    if (r.chance(0.7) || (sem && sem.motif === 'rise')) {
      const sunX = r.pick([9, 14, 20, 26, 31]);
      inner += `<circle cx="${sunX}" cy="${f(r.range(9, 15))}" r="${f(small ? 5 : r.range(3.5, 6))}" fill="${light}"/>`;
    }
    const side = r.pick([-1, 1]);
    if (scene === 'two') {
      inner += `<ellipse cx="${f(20 + side * 14)}" cy="${f(r.range(36, 41))}" rx="26" ry="16" fill="${a.mid}"/>`;
      inner += `<ellipse cx="${f(20 - side * 10)}" cy="${f(r.range(44, 48))}" rx="28" ry="16" fill="${a.deep}"/>`;
    } else if (scene === 'valley') {
      inner += `<ellipse cx="-4" cy="${f(r.range(34, 40))}" rx="24" ry="18" fill="${a.mid}"/>`;
      inner += `<ellipse cx="44" cy="${f(r.range(34, 40))}" rx="24" ry="18" fill="${a.deep}"/>`;
    } else if (scene === 'one') {
      inner += `<ellipse cx="${f(20 + side * 6)}" cy="${f(r.range(42, 48))}" rx="30" ry="20" fill="${a.deep}"/>`;
    } else {
      // ridge: a flat ground with one hill
      inner += `<ellipse cx="${f(20 + side * 12)}" cy="${f(r.range(40, 44))}" rx="20" ry="16" fill="${a.mid}"/>`;
      inner += `<rect x="0" y="${f(r.range(30, 34))}" width="40" height="12" fill="${a.deep}"/>`;
    }
    return wrap(inner, defs, ctx);
  }

  // ---------------------------------------------------------------------
  // Group DMs: the recommended family (Bloom) using the participants'
  // person hues instead of a hashed hue, so the mark is "those people".
  // ---------------------------------------------------------------------

  function groupBloom(ctx, personHues) {
    const { theme, uid } = ctx;
    const hs = personHues.slice(0, 3);
    const t = hs.map((h) => tones(h, theme));
    const pos = [
      [12, 12],
      [29, 16],
      [18, 30],
    ];
    let defs = '';
    let inner = `<rect width="40" height="40" fill="${t[0].base}"/>`;
    t.forEach((tt, i) => {
      defs += `<radialGradient id="${uid}g${i}"><stop offset="0" stop-color="${tt.mid}"/><stop offset="0.4" stop-color="${tt.mid}"/><stop offset="1" stop-color="${tt.mid}" stop-opacity="0"/></radialGradient>`;
      inner += `<circle cx="${pos[i][0]}" cy="${pos[i][1]}" r="20" fill="url(#${uid}g${i})"/>`;
    });
    return wrap(inner, defs, ctx);
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  const STYLES = {
    A: { name: 'Bloom', draw: bloom },
    B: { name: 'Blocks', draw: blocks },
    C: { name: 'Sunset', draw: sunset },
    D: { name: 'Terrazzo', draw: terrazzo, dropped: 'chips turn to noise at 16px and the overlaps read as camouflage' },
    E: { name: 'Tide', draw: tide },
    F: { name: 'Hills', draw: hills },
  };

  function mark(channel, opts) {
    const style = STYLES[opts.style] || STYLES.A;
    const theme = opts.theme === 'dark' ? 'dark' : 'light';
    const size = opts.size || 40;
    const seed = opts.seed != null ? String(opts.seed) : channel.id;
    const h = hash(seed);
    const r = rng(h);
    const sem = opts.semantic ? semantics(channel.name) : null;
    const energy = sem ? sem.energy : 0.3;
    const hues = chooseHues(r, sem, energy);
    const uid = 'm' + h.toString(36) + opts.style + theme[0] + (size < 20 ? 's' : '');
    const ctx = { r, theme, size, uid, small: size < 20, hues, sem };
    if (opts.group && opts.group.length) return groupBloom(ctx, opts.group);
    return style.draw(ctx);
  }

  return { mark, STYLES, HUES, KEYWORDS, semantics, hash, tones, oklch };
});
