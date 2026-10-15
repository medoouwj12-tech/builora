import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'madar-db.json');
const SEED_FILE = path.join(ROOT, 'seed-data.json');
const HOST = process.env.MADAR_HOST || '127.0.0.1';
const PORT = Number(process.env.MADAR_PORT || 3210);
const sessions = new Map();
const loginFailures = new Map();
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
let db;
let writeQueue = Promise.resolve();

async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { db = JSON.parse(await fs.readFile(DATA_FILE, 'utf8')); }
  catch {
    const seeds = JSON.parse(await fs.readFile(SEED_FILE, 'utf8'));
    db = { users: [], leads: seeds.map(l => ({ ...l, status: 'جديد', owner: '' })), activities: [], offers: [], projects: [], target: 250000, banner: true };
    await persist();
  }
  db.users ||= []; db.leads ||= []; db.activities ||= []; db.offers ||= []; db.projects ||= []; db.target ||= 250000;
  const oldLeadCount = db.leads.length;
  db.leads = db.leads.filter(validWhatsAppLead).map(lead => ({ ...lead, phones: `واتساب: +${whatsappDigits(lead.whatsapp)}` }));
  if (db.leads.length !== oldLeadCount) await persist();
}

function persist() {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
    await fs.rename(tmp, DATA_FILE);
  });
  return writeQueue;
}
function cleanUser(user) { return user ? { id: user.id, username: user.username, email: user.username, name: user.name, role: user.role, initials: user.initials, color: user.color } : null; }
function safeEqual(a, b) { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve({ salt, hash: key.toString('hex') })));
}
function whatsappDigits(value) { return String(value || '').match(/(?:wa\.me\/|phone=)\+?(\d{10,15})/i)?.[1] || ''; }
function validWhatsAppLead(lead) { return Boolean(whatsappDigits(lead?.whatsapp)); }
function getSession(req) {
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').map(x => x.trim()).find(x => x.startsWith('madar_session='))?.slice('madar_session='.length);
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; }
  const user = db.users.find(u => u.id === session.userId);
  return user ? { token, user } : null;
}
function loginThrottleKey(req, username) { return `${req.socket.remoteAddress || 'unknown'}|${username}`; }
function isLoginThrottled(key) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (entry.until <= Date.now()) { loginFailures.delete(key); return false; }
  return entry.count >= 8;
}
function recordLoginFailure(key) {
  const now = Date.now(); const entry = loginFailures.get(key);
  if (!entry || entry.until <= now) loginFailures.set(key, { count: 1, until: now + 15 * 60 * 1000 });
  else entry.count++;
}
function send(res, status, obj, headers = {}) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
  res.end(data);
}
async function readBody(req) {
  let raw = ''; for await (const part of req) { raw += part; if (raw.length > 2_000_000) throw new Error('الطلب كبير جدًا'); }
  return raw ? JSON.parse(raw) : {};
}
function requireAuth(req, res) { const session = getSession(req); if (!session) { send(res, 401, { error: 'سجّل دخولك الأول' }); return null; } return session; }
function managerOnly(session, res) { if (session.user.role !== 'المدير') { send(res, 403, { error: 'الصلاحية دي للمدير فقط' }); return false; } return true; }
function mergeById(existing, incoming, predicate) {
  const map = new Map(existing.map(item => [item.id, item]));
  for (const item of incoming || []) {
    if (!item?.id || !predicate(item, map.get(item.id))) continue;
    const old = map.get(item.id);
    if (old) Object.assign(old, item); else map.set(item.id, item);
  }
  return [...map.values()];
}

async function api(req, res, url) {
  const method = req.method;
  if (method === 'GET' && url.pathname === '/api/bootstrap') return send(res, 200, { setupRequired: db.users.length === 0 });
  if (method === 'POST' && url.pathname === '/api/setup') {
    if (db.users.length) return send(res, 409, { error: 'تم إعداد حساب المدير بالفعل' });
    const body = await readBody(req); const name = String(body.name || '').trim(); const username = String(body.username || '').trim().toLowerCase(); const password = String(body.password || '');
    if (!name || !/^[a-zA-Z0-9_.@-]{3,48}$/.test(username) || password.length < 12) return send(res, 400, { error: 'اكتب اسمًا واسم مستخدم صالحًا وكلمة مرور ١٢ حرفًا على الأقل' });
    const secret = await hashPassword(password); const user = { id: crypto.randomUUID(), username, name, role: 'المدير', initials: name.slice(0, 1), color: '#4ccfc1', ...secret, createdAt: new Date().toISOString() };
    db.users.push(user); await persist(); return createSession(res, user);
  }
  if (method === 'POST' && url.pathname === '/api/login') {
    const body = await readBody(req); const username = String(body.username || '').trim().toLowerCase(); const password = String(body.password || '');
    const throttleKey = loginThrottleKey(req, username);
    if (isLoginThrottled(throttleKey)) return send(res, 429, { error: 'محاولات دخول كثيرة. جرّب بعد ١٥ دقيقة.' });
    const user = db.users.find(x => x.username === username);
    if (!user) { recordLoginFailure(throttleKey); return send(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحين' }); }
    const check = await hashPassword(password, user.salt); if (!safeEqual(check.hash, user.hash)) { recordLoginFailure(throttleKey); return send(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحين' }); }
    loginFailures.delete(throttleKey);
    return createSession(res, user);
  }
  if (method === 'POST' && url.pathname === '/api/logout') {
    const session = getSession(req); if (session) sessions.delete(session.token);
    return send(res, 200, { ok: true }, { 'set-cookie': 'madar_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
  }
  if (method === 'GET' && url.pathname === '/api/session') {
    const session = getSession(req); return session ? send(res, 200, { user: cleanUser(session.user) }) : send(res, 401, { error: 'انتهت الجلسة' });
  }
  if (method === 'POST' && url.pathname === '/api/login' && db.users.length === 0) return send(res, 409, { error: 'أنشئ حساب المدير أولًا' });

  const session = requireAuth(req, res); if (!session) return;
  const user = session.user;
  if (method === 'GET' && url.pathname === '/api/state') {
    const manager = user.role === 'المدير';
    return send(res, 200, {
      user: cleanUser(user), team: db.users.map(cleanUser),
      leads: manager ? db.leads : db.leads.filter(l => !l.owner || l.owner === user.id),
      activities: manager ? db.activities : db.activities.filter(a => a.userId === user.id),
      offers: manager ? db.offers : db.offers.filter(o => o.owner === user.id),
      projects: manager ? db.projects : db.projects.filter(p => p.owner === user.id),
      target: manager ? db.target : 0, banner: db.banner
    });
  }
  if (method === 'POST' && url.pathname === '/api/users') {
    if (!managerOnly(session, res)) return;
    const body = await readBody(req); const name = String(body.name || '').trim(); const username = String(body.username || '').trim().toLowerCase(); const password = String(body.password || '');
    if (!name || !/^[a-zA-Z0-9_.@-]{3,48}$/.test(username) || password.length < 12) return send(res, 400, { error: 'اسم المستخدم مطلوب (٣ أحرف على الأقل) وكلمة المرور ١٢ حرفًا على الأقل' });
    if (db.users.some(u => u.username === username)) return send(res, 409, { error: 'اسم المستخدم مستخدم بالفعل' });
    const secret = await hashPassword(password); const userNew = { id: crypto.randomUUID(), username, name, role: 'سيلز', initials: name.slice(0, 1), color: ['#58d6a3', '#a78bfa', '#64a7ff', '#f1a978'][db.users.length % 4], ...secret, createdAt: new Date().toISOString() };
    db.users.push(userNew); await persist(); return send(res, 201, { user: cleanUser(userNew) });
  }
  if (method === 'POST' && url.pathname === '/api/leads/claim') {
    if (user.role !== 'سيلز') return send(res, 403, { error: 'استلام العميل متاح لحسابات السيلز فقط' });
    const body = await readBody(req); const lead = db.leads.find(l => l.id === String(body.id || ''));
    if (!lead || !validWhatsAppLead(lead)) return send(res, 404, { error: 'العميل غير موجود' });
    if (lead.owner) return send(res, 409, { error: lead.owner === user.id ? 'العميل ضمن قائمتك بالفعل' : 'العميل استلمه فرد آخر من السيلز' });
    lead.owner = user.id;
    db.activities.unshift({ id: crypto.randomUUID(), kind: 'assign', title: `استلام عميل: ${lead.name}`, detail: `أصبح العميل ضمن متابعة ${user.name}`, leadId: lead.id, userId: user.id, at: new Date().toISOString() });
    await persist(); return send(res, 200, { ok: true, lead });
  }
  if (method === 'DELETE' && url.pathname.startsWith('/api/leads/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/leads/'.length));
    const index = db.leads.findIndex(l => l.id === id && (user.role === 'المدير' || l.owner === user.id));
    if (index < 0) return send(res, 404, { error: 'العميل غير موجود أو لا تملك صلاحية حذفه' });
    db.leads.splice(index, 1); await persist(); return send(res, 200, { ok: true });
  }
  if (method === 'DELETE' && url.pathname.startsWith('/api/users/')) {
    if (!managerOnly(session, res)) return;
    const id = decodeURIComponent(url.pathname.slice('/api/users/'.length)); const index = db.users.findIndex(u => u.id === id && u.role === 'سيلز');
    if (index < 0) return send(res, 404, { error: 'حساب السيلز غير موجود' });
    db.users.splice(index, 1); db.leads.forEach(l => { if (l.owner === id) l.owner = ''; }); await persist(); return send(res, 200, { ok: true });
  }
  if (method === 'PUT' && url.pathname === '/api/state') {
    const body = await readBody(req); const manager = user.role === 'المدير';
    if (manager) {
      if (Array.isArray(body.leads)) db.leads = body.leads.filter(validWhatsAppLead).map(lead => ({ ...lead, phones: `واتساب: +${whatsappDigits(lead.whatsapp)}` }));
      if (Array.isArray(body.activities)) db.activities = body.activities;
      if (Array.isArray(body.offers)) db.offers = body.offers;
      if (Array.isArray(body.projects)) db.projects = body.projects;
      if (Number.isFinite(Number(body.target))) db.target = Math.max(0, Number(body.target));
      if (typeof body.banner === 'boolean') db.banner = body.banner;
    } else {
      db.leads = mergeById(db.leads, body.leads, (item, old) => validWhatsAppLead(item) && (old ? old.owner === user.id && item.owner === user.id : item.owner === user.id));
      db.activities = mergeById(db.activities, body.activities, item => item.userId === user.id);
      db.offers = mergeById(db.offers, body.offers, item => item.owner === user.id);
      db.projects = mergeById(db.projects, body.projects, item => item.owner === user.id);
    }
    await persist(); return send(res, 200, { ok: true });
  }
  if (method === 'POST' && url.pathname === '/api/password') {
    const body = await readBody(req); const current = String(body.currentPassword || ''); const next = String(body.newPassword || '');
    const oldHash = await hashPassword(current, user.salt); if (!safeEqual(oldHash.hash, user.hash)) return send(res, 401, { error: 'كلمة المرور الحالية غير صحيحة' });
    if (next.length < 10) return send(res, 400, { error: 'كلمة المرور الجديدة لازم تكون ١٠ أحرف على الأقل' });
    Object.assign(user, await hashPassword(next)); await persist(); return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'الطلب غير معروف' });
}

function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex'); const expires = Date.now() + 12 * 60 * 60 * 1000;
  sessions.set(token, { userId: user.id, expires });
  const secure = process.env.MADAR_SECURE_COOKIE === '1' ? '; Secure' : '';
  return send(res, 200, { user: cleanUser(user) }, { 'set-cookie': `madar_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}` });
}

const allowedFiles = new Set(['index.html', 'app.js', 'styles.css', 'seed.js', 'نشر-مَدار-على-Vercel.txt']);
async function serveFile(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const name = path.basename(pathname);
  if (!allowedFiles.has(name) || pathname.slice(1) !== name) { res.writeHead(404); res.end('Not found'); return; }
  const file = path.join(ROOT, name); const ext = path.extname(file);
  try { const data = await fs.readFile(file); res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': name.endsWith('.html') ? 'no-store' : 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' }); res.end(data); }
  catch { res.writeHead(404); res.end('Not found'); }
}

await init();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try { if (url.pathname.startsWith('/api/')) await api(req, res, url); else await serveFile(req, res, url); }
  catch (error) { console.error(error); if (!res.headersSent) send(res, 500, { error: 'حصل خطأ داخلي في النظام' }); else res.end(); }
});
server.listen(PORT, HOST, () => console.log(`Madar running at http://${HOST}:${PORT}`));
