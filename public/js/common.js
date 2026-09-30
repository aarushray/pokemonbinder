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

  // Custom designs in the cart: { id: 'custom-…', custom: true, type, color, qty }, with the artwork
  // kept by CustomArt under the same id. Each is its own line (never merged), priced at the binder's
  // base price plus any texture surcharge, and never discounted.
  const isCustom = (item) => item.custom === true;

  function customPrice(item) {
    const t = Binder.getType(item.type);
    return t.basePrice + Binder.finishExtra(t.id, Binder.finishOf(t.id, item.color));
  }

  function addCustomToCart(entry) {
    const items = readCart();
    items.push({ ...entry, custom: true });
    writeCart(items);
  }

  // Ids of every custom design in any cart on this browser (the current one and set-aside ones).
  function customArtIds() {
    const ids = new Set();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== CART_KEY && !key.startsWith(`${CART_KEY}:`)) continue;
        const items = JSON.parse(localStorage.getItem(key));
        if (Array.isArray(items)) for (const it of items) if (isCustom(it)) ids.add(it.id);
      }
    } catch {
      // Storage blocked: nothing to keep.
    }
    return ids;
  }

  function clearCart() {
    writeCart([]);
  }

  // Carts belong to whoever is logged in on this browser. Logging out sets the cart aside for that
  // account (so the next person starts empty); logging back in brings back exactly that cart.
  // Anything added while logged out is discarded on log in.
  const savedCartKey = (userId) => `${CART_KEY}:${userId}`;

  function stashCart(userId) {
    try {
      const items = readCart();
      if (items.length) localStorage.setItem(savedCartKey(userId), JSON.stringify(items));
      else localStorage.removeItem(savedCartKey(userId));
    } catch {
      // Storage blocked: nothing to set aside.
    }
    writeCart([]);
  }

  function restoreCart(userId) {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(savedCartKey(userId))) || [];
      localStorage.removeItem(savedCartKey(userId));
    } catch {
      // Storage blocked: the account starts with an empty cart.
    }
    writeCart(Array.isArray(saved) ? saved : []);
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
  let storeDiscount = 0; // percent, from the admin page (set when the catalogue loads)

  function loadCatalog(fresh = false) {
    if (fresh || !catalogPromise) {
      catalogPromise = fetch('designs/designs.json', { cache: 'no-store' }).then(async (res) => {
        if (!res.ok) throw new Error(`Could not load designs (${res.status})`);
        const db = await res.json();
        storeDiscount = Number(db.settings && db.settings.storeDiscount) || 0;
        return { designs: db.designs || [], collections: db.collections || [], settings: { storeDiscount } };
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

  // Price of a design in a colour: the admin's price, plus the texture surcharge when that colour
  // is a velvet one (velvet is always $5 more than diamond).
  function priceFor(design, color) {
    const typeId = designType(design).id;
    return design.price + Binder.finishExtra(typeId, Binder.finishOf(typeId, color));
  }

  // Discount on a shop design: the storewide one while it's on (binders' own discounts are reset
  // and locked then), otherwise the binder's own. They never stack. (Custom designs don't use
  // this, so they're never discounted.)
  function discountFor(design) {
    return storeDiscount > 0 ? storeDiscount : design.discount || 0;
  }

  // { original, price, discount } for a design at a full price (e.g. from priceFor).
  function sale(design, original) {
    const discount = discountFor(design);
    const price = discount ? Math.round(original * (100 - discount)) / 100 : original;
    return { original, price, discount };
  }

  // Writes a price into el: just the price, or the crossed-out original, the sale price and a
  // "-20%" badge when discounted.
  function renderPrice(el, info) {
    el.classList.toggle('on-sale', info.discount > 0);
    if (!info.discount) {
      el.textContent = money(info.price);
      return;
    }
    const was = document.createElement('s');
    was.className = 'price-was';
    was.textContent = money(info.original);
    const now = document.createElement('span');
    now.className = 'price-now';
    now.textContent = money(info.price);
    const badge = document.createElement('span');
    badge.className = 'sale-badge';
    badge.textContent = `-${info.discount}%`;
    el.replaceChildren(was, ' ', now, ' ', badge);
  }

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
    // Account: goes to the log in page (which shows who's logged in, with a Log out button).
    const account = document.createElement('a');
    account.href = 'login.html';
    account.className = 'icon-btn';
    account.setAttribute('aria-label', 'Account');
    account.title = 'Log in or sign up';
    account.innerHTML = ICONS.account;
    if (/\/(login|signup|reset-password)\.html$/.test(location.pathname)) account.setAttribute('aria-current', 'page');
    right.append(currency, search, account);
    if (cart) {
      cart.className = 'icon-btn header-cart';
      cart.innerHTML = `${ICONS.bag}<span class="cart-badge" data-cart-count hidden>0</span>`;
      right.appendChild(cart);
    }
    searchPanel(container.parentElement, search);
  }

  const ICONS = {
    account: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5"/></svg>',
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
        renderPrice(price, sale(d, priceFor(d, d.color)));
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
  // Two slides for a binder preview: the front cover (the page's own canvas, with the design) and
  // the back cover (the same binder mirrored, no design), switched with arrows, the dots or a swipe.
  // Call setBinder(type, color) whenever the binder changes so the back cover matches.
  const CHEVRON = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

  function coverSlides(front) {
    const stage = front.parentElement;
    stage.classList.add('cover-slides');
    front.setAttribute('aria-label', 'Front cover');
    const back = document.createElement('canvas');
    back.setAttribute('aria-label', 'Back cover');
    back.hidden = true;
    front.after(back);

    const arrow = (cls, label, path, to) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `slide-arrow ${cls}`;
      b.setAttribute('aria-label', label);
      b.innerHTML = CHEVRON(path);
      b.addEventListener('click', () => show(to));
      stage.appendChild(b);
      return b;
    };
    const prev = arrow('slide-prev', 'Show front cover', 'm15 18-6-6 6-6', 0);
    const next = arrow('slide-next', 'Show back cover', 'm9 18 6-6-6-6', 1);

    const dots = document.createElement('div');
    dots.className = 'slide-dots';
    const dotEls = ['Front cover', 'Back cover'].map((label, i) => {
      const d = document.createElement('button');
      d.type = 'button';
      d.setAttribute('aria-label', label);
      d.addEventListener('click', () => show(i));
      dots.appendChild(d);
      return d;
    });
    stage.appendChild(dots);

    let index = 0;
    let binder = null;
    let backDrawn = false;
    function drawBack() {
      if (!binder || backDrawn) return;
      Binder.render(back, { type: binder.type, color: binder.color, back: true });
      backDrawn = true;
    }
    function show(i) {
      index = i;
      if (i === 1) drawBack();
      front.hidden = i !== 0;
      back.hidden = i !== 1;
      prev.hidden = i === 0;
      next.hidden = i === 1;
      dotEls.forEach((d, j) => d.setAttribute('aria-current', String(j === i)));
    }

    // Swipe left/right on touch screens.
    let startX = null;
    stage.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) show(dx < 0 ? 1 : 0);
    });

    show(0);
    return {
      show,
      setBinder(type, color) {
        if (binder && binder.type === type && binder.color === color) return;
        binder = { type, color };
        backDrawn = false;
        if (index === 1) drawBack();
      },
    };
  }

  function pruneCart(validIds) {
    const items = readCart();
    const kept = items.filter((i) => isCustom(i) || validIds.has(i.id));
    if (kept.length !== items.length) writeCart(kept);
  }

  layoutHeader();
  updateCartCount();
  pageSwitcher();

  return {
    coverSlides, isCustom, customPrice, addCustomToCart, customArtIds, priceFor, discountFor, sale, renderPrice, readCart, addToCart, setQty, clearCart, stashCart, restoreCart, pruneCart, loadDesigns, loadImage, money, thumbUrl, swatches, designType,
    loadCatalog, normTag, pageOf, currentPage, setPage,
  };
})();
