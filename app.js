// Binder Designer: renders an uploaded 2:3 design as a laser engraving on a solid-colour binder.

const COLORS = [
  { name: 'Pink', hex: '#e6a9b0' },
  { name: 'Red', hex: '#b8322f' },
  { name: 'Orange', hex: '#e8742a' },
  { name: 'Yellow', hex: '#e8c547' },
  { name: 'Green', hex: '#3f8f4e' },
  { name: 'Teal', hex: '#2c8c8c' },
  { name: 'Electric Blue', hex: '#1e7fd6' },
  { name: 'Blue', hex: '#2f5fa8' },
  { name: 'Purple', hex: '#7d5ba6' },
  { name: 'Brown', hex: '#7a5236' },
  { name: 'Gray', hex: '#8a8d91' },
  { name: 'White', hex: '#eeeeec' },
  { name: 'Black', hex: '#242424' },
];

// Binder geometry in canvas pixels. The cover is exactly 2:3 so a 2:3 design fills it.
const SPINE = 36;
const COVER_W = 1000;
const COVER_H = 1500;
const PAD = 70;
const BINDER_W = SPINE + COVER_W;
const BINDER_H = COVER_H;
const RADII = [18, 72, 72, 18]; // top-left, top-right, bottom-right, bottom-left

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
canvas.width = BINDER_W + PAD * 2;
canvas.height = BINDER_H + PAD * 2;

const state = {
  image: null,
  color: COLORS[0].hex,
  fit: 'cover',
  depth: 1,
  clean: 0.08,
  invert: false,
};

// Fabric texture: fine noise + a 2px weave + gentle low-frequency variation. Computed once.
const texture = (() => {
  const t = new Float32Array(BINDER_W * BINDER_H);
  for (let y = 0; y < BINDER_H; y++) {
    for (let x = 0; x < BINDER_W; x++) {
      const weave = ((x >> 1) + (y >> 1)) & 1 ? 0.012 : -0.012;
      const low = Math.sin(x * 0.011 + y * 0.004) * 0.008 + Math.sin(y * 0.017 - x * 0.003) * 0.006;
      t[y * BINDER_W + x] = 1 + (Math.random() - 0.5) * 0.06 + weave + low;
    }
  }
  return t;
})();

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

// Colour the laser burns the material to. Calibrated against the pink sample photo:
// base (230,169,176) engraves to roughly (154,69,74). Dark binders get lighter instead.
function engraveColor(base) {
  if (luminance(base) < 0.28) {
    return base.map((v) => v + (255 - v) * 0.42);
  }
  return base.map((v) => v * Math.pow(v / 255, 1.5) * 0.8);
}

function binderPath(c, x, y) {
  c.beginPath();
  c.roundRect(x, y, BINDER_W, BINDER_H, RADII);
}

// Returns per-pixel engraving strength (0..1) for the cover area, or null without a design.
function designMask() {
  if (!state.image) return null;
  const off = document.createElement('canvas');
  off.width = COVER_W;
  off.height = COVER_H;
  const o = off.getContext('2d', { willReadFrequently: true });
  o.fillStyle = '#fff';
  o.fillRect(0, 0, COVER_W, COVER_H);

  const img = state.image;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  let dw = COVER_W, dh = COVER_H;
  if (state.fit === 'cover') {
    const s = Math.max(COVER_W / iw, COVER_H / ih);
    dw = iw * s; dh = ih * s;
  } else if (state.fit === 'contain') {
    const s = Math.min(COVER_W / iw, COVER_H / ih);
    dw = iw * s; dh = ih * s;
  }
  o.imageSmoothingQuality = 'high';
  o.drawImage(img, (COVER_W - dw) / 2, (COVER_H - dh) / 2, dw, dh);

  const px = o.getImageData(0, 0, COVER_W, COVER_H).data;
  const mask = new Float32Array(COVER_W * COVER_H);
  const clean = state.clean;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const L = (0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2]) / 255;
    let d = state.invert ? L : 1 - L;
    d = (d - clean) / (1 - clean);
    if (d <= 0) { mask[i] = 0; continue; }
    if (d > 1) d = 1;
    mask[i] = Math.min(1, d * d * (3 - 2 * d) * state.depth); // smoothstep adds laser-like contrast
  }
  return mask;
}

function renderSurface(base, mask) {
  const surf = document.createElement('canvas');
  surf.width = BINDER_W;
  surf.height = BINDER_H;
  const s = surf.getContext('2d');
  const out = s.createImageData(BINDER_W, BINDER_H);
  const d = out.data;
  const eng = engraveColor(base);
  const spine = shade(base, 0.9);

  for (let y = 0; y < BINDER_H; y++) {
    for (let x = 0; x < BINDER_W; x++) {
      const i = y * BINDER_W + x;
      const t = texture[i];
      let r, g, b;
      if (x < SPINE) {
        [r, g, b] = spine;
      } else {
        const m = mask ? mask[y * COVER_W + (x - SPINE)] : 0;
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

function render() {
  const base = hexToRgb(state.color);
  const dark = luminance(base) < 0.28;
  const x0 = PAD;
  const y0 = PAD;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Zipper pull tab peeking out from behind the top edge.
  ctx.fillStyle = rgb(shade(base, 0.82));
  ctx.beginPath();
  ctx.roundRect(x0 + SPINE + 70, y0 - 22, 34, 60, 8);
  ctx.fill();

  // Body with drop shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = rgb(base);
  binderPath(ctx, x0, y0);
  ctx.fill();
  ctx.restore();

  ctx.save();
  binderPath(ctx, x0, y0);
  ctx.clip();
  ctx.drawImage(renderSurface(base, designMask()), x0, y0);

  // Soft studio lighting: brighter top-left, falling off to the bottom-right.
  const light = ctx.createLinearGradient(x0, y0, x0 + BINDER_W, y0 + BINDER_H);
  light.addColorStop(0, 'rgba(255,255,255,0.10)');
  light.addColorStop(0.5, 'rgba(255,255,255,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = light;
  ctx.fillRect(x0, y0, BINDER_W, BINDER_H);

  // Spine fold: shadow line with a highlight just to its right.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(x0 + SPINE - 2, y0, 2, BINDER_H);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(x0 + SPINE, y0, 2, BINDER_H);
  const spineShade = ctx.createLinearGradient(x0, 0, x0 + SPINE, 0);
  spineShade.addColorStop(0, 'rgba(0,0,0,0.16)');
  spineShade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = spineShade;
  ctx.fillRect(x0, y0, SPINE, BINDER_H);

  // Rounded padded edge.
  binderPath(ctx, x0, y0);
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.stroke();
  ctx.restore();

  // Stitching around the perimeter.
  const inset = 13;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0 + inset, y0 + inset, BINDER_W - inset * 2, BINDER_H - inset * 2,
    RADII.map((r) => Math.max(4, r - inset)));
  ctx.setLineDash([11, 7]);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = rgb(dark ? shade(base, 1.6) : shade(base, 0.78), 0.9);
  ctx.stroke();
  ctx.restore();

  // Crisp outer edge.
  binderPath(ctx, x0, y0);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.stroke();
}

let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    render();
  });
}

// ---- UI wiring ----

const swatchesEl = document.getElementById('swatches');
const customColor = document.getElementById('customColor');
const colorHex = document.getElementById('colorHex');

function setColor(hex) {
  state.color = hex;
  customColor.value = hex;
  colorHex.textContent = hex;
  for (const el of swatchesEl.children) {
    el.setAttribute('aria-checked', String(el.dataset.hex === hex));
  }
  scheduleRender();
}

for (const c of COLORS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.style.background = c.hex;
  b.title = c.name;
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-label', c.name);
  b.dataset.hex = c.hex;
  b.addEventListener('click', () => setColor(c.hex));
  swatchesEl.appendChild(b);
}
customColor.addEventListener('input', (e) => setColor(e.target.value));

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileInfo = document.getElementById('fileInfo');
const downloadBtn = document.getElementById('downloadBtn');

function loadImage(src, label) {
  const img = new Image();
  img.onload = () => {
    state.image = img;
    const ratio = img.naturalWidth / img.naturalHeight;
    const ok = Math.abs(ratio / (2 / 3) - 1) < 0.02;
    fileInfo.hidden = false;
    fileInfo.classList.toggle('warn', !ok);
    fileInfo.textContent = ok
      ? `${label}: ${img.naturalWidth} × ${img.naturalHeight} (2:3)`
      : `${label}: ${img.naturalWidth} × ${img.naturalHeight} is not 2:3. It will be adjusted using the Fit setting below.`;
    downloadBtn.disabled = false;
    scheduleRender();
  };
  img.onerror = () => {
    fileInfo.hidden = false;
    fileInfo.classList.add('warn');
    fileInfo.textContent = `Could not read ${label} as an image.`;
  };
  img.src = src;
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  loadImage(URL.createObjectURL(file), file.name);
}

fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
for (const ev of ['dragenter', 'dragover']) {
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
}
for (const ev of ['dragleave', 'drop']) {
  dropzone.addEventListener(ev, () => dropzone.classList.remove('drag'));
}
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  loadFile(e.dataTransfer.files[0]);
});
// Dropping anywhere else on the page shouldn't navigate away.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

document.getElementById('sampleBtn').addEventListener('click', () => {
  if (window.SAMPLE_DESIGN) loadImage(window.SAMPLE_DESIGN, 'Sylveon sample');
});

document.getElementById('fitMode').addEventListener('change', (e) => {
  state.fit = e.target.value;
  scheduleRender();
});

const depth = document.getElementById('depth');
const depthOut = document.getElementById('depthOut');
depth.addEventListener('input', () => {
  state.depth = depth.value / 100;
  depthOut.textContent = `${depth.value}%`;
  scheduleRender();
});

const clean = document.getElementById('clean');
const cleanOut = document.getElementById('cleanOut');
clean.addEventListener('input', () => {
  state.clean = clean.value / 100;
  cleanOut.textContent = `${clean.value}%`;
  scheduleRender();
});

document.getElementById('invert').addEventListener('change', (e) => {
  state.invert = e.target.checked;
  scheduleRender();
});

downloadBtn.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'binder-mockup.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

setColor(COLORS[0].hex);
if (window.SAMPLE_DESIGN) loadImage(window.SAMPLE_DESIGN, 'Sylveon sample');
