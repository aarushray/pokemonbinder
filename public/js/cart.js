// Cart page: lists cart lines with a small render of each binder in its chosen colour.
(async () => {
  const linesEl = document.getElementById('lines');
  let designs = [];
  try {
    designs = await Shop.loadDesigns();
  } catch {
    // Treated as an empty catalogue: lines for unknown designs are skipped (but kept in the cart).
  }
  const byId = new Map(designs.map((d) => [d.id, d]));
  if (designs.length) Shop.pruneCart(byId);
  const artCache = new Map();

  function art(design) {
    if (!artCache.has(design.id)) artCache.set(design.id, Shop.loadImage(design.art).catch(() => null));
    return artCache.get(design.id);
  }

  function render() {
    const items = Shop.readCart().filter((i) => byId.has(i.id));
    document.getElementById('empty').hidden = items.length > 0;
    document.getElementById('cart').hidden = items.length === 0;
    linesEl.replaceChildren();

    let total = 0;
    let count = 0;
    for (const item of items) {
      const d = byId.get(item.id);
      total += d.price * item.qty;
      count += item.qty;

      const line = document.createElement('div');
      line.className = 'cart-line';

      const thumb = document.createElement('a');
      thumb.className = 'cart-thumb';
      thumb.href = `design.html?id=${encodeURIComponent(d.id)}`;
      const canvas = document.createElement('canvas');
      thumb.appendChild(canvas);
      const type = Shop.designType(d);
      art(d).then((img) => Binder.render(canvas, { image: img, color: item.color, type: type.id, scale: 0.15 }));

      const info = document.createElement('div');
      const name = document.createElement('a');
      name.className = 'name';
      name.href = thumb.href;
      name.textContent = d.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${type.name} · ${Binder.colorName(item.color)} · ${Shop.money(d.price)}`;
      info.append(name, meta);

      const right = document.createElement('div');
      right.className = 'line-right';
      const qty = document.createElement('div');
      qty.className = 'qty';
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      minus.setAttribute('aria-label', 'Decrease quantity');
      minus.addEventListener('click', () => { Shop.setQty(d.id, item.color, item.qty - 1); render(); });
      const n = document.createElement('span');
      n.textContent = item.qty;
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Increase quantity');
      plus.addEventListener('click', () => { Shop.setQty(d.id, item.color, Math.min(20, item.qty + 1)); render(); });
      qty.append(minus, n, plus);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => { Shop.setQty(d.id, item.color, 0); render(); });
      right.append(qty, remove);

      line.append(thumb, info, right);
      linesEl.appendChild(line);
    }

    document.getElementById('items').textContent = count;
    document.getElementById('subtotal').textContent = Shop.money(total);
  }

  document.getElementById('checkout').addEventListener('click', () => {
    document.getElementById('checkoutNote').hidden = false;
  });

  render();
})();
