// Product page: shows one design engraved on a binder and adds it to the cart.
(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const missing = document.getElementById('missing');

  let design;
  try {
    design = (await Shop.loadDesigns()).find((d) => d.id === id);
  } catch {
    // handled below as "not found"
  }
  if (!design) {
    missing.hidden = false;
    return;
  }

  document.title = `${design.name} · PokeEngrave`;
  document.getElementById('name').textContent = design.name;
  document.getElementById('price').textContent = Shop.money(design.price);
  const type = Shop.designType(design);
  const colors = Binder.typeColors(type.id);
  document.getElementById('typeName').textContent = `${type.name} binder`;
  document.getElementById('pockets').textContent = `${type.pockets} pockets per page, side-loading`;  document.getElementById('cards').textContent = `Holds ${design.cards ?? 540} cards`;
  document.getElementById('product').hidden = false;

  const canvas = document.getElementById('canvas');
  const colorName = document.getElementById('colorName');
  // The home page passes the colour picked on the card, if any.
  const requested = new URLSearchParams(location.search).get('color');
  let color = colors.some((c) => c.hex === requested) ? requested : design.color;
  let art = null;

  function draw() {
    colorName.textContent = Binder.colorName(color);
    Binder.render(canvas, { image: art, color, type: type.id });
  }

  Shop.swatches(document.getElementById('swatches'), colors, color, (hex) => {
    color = hex;
    draw();
  });

  // Show the pre-rendered thumbnail instantly, then the full-resolution render once the art loads.
  // (The thumbnail is in the design's default colour, so skip it when another colour was requested.)
  const thumb = color === design.color ? await Shop.loadImage(design.thumb).catch(() => null) : null;
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
