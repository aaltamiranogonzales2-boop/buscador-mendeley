'use strict';

const { clearSessionCookie } = require('../../lib/session');

module.exports = (req, res) => {
  clearSessionCookie(res);
  res.writeHead(302, { Location: '/' });
  res.end();
};
