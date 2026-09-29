// Serves the site and the designer upload API. No dependencies: run with `node server.js`.
//
// Layout: public/ holds everything the browser loads (HTML pages, css/, js/). Only public/ and
// designs/ are served, so this file, package.json and .data/ never are.
//
// Data lives in designs/designs.json: { designs: [...], collections: [{ id, name, subclasses }] }.
// Collections are the shop's pages. Each design belongs to one page (`page`, a collection id) and
// may be tagged with some of that page's subclasses (`subclasses`), which the shop uses as filters.
//
// Contact-form messages are saved in .data/messages.json. The dot folder is never served to
// browsers and is ignored by git, so customers' details stay on this computer.
//
// Admin actions (upload/edit/delete designs, add/remove pages, read messages) are allowed from this computer only, unless
// ADMIN_PASSWORD is set, in which case requests must send it in the X-Admin-Key header.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DESIGNS_DIR = path.join(ROOT, 'designs');
const DB_FILE = path.join(DESIGNS_DIR, 'designs.json');
const DATA_DIR = path.join(ROOT, '.data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 40 * 1024 * 1024;

const { TYPES: BINDER_TYPES } = require('./public/js/catalog.js');

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
  if (!Number.isInteger(cards) || cards < 1 || cards > 10000) return { error: 'Card capacity must be a whole number from 1 to 10000' };
  const page = db.collections.find((c) => c.id === body.page);
  if (!page) return { error: 'Choose which page the design goes on' };
  // Keep only subclasses that exist on that page, spelled as the page spells them.
  const wanted = new Set(cleanNames(body.subclasses).map(normTag));
  const subclasses = page.subclasses.filter((s) => wanted.has(normTag(s)));
  return { fields: { name, price, color: body.color, type: type.id, cards, page: page.id, subclasses } };
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
