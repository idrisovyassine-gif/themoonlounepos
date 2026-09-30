const crypto = require("crypto");
const path = require("path");
const express = require("express");
const config = require("./config");
const { openDatabase, seedMoonLounge, json, audit } = require("./db");
const { hashSecret, verifySecret, randomId, hashToken, parseCookies, normalizeEmail, normalizeText, validEmail } = require("./security");

const COOKIE_NAME = "servio_session";
const MANAGERS = new Set(["SUPER_ADMIN", "RESTAURANT_OWNER", "MANAGER"]);
const STAFF_ROLES = new Set(["MANAGER", "WAITER", "CASHIER", "KITCHEN"]);
const now = () => new Date().toISOString();
const toCents = (value) => { const n = Number(String(value ?? 0).replace(",", ".")); return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0; };
const fromCents = (value) => Number(value || 0) / 100;
const flag = (value) => value ? 1 : 0;
const slugify = (value) => normalizeText(value, 80).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `restaurant-${Date.now()}`;

function tx(db, callback) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = callback(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function restaurantDto(row) {
  if (!row) return null;
  return { id: row.id, slug: row.slug, name: row.name, logoUrl: row.logo_url, address: row.address, city: row.city,
    postalCode: row.postal_code, country: row.country, phone: row.phone, email: row.email, vatNumber: row.vat_number,
    currency: row.currency, timezone: row.timezone, language: row.language, taxRate: row.tax_rate,
    serviceChargeRate: row.service_charge_rate, tipsEnabled: Boolean(row.tips_enabled), receiptFooter: row.receipt_footer,
    status: row.status, plan: row.plan, subscriptionStatus: row.subscription_status, trialEndsAt: row.trial_ends_at,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function actorDto(row, kind = "employee") {
  if (!row) return null;
  return { id: row.id, name: `${row.first_name} ${row.last_name || ""}`.trim(), firstName: row.first_name,
    lastName: row.last_name || "", email: row.email || null, phone: row.phone || null, role: row.role,
    permissions: json(row.permissions_json, []), active: Boolean(row.active), kind };
}

function createApp(options = {}) {
  const cfg = { ...config, ...options };
  const db = options.db || openDatabase(cfg.databasePath);
  if (options.seed !== false) seedMoonLounge(db);
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin"); res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const origin = req.headers.origin, expected = `${req.protocol}://${req.get("host")}`;
      if (origin && origin !== expected && origin !== process.env.APP_ORIGIN) return res.status(403).json({ error: "Origine non autorisée" });
    }
    next();
  });

  const attempts = new Map();
  const loginLimit = (req, res, next) => {
    const key = req.ip || "unknown", item = attempts.get(key) || { count: 0, reset: Date.now() + 900000 };
    if (Date.now() > item.reset) { item.count = 0; item.reset = Date.now() + 900000; }
    item.count += 1; attempts.set(key, item); return item.count > 20 ? res.status(429).json({ error: "Trop de tentatives" }) : next();
  };

  function session(req) {
    const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME]; if (!token) return null;
    const saved = db.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").get(hashToken(token), now()); if (!saved) return null;
    const actor = saved.user_id ? db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(saved.user_id) : db.prepare("SELECT * FROM employees WHERE id=? AND active=1").get(saved.employee_id);
    if (!actor) return null;
    const restaurant = saved.restaurant_id ? db.prepare("SELECT * FROM restaurants WHERE id=?").get(saved.restaurant_id) : null;
    return { token, sessionId: saved.id, userId: saved.user_id, employeeId: saved.employee_id, restaurantId: saved.restaurant_id,
      role: actor.role, permissions: json(actor.permissions_json, []), actor, restaurant };
  }

  function createSession(res, actor, kind) {
    const token = crypto.randomBytes(32).toString("base64url"), createdAt = now();
    db.prepare("INSERT INTO sessions(id,token_hash,user_id,employee_id,restaurant_id,expires_at,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(randomId("session"), hashToken(token), kind === "user" ? actor.id : null, kind === "employee" ? actor.id : null,
        actor.restaurant_id || null, new Date(Date.now() + cfg.sessionDays * 86400000).toISOString(), createdAt);
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${cfg.sessionDays * 86400}${cfg.nodeEnv === "production" ? "; Secure" : ""}`);
  }
  const requireAuth = (req, res, next) => { req.auth = session(req); return req.auth ? next() : res.status(401).json({ error: "Authentification requise" }); };
  const requireTenant = (req, res, next) => !req.auth?.restaurantId ? res.status(403).json({ error: "Aucun restaurant associé" })
    : req.auth.restaurant?.status !== "ACTIVE" ? res.status(423).json({ error: "Restaurant suspendu ou désactivé" }) : next();
  const roles = (...allowed) => (req, res, next) => allowed.includes(req.auth?.role) ? next() : res.status(403).json({ error: "Permission insuffisante" });
  const rolePermissions = { MANAGER:["MANAGE_MENU","MANAGE_STAFF","MANAGE_TABLES","CREATE_ORDERS","TAKE_PAYMENTS","VIEW_REPORTS","MANAGE_PAYMENTS","VIEW_KITCHEN"], WAITER:["CREATE_ORDERS"], CASHIER:["CREATE_ORDERS","TAKE_PAYMENTS"], KITCHEN:["VIEW_KITCHEN"] };
  const permitted = (req, permission) => ["SUPER_ADMIN", "RESTAURANT_OWNER"].includes(req.auth.role) || req.auth.permissions.includes(permission) || (rolePermissions[req.auth.role]||[]).includes(permission);
  const permission = (name) => (req, res, next) => permitted(req, name) ? next() : res.status(403).json({ error: "Permission insuffisante" });

  app.get("/health", (_req, res) => res.json({ ok: true, database: "sqlite" }));
  app.get("/login", (req, res) => session(req) ? res.redirect("/") : res.sendFile(path.join(cfg.publicDir, "login.html")));
  app.get("/signup", (req, res) => session(req) ? res.redirect("/") : res.sendFile(path.join(cfg.publicDir, "signup.html")));
  app.get("/api/auth/status", (req, res) => { const auth = session(req); res.json({ authenticated: Boolean(auth), user: auth ? actorDto(auth.actor, auth.userId ? "user" : "employee") : null, restaurant: restaurantDto(auth?.restaurant) }); });

  app.post("/api/auth/signup", loginLimit, (req, res, next) => {
    const body = req.body || {}, firstName = normalizeText(body.firstName, 80), lastName = normalizeText(body.lastName, 80);
    const email = normalizeEmail(body.email), password = String(body.password || ""), restaurantName = normalizeText(body.restaurantName, 120);
    if (firstName.length < 2 || lastName.length < 2 || !validEmail(email) || password.length < 10 || restaurantName.length < 2) return res.status(400).json({ error: "Informations invalides ou mot de passe trop court" });
    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email)) return res.status(409).json({ error: "Cet email existe déjà" });
    try {
      const user = tx(db, () => {
        const createdAt = now(), restaurantId = randomId("rest"), userId = randomId("user"), employeeId = randomId("employee");
        let slug = slugify(restaurantName), suffix = 2; while (db.prepare("SELECT 1 FROM restaurants WHERE slug=?").get(slug)) slug = `${slugify(restaurantName)}-${suffix++}`;
        db.prepare(`INSERT INTO restaurants(id,slug,name,address,city,postal_code,country,phone,email,vat_number,currency,timezone,language,status,plan,subscription_status,trial_ends_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE','FREE','TRIAL',?,?,?)`).run(restaurantId, slug, restaurantName, normalizeText(body.address), normalizeText(body.city), normalizeText(body.postalCode,20),
          normalizeText(body.country || "BE",2).toUpperCase(), normalizeText(body.restaurantPhone,40), normalizeEmail(body.restaurantEmail || email), normalizeText(body.vatNumber,40),
          normalizeText(body.currency || "EUR",3).toUpperCase(), normalizeText(body.timezone || "Europe/Brussels",80), normalizeText(body.language || "fr",8),
          new Date(Date.now()+14*86400000).toISOString(), createdAt, createdAt);
        db.prepare(`INSERT INTO users(id,restaurant_id,first_name,last_name,email,phone,password_hash,role,permissions_json,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'RESTAURANT_OWNER','[]',1,?,?)`)
          .run(userId, restaurantId, firstName, lastName, email, normalizeText(body.phone,40), hashSecret(password), createdAt, createdAt);
        db.prepare(`INSERT INTO employees(id,restaurant_id,user_id,first_name,last_name,email,phone,role,permissions_json,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'RESTAURANT_OWNER','[]',1,?,?)`)
          .run(employeeId, restaurantId, userId, firstName, lastName, email, normalizeText(body.phone,40), createdAt, createdAt);
        audit(db, { restaurantId, userId }, "RESTAURANT_CREATED", "restaurant", restaurantId); return db.prepare("SELECT * FROM users WHERE id=?").get(userId);
      });
      createSession(res, user, "user"); res.status(201).json({ user: actorDto(user,"user"), restaurant: restaurantDto(db.prepare("SELECT * FROM restaurants WHERE id=?").get(user.restaurant_id)), next: "/dashboard?onboarding=1" });
    } catch (error) { next(error); }
  });

  app.post("/api/auth/login", loginLimit, (req, res) => {
    const email = normalizeEmail(req.body?.email), password = String(req.body?.password || ""); let actor, kind;
    if (email && password) { actor = db.prepare("SELECT * FROM users WHERE email=? AND active=1").get(email); kind = "user"; if (!actor || !verifySecret(password, actor.password_hash)) actor = null; }
    else {
      const restaurantKey = normalizeText(req.body?.restaurant,120).toLowerCase(), name = normalizeText(req.body?.name,160).toLowerCase(), pin = String(req.body?.pin || "");
      const restaurant = db.prepare("SELECT * FROM restaurants WHERE lower(slug)=? OR lower(name)=?").get(restaurantKey, restaurantKey);
      if (restaurant) actor = db.prepare("SELECT * FROM employees WHERE restaurant_id=? AND active=1").all(restaurant.id).find((item) => `${item.first_name} ${item.last_name}`.trim().toLowerCase() === name && item.pin_hash && verifySecret(pin,item.pin_hash)); kind = "employee";
    }
    if (!actor) return res.status(401).json({ error: "Identifiants invalides" });
    const restaurant = actor.restaurant_id ? db.prepare("SELECT * FROM restaurants WHERE id=?").get(actor.restaurant_id) : null;
    if (restaurant && restaurant.status !== "ACTIVE") return res.status(423).json({ error: "Restaurant suspendu ou désactivé" });
    createSession(res, actor, kind); attempts.delete(req.ip || "unknown");
    res.json({ authenticated: true, user: actorDto(actor,kind), restaurant: restaurantDto(restaurant), next: actor.role === "SUPER_ADMIN" ? "/super-admin" : MANAGERS.has(actor.role) ? "/dashboard" : "/" });
  });
  app.post("/api/auth/logout", (req, res) => { const auth = session(req); if (auth) db.prepare("DELETE FROM sessions WHERE id=?").run(auth.sessionId); res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`); res.json({ authenticated:false }); });

  app.use("/api", requireAuth);

  app.get("/api/restaurant/current", requireTenant, (req,res) => res.json(restaurantDto(req.auth.restaurant)));
  app.put("/api/restaurant/current", requireTenant, roles("RESTAURANT_OWNER"), (req,res) => {
    const b=req.body||{}, r=req.auth.restaurant;
    db.prepare(`UPDATE restaurants SET name=?,logo_url=?,address=?,city=?,postal_code=?,country=?,phone=?,email=?,vat_number=?,currency=?,timezone=?,language=?,tax_rate=?,service_charge_rate=?,tips_enabled=?,receipt_footer=?,updated_at=? WHERE id=?`)
      .run(normalizeText(b.name||r.name,120),normalizeText(b.logoUrl,500)||null,normalizeText(b.address),normalizeText(b.city),normalizeText(b.postalCode,20),normalizeText(b.country||"BE",2).toUpperCase(),normalizeText(b.phone,40),normalizeEmail(b.email),normalizeText(b.vatNumber,40),normalizeText(b.currency||"EUR",3).toUpperCase(),normalizeText(b.timezone||"Europe/Brussels",80),normalizeText(b.language||"fr",8),Math.max(0,Math.min(100,Number(b.taxRate)||0)),Math.max(0,Math.min(100,Number(b.serviceChargeRate)||0)),flag(b.tipsEnabled),normalizeText(b.receiptFooter,500),now(),req.auth.restaurantId);
    audit(db,req.auth,"RESTAURANT_UPDATED","restaurant",req.auth.restaurantId); res.json(restaurantDto(db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.auth.restaurantId)));
  });

  const categoryRows = (restaurantId, all=false) => db.prepare(`SELECT * FROM categories WHERE restaurant_id=? ${all?"":"AND active=1"} ORDER BY position,name`).all(restaurantId);
  const categoryDto = (row) => { const meta=json(row.metadata_json); return { id:row.id,name:row.name,label:row.name,imageUrl:row.image_url,color:row.color,position:row.position,active:Boolean(row.active),feature:meta.feature||null }; };
  const productDto = (row) => { const meta=json(row.metadata_json); delete meta.id; delete meta.name; delete meta.price; return { id:row.id,categoryId:row.category_id,name:row.name,description:row.description,price:fromCents(row.price_cents),imageUrl:row.image_url,active:Boolean(row.active),available:Boolean(row.available),taxRate:row.tax_rate,position:row.position,...meta }; };
  const productWithOptions = (row) => ({ ...productDto(row), optionGroups: db.prepare("SELECT * FROM product_option_groups WHERE restaurant_id=? AND product_id=? ORDER BY position,name").all(row.restaurant_id,row.id).map(group=>({ id:group.id,name:group.name,required:Boolean(group.required),minChoices:group.min_choices,maxChoices:group.max_choices,position:group.position,options:db.prepare("SELECT * FROM product_options WHERE restaurant_id=? AND group_id=? AND active=1 ORDER BY position,name").all(row.restaurant_id,group.id).map(option=>({id:option.id,name:option.name,priceDelta:fromCents(option.price_delta_cents),active:Boolean(option.active),position:option.position})) })) });

  app.get("/api/categories", requireTenant, (req,res) => res.json(categoryRows(req.auth.restaurantId,req.query.all==="1").map(categoryDto)));
  app.post("/api/categories", requireTenant, permission("MANAGE_MENU"), (req,res) => {
    const name=normalizeText(req.body?.name,100); if(name.length<2)return res.status(400).json({error:"Nom requis"});
    const id=randomId("cat"),createdAt=now();
    db.prepare("INSERT INTO categories(id,restaurant_id,name,image_url,color,position,active,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'{}',?,?)")
      .run(id,req.auth.restaurantId,name,normalizeText(req.body?.imageUrl,500)||null,normalizeText(req.body?.color,20)||null,Number.isInteger(req.body?.position)?req.body.position:categoryRows(req.auth.restaurantId,true).length,flag(req.body?.active!==false),createdAt,createdAt);
    audit(db,req.auth,"CATEGORY_CREATED","category",id); res.status(201).json(categoryDto(db.prepare("SELECT * FROM categories WHERE id=?").get(id)));
  });
  app.put("/api/categories/:id", requireTenant, permission("MANAGE_MENU"), (req,res) => {
    const row=db.prepare("SELECT * FROM categories WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId); if(!row)return res.status(404).json({error:"Catégorie introuvable"});
    db.prepare("UPDATE categories SET name=?,image_url=?,color=?,position=?,active=?,updated_at=? WHERE id=? AND restaurant_id=?").run(normalizeText(req.body?.name||row.name,100),normalizeText(req.body?.imageUrl??row.image_url,500)||null,normalizeText(req.body?.color??row.color,20)||null,Number.isInteger(req.body?.position)?req.body.position:row.position,flag(req.body?.active===undefined?row.active:req.body.active),now(),row.id,req.auth.restaurantId);
    audit(db,req.auth,"CATEGORY_UPDATED","category",row.id); res.json(categoryDto(db.prepare("SELECT * FROM categories WHERE id=?").get(row.id)));
  });
  app.delete("/api/categories/:id", requireTenant, permission("MANAGE_MENU"), (req,res) => {
    const row=db.prepare("SELECT * FROM categories WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId); if(!row)return res.status(404).json({error:"Catégorie introuvable"});
    if(db.prepare("SELECT 1 FROM products WHERE category_id=? AND restaurant_id=?").get(row.id,req.auth.restaurantId))return res.status(409).json({error:"Déplacez les produits avant suppression"});
    db.prepare("DELETE FROM categories WHERE id=? AND restaurant_id=?").run(row.id,req.auth.restaurantId); audit(db,req.auth,"CATEGORY_DELETED","category",row.id); res.json({ok:true});
  });

  app.get("/api/products", requireTenant, (req,res) => res.json(db.prepare(`SELECT * FROM products WHERE restaurant_id=? ${req.query.all==="1"?"":"AND active=1"} ORDER BY position,name`).all(req.auth.restaurantId).map(productWithOptions)));
  app.post("/api/products", requireTenant, permission("MANAGE_MENU"), (req,res) => {
    const category=db.prepare("SELECT * FROM categories WHERE id=? AND restaurant_id=?").get(req.body?.categoryId,req.auth.restaurantId),name=normalizeText(req.body?.name,140);
    if(!category||name.length<2)return res.status(400).json({error:"Catégorie valide et nom requis"}); const id=randomId("product"),createdAt=now();
    db.prepare("INSERT INTO products(id,restaurant_id,category_id,name,description,price_cents,image_url,active,available,tax_rate,position,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'{}',?,?)")
      .run(id,req.auth.restaurantId,category.id,name,normalizeText(req.body?.description,1000),toCents(req.body?.price),normalizeText(req.body?.imageUrl,500)||null,flag(req.body?.active!==false),flag(req.body?.available!==false),req.body?.taxRate==null?null:Number(req.body.taxRate),Number(req.body?.position)||0,createdAt,createdAt);
    audit(db,req.auth,"PRODUCT_CREATED","product",id); res.status(201).json(productDto(db.prepare("SELECT * FROM products WHERE id=?").get(id)));
  });
  app.put("/api/products/:id", requireTenant, permission("MANAGE_MENU"), (req,res) => {
    const row=db.prepare("SELECT * FROM products WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId); if(!row)return res.status(404).json({error:"Produit introuvable"}); const categoryId=req.body?.categoryId||row.category_id;
    if(!db.prepare("SELECT 1 FROM categories WHERE id=? AND restaurant_id=?").get(categoryId,req.auth.restaurantId))return res.status(400).json({error:"Catégorie invalide"});
    db.prepare("UPDATE products SET category_id=?,name=?,description=?,price_cents=?,image_url=?,active=?,available=?,tax_rate=?,position=?,updated_at=? WHERE id=? AND restaurant_id=?")
      .run(categoryId,normalizeText(req.body?.name||row.name,140),normalizeText(req.body?.description??row.description,1000),req.body?.price==null?row.price_cents:toCents(req.body.price),normalizeText(req.body?.imageUrl??row.image_url,500)||null,flag(req.body?.active===undefined?row.active:req.body.active),flag(req.body?.available===undefined?row.available:req.body.available),req.body?.taxRate===undefined?row.tax_rate:Number(req.body.taxRate),Number.isInteger(req.body?.position)?req.body.position:row.position,now(),row.id,req.auth.restaurantId);
    audit(db,req.auth,"PRODUCT_UPDATED","product",row.id); res.json(productDto(db.prepare("SELECT * FROM products WHERE id=?").get(row.id)));
  });
  app.delete("/api/products/:id", requireTenant, permission("MANAGE_MENU"), (req,res) => { const result=db.prepare("DELETE FROM products WHERE id=? AND restaurant_id=?").run(req.params.id,req.auth.restaurantId); if(!result.changes)return res.status(404).json({error:"Produit introuvable"}); audit(db,req.auth,"PRODUCT_DELETED","product",req.params.id); res.json({ok:true}); });
  app.put("/api/products/:id/options", requireTenant, permission("MANAGE_MENU"), (req,res,next) => {
    const product=db.prepare("SELECT * FROM products WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId); if(!product)return res.status(404).json({error:"Produit introuvable"});
    const groups=Array.isArray(req.body?.groups)?req.body.groups:[]; if(groups.length>20)return res.status(400).json({error:"Trop de groupes d’options"});
    try{tx(db,()=>{db.prepare("DELETE FROM product_option_groups WHERE product_id=? AND restaurant_id=?").run(product.id,req.auth.restaurantId);const addGroup=db.prepare("INSERT INTO product_option_groups(id,restaurant_id,product_id,name,required,min_choices,max_choices,position) VALUES (?,?,?,?,?,?,?,?)"),addOption=db.prepare("INSERT INTO product_options(id,restaurant_id,group_id,name,price_delta_cents,active,position) VALUES (?,?,?,?,?,1,?)");groups.forEach((raw,index)=>{const name=normalizeText(raw.name,100),options=Array.isArray(raw.options)?raw.options:[];if(!name||!options.length||options.length>50)throw Object.assign(new Error("Chaque groupe doit avoir un nom et des options"),{status:400});const groupId=randomId("option_group"),max=Math.max(1,Math.min(options.length,Number(raw.maxChoices)||1)),min=raw.required?Math.max(1,Math.min(max,Number(raw.minChoices)||1)):Math.max(0,Math.min(max,Number(raw.minChoices)||0));addGroup.run(groupId,req.auth.restaurantId,product.id,name,flag(raw.required),min,max,index);options.forEach((option,optionIndex)=>{const optionName=normalizeText(option.name,100);if(!optionName)throw Object.assign(new Error("Nom d’option requis"),{status:400});addOption.run(randomId("option"),req.auth.restaurantId,groupId,optionName,toCents(option.priceDelta),optionIndex);});});});audit(db,req.auth,"PRODUCT_OPTIONS_UPDATED","product",product.id,{groups:groups.length});res.json(productWithOptions(product));}catch(error){next(error);}
  });

  const employeeDto=(row)=>actorDto(row,"employee");
  app.get("/api/employees", requireTenant, permission("MANAGE_STAFF"), (req,res)=>res.json(db.prepare("SELECT * FROM employees WHERE restaurant_id=? ORDER BY active DESC,first_name,last_name").all(req.auth.restaurantId).map(employeeDto)));
  function createEmployee(req,res){ const first=normalizeText(req.body?.firstName||req.body?.name,80),last=normalizeText(req.body?.lastName,80),pin=String(req.body?.pin||""),role=String(req.body?.role||"WAITER").toUpperCase(); if(first.length<2||!STAFF_ROLES.has(role)||(pin&&!/^\d{4,12}$/.test(pin)))return res.status(400).json({error:"Employé, rôle et PIN valides requis"}); const id=randomId("employee"),createdAt=now(); db.prepare("INSERT INTO employees(id,restaurant_id,first_name,last_name,email,phone,role,permissions_json,pin_hash,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)").run(id,req.auth.restaurantId,first,last,normalizeEmail(req.body?.email)||null,normalizeText(req.body?.phone,40)||null,role,JSON.stringify(Array.isArray(req.body?.permissions)?req.body.permissions:[]),pin?hashSecret(pin):null,createdAt,createdAt); audit(db,req.auth,"EMPLOYEE_CREATED","employee",id); res.status(201).json(employeeDto(db.prepare("SELECT * FROM employees WHERE id=?").get(id))); }
  app.post("/api/employees", requireTenant, permission("MANAGE_STAFF"), createEmployee);
  app.put("/api/employees/:id", requireTenant, permission("MANAGE_STAFF"), (req,res)=>{ const row=db.prepare("SELECT * FROM employees WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId); if(!row)return res.status(404).json({error:"Employé introuvable"}); const role=String(req.body?.role||row.role).toUpperCase(),pin=String(req.body?.pin||""); if((!STAFF_ROLES.has(role)&&role!=="RESTAURANT_OWNER")||(pin&&!/^\d{4,12}$/.test(pin)))return res.status(400).json({error:"Rôle ou PIN invalide"}); db.prepare("UPDATE employees SET first_name=?,last_name=?,email=?,phone=?,role=?,permissions_json=?,pin_hash=?,active=?,updated_at=? WHERE id=? AND restaurant_id=?").run(normalizeText(req.body?.firstName||req.body?.name||row.first_name,80),normalizeText(req.body?.lastName??row.last_name,80),normalizeEmail(req.body?.email??row.email)||null,normalizeText(req.body?.phone??row.phone,40)||null,role,JSON.stringify(Array.isArray(req.body?.permissions)?req.body.permissions:json(row.permissions_json,[])),pin?hashSecret(pin):row.pin_hash,flag(req.body?.active===undefined?row.active:req.body.active),now(),row.id,req.auth.restaurantId); audit(db,req.auth,"EMPLOYEE_UPDATED","employee",row.id); res.json(employeeDto(db.prepare("SELECT * FROM employees WHERE id=?").get(row.id))); });
  function disableEmployee(req,res){ const row=db.prepare("SELECT * FROM employees WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId); if(!row)return res.status(404).json({error:"Employé introuvable"}); if(row.role==="RESTAURANT_OWNER")return res.status(400).json({error:"Le propriétaire ne peut pas être supprimé"}); db.prepare("UPDATE employees SET active=0,updated_at=? WHERE id=? AND restaurant_id=?").run(now(),row.id,req.auth.restaurantId); db.prepare("DELETE FROM sessions WHERE employee_id=? AND restaurant_id=?").run(row.id,req.auth.restaurantId); audit(db,req.auth,"EMPLOYEE_DISABLED","employee",row.id); res.json({ok:true,staff:employeeDto({...row,active:0})}); }
  app.delete("/api/employees/:id", requireTenant, permission("MANAGE_STAFF"), disableEmployee);
  app.get("/api/staff", requireTenant, permission("MANAGE_STAFF"), (req,res)=>res.json(db.prepare("SELECT * FROM employees WHERE restaurant_id=? AND active=1 ORDER BY first_name").all(req.auth.restaurantId).map(employeeDto)));
  app.post("/api/staff", requireTenant, permission("MANAGE_STAFF"), createEmployee);
  app.put("/api/staff/:id", requireTenant, permission("MANAGE_STAFF"), (req,res)=>{ const row=db.prepare("SELECT * FROM employees WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId),pin=String(req.body?.pin||""); if(!row)return res.status(404).json({error:"Employé introuvable"}); if(!/^\d{4,12}$/.test(pin))return res.status(400).json({error:"PIN invalide"}); db.prepare("UPDATE employees SET pin_hash=?,updated_at=? WHERE id=? AND restaurant_id=?").run(hashSecret(pin),now(),row.id,req.auth.restaurantId); res.json(employeeDto(row)); });
  app.delete("/api/staff/:id", requireTenant, permission("MANAGE_STAFF"), disableEmployee);

  const findTable=(restaurantId,id)=>db.prepare("SELECT * FROM restaurant_tables WHERE restaurant_id=? AND (id=? OR CAST(number AS TEXT)=?)").get(restaurantId,id,String(id));
  const tableDto=(row)=>{ const order=db.prepare("SELECT id,status FROM orders WHERE restaurant_id=? AND table_id=? AND status NOT IN ('COMPLETED','CANCELLED') ORDER BY created_at DESC LIMIT 1").get(row.restaurant_id,row.id); return {id:row.number||row.id,dbId:row.id,number:row.number,name:row.name,capacity:row.capacity,area:row.area,active:Boolean(row.active),orderId:order?.id||null,status:order?(order.status==="READY"?"to_pay":"occupied"):"free"}; };
  app.get("/api/tables", requireTenant, (req,res)=>res.json(db.prepare("SELECT * FROM restaurant_tables WHERE restaurant_id=? AND active=1 ORDER BY number,name").all(req.auth.restaurantId).map(tableDto)));
  app.post("/api/tables", requireTenant, permission("MANAGE_TABLES"), (req,res)=>{ const name=normalizeText(req.body?.name||`Table ${req.body?.number||""}`,80); if(!name)return res.status(400).json({error:"Nom requis"}); const id=randomId("table"),createdAt=now(); db.prepare("INSERT INTO restaurant_tables(id,restaurant_id,number,name,capacity,area,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)").run(id,req.auth.restaurantId,Number(req.body?.number)||null,name,Math.max(1,Number(req.body?.capacity)||2),normalizeText(req.body?.area,80)||null,createdAt,createdAt); audit(db,req.auth,"TABLE_CREATED","table",id); res.status(201).json(tableDto(db.prepare("SELECT * FROM restaurant_tables WHERE id=?").get(id))); });
  app.put("/api/tables/:id", requireTenant, permission("MANAGE_TABLES"), (req,res)=>{ const row=findTable(req.auth.restaurantId,req.params.id); if(!row)return res.status(404).json({error:"Table introuvable"}); db.prepare("UPDATE restaurant_tables SET number=?,name=?,capacity=?,area=?,active=?,updated_at=? WHERE id=? AND restaurant_id=?").run(req.body?.number===undefined?row.number:Number(req.body.number)||null,normalizeText(req.body?.name||row.name,80),Math.max(1,Number(req.body?.capacity)||row.capacity),normalizeText(req.body?.area??row.area,80)||null,flag(req.body?.active===undefined?row.active:req.body.active),now(),row.id,req.auth.restaurantId); audit(db,req.auth,"TABLE_UPDATED","table",row.id); res.json(tableDto(db.prepare("SELECT * FROM restaurant_tables WHERE id=?").get(row.id))); });
  app.delete("/api/tables/:id", requireTenant, permission("MANAGE_TABLES"), (req,res)=>{ const row=findTable(req.auth.restaurantId,req.params.id); if(!row)return res.status(404).json({error:"Table introuvable"}); if(db.prepare("SELECT 1 FROM orders WHERE restaurant_id=? AND table_id=? AND status NOT IN ('COMPLETED','CANCELLED')").get(req.auth.restaurantId,row.id))return res.status(409).json({error:"Table occupée"}); db.prepare("UPDATE restaurant_tables SET active=0,updated_at=? WHERE id=? AND restaurant_id=?").run(now(),row.id,req.auth.restaurantId); audit(db,req.auth,"TABLE_DISABLED","table",row.id); res.json({ok:true}); });

  app.get("/api/menu", requireTenant, (req,res)=>{ const categories=categoryRows(req.auth.restaurantId).map(row=>({...categoryDto(row),items:[]})),map=new Map(categories.map(item=>[item.id,item])); db.prepare("SELECT * FROM products WHERE restaurant_id=? AND active=1 AND available=1 ORDER BY position,name").all(req.auth.restaurantId).map(productWithOptions).forEach(product=>map.get(product.categoryId)?.items.push(product)); res.json(categories); });

  const employeeFor=(auth)=>auth.employeeId||db.prepare("SELECT id FROM employees WHERE restaurant_id=? AND user_id=?").get(auth.restaurantId,auth.userId)?.id||null;
  const findOrder=(restaurantId,id)=>db.prepare("SELECT * FROM orders WHERE id=? AND restaurant_id=?").get(id,restaurantId);
  const paidCentsForOrder=(restaurantId,orderId)=>db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM payments WHERE restaurant_id=? AND order_id=? AND status IN ('ACTIVE','EDITED')").get(restaurantId,orderId).total;
  const orderDto=(row)=>({ id:row.id,restaurantId:row.restaurant_id,orderNumber:row.order_number,tableId:row.table_id,employeeId:row.employee_id,status:row.status,
    items:db.prepare("SELECT * FROM order_items WHERE order_id=? AND restaurant_id=? ORDER BY rowid").all(row.id,row.restaurant_id).map(line=>({id:line.id,productId:line.product_id,name:line.name_snapshot,price:fromCents(line.unit_price_cents),qty:line.quantity,sentQty:line.sent_quantity,...json(line.metadata_json)})),
    subtotal:fromCents(row.subtotal_cents),taxes:fromCents(row.tax_cents),discount:fromCents(row.discount_cents),serviceCharge:fromCents(row.service_charge_cents),tip:fromCents(row.tip_cents),total:fromCents(row.total_cents),paidAmount:fromCents(paidCentsForOrder(row.restaurant_id,row.id)),remainingAmount:fromCents(Math.max(0,row.total_cents-paidCentsForOrder(row.restaurant_id,row.id))),paymentStatus:row.payment_status,sentToKitchen:row.kitchen_send_count>0,kitchenSendCount:row.kitchen_send_count,createdAt:row.created_at,updatedAt:row.updated_at });
  const nextOrderNumber=(restaurantId)=>db.prepare("SELECT COALESCE(MAX(order_number),0)+1 value FROM orders WHERE restaurant_id=?").get(restaurantId).value;

  app.post("/api/tables/:id/open", requireTenant, permission("CREATE_ORDERS"), (req,res)=>{ const table=findTable(req.auth.restaurantId,req.params.id); if(!table||!table.active)return res.status(404).json({error:"Table introuvable"}); let order=db.prepare("SELECT * FROM orders WHERE restaurant_id=? AND table_id=? AND status NOT IN ('COMPLETED','CANCELLED') ORDER BY created_at DESC LIMIT 1").get(req.auth.restaurantId,table.id); if(!order){ const id=randomId("order"),createdAt=now(); db.prepare("INSERT INTO orders(id,restaurant_id,order_number,table_id,employee_id,status,created_at,updated_at) VALUES (?,?,?,?,?,'OPEN',?,?)").run(id,req.auth.restaurantId,nextOrderNumber(req.auth.restaurantId),table.id,employeeFor(req.auth),createdAt,createdAt); order=findOrder(req.auth.restaurantId,id); audit(db,req.auth,"ORDER_OPENED","order",id); } res.json({table:tableDto(table),order:orderDto(order)}); });
  app.get("/api/orders/:id", requireTenant, (req,res)=>{ const row=findOrder(req.auth.restaurantId,req.params.id); return row?res.json(orderDto(row)):res.status(404).json({error:"Commande introuvable"}); });

  function orderLines(restaurantId,input){
    if(!Array.isArray(input)||input.length>200)throw Object.assign(new Error("Commande invalide"),{status:400});
    const products=db.prepare("SELECT * FROM products WHERE restaurant_id=? AND active=1").all(restaurantId),byId=new Map(products.map(product=>[product.id,product]));
    return input.map(line=>{
      const qty=Math.min(99,Math.max(0,Math.round(Number(line.qty)||0))); if(!qty)return null;
      const product=byId.get(line.productId||line.id)||byId.get(line.baseItemId)||byId.get(line.shishaFlavorId);
      const offered=Boolean(line.isOffered)&&String(line.id).startsWith("offert-");
      if(!product&&!offered)throw Object.assign(new Error("Produit non autorisé"),{status:400});
      let price=product?.price_cents||0,name=product?.name||normalizeText(line.name,240);
      if(offered)price=0; else if(line.alcoholized)price+=300; else if(line.isShisha||line.isAdditionalShishaHead)price=toCents(line.price);
      const selected=Array.isArray(line.selectedOptions)?line.selectedOptions:[], selectedIds=[...new Set(selected.map(value=>value.id||value))];
      const groups=product?db.prepare("SELECT * FROM product_option_groups WHERE restaurant_id=? AND product_id=?").all(restaurantId,product.id):[];
      let valid=[];
      if(selectedIds.length){const placeholders=selectedIds.map(()=>"?").join(",");valid=db.prepare(`SELECT po.*,pog.product_id FROM product_options po JOIN product_option_groups pog ON pog.id=po.group_id AND pog.restaurant_id=po.restaurant_id WHERE po.restaurant_id=? AND pog.product_id=? AND po.id IN (${placeholders}) AND po.active=1`).all(restaurantId,product.id,...selectedIds);if(valid.length!==selectedIds.length)throw Object.assign(new Error("Option non autorisée"),{status:400});}
      for(const group of groups){const count=valid.filter(option=>option.group_id===group.id).length;if(count<group.min_choices||count>group.max_choices)throw Object.assign(new Error(`Sélection invalide pour ${group.name}`),{status:400});}
      if(valid.length){price+=valid.reduce((sum,x)=>sum+x.price_delta_cents,0);name+=` (${valid.map(x=>x.name).join(", ")})`;}
      const metadata={...line,selectedOptions:valid.map(option=>({id:option.id,name:option.name,priceDelta:fromCents(option.price_delta_cents)}))};
      ["id","productId","name","price","qty","sentQty"].forEach(key=>delete metadata[key]);
      return {id:normalizeText(line.id,180)||randomId("line"),productId:product?.id||null,name:normalizeText(name,240),price,qty,metadata};
    }).filter(Boolean);
  }
  app.put("/api/orders/:id", requireTenant, permission("CREATE_ORDERS"), (req,res,next)=>{ const order=findOrder(req.auth.restaurantId,req.params.id); if(!order)return res.status(404).json({error:"Commande introuvable"}); if(["COMPLETED","CANCELLED"].includes(order.status))return res.status(409).json({error:"Commande clôturée"}); try{ const lines=orderLines(req.auth.restaurantId,req.body?.items),subtotal=lines.reduce((sum,line)=>sum+line.price*line.qty,0),taxRate=Math.max(0,Number(req.auth.restaurant.tax_rate)||0),tax=Math.round(subtotal-(subtotal/(1+taxRate/100))),service=Math.round(subtotal*Math.max(0,Number(req.auth.restaurant.service_charge_rate)||0)/100),discount=permitted(req,"MANAGE_PAYMENTS")?Math.min(subtotal+service,toCents(req.body?.discount??fromCents(order.discount_cents))):order.discount_cents,tip=req.auth.restaurant.tips_enabled?toCents(req.body?.tip??fromCents(order.tip_cents)):0,total=Math.max(0,subtotal+service+tip-discount),alreadyPaid=paidCentsForOrder(req.auth.restaurantId,order.id); if(total<alreadyPaid)throw Object.assign(new Error("Le total ne peut pas être inférieur au montant déjà payé"),{status:400}); tx(db,()=>{ const sent=new Map(db.prepare("SELECT id,sent_quantity FROM order_items WHERE order_id=? AND restaurant_id=?").all(order.id,req.auth.restaurantId).map(line=>[line.id,line.sent_quantity])); db.prepare("DELETE FROM order_items WHERE order_id=? AND restaurant_id=?").run(order.id,req.auth.restaurantId); const insert=db.prepare("INSERT INTO order_items(id,restaurant_id,order_id,product_id,name_snapshot,unit_price_cents,quantity,sent_quantity,metadata_json) VALUES (?,?,?,?,?,?,?,?,?)"); lines.forEach(line=>insert.run(line.id,req.auth.restaurantId,order.id,line.productId,line.name,line.price,line.qty,Math.min(line.qty,sent.get(line.id)||0),JSON.stringify(line.metadata))); db.prepare("UPDATE orders SET subtotal_cents=?,tax_cents=?,service_charge_cents=?,discount_cents=?,tip_cents=?,total_cents=?,updated_at=? WHERE id=? AND restaurant_id=?").run(subtotal,tax,service,discount,tip,total,now(),order.id,req.auth.restaurantId); }); audit(db,req.auth,"ORDER_UPDATED","order",order.id,{lineCount:lines.length}); res.json(orderDto(findOrder(req.auth.restaurantId,order.id))); }catch(error){next(error);} });
  app.post("/api/orders/:id/send-kitchen", requireTenant, permission("CREATE_ORDERS"), (req,res)=>{ const order=findOrder(req.auth.restaurantId,req.params.id); if(!order)return res.status(404).json({error:"Commande introuvable"}); const lines=db.prepare("SELECT * FROM order_items WHERE order_id=? AND restaurant_id=? AND quantity>sent_quantity").all(order.id,req.auth.restaurantId); if(!lines.length)return res.status(400).json({error:"Aucun nouvel article"}); const sentAt=now(),kitchenItems=lines.map(line=>({name:line.name_snapshot,qty:line.quantity-line.sent_quantity,price:fromCents(line.unit_price_cents)})); tx(db,()=>{db.prepare("UPDATE order_items SET sent_quantity=quantity WHERE order_id=? AND restaurant_id=?").run(order.id,req.auth.restaurantId);db.prepare("UPDATE orders SET status='IN_PROGRESS',kitchen_send_count=kitchen_send_count+1,updated_at=? WHERE id=? AND restaurant_id=?").run(sentAt,order.id,req.auth.restaurantId);}); audit(db,req.auth,"ORDER_SENT_TO_KITCHEN","order",order.id); res.json({ok:true,order:orderDto(findOrder(req.auth.restaurantId,order.id)),kitchenTicket:{sentAt,type:order.kitchen_send_count?"supplement":"initial",items:kitchenItems}}); });
  app.post("/api/orders/:id/mark-to-pay", requireTenant, permission("CREATE_ORDERS"), (req,res)=>{ const order=findOrder(req.auth.restaurantId,req.params.id); if(!order)return res.status(404).json({error:"Commande introuvable"}); db.prepare("UPDATE orders SET status='READY',updated_at=? WHERE id=? AND restaurant_id=?").run(now(),order.id,req.auth.restaurantId); audit(db,req.auth,"ORDER_READY_TO_PAY","order",order.id); res.json(orderDto(findOrder(req.auth.restaurantId,order.id))); });
  app.post("/api/orders/:id/settle", requireTenant, permission("TAKE_PAYMENTS"), (req,res)=>{ const order=findOrder(req.auth.restaurantId,req.params.id); if(!order)return res.status(404).json({error:"Commande introuvable"}); if(order.payment_status==="PAID")return res.status(409).json({error:"Commande déjà payée"}); const paidCash=toCents(req.body?.paymentAmounts?.cash),paidCard=toCents(req.body?.paymentAmounts?.card),paid=paidCash+paidCard,previouslyPaid=paidCentsForOrder(req.auth.restaurantId,order.id),remaining=Math.max(0,order.total_cents-previouslyPaid); if(paid<=0)return res.status(400).json({error:"Introduisez un montant à encaisser"}); if(remaining<=0)return res.status(409).json({error:"Commande déjà payée"}); const amount=Math.min(paid,remaining),card=Math.min(paidCard,amount),cash=Math.max(0,amount-card),change=Math.max(0,paid-amount),method=cash&&card?"SPLIT":cash?"CASH":"CARD",id=randomId("payment"),date=now(),fullyPaid=previouslyPaid+amount>=order.total_cents; tx(db,()=>{db.prepare("INSERT INTO payments(id,restaurant_id,order_id,employee_id,method,amount_cents,cash_cents,card_cents,change_cents,status,include_in_daily,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',1,?,?)").run(id,req.auth.restaurantId,order.id,employeeFor(req.auth),method,amount,cash,card,change,date,date);db.prepare("UPDATE orders SET status=?,payment_status=?,updated_at=? WHERE id=? AND restaurant_id=?").run(fullyPaid?"COMPLETED":"READY",fullyPaid?"PAID":"PARTIAL",date,order.id,req.auth.restaurantId);}); audit(db,req.auth,"PAYMENT_CAPTURED","payment",id,{orderId:order.id,method,partial:!fullyPaid,remainingCents:Math.max(0,remaining-amount)}); const table=db.prepare("SELECT * FROM restaurant_tables WHERE id=? AND restaurant_id=?").get(order.table_id,req.auth.restaurantId),dto=orderDto(findOrder(req.auth.restaurantId,order.id)),r=req.auth.restaurant; res.json({id,restaurant:r.name,restaurantAddress:[r.address,r.postal_code,r.city].filter(Boolean).join(", "),vatNumber:r.vat_number,ticketNumber:order.order_number,table:table?.name||"-",date,items:previouslyPaid===0&&fullyPaid?dto.items:[],totalTtc:fromCents(amount),orderTotal:fromCents(order.total_cents),paidTotal:dto.paidAmount,remainingBalance:dto.remainingAmount,partial:!fullyPaid,totalCash:fromCents(cash),totalCard:fromCents(card),paidCash:fromCents(paidCash),paidCard:fromCents(paidCard),changeDue:fromCents(change),paymentMethod:method.toLowerCase(),paidBy:actorDto(req.auth.actor,req.auth.userId?"user":"employee"),order:dto}); });

  function ticket(row){ const order=findOrder(row.restaurant_id,row.order_id),r=db.prepare("SELECT * FROM restaurants WHERE id=?").get(row.restaurant_id),table=db.prepare("SELECT * FROM restaurant_tables WHERE id=?").get(order.table_id); return {id:row.id,restaurant:r.name,vatNumber:r.vat_number,ticketNumber:order.order_number,table:table?.name||"-",date:row.created_at,items:orderDto(order).items,totalTtc:fromCents(row.amount_cents),totalCash:fromCents(row.cash_cents),totalCard:fromCents(row.card_cents),paidCash:fromCents(row.cash_cents+row.change_cents),paidCard:fromCents(row.card_cents),changeDue:fromCents(row.change_cents),paymentMethod:row.method.toLowerCase(),status:row.status.toLowerCase(),includeInDaily:Boolean(row.include_in_daily),paidBy:null}; }
  app.get("/api/payments/history", requireTenant, permission("VIEW_REPORTS"), (req,res)=>{ const date=/^\d{4}-\d{2}-\d{2}$/.test(req.query.date||"")?req.query.date:null,sql=`SELECT * FROM payments WHERE restaurant_id=? ${date?"AND substr(created_at,1,10)=?":""} ORDER BY created_at DESC`; res.json(db.prepare(sql).all(...(date?[req.auth.restaurantId,date]:[req.auth.restaurantId])).map(ticket)); });
  app.put("/api/payments/history/:id", requireTenant, permission("MANAGE_PAYMENTS"), (req,res)=>{ const row=db.prepare("SELECT * FROM payments WHERE id=? AND restaurant_id=?").get(req.params.id,req.auth.restaurantId); if(!row)return res.status(404).json({error:"Paiement introuvable"}); const paidCash=req.body?.cash===undefined?row.cash_cents+row.change_cents:toCents(req.body.cash),paidCard=req.body?.card===undefined?row.card_cents:toCents(req.body.card); if(paidCash+paidCard<row.amount_cents)return res.status(400).json({error:"Montant insuffisant"}); const card=Math.min(paidCard,row.amount_cents),cash=row.amount_cents-card,change=paidCash+paidCard-row.amount_cents; db.prepare("UPDATE payments SET cash_cents=?,card_cents=?,change_cents=?,method=?,status='EDITED',include_in_daily=?,updated_at=? WHERE id=? AND restaurant_id=?").run(cash,card,change,cash&&card?"SPLIT":cash?"CASH":"CARD",flag(req.body?.includeInDaily!==false),now(),row.id,req.auth.restaurantId); audit(db,req.auth,"PAYMENT_UPDATED","payment",row.id); res.json(ticket(db.prepare("SELECT * FROM payments WHERE id=?").get(row.id))); });
  app.delete("/api/payments/history/:id", requireTenant, permission("MANAGE_PAYMENTS"), (req,res)=>{ const result=db.prepare("UPDATE payments SET status='DELETED',include_in_daily=0,updated_at=? WHERE id=? AND restaurant_id=?").run(now(),req.params.id,req.auth.restaurantId); if(!result.changes)return res.status(404).json({error:"Paiement introuvable"}); audit(db,req.auth,"PAYMENT_DELETED","payment",req.params.id); res.json(ticket(db.prepare("SELECT * FROM payments WHERE id=?").get(req.params.id))); });

  function daily(restaurantId,date){ const r=db.prepare("SELECT * FROM restaurants WHERE id=?").get(restaurantId),rows=db.prepare("SELECT * FROM payments WHERE restaurant_id=? AND substr(created_at,1,10)=? AND status!='DELETED' AND include_in_daily=1 ORDER BY created_at").all(restaurantId,date),tickets=rows.map(ticket),items=new Map(),orderIds=[...new Set(rows.map(row=>row.order_id))]; orderIds.forEach(orderId=>{const order=findOrder(restaurantId,orderId),lastPayment=db.prepare("SELECT * FROM payments WHERE restaurant_id=? AND order_id=? AND status IN ('ACTIVE','EDITED') ORDER BY created_at DESC,rowid DESC LIMIT 1").get(restaurantId,orderId);if(!order||order.payment_status!=="PAID"||!lastPayment||lastPayment.created_at.slice(0,10)!==date)return;orderDto(order).items.forEach(line=>{const item=items.get(line.name)||{name:line.name,qty:0,total:0};item.qty+=line.qty;item.total+=line.price*line.qty;items.set(line.name,item);});}); return {restaurant:r.name,date,vatNumber:r.vat_number,totalTtc:fromCents(rows.reduce((s,x)=>s+x.amount_cents,0)),totalCash:fromCents(rows.reduce((s,x)=>s+x.cash_cents,0)),totalCard:fromCents(rows.reduce((s,x)=>s+x.card_cents,0)),tickets,items:[...items.values()]}; }
  app.get("/api/reports/daily", requireTenant, permission("VIEW_REPORTS"), (req,res)=>res.json(daily(req.auth.restaurantId,/^\d{4}-\d{2}-\d{2}$/.test(req.query.date||"")?req.query.date:now().slice(0,10))));
  app.post("/api/reports/daily/send", requireTenant, permission("VIEW_REPORTS"), (_req,res)=>res.json({ok:true,sent:false,reason:"Intégration externe à configurer par restaurant"}));
  app.get("/api/reports/staff", requireTenant, permission("VIEW_REPORTS"), (req,res)=>{ const date=/^\d{4}-\d{2}-\d{2}$/.test(req.query.date||"")?req.query.date:now().slice(0,10),reports=db.prepare("SELECT * FROM employees WHERE restaurant_id=? ORDER BY first_name").all(req.auth.restaurantId).map(employee=>{const rows=db.prepare("SELECT * FROM payments WHERE restaurant_id=? AND employee_id=? AND substr(created_at,1,10)=? AND status!='DELETED'").all(req.auth.restaurantId,employee.id,date);return{staff:employeeDto(employee),ticketCount:rows.length,totalTtc:fromCents(rows.reduce((s,x)=>s+x.amount_cents,0)),totalCash:fromCents(rows.reduce((s,x)=>s+x.cash_cents,0)),totalCard:fromCents(rows.reduce((s,x)=>s+x.card_cents,0)),tickets:rows.map(ticket),pointages:[]};});res.json({date,reports}); });

  app.get("/api/kitchen/orders", requireTenant, permission("VIEW_KITCHEN"), (req,res)=>{ const rows=db.prepare("SELECT o.*,t.name table_name FROM orders o LEFT JOIN restaurant_tables t ON t.id=o.table_id AND t.restaurant_id=o.restaurant_id WHERE o.restaurant_id=? AND o.kitchen_send_count>0 AND o.status IN ('IN_PROGRESS','READY') ORDER BY o.created_at").all(req.auth.restaurantId);res.json(rows.map(row=>({...orderDto(row),tableName:row.table_name||"Sans table"}))); });
  app.patch("/api/kitchen/orders/:id/status", requireTenant, permission("VIEW_KITCHEN"), (req,res)=>{ const order=findOrder(req.auth.restaurantId,req.params.id),status=String(req.body?.status||"").toUpperCase();if(!order)return res.status(404).json({error:"Commande introuvable"});if(!["IN_PROGRESS","READY"].includes(status))return res.status(400).json({error:"Statut cuisine invalide"});db.prepare("UPDATE orders SET status=?,updated_at=? WHERE id=? AND restaurant_id=?").run(status,now(),order.id,req.auth.restaurantId);audit(db,req.auth,`KITCHEN_${status}`,"order",order.id);res.json(orderDto(findOrder(req.auth.restaurantId,order.id))); });

  app.get("/api/dashboard", requireTenant, permission("VIEW_REPORTS"), (req,res)=>{ const days=Math.min(366,Math.max(1,Number(req.query.days)||1)),since=new Date(Date.now()-(days-1)*86400000).toISOString().slice(0,10),a=db.prepare("SELECT COUNT(*) orders,COALESCE(SUM(amount_cents),0) revenue,COALESCE(SUM(cash_cents),0) cash,COALESCE(SUM(card_cents),0) card FROM payments WHERE restaurant_id=? AND substr(created_at,1,10)>=? AND status!='DELETED' AND include_in_daily=1").get(req.auth.restaurantId,since),top=db.prepare("SELECT oi.name_snapshot name,SUM(oi.quantity) quantity,SUM(oi.quantity*oi.unit_price_cents) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id AND o.restaurant_id=oi.restaurant_id WHERE oi.restaurant_id=? AND o.status='COMPLETED' AND substr(o.created_at,1,10)>=? GROUP BY oi.name_snapshot ORDER BY quantity DESC LIMIT 10").all(req.auth.restaurantId,since).map(x=>({name:x.name,quantity:x.quantity,revenue:fromCents(x.revenue)}));res.json({period:{since,days},revenue:fromCents(a.revenue),orders:a.orders,averageBasket:a.orders?fromCents(Math.round(a.revenue/a.orders)):0,cash:fromCents(a.cash),card:fromCents(a.card),topProducts:top}); });

  app.get("/api/super-admin/overview", roles("SUPER_ADMIN"), (_req,res)=>{ const counts=db.prepare("SELECT status,COUNT(*) count FROM restaurants GROUP BY status").all(),restaurants=counts.reduce((a,x)=>(a.total+=x.count,a[x.status.toLowerCase()]=x.count,a),{total:0,active:0,suspended:0,disabled:0});res.json({restaurants,users:db.prepare("SELECT COUNT(*) count FROM users").get().count,employees:db.prepare("SELECT COUNT(*) count FROM employees").get().count,orders:db.prepare("SELECT COUNT(*) count FROM orders").get().count,revenue:fromCents(db.prepare("SELECT COALESCE(SUM(amount_cents),0) total FROM payments WHERE status!='DELETED'").get().total)}); });
  app.get("/api/super-admin/restaurants", roles("SUPER_ADMIN"), (req,res)=>{ const search=`%${normalizeText(req.query.search,100)}%`,rows=db.prepare("SELECT r.*,(SELECT email FROM users u WHERE u.restaurant_id=r.id AND u.role='RESTAURANT_OWNER' LIMIT 1) owner_email,(SELECT COUNT(*) FROM employees e WHERE e.restaurant_id=r.id) employee_count,(SELECT COUNT(*) FROM products p WHERE p.restaurant_id=r.id) product_count,(SELECT COUNT(*) FROM orders o WHERE o.restaurant_id=r.id) order_count FROM restaurants r WHERE r.name LIKE ? OR r.email LIKE ? ORDER BY r.created_at DESC").all(search,search);res.json(rows.map(row=>({...restaurantDto(row),ownerEmail:row.owner_email,employeeCount:row.employee_count,productCount:row.product_count,orderCount:row.order_count}))); });
  app.get("/api/super-admin/restaurants/:id", roles("SUPER_ADMIN"), (req,res)=>{ const r=db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id);if(!r)return res.status(404).json({error:"Restaurant introuvable"});res.json({restaurant:restaurantDto(r),users:db.prepare("SELECT * FROM users WHERE restaurant_id=?").all(r.id).map(x=>actorDto(x,"user")),employees:db.prepare("SELECT * FROM employees WHERE restaurant_id=?").all(r.id).map(employeeDto),categories:categoryRows(r.id,true).map(categoryDto),products:db.prepare("SELECT * FROM products WHERE restaurant_id=?").all(r.id).map(productDto),tables:db.prepare("SELECT * FROM restaurant_tables WHERE restaurant_id=?").all(r.id).map(tableDto),recentOrders:db.prepare("SELECT * FROM orders WHERE restaurant_id=? ORDER BY created_at DESC LIMIT 50").all(r.id).map(orderDto),logs:db.prepare("SELECT * FROM audit_logs WHERE restaurant_id=? ORDER BY created_at DESC LIMIT 100").all(r.id)}); });
  app.patch("/api/super-admin/restaurants/:id/status", roles("SUPER_ADMIN"), (req,res)=>{ const status=String(req.body?.status||"").toUpperCase();if(!["ACTIVE","SUSPENDED","DISABLED"].includes(status))return res.status(400).json({error:"Statut invalide"});const result=db.prepare("UPDATE restaurants SET status=?,updated_at=? WHERE id=?").run(status,now(),req.params.id);if(!result.changes)return res.status(404).json({error:"Restaurant introuvable"});if(status!=="ACTIVE")db.prepare("DELETE FROM sessions WHERE restaurant_id=?").run(req.params.id);audit(db,req.auth,`RESTAURANT_${status}`,"restaurant",req.params.id);res.json(restaurantDto(db.prepare("SELECT * FROM restaurants WHERE id=?").get(req.params.id))); });

  app.use(express.static(cfg.publicDir,{index:false,etag:true,maxAge:cfg.nodeEnv==="production"?"1h":0}));
  app.get("/dashboard",(req,res)=>{const auth=session(req);if(!auth)return res.redirect("/login");if(!MANAGERS.has(auth.role))return res.redirect("/");res.sendFile(path.join(cfg.publicDir,"dashboard.html"));});
  app.get("/kitchen",(req,res)=>{const auth=session(req);if(!auth)return res.redirect("/login");if(!auth.restaurantId||!["SUPER_ADMIN","RESTAURANT_OWNER","MANAGER","KITCHEN"].includes(auth.role))return res.status(403).send("Accès interdit");res.sendFile(path.join(cfg.publicDir,"kitchen.html"));});
  app.get("/super-admin",(req,res)=>{const auth=session(req);if(!auth)return res.redirect("/login");if(auth.role!=="SUPER_ADMIN")return res.status(403).send("Accès interdit");res.sendFile(path.join(cfg.publicDir,"super-admin.html"));});
  app.get("/",(req,res)=>{const auth=session(req);if(!auth)return res.redirect("/login");if(auth.role==="SUPER_ADMIN")return res.redirect("/super-admin");if(auth.role==="KITCHEN")return res.redirect("/kitchen");res.sendFile(path.join(cfg.publicDir,"index.html"));});
  app.use((req,res)=>session(req)?res.redirect("/"):res.redirect("/login"));
  app.use((error,req,res,_next)=>{const status=error.status||(String(error.message).includes("UNIQUE constraint")?409:500);if(status>=500)console.error("Erreur serveur",{method:req.method,path:req.path,message:error.message});res.status(status).json({error:status>=500?"Erreur interne":error.message});});
  app.locals.db=db;
  return app;
}

module.exports = { createApp };
