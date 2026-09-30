const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { hashSecret, randomId } = require("./security");

const migrations = [
  {
    version: 1,
    name: "multi_tenant_core",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
      CREATE TABLE restaurants (
        id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, logo_url TEXT,
        address TEXT, city TEXT, postal_code TEXT, country TEXT NOT NULL DEFAULT 'BE',
        phone TEXT, email TEXT, vat_number TEXT, currency TEXT NOT NULL DEFAULT 'EUR',
        timezone TEXT NOT NULL DEFAULT 'Europe/Brussels', language TEXT NOT NULL DEFAULT 'fr',
        tax_rate REAL NOT NULL DEFAULT 0, service_charge_rate REAL NOT NULL DEFAULT 0,
        tips_enabled INTEGER NOT NULL DEFAULT 0, receipt_footer TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE'
          CHECK(status IN ('ACTIVE','SUSPENDED','DISABLED')),
        plan TEXT NOT NULL DEFAULT 'FREE' CHECK(plan IN ('FREE','BASIC','PRO','ENTERPRISE')),
        subscription_status TEXT NOT NULL DEFAULT 'TRIAL', trial_ends_at TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE users (
        id TEXT PRIMARY KEY, restaurant_id TEXT REFERENCES restaurants(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT,
        password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','WAITER','CASHIER','KITCHEN')),
        permissions_json TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE employees (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL DEFAULT '',
        email TEXT, phone TEXT, role TEXT NOT NULL CHECK(role IN ('RESTAURANT_OWNER','MANAGER','WAITER','CASHIER','KITCHEN')),
        permissions_json TEXT NOT NULL DEFAULT '[]', pin_hash TEXT, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(restaurant_id, email)
      );
      CREATE TABLE categories (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        name TEXT NOT NULL, image_url TEXT, color TEXT, position INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(restaurant_id, name)
      );
      CREATE TABLE products (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT, name TEXT NOT NULL,
        description TEXT, price_cents INTEGER NOT NULL CHECK(price_cents >= 0), image_url TEXT,
        active INTEGER NOT NULL DEFAULT 1, available INTEGER NOT NULL DEFAULT 1, tax_rate REAL,
        position INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE product_option_groups (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, name TEXT NOT NULL,
        required INTEGER NOT NULL DEFAULT 0, min_choices INTEGER NOT NULL DEFAULT 0, max_choices INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE product_options (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE, name TEXT NOT NULL,
        price_delta_cents INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE restaurant_tables (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        number INTEGER, name TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 2, area TEXT,
        position_x REAL, position_y REAL, active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(restaurant_id, name)
      );
      CREATE TABLE orders (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        order_number INTEGER NOT NULL, table_id TEXT REFERENCES restaurant_tables(id) ON DELETE SET NULL,
        employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK(status IN ('OPEN','IN_PROGRESS','READY','COMPLETED','CANCELLED')),
        subtotal_cents INTEGER NOT NULL DEFAULT 0, tax_cents INTEGER NOT NULL DEFAULT 0,
        discount_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PARTIAL','PAID','REFUNDED')),
        kitchen_send_count INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(restaurant_id, order_number)
      );
      CREATE TABLE order_items (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        name_snapshot TEXT NOT NULL, unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0),
        sent_quantity INTEGER NOT NULL DEFAULT 0, options_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE payments (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT, employee_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
        method TEXT NOT NULL CHECK(method IN ('CASH','CARD','OTHER','SPLIT')), amount_cents INTEGER NOT NULL,
        cash_cents INTEGER NOT NULL DEFAULT 0, card_cents INTEGER NOT NULL DEFAULT 0, change_cents INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','EDITED','DELETED','REFUNDED')),
        include_in_daily INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE settings (
        id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
        key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(restaurant_id, key)
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE, restaurant_id TEXT REFERENCES restaurants(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL, created_at TEXT NOT NULL, CHECK(user_id IS NOT NULL OR employee_id IS NOT NULL)
      );
      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY, restaurant_id TEXT REFERENCES restaurants(id) ON DELETE CASCADE,
        actor_user_id TEXT, actor_employee_id TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      );
      CREATE INDEX idx_users_restaurant ON users(restaurant_id);
      CREATE INDEX idx_employees_restaurant ON employees(restaurant_id);
      CREATE INDEX idx_categories_restaurant ON categories(restaurant_id, active, position);
      CREATE INDEX idx_products_restaurant ON products(restaurant_id, category_id, active, position);
      CREATE INDEX idx_tables_restaurant ON restaurant_tables(restaurant_id, active);
      CREATE INDEX idx_orders_restaurant ON orders(restaurant_id, created_at, status);
      CREATE INDEX idx_order_items_restaurant ON order_items(restaurant_id, order_id);
      CREATE INDEX idx_payments_restaurant ON payments(restaurant_id, created_at, status);
    `
  },
  {
    version: 2,
    name: "order_totals_and_kitchen",
    sql: `
      ALTER TABLE orders ADD COLUMN service_charge_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN tip_cents INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_option_groups_tenant_product ON product_option_groups(restaurant_id, product_id);
      CREATE INDEX idx_options_tenant_group ON product_options(restaurant_id, group_id);
    `
  }
];

function openDatabase(databasePath) {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of migrations) {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version);
    if (applied) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return db;
}

function json(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function audit(db, context, action, entityType, entityId, details = {}) {
  db.prepare(`INSERT INTO audit_logs(id, restaurant_id, actor_user_id, actor_employee_id, action, entity_type, entity_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomId("log"), context?.restaurantId || null, context?.userId || null, context?.employeeId || null,
      action, entityType || null, entityId || null, JSON.stringify(details), new Date().toISOString());
}

function seedMoonLounge(db) {
  if (db.prepare("SELECT 1 FROM restaurants WHERE id = 'rest_moon_lounge'").get()) return;
  const seedPath = path.join(__dirname, "..", "seeds", "moon-menu.seed.json");
  if (!fs.existsSync(seedPath)) return;
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO restaurants(id,slug,name,address,city,country,email,vat_number,currency,timezone,language,status,plan,subscription_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run("rest_moon_lounge", "moon-lounge", "The Moon Brussels", "", "Bruxelles", "BE", "", "BE 0773 802 850", "EUR", "Europe/Brussels", "fr", "ACTIVE", "PRO", "ACTIVE", now, now);
    const categories = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    const categoryInsert = db.prepare(`INSERT INTO categories(id,restaurant_id,name,position,active,metadata_json,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)`);
    const productInsert = db.prepare(`INSERT INTO products(id,restaurant_id,category_id,name,price_cents,position,active,available,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,?,?,?)`);
    categories.forEach((category, categoryIndex) => {
      const categoryId = `moon_cat_${category.id}`;
      const feature = category.id === "promotions" ? "PROMOTION_FLAVOR" : ["mocktails", "mojitos"].includes(category.id) ? "ALCOHOL_UPGRADE" : null;
      categoryInsert.run(categoryId, "rest_moon_lounge", category.label, categoryIndex, JSON.stringify({ legacyId: category.id, feature }), now, now);
      category.items.forEach((product, productIndex) => {
        productInsert.run(`moon_product_${category.id}_${product.id}`, "rest_moon_lounge", categoryId, product.name,
          Math.round(Number(product.price) * 100), productIndex, JSON.stringify({ ...product, legacyId: product.id }), now, now);
      });
    });
    for (let number = 1; number <= 13; number += 1) {
      db.prepare(`INSERT INTO restaurant_tables(id,restaurant_id,number,name,capacity,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
        .run(`moon_table_${number}`, "rest_moon_lounge", number, `Table ${number}`, 4, now, now);
    }
    const legacyPin = process.env.MOON_OWNER_PIN;
    if (legacyPin && /^\d{4,12}$/.test(legacyPin)) {
      db.prepare(`INSERT INTO employees(id,restaurant_id,first_name,last_name,role,pin_hash,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)`)
        .run("moon_employee_owner", "rest_moon_lounge", "Gérant", "Moon Lounge", "RESTAURANT_OWNER", hashSecret(legacyPin), now, now);
    }
    db.prepare(`INSERT INTO settings(id,restaurant_id,key,value_json,updated_at) VALUES (?,?,?,?,?)`)
      .run(randomId("setting"), "rest_moon_lounge", "pos", JSON.stringify({ loungeOptionsEnabled: true }), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { openDatabase, seedMoonLounge, json, audit };
