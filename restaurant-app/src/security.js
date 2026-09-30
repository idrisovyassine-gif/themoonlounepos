const crypto = require("crypto");

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(secret), salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifySecret(secret, encoded) {
  if (typeof encoded !== "string") return false;
  const [algorithm, saltHex, hashHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const actual = crypto.scryptSync(String(secret), Buffer.from(saltHex, "hex"), KEY_LENGTH, SCRYPT_OPTIONS);
    const expected = Buffer.from(hashHex, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function parseCookies(header = "") {
  return header.split(";").map((value) => value.trim()).filter(Boolean).reduce((cookies, part) => {
    const [name, ...value] = part.split("=");
    if (name) cookies[name] = decodeURIComponent(value.join("="));
    return cookies;
  }, {});
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeText(value, maxLength = 200) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

module.exports = { hashSecret, verifySecret, randomId, hashToken, parseCookies, normalizeEmail, normalizeText, validEmail };
