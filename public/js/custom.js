// Custom Designs page: preview an uploaded design engraved on a binder type and colour of your choice.

const canvas = document.getElementById('canvas');

const state = {
  image: null,
  file: null, // the uploaded file itself (full quality), saved with the cart line
  type: Binder.DEFAULT_TYPE,
  color: null,
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
  showBuy();
}

const typesEl = document.getElementById('types');
const ratioHint = document.getElementById('ratioHint');

function setType(id) {
  state.type = id;
  const t = Binder.getType(id);
  const [w, h] = t.ratio;
  for (const el of typesEl.querySelectorAll('.type-option')) el.setAttribute('aria-checked', String(el.dataset.id === id));
  ratioHint.textContent = `PNG or JPG, ${w}:${h} ratio (e.g. ${w * 500} × ${h * 500})`;

  // Binders with texture choices (the 9-pocket) show a dropdown that limits the colours.
  const list = Binder.finishes(id);
  finishField.hidden = !list;
  // Every other binder only comes in the diamond texture, shown as a fixed label.
  document.getElementById('finishFixed').hidden = !!list;
  state.finish = list ? Binder.finishOf(id, state.color) : null;
  if (list) finishSelect.replaceChildren(...list.map((f) => new Option(Binder.finishLabel(f), f.id, false, f.id === state.finish)));
  showPrices();
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
  showPrices();
  showColors();
});

// Price beside each binder type: its base price, plus the texture surcharge (velvet +$5) for the
// selected binder.
const prices = new Map();
function showPrices() {
  for (const t of Binder.TYPES) {
    const finish = t.id === state.type ? (Binder.finishes(t.id) || []).find((f) => f.id === state.finish) : null;
    prices.get(t.id).textContent = `$${t.basePrice + ((finish && finish.extraPrice) || 0)}`;
  }
}

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
  // Base price sits beside the option box.
  const row = document.createElement('div');
  row.className = 'type-row';
  const price = document.createElement('span');
  price.className = 'type-price';
  prices.set(t.id, price);
  row.append(b, price);
  typesEl.appendChild(row);
}

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileInfo = document.getElementById('fileInfo');

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
    : `${imageLabel}: ${img.naturalWidth} × ${img.naturalHeight} is not ${w}:${h}. It will be cropped to fill the cover.`;
}

function loadImage(src, label, file) {
  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.file = file;
    imageLabel = label;
    showImageInfo();
    scheduleRender();
    showBuy();
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
  loadImage(URL.createObjectURL(file), file.name, file);
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
  if (!window.SAMPLE_DESIGN) return;
  fetch(window.SAMPLE_DESIGN).then((r) => r.blob()).then((blob) => loadImage(window.SAMPLE_DESIGN, 'Sylveon sample', blob));
});

// ---- Add to cart (lower right, under the preview) ----
// Custom designs are priced at the binder's base price plus any texture surcharge (never discounted).
const MAX_ART_BYTES = 25 * 1024 * 1024;
const addBtn = document.getElementById('addBtn');
const buyNote = document.getElementById('buyNote');
let qty = 1;

function showBuy() {
  if (!state.color) return;
  const t = Binder.getType(state.type);
  const finish = (Binder.finishes(t.id) || []).find((f) => f.id === Binder.finishOf(t.id, state.color));
  document.getElementById('buySummary').textContent =
    `${t.name} · ${finish ? finish.name : 'Diamond texture'} · ${Binder.colorName(state.color)}`;
  document.getElementById('buyPrice').textContent = Shop.money(Shop.customPrice({ type: t.id, color: state.color }) * qty);
  addBtn.disabled = !state.file;
  const prompt = 'Upload your design (step 3) to add it to your cart.';
  if (!state.file) {
    buyNote.textContent = prompt;
    buyNote.hidden = false;
  } else if (buyNote.textContent === prompt) {
    buyNote.hidden = true;
  }
}

const qtyEl = document.getElementById('qty');
const setQty = (n) => {
  qty = Math.max(1, Math.min(20, n));
  qtyEl.textContent = qty;
  showBuy();
};
document.getElementById('minus').addEventListener('click', () => setQty(qty - 1));
document.getElementById('plus').addEventListener('click', () => setQty(qty + 1));

addBtn.addEventListener('click', async () => {
  if (!state.file) return;
  if (state.file.size > MAX_ART_BYTES) {
    buyNote.textContent = 'This image is over 25 MB. Please upload a smaller file.';
    buyNote.hidden = false;
    return;
  }
  const id = `custom-${crypto.randomUUID()}`;
  addBtn.disabled = true;
  try {
    await CustomArt.save(id, state.file);
  } catch {
    addBtn.disabled = false;
    buyNote.textContent = "Couldn't save your design in this browser (private browsing can block this). Please try another browser.";
    buyNote.hidden = false;
    return;
  }
  Shop.addCustomToCart({ id, type: state.type, color: state.color, qty });
  addBtn.disabled = false;
  buyNote.hidden = false;
  buyNote.replaceChildren(`Added ${qty} to your cart. `);
  const link = document.createElement('a');
  link.href = 'cart.html';
  link.textContent = 'View cart';
  buyNote.appendChild(link);
});

// Start with a blank binder; the design appears once one is uploaded (or the sample is chosen).
setType(state.type);
