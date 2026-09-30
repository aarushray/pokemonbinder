// Shared binder mockup renderer: engraves a design onto a solid-colour binder of a given type.
// Used by the shop, product, cart, admin and Custom Designs pages. Requires catalog.js.
(function () {
  const { COLORS, DEFAULT_DEPTH, TYPES, DEFAULT_TYPE } = window.Catalog;

  // Engraving settings are fixed, not user-adjustable.
  const CLEAN = 0.08; // ignore faint grey paper tones in the design

  // Geometry at scale 1. Every cover is 1000px wide; its height follows the type's art ratio,
  // so artwork in that ratio fills the cover exactly.
  const COVER_W = 1000;
  const PAD = 70;
  const LEFT_RADIUS = 18;

  function getType(id) {
    return TYPES.find((t) => t.id === id) || TYPES.find((t) => t.id === DEFAULT_TYPE);
  }

  function typeColors(id) {
    const ids = getType(id).colors;
    return COLORS.filter((c) => ids.includes(c.id));
  }

  // Texture choices for a binder type (e.g. diamond / velvet), or null if it has none.
  function finishes(typeId) {
    return getType(typeId).finishes || null;
  }

  function finishColors(typeId, finishId) {
    const f = (finishes(typeId) || []).find((f) => f.id === finishId);
    return f ? COLORS.filter((c) => f.colors.includes(c.id)) : typeColors(typeId);
  }

  // The texture choice a colour belongs to (the first one for colours not listed, e.g. custom).
  function finishOf(typeId, colorId) {
    const list = finishes(typeId);
    if (!list) return null;
    return (list.find((f) => f.colors.includes(colorId)) || list[0]).id;
  }

  // Extra cost of a texture (velvet +5), or 0.
  function finishExtra(typeId, finishId) {
    const f = (finishes(typeId) || []).find((f) => f.id === finishId);
    return (f && f.extraPrice) || 0;
  }

  // Texture name for dropdowns, with its surcharge, e.g. "Velvet texture (+5)".
  function finishLabel(f) {
    return f.extraPrice ? `${f.name} (+${f.extraPrice})` : f.name;
  }

  // A colour value is a COLORS id, or any hex code (custom colours from the colour wheel).
  // Anything else (e.g. a colour since removed from the catalogue) falls back to the first colour.
  function resolveColor(value) {
    const c = COLORS.find((c) => c.id === value);
    if (c) return { hex: c.hex, texture: c.texture || 'diamond', depth: c.depth || DEFAULT_DEPTH };
    if (/^#[0-9a-f]{6}$/i.test(value)) return { hex: value, texture: 'diamond', depth: DEFAULT_DEPTH };
    return resolveColor(COLORS[0].id);
  }

  function colorHex(value) {
    return resolveColor(value).hex;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgb([r, g, b], a = 1) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
  }

  function shade(c, f) {
    return c.map((v) => Math.max(0, Math.min(255, v * f)));
  }

  function luminance([r, g, b]) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  // Colour the laser burns the material to. Calibrated against a pink sample photo:
  // base (230,169,176) engraves to roughly (154,69,74). Dark binders get lighter instead.
  function engraveColor(base) {
    if (luminance(base) < 0.28) {
      return base.map((v) => v + (255 - v) * 0.42);
    }
    return base.map((v) => v * Math.pow(v / 255, 1.5) * 0.8);
  }

  function colorName(value) {
    const c = COLORS.find((c) => c.id === value);
    if (c) return c.name;
    return /^#[0-9a-f]{6}$/i.test(value) ? `Custom (${value})` : COLORS[0].name;
  }

  // Smooth random blotches: bilinear value noise on a grid of cellX × cellY px with smoothstep easing.
  function valueNoise(w, h, cellX, cellY = cellX) {
    const gw = Math.ceil(w / cellX) + 2;
    const gh = Math.ceil(h / cellY) + 2;
    const grid = new Float32Array(gw * gh).map(() => Math.random());
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const gy = y / cellY;
      const y0 = Math.floor(gy);
      let fy = gy - y0;
      fy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < w; x++) {
        const gx = x / cellX;
        const x0 = Math.floor(gx);
        let fx = gx - x0;
        fx = fx * fx * (3 - 2 * fx);
        const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
        const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
        out[y * w + x] = (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
      }
    }
    return out;
  }

  // Fractal noise: sum of value-noise octaves (cell sizes and weights given), stretched `stretchX`
  // times wider than tall, normalised to mean 0 and standard deviation 1.
  function fbm(w, h, cells, weights, stretchX = 1) {
    const out = new Float32Array(w * h);
    cells.forEach((cell, k) => {
      const n = valueNoise(w, h, cell * stretchX, cell);
      for (let i = 0; i < out.length; i++) out[i] += (n[i] - 0.5) * weights[k];
    });
    let mean = 0;
    for (let i = 0; i < out.length; i++) mean += out[i];
    mean /= out.length;
    let v = 0;
    for (let i = 0; i < out.length; i++) v += (out[i] - mean) ** 2;
    const sd = Math.sqrt(v / out.length) || 1;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd;
    return out;
  }

  // Surface textures (brightness multipliers), cached per size and kind:
  // diamond: raised diamond-plate pattern (the default for every binder colour except velvet ones).
  // felt:  suede-like mottling modelled on a grey felt binder photo: soft, slightly horizontal
  //        light/dark patches (about ±7% brightness) with thin lighter streaks and fine grain, no weave.
  const textures = new Map();
  function getTexture(w, h, scale, kind = 'diamond') {
    const key = `${w}x${h}:${kind}`;
    if (kind === 'felt' && !textures.has(key)) {
      const s = (px) => Math.max(2, px * scale);
      // Layered clouds from coarse to fine, slightly stretched sideways, then domain-warped so the
      // patches look organic rather than grid-like. Light wisps are the peaks of a second layer.
      const cloud = fbm(w, h, [200, 100, 50, 25, 12, 6].map(s), [1, 0.85, 0.62, 0.42, 0.26, 0.15], 1.4);
      const wisp = fbm(w, h, [130, 65, 32, 16, 8].map(s), [1, 0.75, 0.5, 0.3, 0.18], 1.8);
      const warpX = valueNoise(w, h, s(180));
      const warpY = valueNoise(w, h, s(180));
      const warp = s(55);
      const t = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const sx = Math.min(w - 1, Math.max(0, Math.round(x + (warpX[i] - 0.5) * 2 * warp)));
          const sy = Math.min(h - 1, Math.max(0, Math.round(y + (warpY[i] - 0.5) * 2 * warp)));
          const j = sy * w + sx;
          const light = Math.max(0, wisp[j] - 0.45);
          t[i] = 1 + cloud[j] * 0.058 + light * 0.08 - 0.012 + (Math.random() - 0.5) * 0.045;
        }
      }
      textures.set(key, t);
    }
    if (!textures.has(key)) {
      // Diamond texture: a fine, perfectly even lattice of tiny raised diamonds (softened pyramids on
      // a grid turned 45°), like ballistic nylon. Lit from the upper-left so each diamond has a lit
      // and a shadowed side, with faint grooves between them. No large-scale variation.
      const p = 6 * scale; // diamond pitch in px (about 1.5 mm on a 9-pocket cover)
      const amp = Math.min(1, Math.max(0, (p - 2) / 3)); // fade out when too small to resolve
      const Lx = -0.6, Ly = -0.8; // one pixel step towards the light
      const height = (x, y) => {
        const u = (x + y) / p;
        const v = (x - y) / p;
        const m = Math.max(Math.abs(u - Math.floor(u) - 0.5), Math.abs(v - Math.floor(v) - 0.5)); // 0 at the tip, 0.5 in the groove
        const s = Math.min(1, Math.max(0, (m - 0.04) / 0.46));
        return 1 - s * s * (3 - 2 * s);
      };
      const t = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const hgt = height(x, y);
          // Positive where the surface faces the light (it drops towards the light).
          const slope = Math.max(-1.3, Math.min(1.3, ((hgt - height(x + Lx, y + Ly)) * p) / 3.5));
          t[y * w + x] = 1 + amp * (slope * 0.07 + (hgt - 0.5) * 0.06) + (Math.random() - 0.5) * 0.008;
        }
      }
      textures.set(key, t);
    }
    return textures.get(key);
  }

  // Per-pixel engraving tone (0..1) for the cover, before depth is applied. Cached so colour changes re-render fast.
  let maskCache = null;
  function designMask(image, fit, invert, w, h) {
    if (!image) return null;
    const c = maskCache;
    if (c && c.image === image && c.fit === fit && c.invert === invert && c.w === w && c.h === h) return c.mask;

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const o = off.getContext('2d', { willReadFrequently: true });
    o.fillStyle = '#fff';
    o.fillRect(0, 0, w, h);

    const iw = image.naturalWidth;
    const ih = image.naturalHeight;
    let dw = w, dh = h;
    if (fit === 'cover') {
      const s = Math.max(w / iw, h / ih);
      dw = iw * s; dh = ih * s;
    } else if (fit === 'contain') {
      const s = Math.min(w / iw, h / ih);
      dw = iw * s; dh = ih * s;
    }
    o.imageSmoothingQuality = 'high';
    o.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);

    const px = o.getImageData(0, 0, w, h).data;
    const mask = new Float32Array(w * h);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const L = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
      let d = invert ? L : 1 - L;
      d = (d - CLEAN) / (1 - CLEAN);
      if (d <= 0) continue;
      if (d > 1) d = 1;
      mask[i] = d * d * (3 - 2 * d); // smoothstep adds laser-like contrast
    }
    maskCache = { image, fit, invert, w, h, mask };
    return mask;
  }

  // Depth up to 200% strengthens the engraving (mask gain up to 2x). Beyond that it keeps adding a
  // little gain but mostly deepens the engraved colour toward a near-black (or, on dark binders,
  // near-white) tone of the binder's hue, so the artwork gets bolder without losing its detail.
  function depthSettings(base, depth) {
    const k = Math.max(0, depth) / 100;
    const gain = k <= 2 ? k : 2 + (k - 2) * 0.25;
    const extra = Math.min(1, Math.max(0, (k - 2) / 8));
    let eng = engraveColor(base);
    if (extra > 0) {
      const deep = luminance(base) < 0.28 ? base.map((v) => v + (255 - v) * 0.92) : base.map((v) => v * 0.12);
      eng = eng.map((v, j) => v + (deep[j] - v) * extra);
    }
    return { gain, eng };
  }

  function renderSurface(base, mask, bw, bh, spineW, coverW, scale, texture, depth) {
    const surf = document.createElement('canvas');
    surf.width = bw;
    surf.height = bh;
    const s = surf.getContext('2d');
    const out = s.createImageData(bw, bh);
    const d = out.data;
    const tex = getTexture(bw, bh, scale, texture);
    const { gain, eng } = depthSettings(base, depth);
    const spine = shade(base, 0.9);
    // The laser flattens the diamond relief, so the pattern fades where the design is engraved
    // and the artwork stays crisp. (Velvet keeps its mottling everywhere.)
    const flatten = texture === 'felt' ? 0 : 0.7;

    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        let t = tex[i];
        let r, g, b;
        if (x < spineW) {
          [r, g, b] = spine;
        } else {
          const m = mask ? Math.min(1, mask[y * coverW + (x - spineW)] * gain) : 0;
          r = base[0] + (eng[0] - base[0]) * m;
          g = base[1] + (eng[1] - base[1]) * m;
          b = base[2] + (eng[2] - base[2]) * m;
          t = 1 + (t - 1) * (1 - flatten * m);
        }
        const p = i * 4;
        d[p] = r * t;
        d[p + 1] = g * t;
        d[p + 2] = b * t;
        d[p + 3] = 255;
      }
    }
    s.putImageData(out, 0, 0);
    return surf;
  }

  // Draws the binder (with shadow, on a transparent background) into `canvas`, resizing it.
  // `back: true` draws the back cover: the same binder mirrored left to right (spine on the right),
  // with no design.
  function render(canvas, { image = null, color = COLORS[0].id, type = DEFAULT_TYPE, fit = 'cover', invert = false, scale: frameScale = 1, back = false } = {}) {
    if (back) image = null;
    const t = getType(type);
    // Binders with a `display` factor are drawn smaller, centred in a picture sized like the 9-pocket's.
    const scale = frameScale * (t.shape.display || 1);
    const spineW = Math.round(t.shape.spine * scale);
    const coverW = Math.round(COVER_W * scale);
    const fullH = Math.round((coverW * t.ratio[1]) / t.ratio[0]);
    const coverH = Math.round(fullH * (t.shape.height || 1));
    const pad = Math.round(PAD * scale);
    const bw = spineW + coverW;
    const bh = coverH;
    const radii = [LEFT_RADIUS, t.shape.radius, t.shape.radius, LEFT_RADIUS].map((r) => r * scale);
    const { hex, texture, depth } = resolveColor(color);
    const base = hexToRgb(hex);
    const dark = luminance(base) < 0.28;
    // A shortened binder keeps the full-height canvas (so it displays at the same size and
    // width as before) and sits vertically centred in it.
    let x0 = pad;
    let y0 = pad + Math.round((fullH - bh) / 2);

    canvas.width = bw + pad * 2;
    canvas.height = fullH + pad * 2;
    if (t.shape.display) {
      const ref = getType(DEFAULT_TYPE);
      const refPad = Math.round(PAD * frameScale);
      const refCoverW = Math.round(COVER_W * frameScale);
      canvas.width = Math.round(ref.shape.spine * frameScale) + refCoverW + refPad * 2;
      canvas.height = Math.round((refCoverW * ref.ratio[1]) / ref.ratio[0]) + refPad * 2;
      x0 = Math.round((canvas.width - bw) / 2);
      y0 = Math.round((canvas.height - bh) / 2);
    }
    const ctx = canvas.getContext('2d');
    if (back) ctx.setTransform(-1, 0, 0, 1, canvas.width, 0); // mirror (resizing the canvas above reset any earlier transform)

    const path = () => {
      ctx.beginPath();
      ctx.roundRect(x0, y0, bw, bh, radii);
    };
    const inset = 13 * scale;
    // The left line of stitching runs along the spine fold, where the engraving starts.
    const stitchPath = () => {
      ctx.beginPath();
      ctx.roundRect(x0 + spineW, y0 + inset, bw - spineW - inset, bh - inset * 2,
        radii.map((r) => Math.max(4 * scale, r - inset)));
    };

    // Zipper pull tab peeking out from behind the top edge.
    if (t.shape.tab) {
      ctx.fillStyle = rgb(shade(base, 0.82));
      ctx.beginPath();
      ctx.roundRect(x0 + spineW + 70 * scale, y0 - 22 * scale, 34 * scale, 60 * scale, 8 * scale);
      ctx.fill();
    }

    // Body with drop shadow.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 40 * scale;
    ctx.shadowOffsetY = 18 * scale;
    ctx.fillStyle = rgb(base);
    path();
    ctx.fill();
    ctx.restore();

    ctx.save();
    path();
    ctx.clip();
    const mask = designMask(image, fit, invert, coverW, coverH);
    // Plain fabric everywhere, then the engraved surface only inside the stitching.
    ctx.drawImage(renderSurface(base, null, bw, bh, spineW, coverW, scale, texture, depth), x0, y0);
    if (mask) {
      ctx.save();
      stitchPath();
      ctx.clip();
      ctx.drawImage(renderSurface(base, mask, bw, bh, spineW, coverW, scale, texture, depth), x0, y0);
      ctx.restore();
    }

    // Soft studio lighting: brighter top-left, falling off to the bottom-right.
    const light = ctx.createLinearGradient(x0, y0, x0 + bw, y0 + bh);
    light.addColorStop(0, 'rgba(255,255,255,0.10)');
    light.addColorStop(0.5, 'rgba(255,255,255,0)');
    light.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = light;
    ctx.fillRect(x0, y0, bw, bh);

    // Spine fold: shadow line with a highlight just to its right.
    const line = Math.max(1, 2 * scale);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x0 + spineW - line, y0, line, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x0 + spineW, y0, line, bh);
    const spineShade = ctx.createLinearGradient(x0, 0, x0 + spineW, 0);
    spineShade.addColorStop(0, 'rgba(0,0,0,0.16)');
    spineShade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spineShade;
    ctx.fillRect(x0, y0, spineW, bh);

    // Rounded padded edge.
    path();
    ctx.lineWidth = 10 * scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.stroke();
    ctx.restore();

    // Stitching around the perimeter.
    ctx.save();
    stitchPath();
    ctx.setLineDash([11 * scale, 7 * scale]);
    ctx.lineWidth = Math.max(1, 2.6 * scale);
    ctx.strokeStyle = rgb(dark ? shade(base, 1.6) : shade(base, 0.78), 0.9);
    ctx.stroke();
    ctx.restore();

    // Crisp outer edge.
    path();
    ctx.lineWidth = Math.max(0.75, 1.5 * scale);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.stroke();
  }

  window.Binder = { COLORS, TYPES, DEFAULT_TYPE, getType, typeColors, finishes, finishColors, finishOf, finishExtra, finishLabel, render, colorName, colorHex };
})();
