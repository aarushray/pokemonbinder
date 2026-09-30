// Contact page: sends the form to the server, which saves it for the admin page.
const form = document.getElementById('contactForm');
const statusEl = document.getElementById('status');
const submitBtn = document.getElementById('submitBtn');
const fields = {
  name: document.getElementById('name'),
  telegram: document.getElementById('telegram'),
  phone: document.getElementById('phone'),
  description: document.getElementById('description'),
};

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', !!isError);
  statusEl.hidden = false;
}

// Checks the form in the browser first; the server checks again. Returns an error message or ''.
function problem() {
  const v = (k) => fields[k].value.trim();
  for (const el of Object.values(fields)) el.removeAttribute('aria-invalid');
  const bad = (k, msg) => {
    fields[k].setAttribute('aria-invalid', 'true');
    fields[k].focus();
    return msg;
  };
  if (!v('name')) return bad('name', 'Please enter your name.');
  if (!/^@?[A-Za-z0-9_]{5,32}$/.test(v('telegram'))) return bad('telegram', 'Please enter a valid Telegram handle, e.g. @tcgengrave.');
  if (v('phone') && !/^[0-9+()\-\s]{6,30}$/.test(v('phone'))) return bad('phone', 'Please enter a valid phone number.');
  if (!v('description')) return bad('description', 'Please describe the art you would like.');
  return '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = problem();
  if (error) return setStatus(error, true);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';
  const body = Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value.trim()]));
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit';

  if (!res) return setStatus("Couldn't reach the server. Please try again.", true);
  if (!res.ok) {
    const { error: msg } = await res.json().catch(() => ({}));
    return setStatus(msg || 'Something went wrong. Please try again.', true);
  }
  form.reset();
  setStatus("Thanks! We've got your message and will reach out on Telegram soon.");
});
