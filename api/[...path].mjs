import crypto from 'node:crypto';
import pg from 'pg';
import seedLeads from '../seed-data.json' with { type: 'json' };

const { Pool } = pg;
let pool;
const COOKIE = 'madar_session';
const SESSION_MS = 12 * 60 * 60 * 1000;

function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, idleTimeoutMillis: 5000, connectionTimeoutMillis: 8000, ssl: { rejectUnauthorized: false } });
  return pool;
}
function secret() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return process.env.SESSION_SECRET;
}
function json(res, code, value, headers = {}) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  for (const [key, val] of Object.entries(headers)) res.setHeader(key, val);
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2_000_000) throw Object.assign(new Error('الطلب أكبر من المسموح'), { status: 413 }); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('صيغة البيانات غير صحيحة'), { status: 400 }); }
}
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve({ salt, hash: key.toString('hex') })));
}
function eqHex(a, b) {
  try { const left = Buffer.from(a, 'hex'), right = Buffer.from(b, 'hex'); return left.length === right.length && crypto.timingSafeEqual(left, right); } catch { return false; }
}
function sessionToken(userId, expires) {
  const payload = Buffer.from(`${userId}.${expires}`).toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function parseCookie(req, name) {
  const prefix = `${name}=`;
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(prefix))?.slice(prefix.length) || '';
}
function verifyToken(token) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
  let actual; try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const [id, expiresText] = Buffer.from(payload, 'base64url').toString().split('.');
    const expires = Number(expiresText);
    return id && Number.isFinite(expires) && expires > Date.now() ? { id, expires } : null;
  } catch { return null; }
}
function setSession(res, user) {
  const expires = Date.now() + SESSION_MS;
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('set-cookie', `${COOKIE}=${sessionToken(user.id, expires)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`);
  return json(res, 200, { user: cleanUser(user) });
}
function cleanUser(u) { return { id: u.id, username: u.username, email: u.username, name: u.name, role: u.role, initials: u.initials, color: u.color, approved: u.approved !== false }; }
function cleanLead(row) { return { ...row.payload, id: row.id, owner: row.owner_id || '' }; }
function digitsFromWhatsApp(value) {
  const match = String(value || '').match(/(?:wa\.me\/|phone=)(\+?\d{10,15})/i);
  return match ? match[1].replace(/\D/g, '') : '';
}
function validWhatsAppLead(item) { return Boolean(digitsFromWhatsApp(item?.whatsapp)); }
async function auth(req) {
  const parsed = verifyToken(parseCookie(req, COOKIE));
  if (!parsed) return null;
  const result = await db().query('select id, username, name, role, initials, color, approved from madar_users where id=$1 and active=true and approved=true', [parsed.id]);
  return result.rows[0] || null;
}
function isManager(user) { return user?.role === 'المدير'; }
async function requireUser(req, res) {
  const user = await auth(req);
  if (!user) { json(res, 401, { error: 'سجّل دخولك الأول' }); return null; }
  return user;
}
async function transaction(fn) {
  const client = await db().connect();
  try { await client.query('begin'); const result = await fn(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
async function seedPublicLeadsOnce(version = 'whatsapp-public-leads-2026-10-16-v1', leadFilter = () => true) {
  await transaction(async client => {
    await client.query(`create table if not exists public.madar_seed_imports (
      version text primary key,
      applied_at timestamptz not null default now()
    )`);
    await client.query('alter table public.madar_seed_imports enable row level security');
    await client.query('revoke all on public.madar_seed_imports from public');
    await client.query('select pg_advisory_xact_lock($1)', [731926042]);
    const marked = await client.query('insert into public.madar_seed_imports(version) values($1) on conflict(version) do nothing returning version', [version]);
    if (!marked.rowCount) return;
    const seenNumbers = new Set((await client.query('select whatsapp_number from madar_leads')).rows.map(row => row.whatsapp_number));
    for (const lead of seedLeads) {
      if (!leadFilter(lead)) continue;
      const digits = digitsFromWhatsApp(lead?.whatsapp);
      if (!digits || seenNumbers.has(digits)) continue;
      const { owner, ...payload } = lead;
      payload.phones = `واتساب: +${digits}`;
      const inserted = await client.query(`insert into madar_leads(id,payload,owner_id,whatsapp_number)
        select $1,$2,null,$3 where not exists(select 1 from madar_leads where whatsapp_number=$3)
        on conflict(id) do nothing returning whatsapp_number`, [String(lead.id), payload, digits]);
      if (inserted.rowCount) seenNumbers.add(digits);
    }
  });
}
function cleanPath(url) { return decodeURIComponent(new URL(url, 'https://madar.invalid').pathname).replace(/\/$/, ''); }
function csrfCheck(req, res) {
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) { json(res, 403, { error: 'الطلب مرفوض' }); return false; }
  return true;
}
async function writeRows(client, table, rows, user, kind) {
  if (!Array.isArray(rows)) return;
  for (const item of rows.slice(0, 5000)) {
    if (!item?.id) continue;
    if (kind === 'leads') {
      if (!validWhatsAppLead(item)) continue;
      if (!isManager(user) && item.owner !== user.id) continue;
      const owner = isManager(user) ? (item.owner || null) : user.id;
      const result = await client.query('select owner_id from madar_leads where id=$1 for update', [String(item.id)]);
      if (!isManager(user) && result.rows.length && result.rows[0].owner_id !== user.id) continue;
      if (isManager(user) && owner && !(await client.query("select 1 from madar_users where id=$1 and role='سيلز' and active=true", [owner])).rowCount) continue;
      const payload = { ...item }; delete payload.owner;
      payload.phones = `واتساب: +${digitsFromWhatsApp(item.whatsapp)}`;
      await client.query('insert into madar_leads(id,payload,owner_id,whatsapp_number) values($1,$2,$3,$4) on conflict(id) do update set payload=excluded.payload, owner_id=excluded.owner_id, whatsapp_number=excluded.whatsapp_number', [String(item.id), payload, owner, digitsFromWhatsApp(item.whatsapp)]);
    } else {
      const ownerId = isManager(user) ? (item.userId || item.owner || null) : user.id;
      if (!isManager(user)) {
        const ownerColumn = kind === 'activities' ? 'user_id' : 'owner_id';
        const found = await client.query(`select ${ownerColumn} as owner_id from ${table} where id=$1`, [String(item.id)]);
        if (found.rowCount ? found.rows[0].owner_id !== user.id : ownerId !== user.id) continue;
      }
      if (kind === 'activities') await client.query('insert into madar_activities(id,payload,user_id,lead_id) values($1,$2,$3,$4) on conflict(id) do update set payload=excluded.payload,user_id=excluded.user_id,lead_id=excluded.lead_id', [String(item.id), item, ownerId, item.leadId || null]);
      else await client.query(`insert into ${table}(id,payload,owner_id) values($1,$2,$3) on conflict(id) do update set payload=excluded.payload,owner_id=excluded.owner_id`, [String(item.id), item, ownerId]);
    }
  }
}

export default async function handler(req, res) {
  const path = cleanPath(req.url);
  const method = req.method || 'GET';
  if (method !== 'GET' && !csrfCheck(req, res)) return;
  try {
    if (method === 'GET' && path === '/api/bootstrap') {
      const result = await db().query('select exists(select 1 from madar_users where role=$1 and active=true) as ready', ['المدير']);
      return json(res, 200, { setupRequired: !result.rows[0].ready });
    }
    if (method === 'POST' && path === '/api/setup') {
      const data = await body(req); const name = String(data.name || '').trim(); const username = String(data.username || '').trim().toLowerCase(); const password = String(data.password || '');
      if (!name || !/^[a-zA-Z0-9_.@-]{3,48}$/.test(username) || password.length < 12) return json(res, 400, { error: 'اكتب اسم مستخدم صالحًا وكلمة مرور من ١٢ حرفًا على الأقل' });
      const user = await transaction(async client => {
        await client.query('select pg_advisory_xact_lock(731926041)');
        if ((await client.query('select 1 from madar_users where role=$1 and active=true limit 1', ['المدير'])).rowCount) throw Object.assign(new Error('تم إعداد حساب المدير بالفعل'), { status: 409 });
        const secretPair = await passwordHash(password);
        const insert = await client.query("insert into madar_users(username,name,role,initials,color,password_salt,password_hash,approved) values($1,$2,'المدير',$3,'#4ccfc1',$4,$5,true) returning id,username,name,role,initials,color,approved", [username, name, name.slice(0,1), secretPair.salt, secretPair.hash]);
        await client.query('insert into madar_settings(id,target,banner) values(1,250000,true) on conflict(id) do nothing');
        for (const lead of seedLeads) {
          if (!validWhatsAppLead(lead)) continue;
          const { owner, ...payload } = lead;
          await client.query('insert into madar_leads(id,payload,owner_id,whatsapp_number) values($1,$2,null,$3) on conflict(id) do nothing', [String(lead.id), payload, digitsFromWhatsApp(lead.whatsapp)]);
        }
        return insert.rows[0];
      });
      return setSession(res, user);
    }
    if (method === 'POST' && path === '/api/register') {
      const data = await body(req); const name = String(data.name || '').trim(); const username = String(data.username || '').trim().toLowerCase(); const password = String(data.password || '');
      if (name.length < 2 || name.length > 80 || !/^[a-zA-Z0-9_.@-]{3,48}$/.test(username) || password.length < 12 || password.length > 256) return json(res, 400, { error: 'اكتب اسمك واسم مستخدم صالحًا وكلمة مرور من ١٢ حرفًا على الأقل' });
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const key = `register:${crypto.createHash('sha256').update(ip).digest('hex')}`;
      const limit = await db().query(`insert into madar_login_attempts(key,failures,locked_until) values($1,1,null)
        on conflict(key) do update set failures=case when madar_login_attempts.window_started < now()-interval '15 minutes' then 1 else madar_login_attempts.failures+1 end,
        window_started=case when madar_login_attempts.window_started < now()-interval '15 minutes' then now() else madar_login_attempts.window_started end,
        locked_until=case when (case when madar_login_attempts.window_started < now()-interval '15 minutes' then 1 else madar_login_attempts.failures+1 end)>5 then now()+interval '15 minutes' else null end
        returning failures,locked_until`, [key]);
      if (limit.rows[0].failures > 5 || limit.rows[0].locked_until > new Date()) return json(res, 429, { error: 'طلبات تسجيل كثيرة من نفس الشبكة. جرّب بعد ١٥ دقيقة.' });
      const secretPair = await passwordHash(password);
      try {
        const result = await db().query("insert into madar_users(username,name,role,initials,color,password_salt,password_hash,active,approved) values($1,$2,'سيلز',$3,$4,$5,$6,true,false) returning id,username,name,role,initials,color,approved", [username, name, name.slice(0,1), ['#58d6a3','#a78bfa','#64a7ff','#f1a978'][Math.floor(Math.random()*4)], secretPair.salt, secretPair.hash]);
        return json(res, 201, { pendingApproval: true, user: cleanUser(result.rows[0]) });
      } catch (error) { if (error.code === '23505') return json(res, 409, { error: 'اسم المستخدم مستخدم بالفعل' }); throw error; }
    }
    if (method === 'POST' && path === '/api/login') {
      const data = await body(req); const username = String(data.username || '').trim().toLowerCase(); const password = String(data.password || '');
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
      const key = crypto.createHash('sha256').update(`${ip}|${username}`).digest('hex');
      const blocked = await db().query('select locked_until from madar_login_attempts where key=$1 and locked_until>now()', [key]);
      if (blocked.rowCount) return json(res, 429, { error: 'محاولات دخول كثيرة. جرّب بعد ١٥ دقيقة.' });
      const found = await db().query('select id,username,name,role,initials,color,approved,password_salt,password_hash from madar_users where username=$1 and active=true', [username]);
      const hash = found.rowCount ? await passwordHash(password, found.rows[0].password_salt) : null;
      if (!found.rowCount || !eqHex(hash.hash, found.rows[0].password_hash)) {
        await db().query(`insert into madar_login_attempts(key,failures,locked_until) values($1,1,null)
          on conflict(key) do update set failures=case when madar_login_attempts.window_started < now()-interval '15 minutes' then 1 else madar_login_attempts.failures+1 end,
          window_started=case when madar_login_attempts.window_started < now()-interval '15 minutes' then now() else madar_login_attempts.window_started end,
          locked_until=case when (case when madar_login_attempts.window_started < now()-interval '15 minutes' then 1 else madar_login_attempts.failures+1 end)>=8 then now()+interval '15 minutes' else null end`, [key]);
        return json(res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحين' });
      }
      await db().query('delete from madar_login_attempts where key=$1', [key]);
      if (!found.rows[0].approved) return json(res, 403, { error: 'طلبك وصل للمدير. هتقدر تدخل بعد ما يوافق على حسابك.' });
      return setSession(res, found.rows[0]);
    }
    if (method === 'POST' && path === '/api/logout') {
      res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.VERCEL ? '; Secure' : ''}`);
      return json(res, 200, { ok: true });
    }
    if (method === 'GET' && path === '/api/session') {
      const user = await auth(req); return user ? json(res, 200, { user: cleanUser(user) }) : json(res, 401, { error: 'انتهت الجلسة' });
    }
    const user = await requireUser(req, res); if (!user) return;
    if (method === 'GET' && path === '/api/state') {
      const manager = isManager(user);
      if (manager) {
        await seedPublicLeadsOnce();
        await seedPublicLeadsOnce('whatsapp-public-suppliers-2026-10-17-v1', lead => {
          const batch = Number(String(lead?.id || '').replace('BWA-2026-', ''));
          return Number.isInteger(batch) && batch >= 67 && batch <= 98;
        });
        await seedPublicLeadsOnce('whatsapp-public-maps-leads-2026-10-18-v1', lead => {
          const batch = Number(String(lead?.id || '').replace('BWA-2026-', ''));
          return Number.isInteger(batch) && batch >= 99 && batch <= 126;
        });
        await seedPublicLeadsOnce('whatsapp-public-maps-leads-2026-10-20-v1', lead => {
          const batch = Number(String(lead?.id || '').replace('BWA-2026-', ''));
          return Number.isInteger(batch) && batch >= 127 && batch <= 141;
        });
        await seedPublicLeadsOnce('whatsapp-automotive-leads-2026-10-20-v1', lead => {
          const batch = Number(String(lead?.id || '').replace('BWA-2026-', ''));
          return Number.isInteger(batch) && batch >= 142 && batch <= 153;
        });
        await seedPublicLeadsOnce('whatsapp-automotive-leads-2026-10-20-v2', lead => {
          const batch = Number(String(lead?.id || '').replace('BWA-2026-', ''));
          return Number.isInteger(batch) && batch >= 154 && batch <= 203;
        });
      }
      const [team, leads, activities, offers, projects, settings] = await Promise.all([
        db().query(manager ? 'select id,username,name,role,initials,color,approved from madar_users where active=true order by created_at' : 'select id,username,name,role,initials,color,approved from madar_users where id=$1 and active=true and approved=true', manager ? [] : [user.id]),
        db().query(manager ? 'select id,payload,owner_id from madar_leads order by created_at desc' : 'select id,payload,owner_id from madar_leads where owner_id is null or owner_id=$1 order by created_at desc', manager ? [] : [user.id]),
        db().query(manager ? 'select id,payload,user_id from madar_activities order by created_at desc limit 5000' : 'select id,payload,user_id from madar_activities where user_id=$1 order by created_at desc limit 5000', manager ? [] : [user.id]),
        db().query(manager ? 'select id,payload,owner_id from madar_offers order by created_at desc' : 'select id,payload,owner_id from madar_offers where owner_id=$1 order by created_at desc', manager ? [] : [user.id]),
        db().query(manager ? 'select id,payload,owner_id from madar_projects order by created_at desc' : 'select id,payload,owner_id from madar_projects where owner_id=$1 order by created_at desc', manager ? [] : [user.id]),
        db().query('select target,banner from madar_settings where id=1')
      ]);
      const mapOwned = rows => rows.map(row => ({ ...row.payload, id: row.id, owner: row.owner_id || '' }));
      return json(res, 200, { user: cleanUser(user), team: team.rows.map(cleanUser), leads: leads.rows.map(cleanLead), activities: activities.rows.map(row => ({ ...row.payload, id: row.id, userId: row.user_id })), offers: mapOwned(offers.rows), projects: mapOwned(projects.rows), target: manager ? (settings.rows[0]?.target || 0) : 0, banner: settings.rows[0]?.banner ?? true });
    }
    if (method === 'POST' && path === '/api/users') {
      if (!isManager(user)) return json(res, 403, { error: 'الصلاحية دي للمدير فقط' });
      const data = await body(req);
      if (data.action === 'approve' || data.action === 'reject') {
        const id = String(data.id || '');
        const approved = data.action === 'approve';
        const result = approved
          ? await db().query("update madar_users set approved=true where id=$1 and role='سيلز' and active=true and approved=false returning id", [id])
          : await db().query("update madar_users set active=false where id=$1 and role='سيلز' and active=true and approved=false returning id", [id]);
        return result.rowCount ? json(res, 200, { ok: true }) : json(res, 404, { error: 'طلب الحساب غير موجود أو تم التعامل معه' });
      }
      const name = String(data.name || '').trim(); const username = String(data.username || '').trim().toLowerCase(); const password = String(data.password || '');
      if (!name || !/^[a-zA-Z0-9_.@-]{3,48}$/.test(username) || password.length < 12) return json(res, 400, { error: 'اسم المستخدم مطلوب وكلمة المرور ١٢ حرفًا على الأقل' });
      const secretPair = await passwordHash(password);
      try {
        const result = await db().query("insert into madar_users(username,name,role,initials,color,password_salt,password_hash) values($1,$2,'سيلز',$3,$4,$5,$6) returning id,username,name,role,initials,color", [username, name, name.slice(0,1), ['#58d6a3','#a78bfa','#64a7ff','#f1a978'][Math.floor(Math.random()*4)], secretPair.salt, secretPair.hash]);
        return json(res, 201, { user: cleanUser(result.rows[0]) });
      } catch (error) { if (error.code === '23505') return json(res, 409, { error: 'اسم المستخدم مستخدم بالفعل' }); throw error; }
    }
    if (method === 'DELETE' && path.startsWith('/api/users/')) {
      if (!isManager(user)) return json(res, 403, { error: 'الصلاحية دي للمدير فقط' });
      const id = path.slice('/api/users/'.length);
      await transaction(async client => {
        const target = await client.query("update madar_users set active=false where id=$1 and role='سيلز' and active=true", [id]);
        if (!target.rowCount) throw Object.assign(new Error('حساب السيلز غير موجود'), { status: 404 });
        await client.query('update madar_leads set owner_id=null where owner_id=$1', [id]);
      });
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/leads/claim') {
      if (user.role !== 'سيلز') return json(res, 403, { error: 'استلام العميل متاح لحسابات السيلز فقط' });
      const data = await body(req);
      const claimed = await transaction(async client => {
        const row = await client.query('update madar_leads set owner_id=$2 where id=$1 and owner_id is null returning id,payload,owner_id', [String(data.id || ''), user.id]);
        if (!row.rowCount) return { row: null, exists: await client.query('select owner_id from madar_leads where id=$1', [String(data.id || '')]) };
        const lead = cleanLead(row.rows[0]);
        const activity = { id: crypto.randomUUID(), kind: 'assign', title: `استلام عميل: ${lead.name}`, detail: `أصبح العميل ضمن متابعة ${user.name}`, leadId: lead.id, userId: user.id, at: new Date().toISOString() };
        await client.query('insert into madar_activities(id,payload,user_id,lead_id) values($1,$2,$3,$4)', [activity.id, activity, user.id, lead.id]);
        return { row: row.rows[0] };
      });
      if (!claimed.row) return claimed.exists.rowCount ? json(res, 409, { error: claimed.exists.rows[0].owner_id === user.id ? 'العميل ضمن قائمتك بالفعل' : 'العميل استلمه فرد آخر من السيلز' }) : json(res, 404, { error: 'العميل غير موجود' });
      return json(res, 200, { ok: true, lead: cleanLead(claimed.row) });
    }
    if (method === 'DELETE' && path.startsWith('/api/leads/')) {
      const id = path.slice('/api/leads/'.length);
      const result = await db().query(isManager(user) ? 'delete from madar_leads where id=$1 returning id' : 'delete from madar_leads where id=$1 and owner_id=$2 returning id', isManager(user) ? [id] : [id, user.id]);
      return result.rowCount ? json(res, 200, { ok: true }) : json(res, 404, { error: 'العميل غير موجود أو لا تملك صلاحية حذفه' });
    }
    if (method === 'POST' && path === '/api/password') {
      const data = await body(req); const result = await db().query('select password_salt,password_hash from madar_users where id=$1 and active=true', [user.id]);
      const current = await passwordHash(String(data.currentPassword || ''), result.rows[0].password_salt);
      if (!eqHex(current.hash, result.rows[0].password_hash)) return json(res, 401, { error: 'كلمة المرور الحالية غير صحيحة' });
      const next = String(data.newPassword || ''); if (next.length < 12) return json(res, 400, { error: 'كلمة المرور الجديدة لازم تكون ١٢ حرفًا على الأقل' });
      const pair = await passwordHash(next); await db().query('update madar_users set password_salt=$2,password_hash=$3 where id=$1', [user.id,pair.salt,pair.hash]);
      return json(res, 200, { ok: true });
    }
    if (method === 'PUT' && path === '/api/state') {
      const data = await body(req); const manager = isManager(user);
      await transaction(async client => {
        await writeRows(client, 'madar_leads', data.leads, user, 'leads');
        await writeRows(client, 'madar_activities', data.activities, user, 'activities');
        await writeRows(client, 'madar_offers', data.offers, user, 'offers');
        await writeRows(client, 'madar_projects', data.projects, user, 'projects');
        if (manager) {
          if (Number.isFinite(Number(data.target))) await client.query('insert into madar_settings(id,target,banner) values(1,$1,$2) on conflict(id) do update set target=excluded.target,banner=excluded.banner', [Math.max(0, Number(data.target)), typeof data.banner === 'boolean' ? data.banner : true]);
          if (Array.isArray(data.leads)) {
            const validOwners = await client.query("select id from madar_users where role='سيلز' and active=true"); const ids = new Set(validOwners.rows.map(x => x.id));
            for (const lead of data.leads) if (lead?.owner && !ids.has(lead.owner)) await client.query('update madar_leads set owner_id=null where id=$1', [String(lead.id)]);
          }
        }
      });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'الطلب غير معروف' });
  } catch (error) {
    if (error.status) return json(res, error.status, { error: error.message });
    console.error('Madar API error:', error);
    const message = error.message === 'DATABASE_URL is not configured' || error.message.startsWith('SESSION_SECRET') ? 'إعدادات الخادم غير مكتملة؛ راجع ملف الإعداد.' : 'حصل خطأ داخلي في النظام';
    return json(res, 500, { error: message });
  }
}
