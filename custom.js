// Custom Designs page: preview an uploaded design engraved on a binder type and colour of your choice.

const canvas = document.getElementById('canvas');

const state = {
  image: null,
  type: Binder.DEFAULT_TYPE,
  color: null,
  fit: 'cover',
  invert: false,
  insideStitch: true,
};
let imageLabel = '';

let pending = false;
function scheduleRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    Binder.render(canvas, state);
  });
}

const colorName = document.getElementById('colorName');
function setColor(hex) {
  state.color = hex;
  colorName.textContent = Binder.colorName(hex);
  scheduleRender();
}

const typesEl = document.getElementById('types');
const ratioHint = document.getElementById('ratioHint');
const stretchOption = document.getElementById('stretchOption');

function setType(id) {
  state.type = id;
  const t = Binder.getType(id);
  const [w, h] = t.ratio;
  for (const el of typesEl.children) el.setAttribute('aria-checked', String(el.dataset.id === id));
  ratioHint.textContent = `PNG or JPG, ${w}:${h} ratio (e.g. ${w * 500} × ${h * 500})`;
  stretchOption.textContent = `Stretch to ${w}:${h}`;

  // Binders with texture choices (the 9-pocket) show a dropdown that limits the colours.
  const list = Binder.finishes(id);
  finishField.hidden = !list;
  // Every other binder only comes in the diamond texture, shown as a fixed label.
  document.getElementById('finishFixed').hidden = !!list;
  state.finish = list ? Binder.finishOf(id, state.color) : null;
  if (list) finishSelect.replaceChildren(...list.map((f) => new Option(f.name, f.id, false, f.id === state.finish)));
  showImageInfo();
  showColors();
}

// Swatches for the current binder type and texture. Keeps the chosen colour if it's still
// offered, otherwise picks the first one.
function showColors() {
  const colors = Binder.finishColors(state.type, state.finish);
  const color = colors.some((c) => c.id === state.color) ? state.color : colors[0].id;
  Shop.swatches(document.getElementById('swatches'), colors, color, setColor);
  setColor(color);
}

const finishField = document.getElementById('finishField');
const finishSelect = document.getElementById('finish');
finishSelect.addEventListener('change', () => {
  state.finish = finishSelect.value;
  showColors();
});

for (const t of Binder.TYPES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'type-option';
  b.dataset.id = t.id;
  b.setAttribute('role', 'radio');
  b.innerHTML = `<span></span><span class="ratio"></span>`;
  b.firstChild.textContent = t.name;
  b.lastChild.textContent = `${t.ratio[0]}:${t.ratio[1]} art`;
  b.addEventListener('click', () => setType(t.id));
  typesEl.appendChild(b);
}

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileInfo = document.getElementById('fileInfo');
const downloadBtn = document.getElementById('downloadBtn');

// Shows the loaded image's size and whether it matches the selected binder's ratio.
function showImageInfo() {
  const img = state.image;
  if (!img) return;
  const [w, h] = Binder.getType(state.type).ratio;
  const ok = Math.abs(img.naturalWidth / img.naturalHeight / (w / h) - 1) < 0.02;
  fileInfo.hidden = false;
  fileInfo.classList.toggle('warn', !ok);
  fileInfo.textContent = ok
    ? `${imageLabel}: ${img.naturalWidth} × ${img.naturalHeight} (${w}:${h})`
    : `${imageLabel}: ${img.naturalWidth} × ${img.naturalHeight} is not ${w}:${h}. It will be adjusted using the Fit setting below.`;
}

function loadImage(src, label) {
  const img = new Image();
  img.onload = () => {
    state.image = img;
    imageLabel = label;
    showImageInfo();
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

document.getElementById('invert').addEventListener('change', (e) => {
  state.invert = e.target.checked;
  scheduleRender();
});

downloadBtn.addEventListener('click', () => {
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `binder-mockup-${state.type}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
});

// Start with a blank binder; the design appears once one is uploaded (or the sample is chosen).
setType(state.type);
