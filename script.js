/**
 * Magazyn PRO - Core Logic
 * Wersja: V2.3 - Poprawka Daty Dostawy
 */

// === KONFIGURACJA I STAN ===
const STORAGE_KEY = "magazyn_state_v2_1";

const state = {
    lots: [],           // Partie materiału {id, sku, name, supplier, unitPrice, qty}
    machinesStock: [],  // Wyprodukowane maszyny {code, name, qty}
    partsCatalog: new Map(), // Słownik części: skuKey -> {sku, name}
    suppliers: new Map(),    // Dostawcy: name -> {prices: Map(skuKey -> price)}
    machineCatalog: [],      // Definicje maszyn (BOM) {code, name, bom: []}

    // Stan tymczasowy
    currentDelivery: { supplier: null, dateISO: "", items: [] },
    currentBuild: { dateISO: "", items: [] } 
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

function serializeState() {
    return {
        lots: state.lots,
        machinesStock: state.machinesStock,
        machineCatalog: state.machineCatalog,
        currentDelivery: state.currentDelivery,
        currentBuild: state.currentBuild,
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
    state.lots = data.lots || [];
    state.machinesStock = data.machinesStock || [];
    state.machineCatalog = data.machineCatalog || [];
    state.currentDelivery = data.currentDelivery || { supplier: null, dateISO: "", items: [] };
    state.currentBuild = data.currentBuild || { dateISO: "", items: [] };
    
    LOW_WARN = data.LOW_WARN ?? 100;
    LOW_DANGER = data.LOW_DANGER ?? 50;

    state.partsCatalog = new Map(data.partsCatalog || []);
    state.suppliers = new Map();
    (data.suppliers || []).forEach(s => {
        state.suppliers.set(s.name, { prices: new Map(s.prices || []) });
    });

    const allIds = [
        ...state.lots.map(x => x.id),
        ...state.currentDelivery.items.map(x => x.id),
        ...state.currentBuild.items.map(x => x.id)
    ];
    _idCounter = allIds.length ? Math.max(...allIds) + 1 : 1;
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
    if (!n) return;
    if (!state.suppliers.has(n)) {
        state.suppliers.set(n, { prices: new Map() });
        save();
        renderAllSuppliers();
        refreshCatalogsUI(); // Żeby odświeżyć listę checkboxów w "Nowa część"
    }
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

    state.currentDelivery.items = [];
    state.currentDelivery.supplier = null;
    
    // Resetujemy też stan daty i pole w formularzu
    state.currentDelivery.dateISO = "";
    if (dateInput) dateInput.value = "";

    save();
    renderDelivery();
    renderWarehouse();
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
    const requirements = calculateBuildRequirements();
    const missing = checkStockAvailability(requirements);

    if (missing.length > 0) {
        renderMissingParts(missing);
        return;
    }

    const lotsClone = JSON.parse(JSON.stringify(state.lots));
    
    if (manualAllocation) {
        for (const [lotId, qty] of Object.entries(manualAllocation)) {
            const lot = lotsClone.find(l => l.id == lotId);
            if (lot) {
                lot.qty -= qty;
                if (lot.qty < 0) return toast("Błąd", "Próba pobrania więcej niż w partii.", "bad");
            }
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

    state.currentBuild.items = [];
    save();
    
    renderBuild();
    renderWarehouse();
    renderMachinesStock();
    toast("Produkcja zakończona", "Stany zaktualizowane.", "ok");
}


// === INTERFEJS UŻYTKOWNIKA (UI) ===

const els = {
    partsTable: document.querySelector("#partsTable tbody"),
    summaryTable: document.querySelector("#skuSummaryTable tbody"),
    whTotal: document.getElementById("warehouseTotal"),
    deliveryItems: document.querySelector("#deliveryItemsTable tbody"),
    buildItems: document.querySelector("#buildItemsTable tbody"),
    missingBox: document.getElementById("missingBox"),
    manualBox: document.getElementById("manualConsumeBox"),
    partsCatalog: document.querySelector("#partsCatalogTable tbody"),
    suppliersList: document.querySelector("#suppliersListTable tbody"),
    machinesCatalog: document.querySelector("#machinesCatalogTable tbody"),
    machineSelect: document.getElementById('machineSelect'),};

function renderWarehouse() {
    const q = normalize(document.getElementById("searchParts").value).toLowerCase();
    const summary = new Map();
    let grandTotal = 0;

    // POPRAWKA: Wyszukiwanie obejmuje dostawcę
    const filteredLots = state.lots.filter(l => 
        !q || 
        l.sku.toLowerCase().includes(q) || 
        l.name.toLowerCase().includes(q) ||
        (l.supplier && l.supplier.toLowerCase().includes(q))
    );

    els.partsTable.innerHTML = filteredLots.map(l => {
        const val = l.qty * l.unitPrice;
        grandTotal += val;
        
        const k = skuKey(l.sku);
        // POPRAWKA: Pobieramy aktualną nazwę z katalogu (synchronizacja)
        const catalogPart = state.partsCatalog.get(k);
        const displayName = catalogPart ? catalogPart.name : l.name;

        if (!summary.has(k)) {
            summary.set(k, {
                sku: l.sku, 
                name: displayName, 
                qty: 0, 
                val: 0
            });
        }
        
        const s = summary.get(k);
        s.qty += l.qty;
        s.val += val;

        return `<tr>
            <td><strong>${displayName}</strong><br><small class="muted">${l.sku}</small></td>
            <td>${l.supplier || "-"}</td>
            <td class="right">${fmtPLN.format(l.unitPrice)}</td>
            <td class="right">${l.qty}</td>
            <td class="right">${fmtPLN.format(val)}</td>
        </tr>`;
    }).join("");

    els.whTotal.textContent = fmtPLN.format(grandTotal);

    els.summaryTable.innerHTML = Array.from(summary.values())
        .sort((a,b) => a.sku.localeCompare(b.sku))
        .map(s => {
            let cls = "";
            if (s.qty < LOW_DANGER) cls = "stock-danger";
            else if (s.qty < LOW_WARN) cls = "stock-warn";
            
            return `<tr class="${cls}">
                <td><span class="badge">${s.sku}</span></td>
                <td>${s.name}</td>
                <td class="right"><strong>${s.qty}</strong></td>
                <td class="right">${fmtPLN.format(s.val)}</td>
            </tr>`;
        }).join("");
}

function renderDelivery() {
    const items = state.currentDelivery.items;
    let total = 0;
    els.deliveryItems.innerHTML = items.map(i => {
        const rowVal = i.qty * i.price;
        total += rowVal;
        return `<tr>
            <td><span class="badge">${i.sku}</span> ${i.name}</td>
            <td class="right">${i.qty}</td>
            <td class="right">${fmtPLN.format(i.price)}</td>
            <td class="right">${fmtPLN.format(rowVal)}</td>
            <td class="right"><button class="iconBtn" onclick="removeDeliveryItem(${i.id})">✕</button></td>
        </tr>`;
    }).join("");
    
    document.getElementById("itemsCount").textContent = items.length;
    document.getElementById("itemsTotal").textContent = fmtPLN.format(total);
    document.getElementById("finalizeDeliveryBtn").disabled = items.length === 0;
}

function renderBuild() {
    els.buildItems.innerHTML = state.currentBuild.items.map(i => {
        const m = state.machineCatalog.find(x => x.code === i.machineCode);
        return `<tr>
            <td>${m ? m.name : "???"} <span class="badge">${i.machineCode}</span></td>
            <td class="right">${i.qty}</td>
            <td class="right"><button class="iconBtn" onclick="removeBuildItem(${i.id})">✕</button></td>
        </tr>`;
    }).join("");
    
    document.getElementById("buildItemsCount").textContent = state.currentBuild.items.length;
    document.getElementById("finalizeBuildBtn").disabled = state.currentBuild.items.length === 0;
    els.missingBox.hidden = true;
    els.manualBox.hidden = true;
}

function renderMissingParts(missing) {
    els.missingBox.hidden = false;
    document.getElementById("missingList").innerHTML = missing.map(m => 
        `<li><strong>${m.sku}</strong>: Potrzeba ${m.needed}, stan: ${m.has} (brak: ${m.needed - m.has})</li>`
    ).join("");
}

function renderManualConsume() {
    const req = calculateBuildRequirements();
    const container = document.getElementById("manualConsumeUI");
    container.innerHTML = "";
    
    const missing = checkStockAvailability(req);
    if (missing.length > 0) {
        renderMissingParts(missing);
        els.manualBox.hidden = true;
        return;
    }

    els.manualBox.hidden = false;
    
    req.forEach((qtyNeeded, skuKeyStr) => {
        const part = state.partsCatalog.get(skuKeyStr);
        const lots = state.lots.filter(l => skuKey(l.sku) === skuKeyStr);
        
        const html = `
        <div class="consumePart">
            <div style="margin-bottom:6px">
                <strong>${part?.sku || skuKeyStr}</strong> 
                <span class="muted">(Wymagane: ${qtyNeeded})</span>
            </div>
            ${lots.map(lot => `
                <div class="lotRow">
                    <span>${lot.supplier} (${fmtPLN.format(lot.unitPrice)}) - Dostępne: ${lot.qty}</span>
                    <input type="number" class="manual-lot-input" 
                        data-lot-id="${lot.id}" 
                        data-sku="${skuKeyStr}"
                        max="${lot.qty}" min="0" value="0">
                </div>
            `).join("")}
        </div>`;
        container.insertAdjacentHTML('beforeend', html);
    });
}

function renderMachinesStock() {
    const q = normalize(document.getElementById("searchMachines").value).toLowerCase();
    const tbody = document.querySelector("#machinesStockTable tbody");
    
    tbody.innerHTML = state.machinesStock
        .filter(m => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q))
        .map(m => `<tr>
            <td><span class="badge">${m.code}</span></td>
            <td>${m.name}</td>
            <td class="right"><strong>${m.qty}</strong></td>
        </tr>`).join("");
}

function renderAllSuppliers() {
    const tbody = document.getElementById("suppliersListTable").querySelector("tbody");
    tbody.innerHTML = Array.from(state.suppliers.keys()).sort().map(name => `
        <tr>
            <td>${name}</td>
            <td class="right">
                <button class="success compact" onclick="openSupplierEditor('${name}')">Cennik</button>
                <button class="secondary compact" onclick="askDeleteSupplier('${name}')">Usuń</button>
            </td>
        </tr>
    `).join("");
    
    renderSelectOptions(document.getElementById("supplierSelect"), Array.from(state.suppliers.keys()));
}

function refreshCatalogsUI() {
    // 1. PARTS CATALOG TABLE
    const parts = Array.from(state.partsCatalog.values());
    els.partsCatalog.innerHTML = parts.map(p => {
        // Find suppliers who have this part
        const suppliers = Array.from(state.suppliers.entries())
            .filter(([_, data]) => data.prices.has(skuKey(p.sku)))
            .map(([n]) => n);
            
        return `<tr>
            <td><span class="badge">${p.sku}</span></td>
            <td>${p.name}</td>
            <td>${suppliers.length ? suppliers.map(s => `<span class="supplierChip small">${s}</span>`).join(" ") : '<span class="muted">-</span>'}</td>
            <td class="right">
                <button class="success compact" onclick="startEditPart('${p.sku}')">Edytuj</button>
                <button class="iconBtn" onclick="askDeletePart('${p.sku}')">Usuń</button>
            </td>
        </tr>`;
    }).join("");

    // 2. MACHINES CATALOG
    els.machinesCatalog.innerHTML = state.machineCatalog.map(m => `
        <tr>
            <td><span class="badge">${m.code}</span></td>
            <td>${m.name}</td>
            <td class="right">${m.bom.length}</td>
            <td class="right">
                <button class="success compact" onclick="openMachineEditor('${m.code}')">Edytuj BOM</button>
                <button class="secondary compact" onclick="askDeleteMachine('${m.code}')">Usuń</button>
            </td>
        </tr>
    `).join("");

    // 3. SELECTS for machines
    renderSelectOptions(els.machineSelect, state.machineCatalog.map(m => m.code), c => {
        const m = state.machineCatalog.find(x => x.code === c);
        return `${m.name} (${c})`;
    });

    // 4. GENERATE SUPPLIER CHECKBOXES FOR NEW PART
    const supCheckList = document.getElementById("partNewSuppliersChecklist");
    const allSups = Array.from(state.suppliers.keys()).sort();
    
    if (allSups.length === 0) {
        supCheckList.innerHTML = '<span class="small muted">Brak zdefiniowanych dostawców. Dodaj ich w zakładce "Dostawcy".</span>';
    } else {
        supCheckList.innerHTML = allSups.map(s => `
            <label style="display:inline-flex; align-items:center; background:rgba(255,255,255,0.05); padding:4px 8px; border-radius:12px; font-size:0.85rem; cursor:pointer;">
                <input type="checkbox" name="newPartSupplier" value="${s}" style="width:auto; margin:0 6px 0 0;">
                ${s}
            </label>
        `).join("");
    }
}

// === UTILS UI ===
function renderSelectOptions(select, values, displayMapFn = x => x) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">-- Wybierz --</option>' + 
        values.map(v => `<option value="${v}">${displayMapFn(v)}</option>`).join("");
    if (values.includes(current)) select.value = current;
}

function toast(title, msg, type="ok") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div style="font-weight:bold">${title}</div><div>${msg}</div>`;
    document.querySelector(".toastHost").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3000);
}

// === INITIALIZATION ===
function init() {
    if (!document.querySelector(".toastHost")) {
        const h = document.createElement("div"); h.className = "toastHost"; document.body.appendChild(h);
    }
    load();
    bindTabs();
    bindSearch();
    
    renderWarehouse();
    renderAllSuppliers();
    renderMachinesStock();
    refreshCatalogsUI();

    document.getElementById("warnRange").addEventListener("input", (e) => {
        LOW_WARN = parseInt(e.target.value);
        document.getElementById("warnValue").textContent = LOW_WARN;
        save(); renderWarehouse();
    });
    document.getElementById("dangerRange").addEventListener("input", (e) => {
        LOW_DANGER = parseInt(e.target.value);
        document.getElementById("dangerValue").textContent = LOW_DANGER;
        save(); renderWarehouse();
    });
    // Edycja części (Baza Części)
    document.getElementById("saveEditPartBtn")?.addEventListener("click", saveEditPart);
    document.getElementById("cancelEditPartBtn")?.addEventListener("click", cancelEditPart);

}

// EVENTS

// --- Delivery ---
document.getElementById("supplierSelect").addEventListener("change", (e) => {
  const supName = e.target.value;
  const skuSelect = document.getElementById("supplierPartsSelect");

  if (!supName) {
    skuSelect.innerHTML = "";
    return;
  }

  const sup = state.suppliers.get(supName);

  // FIX: jeśli dostawca nie ma jeszcze pozycji w cenniku, pokaż wszystkie części z katalogu
  const skuList = (sup && sup.prices && sup.prices.size)
    ? Array.from(sup.prices.keys())
    : Array.from(state.partsCatalog.keys());

  skuSelect.innerHTML =
    '<option value="">-- Wybierz część --</option>' +
    skuList.map(k => {
      const p = state.partsCatalog.get(k);
      const price = (sup && sup.prices) ? (sup.prices.get(k) ?? 0) : 0;
      return `<option value="${k}" data-price="${price}">
        ${p ? p.sku : k} - ${p ? p.name : ""} (${fmtPLN.format(price)})
      </option>`;
    }).join("");

  skuSelect.dispatchEvent(new Event("change"));
});

document.getElementById("supplierPartsSelect").addEventListener("change", (e) => {
  const opt = e.target.selectedOptions[0];

  // FIX: placeholder/brak wyboru nie powinien wpychać undefined/NaN
  if (!opt || !opt.value) {
    document.getElementById("deliveryPrice").value = 0;
    return;
  }

  document.getElementById("deliveryPrice").value = opt.dataset.price ?? 0;
});

document.getElementById("addDeliveryItemBtn").addEventListener("click", () => {
    const sup = document.getElementById("supplierSelect").value;
    if (!sup) return toast("Błąd", "Wybierz dostawcę.", "warn");
    
    const skuKeyVal = document.getElementById("supplierPartsSelect").value;
    if (!skuKeyVal) return toast("Błąd", "Wybierz część.", "warn");
    
    const qty = document.getElementById("deliveryQty").value;
    const price = document.getElementById("deliveryPrice").value;
    
    const part = state.partsCatalog.get(skuKeyVal);
    addToDelivery(sup, part.sku, qty, price);
});

document.getElementById("finalizeDeliveryBtn").addEventListener("click", finalizeDelivery);
window.removeDeliveryItem = (id) => {
    state.currentDelivery.items = state.currentDelivery.items.filter(x => x.id !== id);
    save(); renderDelivery();
}

// --- Build ---
document.getElementById("addBuildItemBtn").addEventListener("click", () => {
    const code = els.machineSelect.value;
    if (!code) return;
    const qty = safeInt(document.getElementById("buildQty").value);
    
    state.currentBuild.items.push({ id: nextId(), machineCode: code, qty });
    save(); renderBuild();
});

window.removeBuildItem = (id) => {
    state.currentBuild.items = state.currentBuild.items.filter(x => x.id !== id);
    save(); renderBuild();
}

document.getElementById("finalizeBuildBtn").addEventListener("click", () => {
    const mode = document.getElementById("consumeMode").value;
    if (mode === 'manual') {
        const inputs = document.querySelectorAll(".manual-lot-input");
        const manualAlloc = {};
        let error = false;
        
        const req = calculateBuildRequirements();
        const currentSum = new Map();
        
        inputs.forEach(inp => {
            const val = safeFloat(inp.value);
            if (val > 0) {
                manualAlloc[inp.dataset.lotId] = val;
                const k = inp.dataset.sku;
                currentSum.set(k, (currentSum.get(k)||0) + val);
            }
        });

        req.forEach((needed, k) => {
            if ((currentSum.get(k) || 0) !== needed) {
                toast("Błąd manualny", `Dla części ${state.partsCatalog.get(k)?.sku} wybrano ${currentSum.get(k)||0}, a potrzeba ${needed}.`, "bad");
                error = true;
            }
        });

        if (!error) finalizeBuild(manualAlloc);
    } else {
        finalizeBuild(null);
    }
});

document.getElementById("consumeMode").addEventListener("change", (e) => {
    if (e.target.value === 'manual') renderManualConsume();
    else {
        els.manualBox.hidden = true;
        els.missingBox.hidden = true;
    }
});

// --- Catalogs ---
document.getElementById("addPartBtn").addEventListener("click", () => {
    const sku = document.getElementById("partSkuInput").value;
    const name = document.getElementById("partNameInput").value;
    
    // Pobierz zaznaczonych dostawców
    const checkboxes = document.querySelectorAll('input[name="newPartSupplier"]:checked');
    const selectedSups = Array.from(checkboxes).map(cb => cb.value);

    const res = upsertPart(sku, name, selectedSups);
    toast(res.success?"OK":"Błąd", res.msg, res.success?"ok":"warn");
    if (res.success) {
        document.getElementById("partSkuInput").value = "";
        document.getElementById("partNameInput").value = "";
        // Reset checkboxów
        checkboxes.forEach(cb => cb.checked = false);
        refreshCatalogsUI();
    }
});

window.askDeletePart = (sku) => {
    if(confirm("Czy na pewno usunąć tę część?")) {
        const err = deletePart(sku);
        if (err) toast("Nie można usunąć", err, "bad");
        else { toast("Usunięto", sku, "ok"); refreshCatalogsUI(); }
    }
};

document.getElementById("addSupplierBtn").addEventListener("click", () => {
    addSupplier(document.getElementById("supplierNameInput").value);
    document.getElementById("supplierNameInput").value = "";
});
window.askDeleteSupplier = (n) => { if(confirm("Usunąć dostawcę " + n + "?")) deleteSupplier(n); };

document.getElementById("addMachineBtn").addEventListener("click", () => {
    const c = normalize(document.getElementById("machineCodeInput").value);
    const n = normalize(document.getElementById("machineNameInput").value);
    if (!c || !n) return;
    state.machineCatalog.push({code: c, name: n, bom: []});
    save(); refreshCatalogsUI();
});
window.askDeleteMachine = (code) => {
    state.machineCatalog = state.machineCatalog.filter(m => m.code !== code);
    save(); refreshCatalogsUI();
};

// --- Editors Inline ---
let editingSup = null;
let editingMachine = null;

window.openSupplierEditor = (name) => {
    editingSup = name;
    const panel = document.getElementById("supplierEditorTemplate");
    document.getElementById("supplierEditorName").textContent = name;
    
    const sel = document.getElementById("supplierEditorPartSelect");
    sel.innerHTML = Array.from(state.partsCatalog.values()).map(p => 
        `<option value="${p.sku}">${p.sku} (${p.name})</option>`
    ).join("");
    
    renderSupEditorTable();
    panel.hidden = false;
    panel.scrollIntoView({behavior: "smooth"});
};

function renderSupEditorTable() {
    const tbody = document.getElementById("supplierEditorPriceBody");
    const sup = state.suppliers.get(editingSup);
    tbody.innerHTML = Array.from(sup.prices.entries()).map(([k, price]) => {
        const p = state.partsCatalog.get(k);
        return `<tr><td>${p ? p.sku : k}</td><td>${p ? p.name : '-'}</td><td>${fmtPLN.format(price)}</td></tr>`;
    }).join("");
}

document.getElementById("supplierEditorSetPriceBtn").addEventListener("click", () => {
    const sku = document.getElementById("supplierEditorPartSelect").value;
    const price = document.getElementById("supplierEditorPriceInput").value;
    updateSupplierPrice(editingSup, sku, price);
    renderSupEditorTable();
});

document.getElementById("supplierEditorSaveBtn").addEventListener("click", () => {
    document.getElementById("supplierEditorTemplate").hidden = true;
    renderAllSuppliers();
    refreshCatalogsUI();
});
document.getElementById("supplierEditorCancelBtn").addEventListener("click", () => {
    document.getElementById("supplierEditorTemplate").hidden = true;
});

window.openMachineEditor = (code) => {
    editingMachine = state.machineCatalog.find(m => m.code === code);
    if (!editingMachine) return;
    
    const panel = document.getElementById("machineEditorTemplate");
    document.getElementById("machineEditorName").textContent = editingMachine.name;
    document.getElementById("machineEditorCode").textContent = code;
    
    const sel = document.getElementById("bomSkuSelect");
    sel.innerHTML = Array.from(state.partsCatalog.values()).map(p => 
        `<option value="${p.sku}">${p.sku} (${p.name})</option>`
    ).join("");

    renderBomTable();
    panel.hidden = false;
    panel.scrollIntoView({behavior: "smooth"});
};

function renderBomTable() {
    const tbody = document.querySelector("#bomTable tbody");
    tbody.innerHTML = editingMachine.bom.map((b, idx) => {
        const p = state.partsCatalog.get(skuKey(b.sku));
        return `<tr>
            <td><span class="badge">${b.sku}</span></td>
            <td>${p ? p.name : "???"}</td>
            <td class="right">${b.qty}</td>
            <td class="right"><button class="iconBtn" onclick="removeBomItem(${idx})">Usuń</button></td>
        </tr>`;
    }).join("");
}

document.getElementById("addBomItemBtn").addEventListener("click", () => {
    const sku = document.getElementById("bomSkuSelect").value;
    const qty = safeInt(document.getElementById("bomQtyInput").value);
    
    const existing = editingMachine.bom.find(b => skuKey(b.sku) === skuKey(sku));
    if (existing) existing.qty = qty;
    else editingMachine.bom.push({ sku, qty });
    
    renderBomTable();
});

window.removeBomItem = (idx) => {
    editingMachine.bom.splice(idx, 1);
    renderBomTable();
};

document.getElementById("machineEditorSaveBtn").addEventListener("click", () => {
    save();
    document.getElementById("machineEditorTemplate").hidden = true;
    refreshCatalogsUI();
});
document.getElementById("machineEditorCancelBtn").addEventListener("click", () => {
    document.getElementById("machineEditorTemplate").hidden = true;
    load(); 
});

// Common Bindings
function bindTabs() {
    const btns = document.querySelectorAll(".tabBtn");
    btns.forEach(btn => {
        btn.addEventListener("click", () => {
            btns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".tabPanel").forEach(p => p.hidden = true);
            document.querySelector(`[data-tab-panel="${btn.dataset.tabTarget}"]`).hidden = false;
        });
    });
}

function bindSearch() {
    document.getElementById("searchParts").addEventListener("input", renderWarehouse);
    document.getElementById("searchMachines").addEventListener("input", renderMachinesStock);
}

document.getElementById("clearDataBtn").addEventListener("click", () => {
    if(confirm("Czy na pewno chcesz usunąć WSZYSTKIE dane?")) resetData();
});

init();

// === EDYCJA CZĘŚCI (Baza Części) ===

function buildEditPartSuppliersChecklist(partKey) {
    const box = document.getElementById("editPartSuppliersChecklist");
    if (!box) return;

    const allSups = Array.from(state.suppliers.keys()).sort();
    if (!allSups.length) {
        box.innerHTML = '<span class="small muted">Brak zdefiniowanych dostawców.</span>';
        return;
    }

    box.innerHTML = allSups.map(name => {
        const sup = state.suppliers.get(name);
        const checked = sup && sup.prices && sup.prices.has(partKey);
        return `
            <label class="checkRow">
                <input type="checkbox" value="${name}" ${checked ? "checked" : ""}>
                <span>${name}</span>
            </label>
        `;
    }).join("");
}

function startEditPart(sku) {
    const section = document.getElementById("partEditSection");
    const title = document.getElementById("partEditTitle");
    const skuInput = document.getElementById("editPartSkuInput");
    const nameInput = document.getElementById("editPartNameInput");

    if (!section || !title || !skuInput || !nameInput) {
        return toast("Brakuje elementów UI do edycji części (HTML).");
    }

    const key = skuKey(sku);
    const part = state.partsCatalog.get(key);
    if (!part) return toast("Nie znaleziono części w bazie.");

    currentEditPartKey = key;

    title.textContent = `Edycja Części: ${part.sku}`;
    skuInput.value = part.sku;
    nameInput.value = part.name || "";

    buildEditPartSuppliersChecklist(key);

    section.hidden = false;
    // slide-open (hidden nie da się animować, więc robimy transition po klasie)
    section.classList.add("collapsed");
    requestAnimationFrame(() => {
        section.classList.remove("collapsed");
        setTimeout(() => section.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    });
}

function cancelEditPart() {
    const section = document.getElementById("partEditSection");
    if (section) {
        section.classList.add("collapsed");
        const onEnd = () => { section.hidden = true; };
        section.addEventListener("transitionend", onEnd, { once: true });
    }

    currentEditPartKey = null;

    const title = document.getElementById("partEditTitle");
    if (title) title.textContent = "Edycja Części";

    const skuInput = document.getElementById("editPartSkuInput");
    const nameInput = document.getElementById("editPartNameInput");
    if (skuInput) skuInput.value = "";
    if (nameInput) nameInput.value = "";
}

function saveEditPart() {
    if (!currentEditPartKey) return toast("Nie wybrano części do edycji.");

    const nameInput = document.getElementById("editPartNameInput");
    const checklist = document.getElementById("editPartSuppliersChecklist");

    const part = state.partsCatalog.get(currentEditPartKey);
    if (!part) return toast("Nie znaleziono części w bazie.");

    const newName = (nameInput?.value || "").trim();
    if (!newName) return toast("Uzupełnij pole Typ (Opis).");

    // Aktualizacja opisu
    part.name = newName;

    // Aktualizacja przypisania do dostawców
    if (checklist) {
        const checked = new Set(
            Array.from(checklist.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value)
        );

        for (const [supName, sup] of state.suppliers.entries()) {
            const has = sup.prices.has(currentEditPartKey);
            const shouldHave = checked.has(supName);

            if (shouldHave && !has) {
                // dodaj z ceną 0 jako start (użytkownik może potem edytować cennik)
                sup.prices.set(currentEditPartKey, 0);
            } else if (!shouldHave && has) {
                sup.prices.delete(currentEditPartKey);
            }
        }
    }

    save();
    refreshCatalogsUI();
    cancelEditPart();
    toast("Zapisano zmiany części.");
}

