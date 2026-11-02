// Admin Orders page: every customer order (read from Supabase through the server), status changes,
// and downloads of customers' artwork for custom designs.
(() => {
  const listEl = document.getElementById('orders');
  const statusEl = document.getElementById('orderStatus');
  const filterEl = document.getElementById('statusFilter');

  const STATUS = {
    pending: 'Awaiting payment', payment_submitted: 'Payment submitted', paid: 'Paid', in_production: 'Being engraved',
    shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled',
  };
  for (const [id, label] of Object.entries(STATUS)) filterEl.add(new Option(label, id));

  function showStatus(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg;
  }

  async function adminFetch(url, options = {}) {
    const res = await AdminAuth.fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);
    if (!res) throw new Error('Could not reach the server. Start it with "npm start".');
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Request failed.');
    return body;
  }

  const orderNumber = (id) => `#${String(id).slice(0, 8).toUpperCase()}`;
  const text = (tag, value, className) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = value;
    return el;
  };
  const link = (href, value) => {
    const a = text('a', value);
    a.href = href;
    if (/^https?:/.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
    return a;
  };

  let orders = [];

  async function load() {
    try {
      orders = await adminFetch('/api/orders');
    } catch (err) {
      return showStatus(err.message);
    }
    showStatus('');
    render();
  }

  function render() {
    const shown = filterEl.value ? orders.filter((o) => o.status === filterEl.value) : orders;
    document.getElementById('orderCount').textContent = `${shown.length} ${shown.length === 1 ? 'order' : 'orders'}`;
    document.getElementById('noOrders').hidden = shown.length > 0;
    listEl.replaceChildren(...shown.map(orderCard));
  }

  function orderCard(o) {
    const el = document.createElement('article');
    el.className = 'admin-order';

    // Header: number, date, status.
    const head = document.createElement('div');
    head.className = 'admin-order-head';
    const when = new Date(o.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const status = document.createElement('select');
    status.className = 'order-status-select';
    status.setAttribute('aria-label', `Status of order ${orderNumber(o.id)}`);
    for (const [id, label] of Object.entries(STATUS)) status.add(new Option(label, id, false, id === o.status));
    const saved = text('span', '', 'muted');
    // Cancelled orders can be deleted for good.
    const del = text('button', 'Delete', 'btn btn-outline btn-sm order-delete');
    del.type = 'button';
    del.hidden = o.status !== 'cancelled';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete order ${orderNumber(o.id)} from ${o.customer_name || 'this customer'} for good? Its artwork and payment proof are deleted too. This can't be undone.`)) return;
      del.disabled = true;
      try {
        await adminFetch(`/api/orders/${o.id}`, { method: 'DELETE' });
        orders = orders.filter((x) => x !== o);
        render();
        showStatus(`Deleted order ${orderNumber(o.id)}.`);
      } catch (err) {
        del.disabled = false;
        showStatus(err.message);
      }
    });
    status.addEventListener('change', async () => {
      status.disabled = true;
      try {
        const updated = await adminFetch(`/api/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: status.value }) });
        o.status = updated.status;
        del.hidden = o.status !== 'cancelled';
        saved.textContent = 'Saved';
        setTimeout(() => { saved.textContent = ''; }, 1500);
        // Marking it paid takes its binders out of the stock counts (cancelling puts them back).
        if (updated.stock && updated.stock.length) {
          showStatus(`Order ${orderNumber(o.id)}: stock ${updated.stockReturned ? 'put back' : 'updated'}. ${updated.stock.join(', ')}.`);
        }
      } catch (err) {
        status.value = o.status;
        showStatus(err.message);
      }
      status.disabled = false;
    });
    head.append(text('strong', orderNumber(o.id)), text('span', when, 'muted'), saved, status, del);

    // Customer and delivery details.
    const who = document.createElement('div');
    who.className = 'admin-order-customer';
    const lines = [];
    const contactRow = document.createElement('div');
    contactRow.append(text('strong', o.customer_name || '(no name)'));
    if (o.contact_method === 'telegram' && o.contact) contactRow.append(' · Telegram ', link(`https://t.me/${encodeURIComponent(o.contact)}`, `@${o.contact}`));
    if (o.contact_method === 'gmail' && o.contact) contactRow.append(' · Gmail ', link(`mailto:${o.contact}`, o.contact));
    if (o.phone) contactRow.append(' · ', link(`tel:${o.phone.replace(/[^0-9+]/g, '')}`, o.phone));
    lines.push(contactRow);
    if (o.address) lines.push(text('div', [o.address, o.unit_number, o.postal_code && `Singapore ${o.postal_code}`].filter(Boolean).join(', ')));
    else if (Number(o.shipping_fee) === 0) lines.push(text('div', 'Self collection (570168 / 510153)'));
    if (o.account_email) lines.push(text('div', `Account: ${o.account_email}`, 'muted'));
    who.append(...lines);

    // Items, with a download button for each custom design's artwork.
    const items = document.createElement('ul');
    items.className = 'admin-order-items';
    o.items.forEach((l, index) => {
      const li = document.createElement('li');
      const details = [l.binder_type, l.texture, l.color_name].filter(Boolean).join(', ');
      li.append(text('span', `${l.qty} × ${l.name} (${details})`));
      if (l.preorder) li.append(text('span', 'Pre-order (3–4 weeks)', 'tag tag-preorder'));
      const price = l.discount_percent
        ? `${Shop.money(l.unit_price)} each (${l.discount_percent}% off ${Shop.money(l.original_price)})`
        : `${Shop.money(l.unit_price)} each`;
      li.append(text('span', price, 'muted'));
      if (l.custom && l.art_path) {
        const btn = text('button', 'Download artwork', 'btn btn-outline btn-sm');
        btn.type = 'button';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const { url } = await adminFetch(`/api/orders/${o.id}/art/${index}`);
            location.href = url;
          } catch (err) {
            showStatus(err.message);
          }
          btn.disabled = false;
        });
        li.append(btn);
      }
      items.appendChild(li);
    });

    // Totals.
    const totals = text('div', '', 'admin-order-total');
    const total = o.total != null ? o.total : o.subtotal;
    totals.textContent = `Subtotal ${Shop.money(o.subtotal)} · Shipping ${Number(o.shipping_fee) ? Shop.money(o.shipping_fee) : 'Free'} · Total ${o.currency} ${Shop.money(total)}`;

    // Proof of payment uploaded by the customer: check it, then set the status to Paid. You can
    // also add or replace it yourself, e.g. with a screenshot the customer sent you privately.
    const proofRow = document.createElement('div');
    proofRow.className = 'admin-order-proof';
    const proofInfo = text('span', '', 'muted');
    const viewBtn = text('button', 'View payment proof', 'btn btn-outline btn-sm');
    viewBtn.type = 'button';
    viewBtn.addEventListener('click', async () => {
      const win = window.open('', '_blank'); // opened now so the browser doesn't block it
      try {
        const { url } = await adminFetch(`/api/orders/${o.id}/proof`);
        if (win) win.location = url;
        else location.href = url;
      } catch (err) {
        if (win) win.close();
        showStatus(err.message);
      }
    });
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/heic,image/heif';
    fileInput.hidden = true;
    const uploadBtn = text('button', '', 'link');
    uploadBtn.type = 'button';
    uploadBtn.addEventListener('click', () => fileInput.click());
    const showProof = () => {
      const when = o.payment_submitted_at && new Date(o.payment_submitted_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      proofInfo.textContent = o.payment_proof_path ? `Payment proof uploaded${when ? ` on ${when}` : ''}` : 'No payment proof yet';
      viewBtn.hidden = !o.payment_proof_path;
      uploadBtn.textContent = o.payment_proof_path ? 'Replace payment proof' : 'Upload payment proof';
    };
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!/^image\/(png|jpeg|webp|heic|heif)$/.test(file.type)) return showStatus('Please choose a PNG, JPG, WebP or HEIC picture.');
      if (file.size > 10 * 1024 * 1024) return showStatus('That picture is over 10 MB. Please choose a smaller one.');
      if (o.payment_proof_path && !confirm(`Replace the payment proof on order ${orderNumber(o.id)}? The current picture is deleted.`)) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading…';
      try {
        const image = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        const updated = await adminFetch(`/api/orders/${o.id}/proof`, { method: 'POST', body: JSON.stringify({ image }) });
        Object.assign(o, updated);
        status.value = o.status;
        showStatus(`Payment proof saved on order ${orderNumber(o.id)}.`);
      } catch (err) {
        showStatus(err.message);
      }
      uploadBtn.disabled = false;
      showProof();
    });
    showProof();
    proofRow.append(proofInfo, viewBtn, uploadBtn, fileInput);

    // Private note, for you only: customers never see it (it isn't stored with their order).
    const noteBox = document.createElement('div');
    noteBox.className = 'admin-order-note';
    const noteLabel = text('label', 'Private note (only you can see this)');
    const note = document.createElement('textarea');
    note.rows = 2;
    note.maxLength = 2000;
    note.placeholder = 'e.g. Customer asked on Telegram to change the colour to Navy Blue';
    note.value = o.admin_note || '';
    noteLabel.htmlFor = note.id = `note-${o.id}`;
    const noteSave = text('button', 'Save note', 'btn btn-outline btn-sm');
    noteSave.type = 'button';
    const noteSaved = text('span', '', 'muted');
    const noteDirty = () => {
      noteSave.disabled = note.value.trim() === (o.admin_note || '');
    };
    note.addEventListener('input', () => {
      noteSaved.textContent = '';
      noteDirty();
    });
    noteSave.addEventListener('click', async () => {
      noteSave.disabled = true;
      try {
        const saved = await adminFetch(`/api/orders/${o.id}/note`, { method: 'PUT', body: JSON.stringify({ note: note.value }) });
        o.admin_note = saved.note;
        note.value = saved.note;
        noteSaved.textContent = 'Saved';
      } catch (err) {
        showStatus(err.message);
      }
      noteDirty();
    });
    noteDirty();
    const noteActions = document.createElement('div');
    noteActions.className = 'row';
    noteActions.append(noteSave, noteSaved);
    noteBox.append(noteLabel, note, noteActions);

    el.append(head, who, items, totals, proofRow, noteBox);
    return el;
  }

  filterEl.addEventListener('change', render);
  AdminAuth.ready.then(load);
})();
