// Admin pages: only admin accounts can use them. On load this checks the logged-in account; anyone
// not logged in is sent to the log in page (and brought back afterwards), and a logged-in account
// that isn't an admin sees a message instead of the page. The page's content stays hidden until
// the check passes. Every admin request carries the account's access token; the server checks it.
const AdminAuth = (() => {
  const here = location.pathname.split('/').pop() || 'admin.html';
  const toLogin = () => {
    location.href = `login.html?next=${encodeURIComponent(here + location.search)}&reason=admin`;
  };

  async function token() {
    if (!Account.client) return '';
    const { data } = await Account.client.auth.getSession();
    return (data.session && data.session.access_token) || '';
  }

  // fetch() for admin endpoints: adds the token; a 401 (logged out or session expired) goes to log in.
  async function adminFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${await token()}` },
    });
    if (res.status === 401) {
      toLogin();
      throw new Error('Please log in again.');
    }
    return res;
  }

  function block(message) {
    const main = document.querySelector('main');
    main.replaceChildren();
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = message;
    main.appendChild(p);
    main.classList.add('admin-ok');
  }

  // Resolves once the visitor is confirmed as an admin (it never resolves otherwise).
  const ready = (async () => {
    if (!Account.configured) {
      block("Admin pages aren't available: accounts aren't set up on this site.");
      return new Promise(() => {});
    }
    if (!(await token())) {
      toLogin();
      return new Promise(() => {});
    }
    let res;
    try {
      res = await adminFetch('/api/me');
    } catch {
      return new Promise(() => {});
    }
    const me = await res.json().catch(() => ({}));
    if (!res.ok) {
      block(me.error || "Couldn't check your account. Please try again.");
      return new Promise(() => {});
    }
    if (!me.admin) {
      block("This account isn't an admin. Log out and log in with an admin account to manage the shop.");
      return new Promise(() => {});
    }
    document.querySelector('main').classList.add('admin-ok');
    return true;
  })();

  // "Log out" in the header.
  document.addEventListener('click', async (e) => {
    const link = e.target.closest('[data-logout]');
    if (!link) return;
    e.preventDefault();
    if (Account.client) await Account.client.auth.signOut();
    location.href = 'login.html';
  });

  return { ready, fetch: adminFetch };
})();
