/**
 * Magazyn PRO - Core (state/storage/business)
 * Version: 2.5 - Additional bug fixes and UX improvements
 */

// === CONFIGURATION & STATE ===
const STORAGE_KEY = "magazyn_state_v2_1";
const THEME_KEY = "magazyn_theme";
const THRESHOLDS_OPEN_KEY = "magazyn_thresholds_open";

// Anti-double-click guards for critical operations
let _finalizeDeliveryBusy = false;
let _finalizeBuildBusy = false;

// === THEME MANAGEMENT ===
function applyTheme(theme) {
    const t = (theme === "light") ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);

    const btn = document.getElementById("themeToggleBtn");
    if (btn) btn.textContent = `Tryb: ${t === "light" ? "Jasny" : "Ciemny"}`;
}

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
        applyTheme(saved);
    } else {
        applyTheme("dark");
    }

    const btn = document.getElementById("themeToggleBtn");
    if (btn) {
        btn.addEventListener("click", () => {
            const current = document.documentElement.getAttribute("data-theme") || "dark";
            applyTheme(current === "dark" ? "light" : "dark");
        });
    }
}

// === STATE ===
const state = {
    lots: [],
    machinesStock: [],
    partsCatalog: new Map(),
    suppliers: new Map(),
    machineCatalog: [],
    currentDelivery: { supplier: null, dateISO: "", items: [] },
    currentBuild: { dateISO: "", items: [] },
    history: []
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
function serializeState() {
    return {
        lots: state.lots,
        machinesStock: state.machinesStock,
        machineCatalog: state.machineCatalog,
        currentDelivery: state.currentDelivery,
        currentBuild: state.currentBuild,
        history: state.history,
        LOW_WARN,
        LOW_DANGER,
        partsCatalog: Array.from(state.partsCatalog.entries()),
        suppliers: Array.from(state.suppliers.entries()).map(([name, data]) => ({
            name,
            prices: Array.from(data.prices.entries())
        }))
    };
}

function restoreState(data) {
    if (!data) return;

    const asArr = (x) => Array.isArray(x) ? x : [];

    state.lots = asArr(data.lots).map(l => ({
        id: (typeof l?.id === "number") ? l.id : nextId(),
        sku: normalize(l?.sku),
        name: normalize(l?.name),
        supplier: normalize(l?.supplier) || "-",
        unitPrice: safeFloat(l?.unitPrice ?? 0),
        qty: safeQtyInt(l?.qty),
        dateIn: normalize(l?.dateIn)
    })).filter(l => l.sku && l.name);

    state.machinesStock = asArr(data.machinesStock).map(m => ({
        code: normalize(m?.code),
        name: normalize(m?.name),
        qty: safeQtyInt(m?.qty)
    })).filter(m => m.code);

    state.machineCatalog = asArr(data.machineCatalog).map(m => ({
        code: normalize(m?.code),
        name: normalize(m?.name),
        bom: asArr(m?.bom).map(b => ({
            sku: normalize(b?.sku),
            qty: safeInt(b?.qty)
        })).filter(b => b.sku)
    })).filter(m => m.code && m.name);

    state.currentDelivery = data.currentDelivery || { supplier: null, dateISO: "", items: [] };
    state.currentDelivery.items = asArr(state.currentDelivery.items).map(i => ({
        id: (typeof i?.id === "number") ? i.id : nextId(),
        sku: normalize(i?.sku),
        name: normalize(i?.name),
        qty: safeInt(i?.qty),
        price: safeFloat(i?.price)
    })).filter(i => i.sku);

    state.currentBuild = data.currentBuild || { dateISO: "", items: [] };
    state.currentBuild.items = asArr(state.currentBuild.items).map(i => ({
        id: (typeof i?.id === "number") ? i.id : nextId(),
        machineCode: normalize(i?.machineCode),
        qty: safeInt(i?.qty)
    })).filter(i => i.machineCode);

    state.history = asArr(data.history).filter(Boolean);

    // Thresholds with invariants
    LOW_WARN = (strictNonNegInt(data.LOW_WARN) ?? 100);
    LOW_DANGER = (strictNonNegInt(data.LOW_DANGER) ?? 50);
    if (LOW_WARN < 0) LOW_WARN = 0;
    if (LOW_DANGER < 0) LOW_DANGER = 0;
    if (LOW_DANGER > LOW_WARN) LOW_DANGER = LOW_WARN;

    // Restore Maps
    state.partsCatalog = new Map();
    const pc = (Array.isArray(data.partsCatalog) ? data.partsCatalog : []);
    for (const ent of pc) {
        if (!Array.isArray(ent) || ent.length < 2) continue;
        const rawKey = ent[0];
        const v = ent[1] || {};
        const k = skuKey(rawKey);
        const sku = normalize(v.sku ?? rawKey);
        const name = normalize(v.name);
        if (!k || !sku || !name) continue;
        state.partsCatalog.set(k, { sku, name });
    }

    state.suppliers = new Map();
    const sups = Array.isArray(data.suppliers) ? data.suppliers : [];
    for (const s of sups) {
        let name = "";
        let pricesRaw = [];
        if (Array.isArray(s)) {
            name = normalize(s[0]);
            pricesRaw = Array.isArray(s[1]?.prices) ? s[1].prices : [];
        } else {
            name = normalize(s?.name);
            pricesRaw = Array.isArray(s?.prices) ? s.prices : [];
        }
        if (!name) continue;
        const prices = new Map();
        for (const pe of pricesRaw) {
            if (!Array.isArray(pe) || pe.length < 2) continue;
            const pk = skuKey(pe[0]);
            if (!pk) continue;
            prices.set(pk, safeFloat(pe[1]));
        }
        state.suppliers.set(name, { prices });
    }

    syncIdCounter();
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
    } catch (e) {
        console.error("Failed to save state:", e);
        toast("Błąd zapisu", "Nie udało się zapisać danych. Pamięć lokalna może być pełna. Spróbuj usunąć niepotrzebne dane.", "bad");
    }
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) restoreState(JSON.parse(raw));
    } catch (e) {
        console.error("Error loading data:", e);
        toast("Błąd odczytu", "Nie udało się wczytać danych. Sprawdź konsolę (F12) po szczegóły.", "bad");
    }
}

function resetData() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
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

// FIXED: Handle both comma and dot decimals properly
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

const safeQtyInt = (val) => {
    const n = strictNonNegInt(val);
    return (n === null) ? 0 : n;
};

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
    
    // Check format
    const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return { valid: false, error: "Nieprawidłowy format daty (oczekiwano RRRR-MM-DD)" };
    
    const [, y, m, d] = match;
    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    
    // Check ranges
    if (year < 2000 || year > 2100) return { valid: false, error: "Rok musi być między 2000 a 2100" };
    if (month < 1 || month > 12) return { valid: false, error: "Miesiąc musi być między 1 a 12" };
    if (day < 1 || day > 31) return { valid: false, error: "Dzień musi być między 1 a 31" };
    
    // Check if valid calendar date
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return { valid: false, error: "Nieprawidłowa data (np. 31 lutego)" };
    }
    
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Check future
    if (!allowFuture && date > now) {
        return { valid: false, error: "Data nie może być w przyszłości" };
    }
    
    // Check too far in past
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - maxPastYears);
    if (date < minDate) {
        return { valid: false, error: `Data nie może być starsza niż ${maxPastYears} lat` };
    }
    
    return { valid: true, date };
}

// === PARTS CATALOG ===
function upsertPart(sku, name, selectedSuppliers = []) {
    const s = normalize(sku);
    const n = normalize(name);
    if (!s || !n) return { success: false, msg: "Podaj Nazwę (ID) i Typ." };
    
    // Validate SKU format
    if (!/^[a-zA-Z0-9_-]+$/.test(s)) {
        return { success: false, msg: "ID może zawierać tylko litery, cyfry, myślniki i podkreślenia (bez spacji)." };
    }
    
    if (s.length > 50) return { success: false, msg: "ID nie może być dłuższe niż 50 znaków." };
    if (n.length > 200) return { success: false, msg: "Typ nie może być dłuższy niż 200 znaków." };
    
    const k = skuKey(s);
    state.partsCatalog.set(k, { sku: s, name: n });

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
        toast("Brak nazwy", "Podaj nazwę dostawcy.", "warn");
        return false;
    }
    if (n.length > 100) {
        toast("Za długa nazwa", "Nazwa dostawcy nie może przekraczać 100 znaków.", "warn");
        return false;
    }
    if (state.suppliers.has(n)) {
        toast("Dostawca już istnieje", `Dostawca "${n}" jest już w bazie.`, "warn");
        return false;
    }
    state.suppliers.set(n, { prices: new Map() });
    save();
    renderAllSuppliers();
    refreshCatalogsUI();
    renderHistory();
    toast("Dodano dostawcę", `"${n}" został dodany do bazy.`, "ok");
    return true;
}

function deleteSupplier(name) {
    if (state.lots.some(l => l.supplier === name)) {
        toast("Nie można usunąć", `Dostawca "${name}" ma towar na magazynie. Najpierw rozchoduj jego partie.`, "bad");
        return;
    }
    state.suppliers.delete(name);
    save();
    renderAllSuppliers();
    refreshCatalogsUI();
    toast("Usunięto dostawcę", `"${name}" został usunięty.`, "ok");
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
    if (!part) return;

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

function finalizeDelivery() {
    if (_finalizeDeliveryBusy) {
        toast("Operacja w toku", "Przetwarzanie dostawy już trwa - proszę czekać.", "warn");
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
            toast("Brak pozycji", "Dodaj przynajmniej jedną pozycję do dostawy.", "warn");
            _finalizeDeliveryBusy = false;  // FIXED (B3)
            return;
        }
        if (!d.dateISO) {
            toast("Brak daty", "Podaj datę dostawy.", "warn");
            dateInput?.focus();
            _finalizeDeliveryBusy = false;  // FIXED (B3)
            return;
        }
        
        // Validate date
        const dateValidation = validateDateISO(d.dateISO, { allowFuture: false, maxPastYears: 5 });
        if (!dateValidation.valid) {
            toast("Nieprawidłowa data", dateValidation.error, "warn");
            dateInput?.focus();
            _finalizeDeliveryBusy = false;  // FIXED (B3)
            return;
        }

        // FIXED (B1): Save count before processing
        const itemCount = d.items.length;

        d.items.forEach(item => {
            // FIXED: Use nullish coalescing to properly handle 0 values
            const unitPrice = item.price ?? item.unitPrice ?? 0;
            state.lots.push({
                id: nextId(),
                sku: item.sku,
                name: item.name,
                supplier: d.supplier,
                unitPrice: safeFloat(unitPrice),
                qty: safeInt(item.qty),
                dateIn: d.dateISO
            });
        });

        addHistoryEvent({
            id: nextId(),
            ts: Date.now(),
            type: "delivery",
            dateISO: d.dateISO,
            supplier: d.supplier,
            items: d.items.map(it => ({
                sku: it.sku,
                name: it.name,
                qty: safeInt(it.qty),
                price: safeFloat(it.price)
            }))
        });

        state.currentDelivery.items = [];
        state.currentDelivery.supplier = null;
        state.currentDelivery.dateISO = "";
        if (dateInput) dateInput.value = "";

        save();
        renderDelivery();
        renderWarehouse();
        renderHistory();
        // FIXED (B1): Use saved count
        toast("Dostawa przyjęta", `Przyjęto ${itemCount} pozycji na stan magazynowy.`, "ok");
    } finally {
        _finalizeDeliveryBusy = false;
    }
}

// === PRODUCTION ===
function calculateBuildRequirements() {
    const needs = new Map();
    state.currentBuild.items.forEach(buildItem => {
        const machine = state.machineCatalog.find(m => m.code === buildItem.machineCode);
        if (!machine) return;
        machine.bom.forEach(bomItem => {
            const k = skuKey(bomItem.sku);
            const total = (bomItem.qty * buildItem.qty);
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

function finalizeBuild(manualAllocation = null) {
    if (_finalizeBuildBusy) {
        toast("Operacja w toku", "Produkcja jest już przetwarzana - proszę czekać.", "warn");
        return;
    }
    _finalizeBuildBusy = true;
    
    try {
        const buildDateInput = document.getElementById("buildDate");
        const buildISO = (buildDateInput && buildDateInput.value) 
            ? buildDateInput.value 
            : (new Date().toISOString().slice(0, 10));
        
        // Validate build date
        const dateValidation = validateDateISO(buildISO, { allowFuture: false, maxPastYears: 1 });
        if (!dateValidation.valid) {
            toast("Nieprawidłowa data", dateValidation.error, "warn");
            buildDateInput?.focus();
            _finalizeBuildBusy = false;  // FIXED (B2)
            return;
        }

        const requirements = calculateBuildRequirements();
        const missing = checkStockAvailability(requirements);

        if (missing.length > 0) {
            renderMissingParts(missing);
            _finalizeBuildBusy = false;  // FIXED (B2)
            return;
        }

        const lotsClone = JSON.parse(JSON.stringify(state.lots));
        const lotSnapshotById = new Map();
        (state.lots || []).forEach(l => { 
            if (l && l.id != null) lotSnapshotById.set(String(l.id), JSON.parse(JSON.stringify(l))); 
        });

        const takenLotsBySku = new Map();
        function pushTaken(k, lotId, qty) {
            const take = safeQtyInt(qty);
            if (take <= 0) return;
            const id = String(lotId);
            if (!takenLotsBySku.has(k)) takenLotsBySku.set(k, []);
            takenLotsBySku.get(k).push({ lotId: id, qty: take });
        }

        if (manualAllocation) {
            const takenBySku = new Map();

            for (const [lotId, qty] of Object.entries(manualAllocation)) {
                const take = safeQtyInt(qty);
                if (take <= 0) continue;

                const lot = lotsClone.find(l => l.id == lotId);
                if (!lot) {
                    toast("Błąd partii", `Nie znaleziono partii #${lotId} w magazynie.`, "bad");
                    return;
                }

                const k = skuKey(lot.sku);

                if (!requirements.has(k)) {
                    return toast(
                        "Błąd alokacji",
                        `Partia #${lotId} (${lot.sku}) nie jest potrzebna do tej produkcji.`,
                        "bad"
                    );
                }

                if (take > safeQtyInt(lot.qty)) {
                    return toast("Za mało w partii", `W partii #${lotId} dostępne jest tylko ${lot.qty} sztuk, a próbowano pobrać ${take}.`, "bad");
                }

                takenBySku.set(k, (takenBySku.get(k) || 0) + take);
            }

            for (const [k, needed] of requirements.entries()) {
                const got = takenBySku.get(k) || 0;
                if (got !== needed) {
                    const skuLabel = state.partsCatalog.get(k)?.sku || k;
                    const nameLabel = state.partsCatalog.get(k)?.name || "";
                    return toast("Niekompletna alokacja", `Dla części ${skuLabel} ${nameLabel ? `(${nameLabel}) ` : ""}wybrano ${got}, a potrzeba ${needed}.`, "bad");
                }
            }

            const manualEntries = Object.entries(manualAllocation)
                .map(([lotId, qty]) => {
                    const take = safeQtyInt(qty);
                    if (take <= 0) return null;
                    const lot = lotsClone.find(l => l.id == lotId);
                    if (!lot) return null;
                    return { lot, take };
                })
                .filter(Boolean)
                .sort((a, b) => (safeInt(a.lot.id) - safeInt(b.lot.id)));

            for (const ent of manualEntries) {
                ent.lot.qty = safeQtyInt(ent.lot.qty) - ent.take;
                pushTaken(skuKey(ent.lot.sku), ent.lot.id, ent.take);
            }
        } else {
            for (const [k, qtyNeeded] of requirements.entries()) {
                let remain = qtyNeeded;
                const relevantLots = lotsClone
                    .filter(l => skuKey(l.sku) === k && l.qty > 0)
                    .sort((a, b) => a.id - b.id);
                
                for (const lot of relevantLots) {
                    if (remain <= 0) break;
                    const take = Math.min(lot.qty, remain);
                    lot.qty -= take;
                    remain -= take;
                    pushTaken(k, lot.id, take);
                }
            }
        }

        state.lots = lotsClone.filter(l => l.qty > 0);
        
        state.currentBuild.items.forEach(bi => {
            const existing = state.machinesStock.find(m => m.code === bi.machineCode);
            const machineDef = state.machineCatalog.find(m => m.code === bi.machineCode);
            const currentName = machineDef ? machineDef.name : bi.machineCode;

            if (existing) {
                existing.qty += bi.qty;
                existing.name = currentName;
            } else {
                state.machinesStock.push({ 
                    code: bi.machineCode, 
                    name: currentName, 
                    qty: bi.qty 
                });
            }
        });

        // Build history snapshot
        const takenPoolBySku = new Map();
        for (const [k, arr] of takenLotsBySku.entries()) {
            takenPoolBySku.set(k, arr.map(x => ({ lotId: String(x.lotId), qty: safeQtyInt(x.qty) })));
        }

        function takeForSku(k, needed) {
            let remain = safeQtyInt(needed);
            const used = [];
            const pool = takenPoolBySku.get(k) || [];
            while (remain > 0 && pool.length) {
                const head = pool[0];
                const take = Math.min(safeQtyInt(head.qty), remain);
                if (take > 0) {
                    used.push({ lotId: String(head.lotId), qty: take });
                    head.qty = safeQtyInt(head.qty) - take;
                    remain -= take;
                }
                if (safeQtyInt(head.qty) <= 0) pool.shift();
            }
            return used;
        }

        const buildItemsDetailed = state.currentBuild.items.map(bi => {
            const def = state.machineCatalog.find(m => m.code === bi.machineCode);
            const currentName = def ? def.name : bi.machineCode;

            const partsUsed = (def && Array.isArray(def.bom) ? def.bom : []).map(bomItem => {
                const k = skuKey(bomItem.sku);
                const need = safeQtyInt(bomItem.qty) * safeQtyInt(bi.qty);

                const lotsUsed = takeForSku(k, need).map(t => {
                    const snap = lotSnapshotById.get(String(t.lotId)) || {};
                    return {
                        lotId: String(t.lotId),
                        qty: safeQtyInt(t.qty),
                        sku: snap.sku || (state.partsCatalog.get(k)?.sku || k),
                        name: snap.name || (state.partsCatalog.get(k)?.name || ""),
                        type: normalize(snap.type || ""),
                        supplier: snap.supplier || "-",
                        dateIn: snap.dateIn || snap.dateISO || null,
                        unitPrice: safeFloat(snap.unitPrice || 0)
                    };
                });

                return {
                    sku: state.partsCatalog.get(k)?.sku || k,
                    name: state.partsCatalog.get(k)?.name || "",
                    qty: need,
                    lots: lotsUsed
                };
            });

            return {
                code: bi.machineCode,
                name: currentName,
                qty: safeInt(bi.qty),
                partsUsed
            };
        });

        addHistoryEvent({
            id: nextId(),
            ts: Date.now(),
            type: "build",
            dateISO: buildISO,
            items: buildItemsDetailed
        });
        
        state.currentBuild.items = [];
        if (buildDateInput) buildDateInput.value = "";
        save();
        
        renderBuild();
        renderWarehouse();
        renderMachinesStock();
        renderHistory();
        toast("Produkcja zakończona", "Stany magazynowe zostały zaktualizowane.", "ok");
    } finally {
        _finalizeBuildBusy = false;
    }
}

// === HISTORY ===
function addHistoryEvent(ev) {
    if (!state.history) state.history = [];
    state.history.push(ev);
    if (state.history.length > 200) state.history = state.history.slice(-200);
    save();
}

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
