// Payment page (pay.html?order=<id>): the customer pays with the shop's PayNow QR code, uploads a
// screenshot of the payment, and then sees "Thank you! Your order has been placed".
(async () => {
  const $ = (id) => document.getElementById(id);
  const MAX_BYTES = 10 * 1024 * 1024;
  const orderId = new URLSearchParams(location.search).get('order') || '';

  const showStatus = (msg, isError = true) => {
    $('payStatus').textContent = msg;
    $('payStatus').hidden = !msg;
    $('payStatus').classList.toggle('error', isError);
  };
  const showPlaced = () => {
    $('paying').hidden = true;
    $('placed').hidden = false;
    $('payTitle').textContent = 'Order placed';
    showStatus('');
  };

  if (!/^[0-9a-f-]{36}$/.test(orderId)) return showStatus('No order to pay for. Your orders are listed on your account page.');
  const number = Account.orderNumber(orderId);
  $('orderNumber').textContent = number;
  for (const el of document.querySelectorAll('[data-order-number]')) el.textContent = number;

  if (!Account.configured) return showStatus("Payments aren't available right now. Please try again later.");
  const user = await Account.currentUser();
  if (!user) {
    location.href = `login.html?next=${encodeURIComponent(`pay.html?order=${orderId}`)}`;
    return;
  }
  const authHeader = async () => {
    const { data: { session } } = await Account.client.auth.getSession();
    return { Authorization: `Bearer ${session && session.access_token}` };
  };

  // The order: amount to pay, and whether it's already been paid for.
  let order;
  try {
    const res = await fetch(`/api/checkout/${orderId}`, { headers: await authHeader() });
    order = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(order.error || "Couldn't load this order.");
  } catch (err) {
    return showStatus(err.message);
  }
  if (order.status === 'cancelled') {
    $('payTitle').textContent = 'Order cancelled';
    return showStatus('This order was cancelled. Please contact us if you have any questions.', false);
  }
  if (order.status !== 'pending') return showPlaced();

  const amount = `${order.currency} ${Shop.money(order.total)}`;
  $('amount').textContent = amount;
  for (const el of document.querySelectorAll('[data-amount]')) el.textContent = amount;
  $('paying').hidden = false;

  // Choosing the screenshot (click or drag and drop).
  let file = null;
  const input = $('proofFile');
  const drop = $('proofDrop');
  const preview = $('proofPreview');
  const submit = $('submitProof');

  function choose(f) {
    if (!f) return;
    if (!f.type.startsWith('image/')) return showStatus('Please upload a picture (screenshot) of your payment.');
    if (f.size > MAX_BYTES) return showStatus('That picture is over 10 MB. Please upload a smaller screenshot.');
    file = f;
    showStatus('');
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(f);
    preview.hidden = false;
    drop.querySelector('.dz-main').textContent = 'Change screenshot';
    drop.querySelector('.dz-hint').textContent = f.name;
    submit.disabled = false;
  }
  input.addEventListener('change', () => choose(input.files[0]));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); choose(e.dataTransfer.files[0]); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Upload the screenshot (privately, into the customer's own folder), then record it on the order.
  $('proofForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file) return showStatus('Please upload a screenshot of your payment first.');
    submit.disabled = true;
    submit.textContent = 'Submitting…';
    showStatus('');
    const done = () => {
      submit.disabled = false;
      submit.textContent = 'Submit payment';
    };
    try {
      const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }[file.type] || 'jpg';
      const path = `${user.id}/${number.slice(1)}_payment-proof_${Date.now()}.${ext}`;
      const { error } = await Account.client.storage.from('payment-proofs')
        .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if (error) {
        throw new Error(/bucket not found/i.test(error.message)
          ? "Payment uploads aren't set up yet. Please contact us."
          : `Couldn't upload your screenshot: ${error.message}`);
      }
      const res = await fetch(`/api/checkout/${orderId}/proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ path }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't submit your payment. Please try again.");
    } catch (err) {
      done();
      return showStatus(err.message);
    }
    showPlaced();
  });
})();
