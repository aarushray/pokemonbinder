// Shared binder mockup renderer: engraves a design onto a solid-colour binder of a given type.
// Used by the shop, product, cart, admin and Custom Designs pages. Requires catalog.js.
(function () {
  const { COLORS, TYPES, DEFAULT_TYPE } = window.Catalog;

  // Engraving settings are fixed, not user-adjustable.
  const DEPTH = 2;
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
    const hexes = getType(id).colors;
    return COLORS.filter((c) => hexes.includes(c.hex));
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

  function colorName(hex) {
    const c = COLORS.find((c) => c.hex === hex);
    return c ? c.name : hex;
  }

  // Fabric texture: fine noise + a 2px weave + gentle low-frequency variation. Cached per size.
  const textures = new Map();
  function getTexture(w, h, scale) {
    const key = `${w}x${h}`;
    if (!textures.has(key)) {
      const t = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const ys = y / scale;
        for (let x = 0; x < w; x++) {
          const xs = x / scale;
          const weave = ((x >> 1) + (y >> 1)) & 1 ? 0.012 : -0.012;
          const low = Math.sin(xs * 0.011 + ys * 0.004) * 0.008 + Math.sin(ys * 0.017 - xs * 0.003) * 0.006;
          t[y * w + x] = 1 + (Math.random() - 0.5) * 0.06 + weave + low;
        }
      }
      textures.set(key, t);
    }
    return textures.get(key);
  }

  // Per-pixel engraving strength (0..1) for the cover. Cached so colour changes re-render fast.
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
      mask[i] = Math.min(1, d * d * (3 - 2 * d) * DEPTH); // smoothstep adds laser-like contrast
    }
    maskCache = { image, fit, invert, w, h, mask };
    return mask;
  }

  function renderSurface(base, mask, bw, bh, spineW, coverW, scale) {
    const surf = document.createElement('canvas');
    surf.width = bw;
    surf.height = bh;
    const s = surf.getContext('2d');
    const out = s.createImageData(bw, bh);
    const d = out.data;
    const tex = getTexture(bw, bh, scale);
    const eng = engraveColor(base);
    const spine = shade(base, 0.9);

    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const i = y * bw + x;
        const t = tex[i];
        let r, g, b;
        if (x < spineW) {
          [r, g, b] = spine;
        } else {
          const m = mask ? mask[y * coverW + (x - spineW)] : 0;
          r = base[0] + (eng[0] - base[0]) * m;
          g = base[1] + (eng[1] - base[1]) * m;
          b = base[2] + (eng[2] - base[2]) * m;
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
  // `insideStitch` keeps the engraving within the stitched line instead of running to the edge.
  function render(canvas, { image = null, color = COLORS[0].hex, type = DEFAULT_TYPE, fit = 'cover', invert = false, scale: frameScale = 1, insideStitch = false } = {}) {
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
    const base = hexToRgb(color);
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

    const path = () => {
      ctx.beginPath();
      ctx.roundRect(x0, y0, bw, bh, radii);
    };
    const inset = 13 * scale;
    const stitchPath = () => {
      ctx.beginPath();
      ctx.roundRect(x0 + inset, y0 + inset, bw - inset * 2, bh - inset * 2,
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
    ctx.drawImage(renderSurface(base, insideStitch ? null : mask, bw, bh, spineW, coverW, scale), x0, y0);
    if (insideStitch && mask) {
      // Plain fabric everywhere, then the engraved surface only inside the stitching.
      ctx.save();
      stitchPath();
      ctx.clip();
      ctx.drawImage(renderSurface(base, mask, bw, bh, spineW, coverW, scale), x0, y0);
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

  window.Binder = { COLORS, TYPES, DEFAULT_TYPE, getType, typeColors, render, colorName };
})();
