// Product page: shows one design engraved on a binder and adds it to the cart.
(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const missing = document.getElementById('missing');

  let design;
  let collections = [];
  try {
    const catalog = await Shop.loadCatalog();
    collections = catalog.collections;
    design = catalog.designs.find((d) => d.id === id);
  } catch {
    // handled below as "not found"
  }
  if (!design) {
    missing.hidden = false;
    return;
  }

  document.title = `${design.name} · TCGEngrave`;
  Shop.setPage(Shop.pageOf(design, collections)); // header dropdown and "All designs" follow this design's page
  document.getElementById('name').textContent = design.name;
  const type = Shop.designType(design);
  const colors = Binder.typeColors(type.id);
  document.getElementById('typeName').textContent = `${type.name} binder`;
  document.getElementById('pockets').textContent = `${type.pockets} slots per page, side-loading`;
  document.getElementById('product').hidden = false;

  const canvas = document.getElementById('canvas');
  const colorName = document.getElementById('colorName');
  // The home page passes the colour picked on the card, if any.
  const requested = new URLSearchParams(location.search).get('color');
  let color = colors.some((c) => c.id === requested) ? requested : design.color;
  let art = null;

  const slides = Shop.coverSlides(canvas);
  slides.setBinder(type.id, color);

  function draw() {
    colorName.textContent = Binder.colorName(color);
    slides.setBinder(type.id, color);
    Binder.render(canvas, { image: art, color, type: type.id });
  }

  const swatchesEl = document.getElementById('swatches');

  // Colour wheel after the preset swatches: any custom binder colour (woven texture only).
  const wheel = document.createElement('label');
  wheel.className = 'swatch swatch-wheel';
  wheel.title = 'Custom colour';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = Binder.colorHex(color);
  picker.setAttribute('aria-label', 'Custom binder colour');
  wheel.appendChild(picker);

  // Binders with texture choices (the 9-pocket) get a dropdown that limits the colours shown.
  const finishes = Binder.finishes(type.id);
  let finish = Binder.finishOf(type.id, color);
  const finishSelect = document.getElementById('finish');
  const cardsEl = document.getElementById('cards');
  // Some textures have a fixed capacity (velvet always holds 540); otherwise use the design's own.
  const priceEl = document.getElementById('price');
  const showPrice = () => {
    Shop.renderPrice(priceEl, Shop.sale(design, design.price + Binder.finishExtra(type.id, finish)));
  };
  showPrice();
  const showCards = () => {
    const fixed = (finishes || []).find((f) => f.id === finish)?.cards;
    cardsEl.textContent = `Holds ${fixed ?? design.cards ?? 540} pockets`;
  };
  showCards();
  document.getElementById('finishField').hidden = !finishes;
  // Every other binder only comes in the diamond texture, shown as a fixed label.
  document.getElementById('finishFixed').hidden = !!finishes;
  if (finishes) {
    finishSelect.replaceChildren(...finishes.map((f) => new Option(Binder.finishLabel(f), f.id, false, f.id === finish)));
    finishSelect.addEventListener('change', () => {
      finish = finishSelect.value;
      showCards();
      showPrice();
      showSwatches();
      if (art) draw();
      else {
        colorName.textContent = Binder.colorName(color);
        slides.setBinder(type.id, color);
      }
    });
  }

  function showSwatches() {
    const list = Binder.finishColors(type.id, finish);
    if (!list.some((c) => c.id === color)) {
      color = list.some((c) => c.id === design.color) ? design.color : list[0].id;
    }
    Shop.swatches(swatchesEl, list, color, (id) => {
      color = id;
      wheel.style.removeProperty('--pick');
      draw();
    });
    wheel.setAttribute('aria-checked', 'false');
    wheel.style.removeProperty('--pick');
    if (list.every((c) => !c.texture)) swatchesEl.appendChild(wheel);
  }
  showSwatches();

  let pending = false;
  picker.addEventListener('input', () => {
    for (const el of swatchesEl.children) el.setAttribute('aria-checked', String(el === wheel));
    color = picker.value;
    wheel.style.setProperty('--pick', color);
    colorName.textContent = Binder.colorName(color);
    slides.setBinder(type.id, color);
    if (pending || !art) return;
    pending = true; // dragging in the picker fires many events; render at most once per frame
    requestAnimationFrame(() => {
      pending = false;
      draw();
    });
  });

  // Show the pre-rendered thumbnail instantly, then the full-resolution render once the art loads.
  // (The thumbnail is in the design's default colour, so skip it when another colour was requested.)
  const thumb = color === design.color ? await Shop.loadImage(Shop.thumbUrl(design)).catch(() => null) : null;
  if (thumb) {
    canvas.width = thumb.naturalWidth;
    canvas.height = thumb.naturalHeight;
    canvas.getContext('2d').drawImage(thumb, 0, 0);
  }
  colorName.textContent = Binder.colorName(color);
  art = await Shop.loadImage(design.art);
  draw();

  let qty = 1;
  const qtyEl = document.getElementById('qty');
  const setQty = (n) => {
    qty = Math.max(1, Math.min(20, n));
    qtyEl.textContent = qty;
  };
  document.getElementById('minus').addEventListener('click', () => setQty(qty - 1));
  document.getElementById('plus').addEventListener('click', () => setQty(qty + 1));

  const added = document.getElementById('added');
  document.getElementById('addBtn').addEventListener('click', () => {
    Shop.addToCart(design.id, color, qty);
    added.hidden = false;
  });
})();
