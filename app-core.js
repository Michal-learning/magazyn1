/**
 * Magazyn PRO - Core (state/storage/business)
 * Wersja: V2.3 - Poprawka Daty Dostawy
 */

// === KONFIGURACJA I STAN ===
const STORAGE_KEY = "magazyn_state_v2_1";
const THEME_KEY = "magazyn_theme";
const THRESHOLDS_OPEN_KEY = "magazyn_thresholds_open";


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

const state = {
    lots: [],           // Partie materiału {id, sku, name, supplier, unitPrice, qty}
    machinesStock: [],  // Wyprodukowane maszyny {code, name, qty}
    partsCatalog: new Map(), // Słownik części: skuKey -> {sku, name}
    suppliers: new Map(),    // Dostawcy: name -> {prices: Map(skuKey -> price)}
    machineCatalog: [],      // Definicje maszyn (BOM) {code, name, bom: []}

    // Stan tymczasowy
    currentDelivery: { supplier: null, dateISO: "", items: [] },
    currentBuild: { dateISO: "", items: [] },

    // Historia zdarzeń (dostawy + produkcja)
    history: []
};

// Zmienne pomocnicze
let _idCounter = 1;
let currentEditPartKey = null; // SKU key edytowanej części
let LOW_WARN = 100;
let LOW_DANGER = 50;

// Formatowanie waluty
const fmtPLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

// === SERIALIZACJA I ZAPIS ===

function nextId() { return _idCounter++; }

/**
 * Zapobiega kolizjom ID po odświeżeniu strony.
 * Ustawia licznik na (max ID w zapisanych danych + 1).
 */
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

    // partsCatalog is a Map of objects; some may carry id
    try { scan(Array.from(state.partsCatalog?.values?.() || [])); } catch {}

    _idCounter = Math.max(_idCounter, maxId + 1);
}


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

    // Defensive restore: old/corrupted localStorage should not crash the app or poison invariants.
    // We normalize only what we must (qty >= 0, numbers finite, arrays/maps shape). No schema changes.
    const asArr = (x) => Array.isArray(x) ? x : [];

    state.lots = asArr(data.lots).map(l => ({
        id: (typeof l?.id === "number") ? l.id : nextId(), // keep stable if possible
        sku: normalize(l?.sku),
        name: normalize(l?.name),
        supplier: normalize(l?.supplier) || "-",
        unitPrice: safeFloat(l?.unitPrice ?? 0),
        qty: safeQtyInt(l?.qty),
        dateIn: normalize(l?.dateIn)
    })).filter(l => l.sku && l.name); // minimal: require identity fields

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
            qty: safeInt(b?.qty) // BOM is required >= 1
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

    LOW_WARN = data.LOW_WARN ?? 100;
    LOW_DANGER = data.LOW_DANGER ?? 50;

    state.partsCatalog = new Map(data.partsCatalog || []);
    state.suppliers = new Map();
    (data.suppliers || []).forEach(s => {
        state.suppliers.set(s.name, { prices: new Map(s.prices || []) });
    });

    syncIdCounter();
}

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
}

function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) restoreState(JSON.parse(raw));
    } catch (e) {
        console.error("Błąd odczytu danych", e);
    }
}

function resetData() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
}

// === UTILS ===
const normalize = (str) => String(str || "").trim();
const skuKey = (str) => normalize(str).toLowerCase();

// POPRAWKA: Obsługa przecinków (np. "12,50" -> 12.50)
const safeFloat = (val) => {
    if (typeof val === "number") return Math.max(0, val);
    const strVal = String(val || "").replace(",", "."); 
    return Math.max(0, parseFloat(strVal) || 0);
};

const safeInt = (val) => Math.max(1, parseInt(val) || 1);
// NOTE: quantities in stock can be 0 when data is corrupted/imported; we normalize to integer >= 0.
// Keep safeInt() as >=1 for user-entered required quantities (delivery/build/BOM).
const safeQtyInt = (val) => {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
};

// DOM helpers (defensive, minimal)
const byId = (id) => document.getElementById(id);

function setExpanded(btn, expanded) {
    if (!btn) return;
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
}

// === LOGIKA BIZNESOWA: KATALOG CZĘŚCI ===

function upsertPart(sku, name, selectedSuppliers = []) {
    const s = normalize(sku);
    const n = normalize(name);
    if (!s || !n) return { success: false, msg: "Podaj Nazwę (ID) i Typ." };
    
    const k = skuKey(s);
    state.partsCatalog.set(k, { sku: s, name: n });

    // Przypisz do dostawców
    selectedSuppliers.forEach(supName => {
        const sup = state.suppliers.get(supName);
        if (sup && !sup.prices.has(k)) {
            sup.prices.set(k, 0); // Dodaj z ceną 0, jeśli jeszcze nie ma
        }
    });

    save();
    return { success: true, msg: "Zapisano część w bazie." };
}

function deletePart(skuRaw) {
    const k = skuKey(skuRaw);
    if (state.lots.some(l => skuKey(l.sku) === k)) return "Część jest na stanie magazynowym.";
    if (state.currentDelivery.items.some(i => skuKey(i.sku) === k)) return "Część jest w trakcie dostawy.";
    
    const usedInMachine = state.machineCatalog.find(m => m.bom.some(b => skuKey(b.sku) === k));
    if (usedInMachine) return `Część używana w maszynie: ${usedInMachine.name}`;

    state.partsCatalog.delete(k);
    for (let s of state.suppliers.values()) {
        s.prices.delete(k);
    }
    save();
    return null;
}

// === LOGIKA BIZNESOWA: DOSTAWCY ===

function addSupplier(name) {
    const n = normalize(name);
    if (!n) {
        toast("Błąd", "Podaj nazwę dostawcy.", "warn");
        return false;
    }
    if (state.suppliers.has(n)) {
        toast("Błąd", "Taki dostawca już istnieje.", "warn");
        return false;
    }
    state.suppliers.set(n, { prices: new Map() });
    save();
    renderAllSuppliers();
    refreshCatalogsUI();
    renderHistory();
    toast("OK", "Dodano dostawcę.", "ok");
    return true;
}

function deleteSupplier(name) {
    if (state.lots.some(l => l.supplier === name)) {
        toast("Błąd", "Nie można usunąć dostawcy, który ma towar na magazynie.", "bad");
        return;
    }
    state.suppliers.delete(name);
    save();
    renderAllSuppliers();
    refreshCatalogsUI();
}

function updateSupplierPrice(supplierName, skuRaw, price) {
    const sup = state.suppliers.get(supplierName);
    if (!sup) return;
    const k = skuKey(skuRaw);
    
    sup.prices.set(k, safeFloat(price));
    save();
}

// === LOGIKA BIZNESOWA: DOSTAWY ===

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
    // --- POPRAWKA TUTAJ ---
    // Pobieramy datę bezpośrednio z pola input przed sprawdzeniem
    const dateInput = document.getElementById("deliveryDate");
    if (dateInput) {
        state.currentDelivery.dateISO = dateInput.value;
    }
    // ----------------------

    const d = state.currentDelivery;
    if (!d.items.length) return;
    if (!d.dateISO) return toast("Uwaga", "Podaj datę dostawy.", "warn");

    d.items.forEach(item => {
        state.lots.push({
            id: nextId(),
            sku: item.sku,
            name: item.name,
            supplier: d.supplier,
            unitPrice: item.unitPrice || item.price, // Fallback fix
            qty: item.qty,
            dateIn: d.dateISO
        });
    });


    // Historia: zapis dostawy (snapshot)
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
    
    // Resetujemy też stan daty i pole w formularzu
    state.currentDelivery.dateISO = "";
    if (dateInput) dateInput.value = "";

    save();
    renderDelivery();
    renderWarehouse();
    renderHistory();
    toast("Sukces", "Towar przyjęty na stan.", "ok");
}

// === LOGIKA BIZNESOWA: PRODUKCJA ===

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
            .reduce((sum, l) => sum + l.qty, 0);
        
        if (stock < qtyNeeded) {
            const part = state.partsCatalog.get(k);
            missing.push({ sku: part ? part.sku : k, needed: qtyNeeded, has: stock });
        }
    }
    return missing;
}

function finalizeBuild(manualAllocation = null) {

    // Pobierz datę produkcji z formularza (jeśli puste, użyj dzisiejszej)
    const buildDateInput = document.getElementById("buildDate");
    const buildISO = (buildDateInput && buildDateInput.value) ? buildDateInput.value : (new Date().toISOString().slice(0,10));

    const requirements = calculateBuildRequirements();
    const missing = checkStockAvailability(requirements);

    if (missing.length > 0) {
        renderMissingParts(missing);
        return;
    }

    const lotsClone = JSON.parse(JSON.stringify(state.lots));
    
    if (manualAllocation) {
        // 1) policz ile wzięto per SKU (na podstawie faktycznych partii, nie datasetów z DOM)
        const takenBySku = new Map();

        for (const [lotId, qty] of Object.entries(manualAllocation)) {
            const take = safeQtyInt(qty);
            if (take <= 0) continue;

            const lot = lotsClone.find(l => l.id == lotId);
            if (!lot) return toast("Błąd", `Nie znaleziono partii #${lotId}.`, "bad");

            const k = skuKey(lot.sku);

            // Manual nie może pobierać czegokolwiek spoza wymagań bieżącego planu.
            if (!requirements.has(k)) {
                return toast(
                    "Błąd manualny",
                    `Wybrano partię #${lotId} dla części ${lot.sku}, która nie jest wymagana w tym planie.`,
                    "bad"
                );
            }

            // Nigdy nie pozwól nadpisać stanu partii.
            if (take > safeQtyInt(lot.qty)) {
                return toast("Błąd", "Próba pobrania więcej niż jest w partii.", "bad");
            }

            takenBySku.set(k, (takenBySku.get(k) || 0) + take);
        }

        // 2) wymuś dokładne dopasowanie do wymagań (i brak braków oraz brak nadmiaru)
        for (const [k, needed] of requirements.entries()) {
            const got = takenBySku.get(k) || 0;
            if (got !== needed) {
                const skuLabel = state.partsCatalog.get(k)?.sku || k;
                return toast("Błąd manualny", `Dla części ${skuLabel} wybrano ${got}, a potrzeba ${needed}.`, "bad");
            }
        }

        // 3) dopiero teraz fizycznie zdejmij ze stanu
        for (const [lotId, qty] of Object.entries(manualAllocation)) {
            const take = safeQtyInt(qty);
            if (take <= 0) continue;
            const lot = lotsClone.find(l => l.id == lotId);
            if (!lot) continue;
            lot.qty = safeQtyInt(lot.qty) - take;
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
            }
        }
    }

    state.lots = lotsClone.filter(l => l.qty > 0);
    
    state.currentBuild.items.forEach(bi => {
        const existing = state.machinesStock.find(m => m.code === bi.machineCode);
        
        // POPRAWKA: Pobieranie aktualnej nazwy maszyny (jeśli edytowano BOM/nazwę)
        const machineDef = state.machineCatalog.find(m => m.code === bi.machineCode);
        const currentName = machineDef ? machineDef.name : bi.machineCode;

        if (existing) {
            existing.qty += bi.qty;
            existing.name = currentName; // Aktualizacja nazwy
        } else {
            state.machinesStock.push({ 
                code: bi.machineCode, 
                name: currentName, 
                qty: bi.qty 
            });
        }
    });


    // Historia: zapis produkcji (snapshot)
    addHistoryEvent({
        id: nextId(),
        ts: Date.now(),
        type: "build",
        dateISO: buildISO,
        items: state.currentBuild.items.map(bi => {
            const def = state.machineCatalog.find(m => m.code === bi.machineCode);
            return {
                code: bi.machineCode,
                name: def ? def.name : bi.machineCode,
                qty: safeInt(bi.qty)
            };
        })
    });

    state.currentBuild.items = [];
    if (buildDateInput) buildDateInput.value = "";
    save();
    
    renderBuild();
    renderWarehouse();
    renderMachinesStock();
    renderHistory();
    toast("Produkcja zakończona", "Stany zaktualizowane.", "ok");
}



function fmtDateISO(iso) {
    if (!iso) return "—";
    // iso expected: YYYY-MM-DD
    try {
        const [y,m,d] = String(iso).split("-").map(x => parseInt(x,10));
        if (!y || !m || !d) return iso;
        const dt = new Date(Date.UTC(y, m-1, d));
        return dt.toLocaleDateString("pl-PL", { year:"numeric", month:"2-digit", day:"2-digit" });
    } catch {
        return iso;
    }
    // TODO: syncIdCounter() was here but unreachable; leaving it out on purpose.
}
