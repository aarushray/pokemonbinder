// Home page: lists every published design in a grid, with in-place binder colour switching.
(async () => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');

  let designs, collections, settings;
  try {
    ({ designs, collections, settings } = await Shop.loadCatalog());
    Shop.saleBanner(settings); // scrolling sale message while a storewide discount is on
  } catch (err) {
    empty.hidden = false;
    empty.textContent = 'Designs could not be loaded. Start the site with "npm start" and open http://localhost:3000.';
    return;
  }

  // Designs the admin featured come first, in the admin's order; the rest stay newest first.
  // Mini series designs (tagged with a "Mini Series" subclass, or named so) always go last,
  // so newly posted designs appear above them.
  const rank = (d) => {
    const i = settings.featured.indexOf(d.id);
    return i < 0 ? Infinity : i;
  };
  const isMini = (d) => [d.name, ...(d.subclasses || [])].some((s) => /\bmini ?series\b/.test(Shop.normTag(s)));
  const cards = [];
  for (const d of [...designs].sort((a, b) => isMini(a) - isMini(b) || rank(a) - rank(b))) {
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
    const subText = (hex) => `${type.name} · ${Binder.colorName(hex)}${Shop.isPreorder(type.id, hex) ? ' · Pre-order' : ''}`;
    sub.textContent = subText(d.color);
    left.append(title, sub);
    const price = document.createElement('div');
    price.className = 'card-price';
    Shop.renderPrice(price, Shop.sale(d, Shop.priceFor(d, d.color)));
    body.append(left, price);
    link.append(media, body);

    // Designs on hand are a photo of the real binder, so they only come in that one colour.
    if (Shop.isOnHand(d)) {
      sub.textContent = `${type.name} · ${Binder.colorName(d.color)} · In stock`;
      card.append(link);
      cards.push({ el: card, design: d, subs: new Set((d.subclasses || []).map(Shop.normTag)) });
      continue;
    }

    // A duo is a pair of binders; customers pick each binder's colour on its own page.
    if (Shop.isDuo(d)) {
      const pre = [d.color, d.duo.color].some((c) => Shop.isPreorder(type.id, c));
      sub.textContent = `Duo set · ${type.name} · ${Binder.colorName(d.color)} + ${Binder.colorName(d.duo.color)}${pre ? ' · Pre-order' : ''}`;
      img.alt = `${d.name} binder pair`;
      card.classList.add('card-duo');
      card.append(link);
      cards.push({ el: card, design: d, subs: new Set((d.subclasses || []).map(Shop.normTag)) });
      continue;
    }

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
    }, Shop.unavailableFor(type.id));

    card.append(link, swatches);
    cards.push({ el: card, design: d, subs: new Set((d.subclasses || []).map(Shop.normTag)) });
  }

  // Show only the selected page's designs, optionally narrowed to one of the page's subclasses
  // (e.g. Pokémon → Pikachu). The header dropdown switches pages.
  const heading = document.getElementById('designs-heading');
  const filtersEl = document.getElementById('tagFilters');
  let pageId = null;
  let subFilter = null; // normalised subclass name, or null for all

  // Searchable list of a page's character subclasses ("Find a Pokémon"): type to narrow it down,
  // pick one to filter the grid. `names` is [{ name, id, n }].
  function namePicker(names, page) {
    const noun = page.id === 'pokemon' ? 'Pokémon' : 'character';
    const wrap = document.createElement('div');
    wrap.className = 'name-picker';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'name-picker-input';
    input.placeholder = `Find a ${noun}`;
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-label', `Find a ${noun}`);
    input.setAttribute('aria-expanded', 'false');
    const list = document.createElement('ul');
    list.className = 'name-picker-list';
    list.id = 'namePickerList';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    input.setAttribute('aria-controls', list.id);
    const selected = names.find((x) => x.id === subFilter);
    if (selected) input.value = selected.name;

    let matches = [];
    let active = -1;
    const pick = (x) => {
      subFilter = x ? x.id : null;
      show();
    };
    const close = () => {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
      // Everything while the box shows the current choice; otherwise names containing the text.
      const q = Shop.normTag(input.value);
      matches = !q || (selected && input.value === selected.name) ? names : names.filter((x) => x.id.includes(q));
      active = -1;
      list.replaceChildren(...(matches.length ? matches.map((x, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `namePickerOption${i}`;
        li.setAttribute('aria-selected', String(x.id === subFilter));
        const n = document.createElement('span');
        n.className = 'chip-count';
        n.textContent = x.n;
        li.append(x.name, n);
        li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus until the click
        li.addEventListener('click', () => pick(x));
        return li;
      }) : [Object.assign(document.createElement('li'), { className: 'name-picker-empty', textContent: `No ${noun} found` })]));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const highlight = (i) => {
      active = Math.max(0, Math.min(matches.length - 1, i));
      [...list.children].forEach((li, j) => li.classList.toggle('active', j === active));
      input.setAttribute('aria-activedescendant', `namePickerOption${active}`);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('focus', open);
    input.addEventListener('input', () => {
      if (!input.value && selected) return pick(null); // cleared: back to all designs
      open();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(); highlight(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); const x = matches[active] || (matches.length === 1 && matches[0]); if (x) pick(x); }
      else if (e.key === 'Escape') { close(); input.blur(); }
    });
    input.addEventListener('blur', () => {
      close();
      if (selected && input.value !== selected.name) input.value = selected.name;
    });
    wrap.append(input, list);
    return wrap;
  }

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

    // Filters: collections (Designs on hand, series, 30th Anniversary, Duo…) as buttons, and
    // character names (e.g. Pokémon) in a searchable picker. Only subclasses with designs on this
    // page are offered, each with how many it has.
    const offered = Shop.sortSubclasses(subs)
      .map((name) => ({ name, id: Shop.normTag(name), n: onPage.filter((c) => c.subs.has(Shop.normTag(name))).length }))
      .filter((x) => x.n > 0);
    if (subFilter && !offered.some((x) => x.id === subFilter)) subFilter = null;
    const groups = offered.filter((x) => Shop.isCollectionSubclass(x.name));
    const names = offered.filter((x) => !Shop.isCollectionSubclass(x.name));

    const chip = (label, n, id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', String(subFilter === id));
      const count = document.createElement('span');
      count.className = 'chip-count';
      count.textContent = n;
      b.append(`${label} `, count);
      b.addEventListener('click', () => {
        subFilter = id;
        show();
      });
      return b;
    };
    const chips = document.createElement('div');
    chips.className = 'filter-chips';
    chips.append(chip('All designs', onPage.filter((c) => !Shop.isOnHand(c.design)).length, null), ...groups.map((x) => chip(x.name, x.n, x.id)));
    filtersEl.replaceChildren(chips);
    if (names.length) filtersEl.appendChild(namePicker(names, page));
    filtersEl.hidden = offered.length === 0;

    // Designs on hand only show under their own subclass, not in "All designs".
    const shown = subFilter ? onPage.filter((c) => c.subs.has(subFilter)) : onPage.filter((c) => !Shop.isOnHand(c.design));
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
