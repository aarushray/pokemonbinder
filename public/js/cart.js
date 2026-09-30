// Cart page: lists cart lines with a small render of each binder in its chosen colour. Lines are
// either shop designs or custom designs (the customer's own artwork, kept by CustomArt).
(async () => {
  const linesEl = document.getElementById('lines');
  let designs = [];
  try {
    designs = await Shop.loadDesigns();
  } catch {
    // Treated as an empty catalogue: lines for unknown designs are skipped (but kept in the cart).
  }
  const byId = new Map(designs.map((d) => [d.id, d]));
  if (designs.length) Shop.pruneCart(byId);
  CustomArt.prune(Shop.customArtIds()).catch(() => {});
  const artCache = new Map();
  const SHIPPING_FEE = 3; // flat, per order (SGD)

  // Artwork for a line: the shop design's art, or the customer's own upload.
  function art(item) {
    if (!artCache.has(item.id)) {
      const load = Shop.isCustom(item)
        ? CustomArt.get(item.id).then((blob) => (blob ? Shop.loadImage(URL.createObjectURL(blob)) : null))
        : Shop.loadImage(byId.get(item.id).art);
      artCache.set(item.id, load.catch(() => null));
    }
    return artCache.get(item.id);
  }

  // Cart lines we can show and sell: custom designs, and shop designs still in the catalogue.
  const sellable = () => Shop.readCart().filter((i) => Shop.isCustom(i) || byId.has(i.id));

  // Name, binder type, link and price for a line.
  function describe(item) {
    if (Shop.isCustom(item)) {
      const type = Binder.getType(item.type);
      const price = Shop.customPrice(item);
      return { name: 'Custom design', href: null, type, unit: { original: price, price, discount: 0 } };
    }
    const d = byId.get(item.id);
    return {
      name: d.name,
      href: `design.html?id=${encodeURIComponent(d.id)}`,
      type: Shop.designType(d),
      unit: Shop.sale(d, Shop.priceFor(d, item.color)),
    };
  }

  function render() {
    const items = sellable();
    document.getElementById('empty').hidden = items.length > 0;
    document.getElementById('cart').hidden = items.length === 0;
    linesEl.replaceChildren();

    let total = 0;
    let count = 0;
    for (const item of items) {
      const { name: title, href, type, unit } = describe(item);
      total += unit.price * item.qty;
      count += item.qty;

      const line = document.createElement('div');
      line.className = 'cart-line';

      const thumb = document.createElement(href ? 'a' : 'div');
      thumb.className = 'cart-thumb';
      if (href) thumb.href = href;
      const canvas = document.createElement('canvas');
      thumb.appendChild(canvas);
      art(item).then((img) => Binder.render(canvas, { image: img, color: item.color, type: type.id, scale: 0.15 }));

      const info = document.createElement('div');
      const name = document.createElement(href ? 'a' : 'span');
      name.className = 'name';
      if (href) name.href = href;
      name.textContent = title;
      const meta = document.createElement('div');
      meta.className = 'meta';
      const finish = (Binder.finishes(type.id) || []).find((f) => f.id === Binder.finishOf(type.id, item.color));
      meta.textContent = `${type.name}${finish && Shop.isCustom(item) ? ` · ${finish.name}` : ''} · ${Binder.colorName(item.color)} · `;
      const unitEl = document.createElement('span');
      Shop.renderPrice(unitEl, unit);
      meta.appendChild(unitEl);
      info.append(name, meta);

      const right = document.createElement('div');
      right.className = 'line-right';
      const qty = document.createElement('div');
      qty.className = 'qty';
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      minus.setAttribute('aria-label', 'Decrease quantity');
      minus.addEventListener('click', () => { Shop.setQty(item.id, item.color, item.qty - 1); render(); });
      const n = document.createElement('span');
      n.textContent = item.qty;
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Increase quantity');
      plus.addEventListener('click', () => { Shop.setQty(item.id, item.color, Math.min(20, item.qty + 1)); render(); });
      qty.append(minus, n, plus);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => { Shop.setQty(item.id, item.color, 0); render(); });
      right.append(qty, remove);

      line.append(thumb, info, right);
      linesEl.appendChild(line);
    }

    const subtotal = Math.round(total * 100) / 100;
    document.getElementById('items').textContent = count;
    document.getElementById('subtotal').textContent = Shop.money(subtotal);
    document.getElementById('shipping').textContent = Shop.money(SHIPPING_FEE);
    document.getElementById('total').textContent = Shop.money(subtotal + SHIPPING_FEE);
  }

  // ---- Delivery details ----
  // Kept in this tab while the customer logs in, and filled from their profile (saved at their last
  // checkout) when they're logged in.
  const DETAILS_KEY = 'checkout-details';
  const f = {
    contactMethod: document.getElementById('contactMethod'),
    contact: document.getElementById('contact'),
    name: document.getElementById('fullName'),
    phone: document.getElementById('phone'),
    address: document.getElementById('address'),
    unit: document.getElementById('unit'),
    postal: document.getElementById('postal'),
  };

  function showContactMethod() {
    const gmail = f.contactMethod.value === 'gmail';
    f.contact.placeholder = gmail ? 'Gmail address, e.g. name@gmail.com' : 'Telegram username, e.g. @tcgengrave';
    f.contact.setAttribute('aria-label', gmail ? 'Gmail address' : 'Telegram username');
    f.contact.type = gmail ? 'email' : 'text';
  }

  const readDetails = () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim()]));
  function saveDraft() {
    try { sessionStorage.setItem(DETAILS_KEY, JSON.stringify(readDetails())); } catch { /* not kept */ }
  }
  function fill(values, onlyEmpty) {
    for (const [k, v] of Object.entries(values)) {
      if (!f[k] || v == null || v === '') continue;
      if (onlyEmpty && f[k].value && k !== 'contactMethod') continue;
      f[k].value = v;
    }
    showContactMethod();
  }

  try { fill(JSON.parse(sessionStorage.getItem(DETAILS_KEY)) || {}, false); } catch { /* none saved */ }
  showContactMethod();
  f.contactMethod.addEventListener('change', () => { showContactMethod(); saveDraft(); });
  document.getElementById('details').addEventListener('input', saveDraft);

  // Fill anything still empty from the logged-in customer's profile.
  if (Account.configured) {
    Account.currentUser().then(async (user) => {
      if (!user) return;
      const { data } = await Account.client.from('profiles')
        .select('full_name, phone, contact_method, contact, address, unit_number, postal_code')
        .eq('id', user.id).maybeSingle();
      if (!data) return;
      const draftHasContact = !!f.contact.value;
      fill({
        contactMethod: draftHasContact ? '' : data.contact_method,
        contact: data.contact && data.contact_method === 'telegram' ? `@${data.contact}` : data.contact,
        name: data.full_name, phone: data.phone, address: data.address, unit: data.unit_number, postal: data.postal_code,
      }, true);
    }).catch(() => {});
  }

  // Checks the details; marks the first problem and returns its message, or ''.
  function detailsProblem() {
    const d = readDetails();
    for (const el of Object.values(f)) el.removeAttribute('aria-invalid');
    const bad = (k, msg) => {
      f[k].setAttribute('aria-invalid', 'true');
      f[k].focus();
      return msg;
    };
    if (d.contactMethod === 'telegram' && !/^@?[A-Za-z0-9_]{5,32}$/.test(d.contact)) return bad('contact', 'Please enter your Telegram username, e.g. @tcgengrave.');
    if (d.contactMethod === 'gmail' && !/^[^\s@]+@gmail\.com$/i.test(d.contact)) return bad('contact', 'Please enter a Gmail address, e.g. name@gmail.com.');
    if (!d.name) return bad('name', 'Please enter your name.');
    if (!/^(\+?65[\s-]?)?[3689]\d{3}[\s-]?\d{4}$/.test(d.phone)) return bad('phone', 'Please enter a Singapore phone number, e.g. 9123 4567.');
    if (!d.address) return bad('address', 'Please enter your address.');
    if (!/^\d{6}$/.test(d.postal)) return bad('postal', 'Please enter a 6-digit postal code.');
    return '';
  }

  // Checkout saves the order to Supabase for the logged-in customer (payment is arranged separately).
  // Custom artwork is uploaded first, to the private "custom-art" storage bucket, in a folder named
  // after the customer; the order line records where it is.
  const checkoutBtn = document.getElementById('checkout');
  const note = document.getElementById('checkoutNote');
  const showNote = (text) => {
    note.textContent = text;
    note.hidden = !text;
  };

  // The order's id is made here (not by the database) so artwork files can be named after the order,
  // e.g. <customer id>/3F9A1C2B_Ash-Ketchum_9-pocket_Grey_1.png. Kept across retries of a failed checkout.
  let pendingOrderId = null;
  const fileSlug = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

  async function uploadArt(user, item, orderId, customerName, index) {
    const blob = await CustomArt.get(item.id);
    if (!blob) throw new Error('The artwork for a custom design in your cart is missing. Please remove it and add it again.');
    const ext = { 'image/png': 'png', 'image/webp': 'webp' }[blob.type] || 'jpg';
    const type = Binder.getType(item.type);
    const name = [Account.orderNumber(orderId).slice(1), fileSlug(customerName), fileSlug(type.name), fileSlug(Binder.colorName(item.color)), index + 1].join('_');
    const path = `${user.id}/${name}.${ext}`;
    const { error } = await Account.client.storage.from('custom-art')
      .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    // Already there means an earlier checkout attempt uploaded it; that's fine.
    if (error && !/exists|duplicate/i.test(error.message)) {
      throw new Error(/bucket not found/i.test(error.message)
        ? "Custom design orders aren't set up yet. Please try again later."
        : `Couldn't upload your custom design: ${error.message}`);
    }
    return path;
  }

  checkoutBtn.addEventListener('click', async () => {
    const items = sellable();
    if (!items.length) return;
    if (!Account.configured) return showNote("Online checkout isn't connected yet.");
    const problem = detailsProblem();
    if (problem) return showNote(problem);
    saveDraft();
    const user = await Account.currentUser();
    if (!user) {
      location.href = 'login.html?next=cart.html&reason=checkout';
      return;
    }

    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Placing order…';
    showNote('');
    const done = () => {
      checkoutBtn.disabled = false;
      checkoutBtn.textContent = 'Checkout';
    };

    // Custom artwork is uploaded first. Then only what's in the cart goes to the server, which works
    // out every price itself and saves the order (so prices can't be altered in the browser).
    const d = readDetails();
    let result;
    try {
      pendingOrderId = pendingOrderId || crypto.randomUUID();
      const lines = await Promise.all(items.map(async (i, index) => (Shop.isCustom(i)
        ? { custom: true, type: i.type, color: i.color, qty: i.qty, art_path: await uploadArt(user, i, pendingOrderId, d.name, index) }
        : { id: i.id, color: i.color, qty: i.qty })));
      const { data: { session } } = await Account.client.auth.getSession();
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session && session.access_token}` },
        body: JSON.stringify({ orderId: pendingOrderId, items: lines, details: d }),
      }).catch(() => null);
      if (!res) throw new Error("Couldn't reach the shop. Please check your connection and try again.");
      result = await res.json().catch(() => ({}));
      if (res.status === 401) {
        location.href = 'login.html?next=cart.html&reason=checkout';
        return;
      }
      if (!res.ok) throw new Error(result.error || "Couldn't place your order. Please try again.");
    } catch (err) {
      done();
      return showNote(err.message);
    }
    done();
    const contact = d.contactMethod === 'telegram' ? d.contact.replace(/^@/, '') : d.contact.toLowerCase();

    // Remember the details on the customer's profile for next time.
    Account.client.from('profiles').update({
      full_name: d.name, phone: d.phone, contact_method: d.contactMethod, contact,
      address: d.address, unit_number: d.unit || null, postal_code: d.postal, updated_at: new Date().toISOString(),
    }).eq('id', user.id).then(() => {}, () => {});
    try { sessionStorage.removeItem(DETAILS_KEY); } catch { /* nothing kept */ }

    pendingOrderId = null;
    Shop.clearCart();
    CustomArt.prune(Shop.customArtIds()).catch(() => {});
    // Next: pay with PayNow and upload proof of payment.
    location.href = `pay.html?order=${encodeURIComponent(result.orderId)}`;
  });

  render();
})();
