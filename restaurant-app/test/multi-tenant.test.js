const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../src/app");
const { hashSecret, randomId } = require("../src/security");

let app, server, base;

async function request(path, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

async function signup(suffix) {
  return request("/api/auth/signup", { method: "POST", body: {
    firstName: "Owner", lastName: suffix === "A" ? "Alpha" : "Beta", email: `owner-${suffix.toLowerCase()}@example.test`,
    password: `correct horse battery ${suffix}`, restaurantName: `Restaurant ${suffix}`,
    city: suffix === "A" ? "Bruxelles" : "Liège", country: "BE", currency: "EUR"
  } });
}

test.before(async () => {
  app = createApp({ databasePath: ":memory:", seed: false, nodeEnv: "test" });
  server = app.listen(0); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(() => { app.locals.db.close(); resolve(); })));

test("deux restaurants restent strictement isolés et le Super Admin voit les deux", async () => {
  const a = await signup("A"), b = await signup("B");
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.notEqual(a.body.restaurant.id, b.body.restaurant.id);

  const categoryA = await request("/api/categories", { cookie: a.cookie, method: "POST", body: { name: "Burgers A" } });
  const categoryB = await request("/api/categories", { cookie: b.cookie, method: "POST", body: { name: "Sushis B" } });
  assert.equal(categoryA.status, 201); assert.equal(categoryB.status, 201);
  const productA = await request("/api/products", { cookie: a.cookie, method: "POST", body: { categoryId: categoryA.body.id, name: "Burger A", price: 12 } });
  const productB = await request("/api/products", { cookie: b.cookie, method: "POST", body: { categoryId: categoryB.body.id, name: "Sushi B", price: 18 } });
  assert.equal(productA.status, 201); assert.equal(productB.status, 201);
  await request("/api/employees", { cookie: a.cookie, method: "POST", body: { firstName: "Alice", role: "WAITER", pin: "1111" } });
  await request("/api/employees", { cookie: b.cookie, method: "POST", body: { firstName: "Bob", role: "WAITER", pin: "2222" } });
  await request("/api/tables", { cookie: a.cookie, method: "POST", body: { number: 1, name: "Table A" } });
  await request("/api/tables", { cookie: b.cookie, method: "POST", body: { number: 1, name: "Table B" } });

  const menuA = await request("/api/menu", { cookie: a.cookie });
  const menuB = await request("/api/menu", { cookie: b.cookie });
  assert.deepEqual(menuA.body.map(x => x.name), ["Burgers A"]);
  assert.deepEqual(menuB.body.map(x => x.name), ["Sushis B"]);
  assert.equal(menuA.body[0].items[0].name, "Burger A");
  assert.equal(menuB.body[0].items[0].name, "Sushi B");

  const crossProduct = await request(`/api/products/${productB.body.id}`, { cookie: a.cookie, method: "PUT", body: { name: "Volé" } });
  assert.equal(crossProduct.status, 404);
  const crossCategory = await request(`/api/categories/${categoryB.body.id}`, { cookie: a.cookie, method: "DELETE" });
  assert.equal(crossCategory.status, 404);

  const settings = await request("/api/restaurant/current", { cookie: a.cookie, method: "PUT", body: { name: "Restaurant A", country: "BE", currency: "EUR", timezone: "Europe/Brussels", language: "fr", taxRate: 12, serviceChargeRate: 10 } });
  assert.equal(settings.status, 200);
  const configured = await request(`/api/products/${productA.body.id}/options`, { cookie: a.cookie, method: "PUT", body: { groups: [{ name: "Suppléments", required: false, maxChoices: 2, options: [{ name: "Fromage", priceDelta: 1 }] }] } });
  assert.equal(configured.status, 200);
  const option = configured.body.optionGroups[0].options[0];
  const opened = await request("/api/tables/1/open", { cookie: a.cookie, method: "POST" });
  assert.equal(opened.status, 200);
  const updated = await request(`/api/orders/${opened.body.order.id}`, { cookie: a.cookie, method: "PUT", body: { items: [{ id: `option-${productA.body.id}-${option.id}`, productId: productA.body.id, baseItemId: productA.body.id, name: "Prix falsifié", price: 0, qty: 1, selectedOptions: [{ id: option.id }] }] } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.subtotal, 13);
  assert.equal(updated.body.serviceCharge, 1.3);
  assert.equal(updated.body.total, 14.3);
  assert.equal(updated.body.taxes, 1.39);
  const kitchenSend = await request(`/api/orders/${opened.body.order.id}/send-kitchen`, { cookie: a.cookie, method: "POST" });
  assert.equal(kitchenSend.status, 200);
  assert.equal(kitchenSend.body.kitchenTicket.items[0].name, "Burger A (Fromage)");
  const kitchenA = await request("/api/kitchen/orders", { cookie: a.cookie });
  const kitchenB = await request("/api/kitchen/orders", { cookie: b.cookie });
  assert.equal(kitchenA.body.length, 1);
  assert.equal(kitchenB.body.length, 0);
  const ready = await request(`/api/kitchen/orders/${opened.body.order.id}/status`, { cookie: a.cookie, method: "PATCH", body: { status: "READY" } });
  assert.equal(ready.status, 200);
  const partial = await request(`/api/orders/${opened.body.order.id}/settle`, { cookie: a.cookie, method: "POST", body: { paymentAmounts: { cash: 5, card: 0 } } });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.partial, true);
  assert.equal(partial.body.totalTtc, 5);
  assert.equal(partial.body.remainingBalance, 9.3);
  assert.equal(partial.body.order.paymentStatus, "PARTIAL");
  const tableAfterPartial = await request("/api/tables", { cookie: a.cookie });
  assert.equal(tableAfterPartial.body.find(table => table.id === 1).status, "to_pay");
  const paid = await request(`/api/orders/${opened.body.order.id}/settle`, { cookie: a.cookie, method: "POST", body: { paymentAmounts: { cash: 0, card: 9.3 } } });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.partial, false);
  assert.equal(paid.body.totalTtc, 9.3);
  assert.equal(paid.body.remainingBalance, 0);
  assert.equal(paid.body.order.paymentStatus, "PAID");
  const tableAfterFullPayment = await request("/api/tables", { cookie: a.cookie });
  assert.equal(tableAfterFullPayment.body.find(table => table.id === 1).status, "free");
  const dailyReport = await request("/api/reports/daily", { cookie: a.cookie });
  assert.equal(dailyReport.body.totalTtc, 14.3);
  assert.equal(dailyReport.body.items.length, 1);
  assert.equal(dailyReport.body.items[0].qty, 1);

  const db = app.locals.db, timestamp = new Date().toISOString();
  db.prepare("INSERT INTO users(id,restaurant_id,first_name,last_name,email,password_hash,role,permissions_json,active,created_at,updated_at) VALUES (?,NULL,?,?,?,?, 'SUPER_ADMIN','[]',1,?,?)")
    .run(randomId("user"), "Super", "Admin", "super@example.test", hashSecret("an excellent admin password"), timestamp, timestamp);
  const login = await request("/api/auth/login", { method: "POST", body: { email: "super@example.test", password: "an excellent admin password" } });
  assert.equal(login.status, 200);
  const restaurants = await request("/api/super-admin/restaurants", { cookie: login.cookie });
  assert.equal(restaurants.status, 200);
  assert.deepEqual(new Set(restaurants.body.map(x => x.name)), new Set(["Restaurant A", "Restaurant B"]));

  const suspend = await request(`/api/super-admin/restaurants/${a.body.restaurant.id}/status`, { cookie: login.cookie, method: "PATCH", body: { status: "SUSPENDED" } });
  assert.equal(suspend.status, 200);
  const revoked = await request("/api/menu", { cookie: a.cookie });
  assert.equal(revoked.status, 401);
});
