const state = {
  tables: [],
  menu: [],
  activeCategory: null,
  currentTable: null,
  currentOrder: null,
  saving: false,
  daily: null,
  offeredCategory: null,
  user: null,
  paymentMethod: "card"
};

let lastTicket = null;
let kitchenSendInProgress = false;
const RESTAURANT_NAME = "The Moon Brussels";
const OFFERED_CATEGORY_ID = "__offered__";

const tableGrid = document.getElementById("table-grid");
const categoryList = document.getElementById("category-list");
const itemList = document.getElementById("item-list");
const orderItemsEl = document.getElementById("order-items");
const orderTotalEl = document.getElementById("order-total");
const tablesPanel = document.getElementById("tables-panel");
const orderPanel = document.getElementById("order-panel");
const tableTitle = document.getElementById("table-title");
const tableStatusLabel = document.getElementById("table-status-label");
const kitchenStatus = document.getElementById("kitchen-status");
const ticketModal = document.getElementById("ticket-modal");
const ticketRestaurant = document.getElementById("ticket-restaurant");
const ticketMeta = document.getElementById("ticket-meta");
const ticketVat = document.getElementById("ticket-vat");
const ticketLines = document.getElementById("ticket-lines");
const ticketTotal = document.getElementById("ticket-total");
const dailyModal = document.getElementById("daily-modal");
const dailyTitle = document.getElementById("daily-title");
const dailyRestaurant = document.getElementById("daily-restaurant");
const dailyDate = document.getElementById("daily-date");
const dailyVat = document.getElementById("daily-vat");
const dailyLines = document.getElementById("daily-lines");
const dailyTotal = document.getElementById("daily-total");
const managerTotalTicketBtn = document.getElementById("manager-total-ticket");
const currentUserEl = document.getElementById("current-user");
const managerOnlyEls = document.querySelectorAll(".manager-only");
const staffManagementBtn = document.getElementById("staff-management");
const staffReportBtn = document.getElementById("staff-report");
const staffModal = document.getElementById("staff-modal");
const staffCreateForm = document.getElementById("staff-create-form");
const staffCreateName = document.getElementById("staff-create-name");
const staffCreatePin = document.getElementById("staff-create-pin");
const staffList = document.getElementById("staff-list");
const closeStaffBtn = document.getElementById("close-staff");
const staffReportModal = document.getElementById("staff-report-modal");
const staffReportDate = document.getElementById("staff-report-date");
const staffReportList = document.getElementById("staff-report-list");
const closeStaffReportBtn = document.getElementById("close-staff-report");
const shishaHeadSelect = document.getElementById("shisha-head");
const paymentModal = document.getElementById("payment-modal");
const confirmPaymentBtn = document.getElementById("confirm-payment");
const cancelPaymentBtn = document.getElementById("cancel-payment");
const paymentCashInput = document.getElementById("payment-cash");
const paymentCardInput = document.getElementById("payment-card");
const paymentTotalHint = document.getElementById("payment-total-hint");
const alcoholOptionModal = document.getElementById("alcohol-option-modal");
const alcoholOptionTitle = document.getElementById("alcohol-option-title");
const alcoholOptionSubtitle = document.getElementById("alcohol-option-subtitle");
const alcoholOptionNoBtn = document.getElementById("alcohol-option-no");
const alcoholOptionYesBtn = document.getElementById("alcohol-option-yes");
const alcoholOptionCancelBtn = document.getElementById("alcohol-option-cancel");
const promotionFlavorModal = document.getElementById("promotion-flavor-modal");
const promotionFlavorTitle = document.getElementById("promotion-flavor-title");
const promotionFlavorSubtitle = document.getElementById("promotion-flavor-subtitle");
const promotionFlavorGrid = document.getElementById("promotion-flavor-grid");
const promotionFlavorCancelBtn = document.getElementById("promotion-flavor-cancel");
const additionalShishaHeadModal = document.getElementById("additional-shisha-head-modal");
const additionalShishaHeadGrid = document.getElementById("additional-shisha-head-grid");
const additionalShishaHeadCancelBtn = document.getElementById("additional-shisha-head-cancel");
const historyModal = document.getElementById("history-modal");
const historyList = document.getElementById("history-list");
const historyBtn = document.getElementById("payment-history");
const closeHistoryBtn = document.getElementById("close-history");
const lockAppBtn = document.getElementById("lock-app");

const redirectToLogin = () => {
  window.location.replace("/login");
};

const SHISHA_HEADS = [
  { id: "quasar", label: "Tete Quasar", price: 20 },
  { id: "kaloud", label: "Tete Kaloud", price: 15 },
  { id: "brohood", label: "Tete Brohood", price: 15 },
  { id: "hookah", label: "Tete Hookah", price: 20 }
];
const ADDITIONAL_SHISHA_HEADS = [
  { id: "quasar", label: "Quasar", price: 8 },
  { id: "hookah", label: "Hookah", price: 8 },
  { id: "brohood", label: "Brohood", price: 7 },
  { id: "kaloud", label: "Kaloud", price: 7 }
];
const ALCOHOL_OPTION_CATEGORIES = new Set(["mocktails", "mojitos"]);
const ALCOHOL_SUPPLEMENT_PRICE = 3;
let alcoholOptionResolver = null;
let promotionFlavorResolver = null;
let additionalShishaHeadResolver = null;

const api = async (url, options = {}) => {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  if (res.status === 401) {
    redirectToLogin();
    throw new Error("Authentification requise");
  }
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
};

const euros = (value) => `${value.toFixed(2)} EUR`;
const formatTicketNumber = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) return "N/A";
  return String(num).padStart(4, "0");
};
const paymentMethodLabel = (method) => {
  if (method === "split") return "Mixte";
  if (method === "cash") return "Cash";
  return "Carte";
};
const hasVatNumber = (value) => typeof value === "string" && value.trim().length > 0;
const normalizeMoney = (value) => {
  const num = Number(String(value || "0").replace(",", "."));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num * 100) / 100);
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const computeItemsTotal = (items = []) =>
  items.reduce((sum, item) => sum + normalizeMoney(item.price) * Math.max(0, Number(item.qty) || 0), 0);

const HISTORY_CUSTOM_CATEGORY = "__custom__";
const normalizeLabel = (value) => String(value || "").trim().toLowerCase();

const findHistoryMenuMatch = (item = {}) => {
  if (!Array.isArray(state.menu)) return null;

  for (const category of state.menu) {
    for (const menuItem of category.items || []) {
      if (item?.id && menuItem.id === item.id) {
        return { categoryId: category.id, menuItemId: menuItem.id, menuItem };
      }
    }
  }

  const targetName = normalizeLabel(item?.name);
  const targetPrice = normalizeMoney(item?.price);
  for (const category of state.menu) {
    for (const menuItem of category.items || []) {
      if (
        targetName &&
        normalizeLabel(menuItem.name) === targetName &&
        Math.abs(normalizeMoney(menuItem.price) - targetPrice) < 0.01
      ) {
        return { categoryId: category.id, menuItemId: menuItem.id, menuItem };
      }
    }
  }

  return null;
};

const getHistoryMenuItems = (categoryId) =>
  state.menu.find((category) => category.id === categoryId)?.items || [];

const getHistoryMenuItemById = (categoryId, itemId) =>
  getHistoryMenuItems(categoryId).find((item) => item.id === itemId) || null;

const getHistoryCategoryOptionsMarkup = (selectedCategoryId = "") => {
  const selected = selectedCategoryId || "";
  const options = ['<option value="">Choisir categorie</option>'];
  state.menu.forEach((category) => {
    const isSelected = selected === category.id ? " selected" : "";
    options.push(`<option value="${escapeHtml(category.id)}"${isSelected}>${escapeHtml(category.label)}</option>`);
  });
  const customSelected = selected === HISTORY_CUSTOM_CATEGORY ? " selected" : "";
  options.push(`<option value="${HISTORY_CUSTOM_CATEGORY}"${customSelected}>Personnalise</option>`);
  return options.join("");
};

const getHistoryArticleOptionsMarkup = (categoryId, selectedItemId = "") => {
  const options = ['<option value="">Choisir article</option>'];
  getHistoryMenuItems(categoryId).forEach((item) => {
    const isSelected = selectedItemId === item.id ? " selected" : "";
    options.push(`<option value="${escapeHtml(item.id)}"${isSelected}>${escapeHtml(item.name)}</option>`);
  });
  return options.join("");
};

const paymentStatusLabel = (status) => {
  if (status === "edited") return "Modifie";
  if (status === "deleted") return "Supprime";
  return "Actif";
};

const getSelectedShishaHead = () => {
  if (!shishaHeadSelect) return null;
  const id = shishaHeadSelect.value;
  if (!id) return null;
  return SHISHA_HEADS.find((head) => head.id === id) || null;
};

const categoryNeedsAlcoholOption = (categoryId) => ALCOHOL_OPTION_CATEGORIES.has(categoryId);
const categoryNeedsPromotionFlavor = (categoryId) => categoryId === "promotions";

const getMenuItemQuantity = (item, categoryId) => {
  const orderItems = state.currentOrder?.items || [];
  if (item.isAdditionalShishaHead) {
    return orderItems
      .filter((i) => i.baseItemId === item.id && i.isAdditionalShishaHead)
      .reduce((sum, i) => sum + i.qty, 0);
  }
  if (item.isShisha) {
    return orderItems
      .filter((i) => i.shishaFlavorId === item.id)
      .reduce((sum, i) => sum + i.qty, 0);
  }
  if (categoryNeedsAlcoholOption(categoryId)) {
    return orderItems
      .filter((i) => i.id === item.id || i.baseItemId === item.id)
      .reduce((sum, i) => sum + i.qty, 0);
  }
  if (categoryNeedsPromotionFlavor(categoryId)) {
    return orderItems
      .filter((i) => i.id === item.id || i.baseItemId === item.id)
      .reduce((sum, i) => sum + i.qty, 0);
  }
  return orderItems.find((i) => i.id === item.id)?.qty || 0;
};

const getOfferedItemQuantity = (item, categoryId) =>
  (state.currentOrder?.items || [])
    .filter((line) => line.isOffered && line.offeredCategoryId === categoryId && line.offeredItemId === item.id)
    .reduce((sum, line) => sum + line.qty, 0);

const buildAlcoholOptionLine = (item, isAlcoholized) => ({
  id: `${item.id}-${isAlcoholized ? "alcoolise" : "sans-alcool"}`,
  name: `${item.name} - ${isAlcoholized ? "Alcoolise" : "Sans alcool"}`,
  price: normalizeMoney(item.price + (isAlcoholized ? ALCOHOL_SUPPLEMENT_PRICE : 0)),
  qty: 1,
  baseItemId: item.id,
  alcoholized: isAlcoholized
});

const resolveAlcoholOption = (value) => {
  if (!alcoholOptionResolver) return;
  const resolver = alcoholOptionResolver;
  alcoholOptionResolver = null;
  if (alcoholOptionModal) alcoholOptionModal.classList.add("hidden");
  resolver(value);
};

const pickAlcoholOption = (item) => {
  if (!alcoholOptionModal) {
    return Promise.resolve(window.confirm(`${item.name}\nAlcoolise avec supplement de 3 EUR ?`));
  }
  if (alcoholOptionResolver) {
    resolveAlcoholOption(null);
  }
  if (alcoholOptionTitle) alcoholOptionTitle.textContent = item.name;
  if (alcoholOptionSubtitle) {
    alcoholOptionSubtitle.textContent = `Choisir la version. Alcoolise ajoute ${euros(ALCOHOL_SUPPLEMENT_PRICE)}.`;
  }
  alcoholOptionModal.classList.remove("hidden");
  return new Promise((resolve) => {
    alcoholOptionResolver = resolve;
  });
};

const resolvePromotionFlavor = (flavor) => {
  if (!promotionFlavorResolver) return;
  const resolver = promotionFlavorResolver;
  promotionFlavorResolver = null;
  if (promotionFlavorModal) promotionFlavorModal.classList.add("hidden");
  resolver(flavor);
};

const pickShishaFlavor = (title, subtitle) => {
  const flavors = (state.menu.find((category) => category.id === "shisha")?.items || [])
    .filter((item) => item.isShisha);
  if (!promotionFlavorModal || !promotionFlavorGrid || !flavors.length) {
    alert("Aucun gout shisha disponible");
    return Promise.resolve(null);
  }
  if (promotionFlavorResolver) resolvePromotionFlavor(null);
  if (promotionFlavorTitle) promotionFlavorTitle.textContent = title;
  if (promotionFlavorSubtitle) promotionFlavorSubtitle.textContent = subtitle;
  promotionFlavorGrid.innerHTML = "";
  flavors.forEach((flavor) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-btn";
    button.textContent = flavor.name;
    button.addEventListener("click", () => resolvePromotionFlavor(flavor));
    promotionFlavorGrid.appendChild(button);
  });
  promotionFlavorModal.classList.remove("hidden");
  return new Promise((resolve) => {
    promotionFlavorResolver = resolve;
  });
};

const pickPromotionFlavor = (promotion) =>
  pickShishaFlavor(promotion.name, "Selectionne le gout a ajouter a la promotion.");

const resolveAdditionalShishaHead = (head) => {
  if (!additionalShishaHeadResolver) return;
  const resolver = additionalShishaHeadResolver;
  additionalShishaHeadResolver = null;
  if (additionalShishaHeadModal) additionalShishaHeadModal.classList.add("hidden");
  resolver(head);
};

const pickAdditionalShishaHead = () => {
  if (!additionalShishaHeadModal || !additionalShishaHeadGrid) {
    alert("Selection de tete supplementaire indisponible");
    return Promise.resolve(null);
  }
  if (additionalShishaHeadResolver) resolveAdditionalShishaHead(null);
  additionalShishaHeadGrid.innerHTML = "";
  ADDITIONAL_SHISHA_HEADS.forEach((head) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-btn";
    button.textContent = `${head.label} - ${euros(head.price)}`;
    button.addEventListener("click", () => resolveAdditionalShishaHead(head));
    additionalShishaHeadGrid.appendChild(button);
  });
  additionalShishaHeadModal.classList.remove("hidden");
  return new Promise((resolve) => {
    additionalShishaHeadResolver = resolve;
  });
};

const buildPromotionFlavorLine = (promotion, flavor) => ({
  id: `${promotion.id}-gout-${flavor.id}`,
  name: `${promotion.name} - Gout ${flavor.name}`,
  price: normalizeMoney(promotion.price),
  qty: 1,
  baseItemId: promotion.id,
  promotionShishaFlavorId: flavor.id
});

const buildAdditionalShishaHeadLine = (item, head, flavor) => ({
  id: `${item.id}-${head.id}-${flavor.id}`,
  name: `Tete supplementaire ${head.label} - Gout ${flavor.name}`,
  price: normalizeMoney(head.price),
  qty: 1,
  baseItemId: item.id,
  isAdditionalShishaHead: true,
  shishaFlavorId: flavor.id,
  shishaHeadId: head.id
});

const statusLabel = (status) => {
  if (status === "occupied") return "Occupee";
  if (status === "to_pay") return "A payer";
  return "Libre";
};

const renderTables = () => {
  tableGrid.innerHTML = "";
  state.tables.forEach((table) => {
    const btn = document.createElement("button");
    btn.className = `table-card ${table.status}`;
    btn.setAttribute("aria-label", `Table ${table.id} ${table.status}`);
    btn.innerHTML = `
      <div class="table-number">Table ${table.id}</div>
      <div class="badge ${table.status}">${statusLabel(table.status)}</div>
    `;
    btn.addEventListener("click", () => openTable(table.id));
    tableGrid.appendChild(btn);
  });
};

const renderCategories = () => {
  categoryList.innerHTML = "";
  state.menu.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = `chip ${state.activeCategory === cat.id ? "active" : ""}`;
    btn.textContent = cat.label;
    btn.addEventListener("click", () => {
      state.activeCategory = cat.id;
      renderCategories();
      renderItems();
    });
    categoryList.appendChild(btn);
  });

  const offeredBtn = document.createElement("button");
  offeredBtn.className = `chip ${state.activeCategory === OFFERED_CATEGORY_ID ? "active" : ""}`;
  offeredBtn.textContent = "Offert";
  offeredBtn.addEventListener("click", () => {
    state.activeCategory = OFFERED_CATEGORY_ID;
    state.offeredCategory ||= state.menu[0]?.id || null;
    renderCategories();
    renderItems();
  });
  categoryList.appendChild(offeredBtn);
};

const renderItemCard = (item, categoryId, { offered = false } = {}) => {
    const card = document.createElement("div");
    card.className = `item-card${offered ? " offered-item" : ""}`;
    const qty = offered ? getOfferedItemQuantity(item, categoryId) : getMenuItemQuantity(item, categoryId);
    const selectedHead = getSelectedShishaHead();
    const priceLabel = offered
      ? "OFFERT - 0,00 EUR"
      : item.isAdditionalShishaHead
      ? "A partir de 7,00 EUR"
      : item.isShisha
      ? selectedHead
        ? euros(selectedHead.price)
        : "Choisir tete"
      : euros(item.price);
    card.innerHTML = `
      <div>
        <h4>${item.name}</h4>
        <div class="price">${priceLabel}</div>
      </div>
      <div class="item-actions">
        <div class="quantity">
          <button aria-label="Diminuer" data-delta="-1">-</button>
          <div style="display:flex;align-items:center;justify-content:center;font-weight:700;">${qty}</div>
          <button aria-label="Augmenter" data-delta="1">+</button>
        </div>
      </div>
    `;
    if (!offered && item.isShisha && !selectedHead) {
      card.classList.add("needs-head");
      card.querySelectorAll("button[data-delta]").forEach((btn) => {
        btn.disabled = btn.dataset.delta === "1";
        if (btn.dataset.delta === "1") {
          btn.setAttribute("title", "Choisir tete shisha");
        }
      });
    }
    card.querySelectorAll("button[data-delta]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const delta = Number(btn.dataset.delta);
        if (offered) {
          updateOfferedItemQuantity(item, categoryId, delta);
        } else {
          updateItemQuantity(item, delta, categoryId);
        }
      });
    });
    itemList.appendChild(card);
};

const renderOfferedItems = () => {
  const offeredCategory = state.menu.find((category) => category.id === state.offeredCategory) || state.menu[0];
  if (!offeredCategory) return;

  const heading = document.createElement("div");
  heading.className = "offered-menu-heading";
  heading.innerHTML = "<strong>Articles offerts</strong><span>Choisis une categorie, puis l'article a offrir.</span>";
  itemList.appendChild(heading);

  const categoryChoices = document.createElement("div");
  categoryChoices.className = "offered-category-list";
  state.menu.forEach((category) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chip ${state.offeredCategory === category.id ? "active" : ""}`;
    btn.textContent = category.label;
    btn.addEventListener("click", () => {
      state.offeredCategory = category.id;
      renderItems();
    });
    categoryChoices.appendChild(btn);
  });
  itemList.appendChild(categoryChoices);

  offeredCategory.items.forEach((item) => renderItemCard(item, offeredCategory.id, { offered: true }));
};

const renderItems = () => {
  itemList.innerHTML = "";
  if (state.activeCategory === OFFERED_CATEGORY_ID) {
    renderOfferedItems();
    return;
  }

  const category = state.menu.find((c) => c.id === state.activeCategory) || state.menu[0];
  if (!category) return;
  category.items.forEach((item) => renderItemCard(item, category.id));
};

const renderOrder = () => {
  orderItemsEl.innerHTML = "";
  const items = state.currentOrder?.items || [];
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "order-line";
    li.innerHTML = `
      <h4>${item.name}</h4>
      <span class="price">x${item.qty}</span>
      <strong>${euros(item.price * item.qty)}</strong>
      <button class="line-remove" type="button">Retirer</button>
    `;
    li.addEventListener("click", () => updateItemQuantity(item, -1));
    li.querySelector(".line-remove").addEventListener("click", (event) => {
      event.stopPropagation();
      removeOrderLine(item);
    });
    orderItemsEl.appendChild(li);
  });
  const total = items.reduce((acc, curr) => acc + curr.price * curr.qty, 0);
  orderTotalEl.textContent = euros(total);
};

const updatePaymentTotalHint = () => {
  if (!paymentTotalHint || !state.currentOrder) return;
  const total = (state.currentOrder.items || []).reduce((acc, curr) => acc + curr.price * curr.qty, 0);
  const cash = normalizeMoney(paymentCashInput ? paymentCashInput.value : 0);
  const card = normalizeMoney(paymentCardInput ? paymentCardInput.value : 0);
  const entered = Math.round((cash + card) * 100) / 100;
  const diff = Math.round((total - entered) * 100) / 100;
  if (Math.abs(diff) < 0.01) {
    paymentTotalHint.textContent = `Total OK: ${euros(total)}`;
    return;
  }
  if (diff > 0) {
    paymentTotalHint.textContent = `Il manque ${euros(diff)} (total ${euros(total)})`;
    return;
  }
  paymentTotalHint.textContent = `Rendu client: ${euros(Math.abs(diff))} (total ${euros(total)})`;
};

const computePaymentMethod = (totalCash, totalCard) => {
  if (totalCash > 0 && totalCard > 0) return "split";
  if (totalCash > 0) return "cash";
  return "card";
};

const removeOrderLine = (item) => {
  if (!state.currentOrder) return;
  const items = [...state.currentOrder.items];
  const targetIndex = items.findIndex((i) => i.id === item.id);
  if (targetIndex >= 0) {
    items.splice(targetIndex, 1);
  }
  state.currentOrder.items = items;
  renderItems();
  renderOrder();
  persistOrder();
};

const updateOfferedItemQuantity = (item, categoryId, delta) => {
  if (!state.currentOrder) return;
  const items = [...state.currentOrder.items];
  const id = `offert-${categoryId}-${item.id}`;
  const existing = items.find((line) => line.id === id);

  if (!existing && delta > 0) {
    items.push({
      id,
      name: `Offert - ${item.name}`,
      price: 0,
      qty: 1,
      isOffered: true,
      offeredCategoryId: categoryId,
      offeredItemId: item.id
    });
  } else if (existing) {
    existing.qty = Math.max(0, existing.qty + delta);
  }

  state.currentOrder.items = items.filter((line) => line.qty > 0);
  renderItems();
  renderOrder();
  persistOrder();
};

const updateItemQuantity = async (item, delta, categoryId = state.activeCategory) => {
  if (!state.currentOrder) return;
  const items = [...state.currentOrder.items];
  if (item.promotionShishaFlavorId && delta < 0) {
    const existing = items.find((i) => i.id === item.id);
    if (existing) existing.qty = Math.max(0, existing.qty + delta);
  } else if (item.isAdditionalShishaHead) {
    if (delta > 0) {
      const head = await pickAdditionalShishaHead();
      if (!head) return;
      const flavor = await pickShishaFlavor(
        `Tete supplementaire ${head.label}`,
        `Selectionne le gout pour cette tete supplementaire a ${euros(head.price)}.`
      );
      if (!flavor) return;
      const line = buildAdditionalShishaHeadLine(item, head, flavor);
      const existing = items.find((i) => i.id === line.id);
      if (!existing) {
        items.push(line);
      } else {
        existing.qty = Math.max(0, existing.qty + delta);
      }
    } else if (delta < 0) {
      const existing = items.find((i) => i.baseItemId === item.id && i.isAdditionalShishaHead);
      if (existing) existing.qty = Math.max(0, existing.qty + delta);
    }
  } else if (item.isShisha) {
    const head = getSelectedShishaHead();
    if (delta > 0) {
      if (!head) {
        alert("Choisir tete shisha avant d'ajouter un gout");
        return;
      }
      const shishaId = `shisha-${item.id}-${head.id}`;
      const existing = items.find((i) => i.id === shishaId);
      if (!existing) {
        items.push({
          id: shishaId,
          name: `Shisha ${item.name} - ${head.label}`,
          price: head.price,
          qty: 1,
          isShisha: true,
          shishaFlavorId: item.id
        });
      } else {
        existing.qty = Math.max(0, existing.qty + delta);
      }
    } else if (delta < 0) {
      const targetId =
        item.id && item.id.startsWith("shisha-")
          ? item.id
          : head
            ? `shisha-${item.id}-${head.id}`
            : null;
      let existing = targetId ? items.find((i) => i.id === targetId) : null;
      if (!existing) {
        existing = items.find((i) => i.shishaFlavorId === item.id);
      }
      if (existing) {
        existing.qty = Math.max(0, existing.qty + delta);
      }
    }
  } else if (categoryNeedsPromotionFlavor(categoryId)) {
    if (delta > 0) {
      const flavor = await pickPromotionFlavor(item);
      if (!flavor) return;
      const line = buildPromotionFlavorLine(item, flavor);
      const existing = items.find((i) => i.id === line.id);
      if (!existing) {
        items.push(line);
      } else {
        existing.qty = Math.max(0, existing.qty + delta);
      }
    } else if (delta < 0) {
      const existing =
        items.find((i) => i.id === item.id) ||
        items.find((i) => i.baseItemId === item.id);
      if (existing) existing.qty = Math.max(0, existing.qty + delta);
    }
  } else if (categoryNeedsAlcoholOption(categoryId)) {
    if (delta > 0) {
      const isAlcoholized = await pickAlcoholOption(item);
      if (isAlcoholized === null) return;
      const line = buildAlcoholOptionLine(item, isAlcoholized);
      const existing = items.find((i) => i.id === line.id);
      if (!existing) {
        items.push(line);
      } else {
        existing.qty = Math.max(0, existing.qty + delta);
      }
    } else if (delta < 0) {
      const existing =
        items.find((i) => i.id === item.id) ||
        items.find((i) => i.baseItemId === item.id && !i.alcoholized) ||
        items.find((i) => i.baseItemId === item.id);
      if (existing) {
        existing.qty = Math.max(0, existing.qty + delta);
      }
    }
  } else {
    const existing = items.find((i) => i.id === item.id);
    if (!existing && delta > 0) {
      items.push({ ...item, qty: 1 });
    } else if (existing) {
      existing.qty = Math.max(0, existing.qty + delta);
    }
  }
  const filtered = items.filter((i) => i.qty > 0);
  state.currentOrder.items = filtered;
  renderItems();
  renderOrder();
  persistOrder();
};

let saveTimeout;
const persistOrder = () => {
  if (!state.currentOrder) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    state.saving = true;
    try {
      const updated = await api(`/api/orders/${state.currentOrder.id}`, {
        method: "PUT",
        body: JSON.stringify({ items: state.currentOrder.items })
      });
      state.currentOrder = updated;
      localStorage.setItem(`order-${state.currentTable.id}`, JSON.stringify(updated.items));
    } catch (err) {
      console.error(err);
      alert("Echec de sauvegarde");
    } finally {
      state.saving = false;
    }
  }, 250);
};

const renderKitchenStatus = () => {
  if (!state.currentOrder?.sentToKitchen) {
    kitchenStatus.classList.add("hidden");
    kitchenStatus.textContent = "";
    return;
  }
  kitchenStatus.classList.remove("hidden");
  kitchenStatus.textContent = "Envoye en cuisine";
};

const openPrintWindow = (html, options = {}) => {
  const printRoot = document.getElementById("print-root");
  if (!printRoot) {
    alert("Zone d'impression introuvable");
    return;
  }

  const parsed = new DOMParser().parseFromString(html, "text/html");
  printRoot.innerHTML = parsed.body ? parsed.body.innerHTML : html;
  document.body.classList.add("printing-active");
  printRoot.getBoundingClientRect();

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("printing-active");
    printRoot.innerHTML = "";
    window.removeEventListener("afterprint", cleanup);
  };

  window.addEventListener("afterprint", cleanup, { once: true });

  try {
    window.print();
    setTimeout(cleanup, options.cleanupDelay || 120000);
  } catch (error) {
    console.error(error);
    cleanup();
    alert("Impossible de lancer l'impression");
  }
};

const THERMAL_BODY_STYLE = "margin:0;padding:0;width:58mm;background:#fff;color:#000;";
const THERMAL_PRE_STYLE = "margin:0 auto;padding:2mm 1mm 1mm;width:56mm;white-space:pre-wrap;word-break:break-word;font:800 16px/1.25 monospace;color:#000;background:#fff;";
const THERMAL_TEXT_WIDTH = 26;

const buildThermalPrintDocument = (title, text) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="${THERMAL_BODY_STYLE}">
    <pre style="${THERMAL_PRE_STYLE}">${escapeHtml(text)}</pre>
  </body>
</html>`;

const normalizePrintText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const wrapPrintText = (value, width = THERMAL_TEXT_WIDTH) => {
  const text = normalizePrintText(value);
  if (!text) return [""];

  const words = text.split(" ");
  const lines = [];
  let current = "";

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      return;
    }
    if (current) lines.push(current);
    if (word.length <= width) {
      current = word;
      return;
    }
    for (let index = 0; index < word.length; index += width) {
      lines.push(word.slice(index, index + width));
    }
    current = "";
  });

  if (current) lines.push(current);
  return lines.length ? lines : [text];
};

const thermalSeparator = () => "-".repeat(THERMAL_TEXT_WIDTH);

const thermalLine = (label, amount = "") => {
  const text = normalizePrintText(label);
  const amountText = normalizePrintText(amount);
  if (!amountText) return wrapPrintText(text).join("\n");

  const inline = `${text} ${amountText}`.trim();
  if (inline.length <= THERMAL_TEXT_WIDTH) {
    const spaces = Math.max(1, THERMAL_TEXT_WIDTH - text.length - amountText.length);
    return `${text}${" ".repeat(spaces)}${amountText}`;
  }

  return `${wrapPrintText(text).join("\n")}\n${amountText}`;
};

const joinThermalLines = (...sections) =>
  sections
    .flat()
    .filter((line) => line !== null && line !== undefined && line !== "")
    .join("\n");

const printKitchenTicket = (order, kitchenTicket) => {
  const tableLabel = state.currentTable ? `Table ${state.currentTable.id}` : "Table";
  const date = new Date(kitchenTicket.sentAt || Date.now()).toLocaleString();
  const lines = (kitchenTicket.items || [])
    .map(
      (line) =>
        thermalLine(`${line.qty} x ${line.name}`, euros(line.price))
    ) || [];
  const ticketLabel = kitchenTicket.type === "supplement" ? "COMPLEMENT DE COMMANDE" : "PREMIERE COMMANDE";
  const lineCount = (kitchenTicket.items || []).reduce((total, line) => total + line.qty, 0);

  const text = joinThermalLines(
    "TICKET CUISINE",
    ticketLabel,
    tableLabel,
    date,
    thermalSeparator(),
    lines.length ? lines : "Aucun article",
    thermalSeparator(),
    thermalLine("Nouvelles lignes", String(lineCount))
  );

  const html = buildThermalPrintDocument("Ticket Cuisine", text);
  openPrintWindow(html);
};

const sendToKitchen = async () => {
  if (!state.currentOrder || kitchenSendInProgress) return;
  kitchenSendInProgress = true;
  const kitchenButton = document.getElementById("send-kitchen");
  if (kitchenButton) {
    kitchenButton.disabled = true;
    kitchenButton.textContent = "Envoi cuisine...";
  }
  try {
    const { order, kitchenTicket } = await api(`/api/orders/${state.currentOrder.id}/send-kitchen`, {
      method: "POST"
    });
    state.currentOrder = order;
    renderKitchenStatus();
    if (!kitchenTicket) {
      alert("Aucun nouvel article a envoyer en cuisine");
      return;
    }
    alert("Commande envoyee en cuisine");
    printKitchenTicket(order, kitchenTicket);
  } catch (err) {
    console.error(err);
    alert("Impossible d'envoyer en cuisine");
  } finally {
    kitchenSendInProgress = false;
    if (kitchenButton) {
      kitchenButton.disabled = false;
      kitchenButton.textContent = "Envoyer cuisine";
    }
  }
};

const printReceiptTicket = () => {
  if (!lastTicket) {
    alert("Aucun ticket a imprimer");
    return;
  }
  const date = new Date(lastTicket.date);
  const methodLabel = paymentMethodLabel(lastTicket.paymentMethod);
  const totalCash =
    typeof lastTicket.paidCash === "number"
      ? lastTicket.paidCash
      : typeof lastTicket.totalCash === "number"
        ? lastTicket.totalCash
        : 0;
  const totalCard =
    typeof lastTicket.paidCard === "number"
      ? lastTicket.paidCard
      : typeof lastTicket.totalCard === "number"
        ? lastTicket.totalCard
        : 0;
  const lines = (lastTicket.items || [])
    .map(
      (line) =>
        thermalLine(`${line.qty} x ${line.name}`, euros(line.price * line.qty))
    ) || [];
  const paymentDetails = [];
  if (totalCash > 0) {
    paymentDetails.push(thermalLine("Cash", euros(totalCash)));
  }
  if (totalCard > 0) {
    paymentDetails.push(thermalLine("Carte", euros(totalCard)));
  }
  if (!paymentDetails.length) {
    paymentDetails.push(thermalLine("Carte", euros(lastTicket.totalTtc || 0)));
  }
  if (typeof lastTicket.changeDue === "number" && lastTicket.changeDue > 0) {
    paymentDetails.push(thermalLine("Rendu", euros(lastTicket.changeDue)));
  }
  const text = joinThermalLines(
    lastTicket.restaurant || "Ticket",
    `Ticket N ${formatTicketNumber(lastTicket.ticketNumber)}`,
    `Table ${lastTicket.table}`,
    `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`,
    lastTicket.paidBy?.name ? `Serveur: ${lastTicket.paidBy.name}` : null,
    methodLabel,
    hasVatNumber(lastTicket.vatNumber) ? `TVA: ${lastTicket.vatNumber}` : null,
    thermalSeparator(),
    lines.length ? lines : "Aucun article",
    thermalSeparator(),
    paymentDetails,
    thermalLine("Total TTC", euros(lastTicket.totalTtc || 0)),
    "Chaussee d'Haecht 32",
    "1210 Bruxelles"
  );

  const html = buildThermalPrintDocument("Ticket", text);
  openPrintWindow(html);
};

const printDailyTicketNow = () => {
  if (!state.daily) {
    alert("Pas de ticket journalier");
    return;
  }
  const lines = [
    thermalLine("Cash", euros(state.daily.totalCash || 0)),
    thermalLine("Carte", euros(state.daily.totalCard || 0))
  ];
  const displayDate = state.daily.date;
  const text = joinThermalLines(
    RESTAURANT_NAME,
    "TICKET DE LA JOURNEE",
    `Date: ${displayDate}`,
    hasVatNumber(state.daily.vatNumber) ? `TVA: ${state.daily.vatNumber}` : null,
    thermalSeparator(),
    lines,
    thermalSeparator(),
    thermalLine("Total journalier", euros(state.daily.totalTtc || 0))
  );

  const html = buildThermalPrintDocument(`${RESTAURANT_NAME} - TICKET DE LA JOURNEE`, text);
  openPrintWindow(html);
};

const printManagerTotalTicket = async () => {
  if (state.user?.role !== "manager") return;
  try {
    const report = await api("/api/reports/daily");
    state.daily = report;
    printDailyTicketNow();
  } catch (err) {
    console.error(err);
    alert("Impossible de charger le ticket total");
  }
};

const openTable = async (tableId) => {
  try {
    const { table, order } = await api(`/api/tables/${tableId}/open`, { method: "POST" });
    state.currentTable = table;
    const savedItems = localStorage.getItem(`order-${tableId}`);
    if (savedItems && (!order.items || order.items.length === 0)) {
      order.items = JSON.parse(savedItems);
      await api(`/api/orders/${order.id}`, {
        method: "PUT",
        body: JSON.stringify({ items: order.items })
      });
    }
    state.currentOrder = order;
    tableTitle.textContent = `Table ${table.id}`;
    tableStatusLabel.textContent = `Statut : ${statusLabel(table.status)}`;
    tablesPanel.classList.add("hidden");
    orderPanel.classList.remove("hidden");
    renderCategories();
    renderItems();
    renderOrder();
    renderKitchenStatus();
    await refreshTables();
  } catch (err) {
    console.error(err);
    alert("Impossible d'ouvrir la table.");
  }
};

const refreshTables = async () => {
  state.tables = await api("/api/tables");
  renderTables();
};

const markToPay = async () => {
  if (!state.currentOrder) return;
  await api(`/api/orders/${state.currentOrder.id}/mark-to-pay`, { method: "POST" });
  tableStatusLabel.textContent = "Statut : A payer";
  await refreshTables();
  openPaymentModal();
};

const confirmPayment = async () => {
  if (!state.currentOrder) return;
  try {
    const orderTotal = (state.currentOrder.items || []).reduce((acc, curr) => acc + curr.price * curr.qty, 0);
    const totalCash = normalizeMoney(paymentCashInput ? paymentCashInput.value : 0);
    const totalCard = normalizeMoney(paymentCardInput ? paymentCardInput.value : 0);
    const entered = Math.round((totalCash + totalCard) * 100) / 100;
    if (entered + 0.01 < orderTotal) {
      alert(`Le total saisi (${euros(entered)}) doit etre au moins egal au total commande (${euros(orderTotal)}).`);
      return;
    }
    const method = computePaymentMethod(totalCash, totalCard);
    state.paymentMethod = method;
    const ticket = await api(`/api/orders/${state.currentOrder.id}/settle`, {
      method: "POST",
      body: JSON.stringify({
        paymentMethod: method,
        paymentAmounts: {
          cash: totalCash,
          card: totalCard
        }
      })
    });
    showTicket(ticket);
    localStorage.removeItem(`order-${state.currentTable.id}`);
    state.currentOrder = null;
    state.currentTable = null;
    orderPanel.classList.add("hidden");
    tablesPanel.classList.remove("hidden");
    await refreshTables();
    hidePaymentModal();
  } catch (err) {
    console.error(err);
    alert("Impossible d'encaisser");
    hidePaymentModal();
  }
};

const showTicket = (ticket) => {
  lastTicket = ticket;
  ticketRestaurant.textContent = ticket.restaurant;
  const date = new Date(ticket.date);
  if (ticketVat) {
    ticketVat.textContent = hasVatNumber(ticket.vatNumber) ? `TVA: ${ticket.vatNumber}` : "";
  }
  const methodLabel = paymentMethodLabel(ticket.paymentMethod);
  const serverLabel = ticket.paidBy?.name ? `  -  Serveur: ${ticket.paidBy.name}` : "";
  ticketMeta.textContent = `Ticket N ${formatTicketNumber(ticket.ticketNumber)}  -  Table ${ticket.table}  -  ${date.toLocaleDateString()} ${date.toLocaleTimeString()}  -  ${methodLabel}${serverLabel}`;
  ticketLines.innerHTML = "";
  ticket.items.forEach((line) => {
    const row = document.createElement("div");
    row.className = "ticket-row";
    row.innerHTML = `<span>${line.qty} x ${line.name}</span><strong>${euros(line.price * line.qty)}</strong>`;
    ticketLines.appendChild(row);
  });
  if (typeof ticket.totalCash === "number" || typeof ticket.totalCard === "number") {
    const totalCash =
      typeof ticket.paidCash === "number"
        ? ticket.paidCash
        : typeof ticket.totalCash === "number"
          ? ticket.totalCash
          : 0;
    const totalCard =
      typeof ticket.paidCard === "number"
        ? ticket.paidCard
        : typeof ticket.totalCard === "number"
          ? ticket.totalCard
          : 0;
    const cashRow = document.createElement("div");
    cashRow.className = "ticket-row";
    cashRow.innerHTML = `<span>Cash</span><strong>${euros(totalCash)}</strong>`;
    ticketLines.appendChild(cashRow);
    const cardRow = document.createElement("div");
    cardRow.className = "ticket-row";
    cardRow.innerHTML = `<span>Carte</span><strong>${euros(totalCard)}</strong>`;
    ticketLines.appendChild(cardRow);
    if (typeof ticket.changeDue === "number" && ticket.changeDue > 0) {
      const changeRow = document.createElement("div");
      changeRow.className = "ticket-row";
      changeRow.innerHTML = `<span>Rendu</span><strong>${euros(ticket.changeDue)}</strong>`;
      ticketLines.appendChild(changeRow);
    }
  }
  ticketTotal.textContent = euros(ticket.totalTtc);
  const existingAddress = ticketModal.querySelector(".ticket-address");
  if (existingAddress) {
    existingAddress.textContent = "Chaussée d'Haecht 32, 1210 Bruxelles";
  } else {
    const addr = document.createElement("div");
    addr.className = "ticket-address";
    addr.textContent = "Chaussée d'Haecht 32, 1210 Bruxelles";
    ticketTotal.parentElement.appendChild(addr);
  }
  ticketModal.classList.remove("hidden");
};

const hideTicket = () => ticketModal.classList.add("hidden");

const loadDailyReport = async () => {
  try {
    const report = await api("/api/reports/daily");
    state.daily = report;
    renderDaily(report);
    try {
      await api("/api/reports/daily/send", {
        method: "POST",
        body: JSON.stringify({ date: report.date })
      });
    } catch (sendErr) {
      console.error(sendErr);
      alert("Ticket journalier affiche, mais l'envoi Telegram a echoue.");
    }
  } catch (err) {
    console.error(err);
    alert("Impossible de charger le ticket journalier");
  }
};

const renderDaily = (report) => {
  if (!report) return;
  if (dailyTitle) dailyTitle.textContent = "TICKET DE LA JOURNEE";
  dailyDate.textContent = `Date : ${report.date}`;
  if (dailyRestaurant) dailyRestaurant.textContent = RESTAURANT_NAME;
  if (dailyVat) dailyVat.textContent = hasVatNumber(report.vatNumber) ? `TVA: ${report.vatNumber}` : "";
  dailyLines.innerHTML = "";
  const cashRow = document.createElement("div");
  cashRow.className = "ticket-row";
  cashRow.innerHTML = `<span>Cash</span><strong>${euros(report.totalCash || 0)}</strong>`;
  dailyLines.appendChild(cashRow);
  const cardRow = document.createElement("div");
  cardRow.className = "ticket-row";
  cardRow.innerHTML = `<span>Carte</span><strong>${euros(report.totalCard || 0)}</strong>`;
  dailyLines.appendChild(cardRow);
  dailyTotal.textContent = euros(report.totalTtc || 0);
  dailyModal.classList.remove("hidden");
};

const hideDaily = () => dailyModal.classList.add("hidden");

const openPaymentModal = () => {
  if (!paymentModal || !state.currentOrder) return;
  const total = (state.currentOrder.items || []).reduce((acc, curr) => acc + curr.price * curr.qty, 0);
  if (paymentCashInput) paymentCashInput.value = "0.00";
  if (paymentCardInput) paymentCardInput.value = total.toFixed(2);
  updatePaymentTotalHint();
  paymentModal.classList.remove("hidden");
};

const hidePaymentModal = () => {
  if (!paymentModal) return;
  paymentModal.classList.add("hidden");
};

const createHistoryLineMarkup = (item = {}) => {
  const match = findHistoryMenuMatch(item);
  const categoryId = match ? match.categoryId : "";
  const menuItemId = match ? match.menuItemId : "";
  const isCustom = !match && Boolean(item.name);
  const selectedCategory = isCustom ? HISTORY_CUSTOM_CATEGORY : categoryId;
  const menuDisabled = !categoryId || isCustom ? " disabled" : "";
  const customNameHidden = isCustom ? "" : " hidden";

  return `
    <div class="history-line" data-item-id="${escapeHtml(item.id || "")}">
      <div class="history-item-picker">
        <select data-item-field="category">
          ${getHistoryCategoryOptionsMarkup(selectedCategory)}
        </select>
        <select data-item-field="menuItem"${menuDisabled}>
          ${getHistoryArticleOptionsMarkup(categoryId, menuItemId)}
        </select>
        <input
          type="text"
          data-item-field="name"
          placeholder="Article personnalise"
          value="${escapeHtml(isCustom ? item.name || "" : "")}"
          ${customNameHidden}
        />
      </div>
      <input type="number" step="1" min="1" data-item-field="qty" value="${Math.max(1, Number(item.qty) || 1)}" />
      <input type="number" step="0.01" min="0" data-item-field="price" value="${normalizeMoney(item.price).toFixed(2)}" />
      <button type="button" class="btn-line-remove" data-action="remove-line">Retirer</button>
    </div>
  `;
};

const syncHistoryLinePicker = (line, options = {}) => {
  const { resetItemSelection = false } = options;
  const categorySelect = line.querySelector('[data-item-field="category"]');
  const itemSelect = line.querySelector('[data-item-field="menuItem"]');
  const nameInput = line.querySelector('[data-item-field="name"]');
  const priceInput = line.querySelector('[data-item-field="price"]');
  if (!categorySelect || !itemSelect || !nameInput || !priceInput) return;

  const categoryId = categorySelect.value;
  const isCustom = categoryId === HISTORY_CUSTOM_CATEGORY;

  if (isCustom) {
    itemSelect.innerHTML = '<option value="">Article libre</option>';
    itemSelect.disabled = true;
    itemSelect.value = "";
    nameInput.hidden = false;
    return;
  }

  nameInput.hidden = true;
  nameInput.value = "";
  itemSelect.disabled = !categoryId;
  itemSelect.innerHTML = getHistoryArticleOptionsMarkup(categoryId, resetItemSelection ? "" : itemSelect.value);

  if (resetItemSelection) {
    itemSelect.value = "";
    priceInput.value = "0.00";
    return;
  }

  const selectedItem = getHistoryMenuItemById(categoryId, itemSelect.value);
  if (selectedItem) {
    priceInput.value = normalizeMoney(selectedItem.price).toFixed(2);
  }
};

const readHistoryItems = (wrap) =>
  [...wrap.querySelectorAll(".history-line")]
    .map((line, index) => {
      const categoryId = line.querySelector('[data-item-field="category"]').value;
      const selectedItemId = line.querySelector('[data-item-field="menuItem"]').value;
      const customName = line.querySelector('[data-item-field="name"]').value.trim();
      const qty = Math.max(0, Math.round(Number(line.querySelector('[data-item-field="qty"]').value || 0)));
      const price = normalizeMoney(line.querySelector('[data-item-field="price"]').value);
      let id = line.dataset.itemId || `history-line-${Date.now()}-${index}`;
      let name = customName;

      if (categoryId && categoryId !== HISTORY_CUSTOM_CATEGORY) {
        const selectedItem = getHistoryMenuItemById(categoryId, selectedItemId);
        if (!selectedItem) return null;
        id = selectedItem.id;
        name = selectedItem.name;
      }

      if (!name || qty < 1) return null;
      return { id, name, qty, price };
    })
    .filter(Boolean);

const updateHistoryDraftHint = (wrap) => {
  const hint = wrap.querySelector('[data-role="draft-total"]');
  if (!hint) return;
  const items = readHistoryItems(wrap);
  const total = computeItemsTotal(items);
  const cash = normalizeMoney(wrap.querySelector('[data-field="cash"]').value);
  const card = normalizeMoney(wrap.querySelector('[data-field="card"]').value);
  const paid = Math.round((cash + card) * 100) / 100;
  const diff = Math.round((paid - total) * 100) / 100;
  if (!items.length) {
    hint.textContent = "Commande vide";
    return;
  }
  if (Math.abs(diff) < 0.01) {
    hint.textContent = `Commande ${euros(total)} | Paiement OK`;
    return;
  }
  if (diff > 0) {
    hint.textContent = `Commande ${euros(total)} | Rendu ${euros(diff)}`;
    return;
  }
  hint.textContent = `Commande ${euros(total)} | Il manque ${euros(Math.abs(diff))}`;
};

const renderPaymentHistory = (list) => {
  if (!historyList) return;
  historyList.innerHTML = "";
  if (!list || list.length === 0) {
    historyList.innerHTML = "<div>Aucun paiement.</div>";
    return;
  }
  list.forEach((entry) => {
    const wrap = document.createElement("div");
    wrap.className = "history-item";
    const date = new Date(entry.date);
    const includeChecked = entry.includeInDaily ? "checked" : "";
    const isDeleted = entry.status === "deleted";
    const includeDisabled = isDeleted ? "disabled" : "";
    const actionDisabled = isDeleted ? "disabled" : "";
    const itemsMarkup =
      (entry.items || []).map((item) => createHistoryLineMarkup(item)).join("") ||
      createHistoryLineMarkup({ name: "", qty: 1, price: 0 });
    wrap.innerHTML = `
      <div class="history-meta">
        <strong>Ticket ${formatTicketNumber(entry.ticketNumber)}</strong>
        <span>Table ${entry.table}</span>
        <span>${date.toLocaleDateString()} ${date.toLocaleTimeString()}</span>
        <span>Total ${euros(entry.totalTtc || 0)}</span>
      </div>
      <div class="history-meta">
        <span>Cash: ${euros(entry.totalCash || 0)}</span>
        <span>Carte: ${euros(entry.totalCard || 0)}</span>
        <span>Encaisse par: ${escapeHtml(entry.paidBy?.name || "Non renseigne")}</span>
        <span>Table ouverte par: ${escapeHtml(entry.openedBy?.name || "Non renseigne")}</span>
        <span class="history-status">Statut: ${paymentStatusLabel(entry.status)}</span>
      </div>
      <label class="history-toggle">
        <input type="checkbox" data-field="include" ${includeChecked} ${includeDisabled} />
        Afficher dans le ticket journalier
      </label>
      <div class="history-editor">
        <div class="history-editor-head">
          <strong>Commande</strong>
          <button type="button" class="ghost-btn history-add-line" data-action="add-line" ${actionDisabled}>Ajouter ligne</button>
        </div>
        <div class="history-editor-labels">
          <span>Categorie / Article</span>
          <span>Qté</span>
          <span>Prix</span>
          <span></span>
        </div>
        <div class="history-lines">${itemsMarkup}</div>
        <div class="history-draft-total" data-role="draft-total"></div>
      </div>
      <div class="history-actions">
        <input type="number" step="0.01" min="0" value="${(entry.paidCash ?? entry.totalCash ?? 0).toFixed(2)}" data-field="cash" ${actionDisabled}/>
        <input type="number" step="0.01" min="0" value="${(entry.paidCard ?? entry.totalCard ?? 0).toFixed(2)}" data-field="card" ${actionDisabled}/>
        <button class="btn-edit" data-action="edit" ${actionDisabled}>Enregistrer</button>
        <button class="btn-delete" data-action="delete" ${actionDisabled}>Supprimer</button>
      </div>
    `;
    updateHistoryDraftHint(wrap);
    wrap.querySelector('[data-field="include"]').addEventListener("change", async (event) => {
      try {
        await api(`/api/payments/history/${entry.id}`, {
          method: "PUT",
          body: JSON.stringify({ includeInDaily: event.target.checked })
        });
        await openHistoryModal();
      } catch (err) {
        console.error(err);
        alert("Impossible de modifier l'affichage journalier");
      }
    });
    wrap.addEventListener("input", (event) => {
      if (event.target.matches('[data-field="cash"], [data-field="card"], [data-item-field]')) {
        updateHistoryDraftHint(wrap);
      }
    });
    wrap.addEventListener("change", (event) => {
      const line = event.target.closest(".history-line");
      if (!line) return;
      if (event.target.matches('[data-item-field="category"]')) {
        syncHistoryLinePicker(line, { resetItemSelection: true });
        updateHistoryDraftHint(wrap);
        return;
      }
      if (event.target.matches('[data-item-field="menuItem"]')) {
        syncHistoryLinePicker(line);
        updateHistoryDraftHint(wrap);
      }
    });
    wrap.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      const { action } = button.dataset;
      if (!action || isDeleted) return;
      if (action === "add-line") {
        wrap.querySelector(".history-lines").insertAdjacentHTML(
          "beforeend",
          createHistoryLineMarkup({ name: "", qty: 1, price: 0 })
        );
        const newLine = wrap.querySelector(".history-lines .history-line:last-child");
        if (newLine) syncHistoryLinePicker(newLine, { resetItemSelection: true });
        updateHistoryDraftHint(wrap);
        return;
      }
      if (action === "remove-line") {
        const line = button.closest(".history-line");
        if (line) line.remove();
        updateHistoryDraftHint(wrap);
        return;
      }
      if (action === "edit") {
        const cash = wrap.querySelector('[data-field="cash"]').value;
        const card = wrap.querySelector('[data-field="card"]').value;
        const items = readHistoryItems(wrap);
        if (!items.length) {
          alert("Ajoute au moins une ligne de commande valide");
          return;
        }
        try {
          await api(`/api/payments/history/${entry.id}`, {
            method: "PUT",
            body: JSON.stringify({ cash, card, items })
          });
          await openHistoryModal();
        } catch (err) {
          console.error(err);
          alert("Impossible de modifier cette commande payee");
        }
        return;
      }
      if (action === "delete") {
        if (!confirm("Supprimer ce paiement de l'historique ?")) return;
        try {
          await api(`/api/payments/history/${entry.id}`, { method: "DELETE" });
          await openHistoryModal();
        } catch (err) {
          console.error(err);
          alert("Impossible de supprimer ce paiement");
        }
      }
    });
    historyList.appendChild(wrap);
  });
};

const openHistoryModal = async () => {
  if (!historyModal) return;
  try {
    const list = await api("/api/payments/history");
    renderPaymentHistory(list);
    historyModal.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    alert("Impossible de charger l'historique");
  }
};

const hideHistoryModal = () => {
  if (!historyModal) return;
  historyModal.classList.add("hidden");
};

const isManagerUser = () => state.user?.role === "manager";

const updateUserInterface = () => {
  if (currentUserEl) {
    const role = isManagerUser() ? "Gerant" : "Serveur";
    currentUserEl.textContent = state.user ? `${state.user.name} - ${role}` : "";
  }
  managerOnlyEls.forEach((element) => element.classList.toggle("hidden", !isManagerUser()));
};

const hideStaffModal = () => {
  if (staffModal) staffModal.classList.add("hidden");
};

const renderStaffList = (staff) => {
  if (!staffList) return;
  staffList.innerHTML = "";
  staff.forEach((member) => {
    const row = document.createElement("div");
    row.className = "staff-row";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <span>${member.role === "manager" ? "Gerant" : "Serveur"}</span>
      </div>
      <input type="password" inputmode="numeric" minlength="4" placeholder="Nouveau PIN" />
      <div class="staff-actions">
        <button class="ghost-btn staff-pin-btn" type="button">Modifier PIN</button>
        ${member.role === "manager" ? "" : '<button class="ghost-btn danger-btn staff-delete-btn" type="button">Supprimer</button>'}
      </div>
    `;
    const pinInput = row.querySelector("input");
    row.querySelector(".staff-pin-btn").addEventListener("click", async () => {
      const pin = pinInput.value.trim();
      if (pin.length < 4) {
        alert("Le PIN doit contenir au moins 4 chiffres");
        return;
      }
      try {
        await api(`/api/staff/${member.id}`, {
          method: "PUT",
          body: JSON.stringify({ pin })
        });
        pinInput.value = "";
        alert(`PIN de ${member.name} modifie`);
      } catch (err) {
        console.error(err);
        alert("Impossible de modifier le PIN");
      }
    });
    const deleteBtn = row.querySelector(".staff-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!window.confirm(`Supprimer definitivement ${member.name} ?`)) return;
        try {
          await api(`/api/staff/${member.id}`, { method: "DELETE" });
          await openStaffModal();
        } catch (err) {
          console.error(err);
          alert("Impossible de supprimer ce serveur");
        }
      });
    }
    staffList.appendChild(row);
  });
};

const openStaffModal = async () => {
  if (!isManagerUser() || !staffModal) return;
  try {
    const staff = await api("/api/staff");
    renderStaffList(staff);
    staffModal.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    alert("Impossible de charger le personnel");
  }
};

const createStaff = async (event) => {
  event.preventDefault();
  const name = staffCreateName?.value.trim() || "";
  const pin = staffCreatePin?.value.trim() || "";
  try {
    await api("/api/staff", {
      method: "POST",
      body: JSON.stringify({ name, pin })
    });
    if (staffCreateName) staffCreateName.value = "";
    if (staffCreatePin) staffCreatePin.value = "";
    await openStaffModal();
  } catch (err) {
    console.error(err);
    alert("Impossible d'ajouter ce serveur. Verifie le nom et le PIN.");
  }
};

const hideStaffReportModal = () => {
  if (staffReportModal) staffReportModal.classList.add("hidden");
};

const printStaffReport = (report, date) => {
  const payments = (report.tickets || []).map((ticket) =>
    thermalLine(`Table ${ticket.table} - Ticket ${formatTicketNumber(ticket.ticketNumber)}`, euros(ticket.totalTtc || 0))
  );
  const pointages = (report.pointages || []).map((item) => `${item.qty} x ${item.name}`);
  const text = joinThermalLines(
    RESTAURANT_NAME,
    `TICKET SERVEUR - ${report.staff.name}`,
    `Date: ${date}`,
    thermalSeparator(),
    "Encaissements",
    payments.length ? payments : "Aucun paiement",
    thermalSeparator(),
    thermalLine("Cash", euros(report.totalCash || 0)),
    thermalLine("Carte", euros(report.totalCard || 0)),
    thermalLine("Total", euros(report.totalTtc || 0)),
    thermalSeparator(),
    "Articles pointes",
    pointages.length ? pointages : "Aucun article pointe"
  );
  openPrintWindow(buildThermalPrintDocument(`Ticket ${report.staff.name}`, text));
};

const renderStaffReports = (data) => {
  if (!staffReportList) return;
  staffReportList.innerHTML = "";
  if (staffReportDate) staffReportDate.textContent = `Date : ${data.date}`;
  (data.reports || []).forEach((report) => {
    const card = document.createElement("div");
    card.className = "staff-report-card";
    const pointages = (report.pointages || [])
      .map((item) => `<li>${item.qty} x ${escapeHtml(item.name)}</li>`)
      .join("") || "<li>Aucun article pointe</li>";
    card.innerHTML = `
      <div class="staff-report-head">
        <strong>${escapeHtml(report.staff.name)}</strong>
        <span>${report.ticketCount} paiement(s)</span>
      </div>
      <div class="history-meta">
        <span>Cash: ${euros(report.totalCash || 0)}</span>
        <span>Carte: ${euros(report.totalCard || 0)}</span>
        <span>Total: ${euros(report.totalTtc || 0)}</span>
      </div>
      <p class="staff-report-label">Articles pointes</p>
      <ul class="staff-pointages">${pointages}</ul>
      <button class="pill-btn primary" type="button">Imprimer le ticket</button>
    `;
    card.querySelector("button").addEventListener("click", () => printStaffReport(report, data.date));
    staffReportList.appendChild(card);
  });
};

const openStaffReportModal = async () => {
  if (!isManagerUser() || !staffReportModal) return;
  try {
    const report = await api("/api/reports/staff");
    renderStaffReports(report);
    staffReportModal.classList.remove("hidden");
  } catch (err) {
    console.error(err);
    alert("Impossible de charger le suivi des serveurs");
  }
};

const lockApp = async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (err) {
    console.error(err);
  } finally {
    redirectToLogin();
  }
};

const registerEvents = () => {
  document.getElementById("back-to-tables").addEventListener("click", () => {
    orderPanel.classList.add("hidden");
    tablesPanel.classList.remove("hidden");
    state.currentTable = null;
    state.currentOrder = null;
  });
  document.getElementById("mark-pay").addEventListener("click", markToPay);
  document.getElementById("send-kitchen").addEventListener("click", sendToKitchen);
  document.getElementById("refresh-tables").addEventListener("click", refreshTables);
  document.getElementById("close-ticket").addEventListener("click", hideTicket);
  document.getElementById("print-ticket").addEventListener("click", printReceiptTicket);
  document.getElementById("daily-report").addEventListener("click", loadDailyReport);
  document.getElementById("close-daily").addEventListener("click", hideDaily);
  document.getElementById("print-daily").addEventListener("click", printDailyTicketNow);
  if (managerTotalTicketBtn) managerTotalTicketBtn.addEventListener("click", printManagerTotalTicket);
  if (staffManagementBtn) staffManagementBtn.addEventListener("click", openStaffModal);
  if (staffReportBtn) staffReportBtn.addEventListener("click", openStaffReportModal);
  if (closeStaffBtn) closeStaffBtn.addEventListener("click", hideStaffModal);
  if (closeStaffReportBtn) closeStaffReportBtn.addEventListener("click", hideStaffReportModal);
  if (staffCreateForm) staffCreateForm.addEventListener("submit", createStaff);
  if (lockAppBtn) lockAppBtn.addEventListener("click", lockApp);
  if (historyBtn) historyBtn.addEventListener("click", openHistoryModal);
  if (closeHistoryBtn) closeHistoryBtn.addEventListener("click", hideHistoryModal);
  if (confirmPaymentBtn) confirmPaymentBtn.addEventListener("click", confirmPayment);
  if (cancelPaymentBtn) cancelPaymentBtn.addEventListener("click", hidePaymentModal);
  if (alcoholOptionNoBtn) alcoholOptionNoBtn.addEventListener("click", () => resolveAlcoholOption(false));
  if (alcoholOptionYesBtn) alcoholOptionYesBtn.addEventListener("click", () => resolveAlcoholOption(true));
  if (alcoholOptionCancelBtn) alcoholOptionCancelBtn.addEventListener("click", () => resolveAlcoholOption(null));
  if (promotionFlavorCancelBtn) {
    promotionFlavorCancelBtn.addEventListener("click", () => resolvePromotionFlavor(null));
  }
  if (additionalShishaHeadCancelBtn) {
    additionalShishaHeadCancelBtn.addEventListener("click", () => resolveAdditionalShishaHead(null));
  }
  if (paymentCashInput) paymentCashInput.addEventListener("input", updatePaymentTotalHint);
  if (paymentCardInput) paymentCardInput.addEventListener("input", updatePaymentTotalHint);
  document.getElementById("fullscreen-btn").addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
};

const registerServiceWorker = () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
};

const init = async () => {
  try {
    const auth = await api("/api/auth/status");
    if (!auth.authenticated || !auth.user) {
      redirectToLogin();
      return;
    }
    state.user = auth.user;
    updateUserInterface();
    registerEvents();
    registerServiceWorker();
    state.menu = await api("/api/menu");
    state.activeCategory = state.menu[0]?.id;
    state.paymentMethod = "card";
    renderCategories();
    renderItems();
    await refreshTables();
  } catch (err) {
    console.error(err);
    redirectToLogin();
  }
};

document.addEventListener("DOMContentLoaded", init);




















