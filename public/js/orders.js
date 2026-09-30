// Admin Orders page: every customer order (read from Supabase through the server), status changes,
// and downloads of customers' artwork for custom designs.
(() => {
  const listEl = document.getElementById('orders');
  const statusEl = document.getElementById('orderStatus');
  const filterEl = document.getElementById('statusFilter');
  const keyForm = document.getElementById('keyForm');
  const keyInput = document.getElementById('adminKey');

  const STATUS = {
    pending: 'Awaiting payment', paid: 'Paid', in_production: 'Being engraved',
    shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled',
  };
  for (const [id, label] of Object.entries(STATUS)) filterEl.add(new Option(label, id));

  // Same password the admin page remembers for this browser tab session.
  try {
    keyInput.value = sessionStorage.getItem('admin-key') || '';
  } catch {
    // sessionStorage unavailable: the password just won't be remembered.
  }

  function showStatus(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg;
  }

  async function adminFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': keyInput.value },
    }).catch(() => null);
    if (!res) throw new Error('Could not reach the server. Start it with "npm start".');
    if (res.status === 403) {
      keyForm.hidden = false;
      throw new Error('Not allowed. Enter the admin password.');
    }
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
    keyForm.hidden = true;
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
    status.addEventListener('change', async () => {
      status.disabled = true;
      try {
        const updated = await adminFetch(`/api/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: status.value }) });
        o.status = updated.status;
        saved.textContent = 'Saved';
        setTimeout(() => { saved.textContent = ''; }, 1500);
      } catch (err) {
        status.value = o.status;
        showStatus(err.message);
      }
      status.disabled = false;
    });
    head.append(text('strong', orderNumber(o.id)), text('span', when, 'muted'), saved, status);

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
    if (o.account_email) lines.push(text('div', `Account: ${o.account_email}`, 'muted'));
    who.append(...lines);

    // Items, with a download button for each custom design's artwork.
    const items = document.createElement('ul');
    items.className = 'admin-order-items';
    o.items.forEach((l, index) => {
      const li = document.createElement('li');
      const details = [l.binder_type, l.texture, l.color_name].filter(Boolean).join(', ');
      li.append(text('span', `${l.qty} × ${l.name} (${details})`));
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
    totals.textContent = `Subtotal ${Shop.money(o.subtotal)} · Shipping ${Shop.money(o.shipping_fee || 0)} · Total ${o.currency} ${Shop.money(total)}`;

    el.append(head, who, items, totals);
    return el;
  }

  filterEl.addEventListener('change', render);
  keyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    try { sessionStorage.setItem('admin-key', keyInput.value); } catch { /* not remembered */ }
    load();
  });

  load();
})();
