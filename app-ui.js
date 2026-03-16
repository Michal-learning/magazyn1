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

function computePartsSummary() {
  const summary = new Map();

  for (const [key, part] of (state.partsCatalog || new Map()).entries()) {
    if (!key || !part) continue;
    summary.set(key, {
      sku: part.sku,
      name: part.name,
      qty: 0,
      value: 0
    });
  }

  (state.lots || []).forEach(lot => {
    const key = skuKey(lot.sku);
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

  const rows = computePartsSummary()
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
      <li style="padding:var(--space-3);background:var(--surface-1);border:1px solid var(--border);border-radius:var(--radius-md)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-1)">
          <span class="badge badge-${pillClass}">${typeLabel}</span>
          <span class="text-muted" style="font-size:var(--text-sm)">${fmtDateISO(ev.dateISO)}</span>
        </div>
        <div class="text-secondary" style="font-size:var(--text-sm)">${meta}</div>
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
          <table class="batch-preview-table">
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

  const searchInput = document.getElementById("searchParts");
  const q = normalize(searchInput?.value).toLowerCase();
  const stockEditToggleBtn = document.getElementById("stockEditToggleBtn");
  const stockEditActions = document.getElementById("stockEditActions");
  const stockEditBanner = document.getElementById("stockEditBanner");
  const isEditMode = !!state.ui?.stockEditMode;
  const pendingMap = state.ui?.pendingStockAdjustments || {};
  
  const summaryRows = computePartsSummary().filter(item => {
    if (!q) return true;
    return String(item?.sku || '').toLowerCase().includes(q) || String(item?.name || '').toLowerCase().includes(q);
  });
  let grandTotal = 0;

  summaryRows.forEach(item => { grandTotal += item.value; });
  const totalFormatted = fmtPLN.format(grandTotal);

  if (els.sideWarehouseTotal) els.sideWarehouseTotal.textContent = totalFormatted;
  if (els.whTotal) els.whTotal.textContent = totalFormatted;

  if (stockEditToggleBtn) stockEditToggleBtn.classList.toggle("hidden", isEditMode);
  if (stockEditActions) stockEditActions.classList.toggle("hidden", !isEditMode);
  if (stockEditBanner) {
    if (isEditMode) {
      stockEditBanner.classList.remove("hidden");
      const changedCount = getPendingStockAdjustmentsCount();
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

  els.summaryTable.innerHTML = summaryRows
    .slice()
    .sort((a, b) => (safeQtyInt(a.qty) - safeQtyInt(b.qty)) || String(a.sku).localeCompare(String(b.sku), 'pl'))
    .map(item => {
      const pending = pendingMap[skuKey(item.sku)];
      const isInvalid = !!pending?.invalid;
      const diff = isInvalid ? null : Number.isFinite(pending?.diff) ? pending.diff : 0;
      const effectiveQty = isInvalid ? item.qty : Number.isFinite(pending?.newQty) ? safeQtyInt(pending.newQty) : item.qty;
      const statusMeta = getPartStockStatus(item.sku, effectiveQty);
      const rowClass = [
        statusMeta.level === "danger" ? "stock-row-danger" : statusMeta.level === "warning" ? "stock-row-warning" : "",
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

  renderSidePanel();
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
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <span class="badge">${escapeHtml(i.sku)}</span>
          <span>${escapeHtml(i.name || "")}</span>
        </div>
      </td>
      <td class="text-right">${i.qty}</td>
      <td class="text-right">${fmtPLN.format(i.price)}</td>
      <td class="text-right">${fmtPLN.format(rowVal)}</td>
      <td class="text-right">
        <button class="btn btn-danger btn-sm btn-icon" onclick="removeDeliveryItem(${i.id})" aria-label="Usuń">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");

  const itemsCountEl = document.getElementById("itemsCount");
  const itemsTotalEl = document.getElementById("itemsTotal");
  const finalizeBtn = document.getElementById("finalizeDeliveryBtn");
  
  if (itemsCountEl) itemsCountEl.textContent = String(items.length);
  if (itemsTotalEl) itemsTotalEl.textContent = fmtPLN.format(total);
  if (finalizeBtn) finalizeBtn.disabled = items.length === 0;
}


function renderBuild() {
  const els = getEls();
  if (!els.buildItems) return;

  els.buildItems.innerHTML = state.currentBuild.items.map(i => {
    const machineName = getBuildItemMachineName(i);
    return `<tr>
      <td>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <span class="badge">${escapeHtml(i.machineCode)}</span>
          <span>${escapeHtml(machineName || "???")}</span>
        </div>
      </td>
      <td class="text-right">${i.qty}</td>
      <td class="text-right">
        <button class="btn btn-danger btn-sm btn-icon" onclick="removeBuildItem(${i.id})" aria-label="Usuń">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");

  const buildCountEl = document.getElementById("buildItemsCount");
  const finalizeBuildBtn = document.getElementById("finalizeBuildBtn");
  
  if (buildCountEl) buildCountEl.textContent = String(state.currentBuild.items.length);
  if (finalizeBuildBtn) finalizeBuildBtn.disabled = state.currentBuild.items.length === 0;

  if (els.missingBox) els.missingBox.classList.add("hidden");
  if (els.manualBox) els.manualBox.classList.add("hidden");

  const mode = document.getElementById("consumeMode")?.value || "fifo";
  if (mode === "manual" && state.currentBuild.items.length > 0) {
    renderManualConsume();
  }
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
                aria-label="Ilość z partii ${lotId}">
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
  
  const tbody = document.querySelector("#machinesStockTable tbody");
  if (!tbody) return;

  tbody.innerHTML = state.machinesStock
    .filter(m => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q))
    .map(m => `<tr>
      <td>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <span class="badge">${escapeHtml(m.code)}</span>
        </div>
      </td>
      <td>${escapeHtml(m.name)}</td>
      <td class="text-right"><strong>${m.qty}</strong></td>
    </tr>`).join("");
}

function getHistoryView() {
  const v = localStorage.getItem("magazyn_history_view_v3");
  return (v === "builds" || v === "adjustments") ? v : "deliveries";
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

function historyMatchesFilters(ev, view, qNorm, fromISO, toISO) {
  if (!ev) return false;
  if (view === "deliveries" && ev.type !== "delivery") return false;
  if (view === "builds" && ev.type !== "build") return false;
  if (view === "adjustments" && ev.type !== "adjustment") return false;

  const d = ev.dateISO || "";
  if (fromISO && d && d < fromISO) return false;
  if (toISO && d && d > toISO) return false;

  if (!qNorm) return true;

  if (view === "deliveries") {
    const supplier = normalize(ev.supplier || "").toLowerCase();
    if (supplier.includes(qNorm)) return true;

    const items = Array.isArray(ev.items) ? ev.items : [];
    for (const it of items) {
      const sku = normalize(it?.sku || "").toLowerCase();
      const name = normalize(it?.name || "").toLowerCase();
      if ((sku && sku.includes(qNorm)) || (name && name.includes(qNorm))) return true;
    }
    return false;
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
  
  const qNorm = normalize(searchInput?.value || "").toLowerCase();
  const { fromISO, toISO } = parseHistoryDateRange(dateInput?.value || "");

  const rows = (state.history || [])
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .filter(ev => historyMatchesFilters(ev, view, qNorm, fromISO, toISO));

  if (!rows.length) {
    const msg = (view === "deliveries")
      ? "Brak dostaw w historii dla wybranych filtrów."
      : (view === "builds")
        ? "Brak produkcji w historii dla wybranych filtrów."
        : "Brak korekt w historii dla wybranych filtrów.";
    tbody.innerHTML = `<tr><td colspan="3" class="text-muted" style="text-align:center;padding:var(--space-6)">${msg}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(ev => {
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
        <td>${summary}</td>
        <td class="text-right">
          <button class="btn btn-secondary btn-sm" type="button" 
            data-action="toggleHistory" data-hid="${ev.id}">Podgląd</button>
        </td>
      </tr>
    `;
  }).join("");

  renderSideRecentActions5();
}

function buildHistoryDetails(ev) {
  if (!ev) return "";

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

    return `
      <div class="history-modal-head">
        <div>
          <div class="history-modal-kicker"><span class="badge ${badgeClass}">${typeLabel}</span><span>${fmtDateISO(ev.dateISO)}</span></div>
          <h3 class="history-modal-title">Podgląd dostawy</h3>
          <p class="history-modal-subtitle">Szczegóły przyjęcia od dostawcy i pełne zestawienie pozycji.</p>
        </div>
      </div>

      <div class="history-modal-stats history-modal-stats-3">
        <div class="history-stat-card">
          <span class="history-stat-label">Dostawca</span>
          <strong class="history-stat-value">${escapeHtml(ev.supplier || "—")}</strong>
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
          <table class="history-modal-table">
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

  const totalQty = items.reduce((s, i) => s + safeInt(i.qty), 0);
  const totalConsumptionValue = items.reduce((sum, it) => {
    const machineVal = (it?.partsUsed || []).reduce((ms, p) => {
      const lots = Array.isArray(p?.lots) ? p.lots : [];
      return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
    }, 0);
    return sum + machineVal;
  }, 0);

  const machineCards = items.map((i) => {
    const machineConsumptionValue = (i?.partsUsed || []).reduce((ms, p) => {
      const lots = Array.isArray(p?.lots) ? p.lots : [];
      return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
    }, 0);

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

    const empty = !partsRows ? `
      <div class="history-empty-state">
        <span class="text-muted">Brak danych o zużytych partiach dla tej maszyny.</span>
      </div>
    ` : `
      <div class="table-container history-modal-table-wrap">
        <table class="history-modal-table history-modal-table-dense">
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
            <div><span>Zużycie</span><strong>${fmtPLN.format(machineConsumptionValue || 0)}</strong></div>
          </div>
        </div>
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
        <strong class="history-stat-value">${fmtPLN.format(totalConsumptionValue || 0)}</strong>
      </div>
    </div>

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

function renderAllSuppliers() {
  const table = byId("suppliersListTable");
  const tbody = table?.querySelector("tbody");
  if (!tbody) return;
  
  tbody.innerHTML = Array.from(state.suppliers.keys()).sort().map(name => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td class="text-right">
        <button class="btn btn-success btn-sm" onclick="openSupplierEditor('${escapeHtml(name)}')">Cennik</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="askDeleteSupplier('${escapeHtml(name)}')" aria-label="Usuń">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>
  `).join("");

  renderSelectOptions(document.getElementById("supplierSelect"), Array.from(state.suppliers.keys()));
}

function refreshCatalogsUI() {
  const els = getEls();
  if (!els.partsCatalog || !els.machinesCatalog) return;

  const parts = Array.from(state.partsCatalog.values());
  const allSups = Array.from(state.suppliers.keys()).sort();

  // Parts catalog
  els.partsCatalog.innerHTML = parts.map(p => {
    const warnings = getPartDataWarnings(p.sku);
    const suppliers = warnings.suppliers.map(item => item.name);
    const badges = [];

    if (warnings.hasMissingPrice) {
      badges.push('<span class="badge badge-warning badge-status-warning">BRAK CENY</span>');
    }
    if (warnings.hasMissingSuppliers) {
      badges.push('<span class="badge badge-warning badge-status-warning">BRAK DOSTAWCÓW</span>');
    }

    return `<tr>
      <td><span class="badge">${escapeHtml(p.sku)}</span></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${suppliers.length ? suppliers.map(s => escapeHtml(s)).join(", ") : '<span class="text-muted">-</span>'}</td>
      <td>
        ${badges.length ? `<div class="catalog-status-badges">${badges.join('')}</div>` : '<span class="catalog-status-empty" aria-hidden="true"></span>'}
      </td>
      <td class="text-right">
        <button class="btn btn-success btn-sm" onclick="startEditPart('${escapeHtml(p.sku)}')">Edytuj</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="askDeletePart('${escapeHtml(p.sku)}')" aria-label="Usuń">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");

  // Machines catalog
  els.machinesCatalog.innerHTML = state.machineCatalog.map(m => {
    const warnings = getMachineDataWarnings(m.code);
    const badges = [];

    if (warnings.hasMissingParts) {
      badges.push('<span class="badge badge-warning badge-status-warning">BRAK CZĘŚCI</span>');
    }

    return `
    <tr>
      <td><span class="badge">${escapeHtml(m.code)}</span></td>
      <td>${escapeHtml(m.name)}</td>
      <td class="text-right">${Array.isArray(m.bom) ? m.bom.length : 0}</td>
      <td>
        ${badges.length ? `<div class="catalog-status-badges">${badges.join('')}</div>` : '<span class="catalog-status-empty" aria-hidden="true"></span>'}
      </td>
      <td class="text-right">
        <button class="btn btn-success btn-sm" onclick="openMachineEditor('${escapeHtml(m.code)}')">Edytuj BOM</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="askDeleteMachine('${escapeHtml(m.code)}')" aria-label="Usuń">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>
  `;
  }).join("");

  // Machine select
  renderSelectOptions(els.machineSelect, state.machineCatalog.map(m => m.code), c => {
    const m = state.machineCatalog.find(x => x.code === c);
    return `${c} (${m?.name || ""})`;
  });

  const bomSkuSelect = document.getElementById('bomSkuSelect');
  if (bomSkuSelect) {
    renderSelectOptions(bomSkuSelect, parts.map(p => p.sku), sku => {
      const part = state.partsCatalog.get(skuKey(sku));
      return `${sku} (${part?.name || ""})`;
    });
    refreshComboFromSelect(bomSkuSelect, { placeholder: 'Wybierz część...' });
  }

  const supplierEditorPartSelect = document.getElementById('supplierEditorPartSelect');
  if (supplierEditorPartSelect) {
    renderSelectOptions(supplierEditorPartSelect, parts.map(p => p.sku), sku => {
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
  refreshComboFromSelect(selectEl, opts);
  return data;
}

function refreshComboFromSelect(selectEl, opts = {}) {
  if (!selectEl) return null;
  const data = _singleComboRegistry.get(selectEl) || initComboFromSelect(selectEl, opts);
  if (!data) return null;

  if (opts.placeholder) data.placeholder = opts.placeholder;
  const { refs, hostEl } = data;
  const options = Array.from(selectEl.options || []).map(opt => ({
    value: opt.value,
    label: opt.textContent || '',
    selected: opt.selected,
    disabled: !!opt.disabled
  })).filter(opt => opt.value !== '');

  refs.search.placeholder = options.length ? 'Szukaj...' : 'Brak opcji';
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
  // Part Details button
  const detailsBtn = e.target?.closest?.('[data-action="openPartDetails"]');
  if (detailsBtn) {
    const sku = detailsBtn.getAttribute('data-sku');
    if (sku) openPartDetailsModal(sku);
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
document.getElementById('batchPreviewCloseBtn')?.addEventListener('click', closeBatchPreviewModal);
document.getElementById('historyPreviewCloseBtn')?.addEventListener('click', closeHistoryPreviewModal);

// Close modals on backdrop click
document.getElementById('partDetailsBackdrop')?.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closePartDetailsModal();
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
    closeBatchPreviewModal();
    closeHistoryPreviewModal();
  }
});
