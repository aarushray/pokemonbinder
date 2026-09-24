// Serves the site and the designer upload API. No dependencies: run with `node server.js`.
//
// Admin actions (upload/delete designs) are allowed from this computer only, unless
// ADMIN_PASSWORD is set, in which case requests must send it in the X-Admin-Key header.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DESIGNS_DIR = path.join(ROOT, 'designs');
const DB_FILE = path.join(DESIGNS_DIR, 'designs.json');
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY = 40 * 1024 * 1024;

const { TYPES: BINDER_TYPES } = require('./catalog.js');

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

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { designs: [] };
  }
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Upload too large (40 MB max)'), { status: 413 }));
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
function validateFields(body) {
  const name = String(body.name || '').trim().slice(0, 80);
  const price = Math.round(Number(body.price) * 100) / 100;
  if (!name) return { error: 'Name is required' };
  if (!(price > 0 && price < 10000)) return { error: 'Price must be between 0 and 10000' };
  const type = BINDER_TYPES.find((t) => t.id === body.type);
  if (!type) return { error: 'Unknown binder type' };
  if (!type.colors.includes(body.color)) return { error: `That colour isn't available for the ${type.name}` };
  const cards = Number(body.cards);
  if (!Number.isInteger(cards) || cards < 1 || cards > 10000) return { error: 'Card capacity must be a whole number from 1 to 10000' };
  return { fields: { name, price, color: body.color, type: type.id, cards } };
}

async function createDesign(req, res) {
  const body = JSON.parse(await readBody(req));
  const { error, fields } = validateFields(body);
  if (error) return sendJson(res, 400, { error });

  const id = `${slug(fields.name)}-${crypto.randomBytes(3).toString('hex')}`;
  const design = {
    id,
    ...fields,
    art: saveDataUrl(body.art, `${id}-art`),
    thumb: saveDataUrl(body.thumb, `${id}-thumb`),
    createdAt: new Date().toISOString(),
  };
  const db = readDb();
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
  const { error, fields } = validateFields(body);
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
  writeDb(db);
  sendJson(res, 200, design);
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

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  const inside = file.startsWith(ROOT + path.sep);
  const hidden = rel.split('/').some((seg) => seg.startsWith('.'));
  if (!inside || hidden || rel.toLowerCase() === '/server.js') {
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
if (!fs.existsSync(DB_FILE)) writeDb({ designs: [] });

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/api/designs' && req.method === 'POST') {
      if (!isAdmin(req)) return sendJson(res, 403, { error: 'Not allowed' });
      return await createDesign(req, res);
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
