'use strict';

const https = require('https');
const { getSession } = require('../../lib/session');
const { ensureFreshSession } = require('../../lib/oauth');

// Disable Vercel's automatic body parsing so we can pipe raw bytes to Mendeley
module.exports.config = { api: { bodyParser: false } };

module.exports = async (req, res) => {
  let session = getSession(req);
  session = await ensureFreshSession(session, res);
  if (!session) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
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

  await new Promise(resolve => {
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
          resolve();
        });
      } else {
        res.writeHead(proxyRes.statusCode, outHeaders);
        proxyRes.on('end', resolve);
        proxyRes.on('error', resolve);
        proxyRes.pipe(res);
      }
    });
    proxyReq.on('error', err => {
      console.log(`[proxy] ERROR ${req.method} ${targetPath}: ${err.message}`);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(JSON.stringify({ error: 'proxy_error', message: err.message }));
      resolve();
    });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });
};
