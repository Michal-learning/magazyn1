// === UI: Renderers and Components ===

// Defensive element cache
const getEls = () => ({
  summaryTable: document.querySelector("#skuSummaryTable tbody"),
  whTotal: document.getElementById("warehouseTotal"),
  deliveryItems: document.querySelector("#deliveryItemsTable tbody"),
  buildItems: document.querySelector("#buildItemsTable tbody"),
  missingBox: document.getElementById("missingBox"),
  manualBox: document.getElementById("manualConsumeBox"),
  partsCatalog: document.querySelector("#partsCatalogTable tbody"),
  suppliersList: document.querySelector("#suppliersListTable tbody"),
  machinesCatalog: document.querySelector("#machinesCatalogTable tbody"),
  machineSelect: document.getElementById('machineSelect'),
  sideWarehouseTotal: document.getElementById('sideWarehouseTotal'),
  sideMissingSignals: document.getElementById('sideMissingSignals'),
  sideRecentActions: document.getElementById('sideRecentActions'),
});

// HTML escaping
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


const TABLE_PAGE_SIZE = 50;

function ensureTablePaginationState() {
  if (!state.ui || typeof state.ui !== 'object') state.ui = {};
  if (!state.ui.tablePagination || typeof state.ui.tablePagination !== 'object') {
    state.ui.tablePagination = {};
  }
  return state.ui.tablePagination;
}

function getTablePage(tableKey) {
  const pagination = ensureTablePaginationState();
  const raw = Number(pagination[tableKey]);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function resetTablePage(tableKey) {
  const pagination = ensureTablePaginationState();
  pagination[tableKey] = 1;
  return 1;
}

function clampTablePage(tableKey, totalPages) {
  const pagination = ensureTablePaginationState();
  const safeTotalPages = Math.max(1, Number(totalPages) || 1);
  const nextPage = Math.min(Math.max(getTablePage(tableKey), 1), safeTotalPages);
  pagination[tableKey] = nextPage;
  return nextPage;
}

function getPaginationRenderer(tableKey) {
  const renderers = {
    warehouse_parts: () => renderWarehouse(),
    history: () => renderHistory(),
    catalog_parts: () => refreshCatalogsUI(),
    catalog_suppliers: () => renderAllSuppliers(),
    catalog_machines: () => refreshCatalogsUI(),
    warehouse_machines: () => renderMachinesStock()
  };
  return renderers[tableKey] || null;
}

function changeTablePage(tableKey, delta) {
  const pagination = ensureTablePaginationState();
  const current = getTablePage(tableKey);
  pagination[tableKey] = Math.max(1, current + Number(delta || 0));
  const rerender = getPaginationRenderer(tableKey);
  if (typeof rerender === 'function') rerender();
}

window.changeTablePage = changeTablePage;
window.resetTablePage = resetTablePage;

function paginateTableRows(tableKey, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const totalPages = Math.max(1, Math.ceil(list.length / TABLE_PAGE_SIZE));
  const page = list.length <= TABLE_PAGE_SIZE
    ? resetTablePage(tableKey)
    : clampTablePage(tableKey, totalPages);
  const start = (page - 1) * TABLE_PAGE_SIZE;

  return {
    rows: list.slice(start, start + TABLE_PAGE_SIZE),
    page,
    totalPages,
    totalRows: list.length,
    isEnabled: totalPages > 1
  };
}

function getTablePaginationMount(tableElement) {
  if (!tableElement) return null;
  const host = tableElement.closest('.table-container') || tableElement.parentElement;
  if (!host || !host.parentElement) return null;

  const tableId = tableElement.id || host.getAttribute('data-pagination-table-id') || '';
  if (!tableId) return null;

  const shell = host.parentElement;
  const card = tableElement.closest('.card');

  host.setAttribute('data-pagination-table-id', tableId);
  host.classList.add('table-scroll-paginated-host');
  shell.classList.add('table-section-shell', 'table-section-shell-paginated');
  shell.setAttribute('data-pagination-shell', tableId);

  if (card) {
    card.classList.add('table-section-card', 'table-section-card-paginated');
    card.setAttribute('data-pagination-card', tableId);
  }

  let mount = host.nextElementSibling;
  if (!mount || !mount.classList?.contains('table-pagination')) {
    mount = document.createElement('div');
    mount.className = 'table-pagination';
    host.insertAdjacentElement('afterend', mount);
  }

  mount.classList.add('table-pagination-stable');
  mount.setAttribute('data-pagination-for', tableId);
  return mount;
}

function renderTablePagination(tableSelector, tableKey, meta) {
  const tableElement = document.querySelector(tableSelector);
  if (!tableElement) return;

  const mount = getTablePaginationMount(tableElement);
  if (!mount) return;

  const totalPages = Math.max(1, Number(meta?.totalPages) || 1);
  const page = Math.min(Math.max(Number(meta?.page) || 1, 1), totalPages);

  mount.classList.remove('hidden');
  mount.innerHTML = `
    <div class="table-pagination-inner" aria-label="Paginacja tabeli">
      <button type="button" class="table-pagination-btn" aria-label="Poprzednia strona" ${page <= 1 ? 'disabled' : ''} onclick="changeTablePage('${escapeHtml(tableKey)}', -1)">&lt;</button>
      <span class="table-pagination-label">Strona ${page} z ${totalPages}</span>
      <button type="button" class="table-pagination-btn" aria-label="Następna strona" ${page >= totalPages ? 'disabled' : ''} onclick="changeTablePage('${escapeHtml(tableKey)}', 1)">&gt;</button>
    </div>
  `;
}



function ensureToastHost() {
  if (typeof document === 'undefined') return null;
  let host = document.querySelector('.toast-host');
  if (host) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  document.body.appendChild(host);
  return host;
}

function getToastIcon(type) {
  if (type === 'success') return '✓';
  if (type === 'warning') return '!';
  if (type === 'error') return '×';
  return 'i';
}

function toast(title, message = '', type = 'success', opts = {}) {
  const host = ensureToastHost();
  if (!host) return null;

  const variant = ['success', 'warning', 'error'].includes(type) ? type : 'success';
  const duration = Number.isFinite(opts?.duration) ? Math.max(1200, opts.duration) : 3200;

  const el = document.createElement('div');
  el.className = `toast toast-${variant}`;
  el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', variant === 'error' ? 'assertive' : 'polite');

  const safeTitle = escapeHtml(title || 'Powiadomienie');
  const safeMessage = escapeHtml(message || '');

  el.innerHTML = `
    <div class="toast-icon" aria-hidden="true">${getToastIcon(variant)}</div>
    <div class="toast-content">
      <div class="toast-title">${safeTitle}</div>
      ${safeMessage ? `<div class="toast-message">${safeMessage}</div>` : ''}
    </div>
  `;

  host.appendChild(el);

  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add('toast-out');
    window.setTimeout(() => {
      try { el.remove(); } catch {}
    }, 220);
  };

  const timer = window.setTimeout(remove, duration);
  el.addEventListener('click', () => {
    window.clearTimeout(timer);
    remove();
  });

  return el;
}

// Part details modal state
let currentPartDetailsSku = null;

function computePartsSummary(options = {}) {
  const includeArchived = options.includeArchived !== false;
  const summary = new Map();

  for (const [key, part] of (state.partsCatalog || new Map()).entries()) {
    if (!key || !part) continue;
    if (!includeArchived && part?.archived) continue;
    summary.set(key, {
      sku: part.sku,
      name: part.name,
      qty: 0,
      value: 0
    });
  }

  (state.lots || []).forEach(lot => {
    const key = skuKey(lot.sku);
    const catalogPart = state.partsCatalog.get(key);
    if (!includeArchived && catalogPart?.archived) return;

    const prev = summary.get(key) || { sku: lot.sku, name: lot.name, qty: 0, value: 0 };
    prev.qty += safeQtyInt(lot.qty);
    prev.value += safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0);
    prev.name = lot.name || prev.name;
    summary.set(key, prev);
  });
  return Array.from(summary.values());
}

function renderSideMissingTop5() {
  const els = getEls();
  if (!els.sideMissingSignals) return;

  const rows = computePartsSummary({ includeArchived: shouldShowArchivedPartsInWarehouse() })
    .map(r => ({ ...r, statusMeta: getPartStockStatus(r.sku, r.qty) }))
    .filter(r => r.statusMeta.level === "warning" || r.statusMeta.level === "danger")
    .sort((a, b) => {
      const levelOrder = { danger: 0, warning: 1, success: 2 };
      const levelDiff = (levelOrder[a.statusMeta.level] ?? 9) - (levelOrder[b.statusMeta.level] ?? 9);
      if (levelDiff !== 0) return levelDiff;
      if (a.qty !== b.qty) return a.qty - b.qty;
      return String(a.sku).localeCompare(String(b.sku), "pl");
    })
    .slice(0, 5);

  if (!rows.length) {
    els.sideMissingSignals.innerHTML = `<div class="text-muted" style="font-size:var(--text-sm);padding:var(--space-3);text-align:center">Brak alertów</div>`;
    return;
  }

  els.sideMissingSignals.innerHTML = rows.map(r => {
    const statusMeta = r.statusMeta || getPartStockStatus(r.sku, r.qty);
    const cls = statusMeta.level;
    const status = statusMeta.label;

    return `
      <button class="signal-row" type="button" data-sku="${escapeHtml(String(r.sku))}" 
              aria-label="Przejdź do części ${escapeHtml(String(r.sku))}">
        <div class="signal-info">
          <span class="badge badge-${cls}">${escapeHtml(String(r.sku))}</span>
          <span class="signal-name" title="${escapeHtml(String(r.name))}">${escapeHtml(String(r.name))}</span>
        </div>
        <div class="signal-meta">
          <span class="status-pill status-pill-${cls}">${status}</span>
          <span class="signal-qty">${Number.isFinite(r.qty) ? r.qty : 0}</span>
        </div>
      </button>
    `;
  }).join("");
}

function renderSideRecentActions5() {
  const els = getEls();
  if (!els.sideRecentActions) return;

  const rows = (state.history || [])
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 5);

  if (!rows.length) {
    els.sideRecentActions.innerHTML = `<li class="text-muted" style="font-size:var(--text-sm);padding:var(--space-3);text-align:center">Brak akcji</li>`;
    return;
  }

  els.sideRecentActions.innerHTML = rows.map(ev => {
    const typeLabel = ev.type === "delivery" ? "Dostawa" : ev.type === "build" ? "Produkcja" : "Korekta";
    const pillClass = ev.type === "delivery" ? "success" : ev.type === "build" ? "accent" : "warning";

    const meta = ev.type === "delivery"
      ? `${(ev.items || []).length} poz. • ${ev.supplier || "—"}`
      : ev.type === "build"
        ? `${(ev.items || []).length} poz.`
        : `${(ev.items || []).length} części • inwentaryzacja`;

    return `
      <li>
        <button
          class="signal-row signal-row-history"
          type="button"
          data-action="toggleHistory"
          data-hid="${escapeHtml(String(ev.id))}"
          aria-label="Otwórz podgląd akcji z dnia ${escapeHtml(String(fmtDateISO(ev.dateISO) || '—'))}">
          <div class="signal-info signal-info-history">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-2);margin-bottom:var(--space-1)">
              <span class="badge badge-${pillClass}">${typeLabel}</span>
              <span class="text-muted" style="font-size:var(--text-sm)">${fmtDateISO(ev.dateISO)}</span>
            </div>
            <div class="text-secondary" style="font-size:var(--text-sm)">${escapeHtml(meta)}</div>
          </div>
        </button>
      </li>
    `;
  }).join("");
}

function renderSidePanel() {
  renderSideMissingTop5();
  renderSideRecentActions5();
}

// === NEW: Part Details Modal Functions ===

function openPartDetailsModal(sku) {
  const skuKeyVal = skuKey(sku);
  const part = state.partsCatalog.get(skuKeyVal);
  if (!part) return;

  currentPartDetailsSku = sku;

  // Get all lots for this part
  const lots = (state.lots || []).filter(l => skuKey(l.sku) === skuKeyVal);
  
  // Group by price (ignoring supplier at this stage)
  const priceGroups = new Map();
  lots.forEach(lot => {
    const price = safeFloat(lot.unitPrice || 0);
    const priceKey = String(price);
    if (!priceGroups.has(priceKey)) {
      priceGroups.set(priceKey, { price, lots: [], totalQty: 0, totalValue: 0 });
    }
    const group = priceGroups.get(priceKey);
    group.lots.push(lot);
    group.totalQty += safeQtyInt(lot.qty);
    group.totalValue += safeQtyInt(lot.qty) * price;
  });

  // Calculate totals
  const totalQty = lots.reduce((sum, l) => sum + safeQtyInt(l.qty), 0);
  const totalValue = lots.reduce((sum, l) => sum + safeQtyInt(l.qty) * safeFloat(l.unitPrice || 0), 0);
  const uniquePrices = priceGroups.size;
  const batchCount = lots.length;

  // Update header
  const titleEl = document.getElementById("partDetailsTitle");
  const subtitleEl = document.getElementById("partDetailsSubtitle");
  if (titleEl) titleEl.textContent = part.sku;
  if (subtitleEl) subtitleEl.textContent = part.name;

  // Update stats
  const statsEl = document.getElementById("partDetailsStats");
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="history-stat-card">
        <span class="history-stat-label">Całkowity stan</span>
        <strong class="history-stat-value">${totalQty} szt.</strong>
      </div>
      <div class="history-stat-card">
        <span class="history-stat-label">Wartość całkowita</span>
        <strong class="history-stat-value">${fmtPLN.format(totalValue)}</strong>
      </div>
      <div class="history-stat-card">
        <span class="history-stat-label">Liczba cen</span>
        <strong class="history-stat-value">${uniquePrices}</strong>
      </div>
      <div class="history-stat-card">
        <span class="history-stat-label">Liczba partii</span>
        <strong class="history-stat-value">${batchCount}</strong>
      </div>
    `;
  }

  // Update price variants table
  const variantsEl = document.getElementById("partDetailsPriceVariants");
  if (variantsEl) {
    const sortedGroups = Array.from(priceGroups.values()).sort((a, b) => a.price - b.price);
    
    if (sortedGroups.length === 0) {
      variantsEl.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:var(--space-4)">Brak partii na magazynie</td></tr>`;
    } else {
      variantsEl.innerHTML = sortedGroups.map(group => {
        const batchCount = group.lots.length;
        const correctionLots = group.lots.filter(lot => normalize(lot?.supplier) === "Korekta stanu").length;
        return `
          <tr>
            <td>
              <strong>${fmtPLN.format(group.price)}</strong>
              ${correctionLots > 0 ? `<div class="lot-origin-note">W tym korekty: ${correctionLots}</div>` : ``}
            </td>
            <td class="text-right">${group.totalQty}</td>
            <td class="text-right">${fmtPLN.format(group.totalValue)}</td>
            <td class="text-right">
              <span class="badge">${batchCount}</span>
              ${correctionLots > 0 ? `<span class="lot-origin-badge">korekta</span>` : ``}
            </td>
            <td class="text-right">
              <button class="btn btn-secondary btn-sm" type="button"
                data-action="openBatchPreviewByPrice"
                data-sku="${escapeHtml(sku)}"
                data-price="${group.price}">
                Podgląd
              </button>
            </td>
          </tr>
        `;
      }).join("");
    }
  }

  // Show modal
  const backdrop = document.getElementById("partDetailsBackdrop");
  const panel = document.getElementById("partDetailsPanel");
  if (backdrop && panel) {
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    panel.classList.remove("hidden");
    document.body.classList.add("part-details-open");
  }
}

function closePartDetailsModal() {
  const backdrop = document.getElementById("partDetailsBackdrop");
  const panel = document.getElementById("partDetailsPanel");
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
  }
  if (panel) panel.classList.add("hidden");
  document.body.classList.remove("part-details-open");
  currentPartDetailsSku = null;
}

// === NEW: Batch Preview by Price (with supplier breakdown) ===

function syncWarehouseToggleButtonState(button, isActive) {
  if (!button) return;
  button.classList.toggle("is-active", !!isActive);
  button.setAttribute("aria-pressed", isActive ? "true" : "false");
}

function openBatchPreviewByPrice(sku, price) {
  const skuKeyVal = skuKey(sku);
  const part = state.partsCatalog.get(skuKeyVal);
  if (!part) return;

  // Get lots for this part with this specific price
  const lots = (state.lots || [])
    .filter(l => skuKey(l.sku) === skuKeyVal && Math.abs(safeFloat(l.unitPrice || 0) - price) < 0.001)
    .sort((a, b) => (a.id || 0) - (b.id || 0));

  if (!lots.length) return;

  // Group by supplier
  const supplierGroups = new Map();
  lots.forEach(lot => {
    const sup = lot.supplier || "-";
    if (!supplierGroups.has(sup)) {
      supplierGroups.set(sup, { supplier: sup, lots: [], totalQty: 0, totalValue: 0 });
    }
    const group = supplierGroups.get(sup);
    group.lots.push(lot);
    group.totalQty += safeQtyInt(lot.qty);
    group.totalValue += safeQtyInt(lot.qty) * price;
  });

  const totalQty = lots.reduce((sum, l) => sum + safeQtyInt(l.qty), 0);
  const totalValue = lots.reduce((sum, l) => sum + safeQtyInt(l.qty) * price, 0);

  // Build supplier sections
  const supplierSections = Array.from(supplierGroups.values()).map(supGroup => {
    const isAdjustmentSource = normalize(supGroup.supplier) === "Korekta stanu";
    const rows = supGroup.lots.map(lot => `
      <tr>
        <td style="white-space:nowrap">
          Partia #${lot.id ?? "—"}
          ${normalize(lot?.supplier) === "Korekta stanu" ? `<span class="lot-origin-badge">korekta</span>` : ``}
        </td>
        <td>${escapeHtml(fmtDateISO(lot.dateIn) || "—")}</td>
        <td class="text-right">${safeQtyInt(lot.qty)}</td>
        <td class="text-right">${fmtPLN.format(safeQtyInt(lot.qty) * price)}</td>
      </tr>
    `).join("");

    return `
      <div class="batch-supplier-section" style="margin-bottom:var(--space-4)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--surface-2);border-radius:var(--radius-md)">
          <span class="badge ${isAdjustmentSource ? 'badge-warning' : 'badge-success'}">${escapeHtml(supGroup.supplier)}</span>
          <span class="text-secondary" style="font-size:var(--text-sm)">${supGroup.totalQty} szt. • ${fmtPLN.format(supGroup.totalValue)}</span>
        </div>
        <div class="table-container" style="margin:0">
          <table class="batch-preview-table table-dense">
            <thead>
              <tr><th>Partia</th><th>Data przyjęcia</th><th class="text-right">Ilość</th><th class="text-right">Wartość</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");

  const content = document.getElementById("batchPreviewContent");
  if (content) {
    content.innerHTML = `
      <div class="batch-preview-head">
        <div>
          <div class="batch-preview-kicker">
            <span class="badge badge-accent">Podgląd partii</span>
            <span>${fmtPLN.format(price)} / szt.</span>
          </div>
          <h3 class="batch-preview-title">${escapeHtml(part.sku)}</h3>
          <p class="batch-preview-subtitle">${escapeHtml(part.name)} • Podział na dostawców i partie korekcyjne</p>
        </div>
      </div>

      <div class="batch-preview-stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="history-stat-card">
          <span class="history-stat-label">Dostawców</span>
          <strong class="history-stat-value">${supplierGroups.size}</strong>
        </div>
        <div class="history-stat-card">
          <span class="history-stat-label">Łączna ilość</span>
          <strong class="history-stat-value">${totalQty} szt.</strong>
        </div>
        <div class="history-stat-card">
          <span class="history-stat-label">Łączna wartość</span>
          <strong class="history-stat-value">${fmtPLN.format(totalValue)}</strong>
        </div>
      </div>

      <div class="batch-preview-section">
        <div class="batch-preview-section-head">
          <div><h4>Partie według dostawców</h4><p>Szczegółowy podział partii dla wybranej ceny.</p></div>
        </div>
        ${supplierSections}
      </div>
    `;
  }

  // Show modal
  const backdrop = document.getElementById("batchPreviewBackdrop");
  const panel = document.getElementById("batchPreviewPanel");
  if (backdrop && panel) {
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    panel.classList.remove("hidden");
    document.body.classList.add("batch-preview-open");
  }
}

function closeBatchPreviewModal() {
  const backdrop = document.getElementById("batchPreviewBackdrop");
  const panel = document.getElementById("batchPreviewPanel");
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
  }
  if (panel) panel.classList.add("hidden");
  document.body.classList.remove("batch-preview-open");
}

function renderWarehouse() {
  const els = getEls();
  if (!els.summaryTable) return;

  if (typeof enforceFeaturePermissionSafeStates === 'function') {
    enforceFeaturePermissionSafeStates();
  }

  const canThresholdsManage = typeof canManageCompanyThresholds === 'function' ? canManageCompanyThresholds() : true;
  const canStockAdjustmentsManage = typeof canManageStockAdjustments === 'function' ? canManageStockAdjustments() : true;
  const thresholdsBtn = document.getElementById("toggleThresholdsBtn");
  const thresholdsPanel = document.getElementById("thresholdsPanel");
  const warnRange = document.getElementById("warnRange");
  const dangerRange = document.getElementById("dangerRange");
  const searchInput = document.getElementById("searchParts");
  const q = normalize(searchInput?.value).toLowerCase();
  const stockEditToggleBtn = document.getElementById("stockEditToggleBtn");
  const stockEditActions = document.getElementById("stockEditActions");
  const stockEditBanner = document.getElementById("stockEditBanner");
  const showArchivedToggle = document.getElementById("showArchivedPartsToggle");
  const showOnlyAlertsToggle = document.getElementById("showOnlyAlertsPartsToggle");
  const isEditMode = !!state.ui?.stockEditMode;
  const pendingMap = state.ui?.pendingStockAdjustments || {};
  const showArchived = shouldShowArchivedPartsInWarehouse();
  const showOnlyAlerts = shouldShowOnlyAlertsPartsInWarehouse();

  syncWarehouseToggleButtonState(showArchivedToggle, showArchived);
  syncWarehouseToggleButtonState(showOnlyAlertsToggle, showOnlyAlerts);
  if (thresholdsBtn) {
    thresholdsBtn.classList.toggle("hidden", !canThresholdsManage);
    thresholdsBtn.setAttribute('aria-hidden', canThresholdsManage ? 'false' : 'true');
    thresholdsBtn.disabled = !canThresholdsManage;
    thresholdsBtn.setAttribute('aria-disabled', canThresholdsManage ? 'false' : 'true');
  }
  if (warnRange) warnRange.disabled = !canThresholdsManage;
  if (dangerRange) dangerRange.disabled = !canThresholdsManage;
  if (thresholdsPanel) {
    thresholdsPanel.classList.toggle('permissions-readonly', !canThresholdsManage);
    if (!canThresholdsManage) {
      thresholdsPanel.classList.add('collapsed');
      thresholdsPanel.setAttribute('aria-hidden', 'true');
      thresholdsBtn?.setAttribute('aria-expanded', 'false');
      thresholdsBtn?.classList.remove('is-active');
    }
  }

  const totalValueRows = computePartsSummary({ includeArchived: false });
  const summaryRows = computePartsSummary({ includeArchived: showArchived }).filter(item => {
    if (q) {
      const matchesSearch = String(item?.sku || '').toLowerCase().includes(q) || String(item?.name || '').toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }

    if (!showOnlyAlerts) return true;

    const pending = pendingMap[skuKey(item.sku)];
    const effectiveQty = pending?.invalid === true
      ? item.qty
      : Number.isFinite(pending?.newQty)
        ? safeQtyInt(pending.newQty)
        : item.qty;
    const statusMeta = getPartStockStatus(item.sku, effectiveQty);
    return statusMeta.level === "warning" || statusMeta.level === "danger";
  });
  let grandTotal = 0;

  totalValueRows.forEach(item => { grandTotal += item.value; });
  const totalFormatted = fmtPLN.format(grandTotal);

  if (els.sideWarehouseTotal) els.sideWarehouseTotal.textContent = totalFormatted;
  if (els.whTotal) els.whTotal.textContent = totalFormatted;

  if (stockEditToggleBtn) {
    stockEditToggleBtn.classList.toggle("hidden", isEditMode || !canStockAdjustmentsManage);
    stockEditToggleBtn.setAttribute('aria-hidden', (!isEditMode && canStockAdjustmentsManage) ? 'false' : 'true');
    stockEditToggleBtn.disabled = !canStockAdjustmentsManage;
    stockEditToggleBtn.setAttribute('aria-disabled', canStockAdjustmentsManage ? 'false' : 'true');
  }
  if (stockEditActions) {
    stockEditActions.classList.toggle("hidden", !isEditMode);
    stockEditActions.querySelectorAll('button').forEach(btn => {
      btn.disabled = !canStockAdjustmentsManage;
    });
  }
  if (stockEditBanner) {
    if (isEditMode) {
      stockEditBanner.classList.remove("hidden");
      const changedCount = Object.values(pendingMap).filter(item => {
        return item && item.invalid !== true && safeQtyInt(item.newQty) !== safeQtyInt(item.previousQty);
      }).length;
      stockEditBanner.innerHTML = `
        <div>
          <strong>Tryb korekty stanów aktywny</strong>
          <div class="history-adjustment-note">Wpisujesz stan docelowy dla części. Zmiany zapiszą się dopiero po zbiorczym zatwierdzeniu.</div>
        </div>
        <div class="badge badge-accent">Zmodyfikowane: ${changedCount}</div>
      `;
    } else {
      stockEditBanner.classList.add("hidden");
      stockEditBanner.innerHTML = "";
    }
  }

  const sortedSummaryRows = summaryRows
    .slice()
    .sort((a, b) => (safeQtyInt(a.qty) - safeQtyInt(b.qty)) || String(a.sku).localeCompare(String(b.sku), 'pl'));
  const paginatedSummary = paginateTableRows('warehouse_parts', sortedSummaryRows);

  els.summaryTable.innerHTML = paginatedSummary.rows
    .map(item => {
      const pending = pendingMap[skuKey(item.sku)];
      const isInvalid = !!pending?.invalid;
      const diff = isInvalid ? null : Number.isFinite(pending?.diff) ? pending.diff : 0;
      const effectiveQty = isInvalid ? item.qty : Number.isFinite(pending?.newQty) ? safeQtyInt(pending.newQty) : item.qty;
      const isArchived = isPartArchived(item.sku);
      const statusMeta = getPartStockStatus(item.sku, effectiveQty);
      const rowClass = [
        !isArchived && statusMeta.level === "danger" ? "stock-row-danger" : !isArchived && statusMeta.level === "warning" ? "stock-row-warning" : "",
        pending && !isInvalid && diff !== 0 ? "stock-edit-row-changed" : "",
        isInvalid ? "stock-edit-row-invalid" : ""
      ].filter(Boolean).join(" ");

      const stockCell = !isEditMode
        ? `${item.qty}`
        : `
          <div class="stock-edit-stack">
            <input
              type="number"
              class="stock-edit-input ${isInvalid ? "input-invalid" : ""}"
              min="0"
              step="1"
              inputmode="numeric"
              data-action="stockEditInput"
              data-sku="${escapeHtml(item.sku)}"
              value="${escapeHtml(pending?.rawValue ?? String(item.qty))}"
              aria-label="Docelowy stan dla części ${escapeHtml(item.sku)}"
              ${canStockAdjustmentsManage ? '' : 'disabled'}
            />
            <div class="stock-edit-meta">
              <span class="text-muted">Było: ${item.qty}</span>
              <span class="adjustment-diff ${isInvalid ? "adjustment-diff-invalid" : diff > 0 ? "adjustment-diff-plus" : diff < 0 ? "adjustment-diff-minus" : "adjustment-diff-zero"}">
                ${isInvalid ? "Błąd" : diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : "0"}
              </span>
            </div>
          </div>
        `;

      return `
        <tr class="${rowClass}">
          <td><span class="badge">${escapeHtml(item.sku)}</span></td>
          <td>${escapeHtml(item.name || "")}</td>
          <td class="text-right stock-edit-cell">${stockCell}</td>
          <td class="text-right">${fmtPLN.format(item.value)}</td>
          <td>${isArchived ? '<span class="badge badge-muted badge-status-warning">ZARCHIWIZOWANE</span>' : '<span class="catalog-status-empty" aria-hidden="true"></span>'}</td>
          <td class="text-right">
            <button class="btn btn-secondary btn-sm" type="button"
              data-action="openPartDetails"
              data-sku="${escapeHtml(item.sku)}">
              Szczegóły
            </button>
          </td>
        </tr>
      `;
    }).join("");

  renderTablePagination('#skuSummaryTable', 'warehouse_parts', paginatedSummary);
  renderSidePanel();
}

function isDeliveryFinalizationBusy() {
  return !!_finalizeDeliveryBusy;
}

function isBuildFinalizationBusy() {
  return !!_finalizeBuildBusy;
}

function syncDeliveryBusyState() {
  const busy = isDeliveryFinalizationBusy();
  const ids = [
    "finalizeDeliveryBtn",
    "addDeliveryItemBtn",
    "supplierSelect",
    "supplierPartsSelect",
    "deliveryQty",
    "deliveryPrice",
    "deliveryDate",
    "deliveryInvoiceNumber"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = busy;
    el.setAttribute("aria-disabled", busy ? "true" : "false");
  });

  document.querySelectorAll('#deliveryItemsTable button[aria-label="Usuń"]').forEach(btn => {
    btn.disabled = busy;
    btn.setAttribute("aria-disabled", busy ? "true" : "false");
  });

  if (typeof refreshComboFromSelect === "function") {
    try { refreshComboFromSelect(document.getElementById("supplierSelect"), { placeholder: "Wybierz dostawcę..." }); } catch {}
    try { refreshComboFromSelect(document.getElementById("supplierPartsSelect"), { placeholder: "Wybierz część..." }); } catch {}
  }
}

function syncBuildBusyState() {
  const busy = isBuildFinalizationBusy();
  const ids = [
    "finalizeBuildBtn",
    "addBuildItemBtn",
    "machineSelect",
    "buildQty",
    "buildDate",
    "consumeMode"
  ];

  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = busy;
    el.setAttribute("aria-disabled", busy ? "true" : "false");
  });

  document.querySelectorAll('#buildItemsTable button[aria-label="Usuń"]').forEach(btn => {
    btn.disabled = busy;
    btn.setAttribute("aria-disabled", busy ? "true" : "false");
  });

  document.querySelectorAll(".manual-lot-input").forEach(input => {
    input.disabled = busy;
    input.setAttribute("aria-disabled", busy ? "true" : "false");
  });

  if (typeof refreshComboFromSelect === "function") {
    try { refreshComboFromSelect(document.getElementById("machineSelect"), { placeholder: "Wybierz maszynę..." }); } catch {}
  }
}

function renderDelivery() {
  const els = getEls();
  if (!els.deliveryItems) return;
  
  const items = state.currentDelivery.items;
  let total = 0;

  els.deliveryItems.innerHTML = items.map(i => {
    const rowVal = i.qty * i.price;
    total += rowVal;
    return `<tr>
      <td>
        <div class="table-maincell">
          <span class="badge">${escapeHtml(i.sku)}</span>
          <div class="table-cell-stack">
            <span>${escapeHtml(i.name || "")}</span>
          </div>
        </div>
      </td>
      <td class="text-right">${i.qty}</td>
      <td class="text-right">${fmtPLN.format(i.price)}</td>
      <td class="text-right">${fmtPLN.format(rowVal)}</td>
      <td class="text-right">
        <div class="table-actions table-actions-tight">
          <button class="btn btn-danger btn-sm btn-icon" onclick="removeDeliveryItem(${i.id})" aria-label="Usuń">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");

  const itemsCountEl = document.getElementById("itemsCount");
  const itemsTotalEl = document.getElementById("itemsTotal");
  const finalizeBtn = document.getElementById("finalizeDeliveryBtn");
  const canFinalize = typeof isCurrentDeliveryFinalizable === "function"
    ? isCurrentDeliveryFinalizable()
    : false;
  
  if (itemsCountEl) itemsCountEl.textContent = String(items.length);
  if (itemsTotalEl) itemsTotalEl.textContent = fmtPLN.format(total);
  if (finalizeBtn) finalizeBtn.disabled = isDeliveryFinalizationBusy() || !canFinalize;

  syncDeliveryBusyState();
}


function renderBuild() {
  const els = getEls();
  if (!els.buildItems) return;

  els.buildItems.innerHTML = state.currentBuild.items.map(i => {
    const machineName = getBuildItemMachineName(i);
    return `<tr>
      <td>
        <div class="table-maincell">
          <span class="badge">${escapeHtml(i.machineCode)}</span>
          <div class="table-cell-stack">
            <span>${escapeHtml(machineName || "???")}</span>
          </div>
        </div>
      </td>
      <td class="text-right">${i.qty}</td>
      <td class="text-right">
        <div class="table-actions table-actions-tight">
          <button class="btn btn-danger btn-sm btn-icon" onclick="removeBuildItem(${i.id})" aria-label="Usuń">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");

  const buildCountEl = document.getElementById("buildItemsCount");
  const finalizeBuildBtn = document.getElementById("finalizeBuildBtn");
  
  if (buildCountEl) buildCountEl.textContent = String(state.currentBuild.items.length);
  if (finalizeBuildBtn) finalizeBuildBtn.disabled = isBuildFinalizationBusy() || state.currentBuild.items.length === 0;

  if (els.missingBox) els.missingBox.classList.add("hidden");
  if (els.manualBox) els.manualBox.classList.add("hidden");

  const mode = document.getElementById("consumeMode")?.value || "fifo";
  if (mode === "manual" && state.currentBuild.items.length > 0) {
    renderManualConsume();
  }

  syncBuildBusyState();
}

function renderMissingParts(missing) {
  const els = getEls();
  if (!els.missingBox) return;
  
  els.missingBox.classList.remove("hidden");
  const list = byId("missingList");
  if (!list) return;
  
  list.innerHTML = missing.map(m =>
    `<li><strong>${escapeHtml(m.sku)}</strong> ${m.name ? `(${escapeHtml(m.name)})` : ""}: 
     Potrzeba ${m.needed}, stan: ${m.has} <span class="text-muted">(brakuje: ${m.missing})</span></li>`
  ).join("");
}

function renderManualConsume() {
  const req = calculateBuildRequirements();
  const container = document.getElementById("manualConsumeUI");
  if (!container) return;
  
  container.innerHTML = "";

  const missing = checkStockAvailability(req);
  if (missing.length > 0) {
    renderMissingParts(missing);
    const els = getEls();
    if (els.manualBox) els.manualBox.classList.add("hidden");
    return;
  }

  const els = getEls();
  if (els.manualBox) els.manualBox.classList.remove("hidden");

  req.forEach((qtyNeeded, skuKeyStr) => {
    const part = state.partsCatalog.get(skuKeyStr);
    const draftBomItem = state.currentBuild.items
      .flatMap(item => getBuildItemBom(item))
      .find(item => skuKey(item?.sku) === skuKeyStr);

    const lots = (state.lots || [])
      .filter(l => skuKey(l.sku) === skuKeyStr)
      .slice()
      .sort(compareLotsForConsumption);

    const html = `
      <div class="consume-part">
        <div class="consume-part-header">
          <div>
            <strong>${escapeHtml(part?.sku || draftBomItem?.sku || skuKeyStr)}</strong>
            ${(part?.name || draftBomItem?.name) ? `<span class="text-muted"> - ${escapeHtml(part?.name || draftBomItem?.name || "")}</span>` : ""}
          </div>
          <span class="badge">Wymagane: ${qtyNeeded}</span>
        </div>
        ${lots.length ? lots.map(lot => {
          const dateStr = lot?.dateIn ? fmtDateISO(lot.dateIn) : "—";
          const supplier = lot?.supplier || "—";
          const price = fmtPLN.format(safeFloat(lot?.unitPrice || 0));
          const qtyAvail = safeQtyInt(lot?.qty || 0);
          const lotId = lot?.id ?? "—";

          return `
            <div class="lot-row">
              <div style="font-size:var(--text-sm)">
                <strong>#${lotId}</strong>
                <span class="text-muted"> • ${escapeHtml(supplier)} (${price})</span>
                <span class="text-muted"> • Data: <strong>${dateStr}</strong></span>
                <span class="text-muted"> • Dostępne: <strong>${qtyAvail}</strong></span>
              </div>
              <input type="number" class="manual-lot-input"
                data-lot-id="${lot?.id}"
                data-sku="${skuKeyStr}"
                max="${qtyAvail}" min="0" value="0"
                aria-label="Ilość z partii ${lotId}"
                ${isBuildFinalizationBusy() ? 'disabled aria-disabled="true"' : ''}>
            </div>
          `;
        }).join("") : `<div class="text-muted" style="font-size:var(--text-sm)">Brak partii dla tej części.</div>`}
      </div>`;

    container.insertAdjacentHTML("beforeend", html);
  });
}

function renderMachinesStock() {
  const searchInput = document.getElementById("searchMachines");
  const q = normalize(searchInput?.value).toLowerCase();
  const showArchivedToggle = document.getElementById("showArchivedMachinesToggle");
  const showArchived = shouldShowArchivedMachinesInStock();

  syncWarehouseToggleButtonState(showArchivedToggle, showArchived);

  const tbody = document.querySelector("#machinesStockTable tbody");
  if (!tbody) return;

  const filteredMachinesStockRows = state.machinesStock
    .filter(m => showArchived || !isMachineArchived(m?.code))
    .filter(m => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
  const paginatedMachinesStock = paginateTableRows('warehouse_machines', filteredMachinesStockRows);

  tbody.innerHTML = paginatedMachinesStock.rows
    .map(m => {
      const isArchived = isMachineArchived(m?.code);
      return `<tr>
      <td>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <span class="badge">${escapeHtml(m.code)}</span>
        </div>
      </td>
      <td>${escapeHtml(m.name)}</td>
      <td class="text-right"><strong>${m.qty}</strong></td>
      <td>${isArchived ? '<span class="badge badge-muted badge-status-warning">ZARCHIWIZOWANE</span>' : '<span class="catalog-status-empty" aria-hidden="true"></span>'}</td>
    </tr>`;
    }).join("");

  renderTablePagination('#machinesStockTable', 'warehouse_machines', paginatedMachinesStock);
}

function getHistoryView() {
  const v = localStorage.getItem("magazyn_history_view_v3");
  return (v === "all" || v === "builds" || v === "adjustments") ? v : "deliveries";
}

function parsePLDateToISO(dmy) {
  const m = String(dmy || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = parseInt(dd, 10), mo = parseInt(mm, 10), y = parseInt(yyyy, 10);
  if (!(y >= 1970 && y <= 2100)) return null;
  if (!(mo >= 1 && mo <= 12)) return null;
  if (!(d >= 1 && d <= 31)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function parseHistoryDateRange(raw) {
  const s = String(raw || "").trim();
  if (!s) return { fromISO: null, toISO: null };

  const parts = s.split("-").map(x => x.trim());
  if (parts.length === 1) {
    return { fromISO: parsePLDateToISO(parts[0]), toISO: null };
  }
  if (parts.length >= 2) {
    return { 
      fromISO: parts[0] ? parsePLDateToISO(parts[0]) : null, 
      toISO: parts[1] ? parsePLDateToISO(parts[1]) : null 
    };
  }
  return { fromISO: null, toISO: null };
}

function isMeaningfulHistoryAuthorName(value) {
  const normalized = normalize(value);
  if (!normalized) return false;
  const simplified = normalized.toLowerCase();
  return !["-", "—", "brak", "unknown", "nieznany", "nieznany autor"].includes(simplified);
}

function getHistoryAuthorMeta(ev) {
  const authorUserId = normalize(ev?.authorUserId || "");
  const authorName = normalize(ev?.authorName || "");
  const authorEmail = normalize(ev?.authorEmail || "");
  const hasName = isMeaningfulHistoryAuthorName(authorName);
  const hasEmail = !!authorEmail;

  let key = "unknown";
  if (authorUserId) key = `user:${authorUserId}`;
  else if (hasEmail) key = `email:${authorEmail.toLowerCase()}`;
  else if (hasName) key = `name:${authorName.toLowerCase()}`;

  let label = "Nieznany autor";
  if (hasName) label = authorName;
  else if (hasEmail) label = authorEmail;

  const rank = hasName ? 3 : hasEmail ? 2 : 1;
  return { key, label, rank };
}

function syncHistoryAuthorFilterOptions() {
  const selectEl = document.getElementById("historyAuthorFilter");
  if (!selectEl) return;

  const previousValue = normalize(selectEl.value || "");
  const optionsMap = new Map();

  (state.history || []).forEach(ev => {
    const meta = getHistoryAuthorMeta(ev);
    const existing = optionsMap.get(meta.key);
    if (!existing || meta.rank > existing.rank || (meta.rank === existing.rank && meta.label.localeCompare(existing.label, 'pl') < 0)) {
      optionsMap.set(meta.key, meta);
    }
  });

  const sortedOptions = Array.from(optionsMap.values()).sort((a, b) => {
    if (a.rank !== b.rank) return b.rank - a.rank;
    return String(a.label).localeCompare(String(b.label), 'pl');
  });

  selectEl.innerHTML = [
    '<option value="">Wszyscy autorzy</option>',
    ...sortedOptions.map(opt => `<option value="${escapeHtml(opt.key)}">${escapeHtml(opt.label)}</option>`)
  ].join('');

  selectEl.value = sortedOptions.some(opt => opt.key === previousValue) ? previousValue : '';

  if (typeof refreshComboFromSelect === "function") {
    try { refreshComboFromSelect(selectEl, { placeholder: "Wszyscy autorzy", includeEmptyOption: true }); } catch {}
  }
}

function historyMatchesFilters(ev, view, qNorm, fromISO, toISO, authorKey) {
  if (!ev) return false;
  if (view === "deliveries" && ev.type !== "delivery") return false;
  if (view === "builds" && ev.type !== "build") return false;
  if (view === "adjustments" && ev.type !== "adjustment") return false;

  const d = ev.dateISO || "";
  if (fromISO && d && d < fromISO) return false;
  if (toISO && d && d > toISO) return false;

  if (authorKey && getHistoryAuthorMeta(ev).key !== authorKey) return false;

  if (!qNorm) return true;

  if (view === "deliveries") {
    const supplier = normalize(ev.supplier || "").toLowerCase();
    const invoiceNumber = normalize(ev.invoiceNumber || "").toLowerCase();
    if (supplier.includes(qNorm) || invoiceNumber.includes(qNorm)) return true;

    const items = Array.isArray(ev.items) ? ev.items : [];
    for (const it of items) {
      const sku = normalize(it?.sku || "").toLowerCase();
      const name = normalize(it?.name || "").toLowerCase();
      if ((sku && sku.includes(qNorm)) || (name && name.includes(qNorm))) return true;
    }
    return false;
  }

  if (ev.type === "delivery") {
    const supplier = normalize(ev.supplier || "").toLowerCase();
    const invoiceNumber = normalize(ev.invoiceNumber || "").toLowerCase();
    if (supplier.includes(qNorm) || invoiceNumber.includes(qNorm)) return true;
  }

  const items = Array.isArray(ev.items) ? ev.items : [];
  for (const it of items) {
    const code = normalize(it?.code || it?.sku || "").toLowerCase();
    const name = normalize(it?.name || "").toLowerCase();
    if ((code && code.includes(qNorm)) || (name && name.includes(qNorm))) return true;
  }
  return false;
}

function renderHistory() {
  const tbody = document.querySelector("#historyTable tbody");
  if (!tbody) return;

  const view = getHistoryView();
  const searchInput = document.getElementById("historySearch");
  const dateInput = document.getElementById("historyDateRange");
  const authorSelect = document.getElementById("historyAuthorFilter");

  syncHistoryAuthorFilterOptions();

  const qNorm = normalize(searchInput?.value || "").toLowerCase();
  const { fromISO, toISO } = parseHistoryDateRange(dateInput?.value || "");
  const authorKey = normalize(authorSelect?.value || "");

  const rows = (state.history || [])
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .filter(ev => historyMatchesFilters(ev, view, qNorm, fromISO, toISO, authorKey));
  const paginatedHistory = paginateTableRows('history', rows);

  if (!rows.length) {
    const msg = (view === "all")
      ? "Brak akcji w historii dla wybranych filtrów."
      : (view === "deliveries")
        ? "Brak dostaw w historii dla wybranych filtrów."
        : (view === "builds")
          ? "Brak produkcji w historii dla wybranych filtrów."
          : "Brak korekt w historii dla wybranych filtrów.";
    tbody.innerHTML = `<tr><td colspan="4" class="text-muted" style="text-align:center;padding:var(--space-6)">${msg}</td></tr>`;
    renderTablePagination('#historyTable', 'history', { totalRows: 0, totalPages: 1, page: 1 });
    return;
  }

  tbody.innerHTML = paginatedHistory.rows.map(ev => {
    const date = fmtDateISO(ev.dateISO);
    let summary = "";

    if (ev.type === "delivery") {
      const n = (ev.items || []).length;
      const total = (ev.items || []).reduce((s, i) => s + (safeFloat(i.price) * safeInt(i.qty)), 0);
      summary = `
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <span class="badge badge-success">${escapeHtml(ev.supplier || "—")}</span>
          <span class="text-muted" style="font-size:var(--text-sm)">Pozycji: <strong>${n}</strong></span>
          <span class="text-muted" style="font-size:var(--text-sm)">Suma: <strong>${fmtPLN.format(total)}</strong></span>
        </div>
      `;
    } else if (ev.type === "build") {
      const n = (ev.items || []).length;
      const totalQty = (ev.items || []).reduce((s, i) => s + safeInt(i.qty), 0);
      const totalConsumptionValue = (ev.items || []).reduce((sum, it) => {
        const machineVal = (it?.partsUsed || []).reduce((ms, p) => {
          const lots = Array.isArray(p?.lots) ? p.lots : [];
          return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
        }, 0);
        return sum + machineVal;
      }, 0);

      const machinesPreview = (ev.items || [])
        .slice(0, 2)
        .map(i => `${i?.name || "—"} (${i?.code || "—"})`)
        .join(", ");
      const more = (ev.items || []).length > 2 ? ` +${(ev.items || []).length - 2}` : "";

      summary = `
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <span class="badge badge-accent">${escapeHtml(machinesPreview || "Produkcja")}${escapeHtml(more)}</span>
          <span class="text-muted" style="font-size:var(--text-sm)">Pozycji: <strong>${n}</strong></span>
          <span class="text-muted" style="font-size:var(--text-sm)">Sztuk: <strong>${totalQty}</strong></span>
          ${Number.isFinite(totalConsumptionValue) && totalConsumptionValue > 0
            ? `<span class="text-muted" style="font-size:var(--text-sm)">Zużycie: <strong>${fmtPLN.format(totalConsumptionValue)}</strong></span>`
            : ``}
        </div>
      `;
    } else {
      const adjustmentItems = Array.isArray(ev.items)
        ? ev.items
        : (Array.isArray(ev?.details?.changes) ? ev.details.changes : []);
      const n = safeQtyInt(ev.partsChanged ?? adjustmentItems.length);
      const netDiff = adjustmentItems.reduce((sum, i) => sum + Number(i?.diff || 0), 0);
      summary = `
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          <span class="badge badge-warning">Korekta stanów</span>
          <span class="text-muted" style="font-size:var(--text-sm)">Części: <strong>${n}</strong></span>
          <span class="text-muted" style="font-size:var(--text-sm)">Bilans: <strong>${netDiff > 0 ? `+${netDiff}` : netDiff}</strong></span>
        </div>
      `;
    }

    return `
      <tr data-hid="${ev.id}">
        <td style="white-space:nowrap">${date}</td>
        <td class="history-author-cell"><span class="history-author-value">${escapeHtml(getHistoryAuthorMeta(ev).label)}</span></td>
        <td>${summary}</td>
        <td class="text-right">
          <div class="table-row-actions">
            <button class="btn btn-secondary btn-sm" type="button" 
              data-action="toggleHistory" data-hid="${ev.id}">Szczegóły</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  renderTablePagination('#historyTable', 'history', paginatedHistory);
  renderSideRecentActions5();
}

function getBuildHistoryCompletenessMeta(buildItems = []) {
  const items = Array.isArray(buildItems) ? buildItems.filter(Boolean) : [];
  let machinesWithMissingLots = 0;
  let partsWithMissingLots = 0;

  items.forEach(item => {
    const partsUsed = Array.isArray(item?.partsUsed) ? item.partsUsed.filter(Boolean) : [];
    const hasMissingLots = partsUsed.some(part => {
      const expectedQty = safeInt(part?.qty);
      const lots = Array.isArray(part?.lots) ? part.lots.filter(Boolean) : [];
      if (expectedQty <= 0) return false;
      if (!lots.length) return true;
      const allocatedQty = lots.reduce((sum, lot) => sum + safeInt(lot?.qty), 0);
      return allocatedQty < expectedQty;
    });

    if (hasMissingLots) machinesWithMissingLots += 1;

    partsUsed.forEach(part => {
      const expectedQty = safeInt(part?.qty);
      const lots = Array.isArray(part?.lots) ? part.lots.filter(Boolean) : [];
      if (expectedQty <= 0) return;
      if (!lots.length) {
        partsWithMissingLots += 1;
        return;
      }
      const allocatedQty = lots.reduce((sum, lot) => sum + safeInt(lot?.qty), 0);
      if (allocatedQty < expectedQty) partsWithMissingLots += 1;
    });
  });

  return {
    isIncomplete: machinesWithMissingLots > 0 || partsWithMissingLots > 0,
    machinesWithMissingLots,
    partsWithMissingLots
  };
}

function getBuildHistoryConsumptionValue(buildItem = {}) {
  const partsUsed = Array.isArray(buildItem?.partsUsed) ? buildItem.partsUsed : [];
  return partsUsed.reduce((machineSum, part) => {
    const lots = Array.isArray(part?.lots) ? part.lots : [];
    return machineSum + lots.reduce((lotSum, lot) => lotSum + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
  }, 0);
}

function renderBuildHistoryConsumptionValue(value, isComplete) {
  if (!isComplete) return 'brak pełnych danych';
  return fmtPLN.format(value || 0);
}

function buildHistoryDetails(ev) {
  if (!ev) return "";

  const authorLabel = escapeHtml(getHistoryAuthorMeta(ev).label);
  const isDelivery = ev.type === "delivery";
  const isBuild = ev.type === "build";
  const isAdjustment = ev.type === "adjustment";
  const typeLabel = isDelivery ? "Dostawa" : isBuild ? "Produkcja" : "Korekta";
  const badgeClass = isDelivery ? "badge-success" : isBuild ? "badge-accent" : "badge-warning";
  const items = Array.isArray(ev.items)
    ? ev.items
    : (Array.isArray(ev?.details?.changes) ? ev.details.changes : []);

  if (isAdjustment) {
    const positiveCount = items.filter(i => Number(i?.diff || 0) > 0).length;
    const negativeCount = items.filter(i => Number(i?.diff || 0) < 0).length;
    const netDiff = items.reduce((sum, i) => sum + Number(i?.diff || 0), 0);
    const changeCount = safeQtyInt(ev.partsChanged ?? items.length);

    const cards = items.map(i => {
      const diff = Number(i?.diff || 0);
      const diffClass = diff > 0 ? "adjustment-diff-plus" : diff < 0 ? "adjustment-diff-minus" : "adjustment-diff-zero";
      const diffLabel = diff > 0 ? `+${diff}` : `${diff}`;
      const previousQty = safeQtyInt(i?.previousQty);
      const newQty = safeQtyInt(i?.newQty);
      const lots = Array.isArray(i?.affectedLots) ? i.affectedLots : [];
      const createdLot = i?.createdLot || null;
      const settlementLabel = diff > 0 ? "Nowa partia korekcyjna" : diff < 0 ? "Rozchód z partii FIFO" : "Brak zmiany";

      let settlementHtml = `<div class="adjustment-lots-list"><div class="adjustment-lot-item"><div>${escapeHtml(settlementLabel)}</div></div></div>`;

      if (diff > 0 && createdLot) {
        settlementHtml = `
          <div class="adjustment-lots-list">
            <div class="adjustment-lot-item">
              <div>
                <strong>Utworzono partię korekcyjną #${escapeHtml(createdLot.lotId || "—")}</strong>
                <span class="lot-origin-badge">korekta</span>
                <div class="text-muted">Źródło: ${escapeHtml(createdLot.supplier || "Korekta stanu")} • Data: ${escapeHtml(fmtDateISO(createdLot.dateIn) || "—")}</div>
              </div>
              <div>
                Dodano <strong>${safeQtyInt(createdLot.qty)}</strong> • Cena ref. <strong>${fmtPLN.format(safeFloat(i.referenceUnitPrice ?? createdLot.unitPrice ?? 0))}</strong>
              </div>
            </div>
          </div>
        `;
      } else if (diff < 0 && lots.length) {
        settlementHtml = `
          <div class="adjustment-lots-list">
            ${lots.map(lot => `
              <div class="adjustment-lot-item">
                <div>
                  <strong>Partia #${escapeHtml(lot.lotId || "—")}</strong>
                  <div class="text-muted">${escapeHtml(lot.supplier || "-")} • ${escapeHtml(fmtDateISO(lot.dateIn) || "—")}</div>
                </div>
                <div>
                  Zdjęto <strong>${safeQtyInt(lot.removedQty)}</strong>
                  ${safeQtyInt(lot.remainingAfter) > 0 ? `• Pozostało ${safeQtyInt(lot.remainingAfter)}` : `• Wyzerowana`}
                  • Cena ${fmtPLN.format(safeFloat(lot.unitPrice || 0))}
                </div>
              </div>
            `).join("")}
          </div>
        `;
      }

      return `
        <article class="adjustment-history-row">
          <div class="adjustment-history-head">
            <div>
              <div class="history-table-maincell">
                <span class="badge">${escapeHtml(i?.sku || "—")}</span>
                <span>${escapeHtml(i?.name || "")}</span>
              </div>
              <p>Stan przed <strong>${previousQty}</strong> • stan po <strong>${newQty}</strong> • rozliczenie: <strong>${escapeHtml(settlementLabel)}</strong>.</p>
            </div>
            <div class="adjustment-history-meta">
              <span class="adjustment-diff ${diffClass}">${diffLabel}</span>
              ${diff > 0 ? `<span class="badge badge-success">Plus</span>` : diff < 0 ? `<span class="badge badge-warning">Minus / FIFO</span>` : `<span class="badge">0</span>`}
            </div>
          </div>
          ${settlementHtml}
        </article>
      `;
    }).join("");

    return `
      <div class="history-modal-head">
        <div>
          <div class="history-modal-kicker"><span class="badge ${badgeClass}">${typeLabel}</span><span>${fmtDateISO(ev.dateISO)}</span></div>
          <h3 class="history-modal-title">Podgląd korekty stanów</h3>
          <p class="history-modal-subtitle">Zbiorcza sesja korekt z czytelnym rozpisaniem stanu przed, po i sposobu rozliczenia.</p>
          <p class="history-modal-subtitle">Wykonał: ${authorLabel}</p>
        </div>
      </div>

      <div class="history-modal-stats history-modal-stats-3">
        <div class="history-stat-card">
          <span class="history-stat-label">Data korekty</span>
          <strong class="history-stat-value">${fmtDateISO(ev.dateISO)}</strong>
        </div>
        <div class="history-stat-card">
          <span class="history-stat-label">Zmienione części</span>
          <strong class="history-stat-value">${changeCount}</strong>
        </div>
        <div class="history-stat-card">
          <span class="history-stat-label">Bilans / + / -</span>
          <strong class="history-stat-value">${netDiff > 0 ? `+${netDiff}` : netDiff} • ${positiveCount}/${negativeCount}</strong>
        </div>
      </div>

      <div class="history-modal-section">
        <div class="history-modal-section-head">
          <div>
            <h4>Pozycje korekty</h4>
            <p>Każda pozycja pokazuje stan przed, stan po, różnicę i faktyczny sposób rozliczenia.</p>
          </div>
        </div>
        <div class="adjustment-history-list">${cards || `<div class="history-empty-state"><span class="text-muted">Brak pozycji korekty.</span></div>`}</div>
      </div>
    `;
  }

  if (isDelivery) {
    const total = items.reduce((s, i) => s + (safeFloat(i.price) * safeInt(i.qty)), 0);
    const totalQty = items.reduce((s, i) => s + safeInt(i.qty), 0);
    const invoiceNumber = normalize(ev.invoiceNumber || "");

    return `
      <div class="history-modal-head">
        <div>
          <div class="history-modal-kicker"><span class="badge ${badgeClass}">${typeLabel}</span><span>${fmtDateISO(ev.dateISO)}</span></div>
          <h3 class="history-modal-title">Podgląd dostawy</h3>
          <p class="history-modal-subtitle">Szczegóły przyjęcia od dostawcy i pełne zestawienie pozycji.</p>
          <p class="history-modal-subtitle">Wykonał: ${authorLabel}</p>
        </div>
      </div>

      <div class="history-modal-stats history-modal-stats-4">
        <div class="history-stat-card">
          <span class="history-stat-label">Dostawca</span>
          <strong class="history-stat-value">${escapeHtml(ev.supplier || "—")}</strong>
        </div>
        <div class="history-stat-card">
          <span class="history-stat-label">Numer faktury</span>
          <strong class="history-stat-value">${escapeHtml(invoiceNumber || "—")}</strong>
        </div>
        <div class="history-stat-card">
          <span class="history-stat-label">Pozycji / sztuk</span>
          <strong class="history-stat-value">${items.length} / ${totalQty}</strong>
        </div>
        <div class="history-stat-card">
          <span class="history-stat-label">Łączna wartość</span>
          <strong class="history-stat-value">${fmtPLN.format(total)}</strong>
        </div>
      </div>

      <div class="history-modal-section">
        <div class="history-modal-section-head">
          <div>
            <h4>Pozycje dostawy</h4>
            <p>Każda pozycja z ilością, ceną jednostkową i wartością.</p>
          </div>
        </div>
        <div class="table-container history-modal-table-wrap">
          <table class="history-modal-table table-dense">
            <thead>
              <tr>
                <th>Nazwa (ID)</th>
                <th class="text-right">Ilość</th>
                <th class="text-right">Cena</th>
                <th class="text-right">Razem</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(i => {
                const rowVal = safeInt(i.qty) * safeFloat(i.price);
                return `<tr>
                  <td>
                    <div class="history-table-maincell">
                      <span class="badge">${escapeHtml(i.sku)}</span>
                      <span>${escapeHtml(i.name || "")}</span>
                    </div>
                  </td>
                  <td class="text-right">${safeInt(i.qty)}</td>
                  <td class="text-right">${fmtPLN.format(safeFloat(i.price))}</td>
                  <td class="text-right"><strong>${fmtPLN.format(rowVal)}</strong></td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const buildCompleteness = getBuildHistoryCompletenessMeta(items);
  const totalQty = items.reduce((s, i) => s + safeInt(i.qty), 0);
  const totalConsumptionValue = items.reduce((sum, it) => sum + getBuildHistoryConsumptionValue(it), 0);

  const machineCards = items.map((i) => {
    const machineConsumptionValue = getBuildHistoryConsumptionValue(i);
    const machineCompleteness = getBuildHistoryCompletenessMeta([i]);

    const partsRows = (Array.isArray(i.partsUsed) ? i.partsUsed : []).flatMap(p => {
      const lots = Array.isArray(p?.lots) ? p.lots : [];
      if (!lots.length) return [];
      return lots.map(lot => {
        const d = lot.dateIn ? fmtDateISO(lot.dateIn) : "—";
        const price = fmtPLN.format(safeFloat(lot.unitPrice || 0));
        const rowVal = safeInt(lot.qty) * safeFloat(lot.unitPrice || 0);
        return `
          <tr>
            <td>
              <div class="history-table-maincell">
                <span class="badge">${escapeHtml(lot.sku || p.sku || "—")}</span>
                <span>${escapeHtml(lot.name || p.name || "")}</span>
              </div>
            </td>
            <td>${escapeHtml(lot.supplier || "-")}</td>
            <td>${escapeHtml(d)}</td>
            <td class="text-right">${price}</td>
            <td class="text-right"><strong>${safeInt(lot.qty)}</strong></td>
            <td class="text-right">${fmtPLN.format(rowVal)}</td>
          </tr>
        `;
      });
    }).join("");

    const incompleteNote = machineCompleteness.isIncomplete ? `
      <div class="history-empty-state" style="margin-bottom:var(--space-3)">
        <span class="badge badge-warning">Podgląd niepełny</span>
        <span class="text-muted">Brakuje pełnej rozpiski partii dla części tej pozycji. Koszt i zużycie mogą być niepełne.</span>
      </div>
    ` : ``;

    const empty = !partsRows ? `
      <div class="history-empty-state">
        <span class="text-muted">Brak danych o zużytych partiach dla tej maszyny.</span>
      </div>
    ` : `
      <div class="table-container history-modal-table-wrap">
        <table class="history-modal-table history-modal-table-dense table-dense">
          <thead>
            <tr>
              <th>Nazwa (ID)</th>
              <th>Dostawca</th>
              <th>Data</th>
              <th class="text-right">Cena zak.</th>
              <th class="text-right">Ilość</th>
              <th class="text-right">Razem</th>
            </tr>
          </thead>
          <tbody>${partsRows}</tbody>
        </table>
      </div>
    `;

    return `
      <article class="history-machine-card">
        <div class="history-machine-card-head">
          <div>
            <div class="history-machine-title-row">
              <h4>${escapeHtml(i.name || "—")}</h4>
              <span class="badge">${escapeHtml(i.code || "—")}</span>
            </div>
            <p>Pełne zużycie partii dla tej pozycji produkcyjnej.</p>
          </div>
          <div class="history-machine-meta">
            <div><span>Ilość</span><strong>${safeInt(i.qty)}</strong></div>
            <div><span>Zużycie</span><strong>${renderBuildHistoryConsumptionValue(machineConsumptionValue, !machineCompleteness.isIncomplete)}</strong></div>
          </div>
        </div>
        ${incompleteNote}
        ${empty}
      </article>
    `;
  }).join("");

  return `
    <div class="history-modal-head">
      <div>
        <div class="history-modal-kicker"><span class="badge ${badgeClass}">${typeLabel}</span><span>${fmtDateISO(ev.dateISO)}</span></div>
        <h3 class="history-modal-title">Podgląd produkcji</h3>
        <p class="history-modal-subtitle">Rozpiska maszyn i realnie zużytych partii magazynowych.</p>
        <p class="history-modal-subtitle">Wykonał: ${authorLabel}</p>
      </div>
    </div>

    <div class="history-modal-stats history-modal-stats-3">
      <div class="history-stat-card">
        <span class="history-stat-label">Pozycji</span>
        <strong class="history-stat-value">${items.length}</strong>
      </div>
      <div class="history-stat-card">
        <span class="history-stat-label">Łącznie sztuk</span>
        <strong class="history-stat-value">${totalQty}</strong>
      </div>
      <div class="history-stat-card">
        <span class="history-stat-label">Wartość zużycia</span>
        <strong class="history-stat-value">${renderBuildHistoryConsumptionValue(totalConsumptionValue, !buildCompleteness.isIncomplete)}</strong>
      </div>
    </div>

    ${buildCompleteness.isIncomplete ? `
      <div class="history-empty-state" style="margin-bottom:var(--space-4)">
        <span class="badge badge-warning">Podgląd niepełny</span>
        <span class="text-muted">Brakuje pełnej rozpiski partii dla ${buildCompleteness.partsWithMissingLots} ${buildCompleteness.partsWithMissingLots === 1 ? 'części' : 'części'} w ${buildCompleteness.machinesWithMissingLots} ${buildCompleteness.machinesWithMissingLots === 1 ? 'pozycji produkcyjnej' : 'pozycjach produkcyjnych'}. Część danych o zużyciu i koszcie może być niepełna.</span>
      </div>
    ` : ``}

    <div class="history-modal-section">
      <div class="history-modal-section-head">
        <div>
          <h4>Pozycje produkcyjne</h4>
          <p>Każda maszyna pokazuje zużyte części i partie z magazynu.</p>
        </div>
      </div>
      <div class="history-machine-list">
        ${machineCards || `<div class="history-empty-state"><span class="text-muted">Brak pozycji produkcyjnych.</span></div>`}
      </div>
    </div>
  `;
}


function getHistoryEventsByType(type) {
  return (state.history || []).filter(ev => ev && ev.type === type);
}

function getReferencePriceForCatalogDetails(skuRaw) {
  const supplierRef = safeFloat(getPartReferencePriceForStatus(skuRaw));
  if (supplierRef > 0) return supplierRef;
  return safeFloat(getLastKnownUnitPrice(skuRaw));
}

function getMaxDateISO(dateList) {
  const valid = (Array.isArray(dateList) ? dateList : []).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))).sort();
  return valid.length ? valid[valid.length - 1] : '';
}

function getSupplierCatalogDetailsData(supplierNameRaw) {
  const supplierName = normalize(supplierNameRaw);
  const assignedParts = getSupplierPartsForStatus(supplierName);
  const deliveryEvents = getHistoryEventsByType('delivery').filter(ev => normalize(ev?.supplier) === supplierName);

  let totalBoughtQty = 0;
  let totalBoughtValue = 0;
  const purchasedByPart = new Map();

  deliveryEvents.forEach(ev => {
    (ev.items || []).forEach(item => {
      const qty = safeQtyInt(item?.qty);
      const value = qty * safeFloat(item?.price);
      const k = skuKey(item?.sku);
      totalBoughtQty += qty;
      totalBoughtValue += value;
      if (!k) return;
      const prev = purchasedByPart.get(k) || {
        sku: normalize(item?.sku),
        name: normalize(item?.name),
        qty: 0
      };
      prev.qty += qty;
      if (!prev.name) prev.name = normalize(item?.name);
      if (!prev.sku) prev.sku = normalize(item?.sku);
      purchasedByPart.set(k, prev);
    });
  });

  const mostPurchasedPart = Array.from(purchasedByPart.values())
    .sort((a, b) => (b.qty - a.qty) || String(a.sku).localeCompare(String(b.sku), 'pl'))[0] || null;

  const warehouseQty = (state.lots || [])
    .filter(lot => normalize(lot?.supplier) === supplierName)
    .reduce((sum, lot) => sum + safeQtyInt(lot?.qty), 0);

  return {
    supplierName,
    assignedPartsCount: assignedParts.length,
    deliveryCount: deliveryEvents.length,
    totalBoughtQty,
    totalBoughtValue,
    lastDeliveryDateISO: getMaxDateISO(deliveryEvents.map(ev => ev?.dateISO)),
    mostPurchasedPart,
    warehouseQty
  };
}

function getPartCatalogDetailsData(skuRaw) {
  const k = skuKey(skuRaw);
  const part = state.partsCatalog.get(k);
  if (!part) return null;

  const suppliers = getPartSuppliersForStatus(part.sku);
  const referencePrice = getReferencePriceForCatalogDetails(part.sku);
  const stockQty = getPartTotalQty(part.sku);
  const stockStatus = getPartStockStatus(part.sku, stockQty);

  const machines = (state.machineCatalog || [])
    .filter(machine => Array.isArray(machine?.bom) && machine.bom.some(item => skuKey(item?.sku) === k))
    .map(machine => ({ code: machine.code, name: machine.name }));

  const deliveryEvents = getHistoryEventsByType('delivery');
  let purchaseCount = 0;
  let purchasedQty = 0;
  let purchasedValue = 0;

  deliveryEvents.forEach(ev => {
    (ev.items || []).forEach(item => {
      if (skuKey(item?.sku) !== k) return;
      const qty = safeQtyInt(item?.qty);
      purchaseCount += 1;
      purchasedQty += qty;
      purchasedValue += qty * safeFloat(item?.price);
    });
  });

  const buildEvents = getHistoryEventsByType('build');
  let productionUseCount = 0;
  let consumedQty = 0;
  const usageDates = [];

  buildEvents.forEach(ev => {
    (ev.items || []).forEach(machineItem => {
      (machineItem?.partsUsed || []).forEach(partItem => {
        if (skuKey(partItem?.sku) !== k) return;
        productionUseCount += 1;
        consumedQty += safeQtyInt(partItem?.qty);
        if (ev?.dateISO) usageDates.push(ev.dateISO);
      });
    });
  });

  return {
    sku: part.sku,
    name: part.name,
    suppliersCount: suppliers.length,
    referencePrice,
    stockQty,
    stockStatus,
    machineCount: machines.length,
    machines,
    purchaseCount,
    purchasedQty,
    purchasedValue,
    productionUseCount,
    consumedQty,
    lastUsageDateISO: getMaxDateISO(usageDates)
  };
}

function getMachineCatalogDetailsData(machineCodeRaw) {
  const machineCode = normalize(machineCodeRaw);
  const machine = (state.machineCatalog || []).find(item => normalize(item?.code) === machineCode);
  if (!machine) return null;

  const bomItems = Array.isArray(machine?.bom) ? machine.bom : [];
  const bomCount = bomItems.length;
  const totalBomQty = bomItems.reduce((sum, item) => sum + safeQtyInt(item?.qty), 0);

  const buildEvents = getHistoryEventsByType('build');
  let buildCount = 0;
  let totalProducedQty = 0;
  const buildDates = [];

  buildEvents.forEach(ev => {
    (ev.items || []).forEach(item => {
      if (normalize(item?.code) !== machineCode) return;
      buildCount += 1;
      totalProducedQty += safeQtyInt(item?.qty);
      if (ev?.dateISO) buildDates.push(ev.dateISO);
    });
  });

  const estimatedUnitCost = bomItems.reduce((sum, item) => {
    const qty = safeQtyInt(item?.qty);
    const refPrice = getReferencePriceForCatalogDetails(item?.sku);
    return sum + (qty * refPrice);
  }, 0);

  let maxBuildableUnits = 0;
  if (bomItems.length > 0) {
    maxBuildableUnits = bomItems.reduce((minUnits, item) => {
      const qtyNeeded = safeQtyInt(item?.qty);
      if (qtyNeeded <= 0) return minUnits;
      const stock = getPartTotalQty(item?.sku);
      const units = Math.floor(stock / qtyNeeded);
      return Math.min(minUnits, units);
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(maxBuildableUnits)) maxBuildableUnits = 0;
  }

  return {
    code: machine.code,
    name: machine.name,
    bomCount,
    totalBomQty,
    buildCount,
    totalProducedQty,
    lastBuildDateISO: getMaxDateISO(buildDates),
    estimatedUnitCost,
    maxBuildableUnits
  };
}

function renderCatalogDetailsStat(label, value, accent = '') {
  return `
    <div class="history-stat-card${accent ? ` ${accent}` : ''}">
      <span class="history-stat-label">${escapeHtml(label)}</span>
      <strong class="history-stat-value">${value}</strong>
    </div>
  `;
}

function renderCatalogDetailsRow(label, valueHtml) {
  return `
    <div class="catalog-readonly-row">
      <span class="catalog-readonly-row-label">${escapeHtml(label)}</span>
      <span class="catalog-readonly-row-value">${valueHtml}</span>
    </div>
  `;
}

function renderCatalogDetailsList(items, emptyLabel) {
  if (!Array.isArray(items) || !items.length) {
    return `<div class="catalog-readonly-empty">${escapeHtml(emptyLabel)}</div>`;
  }
  return `
    <div class="catalog-readonly-tags">
      ${items.map(item => `<span class="badge">${escapeHtml(item)}</span>`).join('')}
    </div>
  `;
}

function openSupplierCatalogDetailsModal(supplierNameRaw) {
  const data = getSupplierCatalogDetailsData(supplierNameRaw);
  if (!data) return;

  const titleEl = document.getElementById('supplierCatalogDetailsTitle');
  const subtitleEl = document.getElementById('supplierCatalogDetailsSubtitle');
  const statsEl = document.getElementById('supplierCatalogDetailsStats');
  const sectionsEl = document.getElementById('supplierCatalogDetailsSections');
  const backdrop = document.getElementById('supplierCatalogDetailsBackdrop');
  const panel = document.getElementById('supplierCatalogDetailsPanel');
  if (!titleEl || !subtitleEl || !statsEl || !sectionsEl || !backdrop || !panel) return;

  titleEl.textContent = data.supplierName || '—';
  subtitleEl.textContent = 'Podgląd informacji i statystyk dostawcy.';

  statsEl.innerHTML = [
    renderCatalogDetailsStat('Przypisane części', String(data.assignedPartsCount)),
    renderCatalogDetailsStat('Dostawy', String(data.deliveryCount)),
    renderCatalogDetailsStat('Kupione sztuki', String(data.totalBoughtQty)),
    renderCatalogDetailsStat('Na magazynie', String(data.warehouseQty))
  ].join('');

  const topPartHtml = data.mostPurchasedPart
    ? `<strong>${escapeHtml(data.mostPurchasedPart.sku)}</strong>${data.mostPurchasedPart.name ? ` <span class="text-secondary">${escapeHtml(data.mostPurchasedPart.name)}</span>` : ''}<span class="text-muted"> • ${data.mostPurchasedPart.qty} szt.</span>`
    : '<span class="text-muted">brak danych</span>';

  sectionsEl.innerHTML = `
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Podstawowe</h4><p>Najważniejsze dane o dostawcy.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Nazwa dostawcy', `<strong>${escapeHtml(data.supplierName || '—')}</strong>`)}
        ${renderCatalogDetailsRow('Liczba przypisanych części', String(data.assignedPartsCount))}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Historia zakupów</h4><p>Policzone z realnej historii dostaw.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Ile razy był użyty w dostawach', String(data.deliveryCount))}
        ${renderCatalogDetailsRow('Łączna liczba kupionych sztuk', String(data.totalBoughtQty))}
        ${renderCatalogDetailsRow('Łączna wartość zakupów', escapeHtml(fmtPLN.format(data.totalBoughtValue)))}
        ${renderCatalogDetailsRow('Data ostatniej dostawy', escapeHtml(fmtDateISO(data.lastDeliveryDateISO)))}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Przydatne powiązania</h4><p>Szybkie odczytanie najważniejszego kontekstu.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Najczęściej kupowana część', topPartHtml)}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Status / jakość danych</h4><p>Informacje pomocnicze na dziś.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Ile jego części jest aktualnie na magazynie', String(data.warehouseQty))}
      </div>
    </section>
  `;

  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  panel.classList.remove('hidden');
  document.body.classList.add('catalog-readonly-open');
}

function closeSupplierCatalogDetailsModal() {
  const backdrop = document.getElementById('supplierCatalogDetailsBackdrop');
  const panel = document.getElementById('supplierCatalogDetailsPanel');
  backdrop?.classList.add('hidden');
  backdrop?.setAttribute('aria-hidden', 'true');
  panel?.classList.add('hidden');
  document.body.classList.remove('catalog-readonly-open');
}

function openCatalogPartDetailsModal(skuRaw) {
  const data = getPartCatalogDetailsData(skuRaw);
  if (!data) return;

  const titleEl = document.getElementById('catalogPartDetailsTitle');
  const subtitleEl = document.getElementById('catalogPartDetailsSubtitle');
  const statsEl = document.getElementById('catalogPartDetailsStats');
  const sectionsEl = document.getElementById('catalogPartDetailsSections');
  const backdrop = document.getElementById('catalogPartDetailsBackdrop');
  const panel = document.getElementById('catalogPartDetailsPanel');
  if (!titleEl || !subtitleEl || !statsEl || !sectionsEl || !backdrop || !panel) return;

  titleEl.textContent = data.sku || '—';
  subtitleEl.textContent = data.name || 'Podgląd informacji i statystyk części.';

  statsEl.innerHTML = [
    renderCatalogDetailsStat('Dostawcy', String(data.suppliersCount)),
    renderCatalogDetailsStat('Stan magazynowy', String(data.stockQty)),
    renderCatalogDetailsStat('Maszyny', String(data.machineCount)),
    renderCatalogDetailsStat('Zużycie', String(data.consumedQty))
  ].join('');

  const machineLabels = data.machines.map(machine => `${machine.code}${machine.name ? ` • ${machine.name}` : ''}`);
  const stockStatusHtml = `<span class="status-pill status-pill-${escapeHtml(data.stockStatus.level)}">${escapeHtml(data.stockStatus.label)}</span>`;

  sectionsEl.innerHTML = `
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Podstawowe</h4><p>Krótkie podsumowanie części i jej stanu.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Nazwa / typ', `<strong>${escapeHtml(data.name || '—')}</strong>`)}
        ${renderCatalogDetailsRow('Liczba przypisanych dostawców', String(data.suppliersCount))}
        ${renderCatalogDetailsRow('Cena referencyjna', escapeHtml(data.referencePrice > 0 ? fmtPLN.format(data.referencePrice) : 'brak danych'))}
        ${renderCatalogDetailsRow('Aktualny stan magazynowy', String(data.stockQty))}
        ${renderCatalogDetailsRow('Status magazynowy', stockStatusHtml)}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Wykorzystanie</h4><p>Powiązania z BOM-ami maszyn.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('W ilu maszynach jest używana', String(data.machineCount))}
        ${renderCatalogDetailsRow('Lista maszyn, w których występuje', renderCatalogDetailsList(machineLabels, 'Brak powiązanych maszyn'))}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Historia zakupów</h4><p>Zliczone z historii dostaw.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Ile razy część była kupiona', String(data.purchaseCount))}
        ${renderCatalogDetailsRow('Łączna kupiona ilość', String(data.purchasedQty))}
        ${renderCatalogDetailsRow('Łączna wartość zakupów', escapeHtml(fmtPLN.format(data.purchasedValue)))}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Zużycie / produkcja</h4><p>Ujęte z historii produkcji.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Ile razy ta część została zużyta w produkcji', String(data.productionUseCount))}
        ${renderCatalogDetailsRow('Łączna zużyta ilość', String(data.consumedQty))}
        ${renderCatalogDetailsRow('Data ostatniego użycia w budowie maszyny', escapeHtml(fmtDateISO(data.lastUsageDateISO)))}
      </div>
    </section>
  `;

  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  panel.classList.remove('hidden');
  document.body.classList.add('catalog-readonly-open');
}

function closeCatalogPartDetailsModal() {
  const backdrop = document.getElementById('catalogPartDetailsBackdrop');
  const panel = document.getElementById('catalogPartDetailsPanel');
  backdrop?.classList.add('hidden');
  backdrop?.setAttribute('aria-hidden', 'true');
  panel?.classList.add('hidden');
  document.body.classList.remove('catalog-readonly-open');
}

function openMachineCatalogDetailsModal(machineCodeRaw) {
  const data = getMachineCatalogDetailsData(machineCodeRaw);
  if (!data) return;

  const titleEl = document.getElementById('machineCatalogDetailsTitle');
  const subtitleEl = document.getElementById('machineCatalogDetailsSubtitle');
  const statsEl = document.getElementById('machineCatalogDetailsStats');
  const sectionsEl = document.getElementById('machineCatalogDetailsSections');
  const backdrop = document.getElementById('machineCatalogDetailsBackdrop');
  const panel = document.getElementById('machineCatalogDetailsPanel');
  if (!titleEl || !subtitleEl || !statsEl || !sectionsEl || !backdrop || !panel) return;

  titleEl.textContent = data.code || '—';
  subtitleEl.textContent = data.name || 'Podgląd informacji i statystyk maszyny.';

  statsEl.innerHTML = [
    renderCatalogDetailsStat('Pozycje BOM', String(data.bomCount)),
    renderCatalogDetailsStat('Łączne sztuki na 1 budowę', String(data.totalBomQty)),
    renderCatalogDetailsStat('Wyprodukowano', String(data.totalProducedQty)),
    renderCatalogDetailsStat('Maks. do zbudowania', String(data.maxBuildableUnits))
  ].join('');

  sectionsEl.innerHTML = `
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Podstawowe</h4><p>Kondensat najważniejszych informacji o definicji maszyny.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Nazwa / typ', `<strong>${escapeHtml(data.name || '—')}</strong>`)}
        ${renderCatalogDetailsRow('Liczba pozycji BOM', String(data.bomCount))}
        ${renderCatalogDetailsRow('Łączna liczba wszystkich sztuk części potrzebnych do 1 budowy', String(data.totalBomQty))}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Produkcja</h4><p>Liczone z historii produkcji.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Ile razy była budowana', String(data.buildCount))}
        ${renderCatalogDetailsRow('Ile łącznie sztuk tej maszyny wyprodukowano', String(data.totalProducedQty))}
        ${renderCatalogDetailsRow('Data ostatniej budowy', escapeHtml(fmtDateISO(data.lastBuildDateISO)))}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>Koszt</h4><p>Szacunek liczony z referencyjnych cen części.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Szacowany koszt budowy 1 sztuki', escapeHtml(data.estimatedUnitCost > 0 ? fmtPLN.format(data.estimatedUnitCost) : 'brak danych'))}
      </div>
    </section>
    <section class="catalog-readonly-section">
      <div class="catalog-readonly-section-head"><div><h4>BOM / gotowość</h4><p>Realna gotowość ograniczona stanem magazynowym.</p></div></div>
      <div class="catalog-readonly-grid">
        ${renderCatalogDetailsRow('Maksymalna liczba sztuk możliwych do zbudowania z obecnego magazynu', String(data.maxBuildableUnits))}
      </div>
    </section>
  `;

  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  panel.classList.remove('hidden');
  document.body.classList.add('catalog-readonly-open');
}

function closeMachineCatalogDetailsModal() {
  const backdrop = document.getElementById('machineCatalogDetailsBackdrop');
  const panel = document.getElementById('machineCatalogDetailsPanel');
  backdrop?.classList.add('hidden');
  backdrop?.setAttribute('aria-hidden', 'true');
  panel?.classList.add('hidden');
  document.body.classList.remove('catalog-readonly-open');
}

function renderCatalogStatusBadges({ isArchived = false, warningBadges = [] } = {}) {
  if (isArchived) {
    return '<div class="catalog-status-badges"><span class="badge badge-muted badge-status-warning">ZARCHIWIZOWANE</span></div>';
  }

  const badges = Array.isArray(warningBadges) ? warningBadges.filter(Boolean) : [];
  return badges.length
    ? `<div class="catalog-status-badges">${badges.join('')}</div>`
    : '<span class="catalog-status-empty" aria-hidden="true"></span>';
}


function normalizeCatalogSearchQuery(value) {
  return normalize(value).toLowerCase();
}

function catalogIncludesQuery(query, ...values) {
  if (!query) return true;
  return values.some(value => String(value || '').toLowerCase().includes(query));
}

function renderAllSuppliers() {
  const table = byId("suppliersListTable");
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;

  const canCreate = typeof canCreateSuppliers === 'function' ? canCreateSuppliers() : true;
  const canEdit = typeof canEditSuppliers === 'function' ? canEditSuppliers() : true;
  const supplierAddRow = document.querySelector('.supplier-add-row');
  if (supplierAddRow) {
    supplierAddRow.classList.toggle('hidden', !canCreate);
    supplierAddRow.setAttribute('aria-hidden', canCreate ? 'false' : 'true');
  }

  const q = normalizeCatalogSearchQuery(document.getElementById("searchCatalogSuppliers")?.value);
  
  const supplierRows = Array.from(state.suppliers.keys())
    .sort()
    .filter(name => catalogIncludesQuery(q, name));
  const paginatedSuppliers = paginateTableRows('catalog_suppliers', supplierRows);

  tbody.innerHTML = paginatedSuppliers.rows
    .map(name => {
      const warnings = getSupplierDataWarnings(name);
      const isArchived = isSupplierArchived(name);
      const warningBadges = [];

      if (warnings.hasMissingParts) {
        warningBadges.push('<span class="badge badge-warning badge-status-warning">BRAK CZĘŚCI</span>');
      }

      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>
            ${renderCatalogStatusBadges({ isArchived, warningBadges })}
          </td>
          <td class="text-right">
            <div class="catalog-actions">
              ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="openSupplierEditor('${escapeHtml(name)}')">Edytuj</button>` : ``}
              ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="toggleSupplierArchive('${escapeHtml(name)}')">${isArchived ? 'Przywróć' : 'Archiwizuj'}</button>` : ``}
              <button class="btn btn-secondary btn-sm" type="button" data-action="openSupplierCatalogDetails" data-supplier="${escapeHtml(name)}">Szczegóły</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

  renderTablePagination('#suppliersListTable', 'catalog_suppliers', paginatedSuppliers);
  renderSelectOptions(document.getElementById("supplierSelect"), getActiveSupplierNames());
}

function refreshCatalogsUI() {
  const els = getEls();
  if (!els.partsCatalog || !els.machinesCatalog) return;

  const canPartsCreate = typeof canCreateCatalogParts === 'function' ? canCreateCatalogParts() : true;
  const canPartsEdit = typeof canEditCatalogParts === 'function' ? canEditCatalogParts() : true;
  const canMachinesCreate = typeof canCreateCatalogMachines === 'function' ? canCreateCatalogMachines() : true;
  const canMachinesEdit = typeof canEditCatalogMachines === 'function' ? canEditCatalogMachines() : true;
  const newPartBtn = document.getElementById('toggleNewPartBtn');
  const newMachineBtn = document.getElementById('openMachineModalBtn');

  if (newPartBtn) {
    newPartBtn.classList.toggle('hidden', !canPartsCreate);
    newPartBtn.setAttribute('aria-hidden', canPartsCreate ? 'false' : 'true');
  }
  if (newMachineBtn) {
    newMachineBtn.classList.toggle('hidden', !canMachinesCreate);
    newMachineBtn.setAttribute('aria-hidden', canMachinesCreate ? 'false' : 'true');
  }

  const parts = Array.from(state.partsCatalog.values());
  const activeParts = getActivePartsCatalog();
  const allSups = getActiveSupplierNames();
  const partsQuery = normalizeCatalogSearchQuery(document.getElementById("searchCatalogParts")?.value);
  const machinesQuery = normalizeCatalogSearchQuery(document.getElementById("searchCatalogMachines")?.value);

  // Parts catalog
  const filteredCatalogParts = parts
    .filter(p => catalogIncludesQuery(partsQuery, p?.sku, p?.name));
  const paginatedCatalogParts = paginateTableRows('catalog_parts', filteredCatalogParts);

  els.partsCatalog.innerHTML = paginatedCatalogParts.rows
    .map(p => {
      const warnings = getPartDataWarnings(p.sku);
      const suppliers = warnings.suppliers.map(item => item.name);
      const isArchived = !!p?.archived;
      const warningBadges = [];

      if (warnings.hasMissingPrice) {
        warningBadges.push('<span class="badge badge-warning badge-status-warning">BRAK CENY</span>');
      }
      if (warnings.hasMissingSuppliers) {
        warningBadges.push('<span class="badge badge-warning badge-status-warning">BRAK DOSTAWCÓW</span>');
      }

      return `<tr>
        <td><span class="badge">${escapeHtml(p.sku)}</span></td>
        <td>${escapeHtml(p.name)}</td>
        <td>${suppliers.length ? suppliers.map(s => escapeHtml(s)).join(", ") : '<span class="text-muted">-</span>'}</td>
        <td>
          ${renderCatalogStatusBadges({ isArchived, warningBadges })}
        </td>
        <td class="text-right">
          <div class="catalog-actions">
            ${canPartsEdit ? `<button class="btn btn-secondary btn-sm" onclick="startEditPart('${escapeHtml(p.sku)}')">Edytuj</button>` : ``}
            ${canPartsEdit ? `<button class="btn btn-secondary btn-sm" onclick="togglePartArchive('${escapeHtml(p.sku)}')">${isArchived ? 'Przywróć' : 'Archiwizuj'}</button>` : ``}
            <button class="btn btn-secondary btn-sm" type="button" data-action="openCatalogPartDetails" data-sku="${escapeHtml(p.sku)}">Szczegóły</button>
          </div>
        </td>
      </tr>`;
    }).join("");

  renderTablePagination('#partsCatalogTable', 'catalog_parts', paginatedCatalogParts);

  // Machines catalog
  const filteredCatalogMachines = state.machineCatalog
    .filter(m => catalogIncludesQuery(machinesQuery, m?.code, m?.name));
  const paginatedCatalogMachines = paginateTableRows('catalog_machines', filteredCatalogMachines);

  els.machinesCatalog.innerHTML = paginatedCatalogMachines.rows
    .map(m => {
      const warnings = getMachineDataWarnings(m.code);
      const isArchived = !!m?.archived;
      const warningBadges = [];

      if (warnings.hasMissingParts) {
        warningBadges.push('<span class="badge badge-warning badge-status-warning">BRAK CZĘŚCI</span>');
      }

      return `
        <tr>
          <td><span class="badge">${escapeHtml(m.code)}</span></td>
          <td>${escapeHtml(m.name)}</td>
          <td class="text-right">${Array.isArray(m.bom) ? m.bom.length : 0}</td>
          <td>
            ${renderCatalogStatusBadges({ isArchived, warningBadges })}
          </td>
          <td class="text-right">
            <div class="catalog-actions">
              ${canMachinesEdit ? `<button class="btn btn-secondary btn-sm" onclick="openMachineEditor('${escapeHtml(m.code)}')">Edytuj</button>` : ``}
              ${canMachinesEdit ? `<button class="btn btn-secondary btn-sm" onclick="toggleMachineArchive('${escapeHtml(m.code)}')">${isArchived ? 'Przywróć' : 'Archiwizuj'}</button>` : ``}
              <button class="btn btn-secondary btn-sm" type="button" data-action="openMachineCatalogDetails" data-machine-code="${escapeHtml(m.code)}">Szczegóły</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

  renderTablePagination('#machinesCatalogTable', 'catalog_machines', paginatedCatalogMachines);

  // Machine select
  renderSelectOptions(els.machineSelect, getActiveMachineCatalog().map(m => m.code), c => {
    const m = state.machineCatalog.find(x => x.code === c);
    return `${c} (${m?.name || ""})`;
  });

  const bomSkuSelect = document.getElementById('bomSkuSelect');
  if (bomSkuSelect) {
    renderSelectOptions(bomSkuSelect, activeParts.map(p => p.sku), sku => {
      const part = state.partsCatalog.get(skuKey(sku));
      return `${sku} (${part?.name || ""})`;
    });
    refreshComboFromSelect(bomSkuSelect, { placeholder: 'Wybierz część...' });
  }

  const supplierEditorPartSelect = document.getElementById('supplierEditorPartSelect');
  if (supplierEditorPartSelect) {
    renderSelectOptions(supplierEditorPartSelect, activeParts.map(p => p.sku), sku => {
      const part = state.partsCatalog.get(skuKey(sku));
      return `${sku} (${part?.name || ""})`;
    });
    refreshComboFromSelect(supplierEditorPartSelect, { placeholder: 'Wybierz część...' });
  }

  const supBox = byId("partNewSuppliersChecklist");
  if (supBox) {
    comboMultiRender(supBox, {
      options: allSups,
      selected: comboMultiGetSelected(supBox),
      placeholder: allSups.length ? "Wybierz dostawców..." : "Brak zdefiniowanych dostawców."
    });
  }

  const editBox = byId('editPartSuppliersChecklist');
  if (editBox) {
    comboMultiRender(editBox, {
      options: allSups,
      selected: comboMultiGetSelected(editBox),
      placeholder: allSups.length ? 'Wybierz dostawców...' : 'Brak zdefiniowanych dostawców.'
    });
  }

  if (typeof syncDeliveryDraftUI === 'function') {
    syncDeliveryDraftUI({ keepSelectedPart: true });
  }

  if (typeof syncNewPartSupplierPricesUI === 'function') syncNewPartSupplierPricesUI();
  if (typeof syncEditPartSupplierPricesUI === 'function') syncEditPartSupplierPricesUI();
}


// === Shared comboboxes ===
const _comboRegistry = new WeakMap();
const _singleComboRegistry = new WeakMap();
let _openComboApi = null;

function getComboValueFromSelect(selectEl) {
  if (!selectEl) return "";
  const data = _singleComboRegistry.get(selectEl);
  const registryValue = normalize(data?.currentValue ?? "");
  const selectValue = normalize(selectEl.value ?? "");
  return registryValue || selectValue;
}

function setComboValueForSelect(selectEl, value, opts = {}) {
  if (!selectEl) return "";
  const normalized = normalize(value ?? "");
  selectEl.value = normalized;

  const data = _singleComboRegistry.get(selectEl);
  if (data) data.currentValue = normalized;

  try {
    refreshComboFromSelect(selectEl, opts || {});
  } catch {}

  if (opts?.dispatchChange) {
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return normalized;
}

function closeOpenCombobox(exceptApi = null) {
  if (_openComboApi && _openComboApi !== exceptApi) {
    _openComboApi.close();
  }
}

function createComboShell(hostEl, placeholder = "Wybierz...", extraClass = "") {
  hostEl.innerHTML = `
    <button type="button" class="combobox-trigger ${extraClass}" aria-expanded="false">
      <span class="combobox-trigger-label">${escapeHtml(placeholder)}</span>
    </button>
    <div class="combobox-menu hidden">
      <div class="combobox-search">
        <input type="text" class="combobox-search-input" placeholder="Szukaj..." autocomplete="off" />
      </div>
      <div class="combobox-options" role="listbox"></div>
    </div>
  `;

  return {
    trigger: hostEl.querySelector('.combobox-trigger'),
    label: hostEl.querySelector('.combobox-trigger-label'),
    menu: hostEl.querySelector('.combobox-menu'),
    search: hostEl.querySelector('.combobox-search-input'),
    optionsBox: hostEl.querySelector('.combobox-options')
  };
}

function attachComboBehavior(hostEl, refs, api) {
  const { trigger, menu, search } = refs;

  api.open = () => {
    closeOpenCombobox(api);
    hostEl.classList.add('open');
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    _openComboApi = api;
    api.refresh?.();
    requestAnimationFrame(() => {
      search?.focus();
      search?.select?.();
    });
  };

  api.close = () => {
    hostEl.classList.remove('open');
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    if (_openComboApi === api) _openComboApi = null;
    if (search) search.value = '';
    api.activeIndex = -1;
    api.refresh?.();
  };

  api.toggle = () => {
    if (hostEl.classList.contains('open')) api.close();
    else api.open();
  };

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    api.toggle();
  });

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      api.open();
    } else if (e.key === 'Escape') {
      api.close();
    }
  });

  search?.addEventListener('input', () => {
    api.activeIndex = 0;
    api.refresh?.();
  });

  search?.addEventListener('keydown', (e) => {
    const items = Array.from(refs.optionsBox.querySelectorAll('.combobox-option:not(.is-empty):not(.is-disabled)'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!items.length) return;
      api.activeIndex = Math.min(items.length - 1, api.activeIndex + 1);
      api.refresh?.();
      items[api.activeIndex]?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      api.activeIndex = Math.max(0, api.activeIndex - 1);
      api.refresh?.();
      items[api.activeIndex]?.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      const target = items[Math.max(0, api.activeIndex)] || items[0];
      if (target) {
        e.preventDefault();
        target.click();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      api.close();
      trigger.focus();
      return;
    }
    if (e.key === 'Tab') {
      api.close();
    }
  });
}

function comboMultiGetSelected(hostEl) {
  if (!hostEl) return [];
  return [...(_comboRegistry.get(hostEl)?.selected || [])];
}

function comboMultiClear(hostEl) {
  if (!hostEl) return;
  const data = _comboRegistry.get(hostEl);
  if (!data) return;
  comboMultiRender(hostEl, { options: data.options, selected: [], placeholder: data.placeholder });
}

function comboMultiSetSelected(hostEl, selected = []) {
  if (!hostEl) return;
  const data = _comboRegistry.get(hostEl);
  if (!data) {
    comboMultiRender(hostEl, { selected });
    return;
  }
  comboMultiRender(hostEl, {
    options: data.options,
    selected,
    placeholder: data.placeholder
  });
}

function comboMultiRender(hostEl, opts) {
  if (!hostEl) return;

  const options = Array.isArray(opts?.options) ? [...opts.options] : [];
  const placeholder = opts?.placeholder || 'Wybierz...';
  const selected = Array.from(new Set(Array.isArray(opts?.selected) ? opts.selected.filter(v => options.includes(v)) : []));

  let data = _comboRegistry.get(hostEl);
  if (!data) {
    hostEl.classList.add('combo-tags-host');
    const refs = createComboShell(hostEl, placeholder);
    const selectedList = document.createElement('div');
    selectedList.className = 'combobox-selected-list';
    hostEl.appendChild(selectedList);

    data = {
      hostEl,
      refs,
      selectedList,
      options: [],
      selected: [],
      placeholder,
      activeIndex: -1,
      refresh: null,
      open: null,
      close: null,
      toggle: null
    };

    attachComboBehavior(hostEl, refs, data);
    _comboRegistry.set(hostEl, data);
  }

  data.options = options;
  data.selected = selected;
  data.placeholder = placeholder;
  data.refs.search.placeholder = options.length ? 'Szukaj i dodaj...' : 'Brak opcji';

  data.refresh = () => {
    const { label, optionsBox, search } = data.refs;
    const query = String(search?.value || '').trim().toLowerCase();
    const available = data.options.filter(opt => !data.selected.includes(opt));
    const filtered = available.filter(opt => !query || opt.toLowerCase().includes(query));

    label.textContent = data.selected.length ? `Dodaj kolejny (${data.selected.length})` : data.placeholder;

    if (!filtered.length) {
      optionsBox.innerHTML = `<div class="combobox-option is-empty">${available.length ? 'Brak wyników' : 'Brak dostępnych opcji'}</div>`;
    } else {
      if (data.activeIndex >= filtered.length) data.activeIndex = filtered.length - 1;
      if (data.activeIndex < 0) data.activeIndex = 0;
      optionsBox.innerHTML = filtered.map((opt, idx) => `
        <button type="button" class="combobox-option ${idx === data.activeIndex ? 'active' : ''}" data-value="${escapeHtml(opt)}">
          <span>${escapeHtml(opt)}</span>
        </button>
      `).join('');

      optionsBox.querySelectorAll('.combobox-option[data-value]').forEach(btn => {
        btn.addEventListener('click', () => {
          const value = btn.getAttribute('data-value') || '';
          if (!value || data.selected.includes(value)) return;
          data.selected.push(value);
          if (data.refs.search) data.refs.search.value = '';
          data.activeIndex = 0;
          data.refresh();
          hostEl.dispatchEvent(new Event('change', { bubbles: true }));
          requestAnimationFrame(() => data.refs.search?.focus());
        });
      });
    }

    if (!data.selected.length) {
      data.selectedList.innerHTML = `<div class="combobox-selected-empty text-muted">Nic jeszcze nie wybrano.</div>`;
    } else {
      data.selectedList.innerHTML = data.selected.map(value => `
        <div class="combobox-chip">
          <span class="combobox-chip-label">${escapeHtml(value)}</span>
          <button type="button" class="combobox-chip-remove" data-remove="${escapeHtml(value)}" aria-label="Usuń ${escapeHtml(value)}">×</button>
        </div>
      `).join('');

      data.selectedList.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', () => {
          const value = btn.getAttribute('data-remove') || '';
          data.selected = data.selected.filter(v => v !== value);
          data.refresh();
          hostEl.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }
  };

  data.refresh();
}

function renderSelectOptions(selectEl, options, labelFn = null) {
  if (!selectEl) return;
  const currentValue = selectEl.value;
  selectEl.innerHTML = '<option value="">-- Wybierz --</option>' + 
    options.map(opt => {
      const label = labelFn ? labelFn(opt) : opt;
      return `<option value="${escapeHtml(opt)}">${escapeHtml(label)}</option>`;
    }).join('');
  if (options.includes(currentValue)) selectEl.value = currentValue;
  refreshComboFromSelect(selectEl);
}

function initComboFromSelect(selectEl, opts = {}) {
  if (!selectEl) return null;

  let data = _singleComboRegistry.get(selectEl);
  if (!data) {
    selectEl.classList.add('combo-native-hidden');

    const hostEl = document.createElement('div');
    hostEl.className = 'combobox combo-select-host';
    selectEl.insertAdjacentElement('afterend', hostEl);

    const refs = createComboShell(hostEl, opts.placeholder || 'Wybierz...');
    data = {
      selectEl,
      hostEl,
      refs,
      placeholder: opts.placeholder || 'Wybierz...',
      includeEmptyOption: !!opts.includeEmptyOption,
      activeIndex: -1,
      currentValue: normalize(selectEl.value || ''),
      refresh: null,
      open: null,
      close: null,
      toggle: null
    };

    attachComboBehavior(hostEl, refs, data);

    selectEl.addEventListener('change', () => refreshComboFromSelect(selectEl));
    _singleComboRegistry.set(selectEl, data);
  }

  if (opts.placeholder) data.placeholder = opts.placeholder;
  if (Object.prototype.hasOwnProperty.call(opts, 'includeEmptyOption')) {
    data.includeEmptyOption = !!opts.includeEmptyOption;
  }
  refreshComboFromSelect(selectEl, opts);
  return data;
}

function refreshComboFromSelect(selectEl, opts = {}) {
  if (!selectEl) return null;
  const data = _singleComboRegistry.get(selectEl) || initComboFromSelect(selectEl, opts);
  if (!data) return null;

  if (opts.placeholder) data.placeholder = opts.placeholder;
  if (Object.prototype.hasOwnProperty.call(opts, 'includeEmptyOption')) {
    data.includeEmptyOption = !!opts.includeEmptyOption;
  }
  const { refs, hostEl } = data;
  const includeEmptyOption = !!data.includeEmptyOption;
  const options = Array.from(selectEl.options || []).map(opt => ({
    value: opt.value,
    label: opt.textContent || '',
    selected: opt.selected,
    disabled: !!opt.disabled
  })).filter(opt => includeEmptyOption || opt.value !== '');
  const hasVisibleOptions = options.some(opt => !opt.disabled);

  refs.search.placeholder = hasVisibleOptions ? 'Szukaj...' : 'Brak opcji';
  refs.trigger.disabled = !!selectEl.disabled;
  hostEl.classList.toggle('is-disabled', !!selectEl.disabled);

  if (!options.some(opt => opt.value === selectEl.value)) {
    selectEl.value = '';
  }
  data.currentValue = normalize(selectEl.value || '');

  data.refresh = () => {
    const query = String(refs.search?.value || '').trim().toLowerCase();
    const filtered = options.filter(opt => !query || opt.label.toLowerCase().includes(query) || opt.value.toLowerCase().includes(query));
    const selectedOpt = options.find(opt => opt.value === selectEl.value);

    refs.label.textContent = selectedOpt?.label || data.placeholder;

    if (!filtered.length) {
      refs.optionsBox.innerHTML = '<div class="combobox-option is-empty">Brak wyników</div>';
    } else {
      if (data.activeIndex >= filtered.length) data.activeIndex = filtered.length - 1;
      if (data.activeIndex < 0) data.activeIndex = Math.max(0, filtered.findIndex(opt => opt.value === selectEl.value));
      if (data.activeIndex < 0) data.activeIndex = 0;

      refs.optionsBox.innerHTML = filtered.map((opt, idx) => `
        <button type="button" class="combobox-option ${opt.value === selectEl.value ? 'selected' : ''} ${idx === data.activeIndex ? 'active' : ''} ${opt.disabled ? 'is-disabled' : ''}" data-value="${escapeHtml(opt.value)}" ${opt.disabled ? 'disabled' : ''}>
          <span>${escapeHtml(opt.label)}</span>
        </button>
      `).join('');

      refs.optionsBox.querySelectorAll('.combobox-option[data-value]').forEach(btn => {
        btn.addEventListener('click', () => {
          const value = btn.getAttribute('data-value') || '';
          if (selectEl.value === value) {
            data.currentValue = normalize(value);
            data.close();
            return;
          }
          selectEl.value = value;
          data.currentValue = normalize(value);
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          data.close();
          refs.trigger.focus();
        });
      });
    }
  };

  data.refresh();
  return data;
}

const _comboGlobalBound = (() => {
  if (window.__comboGlobalBound) return true;
  window.__comboGlobalBound = true;

  document.addEventListener('click', (e) => {
    if (_openComboApi?.hostEl?.contains?.(e.target)) return;
    closeOpenCombobox();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeOpenCombobox();
  });

  return true;
})();

// === Supplier Prices UI ===
function bindSupplierPricesUI() {
  const newChecklist = document.getElementById('partNewSuppliersChecklist');
  const editChecklist = document.getElementById('editPartSuppliersChecklist');
  
  if (newChecklist) {
    newChecklist.addEventListener('change', () => syncNewPartSupplierPricesUI());
  }
  if (editChecklist) {
    editChecklist.addEventListener('change', () => syncEditPartSupplierPricesUI());
  }
}

function syncNewPartSupplierPricesUI() {
  const checklist = document.getElementById('partNewSuppliersChecklist');
  const panel = document.getElementById('newPartSupplierPrices');
  const body = document.getElementById('newPartSupplierPricesBody');
  if (!checklist || !panel || !body) return;
  
  const selected = comboMultiGetSelected(checklist);
  if (!selected.length) {
    panel.classList.add('hidden');
    return;
  }
  
  panel.classList.remove('hidden');
  body.innerHTML = selected.map(sup => `
    <div class="form-row" style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2)">
      <span style="min-width:150px;font-size:var(--text-sm)">${escapeHtml(sup)}</span>
      <input type="number" data-sup="${escapeHtml(sup)}" min="0" step="0.01" value="0" 
        style="max-width:120px" placeholder="Cena">
      <span class="text-muted" style="font-size:var(--text-sm)">PLN</span>
    </div>
  `).join('');
}

function syncEditPartSupplierPricesUI() {
  const checklist = document.getElementById('editPartSuppliersChecklist');
  const panel = document.getElementById('editPartSupplierPrices');
  const body = document.getElementById('editPartSupplierPricesBody');
  if (!checklist || !panel || !body) return;
  
  const selected = comboMultiGetSelected(checklist);
  const sku = currentEditPartKey;
  if (!selected.length || !sku) {
    panel.classList.add('hidden');
    return;
  }
  
  panel.classList.remove('hidden');
  body.innerHTML = selected.map(sup => {
    const supData = state.suppliers.get(sup);
    const currentPrice = supData?.prices?.get(sku) || 0;
    return `
      <div class="form-row" style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-2)">
        <span style="min-width:150px;font-size:var(--text-sm)">${escapeHtml(sup)}</span>
        <input type="number" data-sup="${escapeHtml(sup)}" min="0" step="0.01" value="${currentPrice}" 
          style="max-width:120px" placeholder="Cena">
        <span class="text-muted" style="font-size:var(--text-sm)">PLN</span>
      </div>
    `;
  }).join('');
}

// === History Preview Modal ===
function openHistoryPreviewModal(ev) {
  const content = document.getElementById('historyPreviewContent');
  if (!content) return;
  
  content.innerHTML = buildHistoryDetails(ev);
  
  const backdrop = document.getElementById('historyPreviewBackdrop');
  const panel = document.getElementById('historyPreviewPanel');
  if (backdrop && panel) {
    backdrop.classList.remove('hidden');
    backdrop.setAttribute('aria-hidden', 'false');
    panel.classList.remove('hidden');
    document.body.classList.add('history-preview-open');
  }
}

function closeHistoryPreviewModal() {
  const backdrop = document.getElementById('historyPreviewBackdrop');
  const panel = document.getElementById('historyPreviewPanel');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
  }
  if (panel) panel.classList.add('hidden');
  document.body.classList.remove('history-preview-open');
}

// === Global click handlers for new actions ===
document.addEventListener('click', (e) => {
  // Existing warehouse part details button
  const detailsBtn = e.target?.closest?.('[data-action="openPartDetails"]');
  if (detailsBtn) {
    const sku = detailsBtn.getAttribute('data-sku');
    if (sku) openPartDetailsModal(sku);
    return;
  }

  // Catalog supplier details button
  const supplierDetailsBtn = e.target?.closest?.('[data-action="openSupplierCatalogDetails"]');
  if (supplierDetailsBtn) {
    const supplier = supplierDetailsBtn.getAttribute('data-supplier');
    if (supplier) openSupplierCatalogDetailsModal(supplier);
    return;
  }

  // Catalog part details button
  const catalogPartDetailsBtn = e.target?.closest?.('[data-action="openCatalogPartDetails"]');
  if (catalogPartDetailsBtn) {
    const sku = catalogPartDetailsBtn.getAttribute('data-sku');
    if (sku) openCatalogPartDetailsModal(sku);
    return;
  }

  // Catalog machine details button
  const machineDetailsBtn = e.target?.closest?.('[data-action="openMachineCatalogDetails"]');
  if (machineDetailsBtn) {
    const code = machineDetailsBtn.getAttribute('data-machine-code');
    if (code) openMachineCatalogDetailsModal(code);
    return;
  }
  
  // Batch Preview by Price button
  const batchBtn = e.target?.closest?.('[data-action="openBatchPreviewByPrice"]');
  if (batchBtn) {
    const sku = batchBtn.getAttribute('data-sku');
    const price = parseFloat(batchBtn.getAttribute('data-price'));
    if (sku && !isNaN(price)) openBatchPreviewByPrice(sku, price);
    return;
  }
  
  // History toggle button
  const historyBtn = e.target?.closest?.('[data-action="toggleHistory"]');
  if (historyBtn) {
    const id = historyBtn.getAttribute('data-hid');
    const ev = (state.history || []).find(x => String(x.id) === String(id));
    if (ev) openHistoryPreviewModal(ev);
    return;
  }
});

// === Modal close buttons ===
document.getElementById('partDetailsCloseBtn')?.addEventListener('click', closePartDetailsModal);
document.getElementById('supplierCatalogDetailsCloseBtn')?.addEventListener('click', closeSupplierCatalogDetailsModal);
document.getElementById('catalogPartDetailsCloseBtn')?.addEventListener('click', closeCatalogPartDetailsModal);
document.getElementById('machineCatalogDetailsCloseBtn')?.addEventListener('click', closeMachineCatalogDetailsModal);
document.getElementById('batchPreviewCloseBtn')?.addEventListener('click', closeBatchPreviewModal);
document.getElementById('historyPreviewCloseBtn')?.addEventListener('click', closeHistoryPreviewModal);

// Close modals on backdrop click
document.getElementById('partDetailsBackdrop')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePartDetailsModal();
});
document.getElementById('supplierCatalogDetailsBackdrop')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSupplierCatalogDetailsModal();
});
document.getElementById('catalogPartDetailsBackdrop')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeCatalogPartDetailsModal();
});
document.getElementById('machineCatalogDetailsBackdrop')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeMachineCatalogDetailsModal();
});
document.getElementById('batchPreviewBackdrop')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeBatchPreviewModal();
});
document.getElementById('historyPreviewBackdrop')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeHistoryPreviewModal();
});

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePartDetailsModal();
    closeSupplierCatalogDetailsModal();
    closeCatalogPartDetailsModal();
    closeMachineCatalogDetailsModal();
    closeBatchPreviewModal();
    closeHistoryPreviewModal();
  }
});
