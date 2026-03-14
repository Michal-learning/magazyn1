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

// Part details modal state
let currentPartDetailsSku = null;

function computePartsSummary() {
  const summary = new Map();
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
    .filter(r => Number.isFinite(r.qty))
    .sort((a, b) => (a.qty - b.qty) || String(a.sku).localeCompare(String(b.sku), "pl"))
    .slice(0, 5);

  if (!rows.length) {
    els.sideMissingSignals.innerHTML = `<div class="text-muted" style="font-size:var(--text-sm);padding:var(--space-3);text-align:center">Brak danych</div>`;
    return;
  }

  els.sideMissingSignals.innerHTML = rows.map(r => {
    const cls = r.qty <= LOW_DANGER ? "danger" : r.qty <= LOW_WARN ? "warning" : "success";
    const status = r.qty <= LOW_DANGER ? "Krytyczne" : r.qty <= LOW_WARN ? "Niskie" : "OK";

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
    const typeLabel = ev.type === "delivery" ? "Dostawa" : "Produkcja";
    const pillClass = ev.type === "delivery" ? "success" : "accent";

    const meta = ev.type === "delivery"
      ? `${(ev.items || []).length} poz. • ${ev.supplier || "—"}`
      : `${(ev.items || []).length} poz.`;

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
        return `
          <tr>
            <td><strong>${fmtPLN.format(group.price)}</strong></td>
            <td class="text-right">${group.totalQty}</td>
            <td class="text-right">${fmtPLN.format(group.totalValue)}</td>
            <td class="text-right"><span class="badge">${batchCount}</span></td>
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
    const rows = supGroup.lots.map(lot => `
      <tr>
        <td style="white-space:nowrap">Partia #${lot.id ?? "—"}</td>
        <td>${escapeHtml(fmtDateISO(lot.dateIn) || "—")}</td>
        <td class="text-right">${safeQtyInt(lot.qty)}</td>
        <td class="text-right">${fmtPLN.format(safeQtyInt(lot.qty) * price)}</td>
      </tr>
    `).join("");

    return `
      <div class="batch-supplier-section" style="margin-bottom:var(--space-4)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--surface-2);border-radius:var(--radius-md)">
          <span class="badge badge-success">${escapeHtml(supGroup.supplier)}</span>
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
          <p class="batch-preview-subtitle">${escapeHtml(part.name)} • Podział na dostawców</p>
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
  
  const summary = new Map();
  let grandTotal = 0;

  // Filter and group lots
  (state.lots || []).forEach(lot => {
    if (!lot) return;
    const key = skuKey(lot.sku);
    if (!key) return;
    
    // Apply search filter
    if (q && 
        !String(lot.sku || "").toLowerCase().includes(q) &&
        !String(lot.name || "").toLowerCase().includes(q)) {
      return;
    }
    
    if (!summary.has(key)) {
      summary.set(key, { sku: lot.sku, name: lot.name, qty: 0, value: 0 });
    }
    const item = summary.get(key);
    item.qty += safeQtyInt(lot.qty);
    item.value += safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0);
  });

  summary.forEach(item => { grandTotal += item.value; });
  const totalFormatted = fmtPLN.format(grandTotal);

  if (els.sideWarehouseTotal) els.sideWarehouseTotal.textContent = totalFormatted;
  if (els.whTotal) els.whTotal.textContent = totalFormatted;

  // Summary table with "Szczegóły" button
  els.summaryTable.innerHTML = Array.from(summary.values())
    .slice()
    .sort((a, b) => (safeQtyInt(a.qty) - safeQtyInt(b.qty)) || String(a.sku).localeCompare(String(b.sku), 'pl'))
    .map(item => `
      <tr class="${item.qty <= LOW_DANGER ? "stock-row-danger" : item.qty <= LOW_WARN ? "stock-row-warning" : ""}">
        <td><span class="badge">${escapeHtml(item.sku)}</span></td>
        <td>${escapeHtml(item.name || "")}</td>
        <td class="text-right">${item.qty}</td>
        <td class="text-right">${fmtPLN.format(item.value)}</td>
        <td class="text-right">
          <button class="btn btn-secondary btn-sm" type="button"
            data-action="openPartDetails"
            data-sku="${escapeHtml(item.sku)}">
            Szczegóły
          </button>
        </td>
      </tr>
    `).join("");

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
    const m = state.machineCatalog.find(x => x.code === i.machineCode);
    return `<tr>
      <td>
        <div style="display:flex;gap:var(--space-2);align-items:center">
          <span class="badge">${escapeHtml(i.machineCode)}</span>
          <span>${m ? escapeHtml(m.name) : "???"}</span>
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

    const lots = (state.lots || [])
      .filter(l => skuKey(l.sku) === skuKeyStr)
      .slice()
      .sort((a, b) => (a.id || 0) - (b.id || 0));

    const html = `
      <div class="consume-part">
        <div class="consume-part-header">
          <div>
            <strong>${escapeHtml(part?.sku || skuKeyStr)}</strong>
            ${part?.name ? `<span class="text-muted"> - ${escapeHtml(part.name)}</span>` : ""}
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
  return (v === "builds") ? "builds" : "deliveries";
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
    const code = normalize(it?.code || "").toLowerCase();
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
      : "Brak produkcji w historii dla wybranych filtrów.";
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
    } else {
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
  const typeLabel = isDelivery ? "Dostawa" : "Produkcja";
  const badgeClass = isDelivery ? "badge-success" : "badge-accent";
  const items = Array.isArray(ev.items) ? ev.items : [];

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

  // Parts catalog
  const parts = Array.from(state.partsCatalog.values());
  els.partsCatalog.innerHTML = parts.map(p => {
    const suppliers = Array.from(state.suppliers.entries())
      .filter(([_, data]) => data.prices.has(skuKey(p.sku)))
      .map(([n]) => n);

    return `<tr>
      <td><span class="badge">${escapeHtml(p.sku)}</span></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${suppliers.length ? suppliers.map(s => escapeHtml(s)).join(", ") : '<span class="text-muted">-</span>'}</td>
      <td class="text-right">
        <button class="btn btn-success btn-sm" onclick="startEditPart('${escapeHtml(p.sku)}')">Edytuj</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="askDeletePart('${escapeHtml(p.sku)}')" aria-label="Usuń">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>`;
  }).join("");

  // Machines catalog
  els.machinesCatalog.innerHTML = state.machineCatalog.map(m => `
    <tr>
      <td><span class="badge">${escapeHtml(m.code)}</span></td>
      <td>${escapeHtml(m.name)}</td>
      <td class="text-right">${m.bom.length}</td>
      <td class="text-right">
        <button class="btn btn-success btn-sm" onclick="openMachineEditor('${escapeHtml(m.code)}')">Edytuj BOM</button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="askDeleteMachine('${escapeHtml(m.code)}')" aria-label="Usuń">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </td>
    </tr>
  `).join("");

  // Machine select
  renderSelectOptions(els.machineSelect, state.machineCatalog.map(m => m.code), c => {
    const m = state.machineCatalog.find(x => x.code === c);
    return `${c} (${m?.name || ""})`;
  });

  // Supplier picker for new part
  const supBox = byId("partNewSuppliersChecklist");
  const allSups = Array.from(state.suppliers.keys()).sort();
  if (!supBox) return;
  
  comboMultiRender(supBox, {
    options: allSups,
    selected: comboMultiGetSelected(supBox),
    placeholder: allSups.length ? "Wybierz dostawców..." : "Brak zdefiniowanych dostawców."
  });
}


// === Multi-combobox ===
const _comboRegistry = new WeakMap();

function comboMultiGetSelected(hostEl) {
  if (!hostEl) return [];
  return _comboRegistry.get(hostEl)?.selected || [];
}

function comboMultiClear(hostEl) {
  if (!hostEl) return;
  const data = _comboRegistry.get(hostEl);
  if (data) {
    data.selected = [];
    comboMultiRender(hostEl, { options: data.options, selected: [], placeholder: data.placeholder });
  }
}

function comboMultiRender(hostEl, opts) {
  if (!hostEl) return;
  const { options = [], selected = [], placeholder = "Wybierz..." } = opts;
  
  _comboRegistry.set(hostEl, { options, selected: [...selected], placeholder });
  
  if (!options.length) {
    hostEl.innerHTML = `<span class="text-muted" style="font-size:var(--text-sm)">${placeholder}</span>`;
    return;
  }
  
  const selectedSet = new Set(selected);
  hostEl.innerHTML = `
    <div class="combobox-multi" style="display:flex;flex-wrap:wrap;gap:var(--space-2);padding:var(--space-2);background:var(--field-bg);border:1px solid var(--border);border-radius:var(--radius-md)">
      ${options.map(opt => `
        <label style="display:flex;align-items:center;gap:var(--space-1);padding:var(--space-1) var(--space-2);background:var(--surface-2);border-radius:var(--radius-sm);cursor:pointer;font-size:var(--text-sm)">
          <input type="checkbox" value="${escapeHtml(opt)}" ${selectedSet.has(opt) ? 'checked' : ''} 
            onchange="comboMultiToggle(this, '${escapeHtml(opt)}')" style="cursor:pointer">
          <span>${escapeHtml(opt)}</span>
        </label>
      `).join('')}
    </div>
  `;
}

function comboMultiToggle(checkbox, value) {
  const hostEl = checkbox.closest('[data-combo]');
  if (!hostEl) return;
  
  const data = _comboRegistry.get(hostEl);
  if (!data) return;
  
  if (checkbox.checked) {
    if (!data.selected.includes(value)) data.selected.push(value);
  } else {
    data.selected = data.selected.filter(v => v !== value);
  }
  
  // Trigger change event for price sync
  hostEl.dispatchEvent(new Event('change', { bubbles: true }));
}

// === Select helpers ===
function renderSelectOptions(selectEl, options, labelFn = null) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">-- Wybierz --</option>' + 
    options.map(opt => {
      const label = labelFn ? labelFn(opt) : opt;
      return `<option value="${escapeHtml(opt)}">${escapeHtml(label)}</option>`;
    }).join('');
}

// === Combobox from select (for enhanced selects) ===
function initComboFromSelect(selectEl, opts = {}) {
  if (!selectEl) return;
  // Keep original select, just ensure it has proper styling
  selectEl.classList.add('form-select');
}

function refreshComboFromSelect(selectEl, opts = {}) {
  if (!selectEl) return;
  // Re-initialize if needed
}

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
