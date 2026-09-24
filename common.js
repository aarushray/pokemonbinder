// Shared shop helpers: design catalogue, cart (kept in this browser), header cart count.
const Shop = (() => {
  const CART_KEY = 'binder-cart';

  function readCart() {
    try {
      const items = JSON.parse(localStorage.getItem(CART_KEY));
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  }

  function writeCart(items) {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(items));
    } catch {
      // Storage blocked (private mode etc.): the cart just won't persist.
    }
    updateCartCount();
  }

  // Type info for a design (designs published before binder types existed are 9-pocket).
  function designType(design) {
    return Binder.getType(design.type);
  }

  function addToCart(id, color, qty) {
    const items = readCart();
    const line = items.find((i) => i.id === id && i.color === color);
    if (line) line.qty += qty;
    else items.push({ id, color, qty });
    writeCart(items);
  }

  function setQty(id, color, qty) {
    let items = readCart();
    if (qty <= 0) items = items.filter((i) => !(i.id === id && i.color === color));
    else for (const i of items) if (i.id === id && i.color === color) i.qty = qty;
    writeCart(items);
  }

  function cartCount() {
    return readCart().reduce((n, i) => n + i.qty, 0);
  }

  function updateCartCount() {
    for (const el of document.querySelectorAll('[data-cart-count]')) el.textContent = cartCount();
  }

  async function loadDesigns() {
    const res = await fetch('designs/designs.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not load designs (${res.status})`);
    return (await res.json()).designs || [];
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${src}`));
      img.src = src;
    });
  }

  const money = (n) => `$${Number(n).toFixed(2)}`;

  // Colour swatch radio buttons for `colors` ({name, hex} list); calls onPick(hex) when one is chosen.
  function swatches(container, colors, selected, onPick) {
    container.replaceChildren();
    for (const c of colors) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = c.hex;
      b.title = c.name;
      b.dataset.hex = c.hex;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-checked', String(c.hex === selected));
      b.addEventListener('click', () => {
        for (const el of container.children) el.setAttribute('aria-checked', String(el === b));
        onPick(c.hex);
      });
      container.appendChild(b);
    }
  }

  window.addEventListener('storage', updateCartCount);
  updateCartCount();

  // Drops cart lines whose design has since been deleted from the shop.
  function pruneCart(validIds) {
    const items = readCart();
    const kept = items.filter((i) => validIds.has(i.id));
    if (kept.length !== items.length) writeCart(kept);
  }

  return { readCart, addToCart, setQty, pruneCart, loadDesigns, loadImage, money, swatches, designType };
})();
