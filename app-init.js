// === INIT & BINDINGS ===

// Strict integer parser for quantities
function strictParseQtyInt(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

// === History view + filters ===
const HISTORY_VIEW_KEY = "magazyn_history_view_v3";

function setHistoryView(view) {
  const v = (view === "builds" || view === "adjustments") ? view : "deliveries";

  const bDel = document.getElementById("historyViewDeliveriesBtn");
  const bBuild = document.getElementById("historyViewBuildsBtn");
  const bAdj = document.getElementById("historyViewAdjustmentsBtn");

  if (bDel) {
    bDel.classList.toggle("active", v === "deliveries");
    bDel.setAttribute("aria-selected", v === "deliveries" ? "true" : "false");
  }
  if (bBuild) {
    bBuild.classList.toggle("active", v === "builds");
    bBuild.setAttribute("aria-selected", v === "builds" ? "true" : "false");
  }
  if (bAdj) {
    bAdj.classList.toggle("active", v === "adjustments");
    bAdj.setAttribute("aria-selected", v === "adjustments" ? "true" : "false");
  }

  const search = document.getElementById("historySearch");
  if (search) {
    search.placeholder = (v === "deliveries")
      ? "Szukaj po Dostawcy lub Nazwie/Typie części..."
      : (v === "builds")
        ? "Szukaj po Nazwie/Typie maszyny..."
        : "Szukaj po Nazwie (ID) lub Typie części...";
  }

  localStorage.setItem(HISTORY_VIEW_KEY, v);
  renderHistory();
}

function initHistoryViewToggle() {
  const bDel = document.getElementById("historyViewDeliveriesBtn");
  const bBuild = document.getElementById("historyViewBuildsBtn");
  const bAdj = document.getElementById("historyViewAdjustmentsBtn");
  if (!bDel || !bBuild || !bAdj) return;

  const saved = localStorage.getItem(HISTORY_VIEW_KEY);
  setHistoryView(saved === "builds" || saved === "adjustments" ? saved : "deliveries");

  bDel.addEventListener("click", () => setHistoryView("deliveries"));
  bBuild.addEventListener("click", () => setHistoryView("builds"));
  bAdj.addEventListener("click", () => setHistoryView("adjustments"));
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
    const row = e.target?.closest?.(".signal-row");
    if (!row) return;

    const sku = row.getAttribute("data-sku");
    if (!sku) return;

    const partsTabBtn = document.querySelector('.tab-btn[data-tab-target="parts"]');
    if (partsTabBtn) partsTabBtn.click();

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

function initStockEditMode() {
  document.getElementById("stockEditToggleBtn")?.addEventListener("click", () => {
    beginStockEditMode();
  });

  document.getElementById("stockEditCancelBtn")?.addEventListener("click", () => {
    cancelStockEditMode();
  });

  document.getElementById("stockEditSaveBtn")?.addEventListener("click", () => {
    commitStockAdjustments();
  });

  document.addEventListener("change", (e) => {
    const input = e.target?.closest?.(".stock-edit-input");
    if (!input) return;
    const sku = input.getAttribute("data-sku");
    if (!sku) return;
    updatePendingStockAdjustment(sku, input.value);
  });

  document.addEventListener("keydown", (e) => {
    const input = e.target?.closest?.(".stock-edit-input");
    if (!input) return;
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
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

let partEditorIsNew = true;

function syncPartEditorModal() {
  const titleEl = document.getElementById("partEditorModalTitle");
  const hintEl = document.getElementById("partEditorModalHint");
  const skuInput = document.getElementById("partSkuInput");
  const createBtn = document.getElementById("addPartBtn");
  const saveBtn = document.getElementById("saveEditPartBtn");
  const cancelNewBtn = document.getElementById("cancelNewPartBtn");
  const cancelEditBtn = document.getElementById("cancelEditPartBtn");
  const newPrices = document.getElementById("newPartSupplierPrices");
  const editPrices = document.getElementById("editPartSupplierPrices");
  const newChecklist = document.getElementById("partNewSuppliersChecklist");
  const editChecklist = document.getElementById("editPartSuppliersChecklist");

  if (titleEl) titleEl.textContent = partEditorIsNew ? "Nowa część" : "Edycja części";
  if (hintEl) hintEl.textContent = partEditorIsNew
    ? "Dodaj część do bazy i przypisz ją do dostawców."
    : "Edytuj część i jej przypisania do dostawców w jednym miejscu.";

  if (skuInput) skuInput.readOnly = !partEditorIsNew;
  createBtn?.classList.toggle("hidden", !partEditorIsNew);
  saveBtn?.classList.toggle("hidden", partEditorIsNew);
  cancelNewBtn?.classList.toggle("hidden", !partEditorIsNew);
  cancelEditBtn?.classList.toggle("hidden", partEditorIsNew);
  if (newChecklist) {
    newChecklist.classList.toggle("hidden", !partEditorIsNew);
    newChecklist.setAttribute("aria-hidden", partEditorIsNew ? "false" : "true");
  }
  if (editChecklist) {
    editChecklist.classList.toggle("hidden", partEditorIsNew);
    editChecklist.setAttribute("aria-hidden", partEditorIsNew ? "true" : "false");
  }
  if (newPrices && partEditorIsNew && typeof syncNewPartSupplierPricesUI === "function") syncNewPartSupplierPricesUI();
  if (editPrices && !partEditorIsNew && typeof syncEditPartSupplierPricesUI === "function") syncEditPartSupplierPricesUI();
}

function openPartEditorModal() {
  const backdrop = document.getElementById("partEditorBackdrop");
  const panel = document.getElementById("partEditorTemplate");
  if (!backdrop || !panel) return;
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  panel.classList.remove("hidden");
  document.body.classList.add("part-editor-open");
}

function closePartEditorModal() {
  const backdrop = document.getElementById("partEditorBackdrop");
  const panel = document.getElementById("partEditorTemplate");
  backdrop?.classList.add("hidden");
  backdrop?.setAttribute("aria-hidden", "true");
  panel?.classList.add("hidden");
  document.body.classList.remove("part-editor-open");
}

function openNewPartPanel() {
  partEditorIsNew = true;
  currentEditPartKey = null;
  unsavedChanges.clear("partEditor");

  const skuEl = document.getElementById("partSkuInput");
  const nameEl = document.getElementById("partNameInput");
  if (skuEl) skuEl.value = "";
  if (nameEl) nameEl.value = "";
  fillPartThresholdForm(null);

  const box = document.getElementById("partNewSuppliersChecklist");
  if (typeof comboMultiClear === "function") comboMultiClear(box);

  const newBody = document.getElementById("newPartSupplierPricesBody");
  if (newBody) newBody.innerHTML = "";
  document.getElementById("newPartSupplierPrices")?.classList.add("hidden");
  document.getElementById("editPartSupplierPrices")?.classList.add("hidden");

  syncPartEditorModal();
  openPartEditorModal();
  document.getElementById("partSkuInput")?.focus?.();
}

function closeNewPartPanel(opts = {}) {
  const clear = !!opts.clear;

  if (clear) {
    const skuEl = document.getElementById("partSkuInput");
    const nameEl = document.getElementById("partNameInput");
    if (skuEl) skuEl.value = "";
    if (nameEl) nameEl.value = "";
    fillPartThresholdForm(null);

    const box = document.getElementById("partNewSuppliersChecklist");
    if (typeof comboMultiClear === "function") comboMultiClear(box);
    document.getElementById("newPartSupplierPrices")?.classList.add("hidden");
    const body = document.getElementById("newPartSupplierPricesBody");
    if (body) body.innerHTML = "";
  }

  closePartEditorModal();
}


function getPartThresholdInputs() {
  return {
    yellowInput: document.getElementById("partYellowThresholdInput"),
    redInput: document.getElementById("partRedThresholdInput")
  };
}

function readPartThresholdForm() {
  const { yellowInput, redInput } = getPartThresholdInputs();
  const yellowRaw = String(yellowInput?.value ?? "").trim();
  const redRaw = String(redInput?.value ?? "").trim();
  const yellowThreshold = normalizeThresholdValue(yellowRaw || null);
  const redThreshold = normalizeThresholdValue(redRaw || null);

  if (yellowRaw && yellowThreshold === null) {
    return { success: false, msg: "Próg żółty musi być liczbą całkowitą większą lub równą 0." };
  }
  if (redRaw && redThreshold === null) {
    return { success: false, msg: "Próg czerwony musi być liczbą całkowitą większą lub równą 0." };
  }

  return validatePartThresholds(yellowThreshold, redThreshold);
}

function fillPartThresholdForm(part = null) {
  const { yellowInput, redInput } = getPartThresholdInputs();
  if (yellowInput) yellowInput.value = part?.yellowThreshold ?? "";
  if (redInput) redInput.value = part?.redThreshold ?? "";
}

function getDeliverySupplierOptions(supplierName) {
  const supName = normalize(supplierName);
  if (!supName) return [];

  const sup = state.suppliers.get(supName);
  const skuListRaw = (sup && sup.prices && sup.prices.size)
    ? Array.from(sup.prices.keys())
    : Array.from(state.partsCatalog.keys());

  return skuListRaw
    .filter(k => state.partsCatalog.has(k))
    .map(k => {
      const part = state.partsCatalog.get(k);
      const price = (sup && sup.prices) ? (sup.prices.get(k) ?? 0) : 0;
      return {
        key: k,
        sku: part?.sku || k,
        name: part?.name || '',
        price: safeFloat(price)
      };
    });
}

function syncDeliveryPartPriceFromSelection() {
  const partSelect = document.getElementById('supplierPartsSelect');
  const priceEl = document.getElementById('deliveryPrice');
  if (!priceEl) return;
  const opt = partSelect?.selectedOptions?.[0];
  priceEl.value = (opt && opt.value) ? (opt.dataset.price ?? 0) : 0;
}

function rebuildDeliveryPartSelect(supplierName, opts = {}) {
  const { preferredSku = null, keepExistingIfPossible = true } = opts;
  const partSelect = document.getElementById('supplierPartsSelect');
  if (!partSelect) return;

  const supName = normalize(supplierName);
  const previousValue = normalize(partSelect.value);
  const currentDraftItems = Array.isArray(state.currentDelivery?.items) ? state.currentDelivery.items : [];
  const draftSku = normalize(currentDraftItems[0]?.sku || '');

  partSelect.disabled = !supName;

  if (!supName) {
    partSelect.innerHTML = '<option value="">-- Wybierz część --</option>';
    partSelect.value = '';
    syncDeliveryPartPriceFromSelection();
    try { refreshComboFromSelect(partSelect, { placeholder: 'Wybierz część...' }); } catch {}
    return;
  }

  const options = getDeliverySupplierOptions(supName);
  partSelect.innerHTML = '<option value="">-- Wybierz część --</option>' + options.map(opt => `
    <option value="${escapeHtml(opt.key)}" data-price="${opt.price}">
      ${escapeHtml(opt.sku)} - ${escapeHtml(opt.name)} (${escapeHtml(fmtPLN.format(opt.price))})
    </option>`).join('');

  const allowed = new Set(options.map(opt => opt.key));
  const preferredCandidates = [
    normalize(preferredSku),
    keepExistingIfPossible ? previousValue : '',
    draftSku ? skuKey(draftSku) : ''
  ].filter(Boolean);

  const nextValue = preferredCandidates.find(val => allowed.has(val)) || '';
  partSelect.value = nextValue;
  syncDeliveryPartPriceFromSelection();
  try { refreshComboFromSelect(partSelect, { placeholder: 'Wybierz część...' }); } catch {}
}

function syncDeliveryDraftUI(opts = {}) {
  const { keepSelectedPart = true } = opts;
  const supplierSelect = document.getElementById('supplierSelect');
  const dateInput = document.getElementById('deliveryDate');
  if (!supplierSelect) return;

  const supplierNames = Array.from(state.suppliers.keys());
  let draftSupplier = normalize(state.currentDelivery?.supplier);
  if (draftSupplier && !supplierNames.includes(draftSupplier)) {
    const hasDraftItems = Array.isArray(state.currentDelivery?.items) && state.currentDelivery.items.length > 0;
    if (!hasDraftItems) {
      draftSupplier = '';
      state.currentDelivery.supplier = null;
    }
  }

  supplierSelect.value = draftSupplier || '';
  try { refreshComboFromSelect(supplierSelect, { placeholder: 'Wybierz dostawcę...' }); } catch {}

  if (dateInput) {
    const today = new Date().toISOString().slice(0, 10);
    const draftDate = normalize(state.currentDelivery?.dateISO) || today;
    dateInput.value = draftDate;
    state.currentDelivery.dateISO = draftDate;
  }

  rebuildDeliveryPartSelect(draftSupplier, { keepExistingIfPossible: keepSelectedPart });
}

function initNewPartToggle() {
  const btn = document.getElementById("toggleNewPartBtn");
  const cancelBtn = document.getElementById("cancelNewPartBtn");
  if (!btn) return;

  btn.textContent = "Nowa";
  btn.addEventListener("click", openNewPartPanel);
  cancelBtn?.addEventListener("click", () => closeNewPartPanel({ clear: true }));
}

// === MAIN INIT ===
function init() {
  initThresholdsToggle();
  initNewPartToggle();
  initStockEditMode();
  
  if (!document.querySelector(".toast-host")) {
    const h = document.createElement("div");
    h.className = "toast-host";
    document.body.appendChild(h);
  }
  
  load();
  bindTabs();
  bindTabModal();
  bindMachineEditorModal();
  bindPartEditorModal();
  bindSupplierEditorModal();
  bindSearch();
  initHistoryViewToggle();
  initHistoryFilters();
  initSidePanelSignals();
  initBeforeUnloadWarning();

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

    syncDeliveryDraftUI({ keepSelectedPart: true });
  } catch (e) {
    console.warn("Combobox init warning:", e);
  }
  
  // Set default dates and keep draft dates in sync with state
  const today = new Date().toISOString().slice(0, 10);
  const deliveryDate = document.getElementById("deliveryDate");
  const buildDate = document.getElementById("buildDate");

  if (deliveryDate) {
    deliveryDate.addEventListener("input", (e) => {
      state.currentDelivery.dateISO = normalize(e.target.value);
      save();
    });
    deliveryDate.addEventListener("change", (e) => {
      state.currentDelivery.dateISO = normalize(e.target.value);
      save();
    });
  }

  if (buildDate) {
    const buildDraftDate = normalize(state.currentBuild?.dateISO) || today;
    buildDate.value = buildDraftDate;
    state.currentBuild.dateISO = buildDraftDate;
    buildDate.addEventListener("input", (e) => {
      state.currentBuild.dateISO = normalize(e.target.value);
      save();
    });
    buildDate.addEventListener("change", (e) => {
      state.currentBuild.dateISO = normalize(e.target.value);
      save();
    });
  }

  save();
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
  const nextSupplier = normalize(e.target.value);
  const currentSupplier = normalize(state.currentDelivery?.supplier);
  const hasItems = Array.isArray(state.currentDelivery?.items) && state.currentDelivery.items.length > 0;

  if (hasItems && currentSupplier && currentSupplier !== nextSupplier) {
    if (!confirm("Zmiana dostawcy spowoduje usunięcie bieżących pozycji dostawy. Kontynuować?")) {
      e.target.value = currentSupplier || "";
      try { refreshComboFromSelect(e.target, { placeholder: "Wybierz dostawcę..." }); } catch {}
      rebuildDeliveryPartSelect(currentSupplier, { keepExistingIfPossible: true });
      return;
    }
    state.currentDelivery.items = [];
  }

  state.currentDelivery.supplier = nextSupplier || null;
  rebuildDeliveryPartSelect(nextSupplier, { keepExistingIfPossible: !hasItems });
  save();
  renderDelivery();
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
  if (!sup) return toast("Brak dostawcy", "Wybierz dostawcę z listy.", "warning");
  
  const skuKeyVal = document.getElementById("supplierPartsSelect")?.value;
  if (!skuKeyVal) return toast("Brak części", "Wybierz część z listy.", "warning");
  
  const qtyEl = document.getElementById("deliveryQty");
  const priceEl = document.getElementById("deliveryPrice");

  const qtyRaw = qtyEl?.value ?? "";
  const priceRaw = priceEl?.value ?? "";

  const qtyNum = strictParseQtyInt(qtyRaw);
  if (qtyNum === null) {
    toast("Nieprawidłowa ilość", "Ilość musi być liczbą całkowitą większą lub równą 1.", "warning");
    qtyEl?.focus();
    return;
  }

  const priceNum = safeFloat(priceRaw);
  if (priceNum < 0) {
    toast("Nieprawidłowa cena", "Cena nie może być ujemna.", "warning");
    priceEl?.focus();
    return;
  }
  
  const part = state.partsCatalog.get(skuKeyVal);
  if (!part) {
    toast("Błąd części", "Wybrana część nie istnieje w bazie. Odśwież stronę i spróbuj ponownie.", "error");
    return;
  }

  const deliveryDateInput = document.getElementById("deliveryDate");
  if (deliveryDateInput) {
    state.currentDelivery.dateISO = normalize(deliveryDateInput.value);
  }

  if (btn) btn.dataset.busy = "1";
  try {
    addToDelivery(sup, part.sku, qtyNum, priceNum);
    if (qtyEl) qtyEl.value = "";
    toast("Dodano pozycję", `${part.sku} - ${qtyNum} szt.`, "success");
  } finally {
    setTimeout(() => { if (btn) btn.dataset.busy = "0"; }, 250);
  }
});

document.getElementById("finalizeDeliveryBtn")?.addEventListener("click", () => {
  try { finalizeDelivery(); }
  catch (e) { 
    console.error(e); 
    toast("Błąd systemu", "Nie udało się zatwierdzić dostawy. Sprawdź konsolę (F12) po szczegóły.", "error"); 
  }
});

window.removeDeliveryItem = (id) => {
  const item = state.currentDelivery.items.find(x => x.id === id);
  if (!item) return;
  if (!confirm(`Czy na pewno usunąć pozycję "${item.sku}" (${item.qty} szt.) z dostawy?`)) return;
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
    toast("Brak maszyny", "Wybierz maszynę z listy.", "warning");
    return;
  }

  const qtyEl = document.getElementById("buildQty");
  const qtyRaw = qtyEl?.value ?? "";
  const qtyNum = strictParseQtyInt(qtyRaw);
  if (qtyNum === null) {
    toast("Nieprawidłowa ilość", "Ilość sztuk musi być liczbą całkowitą większą lub równą 1.", "warning");
    qtyEl?.focus();
    return;
  }

  const buildDateInput = document.getElementById("buildDate");
  if (buildDateInput) {
    state.currentBuild.dateISO = normalize(buildDateInput.value);
  }

  if (btn) btn.dataset.busy = "1";
  
  const machine = state.machineCatalog.find(m => m.code === code);
  state.currentBuild.items.push({
    id: nextId(),
    machineCode: code,
    qty: qtyNum,
    machineNameSnapshot: machine?.name || code,
    bomSnapshot: getMachineBomSnapshot(code)
  });
  save();
  renderBuild();

  if (qtyEl) qtyEl.value = "";
  toast("Dodano do produkcji", `${machine?.name || code} - ${qtyNum} szt.`, "success");

  setTimeout(() => { if (btn) btn.dataset.busy = "0"; }, 250);
});

window.removeBuildItem = (id) => {
  const item = state.currentBuild.items.find(x => x.id === id);
  if (!item) return;
  const machine = state.machineCatalog.find(m => m.code === item.machineCode);
  const name = machine ? machine.name : item.machineCode;
  if (!confirm(`Czy na pewno usunąć "${name}" (${item.qty} szt.) z produkcji?`)) return;
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
            "error");
          error = true;
        }
      });

      if (!error) finalizeBuild(manualAlloc);
    } else {
      finalizeBuild(null);
    }
  } catch (e) {
    console.error(e);
    toast("Błąd systemu", "Nie udało się finalizować produkcji. Sprawdź konsolę (F12) po szczegóły.", "error");
  }
});

document.getElementById("consumeMode")?.addEventListener("change", (e) => {
  if (e.target.value === 'manual') {
    const els = getEls();
    if (els.missingBox) els.missingBox.classList.add("hidden");
    renderManualConsume();
  } else {
    const els = getEls();
    if (els.manualBox) els.manualBox.classList.add("hidden");
    if (els.missingBox) els.missingBox.classList.add("hidden");
  }
});

// Catalog events
document.getElementById("addPartBtn")?.addEventListener("click", () => {
  const sku = document.getElementById("partSkuInput")?.value ?? "";
  const name = document.getElementById("partNameInput")?.value ?? "";

  const normalizedSku = normalize(sku);
  const skuInput = document.getElementById("partSkuInput");
  if (normalizedSku && state.partsCatalog.has(skuKey(normalizedSku))) {
    toast("ID zajęte", `Część o ID "${normalizedSku}" już istnieje w bazie.`, "warning");
    skuInput?.focus();
    return;
  }

  const box = document.getElementById("partNewSuppliersChecklist");
  const selectedSups = (typeof comboMultiGetSelected === "function") ? comboMultiGetSelected(box) : [];
  const thresholds = readPartThresholdForm();
  if (!thresholds.success) {
    toast("Błąd walidacji", thresholds.msg, "warning");
    return;
  }

  const res = upsertPart(sku, name, selectedSups, thresholds);
  toast(res.success ? "Zapisano" : "Błąd walidacji", res.msg, res.success ? "success" : "warning");

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
    closeNewPartPanel({ clear: true });
  }
});

window.askDeletePart = (sku) => {
  if (confirm(`Czy na pewno usunąć część "${sku}"?\n\nTej operacji nie można cofnąć.`)) {
    const err = deletePart(sku);
    if (err) toast("Nie można usunąć", err, "error");
    else { toast("Usunięto", `Część "${sku}" została usunięta z bazy.`, "success"); refreshCatalogsUI(); }
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
let editingSupSnapshot = null;
let editingMachine = null;
let editingMachineSnapshot = null;
let editingMachineOriginalCode = null;
let editingMachineIsNew = false;

function cloneBomItems(items) {
  return Array.isArray(items)
    ? items.filter(Boolean).map(item => ({ sku: normalize(item?.sku), qty: safeInt(item?.qty) })).filter(item => item.sku)
    : [];
}

function ensureEditingMachineDraft() {
  if (!editingMachine || typeof editingMachine !== 'object') {
    editingMachine = { code: '', name: '', bom: [] };
  }
  if (!Array.isArray(editingMachine.bom)) editingMachine.bom = [];
  return editingMachine;
}

function getBomEditorSelection() {
  const selectEl = document.getElementById('bomSkuSelect');
  const comboValue = (typeof getComboValueFromSelect === 'function')
    ? normalize(getComboValueFromSelect(selectEl))
    : '';
  const selectValue = normalize(selectEl?.value ?? '');
  const rawValue = comboValue || selectValue;
  const partKey = rawValue ? skuKey(rawValue) : '';
  const part = partKey ? state.partsCatalog.get(partKey) : null;

  if (selectEl && rawValue && selectValue !== rawValue) {
    selectEl.value = rawValue;
  }

  return {
    selectEl,
    rawValue,
    part,
    sku: part?.sku || rawValue
  };
}

function resetBomEditorInputs() {
  const qtyInput = document.getElementById('bomQtyInput');
  const selectEl = document.getElementById('bomSkuSelect');

  if (qtyInput) qtyInput.value = '1';
  if (selectEl) {
    if (typeof setComboValueForSelect === 'function') {
      setComboValueForSelect(selectEl, '', { placeholder: 'Wybierz część...' });
    } else {
      selectEl.value = '';
      if (typeof refreshComboFromSelect === 'function') {
        try { refreshComboFromSelect(selectEl, { placeholder: 'Wybierz część...' }); } catch {}
      }
    }
  }
}

function syncMachineEditorHeader() {
  const codeInput = document.getElementById("machineCodeInput");
  const nameInput = document.getElementById("machineNameInput");
  const titleEl = document.getElementById("machineEditorTitle");
  const hintEl = document.getElementById("machineEditorHint");
  const nameEl = document.getElementById("machineEditorName");
  const codeEl = document.getElementById("machineEditorCode");

  const code = normalize(codeInput?.value ?? editingMachine?.code ?? "");
  const name = normalize(nameInput?.value ?? editingMachine?.name ?? "");

  if (titleEl) titleEl.textContent = editingMachineIsNew ? "Nowa definicja maszyny" : "Edycja definicji maszyny";
  if (hintEl) {
    hintEl.textContent = editingMachineIsNew
      ? "Uzupełnij dane maszyny i od razu zbuduj jej BOM."
      : "Edytuj dane maszyny i jej skład w jednym miejscu.";
  }
  if (nameEl) nameEl.textContent = name || "—";
  if (codeEl) codeEl.textContent = code || (editingMachineIsNew ? "NOWA" : "—");

  const saveBtn = document.getElementById("machineEditorSaveBtn");
  if (saveBtn) saveBtn.textContent = editingMachineIsNew ? "Utwórz" : "Zapisz zmiany";
}

function openMachineEditorModal() {
  const backdrop = document.getElementById("machineEditorBackdrop");
  const panel = document.getElementById("machineEditorTemplate");
  if (!backdrop || !panel) return;
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  panel.classList.remove("hidden");
  document.body.classList.add("machine-editor-open");
}

function closeMachineEditorModal() {
  const backdrop = document.getElementById("machineEditorBackdrop");
  const panel = document.getElementById("machineEditorTemplate");
  backdrop?.classList.add("hidden");
  backdrop?.setAttribute("aria-hidden", "true");
  panel?.classList.add("hidden");
  document.body.classList.remove("machine-editor-open");
}

function startNewMachineFlow() {
  editingMachineIsNew = true;
  editingMachineOriginalCode = null;
  editingMachineSnapshot = null;
  editingMachine = { code: "", name: "", bom: [] };
  unsavedChanges.clear("machineEditor");

  const codeInput = document.getElementById("machineCodeInput");
  const nameInput = document.getElementById("machineNameInput");
  if (codeInput) {
    codeInput.value = "";
    codeInput.readOnly = false;
  }
  if (nameInput) nameInput.value = "";

  const qtyInput = document.getElementById("bomQtyInput");
  if (qtyInput) qtyInput.value = 1;

  const sel = document.getElementById("bomSkuSelect");
  if (sel) {
    sel.innerHTML = '<option value="">-- Wybierz --</option>' + 
      Array.from(state.partsCatalog.values()).map(p =>
        `<option value="${p.sku}">${p.sku} (${p.name})</option>`
      ).join("");
    try { refreshComboFromSelect(sel, { placeholder: "Wybierz część..." }); } catch {}
  }

  syncMachineEditorHeader();
  renderBomTable();
  openMachineEditorModal();
  try { document.activeElement?.blur?.(); } catch {}
}

document.getElementById("openMachineModalBtn")?.addEventListener("click", startNewMachineFlow);

window.askDeleteMachine = (code) => {
  const machine = state.machineCatalog.find(m => m.code === code);
  const name = machine?.name || code;
  if (confirm(`Czy na pewno usunąć maszynę "${name}" (${code})?\n\nTej operacji nie można cofnąć.`)) {
    state.machineCatalog = state.machineCatalog.filter(m => m.code !== code);
    save();
    refreshCatalogsUI();
    toast("Usunięto maszynę", `"${name}" została usunięta.`, "success");
  }
};

window.openSupplierEditor = (name) => {
  editingSup = name;
  const originalSup = state.suppliers.get(name);
  editingSupSnapshot = originalSup ? { name, prices: new Map(originalSup.prices || []) } : null;
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
  
  const priceInput = document.getElementById("supplierEditorPriceInput");
  if (priceInput) priceInput.value = 0;

  renderSupEditorTable();
  openSupplierEditorModal();
};

function renderSupEditorTable() {
  const tbody = byId("supplierEditorPriceBody");
  const sup = editingSup ? state.suppliers.get(editingSup) : null;
  if (!tbody || !sup || !sup.prices) return;
  
  tbody.innerHTML = Array.from(sup.prices.entries()).map(([k, price]) => {
    const p = state.partsCatalog.get(k);
    return `<tr><td>${p ? p.sku : k}</td><td>${p ? p.name : '-'}</td><td class="text-right">${fmtPLN.format(price)}</td></tr>`;
  }).join("");
}

document.getElementById("supplierEditorSetPriceBtn")?.addEventListener("click", () => {
  const sku = document.getElementById("supplierEditorPartSelect")?.value;
  const price = document.getElementById("supplierEditorPriceInput")?.value;
  if (!sku) {
    toast("Brak części", "Wybierz część z listy.", "warning");
    return;
  }
  updateSupplierPrice(editingSup, sku, price);
  unsavedChanges.mark("supplierEditor");
  renderSupEditorTable();
  toast("Zapisano cenę", `Cena dla wybranej części została zaktualizowana.`, "success");
});

document.getElementById("supplierEditorSaveBtn")?.addEventListener("click", () => {
  closeSupplierEditorModal();
  editingSup = null;
  editingSupSnapshot = null;
  unsavedChanges.clear("supplierEditor");
  renderAllSuppliers();
  refreshCatalogsUI();
  toast("Zapisano zmiany", "Cennik dostawcy został zaktualizowany.", "success");
});

document.getElementById("supplierEditorCancelBtn")?.addEventListener("click", () => {
  if (unsavedChanges.supplierEditor) {
    if (!confirm("Masz niezapisane zmiany w cenniku. Czy na pewno chcesz anulować?")) {
      return;
    }
  }

  if (editingSup && editingSupSnapshot) {
    state.suppliers.set(editingSup, { prices: new Map(editingSupSnapshot.prices || []) });
    save();
  }

  closeSupplierEditorModal();
  editingSup = null;
  editingSupSnapshot = null;
  unsavedChanges.clear("supplierEditor");
  renderAllSuppliers();
  refreshCatalogsUI();
});

window.openMachineEditor = (code) => {
  editingMachineIsNew = false;
  const machine = state.machineCatalog.find(m => m.code === code);
  if (!machine) return;
  editingMachineOriginalCode = machine.code;
  editingMachineSnapshot = {
    code: machine.code,
    name: machine.name,
    bom: cloneBomItems(machine.bom)
  };
  editingMachine = {
    code: machine.code,
    name: machine.name,
    bom: cloneBomItems(machine.bom)
  };

  const codeInput = document.getElementById("machineCodeInput");
  const nameInput = document.getElementById("machineNameInput");
  if (codeInput) {
    codeInput.value = editingMachine.code;
    codeInput.readOnly = true;
  }
  if (nameInput) nameInput.value = editingMachine.name;

  const qtyInput = document.getElementById("bomQtyInput");
  if (qtyInput) qtyInput.value = 1;

  const sel = document.getElementById("bomSkuSelect");
  if (sel) {
    sel.innerHTML = '<option value="">-- Wybierz --</option>' + 
      Array.from(state.partsCatalog.values()).map(p =>
        `<option value="${p.sku}">${p.sku} (${p.name})</option>`
      ).join("");
    try { refreshComboFromSelect(sel, { placeholder: "Wybierz część..." }); } catch {}
  }

  syncMachineEditorHeader();
  renderBomTable();
  openMachineEditorModal();
  try { document.activeElement?.blur?.(); } catch {}
};

function renderBomTable() {
  const tbody = document.querySelector("#bomTable tbody");
  const saveBtn = document.getElementById("machineEditorSaveBtn");
  const draft = ensureEditingMachineDraft();
  if (!tbody) {
    if (saveBtn) {
      saveBtn.disabled = !draft.bom.length;
      saveBtn.textContent = editingMachineIsNew ? "Utwórz" : "Zapisz zmiany";
    }
    return;
  }

  if (!draft.bom.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:var(--space-4)">BOM jest pusty. Dodaj przynajmniej jedną część.</td></tr>`;
  } else {
    tbody.innerHTML = draft.bom.map((b, idx) => {
      const p = state.partsCatalog.get(skuKey(b.sku));
      return `<tr>
        <td><span class="badge">${escapeHtml(b.sku)}</span></td>
        <td>${p ? p.name : "???"}</td>
        <td class="text-right">${safeInt(b.qty)}</td>
        <td class="text-right">
          <button class="btn btn-danger btn-sm btn-icon" onclick="removeBomItem(${idx})" aria-label="Usuń">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </td>
      </tr>`;
    }).join("");
  }

  if (saveBtn) {
    saveBtn.disabled = !draft.bom.length;
    saveBtn.textContent = editingMachineIsNew ? "Utwórz" : "Zapisz zmiany";
  }
}

document.getElementById("machineCodeInput")?.addEventListener("input", (e) => {
  if (!editingMachine) return;
  editingMachine.code = normalize(e.target.value);
  unsavedChanges.mark("machineEditor");
  syncMachineEditorHeader();
});

document.getElementById("machineNameInput")?.addEventListener("input", (e) => {
  if (!editingMachine) return;
  editingMachine.name = normalize(e.target.value);
  unsavedChanges.mark("machineEditor");
  syncMachineEditorHeader();
});

document.getElementById("addBomItemBtn")?.addEventListener("click", () => {
  const draft = ensureEditingMachineDraft();
  const { selectEl, part, sku } = getBomEditorSelection();
  const qtyInput = document.getElementById("bomQtyInput");
  const qtyRaw = qtyInput?.value ?? "";
  const qty = strictParseQtyInt(qtyRaw);

  if (!sku) {
    toast("Brak części", "Wybierz część do składu.", "warning");
    return;
  }
  if (!part) {
    toast("Nieaktualna część", "Wybrana część nie istnieje już w katalogu. Odśwież wybór i spróbuj ponownie.", "warning");
    refreshCatalogsUI();
    return;
  }
  if (qty === null) {
    toast("Nieprawidłowa ilość", "Ilość musi być liczbą całkowitą większą lub równą 1.", "warning");
    qtyInput?.focus?.();
    return;
  }

  if (selectEl) {
    if (typeof setComboValueForSelect === "function") {
      setComboValueForSelect(selectEl, sku, { placeholder: "Wybierz część..." });
    } else {
      selectEl.value = sku;
      if (typeof refreshComboFromSelect === "function") {
        try { refreshComboFromSelect(selectEl, { placeholder: "Wybierz część..." }); } catch {}
      }
    }
  }

  const existing = draft.bom.find(b => skuKey(b.sku) === skuKey(sku));
  if (existing) {
    existing.qty = qty;
    toast("Zaktualizowano", `Ilość części ${sku} w BOM została zmieniona na ${qty}.`, "success");
  } else {
    draft.bom.push({ sku, qty });
    toast("Dodano do BOM", `Część ${sku} została dodana do składu maszyny.`, "success");
  }

  resetBomEditorInputs();
  unsavedChanges.mark("machineEditor");
  renderBomTable();
});

window.removeBomItem = (idx) => {
  const draft = ensureEditingMachineDraft();
  if (idx < 0 || idx >= draft.bom.length) return;
  draft.bom.splice(idx, 1);
  unsavedChanges.mark("machineEditor");
  renderBomTable();
};

document.getElementById("machineEditorSaveBtn")?.addEventListener("click", () => {
  const draft = ensureEditingMachineDraft();

  const codeInput = document.getElementById("machineCodeInput");
  const nameInput = document.getElementById("machineNameInput");
  const code = normalize(codeInput?.value ?? draft.code ?? "");
  const name = normalize(nameInput?.value ?? draft.name ?? "");

  if (!code || !name) {
    toast("Brak danych", "Podaj kod i nazwę maszyny.", "warning");
    (!code ? codeInput : nameInput)?.focus?.();
    return;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
    toast("Nieprawidłowy kod", "Kod maszyny może zawierać tylko litery, cyfry, myślniki i podkreślenia (bez spacji).", "warning");
    codeInput?.focus?.();
    return;
  }

  if (!Array.isArray(draft.bom) || draft.bom.length === 0) {
    toast("Pusty BOM", "Nie można zapisać maszyny bez składników. Dodaj przynajmniej jedną część.", "warning");
    return;
  }

  if (editingMachineIsNew && state.machineCatalog.some(m => m.code === code)) {
    toast("Kod zajęty", `Maszyna o kodzie "${code}" już istnieje w bazie.`, "warning");
    codeInput?.focus?.();
    return;
  }

  draft.code = code;
  draft.name = name;

  if (editingMachineIsNew) {
    state.machineCatalog.push({
      code,
      name,
      bom: draft.bom.map(b => ({ sku: b.sku, qty: safeInt(b.qty) }))
    });
    editingMachineIsNew = false;
    toast("Dodano maszynę", `"${name}" została dodana do katalogu.`, "success");
  } else {
    const idx = state.machineCatalog.findIndex(m => m.code === (editingMachineOriginalCode || code));
    if (idx >= 0) {
      state.machineCatalog[idx] = {
        code,
        name,
        bom: draft.bom.map(b => ({ sku: b.sku, qty: safeInt(b.qty) }))
      };
    }
    toast("Zapisano zmiany", `BOM maszyny "${name}" został zaktualizowany.`, "success");
  }

  unsavedChanges.clear("machineEditor");
  save();
  closeMachineEditorModal();
  editingMachine = null;
  editingMachineSnapshot = null;
  editingMachineOriginalCode = null;
  refreshCatalogsUI();
});

document.getElementById("machineEditorCancelBtn")?.addEventListener("click", () => {
  if (unsavedChanges.machineEditor) {
    if (!confirm("Masz niezapisane zmiany w BOM. Czy na pewno chcesz anulować?")) {
      return;
    }
  }

  if (editingMachineIsNew) {
    closeMachineEditorModal();
    editingMachineIsNew = false;
    editingMachine = null;
    editingMachineSnapshot = null;
    editingMachineOriginalCode = null;
    unsavedChanges.clear("machineEditor");
    return;
  }

  if (editingMachineSnapshot) {
    editingMachine = {
      code: editingMachineSnapshot.code,
      name: editingMachineSnapshot.name,
      bom: cloneBomItems(editingMachineSnapshot.bom)
    };
  }

  closeMachineEditorModal();
  editingMachine = null;
  editingMachineSnapshot = null;
  editingMachineOriginalCode = null;
  unsavedChanges.clear("machineEditor");
});

// === Supplier Editor Modal ===
function openSupplierEditorModal() {
  const backdrop = document.getElementById("supplierEditorBackdrop");
  const panel = document.getElementById("supplierEditorTemplate");
  if (!backdrop || !panel) return;
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  panel.classList.remove("hidden");
  document.body.classList.add("supplier-editor-open");
}

function closeSupplierEditorModal() {
  const backdrop = document.getElementById("supplierEditorBackdrop");
  const panel = document.getElementById("supplierEditorTemplate");
  backdrop?.classList.add("hidden");
  backdrop?.setAttribute("aria-hidden", "true");
  panel?.classList.add("hidden");
  document.body.classList.remove("supplier-editor-open");
}

function bindSupplierEditorModal() {
  const requestCancel = () => {
    const cancelBtn = document.getElementById("supplierEditorCancelBtn");
    if (cancelBtn) cancelBtn.click();
    else closeSupplierEditorModal();
  };

  document.getElementById("supplierEditorCloseBtn")?.addEventListener("click", requestCancel);
  document.getElementById("supplierEditorBackdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) requestCancel();
  });
}

// === Machine Editor Modal ===
function bindMachineEditorModal() {
  const requestCancel = () => {
    const cancelBtn = document.getElementById("machineEditorCancelBtn");
    if (cancelBtn) cancelBtn.click();
    else closeMachineEditorModal();
  };

  document.getElementById("machineEditorCloseBtn")?.addEventListener("click", requestCancel);
  document.getElementById("machineEditorBackdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) requestCancel();
  });
}

// === Part Editor Modal ===
function bindPartEditorModal() {
  const requestCancel = () => {
    const cancelBtn = document.getElementById(partEditorIsNew ? "cancelNewPartBtn" : "cancelEditPartBtn");
    if (cancelBtn) cancelBtn.click();
    else closePartEditorModal();
  };

  document.getElementById("partEditorCloseBtn")?.addEventListener("click", requestCancel);
  document.getElementById("partEditorBackdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) requestCancel();
  });

  const markDirty = () => {
    if (!partEditorIsNew) unsavedChanges.mark("partEditor");
  };

  document.getElementById("partSkuInput")?.addEventListener("input", markDirty);
  document.getElementById("partNameInput")?.addEventListener("input", markDirty);
  document.getElementById("partYellowThresholdInput")?.addEventListener("input", markDirty);
  document.getElementById("partRedThresholdInput")?.addEventListener("input", markDirty);
  document.getElementById("editPartSuppliersChecklist")?.addEventListener("change", markDirty);
  document.getElementById("editPartSuppliersChecklist")?.addEventListener("input", markDirty);
  document.getElementById("editPartSupplierPrices")?.addEventListener("input", markDirty);
}

// === Tab Modal ===
function bindTabModal() {
  document.getElementById("tabModalCloseBtn")?.addEventListener("click", () => {
    document.getElementById("tabModalBackdrop")?.classList.add("hidden");
  });
}

// === Search binding ===
function bindSearch() {
  const partsSearch = document.getElementById("searchParts");
  const machinesSearch = document.getElementById("searchMachines");
  
  if (partsSearch) {
    partsSearch.addEventListener("input", debounce(() => renderWarehouse(), 200));
  }
  if (machinesSearch) {
    machinesSearch.addEventListener("input", debounce(() => renderMachinesStock(), 200));
  }
}

// === Tabs ===
function bindTabs() {
  const tabRefreshers = {
    parts: () => renderWarehouse(),
    delivery: () => { renderAllSuppliers(); refreshCatalogsUI(); renderDelivery(); },
    build: () => { refreshCatalogsUI(); renderBuild(); },
    machines: () => renderMachinesStock(),
    catalog_parts: () => refreshCatalogsUI(),
    catalog_suppliers: () => renderAllSuppliers(),
    catalog_machines: () => refreshCatalogsUI(),
    history: () => renderHistory()
  };

  document.querySelectorAll('.tab-btn[data-tab-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab-target');
      
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      document.querySelectorAll('.tabPanel').forEach(panel => {
        if (panel.getAttribute('data-tab-panel') === target) {
          panel.classList.remove('hidden');
        } else {
          panel.classList.add('hidden');
        }
      });

      const refresh = tabRefreshers[target];
      if (typeof refresh === 'function') refresh();
    });
  });
}

// === Edit Part Functions ===
window.startEditPart = (sku) => {
  const k = skuKey(sku);
  const part = state.partsCatalog.get(k);
  if (!part) return;

  partEditorIsNew = false;
  currentEditPartKey = k;
  unsavedChanges.clear("partEditor");

  const skuInput = document.getElementById("partSkuInput");
  const nameInput = document.getElementById("partNameInput");
  const editSkuInput = document.getElementById("editPartSkuInput");

  if (skuInput) skuInput.value = part.sku;
  if (nameInput) nameInput.value = part.name;
  if (editSkuInput) editSkuInput.value = part.sku;
  fillPartThresholdForm(part);

  // Get suppliers for this part
  const supsForPart = Array.from(state.suppliers.entries())
    .filter(([_, data]) => data.prices.has(k))
    .map(([name]) => name);

  const editChecklist = document.getElementById("editPartSuppliersChecklist");
  if (editChecklist) {
    const allSups = Array.from(state.suppliers.keys()).sort();
    comboMultiRender(editChecklist, {
      options: allSups,
      selected: supsForPart,
      placeholder: "Wybierz dostawców..."
    });
  }

  syncPartEditorModal();
  openPartEditorModal();
};

function saveEditPart() {
  const skuInput = document.getElementById("partSkuInput");
  const nameInput = document.getElementById("partNameInput");
  const editSkuInput = document.getElementById("editPartSkuInput");

  const sku = normalize(skuInput?.value ?? "");
  const name = normalize(nameInput?.value ?? "");
  const originalSku = normalize(editSkuInput?.value ?? "");
  const thresholds = readPartThresholdForm();

  if (!sku || !name) {
    toast("Brak danych", "Podaj nazwę (ID) i typ części.", "warning");
    return;
  }

  if (!thresholds.success) {
    toast("Błąd walidacji", thresholds.msg, "warning");
    return;
  }

  const k = skuKey(sku);
  const originalK = skuKey(originalSku);
  const skuChanged = k !== originalK;

  if (skuChanged && state.partsCatalog.has(k)) {
    toast("ID zajęte", `Część o ID "${sku}" już istnieje w bazie.`, "warning");
    skuInput?.focus();
    return;
  }

  state.partsCatalog.delete(originalK);
  state.partsCatalog.set(k, {
    sku,
    name,
    yellowThreshold: thresholds.yellowThreshold,
    redThreshold: thresholds.redThreshold
  });

  state.lots.forEach(lot => {
    if (skuKey(lot.sku) === originalK) {
      lot.sku = sku;
      lot.name = name;
    }
  });

  state.currentDelivery.items.forEach(item => {
    if (skuKey(item.sku) === originalK) {
      item.sku = sku;
      item.name = name;
    }
  });

  state.machineCatalog.forEach(machine => {
    if (!Array.isArray(machine?.bom)) return;
    machine.bom.forEach(item => {
      if (skuKey(item?.sku) === originalK) {
        item.sku = sku;
      }
    });
  });

  state.currentBuild.items.forEach(item => {
    const bomSnapshot = Array.isArray(item?.bomSnapshot) ? item.bomSnapshot : [];
    bomSnapshot.forEach(bomItem => {
      if (skuKey(bomItem?.sku) === originalK) {
        bomItem.sku = sku;
        bomItem.name = name;
      }
    });
  });

  updateHistoryPartReferences(originalK, { sku, name });

  const editChecklist = document.getElementById("editPartSuppliersChecklist");
  const selectedSups = (typeof comboMultiGetSelected === "function") ? comboMultiGetSelected(editChecklist) : [];

  for (const sup of state.suppliers.values()) {
    sup.prices.delete(originalK);
  }

  const panel = document.getElementById("editPartSupplierPrices");
  const inputs = panel?.querySelectorAll('input[data-sup]') || [];
  inputs.forEach(inp => {
    const sup = inp.getAttribute("data-sup");
    if (sup && selectedSups.includes(sup)) {
      const supData = state.suppliers.get(sup);
      if (supData) supData.prices.set(k, safeFloat(inp.value));
    }
  });

  currentEditPartKey = k;
  if (editSkuInput) editSkuInput.value = sku;

  save();
  refreshCatalogsUI();
  renderWarehouse();
  renderDelivery();
  renderBuild();
  renderMachinesStock();
  unsavedChanges.clear("partEditor");
  closePartEditorModal();
  toast("Zapisano zmiany", `Część "${sku}" została zaktualizowana.`, "success");
}

function cancelEditPart() {
  if (unsavedChanges.partEditor) {
    if (!confirm("Masz niezapisane zmiany. Czy na pewno chcesz anulować?")) {
      return;
    }
  }
  closePartEditorModal();
  fillPartThresholdForm(null);
  unsavedChanges.clear("partEditor");
}

// Start the app
document.addEventListener('DOMContentLoaded', init);
