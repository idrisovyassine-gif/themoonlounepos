const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const express = require("express");
const cors = require("cors");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) return;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) return;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value.replace(/\\n/g, "\n");
  });
};

loadEnvFile(path.join(__dirname, ".env"));

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_COOKIE_NAME = "moonlounge_auth";
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const authSessions = new Map();

app.use(cors());
app.use(express.json());

const RESTAURANT_NAME = "The Moon Brussels";
const COMPANY_VAT_NUMBER = (process.env.COMPANY_VAT_NUMBER || "BE 0773 802 850").trim();
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const STAFF_FILE = path.join(DATA_DIR, "staff.json");
const POS_STATE_FILE = path.join(DATA_DIR, "pos-state.json");

const hashPin = (pin) => crypto.createHash("sha256").update(String(pin)).digest("hex");

const readJsonFile = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Impossible de lire ${path.basename(filePath)}`, error);
    return fallback;
  }
};

const writeJsonFile = (filePath, value) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
};

const normalizeStaffName = (value) => String(value || "").trim().replace(/\s+/g, " ");
const staffNameKey = (value) => normalizeStaffName(value).toLocaleLowerCase("fr-BE");
const publicStaff = (staff) => ({ id: staff.id, name: staff.name, role: staff.role });

const initialStaff = () => [
  {
    id: "ilyes",
    name: "Ilias",
    role: "manager",
    pinHash: hashPin("1140"),
    createdAt: new Date().toISOString()
  },
  {
    id: "celia",
    name: "Celia",
    role: "server",
    pinHash: hashPin("1205"),
    createdAt: new Date().toISOString()
  }
];

const loadStaff = () => {
  const saved = readJsonFile(STAFF_FILE, null);
  if (Array.isArray(saved) && saved.some((staff) => staff?.role === "manager")) {
    const staff = saved.filter((member) => member?.id && member?.name && member?.pinHash && member?.role);
    const manager = staff.find((member) => member.id === "ilyes" && member.role === "manager");
    if (manager?.name === "Ilyes") {
      manager.name = "Ilias";
      writeJsonFile(STAFF_FILE, staff);
    }
    return staff;
  }
  const staff = initialStaff();
  writeJsonFile(STAFF_FILE, staff);
  return staff;
};

let staffMembers = loadStaff();
const saveStaff = () => writeJsonFile(STAFF_FILE, staffMembers);

// Menu complet (ASCII pour compatibilite)
const menu = [
  {
    id: "promotions",
    label: "Promotions",
    items: [
      { id: "promo-filles", name: "Promo filles: shisha + boisson (tete base 15)", price: 10.0 },
      { id: "promo-hommes", name: "Promo hommes: shisha + boisson (tete base 15)", price: 15.0 }
    ]
  },
  {
    id: "softs-classiques",
    label: "Softs Classiques",
    items: [
      { id: "coca-cola", name: "Coca-Cola / Coca-Cola Zero", price: 4.0 },
      { id: "fanta", name: "Fanta Orange / Citron", price: 4.0 },
      { id: "sprite", name: "Sprite", price: 4.0 },
      { id: "ice-tea", name: "Ice Tea (Peche, Citron)", price: 4.0 },
      { id: "red-bull", name: "Red Bull", price: 5.0 },
      { id: "jooza", name: "Jus de fruits Jooza (Orange, Pomme, Ananas, Mangue, Fraise, Framboise)", price: 4.0 },
      { id: "oasis", name: "Oasis tropical", price: 4.0 },
      { id: "eau-1l", name: "Bouteille eau 1L (plate ou gazeuse)", price: 5.0 }
    ]
  },
  {
    id: "boissons-chaudes",
    label: "Boissons Chaudes",
    items: [
      { id: "cafe-expresso-allonge", name: "Cafe expresso / allonge", price: 4.0 },
      { id: "cappuccino-latte", name: "Cappuccino / Cafe latte", price: 4.0 },
      { id: "chocolat-chaud", name: "Chocolat chaud", price: 4.0 },
      { id: "the-menthe", name: "The a la menthe", price: 4.0 },
      { id: "infusions", name: "Infusions (verveine, camomille, menthe)", price: 4.0 }
    ]
  },
  {
    id: "smoothie-maison",
    label: "Smoothie Maison",
    items: [
      { id: "tropical", name: "Tropical (Ananas, mangue, banane)", price: 8.0 },
      { id: "fruit-rouge", name: "Fruit Rouge (Fraise, framboise, cerise)", price: 8.0 },
      { id: "chillout", name: "Chillout (Myrtille, avocat, banane)", price: 8.0 },
      { id: "carotte-banane", name: "Carotte-Banane (Carottes, banane, gingembre)", price: 8.0 },
      { id: "mango-avocat", name: "Mango-Avocat (Mangue, avocat, lait d'amande)", price: 8.0 },
      { id: "berry-bliss", name: "Berry Bliss (Myrtille, framboise, fraise)", price: 8.0 },
      { id: "green-goddess", name: "Green Goddess (Epinards, banane, avocat)", price: 8.0 },
      { id: "orange-sunrise", name: "Orange Sunrise", price: 8.0 }
    ]
  },
  {
    id: "alcools",
    label: "Alcools",
    items: [
      { id: "baileys", name: "Bailey's", price: 8.0 },
      { id: "vodka", name: "Vodka (Absolut, Smirnoff, Eristoff)", price: 12.0 },
      { id: "vodka-premium", name: "Vodka Premium (Belvedere, Grey Goose)", price: 15.0 },
      { id: "whisky", name: "Whisky (Jack Daniels, Jameson, Red Label)", price: 13.0 },
      { id: "whisky-premium", name: "Whisky Premium (Chivas 12, Glenfiddich 12)", price: 15.0 },
      { id: "rhum", name: "Rhum (Havana Club, Bacardi, Captain Morgan)", price: 12.0 },
      { id: "rhum-premium", name: "Rhum Premium (Diplomatico, Zacapa, Don Papa)", price: 15.0 },
      { id: "gin", name: "Gin (Beefeater, Bombay)", price: 12.0 },
      { id: "cognac", name: "Cognac (Hennessy VS, Courvoisier)", price: 15.0 }
    ]
  },
  {
    id: "mocktails",
    label: "Nos Mocktails",
    items: [
      { id: "the-moon-rose", name: "The Moon Rose", price: 9.0 },
      { id: "blue-lady", name: "Blue Lady", price: 9.0 },
      { id: "fleur-amour", name: "Fleur d'Amour", price: 9.0 },
      { id: "pina-colada", name: "Pina Colada", price: 9.0 },
      { id: "sex-on-the-beach", name: "Sex on the beach", price: 9.0 }
    ]
  },
  {
    id: "mojitos",
    label: "Nos Mojitos",
    items: [
      { id: "mojito-fraise", name: "Mojito Fraise", price: 9.0 },
      { id: "mojito-peche", name: "Mojito Peche", price: 9.0 },
      { id: "mojito-violette", name: "Mojito Violette", price: 9.0 },
      { id: "mojito-pasteque", name: "Mojito Pasteque", price: 9.0 },
      { id: "mojito-passion", name: "Mojito Fruit de la passion", price: 9.0 },
      { id: "mojito-blue-lagoon", name: "Mojito Blue Lagoon", price: 9.0 }
    ]
  },
  {
    id: "vins-champagnes",
    label: "Vins & Champagnes",
    items: [
      { id: "verre-vin", name: "Verre de vin (Rouge / Blanc / Rose)", price: 6.0 },
      { id: "bouteille-vin", name: "Bouteille de vin (Rouge / Blanc / Rose)", price: 30.0 },
      { id: "cava", name: "Cava (Blanc / Rose)", price: 40.0 }
    ]
  },
  {
    id: "bieres",
    label: "Bieres",
    items: [
      { id: "heineken-corona-desperados", name: "Heineken / Corona / Desperados", price: 6.0 },
      { id: "kriek", name: "Kriek", price: 6.0 },
      { id: "leffe-chimay", name: "Leffe / Chimay", price: 7.0 }
    ]
  },
  {
    id: "bouteilles-spiritueux",
    label: "Bouteilles Spiritueux",
    items: [
      { id: "vodka-bottle", name: "Vodka (Absolut, Smirnoff, Eristoff)", price: 110.0 },
      { id: "vodka-premium-bottle", name: "Vodka Premium (Belvedere, Grey Goose)", price: 160.0 },
      { id: "whisky-bottle", name: "Whisky (Jack Daniels, Jameson, Red Label)", price: 120.0 },
      { id: "whisky-premium-bottle", name: "Whisky Premium (Chivas 12, Glenfiddich 12)", price: 180.0 },
      { id: "rhum-bottle", name: "Rhum (Havana Club, Bacardi, Captain Morgan)", price: 110.0 },
      { id: "rhum-premium-bottle", name: "Rhum Premium (Diplomatico, Zacapa, Don Papa)", price: 180.0 },
      { id: "gin-bottle", name: "Gin (Beefeater, Bombay)", price: 110.0 },
      { id: "cognac-bottle", name: "Cognac (Hennessy VS, Courvoisier)", price: 160.0 }
    ]
  },
  {
    id: "champagnes-autres",
    label: "Champagnes & Autres",
    items: [
      { id: "jagermeister", name: "Jagermeister", price: 120.0 },
      { id: "veuve-clicquot", name: "Veuve Clicquot Brut", price: 140.0 },
      { id: "moet-chandon", name: "Moet & Chandon Brut", price: 150.0 },
      { id: "ruinart", name: "Ruinart", price: 280.0 },
      { id: "dom-perignon", name: "Dom Perignon", price: 380.0 }
    ]
  },
  {
    id: "snacks",
    label: "Snacks",
    items: [
      { id: "snack-calamars-frits", name: "Calamars frits sauce tartare (8 pcs)", price: 10.0 },
      { id: "snack-samoussa-boeuf", name: "Samoussa farci au boeuf, sauce aigre-douce (8 pcs)", price: 10.0 },
      { id: "snack-wings-chef", name: "Wings du chef sauce aigre-douce (7 pcs)", price: 10.0 },
      { id: "snack-nachos-mexicains", name: "Nachos mexicains", price: 10.0 },
      { id: "snack-loempia", name: "Loempia", price: 10.0 },
      { id: "snack-croquemonsieur", name: "Croquemonsieur (2pcs)", price: 12.0 }
    ]
  },
  {
    id: "desserts",
    label: "Nos Desserts",
    items: [
      { id: "dessert-creme-brulee", name: "Creme brulee", price: 8.0 },
      { id: "dessert-mousse-chocolat", name: "Mousse au chocolat", price: 8.0 },
      { id: "dessert-fondant-chocolat", name: "Fondant chocolat", price: 8.0 },
      { id: "dessert-boule-vanille", name: "Boule vanille", price: 8.0 },
      { id: "dessert-tiramisu-boudoir", name: "Tiramisu boudoir maison", price: 8.0 },
      { id: "dessert-tiramisu-speculose", name: "Tiramisu speculose maison", price: 8.0 },
      { id: "dessert-tarte-pomme", name: "Tarte pomme", price: 8.0 },
      { id: "dessert-saint-sebastian", name: "Saint Sebastian (coulis pistach / coulis nutella)", price: 10.0 }
    ]
  },
  {
    id: "shisha",
    label: "Shisha",
    items: [
      { id: "tete-supplementaire", name: "Tete supplementaire", price: 0.0, isAdditionalShishaHead: true },
      { id: "double-pomme", name: "Double pomme", price: 0.0, isShisha: true },
      { id: "love-66", name: "Love 66", price: 0.0, isShisha: true },
      { id: "lady-killer", name: "Lady killer", price: 0.0, isShisha: true },
      { id: "blue-mystery", name: "Blue mystery", price: 0.0, isShisha: true },
      { id: "water-mellon-chill", name: "Water Mellon chill", price: 0.0, isShisha: true },
      { id: "vaga-blue", name: "Vaga blue", price: 0.0, isShisha: true },
      { id: "raisin-royale", name: "Raisin royale", price: 0.0, isShisha: true },
      { id: "chewing-gum-menthe", name: "Chewing-gum menthe", price: 0.0, isShisha: true },
      { id: "citron-menthe-glace", name: "Citron menthe glace", price: 0.0, isShisha: true },
      { id: "dragon-king-cola", name: "Dragon king cola", price: 0.0, isShisha: true },
      { id: "blue-ice", name: "Blue ice", price: 0.0, isShisha: true },
      { id: "blue-lychee", name: "Blue lychee", price: 0.0, isShisha: true },
      { id: "morocco-mints", name: "Morocco mints", price: 0.0, isShisha: true },
      { id: "menthe-verte", name: "Menthe verte", price: 0.0, isShisha: true },
      { id: "mi-amor", name: "Mi amor", price: 0.0, isShisha: true },
      { id: "mojito", name: "Mojito", price: 0.0, isShisha: true },
      { id: "absolute-zero", name: "Absolute zero", price: 0.0, isShisha: true },
      { id: "moloko-okolom", name: "Moloko (okolom)", price: 0.0, isShisha: true },
      { id: "pistache", name: "Pistache", price: 0.0, isShisha: true },
      { id: "black-raisin", name: "Black raisin", price: 0.0, isShisha: true },
      { id: "hawai", name: "Hawai", price: 0.0, isShisha: true },
      { id: "lemon-chill", name: "Lemon chill", price: 0.0, isShisha: true },
      { id: "coca-cola", name: "Coca cola", price: 0.0, isShisha: true },
      { id: "poire-chill", name: "Poire chill", price: 0.0, isShisha: true },
      { id: "gold-peche", name: "Gold peche", price: 0.0, isShisha: true },
      { id: "gold-kiwi", name: "Gold kiwi", price: 0.0, isShisha: true },
      { id: "the-moon-queen", name: "The Moon Queen", price: 0.0, isShisha: true },
      { id: "prince-of-the-moon", name: "Prince of the Moon", price: 0.0, isShisha: true }
    ]
  }
];

const createDefaultTables = () => Array.from({ length: 13 }, (_, idx) => ({
  id: idx + 1,
  status: "free",
  orderId: null
}));

const savedPosState = readJsonFile(POS_STATE_FILE, {});
const tables =
  Array.isArray(savedPosState.tables) && savedPosState.tables.length === 13
    ? savedPosState.tables
    : createDefaultTables();
const orders = new Map(
  Array.isArray(savedPosState.orders)
    ? savedPosState.orders.filter((order) => order?.id).map((order) => [order.id, order])
    : []
);
const settledTickets = Array.isArray(savedPosState.settledTickets) ? savedPosState.settledTickets : [];
const paymentHistory = Array.isArray(savedPosState.paymentHistory) ? savedPosState.paymentHistory : [];
const ticketCountersByDate = new Map(
  Object.entries(savedPosState.ticketCountersByDate || {}).map(([date, count]) => [date, Number(count) || 0])
);

const savePosState = () =>
  writeJsonFile(POS_STATE_FILE, {
    tables,
    orders: Array.from(orders.values()),
    settledTickets,
    paymentHistory,
    ticketCountersByDate: Object.fromEntries(ticketCountersByDate)
  });

const computeTotal = (items = []) =>
  items.reduce((acc, item) => acc + item.price * item.qty, 0);

const snapshotOrderItems = (items = []) =>
  items.map((item) => ({
    id: item.id,
    name: item.name,
    price: item.price,
    qty: Math.max(0, Number(item.qty) || 0)
  }));

const getKitchenItemsToSend = (order) => {
  const sentQuantities = new Map(
    (order.kitchenSentItems || []).map((item) => [item.id, Math.max(0, Number(item.qty) || 0)])
  );

  return (order.items || [])
    .map((item) => {
      const sentQty = sentQuantities.get(item.id) || 0;
      const qtyToSend = Math.max(0, (Number(item.qty) || 0) - sentQty);
      return qtyToSend > 0 ? { ...item, qty: qtyToSend } : null;
    })
    .filter(Boolean);
};

const normalizeMoney = (value) => {
  const num = Number(String(value || "0").replace(",", "."));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num * 100) / 100);
};

const computePaymentMethod = (totalCash, totalCard) => {
  if (totalCash > 0 && totalCard > 0) return "split";
  if (totalCash > 0) return "cash";
  return "card";
};

const paymentMethodLabel = (method) => {
  if (method === "split") return "Mixte";
  if (method === "cash") return "Cash";
  return "Carte";
};

const getDateKey = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const nextTicketNumberForDate = (dateKey) => {
  const current = ticketCountersByDate.get(dateKey) || 0;
  const next = current + 1;
  ticketCountersByDate.set(dateKey, next);
  return next;
};

const computePaymentBreakdown = (items, paymentMethod, paymentSplit, paymentAmounts) => {
  const totalTtc = computeTotal(items);
  const toMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.round(num * 100) / 100);
  };

  if (paymentAmounts && typeof paymentAmounts === "object") {
    const paidCash = toMoney(paymentAmounts.cash);
    const paidCard = toMoney(paymentAmounts.card);
    const paidTotal = Math.round((paidCash + paidCard) * 100) / 100;
    const changeDue = Math.max(0, Math.round((paidTotal - totalTtc) * 100) / 100);
    const totalCard = Math.min(paidCard, totalTtc);
    const totalCash = Math.max(0, Math.round((totalTtc - totalCard) * 100) / 100);
    return { totalCash, totalCard, paidCash, paidCard, changeDue };
  }

  if (paymentMethod === "cash") {
    return { totalCash: totalTtc, totalCard: 0, paidCash: totalTtc, paidCard: 0, changeDue: 0 };
  }
  if (paymentMethod === "card") {
    return { totalCash: 0, totalCard: totalTtc, paidCash: 0, paidCard: totalTtc, changeDue: 0 };
  }
  if (paymentSplit && typeof paymentSplit === "object") {
    let totalCash = 0;
    let totalCard = 0;
    items.forEach((line) => {
      const raw = paymentSplit[line.id];
      const cashQty = Math.max(0, Math.min(line.qty, Number(raw || 0)));
      const cardQty = Math.max(0, line.qty - cashQty);
      totalCash += line.price * cashQty;
      totalCard += line.price * cardQty;
    });
    return { totalCash, totalCard, paidCash: totalCash, paidCard: totalCard, changeDue: 0 };
  }

  return { totalCash: 0, totalCard: totalTtc, paidCash: 0, paidCard: totalTtc, changeDue: 0 };
};

const computePaymentBreakdownFromTotal = (totalTtc, paymentAmounts) => {
  const toMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.round(num * 100) / 100);
  };
  const paidCash = toMoney(paymentAmounts?.cash);
  const paidCard = toMoney(paymentAmounts?.card);
  const paidTotal = Math.round((paidCash + paidCard) * 100) / 100;
  const changeDue = Math.max(0, Math.round((paidTotal - totalTtc) * 100) / 100);
  const totalCard = Math.min(paidCard, totalTtc);
  const totalCash = Math.max(0, Math.round((totalTtc - totalCard) * 100) / 100);
  return { totalCash, totalCard, paidCash, paidCard, changeDue };
};

const sanitizeHistoryItems = (items = []) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item, index) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const qty = Math.max(0, Math.round(Number(item?.qty || 0)));
      const price = normalizeMoney(item?.price);
      if (!name || qty < 1) return null;
      return {
        id:
          typeof item?.id === "string" && item.id.trim().length > 0
            ? item.id.trim()
            : `history-line-${Date.now()}-${index}`,
        name,
        qty,
        price
      };
    })
    .filter(Boolean);
};

const makeAuditEvent = (user, type, details = {}) => ({
  type,
  at: new Date().toISOString(),
  userId: user?.id || null,
  userName: user?.name || "Inconnu",
  ...details
});

const recordItemChanges = (order, previousItems, nextItems, user) => {
  const previousQty = new Map((previousItems || []).map((item) => [item.id, Number(item.qty) || 0]));
  const nextQty = new Map((nextItems || []).map((item) => [item.id, Number(item.qty) || 0]));
  const events = [];

  (nextItems || []).forEach((item) => {
    const delta = (Number(item.qty) || 0) - (previousQty.get(item.id) || 0);
    if (delta > 0) {
      events.push(makeAuditEvent(user, "ajout", {
        items: [{ id: item.id, name: item.name, qty: delta, price: item.price }]
      }));
    }
  });
  (previousItems || []).forEach((item) => {
    const delta = (Number(item.qty) || 0) - (nextQty.get(item.id) || 0);
    if (delta > 0) {
      events.push(makeAuditEvent(user, "retrait", {
        items: [{ id: item.id, name: item.name, qty: delta, price: item.price }]
      }));
    }
  });

  order.activity = [...(order.activity || []), ...events];
};

const createPaymentEntry = (ticket) => ({
  id: `pay-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
  ticketNumber: ticket.ticketNumber,
  ticketDateKey: ticket.ticketDateKey,
  date: ticket.date,
  table: ticket.table,
  orderId: ticket.orderId,
  items: ticket.items || [],
  totalTtc: ticket.totalTtc,
  totalCash: ticket.totalCash,
  totalCard: ticket.totalCard,
  paidCash: ticket.paidCash,
  paidCard: ticket.paidCard,
  changeDue: ticket.changeDue,
  paymentMethod: ticket.paymentMethod,
  openedBy: ticket.openedBy || null,
  paidBy: ticket.paidBy || null,
  activity: ticket.activity || [],
  status: "active",
  includeInDaily: true,
  updatedAt: null
});

const createOrder = (tableId, user) => {
  const id = `${Date.now()}-${tableId}-${Math.floor(Math.random() * 9999)}`;
  const order = {
    id,
    tableId,
    items: [],
    status: "open",
    sentToKitchen: false,
    kitchenSentItems: [],
    kitchenSendCount: 0,
    openedBy: publicStaff(user),
    lastUpdatedBy: publicStaff(user),
    activity: [makeAuditEvent(user, "ouverture-table")],
    createdAt: new Date().toISOString()
  };
  orders.set(id, order);
  return order;
};

const findTable = (tableId) => tables.find((t) => t.id === tableId);

const formatMoney = (value) =>
  new Intl.NumberFormat("fr-BE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));

const formatTicketDateTime = (value) =>
  new Intl.DateTimeFormat("fr-BE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Brussels"
  }).format(new Date(value));

const buildTelegramTicketCaption = (ticket) =>
  `Ticket #${String(ticket.ticketNumber).padStart(4, "0")} - Table ${ticket.table}`;

const buildTelegramDailyReportCaption = (report) =>
  `TICKET DE LA JOURNEE - ${report.date}`;

const buildTicketPdfBuffer = (ticket) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [226.77, 600],
      margins: { top: 20, bottom: 20, left: 18, right: 18 }
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).text(ticket.restaurant || RESTAURANT_NAME, {
      align: "center"
    });
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).text(`Ticket #${String(ticket.ticketNumber).padStart(4, "0")}`, {
      align: "center"
    });
    doc.text(`Date: ${formatTicketDateTime(ticket.date)}`, { align: "center" });
    doc.text(`Table: ${ticket.table}`, { align: "center" });
    if (ticket.paidBy?.name) {
      doc.text(`Serveur: ${ticket.paidBy.name}`, { align: "center" });
    }
    doc.text(`Paiement: ${paymentMethodLabel(ticket.paymentMethod)}`, { align: "center" });
    if (ticket.vatNumber) {
      doc.text(`TVA: ${ticket.vatNumber}`, { align: "center" });
    }

    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(11).text("Articles");
    doc.moveDown(0.3);

    (ticket.items || []).forEach((line) => {
      doc.font("Helvetica").fontSize(10).text(
        `${line.qty} x ${line.name}`,
        { width: 120, continued: true }
      );
      doc.text(`${formatMoney(line.price * line.qty)} EUR`, {
        align: "right"
      });
    });

    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(11).text(`Total TTC: ${formatMoney(ticket.totalTtc)} EUR`);
    doc.font("Helvetica").fontSize(10).text(`Cash: ${formatMoney(ticket.paidCash ?? ticket.totalCash ?? 0)} EUR`);
    doc.text(`Carte: ${formatMoney(ticket.paidCard ?? ticket.totalCard ?? 0)} EUR`);
    if ((ticket.changeDue || 0) > 0) {
      doc.text(`Rendu: ${formatMoney(ticket.changeDue)} EUR`);
    }

    doc.moveDown(0.8);
    doc.font("Helvetica-Oblique").fontSize(9).text("Ticket envoye automatiquement via Telegram.", {
      align: "center"
    });

    doc.end();
  });

const buildDailyReportPdfBuffer = (report) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [226.77, 700],
      margins: { top: 20, bottom: 20, left: 18, right: 18 }
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(15).text(RESTAURANT_NAME, { align: "center" });
    doc.moveDown(0.25);
    doc.font("Helvetica-Bold").fontSize(11).text("TICKET DE LA JOURNEE", { align: "center" });
    doc.font("Helvetica").fontSize(10).text(`Date: ${report.date}`, { align: "center" });
    if (report.vatNumber) {
      doc.text(`TVA: ${report.vatNumber}`, { align: "center" });
    }

    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(11).text("Recap paiements");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(10).text(`Cash: ${formatMoney(report.totalCash)} EUR`);
    doc.text(`Carte: ${formatMoney(report.totalCard)} EUR`);
    doc.font("Helvetica-Bold").text(`Total TTC: ${formatMoney(report.totalTtc)} EUR`);

    doc.moveDown(0.7);
    doc.font("Helvetica-Bold").fontSize(11).text("Articles");
    doc.moveDown(0.3);

    if (!report.items || report.items.length === 0) {
      doc.font("Helvetica").fontSize(10).text("Aucun ticket pour cette date.");
    } else {
      report.items.forEach((line) => {
        doc.font("Helvetica").fontSize(10).text(
          `${line.qty} x ${line.name}`,
          { width: 120, continued: true }
        );
        doc.text(`${formatMoney(line.total)} EUR`, { align: "right" });
      });
    }

    doc.end();
  });

const sendTelegramTicket = async (ticket) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  const pdfBuffer = await buildTicketPdfBuffer(ticket);
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("caption", buildTelegramTicketCaption(ticket));
  form.append(
    "document",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    `ticket-${ticket.ticketDateKey}-${String(ticket.ticketNumber).padStart(4, "0")}.pdf`
  );

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API ${response.status}: ${errorText}`);
  }
};

const sendTelegramDailyReport = async (report) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return;
  }

  const pdfBuffer = await buildDailyReportPdfBuffer(report);
  const form = new FormData();
  form.append("chat_id", TELEGRAM_CHAT_ID);
  form.append("caption", buildTelegramDailyReportCaption(report));
  form.append(
    "document",
    new Blob([pdfBuffer], { type: "application/pdf" }),
    `ticket-journee-${report.date}.pdf`
  );

  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API ${response.status}: ${errorText}`);
  }
};

const parseCookies = (cookieHeader = "") =>
  cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [rawName, ...rawValue] = part.split("=");
      if (!rawName) return acc;
      acc[rawName] = decodeURIComponent(rawValue.join("=") || "");
      return acc;
    }, {});

const createAuthSession = (staff) => {
  const token = crypto.randomBytes(32).toString("hex");
  authSessions.set(token, { createdAt: Date.now(), user: publicStaff(staff) });
  return token;
};

const getAuthToken = (req) => {
  const cookies = parseCookies(req.headers.cookie || "");
  return cookies[AUTH_COOKIE_NAME] || "";
};

const getAuthenticatedUser = (req) => authSessions.get(getAuthToken(req))?.user || null;
const isAuthenticated = (req) => Boolean(getAuthenticatedUser(req));
const isManager = (req) => getAuthenticatedUser(req)?.role === "manager";

const requireManager = (req, res, next) => {
  if (!isManager(req)) {
    return res.status(403).json({ error: "Acces gerant requis" });
  }
  return next();
};

const setAuthCookie = (res, token) => {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
};

const clearAuthCookie = (res) => {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];
  if (process.env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
};

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }
  return res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/api/auth/status", (req, res) => {
  const user = getAuthenticatedUser(req);
  res.json({ authenticated: Boolean(user), user });
});

app.post("/api/auth/login", (req, res) => {
  const name = normalizeStaffName(req.body?.name);
  const pin = String(req.body?.pin || "").trim();
  const staff = staffMembers.find((member) => staffNameKey(member.name) === staffNameKey(name));
  if (!staff || !pin || hashPin(pin) !== staff.pinHash) {
    return res.status(401).json({ error: "Identifiants invalides" });
  }
  const token = createAuthSession(staff);
  setAuthCookie(res, token);
  return res.json({ authenticated: true, user: publicStaff(staff) });
});

app.post("/api/auth/logout", (req, res) => {
  const token = getAuthToken(req);
  if (token) {
    authSessions.delete(token);
  }
  clearAuthCookie(res);
  return res.json({ authenticated: false });
});

app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (req.path === "/login") return next();
  if (req.path === "/api/auth/status") return next();
  if (req.path === "/api/auth/login") return next();
  if (req.path === "/api/auth/logout") return next();

  if (!isAuthenticated(req)) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "Authentification requise" });
    }
    return res.redirect("/login");
  }

  next();
});

app.use(express.static(PUBLIC_DIR));

app.get("/api/staff", requireManager, (_req, res) => {
  res.json(staffMembers.map(publicStaff));
});

app.post("/api/staff", requireManager, (req, res) => {
  const name = normalizeStaffName(req.body?.name);
  const pin = String(req.body?.pin || "").trim();
  if (name.length < 2 || !/^\d{4,}$/.test(pin)) {
    return res.status(400).json({ error: "Nom et PIN numerique de 4 chiffres minimum requis" });
  }
  if (staffMembers.some((staff) => staffNameKey(staff.name) === staffNameKey(name))) {
    return res.status(409).json({ error: "Ce serveur existe deja" });
  }
  const staff = {
    id: `staff-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    name,
    role: "server",
    pinHash: hashPin(pin),
    createdAt: new Date().toISOString()
  };
  staffMembers.push(staff);
  saveStaff();
  return res.status(201).json(publicStaff(staff));
});

app.put("/api/staff/:id", requireManager, (req, res) => {
  const staff = staffMembers.find((member) => member.id === req.params.id);
  if (!staff) return res.status(404).json({ error: "Serveur introuvable" });
  const pin = String(req.body?.pin || "").trim();
  if (!/^\d{4,}$/.test(pin)) {
    return res.status(400).json({ error: "PIN numerique de 4 chiffres minimum requis" });
  }
  staff.pinHash = hashPin(pin);
  staff.updatedAt = new Date().toISOString();
  saveStaff();
  return res.json(publicStaff(staff));
});

app.get("/api/menu", (_req, res) => {
  res.json(menu);
});

app.get("/api/tables", (_req, res) => {
  res.json(tables);
});

app.post("/api/tables/:id/open", (req, res) => {
  const user = getAuthenticatedUser(req);
  const tableId = Number(req.params.id);
  const table = findTable(tableId);
  if (!table) {
    return res.status(404).json({ error: "Table introuvable" });
  }
  if (!table.orderId) {
    const order = createOrder(tableId, user);
    table.orderId = order.id;
    table.status = "occupied";
  } else if (table.status === "free") {
    table.status = "occupied";
  }
  const order = orders.get(table.orderId);
  savePosState();
  return res.json({ table, order });
});

app.get("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Commande introuvable" });
  }
  res.json(order);
});

app.put("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Commande introuvable" });
  }
  const { items = [] } = req.body || {};
  const previousItems = snapshotOrderItems(order.items);
  const nextItems = Array.isArray(items) ? items : order.items;
  order.items = nextItems;
  const user = getAuthenticatedUser(req);
  recordItemChanges(order, previousItems, nextItems, user);
  order.lastUpdatedBy = publicStaff(user);
  order.total = computeTotal(order.items);
  savePosState();
  res.json(order);
});

app.post("/api/orders/:id/send-kitchen", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Commande introuvable" });
  }

  const items = getKitchenItemsToSend(order);
  order.sentToKitchen = true;
  if (!items.length) {
    savePosState();
    return res.json({ order, kitchenTicket: null });
  }

  const isFirstSend = order.kitchenSendCount === 0;
  order.kitchenSentItems = snapshotOrderItems(order.items);
  order.kitchenSendCount += 1;
  order.activity = [
    ...(order.activity || []),
    makeAuditEvent(getAuthenticatedUser(req), "envoi-cuisine", { items: snapshotOrderItems(items) })
  ];
  savePosState();

  res.json({
    order,
    kitchenTicket: {
      type: isFirstSend ? "first" : "supplement",
      number: order.kitchenSendCount,
      sentAt: new Date().toISOString(),
      items
    }
  });
});

app.post("/api/orders/:id/mark-to-pay", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Commande introuvable" });
  }
  const table = findTable(order.tableId);
  table.status = "to_pay";
  order.status = "to_pay";
  order.activity = [...(order.activity || []), makeAuditEvent(getAuthenticatedUser(req), "a-payer")];
  savePosState();
  res.json({ table, order });
});

app.post("/api/orders/:id/settle", async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Commande introuvable" });
  }
  const table = findTable(order.tableId);
  const paymentMethod = (req.body && req.body.paymentMethod) || "card";
  const paymentSplit = req.body && req.body.paymentSplit;
  const paymentAmounts = req.body && req.body.paymentAmounts;
  const dateOverride = req.body && req.body.dateOverride;
  const parsedDate = dateOverride ? new Date(dateOverride) : null;
  const ticketDate =
    parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toISOString()
      : new Date().toISOString();
  const ticketDateKey = getDateKey(ticketDate) || new Date().toISOString().slice(0, 10);
  const ticketNumber = nextTicketNumberForDate(ticketDateKey);
  const { totalCash, totalCard, paidCash, paidCard, changeDue } = computePaymentBreakdown(
    order.items,
    paymentMethod,
    paymentSplit,
    paymentAmounts
  );
  const totalTtc = computeTotal(order.items);
  const paidTotal = Math.round((paidCash + paidCard) * 100) / 100;
  if (paidTotal + 0.01 < totalTtc) {
    return res.status(400).json({
      error: "Montant de paiement invalide",
      expectedTotal: totalTtc,
      paidTotal
    });
  }
  const ticket = {
    restaurant: RESTAURANT_NAME,
    vatNumber: COMPANY_VAT_NUMBER || null,
    ticketNumber,
    ticketDateKey,
    table: table.id,
    orderId: order.id,
    items: order.items,
    totalTtc,
    paymentMethod,
    totalCash,
    totalCard,
    paidCash,
    paidCard,
    changeDue,
    openedBy: order.openedBy || null,
    paidBy: publicStaff(getAuthenticatedUser(req)),
    activity: [
      ...(order.activity || []),
      makeAuditEvent(getAuthenticatedUser(req), "paiement", { total: totalTtc })
    ],
    date: ticketDate
  };
  settledTickets.push(ticket);
  paymentHistory.push(createPaymentEntry(ticket));
  table.status = "free";
  table.orderId = null;
  order.status = "settled";
  orders.delete(order.id);
  savePosState();
  try {
    await sendTelegramTicket(ticket);
  } catch (error) {
    console.error("Impossible d'envoyer le ticket vers Telegram", error);
  }
  res.json(ticket);
});

app.get("/api/reports/daily", requireManager, (_req, res) => {
  const queryDate = getDateKey(_req.query.date);
  const todayKey = new Date().toISOString().slice(0, 10);
  const targetKey = queryDate || todayKey;
  const todayPayments = paymentHistory.filter((p) => {
    const dayKey = new Date(p.date).toISOString().slice(0, 10);
    if (dayKey !== targetKey) return false;
    if (p.status === "active") return true;
    if (p.status === "edited" && p.includeInDaily) return true;
    return false;
  });
  const total = todayPayments.reduce((sum, t) => sum + (t.totalTtc || 0), 0);
  const totalCash = todayPayments.reduce((sum, t) => sum + (t.totalCash || 0), 0);
  const totalCard = todayPayments.reduce((sum, t) => sum + (t.totalCard || 0), 0);
  const items = {};
  todayPayments.forEach((ticket) => {
    (ticket.items || []).forEach((line) => {
      const entry = items[line.name] || { name: line.name, qty: 0, total: 0 };
      entry.qty += line.qty;
      entry.total += line.price * line.qty;
      items[line.name] = entry;
    });
  });
  res.json({
    date: targetKey,
    vatNumber: COMPANY_VAT_NUMBER || null,
    totalTtc: total,
    totalCash,
    totalCard,
    tickets: todayPayments,
    items: Object.values(items)
  });
});

app.post("/api/reports/daily/send", requireManager, async (req, res) => {
  const queryDate = getDateKey(req.body?.date);
  const todayKey = new Date().toISOString().slice(0, 10);
  const targetKey = queryDate || todayKey;
  const todayPayments = paymentHistory.filter((p) => {
    const dayKey = new Date(p.date).toISOString().slice(0, 10);
    if (dayKey !== targetKey) return false;
    if (p.status === "active") return true;
    if (p.status === "edited" && p.includeInDaily) return true;
    return false;
  });
  const total = todayPayments.reduce((sum, t) => sum + (t.totalTtc || 0), 0);
  const totalCash = todayPayments.reduce((sum, t) => sum + (t.totalCash || 0), 0);
  const totalCard = todayPayments.reduce((sum, t) => sum + (t.totalCard || 0), 0);
  const items = {};
  todayPayments.forEach((ticket) => {
    (ticket.items || []).forEach((line) => {
      const entry = items[line.name] || { name: line.name, qty: 0, total: 0 };
      entry.qty += line.qty;
      entry.total += line.price * line.qty;
      items[line.name] = entry;
    });
  });

  const report = {
    date: targetKey,
    vatNumber: COMPANY_VAT_NUMBER || null,
    totalTtc: total,
    totalCash,
    totalCard,
    tickets: todayPayments,
    items: Object.values(items)
  };

  try {
    await sendTelegramDailyReport(report);
    res.json({ ok: true, sent: true, date: targetKey });
  } catch (error) {
    console.error("Impossible d'envoyer le ticket journalier vers Telegram", error);
    res.status(500).json({ ok: false, error: "Envoi Telegram impossible" });
  }
});

app.get("/api/reports/staff", requireManager, (req, res) => {
  const queryDate = getDateKey(req.query.date);
  const targetKey = queryDate || new Date().toISOString().slice(0, 10);
  const tickets = paymentHistory.filter((entry) => {
    if (new Date(entry.date).toISOString().slice(0, 10) !== targetKey) return false;
    return entry.status === "active" || (entry.status === "edited" && entry.includeInDaily);
  });

  const reports = staffMembers.map((staff) => {
    const staffTickets = tickets.filter((ticket) => ticket.paidBy?.id === staff.id);
    const pointages = tickets.flatMap((ticket) =>
      (ticket.activity || []).filter((event) => event.userId === staff.id && event.type === "ajout")
    );
    const items = {};
    pointages.forEach((event) => {
      (event.items || []).forEach((item) => {
        const entry = items[item.name] || { name: item.name, qty: 0 };
        entry.qty += Number(item.qty) || 0;
        items[item.name] = entry;
      });
    });

    return {
      staff: publicStaff(staff),
      ticketCount: staffTickets.length,
      totalTtc: staffTickets.reduce((sum, ticket) => sum + (ticket.totalTtc || 0), 0),
      totalCash: staffTickets.reduce((sum, ticket) => sum + (ticket.totalCash || 0), 0),
      totalCard: staffTickets.reduce((sum, ticket) => sum + (ticket.totalCard || 0), 0),
      tickets: staffTickets.map((ticket) => ({
        ticketNumber: ticket.ticketNumber,
        table: ticket.table,
        date: ticket.date,
        totalTtc: ticket.totalTtc
      })),
      pointages: Object.values(items)
    };
  });

  res.json({ date: targetKey, reports });
});

app.get("/api/payments/history", requireManager, (req, res) => {
  const queryDate = getDateKey(req.query.date);
  const list = queryDate
    ? paymentHistory.filter((p) => new Date(p.date).toISOString().slice(0, 10) === queryDate)
    : paymentHistory;
  res.json(
    [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  );
});

app.put("/api/payments/history/:id", requireManager, (req, res) => {
  const entry = paymentHistory.find((p) => p.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Paiement introuvable" });
  const hasCash = Object.prototype.hasOwnProperty.call(req.body || {}, "cash");
  const hasCard = Object.prototype.hasOwnProperty.call(req.body || {}, "card");
  const hasItems = Object.prototype.hasOwnProperty.call(req.body || {}, "items");
  if (hasCash || hasCard || hasItems) {
    const nextItems = hasItems ? sanitizeHistoryItems(req.body?.items) : entry.items || [];
    if (!nextItems.length) {
      return res.status(400).json({ error: "Commande invalide" });
    }
    const nextTotalTtc = computeTotal(nextItems);
    const cash = hasCash ? normalizeMoney(req.body?.cash) : entry.paidCash ?? entry.totalCash ?? 0;
    const card = hasCard ? normalizeMoney(req.body?.card) : entry.paidCard ?? entry.totalCard ?? 0;
    const updated = computePaymentBreakdownFromTotal(nextTotalTtc, { cash, card });
    const paidTotal = Math.round((updated.paidCash + updated.paidCard) * 100) / 100;
    if (paidTotal + 0.01 < nextTotalTtc) {
      return res.status(400).json({
        error: "Montant de paiement invalide",
        expectedTotal: nextTotalTtc,
        paidTotal
      });
    }
    entry.items = nextItems;
    entry.totalTtc = nextTotalTtc;
    entry.totalCash = updated.totalCash;
    entry.totalCard = updated.totalCard;
    entry.paidCash = updated.paidCash;
    entry.paidCard = updated.paidCard;
    entry.changeDue = updated.changeDue;
    entry.paymentMethod = computePaymentMethod(updated.totalCash, updated.totalCard);
    entry.status = "edited";
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "includeInDaily")) {
    entry.includeInDaily = Boolean(req.body.includeInDaily);
    if (entry.status === "active" && !entry.includeInDaily) {
      entry.status = "edited";
    }
  }
  entry.updatedAt = new Date().toISOString();
  entry.updatedBy = publicStaff(getAuthenticatedUser(req));
  savePosState();
  res.json(entry);
});

app.delete("/api/payments/history/:id", requireManager, (req, res) => {
  const entry = paymentHistory.find((p) => p.id === req.params.id);
  if (!entry) return res.status(404).json({ error: "Paiement introuvable" });
  entry.status = "deleted";
  entry.updatedAt = new Date().toISOString();
  entry.updatedBy = publicStaff(getAuthenticatedUser(req));
  savePosState();
  res.json(entry);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Serveur tactile pret sur le port ${PORT}`);
});
