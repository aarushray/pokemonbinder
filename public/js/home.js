// Home page: lists every published design in a grid, with in-place binder colour switching.
(async () => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');

  let designs, collections;
  try {
    ({ designs, collections } = await Shop.loadCatalog());
  } catch (err) {
    empty.hidden = false;
    empty.textContent = 'Designs could not be loaded. Start the site with "npm start" and open http://localhost:3000.';
    return;
  }

  const cards = [];
  for (const d of designs) {
    const card = document.createElement('div');
    card.className = 'card';

    // Media and title link to the product page; the swatches below sit outside the link.
    const link = document.createElement('a');
    link.className = 'card-link';
    const setHref = (color) => {
      link.href = `design.html?id=${encodeURIComponent(d.id)}`
        + (color === d.color ? '' : `&color=${encodeURIComponent(color)}`);
    };
    setHref(d.color);

    const media = document.createElement('div');
    media.className = 'card-media';
    const img = document.createElement('img');
    img.src = Shop.thumbUrl(d);
    img.alt = `${d.name} binder`;
    img.loading = 'lazy';
    const canvas = document.createElement('canvas');
    canvas.hidden = true;
    canvas.setAttribute('role', 'img');
    media.append(img, canvas);

    const body = document.createElement('div');
    body.className = 'card-body';
    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = d.name;
    const type = Shop.designType(d);
    const sub = document.createElement('div');
    sub.className = 'card-sub';
    const subText = (hex) => `${type.name} · ${Binder.colorName(hex)}`;
    sub.textContent = subText(d.color);
    left.append(title, sub);
    const price = document.createElement('div');
    price.className = 'card-price';
    Shop.renderPrice(price, Shop.sale(d, Shop.priceFor(d, d.color)));
    body.append(left, price);
    link.append(media, body);

    // Other colours are rendered on demand from the full artwork (loaded on first use).
    let art = null;
    let current = d.color;
    const swatches = document.createElement('div');
    swatches.className = 'swatches swatches-sm';
    swatches.setAttribute('role', 'radiogroup');
    swatches.setAttribute('aria-label', `${d.name} binder colour`);
    Shop.swatches(swatches, Binder.typeColors(type.id), d.color, async (hex) => {
      current = hex;
      sub.textContent = subText(hex);
      Shop.renderPrice(price, Shop.sale(d, Shop.priceFor(d, hex)));
      setHref(hex);
      canvas.setAttribute('aria-label', `${d.name} binder in ${Binder.colorName(hex)}`);
      if (hex === d.color) {
        img.hidden = false;
        canvas.hidden = true;
        return;
      }
      media.classList.add('loading');
      art = art || Shop.loadImage(d.art);
      const image = await art.catch(() => null);
      media.classList.remove('loading');
      if (!image || current !== hex) return; // failed, or another swatch was picked meanwhile
      Binder.render(canvas, { image, color: hex, type: type.id, scale: 0.5 });
      img.hidden = true;
      canvas.hidden = false;
    });

    card.append(link, swatches);
    cards.push({ el: card, design: d, subs: new Set((d.subclasses || []).map(Shop.normTag)) });
  }

  // Show only the selected page's designs, optionally narrowed to one of the page's subclasses
  // (e.g. Pokémon → Pikachu). The header dropdown switches pages.
  const heading = document.getElementById('designs-heading');
  const filtersEl = document.getElementById('tagFilters');
  let pageId = null;
  let subFilter = null; // normalised subclass name, or null for all

  function show() {
    const page = collections.find((c) => c.id === pageId);
    if (!page) {
      grid.replaceChildren();
      filtersEl.hidden = true;
      heading.textContent = 'Designs';
      count.textContent = '';
      empty.hidden = false;
      empty.textContent = 'No designs yet.';
      return;
    }
    const onPage = cards.filter((c) => c.design.page === page.id);
    const subs = page.subclasses || [];
    if (subFilter && !subs.some((s) => Shop.normTag(s) === subFilter)) subFilter = null;

    // Subclass filter dropdown: names starting with a number first, in numerical order
    // ("4th" before "30th"), then the rest alphabetically.
    const startsWithDigit = (s) => /^\d/.test(s);
    const sorted = [...subs].sort((a, b) =>
      startsWithDigit(b) - startsWithDigit(a) ||
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const select = document.createElement('select');
    select.className = 'sub-filter';
    select.setAttribute('aria-label', 'Filter designs');
    select.add(new Option('All designs', ''));
    for (const s of sorted) select.add(new Option(s, Shop.normTag(s), false, Shop.normTag(s) === subFilter));
    select.addEventListener('change', () => {
      subFilter = select.value || null;
      show();
    });
    filtersEl.replaceChildren(select);
    filtersEl.hidden = subs.length === 0;

    const shown = subFilter ? onPage.filter((c) => c.subs.has(subFilter)) : onPage;
    grid.replaceChildren(...shown.map((c) => c.el));
    heading.textContent = `${page.name} designs`;
    count.textContent = `${shown.length} ${shown.length === 1 ? 'design' : 'designs'}`;
    empty.hidden = shown.length > 0;
    empty.textContent = subFilter ? 'No designs in this category yet.' : `No ${page.name} designs yet.`;
    document.title = `${page.name} binders · TCGEngrave`;
    history.replaceState(null, '', `?page=${encodeURIComponent(page.id)}`);
  }

  window.addEventListener('pagechange', (e) => {
    pageId = e.detail;
    subFilter = null;
    show();
  });
  pageId = Shop.currentPage(collections);
  show();
})();
