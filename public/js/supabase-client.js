// Shared Supabase connection for pages that use customer accounts (log in, cart checkout).
// Needs the supabase-js library and supabase-config.js loaded first.
(() => {
  const { url, anonKey } = window.SUPABASE_CONFIG || {};
  const configured = Boolean(url && anonKey && window.supabase);
  const client = configured ? window.supabase.createClient(url, anonKey) : null;

  // The logged-in user, or null.
  async function currentUser() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return (data.session && data.session.user) || null;
  }

  // A short order number for customers, e.g. #3F9A1C2B (the first part of the order's id).
  const orderNumber = (id) => `#${String(id).slice(0, 8).toUpperCase()}`;

  window.Account = { client, configured, currentUser, orderNumber };
})();
