'use strict';

const { getSession } = require('../lib/session');
const { ensureFreshSession, fetchHttps } = require('../lib/oauth');

module.exports = async (req, res) => {
  let session = getSession(req);
  session = await ensureFreshSession(session, res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!session) {
    res.statusCode = 200;
    res.end(JSON.stringify({ authenticated: false }));
    return;
  }
  try {
    const r = await fetchHttps('https://api.mendeley.com/profiles/me', {
      headers: { Authorization: `Bearer ${session.access_token}`, Accept: '*/*' }
    });
    if (r.statusCode === 200) {
      const prof = JSON.parse(r.body);
      res.statusCode = 200;
      res.end(JSON.stringify({
        authenticated: true,
        name: prof.display_name || `${prof.first_name || ''} ${prof.last_name || ''}`.trim(),
        email: prof.email
      }));
      return;
    }
  } catch { /* fall through */ }
  res.statusCode = 200;
  res.end(JSON.stringify({ authenticated: true }));
};
