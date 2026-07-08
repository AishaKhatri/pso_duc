// password-utils.js
//
// Password hashing helpers backed by Node's built-in crypto (scrypt) — no
// native/3rd-party dependency to install on the server. New and updated user
// passwords are stored as a salted scrypt hash rather than plaintext.
//
// Stored format: "scrypt$<saltHex>$<derivedKeyHex>"
//
// verifyPassword() falls back to a plaintext comparison when the stored value
// is NOT in that format, so users created before this change (plaintext in the
// DB) keep working. Once such a user's password is reset through /api/users, it
// is re-stored as a hash.

const crypto = require('crypto');

const SCRYPT_PREFIX = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// Produce a salted scrypt hash for a plaintext password.
function hashPassword(plain) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(String(plain), salt, KEY_BYTES);
  return `${SCRYPT_PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

// True when `stored` looks like a value produced by hashPassword().
function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(`${SCRYPT_PREFIX}$`);
}

// Verify a plaintext password against a stored value. Handles both the hashed
// format and legacy plaintext (pre-hashing) records.
function verifyPassword(plain, stored) {
  if (stored == null) return false;

  if (!isHashed(stored)) {
    // Legacy plaintext record — direct comparison.
    return String(plain) === String(stored);
  }

  const [, saltHex, keyHex] = stored.split('$');
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(String(plain), salt, expected.length);

  // Constant-time comparison; lengths must match for timingSafeEqual.
  return derived.length === expected.length &&
    crypto.timingSafeEqual(derived, expected);
}

module.exports = { hashPassword, verifyPassword, isHashed };
