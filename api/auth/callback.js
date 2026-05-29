'use strict';

const { exchangeCodeForTokens, APP_URL } = require('../../lib/oauth');
const { setSessionCookie } = require('../../lib/session');

module.exports = async (req, res) => {
  const base = APP_URL || `https://${req.headers.host}`;
  const u = new URL(req.url, base);
  const code = u.searchParams.get('code');
  const error = u.searchParams.get('error');
  if (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Autorización denegada: ' + error);
    return;
  }
  if (!code) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
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
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Error en autenticación: ' + e.message);
  }
};
