'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- config ----------
const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

const CLIENT_ID = process.env.MENDELEY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MENDELEY_CLIENT_SECRET || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI = `${APP_URL}/auth/callback`;
const COOKIE_NAME = 'mendeley_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const IS_HTTPS = APP_URL.startsWith('https://');

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('⚠ MENDELEY_CLIENT_ID / MENDELEY_CLIENT_SECRET not set — OAuth will not work.');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon'
};

// ---------- session crypto ----------
const SESSION_KEY = crypto.scryptSync(SESSION_SECRET, 'mendeley-cite-salt', 32);

function encryptSession(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64url');
}

function decryptSession(token) {
  try {
    if (!token) return null;
    const buf = Buffer.from(token, 'base64url');
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_KEY, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) {
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return decryptSession(cookies[COOKIE_NAME]);
}

function setSessionCookie(res, session) {
  const token = encryptSession(session);
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE}`,
    'SameSite=Lax'
  ];
  if (IS_HTTPS) parts.push('Secure');
  appendHeader(res, 'Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
    'SameSite=Lax'
  ];
  if (IS_HTTPS) parts.push('Secure');
  appendHeader(res, 'Set-Cookie', parts.join('; '));
}

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, [...existing, value]);
  else res.setHeader(name, [existing, value]);
}

// ---------- https helper ----------
function fetchHttps(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };
    const req = https.request(opts, resp => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({
        statusCode: resp.statusCode,
        headers: resp.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ---------- OAuth ----------
function basicAuth() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI
  }).toString();
  const r = await fetchHttps('https://api.mendeley.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuth(),
      'Accept': 'application/json'
    },
    body
  });
  if (r.statusCode !== 200) {
    throw new Error(`Token exchange failed: ${r.statusCode} ${r.body}`);
  }
  return JSON.parse(r.body);
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  }).toString();
  const r = await fetchHttps('https://api.mendeley.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuth(),
      'Accept': 'application/json'
    },
    body
  });
  if (r.statusCode !== 200) {
    throw new Error(`Refresh failed: ${r.statusCode} ${r.body}`);
  }
  return JSON.parse(r.body);
}

async function ensureFreshSession(session, res) {
  if (!session) return null;
  // Refresh 60s before expiry
  if (session.expires_at && Date.now() < session.expires_at - 60000) return session;
  if (!session.refresh_token) return null;
  try {
    const tokens = await refreshAccessToken(session.refresh_token);
    const newSession = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || session.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000)
    };
    setSessionCookie(res, newSession);
    return newSession;
  } catch (e) {
    console.error('[refresh]', e.message);
    return null;
  }
}

// ---------- route handlers ----------
function handleAuthLogin(req, res) {
  if (!CLIENT_ID) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OAuth no configurado: falta MENDELEY_CLIENT_ID.');
    return;
  }
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'all'
  });
  res.writeHead(302, { Location: `https://api.mendeley.com/oauth/authorize?${params}` });
  res.end();
}

async function handleAuthCallback(req, res) {
  const u = new URL(req.url, APP_URL);
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Autorización denegada: ' + error);
    return;
  }
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Falta el código de autorización.');
    return;
  }
  try {
    const tokens = await exchangeCodeForTokens(code);
    setSessionCookie(res, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000)
    });
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (e) {
    console.error('[callback]', e.message);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Error en autenticación: ' + e.message);
  }
}

function handleAuthLogout(req, res) {
  clearSessionCookie(res);
  res.writeHead(302, { Location: '/' });
  res.end();
}

async function handleApiMe(req, res) {
  let session = getSession(req);
  session = await ensureFreshSession(session, res);
  if (!session) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }
  // Optionally fetch /profiles/me to show name
  try {
    const r = await fetchHttps('https://api.mendeley.com/profiles/me', {
      headers: { Authorization: `Bearer ${session.access_token}`, Accept: '*/*' }
    });
    if (r.statusCode === 200) {
      const prof = JSON.parse(r.body);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        authenticated: true,
        name: prof.display_name || `${prof.first_name || ''} ${prof.last_name || ''}`.trim(),
        email: prof.email
      }));
      return;
    }
  } catch (e) { /* fall through */ }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ authenticated: true }));
}

// ---------- proxy ----------
async function proxyMendeley(req, res) {
  let session = getSession(req);
  session = await ensureFreshSession(session, res);
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_authenticated' }));
    return;
  }

  const targetPath = req.url.replace(/^\/api\/mendeley/, '') || '/';
  const headers = {
    'Accept': req.headers.accept || '*/*',
    'User-Agent': 'mendeley-cite-helper/1.0',
    'Authorization': `Bearer ${session.access_token}`
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers['content-length']) headers['Content-Length'] = req.headers['content-length'];

  const options = {
    hostname: 'api.mendeley.com',
    port: 443,
    path: targetPath,
    method: req.method,
    headers
  };

  const proxyReq = https.request(options, proxyRes => {
    const outHeaders = { ...proxyRes.headers };
    delete outHeaders['content-encoding'];
    delete outHeaders['transfer-encoding'];
    if (proxyRes.statusCode >= 400) {
      let body = '';
      proxyRes.setEncoding('utf8');
      proxyRes.on('data', c => { body += c; });
      proxyRes.on('end', () => {
        console.log(`[proxy] ${req.method} ${targetPath} → ${proxyRes.statusCode}: ${body.slice(0, 200)}`);
        res.writeHead(proxyRes.statusCode, outHeaders);
        res.end(body);
      });
    } else {
      res.writeHead(proxyRes.statusCode, outHeaders);
      proxyRes.pipe(res);
    }
  });
  proxyReq.on('error', err => {
    console.log(`[proxy] ERROR ${req.method} ${targetPath}: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
  });
  req.pipe(proxyReq);
}

// ---------- static ----------
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/mendeley-citas.html';
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

// ---------- router ----------
const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/auth/login') return handleAuthLogin(req, res);
  if (pathname === '/auth/callback') return handleAuthCallback(req, res);
  if (pathname === '/auth/logout') return handleAuthLogout(req, res);
  if (pathname === '/api/me') return handleApiMe(req, res);
  if (pathname.startsWith('/api/mendeley')) return proxyMendeley(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Server ready: ${APP_URL}`);
  console.log(`Redirect URI: ${REDIRECT_URI}`);
});
