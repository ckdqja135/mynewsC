const crypto = require('crypto');

/**
 * Generate unique ID from url and title using sha256.
 * Returns first 24 characters of hash.
 */
function generateNewsId(url, title) {
  const content = `${url}|${title}`;
  const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  return hash.slice(0, 24);
}

module.exports = { generateNewsId };
