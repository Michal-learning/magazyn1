// === INIT & BINDINGS ===
const WAREHOUSE_VIEW_KEY = "magazyn_parts_view";

// Strict integer parser for quantities
function strictParseQtyInt(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    if (!/^\d+$/.test(s)) return null;
    const n = parseInt(s, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return n;
}

function setWarehouseView(view) {
    const v = (view === "batches") ? "batches" : "compact";
    const split = document.getElementById("partsSplit");
    if (split) split.setAttribute("data-view", v);

    const bCompact = document.getElementById("partsViewCompactBtn");
    const bBatches = document.getElementById("partsViewBatchesBtn");

    if (bCompact) {
        bCompact.classList.toggle("active", v === "compact");
        bCompact.setAttribute("aria-selected", v === "compact" ? "true" : "false");
    }
    if (bBatches) {
        bBatches.classList.toggle("active", v === "batches");
        bBatches.setAttribute("aria-selected", v === "batches" ? "true" : "false");
    }

    localStorage.setItem(WAREHOUSE_VIEW_KEY, v);
    renderWarehouse();
}

function initWarehouseViewToggle() {
    const bCompact = document.getElementById("partsViewCompactBtn");
    const bBatches = document.getElementById("partsViewBatchesBtn");
    const split = document.getElementById("partsSplit");
    if (!split || (!bCompact && !bBatches)) return;

    const saved = localStorage.getItem(WAREHOUSE_VIEW_KEY);
    setWarehouseView(saved === "batches" ? "batches" : "compact");

    bCompact?.addEventListener("click", () => setWarehouseView("compact"));
    bBatches?.addEventListener("click", () => setWarehouseView("batches"));
}

// === History view + filters ===
const HISTORY_VIEW_KEY = "magazyn_history_view";

function setHistoryView(view) {
    const v = (view === "builds") ? "builds" : "deliveries";

    const bDel = document.getElementById("historyViewDeliveriesBtn");
    const bBuild = document.getElementById("historyViewBuildsBtn");

    if (bDel) {
        bDel.classList.toggle("active", v === "deliveries");
        bDel.setAttribute("aria-selected", v === "deliveries" ? "true" : "false");
    }
    if (bBuild) {
        bBuild.classList.toggle("active", v === "builds");
        bBuild.setAttribute("aria-selected", v === "builds" ? "true" : "false");
    }

    const search = document.getElementById("historySearch");
    if (search) {
        search.placeholder = (v === "deliveries")
            ? "Szukaj po Dostawcy lub Nazwie/Typie części..."
            : "Szukaj po Nazwie/Typie maszyny...";
    }

    localStorage.setItem(HISTORY_VIEW_KEY, v);

    // Close any open detail rows
    document.querySelectorAll("tr.historyDetailRow").forEach(r => { r.hidden = true; });
    document.querySelectorAll('[data-action="toggleHistory"]').forEach(b => {
        b.textContent = "Podgląd";
        b.classList.remove("primary");
        b.classList.add("secondary");
    });

    renderHistory();
}

function initHistoryViewToggle() {
    const bDel = document.getElementById("historyViewDeliveriesBtn");
    const bBuild = document.getElementById("historyViewBuildsBtn");
    if (!bDel || !bBuild) return;

    const saved = localStorage.getItem(HISTORY_VIEW_KEY);
    setHistoryView(saved === "builds" ? "builds" : "deliveries");

    bDel.addEventListener("click", () => setHistoryView("deliveries"));
    bBuild.addEventListener("click", () => setHistoryView("builds"));
}

function initHistoryFilters() {
    const search = document.getElementById("historySearch");
    const date = document.getElementById("historyDateRange");
    if (search) search.addEventListener("input", debounce(() => renderHistory(), 200));
    if (date) date.addEventListener("input", debounce(() => renderHistory(), 300));
}

function initSidePanelSignals() {
    if (window.__sidePanelSignalsBound) return;
    window.__sidePanelSignalsBound = true;

    document.addEventListener("click", (e) => {
        const row = e.target?.closest?.(".sideSignalRow");
        if (!row) return;

        const sku = row.getAttribute("data-sku");
        if (!sku) return;

        const partsTabBtn = document.querySelector('.tabBtn[data-tab-target="parts"]');
        if (partsTabBtn) partsTabBtn.click();

        setWarehouseView("compact");

        const search = document.getElementById("searchParts");
        if (search) {
            search.value = sku;
            search.dispatchEvent(new Event("input"));
            search.focus();
        }

        const partsPanel = document.querySelector('[data-tab-panel="parts"]');
        if (partsPanel?.scrollIntoView) {
            partsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });
}

function initThresholdsToggle() {
    const panel = byId("thresholdsPanel");
    const btn = byId("toggleThresholdsBtn");
    if (!panel || !btn) return;

    const saved = localStorage.getItem(THRESHOLDS_OPEN_KEY);
    const isOpen = saved === "1";

    panel.classList.toggle("collapsed", !isOpen);
    setExpanded(btn, isOpen);

    btn.addEventListener("click", () => {
        const nowOpen = panel.classList.contains("collapsed");
        panel.classList.toggle("collapsed", !nowOpen);
        localStorage.setItem(THRESHOLDS_OPEN_KEY, nowOpen ? "1" : "0");
        setExpanded(btn, nowOpen);
    });
}

// === MAIN INIT ===
function init() {
    initTheme();
    initThresholdsToggle();
    
    if (!document.querySelector(".toastHost")) {
        const h = document.createElement("div");
        h.className = "toastHost";
        document.body.appendChild(h);
    }
    
    load();
    bindTabs();
    bindSearch();
    initWarehouseViewToggle();
    initHistoryViewToggle();
    initHistoryFilters();
    initSidePanelSignals();
    initBeforeUnloadWarning();

    // History preview delegation
    document.addEventListener("click", (e) => {
        const btn = e.target?.closest?.('[data-action="toggleHistory"]');
        if (!btn) return;

        const id = btn.getAttribute("data-hid");
        const detailRow = document.querySelector(`[data-hid-detail="${id}"]`);
        if (!detailRow) return;

        const ev = (state.history || []).find(x => String(x.id) === String(id));
        if (!ev) return;

        const willOpen = detailRow.hidden;

        document.querySelectorAll("tr.historyDetailRow").forEach(r => { r.hidden = true; });
        document.querySelectorAll('[data-action="toggleHistory"]').forEach(b => {
            b.textContent = "Podgląd";
            b.classList.remove("primary");
            b.classList.add("secondary");
        });

        if (!willOpen) return;

        detailRow.hidden = false;
        const box = detailRow.querySelector(".historyDetails");
        if (box) box.innerHTML = buildHistoryDetails(ev);

        btn.textContent = "Zamknij";
        btn.classList.add("primary");
        btn.classList.remove("secondary");
        detailRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    // Build machine parts toggle
    document.addEventListener("click", (e) => {
        const btn = e.target?.closest?.('[data-action="toggleBuildMachine"]');
        if (!btn) return;

        const bmid = btn.getAttribute("data-bmid");
        if (!bmid) return;

        const scope = btn.closest(".historyDetails") || document;
        const detailRow = scope.querySelector(`[data-bmid-detail="${bmid}"]`);
        if (!detailRow) return;

        const willOpen = detailRow.hidden;

        scope.querySelectorAll("tr.buildMachineDetailRow").forEach(r => { r.hidden = true; });
        scope.querySelectorAll('[data-action="toggleBuildMachine"]').forEach(b => {
            b.textContent = "Podgląd";
            b.setAttribute("aria-expanded", "false");
        });

        if (!willOpen) return;

        detailRow.hidden = false;
        btn.textContent = "Zamknij";
        btn.setAttribute("aria-expanded", "true");
    });

    renderWarehouse();
    renderAllSuppliers();
    renderMachinesStock();
    refreshCatalogsUI();
    bindSupplierPricesUI();

    // Sync threshold UI
    const warnRange = document.getElementById("warnRange");
    const dangerRange = document.getElementById("dangerRange");
    const warnValue = document.getElementById("warnValue");
    const dangerValue = document.getElementById("dangerValue");
    
    if (warnRange) warnRange.value = String(LOW_WARN);
    if (dangerRange) dangerRange.value = String(LOW_DANGER);
    if (warnValue) warnValue.textContent = String(LOW_WARN);
    if (dangerValue) dangerValue.textContent = String(LOW_DANGER);

    warnRange?.addEventListener("input", (e) => {
        const v = parseInt(e.target.value, 10);
        LOW_WARN = Number.isFinite(v) ? Math.max(0, v) : 0;

        if (LOW_DANGER > LOW_WARN) {
            LOW_DANGER = LOW_WARN;
            if (dangerRange) dangerRange.value = String(LOW_DANGER);
            const dv = document.getElementById("dangerValue");
            if (dv) dv.textContent = String(LOW_DANGER);
        }

        const wv = document.getElementById("warnValue");
        if (wv) wv.textContent = String(LOW_WARN);
        save();
        renderWarehouse();
    });

    dangerRange?.addEventListener("input", (e) => {
        const v = parseInt(e.target.value, 10);
        LOW_DANGER = Number.isFinite(v) ? Math.max(0, v) : 0;

        if (LOW_DANGER > LOW_WARN) {
            LOW_DANGER = LOW_WARN;
            if (dangerRange) dangerRange.value = String(LOW_DANGER);
        }

        const dv = document.getElementById("dangerValue");
        if (dv) dv.textContent = String(LOW_DANGER);
        save();
        renderWarehouse();
    });

    // Part edit buttons
    document.getElementById("saveEditPartBtn")?.addEventListener("click", saveEditPart);
    document.getElementById("cancelEditPartBtn")?.addEventListener("click", cancelEditPart);

    // Initialize comboboxes
    try {
        initComboFromSelect(document.getElementById("supplierSelect"), { placeholder: "Wybierz dostawcę..." });
        initComboFromSelect(document.getElementById("supplierPartsSelect"), { placeholder: "Wybierz część..." });
        initComboFromSelect(document.getElementById("machineSelect"), { placeholder: "Wybierz maszynę..." });
        initComboFromSelect(document.getElementById("supplierEditorPartSelect"), { placeholder: "Wybierz część..." });
        initComboFromSelect(document.getElementById("bomSkuSelect"), { placeholder: "Wybierz część..." });

        const supSel = document.getElementById("supplierSelect");
        const partSel = document.getElementById("supplierPartsSelect");
        if (partSel) {
            partSel.disabled = !supSel?.value;
            refreshComboFromSelect(partSel, { placeholder: "Wybierz część..." });
        }
    } catch (e) {
        console.warn("Combobox init warning:", e);
    }
    
    // Set default dates
    const today = new Date().toISOString().slice(0, 10);
    const deliveryDate = document.getElementById("deliveryDate");
    const buildDate = document.getElementById("buildDate");
    if (deliveryDate && !deliveryDate.value) deliveryDate.value = today;
    if (buildDate && !buildDate.value) buildDate.value = today;
}

// === Unsaved changes warning ===
function initBeforeUnloadWarning() {
    window.addEventListener("beforeunload", (e) => {
        if (typeof unsavedChanges !== "undefined" && unsavedChanges.hasAny()) {
            const msg = unsavedChanges.getMessage();
            e.preventDefault();
            e.returnValue = msg;
            return msg;
        }
    });
}

// === EVENT BINDINGS ===

// Delivery events
document.getElementById("supplierSelect")?.addEventListener("change", (e) => {
    if (state.currentDelivery.items.length > 0 && state.currentDelivery.supplier && state.currentDelivery.supplier !== e.target.value) {
        if (!confirm("Zmiana dostawcy spowoduje usunięcie bieżących pozycji dostawy. Kontynuować?")) {
            e.target.value = state.currentDelivery.supplier || "";
            return;
        }
        state.currentDelivery.items = [];
        state.currentDelivery.supplier = e.target.value;
        renderDelivery();
    }
    
    const supName = e.target.value;
    const skuSelect = document.getElementById("supplierPartsSelect");
    if (skuSelect) skuSelect.disabled = !supName;

    if (!supName) {
        skuSelect.innerHTML = '<option value="">-- Wybierz część --</option>';
        const priceEl = document.getElementById("deliveryPrice");
        if (priceEl) priceEl.value = 0;  // FIXED (B8)
        try { refreshComboFromSelect(skuSelect, { placeholder: "Wybierz część..." }); } catch {}
        return;
    }

    const sup = state.suppliers.get(supName);
    const skuListRaw = (sup && sup.prices && sup.prices.size)
        ? Array.from(sup.prices.keys())
        : Array.from(state.partsCatalog.keys());

    const skuList = skuListRaw.filter(k => state.partsCatalog.has(k));
    
    skuSelect.innerHTML =
        '<option value="">-- Wybierz część --</option>' +
        skuList.map(k => {
            const p = state.partsCatalog.get(k);
            const price = (sup && sup.prices) ? (sup.prices.get(k) ?? 0) : 0;
            return `<option value="${k}" data-price="${price}">
                ${p ? p.sku : k} - ${p ? p.name : ""} (${fmtPLN.format(price)})
            </option>`;
        }).join("");

    // FIXED (B8): Reset price when supplier changes
    const priceEl = document.getElementById("deliveryPrice");
    if (priceEl) priceEl.value = 0;

    skuSelect.dispatchEvent(new Event("change"));
    try { refreshComboFromSelect(skuSelect, { placeholder: "Wybierz część..." }); } catch {}
});

document.getElementById("supplierPartsSelect")?.addEventListener("change", (e) => {
    const opt = e.target.selectedOptions?.[0];
    if (!opt || !opt.value) {
        const priceEl = document.getElementById("deliveryPrice");
        if (priceEl) priceEl.value = 0;
        return;
    }
    const priceEl = document.getElementById("deliveryPrice");
    if (priceEl) priceEl.value = opt.dataset.price ?? 0;
});

document.getElementById("addDeliveryItemBtn")?.addEventListener("click", () => {
    const btn = document.getElementById("addDeliveryItemBtn");
    if (btn?.dataset.busy === "1") return;

    const sup = document.getElementById("supplierSelect")?.value;
    if (!sup) return toast("Brak dostawcy", "Wybierz dostawcę z listy.", "warn");
    
    const skuKeyVal = document.getElementById("supplierPartsSelect")?.value;
    if (!skuKeyVal) return toast("Brak części", "Wybierz część z listy.", "warn");
    
    const qtyEl = document.getElementById("deliveryQty");
    const priceEl = document.getElementById("deliveryPrice");

    const qtyRaw = qtyEl?.value ?? "";
    const priceRaw = priceEl?.value ?? "";

    const qtyNum = strictParseQtyInt(qtyRaw);
    if (qtyNum === null) {
        toast("Nieprawidłowa ilość", "Ilość musi być liczbą całkowitą większą lub równą 1.", "warn");
        qtyEl?.focus();
        return;
    }

    const priceNum = safeFloat(priceRaw);
    if (priceNum < 0) {
        toast("Nieprawidłowa cena", "Cena nie może być ujemna.", "warn");
        priceEl?.focus();
        return;
    }
    
    const part = state.partsCatalog.get(skuKeyVal);
    if (!part) {
        toast("Błąd części", "Wybrana część nie istnieje w bazie. Odśwież stronę i spróbuj ponownie.", "bad");
        return;
    }

    if (btn) btn.dataset.busy = "1";
    try {
        addToDelivery(sup, part.sku, qtyNum, priceNum);
        // Clear inputs after successful add
        if (qtyEl) qtyEl.value = "";
        toast("Dodano pozycję", `${part.sku} - ${qtyNum} szt.`, "ok");
    } finally {
        setTimeout(() => { if (btn) btn.dataset.busy = "0"; }, 250);
    }
});

document.getElementById("finalizeDeliveryBtn")?.addEventListener("click", () => {
    try { finalizeDelivery(); }
    catch (e) { 
        console.error(e); 
        toast("Błąd systemu", "Nie udało się zatwierdzić dostawy. Sprawdź konsolę (F12) po szczegóły.", "bad"); 
    }
});

window.removeDeliveryItem = (id) => {
    const item = state.currentDelivery.items.find(x => x.id === id);
    if (!item) return;
    if (!confirm(`Czy na pewno usunąć pozycję "${item.sku}" (${item.qty} szt.) z dostawy?`)) return;  // FIXED (B4)
    state.currentDelivery.items = state.currentDelivery.items.filter(x => x.id !== id);
    save();
    renderDelivery();
};

// Build events
document.getElementById("addBuildItemBtn")?.addEventListener("click", () => {
    const btn = document.getElementById("addBuildItemBtn");
    if (btn?.dataset.busy === "1") return;

    const code = document.getElementById("machineSelect")?.value;
    if (!code) {
        toast("Brak maszyny", "Wybierz maszynę z listy.", "warn");
        return;
    }

    const qtyEl = document.getElementById("buildQty");
    const qtyRaw = qtyEl?.value ?? "";
    const qtyNum = strictParseQtyInt(qtyRaw);
    if (qtyNum === null) {
        toast("Nieprawidłowa ilość", "Ilość sztuk musi być liczbą całkowitą większą lub równą 1.", "warn");
        qtyEl?.focus();
        return;
    }

    if (btn) btn.dataset.busy = "1";
    
    state.currentBuild.items.push({ id: nextId(), machineCode: code, qty: qtyNum });
    save();
    renderBuild();

    // Clear input after successful add
    if (qtyEl) qtyEl.value = "";
    const machine = state.machineCatalog.find(m => m.code === code);
    toast("Dodano do produkcji", `${machine?.name || code} - ${qtyNum} szt.`, "ok");

    setTimeout(() => { if (btn) btn.dataset.busy = "0"; }, 250);
});

window.removeBuildItem = (id) => {
    const item = state.currentBuild.items.find(x => x.id === id);
    if (!item) return;
    const machine = state.machineCatalog.find(m => m.code === item.machineCode);
    const name = machine ? machine.name : item.machineCode;
    if (!confirm(`Czy na pewno usunąć "${name}" (${item.qty} szt.) z produkcji?`)) return;  // FIXED (B4)
    state.currentBuild.items = state.currentBuild.items.filter(x => x.id !== id);
    save();
    renderBuild();
};

document.getElementById("finalizeBuildBtn")?.addEventListener("click", () => {
    try {
        const mode = document.getElementById("consumeMode")?.value;
        if (mode === 'manual') {
            const inputs = document.querySelectorAll(".manual-lot-input");
            const manualAlloc = {};
            let error = false;
    
            const req = calculateBuildRequirements();
            const currentSum = new Map();
    
            inputs.forEach(inp => {
                const val = safeQtyInt(inp.value);
                if (val > 0) {
                    manualAlloc[inp.dataset.lotId] = val;
                    const k = inp.dataset.sku;
                    currentSum.set(k, (currentSum.get(k) || 0) + val);
                }
            });

            req.forEach((needed, k) => {
                if ((currentSum.get(k) || 0) !== needed) {
                    const part = state.partsCatalog.get(k);
                    toast("Niekompletna alokacja", 
                        `Dla części ${part?.sku || k} ${part?.name ? `(${part.name}) ` : ""}wybrano ${currentSum.get(k) || 0}, a potrzeba ${needed}.`, 
                        "bad");
                    error = true;
                }
            });

            if (!error) finalizeBuild(manualAlloc);
        } else {
            finalizeBuild(null);
        }
    } catch (e) {
        console.error(e);
        toast("Błąd systemu", "Nie udało się finalizować produkcji. Sprawdź konsolę (F12) po szczegóły.", "bad");
    }
});

document.getElementById("consumeMode")?.addEventListener("change", (e) => {
    if (e.target.value === 'manual') {
        // FIXED (B7): Hide missingBox when switching to manual
        const els = getEls();
        if (els.missingBox) els.missingBox.hidden = true;
        renderManualConsume();
    } else {
        const els = getEls();
        if (els.manualBox) els.manualBox.hidden = true;
        if (els.missingBox) els.missingBox.hidden = true;
    }
});

// Catalog events
document.getElementById("addPartBtn")?.addEventListener("click", () => {
    const sku = document.getElementById("partSkuInput")?.value ?? "";
    const name = document.getElementById("partNameInput")?.value ?? "";

    const box = document.getElementById("partNewSuppliersChecklist");
    const selectedSups = (typeof comboMultiGetSelected === "function") ? comboMultiGetSelected(box) : [];

    const res = upsertPart(sku, name, selectedSups);
    toast(res.success ? "Zapisano" : "Błąd walidacji", res.msg, res.success ? "ok" : "warn");

    if (res.success) {
        const k = skuKey(sku);
        const panel = document.getElementById("newPartSupplierPrices");
        const inputs = panel?.querySelectorAll('input[data-sup]') || [];
        inputs.forEach(inp => {
            const sup = inp.getAttribute("data-sup");
            if (sup) updateSupplierPrice(sup, sku, inp.value);
        });

        const skuEl = document.getElementById("partSkuInput");
        const nameEl = document.getElementById("partNameInput");
        if (skuEl) skuEl.value = "";
        if (nameEl) nameEl.value = "";

        if (typeof comboMultiClear === "function") comboMultiClear(box);

        refreshCatalogsUI();
        syncNewPartSupplierPricesUI();
    }
});

window.askDeletePart = (sku) => {
    if (confirm(`Czy na pewno usunąć część "${sku}"?\n\nTej operacji nie można cofnąć.`)) {
        const err = deletePart(sku);
        if (err) toast("Nie można usunąć", err, "bad");
        else { toast("Usunięto", `Część "${sku}" została usunięta z bazy.`, "ok"); refreshCatalogsUI(); }
    }
};

document.getElementById("addSupplierBtn")?.addEventListener("click", () => {
    const name = document.getElementById("supplierNameInput")?.value ?? "";
    const added = addSupplier(name);
    if (added) {
        document.getElementById("supplierNameInput").value = "";
    }
});

window.askDeleteSupplier = (n) => { 
    if (confirm(`Czy na pewno usunąć dostawcę "${n}"?\n\nTej operacji nie można cofnąć.`)) deleteSupplier(n); 
};

// === EDITORS ===
let editingSup = null;
let editingMachine = null;
let editingMachineIsNew = false;

document.getElementById("addMachineBtn")?.addEventListener("click", () => {
    const c = normalize(document.getElementById("machineCodeInput")?.value ?? "");
    const n = normalize(document.getElementById("machineNameInput")?.value ?? "");

    if (!c || !n) {
        toast("Brak danych", "Podaj kod i nazwę maszyny.", "warn");
        return;
    }
    
    // Validate code format
    if (!/^[a-zA-Z0-9_-]+$/.test(c)) {
        toast("Nieprawidłowy kod", "Kod maszyny może zawierać tylko litery, cyfry, myślniki i podkreślenia (bez spacji).", "warn");
        return;
    }
    
    if (state.machineCatalog.some(m => m.code === c)) {
        toast("Kod zajęty", `Maszyna o kodzie "${c}" już istnieje w bazie.`, "warn");
        return;
    }

    editingMachineIsNew = true;
    editingMachine = { code: c, name: n, bom: [] };
    unsavedChanges.mark("machineEditor");
    openMachineEditor("__NEW__");
});

window.askDeleteMachine = (code) => {
    const machine = state.machineCatalog.find(m => m.code === code);
    const name = machine?.name || code;
    if (confirm(`Czy na pewno usunąć maszynę "${name}" (${code})?\n\nTej operacji nie można cofnąć.`)) {
        state.machineCatalog = state.machineCatalog.filter(m => m.code !== code);
        save();
        refreshCatalogsUI();
        toast("Usunięto maszynę", `"${name}" została usunięta.`, "ok");
    }
};

window.openSupplierEditor = (name) => {
    editingSup = name;
    unsavedChanges.mark("supplierEditor");
    const panel = document.getElementById("supplierEditorTemplate");
    const nameEl = document.getElementById("supplierEditorName");
    if (nameEl) nameEl.textContent = name;
    
    const sel = document.getElementById("supplierEditorPartSelect");
    if (sel) {
        sel.innerHTML = '<option value="">-- Wybierz --</option>' + 
            Array.from(state.partsCatalog.values()).map(p =>
                `<option value="${p.sku}">${p.sku} (${p.name})</option>`
            ).join("");
        try { refreshComboFromSelect(sel, { placeholder: "Wybierz część..." }); } catch {}
    }
    
    renderSupEditorTable();
    if (panel) {
        panel.hidden = false;
        panel.scrollIntoView({ behavior: "smooth" });
    }
};

function renderSupEditorTable() {
    const tbody = byId("supplierEditorPriceBody");
    const sup = editingSup ? state.suppliers.get(editingSup) : null;
    if (!tbody || !sup || !sup.prices) return;
    
    tbody.innerHTML = Array.from(sup.prices.entries()).map(([k, price]) => {
        const p = state.partsCatalog.get(k);
        return `<tr><td>${p ? p.sku : k}</td><td>${p ? p.name : '-'}</td><td>${fmtPLN.format(price)}</td></tr>`;
    }).join("");
}

document.getElementById("supplierEditorSetPriceBtn")?.addEventListener("click", () => {
    const sku = document.getElementById("supplierEditorPartSelect")?.value;
    const price = document.getElementById("supplierEditorPriceInput")?.value;
    if (!sku) {
        toast("Brak części", "Wybierz część z listy.", "warn");
        return;
    }
    updateSupplierPrice(editingSup, sku, price);
    renderSupEditorTable();
    toast("Zapisano cenę", `Cena dla wybranej części została zaktualizowana.`, "ok");
});

document.getElementById("supplierEditorSaveBtn")?.addEventListener("click", () => {
    const panel = document.getElementById("supplierEditorTemplate");
    if (panel) panel.hidden = true;
    editingSup = null;
    unsavedChanges.clear("supplierEditor");
    renderAllSuppliers();
    refreshCatalogsUI();
    toast("Zapisano zmiany", "Cennik dostawcy został zaktualizowany.", "ok");
});

document.getElementById("supplierEditorCancelBtn")?.addEventListener("click", () => {
    const panel = document.getElementById("supplierEditorTemplate");
    if (panel) panel.hidden = true;
    editingSup = null;
    unsavedChanges.clear("supplierEditor");
    load(); // Reload to discard changes
});

window.openMachineEditor = (code) => {
    if (code !== "__NEW__") {
        editingMachineIsNew = false;
        editingMachine = state.machineCatalog.find(m => m.code === code);
        if (!editingMachine) return;
    } else {
        if (!editingMachine) return;
    }
    
    const panel = document.getElementById("machineEditorTemplate");
    const nameEl = document.getElementById("machineEditorName");
    const codeEl = document.getElementById("machineEditorCode");
    
    if (nameEl) nameEl.textContent = editingMachine.name;
    if (codeEl) codeEl.textContent = editingMachine.code;
    
    const sel = document.getElementById("bomSkuSelect");
    if (sel) {
        sel.innerHTML = '<option value="">-- Wybierz --</option>' + 
            Array.from(state.partsCatalog.values()).map(p =>
                `<option value="${p.sku}">${p.sku} (${p.name})</option>`
            ).join("");
        try { refreshComboFromSelect(sel, { placeholder: "Wybierz część..." }); } catch {}
    }

    renderBomTable();
    if (panel) {
        panel.hidden = false;
        panel.scrollIntoView({ behavior: "smooth" });
    }
};

function renderBomTable() {
    const tbody = document.querySelector("#bomTable tbody");
    if (!tbody || !editingMachine || !Array.isArray(editingMachine.bom)) return;
    
    tbody.innerHTML = editingMachine.bom.map((b, idx) => {
        const p = state.partsCatalog.get(skuKey(b.sku));
        return `<tr>
            <td><span class="badge">${escapeHtml(b.sku)}</span></td>
            <td>${p ? p.name : "???"}</td>
            <td class="right">${b.qty}</td>
            <td class="right"><button class="iconBtn" onclick="removeBomItem(${idx})">Usuń</button></td>
        </tr>`;
    }).join("");

    const saveBtn = document.getElementById("machineEditorSaveBtn");
    if (saveBtn) saveBtn.disabled = !editingMachine.bom.length;
}

document.getElementById("addBomItemBtn")?.addEventListener("click", () => {
    const sku = document.getElementById("bomSkuSelect")?.value;
    if (!sku) {
        toast("Brak części", "Wybierz część do składu.", "warn");
        return;
    }
    const qty = safeInt(document.getElementById("bomQtyInput")?.value);
    
    const existing = editingMachine?.bom?.find(b => skuKey(b.sku) === skuKey(sku));
    if (existing) {
        existing.qty = qty;
        toast("Zaktualizowano", `Ilość części ${sku} w BOM została zmieniona na ${qty}.`, "ok");
    } else {
        editingMachine.bom.push({ sku, qty });
        toast("Dodano do BOM", `Część ${sku} została dodana do składu maszyny.`, "ok");
    }
    
    unsavedChanges.mark("machineEditor");
    renderBomTable();
});

window.removeBomItem = (idx) => {
    editingMachine?.bom?.splice(idx, 1);
    unsavedChanges.mark("machineEditor");
    renderBomTable();
};

document.getElementById("machineEditorSaveBtn")?.addEventListener("click", () => {
    if (!editingMachine) return;
    if (!Array.isArray(editingMachine.bom) || editingMachine.bom.length === 0) {
        toast("Pusty BOM", "Nie można zapisać maszyny bez składników. Dodaj przynajmniej jedną część.", "warn");
        return;
    }

    if (editingMachineIsNew) {
        state.machineCatalog.push({
            code: editingMachine.code,
            name: editingMachine.name,
            bom: editingMachine.bom.map(b => ({ sku: b.sku, qty: safeInt(b.qty) }))
        });
        
        const codeIn = document.getElementById("machineCodeInput");
        const nameIn = document.getElementById("machineNameInput");
        if (codeIn) codeIn.value = "";
        if (nameIn) nameIn.value = "";
        editingMachineIsNew = false;
        toast("Dodano maszynę", `"${editingMachine.name}" została dodana do katalogu.`, "ok");
    } else {
        // Update existing machine
        const idx = state.machineCatalog.findIndex(m => m.code === editingMachine.code);
        if (idx >= 0) {
            state.machineCatalog[idx] = {
                code: editingMachine.code,
                name: editingMachine.name,
                bom: editingMachine.bom.map(b => ({ sku: b.sku, qty: safeInt(b.qty) }))
            };
        }
        toast("Zapisano zmiany", `BOM maszyny "${editingMachine.name}" został zaktualizowany.`, "ok");
    }

    unsavedChanges.clear("machineEditor");
    save();
    const panel = document.getElementById("machineEditorTemplate");
    if (panel) panel.hidden = true;
    editingMachine = null;
    refreshCatalogsUI();
});

document.getElementById("machineEditorCancelBtn")?.addEventListener("click", () => {
    if (unsavedChanges.machineEditor) {
        if (!confirm("Masz niezapisane zmiany w BOM. Czy na pewno chcesz anulować?")) {
            return;
        }
    }
    
    const panel = document.getElementById("machineEditorTemplate");
    if (panel) panel.hidden = true;
    
    if (editingMachineIsNew) {
        editingMachineIsNew = false;
        editingMachine = null;
        unsavedChanges.clear("machineEditor");
        return;
    }
    
    load();
    editingMachine = null;
    unsavedChanges.clear("machineEditor");
});

// === COMMON BINDINGS ===
function bindTabs() {
    const btns = document.querySelectorAll(".tabBtn");
    btns.forEach(btn => {
        btn.addEventListener("click", () => {
            // Check for unsaved changes
            if (editingMachine && unsavedChanges.machineEditor) {
                if (!confirm("Masz niezapisane zmiany w edytorze maszyny. Czy na pewno chcesz przejść do innej zakładki?")) {
                    return;
                }
            }
            if (editingSup && unsavedChanges.supplierEditor) {
                if (!confirm("Masz niezapisane zmiany w edytorze dostawcy. Czy na pewno chcesz przejść do innej zakładki?")) {
                    return;
                }
            }
            
            if (editingMachine) {
                document.getElementById("machineEditorCancelBtn")?.click();
                editingMachine = null;
            }
            
            const supPanel = byId("supplierEditorTemplate");
            if (supPanel && !supPanel.hidden) {
                document.getElementById("supplierEditorCancelBtn")?.click();
                editingSup = null;
            }
            
            const partEditSection = document.getElementById("partEditSection");
            if (partEditSection && !partEditSection.hidden) {
                document.getElementById("cancelEditPartBtn")?.click();
            }
            
            btns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".tabPanel").forEach(p => p.hidden = true);
            
            const target = document.querySelector(`[data-tab-panel="${btn.dataset.tabTarget}"]`);
            if (target) target.hidden = false;
            
            if (btn.dataset.tabTarget === "history") { renderHistory(); }
        });
    });
}

function bindSearch() {
    // Debounced search for better performance
    document.getElementById("searchParts")?.addEventListener("input", debounce(renderWarehouse, 200));
    document.getElementById("searchMachines")?.addEventListener("input", debounce(renderMachinesStock, 200));
}

// === PART EDIT FUNCTIONS ===
function buildEditPartSuppliersChecklist(partKey) {
    const box = document.getElementById("editPartSuppliersChecklist");
    if (!box) return;

    const allSups = Array.from(state.suppliers.keys()).sort();
    if (!allSups.length) {
        box.innerHTML = '<span class="small muted">Brak zdefiniowanych dostawców.</span>';
        return;
    }

    const selected = allSups.filter(name => {
        const sup = state.suppliers.get(name);
        return !!(sup && sup.prices && sup.prices.has(partKey));
    });

    if (typeof comboMultiRender === "function") {
        comboMultiRender(box, {
            options: allSups,
            selected,
            placeholder: "Wybierz dostawców..."
        });
    }
}

window.startEditPart = (sku) => {
    const section = document.getElementById("partEditSection");
    const title = document.getElementById("partEditTitle");
    const skuInput = document.getElementById("editPartSkuInput");
    const nameInput = document.getElementById("editPartNameInput");

    if (!section || !title || !skuInput || !nameInput) {
        return toast("Błąd UI", "Brakuje elementów interfejsu do edycji części.");
    }

    const key = skuKey(sku);
    const part = state.partsCatalog.get(key);
    if (!part) return toast("Nie znaleziono", "Część nie istnieje w bazie.");

    currentEditPartKey = key;
    unsavedChanges.mark("partEditor");

    title.textContent = `Edycja: ${part.sku}`;
    skuInput.value = part.sku;
    nameInput.value = part.name || "";

    buildEditPartSuppliersChecklist(key);
    syncEditPartSupplierPricesUI();

    section.hidden = false;
    section.classList.add("collapsed");
    requestAnimationFrame(() => {
        section.classList.remove("collapsed");
        setTimeout(() => section.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    });
};

window.cancelEditPart = () => {
    if (unsavedChanges.partEditor) {
        if (!confirm("Masz niezapisane zmiany. Czy na pewno chcesz anulować?")) {
            return;
        }
    }
    
    const section = document.getElementById("partEditSection");
    if (section) {
        section.classList.add("collapsed");
        const onEnd = () => { section.hidden = true; };
        section.addEventListener("transitionend", onEnd, { once: true });
    }

    currentEditPartKey = null;
    unsavedChanges.clear("partEditor");

    const pricePanel = document.getElementById("editPartSupplierPrices");
    if (pricePanel) { 
        pricePanel.hidden = true; 
        const body = pricePanel.querySelector(".supplierPriceBody"); 
        if (body) body.innerHTML = ""; 
    }

    const title = document.getElementById("partEditTitle");
    if (title) title.textContent = "Edycja Części";

    const skuInput = document.getElementById("editPartSkuInput");
    const nameInput = document.getElementById("editPartNameInput");
    if (skuInput) skuInput.value = "";
    if (nameInput) nameInput.value = "";
};

window.saveEditPart = () => {
    if (!currentEditPartKey) return toast("Błąd", "Nie wybrano części do edycji.");

    const nameInput = document.getElementById("editPartNameInput");
    const checklist = document.getElementById("editPartSuppliersChecklist");

    const part = state.partsCatalog.get(currentEditPartKey);
    if (!part) return toast("Błąd", "Część nie istnieje w bazie.");

    const newName = (nameInput?.value ?? "").trim();
    if (!newName) return toast("Brak nazwy", "Uzupełnij pole Typ (Opis).");
    
    if (newName.length > 200) {
        return toast("Za długa nazwa", "Typ nie może przekraczać 200 znaków.");
    }

    part.name = newName;

    if (checklist) {
        const checkedArr = (typeof comboMultiGetSelected === "function") ? comboMultiGetSelected(checklist) : [];
        const checked = new Set(checkedArr);

        for (const [supName, sup] of state.suppliers.entries()) {
            const has = sup.prices.has(currentEditPartKey);
            const shouldHave = checked.has(supName);

            if (shouldHave && !has) {
                sup.prices.set(currentEditPartKey, 0);
            } else if (!shouldHave && has) {
                sup.prices.delete(currentEditPartKey);
            }
        }
    }

    const pricePanel = document.getElementById("editPartSupplierPrices");
    if (pricePanel && !pricePanel.hidden) {
        const inputs = pricePanel.querySelectorAll('input[data-sup]');
        inputs.forEach(inp => {
            const supName = inp.getAttribute("data-sup");
            if (supName) updateSupplierPrice(supName, part.sku, inp.value);
        });
    }

    unsavedChanges.clear("partEditor");
    save();
    refreshCatalogsUI();
    cancelEditPart();
    toast("Zapisano", `Zmiany części "${part.sku}" zostały zapisane.`, "ok");
};

// === SUPPLIER PRICES UI ===
function bindSupplierPricesUI() {
    if (window.__supplierPricesBound) return;
    window.__supplierPricesBound = true;

    const newBox = document.getElementById("partNewSuppliersChecklist");
    newBox?.addEventListener("change", () => syncNewPartSupplierPricesUI());

    document.getElementById("partSkuInput")?.addEventListener("input", () => {
        syncNewPartSupplierPricesUI();
    });

    const editBox = document.getElementById("editPartSuppliersChecklist");
    editBox?.addEventListener("change", () => syncEditPartSupplierPricesUI());
}

function renderSupplierPricesPanel(panelEl, selectedSuppliers, partKey, opts = {}) {
    if (!panelEl) return;
    const body = panelEl.querySelector(".supplierPriceBody");
    if (!body) return;

    const skuEmpty = !!opts.skuEmpty;
    const disableInputs = !!opts.disableInputs;

    if (!selectedSuppliers || selectedSuppliers.length === 0) {
        panelEl.hidden = true;
        body.innerHTML = "";
        return;
    }

    panelEl.hidden = false;

    if (skuEmpty || !partKey) {
        body.innerHTML = `<div class="supplierPriceHint">Wpisz najpierw <strong>Nazwa (Unikalne ID)</strong>, żeby przypisać ceny do dostawców.</div>`;
        return;
    }

    body.innerHTML = selectedSuppliers.map(supName => {
        const sup = state.suppliers.get(supName);
        const current = sup && sup.prices ? (sup.prices.get(partKey) ?? 0) : 0;

        return `
            <div class="supplierPriceRow">
                <div class="supplierName">
                    <span class="supplierLabel">${escapeHtml(supName)}</span>
                    <span class="supplierMeta">aktualnie: ${fmtPLN.format(safeFloat(current))}</span>
                </div>
                <input type="number" min="0" step="0.01"
                    ${disableInputs ? "disabled" : ""}
                    data-sup="${escapeHtml(supName)}"
                    value="${safeFloat(current)}"
                    aria-label="Cena dla dostawcy ${escapeHtml(supName)}">
            </div>
        `;
    }).join("");
}

function syncNewPartSupplierPricesUI() {
    const skuEl = document.getElementById("partSkuInput");
    const skuVal = skuEl ? skuEl.value : "";
    const key = skuKey(skuVal);

    const box = document.getElementById("partNewSuppliersChecklist");
    const selected = (typeof comboMultiGetSelected === "function") ? comboMultiGetSelected(box) : [];
    const panel = document.getElementById("newPartSupplierPrices");

    renderSupplierPricesPanel(panel, selected, key, {
        skuEmpty: !normalize(skuVal),
        disableInputs: false
    });
}

function syncEditPartSupplierPricesUI() {
    const panel = document.getElementById("editPartSupplierPrices");
    const key = currentEditPartKey;

    const checklist = document.getElementById("editPartSuppliersChecklist");
    const selected = (typeof comboMultiGetSelected === "function") ? comboMultiGetSelected(checklist) : [];

    renderSupplierPricesPanel(panel, selected, key, { skuEmpty: false, disableInputs: false });
}

// === RESET BUTTONS ===
document.getElementById("clearDataBtn")?.addEventListener("click", () => {
    if (confirm("UWAGA!\n\nCzy na pewno chcesz usunąć WSZYSTKIE dane?\n\nTej operacji NIE MOŻNA COFNĄĆ.\n\nZalecane jest najpierw wykonanie kopii zapasowej (eksport danych).")) {
        resetData();
    }
});

document.getElementById("clearDataBtnHistory")?.addEventListener("click", () => {
    if (confirm("UWAGA!\n\nCzy na pewno chcesz usunąć WSZYSTKIE dane?\n\nTej operacji NIE MOŻNA COFNĄĆ.")) {
        resetData();
    }
});

// === STARTUP ===
try { 
    init(); 
} catch (e) { 
    console.error(e); 
    toast("Błąd inicjalizacji", "Aplikacja nie mogła się poprawnie uruchomić. Sprawdź konsolę (F12) po szczegóły.", "bad"); 
}
