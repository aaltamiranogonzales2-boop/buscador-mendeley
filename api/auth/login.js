'use strict';

const { CLIENT_ID, REDIRECT_URI } = require('../../lib/oauth');

module.exports = (req, res) => {
  if (!CLIENT_ID) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
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
};
