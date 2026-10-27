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

  // Designs on hand: a photo of the real binder, sold as it is in its one colour and material.
  if (Shop.isOnHand(design)) {
    const finish = (Binder.finishes(type.id) || []).find((f) => f.id === Binder.finishOf(type.id, design.color));
    colorName.textContent = Binder.colorName(design.color);
    document.getElementById('swatches').hidden = true;
    const fixed = document.getElementById('finishFixed');
    fixed.hidden = false;
    fixed.querySelector('.fixed-value').textContent = finish ? finish.name : 'PU Leather';
    Shop.renderPrice(document.getElementById('price'), Shop.sale(design, design.price + Binder.finishExtra(type.id, finish && finish.id)));
    document.getElementById('cards').textContent = `Holds ${finish?.cards ?? design.cards ?? 540} pockets`;
    document.getElementById('madeToOrder').textContent = 'In stock: this is the binder you will receive';
    document.getElementById('leadTime').hidden = true; // already made, no waiting
    canvas.setAttribute('aria-label', `Photo of the ${design.name} binder`);
    document.querySelector('.qty').hidden = true; // one of a kind
    buyButtons(() => design.color, 1);
    const [photo, back] = await Promise.all([design.art, design.back]
      .map((src) => (src ? Shop.loadImage(src).catch(() => null) : null)));
    if (photo) Shop.drawPhoto(canvas, photo);
    if (photo && back) Shop.coverSlides(canvas).setPhotos(photo, back); // front/back arrows
    return;
  }

  // The home page passes the colour picked on the card, if any.
  const requested = new URLSearchParams(location.search).get('color');
  const unavailable = Shop.unavailableFor(type.id);
  // Out-of-stock colours can still be picked (as a pre-order), but an in-stock one is chosen first.
  const firstOpen = (colors.find((c) => !unavailable.includes(c.id)) || colors[0]).id;
  let color = colors.some((c) => c.id === requested) ? requested
    : !unavailable.includes(design.color) ? design.color : firstOpen;
  let art = null;

  const slides = Shop.coverSlides(canvas);
  slides.setBinder(type.id, color);

  // Pre-order note under the swatches, and the lead time in the details, for out-of-stock colours.
  const preorderEl = document.getElementById('preorder');
  const leadTime = document.getElementById('leadTime');
  const leadText = leadTime.textContent;
  const showColor = () => {
    colorName.textContent = Binder.colorName(color);
    const pre = unavailable.includes(color);
    preorderEl.hidden = !pre;
    preorderEl.textContent = Shop.PREORDER_NOTE;
    leadTime.textContent = pre ? 'Pre-order: this colour is out of stock, so your binder will be completed in 3–4 weeks' : leadText;
  };

  function draw() {
    showColor();
    slides.setBinder(type.id, color, { image: art });
    Binder.render(canvas, { image: art, color, type: type.id });
  }

  const swatchesEl = document.getElementById('swatches');

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
    // A material whose colours are all out of stock is marked as pre-order only.
    finishSelect.replaceChildren(...finishes.map((f) => {
      const none = f.colors.every((c) => unavailable.includes(c));
      return new Option(none ? `${Binder.finishLabel(f)} (pre-order)` : Binder.finishLabel(f), f.id, false, f.id === finish);
    }));
    finishSelect.addEventListener('change', () => {
      finish = finishSelect.value;
      showCards();
      showPrice();
      showSwatches();
      if (art) draw();
      else {
        showColor();
        slides.setBinder(type.id, color);
      }
    });
  }

  function showSwatches() {
    const list = Binder.finishColors(type.id, finish);
    const open = list.filter((c) => !unavailable.includes(c.id));
    if (!list.some((c) => c.id === color)) {
      color = open.some((c) => c.id === design.color) ? design.color : (open[0] || list[0]).id;
    }
    Shop.swatches(swatchesEl, list, color, (id) => {
      color = id;
      draw();
    }, unavailable);
  }
  showSwatches();

  // Show the pre-rendered thumbnail instantly, then the full-resolution render once the art loads.
  // (The thumbnail is in the design's default colour, so skip it when another colour was requested.)
  const thumb = color === design.color ? await Shop.loadImage(Shop.thumbUrl(design)).catch(() => null) : null;
  if (thumb) {
    canvas.width = thumb.naturalWidth;
    canvas.height = thumb.naturalHeight;
    canvas.getContext('2d').drawImage(thumb, 0, 0);
  }
  showColor();
  art = await Shop.loadImage(design.art);
  draw();

  buyButtons(() => color);

  // Quantity buttons and "Add to cart", adding the binder in the colour getColor() returns, at
  // most `max` in the cart.
  function buyButtons(getColor, max = 20) {
    let qty = 1;
    const qtyEl = document.getElementById('qty');
    const setQty = (n) => {
      qty = Math.max(1, Math.min(max, n));
      qtyEl.textContent = qty;
    };
    document.getElementById('minus').addEventListener('click', () => setQty(qty - 1));
    document.getElementById('plus').addEventListener('click', () => setQty(qty + 1));

    const added = document.getElementById('added');
    document.getElementById('addBtn').addEventListener('click', () => {
      Shop.addToCart(design.id, getColor(), qty, max);
      added.hidden = false;
    });
  }
})();
