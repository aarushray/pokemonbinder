// Admin messages page: lists messages sent from the contact page, newest first, and deletes them.
(() => {
  const listEl = document.getElementById('messages');
  const statusEl = document.getElementById('messageStatus');

  function showStatus(msg) {
    statusEl.hidden = !msg;
    statusEl.textContent = msg;
  }

  async function adminFetch(url, options = {}) {
    const res = await AdminAuth.fetch(url, options).catch(() => null);
    if (!res) throw new Error('Could not reach the server. Start it with "npm start".');
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Request failed.');
    return res.json();
  }

  async function load() {
    let list;
    try {
      list = await adminFetch('/api/messages');
    } catch (err) {
      return showStatus(err.message);
    }
    showStatus('');
    document.getElementById('messageCount').textContent = list.length ? `${list.length} ${list.length === 1 ? 'message' : 'messages'}` : '';
    document.getElementById('noMessages').hidden = list.length > 0;
    listEl.replaceChildren(...list.map(messageItem));
  }

  function messageItem(m) {
    const el = document.createElement('article');
    el.className = 'message';
    const head = document.createElement('div');
    head.className = 'message-head';
    const who = document.createElement('strong');
    who.textContent = m.name;
    const tg = document.createElement('a');
    tg.href = `https://t.me/${encodeURIComponent(m.telegram)}`;
    tg.target = '_blank';
    tg.rel = 'noopener';
    tg.textContent = `@${m.telegram}`;
    head.append(who, tg);
    if (m.phone) {
      const phone = document.createElement('a');
      phone.href = `tel:${m.phone.replace(/[^0-9+]/g, '')}`;
      phone.textContent = m.phone;
      head.appendChild(phone);
    }
    const when = document.createElement('time');
    when.className = 'muted';
    when.dateTime = m.createdAt;
    when.textContent = new Date(m.createdAt).toLocaleString();
    head.appendChild(when);
    const text = document.createElement('p');
    text.textContent = m.description;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete the message from ${m.name}?`)) return;
      try {
        await adminFetch(`/api/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        load();
      } catch (err) {
        showStatus(err.message);
      }
    });
    el.append(head, text, del);
    return el;
  }

  AdminAuth.ready.then(load);
})();
