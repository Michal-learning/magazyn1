// === INIT & BINDINGS ===

function showDraftSyncNotifications(summary = {}, options = {}) {
  const notifySupplierReset = options?.notifySupplierReset === true;
  const deliveryItemsRemoved = Math.max(0, Number(summary?.deliveryItemsRemoved) || 0);
  const buildItemsRemoved = Math.max(0, Number(summary?.buildItemsRemoved) || 0);
  const deliverySupplierCleared = summary?.deliverySupplierCleared === true;

  if (notifySupplierReset && deliverySupplierCleared) {
    toast(
      'Dostawca niedostępny',
      'Wybrany wcześniej dostawca nie jest już dostępny aktywnie. Wybierz go ponownie przed finalizacją dostawy.',
      'warning'
    );
  }

  if (!deliveryItemsRemoved && !buildItemsRemoved) return;

  let message = '';
  if (deliveryItemsRemoved && buildItemsRemoved) {
    message = 'Część pozycji draftu dostawy i produkcji została automatycznie usunięta, bo powiązana część albo maszyna nie jest już aktywnie dostępna. Sprawdź oba drafty ponownie.';
  } else if (deliveryItemsRemoved) {
    message = 'Część pozycji draftu dostawy została automatycznie usunięta, bo powiązana część nie jest już aktywnie dostępna. Sprawdź draft ponownie.';
  } else {
    message = 'Część pozycji draftu produkcji została automatycznie usunięta, bo powiązana maszyna nie jest już aktywnie dostępna. Sprawdź draft ponownie.';
  }

  toast('Draft zaktualizowany', message, 'warning', { duration: 4200 });
}

function resetStockAdjustmentsAfterReload(reason = 'Dane magazynowe zmieniły się podczas odświeżania. Tryb korekty został zresetowany dla bezpieczeństwa.') {
  ensureUiState();
  const hadPendingAdjustments = Object.keys(state.ui?.pendingStockAdjustments || {}).length > 0;
  const hadEditMode = !!state.ui?.stockEditMode;
  if (!hadPendingAdjustments && !hadEditMode) return false;

  state.ui.stockEditMode = false;
  state.ui.pendingStockAdjustments = {};
  toast('Korekty zresetowane', reason, 'warning', { duration: 4200 });
  return true;
}

async function loadCatalogsFromSupabaseIntoState(options = {}) {
  const silent = options?.silent === true;
  const preserveUi = options?.preserveUi !== false;

  if (!window.fetchCatalogStateFromSupabase) {
    throw new Error('Brak helpera katalogów Supabase.');
  }

  const uiSnapshot = preserveUi ? {
    showArchivedPartsInWarehouse: shouldShowArchivedPartsInWarehouse(),
    showOnlyAlertsPartsInWarehouse: shouldShowOnlyAlertsPartsInWarehouse(),
    showArchivedMachinesInStock: shouldShowArchivedMachinesInStock()
  } : null;

  const hadStockEditSession = !!state.ui?.stockEditMode || Object.keys(state.ui?.pendingStockAdjustments || {}).length > 0;
  const catalogState = await window.fetchCatalogStateFromSupabase();
  const draftSyncSummary = applyCatalogState(catalogState) || {};

  if (uiSnapshot) {
    ensureUiState();
    state.ui.showArchivedPartsInWarehouse = uiSnapshot.showArchivedPartsInWarehouse;
    state.ui.showOnlyAlertsPartsInWarehouse = uiSnapshot.showOnlyAlertsPartsInWarehouse;
    state.ui.showArchivedMachinesInStock = uiSnapshot.showArchivedMachinesInStock;
  }

  if (hadStockEditSession) {
    resetStockAdjustmentsAfterReload();
  }
  showDraftSyncNotifications(draftSyncSummary, { notifySupplierReset: true });

  save();

  if (!silent) {
    renderWarehouse();
    renderAllSuppliers();
    renderMachinesStock();
    refreshCatalogsUI();
    renderDelivery();
    renderBuild();
  }

  return catalogState;
}

async function loadOperationalStateFromSupabaseIntoState(options = {}) {
  const silent = options?.silent === true;
  const preserveUi = options?.preserveUi !== false;

  if (!window.fetchOperationalStateFromSupabase) {
    throw new Error('Brak helpera operacyjnych danych Supabase.');
  }

  const uiSnapshot = preserveUi ? {
    showArchivedPartsInWarehouse: shouldShowArchivedPartsInWarehouse(),
    showOnlyAlertsPartsInWarehouse: shouldShowOnlyAlertsPartsInWarehouse(),
    showArchivedMachinesInStock: shouldShowArchivedMachinesInStock()
  } : null;

  const hadStockEditSession = !!state.ui?.stockEditMode || Object.keys(state.ui?.pendingStockAdjustments || {}).length > 0;
  const operationalState = await window.fetchOperationalStateFromSupabase();
  const draftSyncSummary = applyOperationalState(operationalState) || {};

  if (uiSnapshot) {
    ensureUiState();
    state.ui.showArchivedPartsInWarehouse = uiSnapshot.showArchivedPartsInWarehouse;
    state.ui.showOnlyAlertsPartsInWarehouse = uiSnapshot.showOnlyAlertsPartsInWarehouse;
    state.ui.showArchivedMachinesInStock = uiSnapshot.showArchivedMachinesInStock;
  }

  if (hadStockEditSession) {
    resetStockAdjustmentsAfterReload();
  }
  showDraftSyncNotifications(draftSyncSummary, { notifySupplierReset: false });

  save();

  if (!silent) {
    renderWarehouse();
    renderMachinesStock();
    renderHistory();
    renderDelivery();
    renderBuild();
  }

  return operationalState;
}

window.loadOperationalStateFromSupabaseIntoState = loadOperationalStateFromSupabaseIntoState;

function collectSupplierPricesFromPanel(panelId, allowedSupplierNames = []) {
  const allowed = new Set((allowedSupplierNames || []).map(name => normalize(name)).filter(Boolean));
  const panel = document.getElementById(panelId);
  const inputs = panel?.querySelectorAll('input[data-sup]') || [];
  const result = {};

  inputs.forEach(inp => {
    const supplierName = normalize(inp.getAttribute('data-sup'));
    if (!supplierName) return;
    if (allowed.size && !allowed.has(supplierName)) return;
    result[supplierName] = safeFloat(inp.value);
  });

  return result;
}

function collectSupplierPriceMapBySku(supplierName) {
  const supplier = state.suppliers.get(normalize(supplierName));
  const prices = supplier?.prices instanceof Map ? supplier.prices : new Map();
  const result = {};
  prices.forEach((price, sku) => {
    result[sku] = safeFloat(price);
  });
  return result;
}

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
  const allowedViews = new Set(["all", "deliveries", "builds", "adjustments"]);
  const v = allowedViews.has(view) ? view : "deliveries";

  const bAll = document.getElementById("historyViewAllBtn");
  const bDel = document.getElementById("historyViewDeliveriesBtn");
  const bBuild = document.getElementById("historyViewBuildsBtn");
  const bAdj = document.getElementById("historyViewAdjustmentsBtn");

  if (bAll) {
    bAll.classList.toggle("active", v === "all");
    bAll.setAttribute("aria-selected", v === "all" ? "true" : "false");
  }
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
    search.placeholder = "Szukaj";
  }

  localStorage.setItem(HISTORY_VIEW_KEY, v);
  renderHistory();
}

function initHistoryViewToggle() {
  const bAll = document.getElementById("historyViewAllBtn");
  const bDel = document.getElementById("historyViewDeliveriesBtn");
  const bBuild = document.getElementById("historyViewBuildsBtn");
  const bAdj = document.getElementById("historyViewAdjustmentsBtn");
  if (!bAll || !bDel || !bBuild || !bAdj) return;

  const saved = localStorage.getItem(HISTORY_VIEW_KEY);
  setHistoryView(["all", "builds", "adjustments", "deliveries"].includes(saved) ? saved : "deliveries");

  bAll.addEventListener("click", () => setHistoryView("all"));
  bDel.addEventListener("click", () => setHistoryView("deliveries"));
  bBuild.addEventListener("click", () => setHistoryView("builds"));
  bAdj.addEventListener("click", () => setHistoryView("adjustments"));
}

function clearHistoryFilters() {
  const search = document.getElementById("historySearch");
  const date = document.getElementById("historyDateRange");
  const author = document.getElementById("historyAuthorFilter");

  if (search) search.value = "";
  if (date) date.value = "";
  if (author) author.value = "";

  if (author && typeof refreshComboFromSelect === "function") {
    try { refreshComboFromSelect(author, { placeholder: "Wszyscy autorzy" }); } catch {}
  }
}

function getHistoryAuthorKeyForCompanyUser(item) {
  if (!item || !Array.isArray(state.history) || !state.history.length || typeof getHistoryAuthorMeta !== "function") {
    return "";
  }

  const userId = normalize(item?.user_id || "");
  const email = normalize(item?.email || "").toLowerCase();
  const fullName = normalize(item?.full_name || "").toLowerCase();

  const matchByUserId = userId
    ? state.history.find(ev => normalize(ev?.authorUserId || "") === userId)
    : null;
  if (matchByUserId) return getHistoryAuthorMeta(matchByUserId).key;

  const matchByEmail = email
    ? state.history.find(ev => normalize(ev?.authorEmail || "").toLowerCase() === email)
    : null;
  if (matchByEmail) return getHistoryAuthorMeta(matchByEmail).key;

  const matchByName = fullName
    ? state.history.find(ev => normalize(ev?.authorName || "").toLowerCase() === fullName)
    : null;
  if (matchByName) return getHistoryAuthorMeta(matchByName).key;

  return "";
}

function openHistoryForCompanyUser(memberId) {
  const item = getCompanyUserByMemberId(memberId);
  if (!item) {
    setActiveTab("history");
    setHistoryView("all");
    clearHistoryFilters();
    renderHistory();
    toast("Nie znaleziono użytkownika", "Nie udało się odczytać danych wybranego użytkownika.", "warning");
    return;
  }

  setActiveTab("history", { skipRefresh: true });
  setHistoryView("all");
  clearHistoryFilters();

  const authorSelect = document.getElementById("historyAuthorFilter");
  const authorKey = getHistoryAuthorKeyForCompanyUser(item);

  if (authorSelect && authorKey) {
    authorSelect.value = authorKey;
    if (typeof refreshComboFromSelect === "function") {
      try { refreshComboFromSelect(authorSelect, { placeholder: "Wszyscy autorzy" }); } catch {}
    }
  } else if (authorSelect && typeof refreshComboFromSelect === "function") {
    try { refreshComboFromSelect(authorSelect, { placeholder: "Wszyscy autorzy" }); } catch {}
  }

  renderHistory();

  if (!authorKey) {
    toast("Brak dopasowania autora", "Nie udało się jednoznacznie ustawić filtra autora, więc pokazuję całą historię.", "warning");
  }
}

function initHistoryFilters() {
  const search = document.getElementById("historySearch");
  const date = document.getElementById("historyDateRange");
  const author = document.getElementById("historyAuthorFilter");
  if (search) search.addEventListener("input", debounce(() => renderHistory(), 200));
  if (date) date.addEventListener("input", debounce(() => renderHistory(), 300));
  if (author) author.addEventListener("change", () => renderHistory());
}

function initSidePanelSignals() {
  if (window.__sidePanelSignalsBound) return;
  window.__sidePanelSignalsBound = true;

  document.addEventListener("click", (e) => {
    const row = e.target?.closest?.(".signal-row[data-sku]");
    if (!row) return;

    const sku = row.getAttribute("data-sku");
    if (!sku) return;

    if (typeof openPartDetailsModal === "function") {
      openPartDetailsModal(sku);
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

  document.getElementById("stockEditSaveBtn")?.addEventListener("click", async () => {
    try {
      await commitStockAdjustments();
    } catch (err) {
      console.error(err);
      toast("Nie zapisano korekt", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać korekt stanów. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać korekt stanów. Odśwież dane i spróbuj ponownie.", "error");
    }
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
  const anchor = byId("thresholdsPopoverAnchor");
  if (!panel || !btn || !anchor) return;
  if (btn.dataset.thresholdsBound === "1") return;
  btn.dataset.thresholdsBound = "1";

  const setPanelOpen = (isOpen) => {
    panel.classList.toggle("collapsed", !isOpen);
    panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    btn.classList.toggle("is-active", isOpen);
    if (typeof setExpanded === "function") {
      setExpanded(btn, isOpen);
    }
    localStorage.setItem(THRESHOLDS_OPEN_KEY, isOpen ? "1" : "0");
  };

  const saved = localStorage.getItem(THRESHOLDS_OPEN_KEY);
  setPanelOpen(saved === "1");

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const shouldOpen = panel.classList.contains("collapsed");
    setPanelOpen(shouldOpen);
  });

  panel.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.addEventListener("click", (e) => {
    if (panel.classList.contains("collapsed")) return;
    if (anchor.contains(e.target)) return;
    setPanelOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (panel.classList.contains("collapsed")) return;
    setPanelOpen(false);
    btn.focus();
  });
}


function initWarehouseArchiveToggles() {
  const partsToggle = document.getElementById("showArchivedPartsToggle");
  const alertsToggle = document.getElementById("showOnlyAlertsPartsToggle");
  const machinesToggle = document.getElementById("showArchivedMachinesToggle");

  if (partsToggle) {
    if (typeof syncWarehouseToggleButtonState === "function") {
      syncWarehouseToggleButtonState(partsToggle, shouldShowArchivedPartsInWarehouse());
    }
    partsToggle.addEventListener("click", () => {
      setShowArchivedPartsInWarehouse(!shouldShowArchivedPartsInWarehouse());
      renderWarehouse();
    });
  }

  if (alertsToggle) {
    if (typeof syncWarehouseToggleButtonState === "function") {
      syncWarehouseToggleButtonState(alertsToggle, shouldShowOnlyAlertsPartsInWarehouse());
    }
    alertsToggle.addEventListener("click", () => {
      setShowOnlyAlertsPartsInWarehouse(!shouldShowOnlyAlertsPartsInWarehouse());
      renderWarehouse();
    });
  }

  if (machinesToggle) {
    if (typeof syncWarehouseToggleButtonState === "function") {
      syncWarehouseToggleButtonState(machinesToggle, shouldShowArchivedMachinesInStock());
    }
    machinesToggle.addEventListener("click", () => {
      setShowArchivedMachinesInStock(!shouldShowArchivedMachinesInStock());
      renderMachinesStock();
    });
  }
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
  if (!canCreateCatalogParts()) {
    toast("Brak dostępu", "Nie masz uprawnienia do dodawania części.", "warning");
    return;
  }

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
  if (!supName || isSupplierArchived(supName)) return [];

  const sup = state.suppliers.get(supName);
  const skuListRaw = (sup && sup.prices && sup.prices.size)
    ? Array.from(sup.prices.keys())
    : Array.from(state.partsCatalog.keys());

  return skuListRaw
    .filter(k => state.partsCatalog.has(k) && !state.partsCatalog.get(k)?.archived)
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
  const { keepSelectedPart = true, notifySupplierReset = true } = opts;
  const supplierSelect = document.getElementById('supplierSelect');
  const dateInput = document.getElementById('deliveryDate');
  const invoiceInput = document.getElementById('deliveryInvoiceNumber');
  if (!supplierSelect) return;

  const beforeDeliveryCount = Array.isArray(state.currentDelivery?.items) ? state.currentDelivery.items.length : 0;
  const draftSupplierBeforeSync = normalize(state.currentDelivery?.supplier);
  const supplierNames = getActiveSupplierNames();
  if (Array.isArray(state.currentDelivery?.items)) {
    state.currentDelivery.items = state.currentDelivery.items.filter(item => !isPartArchived(item?.sku));
  }
  let draftSupplier = normalize(state.currentDelivery?.supplier);
  const supplierWasCleared = !!draftSupplier && !supplierNames.includes(draftSupplier);
  if (supplierWasCleared) {
    draftSupplier = '';
    state.currentDelivery.supplier = null;
  }

  const removedDeliveryItems = Math.max(0, beforeDeliveryCount - (Array.isArray(state.currentDelivery?.items) ? state.currentDelivery.items.length : 0));
  if (supplierWasCleared || removedDeliveryItems > 0) {
    showDraftSyncNotifications({
      deliveryItemsRemoved: removedDeliveryItems,
      buildItemsRemoved: 0,
      deliverySupplierCleared: supplierWasCleared && !!draftSupplierBeforeSync
    }, { notifySupplierReset });
  }

  supplierSelect.value = draftSupplier || '';
  try { refreshComboFromSelect(supplierSelect, { placeholder: 'Wybierz dostawcę...' }); } catch {}

  if (dateInput) {
    const today = new Date().toISOString().slice(0, 10);
    const draftDate = normalize(state.currentDelivery?.dateISO) || today;
    dateInput.value = draftDate;
    state.currentDelivery.dateISO = draftDate;
  }

  if (invoiceInput) {
    const draftInvoiceNumber = normalize(state.currentDelivery?.invoiceNumber);
    invoiceInput.value = draftInvoiceNumber;
    state.currentDelivery.invoiceNumber = draftInvoiceNumber;
  }

  rebuildDeliveryPartSelect(draftSupplier, { keepExistingIfPossible: keepSelectedPart });
}

function initNewPartToggle() {
  const btn = document.getElementById("toggleNewPartBtn");
  const cancelBtn = document.getElementById("cancelNewPartBtn");
  if (!btn) return;

  btn.textContent = "Nowa";
  btn.classList.toggle("hidden", !canCreateCatalogParts());
  btn.addEventListener("click", openNewPartPanel);
  cancelBtn?.addEventListener("click", () => closeNewPartPanel({ clear: true }));
}

// === MAIN INIT ===

const APP_TABS = Object.freeze([
  { id: "parts", label: "Magazyn Części", description: "Podgląd stanu, wartości i korekt części." },
  { id: "delivery", label: "Dostawa", description: "Przyjęcie dostaw i dodawanie pozycji na magazyn." },
  { id: "build", label: "Produkcja", description: "Tworzenie zleceń i zużycie części do budowy." },
  { id: "machines", label: "Magazyn Maszyn", description: "Stan wyrobów gotowych i dostępność maszyn." },
  { id: "catalog_parts", label: "Baza Części", description: "Katalog części, dostawców i statusów katalogowych." },
  { id: "catalog_suppliers", label: "Dostawcy", description: "Baza dostawców i zarządzanie cennikami." },
  { id: "catalog_machines", label: "Baza Maszyn", description: "Definicje maszyn i konfiguracja BOM." },
  { id: "history", label: "Ostatnie akcje", description: "Historia dostaw, produkcji i korekt magazynowych." },
  { id: "users", label: "Użytkownicy", description: "Użytkownicy firmy i konfiguracja ról." }
]);

const APP_TAB_ACCESS_FALLBACK = {
  owner: APP_TABS.map(tab => tab.id),
  admin: ["parts", "delivery", "build", "machines", "catalog_parts", "catalog_suppliers", "catalog_machines", "history"],
  worker: ["parts", "delivery", "build", "machines"]
};

const APP_FEATURE_PERMISSIONS = Object.freeze([
  {
    key: 'company_thresholds_manage',
    tabId: 'parts',
    label: 'Progi firmy',
    description: 'Globalne progi ostrzeżeń dla firmy.'
  },
  {
    key: 'stock_adjustments_manage',
    tabId: 'parts',
    label: 'Korekty stanów',
    description: 'Ręczne korekty stanów magazynowych części.'
  },
  {
    key: 'users_manage',
    tabId: 'users',
    label: 'Zarządzanie użytkownikami',
    description: 'Tworzenie użytkownika, zmiana roli i aktywacja/dezaktywacja.'
  },
  {
    key: 'users_permissions_manage',
    tabId: 'users',
    label: 'Uprawnienia ról',
    description: 'Konfiguracja uprawnień ról w obrębie firmy.'
  },
  {
    key: 'suppliers_create',
    tabId: 'catalog_suppliers',
    label: 'Dodawanie',
    description: 'Tworzenie nowych dostawców.'
  },
  {
    key: 'suppliers_edit',
    tabId: 'catalog_suppliers',
    label: 'Edycja i archiwizacja',
    description: 'Edycja dostawców, cenników oraz archiwizacja i przywracanie.'
  },
  {
    key: 'parts_create',
    tabId: 'catalog_parts',
    label: 'Dodawanie',
    description: 'Tworzenie nowych części w katalogu.'
  },
  {
    key: 'parts_edit',
    tabId: 'catalog_parts',
    label: 'Edycja i archiwizacja',
    description: 'Edycja istniejących części oraz archiwizacja i przywracanie.'
  },
  {
    key: 'machines_create',
    tabId: 'catalog_machines',
    label: 'Dodawanie',
    description: 'Tworzenie nowych maszyn w katalogu.'
  },
  {
    key: 'machines_edit',
    tabId: 'catalog_machines',
    label: 'Edycja, BOM i archiwizacja',
    description: 'Edycja maszyn, BOM oraz archiwizacja i przywracanie.'
  }
]);

const APP_FEATURE_PERMISSION_KEYS = APP_FEATURE_PERMISSIONS.map(feature => feature.key);
const APP_FEATURES_BY_TAB = APP_FEATURE_PERMISSIONS.reduce((acc, feature) => {
  if (!acc[feature.tabId]) acc[feature.tabId] = [];
  acc[feature.tabId].push(feature);
  return acc;
}, {});

let currentActiveTab = "parts";
window.companyUsersState = window.companyUsersState || {
  items: [],
  loading: false,
  error: "",
  refreshing: false
};

function syncUsersRefreshButtonState() {
  const btn = document.getElementById('refreshUsersBtn');
  if (!btn) return;

  const busy = !!window.companyUsersState?.refreshing;
  btn.disabled = busy;
  btn.textContent = busy ? 'Odświeżanie...' : 'Odśwież';
  btn.setAttribute('aria-disabled', busy ? 'true' : 'false');
}
window.companyRolePermissionsState = window.companyRolePermissionsState || {
  items: {},
  loading: false,
  error: "",
  selectedRole: "owner",
  drafts: {},
  saving: false
};

function getCurrentCompanyRole() {
  return String(window.appAuth?.companyRole || "").trim().toLowerCase();
}

function isCurrentCompanyOwner() {
  return getCurrentCompanyRole() === 'owner';
}

function getPermissionTabDefinitions() {
  return APP_TABS.slice();
}

function getPermissionFeatureDefinitions() {
  return APP_FEATURE_PERMISSIONS.slice();
}

function getFeaturesForTab(tabId) {
  return Array.isArray(APP_FEATURES_BY_TAB[tabId]) ? APP_FEATURES_BY_TAB[tabId].slice() : [];
}

function getDefaultTabPermissionsForRole(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const defaults = new Set(APP_TAB_ACCESS_FALLBACK[normalizedRole] || []);
  const result = {};
  APP_TABS.forEach(tab => {
    result[tab.id] = normalizedRole === 'owner' ? true : defaults.has(tab.id);
  });
  return result;
}

function normalizeRoleTabPermissions(role, rawPermissions) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'owner') return getDefaultTabPermissionsForRole('owner');

  const fallback = getDefaultTabPermissionsForRole(normalizedRole);
  const source = rawPermissions && typeof rawPermissions === 'object' ? rawPermissions : {};
  const normalized = {};

  APP_TABS.forEach(tab => {
    if (Object.prototype.hasOwnProperty.call(source, tab.id)) {
      normalized[tab.id] = !!source[tab.id];
    } else {
      normalized[tab.id] = !!fallback[tab.id];
    }
  });

  return normalized;
}

function getDefaultFeaturePermissionsForRole(role, tabPermissionsOverride) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const tabPermissions = normalizeRoleTabPermissions(normalizedRole, tabPermissionsOverride);
  const normalized = {};

  APP_FEATURE_PERMISSIONS.forEach(feature => {
    normalized[feature.key] = normalizedRole === 'owner' ? true : !!tabPermissions[feature.tabId];
  });

  return normalized;
}

function normalizeRoleFeaturePermissions(role, rawPermissions, tabPermissionsOverride) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'owner') return getDefaultFeaturePermissionsForRole('owner', getDefaultTabPermissionsForRole('owner'));

  const fallback = getDefaultFeaturePermissionsForRole(normalizedRole, tabPermissionsOverride);
  const source = rawPermissions && typeof rawPermissions === 'object' ? rawPermissions : {};
  const normalized = {};

  APP_FEATURE_PERMISSIONS.forEach(feature => {
    if (Object.prototype.hasOwnProperty.call(source, feature.key)) {
      normalized[feature.key] = !!source[feature.key];
    } else {
      normalized[feature.key] = !!fallback[feature.key];
    }
  });

  return normalized;
}

function normalizeRolePermissionsDraft(role, rawDraft) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const source = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
  const inferredTabSource = source?.tab_permissions && typeof source.tab_permissions === 'object'
    ? source.tab_permissions
    : source;
  const tab_permissions = normalizeRoleTabPermissions(normalizedRole, inferredTabSource);
  const feature_permissions = normalizeRoleFeaturePermissions(
    normalizedRole,
    source?.feature_permissions,
    tab_permissions
  );

  return {
    tab_permissions,
    feature_permissions
  };
}

function getStoredRolePermissions(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const st = window.companyRolePermissionsState || {};
  const items = st.items && typeof st.items === 'object' ? st.items : {};
  return items[normalizedRole] || null;
}

function getRolePermissionsDraft(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'owner') {
    return {
      tab_permissions: getDefaultTabPermissionsForRole('owner'),
      feature_permissions: getDefaultFeaturePermissionsForRole('owner')
    };
  }

  const draft = window.companyRolePermissionsState?.drafts?.[normalizedRole];
  if (draft && typeof draft === 'object') return normalizeRolePermissionsDraft(normalizedRole, draft);

  const stored = getStoredRolePermissions(normalizedRole);
  return normalizeRolePermissionsDraft(normalizedRole, {
    tab_permissions: stored?.tab_permissions,
    feature_permissions: stored?.feature_permissions
  });
}

function getRoleTabPermissions(role) {
  return getRolePermissionsDraft(role).tab_permissions;
}

function getRoleFeaturePermissions(role) {
  return getRolePermissionsDraft(role).feature_permissions;
}

function isRoleFeatureEffectivelyEnabled(role, featureKey) {
  const feature = APP_FEATURE_PERMISSIONS.find(item => item.key === String(featureKey || '').trim());
  if (!feature) return false;
  const tabPermissions = getRoleTabPermissions(role);
  if (!tabPermissions[feature.tabId]) return false;
  const featurePermissions = getRoleFeaturePermissions(role);
  return !!featurePermissions[feature.key];
}

function getAllowedTabsForRole(role) {
  const permissions = getRoleTabPermissions(role);
  return APP_TABS.filter(tab => !!permissions[tab.id]).map(tab => tab.id);
}

function canAccessTab(tab, roleOverride) {
  const normalizedTab = String(tab || '').trim();
  const role = roleOverride || getCurrentCompanyRole();
  if (String(role || '').trim().toLowerCase() === 'owner') return true;
  const permissions = getRoleTabPermissions(role);
  return !!permissions[normalizedTab];
}

function getCurrentRolePermissionsRow(roleOverride) {
  const role = String(roleOverride || getCurrentCompanyRole() || '').trim().toLowerCase();
  if (!role) return null;
  const items = window.appAuth?.rolePermissions && typeof window.appAuth.rolePermissions === 'object'
    ? window.appAuth.rolePermissions
    : {};
  return items[role] || null;
}

function hasCurrentUserFeaturePermission(featureKey) {
  const normalizedFeatureKey = String(featureKey || '').trim();
  if (!normalizedFeatureKey) return false;
  if (isCurrentCompanyOwner()) return true;

  const role = getCurrentCompanyRole();
  if (!role) return false;

  const feature = APP_FEATURE_PERMISSIONS.find(item => item.key === normalizedFeatureKey);
  if (!feature) return false;
  if (!canAccessTab(feature.tabId, role)) return false;

  const row = getCurrentRolePermissionsRow(role);
  const rawFeaturePermissions = row?._rawFeaturePermissions && typeof row._rawFeaturePermissions === 'object'
    ? row._rawFeaturePermissions
    : row?.feature_permissions && typeof row.feature_permissions === 'object'
      ? row.feature_permissions
      : null;

  if (!rawFeaturePermissions || !Object.prototype.hasOwnProperty.call(rawFeaturePermissions, normalizedFeatureKey)) {
    return false;
  }

  return rawFeaturePermissions[normalizedFeatureKey] === true;
}

function canManageCompanyThresholds() {
  return hasCurrentUserFeaturePermission('company_thresholds_manage');
}

function canManageStockAdjustments() {
  return hasCurrentUserFeaturePermission('stock_adjustments_manage');
}

function canManageUsers() {
  return hasCurrentUserFeaturePermission('users_manage');
}

function canManageUserPermissions() {
  return hasCurrentUserFeaturePermission('users_permissions_manage');
}

function canCreateSuppliers() {
  return hasCurrentUserFeaturePermission('suppliers_create');
}

function canEditSuppliers() {
  return hasCurrentUserFeaturePermission('suppliers_edit');
}

function canCreateCatalogParts() {
  return hasCurrentUserFeaturePermission('parts_create');
}

function canEditCatalogParts() {
  return hasCurrentUserFeaturePermission('parts_edit');
}

function canCreateCatalogMachines() {
  return hasCurrentUserFeaturePermission('machines_create');
}

function canEditCatalogMachines() {
  return hasCurrentUserFeaturePermission('machines_edit');
}

function refreshCatalogFeatureAccessUI() {
  const newPartBtn = document.getElementById('toggleNewPartBtn');
  const newMachineBtn = document.getElementById('openMachineModalBtn');
  const supplierAddRow = document.querySelector('.supplier-add-row');

  if (newPartBtn) {
    newPartBtn.classList.toggle('hidden', !canCreateCatalogParts());
    newPartBtn.setAttribute('aria-hidden', canCreateCatalogParts() ? 'false' : 'true');
  }

  if (newMachineBtn) {
    newMachineBtn.classList.toggle('hidden', !canCreateCatalogMachines());
    newMachineBtn.setAttribute('aria-hidden', canCreateCatalogMachines() ? 'false' : 'true');
  }

  if (supplierAddRow) {
    supplierAddRow.classList.toggle('hidden', !canCreateSuppliers());
    supplierAddRow.setAttribute('aria-hidden', canCreateSuppliers() ? 'false' : 'true');
  }
}

function enforceFeaturePermissionSafeStates() {
  ensureUiState();
  if (!canManageStockAdjustments() && state.ui?.stockEditMode) {
    state.ui.stockEditMode = false;
    state.ui.pendingStockAdjustments = {};
  }
}

function getDefaultTabForRole(roleOverride) {
  const role = roleOverride || getCurrentCompanyRole();
  const allowed = getAllowedTabsForRole(role);
  return allowed.includes('parts') ? 'parts' : (allowed[0] || 'parts');
}

function normalizeRolePermissionsCollection(rawItems) {
  const normalizedItems = {};
  const source = rawItems && typeof rawItems === 'object' ? rawItems : {};

  Object.values(source).forEach(row => {
    const role = String(row?.role || '').trim().toLowerCase();
    if (!role) return;
    const tab_permissions = normalizeRoleTabPermissions(role, row?.tab_permissions);
    const rawFeaturePermissions = row?._rawFeaturePermissions && typeof row._rawFeaturePermissions === 'object'
      ? { ...row._rawFeaturePermissions }
      : row?.feature_permissions && typeof row.feature_permissions === 'object'
        ? { ...row.feature_permissions }
        : {};
    normalizedItems[role] = {
      ...row,
      role,
      tab_permissions,
      _rawFeaturePermissions: rawFeaturePermissions,
      feature_permissions: normalizeRoleFeaturePermissions(role, row?.feature_permissions, tab_permissions)
    };
  });

  return normalizedItems;
}

function syncRolePermissionsStateFromAuth(opts = {}) {
  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  const preserveError = opts.preserveError === true;
  const normalizedItems = normalizeRolePermissionsCollection(window.appAuth?.rolePermissions);

  st.items = normalizedItems;
  if (!preserveError) st.error = '';
  window.appAuth.rolePermissions = normalizedItems;
  return normalizedItems;
}

async function loadCompanyRolePermissions(options = {}) {
  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  const force = options?.force === true;
  const canUseAuthContext = !force
    && !!window.appAuth?.companyId
    && window.appAuth?.rolePermissions
    && typeof window.appAuth.rolePermissions === 'object';

  st.loading = true;
  if (!options?.preserveError) st.error = '';

  try {
    if (canUseAuthContext) {
      return syncRolePermissionsStateFromAuth();
    }

    const rows = await window.fetchCompanyRolePermissions?.();
    const items = normalizeRolePermissionsCollection(
      (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
        const role = String(row?.role || '').trim().toLowerCase();
        if (!role) return acc;
        acc[role] = row;
        return acc;
      }, {})
    );

    st.items = items;
    st.error = '';
    window.appAuth.rolePermissions = items;
    return items;
  } catch (err) {
    console.error('Błąd konfiguracji ról:', err);
    st.error = window.getUserFriendlyErrorMessage?.(err, 'Nie udało się pobrać konfiguracji ról.') || 'Nie udało się pobrać konfiguracji ról.';
    st.items = {};
    window.appAuth.rolePermissions = {};
    return st.items;
  } finally {
    st.loading = false;
  }
}

function setRolePermissionsEditorRole(role) {
  const normalizedRole = [ 'owner', 'admin', 'worker' ].includes(String(role || '').trim().toLowerCase())
    ? String(role || '').trim().toLowerCase()
    : 'owner';

  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  st.selectedRole = normalizedRole;

  document.querySelectorAll('[data-role-permissions-role]').forEach(btn => {
    const isActive = btn.getAttribute('data-role-permissions-role') === normalizedRole;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  renderUsersAdmin();
}

function toggleRolePermissionDraft(role, tabId) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedTabId = String(tabId || '').trim();
  if (!['admin', 'worker'].includes(normalizedRole)) return;
  if (!APP_TABS.some(tab => tab.id === normalizedTabId)) return;

  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  const current = getRolePermissionsDraft(normalizedRole);
  const next = {
    tab_permissions: {
      ...current.tab_permissions,
      [normalizedTabId]: !current.tab_permissions[normalizedTabId]
    },
    feature_permissions: {
      ...current.feature_permissions
    }
  };
  st.drafts = st.drafts || {};
  st.drafts[normalizedRole] = next;
  renderUsersAdmin();
}

function toggleRoleFeaturePermissionDraft(role, featureKey) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedFeatureKey = String(featureKey || '').trim();
  const feature = APP_FEATURE_PERMISSIONS.find(item => item.key === normalizedFeatureKey);
  if (!['admin', 'worker'].includes(normalizedRole)) return;
  if (!feature) return;

  const current = getRolePermissionsDraft(normalizedRole);
  if (!current.tab_permissions[feature.tabId]) return;

  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  st.drafts = st.drafts || {};
  st.drafts[normalizedRole] = {
    tab_permissions: {
      ...current.tab_permissions
    },
    feature_permissions: {
      ...current.feature_permissions,
      [normalizedFeatureKey]: !current.feature_permissions[normalizedFeatureKey]
    }
  };
  renderUsersAdmin();
}

function resetRolePermissionDraft(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  if (st.drafts && Object.prototype.hasOwnProperty.call(st.drafts, normalizedRole)) {
    delete st.drafts[normalizedRole];
  }
  renderUsersAdmin();
}

async function saveRolePermissions(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!canManageUserPermissions()) {
    toast('Brak dostępu', 'Nie masz uprawnienia do zapisu konfiguracji ról.', 'warning');
    return;
  }
  if (!['admin', 'worker'].includes(normalizedRole)) {
    toast('Brak zmian', 'Owner ma zawsze pełny dostęp i nie jest ograniczany konfiguracją.', 'warning');
    return;
  }

  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  const permissionsDraft = getRolePermissionsDraft(normalizedRole);
  st.saving = true;

  try {
    const saved = await window.upsertCompanyRolePermissions?.(
      normalizedRole,
      permissionsDraft.tab_permissions,
      permissionsDraft.feature_permissions
    );
    const savedTabPermissions = normalizeRoleTabPermissions(normalizedRole, saved?.tab_permissions || permissionsDraft.tab_permissions);
    st.items = st.items || {};
    st.items[normalizedRole] = {
      ...saved,
      role: normalizedRole,
      tab_permissions: savedTabPermissions,
      feature_permissions: normalizeRoleFeaturePermissions(
        normalizedRole,
        saved?.feature_permissions || permissionsDraft.feature_permissions,
        savedTabPermissions
      )
    };
    if (st.drafts && Object.prototype.hasOwnProperty.call(st.drafts, normalizedRole)) {
      delete st.drafts[normalizedRole];
    }
    window.appAuth.rolePermissions = st.items;
    refreshRoleAccessUI();
    toast('Uprawnienia zapisane', `Konfiguracja roli ${normalizedRole} została zaktualizowana.`, 'success');
  } catch (err) {
    console.error('Błąd zapisu konfiguracji ról:', err);
    toast('Nie zapisano konfiguracji', window.getUserFriendlyErrorMessage?.(err, 'Nie udało się zapisać konfiguracji roli.') || 'Nie udało się zapisać konfiguracji roli.', 'error');
  } finally {
    st.saving = false;
    renderUsersAdmin();
  }
}

function renderRolePermissionsPanel() {
  const root = document.getElementById('rolePermissionsEditor');
  const note = document.getElementById('rolePermissionsReadOnlyNote');
  const saveBtn = document.getElementById('rolePermissionsSaveBtn');
  const resetBtn = document.getElementById('rolePermissionsResetBtn');
  if (!root) return;

  const st = window.companyRolePermissionsState || { items: {}, loading: false, error: '', selectedRole: 'owner', drafts: {}, saving: false };
  const selectedRole = ['owner', 'admin', 'worker'].includes(String(st.selectedRole || '').trim().toLowerCase())
    ? String(st.selectedRole || '').trim().toLowerCase()
    : 'owner';
  const canEditPermissions = canManageUserPermissions();
  const isEditableRole = canEditPermissions && ['admin', 'worker'].includes(selectedRole);
  const permissionsDraft = getRolePermissionsDraft(selectedRole);
  const effectivePermissions = permissionsDraft.tab_permissions;
  const featurePermissions = permissionsDraft.feature_permissions;
  const enabledCount = Object.values(effectivePermissions).filter(Boolean).length;
  const totalCount = APP_TABS.length;

  if (note) {
    note.classList.toggle('hidden', canEditPermissions);
    if (!canEditPermissions) {
      note.textContent = 'Nie masz uprawnienia do zmiany konfiguracji ról. Panel zostaje widoczny, ale tylko do podglądu.';
    }
  }

  document.querySelectorAll('[data-role-permissions-role]').forEach(btn => {
    btn.disabled = false;
  });
  if (saveBtn) {
    saveBtn.disabled = !isEditableRole || !!st.saving;
    saveBtn.textContent = st.saving ? 'Zapisywanie...' : 'Zapisz konfigurację';
  }
  if (resetBtn) resetBtn.disabled = !isEditableRole;

  if (st.loading) {
    root.innerHTML = `<div class="users-admin-readonly-note">Ładowanie konfiguracji ról...</div>`;
    return;
  }

  if (selectedRole === 'owner') {
    root.innerHTML = `
      <div class="role-permissions-owner-note">
        <h5>Owner ma pełny dostęp zawsze</h5>
        <p>Ta rola nie korzysta z ograniczeń zapisanych w konfiguracji. Nawet jeśli kiedyś ktoś wpisze tu jakieś cuda, logika aplikacji i tak traktuje ownera jako pełny dostęp do wszystkiego.</p>
        <div class="role-permissions-summary">
          <span class="text-secondary">Dostęp do zakładek</span>
          <strong>${totalCount} / ${totalCount}</strong>
        </div>
      </div>
    `;
    return;
  }

  const roleLabel = selectedRole === 'admin' ? 'Administrator' : 'Pracownik';
  const hasDraft = !!st.drafts?.[selectedRole];
  const enabledFeatureCount = APP_FEATURE_PERMISSIONS.filter(feature => isRoleFeatureEffectivelyEnabled(selectedRole, feature.key)).length;
  const totalFeatureCount = APP_FEATURE_PERMISSIONS.length;

  root.innerHTML = `
    <div class="role-permissions-summary">
      <div>
        <strong>${roleLabel}</strong>
        <div class="text-secondary" style="font-size:var(--text-sm)">Duża karta steruje całą zakładką. Małe chipy w środku sterują dodatkowymi funkcjami tej zakładki.</div>
      </div>
      <div class="role-permissions-summary-metrics">
        ${hasDraft ? '<span class="badge badge-warning">Niezapisane zmiany</span>' : '<span class="badge badge-success">Zapisane</span>'}
        <strong>Zakładki: ${enabledCount} / ${totalCount}</strong>
        <strong>Funkcje: ${enabledFeatureCount} / ${totalFeatureCount}</strong>
      </div>
    </div>
    <div class="role-permissions-grid">
      ${APP_TABS.map(tab => {
        const enabled = !!effectivePermissions[tab.id];
        const features = getFeaturesForTab(tab.id);
        const featureTiles = features.length
          ? `
            <div class="role-permission-feature-list" aria-label="Funkcje dla zakładki ${escapeHtml(tab.label)}">
              ${features.map(feature => {
                const rawEnabled = !!featurePermissions[feature.key];
                const disabledByTab = !enabled;
                const effectiveEnabled = enabled && rawEnabled;
                return `
                  <button
                    type="button"
                    class="role-feature-chip ${effectiveEnabled ? 'is-enabled' : 'is-disabled'} ${disabledByTab ? 'is-locked' : ''}"
                    data-action="toggleRoleFeaturePermission"
                    data-role="${escapeHtml(selectedRole)}"
                    data-feature-key="${escapeHtml(feature.key)}"
                    title="${escapeHtml(feature.description)}"
                    ${isEditableRole && !disabledByTab ? '' : 'disabled'}>
                    <span class="role-feature-chip-label">${escapeHtml(feature.label)}</span>
                    <span class="role-feature-chip-state">${disabledByTab ? 'Wyłączone z kartą' : (rawEnabled ? 'Włączona' : 'Wyłączona')}</span>
                  </button>
                `;
              }).join('')}
            </div>
          `
          : '<div class="role-permission-feature-empty">Brak dodatkowych funkcji w tej zakładce.</div>';
        return `
          <div class="role-permission-tile ${enabled ? 'is-enabled' : 'is-disabled'}">
            <button
              type="button"
              class="role-permission-tile-toggle"
              data-action="toggleRolePermissionTile"
              data-role="${escapeHtml(selectedRole)}"
              data-tab-id="${escapeHtml(tab.id)}"
              aria-label="Przełącz zakładkę ${escapeHtml(tab.label)}"
              aria-pressed="${enabled ? 'true' : 'false'}"
              ${isEditableRole ? '' : 'disabled'}></button>
            <div class="role-permission-tile-head role-permission-tile-static">
              <div class="role-permission-tile-title">
                <strong>${escapeHtml(tab.label)}</strong>
                <span>${escapeHtml(tab.description)}</span>
              </div>
              <span class="status-pill status-pill-${enabled ? 'success' : 'warning'}">${enabled ? 'Aktywna' : 'Wyłączona'}</span>
            </div>
            ${featureTiles}
            <div class="role-permission-tile-foot role-permission-tile-static">
              <span>${escapeHtml(tab.id)}</span>
              <span>${isEditableRole ? 'Kliknij kartę lub chipy' : 'Tylko podgląd'}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function setActiveTab(target, opts = {}) {
  const role = getCurrentCompanyRole();
  const requested = String(target || '').trim();
  const fallback = getDefaultTabForRole(role);
  const nextTab = canAccessTab(requested, role) ? requested : fallback;

  document.querySelectorAll('.tab-btn[data-tab-target]').forEach(btn => {
    const isActive = btn.getAttribute('data-tab-target') === nextTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  document.querySelectorAll('.tabPanel[data-tab-panel]').forEach(panel => {
    panel.classList.toggle('hidden', panel.getAttribute('data-tab-panel') !== nextTab);
  });

  currentActiveTab = nextTab;

  const tabRefreshers = {
    parts: () => renderWarehouse(),
    delivery: () => { renderAllSuppliers(); refreshCatalogsUI(); renderDelivery(); },
    build: () => { refreshCatalogsUI(); renderBuild(); },
    machines: () => renderMachinesStock(),
    catalog_parts: () => refreshCatalogsUI(),
    catalog_suppliers: () => renderAllSuppliers(),
    catalog_machines: () => refreshCatalogsUI(),
    history: () => renderHistory(),
    users: () => { if (typeof renderUsersAdmin === 'function') renderUsersAdmin(); }
  };

  const refresh = tabRefreshers[nextTab];
  if (!opts.skipRefresh && typeof refresh === 'function') refresh();

  return nextTab;
}

function applyRoleAccess() {
  const role = getCurrentCompanyRole();
  const allowedTabs = new Set(getAllowedTabsForRole(role));

  document.querySelectorAll('.tab-btn[data-tab-target]').forEach(btn => {
    const target = btn.getAttribute('data-tab-target');
    const allowed = allowedTabs.has(target);
    btn.hidden = !allowed;
    btn.disabled = !allowed;
    btn.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    btn.setAttribute('tabindex', allowed ? '0' : '-1');
  });

  document.querySelectorAll('.tabPanel[data-tab-panel]').forEach(panel => {
    const target = panel.getAttribute('data-tab-panel');
    if (!allowedTabs.has(target)) panel.classList.add('hidden');
  });

  if (!allowedTabs.has(currentActiveTab)) {
    setActiveTab(getDefaultTabForRole(role));
  }
}

function refreshRoleAccessUI(opts = {}) {
  if (window.appAuth?.rolePermissions && typeof window.appAuth.rolePermissions === 'object') {
    syncRolePermissionsStateFromAuth({ preserveError: true });
  }

  enforceFeaturePermissionSafeStates();
  applyRoleAccess();
  refreshCatalogFeatureAccessUI();

  if (opts.refreshActiveTab !== false) {
    setActiveTab(currentActiveTab || getDefaultTabForRole(), { skipRefresh: false });
  }
}

function hasAppAccess() {
  if (!window.appAuth?.session) return false;
  if (window.appAuth?.profile?.is_active === false) return false;
  if (!window.appAuth?.companyId) return false;
  if (!window.appAuth?.companyRole) return false;
  return true;
}

async function loadCompanyUsers() {
  if (!window.companyUsersState) return [];
  window.companyUsersState.loading = true;
  window.companyUsersState.error = "";
  try {
    const items = await window.fetchCompanyUsers?.();
    window.companyUsersState.items = Array.isArray(items) ? items : [];
    return window.companyUsersState.items;
  } catch (err) {
    console.error('Błąd listy użytkowników:', err);
    window.companyUsersState.error = window.getUserFriendlyErrorMessage?.(err, 'Nie udało się pobrać listy użytkowników.') || 'Nie udało się pobrać listy użytkowników.';
    throw err;
  } finally {
    window.companyUsersState.loading = false;
  }
}

window.companyUserModalState = window.companyUserModalState || {
  memberId: null
};

window.companyCreateUserModalState = window.companyCreateUserModalState || {
  open: false
};

function resetCreateUserForm() {
  const fullNameInput = document.getElementById('createWorkerFullNameInput');
  const emailInput = document.getElementById('createWorkerEmailInput');
  const passwordInput = document.getElementById('createWorkerPasswordInput');
  const roleSelect = document.getElementById('createWorkerRoleSelect');

  if (fullNameInput) fullNameInput.value = '';
  if (emailInput) emailInput.value = '';
  if (passwordInput) passwordInput.value = '';
  if (roleSelect) roleSelect.value = 'worker';
}

function openCreateUserModal() {
  if (!canAccessTab('users')) return;
  if (!canManageUsers()) {
    toast('Brak dostępu', 'Nie masz uprawnienia do tworzenia nowych użytkowników.', 'warning');
    return;
  }

  const backdrop = document.getElementById('createUserBackdrop');
  const fullNameInput = document.getElementById('createWorkerFullNameInput');
  if (!backdrop) return;

  window.companyCreateUserModalState.open = true;
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('user-create-open');
  fullNameInput?.focus?.();
}

function closeCreateUserModal(options = {}) {
  const shouldReset = options?.reset === true;
  const forceClose = options?.force === true;
  const backdrop = document.getElementById('createUserBackdrop');
  const createBtn = document.getElementById('createWorkerBtn');
  if (!backdrop) return;
  if (!forceClose && createBtn?.disabled && createBtn?.textContent === 'Tworzenie...') return;

  if (shouldReset) resetCreateUserForm();

  backdrop.classList.add('hidden');
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('user-create-open');
  window.companyCreateUserModalState.open = false;
}

function getCompanyUserByMemberId(memberId) {
  const normalizedMemberId = String(memberId || '').trim();
  const items = Array.isArray(window.companyUsersState?.items) ? window.companyUsersState.items : [];
  return items.find(item => String(item?.id || '').trim() === normalizedMemberId) || null;
}

function getCompanyUserAdminMeta(item) {
  const currentUserId = window.appAuth?.user?.id || null;
  const rowRole = String(item?.role || '').trim().toLowerCase();
  const isOwnerRow = rowRole === 'owner';
  const isSelf = !!currentUserId && item?.user_id === currentUserId;
  const hasUsersManagePermission = canManageUsers();
  const canModify = hasUsersManagePermission && !isOwnerRow && !isSelf;
  const statusCls = item?.is_active ? 'success' : 'warning';
  const statusLabel = item?.is_active ? 'Aktywny' : 'Nieaktywny';
  const actionLabel = item?.is_active ? 'Dezaktywuj użytkownika' : 'Aktywuj użytkownika';
  const nextActive = !item?.is_active;
  const fullName = String(item?.full_name || '').trim() || '—';
  const email = String(item?.email || '').trim() || '—';

  let readonlyMessage = '';
  if (!hasUsersManagePermission) {
    readonlyMessage = 'Nie masz uprawnienia do zarządzania użytkownikami. Możesz tylko podejrzeć dane.';
  } else if (isOwnerRow) {
    readonlyMessage = 'Owner nie może być edytowany z tego poziomu. I bardzo dobrze.';
  } else if (isSelf) {
    readonlyMessage = 'Nie możesz zmieniać własnej roli ani aktywności z tego poziomu.';
  }

  return {
    rowRole,
    isOwnerRow,
    isSelf,
    canModify,
    statusCls,
    statusLabel,
    actionLabel,
    nextActive,
    fullName,
    email,
    readonlyMessage
  };
}

function openCompanyUserInfoModal(memberId) {
  const item = getCompanyUserByMemberId(memberId);
  const backdrop = document.getElementById('userInfoBackdrop');
  const titleEl = document.getElementById('userInfoTitle');
  const subtitleEl = document.getElementById('userInfoSubtitle');
  const roleHintEl = document.getElementById('userInfoModalRoleHint');
  const summaryEl = document.getElementById('userInfoSummaryGrid');
  const readonlyNoteEl = document.getElementById('userInfoReadonlyNote');
  const roleSelect = document.getElementById('userInfoRoleSelect');
  const statusInput = document.getElementById('userInfoStatusInput');
  const saveRoleBtn = document.getElementById('userInfoRoleSaveBtn');
  const toggleActiveBtn = document.getElementById('userInfoToggleActiveBtn');

  if (!item || !backdrop || !summaryEl || !roleSelect || !statusInput || !saveRoleBtn || !toggleActiveBtn) return;

  const meta = getCompanyUserAdminMeta(item);
  window.companyUserModalState.memberId = String(item.id);

  if (titleEl) titleEl.textContent = meta.fullName;
  if (subtitleEl) subtitleEl.textContent = meta.email;
  if (roleHintEl) roleHintEl.textContent = `Rola: ${meta.rowRole}`;

  summaryEl.innerHTML = `
    <div class="user-info-card">
      <span class="user-info-card-label">Imię i nazwisko</span>
      <strong class="user-info-card-value">${escapeHtml(meta.fullName)}</strong>
    </div>
    <div class="user-info-card">
      <span class="user-info-card-label">Adres e-mail</span>
      <strong class="user-info-card-value">${escapeHtml(meta.email)}</strong>
    </div>
    <div class="user-info-card">
      <span class="user-info-card-label">Rola</span>
      <strong class="user-info-card-value">${escapeHtml(meta.rowRole)}</strong>
    </div>
    <div class="user-info-card">
      <span class="user-info-card-label">Status aktywności</span>
      <strong class="user-info-card-value">${escapeHtml(meta.statusLabel)}</strong>
    </div>
  `;

  roleSelect.value = ['worker', 'admin'].includes(meta.rowRole) ? meta.rowRole : 'worker';
  roleSelect.disabled = !meta.canModify;
  statusInput.value = meta.statusLabel;
  toggleActiveBtn.textContent = meta.actionLabel;
  toggleActiveBtn.dataset.memberId = String(item.id);
  toggleActiveBtn.dataset.nextActive = meta.nextActive ? '1' : '0';
  toggleActiveBtn.disabled = !meta.canModify;
  saveRoleBtn.dataset.memberId = String(item.id);
  saveRoleBtn.disabled = !meta.canModify || !['worker', 'admin'].includes(meta.rowRole);

  if (readonlyNoteEl) {
    if (meta.readonlyMessage) {
      readonlyNoteEl.textContent = meta.readonlyMessage;
      readonlyNoteEl.classList.remove('hidden');
    } else {
      readonlyNoteEl.textContent = '';
      readonlyNoteEl.classList.add('hidden');
    }
  }

  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('user-info-open');
}

function closeCompanyUserInfoModal() {
  const backdrop = document.getElementById('userInfoBackdrop');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('user-info-open');
  window.companyUserModalState.memberId = null;
}

function renderUsersAdmin() {
  const panel = document.querySelector('[data-tab-panel="users"]');
  const tbody = document.querySelector('#companyUsersTable tbody');
  const openCreateBtn = document.getElementById('openCreateUserModalBtn');
  const refreshBtn = document.getElementById('refreshUsersBtn');
  if (!panel || !tbody) return;

  if (!canAccessTab('users')) {
    panel.classList.add('hidden');
    closeCreateUserModal();
    return;
  }

  const hasUsersManagePermission = canManageUsers();
  if (openCreateBtn) {
    openCreateBtn.classList.toggle('hidden', !hasUsersManagePermission);
    openCreateBtn.setAttribute('aria-hidden', hasUsersManagePermission ? 'false' : 'true');
  }
  if (!hasUsersManagePermission) {
    closeCreateUserModal({ reset: true });
  }
  if (refreshBtn) {
    syncUsersRefreshButtonState();
  }

  const st = window.companyUsersState || { items: [], loading: false, error: '' };
  if (st.loading) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:var(--space-4)">Ładowanie użytkowników...</td></tr>`;
    renderRolePermissionsPanel();
    return;
  }

  if (st.error) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:var(--space-4)">${escapeHtml(st.error)}</td></tr>`;
    renderRolePermissionsPanel();
    return;
  }

  const items = Array.isArray(st.items) ? st.items : [];
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:var(--space-4)">Brak użytkowników w firmie.</td></tr>`;
    renderRolePermissionsPanel();
    return;
  }

  tbody.innerHTML = items.map(item => {
    const meta = getCompanyUserAdminMeta(item);

    return `
      <tr>
        <td>
          <div class="user-name-cell">
            <strong>${escapeHtml(meta.fullName)}</strong>
            <span>${escapeHtml(meta.email)}</span>
          </div>
        </td>
        <td><span class="user-role-text">${escapeHtml(meta.rowRole)}</span></td>
        <td><span class="status-pill status-pill-${meta.statusCls} user-status-pill">${meta.statusLabel}</span></td>
        <td class="text-right">
          ${hasUsersManagePermission ? `
            <div class="user-row-actions-clean">
              <button type="button" class="btn btn-secondary btn-sm" data-action="openUserInfo" data-member-id="${escapeHtml(String(item.id))}">Informacje</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="openUserHistory" data-member-id="${escapeHtml(String(item.id))}">Historia</button>
            </div>
          ` : '<span class="catalog-status-empty" aria-hidden="true"></span>'}
        </td>
      </tr>
    `;
  }).join('');

  renderRolePermissionsPanel();
}

function bindUserManagementUI() {
  if (window.__userManagementBound) return;
  window.__userManagementBound = true;

  document.getElementById('openCreateUserModalBtn')?.addEventListener('click', () => {
    openCreateUserModal();
  });

  document.getElementById('createUserCloseBtn')?.addEventListener('click', () => {
    closeCreateUserModal({ reset: true });
  });

  document.getElementById('createUserCancelBtn')?.addEventListener('click', () => {
    closeCreateUserModal({ reset: true });
  });

  document.getElementById('refreshUsersBtn')?.addEventListener('click', async () => {
    if (!canAccessTab('users')) return;
    if (window.companyUsersState?.refreshing) return;

    window.companyUsersState.refreshing = true;
    syncUsersRefreshButtonState();

    try {
      renderUsersAdmin();
      await Promise.all([
        loadCompanyUsers(),
        loadCompanyRolePermissions({ force: true })
      ]);
      renderUsersAdmin();
      toast('Odświeżono', 'Lista użytkowników i konfiguracja ról zostały odświeżone.', 'success');
    } catch (err) {
      renderUsersAdmin();
      toast('Błąd użytkowników', window.getUserFriendlyErrorMessage?.(err, 'Nie udało się odświeżyć zakładki użytkowników.') || 'Nie udało się odświeżyć zakładki użytkowników.', 'error');
    } finally {
      window.companyUsersState.refreshing = false;
      syncUsersRefreshButtonState();
    }
  });

  document.getElementById('createWorkerBtn')?.addEventListener('click', async () => {
    if (!canAccessTab('users')) return;
    if (!canManageUsers()) {
      toast('Brak dostępu', 'Nie masz uprawnienia do tworzenia nowych użytkowników.', 'warning');
      return;
    }

    const fullNameInput = document.getElementById('createWorkerFullNameInput');
    const emailInput = document.getElementById('createWorkerEmailInput');
    const passwordInput = document.getElementById('createWorkerPasswordInput');
    const roleSelect = document.getElementById('createWorkerRoleSelect');

    const fullName = String(fullNameInput?.value || '').trim();
    const email = String(emailInput?.value || '').trim().toLowerCase();
    const password = String(passwordInput?.value || '');
    const role = String(roleSelect?.value || 'worker').trim().toLowerCase() || 'worker';

    if (!fullName) {
      toast('Brak imienia i nazwiska', 'Podaj imię i nazwisko użytkownika.', 'warning');
      fullNameInput?.focus?.();
      return;
    }

    if (fullName.length > 150) {
      toast('Za długa nazwa', 'Imię i nazwisko nie może przekraczać 150 znaków.', 'warning');
      fullNameInput?.focus?.();
      return;
    }

    if (!email) {
      toast('Brak e-maila', 'Podaj adres e-mail użytkownika.', 'warning');
      emailInput?.focus?.();
      return;
    }

    if (!password) {
      toast('Brak hasła', 'Podaj hasło startowe użytkownika.', 'warning');
      passwordInput?.focus?.();
      return;
    }

    if (password.length < 6) {
      toast('Za krótkie hasło', 'Hasło startowe musi mieć co najmniej 6 znaków.', 'warning');
      passwordInput?.focus?.();
      return;
    }

    if (!['worker', 'admin'].includes(role)) {
      toast('Nieprawidłowa rola', 'Na tym etapie możesz tworzyć tylko role worker albo admin.', 'warning');
      return;
    }

    const btn = document.getElementById('createWorkerBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Tworzenie...';
    }

    try {
      const result = await window.createCompanyUser?.({
        fullName,
        email,
        password,
        role
      });

      resetCreateUserForm();
      closeCreateUserModal({ force: true });

      await loadCompanyUsers();
      renderUsersAdmin();

      toast(
        'Użytkownik utworzony',
        result?.message || `Konto ${email} z rolą ${role} zostało utworzone.`,
        'success'
      );
    } catch (err) {
      console.error('Błąd tworzenia użytkownika:', err);
      toast(
        'Nie utworzono użytkownika',
        window.getUserFriendlyErrorMessage?.(err, 'Nie udało się utworzyć konta użytkownika. Sprawdź dane i spróbuj ponownie.') || 'Nie udało się utworzyć konta użytkownika. Sprawdź dane i spróbuj ponownie.',
        'error'
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Utwórz użytkownika';
      }
    }
  });

  document.getElementById('rolePermissionsSaveBtn')?.addEventListener('click', async () => {
    const role = window.companyRolePermissionsState?.selectedRole || 'owner';
    await saveRolePermissions(role);
  });

  document.getElementById('rolePermissionsResetBtn')?.addEventListener('click', () => {
    const role = window.companyRolePermissionsState?.selectedRole || 'owner';
    if (!['admin', 'worker'].includes(String(role || '').trim().toLowerCase())) return;
    resetRolePermissionDraft(role);
    toast('Przywrócono', `Cofnięto niezapisane zmiany dla roli ${role}.`, 'success');
  });

  document.addEventListener('click', async (e) => {
    const roleSwitchBtn = e.target?.closest?.('[data-role-permissions-role]');
    if (roleSwitchBtn) {
      setRolePermissionsEditorRole(roleSwitchBtn.getAttribute('data-role-permissions-role'));
      return;
    }

    const toggleFeatureBtn = e.target?.closest?.('[data-action="toggleRoleFeaturePermission"]');
    if (toggleFeatureBtn) {
      e.stopPropagation();
      if (!canManageUserPermissions()) {
        toast('Brak dostępu', 'Nie masz uprawnienia do zmiany konfiguracji ról.', 'warning');
        return;
      }
      toggleRoleFeaturePermissionDraft(
        toggleFeatureBtn.getAttribute('data-role'),
        toggleFeatureBtn.getAttribute('data-feature-key')
      );
      return;
    }

    const toggleTileBtn = e.target?.closest?.('[data-action="toggleRolePermissionTile"]');
    if (toggleTileBtn) {
      if (!canManageUserPermissions()) {
        toast('Brak dostępu', 'Nie masz uprawnienia do zmiany konfiguracji ról.', 'warning');
        return;
      }
      toggleRolePermissionDraft(
        toggleTileBtn.getAttribute('data-role'),
        toggleTileBtn.getAttribute('data-tab-id')
      );
      return;
    }

    const createUserBackdrop = e.target?.closest?.('#createUserBackdrop');
    if (createUserBackdrop && e.target === createUserBackdrop) {
      closeCreateUserModal({ reset: true });
      return;
    }

    const openUserInfoBtn = e.target?.closest?.('[data-action="openUserInfo"]');
    if (openUserInfoBtn) {
      if (!canAccessTab('users')) return;
      openCompanyUserInfoModal(openUserInfoBtn.getAttribute('data-member-id'));
      return;
    }

    const openUserHistoryBtn = e.target?.closest?.('[data-action="openUserHistory"]');
    if (openUserHistoryBtn) {
      if (!canAccessTab('users')) return;
      openHistoryForCompanyUser(openUserHistoryBtn.getAttribute('data-member-id'));
      return;
    }

    const saveRoleBtn = e.target?.closest?.('[data-action="saveUserRole"]');
    if (saveRoleBtn) {
      if (!canAccessTab('users')) return;
      if (!canManageUsers()) {
        toast('Brak dostępu', 'Nie masz uprawnienia do zmiany roli użytkowników.', 'warning');
        return;
      }
      const memberId = saveRoleBtn.getAttribute('data-member-id');
      const item = getCompanyUserByMemberId(memberId);
      const meta = item ? getCompanyUserAdminMeta(item) : null;
      if (!meta?.canModify) {
        toast('Brak dostępu', meta?.readonlyMessage || 'Ta zmiana nie jest dozwolona.', 'warning');
        return;
      }
      const select = document.getElementById('userInfoRoleSelect');
      const nextRole = String(select?.value || 'worker').trim().toLowerCase();
      if (!['worker', 'admin'].includes(nextRole)) {
        toast('Nieprawidłowa rola', 'Można ustawić tylko rolę worker albo admin.', 'warning');
        return;
      }
      try {
        await window.updateCompanyMember?.(memberId, { role: nextRole });
        await loadCompanyUsers();
        renderUsersAdmin();
        openCompanyUserInfoModal(memberId);
        toast('Rola zapisana', 'Zmiana roli została zapisana.', 'success');
      } catch (err) {
        console.error('Błąd zmiany roli:', err);
        toast('Nie zapisano roli', window.getUserFriendlyErrorMessage?.(err, 'Nie udało się zmienić roli.') || 'Nie udało się zmienić roli.', 'error');
      }
      return;
    }

    const toggleActiveBtn = e.target?.closest?.('[data-action="toggleUserActive"]');
    if (toggleActiveBtn) {
      if (!canAccessTab('users')) return;
      if (!canManageUsers()) {
        toast('Brak dostępu', 'Nie masz uprawnienia do zmiany statusu użytkowników.', 'warning');
        return;
      }
      const memberId = toggleActiveBtn.getAttribute('data-member-id');
      const item = getCompanyUserByMemberId(memberId);
      const meta = item ? getCompanyUserAdminMeta(item) : null;
      if (!meta?.canModify) {
        toast('Brak dostępu', meta?.readonlyMessage || 'Ta zmiana nie jest dozwolona.', 'warning');
        return;
      }
      const nextActive = toggleActiveBtn.getAttribute('data-next-active') === '1';
      try {
        await window.updateCompanyMember?.(memberId, { is_active: nextActive });
        await loadCompanyUsers();
        renderUsersAdmin();
        openCompanyUserInfoModal(memberId);
        toast(nextActive ? 'Użytkownik aktywowany' : 'Użytkownik dezaktywowany', 'Status użytkownika został zaktualizowany.', 'success');
      } catch (err) {
        console.error('Błąd zmiany statusu użytkownika:', err);
        toast('Nie zapisano statusu', window.getUserFriendlyErrorMessage?.(err, 'Nie udało się zmienić statusu użytkownika.') || 'Nie udało się zmienić statusu użytkownika.', 'error');
      }
      return;
    }

    const closeUserInfoBtn = e.target?.closest?.('#userInfoCloseBtn');
    if (closeUserInfoBtn) {
      closeCompanyUserInfoModal();
      return;
    }

    const userInfoBackdrop = e.target?.closest?.('#userInfoBackdrop');
    if (userInfoBackdrop && e.target === userInfoBackdrop) {
      closeCompanyUserInfoModal();
      return;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.body.classList.contains('user-create-open')) {
      closeCreateUserModal({ reset: true });
      return;
    }
    if (document.body.classList.contains('user-info-open')) {
      closeCompanyUserInfoModal();
    }
  });
}

// === Auth gate ===
function getAuthElements() {
  return {
    authShell: document.getElementById("authShell"),
    appShell: document.getElementById("appShell"),
    loginForm: document.getElementById("authLoginForm"),
    emailInput: document.getElementById("authEmailInput"),
    passwordInput: document.getElementById("authPasswordInput"),
    loginBtn: document.getElementById("authLoginBtn"),
    errorBox: document.getElementById("authErrorBox"),
    logoutBtn: document.getElementById("authLogoutBtn"),
    panelStatusText: document.getElementById("authPanelStatusText"),
    panelCompanyName: document.getElementById("authPanelCompanyName"),
    settingsBtn: document.getElementById("accountSettingsBtn"),
    settingsBackdrop: document.getElementById("accountSettingsBackdrop"),
    settingsPanel: document.getElementById("accountSettingsPanel"),
    settingsCloseBtn: document.getElementById("accountSettingsCloseBtn"),
    accountEmailDisplay: document.getElementById("accountEmailDisplay"),
    accountCompanyDisplay: document.getElementById("accountCompanyDisplay"),
    accountRoleDisplay: document.getElementById("accountRoleDisplay"),
    accountNewPasswordInput: document.getElementById("accountNewPasswordInput"),
    accountRepeatPasswordInput: document.getElementById("accountRepeatPasswordInput"),
    accountSavePasswordBtn: document.getElementById("accountSavePasswordBtn"),
    accountPasswordErrorBox: document.getElementById("accountPasswordErrorBox")
  };
}

function setAuthLocked(isLocked) {
  const { authShell, appShell } = getAuthElements();
  const locked = !!isLocked;

  authShell?.classList.toggle("hidden", !locked);
  authShell?.setAttribute("aria-hidden", locked ? "false" : "true");

  appShell?.classList.toggle("hidden", locked);
  appShell?.setAttribute("aria-hidden", locked ? "true" : "false");

  if (appShell) {
    if (locked) appShell.setAttribute("inert", "");
    else appShell.removeAttribute("inert");
  }

  document.body.classList.toggle("auth-locked", locked);
}

function setAuthError(message) {
  const { errorBox } = getAuthElements();
  if (!errorBox) return;
  const text = String(message || "").trim();
  errorBox.textContent = text;
  errorBox.classList.toggle("hidden", !text);
}

function setAccountPasswordError(message) {
  const { accountPasswordErrorBox } = getAuthElements();
  if (!accountPasswordErrorBox) return;

  const text = String(message || "").trim();
  accountPasswordErrorBox.textContent = text;
  accountPasswordErrorBox.classList.toggle("hidden", !text);
}

function clearAccountPasswordForm() {
  const {
    accountNewPasswordInput,
    accountRepeatPasswordInput
  } = getAuthElements();

  if (accountNewPasswordInput) accountNewPasswordInput.value = "";
  if (accountRepeatPasswordInput) accountRepeatPasswordInput.value = "";
  setAccountPasswordError("");
}

function isAppAccessReady() {
  return hasAppAccess() && window.__appAccessConfirmed === true;
}

function updateAuthUI() {
  const {
    panelStatusText,
    panelCompanyName,
    accountEmailDisplay,
    accountCompanyDisplay,
    accountRoleDisplay,
    settingsBackdrop,
    settingsPanel
  } = getAuthElements();
  const loggedIn = !!window.appAuth?.session;
  const accessReady = isAppAccessReady();

  setAuthLocked(!accessReady);

  if (!loggedIn) {
    if (panelStatusText) panelStatusText.textContent = "—";
    if (panelCompanyName) panelCompanyName.textContent = "—";
    if (accountEmailDisplay) accountEmailDisplay.textContent = "—";
    if (accountCompanyDisplay) accountCompanyDisplay.textContent = "—";
    if (accountRoleDisplay) accountRoleDisplay.textContent = "—";
    clearAccountPasswordForm();
    if (settingsBackdrop) {
      settingsBackdrop.classList.add("hidden");
      settingsBackdrop.setAttribute("aria-hidden", "true");
    }
    settingsPanel?.classList.add("hidden");
    return;
  }

  const email = window.appAuth?.profile?.email || window.appAuth?.user?.email || "—";
  const role = window.appAuth?.companyRole || window.appAuth?.membership?.role || "—";
  const companyName = window.appAuth?.companyName || window.appAuth?.companyId || "—";

  if (panelStatusText) panelStatusText.textContent = accessReady ? "ZALOGOWANO" : "SPRAWDZANIE DOSTĘPU";
  if (panelCompanyName) panelCompanyName.textContent = companyName;
  if (accountEmailDisplay) accountEmailDisplay.textContent = email;
  if (accountCompanyDisplay) accountCompanyDisplay.textContent = companyName;
  if (accountRoleDisplay) accountRoleDisplay.textContent = String(role).toUpperCase();
  setAuthError("");
  setAccountPasswordError("");
  if (accessReady) applyRoleAccess();
}

async function ensureAuthSession() {
  window.__appAccessConfirmed = false;

  if (typeof window.refreshAuthContext !== "function") {
    console.error("Brak refreshAuthContext(). Bramka logowania pozostaje zamknięta.");
    setAuthLocked(true);
    setAuthError("Warstwa logowania nie została załadowana poprawnie. Sprawdź pliki skryptów Supabase.");
    return false;
  }

  const result = await window.refreshAuthContext();
  if (!result?.ok) {
    console.error("Auth init error:", result);
    setAuthLocked(true);
    setAuthError("Nie udało się odczytać sesji. Spróbuj odświeżyć stronę lub zalogować się ponownie.");
    return false;
  }

  syncRolePermissionsStateFromAuth({ preserveError: !!result?.rolePermissionsError });
  if (result?.rolePermissionsError) {
    const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
    st.error = result.rolePermissionsError?.message || 'Nie udało się pobrać konfiguracji ról.';
  }

  updateAuthUI();

  if (!window.appAuth?.session) {
    return false;
  }

  if (!hasAppAccess()) {
    setAuthLocked(true);
    setAuthError("To konto nie ma aktywnego dostępu do firmy albo zostało dezaktywowane.");
    return false;
  }

  return true;
}

function bindAuthUI() {
  if (window.__authUIBound) return;
  window.__authUIBound = true;

  const {
    loginForm,
    emailInput,
    passwordInput,
    loginBtn,
    logoutBtn,
    settingsBtn,
    settingsBackdrop,
    settingsPanel,
    settingsCloseBtn,
    accountNewPasswordInput,
    accountRepeatPasswordInput,
    accountSavePasswordBtn
  } = getAuthElements();

  const openAccountSettings = () => {
    if (!window.appAuth?.session || !settingsBackdrop || !settingsPanel) return;
    clearAccountPasswordForm();
    settingsBackdrop.classList.remove("hidden");
    settingsBackdrop.setAttribute("aria-hidden", "false");
    settingsPanel.classList.remove("hidden");
    document.body.classList.add("account-settings-open");
  };

  const closeAccountSettings = () => {
    clearAccountPasswordForm();
    settingsBackdrop?.classList.add("hidden");
    settingsBackdrop?.setAttribute("aria-hidden", "true");
    settingsPanel?.classList.add("hidden");
    document.body.classList.remove("account-settings-open");
  };

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setAuthError("");

    const email = String(emailInput?.value || "").trim();
    const password = String(passwordInput?.value || "");

    if (!email || !password) {
      setAuthError("Podaj e-mail i hasło.");
      return;
    }

    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = "Logowanie...";
    }

    try {
      await window.signInWithPassword(email, password);
      passwordInput && (passwordInput.value = "");
    } catch (err) {
      console.error(err);
      setAuthLocked(true);
      setAuthError(window.getUserFriendlyErrorMessage?.(err, 'Nie udało się zalogować.') || 'Nie udało się zalogować.');
    } finally {
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = "Zaloguj";
      }
    }
  });

  settingsBtn?.addEventListener("click", () => {
    openAccountSettings();
  });

  settingsCloseBtn?.addEventListener("click", () => {
    closeAccountSettings();
  });

  settingsBackdrop?.addEventListener("click", (e) => {
    if (e.target === settingsBackdrop) closeAccountSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAccountSettings();
  });

  accountSavePasswordBtn?.addEventListener("click", async () => {
    const newPassword = String(accountNewPasswordInput?.value || "");
    const repeatPassword = String(accountRepeatPasswordInput?.value || "");

    setAccountPasswordError("");

    if (!newPassword) {
      setAccountPasswordError("Nowe hasło nie może być puste.");
      accountNewPasswordInput?.focus?.();
      return;
    }

    if (newPassword.length < 8) {
      setAccountPasswordError("Nowe hasło musi mieć co najmniej 8 znaków.");
      accountNewPasswordInput?.focus?.();
      return;
    }

    if (newPassword !== repeatPassword) {
      setAccountPasswordError("Pola nowego hasła muszą być identyczne.");
      accountRepeatPasswordInput?.focus?.();
      return;
    }

    if (accountSavePasswordBtn) {
      accountSavePasswordBtn.disabled = true;
      accountSavePasswordBtn.textContent = "Zapisywanie...";
    }

    try {
      await window.updateOwnPassword?.(newPassword);
      clearAccountPasswordForm();
      toast("Hasło zmienione", "Nowe hasło zostało zapisane.", "success");
    } catch (err) {
      console.error("Błąd zmiany hasła:", err);
      const msg = window.getUserFriendlyErrorMessage?.(err, 'Nie udało się zmienić hasła.') || 'Nie udało się zmienić hasła.';
      setAccountPasswordError(msg);
      toast("Nie zapisano hasła", msg, "error");
    } finally {
      if (accountSavePasswordBtn) {
        accountSavePasswordBtn.disabled = false;
        accountSavePasswordBtn.textContent = "Zapisz nowe hasło";
      }
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      await window.signOutApp();
      window.__appInitialized = false;
      closeAccountSettings();
      setAuthError("");
      updateAuthUI();
      passwordInput && (passwordInput.value = "");
      emailInput?.focus?.();
    } catch (err) {
      console.error(err);
      setAuthError(window.getUserFriendlyErrorMessage?.(err, 'Nie udało się wylogować.') || 'Nie udało się wylogować.');
    }
  });

  window.sb?.auth?.onAuthStateChange?.((_event, session) => {
    void (async () => {
      if (window.appAuth) {
        window.appAuth.session = session || null;
        window.appAuth.user = session?.user || null;
      }

      const result = (typeof window.refreshAuthContext === "function")
        ? await window.refreshAuthContext(session || null)
        : { ok: false };

      if (!result?.ok) {
        window.__appAccessConfirmed = false;
        setAuthLocked(true);
        setAuthError("Nie udało się odświeżyć sesji użytkownika.");
        return;
      }

      if (result?.ok && window.appAuth?.session) {
        syncRolePermissionsStateFromAuth({ preserveError: !!result?.rolePermissionsError });
        if (result?.rolePermissionsError) {
          const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
          st.error = result.rolePermissionsError?.message || 'Nie udało się pobrać konfiguracji ról.';
        }
      }

      const hasSession = !!window.appAuth?.session;
      const hasConfirmedAccess = hasSession && hasAppAccess();
      const appBootFinished = window.__appInitialized === true;

      if (!hasSession) {
        window.__appAccessConfirmed = false;
        window.__appInitialized = false;
        closeAccountSettings();
        passwordInput && (passwordInput.value = "");
        updateAuthUI();
        return;
      }

      if (!hasConfirmedAccess) {
        window.__appAccessConfirmed = false;
        updateAuthUI();
        setAuthLocked(true);
        setAuthError("To konto nie ma aktywnego dostępu do firmy albo zostało dezaktywowane.");
        return;
      }

      if (!appBootFinished) {
        window.__appAccessConfirmed = false;
        updateAuthUI();
        await init();
        return;
      }

      window.__appAccessConfirmed = true;
      updateAuthUI();
      refreshRoleAccessUI();
    })().catch((err) => {
      console.error("Auth state change handler error:", err);
      window.__appAccessConfirmed = false;
      setAuthLocked(true);
      setAuthError("Wystąpił błąd podczas przełączania sesji użytkownika.");
    });
  });
}

async function init() {
  if (window.__appInitialized) return;

  if (window.__appInitPromise) {
    await window.__appInitPromise;
    if (window.__appInitialized) return;
  }

  if (window.__appInitialized) return;
  if (window.__appInitPromise) return window.__appInitPromise;

  window.__appAccessConfirmed = false;

  const initPromise = (async () => {
  initThresholdsToggle();
  initNewPartToggle();
  initStockEditMode();
  initWarehouseArchiveToggles();
  
  if (!document.querySelector(".toast-host")) {
    const h = document.createElement("div");
    h.className = "toast-host";
    document.body.appendChild(h);
  }

  bindAuthUI();
  const hasSession = await ensureAuthSession();
  if (!hasSession) {
    document.getElementById("authEmailInput")?.focus?.();
    return;
  }
  
  load();
  try {
    await loadCatalogsFromSupabaseIntoState({ silent: true });
  } catch (err) {
    console.error('Błąd ładowania katalogów z Supabase:', err);
    toast('Katalogi nie zostały pobrane', window.getUserFriendlyErrorMessage?.(err, 'Nie udało się wczytać katalogów. Odśwież dane i spróbuj ponownie.') || 'Nie udało się wczytać katalogów. Odśwież dane i spróbuj ponownie.', 'warning');
  }
  try {
    await loadOperationalStateFromSupabaseIntoState({ silent: true });
  } catch (err) {
    console.error('Błąd ładowania danych operacyjnych z Supabase:', err);
    toast('Dane operacyjne nie zostały pobrane', window.getUserFriendlyErrorMessage?.(err, 'Nie udało się wczytać danych magazynowych. Odśwież dane i spróbuj ponownie.') || 'Nie udało się wczytać danych magazynowych. Odśwież dane i spróbuj ponownie.', 'warning');
  }
  bindTabs();
  bindTabModal();
  bindMachineEditorModal();
  bindPartEditorModal();
  bindSupplierEditorModal();
  bindSearch();
  bindUserManagementUI();
  setRolePermissionsEditorRole(window.companyRolePermissionsState?.selectedRole || 'owner');
  initHistoryViewToggle();
  initHistoryFilters();
  initSidePanelSignals();
  initBeforeUnloadWarning();

  syncRolePermissionsStateFromAuth();

  renderWarehouse();
  renderAllSuppliers();
  renderMachinesStock();
  refreshCatalogsUI();
  bindSupplierPricesUI();
  applyRoleAccess();

  if (canAccessTab('users')) {
    try {
      await loadCompanyUsers();
    } catch {}
    renderUsersAdmin();
  }

  enforceFeaturePermissionSafeStates();

  // Sync threshold UI
  const warnRange = document.getElementById("warnRange");
  const dangerRange = document.getElementById("dangerRange");
  const warnValue = document.getElementById("warnValue");
  const dangerValue = document.getElementById("dangerValue");

  const normalizeCompanyThresholdPair = (warnRaw, dangerRaw) => {
    const normalizedWarn = strictNonNegInt(warnRaw) ?? 100;
    const normalizedDanger = strictNonNegInt(dangerRaw) ?? 50;
    return {
      lowWarn: Math.max(0, normalizedWarn),
      lowDanger: Math.min(Math.max(0, normalizedDanger), Math.max(0, normalizedWarn))
    };
  };

  const syncThresholdInputsFromAuth = () => {
    const next = normalizeCompanyThresholdPair(
      window.appAuth?.companyLowWarn,
      window.appAuth?.companyLowDanger
    );

    if (warnRange) warnRange.value = String(next.lowWarn);
    if (dangerRange) dangerRange.value = String(next.lowDanger);
    if (warnValue) warnValue.textContent = String(next.lowWarn);
    if (dangerValue) dangerValue.textContent = String(next.lowDanger);

    return next;
  };

  const syncThresholdLabelsFromInputs = () => {
    const next = normalizeCompanyThresholdPair(warnRange?.value, dangerRange?.value);
    if (warnRange) warnRange.value = String(next.lowWarn);
    if (dangerRange) dangerRange.value = String(next.lowDanger);
    if (warnValue) warnValue.textContent = String(next.lowWarn);
    if (dangerValue) dangerValue.textContent = String(next.lowDanger);
    return next;
  };

  const saveThresholdsFromInputs = async () => {
    if (!canManageCompanyThresholds()) {
      syncThresholdInputsFromAuth();
      return;
    }
    if (!window.saveCompanyThresholdsToSupabase) return;

    const next = syncThresholdLabelsFromInputs();
    try {
      const savedCompany = await window.saveCompanyThresholdsToSupabase(next.lowWarn, next.lowDanger);
      window.appAuth.companyLowWarn = strictNonNegInt(savedCompany?.low_warn) ?? next.lowWarn;
      window.appAuth.companyLowDanger = Math.min(
        strictNonNegInt(savedCompany?.low_danger) ?? next.lowDanger,
        window.appAuth.companyLowWarn
      );
      syncThresholdInputsFromAuth();
      renderWarehouse();
    } catch (err) {
      console.error('Błąd zapisu progów firmy do Supabase:', err);
      syncThresholdInputsFromAuth();
      toast('Nie zapisano progów', window.getUserFriendlyErrorMessage?.(err, 'Nie udało się zapisać progów firmy. Spróbuj ponownie.') || 'Nie udało się zapisać progów firmy. Spróbuj ponownie.', 'error');
    }
  };

  syncThresholdInputsFromAuth();

  warnRange?.addEventListener("input", () => {
    syncThresholdLabelsFromInputs();
  });

  dangerRange?.addEventListener("input", () => {
    syncThresholdLabelsFromInputs();
  });

  warnRange?.addEventListener("change", () => {
    void saveThresholdsFromInputs();
  });

  dangerRange?.addEventListener("change", () => {
    void saveThresholdsFromInputs();
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
    initComboFromSelect(document.getElementById("historyAuthorFilter"), { placeholder: "Wszyscy autorzy" });

    syncDeliveryDraftUI({ keepSelectedPart: true, notifySupplierReset: false });
  } catch (e) {
    console.warn("Combobox init warning:", e);
  }
  
  // Set default dates and keep draft dates in sync with state
  const today = new Date().toISOString().slice(0, 10);
  const deliveryDate = document.getElementById("deliveryDate");
  const buildDate = document.getElementById("buildDate");

  if (deliveryDate) {
    deliveryDate.addEventListener("input", (e) => {
      if (_finalizeDeliveryBusy) return;
      state.currentDelivery.dateISO = normalize(e.target.value);
      save();
      renderDelivery();
    });
    deliveryDate.addEventListener("change", (e) => {
      if (_finalizeDeliveryBusy) return;
      state.currentDelivery.dateISO = normalize(e.target.value);
      save();
      renderDelivery();
    });
  }

  const deliveryInvoiceNumber = document.getElementById("deliveryInvoiceNumber");
  if (deliveryInvoiceNumber) {
    deliveryInvoiceNumber.addEventListener("input", (e) => {
      if (_finalizeDeliveryBusy) return;
      state.currentDelivery.invoiceNumber = normalize(e.target.value);
      save();
      renderDelivery();
    });
    deliveryInvoiceNumber.addEventListener("change", (e) => {
      if (_finalizeDeliveryBusy) return;
      state.currentDelivery.invoiceNumber = normalize(e.target.value);
      save();
      renderDelivery();
    });
  }

  if (buildDate) {
    const buildDraftDate = normalize(state.currentBuild?.dateISO) || today;
    buildDate.value = buildDraftDate;
    state.currentBuild.dateISO = buildDraftDate;
    buildDate.addEventListener("input", (e) => {
      if (_finalizeBuildBusy) return;
      state.currentBuild.dateISO = normalize(e.target.value);
      save();
    });
    buildDate.addEventListener("change", (e) => {
      if (_finalizeBuildBusy) return;
      state.currentBuild.dateISO = normalize(e.target.value);
      save();
    });
  }

  save();
  window.__appAccessConfirmed = true;
  window.__appInitialized = true;
  updateAuthUI();
  refreshRoleAccessUI({ refreshActiveTab: false });
  setActiveTab(getDefaultTabForRole());
  })();

  window.__appInitPromise = initPromise;

  try {
    await initPromise;
  } finally {
    if (window.__appInitPromise === initPromise) {
      window.__appInitPromise = null;
    }
  }
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
  if (_finalizeDeliveryBusy) return;
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
  if (_finalizeDeliveryBusy) return;
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
  if (_finalizeDeliveryBusy) return;
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

  const deliveryInvoiceInput = document.getElementById("deliveryInvoiceNumber");
  if (deliveryInvoiceInput) {
    state.currentDelivery.invoiceNumber = normalize(deliveryInvoiceInput.value);
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

document.getElementById("finalizeDeliveryBtn")?.addEventListener("click", async () => {
  if (_finalizeDeliveryBusy) return;
  try { await finalizeDelivery(); }
  catch (e) { 
    console.error(e); 
    toast("Błąd systemu", "Nie udało się zatwierdzić dostawy. Sprawdź konsolę (F12) po szczegóły.", "error"); 
  }
});

window.removeDeliveryItem = (id) => {
  if (_finalizeDeliveryBusy) return;
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
  if (_finalizeBuildBusy) return;
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
  if (_finalizeBuildBusy) return;
  const item = state.currentBuild.items.find(x => x.id === id);
  if (!item) return;
  const machine = state.machineCatalog.find(m => m.code === item.machineCode);
  const name = machine ? machine.name : item.machineCode;
  if (!confirm(`Czy na pewno usunąć "${name}" (${item.qty} szt.) z produkcji?`)) return;
  state.currentBuild.items = state.currentBuild.items.filter(x => x.id !== id);
  save();
  renderBuild();
};

document.getElementById("finalizeBuildBtn")?.addEventListener("click", async () => {
  if (_finalizeBuildBusy) return;
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

      if (!error) await finalizeBuild(manualAlloc);
    } else {
      await finalizeBuild(null);
    }
  } catch (e) {
    console.error(e);
    toast("Nie zapisano produkcji", window.getUserFriendlyErrorMessage?.(e, "Nie udało się zapisać produkcji. Sprawdź pozycje i spróbuj ponownie.") || "Nie udało się zapisać produkcji. Sprawdź pozycje i spróbuj ponownie.", "error");
  }
});

document.getElementById("consumeMode")?.addEventListener("change", (e) => {
  if (_finalizeBuildBusy) return;
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
document.getElementById("addPartBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("addPartBtn");
  if (btn?.dataset.busy === "1") return;

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

  if (!/^[a-zA-Z0-9_-]+$/.test(normalizedSku)) {
    toast("Błąd walidacji", "ID może zawierać tylko litery, cyfry, myślniki i podkreślenia (bez spacji).", "warning");
    skuInput?.focus?.();
    return;
  }
  if (normalizedSku.length > 50) {
    toast("Błąd walidacji", "ID nie może być dłuższe niż 50 znaków.", "warning");
    skuInput?.focus?.();
    return;
  }
  if (normalize(name).length > 200) {
    toast("Błąd walidacji", "Typ nie może być dłuższy niż 200 znaków.", "warning");
    return;
  }

  try {
    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
    }

    await window.saveCatalogPartToSupabase?.({
      sku: normalize(sku),
      name: normalize(name),
      yellowThreshold: thresholds.yellowThreshold,
      redThreshold: thresholds.redThreshold,
      selectedSuppliers: selectedSups,
      pricesBySupplier: collectSupplierPricesFromPanel("newPartSupplierPrices", selectedSups),
      archived: false
    });

    await loadCatalogsFromSupabaseIntoState({ silent: false });

    const skuEl = document.getElementById("partSkuInput");
    const nameEl = document.getElementById("partNameInput");
    if (skuEl) skuEl.value = "";
    if (nameEl) nameEl.value = "";
    if (typeof comboMultiClear === "function") comboMultiClear(box);

    syncNewPartSupplierPricesUI();
    closeNewPartPanel({ clear: true });
    toast("Zapisano", "Zapisano część w bazie.", "success");
  } catch (err) {
    console.error("Błąd zapisu części do Supabase:", err);
    toast("Nie zapisano części", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać części. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać części. Odśwież dane i spróbuj ponownie.", "error");
  } finally {
    if (btn) {
      btn.dataset.busy = "0";
      btn.disabled = false;
    }
  }
});

window.togglePartArchive = async (sku) => {
  if (!canEditCatalogParts()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji i archiwizacji części.", "warning");
    return;
  }

  const part = state.partsCatalog.get(skuKey(sku));
  if (!part) return;

  const willArchive = !part.archived;
  const message = willArchive
    ? `Czy na pewno zarchiwizować część "${part.sku}"?

Rekord nie zostanie usunięty. Pozostanie w katalogu, zniknie z nowych operacji, a historia pozostanie bez zmian.`
    : `Czy na pewno przywrócić część "${part.sku}" z archiwum?

Rekord wróci do nowych operacji. Historia pozostanie bez zmian.`;

  if (!confirm(message)) return;

  const result = setPartArchived(part.sku, willArchive);
  if (!result.success) {
    toast(willArchive ? "Nie można zarchiwizować" : "Nie można przywrócić", result.msg, "error");
    return;
  }

  try {
    await window.setCatalogPartArchivedInSupabase?.(part.sku, willArchive);
    await loadCatalogsFromSupabaseIntoState({ silent: false });
    toast(willArchive ? "Zarchiwizowano część" : "Przywrócono część", result.msg, "success");
  } catch (err) {
    console.error("Błąd archiwizacji części w Supabase:", err);
    part.archived = !willArchive;
    save();
    toast(willArchive ? "Nie zarchiwizowano części" : "Nie przywrócono części", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać zmiany statusu części. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać zmiany statusu części. Odśwież dane i spróbuj ponownie.", "error");
  }
};

document.getElementById("addSupplierBtn")?.addEventListener("click", async () => {
  if (!canCreateSuppliers()) {
    toast("Brak dostępu", "Nie masz uprawnienia do dodawania dostawców.", "warning");
    return;
  }

  const btn = document.getElementById("addSupplierBtn");
  if (btn?.dataset.busy === "1") return;

  const nameInput = document.getElementById("supplierNameInput");
  const name = nameInput?.value ?? "";
  const normalizedName = normalize(name);

  if (!normalizedName) {
    toast("Brak nazwy", "Podaj nazwę dostawcy.", "warning");
    return;
  }
  if (normalizedName.length > 100) {
    toast("Za długa nazwa", "Nazwa dostawcy nie może przekraczać 100 znaków.", "warning");
    return;
  }
  if (state.suppliers.has(normalizedName)) {
    toast("Dostawca już istnieje", `Dostawca "${normalizedName}" jest już w bazie.`, "warning");
    return;
  }

  try {
    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
    }
    await window.createCatalogSupplierInSupabase?.(normalizedName);
    await loadCatalogsFromSupabaseIntoState({ silent: false });
    if (nameInput) nameInput.value = "";
    toast("Dodano dostawcę", `"${normalizedName}" został dodany do bazy.`, "success");
  } catch (err) {
    console.error("Błąd dodawania dostawcy do Supabase:", err);
    toast("Nie utworzono dostawcy", window.getUserFriendlyErrorMessage?.(err, "Nie udało się dodać dostawcy. Spróbuj ponownie.") || "Nie udało się dodać dostawcy. Spróbuj ponownie.", "error");
  } finally {
    if (btn) {
      btn.dataset.busy = "0";
      btn.disabled = false;
    }
  }
});

window.toggleSupplierArchive = async (name) => {
  if (!canEditSuppliers()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji i archiwizacji dostawców.", "warning");
    return;
  }

  const supplier = state.suppliers.get(normalize(name));
  if (!supplier) return;

  const willArchive = !supplier.archived;
  const message = willArchive
    ? `Czy na pewno zarchiwizować dostawcę "${name}"?

Rekord nie zostanie usunięty. Pozostanie w katalogu, zniknie z nowych operacji, a historia pozostanie bez zmian.`
    : `Czy na pewno przywrócić dostawcę "${name}" z archiwum?

Rekord wróci do nowych operacji. Historia pozostanie bez zmian.`;

  if (!confirm(message)) return;

  const result = setSupplierArchived(name, willArchive);
  if (!result.success) {
    toast(willArchive ? "Nie można zarchiwizować" : "Nie można przywrócić", result.msg, "error");
    return;
  }

  try {
    await window.setCatalogSupplierArchivedInSupabase?.(name, willArchive);
    await loadCatalogsFromSupabaseIntoState({ silent: false });
    toast(willArchive ? "Zarchiwizowano dostawcę" : "Przywrócono dostawcę", result.msg, "success");
  } catch (err) {
    console.error("Błąd archiwizacji dostawcy w Supabase:", err);
    supplier.archived = !willArchive;
    save();
    toast(willArchive ? "Nie zarchiwizowano dostawcy" : "Nie przywrócono dostawcy", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać zmiany statusu dostawcy. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać zmiany statusu dostawcy. Odśwież dane i spróbuj ponownie.", "error");
  }
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
  const activePart = part && !part.archived ? part : null;

  if (selectEl && rawValue && selectValue !== rawValue) {
    selectEl.value = rawValue;
  }

  return {
    selectEl,
    rawValue,
    part: activePart,
    sku: activePart?.sku || rawValue
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
  if (!canCreateCatalogMachines()) {
    toast("Brak dostępu", "Nie masz uprawnienia do dodawania maszyn.", "warning");
    return;
  }

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
      getActivePartsCatalog().map(p =>
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

window.toggleMachineArchive = async (code) => {
  if (!canEditCatalogMachines()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji i archiwizacji maszyn.", "warning");
    return;
  }

  const machine = state.machineCatalog.find(m => m.code === code);
  const name = machine?.name || code;
  if (!machine) return;

  const willArchive = !machine.archived;
  const message = willArchive
    ? `Czy na pewno zarchiwizować maszynę "${name}" (${code})?

Rekord nie zostanie usunięty. Pozostanie w katalogu, zniknie z nowych operacji, a historia pozostanie bez zmian.`
    : `Czy na pewno przywrócić maszynę "${name}" (${code}) z archiwum?

Rekord wróci do nowych operacji. Historia pozostanie bez zmian.`;

  if (!confirm(message)) return;

  const result = setMachineArchived(code, willArchive);
  if (!result.success) {
    toast(willArchive ? "Nie można zarchiwizować" : "Nie można przywrócić", result.msg, "error");
    return;
  }

  try {
    await window.setMachineArchivedInSupabase?.(code, willArchive);
    await loadCatalogsFromSupabaseIntoState({ silent: false });
    toast(willArchive ? "Zarchiwizowano maszynę" : "Przywrócono maszynę", result.msg, "success");
  } catch (err) {
    console.error("Błąd archiwizacji maszyny w Supabase:", err);
    machine.archived = !willArchive;
    save();
    toast(willArchive ? "Nie zarchiwizowano maszyny" : "Nie przywrócono maszyny", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać zmiany statusu maszyny. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać zmiany statusu maszyny. Odśwież dane i spróbuj ponownie.", "error");
  }
};

window.openSupplierEditor = (name) => {
  if (!canEditSuppliers()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji dostawców i cenników.", "warning");
    return;
  }

  editingSup = name;
  const originalSup = state.suppliers.get(name);
  editingSupSnapshot = originalSup ? {
    name,
    archived: !!originalSup?.archived,
    prices: new Map(originalSup.prices || []),
    _rowId: originalSup?._rowId ?? null,
    _updatedAt: originalSup?._updatedAt ?? null
  } : null;
  const panel = document.getElementById("supplierEditorTemplate");
  const nameEl = document.getElementById("supplierEditorName");
  if (nameEl) nameEl.textContent = name;
  
  const sel = document.getElementById("supplierEditorPartSelect");
  if (sel) {
    sel.innerHTML = '<option value="">-- Wybierz --</option>' + 
      getActivePartsCatalog().map(p =>
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
    const archivedBadge = p?.archived ? ' <span class="badge badge-muted">ZARCHIWIZOWANE</span>' : '';
    return `<tr><td>${p ? p.sku : k}${archivedBadge}</td><td>${p ? p.name : '-'}</td><td class="text-right">${fmtPLN.format(price)}</td></tr>`;
  }).join("");
}

document.getElementById("supplierEditorSetPriceBtn")?.addEventListener("click", () => {
  if (!canEditSuppliers()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji cenników dostawców.", "warning");
    return;
  }

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

document.getElementById("supplierEditorSaveBtn")?.addEventListener("click", async () => {
  if (!canEditSuppliers()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji cenników dostawców.", "warning");
    return;
  }

  const btn = document.getElementById("supplierEditorSaveBtn");
  if (btn?.dataset.busy === "1") return;
  if (!editingSup) return;

  try {
    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
    }
    await window.saveSupplierPricesToSupabase?.({
      supplierName: editingSup,
      pricesBySku: collectSupplierPriceMapBySku(editingSup),
      expectedUpdatedAt: state.suppliers.get(editingSup)?._updatedAt || editingSupSnapshot?._updatedAt || null
    });
    await loadCatalogsFromSupabaseIntoState({ silent: false });
    closeSupplierEditorModal();
    editingSup = null;
    editingSupSnapshot = null;
    unsavedChanges.clear("supplierEditor");
    toast("Zapisano zmiany", "Cennik dostawcy został zaktualizowany.", "success");
  } catch (err) {
    console.error("Błąd zapisu cennika dostawcy do Supabase:", err);
    toast("Nie zapisano cennika", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać cennika dostawcy. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać cennika dostawcy. Odśwież dane i spróbuj ponownie.", "error");
  } finally {
    if (btn) {
      btn.dataset.busy = "0";
      btn.disabled = false;
    }
  }
});

document.getElementById("supplierEditorCancelBtn")?.addEventListener("click", () => {
  if (unsavedChanges.supplierEditor) {
    if (!confirm("Masz niezapisane zmiany w cenniku. Po anulowaniu utracisz je bez zapisu. Czy chcesz kontynuować?")) {
      return;
    }
  }

  if (editingSup && editingSupSnapshot) {
    state.suppliers.set(editingSup, {
      archived: !!editingSupSnapshot?.archived,
      prices: new Map(editingSupSnapshot.prices || []),
      _rowId: editingSupSnapshot?._rowId ?? null,
      _updatedAt: editingSupSnapshot?._updatedAt ?? null
    });
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
  if (!canEditCatalogMachines()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji maszyn i BOM.", "warning");
    return;
  }

  editingMachineIsNew = false;
  const machine = state.machineCatalog.find(m => m.code === code);
  if (!machine) return;
  editingMachineOriginalCode = machine.code;
  editingMachineSnapshot = {
    code: machine.code,
    name: machine.name,
    bom: cloneBomItems(machine.bom),
    _rowId: machine?._rowId ?? null,
    _updatedAt: machine?._updatedAt ?? null
  };
  editingMachine = {
    code: machine.code,
    name: machine.name,
    bom: cloneBomItems(machine.bom),
    _rowId: machine?._rowId ?? null,
    _updatedAt: machine?._updatedAt ?? null
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
      getActivePartsCatalog().map(p =>
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
      saveBtn.disabled = false;
      saveBtn.textContent = editingMachineIsNew ? "Utwórz" : "Zapisz zmiany";
    }
    return;
  }

  if (!draft.bom.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:var(--space-4)">BOM jest pusty. To dozwolone, ale maszyna otrzyma status BRAK CZĘŚCI.</td></tr>`;
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
    saveBtn.disabled = false;
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
  if (!canEditCatalogMachines()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji BOM maszyn.", "warning");
    return;
  }

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
  if (!canEditCatalogMachines()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji BOM maszyn.", "warning");
    return;
  }

  const draft = ensureEditingMachineDraft();
  if (idx < 0 || idx >= draft.bom.length) return;
  draft.bom.splice(idx, 1);
  unsavedChanges.mark("machineEditor");
  renderBomTable();
};

document.getElementById("machineEditorSaveBtn")?.addEventListener("click", async () => {
  const isCreateFlow = !!editingMachineIsNew;
  const hasPermission = isCreateFlow ? canCreateCatalogMachines() : canEditCatalogMachines();
  if (!hasPermission) {
    toast("Brak dostępu", isCreateFlow ? "Nie masz uprawnienia do dodawania maszyn." : "Nie masz uprawnienia do edycji maszyn i BOM.", "warning");
    return;
  }

  const btn = document.getElementById("machineEditorSaveBtn");
  if (btn?.dataset.busy === "1") return;

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

  if (!Array.isArray(draft.bom)) {
    draft.bom = [];
  }

  if (editingMachineIsNew && state.machineCatalog.some(m => m.code === code)) {
    toast("Kod zajęty", `Maszyna o kodzie "${code}" już istnieje w bazie.`, "warning");
    codeInput?.focus?.();
    return;
  }

  draft.code = code;
  draft.name = name;

  try {
    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
    }

    await window.saveMachineDefinitionToSupabase?.({
      originalCode: editingMachineOriginalCode || code,
      code,
      name,
      archived: editingMachineIsNew ? false : !!state.machineCatalog.find(m => m.code === (editingMachineOriginalCode || code))?.archived,
      bom: draft.bom.map(b => ({ sku: b.sku, qty: safeInt(b.qty) })),
      expectedUpdatedAt: editingMachineSnapshot?._updatedAt || state.machineCatalog.find(m => m.code === (editingMachineOriginalCode || code))?._updatedAt || null
    });

    await loadCatalogsFromSupabaseIntoState({ silent: false });

    const successMsg = editingMachineIsNew
      ? `"${name}" została dodana do katalogu.`
      : `BOM maszyny "${name}" został zaktualizowany.`;

    unsavedChanges.clear("machineEditor");
    closeMachineEditorModal();
    editingMachine = null;
    editingMachineSnapshot = null;
    editingMachineOriginalCode = null;
    editingMachineIsNew = false;
    toast("Zapisano zmiany", successMsg, "success");
  } catch (err) {
    console.error("Błąd zapisu maszyny do Supabase:", err);
    toast("Nie zapisano maszyny", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać maszyny. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać maszyny. Odśwież dane i spróbuj ponownie.", "error");
  } finally {
    if (btn) {
      btn.dataset.busy = "0";
      btn.disabled = false;
    }
  }
});

document.getElementById("machineEditorCancelBtn")?.addEventListener("click", () => {
  if (unsavedChanges.machineEditor) {
    if (!confirm("Masz niezapisane zmiany w BOM. Po anulowaniu utracisz je bez zapisu. Czy chcesz kontynuować?")) {
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
      bom: cloneBomItems(editingMachineSnapshot.bom),
      _rowId: editingMachineSnapshot?._rowId ?? null,
      _updatedAt: editingMachineSnapshot?._updatedAt ?? null
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
  const catalogPartsSearch = document.getElementById("searchCatalogParts");
  const catalogMachinesSearch = document.getElementById("searchCatalogMachines");
  const catalogSuppliersSearch = document.getElementById("searchCatalogSuppliers");
  
  if (partsSearch) {
    partsSearch.addEventListener("input", debounce(() => renderWarehouse(), 200));
  }
  if (machinesSearch) {
    machinesSearch.addEventListener("input", debounce(() => renderMachinesStock(), 200));
  }
  if (catalogPartsSearch) {
    catalogPartsSearch.addEventListener("input", debounce(() => refreshCatalogsUI(), 200));
  }
  if (catalogMachinesSearch) {
    catalogMachinesSearch.addEventListener("input", debounce(() => refreshCatalogsUI(), 200));
  }
  if (catalogSuppliersSearch) {
    catalogSuppliersSearch.addEventListener("input", debounce(() => renderAllSuppliers(), 200));
  }
}

// === Tabs ===
function bindTabs() {
  if (window.__tabsBound) {
    applyRoleAccess();
    setActiveTab(currentActiveTab || getDefaultTabForRole());
    return;
  }
  window.__tabsBound = true;

  document.querySelectorAll('.tab-btn[data-tab-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab-target');
      if (!canAccessTab(target)) {
        toast('Brak dostępu', 'Ta sekcja nie jest dostępna dla Twojej roli.', 'warning');
        setActiveTab(getDefaultTabForRole());
        return;
      }
      setActiveTab(target);
    });
  });

  applyRoleAccess();
  setActiveTab(currentActiveTab || getDefaultTabForRole());
}

// === Edit Part Functions ===
window.startEditPart = (sku) => {
  if (!canEditCatalogParts()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji części.", "warning");
    return;
  }

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
    const allSups = getActiveSupplierNames();
    comboMultiRender(editChecklist, {
      options: allSups,
      selected: supsForPart,
      placeholder: "Wybierz dostawców..."
    });
  }

  syncPartEditorModal();
  openPartEditorModal();
};

async function saveEditPart() {
  if (!canEditCatalogParts()) {
    toast("Brak dostępu", "Nie masz uprawnienia do edycji części.", "warning");
    return;
  }

  const btn = document.getElementById("saveEditPartBtn");
  if (btn?.dataset.busy === "1") return;

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

  const originalPart = state.partsCatalog.get(originalK);
  const originalArchived = !!originalPart?.archived;
  const editChecklist = document.getElementById("editPartSuppliersChecklist");
  const selectedSups = (typeof comboMultiGetSelected === "function") ? comboMultiGetSelected(editChecklist) : [];

  try {
    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
    }

    await window.saveCatalogPartToSupabase?.({
      originalSku,
      sku,
      name,
      yellowThreshold: thresholds.yellowThreshold,
      redThreshold: thresholds.redThreshold,
      selectedSuppliers: selectedSups,
      pricesBySupplier: collectSupplierPricesFromPanel("editPartSupplierPrices", selectedSups),
      archived: originalArchived,
      expectedUpdatedAt: originalPart?._updatedAt || null
    });

    applyPartNameChangeAcrossOperationalState(sku, name);
    currentEditPartKey = k;
    if (editSkuInput) editSkuInput.value = sku;

    save();
    await loadCatalogsFromSupabaseIntoState({ silent: false });
    unsavedChanges.clear("partEditor");
    closePartEditorModal();
    toast("Zapisano zmiany", `Część "${sku}" została zaktualizowana.`, "success");
  } catch (err) {
    console.error("Błąd zapisu części do Supabase:", err);
    toast("Nie zapisano części", window.getUserFriendlyErrorMessage?.(err, "Nie udało się zapisać zmian części. Odśwież dane i spróbuj ponownie.") || "Nie udało się zapisać zmian części. Odśwież dane i spróbuj ponownie.", "error");
  } finally {
    if (btn) {
      btn.dataset.busy = "0";
      btn.disabled = false;
    }
  }
}

function cancelEditPart() {
  if (unsavedChanges.partEditor) {
    if (!confirm("Masz niezapisane zmiany. Po anulowaniu utracisz je bez zapisu. Czy chcesz kontynuować?")) {
      return;
    }
  }
  closePartEditorModal();
  fillPartThresholdForm(null);
  unsavedChanges.clear("partEditor");
}

// Start the app
document.addEventListener('DOMContentLoaded', () => { init().catch(err => console.error("Init error:", err)); });
