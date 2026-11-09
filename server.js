'use strict';

/**
 * HaloDesk Live Chat
 * Server ringan tanpa dependency (Node.js built-in saja).
 * - Website pelanggan : /
 * - Panel admin       : /LivechatAdmin
 * - Realtime          : Server-Sent Events (SSE)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'chats.json');
const AUTH_FILE = path.join(DATA_DIR, 'admin-auth.json');
const GENERATED_PASSWORD_FILE = path.join(DATA_DIR, 'ADMIN-PASSWORD.txt');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NAME_LENGTH = 50;
const MAX_MESSAGES_PER_CHAT = 1500;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const UPLOAD_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/ogg': '.ogv',
};
const MIME_BY_UPLOAD_EXT = Object.fromEntries(
  Object.entries(UPLOAD_TYPES).map(([type, ext]) => [ext.slice(1), type])
);

const ADMIN_PASSWORD_ENV = typeof process.env.ADMIN_PASSWORD === 'string'
  ? process.env.ADMIN_PASSWORD
  : '';
const SESSION_COOKIE = 'halodesk_admin';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // sesi tamat selepas 12 jam tidak aktif
const SESSION_MAX_MS = 24 * 60 * 60 * 1000; // had mutlak 24 jam
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const STATIC_FILES = new Set([
  '/styles.css',
  '/admin.css',
  '/app.js',
  '/admin.js',
  '/favicon.svg',
]);

// ---------------------------------------------------------------------------
// Penyimpanan data
// ---------------------------------------------------------------------------

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function normalizeAttachment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = typeof raw.url === 'string' ? raw.url : '';
  if (!/^\/uploads\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(url)) return null;
  const type = typeof raw.type === 'string' ? raw.type.slice(0, 100) : '';
  const kind = raw.kind === 'video' ? 'video' : 'image';
  return {
    url,
    type,
    kind,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : 'Fail',
    size: Math.max(0, Number(raw.size) || 0),
  };
}

function normalizeChat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return null;

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .filter(
          (message) =>
            message &&
            (typeof message.text === 'string' || normalizeAttachment(message.attachment))
        )
        .map((message) => ({
          id: typeof message.id === 'string' ? message.id : crypto.randomUUID(),
          sender: ['visitor', 'admin', 'system'].includes(message.sender)
            ? message.sender
            : 'visitor',
          text:
            typeof message.text === 'string'
              ? message.text.slice(0, MAX_MESSAGE_LENGTH)
              : '',
          attachment: normalizeAttachment(message.attachment),
          createdAt: isValidDate(message.createdAt)
            ? message.createdAt
            : new Date().toISOString(),
        }))
        .filter((message) => message.text || message.attachment)
        .slice(-MAX_MESSAGES_PER_CHAT)
    : [];

  const createdAt = isValidDate(raw.createdAt)
    ? raw.createdAt
    : messages[0]?.createdAt || new Date().toISOString();

  return {
    id,
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, MAX_NAME_LENGTH)
        : 'Tamu',
    createdAt,
    updatedAt: isValidDate(raw.updatedAt)
      ? raw.updatedAt
      : messages[messages.length - 1]?.createdAt || createdAt,
    lastSeen: isValidDate(raw.lastSeen) ? raw.lastSeen : createdAt,
    status: raw.status === 'closed' ? 'closed' : 'open',
    unreadAdmin: Math.max(0, Number(raw.unreadAdmin) || 0),
    unreadVisitor: Math.max(0, Number(raw.unreadVisitor) || 0),
    messages,
  };
}

function isValidDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function loadChats() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(parsed?.chats)) return [];
    return parsed.chats.map(normalizeChat).filter(Boolean);
  } catch (error) {
    console.error('[storage] Gagal membaca data, memulakan storan kosong:', error.message);
    return [];
  }
}

let chats = loadChats();
let saveTimer = null;

function saveChatsNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const payload = JSON.stringify(
    { version: 1, savedAt: new Date().toISOString(), chats },
    null,
    2
  );
  const temporaryFile = `${DATA_FILE}.tmp`;

  try {
    fs.writeFileSync(temporaryFile, payload, 'utf8');
    fs.renameSync(temporaryFile, DATA_FILE);
    return;
  } catch (error) {
    console.error('[storage] Gagal menyimpan secara atomik:', error.message);
  }

  // Fallback Windows: fail sementara mungkin dikunci oleh antivirus/editor.
  try {
    fs.writeFileSync(DATA_FILE, payload, 'utf8');
    console.warn('[storage] Data disimpan terus ke fail utama.');
  } catch (error) {
    console.error('[storage] Gagal menyimpan data:', error.message);
  }
}

function saveChatsSoon() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveChatsNow, 120);
}

// ---------------------------------------------------------------------------
// Pengesahan admin
// ---------------------------------------------------------------------------

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** @type {{salt: string, hash: string, temporary: boolean, updatedAt: string} | null} */
let adminAuthRecord = null;
let adminAuthFromEnv = ADMIN_PASSWORD_ENV.length > 0;

/** @type {Map<string, {createdAt: number, lastSeen: number}>} */
const adminSessions = new Map();
/** @type {Map<string, {count: number, firstAt: number, blockedUntil: number}>} */
const loginAttempts = new Map();

function scryptPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a), 'hex');
    const right = Buffer.from(String(b), 'hex');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function loadAuthRecord() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    if (!parsed || typeof parsed.salt !== 'string' || typeof parsed.hash !== 'string') {
      return null;
    }
    return {
      salt: parsed.salt,
      hash: parsed.hash,
      temporary: Boolean(parsed.temporary),
      updatedAt: isValidDate(parsed.updatedAt) ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch (error) {
    console.error('[auth] Gagal membaca fail kata laluan admin:', error.message);
    return null;
  }
}

function saveAuthRecord(record) {
  const temporaryFile = `${AUTH_FILE}.tmp`;
  fs.writeFileSync(
    temporaryFile,
    JSON.stringify({ version: 1, ...record }, null, 2),
    { encoding: 'utf8', mode: 0o600 }
  );
  fs.renameSync(temporaryFile, AUTH_FILE);
}

function generatePassword(length = 16) {
  let password = '';
  for (let i = 0; i < length; i += 1) {
    password += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}

function initAdminAuth() {
  if (adminAuthFromEnv) {
    console.log('  Auth admin: menggunakan ADMIN_PASSWORD dari environment.');
    return;
  }

  const existing = loadAuthRecord();
  if (existing) {
    adminAuthRecord = existing;
    console.log('  Auth admin: password dimuatkan dari data/admin-auth.json.');
    return;
  }

  const password = generatePassword();
  const { salt, hash } = scryptPassword(password);
  adminAuthRecord = {
    salt,
    hash,
    temporary: true,
    updatedAt: new Date().toISOString(),
  };
  saveAuthRecord(adminAuthRecord);

  const content = [
    'HaloDesk Live Chat — Kata Laluan Admin',
    '===================================',
    '',
    `Kata laluan : ${password}`,
    `Dijana      : ${new Date().toISOString()}`,
    '',
    'Simpan kata laluan ini di tempat selamat, kemudian padam fail ini.',
    'Tukar kata laluan melalui butang "Tukar kata laluan" dalam panel admin.',
    'Fail ini akan dipadam secara automatik selepas kata laluan ditukar.',
    '',
  ].join('\r\n');

  try {
    fs.writeFileSync(GENERATED_PASSWORD_FILE, content, { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    console.error('[auth] Gagal menulis fail password:', error.message);
  }

  console.log('');
  console.log('  +----------------------------------------------------+');
  console.log('  |  KATA LALUAN ADMIN DIJANA AUTOMATIK               |');
  console.log(`  |  ${password.padEnd(50)}|`);
  console.log('  |  Disimpan dalam data/ADMIN-PASSWORD.txt            |');
  console.log('  |  Tukar selepas log masuk pertama.                  |');
  console.log('  +----------------------------------------------------+');
  console.log('');
}

function verifyAdminPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return false;

  if (adminAuthFromEnv) {
    const left = crypto.createHash('sha256').update(password).digest();
    const right = crypto.createHash('sha256').update(ADMIN_PASSWORD_ENV).digest();
    return crypto.timingSafeEqual(left, right);
  }

  if (!adminAuthRecord) return false;
  const { hash } = scryptPassword(password, adminAuthRecord.salt);
  return safeEqualHex(hash, adminAuthRecord.hash);
}

function parseCookies(header) {
  const cookies = new Map();
  if (typeof header !== 'string' || !header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

function isSecureRequest(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return proto === 'https';
}

function sessionCookie(req, token, maxAgeSeconds) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearSessionCookie(req) {
  return sessionCookie(req, '', 0);
}

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  adminSessions.set(token, { createdAt: now, lastSeen: now });
  return token;
}

function getAdminSession(req) {
  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
  if (!token) return null;

  const session = adminSessions.get(token);
  if (!session) return null;

  const now = Date.now();
  if (now - session.lastSeen > SESSION_TTL_MS || now - session.createdAt > SESSION_MAX_MS) {
    adminSessions.delete(token);
    return null;
  }

  session.lastSeen = now;
  return { token, createdAt: session.createdAt, lastSeen: session.lastSeen };
}

function requireAdmin(req, res) {
  const session = getAdminSession(req);
  if (session) return session;
  sendError(res, 401, 'Sesi admin tidak sah. Sila log masuk semula.');
  return null;
}

function clientIp(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function checkLoginRate(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return { blocked: false, retryAfter: 0 };

  if (entry.blockedUntil > now) {
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { blocked: false, retryAfter: 0 };
  }

  return { blocked: false, retryAfter: 0 };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);

  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    entry = { count: 0, firstAt: now, blockedUntil: 0 };
  }

  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.blockedUntil = now + LOGIN_BLOCK_MS;
    entry.count = 0;
    entry.firstAt = now;
  }
  loginAttempts.set(ip, entry);
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

const authCleanup = setInterval(() => {
  const now = Date.now();
  for (const [token, session] of adminSessions) {
    if (now - session.lastSeen > SESSION_TTL_MS || now - session.createdAt > SESSION_MAX_MS) {
      adminSessions.delete(token);
    }
  }
  for (const [ip, entry] of loginAttempts) {
    const expired = entry.blockedUntil ? entry.blockedUntil <= now : now - entry.firstAt > LOGIN_WINDOW_MS;
    if (expired) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000);
authCleanup.unref();

initAdminAuth();

// ---------------------------------------------------------------------------
// Realtime clients
// ---------------------------------------------------------------------------

/** @type {Set<import('node:http').ServerResponse>} */
const adminClients = new Set();
/** @type {Map<string, Set<import('node:http').ServerResponse>>} */
const visitorClients = new Map();

function sseWrite(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Sambungan sudah tertutup; pembersihan dilakukan oleh listener "close".
  }
}

function broadcastAdmin(event, data) {
  for (const client of adminClients) sseWrite(client, event, data);
}

function broadcastVisitors(event, data, onlyChatId = null) {
  if (onlyChatId) {
    const clients = visitorClients.get(onlyChatId);
    if (!clients) return;
    for (const client of clients) sseWrite(client, event, data);
    return;
  }

  for (const clients of visitorClients.values()) {
    for (const client of clients) sseWrite(client, event, data);
  }
}

function isVisitorOnline(chatId) {
  return (visitorClients.get(chatId)?.size || 0) > 0;
}

function withPresence(chat) {
  return {
    ...chat,
    online: isVisitorOnline(chat.id),
    adminOnline: adminClients.size > 0,
  };
}

function broadcastChat(chat) {
  const payload = { chat: withPresence(chat) };
  broadcastAdmin('conversation', payload);
  broadcastVisitors('conversation', payload, chat.id);
}

function broadcastPresence(chatId) {
  broadcastAdmin('presence', {
    chatId,
    online: isVisitorOnline(chatId),
  });
}

function broadcastAdminPresence() {
  broadcastVisitors('presence', {
    adminOnline: adminClients.size > 0,
  });
}

const heartbeat = setInterval(() => {
  for (const client of adminClients) {
    try {
      client.write(': ping\n\n');
    } catch {
      // Abaikan; listener close akan membersihkan.
    }
  }
  for (const clients of visitorClients.values()) {
    for (const client of clients) {
      try {
        client.write(': ping\n\n');
      } catch {
        // Abaikan.
      }
    }
  }
}, 25_000);
heartbeat.unref();

// ---------------------------------------------------------------------------
// Utiliti HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;

    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += Buffer.byteLength(chunk);
      if (size > limit) {
        tooLarge = true;
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('Payload terlalu besar.'), { status: 413 }));
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('JSON tidak valid.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function readBodyBuffer(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        return reject(
          Object.assign(new Error('Fail terlalu besar. Maksimum 25 MB.'), { status: 413 })
        );
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, maxLength);
}

function makeSystemMessage(text) {
  return {
    id: crypto.randomUUID(),
    sender: 'system',
    text,
    createdAt: new Date().toISOString(),
  };
}

function findChat(chatId) {
  return chats.find((chat) => chat.id === chatId);
}

function publicChat(chat) {
  return withPresence(chat);
}

function serveFile(res, filename, contentType) {
  const filePath = path.join(PUBLIC_DIR, filename);
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendError(res, 404, 'Fail tidak ditemui.');
    res.writeHead(200, {
      'Content-Type': contentType || MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveStatic(res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, 'index.html');
  }

  const lower = pathname.toLowerCase().replace(/\/+$/, '');
  if (lower === '/livechatadmin') {
    return serveFile(res, 'admin.html');
  }

  if (STATIC_FILES.has(pathname)) {
    return serveFile(res, pathname.slice(1));
  }

  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>
<html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 — HaloDesk</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f2f7f4;color:#14251f;font-family:system-ui,sans-serif}main{text-align:center;padding:32px}a{color:#0c895f;font-weight:700;text-decoration:none}span{display:block;font-size:5rem;font-weight:800;color:#bcd9cc;line-height:1}</style>
</head><body><main><span>404</span><h1>Halaman tidak ditemui</h1><p><a href="/">Kembali ke sembang langsung</a></p></main></body></html>`);
}

function serveUpload(req, res, pathname) {
  const name = pathname.slice('/uploads/'.length);
  if (!/^[A-Za-z0-9-]+\.[a-z0-9]+$/.test(name)) {
    return sendError(res, 404, 'Fail tidak ditemui.');
  }

  const filePath = path.join(UPLOAD_DIR, name);
  const ext = path.extname(name).slice(1).toLowerCase();
  const contentType = MIME_BY_UPLOAD_EXT[ext] || 'application/octet-stream';

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) return sendError(res, 404, 'Fail tidak ditemui.');

    const headers = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    };

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
      if (match) {
        let start = match[1] === '' ? null : Number(match[1]);
        let end = match[2] === '' ? null : Number(match[2]);

        if (start === null && end !== null) {
          start = Math.max(0, stats.size - end);
          end = stats.size - 1;
        } else if (start !== null && end === null) {
          end = stats.size - 1;
        }

        if (
          start !== null &&
          end !== null &&
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start <= end &&
          start < stats.size
        ) {
          end = Math.min(end, stats.size - 1);
          headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
          headers['Content-Length'] = end - start + 1;
          res.writeHead(206, headers);
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(filePath, { start, end }).pipe(res);
        }

        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        return res.end();
      }
    }

    headers['Content-Length'] = stats.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------------------------------------------------------------------------
// Route API
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method || 'GET';

  if (pathname === '/api/health' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      service: 'HaloDesk Live Chat',
      time: new Date().toISOString(),
      chats: chats.length,
      adminOnline: adminClients.size > 0,
    });
  }

  // ----- Pengesahan admin -------------------------------------------------

  if (pathname === '/api/admin/session' && method === 'GET') {
    const session = getAdminSession(req);
    return sendJson(res, 200, {
      authenticated: Boolean(session),
      authMode: adminAuthFromEnv ? 'env' : 'stored',
      temporary: Boolean(session && !adminAuthFromEnv && adminAuthRecord?.temporary),
    });
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    const ip = clientIp(req);
    const rate = checkLoginRate(ip);
    if (rate.blocked) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      return sendError(res, 429, 'Terlalu banyak percubaan. Sila cuba lagi kemudian.');
    }

    const body = await readJsonBody(req);
    const password = typeof body.password === 'string' ? body.password : '';

    if (!password) return sendError(res, 400, 'Kata laluan tidak boleh kosong.');

    if (!verifyAdminPassword(password)) {
      recordLoginFailure(ip);
      await new Promise((resolve) => setTimeout(resolve, 180));
      return sendError(res, 401, 'Kata laluan salah.');
    }

    clearLoginFailures(ip);
    const token = createAdminSession();
    res.setHeader('Set-Cookie', sessionCookie(req, token, Math.floor(SESSION_MAX_MS / 1000)));
    return sendJson(res, 200, {
      ok: true,
      authenticated: true,
      authMode: adminAuthFromEnv ? 'env' : 'stored',
      temporary: Boolean(!adminAuthFromEnv && adminAuthRecord?.temporary),
      expiresAt: new Date(Date.now() + SESSION_MAX_MS).toISOString(),
    });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (token) adminSessions.delete(token);
    res.setHeader('Set-Cookie', clearSessionCookie(req));
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/password' && method === 'POST') {
    if (!requireAdmin(req, res)) return;

    if (adminAuthFromEnv) {
      return sendError(
        res,
        400,
        'Kata laluan ditetapkan melalui ADMIN_PASSWORD. Tukar nilai tersebut dan mulakan semula pelayan.'
      );
    }

    const body = await readJsonBody(req);
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!verifyAdminPassword(currentPassword)) {
      return sendError(res, 400, 'Kata laluan semasa salah.');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return sendError(res, 400, `Kata laluan baharu mesti sekurang-kurangnya ${MIN_PASSWORD_LENGTH} aksara.`);
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return sendError(res, 400, `Kata laluan baharu tidak boleh melebihi ${MAX_PASSWORD_LENGTH} aksara.`);
    }
    if (newPassword === currentPassword) {
      return sendError(res, 400, 'Kata laluan baharu mesti berbeza daripada kata laluan semasa.');
    }

    const { salt, hash } = scryptPassword(newPassword);
    adminAuthRecord = {
      salt,
      hash,
      temporary: false,
      updatedAt: new Date().toISOString(),
    };
    try {
      saveAuthRecord(adminAuthRecord);
      if (fs.existsSync(GENERATED_PASSWORD_FILE)) fs.unlinkSync(GENERATED_PASSWORD_FILE);
    } catch (error) {
      console.error('[auth] Gagal menyimpan password baharu:', error.message);
      return sendError(res, 500, 'Gagal menyimpan kata laluan baharu.');
    }

    adminSessions.clear();
    res.setHeader('Set-Cookie', clearSessionCookie(req));
    return sendJson(res, 200, { ok: true, reauth: true });
  }

  // SSE — pelanggan
  if (pathname === '/api/events' && method === 'GET') {
    const role = searchParams.get('role');
    const chatId = searchParams.get('chatId');
    if (role === 'admin' && !requireAdmin(req, res)) return;
    return openEventStream(req, res, role, chatId);
  }

  // Buat sesi chat baru
  if (pathname === '/api/chats' && method === 'POST') {
    const body = await readJsonBody(req);
    const name = cleanText(body.name, MAX_NAME_LENGTH);
    if (!name) return sendError(res, 400, 'Nama tidak boleh kosong.');

    const now = new Date().toISOString();
    const chat = {
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      lastSeen: now,
      status: 'open',
      unreadAdmin: 0,
      unreadVisitor: 0,
      messages: [
        {
          id: crypto.randomUUID(),
          sender: 'admin',
          text: `Hai ${name}! 👋 Selamat datang ke HaloDesk. Ada yang boleh kami bantu hari ini?`,
          createdAt: now,
        },
      ],
    };

    chats.push(chat);
    saveChatsSoon();
    broadcastChat(chat);
    return sendJson(res, 201, { chat: publicChat(chat) });
  }

  // Admin — senarai semua perbualan
  if (pathname === '/api/admin/chats' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const sorted = [...chats].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    return sendJson(res, 200, {
      chats: sorted.map(publicChat),
      adminOnline: adminClients.size > 0,
    });
  }

  // GET chat tunggal
  const chatMatch = pathname.match(/^\/api\/chat\/([^/]+)$/);
  if (chatMatch && method === 'GET') {
    const chat = findChat(decodeURIComponent(chatMatch[1]));
    if (!chat) return sendError(res, 404, 'Perbualan tidak ditemui.');
    return sendJson(res, 200, { chat: publicChat(chat) });
  }

  // Hantar mesej
  const messageMatch = pathname.match(/^\/api\/chat\/([^/]+)\/messages$/);
  if (messageMatch && method === 'POST') {
    const chat = findChat(decodeURIComponent(messageMatch[1]));
    if (!chat) return sendError(res, 404, 'Perbualan tidak ditemui.');

    const body = await readJsonBody(req);
    const sender = body.sender === 'admin' ? 'admin' : body.sender === 'visitor' ? 'visitor' : null;
    const text = cleanText(body.text, MAX_MESSAGE_LENGTH);
    if (!sender) return sendError(res, 400, 'Pengirim tidak sah.');
    if (sender === 'admin' && !requireAdmin(req, res)) return;
    if (!text) return sendError(res, 400, 'Mesej tidak boleh kosong.');

    if (chat.status === 'closed') {
      return sendError(
        res,
        409,
        'Perbualan ini sudah ditutup. Buka semula sebelum menghantar mesej.'
      );
    }

    const now = new Date().toISOString();
    chat.messages.push({
      id: crypto.randomUUID(),
      sender,
      text,
      createdAt: now,
    });
    if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
      chat.messages = chat.messages.slice(-MAX_MESSAGES_PER_CHAT);
    }

    chat.updatedAt = now;
    chat.lastSeen = now;
    if (sender === 'visitor') {
      chat.unreadAdmin += 1;
      chat.unreadVisitor = 0;
    } else {
      chat.unreadVisitor += 1;
      chat.unreadAdmin = 0;
    }

    saveChatsSoon();
    broadcastChat(chat);
    return sendJson(res, 201, { chat: publicChat(chat) });
  }

  // Muat naik gambar / video
  const uploadMatch = pathname.match(/^\/api\/chat\/([^/]+)\/upload$/);
  if (uploadMatch && method === 'POST') {
    const chat = findChat(decodeURIComponent(uploadMatch[1]));
    if (!chat) return sendError(res, 404, 'Perbualan tidak ditemui.');

    const senderParam = searchParams.get('sender');
    const sender =
      senderParam === 'admin' ? 'admin' : senderParam === 'visitor' ? 'visitor' : null;
    if (!sender) return sendError(res, 400, 'Pengirim tidak sah.');
    if (sender === 'admin' && !requireAdmin(req, res)) return;

    if (chat.status === 'closed') {
      return sendError(
        res,
        409,
        'Perbualan ini sudah ditutup. Buka semula sebelum menghantar fail.'
      );
    }

    const contentType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const ext = UPLOAD_TYPES[contentType];
    if (!ext) {
      return sendError(
        res,
        415,
        'Jenis fail tidak disokong. Gunakan gambar (JPG, PNG, GIF, WEBP, AVIF) atau video (MP4, WEBM, MOV, OGG).'
      );
    }

    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return sendError(res, 413, 'Fail terlalu besar. Maksimum 25 MB.');
    }

    const buffer = await readBodyBuffer(req, MAX_UPLOAD_BYTES);
    if (!buffer.length) return sendError(res, 400, 'Fail kosong.');

    let rawName = String(req.headers['x-file-name'] || '');
    try {
      rawName = decodeURIComponent(rawName);
    } catch {
      // guna nama asal jika tidak dapat dinyahkod
    }
    const name =
      rawName
        .replace(/[\u0000-\u001F\u007F"\\/]/g, '')
        .trim()
        .slice(0, 120) || `Fail${ext}`;

    const storedName = `${crypto.randomUUID()}${ext}`;
    try {
      await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), buffer);
    } catch (error) {
      console.error('[upload] Gagal menyimpan fail:', error.message);
      return sendError(res, 500, 'Gagal menyimpan fail.');
    }

    const now = new Date().toISOString();
    const attachment = {
      url: `/uploads/${storedName}`,
      type: contentType,
      kind: contentType.startsWith('video/') ? 'video' : 'image',
      name,
      size: buffer.length,
    };

    chat.messages.push({
      id: crypto.randomUUID(),
      sender,
      text: '',
      attachment,
      createdAt: now,
    });
    if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
      chat.messages = chat.messages.slice(-MAX_MESSAGES_PER_CHAT);
    }

    chat.updatedAt = now;
    chat.lastSeen = now;
    if (sender === 'visitor') {
      chat.unreadAdmin += 1;
      chat.unreadVisitor = 0;
    } else {
      chat.unreadVisitor += 1;
      chat.unreadAdmin = 0;
    }

    saveChatsSoon();
    broadcastChat(chat);
    return sendJson(res, 201, { chat: publicChat(chat), attachment });
  }

  // Tanda sudah dibaca
  const readMatch = pathname.match(/^\/api\/chat\/([^/]+)\/read$/);
  if (readMatch && method === 'POST') {
    const chat = findChat(decodeURIComponent(readMatch[1]));
    if (!chat) return sendError(res, 404, 'Perbualan tidak ditemui.');

    const body = await readJsonBody(req);
    if (body.role === 'admin' && !requireAdmin(req, res)) return;
    let changed = false;
    if (body.role === 'admin' && chat.unreadAdmin !== 0) {
      chat.unreadAdmin = 0;
      changed = true;
    }
    if (body.role === 'visitor' && chat.unreadVisitor !== 0) {
      chat.unreadVisitor = 0;
      changed = true;
    }
    chat.lastSeen = new Date().toISOString();
    if (changed) {
      saveChatsSoon();
      broadcastChat(chat);
    }
    return sendJson(res, 200, { ok: true, chat: publicChat(chat) });
  }

  // Indikator sedang menaip
  const typingMatch = pathname.match(/^\/api\/chat\/([^/]+)\/typing$/);
  if (typingMatch && method === 'POST') {
    const chat = findChat(decodeURIComponent(typingMatch[1]));
    if (!chat) return sendError(res, 404, 'Perbualan tidak ditemui.');

    const body = await readJsonBody(req);
    const isTyping = Boolean(body.isTyping);
    if (body.role === 'admin' && !requireAdmin(req, res)) return;
    if (chat.status === 'closed') return sendJson(res, 200, { ok: true });
    if (body.role === 'visitor') {
      broadcastAdmin('typing', { chatId: chat.id, role: 'visitor', isTyping });
    } else if (body.role === 'admin') {
      broadcastVisitors('typing', { chatId: chat.id, role: 'admin', isTyping }, chat.id);
    }
    return sendJson(res, 200, { ok: true });
  }

  // Admin — ubah status / padam
  const adminChatMatch = pathname.match(/^\/api\/admin\/chats\/([^/]+)$/);
  if (adminChatMatch && method === 'PATCH') {
    if (!requireAdmin(req, res)) return;
    const chat = findChat(decodeURIComponent(adminChatMatch[1]));
    if (!chat) return sendError(res, 404, 'Perbualan tidak ditemui.');

    const body = await readJsonBody(req);
    if (body.status === 'open' || body.status === 'closed') {
      if (body.status !== chat.status) {
        chat.status = body.status;
        chat.updatedAt = new Date().toISOString();
        chat.messages.push(
          makeSystemMessage(
            body.status === 'closed'
              ? 'Perbualan ditandakan selesai oleh admin.'
              : 'Perbualan dibuka semula oleh admin.'
          )
        );
        if (body.status === 'closed') chat.unreadAdmin = 0;
        saveChatsSoon();
        broadcastChat(chat);
      }
    }
    return sendJson(res, 200, { chat: publicChat(chat) });
  }

  if (adminChatMatch && method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const chatId = decodeURIComponent(adminChatMatch[1]);
    const index = chats.findIndex((chat) => chat.id === chatId);
    if (index === -1) return sendError(res, 404, 'Perbualan tidak ditemui.');

    chats.splice(index, 1);
    saveChatsSoon();
    broadcastAdmin('deleted', { chatId });
    broadcastVisitors('deleted', { chatId }, chatId);

    const clients = visitorClients.get(chatId);
    if (clients) {
      for (const client of clients) {
        try {
          client.end();
        } catch {
          // Abaikan.
        }
      }
      visitorClients.delete(chatId);
    }
    return sendJson(res, 200, { ok: true, chatId });
  }

  return sendError(res, 404, 'Endpoint tidak ditemui.');
}

function openEventStream(req, res, role, chatId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2500\n\n');
  res.write(': connected\n\n');

  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);

  if (role === 'admin') {
    adminClients.add(res);
    const sorted = [...chats].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    sseWrite(res, 'snapshot', {
      chats: sorted.map(publicChat),
      adminOnline: true,
    });
    broadcastAdminPresence();

    const cleanup = (() => {
      let cleaned = false;
      return () => {
        if (cleaned) return;
        cleaned = true;
        adminClients.delete(res);
        broadcastAdminPresence();
      };
    })();
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return;
  }

  if (role === 'visitor') {
    const chat = chatId ? findChat(chatId) : null;
    if (!chat) {
      sseWrite(res, 'error', { message: 'Perbualan tidak ditemui.' });
      return res.end();
    }

    if (!visitorClients.has(chat.id)) visitorClients.set(chat.id, new Set());
    visitorClients.get(chat.id).add(res);
    chat.lastSeen = new Date().toISOString();
    saveChatsSoon();

    sseWrite(res, 'snapshot', {
      chat: publicChat(chat),
      adminOnline: adminClients.size > 0,
    });
    broadcastPresence(chat.id);
    broadcastVisitors(
      'presence',
      { adminOnline: adminClients.size > 0 },
      chat.id
    );

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      const clients = visitorClients.get(chat.id);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) visitorClients.delete(chat.id);
      }
      broadcastPresence(chat.id);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return;
  }

  sseWrite(res, 'error', { message: 'Role tidak sah.' });
  res.end();
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (url.pathname.startsWith('/api/')) {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(origin).host === req.headers.host;
        } catch {
          sameOrigin = false;
        }
        if (!sameOrigin) return sendError(res, 403, 'Permintaan lintas asal tidak dibenarkan.');
      }
    }
    try {
      await handleApi(req, res, url);
    } catch (error) {
      const status = error?.status || 500;
      if (status >= 500) console.error('[api]', error);
      if (!res.headersSent) sendError(res, status, error.message || 'Ralat pelayan.');
      else res.end();
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'Kaedah tidak dibenarkan.');
  }

  if (url.pathname.startsWith('/uploads/')) {
    return serveUpload(req, res, url.pathname);
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  HaloDesk Live Chat sedang berjalan');
  console.log(`  Pelanggan : http://localhost:${PORT}`);
  console.log(`  Admin     : http://localhost:${PORT}/LivechatAdmin`);
  console.log('');
  console.log('  Tekan Ctrl+C untuk berhenti.');
  console.log('');
});

function shutdown() {
  console.log('\nMenyimpan data dan menutup pelayan...');
  saveChatsNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
