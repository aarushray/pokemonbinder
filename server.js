// Serves the site and the designer upload API. No dependencies: run with `node server.js`.
//
// Layout: public/ holds everything the browser loads (HTML pages, css/, js/). Only public/ and
// designs/ are served, so this file, package.json and .data/ never are.
//
// Data lives in designs/designs.json: { designs: [...], collections: [{ id, name, subclasses }],
// settings: { storeDiscount, bannerText } }. Discounts are whole percentages (0 = none).
// Collections are the shop's pages. Each design belongs to one page (`page`, a collection id) and
// may be tagged with some of that page's subclasses (`subclasses`), which the shop uses as filters.
//
// Contact-form messages are saved in .data/messages.json. The dot folder is never served to
// browsers and is ignored by git, so customers' details stay on this computer.
//
// Customer orders live in Supabase. The admin Orders page reads them through this server using the
// Supabase secret (service_role) key from the git-ignored .env file; that key never reaches a browser.
//
// Checkout: customers' orders are priced and saved here (POST /api/checkout), never by the browser,
// so prices can't be altered. The order is stored in Supabase with the service_role key. Customers
// then pay with the shop's PayNow QR code and upload proof (pay.html), which you check and mark paid.
//
// Admin actions (upload/edit/delete designs, add/remove pages, read messages, manage orders) are
// allowed from this computer only, unless ADMIN_PASSWORD is set, in which case requests must send
// it in the X-Admin-Key header.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

// Settings from .env (KEY=value lines; # comments). Real environment variables take precedence.
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {
  // No .env file: that's fine until the Orders page is needed.
}
const PUBLIC_DIR = path.join(ROOT, 'public');
const DESIGNS_DIR = path.join(ROOT, 'designs');
const DB_FILE = path.join(DESIGNS_DIR, 'designs.json');
const DATA_DIR = path.join(ROOT, '.data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 40 * 1024 * 1024;

const { TYPES: BINDER_TYPES, COLORS: BINDER_COLORS } = require('./public/js/catalog.js');

// Supabase project URL: from .env, or the one the website already uses (public/js/supabase-config.js).
const SUPABASE_URL = (process.env.SUPABASE_URL || (() => {
  try {
    return /url:\s*'([^']+)'/.exec(fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'supabase-config.js'), 'utf8'))[1];
  } catch {
    return '';
  }
})()).replace(/\/+$/, '');
const SUPABASE_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const DEFAULT_COLLECTIONS = [
  { id: 'pokemon', name: 'Pokémon' },
  { id: 'one-piece', name: 'One Piece' },
];

function readDb() {
  let db;
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = { designs: [] };
  }
  if (!Array.isArray(db.collections)) db.collections = DEFAULT_COLLECTIONS.map((c) => ({ ...c }));
  for (const c of db.collections) if (!Array.isArray(c.subclasses)) c.subclasses = [];
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!Number.isInteger(db.settings.storeDiscount)) db.settings.storeDiscount = 0;
  if (typeof db.settings.bannerText !== 'string') db.settings.bannerText = '';
  return db;
}

// Names compare ignoring case, accents and extra spaces ("pokemon" = "Pokémon").
function normTag(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Older designs had a `genre`, then free-text `tags`; turn them into a page plus subclasses.
function migrate() {
  const db = readDb();
  const legacy = { pokemon: 'Pokémon', 'one-piece': 'One Piece' };
  for (const d of db.designs) {
    if (!Array.isArray(d.tags) && !d.page) d.tags = [legacy[d.genre] || 'Pokémon'];
    if (Array.isArray(d.tags)) {
      const page = db.collections.find((c) => d.tags.some((t) => normTag(t) === normTag(c.name)));
      d.page = page ? page.id : null;
      d.subclasses = page ? d.tags.filter((t) => normTag(t) !== normTag(page.name)) : [];
      if (page) {
        for (const x of d.subclasses) {
          if (!page.subclasses.some((y) => normTag(y) === normTag(x))) page.subclasses.push(x);
        }
      }
    }
    if (!Array.isArray(d.subclasses)) d.subclasses = [];
    delete d.tags;
    delete d.genre;
  }
  writeDb(db);
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 2));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}

function isAdmin(req) {
  if (ADMIN_PASSWORD) {
    const given = Buffer.from(String(req.headers['x-admin-key'] || ''));
    const want = Buffer.from(ADMIN_PASSWORD);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  }
  const ip = req.socket.remoteAddress;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error(max === MAX_BODY ? 'Upload too large (40 MB max)' : 'Message too long'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Writes a base64 image data URL into designs/ and returns its site-relative path.
function saveDataUrl(dataUrl, baseName) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Images must be PNG, JPEG or WebP'), { status: 400 });
  const file = `${baseName}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(DESIGNS_DIR, file), Buffer.from(m[2], 'base64'));
  return `designs/${file}`;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'design';
}

// Validates the editable fields of a design; returns { error } or { fields }.
function validateFields(body, db) {
  const name = String(body.name || '').trim().slice(0, 80);
  const price = Math.round(Number(body.price) * 100) / 100;
  if (!name) return { error: 'Name is required' };
  if (!(price > 0 && price < 10000)) return { error: 'Price must be between 0 and 10000' };
  const type = BINDER_TYPES.find((t) => t.id === body.type);
  if (!type) return { error: 'Unknown binder type' };
  if (!type.colors.includes(body.color)) return { error: `That colour isn't available for the ${type.name}` };
  const cards = Number(body.cards);
  if (!Number.isInteger(cards) || cards < 1 || cards > 10000) return { error: 'Number of pockets must be a whole number from 1 to 10000' };
  const page = db.collections.find((c) => c.id === body.page);
  if (!page) return { error: 'Choose which page the design goes on' };
  // Keep only subclasses that exist on that page, spelled as the page spells them.
  const wanted = new Set(cleanNames(body.subclasses).map(normTag));
  const subclasses = page.subclasses.filter((s) => wanted.has(normTag(s)));
  const discount = parseDiscount(body.discount);
  if (discount === null) return { error: 'Discount must be a whole number from 0 to 90 (percent)' };
  if (discount > 0 && db.settings.storeDiscount > 0) {
    return { error: 'A storewide discount is on, so binders can\'t have their own discount. Set the storewide discount to 0 first.' };
  }
  return { fields: { name, price, color: body.color, type: type.id, cards, page: page.id, subclasses, discount } };
}

// A discount percentage: blank means none (0); otherwise a whole number from 0 to 90. Null if invalid.
function parseDiscount(value) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 90 ? n : null;
}

// Storewide discount for every shop design (custom designs are never discounted). Turning it on
// resets every design's own discount to 0, so the two never stack. bannerText is the sale message
// that scrolls across the top of the home page while the discount is on.
async function updateSettings(req, res) {
  const body = JSON.parse(await readBody(req));
  const storeDiscount = parseDiscount(body.storeDiscount);
  if (storeDiscount === null) return sendJson(res, 400, { error: 'Storewide discount must be a whole number from 0 to 90 (percent)' });
  const db = readDb();
  db.settings.storeDiscount = storeDiscount;
  if (body.bannerText !== undefined) db.settings.bannerText = String(body.bannerText).replace(/\s+/g, ' ').trim().slice(0, 160);
  if (storeDiscount > 0) for (const d of db.designs) d.discount = 0;
  writeDb(db);
  sendJson(res, 200, db.settings);
}

// A list (or comma-separated string) of short labels, trimmed, without duplicates.
function cleanNames(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const tag = String(raw).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (tag && !seen.has(normTag(tag))) {
      seen.add(normTag(tag));
      tags.push(tag);
    }
  }
  return tags.slice(0, 20);
}

async function createDesign(req, res) {
  const body = JSON.parse(await readBody(req));
  const db = readDb();
  const { error, fields } = validateFields(body, db);
  if (error) return sendJson(res, 400, { error });

  const id = `${slug(fields.name)}-${crypto.randomBytes(3).toString('hex')}`;
  const design = {
    id,
    ...fields,
    art: saveDataUrl(body.art, `${id}-art`),
    thumb: saveDataUrl(body.thumb, `${id}-thumb`),
    createdAt: new Date().toISOString(),
  };
  db.designs.unshift(design);
  writeDb(db);
  sendJson(res, 201, design);
}

// Updates a design's details. A new thumbnail is optional (sent when the type or colour changed).
async function updateDesign(id, req, res) {
  const body = JSON.parse(await readBody(req));
  const db = readDb();
  const design = db.designs.find((d) => d.id === id);
  if (!design) return sendJson(res, 404, { error: 'Design not found' });
  const { error, fields } = validateFields(body, db);
  if (error) return sendJson(res, 400, { error });

  if (body.thumb) {
    const thumb = saveDataUrl(body.thumb, `${id}-thumb`);
    if (thumb !== design.thumb) {
      const old = path.join(ROOT, design.thumb);
      if (path.dirname(old) === DESIGNS_DIR) fs.rmSync(old, { force: true });
    }
    design.thumb = thumb;
  }
  Object.assign(design, fields, { updatedAt: new Date().toISOString() });
  delete design.genre;
  delete design.tags;
  writeDb(db);
  sendJson(res, 200, design);
}

async function createCollection(req, res) {
  const body = JSON.parse(await readBody(req));
  const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) return sendJson(res, 400, { error: 'Page name is required' });
  const db = readDb();
  if (db.collections.some((c) => normTag(c.name) === normTag(name))) {
    return sendJson(res, 400, { error: `There is already a "${name}" page` });
  }
  const base = slug(normTag(name));
  let id = base;
  for (let n = 2; db.collections.some((c) => c.id === id); n++) id = `${base}-${n}`;
  const collection = { id, name, subclasses: [] };
  db.collections.push(collection);
  writeDb(db);
  sendJson(res, 201, collection);
}

// Replaces a page's subclass list (the admin adds/removes them one at a time). Designs keep only
// the subclasses that still exist on their page.
async function updateCollection(id, req, res) {
  const body = JSON.parse(await readBody(req));
  const db = readDb();
  const page = db.collections.find((c) => c.id === id);
  if (!page) return sendJson(res, 404, { error: 'Page not found' });
  page.subclasses = cleanNames(body.subclasses).slice(0, 50);
  const keep = new Set(page.subclasses.map(normTag));
  for (const d of db.designs) {
    if (d.page === id) d.subclasses = (d.subclasses || []).filter((x) => keep.has(normTag(x)));
  }
  writeDb(db);
  sendJson(res, 200, page);
}

// Removes a page only; its designs stay saved but are hidden from the shop until moved to another page.
function deleteCollection(id, res) {
  const db = readDb();
  if (!db.collections.some((c) => c.id === id)) return sendJson(res, 404, { error: 'Page not found' });
  db.collections = db.collections.filter((c) => c.id !== id);
  writeDb(db);
  sendJson(res, 200, { ok: true });
}

function deleteDesign(id, res) {
  const db = readDb();
  const design = db.designs.find((d) => d.id === id);
  if (!design) return sendJson(res, 404, { error: 'Design not found' });
  for (const rel of [design.art, design.thumb]) {
    const file = path.join(ROOT, rel);
    if (path.dirname(file) === DESIGNS_DIR) fs.rmSync(file, { force: true });
  }
  db.designs = db.designs.filter((d) => d.id !== id);
  writeDb(db);
  sendJson(res, 200, { ok: true });
}

function readMessages() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeMessages(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MESSAGES_FILE + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(MESSAGES_FILE + '.tmp', MESSAGES_FILE);
}

// Saves a message from the contact page. Anyone can send one; only the admin can read them.
async function createMessage(req, res) {
  const body = JSON.parse(await readBody(req, 64 * 1024));
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  const name = text(body.name, 80);
  const telegram = text(body.telegram, 40).replace(/^@/, '');
  const phone = text(body.phone, 30);
  const description = text(body.description, 5000);
  if (!name) return sendJson(res, 400, { error: 'Please enter your name' });
  if (!/^[A-Za-z0-9_]{5,32}$/.test(telegram)) return sendJson(res, 400, { error: 'Please enter a valid Telegram handle (5-32 letters, numbers or underscores)' });
  if (phone && !/^[0-9+()\-\s]{6,30}$/.test(phone)) return sendJson(res, 400, { error: 'Please enter a valid phone number' });
  if (!description) return sendJson(res, 400, { error: 'Please describe the art you would like' });
  const list = readMessages();
  if (list.length >= 5000) return sendJson(res, 503, { error: "We can't take new messages right now. Please try again later." });
  list.unshift({ id: crypto.randomUUID(), name, telegram, phone, description, createdAt: new Date().toISOString() });
  writeMessages(list);
  sendJson(res, 201, { ok: true });
}

function deleteMessage(id, res) {
  const list = readMessages();
  if (!list.some((m) => m.id === id)) return sendJson(res, 404, { error: 'Message not found' });
  writeMessages(list.filter((m) => m.id !== id));
  sendJson(res, 200, { ok: true });
}

// ─── Orders (Supabase, admin only) ─────────────────────────────────────────────────────
const ORDER_STATUSES = ['pending', 'payment_submitted', 'paid', 'in_production', 'shipped', 'completed', 'cancelled'];

// Calls Supabase with the secret key. Throws with Supabase's message on failure.
async function supa(pathAndQuery, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SECRET) {
    throw Object.assign(new Error('The Orders page isn\'t set up yet: add SUPABASE_SERVICE_ROLE_KEY to the .env file and restart the server.'), { status: 503 });
  }
  const headers = { apikey: SUPABASE_SECRET, 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (SUPABASE_SECRET.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_SECRET}`; // legacy JWT keys
  const res = await fetch(`${SUPABASE_URL}${pathAndQuery}`, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error((body && (body.message || body.error)) || `Supabase error ${res.status}`), { status: 502 });
  return body;
}

// Short order number customers see, e.g. #3F9A1C2B (same as the website's).
const orderNumber = (id) => String(id).slice(0, 8).toUpperCase();
const fileSlug = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

// Readable name for a custom design's artwork, e.g. 3F9A1C2B_Ash-Ketchum_9-pocket_Grey_1.png
function artFileName(order, line, index) {
  const ext = (/\.([a-z0-9]+)$/i.exec(line.art_path || '') || [, 'jpg'])[1];
  return `${orderNumber(order.id)}_${fileSlug(order.customer_name || 'customer')}_${fileSlug(line.binder_type)}_${fileSlug(line.color_name)}_${index + 1}.${ext}`;
}

async function listOrders(res) {
  const orders = await supa('/rest/v1/orders?select=*&order=created_at.desc');
  const ids = [...new Set(orders.map((o) => o.user_id))];
  const profiles = ids.length ? await supa(`/rest/v1/profiles?select=id,email&id=in.(${ids.join(',')})`) : [];
  const emails = new Map(profiles.map((p) => [p.id, p.email]));
  sendJson(res, 200, orders.map((o) => ({ ...o, account_email: emails.get(o.user_id) || null })));
}

async function updateOrderStatus(id, req, res) {
  const { status } = JSON.parse(await readBody(req, 4096));
  if (!ORDER_STATUSES.includes(status)) return sendJson(res, 400, { error: 'Unknown status' });
  const rows = await supa(`/rest/v1/orders?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status }),
  });
  if (!rows.length) return sendJson(res, 404, { error: 'Order not found' });
  sendJson(res, 200, rows[0]);
}

// A short-lived download link for one custom design's artwork, saved under a readable name.
async function artDownload(id, index, res) {
  const [order] = await supa(`/rest/v1/orders?select=*&id=eq.${id}`);
  const line = order && order.items[index];
  if (!line || !line.art_path) return sendJson(res, 404, { error: 'No artwork for that item' });
  const signed = await supa(`/storage/v1/object/sign/custom-art/${line.art_path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 300 }),
  });
  const url = `${SUPABASE_URL}/storage/v1${signed.signedURL}&download=${encodeURIComponent(artFileName(order, line, index))}`;
  sendJson(res, 200, { url });
}

// ─── Checkout (customers) ──────────────────────────────────────────────────────────────
// The cart page sends only what's in the cart and the delivery details. Every price is worked out
// here from the catalogue (designs.json + catalog.js), with the same rules the shop pages show.
const SHIPPING_FEE = 3; // flat, per order (SGD); the cart page shows the same
const MAX_QTY = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

// The logged-in customer, from the Supabase access token the page sends. Null if not logged in.
async function customerFrom(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!m || !SUPABASE_URL || !SUPABASE_SECRET) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_SECRET, Authorization: `Bearer ${m[1]}` } });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

// Texture of a colour on a binder type (velvet for velvet colours), or null for single-texture types.
function finishOf(type, color) {
  if (!type.finishes) return null;
  return type.finishes.find((f) => f.colors.includes(color)) || type.finishes[0];
}
const colorName = (value) => BINDER_COLORS.find((c) => c.id === value).name;
const cents = (n) => Math.round(n * 100);

// One cart line → an order line with its price. Throws a 400 for anything that isn't for sale.
function priceLine(item, user, db) {
  const qty = Number(item && item.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw badRequest(`Quantities must be from 1 to ${MAX_QTY}.`);
  const color = String(item.color || '');

  // Custom design: the binder's base price plus any texture surcharge; never discounted.
  if (item.custom === true) {
    const type = BINDER_TYPES.find((t) => t.id === item.type);
    if (!type) throw badRequest('A custom design in your cart uses a binder type we no longer sell. Please remove it.');
    if (!type.colors.includes(color)) throw badRequest('A custom design in your cart has an unknown colour.');
    const artPath = String(item.art_path || '');
    if (!artPath.startsWith(`${user.id}/`) || artPath.includes('..')) throw badRequest('The artwork for a custom design is missing. Please remove it and add it again.');
    const finish = finishOf(type, color);
    const price = type.basePrice + ((finish && finish.extraPrice) || 0);
    return {
      name: 'Custom design', binder_type: type.name, color, color_name: colorName(color),
      unit_price: price, original_price: price, discount_percent: 0, qty,
      custom: true, texture: finish ? finish.name : 'Diamond texture', art_path: artPath,
    };
  }

  // Shop design: the admin's price plus any texture surcharge, less the storewide discount while
  // it's on, otherwise the design's own discount (they never stack).
  const design = db.designs.find((d) => d.id === item.id);
  if (!design) throw badRequest('Something in your cart is no longer sold. Please refresh the cart page.');
  const type = BINDER_TYPES.find((t) => t.id === design.type) || BINDER_TYPES.find((t) => t.id === '9-pocket');
  if (!type.colors.includes(color)) throw badRequest(`"${design.name}" isn't available in that colour.`);
  const finish = finishOf(type, color);
  const original = design.price + ((finish && finish.extraPrice) || 0);
  const discount = db.settings.storeDiscount > 0 ? db.settings.storeDiscount : design.discount || 0;
  const price = discount ? Math.round(original * (100 - discount)) / 100 : original;
  return {
    design_id: design.id, name: design.name, binder_type: type.name, color, color_name: colorName(color),
    unit_price: price, original_price: original, discount_percent: discount, qty,
  };
}

// Delivery details, checked with the same rules as the cart page.
function checkDetails(d) {
  const s = (v, max) => String(v ?? '').trim().slice(0, max);
  const out = {
    contact_method: s(d.contactMethod, 10), contact: s(d.contact, 100), customer_name: s(d.name, 80),
    phone: s(d.phone, 20), address: s(d.address, 200), unit_number: s(d.unit, 20) || null, postal_code: s(d.postal, 6),
  };
  if (out.contact_method === 'telegram') {
    if (!/^@?[A-Za-z0-9_]{5,32}$/.test(out.contact)) throw badRequest('Please enter your Telegram username, e.g. @tcgengrave.');
    out.contact = out.contact.replace(/^@/, '');
  } else if (out.contact_method === 'gmail') {
    if (!/^[^\s@]+@gmail\.com$/i.test(out.contact)) throw badRequest('Please enter a Gmail address, e.g. name@gmail.com.');
    out.contact = out.contact.toLowerCase();
  } else throw badRequest('Please choose how we should contact you.');
  if (!out.customer_name) throw badRequest('Please enter your name.');
  if (!/^(\+?65[\s-]?)?[3689]\d{3}[\s-]?\d{4}$/.test(out.phone)) throw badRequest('Please enter a Singapore phone number, e.g. 9123 4567.');
  if (!out.address) throw badRequest('Please enter your address.');
  if (!/^\d{6}$/.test(out.postal_code)) throw badRequest('Please enter a 6-digit postal code.');
  return out;
}

// POST /api/checkout { orderId, items, details } → { orderId, total }
async function checkout(req, res) {
  const user = await customerFrom(req);
  if (!user) return sendJson(res, 401, { error: 'Please log in again to check out.' });
  const body = JSON.parse(await readBody(req, 256 * 1024));
  const orderId = String(body.orderId || '');
  if (!UUID_RE.test(orderId)) return sendJson(res, 400, { error: 'Bad order id' });
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) return sendJson(res, 400, { error: 'Your cart is empty.' });

  const db = readDb();
  const items = body.items.map((i) => priceLine(i, user, db));
  const details = checkDetails(body.details || {});
  const subtotal = cents(items.reduce((sum, l) => sum + l.unit_price * l.qty, 0)) / 100;
  const total = cents(subtotal + SHIPPING_FEE) / 100;

  const [existing] = await supa(`/rest/v1/orders?select=id&id=eq.${orderId}`);
  if (existing) return sendJson(res, 409, { error: 'This order has already been placed. Please refresh the cart page.' });
  await supa('/rest/v1/orders', {
    method: 'POST',
    body: JSON.stringify({
      id: orderId, user_id: user.id, status: 'pending',
      items, item_count: items.reduce((n, l) => n + l.qty, 0), subtotal, shipping_fee: SHIPPING_FEE, total,
      ...details,
    }),
  });
  sendJson(res, 200, { orderId, total });
}

// ─── PayNow payment proof ──────────────────────────────────────────────────────────────
// After checkout the customer pays by scanning the shop's static PayNow QR code, then uploads a
// screenshot to the private "payment-proofs" bucket (in a folder named after them). The order moves
// to 'payment_submitted' until the admin checks the proof and marks it paid.

// A short-lived link to a private storage file. Throws if the file doesn't exist.
async function signedUrl(bucket, filePath, downloadName) {
  const signed = await supa(`/storage/v1/object/sign/${bucket}/${filePath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 300 }),
  });
  return `${SUPABASE_URL}/storage/v1${signed.signedURL}${downloadName ? `&download=${encodeURIComponent(downloadName)}` : ''}`;
}

// GET /api/checkout/<id>: the customer's own order, for the payment page.
async function customerOrder(orderId, req, res) {
  const user = await customerFrom(req);
  if (!user) return sendJson(res, 401, { error: 'Please log in to see this order.' });
  const [order] = await supa(`/rest/v1/orders?select=id,user_id,status,total,currency,payment_proof_path&id=eq.${orderId}`);
  if (!order || order.user_id !== user.id) return sendJson(res, 404, { error: 'Order not found.' });
  sendJson(res, 200, { orderId, status: order.status, total: Number(order.total), currency: order.currency, proofSubmitted: !!order.payment_proof_path });
}

// POST /api/checkout/<id>/proof { path }: records the uploaded screenshot on the customer's order.
async function submitProof(orderId, req, res) {
  const user = await customerFrom(req);
  if (!user) return sendJson(res, 401, { error: 'Please log in again to submit your payment.' });
  const { path: proofPath } = JSON.parse(await readBody(req, 4096));
  const p = String(proofPath || '');
  if (!p.startsWith(`${user.id}/`) || p.includes('..')) return sendJson(res, 400, { error: 'Please upload your payment screenshot again.' });
  const [order] = await supa(`/rest/v1/orders?select=id,user_id,status&id=eq.${orderId}`);
  if (!order || order.user_id !== user.id) return sendJson(res, 404, { error: 'Order not found.' });
  if (!['pending', 'payment_submitted'].includes(order.status)) return sendJson(res, 409, { error: 'This order has already been paid.' });
  try {
    await signedUrl('payment-proofs', p); // makes sure the file really was uploaded
  } catch {
    return sendJson(res, 400, { error: "We couldn't find your screenshot. Please upload it again." });
  }
  await supa(`/rest/v1/orders?id=eq.${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'payment_submitted', payment_proof_path: p, payment_submitted_at: new Date().toISOString() }),
  });
  sendJson(res, 200, { orderId, status: 'payment_submitted' });
}

// GET /api/orders/<id>/proof (admin): a link to view the customer's payment screenshot.
async function proofLink(id, res) {
  const [order] = await supa(`/rest/v1/orders?select=id,payment_proof_path&id=eq.${id}`);
  if (!order || !order.payment_proof_path) return sendJson(res, 404, { error: 'No payment proof for this order' });
  sendJson(res, 200, { url: await signedUrl('payment-proofs', order.payment_proof_path) });
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  // /designs/... comes from the designs folder; everything else from public/.
  const fromDesigns = rel.startsWith('/designs/');
  const base = fromDesigns ? DESIGNS_DIR : PUBLIC_DIR;
  const file = path.join(base, fromDesigns ? rel.slice('/designs'.length) : rel);
  const inside = file.startsWith(base + path.sep);
  const hidden = rel.split('/').some((seg) => seg.startsWith('.'));
  if (!inside || hidden) {
    res.writeHead(404).end('Not found');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

fs.mkdirSync(DESIGNS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) writeDb({ designs: [], collections: DEFAULT_COLLECTIONS });
migrate();

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/designs' && req.method === 'POST') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return await createDesign(req, res);
    }
    if (pathname === '/api/checkout' && req.method === 'POST') return await checkout(req, res);
    const customerMatch = /^\/api\/checkout\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/proof)?$/.exec(pathname);
    if (customerMatch && !customerMatch[2] && req.method === 'GET') return await customerOrder(customerMatch[1], req, res);
    if (customerMatch && customerMatch[2] && req.method === 'POST') return await submitProof(customerMatch[1], req, res);
    if (pathname.startsWith('/api/orders') && !isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
    if (pathname === '/api/orders' && req.method === 'GET') return await listOrders(res);
    const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
    const orderMatch = new RegExp(`^/api/orders/${uuid}$`).exec(pathname);
    if (orderMatch && req.method === 'PATCH') return await updateOrderStatus(orderMatch[1], req, res);
    const artMatch = new RegExp(`^/api/orders/${uuid}/art/(\\d{1,3})$`).exec(pathname);
    if (artMatch && req.method === 'GET') return await artDownload(artMatch[1], Number(artMatch[2]), res);
    const proofMatch = new RegExp(`^/api/orders/${uuid}/proof$`).exec(pathname);
    if (proofMatch && req.method === 'GET') return await proofLink(proofMatch[1], res);
    if (pathname === '/api/settings' && req.method === 'PATCH') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return await updateSettings(req, res);
    }
    if (pathname === '/api/messages' && req.method === 'POST') return await createMessage(req, res);
    if (pathname === '/api/messages' && req.method === 'GET') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return sendJson(res, 200, readMessages());
    }
    const msg = /^\/api\/messages\/([a-f0-9-]+)$/.exec(pathname);
    if (msg && req.method === 'DELETE') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return deleteMessage(msg[1], res);
    }
    if (pathname === '/api/collections' && req.method === 'POST') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return await createCollection(req, res);
    }
    const page = /^\/api\/collections\/([a-z0-9-]+)$/.exec(pathname);
    if (page && req.method === 'DELETE') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return deleteCollection(page[1], res);
    }
    if (page && req.method === 'PATCH') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return await updateCollection(page[1], req, res);
    }
    const one = /^\/api\/designs\/([a-z0-9-]+)$/.exec(pathname);
    if (one && req.method === 'DELETE') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return deleteDesign(one[1], res);
    }
    if (one && req.method === 'PATCH') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return await updateDesign(one[1], req, res);
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
    serveStatic(req, res, pathname);
  } catch (err) {
    sendJson(res, err.status || (err instanceof SyntaxError ? 400 : 500), { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`Shop:   http://localhost:${PORT}/`);
  console.log(`Admin:  http://localhost:${PORT}/admin.html`);
});
