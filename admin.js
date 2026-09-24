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

    const colorField = document.createElement('label');
    colorField.className = 'field';
    colorField.innerHTML = '<span>Binder colour</span>';
    const select = document.createElement('select');
    const fillColors = () => {
      const colors = Binder.typeColors(item.type);
      if (!colors.some((c) => c.hex === item.color)) item.color = colors[0].hex;
      select.replaceChildren(...colors.map((c) => new Option(c.name, c.hex, false, c.hex === item.color)));
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
    cards.placeholder = 'e.g. 360';
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

    el.append(canvas, warn, nameField, typeField, colorField, cardsField, remove);
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
      const item = { file, img, name: nameFromFile(file), type: Binder.DEFAULT_TYPE, color: null, cards: '' };
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
        Binder.render(thumbCanvas, { image: item.img, color: item.color, scale: 0.5 });
        const res = await fetch('/api/designs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
          body: JSON.stringify({
            name: item.name.trim(),
            price,
            color: item.color,
            type: item.type,
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
      const actions = document.createElement('div');
      actions.className = 'row';
      actions.append(linkButton('Edit', showEdit), linkButton('Delete', () => deleteDesign(d)));
      el.replaceChildren(img, title, meta, actions);
    }

    function showEdit() {
      const draft = { name: d.name, type: Shop.designType(d).id, color: d.color, cards: d.cards ?? '', price: d.price };
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
        if (!colors.some((c) => c.hex === draft.color)) draft.color = colors[0].hex;
        colorSelect.replaceChildren(...colors.map((c) => new Option(c.name, c.hex, false, c.hex === draft.color)));
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
        const body = { name: draft.name.trim(), type: draft.type, color: draft.color, cards: Number(draft.cards), price: Number(draft.price) };
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

      el.replaceChildren(canvas, field('Name', name), field('Binder type', typeSelect),
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

  loadPublished();
})();
