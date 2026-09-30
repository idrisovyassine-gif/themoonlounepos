const { openDatabase } = require("../src/db");
const config = require("../src/config");
const { hashSecret, randomId, normalizeEmail, normalizeText, validEmail } = require("../src/security");

const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
const firstName = normalizeText(process.env.SUPER_ADMIN_FIRST_NAME || "Platform", 80);
const lastName = normalizeText(process.env.SUPER_ADMIN_LAST_NAME || "Admin", 80);

if (!validEmail(email) || password.length < 14) {
  console.error("Définissez SUPER_ADMIN_EMAIL et un SUPER_ADMIN_PASSWORD d’au moins 14 caractères.");
  process.exit(1);
}

const db = openDatabase(config.databasePath);
const existing = db.prepare("SELECT * FROM users WHERE email=?").get(email);
if (existing && existing.role !== "SUPER_ADMIN") {
  console.error("Cet email appartient déjà à un compte non Super Admin.");
  db.close(); process.exit(1);
}
const timestamp = new Date().toISOString();
if (existing) {
  db.prepare("UPDATE users SET first_name=?,last_name=?,password_hash=?,active=1,updated_at=? WHERE id=? AND role='SUPER_ADMIN'")
    .run(firstName,lastName,hashSecret(password),timestamp,existing.id);
  console.log(`Super Admin mis à jour : ${email}`);
} else {
  db.prepare("INSERT INTO users(id,restaurant_id,first_name,last_name,email,password_hash,role,permissions_json,active,created_at,updated_at) VALUES (?,NULL,?,?,?,?, 'SUPER_ADMIN','[]',1,?,?)")
    .run(randomId("user"),firstName,lastName,email,hashSecret(password),timestamp,timestamp);
  console.log(`Super Admin créé : ${email}`);
}
db.close();
