// Home page: lists every published design in a grid, with in-place binder colour switching.
(async () => {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('empty');
  const count = document.getElementById('count');

  let designs;
  try {
    designs = await Shop.loadDesigns();
  } catch (err) {
    empty.hidden = false;
    empty.textContent = 'Designs could not be loaded. Start the site with "npm start" and open http://localhost:3000.';
    return;
  }

  count.textContent = `${designs.length} ${designs.length === 1 ? 'design' : 'designs'}`;
  empty.hidden = designs.length > 0;

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
    price.textContent = Shop.money(d.price);
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
    grid.appendChild(card);
  }
})();
