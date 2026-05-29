'use strict';

const https = require('https');
const { setSessionCookie } = require('./session');

const CLIENT_ID = process.env.MENDELEY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MENDELEY_CLIENT_SECRET || '';
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
// Public URL (rewritten by Vercel to /api/auth/callback)
const REDIRECT_URI = `${APP_URL}/auth/callback`;

function basicAuth() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

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

module.exports = {
  CLIENT_ID, CLIENT_SECRET, APP_URL, REDIRECT_URI,
  basicAuth, fetchHttps, exchangeCodeForTokens,
  refreshAccessToken, ensureFreshSession
};
