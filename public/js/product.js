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

  // Duo: two binders side by side, sold as a pair, each in the colour the customer picks.
  if (Shop.isDuo(design)) {
    const unavailable = Shop.unavailableFor(type.id);
    const params = new URLSearchParams(location.search);
    const valid = (c) => colors.some((x) => x.id === c);
    const picked = [
      valid(params.get('color')) ? params.get('color') : design.color,
      valid(params.get('color2')) ? params.get('color2') : design.duo.color,
    ];
    document.getElementById('typeName').textContent = `Duo set · two ${type.name} binders`;
    document.getElementById('finishField').hidden = true;
    const fixed = document.getElementById('finishFixed');
    fixed.hidden = false;
    canvas.setAttribute('aria-label', `${design.name} binder pair`);

    // A second "colour" row for the right-hand binder, under the first one.
    const swatches = [document.getElementById('swatches')];
    const names = [colorName];
    colorName.parentElement.firstChild.textContent = 'Left binder colour: ';
    const label2 = document.createElement('p');
    label2.className = 'label duo-label';
    names.push(document.createElement('strong'));
    label2.append('Right binder colour: ', names[1]);
    swatches.push(document.createElement('div'));
    swatches[1].className = 'swatches';
    swatches[1].setAttribute('role', 'radiogroup');
    swatches[1].setAttribute('aria-label', 'Right binder colour');
    swatches[0].setAttribute('aria-label', 'Left binder colour');
    swatches[0].after(label2, swatches[1]);

    const preorderEl = document.getElementById('preorder');
    const leadTime = document.getElementById('leadTime');
    const leadText = leadTime.textContent;
    const finishName = (c) => (Binder.finishes(type.id) || []).find((f) => f.id === Binder.finishOf(type.id, c))?.name || 'PU Leather';
    const showDetails = () => {
      picked.forEach((c, i) => { names[i].textContent = Binder.colorName(c); });
      fixed.querySelector('.fixed-value').textContent = [...new Set(picked.map(finishName))].join(' + ');
      Shop.renderPrice(document.getElementById('price'), Shop.sale(design, Shop.priceFor(design, picked[0], picked[1])));
      const pockets = picked.map((c) => (Binder.finishes(type.id) || []).find((f) => f.id === Binder.finishOf(type.id, c))?.cards ?? design.cards ?? 540);
      document.getElementById('cards').textContent = pockets[0] === pockets[1] ? `Each holds ${pockets[0]} pockets` : `Hold ${pockets[0]} and ${pockets[1]} pockets`;
      const pre = picked.some((c) => unavailable.includes(c));
      preorderEl.hidden = !pre;
      preorderEl.textContent = Shop.PREORDER_NOTE;
      leadTime.textContent = pre ? 'Pre-order: a colour you picked is out of stock, so your binders will be completed in 3–4 weeks' : leadText;
    };

    // Front and back slides: the page draws the fronts, the slides draw the backs.
    const slides = Shop.coverSlides(canvas);
    slides.setDuo(type.id, picked[0], picked[1]);
    let images = null;
    const draw = () => {
      slides.setDuo(type.id, picked[0], picked[1]);
      if (images) Shop.renderDuo(canvas, { image: images[0], image2: images[1], color: picked[0], color2: picked[1], type: type.id });
    };
    picked.forEach((c, i) => Shop.swatches(swatches[i], colors, c, (id) => {
      picked[i] = id;
      showDetails();
      draw();
    }, unavailable));
    showDetails();
    buyButtons(() => picked[0], 20, () => picked[1]);

    // The saved thumbnail shows the default colours, so show it while the artwork loads.
    if (picked[0] === design.color && picked[1] === design.duo.color) {
      const thumb = await Shop.loadImage(Shop.thumbUrl(design)).catch(() => null);
      if (thumb && !images) Shop.drawPhoto(canvas, thumb);
    }
    images = await Promise.all([design.art, design.duo.art].map((src) => Shop.loadImage(src)));
    draw();
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
  // most `max` in the cart. For a duo, getColor2() is the right-hand binder's colour.
  function buyButtons(getColor, max = 20, getColor2 = null) {
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
      Shop.addToCart(design.id, getColor(), qty, max, getColor2 && getColor2());
      added.hidden = false;
    });
  }
})();
