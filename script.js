// ====== Dane w pamięci (MVP) ======
// Startujemy bez "demo" maszyn. Użytkownik dodaje własny katalog.
const DEFAULT_MACHINE_CATALOG = [];

const state = {
  // partie magazynowe
  lots: [],

  // magazyn maszyn
  machinesStock: [],

  // GLOBALNY katalog części: skuLower -> { sku, name }
  partsCatalog: new Map(),

  // Dostawcy: name -> { prices: Map(skuLower -> price) }
  suppliers: new Map(),

  // BOM maszyn
  machineCatalog: JSON.parse(JSON.stringify(DEFAULT_MACHINE_CATALOG)),

  // dostawa
  currentDelivery: {
    supplier: null,
    dateISO: "",
    items: [] // {id, sku, name, qty, price}
  },

  // produkcja
  currentBuild: {
    dateISO: "",
    items: [] // {id, machineCode, machineName, qty}
  }
};

let _id = 1;
function nextId() { return _id++; }

const fmtPLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

// progi podświetlania w podsumowaniu per Nazwę (unikat)
let LOW_WARN = 100;
let LOW_DANGER = 50;

let manualPlanGenerated = false;

// ====== LocalStorage (zapis stanu) ======
const STORAGE_KEY = "magazyn_state_v1";

function serializeState() {
  return {
    lots: state.lots,
    machinesStock: state.machinesStock,
    machineCatalog: state.machineCatalog,

    currentDelivery: state.currentDelivery,
    currentBuild: state.currentBuild,

    LOW_WARN,
    LOW_DANGER,

    partsCatalog: Array.from(state.partsCatalog.entries()), // [[skuLower, {sku,name}], ...]
    suppliers: Array.from(state.suppliers.entries()).map(([name, obj]) => ({
      name,
      prices: Array.from(obj?.prices?.entries?.() || []) // [[skuLower, price], ...]
    }))
  };
}

function applySerializedState(data) {
  // prosta walidacja
  if (!data || typeof data !== "object") return;

  state.lots = Array.isArray(data.lots) ? data.lots : [];
  state.machinesStock = Array.isArray(data.machinesStock) ? data.machinesStock : [];
  state.machineCatalog = Array.isArray(data.machineCatalog) ? data.machineCatalog : JSON.parse(JSON.stringify(DEFAULT_MACHINE_CATALOG));

  state.currentDelivery = data.currentDelivery && typeof data.currentDelivery === "object"
    ? data.currentDelivery
    : state.currentDelivery;

  // normalizacja placeholdera (stare wersje)
  if (state.currentDelivery && state.currentDelivery.supplier === "Wybierz dostawcę...") {
    state.currentDelivery.supplier = null;
  }

  state.currentBuild = data.currentBuild && typeof data.currentBuild === "object"
    ? data.currentBuild
    : state.currentBuild;

  LOW_WARN = Number.isFinite(data.LOW_WARN) ? data.LOW_WARN : LOW_WARN;
  LOW_DANGER = Number.isFinite(data.LOW_DANGER) ? data.LOW_DANGER : LOW_DANGER;

  state.partsCatalog = new Map(Array.isArray(data.partsCatalog) ? data.partsCatalog : []);
  state.suppliers = new Map();
  if (Array.isArray(data.suppliers)) {
    for (const s of data.suppliers) {
      if (!s?.name) continue;
      const pricesArr = Array.isArray(s.prices) ? s.prices : [];
      state.suppliers.set(s.name, { prices: new Map(pricesArr) });
    }
  }

  // odtwórz licznik ID (żeby nie było duplikatów po odświeżeniu)
  const maxIn = (arr) => Array.isArray(arr) ? arr.reduce((m, x) => Math.max(m, Number(x?.id) || 0), 0) : 0;
  const maxId = Math.max(
    maxIn(state.lots),
    maxIn(state.currentDelivery?.items),
    maxIn(state.currentBuild?.items)
  );
  _id = Math.max(1, maxId + 1);
}

function saveState() {
  try {
    const payload = serializeState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("saveState() failed:", e);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    applySerializedState(data);
    return true;
  } catch (e) {
    console.warn("loadState() failed:", e);
    return false;
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

function resetAllData() {
  state.lots = [];
  state.machinesStock = [];
  state.partsCatalog = new Map();
  state.suppliers = new Map();
  state.machineCatalog = JSON.parse(JSON.stringify(DEFAULT_MACHINE_CATALOG));

  state.currentDelivery = { supplier: null, dateISO: "", items: [] };
  state.currentBuild = { dateISO: "", items: [] };

  LOW_WARN = 100;
  LOW_DANGER = 50;

  _id = 1;
  manualPlanGenerated = false;
}

function stockClass(totalQty) {
  if (totalQty < LOW_DANGER) return "stock-danger";
  if (totalQty < LOW_WARN) return "stock-warn";
  return "";
}

// ====== Elementy UI ======
const els = {

    machineCodeInput: document.getElementById("machineCodeInput"),
machineNameInput: document.getElementById("machineNameInput"),
addMachineBtn: document.getElementById("addMachineBtn"),
machineManageSelect: document.getElementById("machineManageSelect"),
bomSkuSelect: document.getElementById("bomSkuSelect"),
bomQtyInput: document.getElementById("bomQtyInput"),
addBomItemBtn: document.getElementById("addBomItemBtn"),
bomBody: document.querySelector("#bomTable tbody"),
  machinesCatalogBody: document.querySelector("#machinesCatalogTable tbody"),

  // magazyn części
  searchParts: document.getElementById("searchParts"),
  clearDataBtn: document.getElementById("clearDataBtn"),
  skuSummaryBody: document.querySelector("#skuSummaryTable tbody"),
  lotsBody: document.querySelector("#partsTable tbody"),
  warehouseTotal: document.getElementById("warehouseTotal"),

  // suwaki progów (opcjonalne)
  warnRange: document.getElementById("warnRange"),
  dangerRange: document.getElementById("dangerRange"),
  warnValue: document.getElementById("warnValue"),
  dangerValue: document.getElementById("dangerValue"),

  // dostawy
  supplierSelect: document.getElementById("supplierSelect"),
  deliveryDate: document.getElementById("deliveryDate"),
  supplierPartsSelect: document.getElementById("supplierPartsSelect"),
  deliveryQty: document.getElementById("deliveryQty"),
  deliveryPrice: document.getElementById("deliveryPrice"),
  addDeliveryItemBtn: document.getElementById("addDeliveryItemBtn"),
  deliveryItemsBody: document.querySelector("#deliveryItemsTable tbody"),
  itemsCount: document.getElementById("itemsCount"),
  itemsTotal: document.getElementById("itemsTotal"),
  finalizeDeliveryBtn: document.getElementById("finalizeDeliveryBtn"),

  // produkcja
  machineSelect: document.getElementById("machineSelect"),
  buildQty: document.getElementById("buildQty"),
  buildDate: document.getElementById("buildDate"),
  addBuildItemBtn: document.getElementById("addBuildItemBtn"),
  buildItemsBody: document.querySelector("#buildItemsTable tbody"),
  buildItemsCount: document.getElementById("buildItemsCount"),
  finalizeBuildBtn: document.getElementById("finalizeBuildBtn"),
  missingBox: document.getElementById("missingBox"),
  missingList: document.getElementById("missingList"),
  consumeMode: document.getElementById("consumeMode"),
  manualConsumeBox: document.getElementById("manualConsumeBox"),
  manualConsumeUI: document.getElementById("manualConsumeUI"),

  // magazyn maszyn
  searchMachines: document.getElementById("searchMachines"),
  machinesStockBody: document.querySelector("#machinesStockTable tbody"),

  // NOWE: katalog części + dostawcy
  partSkuInput: document.getElementById("partSkuInput"),
  partNameInput: document.getElementById("partNameInput"),
  addPartBtn: document.getElementById("addPartBtn"),
  partsCatalogBody: document.querySelector("#partsCatalogTable tbody"),

  supplierNameInput: document.getElementById("supplierNameInput"),
  addSupplierBtn: document.getElementById("addSupplierBtn"),
  supplierManageSelect: document.getElementById("supplierManageSelect"),
  supplierSkuSelect: document.getElementById("supplierSkuSelect"),
  supplierPriceInput: document.getElementById("supplierPriceInput"),
  setSupplierPriceBtn: document.getElementById("setSupplierPriceBtn"),
  supplierPriceBody: document.querySelector("#supplierPriceTable tbody"),
  suppliersListBody: document.querySelector("#suppliersListTable tbody")
};

// ====== Utils ======

function hasPendingWork() {
  return (
    state.currentDelivery.items.length > 0 ||
    state.currentBuild.items.length > 0
  );
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(str) { return escapeHtml(str).replaceAll('"', "&quot;"); }

function normSku(sku) { return String(sku || "").trim(); }
function skuKey(sku) { return normSku(sku).toLowerCase(); }

// liczby/kwoty: wywal NaN, trzymaj >= 0
function safePrice(val, fallback = 0) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

// ====== Katalog części (globalny) ======
function upsertPart(sku, name) {
  const s = normSku(sku);
  const n = String(name || "").trim();
  if (!s || !n) return { ok: false, msg: "Podaj Nazwę (unikat) i Typ." };

  const key = skuKey(s);
  if (state.partsCatalog.has(key)) {
    // aktualizuj nazwę
    state.partsCatalog.set(key, { sku: s, name: n });
    return { ok: true, msg: "Zaktualizowano część." };
  }
  state.partsCatalog.set(key, { sku: s, name: n });
  return { ok: true, msg: "Dodano część." };
}

function getPartName(sku) {
  const key = skuKey(sku);
  const it = state.partsCatalog.get(key);
  return it ? it.name : String(sku || "").toUpperCase();
}

function renderPartsCatalogTable() {
  if (!els.partsCatalogBody) return;

  // sortuj po Nazwie (unikatowej), bo to jest klucz i najłatwiej to znaleźć
  const rows = Array.from(state.partsCatalog.entries())
    .map(([skuLower, p]) => ({ skuLower, ...p }))
    .sort((a, b) => a.sku.localeCompare(b.sku, "pl"));

  els.partsCatalogBody.innerHTML = rows.map(p => {
    const reason = getPartDeleteBlockReason(p.skuLower);
    const disabled = reason ? "disabled" : "";
    const title = reason ? `title="${escapeAttr(reason)}"` : "";
    return `
    <tr>
      <td><span class="badge">${escapeHtml(p.sku)}</span></td>
      <td>${escapeHtml(p.name)}</td>
      <td class="right">
        <button type="button" class="secondary" data-delete-part="${escapeAttr(p.skuLower)}" ${disabled} ${title}>Usuń</button>
      </td>
    </tr>
  `;
  }).join("");
}


function getPartDeleteBlockReason(skuLower) {
  // Blokujemy usuwanie, jeśli część jest użyta gdziekolwiek w systemie.
  const inLots = state.lots.some(l => skuKey(l.sku) === skuLower);
  if (inLots) return "Nie można usunąć: część jest w partiach magazynowych.";

  for (const [supplierName, sup] of state.suppliers.entries()) {
    if (sup?.prices?.has?.(skuLower)) {
      return `Nie można usunąć: część jest w cenniku dostawcy (${supplierName}).`;
    }
  }

  const inBom = state.machineCatalog.some(m =>
    Array.isArray(m.bom) && m.bom.some(b => skuKey(b.sku) === skuLower)
  );
  if (inBom) return "Nie można usunąć: część jest użyta w BOM maszyn.";

  const inCurrentDelivery = state.currentDelivery.items.some(it => skuKey(it.sku) === skuLower);
  if (inCurrentDelivery) return "Nie można usunąć: część jest w bieżącej dostawie (koszyku).";

  return "";
}

function deletePart(skuLower) {
  const p = state.partsCatalog.get(skuLower);
  if (!p) return;

  const reason = getPartDeleteBlockReason(skuLower);
  if (reason) {
    toast("Nie można usunąć", reason, "warn", 3200);
    return;
  }

  openConfirm(
    {
      title: "Usunąć część?",
      text: `${p.name} (${p.sku})`,
      okText: "Usuń",
      cancelText: "Anuluj"
    },
    () => {
      state.partsCatalog.delete(skuLower);

      // Na wszelki wypadek usuń z cenników (powinno być puste przez blokadę, ale lepiej domknąć).
      for (const sup of state.suppliers.values()) {
        sup?.prices?.delete?.(skuLower);
      }

      saveState();

      // odśwież UI zależne od katalogu części
      renderPartsCatalogTable();
      renderSupplierSelects();
      renderSupplierSkuDropdown();
      renderSupplierPartsForDelivery();
      renderSupplierPriceTable();
      renderBomSkuSelect();
      renderMachineSelect();

      toast("Usunięto", `Część: ${p.name}`, "ok");
    }
  );
}

els.partsCatalogBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-delete-part]");
  if (!btn) return;
  deletePart(btn.dataset.deletePart);
});

// ====== Dostawcy + cenniki ======
function ensureSupplier(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  if (!state.suppliers.has(n)) state.suppliers.set(n, { prices: new Map() });
  return n;
}

function setSupplierPrice(supplierName, sku, price) {
  const n = ensureSupplier(supplierName);
  if (!n) return { ok: false, msg: "Podaj nazwę dostawcy." };

  const s = normSku(sku);
  if (!s) return { ok: false, msg: "Podaj Nazwę części." };

  const p = safePrice(price, 0);
  const key = skuKey(s);

  // Nazwa części musi istnieć w katalogu (żeby nie robić śmietnika)
  if (!state.partsCatalog.has(key)) {
    return { ok: false, msg: "Najpierw dodaj tę część do katalogu części." };
  }

  state.suppliers.get(n).prices.set(key, p);
  return { ok: true, msg: "Ustawiono cenę." };
}

function renderSupplierSelects() {
  // select w dostawie
  if (els.supplierSelect) {
    const names = Array.from(state.suppliers.keys()).sort((a,b)=>a.localeCompare(b,"pl"));
    els.supplierSelect.innerHTML = [
      `<option value="">Wybierz dostawcę...</option>`,
      ...names.map(x => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`)
    ].join("");

    // supplier w stanie trzymamy jako null albo nazwa dostawcy
    if (!state.currentDelivery.supplier || !state.suppliers.has(state.currentDelivery.supplier)) {
      state.currentDelivery.supplier = null;
    }
    els.supplierSelect.value = state.currentDelivery.supplier || "";
  }

  // select w panelu zarządzania dostawcą
  if (els.supplierManageSelect) {
    const names = Array.from(state.suppliers.keys()).sort((a,b)=>a.localeCompare(b,"pl"));
    els.supplierManageSelect.innerHTML = names.length
      ? names.map(x => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join("")
      : `<option value="">(brak dostawców)</option>`;
  }

  renderSupplierSkuDropdown();
  renderSupplierPriceTable();
  renderSuppliersList();
  renderSupplierPartsForDelivery();
}

function renderSupplierSkuDropdown() {
  if (!els.supplierSkuSelect) return;
  const parts = Array.from(state.partsCatalog.values())
    .sort((a,b)=>a.sku.localeCompare(b.sku,"pl"));

  els.supplierSkuSelect.innerHTML = parts.length
    ? parts.map(p => `<option value="${escapeAttr(p.sku)}">${escapeHtml(p.sku)} • ${escapeHtml(p.name)}</option>`).join("")
    : `<option value="">(dodaj części do katalogu)</option>`;
}

function currentManagedSupplier() {
  const val = els.supplierManageSelect?.value || "";
  return state.suppliers.has(val) ? val : "";
}

function renderSupplierPriceTable() {
  if (!els.supplierPriceBody) return;
  const sup = currentManagedSupplier();
  if (!sup) {
    els.supplierPriceBody.innerHTML = "";
    return;
  }

  const prices = state.suppliers.get(sup).prices;
  const rows = Array.from(prices.entries()).map(([skuLower, price]) => {
    const part = state.partsCatalog.get(skuLower);
    return {
      sku: part?.sku || skuLower.toUpperCase(),
      name: part?.name || skuLower.toUpperCase(),
      price
    };
  }).sort((a,b)=>a.sku.localeCompare(b.sku,"pl"));

  // Kolumny: Nazwa, Typ, Cena
  els.supplierPriceBody.innerHTML = rows.map(r => `
    <tr>
      <td><span class="badge">${escapeHtml(r.sku)}</span></td>
      <td>${escapeHtml(r.name)}</td>
      <td class="right">${fmtPLN.format(r.price)}</td>
    </tr>
  `).join("");
}
// lista wszystkich dostawców + usuwanie
function supplierUsedInLots(name) {
  return state.lots.some(l => String(l.supplier || "").toLowerCase() === String(name || "").toLowerCase());
}

function deleteSupplier(name) {
  if (!state.suppliers.has(name)) return;

  if (supplierUsedInLots(name)) {
    toast("Nie można usunąć", "Dostawca ma partie w magazynie.", "warn", 3200);
    return;
  }

  openConfirm(
    {
      title: "Usunąć dostawcę?",
      text: `Dostawca: "${name}" (usunie też jego cennik)`,
      okText: "Usuń",
      cancelText: "Anuluj"
    },
    () => {
      state.suppliers.delete(name);

      // jeśli był wybrany w dostawie, przestaw na pierwszy dostępny
      if (els.supplierSelect && els.supplierSelect.value === name) {
        const first = Array.from(state.suppliers.keys())[0] || "";
        els.supplierSelect.value = first;
      }

      saveState();
      // odśwież UI po usunięciu dostawcy
      renderSupplierSelects();
      renderSupplierPriceTable();
      renderSupplierPartsForDelivery();

      toast("Usunięto", `Dostawca: ${name}`, "ok");
    }
  );
}

function renderSuppliersList() {
  if (!els.suppliersListBody) return;

  const names = Array.from(state.suppliers.keys()).sort((a,b)=>a.localeCompare(b,"pl"));
  els.suppliersListBody.innerHTML = names.map(n => `
    <tr>
      <td>${escapeHtml(n)}</td>
      <td class="right">
        <button type="button" class="secondary" data-delete-supplier="${escapeAttr(n)}">Usuń</button>
      </td>
    </tr>
  `).join("");
}
// ====== Nowa dostawa (lista części z cennika dostawcy) ======
function supplierPriceForSku(supplierName, sku) {
  const sup = state.suppliers.get(supplierName);
  if (!sup) return null;
  const key = skuKey(sku);
  return sup.prices.has(key) ? sup.prices.get(key) : null;
}

function renderSupplierPartsForDelivery() {
  if (!els.supplierPartsSelect) return;

  const supplier = els.supplierSelect?.value || "";
  state.currentDelivery.supplier = supplier || null;

  if (!supplier || !state.suppliers.has(supplier)) {
    els.supplierPartsSelect.innerHTML = "";
    els.supplierPartsSelect.disabled = true;
    els.addDeliveryItemBtn.disabled = true;
    els.deliveryPrice.value = "0";
    return;
  }

  const prices = state.suppliers.get(supplier).prices;
  const rows = Array.from(prices.entries()).map(([skuLower, price]) => {
    const part = state.partsCatalog.get(skuLower);
    return {
      sku: part?.sku || skuLower.toUpperCase(),
      name: part?.name || skuLower.toUpperCase(),
      price
    };
  }).sort((a,b)=>a.sku.localeCompare(b.sku,"pl"));

  els.supplierPartsSelect.innerHTML = rows.map((it, idx) => `
    <option value="${idx}" data-sku="${escapeAttr(it.sku)}" data-price="${it.price}">
      ${escapeHtml(it.sku)} • ${escapeHtml(it.name)} • ${fmtPLN.format(it.price)}
    </option>
  `).join("");

  els.supplierPartsSelect.disabled = rows.length === 0;
  els.addDeliveryItemBtn.disabled = rows.length === 0;

  if (rows.length > 0) {
    els.deliveryPrice.value = String(rows[0].price ?? 0);
  } else {
    els.deliveryPrice.value = "0";
  }
}

function onDeliveryPartChange() {
  const opt = els.supplierPartsSelect?.selectedOptions?.[0];
  if (!opt) return;
  const price = safePrice(opt.dataset.price, 0);
  els.deliveryPrice.value = String(price);
}

function addDeliveryItem() {
  const supplier = state.currentDelivery.supplier;
  if (!state.suppliers.has(supplier)) return alert("Wybierz dostawcę z listy.");

  const opt = els.supplierPartsSelect?.selectedOptions?.[0];
  if (!opt) return alert("Wybierz część.");

  const sku = String(opt.dataset.sku || "").trim();
  const name = getPartName(sku);

  const rawQty = Number(els.deliveryQty.value);
if (!Number.isInteger(rawQty) || rawQty <= 0) {
  return alert("Ilość musi być liczbą większą od zera.");
}
const qty = rawQty;

  const price = safePrice(els.deliveryPrice.value, 0); // można nadpisać ręcznie

  state.currentDelivery.items.push({
    id: nextId(),
    sku,
    name,
    qty,
    price
  });

  renderDeliveryItems();
  saveState();
}

function renderDeliveryItems() {
  const rows = state.currentDelivery.items;

  els.deliveryItemsBody.innerHTML = rows.map(it => `
    <tr>
      <td><span class="badge">${escapeHtml(it.sku)}</span> ${escapeHtml(it.name)}</td>
      <td class="right">${it.qty}</td>
      <td class="right">${fmtPLN.format(it.price)}</td>
      <td class="right">${fmtPLN.format(it.qty * it.price)}</td>
      <td class="right"><button class="iconBtn" data-remove="${it.id}">Usuń</button></td>
    </tr>
  `).join("");

  const total = rows.reduce((sum, it) => sum + it.qty * it.price, 0);
  els.itemsCount.textContent = String(rows.length);
  els.itemsTotal.textContent = fmtPLN.format(total);

  // CTA: finalizacja tylko jeśli są pozycje
  if (els.finalizeDeliveryBtn) {
    els.finalizeDeliveryBtn.disabled = rows.length === 0;
    // opcjonalnie: pokaż sumę w przycisku
    els.finalizeDeliveryBtn.textContent = rows.length === 0
      ? "Zapisz dostawę (dodaj partie)"
      : `Zapisz dostawę • ${fmtPLN.format(total)}`;
  }
}

function addLot({ name, sku, supplier, qty, unitPrice }) {
  const cleanSku = normSku(sku);
  const cleanName = String(name || "").trim();
  const cleanSupplier = String(supplier || "").trim();
  const q = Math.max(0, Math.floor(Number(qty || 0)));
  const price = safePrice(unitPrice, 0);
  if (!cleanSku || !cleanName || q <= 0) return;

  const existing = state.lots.find(l =>
    skuKey(l.sku) === skuKey(cleanSku) &&
    (l.supplier || "").toLowerCase() === cleanSupplier.toLowerCase() &&
    Number(l.unitPrice) === Number(price)
  );

  if (existing) {
    existing.qty += q;
    return;
  }

  state.lots.push({
    id: nextId(),
    name: cleanName,
    sku: cleanSku,
    supplier: cleanSupplier,
    unitPrice: price,
    qty: q
  });
}

function finalizeDelivery() {
  const supplier = state.currentDelivery.supplier;
  if (!supplier || !state.suppliers.has(supplier)) return alert("Wybierz dostawcę.");
  if (state.currentDelivery.items.length === 0) return alert("Dodaj przynajmniej jedną pozycję.");

  state.currentDelivery.dateISO = els.deliveryDate.value || "";

  for (const it of state.currentDelivery.items) {
    // upewnij się, że część (Nazwa) istnieje w katalogu
    if (!state.partsCatalog.has(skuKey(it.sku))) {
      upsertPart(it.sku, it.name);
    }
    addLot({ name: it.name, sku: it.sku, supplier, qty: it.qty, unitPrice: it.price });
  }

  state.currentDelivery.items = [];
  renderDeliveryItems();

  renderSkuSummary();
  renderLotsTable();
  renderWarehouseTotal();

  refreshManualConsumeUI();
  saveState();
  alert("Dostawa zapisana (partie dodane).");
}

// ====== Magazyn części: render ======
function renderMachineManageSelect() {
  if (!els.machineManageSelect) return;
  els.machineManageSelect.innerHTML = state.machineCatalog
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name,"pl"))
    .map(m => `<option value="${escapeAttr(m.code)}">${escapeHtml(m.name)} (${escapeHtml(m.code)})</option>`)
    .join("");
}

function renderBomSkuSelect() {
  if (!els.bomSkuSelect) return;
  const parts = Array.from(state.partsCatalog.values())
    .sort((a,b)=>a.name.localeCompare(b.name,"pl"));
  els.bomSkuSelect.innerHTML = parts.length
    ? parts.map(p => `<option value="${escapeAttr(p.sku)}">${escapeHtml(p.name)} (${escapeHtml(p.sku)})</option>`).join("")
    : `<option value="">(dodaj części do katalogu)</option>`;
}

function getManagedMachine() {
  const code = els.machineManageSelect?.value || "";
  return state.machineCatalog.find(m => m.code === code) || null;
}

function renderBomTable() {
  if (!els.bomBody) return;
  const m = getManagedMachine();
  if (!m) { els.bomBody.innerHTML = ""; return; }

  // Kolumny: Nazwa, Typ, Ilość
  els.bomBody.innerHTML = (m.bom || []).map((b, idx) => `
    <tr>
      <td><span class="badge">${escapeHtml(b.sku)}</span></td>
      <td>${escapeHtml(getPartName(b.sku))}</td>
      <td class="right">${Number(b.qty || 0)}</td>
      <td class="right"><button class="iconBtn" data-del-bom="${idx}">Usuń</button></td>
    </tr>
  `).join("");
}


function renderMachinesCatalogTable() {
  if (!els.machinesCatalogBody) return;

  const rows = [...state.machineCatalog]
    .sort((a, b) => (a.code || "").localeCompare(b.code || "", "pl"));

  els.machinesCatalogBody.innerHTML = rows.map(m => {
    const bomCount = (m.bom || []).length;
    return `
      <tr>
        <td>${escapeHtml(m.name || "")}</td>
        <td><span class="badge">${escapeHtml(m.code || "")}</span></td>
        <td class="right">${bomCount}</td>
        <td class="right"><button class="iconBtn" data-del-machine="${escapeHtml(m.code || "")}">Usuń</button></td>
      </tr>
    `;
  }).join("");
}

function deleteMachine(code) {
  const idx = state.machineCatalog.findIndex(m => m.code === code);
  if (idx < 0) return;

  const m = state.machineCatalog[idx];

  // blokady bezpieczeństwa
  if (machineHasStock(code)) {
    toast("Nie można usunąć", "Maszyna ma stan w magazynie maszyn.", "warn", 3200);
    return;
  }
  if (machineInBuildList(code)) {
    toast("Nie można usunąć", "Maszyna jest na liście bieżącej produkcji.", "warn", 3200);
    return;
  }

  openConfirm(
    {
      title: "Usunąć maszynę?",
      text: `${m.name} (${m.code})`,
      okText: "Usuń",
      cancelText: "Anuluj"
    },
    () => {
      state.machineCatalog.splice(idx, 1);
      saveState();

      renderMachineManageSelect();
      renderMachineSelect();

      toast("Usunięto", `Maszyna: ${m.name}`, "ok");
    }
  );
}


function addMachine(code, name) {
  const c = String(code || "").trim();
  const n = String(name || "").trim();
  if (!c || !n) return { ok:false, msg:"Podaj kod i nazwę maszyny." };

  if (state.machineCatalog.some(m => m.code.toLowerCase() === c.toLowerCase())) {
    return { ok:false, msg:"Taki kod maszyny już istnieje." };
  }

  state.machineCatalog.push({ code: c, name: n, bom: [] });

  // odśwież select do produkcji też
  renderMachineSelect();
  renderMachineManageSelect();

  return { ok:true, msg:"Dodano maszynę." };
}

function addBomItem(machineCode, sku, qty) {
  const m = state.machineCatalog.find(x => x.code === machineCode);
  if (!m) return { ok:false, msg:"Nie znaleziono maszyny." };

  const s = String(sku || "").trim();
  if (!s) return { ok:false, msg:"Wybierz część." };

  const q = Math.max(1, Math.floor(Number(qty || 1)));
  const key = skuKey(s);

  // Część musi istnieć globalnie
  if (!state.partsCatalog.has(key)) {
    return { ok:false, msg:"Najpierw dodaj tę część do katalogu części." };
  }

  // jeśli już jest w BOM, to NADPISUJ ilość (logiczniejsze)
  const existing = m.bom.find(b => skuKey(b.sku) === key);
  if (existing) existing.qty = q;
  else m.bom.push({ sku: s, qty: q });

  return { ok:true, msg:"Ustawiono w BOM." };
}

function renderSkuSummary() {
  const q = (els.searchParts.value || "").trim().toLowerCase();
  const map = new Map();

  for (const lot of state.lots) {
    if (q) {
      const ok = (lot.name || "").toLowerCase().includes(q) || (lot.sku || "").toLowerCase().includes(q);
      if (!ok) continue;
    }
    const key = skuKey(lot.sku);
    if (!map.has(key)) map.set(key, { name: lot.name, sku: lot.sku, totalQty: 0, totalValue: 0 });

    const row = map.get(key);
    const qty = Number(lot.qty || 0);
    const price = Number(lot.unitPrice || 0);
    row.totalQty += qty;
    row.totalValue += qty * price;
  }

  // sortuj po Nazwie (unikatowej)
  const rows = Array.from(map.values()).sort((a,b)=>String(a.sku||"").localeCompare(String(b.sku||""),"pl"));
  els.skuSummaryBody.innerHTML = rows.map(r => `
    <tr class="${stockClass(r.totalQty)}">
      <td><span class="badge">${escapeHtml(r.sku)}</span></td>
      <td>${escapeHtml(r.name)}</td>
      <td class="right">${r.totalQty}</td>
      <td class="right">${fmtPLN.format(r.totalValue)}</td>
    </tr>
  `).join("");
}

function renderLotsTable() {
  const q = (els.searchParts.value || "").trim().toLowerCase();
  const rows = state.lots
    .filter(l => {
      if (!q) return true;
      return (l.name || "").toLowerCase().includes(q) || (l.sku || "").toLowerCase().includes(q);
    })
    .sort((a,b)=>{
      const n = (a.name||"").localeCompare(b.name||"","pl");
      if (n !== 0) return n;
      return Number(a.unitPrice||0) - Number(b.unitPrice||0);
    });

  els.lotsBody.innerHTML = rows.map(l => {
    const value = Number(l.qty||0) * Number(l.unitPrice||0);
    return `
      <tr>
        <td><span class="badge">${escapeHtml(l.sku)}</span></td>
        <td>${escapeHtml(l.name)}</td>
        <td>${escapeHtml(l.supplier || "-")}</td>
        <td class="right">${fmtPLN.format(l.unitPrice || 0)}</td>
        <td class="right">${Number(l.qty || 0)}</td>
        <td class="right">${fmtPLN.format(value)}</td>
      </tr>
    `;
  }).join("");
}

function renderWarehouseTotal() {
  const total = state.lots.reduce((sum, lot) => sum + Number(lot.qty||0)*Number(lot.unitPrice||0), 0);
  if (els.warehouseTotal) els.warehouseTotal.textContent = fmtPLN.format(total);
}

// ====== Produkcja (FIFO + ręczny) ======
function renderMachineSelect() {
  const rows = state.machineCatalog
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name,"pl"));
  els.machineSelect.innerHTML = rows.map(m => `
    <option value="${escapeAttr(m.code)}">${escapeHtml(m.name)} (${escapeHtml(m.code)})</option>
  `).join("");
}

function renderBuildItems() {
  const rows = state.currentBuild.items;
  els.buildItemsBody.innerHTML = rows.map(it => `
    <tr>
      <td>${escapeHtml(it.machineName)} <span class="badge">${escapeHtml(it.machineCode)}</span></td>
      <td class="right">${it.qty}</td>
      <td class="right"><button class="iconBtn" data-remove-build="${it.id}">Usuń</button></td>
    </tr>
  `).join("");
  els.buildItemsCount.textContent = String(rows.length);
}

function addBuildItem() {
    const rawQty = Number(els.buildQty.value);
if (!Number.isInteger(rawQty) || rawQty <= 0) {
  return alert("Ilość musi być liczbą większą od zera.");
}

  const code = els.machineSelect.value;
  const qty = rawQty;

  const machine = state.machineCatalog.find(m => m.code === code);
  if (!machine) return alert("Nie znaleziono maszyny.");
  if (!machine.bom || machine.bom.length === 0) {
    return alert(`Maszyna ${machine.name} (${machine.code}) nie ma zdefiniowanego BOM.`);
  }

  state.currentBuild.items.push({ id: nextId(), machineCode: machine.code, machineName: machine.name, qty });

  els.missingBox.hidden = true;
  els.missingList.innerHTML = "";
  manualPlanGenerated = false;

  renderBuildItems();
  refreshManualConsumeUI();
  saveState();
}

function totalQtyBySku(skuLowerOrSku) {
  const key = skuKey(skuLowerOrSku);
  return state.lots
    .filter(l => skuKey(l.sku) === key)
    .reduce((sum, l) => sum + Number(l.qty || 0), 0);
}

function consumeSkuFIFO(skuLowerOrSku, qtyNeeded) {
  const key = skuKey(skuLowerOrSku);
  let remaining = Math.max(0, Math.floor(Number(qtyNeeded || 0)));

  const lots = state.lots
    .filter(l => skuKey(l.sku) === key && Number(l.qty || 0) > 0)
    .sort((a,b)=>a.id-b.id);

  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.qty||0), remaining);
    lot.qty -= take;
    remaining -= take;
  }

  state.lots = state.lots.filter(l => Number(l.qty || 0) > 0);
  return remaining === 0;
}

function computeMissingPartsForBuild() {
  const needed = new Map(); // skuLower -> qty
  for (const bi of state.currentBuild.items) {
    const machine = state.machineCatalog.find(m => m.code === bi.machineCode);
    if (!machine) continue;

    for (const b of machine.bom) {
      const add = Number(b.qty||0) * Number(bi.qty||0);
      const key = skuKey(b.sku);
      needed.set(key, (needed.get(key) || 0) + add);
    }
  }

  const missing = [];
  for (const [skuLower, qtyNeeded] of needed.entries()) {
    const available = totalQtyBySku(skuLower);
    if (available < qtyNeeded) {
      missing.push({ sku: skuLower, needed: qtyNeeded, available, missing: qtyNeeded - available });
    }
  }

  return { needed, missing };
}

function showMissing(missing) {
  if (!missing.length) {
    els.missingBox.hidden = true;
    els.missingList.innerHTML = "";
    return;
  }
  els.missingBox.hidden = false;
  els.missingList.innerHTML = missing.map(m => `
    <li><strong>${escapeHtml(m.sku.toUpperCase())}</strong>: brakuje ${m.missing} (potrzeba ${m.needed}, jest ${m.available})</li>
  `).join("");
}

function getLotsForSku(skuLower) {
  return state.lots
    .filter(l => skuKey(l.sku) === skuLower && Number(l.qty||0) > 0)
    .sort((a,b)=>a.id-b.id);
}

function consumeFromLotsByPlan(planMap) {
  for (const [lotIdStr, qtyStr] of Object.entries(planMap)) {
    const lotId = Number(lotIdStr);
    const take = Math.max(0, Math.floor(Number(qtyStr || 0)));
    if (!take) continue;

    const lot = state.lots.find(l => Number(l.id) === lotId);
    if (!lot) continue;

    lot.qty = Number(lot.qty || 0) - take;
  }
  state.lots = state.lots.filter(l => Number(l.qty || 0) > 0);
}

function buildManualConsumeUI(neededMap) {
  const parts = [];
  for (const [skuLower, qtyNeeded] of neededMap.entries()) {
    const lots = getLotsForSku(skuLower);
    const skuLabel = skuLower.toUpperCase();

    parts.push(`
      <div class="consumePart">
        <div><strong>${escapeHtml(skuLabel)}</strong> • potrzeba <strong>${qtyNeeded}</strong></div>
        <div class="consumeGrid">
          ${lots.map(lot => `
            <div class="lotRow">
              <div>
                <span class="badge">${escapeHtml(lot.sku)}</span>
                ${escapeHtml(lot.supplier || "-")} • ${fmtPLN.format(lot.unitPrice || 0)}
                <span class="muted"> (dostępne: ${Number(lot.qty || 0)})</span>
              </div>
              <input
                type="number"
                min="0"
                step="1"
                value="0"
                data-lotid="${lot.id}"
                data-sku="${escapeAttr(skuLower)}"
                data-max="${Number(lot.qty || 0)}"
              />
            </div>
          `).join("")}
        </div>
      </div>
    `);
  }

  els.manualConsumeUI.innerHTML = parts.join("");
  els.manualConsumeBox.hidden = false;
}

function refreshManualConsumeUI() {
  const isManual = (els.consumeMode?.value === "manual");
  if (!isManual) return;

  els.manualConsumeBox.hidden = false;

  if (state.currentBuild.items.length === 0) {
    els.manualConsumeUI.innerHTML = "(Dodaj maszyny do listy, wtedy pokażę wybór partii.)";
    manualPlanGenerated = false;
    return;
  }

  const { needed, missing } = computeMissingPartsForBuild();
  if (missing.length) {
    showMissing(missing);
    els.manualConsumeUI.innerHTML = "(Najpierw uzupełnij braki części, wtedy pojawi się wybór partii.)";
    manualPlanGenerated = false;
    return;
  }

  showMissing([]);
  buildManualConsumeUI(needed);
  manualPlanGenerated = true;
}

function addToMachinesStock(code, name, qty) {
  const existing = state.machinesStock.find(x => x.code === code);
  if (existing) existing.qty += qty;
  else state.machinesStock.push({ code, name, qty });
}

function finalizeBuild() {
    for (const bi of state.currentBuild.items) {
  const machine = state.machineCatalog.find(m => m.code === bi.machineCode);
  if (!machine || !machine.bom || machine.bom.length === 0) {
    return alert(
      `Maszyna ${bi.machineName} (${bi.machineCode}) nie ma zdefiniowanego BOM.`
    );
  }
 }

  if (state.currentBuild.items.length === 0) return alert("Dodaj przynajmniej jedną maszynę do listy.");

  state.currentBuild.dateISO = els.buildDate.value || "";

  const { needed, missing } = computeMissingPartsForBuild();
  if (missing.length) {
    showMissing(missing);
    refreshManualConsumeUI();
    return;
  }

  const mode = els.consumeMode?.value || "fifo";

  if (mode === "manual") {
    const inputCount = els.manualConsumeUI?.querySelectorAll("input[data-lotid]")?.length || 0;
    if (!manualPlanGenerated || inputCount === 0) {
      refreshManualConsumeUI();
      return;
    }

    const inputs = Array.from(els.manualConsumeUI.querySelectorAll("input[data-lotid]"));
    const plan = {};
    const perSkuSum = new Map();

    for (const inp of inputs) {
      const lotId = inp.dataset.lotid;
      const skuLower = (inp.dataset.sku || "").toLowerCase();
      const max = Number(inp.dataset.max || 0);
      let val = Math.max(0, Math.floor(Number(inp.value || 0)));
      if (val > max) val = max;
      inp.value = String(val);

      if (val > 0) plan[lotId] = val;
      perSkuSum.set(skuLower, (perSkuSum.get(skuLower) || 0) + val);
    }

    const errors = [];
    for (const [skuLower, qtyNeeded] of needed.entries()) {
      const sum = perSkuSum.get(skuLower) || 0;
      if (sum !== qtyNeeded) errors.push(`${skuLower.toUpperCase()}: wybrałeś ${sum}, potrzeba ${qtyNeeded}`);
    }

    if (errors.length) return alert("Ręczny wybór nie pasuje:\n\n" + errors.join("\n"));

    consumeFromLotsByPlan(plan);
  } else {
    for (const [skuLower, qtyNeeded] of needed.entries()) {
      const ok = consumeSkuFIFO(skuLower, qtyNeeded);
      if (!ok) return alert("Coś poszło nie tak przy odejmowaniu części (FIFO).");
    }
  }

  for (const bi of state.currentBuild.items) {
    addToMachinesStock(bi.machineCode, bi.machineName, bi.qty);
  }

  state.currentBuild.items = [];
  renderBuildItems();
  showMissing([]);
  els.manualConsumeUI.innerHTML = "";
  els.manualConsumeBox.hidden = true;
  manualPlanGenerated = false;

  renderSkuSummary();
  renderLotsTable();
  renderWarehouseTotal();
  renderMachinesStock();

  saveState();

  alert("Produkcja zrealizowana: części odjęte, maszyny dodane.");
}

// ====== Magazyn maszyn ======
function renderMachinesStock() {
  const q = (els.searchMachines.value || "").trim().toLowerCase();
  const rows = state.machinesStock
    .filter(m => !q || (m.name||"").toLowerCase().includes(q) || (m.code||"").toLowerCase().includes(q))
    .sort((a,b)=>(a.name||"").localeCompare(b.name||"","pl"));

  els.machinesStockBody.innerHTML = rows.map(m => `
    <tr>
      <td>${escapeHtml(m.name)}</td>
      <td><span class="badge">${escapeHtml(m.code)}</span></td>
      <td class="right">${Number(m.qty || 0)}</td>
    </tr>
  `).join("");
}

// ====== Suwaki progów ======
function syncThresholdUI() {
  if (!els.warnRange || !els.dangerRange || !els.warnValue || !els.dangerValue) return;
  els.warnRange.value = String(LOW_WARN);
  els.dangerRange.value = String(LOW_DANGER);
  els.warnValue.textContent = String(LOW_WARN);
  els.dangerValue.textContent = String(LOW_DANGER);
}

function bindThresholds() {
  if (!els.warnRange || !els.dangerRange) return;

  // Uwaga: wartości LOW_WARN/LOW_DANGER mogą być wczytane z LocalStorage.
  // Najpierw ustawiamy UI na te wartości, dopiero potem słuchamy zmian.
  syncThresholdUI();

  const clamp = () => {
    if (LOW_DANGER >= LOW_WARN) LOW_DANGER = Math.max(0, LOW_WARN - 10);
    syncThresholdUI();
    renderSkuSummary();
    saveState();
  };

  els.warnRange.addEventListener("input", () => { LOW_WARN = Number(els.warnRange.value); clamp(); });
  els.dangerRange.addEventListener("input", () => { LOW_DANGER = Number(els.dangerRange.value); clamp(); });

  // dociągnij raz na starcie (napraw relację danger < warn)
  clamp();
}

// ====== Init + eventy ======


function init() {
  // Wczytaj stan zanim cokolwiek wyrenderujemy (żeby UI widziało Mapy, progi, BOM itd.).
  loadState();

  const today = new Date().toISOString().slice(0, 10);
  if (els.deliveryDate) els.deliveryDate.value = state.currentDelivery.dateISO || today;
  if (els.buildDate) els.buildDate.value = state.currentBuild.dateISO || today;

  bindThresholds();
  renderMachineSelect();

  renderPartsCatalogTable();
  renderSupplierSelects();

  renderDeliveryItems();
  renderBuildItems();
  renderSkuSummary();
  renderLotsTable();
  renderWarehouseTotal();
  renderMachinesStock();

  renderMachineManageSelect();
renderBomSkuSelect();
renderBomTable();


    renderMachinesCatalogTable();

// startowe UI manual
  if (els.consumeMode && els.consumeMode.value === "manual") refreshManualConsumeUI();
}
init();

window.addEventListener("beforeunload", (e) => {
  if (!hasPendingWork()) return;
  e.preventDefault();
  e.returnValue = "";
});


// ===== Eventy ogólne =====
els.addMachineBtn?.addEventListener("click", () => {
  const code = els.machineCodeInput.value;
  const name = els.machineNameInput.value;

  const res = addMachine(code, name);
  if (!res.ok) return alert(res.msg);

  els.machineCodeInput.value = "";
  els.machineNameInput.value = "";

  renderMachineSelect();
  renderMachineManageSelect();
  renderBomTable();
  renderMachinesCatalogTable();
  saveState();
  alert(res.msg);
});

els.machineManageSelect?.addEventListener("change", () => {
  renderBomTable();
});

els.addBomItemBtn?.addEventListener("click", () => {
  const m = getManagedMachine();
  if (!m) return alert("Wybierz maszynę do edycji.");

  const sku = els.bomSkuSelect.value;
  const qty = els.bomQtyInput.value;

  const res = addBomItem(m.code, sku, qty);
  if (!res.ok) return alert(res.msg);

  renderBomTable();
  renderMachinesCatalogTable();
  saveState();
  alert(res.msg);
});

els.bomBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-del-bom]");
  if (!btn) return;

  const idx = Number(btn.dataset.delBom);
  const m = getManagedMachine();
  if (!m) return;

  m.bom.splice(idx, 1);
  renderBomTable();
  renderMachinesCatalogTable();
  saveState();
});


els.machinesCatalogBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-del-machine]");
  if (!btn) return;
  deleteMachine(btn.dataset.delMachine);
});


els.searchParts?.addEventListener("input", () => {
  renderSkuSummary();
  renderLotsTable();
});

els.clearDataBtn?.addEventListener("click", () => {
  const ok = confirm(
    "Na pewno wyczyścić wszystkie dane?\n\n" +
    "- usunie zapis z LocalStorage\n" +
    "- wyzeruje magazyn, dostawców, katalog części, BOM-y i stan maszyn"
  );
  if (!ok) return;

  clearSavedState();
  resetAllData();

  // odśwież cały UI
  syncThresholdUI();
  renderMachineSelect();
  renderMachineManageSelect();
  renderBomSkuSelect();
  renderBomTable();
  renderMachinesCatalogTable();

  renderPartsCatalogTable();
  renderSupplierSelects();

  renderDeliveryItems();
  renderBuildItems();
  renderSkuSummary();
  renderLotsTable();
  renderWarehouseTotal();
  renderMachinesStock();

  // zostaw świeże, czyste dane w LocalStorage (żeby progi też były zapisane)
  saveState();
});

// ===== Dostawy =====
els.supplierSelect?.addEventListener("change", () => {
  renderSupplierPartsForDelivery();
  renderDeliveryItems();
  saveState();
});

els.deliveryDate?.addEventListener("change", () => {
  state.currentDelivery.dateISO = els.deliveryDate.value || "";
  saveState();
});

els.supplierPartsSelect?.addEventListener("change", onDeliveryPartChange);
els.addDeliveryItemBtn?.addEventListener("click", addDeliveryItem);

els.deliveryItemsBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remove]");
  if (!btn) return;
  const id = Number(btn.dataset.remove);
  state.currentDelivery.items = state.currentDelivery.items.filter(it => it.id !== id);
  renderDeliveryItems();
  saveState();
});

els.finalizeDeliveryBtn?.addEventListener("click", finalizeDelivery);

// ===== Produkcja =====
els.addBuildItemBtn?.addEventListener("click", addBuildItem);

els.buildDate?.addEventListener("change", () => {
  state.currentBuild.dateISO = els.buildDate.value || "";
  saveState();
});

els.buildItemsBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remove-build]");
  if (!btn) return;
  const id = Number(btn.dataset.removeBuild);
  state.currentBuild.items = state.currentBuild.items.filter(it => it.id !== id);
  renderBuildItems();
  manualPlanGenerated = false;
  refreshManualConsumeUI();
  saveState();
});

els.finalizeBuildBtn?.addEventListener("click", finalizeBuild);

els.consumeMode?.addEventListener("change", () => {
  const isManual = (els.consumeMode.value === "manual");
  els.manualConsumeUI.innerHTML = "";
  els.manualConsumeBox.hidden = !isManual;
  manualPlanGenerated = false;
  if (isManual) refreshManualConsumeUI();
  saveState();
});

els.searchMachines?.addEventListener("input", renderMachinesStock);

// ===== Katalog części =====
els.addPartBtn?.addEventListener("click", () => {
  const sku = els.partSkuInput.value;
  const name = els.partNameInput.value;

  const res = upsertPart(sku, name);
  if (!res.ok) return alert(res.msg);

  els.partSkuInput.value = "";
  els.partNameInput.value = "";

  renderPartsCatalogTable();
  renderSupplierSkuDropdown();
  renderSupplierPartsForDelivery();
  alert(res.msg);
  renderBomSkuSelect();

  saveState();

});

// ===== Dostawcy + cenniki =====
els.addSupplierBtn?.addEventListener("click", () => {
  const name = String(els.supplierNameInput.value || "").trim();
  if (!name) return alert("Podaj nazwę dostawcy.");
  ensureSupplier(name);
  els.supplierNameInput.value = "";
  renderSupplierSelects();
  saveState();
  alert("Dodano dostawcę.");
});

els.supplierManageSelect?.addEventListener("change", () => {
  renderSupplierPriceTable();
  renderSuppliersList();
});

els.setSupplierPriceBtn?.addEventListener("click", () => {
  const sup = currentManagedSupplier();
  if (!sup) return alert("Wybierz dostawcę do edycji (albo dodaj nowego).");

  const sku = els.supplierSkuSelect.value;
  const price = Number(els.supplierPriceInput.value || 0);

  const res = setSupplierPrice(sup, sku, price);
  if (!res.ok) return alert(res.msg);

  renderSupplierPriceTable();
  renderSuppliersList();
  renderSupplierPartsForDelivery();
  saveState();
  alert(res.msg);
});


// lista dostawców: usuwanie (delegacja klików)
els.suppliersListBody?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-delete-supplier]");
  if (!btn) return;
  const name = btn.dataset.deleteSupplier;
  deleteSupplier(name);
});

// ===== Tabs UI (Etap 1) =====
(function initTabsUI(){
  const btns = Array.from(document.querySelectorAll("button[data-tab-target]"));
  const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
  if (!btns.length || !panels.length) return;

  const KEY = "magazyn_active_tab";
  const defaultTab = "parts";

  function setActive(tab) {
    for (const p of panels) {
      p.hidden = (p.dataset.tabPanel !== tab);
    }
    for (const b of btns) {
      b.classList.toggle("active", b.dataset.tabTarget === tab);
    }
    try { localStorage.setItem(KEY, tab); } catch(e) {}
  }

  for (const b of btns) {
    b.addEventListener("click", () => setActive(b.dataset.tabTarget));
  }

  let start = defaultTab;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && panels.some(p => p.dataset.tabPanel === saved)) start = saved;
  } catch(e) {}

  setActive(start);
})();




// ===== UI: Toasty + Modal (micro-interactions) =====
(function uiOverlays(){
  // Toast host
  const toastHost = document.createElement("div");
  toastHost.className = "toastHost";
  document.body.appendChild(toastHost);

  window.toast = function(title, msg = "", type = "ok", ms = 2200){
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="title">${title}</div>${msg ? `<div class="small muted">${msg}</div>` : ""}`;
    toastHost.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 260);
    }, ms);
  };

  // Modal
  const backdrop = document.createElement("div");
  backdrop.className = "modalBackdrop";
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modalHead">
        <div id="modalTitle" class="modalTitle">Potwierdź</div>
      </div>
      <div class="modalBody">
        <div class="modalText" id="modalText"></div>
      </div>
      <div class="modalActions">
        <button type="button" class="secondary" id="modalCancel">Anuluj</button>
        <button type="button" class="danger" id="modalOk">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const titleEl = backdrop.querySelector("#modalTitle");
  const textEl  = backdrop.querySelector("#modalText");
  const okBtn   = backdrop.querySelector("#modalOk");
  const cancelBtn = backdrop.querySelector("#modalCancel");

  let onOk = null;
  let onCancel = null;

  function close(){
    backdrop.classList.remove("show");
    // daj animacji zejść
    setTimeout(() => { backdrop.hidden = true; }, 150);
    onOk = null; onCancel = null;
  }

  function openConfirm({title="Potwierdź", text="", okText="Usuń", cancelText="Anuluj"} = {}, okCb = null, cancelCb = null){
    titleEl.textContent = title;
    textEl.textContent = text;
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    onOk = okCb;
    onCancel = cancelCb;

    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add("show"));
    okBtn.focus();
  }

  // Export
  window.openConfirm = openConfirm;

  // Events
  okBtn.addEventListener("click", () => { const cb = onOk; close(); if (typeof cb === "function") cb(); });
  cancelBtn.addEventListener("click", () => { const cb = onCancel; close(); if (typeof cb === "function") cb(); });

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) { const cb = onCancel; close(); if (typeof cb === "function") cb(); }
  });

  document.addEventListener("keydown", (e) => {
    if (backdrop.hidden) return;
    if (e.key === "Escape") { const cb = onCancel; close(); if (typeof cb === "function") cb(); }
  });
})();