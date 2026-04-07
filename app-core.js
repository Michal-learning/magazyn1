/**
 * Magazyn PRO - Core (state/storage/business)
 * Version: 3.0 - Linear Design Update
 */

// === CONFIGURATION & STATE ===
const STORAGE_KEY = "magazyn_state_v3_0";
const STORAGE_KEY_FALLBACKS = [
  "magazyn_state_v3",
  "magazyn_state_v2_0",
  "magazyn_state_v2",
  "magazyn_state_v1_0",
  "magazyn_state_v1",
  "magazyn_state"
];
const THRESHOLDS_OPEN_KEY = "magazyn_thresholds_open_v3";

// Anti-double-click guards for critical operations
let _finalizeDeliveryBusy = false;
let _finalizeBuildBusy = false;
let _stockAdjustmentsBusy = false;

// === STATE ===
const state = {
  lots: [],
  machinesStock: [],
  partsCatalog: new Map(),
  suppliers: new Map(),
  machineCatalog: [],
  currentDelivery: { supplier: null, dateISO: "", items: [] },
  currentBuild: { dateISO: "", items: [] },
  history: [],
  ui: {
    stockEditMode: false,
    pendingStockAdjustments: {}
  }
};

let _idCounter = 1;
let currentEditPartKey = null;
let LOW_WARN = 100;
let LOW_DANGER = 50;

const fmtPLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

// === ID MANAGEMENT ===
function nextId() { return _idCounter++; }

function syncIdCounter() {
  let maxId = 0;

  const scan = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) {
      const v = x && x.id;
      if (typeof v === "number" && v > maxId) maxId = v;
    }
  };

  scan(state.lots);
  scan(state.machinesStock);
  scan(state.machineCatalog);
  scan(state.history);
  scan(state.currentDelivery?.items);
  scan(state.currentBuild?.items);

  try { 
    scan(Array.from(state.partsCatalog?.values?.() || [])); 
  } catch {}

  _idCounter = Math.max(_idCounter, maxId + 1);
}

// === SERIALIZATION ===
function ensureUiState() {
  if (!state.ui || typeof state.ui !== "object") state.ui = {};
  if (typeof state.ui.stockEditMode !== "boolean") state.ui.stockEditMode = false;
  if (!state.ui.pendingStockAdjustments || typeof state.ui.pendingStockAdjustments !== "object") state.ui.pendingStockAdjustments = {};
  if (typeof state.ui.showArchivedPartsInWarehouse !== "boolean") state.ui.showArchivedPartsInWarehouse = true;
  if (typeof state.ui.showArchivedMachinesInStock !== "boolean") state.ui.showArchivedMachinesInStock = true;
}

function serializeState() {
  ensureUiState();
  return {
    currentDelivery: state.currentDelivery,
    currentBuild: state.currentBuild,
    ui: {
      showArchivedPartsInWarehouse: shouldShowArchivedPartsInWarehouse(),
      showArchivedMachinesInStock: shouldShowArchivedMachinesInStock()
    },
    LOW_WARN,
    LOW_DANGER
  };
}

function restoreState(data) {
  ensureUiState();
  if (!data || typeof data !== "object") return;

  const asArr = (x) => Array.isArray(x) ? x : [];

  const rawCurrentDelivery = (data.currentDelivery && typeof data.currentDelivery === "object") ? data.currentDelivery : {};
  state.currentDelivery = {
    supplier: normalize(rawCurrentDelivery.supplier) || null,
    dateISO: normalize(rawCurrentDelivery.dateISO),
    items: []
  };
  state.currentDelivery.items = asArr(rawCurrentDelivery.items).map(i => ({
    id: (typeof i?.id === "number") ? i.id : nextId(),
    sku: normalize(i?.sku),
    name: normalize(i?.name),
    qty: safeInt(i?.qty),
    price: safeFloat(i?.price)
  })).filter(i => i.sku);

  const rawCurrentBuild = (data.currentBuild && typeof data.currentBuild === "object") ? data.currentBuild : {};
  state.currentBuild = {
    dateISO: normalize(rawCurrentBuild.dateISO),
    items: []
  };
  state.currentBuild.items = asArr(rawCurrentBuild.items).map(i => ({
    id: (typeof i?.id === "number") ? i.id : nextId(),
    machineCode: normalize(i?.machineCode),
    qty: safeInt(i?.qty),
    machineNameSnapshot: normalize(i?.machineNameSnapshot),
    bomSnapshot: asArr(i?.bomSnapshot).map(b => ({
      sku: normalize(b?.sku),
      name: normalize(b?.name),
      qty: safeInt(b?.qty)
    })).filter(b => b.sku)
  })).filter(i => i.machineCode);

  if (data.ui && typeof data.ui === "object") {
    state.ui.showArchivedPartsInWarehouse = data.ui.showArchivedPartsInWarehouse !== false;
    state.ui.showArchivedMachinesInStock = data.ui.showArchivedMachinesInStock !== false;
  }

  // Thresholds with invariants
  LOW_WARN = (strictNonNegInt(data.LOW_WARN) ?? 100);
  LOW_DANGER = (strictNonNegInt(data.LOW_DANGER) ?? 50);
  if (LOW_WARN < 0) LOW_WARN = 0;
  if (LOW_DANGER < 0) LOW_DANGER = 0;
  if (LOW_DANGER > LOW_WARN) LOW_DANGER = LOW_WARN;


  state.ui.stockEditMode = false;
  state.ui.pendingStockAdjustments = {};

  clearArchivedItemsFromDrafts();
  syncIdCounter();
}


function applyOperationalState(nextOperationalState = {}) {
  state.lots = Array.isArray(nextOperationalState?.lots)
    ? nextOperationalState.lots.map(lot => ({
        id: lot?.id,
        sku: normalize(lot?.sku),
        name: normalize(lot?.name),
        supplier: normalize(lot?.supplier) || '-',
        unitPrice: safeFloat(lot?.unitPrice ?? 0),
        qty: safeQtyInt(lot?.qty),
        dateIn: normalize(lot?.dateIn)
      })).filter(lot => lot.sku && lot.name)
    : [];

  state.machinesStock = Array.isArray(nextOperationalState?.machinesStock)
    ? nextOperationalState.machinesStock.map(item => ({
        code: normalize(item?.code),
        name: normalize(item?.name),
        qty: safeQtyInt(item?.qty),
        _rowId: item?._rowId ?? item?.rowId ?? null,
        _machineDefinitionId: item?._machineDefinitionId ?? item?.machineDefinitionId ?? null
      })).filter(item => item.code)
    : [];

  state.history = Array.isArray(nextOperationalState?.history)
    ? nextOperationalState.history.filter(Boolean)
    : [];

  ensureUiState();
  state.ui.stockEditMode = false;
  state.ui.pendingStockAdjustments = {};

  clearArchivedItemsFromDrafts();
  syncIdCounter();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
  } catch (e) {
    console.error("Failed to save state:", e);
    toast("Błąd zapisu", "Nie udało się zapisać danych. Pamięć lokalna może być pełna.", "error");
  }
}

function load() {
  ensureUiState();
  try {
    const keysToTry = [STORAGE_KEY, ...STORAGE_KEY_FALLBACKS.filter(k => k && k !== STORAGE_KEY)];
    let parsed = null;

    for (const key of keysToTry) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") break;
      } catch (err) {
        console.warn(`Skipped unreadable storage key: ${key}`, err);
      }
      parsed = null;
    }

    if (parsed) {
      restoreState(parsed);
    }
  } catch (e) {
    console.error("Error loading data:", e);
    toast("Błąd odczytu", "Nie udało się wczytać danych.", "error");
  }
}


// === UTILITIES ===
const normalize = (str) => String(str || "").trim();
const skuKey = (str) => normalize(str).toLowerCase();

function strictParseIntString(s) {
  const t = String(s ?? "").trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.min(n, Number.MAX_SAFE_INTEGER);
}

function strictNonNegInt(val) {
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return null;
    const n = Math.trunc(val);
    if (n < 0) return 0;
    return Math.min(n, Number.MAX_SAFE_INTEGER);
  }
  const n = strictParseIntString(val);
  return (n === null) ? null : Math.max(0, Math.trunc(n));
}

function strictPosInt(val) {
  const n = strictNonNegInt(val);
  if (n === null) return null;
  return Math.max(1, n);
}

const safeFloat = (val) => {
  if (typeof val === "number") return Math.max(0, val);
  const strVal = String(val || "").replace(",", ".");
  const parsed = parseFloat(strVal);
  return Math.max(0, Number.isFinite(parsed) ? parsed : 0);
};

const safeInt = (val) => {
  const n = strictPosInt(val);
  return (n === null) ? 1 : n;
};

function getLotDateSortValue(lot) {
  const raw = normalize(lot?.dateIn || lot?.dateISO || "");
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = Date.parse(`${raw}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareLotsForConsumption(a, b) {
  const dateA = getLotDateSortValue(a);
  const dateB = getLotDateSortValue(b);

  if (dateA !== null && dateB !== null && dateA !== dateB) return dateA - dateB;
  if (dateA !== null && dateB === null) return -1;
  if (dateA === null && dateB !== null) return 1;

  return safeInt(a?.id) - safeInt(b?.id);
}

const safeQtyInt = (val) => {
  const n = strictNonNegInt(val);
  return (n === null) ? 0 : n;
};


function normalizeThresholdValue(val) {
  const n = strictNonNegInt(val);
  return n === null ? null : n;
}

function isPartArchived(skuRaw) {
  const part = state.partsCatalog.get(skuKey(skuRaw));
  return !!part?.archived;
}

function isSupplierArchived(nameRaw) {
  const supplier = state.suppliers.get(normalize(nameRaw));
  return !!supplier?.archived;
}

function isMachineArchived(codeRaw) {
  const machineCode = normalize(codeRaw);
  const machine = (state.machineCatalog || []).find(item => normalize(item?.code) === machineCode);
  return !!machine?.archived;
}

function getActivePartsCatalog() {
  return Array.from(state.partsCatalog.values()).filter(part => !part?.archived);
}

function getActiveSupplierNames() {
  return Array.from(state.suppliers.entries())
    .filter(([_, data]) => !data?.archived)
    .map(([name]) => name)
    .sort((a, b) => String(a).localeCompare(String(b), 'pl'));
}

function getActiveMachineCatalog() {
  return (state.machineCatalog || []).filter(machine => !machine?.archived);
}

function partUsedInAnyActiveMachineBom(skuRaw) {
  const k = skuKey(skuRaw);
  return (state.machineCatalog || []).find(machine => !machine?.archived && Array.isArray(machine?.bom) && machine.bom.some(item => skuKey(item?.sku) === k)) || null;
}

function clearArchivedItemsFromDrafts() {
  if (state.currentDelivery && Array.isArray(state.currentDelivery.items)) {
    state.currentDelivery.items = state.currentDelivery.items.filter(item => !isPartArchived(item?.sku));
    if (isSupplierArchived(state.currentDelivery?.supplier)) {
      state.currentDelivery.supplier = null;
      state.currentDelivery.items = [];
    }
  }

  if (state.currentBuild && Array.isArray(state.currentBuild.items)) {
    state.currentBuild.items = state.currentBuild.items.filter(item => !isMachineArchived(item?.machineCode));
  }
}

function applyCatalogState(nextCatalogState = {}) {
  const nextPartsCatalog = nextCatalogState?.partsCatalog instanceof Map ? nextCatalogState.partsCatalog : new Map();
  const nextSuppliers = nextCatalogState?.suppliers instanceof Map ? nextCatalogState.suppliers : new Map();
  const nextMachineCatalog = Array.isArray(nextCatalogState?.machineCatalog) ? nextCatalogState.machineCatalog : [];

  state.partsCatalog = new Map(nextPartsCatalog);
  state.suppliers = new Map(
    Array.from(nextSuppliers.entries()).map(([name, data]) => ([name, {
      archived: !!data?.archived,
      prices: new Map(data?.prices instanceof Map ? data.prices : [])
    }]))
  );
  state.machineCatalog = nextMachineCatalog.map(machine => ({
    code: normalize(machine?.code),
    name: normalize(machine?.name),
    archived: !!machine?.archived,
    bom: Array.isArray(machine?.bom)
      ? machine.bom.map(item => ({ sku: normalize(item?.sku), qty: safeInt(item?.qty) })).filter(item => item.sku)
      : []
  })).filter(machine => machine.code && machine.name);

  clearArchivedItemsFromDrafts();
  syncIdCounter();
}

function applyPartNameChangeAcrossOperationalState(partSkuRaw, nextNameRaw) {
  const key = skuKey(partSkuRaw);
  const nextName = normalize(nextNameRaw);
  if (!key || !nextName) return;

  state.lots.forEach(lot => {
    if (skuKey(lot?.sku) === key) lot.name = nextName;
  });

  state.currentDelivery.items.forEach(item => {
    if (skuKey(item?.sku) === key) item.name = nextName;
  });

  state.currentBuild.items.forEach(item => {
    const bomSnapshot = Array.isArray(item?.bomSnapshot) ? item.bomSnapshot : [];
    bomSnapshot.forEach(bomItem => {
      if (skuKey(bomItem?.sku) === key) bomItem.name = nextName;
    });
  });

  updateHistoryPartReferences(key, { sku: normalize(partSkuRaw), name: nextName });
}

function setPartArchived(skuRaw, archived) {
  const k = skuKey(skuRaw);
  const part = state.partsCatalog.get(k);
  if (!part) return { success: false, msg: 'Nie znaleziono części.' };

  const nextArchived = !!archived;
  if (nextArchived) {
    const activeMachine = partUsedInAnyActiveMachineBom(k);
    if (activeMachine) {
      return {
        success: false,
        msg: `Część nie może zostać zarchiwizowana, bo jest używana w aktywnym BOM-ie maszyny "${activeMachine.name}".`
      };
    }
  }

  part.archived = nextArchived;
  clearArchivedItemsFromDrafts();
  save();
  return { success: true, msg: nextArchived ? 'Część została zarchiwizowana.' : 'Część została przywrócona.' };
}

function setSupplierArchived(nameRaw, archived) {
  const supplierName = normalize(nameRaw);
  const supplier = state.suppliers.get(supplierName);
  if (!supplier) return { success: false, msg: 'Nie znaleziono dostawcy.' };

  supplier.archived = !!archived;
  clearArchivedItemsFromDrafts();
  save();
  return { success: true, msg: supplier.archived ? 'Dostawca został zarchiwizowany.' : 'Dostawca został przywrócony.' };
}

function setMachineArchived(codeRaw, archived) {
  const machineCode = normalize(codeRaw);
  const machine = (state.machineCatalog || []).find(item => normalize(item?.code) === machineCode);
  if (!machine) return { success: false, msg: 'Nie znaleziono maszyny.' };

  machine.archived = !!archived;
  clearArchivedItemsFromDrafts();
  save();
  return { success: true, msg: machine.archived ? 'Maszyna została zarchiwizowana.' : 'Maszyna została przywrócona.' };
}

function validatePartThresholds(yellowThreshold, redThreshold) {
  const hasYellow = yellowThreshold !== null;
  const hasRed = redThreshold !== null;

  if (!hasYellow && !hasRed) {
    return { success: true, yellowThreshold: null, redThreshold: null };
  }

  if (hasYellow !== hasRed) {
    return { success: false, msg: "Uzupełnij oba progi albo zostaw oba pola puste." };
  }

  if (redThreshold > yellowThreshold) {
    return { success: false, msg: "Próg czerwony nie może być większy niż próg żółty." };
  }

  return { success: true, yellowThreshold, redThreshold };
}

function resolvePartThresholdConfig(partOrSku) {
  const part = typeof partOrSku === "string"
    ? state.partsCatalog.get(skuKey(partOrSku))
    : partOrSku;

  const yellow = normalizeThresholdValue(part?.yellowThreshold);
  const red = normalizeThresholdValue(part?.redThreshold);

  return {
    yellowThreshold: yellow ?? LOW_WARN,
    redThreshold: red ?? LOW_DANGER,
    usesCustomThresholds: yellow !== null && red !== null
  };
}

function getPartStockStatus(partOrSku, qty) {
  const thresholds = resolvePartThresholdConfig(partOrSku);
  const safeQty = safeQtyInt(qty);

  if (safeQty <= thresholds.redThreshold) {
    return { level: "danger", label: "Krytyczne", ...thresholds };
  }
  if (safeQty <= thresholds.yellowThreshold) {
    return { level: "warning", label: "Niskie", ...thresholds };
  }
  return { level: "success", label: "OK", ...thresholds };
}

// DOM helpers
const byId = (id) => document.getElementById(id);

function setExpanded(btn, expanded) {
  if (!btn) return;
  btn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

// === DATE VALIDATION ===
function validateDateISO(isoDate, options = {}) {
  if (!isoDate) return { valid: false, error: "Data jest wymagana" };
  
  const { allowFuture = false, maxPastYears = 10 } = options;
  
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { valid: false, error: "Nieprawidłowy format daty (oczekiwano RRRR-MM-DD)" };
  
  const [, y, m, d] = match;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  
  if (year < 2000 || year > 2100) return { valid: false, error: "Rok musi być między 2000 a 2100" };
  if (month < 1 || month > 12) return { valid: false, error: "Miesiąc musi być między 1 a 12" };
  if (day < 1 || day > 31) return { valid: false, error: "Dzień musi być między 1 a 31" };
  
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { valid: false, error: "Nieprawidłowa data (np. 31 lutego)" };
  }
  
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  if (!allowFuture && date > now) {
    return { valid: false, error: "Data nie może być w przyszłości" };
  }
  
  const minDate = new Date();
  minDate.setFullYear(minDate.getFullYear() - maxPastYears);
  if (date < minDate) {
    return { valid: false, error: `Data nie może być starsza niż ${maxPastYears} lat` };
  }
  
  return { valid: true, date };
}

// === PARTS CATALOG ===
function upsertPart(sku, name, selectedSuppliers = [], thresholds = {}) {
  const s = normalize(sku);
  const n = normalize(name);
  if (!s || !n) return { success: false, msg: "Podaj Nazwę (ID) i Typ." };
  
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) {
    return { success: false, msg: "ID może zawierać tylko litery, cyfry, myślniki i podkreślenia (bez spacji)." };
  }
  
  if (s.length > 50) return { success: false, msg: "ID nie może być dłuższe niż 50 znaków." };
  if (n.length > 200) return { success: false, msg: "Typ nie może być dłuższy niż 200 znaków." };
  
  const yellowThreshold = normalizeThresholdValue(thresholds?.yellowThreshold);
  const redThreshold = normalizeThresholdValue(thresholds?.redThreshold);
  const thresholdValidation = validatePartThresholds(yellowThreshold, redThreshold);
  if (!thresholdValidation.success) return thresholdValidation;

  const k = skuKey(s);
  state.partsCatalog.set(k, {
    sku: s,
    name: n,
    yellowThreshold: thresholdValidation.yellowThreshold,
    redThreshold: thresholdValidation.redThreshold
  });

  selectedSuppliers.forEach(supName => {
    const sup = state.suppliers.get(supName);
    if (sup && !sup.prices.has(k)) {
      sup.prices.set(k, 0);
    }
  });

  save();
  return { success: true, msg: "Zapisano część w bazie." };
}

function deletePart(skuRaw) {
  const k = skuKey(skuRaw);
  if (state.lots.some(l => skuKey(l.sku) === k)) return "Część jest na stanie magazynowym - najpierw rozchoduj zapasy.";
  if (state.currentDelivery.items.some(i => skuKey(i.sku) === k)) return "Część jest w trakcie dostawy - zakończ lub anuluj dostawę.";
  
  const usedInMachine = state.machineCatalog.find(m => m.bom.some(b => skuKey(b.sku) === k));
  if (usedInMachine) return `Część używana w maszynie "${usedInMachine.name}" - usuń ją najpierw z BOM.`;

  state.partsCatalog.delete(k);
  for (let s of state.suppliers.values()) {
    s.prices.delete(k);
  }
  save();
  return null;
}

// === SUPPLIERS ===
function addSupplier(name) {
  const n = normalize(name);
  if (!n) {
    toast("Brak nazwy", "Podaj nazwę dostawcy.", "warning");
    return false;
  }
  if (n.length > 100) {
    toast("Za długa nazwa", "Nazwa dostawcy nie może przekraczać 100 znaków.", "warning");
    return false;
  }
  if (state.suppliers.has(n)) {
    toast("Dostawca już istnieje", `Dostawca "${n}" jest już w bazie.`, "warning");
    return false;
  }
  state.suppliers.set(n, { archived: false, prices: new Map() });
  save();
  renderAllSuppliers();
  refreshCatalogsUI();
  renderHistory();
  toast("Dodano dostawcę", `"${n}" został dodany do bazy.`, "success");
  return true;
}

function deleteSupplier(name) {
  const deliverySupplierSelected = normalize(state.currentDelivery?.supplier) === normalize(name);
  const deliverySupplierInForm = normalize(document.getElementById("supplierSelect")?.value || "") === normalize(name);

  if (state.lots.some(l => l.supplier === name)) {
    toast("Nie można usunąć", `Dostawca "${name}" ma towar na magazynie. Najpierw rozchoduj jego partie.`, "error");
    return;
  }
  if (deliverySupplierSelected || deliverySupplierInForm) {
    toast("Nie można usunąć", `Dostawca "${name}" jest aktualnie używany w roboczej dostawie. Zmień lub wyczyść dostawę przed usunięciem.`, "error");
    return;
  }

  state.suppliers.delete(name);
  save();
  renderAllSuppliers();
  refreshCatalogsUI();
  toast("Usunięto dostawcę", `"${name}" został usunięty.`, "success");
}

function updateSupplierPrice(supplierName, skuRaw, price) {
  const sup = state.suppliers.get(supplierName);
  if (!sup) return;
  const k = skuKey(skuRaw);
  sup.prices.set(k, safeFloat(price));
  save();
}

// === DELIVERIES ===
function addToDelivery(supplier, skuRaw, qty, price) {
  const k = skuKey(skuRaw);
  const part = state.partsCatalog.get(k);
  if (!part || part.archived) return;

  const dateInput = document.getElementById("deliveryDate");
  if (dateInput) {
    state.currentDelivery.dateISO = normalize(dateInput.value);
  }

  state.currentDelivery.items.push({
    id: nextId(),
    sku: part.sku,
    name: part.name,
    qty: safeInt(qty),
    price: safeFloat(price)
  });
  state.currentDelivery.supplier = supplier;
  save();
  renderDelivery();
}

async function finalizeDelivery() {
  if (_finalizeDeliveryBusy) {
    toast("Operacja w toku", "Przetwarzanie dostawy już trwa - proszę czekać.", "warning");
    return;
  }
  _finalizeDeliveryBusy = true;
  
  try {
    const dateInput = document.getElementById("deliveryDate");
    if (dateInput) {
      state.currentDelivery.dateISO = dateInput.value;
    }

    const d = state.currentDelivery;
    if (!d.items.length) {
      toast("Brak pozycji", "Dodaj przynajmniej jedną pozycję do dostawy.", "warning");
      return;
    }
    if (!d.dateISO) {
      toast("Brak daty", "Podaj datę dostawy.", "warning");
      dateInput?.focus();
      return;
    }
    
    const dateValidation = validateDateISO(d.dateISO, { allowFuture: false, maxPastYears: 5 });
    if (!dateValidation.valid) {
      toast("Nieprawidłowa data", dateValidation.error, "warning");
      dateInput?.focus();
      return;
    }

    const itemCount = d.items.length;
    const payload = {
      supplier: normalize(d.supplier),
      dateISO: d.dateISO,
      items: d.items.map(it => ({
        sku: normalize(it.sku),
        name: normalize(it.name),
        qty: safeInt(it.qty),
        price: safeFloat(it.price ?? it.unitPrice ?? 0)
      }))
    };

    await window.saveDeliveryToSupabase?.(payload);
    await window.loadOperationalStateFromSupabaseIntoState?.({ silent: true });

    state.currentDelivery.items = [];
    state.currentDelivery.supplier = null;
    state.currentDelivery.dateISO = "";
    if (dateInput) dateInput.value = "";

    save();
    renderDelivery();
    renderWarehouse();
    renderHistory();
    toast("Dostawa przyjęta", `Przyjęto ${itemCount} pozycji na stan magazynowy.`, "success");
  } catch (err) {
    console.error("Błąd zapisu dostawy do Supabase:", err);
    toast("Nie zapisano dostawy", err?.message || "Nie udało się zapisać dostawy w Supabase.", "error");
  } finally {
    _finalizeDeliveryBusy = false;
  }
}

// === PRODUCTION ===
function getMachineBomSnapshot(machineCode) {
  const machine = state.machineCatalog.find(m => m.code === machineCode);
  if (!machine || !Array.isArray(machine.bom)) return [];
  return machine.bom.map(bomItem => {
    const part = state.partsCatalog.get(skuKey(bomItem?.sku));
    return {
      sku: part?.sku || normalize(bomItem?.sku),
      name: part?.name || normalize(bomItem?.name),
      qty: safeInt(bomItem?.qty)
    };
  }).filter(item => item.sku);
}

function getBuildItemBom(buildItem) {
  const snapshot = Array.isArray(buildItem?.bomSnapshot) ? buildItem.bomSnapshot : [];
  if (snapshot.length) {
    return snapshot.map(item => ({
      sku: normalize(item?.sku),
      name: normalize(item?.name),
      qty: safeInt(item?.qty)
    })).filter(item => item.sku);
  }
  return getMachineBomSnapshot(buildItem?.machineCode);
}

function getBuildItemMachineName(buildItem) {
  const snapshotName = normalize(buildItem?.machineNameSnapshot);
  if (snapshotName) return snapshotName;
  const machine = state.machineCatalog.find(m => m.code === buildItem?.machineCode);
  return machine ? machine.name : normalize(buildItem?.machineCode);
}

function updateHistoryPartReferences(originalKey, nextPart) {
  const nextSku = normalize(nextPart?.sku);
  const nextName = normalize(nextPart?.name);
  if (!originalKey || !nextSku || !nextName || !Array.isArray(state.history)) return;

  const updateSkuName = (obj, skuField = 'sku', nameField = 'name') => {
    if (!obj || typeof obj !== 'object') return;
    if (skuKey(obj[skuField]) !== originalKey) return;
    obj[skuField] = nextSku;
    if (nameField in obj || obj[nameField] != null) obj[nameField] = nextName;
  };

  state.history.forEach(ev => {
    if (!ev || !Array.isArray(ev.items)) return;

    if (ev.type === 'delivery') {
      ev.items.forEach(item => updateSkuName(item));
      return;
    }

    if (ev.type === 'adjustment') {
      ev.items.forEach(item => updateSkuName(item));
      return;
    }

    if (ev.type === 'build') {
      ev.items.forEach(buildItem => {
        if (!buildItem || !Array.isArray(buildItem.partsUsed)) return;
        buildItem.partsUsed.forEach(partItem => {
          updateSkuName(partItem);
          if (Array.isArray(partItem.lots)) {
            partItem.lots.forEach(lot => updateSkuName(lot));
          }
        });
      });
    }
  });
}
function calculateBuildRequirements() {
  const needs = new Map();
  state.currentBuild.items.forEach(buildItem => {
    const bomItems = getBuildItemBom(buildItem);
    if (!bomItems.length) return;
    bomItems.forEach(bomItem => {
      const k = skuKey(bomItem.sku);
      const total = (safeInt(bomItem.qty) * safeInt(buildItem.qty));
      needs.set(k, (needs.get(k) || 0) + total);
    });
  });
  return needs;
}

function checkStockAvailability(needs) {
  const missing = [];
  for (const [k, qtyNeeded] of needs.entries()) {
    const stock = state.lots
      .filter(l => skuKey(l.sku) === k)
      .reduce((sum, l) => sum + safeQtyInt(l.qty), 0);
    
    if (stock < qtyNeeded) {
      const part = state.partsCatalog.get(k);
      missing.push({ 
        sku: part ? part.sku : k, 
        name: part ? part.name : k,
        needed: qtyNeeded, 
        has: stock,
        missing: qtyNeeded - stock
      });
    }
  }
  return missing;
}

async function finalizeBuild(manualAllocation = null) {
  if (_finalizeBuildBusy) {
    toast("Operacja w toku", "Produkcja jest już przetwarzana - proszę czekać.", "warning");
    return;
  }
  _finalizeBuildBusy = true;
  
  try {
    const buildDateInput = document.getElementById("buildDate");
    if (buildDateInput) {
      state.currentBuild.dateISO = normalize(buildDateInput.value);
    }
    const buildISO = normalize(state.currentBuild.dateISO) || (new Date().toISOString().slice(0, 10));
    
    const dateValidation = validateDateISO(buildISO, { allowFuture: false, maxPastYears: 1 });
    if (!dateValidation.valid) {
      toast("Nieprawidłowa data", dateValidation.error, "warning");
      buildDateInput?.focus();
      return;
    }

    const requirements = calculateBuildRequirements();
    const missing = checkStockAvailability(requirements);

    if (missing.length > 0) {
      renderMissingParts(missing);
      return;
    }

    let manualAllocations = null;

    if (manualAllocation) {
      const takenBySku = new Map();
      const manualEntries = [];

      for (const [lotId, qty] of Object.entries(manualAllocation)) {
        const take = safeQtyInt(qty);
        if (take <= 0) continue;

        const lot = (state.lots || []).find(l => String(l?.id) === String(lotId));
        if (!lot) {
          throw new Error(`Nie znaleziono partii #${lotId} w magazynie.`);
        }

        const k = skuKey(lot.sku);

        if (!requirements.has(k)) {
          throw new Error(`Partia #${lotId} (${lot.sku}) nie jest potrzebna do tej produkcji.`);
        }

        if (take > safeQtyInt(lot.qty)) {
          throw new Error(`W partii #${lotId} dostępne jest tylko ${lot.qty} sztuk, a próbowano pobrać ${take}.`);
        }

        takenBySku.set(k, (takenBySku.get(k) || 0) + take);
        manualEntries.push({
          lotId: String(lot.id),
          sku: normalize(lot.sku),
          qty: take
        });
      }

      for (const [k, needed] of requirements.entries()) {
        const got = takenBySku.get(k) || 0;
        if (got !== needed) {
          const skuLabel = state.partsCatalog.get(k)?.sku || k;
          const nameLabel = state.partsCatalog.get(k)?.name || "";
          throw new Error(`Dla części ${skuLabel} ${nameLabel ? `(${nameLabel}) ` : ""}wybrano ${got}, a potrzeba ${needed}.`);
        }
      }

      manualAllocations = manualEntries;
    }

    const items = state.currentBuild.items.map(bi => ({
      machineCode: normalize(bi?.machineCode),
      qty: safeInt(bi?.qty)
    })).filter(item => item.machineCode);

    if (!items.length) {
      toast("Brak pozycji", "Dodaj przynajmniej jedną pozycję do produkcji.", "warning");
      return;
    }

    await window.saveBuildToSupabase?.({
      buildISO,
      items,
      manualAllocations
    });
    await window.loadOperationalStateFromSupabaseIntoState?.({ silent: true });
    
    state.currentBuild.items = [];
    state.currentBuild.dateISO = "";
    if (buildDateInput) buildDateInput.value = "";
    save();
    
    renderBuild();
    renderWarehouse();
    renderMachinesStock();
    renderHistory();
    toast("Produkcja zakończona", "Stany magazynowe zostały zaktualizowane.", "success");
  } catch (err) {
    console.error("Błąd finalizacji produkcji w Supabase:", err);
    toast("Nie zapisano produkcji", err?.message || "Nie udało się zapisać produkcji w Supabase.", "error");
  } finally {
    _finalizeBuildBusy = false;
  }
}

// === HISTORY ===

function fmtDateISO(iso) {
  if (!iso) return "—";
  try {
    const [y, m, d] = String(iso).split("-").map(x => parseInt(x, 10));
    if (!y || !m || !d) return iso;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toLocaleDateString("pl-PL", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return iso;
  }
}

function getTodayISO() {
  return new Date().toISOString().slice(0, 10);
}

function shouldShowArchivedPartsInWarehouse() {
  ensureUiState();
  return state.ui.showArchivedPartsInWarehouse !== false;
}

function shouldShowArchivedMachinesInStock() {
  ensureUiState();
  return state.ui.showArchivedMachinesInStock !== false;
}

function setShowArchivedPartsInWarehouse(shouldShow) {
  ensureUiState();
  state.ui.showArchivedPartsInWarehouse = shouldShow !== false;
}

function setShowArchivedMachinesInStock(shouldShow) {
  ensureUiState();
  state.ui.showArchivedMachinesInStock = shouldShow !== false;
}

function getPartTotalQty(skuRaw, options = {}) {
  const k = skuKey(skuRaw);
  const includeArchivedPart = options.includeArchivedPart !== false;
  if (!includeArchivedPart && isPartArchived(skuRaw)) return 0;

  return (state.lots || [])
    .filter(l => skuKey(l.sku) === k)
    .reduce((sum, l) => sum + safeQtyInt(l.qty), 0);
}

function getLastKnownUnitPrice(skuRaw) {
  const k = skuKey(skuRaw);
  const lots = (state.lots || [])
    .filter(l => skuKey(l.sku) === k)
    .slice()
    .sort(compareLotsForConsumption);
  if (!lots.length) return 0;
  const last = lots[lots.length - 1];
  return safeFloat(last?.unitPrice || 0);
}


function getPartSuppliersForStatus(skuRaw) {
  const k = skuKey(skuRaw);
  if (!k) return [];

  return Array.from(state.suppliers.entries())
    .filter(([_, data]) => !data?.archived && data?.prices instanceof Map && data.prices.has(k))
    .map(([name, data]) => ({
      name,
      price: safeFloat(data?.prices?.get(k) ?? 0)
    }));
}

function getPartReferencePriceForStatus(skuRaw) {
  const suppliers = getPartSuppliersForStatus(skuRaw);
  if (!suppliers.length) return 0;

  const positiveSupplierPrice = suppliers.find(item => Number.isFinite(item?.price) && item.price > 0);
  if (positiveSupplierPrice) return safeFloat(positiveSupplierPrice.price);

  return safeFloat(suppliers[0]?.price ?? 0);
}

function getPartDataWarnings(skuRaw) {
  const suppliers = getPartSuppliersForStatus(skuRaw);
  const referencePrice = getPartReferencePriceForStatus(skuRaw);

  return {
    suppliers,
    referencePrice,
    hasMissingSuppliers: suppliers.length === 0,
    hasMissingPrice: !(Number.isFinite(referencePrice) && referencePrice > 0)
  };
}


function getSupplierPartsForStatus(supplierNameRaw) {
  const supplierName = normalize(supplierNameRaw);
  const supplier = state.suppliers.get(supplierName);
  if (!supplier || !(supplier.prices instanceof Map)) return [];

  return Array.from(supplier.prices.entries())
    .filter(([partKey]) => state.partsCatalog.has(partKey) && !state.partsCatalog.get(partKey)?.archived)
    .map(([partKey, price]) => {
      const part = state.partsCatalog.get(partKey);
      return {
        sku: part?.sku || partKey,
        name: part?.name || '',
        price: safeFloat(price ?? 0)
      };
    });
}

function getSupplierDataWarnings(supplierNameRaw) {
  const parts = getSupplierPartsForStatus(supplierNameRaw);

  return {
    parts,
    hasMissingParts: parts.length === 0
  };
}

function getMachineBomPartsForStatus(machineCodeRaw) {
  const machineCode = normalize(machineCodeRaw);
  const machine = (state.machineCatalog || []).find(item => normalize(item?.code) === machineCode);
  if (!machine || !Array.isArray(machine.bom)) return [];

  return machine.bom
    .map(item => ({
      sku: normalize(item?.sku),
      qty: safeInt(item?.qty)
    }))
    .filter(item => item.sku);
}

function getMachineDataWarnings(machineCodeRaw) {
  const bomParts = getMachineBomPartsForStatus(machineCodeRaw);

  return {
    bomParts,
    hasMissingParts: bomParts.length === 0
  };
}


function getPendingStockAdjustmentsCount() {
  ensureUiState();
  return Object.values(state.ui.pendingStockAdjustments || {}).filter(item => item && item.invalid !== true && safeQtyInt(item.newQty) !== safeQtyInt(item.previousQty)).length;
}

function beginStockEditMode() {
  ensureUiState();
  state.ui.stockEditMode = true;
  state.ui.pendingStockAdjustments = {};
  renderWarehouse();
}

function cancelStockEditMode() {
  ensureUiState();
  state.ui.stockEditMode = false;
  state.ui.pendingStockAdjustments = {};
  renderWarehouse();
}

function updatePendingStockAdjustment(skuRaw, rawValue) {
  ensureUiState();
  const k = skuKey(skuRaw);
  const part = state.partsCatalog.get(k) || {};
  const previousQty = getPartTotalQty(skuRaw);
  const raw = String(rawValue ?? "").trim();

  if (raw === String(previousQty)) {
    delete state.ui.pendingStockAdjustments[k];
    renderWarehouse();
    return;
  }

  if (raw === "") {
    state.ui.pendingStockAdjustments[k] = {
      sku: part.sku || normalize(skuRaw),
      name: part.name || normalize(part.name),
      previousQty,
      newQty: previousQty,
      diff: 0,
      rawValue: "",
      invalid: true
    };
    renderWarehouse();
    return;
  }

  const parsed = strictNonNegInt(raw);
  if (parsed === null) {
    state.ui.pendingStockAdjustments[k] = {
      sku: part.sku || normalize(skuRaw),
      name: part.name || normalize(part.name),
      previousQty,
      newQty: previousQty,
      diff: 0,
      rawValue: raw,
      invalid: true
    };
    renderWarehouse();
    return;
  }

  if (parsed === previousQty) {
    delete state.ui.pendingStockAdjustments[k];
    renderWarehouse();
    return;
  }

  state.ui.pendingStockAdjustments[k] = {
    sku: part.sku || normalize(skuRaw),
    name: part.name || normalize(part.name),
    previousQty,
    newQty: parsed,
    diff: parsed - previousQty,
    rawValue: String(parsed),
    invalid: false
  };
  renderWarehouse();
}

async function commitStockAdjustments() {
  if (_stockAdjustmentsBusy) {
    toast("Operacja w toku", "Korekty stanów są już zapisywane.", "warning");
    return;
  }
  _stockAdjustmentsBusy = true;

  try {
    ensureUiState();
    const pending = Object.values(state.ui.pendingStockAdjustments || {});
    const invalid = pending.find(item => item && item.invalid);
    if (invalid) {
      toast("Błędne dane", `Popraw wartość dla części ${invalid.sku || "—"}.`, "warning");
      return;
    }

    const dateISO = getTodayISO();
    const changes = pending
      .filter(Boolean)
      .map(item => {
        const sku = normalize(item.sku);
        return {
          sku,
          name: normalize(item.name),
          previousQty: safeQtyInt(item.previousQty),
          newQty: safeQtyInt(item.newQty),
          diff: safeQtyInt(item.newQty) - safeQtyInt(item.previousQty),
          referenceUnitPrice: safeFloat(getLastKnownUnitPrice(sku))
        };
      })
      .filter(item => item.newQty !== item.previousQty);

    if (!changes.length) {
      state.ui.stockEditMode = false;
      state.ui.pendingStockAdjustments = {};
      renderWarehouse();
      toast("Brak zmian", "Nie wykryto realnych korekt do zapisania.", "warning");
      return;
    }

    await window.saveStockAdjustmentToSupabase?.({
      dateISO,
      items: changes
    });
    await window.loadOperationalStateFromSupabaseIntoState?.({ silent: true });

    state.ui.stockEditMode = false;
    state.ui.pendingStockAdjustments = {};

    save();
    renderWarehouse();
    renderHistory();
    toast("Korekty zapisane", `Zapisano korekty dla ${changes.length} ${changes.length === 1 ? "części" : "części"}.`, "success");
  } catch (err) {
    console.error("Błąd zapisu korekt do Supabase:", err);
    toast("Nie zapisano korekt", err?.message || "Nie udało się zapisać korekt stanów w Supabase.", "error");
  } finally {
    _stockAdjustmentsBusy = false;
  }
}

// === DEBOUNCE UTILITY ===
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// === UNSAVED CHANGES TRACKER ===
const unsavedChanges = {
  machineEditor: false,
  supplierEditor: false,
  partEditor: false,
  
  mark(editor) {
    this[editor] = true;
  },
  
  clear(editor) {
    this[editor] = false;
  },
  
  hasAny() {
    return this.machineEditor || this.supplierEditor || this.partEditor;
  },
  
  getMessage() {
    const editors = [];
    if (this.machineEditor) editors.push("edytor maszyny");
    if (this.supplierEditor) editors.push("edytor dostawcy");
    if (this.partEditor) editors.push("edytor części");
    return editors.length ? `Masz niezapisane zmiany w: ${editors.join(", ")}.` : "";
  }
};
