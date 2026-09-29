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
    const n = cartCount();
    for (const el of document.querySelectorAll('[data-cart-count]')) {
      el.textContent = n;
      if (el.classList.contains('cart-badge')) el.hidden = n === 0; // header bag icon: no badge when empty
    }
    const cart = document.querySelector('.header-cart');
    if (cart) cart.setAttribute('aria-label', `Cart, ${n} ${n === 1 ? 'item' : 'items'}`);
  }

  // Designs and the shop's pages ({ designs, collections }), fetched once per page load.
  // Pass fresh = true after changing them (admin page).
  let catalogPromise = null;
  function loadCatalog(fresh = false) {
    if (fresh || !catalogPromise) {
      catalogPromise = fetch('designs/designs.json', { cache: 'no-store' }).then(async (res) => {
        if (!res.ok) throw new Error(`Could not load designs (${res.status})`);
        const db = await res.json();
        return { designs: db.designs || [], collections: db.collections || [] };
      });
      catalogPromise.catch(() => { catalogPromise = null; });
    }
    return catalogPromise;
  }

  async function loadDesigns(fresh = false) {
    return (await loadCatalog(fresh)).designs;
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

  // Thumbnail URL that changes when the design is edited, so browsers don't show a stale image.
  const thumbUrl = (d) => (d.updatedAt ? `${d.thumb}?v=${encodeURIComponent(d.updatedAt)}` : d.thumb);

  // Colour swatch radio buttons for `colors` (COLORS entries); calls onPick(id) when one is chosen.
  function swatches(container, colors, selected, onPick) {
    container.replaceChildren();
    for (const c of colors) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--c', c.hex);
      if (c.texture === 'felt') b.classList.add('swatch-felt');
      b.title = c.name;
      b.dataset.id = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-checked', String(c.id === selected));
      b.addEventListener('click', () => {
        for (const el of container.children) el.setAttribute('aria-checked', String(el === b));
        onPick(c.id);
      });
      container.appendChild(b);
    }
  }

  window.addEventListener('storage', updateCartCount);
  updateCartCount();

  // ---- Pages (Pokémon, One Piece, ...) and their subclasses ----
  // Pages are managed on the admin page. Each design belongs to one page (`design.page`) and may
  // be tagged with some of that page's subclasses, which the shop shows as filters.

  const PAGE_KEY = 'binder-page';

  // Names compare ignoring case, accents and extra spaces ("pokemon" matches "Pokémon").
  function normTag(s) {
    return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // The design's page id, or null if that page no longer exists.
  function pageOf(design, collections) {
    return collections.some((c) => c.id === design.page) ? design.page : null;
  }

  // The page being browsed: ?page= in the URL, else the last one chosen, else the first page.
  function currentPage(collections) {
    const valid = (id) => collections.some((c) => c.id === id);
    const fromUrl = new URLSearchParams(location.search).get('page');
    if (valid(fromUrl)) return fromUrl;
    try {
      const saved = localStorage.getItem(PAGE_KEY);
      if (valid(saved)) return saved;
    } catch {
      // storage unavailable
    }
    return collections.length ? collections[0].id : null;
  }

  function setPage(id) {
    if (!id) return;
    try {
      localStorage.setItem(PAGE_KEY, id);
    } catch {
      // not remembered
    }
    const select = document.querySelector('.page-select');
    if (select) select.value = id;
  }

  // Header in three zones across the full width: links on the left, the logo centred, the cart
  // on the right. (The pages dropdown is added at the start of the left zone.)
  function layoutHeader() {
    const container = document.querySelector('.site-header .container');
    const logo = container && container.querySelector('.logo');
    if (!logo) return;
    const left = document.createElement('nav');
    left.className = 'header-left';
    left.setAttribute('aria-label', 'Main');
    const center = document.createElement('div');
    center.className = 'header-center';
    const right = document.createElement('div');
    right.className = 'header-right';
    let cart = null;
    for (const a of container.querySelectorAll('.nav a')) {
      if (a.getAttribute('href') === 'cart.html') cart = a;
      else if (a.hasAttribute('data-right')) {
        a.classList.add('header-button');
        right.appendChild(a);
      } else left.appendChild(a);
    }
    center.appendChild(logo);
    container.replaceChildren(left, center, right);

    // Right side: currency label, search, cart bag (shop pages only; admin keeps it empty).
    if ('noPages' in document.body.dataset) return;
    const currency = document.createElement('span');
    currency.className = 'header-currency';
    currency.textContent = 'SGD';
    currency.title = 'Prices are in Singapore dollars';
    const search = document.createElement('button');
    search.type = 'button';
    search.className = 'icon-btn';
    search.setAttribute('aria-label', 'Search designs');
    search.setAttribute('aria-expanded', 'false');
    search.innerHTML = ICONS.search;
    right.append(currency, search);
    if (cart) {
      cart.className = 'icon-btn header-cart';
      cart.innerHTML = `${ICONS.bag}<span class="cart-badge" data-cart-count hidden>0</span>`;
      right.appendChild(cart);
    }
    searchPanel(container.parentElement, search);
  }

  const ICONS = {
    search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    bag: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  };

  // Search box that drops down under the header; finds designs by name, page, subclass or binder
  // type and links to them.
  function searchPanel(header, button) {
    const panel = document.createElement('div');
    panel.className = 'search-panel';
    panel.hidden = true;
    const inner = document.createElement('div');
    inner.className = 'search-inner';
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search designs, e.g. Pikachu or One Piece';
    input.setAttribute('aria-label', 'Search designs');
    const results = document.createElement('ul');
    results.className = 'search-results';
    inner.append(input, results);
    panel.appendChild(inner);
    header.appendChild(panel);

    const setOpen = (open) => {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) input.focus();
    };
    button.addEventListener('click', () => setOpen(panel.hidden));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });
    document.addEventListener('click', (e) => { if (!panel.hidden && !header.contains(e.target)) setOpen(false); });

    input.addEventListener('input', async () => {
      const q = normTag(input.value);
      if (!q) {
        results.replaceChildren();
        return;
      }
      let catalog;
      try {
        catalog = await loadCatalog();
      } catch {
        return;
      }
      const words = q.split(' ');
      const hits = catalog.designs.filter((d) => {
        const page = catalog.collections.find((c) => c.id === d.page);
        if (!page) return false; // hidden from the shop
        const text = normTag([d.name, page.name, ...(d.subclasses || []), designType(d).name].join(' '));
        return words.every((w) => text.includes(w));
      });
      if (!hits.length) {
        const li = document.createElement('li');
        li.className = 'search-empty';
        li.textContent = 'No designs found.';
        results.replaceChildren(li);
        return;
      }
      results.replaceChildren(...hits.slice(0, 8).map((d) => {
        const page = catalog.collections.find((c) => c.id === d.page);
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `design.html?id=${encodeURIComponent(d.id)}`;
        const img = document.createElement('img');
        img.src = thumbUrl(d);
        img.alt = '';
        const text = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = d.name;
        const meta = document.createElement('small');
        meta.textContent = `${page.name} · ${designType(d).name}`;
        text.append(name, meta);
        const price = document.createElement('span');
        price.className = 'search-price';
        price.textContent = money(d.price);
        a.append(img, text, price);
        li.appendChild(a);
        return li;
      }));
    });
  }

  // Dropdown listing the shop's pages, left of the logo. On the home page it fires a
  // 'pagechange' event so the grid re-filters in place; elsewhere it goes to that page.
  async function pageSwitcher() {
    const left = document.querySelector('.site-header .header-left');
    if (!left || 'noPages' in document.body.dataset) return;
    let collections;
    try {
      ({ collections } = await loadCatalog());
    } catch {
      return;
    }
    if (!collections.length) return;
    const select = document.createElement('select');
    select.className = 'page-select';
    select.setAttribute('aria-label', 'Binder collection');
    const current = currentPage(collections);
    for (const c of collections) select.add(new Option(`${c.name} binders`, c.id, false, c.id === current));
    select.addEventListener('change', () => {
      setPage(select.value);
      if (document.body.dataset.page === 'home') {
        window.dispatchEvent(new CustomEvent('pagechange', { detail: select.value }));
      } else {
        location.href = `index.html?page=${encodeURIComponent(select.value)}`;
      }
    });
    left.prepend(select);
  }

  // Drops cart lines whose design has since been deleted from the shop.
  function pruneCart(validIds) {
    const items = readCart();
    const kept = items.filter((i) => validIds.has(i.id));
    if (kept.length !== items.length) writeCart(kept);
  }

  layoutHeader();
  updateCartCount();
  pageSwitcher();

  return {
    readCart, addToCart, setQty, pruneCart, loadDesigns, loadImage, money, thumbUrl, swatches, designType,
    loadCatalog, normTag, pageOf, currentPage, setPage,
  };
})();
