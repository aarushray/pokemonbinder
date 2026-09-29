// Admin page: queue up design uploads, publish them to the shop, and delete published ones.
(() => {
  const queue = [];
  const queueEl = document.getElementById('queue');
  const queueGroup = document.getElementById('queueGroup');
  const statusEl = document.getElementById('status');
  const keyField = document.getElementById('keyField');
  const keyInput = document.getElementById('adminKey');
  const publishBtn = document.getElementById('publishBtn');

  try {
    keyInput.value = sessionStorage.getItem('admin-key') || '';
    if (keyInput.value) keyField.hidden = false;
  } catch {
    // sessionStorage unavailable: the password just won't be remembered.
  }

  function setStatus(msg, isError = false) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  }

  function nameFromFile(file) {
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  function renderQueue() {
    queueGroup.hidden = queue.length === 0;
    queueEl.replaceChildren(...queue.map((item) => item.el));
  }

  // ---- Pages and subclasses ----
  // The shop's pages (Pokémon, One Piece, ...), each with its own subclasses (Pikachu, 30th
  // Anniversary, ...). Every design belongs to one page and can be tagged with that page's
  // subclasses, which the shop shows as filters.
  let collections = [];
  let allDesigns = [];

  const pageName = (id) => (collections.find((c) => c.id === id) || {}).name;

  // "Page" dropdown plus a checkbox per subclass of the chosen page. `state` is { page, subclasses }
  // (subclasses: array of names) and is updated in place. Re-renders when pages or subclasses change.
  const pickers = new Set();
  function pageField(state) {
    const wrap = document.createElement('div');
    wrap.className = 'page-picker';

    const render = () => {
      if (!collections.some((c) => c.id === state.page)) state.page = collections.length ? collections[0].id : null;
      const page = collections.find((c) => c.id === state.page);
      const keep = new Set((page ? page.subclasses : []).map(Shop.normTag));
      state.subclasses = state.subclasses.filter((s) => keep.has(Shop.normTag(s)));

      const select = document.createElement('select');
      if (!collections.length) {
        select.add(new Option('Add a page first', ''));
        select.disabled = true;
      }
      for (const c of collections) select.add(new Option(c.name, c.id, false, c.id === state.page));
      select.addEventListener('change', () => {
        state.page = select.value;
        state.subclasses = [];
        render();
      });

      const subs = document.createElement('div');
      subs.className = 'sub-checks';
      if (page && page.subclasses.length) {
        for (const s of page.subclasses) {
          const label = document.createElement('label');
          label.className = 'sub-check';
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.checked = state.subclasses.some((x) => Shop.normTag(x) === Shop.normTag(s));
          box.addEventListener('change', () => {
            state.subclasses = state.subclasses.filter((x) => Shop.normTag(x) !== Shop.normTag(s));
            if (box.checked) state.subclasses.push(s);
          });
          label.append(box, document.createTextNode(s));
          subs.appendChild(label);
        }
      } else if (page) {
        subs.innerHTML = '<span class="tag-hint">This page has no subclasses yet. Add them in Pages above.</span>';
      }

      wrap.replaceChildren(field('Page', select));
      if (page) {
        const subWrap = document.createElement('div');
        subWrap.className = 'field';
        const title = document.createElement('span');
        title.textContent = 'Subclasses';
        subWrap.append(title, subs);
        wrap.appendChild(subWrap);
      }
    };
    render();
    pickers.add(() => (wrap.isConnected ? render() : pickers.delete(render)));
    return wrap;
  }

  const pagesEl = document.getElementById('pages');
  const pageStatus = document.getElementById('pageStatus');

  function setPageStatus(msg, isError = false) {
    pageStatus.hidden = !msg;
    pageStatus.textContent = msg;
    pageStatus.classList.toggle('error', isError);
  }

  async function loadPages() {
    try {
      ({ designs: allDesigns, collections } = await Shop.loadCatalog(true));
    } catch {
      return;
    }
    pagesEl.replaceChildren(...collections.map(pageBlock));
    if (!collections.length) pagesEl.textContent = 'No pages yet. Add one below.';
    for (const refresh of [...pickers]) refresh();
  }

  // One page in the Pages list: name, design count, Remove, and its subclasses (add/remove).
  function pageBlock(c) {
    const count = allDesigns.filter((d) => d.page === c.id).length;
    const block = document.createElement('div');
    block.className = 'page-block';

    const row = document.createElement('div');
    row.className = 'page-row';
    const name = document.createElement('span');
    name.className = 'page-name';
    name.textContent = c.name;
    const meta = document.createElement('span');
    meta.className = 'muted';
    meta.textContent = `${count} ${count === 1 ? 'design' : 'designs'}`;
    row.append(name, meta, linkButton('Remove', () => removePage(c, count)));

    const subs = document.createElement('div');
    subs.className = 'sub-list';
    for (const s of c.subclasses) {
      const n = allDesigns.filter((d) => d.page === c.id && (d.subclasses || []).some((x) => Shop.normTag(x) === Shop.normTag(s))).length;
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.title = `${n} ${n === 1 ? 'design' : 'designs'}`;
      chip.textContent = s;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'tag-remove';
      x.textContent = '×';
      x.setAttribute('aria-label', `Remove subclass ${s}`);
      x.addEventListener('click', () => removeSubclass(c, s, n));
      chip.appendChild(x);
      subs.appendChild(chip);
    }
    const form = document.createElement('form');
    form.className = 'add-sub';
    const input = document.createElement('input');
    input.maxLength = 40;
    input.placeholder = 'Add subclass, e.g. Pikachu';
    input.setAttribute('aria-label', `New subclass for ${c.name}`);
    const add = document.createElement('button');
    add.type = 'submit';
    add.className = 'btn btn-outline btn-sm';
    add.textContent = 'Add';
    form.append(input, add);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      addSubclass(c, input.value);
    });
    subs.appendChild(form);

    block.append(row, subs);
    return block;
  }

  async function saveSubclasses(c, list, message) {
    try {
      await adminFetch(`/api/collections/${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subclasses: list }),
      });
      setPageStatus(message);
    } catch (err) {
      setPageStatus(err.message, true);
    }
    await loadPages();
    loadPublished();
  }

  function addSubclass(c, raw) {
    const name = raw.replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (c.subclasses.some((s) => Shop.normTag(s) === Shop.normTag(name))) {
      setPageStatus(`"${c.name}" already has a "${name}" subclass.`, true);
      return;
    }
    saveSubclasses(c, [...c.subclasses, name], `Added "${name}" to ${c.name}.`);
  }

  function removeSubclass(c, name, count) {
    const note = count ? ` It will be untagged from ${count} ${count === 1 ? 'design' : 'designs'}.` : '';
    if (!confirm(`Remove the "${name}" subclass from ${c.name}?${note}`)) return;
    saveSubclasses(c, c.subclasses.filter((s) => s !== name), `Removed "${name}" from ${c.name}.`);
  }

  async function adminFetch(url, options) {
    const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-Admin-Key': keyInput.value } }).catch(() => null);
    if (res && res.status === 403) keyField.hidden = false;
    if (!res || !res.ok) {
      const msg = res ? (await res.json().catch(() => ({}))).error : 'Could not reach the server.';
      throw new Error(res && res.status === 403 ? 'Not allowed. Enter the admin password above.' : msg || 'Request failed.');
    }
    return res.json();
  }

  async function removePage(c, count) {
    const note = count ? `\n\nIts ${count} ${count === 1 ? 'design stays' : 'designs stay'} saved but hidden from the shop until you move ${count === 1 ? 'it' : 'them'} to another page (Edit → Page).` : '';
    if (!confirm(`Remove the "${c.name}" page?${note}`)) return;
    try {
      await adminFetch(`/api/collections/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      setPageStatus(`Removed the "${c.name}" page.`);
    } catch (err) {
      setPageStatus(err.message, true);
    }
    await loadPages();
    loadPublished();
  }

  document.getElementById('addPageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('newPage');
    const name = input.value.trim();
    if (!name) return;
    try {
      await adminFetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      input.value = '';
      setPageStatus(`Added the "${name}" page. Add its subclasses below it.`);
    } catch (err) {
      setPageStatus(err.message, true);
    }
    await loadPages();
    loadPublished();
  });

  function buildQueueItem(item) {
    const el = document.createElement('div');
    el.className = 'queue-item';

    const canvas = document.createElement('canvas');
    const draw = () => Binder.render(canvas, { image: item.img, color: item.color, type: item.type, scale: 0.25 });

    const warn = document.createElement('div');
    warn.className = 'file-info warn';
    const checkRatio = () => {
      const [w, h] = Binder.getType(item.type).ratio;
      const ratio = item.img.naturalWidth / item.img.naturalHeight;
      warn.textContent = `${item.img.naturalWidth} × ${item.img.naturalHeight} is not ${w}:${h}, so it will be cropped.`;
      warn.hidden = Math.abs(ratio / (w / h) - 1) < 0.02;
    };

    const typeField = document.createElement('label');
    typeField.className = 'field';
    typeField.innerHTML = '<span>Binder type</span>';
    const typeSelect = document.createElement('select');
    for (const t of Binder.TYPES) {
      typeSelect.add(new Option(`${t.name} (${t.ratio[0]}:${t.ratio[1]} art)`, t.id, false, t.id === item.type));
    }
    typeField.appendChild(typeSelect);

    const nameField = document.createElement('label');
    nameField.className = 'field';
    nameField.innerHTML = '<span>Name</span>';
    const name = document.createElement('input');
    name.value = item.name;
    name.maxLength = 80;
    name.addEventListener('input', () => { item.name = name.value; });
    nameField.appendChild(name);

    const pagePicker = pageField(item);

    const colorField = document.createElement('label');
    colorField.className = 'field';
    colorField.innerHTML = '<span>Binder colour</span>';
    const select = document.createElement('select');
    const fillColors = () => {
      const colors = Binder.typeColors(item.type);
      if (!colors.some((c) => c.id === item.color)) item.color = colors[0].id;
      select.replaceChildren(...colors.map((c) => new Option(c.name, c.id, false, c.id === item.color)));
    };
    select.addEventListener('change', () => { item.color = select.value; draw(); });
    colorField.appendChild(select);

    typeSelect.addEventListener('change', () => {
      item.type = typeSelect.value;
      fillColors();
      checkRatio();
      draw();
    });

    const cardsField = document.createElement('label');
    cardsField.className = 'field';
    cardsField.innerHTML = '<span>Cards held</span>';
    const cards = document.createElement('input');
    cards.type = 'number';
    cards.min = '1';
    cards.max = '10000';
    cards.step = '1';
    cards.value = item.cards;
    cards.addEventListener('input', () => { item.cards = cards.value; });
    cardsField.appendChild(cards);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      queue.splice(queue.indexOf(item), 1);
      renderQueue();
    });

    el.append(canvas, warn, nameField, pagePicker, typeField, colorField, cardsField, remove);
    item.el = el;
    fillColors();
    checkRatio();
    draw();
  }

  async function addFiles(files) {
    for (const file of files) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) continue;
      const img = await Shop.loadImage(URL.createObjectURL(file)).catch(() => null);
      if (!img) continue;
      const item = { file, img, name: nameFromFile(file), page: null, subclasses: [], type: Binder.DEFAULT_TYPE, color: null, cards: '' };
      buildQueueItem(item);
      queue.push(item);
    }
    setStatus('');
    renderQueue();
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function publish() {
    const price = Number(document.getElementById('price').value);
    if (!(price > 0)) return setStatus('Enter a price above 0.', true);
    const blank = queue.find((i) => !i.name.trim());
    if (blank) return setStatus('Every design needs a name.', true);
    const wholeNumber = (v, max) => Number.isInteger(Number(v)) && v >= 1 && v <= max;
    const badSize = queue.find((i) => i.cards === '' || !wholeNumber(i.cards, 10000));
    if (badSize) return setStatus(`"${badSize.name}" needs how many cards it holds (a whole number from 1 to 10000).`, true);
    const noPage = queue.find((i) => !i.page);
    if (noPage) return setStatus(`"${noPage.name}" needs a page. Add one in Pages above first.`, true);

    const key = keyInput.value;
    try { sessionStorage.setItem('admin-key', key); } catch { /* not remembered */ }

    publishBtn.disabled = true;
    const total = queue.length;
    let done = 0;
    try {
      while (queue.length) {
        const item = queue[0];
        setStatus(`Publishing ${done + 1} of ${total}…`);
        const thumbCanvas = document.createElement('canvas');
        Binder.render(thumbCanvas, { image: item.img, color: item.color, type: item.type, scale: 0.5 });
        const res = await fetch('/api/designs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
          body: JSON.stringify({
            name: item.name.trim(),
            price,
            color: item.color,
            type: item.type,
            page: item.page,
            subclasses: item.subclasses,
            cards: Number(item.cards),
            art: await fileToDataUrl(item.file),
            thumb: thumbCanvas.toDataURL('image/webp', 0.85),
          }),
        });
        if (res.status === 403) {
          keyField.hidden = false;
          throw new Error('Not allowed. Enter the admin password and try again.');
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Upload failed (${res.status})`);
        }
        queue.shift();
        done++;
        renderQueue();
      }
      setStatus(`Published ${done} ${done === 1 ? 'design' : 'designs'}.`);
      queueGroup.hidden = false;
    } catch (err) {
      const offline = err instanceof TypeError;
      setStatus(offline ? 'Could not reach the server. Start it with "npm start" and open http://localhost:3000/admin.html.' : err.message, true);
    } finally {
      publishBtn.disabled = false;
      await loadPages();
      loadPublished();
    }
  }

  async function deleteDesign(d) {
    if (!confirm(`Delete "${d.name}" from the shop?`)) return;
    const res = await fetch(`/api/designs/${encodeURIComponent(d.id)}`, {
      method: 'DELETE',
      headers: { 'X-Admin-Key': keyInput.value },
    }).catch(() => null);
    if (!res || !res.ok) {
      if (res && res.status === 403) keyField.hidden = false;
      alert(res && res.status === 403 ? 'Not allowed. Enter the admin password first.' : 'Delete failed.');
      return;
    }
    await loadPages();
    loadPublished();
  }

  async function loadPublished() {
    const list = document.getElementById('published');
    const empty = document.getElementById('empty');
    let designs = [];
    try {
      designs = await Shop.loadDesigns();
    } catch {
      empty.hidden = false;
      empty.textContent = 'Could not load designs. Start the site with "npm start" and open http://localhost:3000/admin.html.';
      return;
    }
    document.getElementById('count').textContent = `${designs.length} live`;
    empty.hidden = designs.length > 0;
    list.replaceChildren(...designs.map(publishedItem));
  }

  function field(label, input) {
    const el = document.createElement('label');
    el.className = 'field';
    const span = document.createElement('span');
    span.textContent = label;
    el.append(span, input);
    return el;
  }

  function linkButton(text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  // A published design card that can switch into an edit form.
  function publishedItem(d) {
    const el = document.createElement('div');
    el.className = 'admin-item';

    function showView() {
      const img = document.createElement('img');
      img.src = Shop.thumbUrl(d);
      img.alt = '';
      img.loading = 'lazy';
      const title = document.createElement('a');
      title.href = `design.html?id=${encodeURIComponent(d.id)}`;
      title.textContent = d.name;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `${Shop.designType(d).name} · ${Binder.colorName(d.color)} · ${d.cards ?? 540} cards · ${Shop.money(d.price)}`;
      const onPage = !!Shop.pageOf(d, collections);
      const pages = document.createElement('span');
      pages.className = onPage ? 'tag-hint' : 'tag-hint warn-text';
      pages.textContent = onPage ? `Page: ${pageName(d.page)}` : 'Not on any page (hidden from the shop)';
      const tagList = document.createElement('div');
      tagList.className = 'tag-list';
      for (const t of d.subclasses || []) {
        const chip = document.createElement('span');
        chip.className = 'tag';
        chip.textContent = t;
        tagList.appendChild(chip);
      }
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.append(linkButton('Edit', showEdit), linkButton('Delete', () => deleteDesign(d)));
      el.replaceChildren(img, title, meta, pages, tagList, actions);
    }

    function showEdit() {
      const draft = { name: d.name, page: d.page, subclasses: [...(d.subclasses || [])], type: Shop.designType(d).id, color: d.color, cards: d.cards ?? '', price: d.price };
      const canvas = document.createElement('canvas');
      let art = null;
      const draw = () => {
        if (art) Binder.render(canvas, { image: art, color: draft.color, type: draft.type, scale: 0.25 });
      };
      Shop.loadImage(d.art).then((img) => { art = img; draw(); }).catch(() => {});

      const name = document.createElement('input');
      name.value = draft.name;
      name.maxLength = 80;
      name.addEventListener('input', () => { draft.name = name.value; });

      const typeSelect = document.createElement('select');
      for (const t of Binder.TYPES) typeSelect.add(new Option(`${t.name} (${t.ratio[0]}:${t.ratio[1]} art)`, t.id, false, t.id === draft.type));

      const colorSelect = document.createElement('select');
      const fillColors = () => {
        const colors = Binder.typeColors(draft.type);
        if (!colors.some((c) => c.id === draft.color)) draft.color = colors[0].id;
        colorSelect.replaceChildren(...colors.map((c) => new Option(c.name, c.id, false, c.id === draft.color)));
      };
      fillColors();
      typeSelect.addEventListener('change', () => { draft.type = typeSelect.value; fillColors(); draw(); });
      colorSelect.addEventListener('change', () => { draft.color = colorSelect.value; draw(); });

      const cards = document.createElement('input');
      cards.type = 'number';
      cards.min = '1';
      cards.max = '10000';
      cards.step = '1';
      cards.value = draft.cards;
      cards.addEventListener('input', () => { draft.cards = cards.value; });

      const price = document.createElement('input');
      price.type = 'number';
      price.min = '1';
      price.step = '0.01';
      price.value = draft.price;
      price.addEventListener('input', () => { draft.price = price.value; });

      const sizeRow = document.createElement('div');
      sizeRow.className = 'field-row';
      sizeRow.append(field('Cards held', cards), field('Price', price));

      const error = document.createElement('p');
      error.className = 'status error';
      error.hidden = true;

      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn';
      save.textContent = 'Save';
      save.addEventListener('click', async () => {
        error.hidden = true;
        save.disabled = true;
        const body = { name: draft.name.trim(), page: draft.page, subclasses: draft.subclasses, type: draft.type, color: draft.color, cards: Number(draft.cards), price: Number(draft.price) };
        // The shop thumbnail shows the type and colour, so redraw it when either changed.
        if ((draft.type !== Shop.designType(d).id || draft.color !== d.color) && art) {
          const thumb = document.createElement('canvas');
          Binder.render(thumb, { image: art, color: draft.color, type: draft.type, scale: 0.5 });
          body.thumb = thumb.toDataURL('image/webp', 0.85);
        }
        const res = await fetch(`/api/designs/${encodeURIComponent(d.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': keyInput.value },
          body: JSON.stringify(body),
        }).catch(() => null);
        save.disabled = false;
        if (!res || !res.ok) {
          const msg = res ? (await res.json().catch(() => ({}))).error : 'Could not reach the server.';
          if (res && res.status === 403) keyField.hidden = false;
          error.textContent = res && res.status === 403 ? 'Not allowed. Enter the admin password above.' : msg || 'Save failed.';
          error.hidden = false;
          return;
        }
        Object.assign(d, await res.json());
        showView();
      });

      const actions = document.createElement('div');
      actions.className = 'row';
      actions.append(save, linkButton('Cancel', showView));

      el.replaceChildren(canvas, field('Name', name), pageField(draft),
        field('Binder type', typeSelect),
        field('Binder colour', colorSelect), sizeRow, error, actions);
    }

    showView();
    return el;
  }

  const fileInput = document.getElementById('fileInput');
  const dropzone = document.getElementById('dropzone');
  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  });
  for (const ev of ['dragenter', 'dragover']) {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    dropzone.addEventListener(ev, () => dropzone.classList.remove('drag'));
  }
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  publishBtn.addEventListener('click', publish);

  loadPages().then(loadPublished);
})();
