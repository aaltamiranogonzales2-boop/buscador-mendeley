'use strict';

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-CHANGE-ME';
const SESSION_KEY = crypto.scryptSync(SESSION_SECRET, 'mendeley-cite-salt', 32);
const COOKIE_NAME = 'mendeley_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const APP_URL = (process.env.APP_URL || '').replace(/\/$/, '');
const IS_HTTPS = APP_URL.startsWith('https://');

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

function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, [...existing, value]);
  else res.setHeader(name, [existing, value]);
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

module.exports = { getSession, setSessionCookie, clearSessionCookie };
