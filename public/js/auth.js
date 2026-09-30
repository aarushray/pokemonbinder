// Customer accounts with Supabase Auth: log in, sign up, forgot password and reset password.
// One script for login.html, signup.html and reset-password.html; each page has its own form.
(() => {
  const { client, configured } = window.Account;

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');

  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
    statusEl.hidden = !text;
  }

  function busy(button, text) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = text;
    return () => {
      button.disabled = false;
      button.textContent = label;
    };
  }

  // Supabase's messages are mostly readable already; reword the common ones.
  function friendly(error) {
    const msg = (error && error.message) || '';
    if (/invalid login credentials/i.test(msg)) return 'That email and password don\'t match an account.';
    if (/email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link we sent.';
    if (/already registered|already exists/i.test(msg)) return 'An account with this email already exists. Try logging in instead.';
    if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
    if (/failed to fetch|network/i.test(msg)) return 'Couldn\'t reach the login service. Check your connection and try again.';
    return msg || 'Something went wrong. Please try again.';
  }

  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  // Only same-site pages are allowed as the place to go after logging in.
  function nextPage() {
    const next = new URLSearchParams(location.search).get('next') || '';
    return /^[a-z-]+\.html(\?[^#]*)?$/.test(next) ? next : 'index.html';
  }

  // Marks a field invalid and returns the message, for validation checks.
  function bad(input, msg) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return msg;
  }

  function clearInvalid(form) {
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  }

  // Why the visitor was sent here (e.g. from the cart's Checkout button), shown above the form.
  const REASONS = {
    checkout: "Please log in or create an account to check out. Items added to your cart before logging in won't be kept, so you'll need to add them again.",
  };
  const reason = REASONS[new URLSearchParams(location.search).get('reason')];
  if (reason && $('reasonNotice')) {
    $('reasonNotice').textContent = reason;
    $('reasonNotice').hidden = false;
  }
  // Switching between log in and sign up keeps the reason and where to go afterwards.
  for (const a of document.querySelectorAll('#switchLink a')) a.search = location.search;

  if (!configured) {
    $('setupNotice').hidden = false;
    for (const b of document.querySelectorAll('.auth-form button')) b.disabled = true;
    return;
  }

  // ---- Log in (login.html) ----
  const loginForm = $('loginForm');
  if (loginForm) {
    const email = $('email');
    const password = $('password');
    const signedIn = $('signedIn');

    const showSignedIn = (user) => {
      loginForm.hidden = !!user;
      $('switchLink').hidden = !!user;
      signedIn.hidden = !user;
      $('ordersSection').hidden = !user;
      if (user) $('reasonNotice').hidden = true;
      if (user) {
        const name = user.user_metadata && user.user_metadata.full_name;
        $('signedInAs').textContent = name ? `${name} (${user.email})` : user.email;
        loadOrders();
      }
    };

    const STATUS = {
      pending: 'Awaiting payment', paid: 'Paid', in_production: 'Being engraved',
      shipped: 'Shipped', completed: 'Completed', cancelled: 'Cancelled',
    };

    // The customer's own orders, newest first (the database only returns their rows).
    async function loadOrders() {
      const list = $('orders');
      const { data, error } = await client.from('orders')
        .select('id, status, items, item_count, subtotal, total, currency, created_at')
        .order('created_at', { ascending: false });
      if (error) {
        list.replaceChildren();
        $('noOrders').hidden = false;
        $('noOrders').textContent = "Couldn't load your orders right now.";
        return;
      }
      $('noOrders').hidden = data.length > 0;
      list.replaceChildren(...data.map((o) => {
        const el = document.createElement('article');
        el.className = 'order';
        const head = document.createElement('div');
        head.className = 'order-head';
        const num = document.createElement('strong');
        num.textContent = Account.orderNumber(o.id);
        const when = document.createElement('span');
        when.className = 'muted';
        when.textContent = new Date(o.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        const status = document.createElement('span');
        status.className = `order-status status-${o.status}`;
        status.textContent = STATUS[o.status] || o.status;
        head.append(num, when, status);
        const lines = document.createElement('ul');
        for (const l of o.items) {
          const li = document.createElement('li');
          li.textContent = `${l.qty} × ${l.name} (${l.binder_type}, ${l.color_name})`;
          lines.appendChild(li);
        }
        const total = document.createElement('div');
        total.className = 'order-total';
        total.textContent = `${o.item_count} ${o.item_count === 1 ? 'item' : 'items'} · ${o.currency} ${Shop.money(o.total ?? o.subtotal)}${o.total != null ? ' incl. shipping' : ''}`;
        el.append(head, lines, total);
        return el;
      }));
    }
    client.auth.getSession().then(({ data }) => showSignedIn(data.session && data.session.user));

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInvalid(loginForm);
      const v = email.value.trim();
      const problem = !emailOk(v) ? bad(email, 'Please enter a valid email address.')
        : !password.value ? bad(password, 'Please enter your password.') : '';
      if (problem) return setStatus(problem, true);

      const done = busy($('submitBtn'), 'Logging in…');
      const { data, error } = await client.auth.signInWithPassword({ email: v, password: password.value });
      done();
      if (error) return setStatus(friendly(error), true);
      Shop.restoreCart(data.user.id);
      location.href = nextPage();
    });

    $('forgotBtn').addEventListener('click', async () => {
      clearInvalid(loginForm);
      const v = email.value.trim();
      if (!emailOk(v)) return setStatus(bad(email, 'Enter your email above, then click "Forgot password?" again.'), true);
      const done = busy($('forgotBtn'), 'Sending…');
      const { error } = await client.auth.resetPasswordForEmail(v, {
        redirectTo: new URL('reset-password.html', location.href).href,
      });
      done();
      if (error) return setStatus(friendly(error), true);
      setStatus(`If ${v} has an account, we've sent it a link to reset the password.`);
    });

    $('logoutBtn').addEventListener('click', async () => {
      const user = await Account.currentUser();
      if (user) Shop.stashCart(user.id);
      await client.auth.signOut();
      showSignedIn(null);
      setStatus('You\'ve been logged out.');
    });
  }

  // ---- Sign up (signup.html) ----
  const signupForm = $('signupForm');
  if (signupForm) {
    const name = $('name');
    const email = $('email');
    const password = $('password');
    const confirmPw = $('confirmPassword');

    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInvalid(signupForm);
      const v = email.value.trim();
      const problem = !name.value.trim() ? bad(name, 'Please enter your name.')
        : !emailOk(v) ? bad(email, 'Please enter a valid email address.')
        : password.value.length < 8 ? bad(password, 'Please choose a password of at least 8 characters.')
        : password.value !== confirmPw.value ? bad(confirmPw, 'The two passwords don\'t match.') : '';
      if (problem) return setStatus(problem, true);

      const done = busy($('submitBtn'), 'Creating account…');
      const { data, error } = await client.auth.signUp({
        email: v,
        password: password.value,
        options: {
          data: { full_name: name.value.trim() },
          emailRedirectTo: new URL(`login.html${location.search}`, location.href).href,
        },
      });
      done();
      if (error) return setStatus(friendly(error), true);
      // With email confirmation on (Supabase's default) there's no session until the link is clicked.
      if (data.session) {
        Shop.restoreCart(data.user.id);
        location.href = nextPage();
        return;
      }
      signupForm.hidden = true;
      $('switchLink').hidden = true;
      $('checkEmail').hidden = false;
      $('checkEmailAddress').textContent = v;
      setStatus('');
    });
  }

  // ---- Reset password (reset-password.html, opened from the emailed link) ----
  const resetForm = $('resetForm');
  if (resetForm) {
    const password = $('password');
    const confirmPw = $('confirmPassword');

    // The link logs the visitor in for this one purpose; without a session the link is bad or used.
    let ready = false;
    const allow = () => {
      ready = true;
      resetForm.hidden = false;
      $('badLink').hidden = true;
    };
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (session && !ready)) allow();
    });
    setTimeout(() => {
      if (!ready) $('badLink').hidden = false;
    }, 1500);

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInvalid(resetForm);
      const problem = password.value.length < 8 ? bad(password, 'Please choose a password of at least 8 characters.')
        : password.value !== confirmPw.value ? bad(confirmPw, 'The two passwords don\'t match.') : '';
      if (problem) return setStatus(problem, true);

      const done = busy($('submitBtn'), 'Saving…');
      const { error } = await client.auth.updateUser({ password: password.value });
      done();
      if (error) return setStatus(friendly(error), true);
      resetForm.hidden = true;
      setStatus('Your password has been changed. You\'re now logged in.');
      $('doneLinks').hidden = false;
    });
  }
})();
