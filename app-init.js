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


function initWarehouseArchiveToggles() {
  const partsToggle = document.getElementById("showArchivedPartsToggle");
  const machinesToggle = document.getElementById("showArchivedMachinesToggle");

  if (partsToggle) {
    partsToggle.checked = shouldShowArchivedPartsInWarehouse();
    partsToggle.addEventListener("change", (e) => {
      setShowArchivedPartsInWarehouse(!!e.target.checked);
      renderWarehouse();
    });
  }

  if (machinesToggle) {
    machinesToggle.checked = shouldShowArchivedMachinesInStock();
    machinesToggle.addEventListener("change", (e) => {
      setShowArchivedMachinesInStock(!!e.target.checked);
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
  const { keepSelectedPart = true } = opts;
  const supplierSelect = document.getElementById('supplierSelect');
  const dateInput = document.getElementById('deliveryDate');
  if (!supplierSelect) return;

  const supplierNames = getActiveSupplierNames();
  if (Array.isArray(state.currentDelivery?.items)) {
    state.currentDelivery.items = state.currentDelivery.items.filter(item => !isPartArchived(item?.sku));
  }
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

let currentActiveTab = "parts";
window.companyUsersState = window.companyUsersState || {
  items: [],
  loading: false,
  error: ""
};
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

function getStoredRolePermissions(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const st = window.companyRolePermissionsState || {};
  const items = st.items && typeof st.items === 'object' ? st.items : {};
  return items[normalizedRole] || null;
}

function getRoleTabPermissions(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'owner') return getDefaultTabPermissionsForRole('owner');

  const draft = window.companyRolePermissionsState?.drafts?.[normalizedRole];
  if (draft && typeof draft === 'object') return normalizeRoleTabPermissions(normalizedRole, draft);

  const stored = getStoredRolePermissions(normalizedRole);
  return normalizeRoleTabPermissions(normalizedRole, stored?.tab_permissions);
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
    normalizedItems[role] = {
      ...row,
      role,
      tab_permissions: normalizeRoleTabPermissions(role, row?.tab_permissions)
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
    st.error = err?.message || 'Nie udało się pobrać konfiguracji ról.';
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
  const current = getRoleTabPermissions(normalizedRole);
  const next = { ...current, [normalizedTabId]: !current[normalizedTabId] };
  st.drafts = st.drafts || {};
  st.drafts[normalizedRole] = next;
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
  if (!isCurrentCompanyOwner()) {
    toast('Brak dostępu', 'Tylko owner może zapisywać konfigurację ról.', 'warning');
    return;
  }
  if (!['admin', 'worker'].includes(normalizedRole)) {
    toast('Brak zmian', 'Owner ma zawsze pełny dostęp i nie jest ograniczany konfiguracją.', 'warning');
    return;
  }

  const st = window.companyRolePermissionsState || (window.companyRolePermissionsState = {});
  const permissions = getRoleTabPermissions(normalizedRole);
  st.saving = true;

  try {
    const saved = await window.upsertCompanyRolePermissions?.(normalizedRole, permissions);
    st.items = st.items || {};
    st.items[normalizedRole] = {
      ...saved,
      role: normalizedRole,
      tab_permissions: normalizeRoleTabPermissions(normalizedRole, saved?.tab_permissions || permissions)
    };
    if (st.drafts && Object.prototype.hasOwnProperty.call(st.drafts, normalizedRole)) {
      delete st.drafts[normalizedRole];
    }
    window.appAuth.rolePermissions = st.items;
    refreshRoleAccessUI();
    toast('Uprawnienia zapisane', `Konfiguracja roli ${normalizedRole} została zaktualizowana.`, 'success');
  } catch (err) {
    console.error('Błąd zapisu konfiguracji ról:', err);
    toast('Nie zapisano konfiguracji', err?.message || 'Nie udało się zapisać konfiguracji roli.', 'error');
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
  const isOwner = isCurrentCompanyOwner();
  const isEditableRole = isOwner && ['admin', 'worker'].includes(selectedRole);
  const effectivePermissions = getRoleTabPermissions(selectedRole);
  const enabledCount = Object.values(effectivePermissions).filter(Boolean).length;
  const totalCount = APP_TABS.length;

  if (note) note.classList.toggle('hidden', isOwner);
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

  root.innerHTML = `
    <div class="role-permissions-summary">
      <div>
        <strong>${roleLabel}</strong>
        <div class="text-secondary" style="font-size:var(--text-sm)">Włączasz albo wyłączasz widoczność i wejście do zakładek dla roli ${escapeHtml(selectedRole)}.</div>
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
        ${hasDraft ? '<span class="badge badge-warning">Niezapisane zmiany</span>' : '<span class="badge badge-success">Zapisane</span>'}
        <strong>${enabledCount} / ${totalCount}</strong>
      </div>
    </div>
    <div class="role-permissions-grid">
      ${APP_TABS.map(tab => {
        const enabled = !!effectivePermissions[tab.id];
        return `
          <button
            type="button"
            class="role-permission-tile ${enabled ? 'is-enabled' : 'is-disabled'}"
            data-action="toggleRolePermissionTile"
            data-role="${escapeHtml(selectedRole)}"
            data-tab-id="${escapeHtml(tab.id)}"
            ${isEditableRole ? '' : 'disabled'}>
            <div class="role-permission-tile-head">
              <div class="role-permission-tile-title">
                <strong>${escapeHtml(tab.label)}</strong>
                <span>${escapeHtml(tab.description)}</span>
              </div>
              <span class="status-pill status-pill-${enabled ? 'success' : 'warning'}">${enabled ? 'Aktywna' : 'Wyłączona'}</span>
            </div>
            <div class="role-permission-tile-foot">
              <span>${escapeHtml(tab.id)}</span>
              <span>${isEditableRole ? 'Kliknij, aby przełączyć' : 'Tylko podgląd'}</span>
            </div>
          </button>
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

  applyRoleAccess();

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
    window.companyUsersState.error = err?.message || 'Nie udało się pobrać listy użytkowników.';
    throw err;
  } finally {
    window.companyUsersState.loading = false;
  }
}

function renderUsersAdmin() {
  const panel = document.querySelector('[data-tab-panel="users"]');
  const tbody = document.querySelector('#companyUsersTable tbody');
  const createBlock = document.getElementById('usersCreateBlock');
  if (!panel || !tbody) return;

  if (!canAccessTab('users')) {
    panel.classList.add('hidden');
    return;
  }

  const isOwner = isCurrentCompanyOwner();
  if (createBlock) createBlock.classList.toggle('hidden', !isOwner);

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

  const currentUserId = window.appAuth?.user?.id || null;

  tbody.innerHTML = items.map(item => {
    const rowRole = String(item.role || '').toLowerCase();
    const isOwnerRow = rowRole === 'owner';
    const isSelf = currentUserId && item.user_id === currentUserId;
    const canModify = isOwner && !isOwnerRow && !isSelf;
    const statusCls = item.is_active ? 'success' : 'warning';
    const statusLabel = item.is_active ? 'Aktywny' : 'Nieaktywny';
    const actionLabel = item.is_active ? 'Dezaktywuj' : 'Aktywuj';
    const nextActive = item.is_active ? '0' : '1';
    const roleBadgeClass = rowRole === 'owner' ? 'badge-accent' : rowRole === 'admin' ? 'badge-success' : 'badge';

    return `
      <tr>
        <td>
          <div class="user-email-cell">
            <strong>${escapeHtml(item.email || '—')}</strong>
            <span>${escapeHtml(item.full_name || (isSelf ? 'To konto' : ''))}</span>
          </div>
        </td>
        <td>
          ${isOwnerRow
            ? `<span class="badge ${roleBadgeClass}">owner</span>`
            : `<span class="user-role-inline"><select class="user-role-select" data-action="userRoleChange" data-member-id="${escapeHtml(String(item.id))}" ${canModify ? '' : 'disabled'}><option value="worker" ${rowRole === 'worker' ? 'selected' : ''}>worker</option><option value="admin" ${rowRole === 'admin' ? 'selected' : ''}>admin</option></select><button type="button" class="btn btn-secondary btn-sm" data-action="saveUserRole" data-member-id="${escapeHtml(String(item.id))}" ${canModify ? '' : 'disabled'}>Zapisz</button></span>`}
        </td>
        <td><span class="status-pill status-pill-${statusCls} user-status-pill">${statusLabel}</span></td>
        <td class="text-right">
          <div class="user-row-actions">
            ${isSelf ? '<span class="badge badge-muted">Twoje konto</span>' : ''}
            ${isOwnerRow ? '<span class="badge badge-accent">Owner</span>' : ''}
            <button type="button" class="btn btn-secondary btn-sm" data-action="toggleUserActive" data-member-id="${escapeHtml(String(item.id))}" data-next-active="${nextActive}" ${canModify ? '' : 'disabled'}>${actionLabel}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  renderRolePermissionsPanel();
}

function bindUserManagementUI() {
  if (window.__userManagementBound) return;
  window.__userManagementBound = true;

  document.getElementById('refreshUsersBtn')?.addEventListener('click', async () => {
    if (!canAccessTab('users')) return;
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
      toast('Błąd użytkowników', err?.message || 'Nie udało się odświeżyć zakładki użytkowników.', 'error');
    }
  });

  document.getElementById('createWorkerBtn')?.addEventListener('click', async () => {
    if (!canAccessTab('users')) return;
    if (!isCurrentCompanyOwner()) {
      toast('Brak dostępu', 'Tylko owner może tworzyć nowych użytkowników.', 'warning');
      return;
    }

    const emailInput = document.getElementById('createWorkerEmailInput');
    const passwordInput = document.getElementById('createWorkerPasswordInput');
    const roleSelect = document.getElementById('createWorkerRoleSelect');

    const email = String(emailInput?.value || '').trim().toLowerCase();
    const password = String(passwordInput?.value || '');
    const role = String(roleSelect?.value || 'worker').trim().toLowerCase() || 'worker';

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
        email,
        password,
        role
      });

      if (emailInput) emailInput.value = '';
      if (passwordInput) passwordInput.value = '';
      if (roleSelect) roleSelect.value = 'worker';

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
        err?.message || 'Nie udało się utworzyć konta użytkownika.',
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

    const toggleTileBtn = e.target?.closest?.('[data-action="toggleRolePermissionTile"]');
    if (toggleTileBtn) {
      if (!isCurrentCompanyOwner()) {
        toast('Brak dostępu', 'Tylko owner może zmieniać konfigurację ról.', 'warning');
        return;
      }
      toggleRolePermissionDraft(
        toggleTileBtn.getAttribute('data-role'),
        toggleTileBtn.getAttribute('data-tab-id')
      );
      return;
    }

    const saveRoleBtn = e.target?.closest?.('[data-action="saveUserRole"]');
    if (saveRoleBtn) {
      if (!canAccessTab('users')) return;
      if (!isCurrentCompanyOwner()) {
        toast('Brak dostępu', 'Tylko owner może zmieniać role użytkowników.', 'warning');
        return;
      }
      const memberId = saveRoleBtn.getAttribute('data-member-id');
      const select = document.querySelector(`[data-action="userRoleChange"][data-member-id="${CSS.escape(memberId)}"]`);
      const nextRole = String(select?.value || 'worker').trim().toLowerCase();
      if (!['worker', 'admin'].includes(nextRole)) {
        toast('Nieprawidłowa rola', 'Można ustawić tylko rolę worker albo admin.', 'warning');
        return;
      }
      try {
        await window.updateCompanyMember?.(memberId, { role: nextRole });
        await loadCompanyUsers();
        renderUsersAdmin();
        toast('Rola zapisana', 'Zmiana roli została zapisana.', 'success');
      } catch (err) {
        console.error('Błąd zmiany roli:', err);
        toast('Nie zapisano roli', err?.message || 'Nie udało się zmienić roli.', 'error');
      }
      return;
    }

    const toggleActiveBtn = e.target?.closest?.('[data-action="toggleUserActive"]');
    if (toggleActiveBtn) {
      if (!canAccessTab('users')) return;
      if (!isCurrentCompanyOwner()) {
        toast('Brak dostępu', 'Tylko owner może zmieniać status użytkowników.', 'warning');
        return;
      }
      const memberId = toggleActiveBtn.getAttribute('data-member-id');
      const nextActive = toggleActiveBtn.getAttribute('data-next-active') === '1';
      try {
        await window.updateCompanyMember?.(memberId, { is_active: nextActive });
        await loadCompanyUsers();
        renderUsersAdmin();
        toast(nextActive ? 'Użytkownik aktywowany' : 'Użytkownik dezaktywowany', 'Status użytkownika został zaktualizowany.', 'success');
      } catch (err) {
        console.error('Błąd zmiany statusu użytkownika:', err);
        toast('Nie zapisano statusu', err?.message || 'Nie udało się zmienić statusu użytkownika.', 'error');
      }
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

  setAuthLocked(!loggedIn);

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

  if (panelStatusText) panelStatusText.textContent = "ZALOGOWANO";
  if (panelCompanyName) panelCompanyName.textContent = companyName;
  if (accountEmailDisplay) accountEmailDisplay.textContent = email;
  if (accountCompanyDisplay) accountCompanyDisplay.textContent = companyName;
  if (accountRoleDisplay) accountRoleDisplay.textContent = String(role).toUpperCase();
  setAuthError("");
  setAccountPasswordError("");
  if (loggedIn) applyRoleAccess();
}

async function ensureAuthSession() {
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
      setAuthError(err?.message || "Nie udało się zalogować.");
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
      const msg = err?.message || "Nie udało się zmienić hasła.";
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
      setAuthError(err?.message || "Nie udało się wylogować.");
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
      updateAuthUI();
      if (window.appAuth?.session) {
        refreshRoleAccessUI();
      }

      const hasSession = !!window.appAuth?.session;
      if (hasSession && !window.__appInitialized) {
        await init();
        return;
      }

      if (!hasSession) {
        window.__appInitialized = false;
        closeAccountSettings();
        passwordInput && (passwordInput.value = "");
      }
    })().catch((err) => {
      console.error("Auth state change handler error:", err);
      setAuthLocked(true);
      setAuthError("Wystąpił błąd podczas przełączania sesji użytkownika.");
    });
  });
}

async function init() {
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
  setActiveTab(getDefaultTabForRole());
  window.__appInitialized = true;
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

window.togglePartArchive = (sku) => {
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

  refreshCatalogsUI();
  renderWarehouse();
  renderDelivery();
  renderBuild();
  renderMachinesStock();
  toast(willArchive ? "Zarchiwizowano część" : "Przywrócono część", result.msg, "success");
};

document.getElementById("addSupplierBtn")?.addEventListener("click", () => {
  const name = document.getElementById("supplierNameInput")?.value ?? "";
  const added = addSupplier(name);
  if (added) {
    document.getElementById("supplierNameInput").value = "";
  }
});

window.toggleSupplierArchive = (name) => {
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

  renderAllSuppliers();
  refreshCatalogsUI();
  renderDelivery();
  toast(willArchive ? "Zarchiwizowano dostawcę" : "Przywrócono dostawcę", result.msg, "success");
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

window.toggleMachineArchive = (code) => {
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

  refreshCatalogsUI();
  renderBuild();
  renderMachinesStock();
  toast(willArchive ? "Zarchiwizowano maszynę" : "Przywrócono maszynę", result.msg, "success");
};

window.openSupplierEditor = (name) => {
  editingSup = name;
  const originalSup = state.suppliers.get(name);
  editingSupSnapshot = originalSup ? {
    name,
    archived: !!originalSup?.archived,
    prices: new Map(originalSup.prices || [])
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
    state.suppliers.set(editingSup, {
      archived: !!editingSupSnapshot?.archived,
      prices: new Map(editingSupSnapshot.prices || [])
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

  if (editingMachineIsNew) {
    state.machineCatalog.push({
      code,
      name,
      archived: false,
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
        archived: !!state.machineCatalog[idx]?.archived,
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

  const originalPart = state.partsCatalog.get(originalK);
  const originalArchived = !!originalPart?.archived;

  state.partsCatalog.delete(originalK);
  state.partsCatalog.set(k, {
    sku,
    name,
    yellowThreshold: thresholds.yellowThreshold,
    redThreshold: thresholds.redThreshold,
    archived: originalArchived
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
document.addEventListener('DOMContentLoaded', () => { init().catch(err => console.error("Init error:", err)); });
