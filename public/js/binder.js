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

  // How many pockets a custom design on this binder and texture holds (velvet 9-slots: 540).
  function capacity(typeId, finishId) {
    const f = (finishes(typeId) || []).find((f) => f.id === finishId);
    return (f && f.cards) || getType(typeId).capacity;
  }

  // Texture name for dropdowns with its surcharge, e.g. "Velvet texture (+$5)". With a pocket count:
  // "Velvet texture — 540 pockets (+$5)".
  function finishLabel(f, pockets) {
    return `${f.name}${pockets ? ` — ${pockets} pockets` : ''}${f.extraPrice ? ` (+$${f.extraPrice})` : ''}`;
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

  // ─── TCGEngrave logo, engraved on the back cover ───────────────────────────────────────
  // The logo file is black on white; its dark strokes become a mask, trimmed to the logo's edges.
  // Binder.logoReady resolves once it's loaded (back covers drawn earlier can then be redrawn).
  const LOGO_OPACITY = 0.6; // how strongly the logo is engraved (1 = as strong as the design)
  let logoMask = null; // { w, h, alpha: Float32Array }
  const logoReady = new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(false);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      const a = new Float32Array(c.width * c.height);
      let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = y * c.width + x;
          const L = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
          let v = (0.82 - L) / 0.6; // white paper → 0, black ink → 1
          v = v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);
          a[i] = v;
          if (v > 0.25) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return resolve(false);
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const alpha = new Float32Array(w * h);
      for (let y = 0; y < h; y++) alpha.set(a.subarray((y + minY) * c.width + minX, (y + minY) * c.width + minX + w), y * w);
      logoMask = { w, h, alpha };
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = 'images/tcgengrave-logo.jpg';
  });

  // The logo in colour `ink` (an [r, g, b]), `width` px wide (cached per colour and size).
  const logoCache = new Map();
  function tintedLogo(ink, width) {
    const key = `${ink.join(',')}|${width}`;
    if (logoCache.has(key)) return logoCache.get(key);
    const height = Math.round((width * logoMask.h) / logoMask.w);
    // Scale the mask down to size, then colour it.
    const src = document.createElement('canvas');
    src.width = logoMask.w;
    src.height = logoMask.h;
    const sg = src.getContext('2d');
    const sd = sg.createImageData(logoMask.w, logoMask.h);
    for (let i = 0; i < logoMask.alpha.length; i++) sd.data[i * 4 + 3] = Math.round(logoMask.alpha[i] * 255);
    sg.putImageData(sd, 0, 0);
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const og = out.getContext('2d');
    og.imageSmoothingQuality = 'high';
    og.drawImage(src, 0, 0, width, height);
    og.globalCompositeOperation = 'source-in';
    og.fillStyle = rgb(ink);
    og.fillRect(0, 0, width, height);
    if (logoCache.size > 40) logoCache.clear();
    logoCache.set(key, out);
    return out;
  }

  // Draws the binder (with shadow, on a transparent background) into `canvas`, resizing it.
  // `view: 'spine'` draws the spine at an angle instead of the front cover (see renderSpine), and
  // `view: 'back'` the back cover: the same binder mirrored (spine on the right), no design, with
  // the TCGEngrave logo engraved in the bottom corner beside the spine.
  // Returns where the binder sits in the canvas: { x0, y0, bw, bh, scale }.
  function render(canvas, options = {}) {
    if (options.view === 'spine') return renderSpine(canvas, options);
    const back = options.view === 'back';
    const { color = COLORS[0].id, type = DEFAULT_TYPE, fit = 'cover', invert = false, scale: frameScale = 1, shadow = true } = options;
    const image = back ? null : options.image || null;
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
    // The stitching sits the same distance in from the spine fold as it does from the other edges;
    // the engraving is clipped to it.
    const stitchPath = () => {
      ctx.beginPath();
      ctx.roundRect(x0 + spineW + inset, y0 + inset, bw - spineW - inset * 2, bh - inset * 2,
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
    ctx.shadowColor = shadow ? 'rgba(0,0,0,0.3)' : 'transparent';
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

    // Back cover: the logo, engraved in the bottom corner next to the spine (drawn unmirrored so
    // it reads the right way round).
    if (back && logoMask) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const logo = tintedLogo(depthSettings(base, depth).eng, Math.round(coverW * 0.27));
      const margin = coverW * 0.07;
      const spineEdge = canvas.width - (x0 + spineW); // the spine fold, on screen (mirrored)
      ctx.globalAlpha = LOGO_OPACITY;
      ctx.drawImage(logo, Math.round(spineEdge - inset - margin - logo.width), Math.round(y0 + bh - inset - margin - logo.height));
      ctx.restore();
    }

    // Crisp outer edge.
    path();
    ctx.lineWidth = Math.max(0.75, 1.5 * scale);
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.stroke();
    return { x0, y0, bw, bh, scale };
  }

  // ─── Spine view ───────────────────────────────────────────────────────────────────────
  // The closed binder turned so its spine faces the viewer at an angle, seen from a little above
  // its top edge: the spine on the left with the TCGEngrave logo hot-pressed down its centre, the
  // front cover (with the design) going away to the right in perspective, and along the top the
  // binder's padded rim around the dark inside. Same canvas size as the front view.
  // Seen from above, the binder is a rounded rectangle: the spine is flat across the middle and
  // curves smoothly round into each cover. The upright faces are flat pictures drawn one pixel
  // column at a time to fake perspective.
  const SPINE_TURN = (24 * Math.PI) / 180; // how far the binder is turned away from facing the spine
  const SPINE_THICK = 0.2; // spine width as a fraction of the cover width, unless the type sets `thick`
  const SPINE_ROUND = 0.3; // radius of the spine's rounded corners, as a fraction of its width
  const RIM = 0.08; // thickness of the covers seen along the top edge, as a fraction of the spine width
  const CAMERA = 2.2; // camera distance in binder heights (smaller = stronger perspective)
  const EYE = 0.3; // how far the camera is above the binder's top, in binder heights

  // The spine, unrolled flat: the binder's fabric with the logo in the middle, about `logoSpace` px
  // across.
  function spineFace(base, texture, depth, w, h, scale, dark, logoSpace) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(renderSurface(base, null, w, h, 0, w, scale, texture, depth), 0, 0);
    // The logo, hot-pressed (darker than the fabric) and turned to read from top to bottom, centred
    // on the spine. A faint light edge beside each stroke makes it look pressed in. On very light
    // binders (white) the press stays near the binder's colour, with a soft shadow edge so it shows.
    if (logoMask) {
      const aspect = logoMask.w / logoMask.h;
      const len = Math.round(Math.min(h * 0.36, logoSpace * aspect));
      const light = luminance(base) > 0.75;
      const ink = shade(base, dark ? 0.55 : light ? 0.9 : 0.62);
      const logo = tintedLogo(ink, len);
      const edge = tintedLogo(shade(base, dark ? 1.5 : 1.12), len);
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(Math.PI / 2);
      const off = Math.max(1, 1.5 * scale);
      if (light) {
        g.globalAlpha = 0.55;
        g.drawImage(tintedLogo(shade(base, 0.72), len), -logo.width / 2 - off, -logo.height / 2 + off);
      }
      g.globalAlpha = 0.5;
      g.drawImage(edge, -logo.width / 2 + off, -logo.height / 2 - off);
      g.globalAlpha = 0.9;
      g.drawImage(logo, -logo.width / 2, -logo.height / 2);
      g.restore();
    }
    return c;
  }

  // Points (x, z) round a rounded rectangle seen from above: x from -w/2 to w/2, z from z0 back to
  // z1, corners of radius r on the z0 side only. Runs from the far end of the left side, round the
  // front, to the far end of the right side.
  function roundedOutline(w, z0, z1, r, steps = 12) {
    const pts = [[-w / 2, z1]];
    for (const [cx, sign] of [[-w / 2 + r, -1], [w / 2 - r, 1]]) {
      for (let i = 0; i <= steps; i++) {
        const a = (Math.PI / 2) * (sign < 0 ? i / steps : 1 - i / steps);
        pts.push([cx + sign * r * Math.cos(a), z0 + r - r * Math.sin(a)]);
      }
    }
    pts.push([w / 2, z1]);
    return pts;
  }

  function renderSpine(canvas, { image = null, color = COLORS[0].id, type = DEFAULT_TYPE, fit = 'cover', invert = false, scale: frameScale = 1 } = {}) {
    const t = getType(type);
    // The front cover, flat, drawn by the front view (without its shadow) and cut out of its canvas.
    const flat = document.createElement('canvas');
    const { x0, y0, bw, bh, scale } = render(flat, { image, color, type, fit, invert, scale: frameScale, shadow: false });
    const cover = document.createElement('canvas');
    cover.width = bw;
    cover.height = bh;
    cover.getContext('2d').drawImage(flat, x0, y0, bw, bh, 0, 0, bw, bh);

    const { hex, texture, depth } = resolveColor(color);
    const base = hexToRgb(hex);
    const dark = luminance(base) < 0.28;
    const thick = Math.round(COVER_W * scale * (t.shape.thick || SPINE_THICK));
    const r = thick * SPINE_ROUND;
    // The top edge stops where the cover's far corner starts to round off.
    const far = bw - t.shape.radius * scale;

    // The spine's outer surface: round the left corner, across, round the right corner (the cover
    // then carries on from (thick/2, r) to the back). u is how far along the spine's picture.
    const curve = roundedOutline(thick, 0, r, r).slice(1, -1);
    let length = 0;
    const spinePts = curve.map((p, i) => {
      if (i) length += Math.hypot(p[0] - curve[i - 1][0], p[1] - curve[i - 1][1]);
      return { p, len: length };
    });
    const spine = spineFace(base, texture, depth, Math.round(length), bh, scale, dark, thick * 0.6);

    // Turn by SPINE_TURN, push away from the camera, then project. The camera is EYE binder heights
    // above the top edge, so a point at height y (0 = top edge, bh = bottom) is drawn at
    // screen y = (y + eye) / z, below the horizon.
    const cos = Math.cos(SPINE_TURN);
    const sin = Math.sin(SPINE_TURN);
    const dist = CAMERA * bh;
    const eye = EYE * bh;
    const turn = ([x, z]) => [x * cos + z * sin, -x * sin + z * cos + dist];
    const faces = [
      { pic: spine, pts: spinePts.map((q) => ({ p: turn(q.p), u: q.len / length })), lit: true },
      { pic: cover, pts: [{ p: turn([thick / 2, r]), u: 0 }, { p: turn([thick / 2, bw]), u: 1 }], light: [0.02, 0.3] },
    ];
    const top = roundedOutline(thick, 0, far, r).map(turn);
    const pts = [...faces.flatMap((f) => f.pts.map((q) => q.p)), ...top];
    const minX = Math.min(...pts.map(([x, z]) => x / z));
    const maxX = Math.max(...pts.map(([x, z]) => x / z));
    const minY = Math.min(...pts.map(([, z]) => eye / z));
    const maxY = Math.max(...pts.map(([, z]) => (eye + bh) / z));
    // Fit the picture inside the front view's binder area, centred in a canvas of the same size.
    canvas.width = flat.width;
    canvas.height = flat.height;
    const k = Math.min((canvas.width - 2 * x0) / (maxX - minX), bh / (maxY - minY));
    const cx = canvas.width / 2 - (k * (minX + maxX)) / 2;
    const horizon = y0 + bh / 2 - (k * (minY + maxY)) / 2;
    const screen = ([x, z], y) => [cx + (k * x) / z, horizon + (k * (y + eye)) / z];
    // Light from the front left, for the rounded corners (a direction in the seen-from-above plane).
    const L = [-0.5, -1].map((v) => v / Math.hypot(0.5, 1));

    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const lg = layer.getContext('2d');

    // The top edge: the covers' padded rim (lit from above) round the dark inside of the binder.
    const outline = (list) => {
      lg.beginPath();
      list.forEach((p, i) => {
        const [sx, sy] = screen(p, 0);
        if (i) lg.lineTo(sx, sy);
        else lg.moveTo(sx, sy);
      });
      lg.closePath();
    };
    const rim = thick * RIM;
    outline(top);
    lg.fillStyle = rgb(shade(base, dark ? 1.25 : 1.06));
    lg.fill();
    outline(roundedOutline(thick - 2 * rim, rim, far - rim, Math.max(1, r - rim)).map(turn));
    lg.fillStyle = rgb(shade(base, 0.22));
    lg.fill();

    // The upright faces: spine, then cover.
    for (const f of faces) {
      const face = document.createElement('canvas');
      face.width = canvas.width;
      face.height = canvas.height;
      const fg = face.getContext('2d');
      let left = Infinity;
      let right = -Infinity;
      for (let i = 1; i < f.pts.length; i++) {
        const A = f.pts[i - 1];
        const B = f.pts[i];
        const [xa, za] = A.p;
        const dx = B.p[0] - xa;
        const dz = B.p[1] - za;
        const from = cx + (k * xa) / za;
        const to = cx + (k * B.p[0]) / B.p[1];
        if (to <= from) continue; // facing away from the camera
        left = Math.min(left, from);
        right = Math.max(right, to);
        // Brightness of this strip of the spine: its outward side, against the light.
        let tint = null;
        if (f.lit) {
          const n = [dz, -dx].map((v) => v / Math.hypot(dx, dz));
          const b = 0.82 + 0.26 * Math.max(0, n[0] * L[0] + n[1] * L[1]);
          tint = b < 1 ? `rgba(0,0,0,${1 - b})` : `rgba(255,255,255,${(b - 1) * 0.6})`;
        }
        for (let X = Math.floor(from); X < Math.ceil(to); X++) {
          const sx = (X + 0.5 - cx) / k;
          // Where along this strip the column is (0 at A, 1 at B), allowing for perspective.
          const s = Math.min(1, Math.max(0, (xa - sx * za) / (sx * dz - dx)));
          const u = A.u + s * (B.u - A.u);
          const z = za + s * dz;
          const yTop = horizon + (k * eye) / z;
          const h = (k * bh) / z;
          fg.drawImage(f.pic, Math.min(f.pic.width - 1, Math.floor(u * f.pic.width)), 0, 1, f.pic.height, X, yTop, 1.5, h);
          if (tint) {
            fg.fillStyle = tint;
            fg.fillRect(X, yTop, 1, h);
          }
        }
      }
      // Light falls off across the cover, which turns away from the light.
      if (f.light) {
        fg.globalCompositeOperation = 'source-atop';
        const shadeGrad = fg.createLinearGradient(left, 0, right, 0);
        shadeGrad.addColorStop(0, `rgba(0,0,0,${f.light[0]})`);
        shadeGrad.addColorStop(1, `rgba(0,0,0,${f.light[1]})`);
        fg.fillStyle = shadeGrad;
        fg.fillRect(left, 0, right - left, canvas.height);
      }
      lg.drawImage(face, 0, 0);
    }

    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 40 * scale;
    ctx.shadowOffsetY = 18 * scale;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
    return { x0, y0, bw, bh, scale };
  }

  window.Binder = { COLORS, TYPES, DEFAULT_TYPE, getType, typeColors, finishes, finishColors, finishOf, finishExtra, finishLabel, capacity, logoReady, render, colorName, colorHex };
})();
