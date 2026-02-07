// === UI: renderery i komponenty ===

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
    machineSelect: document.getElementById('machineSelect'),

    // Side panel
    sideWarehouseTotal: document.getElementById('sideWarehouseTotal'),
    sideMissingSignals: document.getElementById('sideMissingSignals'),
    sideHealthLabel: document.getElementById('sideHealthLabel'),
    sideHealthHint: document.getElementById('sideHealthHint'),
    sideCriticalCount: document.getElementById('sideCriticalCount'),
    sideLowCount: document.getElementById('sideLowCount'),
    sideRecentActions: document.getElementById('sideRecentActions'),
};

// Simple HTML escaping for safe UI templates
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


// =========================
// UI-only state for batches grouping expand/collapse
// =========================
const expandedBatchGroups = new Set();

/**
 * Group key for display-only aggregation of lots.
 * IMPORTANT: This does NOT change FIFO or data. It is only for rendering.
 */
const batchGroupKey = (lot) => {
    const sku = skuKey(lot.sku);
    const supplier = normalize(lot.supplier || "-").toLowerCase();
    // normalize price to a stable string to avoid 10 vs 10.0 differences
    const price = String(safeFloat(lot.unitPrice || 0));
    return `${sku}||${supplier}||${price}`;
};

// Bind once: toggle group expand/collapse in batches table (delegation)
(function bindBatchGroupToggleOnce() {
    if (window.__batchGroupToggleBound) return;
    window.__batchGroupToggleBound = true;

    document.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest ? e.target.closest('[data-action="toggleBatchGroup"]') : null;
        if (!btn) return;

        const key = btn.getAttribute("data-gkey");
        if (!key) return;

        if (expandedBatchGroups.has(key)) expandedBatchGroups.delete(key);
        else expandedBatchGroups.add(key);

        // Rerender only warehouse (cheap)
        renderWarehouse();
    });
})();

function computePartsSummary() {
    const summary = new Map();
    (state.lots || []).forEach(lot => {
        const key = skuKey(lot.sku);
        const prev = summary.get(key) || { sku: lot.sku, name: lot.name, qty: 0, value: 0 };
        prev.qty += safeQtyInt(lot.qty);
        prev.value += safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0);
        // keep latest friendly name if any
        prev.name = lot.name || prev.name;
        summary.set(key, prev);
    });
    return Array.from(summary.values());
}

function renderSideMissingTop5() {
  if (!els.sideMissingSignals) return;

  const rows = computePartsSummary()
    .filter(r => Number.isFinite(r.qty))
    .sort((a, b) => (a.qty - b.qty) || String(a.sku).localeCompare(String(b.sku), "pl"))
    .slice(0, 5);

  if (!rows.length) {
    els.sideMissingSignals.innerHTML = `
      <div class="sideEmpty muted small">Brak danych.</div>
    `;
    return;
  }

  els.sideMissingSignals.innerHTML = rows.map(r => {
    const cls =
      r.qty <= LOW_DANGER ? "danger" :
      r.qty <= LOW_WARN ? "warn" :
      "ok";

    const status =
      r.qty <= LOW_DANGER ? "Krytyczne" :
      r.qty <= LOW_WARN ? "Niskie" :
      "OK";

    const safeSku = String(r.sku ?? "");
    const safeName = String(r.name ?? "—");

    return `
      <button class="sideSignalRow" type="button" data-sku="${escapeHtml(safeSku)}" aria-label="Przejdź do części ${escapeHtml(safeSku)}">
        <span class="sigMain">
          <span class="badge sigSku">${escapeHtml(safeSku)}</span>
          <span class="sigName" title="${escapeHtml(safeName)}">${escapeHtml(safeName)}</span>
        </span>
        <span class="sigMeta">
          <span class="statusPill ${cls}">${status}</span>
          <span class="sigQty">${Number.isFinite(r.qty) ? r.qty : 0}</span>
        </span>
      </button>
    `;
  }).join("");
}

function renderSideRecentActions5() {
  if (!els.sideRecentActions) return;

  const rows = (state.history || [])
    .slice()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, 5);

  if (!rows.length) {
    els.sideRecentActions.innerHTML = `<li class="muted small">Brak akcji.</li>`;
    return;
  }

  els.sideRecentActions.innerHTML = rows.map(ev => {
    const typeLabel = ev.type === "delivery" ? "Dostawa" : "Produkcja";
    const pillClass = ev.type === "delivery" ? "delivery" : "build";

    const meta = ev.type === "delivery"
      ? `${(ev.items || []).length} poz. • ${ev.supplier || "—"}`
      : `${(ev.items || []).length} poz.`;

    return `
      <li>
        <div class="sideActionRow">
          <div class="sideActionTop">
            <span class="historyPill ${pillClass}">${typeLabel}</span>
            <span class="sideDate">${fmtDateISO(ev.dateISO)}</span>
          </div>
          <div class="sideActionMeta">${meta}</div>
        </div>
      </li>
    `;
  }).join("");
}

function renderSideHealth() {
    if (!els.sideHealthLabel || !els.sideHealthHint || !els.sideCriticalCount || !els.sideLowCount) return;

    const rows = computePartsSummary().filter(r => Number.isFinite(r.qty));

    let critical = 0;
    let low = 0;

    for (const r of rows) {
        if (r.qty <= LOW_DANGER) critical++;
        else if (r.qty <= LOW_WARN) low++;
    }

    els.sideCriticalCount.textContent = String(critical);
    els.sideLowCount.textContent = String(low);

    const label = els.sideHealthLabel;
    const hint = els.sideHealthHint;

    label.classList.remove("ok", "warn", "danger");

    if (critical > 0) {
        label.classList.add("danger");
        label.textContent = "Uwaga";
        hint.textContent = `Krytyczne braki: ${critical}`;
    } else if (low > 0) {
        label.classList.add("warn");
        label.textContent = "Obserwuj";
        hint.textContent = `Niskie stany: ${low}`;
    } else {
        label.classList.add("ok");
        label.textContent = "OK";
        hint.textContent = "Brak krytycznych braków";
    }
}

function renderSidePanel() {
    renderSideHealth();
    renderSideMissingTop5();
    renderSideRecentActions5();
}

function renderWarehouse() {
    // ✅ Nie blokuj renderu, jeśli wywalisz warehouseTotal z zakładki
    if (!els.partsTable || !els.summaryTable) return;

    const q = normalize(document.getElementById("searchParts")?.value).toLowerCase();
    const summary = new Map();
    const qtyByKey = new Map();
    let grandTotal = 0;

    // Wyszukiwanie obejmuje dostawcę
    const filteredLots = (state.lots || []).filter(l =>
        !q ||
        String(l.sku || "").toLowerCase().includes(q) ||
        String(l.name || "").toLowerCase().includes(q) ||
        String(l.supplier || "").toLowerCase().includes(q)
    );

    // sort: ilość rosnąco (display-only)
    const filteredLotsSorted = filteredLots
        .slice()
        .sort((a, b) => (safeQtyInt(a.qty) - safeQtyInt(b.qty)) || ((a.id || 0) - (b.id || 0)));

    // build summary from filtered lots (for podsumowanie + thresholds)
    filteredLotsSorted.forEach(lot => {
        const key = skuKey(lot.sku);
        if (!key) return;
        summary.set(key, summary.get(key) || { sku: lot.sku, name: lot.name, qty: 0, value: 0 });
        summary.get(key).qty += safeQtyInt(lot.qty);
        summary.get(key).value += safeQtyInt(lot.qty) * (safeFloat(lot.unitPrice || 0));
    });

    // Mapka ilości do progów (żeby w widoku partii też działało ostrzeganie)
    summary.forEach((item, key) => {
        qtyByKey.set(key, item.qty);
    });

    // Determine which view is active from the split wrapper
    const split = document.getElementById("partsSplit");
    const view = split?.getAttribute("data-view") || "batches"; // "compact" vs "batches"

    // ============================
    // BATCHES VIEW (Partie / Szczegóły)
    // Display-only grouping + expandable detail rows (true FIFO lots)
    // ============================
    if (view === "batches") {
        const groups = new Map();

        // group lots by (sku + supplier + unitPrice)
        filteredLotsSorted.forEach(lot => {
            if (!lot) return;
            const gk = batchGroupKey(lot);
            if (!groups.has(gk)) groups.set(gk, { key: gk, lots: [], sumQty: 0, firstId: lot.id || 0, lot0: lot });
            const g = groups.get(gk);
            g.lots.push(lot);
            g.sumQty += safeQtyInt(lot.qty);
            g.firstId = Math.min(g.firstId, lot.id || g.firstId);
        });

        const groupList = Array.from(groups.values()).sort((a, b) => {
            const aSkuTotal = qtyByKey.get(skuKey(a.lot0.sku)) ?? 0;
            const bSkuTotal = qtyByKey.get(skuKey(b.lot0.sku)) ?? 0;
            if (aSkuTotal !== bSkuTotal) return aSkuTotal - bSkuTotal;
            return (a.firstId || 0) - (b.firstId || 0);
        });

        const rowsHtml = [];

        groupList.forEach(g => {
            const lot0 = g.lot0;
            const skuK = skuKey(lot0.sku);
            const totalQtyForSku = qtyByKey.get(skuK) ?? safeQtyInt(lot0.qty);

            // thresholds based on TOTAL SKU qty (same as summary view)
            const rowClass = totalQtyForSku <= LOW_DANGER ? "stock-danger" : totalQtyForSku <= LOW_WARN ? "stock-warn" : "";
            const isOpen = expandedBatchGroups.has(g.key);

            const unitPrice = safeFloat(lot0.unitPrice || 0);
            const groupValue = g.sumQty * unitPrice;

            // Group row
            rowsHtml.push(`
                <tr class="batchGroupRow ${rowClass}">
                    <td>
                        <div class="batchMain">
                            <div class="batchTop" style="display:flex; gap:8px; align-items:baseline;">
                                <span class="badge">${lot0.sku}</span>
                                <span class="batchName">${lot0.name || ""}</span>
                            </div>
                            <div class="batchMeta muted small" style="margin-top:2px">
                                ${lot0.supplier || "-"} • ${fmtPLN.format(unitPrice)} • Partie: <strong>${g.lots.length}</strong>
                            </div>
                        </div>
                    </td>
                    <td>${lot0.supplier || "-"}</td>
                    <td class="right">${fmtPLN.format(unitPrice)}</td>
                    <td class="right"><strong>${g.sumQty}</strong></td>
                    <td class="right">${fmtPLN.format(groupValue)}</td>
                    <td class="right">
                        <button class="secondary compact" type="button"
                            data-action="toggleBatchGroup"
                            data-gkey="${g.key}"
                            aria-expanded="${isOpen ? "true" : "false"}">
                            ${isOpen ? "Zwiń" : "Rozwiń"}
                        </button>
                    </td>
                </tr>
            `);

            // Detail rows: true FIFO lots by id, only when expanded
            if (isOpen) {
                const sortedLots = g.lots.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
                sortedLots.forEach(lot => {
                    const val = safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0);
                    rowsHtml.push(`
                        <tr class="batchDetailRow ${rowClass}">
                            <td>
                                <div class="batchDetailIndent" style="padding-left:18px">
                                    <span class="muted small">Partia #${lot.id ?? "—"} • ${fmtDateISO(lot.dateIn)}</span><br>
                                    <span class="badge">${lot.sku}</span> ${lot.name || ""}
                                </div>
                            </td>
                            <td>${lot.supplier || "-"}</td>
                            <td class="right">${fmtPLN.format(safeFloat(lot.unitPrice || 0))}</td>
                            <td class="right">${safeQtyInt(lot.qty)}</td>
                            <td class="right">${fmtPLN.format(val)}</td>
                            <td class="right"></td>
                        </tr>
                    `);
                });
            }
        });

        els.partsTable.innerHTML = rowsHtml.join("");
    } else {
        // ============================
        // COMPACT VIEW fallback
        // ============================
        els.partsTable.innerHTML = filteredLotsSorted.map(lot => {
            const key = skuKey(lot.sku);
            const totalQty = qtyByKey.get(key) ?? safeQtyInt(lot.qty);
            const rowClass = totalQty <= LOW_DANGER ? "stock-danger" : totalQty <= LOW_WARN ? "stock-warn" : "";
            return `
                <tr class="${rowClass}">
                    <td><span class="badge">${lot.sku}</span> ${lot.name}</td>
                    <td>${lot.supplier || "-"}</td>
                    <td class="right">${fmtPLN.format(lot.unitPrice || 0)}</td>
                    <td class="right">${safeQtyInt(lot.qty)}</td>
                    <td class="right">${fmtPLN.format(safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0))}</td>
                    <td class="right"></td>
                </tr>
            `;
        }).join("");
    }

    // Total value from summary
    summary.forEach(item => { grandTotal += item.value; });
    const totalFormatted = fmtPLN.format(grandTotal);

    // ✅ Sidebar total
    if (els.sideWarehouseTotal) els.sideWarehouseTotal.textContent = totalFormatted;

    // (opcjonalnie) jeśli zostawisz to jeszcze w HTML zakładki
    if (els.whTotal) els.whTotal.textContent = totalFormatted;

    // Summary table (SKU aggregated) sorted by qty ascending
    els.summaryTable.innerHTML = Array.from(summary.values())
        .slice()
        .sort((a, b) => (safeQtyInt(a.qty) - safeQtyInt(b.qty)) || String(a.sku).localeCompare(String(b.sku), 'pl'))
        .map(item => `
            <tr class="${ item.qty <= LOW_DANGER ? "stock-danger" : item.qty <= LOW_WARN ? "stock-warn" : "" }">
                <td><span class="badge">${item.sku}</span></td>
                <td>${item.name}</td>
                <td class="right">${item.qty}</td>
                <td class="right">${fmtPLN.format(item.value)}</td>
            </tr>
        `).join("");

    // side panel: braki + ostatnie akcje
    renderSidePanel();
}

function renderDelivery() {
    if (!els.deliveryItems) return;
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

    const itemsCountEl = document.getElementById("itemsCount");
    const itemsTotalEl = document.getElementById("itemsTotal");
    const finalizeBtn = document.getElementById("finalizeDeliveryBtn");
    if (itemsCountEl) itemsCountEl.textContent = String(items.length);
    if (itemsTotalEl) itemsTotalEl.textContent = fmtPLN.format(total);
    if (finalizeBtn) finalizeBtn.disabled = items.length === 0;
}

function renderBuild() {
    if (!els.buildItems) return;

    els.buildItems.innerHTML = state.currentBuild.items.map(i => {
        const m = state.machineCatalog.find(x => x.code === i.machineCode);
        return `<tr>
            <td>${m ? m.name : "???"} <span class="badge">${i.machineCode}</span></td>
            <td class="right">${i.qty}</td>
            <td class="right"><button class="iconBtn" onclick="removeBuildItem(${i.id})">✕</button></td>
        </tr>`;
    }).join("");

    const buildCountEl = document.getElementById("buildItemsCount");
    const finalizeBuildBtn = document.getElementById("finalizeBuildBtn");
    if (buildCountEl) buildCountEl.textContent = String(state.currentBuild.items.length);
    if (finalizeBuildBtn) finalizeBuildBtn.disabled = state.currentBuild.items.length === 0;

    // Zawsze czyścimy widoki błędów/manual na starcie renderu
    if (els.missingBox) els.missingBox.hidden = true;
    if (els.manualBox) els.manualBox.hidden = true;

    // ✅ KLUCZ: jeśli tryb manual i są jakieś pozycje w planie, pokaż UI manual
    const mode = document.getElementById("consumeMode")?.value || "fifo";
    if (mode === "manual" && state.currentBuild.items.length > 0) {
        renderManualConsume(); // ta funkcja sama pokaże missingBox jeśli brakuje części
    }

}

function renderMissingParts(missing) {
    if (!els.missingBox) return;
    els.missingBox.hidden = false;
    const list = byId("missingList");
    if (!list) return;
    list.innerHTML = missing.map(m =>
        `<li><strong>${m.sku}</strong>: Potrzeba ${m.needed}, stan: ${m.has} (brak: ${m.needed - m.has})</li>`
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
        if (els.manualBox) els.manualBox.hidden = true;
        return;
    }

    if (els.manualBox) els.manualBox.hidden = false;

    req.forEach((qtyNeeded, skuKeyStr) => {
        const part = state.partsCatalog.get(skuKeyStr);

        // FIFO kolejność w manualu (czytelniej i logicznie)
        const lots = (state.lots || [])
            .filter(l => skuKey(l.sku) === skuKeyStr)
            .slice()
            .sort((a, b) => (a.id || 0) - (b.id || 0));

        const html = `
        <div class="consumePart">
            <div style="margin-bottom:6px">
                <strong>${part?.sku || skuKeyStr}</strong>
                <span class="muted">(Wymagane: ${qtyNeeded})</span>
            </div>

            ${lots.length ? lots.map(lot => {
                const dateStr = (lot && lot.dateIn) ? fmtDateISO(lot.dateIn) : "—";
                const supplier = lot?.supplier || "—";
                const price = fmtPLN.format(safeFloat(lot?.unitPrice || 0));
                const qtyAvail = safeQtyInt(lot?.qty || 0);
                const lotId = lot?.id ?? "—";

                return `
                <div class="lotRow">
                    <span>
                        <strong>#${lotId}</strong>
                        • ${supplier} (${price})
                        • <span class="muted">Data:</span> <strong>${dateStr}</strong>
                        • <span class="muted">Dostępne:</span> <strong>${qtyAvail}</strong>
                    </span>
                    <input type="number" class="manual-lot-input"
                        data-lot-id="${lot?.id}"
                        data-sku="${skuKeyStr}"
                        max="${qtyAvail}" min="0" value="0">
                </div>
                `;
            }).join("") : `
                <div class="muted small">Brak partii dla tej części.</div>
            `}
        </div>`;

        container.insertAdjacentHTML("beforeend", html);
    });
}


function renderMachinesStock() {
    const q = normalize(document.getElementById("searchMachines")?.value).toLowerCase();
    const tbody = document.querySelector("#machinesStockTable tbody");
    if (!tbody) return;

    tbody.innerHTML = state.machinesStock
        .filter(m => !q || m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q))
        .map(m => `<tr>
            <td><span class="badge">${m.code}</span></td>
            <td>${m.name}</td>
            <td class="right"><strong>${m.qty}</strong></td>
        </tr>`).join("");
}

function getHistoryView() {
    // initHistoryViewToggle stores it
    const v = localStorage.getItem("magazyn_history_view");
    return (v === "builds") ? "builds" : "deliveries";
}

function parsePLDateToISO(dmy) {
    const m = String(dmy || "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    const dd = m[1], mm = m[2], yyyy = m[3];
    // basic sanity (no heavy calendar validation)
    const d = parseInt(dd, 10), mo = parseInt(mm, 10), y = parseInt(yyyy, 10);
    if (!(y >= 1970 && y <= 2100)) return null;
    if (!(mo >= 1 && mo <= 12)) return null;
    if (!(d >= 1 && d <= 31)) return null;
    return `${yyyy}-${mm}-${dd}`;
}

function parseHistoryDateRange(raw) {
    const s = String(raw || "").trim();
    if (!s) return { fromISO: null, toISO: null };

    // allow "DD.MM.RRRR" OR "DD.MM.RRRR-DD.MM.RRRR" (spaces optional)
    const parts = s.split("-").map(x => x.trim());
    if (parts.length === 1) {
        return { fromISO: parsePLDateToISO(parts[0]), toISO: null };
    }
    if (parts.length >= 2) {
        const fromISO = parts[0] ? parsePLDateToISO(parts[0]) : null;
        const toISO = parts[1] ? parsePLDateToISO(parts[1]) : null;
        return { fromISO, toISO };
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

    // builds
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
    const qNorm = normalize(document.getElementById("historySearch")?.value || "").toLowerCase();
    const { fromISO, toISO } = parseHistoryDateRange(document.getElementById("historyDateRange")?.value || "");

    const rows = (state.history || [])
        .slice()
        .sort((a,b) => (b.ts || 0) - (a.ts || 0))
        .filter(ev => historyMatchesFilters(ev, view, qNorm, fromISO, toISO));

    if (!rows.length) {
        const msg = (view === "deliveries")
            ? "Brak dostaw w historii dla wybranych filtrów."
            : "Brak produkcji w historii dla wybranych filtrów.";
        tbody.innerHTML = `<tr><td colspan="3" class="muted small">${msg}</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(ev => {
        const date = fmtDateISO(ev.dateISO);
        let summary = "";

        if (ev.type === "delivery") {
            const n = (ev.items||[]).length;
            const total = (ev.items||[]).reduce((s,i)=>s + (safeFloat(i.price) * safeInt(i.qty)), 0);
            summary = `
                <span class="badge">${escapeHtml(ev.supplier || "—")}</span>
                <span class="muted small">• Pozycji: <strong>${n}</strong></span>
                <span class="muted small">• Suma: <strong class="historyMoney">${fmtPLN.format(total)}</strong></span>
            `;
        } else {
            const n = (ev.items||[]).length;
            const totalQty = (ev.items||[]).reduce((s,i)=>s + safeInt(i.qty), 0);
            const totalConsumptionValue = (ev.items||[]).reduce((sum, it) => {
                const machineVal = (it?.partsUsed || []).reduce((ms, p) => {
                    const lots = Array.isArray(p?.lots) ? p.lots : [];
                    return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
                }, 0);
                return sum + machineVal;
            }, 0);

            const machinesPreview = (ev.items||[])
                .slice(0, 2)
                .map(i => `${i?.name || "—"} (${i?.code || "—"})`)
                .join(", ");
            const more = (ev.items||[]).length > 2 ? ` +${(ev.items||[]).length - 2}` : "";

            summary = `
                <span class="badge">${escapeHtml(machinesPreview || "Produkcja")}${escapeHtml(more)}</span>
                <span class="muted small">• Pozycji: <strong>${n}</strong></span>
                <span class="muted small">• Sztuk: <strong>${totalQty}</strong></span>
                ${Number.isFinite(totalConsumptionValue) && totalConsumptionValue > 0
                    ? `<span class="muted small">• Zużycie: <strong class="historyMoney">${fmtPLN.format(totalConsumptionValue)}</strong></span>`
                    : ``}
            `;
        }

        return `
        <tr data-hid="${ev.id}">
            <td style="white-space:nowrap">${date}</td>
            <td>${summary}</td>
            <td class="right">
                <button class="secondary compact historyPreviewBtn" type="button" data-action="toggleHistory" data-hid="${ev.id}">Podgląd</button>
            </td>
        </tr>
        <tr class="historyDetailRow" data-hid-detail="${ev.id}" hidden>
            <td colspan="3">
                <div class="historyDetails"></div>
            </td>
        </tr>`;
    }).join("");

    // panel: ostatnie akcje (globalnie)
    renderSideRecentActions5();
}

function buildHistoryDetails(ev) {
    if (!ev) return "";
    const typeLabel = ev.type === "delivery" ? "Dostawa" : "Produkcja";
    const metaBits = [];

    if (ev.type === "delivery") {
        if (ev.supplier) metaBits.push(`<span class="badge">${ev.supplier}</span>`);
        metaBits.push(`<span class="muted small">Pozycji: <strong>${(ev.items||[]).length}</strong></span>`);
        const total = (ev.items||[]).reduce((s,i)=>s + (safeFloat(i.price) * safeInt(i.qty)), 0);
        metaBits.push(`<span class="muted small">Suma: <strong class="historyMoney">${fmtPLN.format(total)}</strong></span>`);
        return `
            <div class="historyGrid">
                <div class="historyMeta">
                    <strong>${typeLabel}</strong>
                    <span class="muted small">•</span>
                    <span class="muted small">${fmtDateISO(ev.dateISO)}</span>
                    ${metaBits.join("")}
                </div>
                <div class="uiSection" style="margin:0">
                    <div class="uiSectionHead">
                        <div class="small muted">Szczegóły dostawy</div>
                    </div>
                    <div class="tableWrap" style="margin:0">
                        <table class="tightTable" style="min-width:auto">
                            <thead>
                                <tr>
                                    <th>Nazwa (ID)</th>
                                    <th class="right">Ilość</th>
                                    <th class="right">Cena</th>
                                    <th class="right">Razem</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(ev.items||[]).map(i => {
                                    const rowVal = safeInt(i.qty) * safeFloat(i.price);
                                    return `<tr>
                                        <td><span class="badge">${i.sku}</span> ${i.name || ""}</td>
                                        <td class="right">${safeInt(i.qty)}</td>
                                        <td class="right">${fmtPLN.format(safeFloat(i.price))}</td>
                                        <td class="right">${fmtPLN.format(rowVal)}</td>
                                    </tr>`;
                                }).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
    }

    // build
    metaBits.push(`<span class="muted small">Pozycji: <strong>${(ev.items||[]).length}</strong></span>`);
    const totalQty = (ev.items||[]).reduce((s,i)=>s + safeInt(i.qty), 0);
    metaBits.push(`<span class="muted small">Sztuk: <strong>${totalQty}</strong></span>`);

    // Wartość zużycia (PLN) per cała akcja produkcji
    const totalConsumptionValue = (ev.items||[]).reduce((sum, it) => {
        const machineVal = (it?.partsUsed || []).reduce((ms, p) => {
            const lots = Array.isArray(p?.lots) ? p.lots : [];
            return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
        }, 0);
        return sum + machineVal;
    }, 0);
    if (Number.isFinite(totalConsumptionValue) && totalConsumptionValue > 0) {
        const perUnit = totalQty > 0 ? (totalConsumptionValue / totalQty) : 0;
        metaBits.push(`<span class="muted small">Wartość zużycia: <strong class="historyMoney">${fmtPLN.format(totalConsumptionValue)}</strong></span>`);
    }

    return `
        <div class="historyGrid">
            <div class="historyMeta">
                <strong>${typeLabel}</strong>
                <span class="muted small">•</span>
                <span class="muted small">${fmtDateISO(ev.dateISO)}</span>
                ${metaBits.join("")}
            </div>

            <div class="uiSection" style="margin:0">
                <div class="uiSectionHead">
                    <div class="small muted">Zbudowane maszyny</div>
                </div>

                <div class="tableWrap" style="margin:0">
                    <table class="tightTable buildMachineTable" style="min-width:auto">
                        <thead>
                            <tr>
                                <th>Maszyna</th>
                                <th class="right">Ilość</th>
                                <th class="right">Wartość</th>
                                <th class="right">Podgląd</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(ev.items||[]).map((i, idx) => {
                                const bmid = `${ev.id}-${idx}`;
                                const hasParts = Array.isArray(i.partsUsed) && i.partsUsed.length > 0;

                                const machineConsumptionValue = (i?.partsUsed || []).reduce((ms, p) => {
                                    const lots = Array.isArray(p?.lots) ? p.lots : [];
                                    return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
                                }, 0);
                                const machinePerUnit = safeInt(i?.qty) > 0 ? (machineConsumptionValue / safeInt(i.qty)) : 0;

                                const btn = hasParts
                                    ? `<button class="secondary compact" type="button" data-action="toggleBuildMachine" data-bmid="${bmid}" aria-expanded="false">Podgląd</button>`
                                    : `<span class="muted small">—</span>`;

                                const partsRows = (hasParts ? i.partsUsed : []).flatMap(p => {
                                    const lots = Array.isArray(p.lots) ? p.lots : [];
                                    if (!lots.length) return [];
                                    return lots.map(lot => {
                                        const d = lot.dateIn ? fmtDateISO(lot.dateIn) : "—";
                                        const price = fmtPLN.format(safeFloat(lot.unitPrice || 0));
                                        const rowVal = safeInt(lot.qty) * safeFloat(lot.unitPrice || 0);
                                        const supplier = lot.supplier || "-";
                                        const sku = lot.sku || p.sku || "—";
                                        const name = lot.name || p.name || "";
                                        return `
                                            <tr>
                                                <td><span class="badge">${escapeHtml(sku)}</span> ${escapeHtml(name)}</td>
                                                <td>${escapeHtml(supplier)}</td>
                                                <td>${escapeHtml(d)}</td>
                                                <td class="right">${price}</td>
                                                <td class="right"><strong>${safeInt(lot.qty)}</strong></td>
                                                <td class="right">${fmtPLN.format(rowVal)}</td>
                                            </tr>
                                        `;
                                    });
                                }).join("");

                                const empty = !partsRows
                                    ? `<div class="muted small">Brak danych o zużyciu dla tej maszyny (stara akcja lub brak BOM).</div>`
                                    : `
                                        <div class="buildPartsSummary">
                                            <div class="small muted">Suma zużycia: <strong class="historyMoney">${fmtPLN.format(machineConsumptionValue)}</strong></div>
                                        </div>

                                        <div class="tableWrap buildPartsWrap">
                                            <table class="tightTable" style="min-width:auto">
                                                <thead>
                                                    <tr>
                                                        <th>Nazwa (ID)</th>
                                                        <th>Dostawca</th>
                                                        <th>Data</th>
                                                        <th class="right">Cena zak.</th>
                                                        <th class="right">Ilość</th>
                                                        <th class="right">Razem</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${partsRows}
                                                </tbody>
                                            </table>
                                        </div>
                                    `;

                                return `
                                    <tr class="buildMachineRow">
                                        <td>${escapeHtml(i.name || "—")} <span class="badge">${escapeHtml(i.code || "—")}</span></td>
                                        <td class="right">${safeInt(i.qty)}</td>
                                        <td class="right"><strong class="historyMoney">${fmtPLN.format(machineConsumptionValue || 0)}</strong></td>
                                        <td class="right">${btn}</td>
                                    </tr>
                                    <tr class="buildMachineDetailRow" data-bmid-detail="${bmid}" hidden>
                                        <td colspan="4">
                                            <div class="buildPartsDetails">
                                                <div class="buildPartsHeader">
                                                    <div class="small muted">Zużyte części (partie)</div>
                                                    <div class="buildPartsMeta">
                                                        <div class="small muted">Maszyna: <strong>${escapeHtml(i.code || "—")}</strong></div>
                                                        <div class="small muted">Suma zużycia: <strong class="historyMoney">${fmtPLN.format(machineConsumptionValue || 0)}</strong></div>
                                                    </div>
                                                </div>
                                                ${empty}
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function addHistoryEvent(ev) {
    if (!state.history) state.history = [];
    state.history.push(ev);
    // limit to last 200 entries to keep localStorage sane
    if (state.history.length > 200) state.history = state.history.slice(-200);
    save();
}

function renderAllSuppliers() {
    const table = byId("suppliersListTable");
    const tbody = table ? table.querySelector("tbody") : null;
    if (!tbody) return;
    tbody.innerHTML = Array.from(state.suppliers.keys()).sort().map(name => `
        <tr>
            <td>${name}</td>
            <td class="right">
                <button class="success compact" onclick="openSupplierEditor('${name}')">Cennik</button>
                <button class="iconBtn" onclick="askDeleteSupplier('${name}')">Usuń</button>
            </td>
        </tr>
    `).join("");

    renderSelectOptions(document.getElementById("supplierSelect"), Array.from(state.suppliers.keys()));
}

function refreshCatalogsUI() {
    // Defensive: if a tab panel is removed/renamed in HTML, don't crash.
    if (!els.partsCatalog || !els.machinesCatalog) return;

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
                <button class="iconBtn" onclick="askDeleteMachine('${m.code}')">Usuń</button>
            </td>
        </tr>
    `).join("");

    // 3. SELECTS for machines
    renderSelectOptions(els.machineSelect, state.machineCatalog.map(m => m.code), c => {
        const m = state.machineCatalog.find(x => x.code === c);
        return `${c} (${m.name})`;
    });

    // 4. SUPPLIER PICKER FOR NEW PART (multi-combobox, instead of inline checkboxes)
    const supBox = byId("partNewSuppliersChecklist");
    const allSups = Array.from(state.suppliers.keys()).sort();
    if (!supBox) return;
    comboMultiRender(supBox, {
        options: allSups,
        selected: comboMultiGetSelected(supBox),
        placeholder: allSups.length ? "Wybierz dostawców..." : "Brak zdefiniowanych dostawców."
    });
}

// === Multi-combobox (no deps) ===
function comboMultiGetSelected(hostEl) {
    try {
        const raw = hostEl?.dataset?.selected || "";
        if (!raw) return [];
        return raw.split("|").map(s => s.trim()).filter(Boolean);
    } catch { return []; }
}

function comboMultiSetSelected(hostEl, arr) {
    if (!hostEl) return;
    const next = (arr || []).map(s => String(s)).filter(Boolean);
    hostEl.dataset.selected = next.join("|");
}

function comboMultiClear(hostEl) {
    comboMultiSetSelected(hostEl, []);
    comboMultiRender(hostEl, {
        options: comboMultiGetOptions(hostEl),
        selected: [],
        placeholder: hostEl.dataset.placeholder || "Wybierz..."
    });
    hostEl.dispatchEvent(new Event("change", { bubbles: true }));
}

function comboMultiGetOptions(hostEl) {
    try {
        const raw = hostEl?.dataset?.options || "";
        if (!raw) return [];
        return raw.split("|").map(s => s.trim()).filter(Boolean);
    } catch { return []; }
}

function comboMultiRender(hostEl, cfg) {
    if (!hostEl) return;
    const options = Array.isArray(cfg?.options) ? cfg.options : [];
    const selected = new Set(Array.isArray(cfg?.selected) ? cfg.selected : comboMultiGetSelected(hostEl));
    const placeholder = cfg?.placeholder || "Wybierz...";

    // Persist for re-render + helpers
    hostEl.dataset.options = options.join("|");
    hostEl.dataset.placeholder = placeholder;
    comboMultiSetSelected(hostEl, Array.from(selected));

    if (options.length === 0) {
        hostEl.innerHTML = `<span class="small muted">${escapeHtml(placeholder)}</span>`;
        return;
    }

    const chips = Array.from(selected).slice(0, 3).map(s =>
        `<span class="comboChip" data-chip="${escapeHtml(s)}">${escapeHtml(s)} <span class="x" aria-hidden="true">×</span></span>`
    ).join("");
    const extra = (selected.size > 3) ? `<span class="comboChip">+${selected.size - 3}</span>` : "";

    hostEl.innerHTML = `
        <div class="comboCtl" tabindex="0" role="combobox" aria-expanded="false">
            <div class="comboLeft">
                ${selected.size ? (chips + extra) : `<span class="comboPlaceholder">${escapeHtml(placeholder)}</span>`}
            </div>
            <div class="comboCaret">▾</div>
        </div>
        <div class="comboMenu" hidden>
            <div class="comboSearchWrap">
                <input class="comboSearch" type="text" placeholder="Szukaj..." autocomplete="off" />
            </div>
            <div class="comboOptions">
                ${options.map(opt => {
                    const on = selected.has(opt);
                    // data-norm: stable, precomputed search label (so filtering never depends on DOM text quirks)
                    const norm = normalizeComboText(opt);
                    return `<div class="comboOpt" data-opt="${escapeHtml(opt)}" data-norm="${escapeHtml(norm)}" data-selected="${on ? "1" : "0"}" role="option" aria-selected="${on}">
                        <span class="comboOptLabel">${escapeHtml(opt)}</span>
                        <span class="tick" aria-hidden="true">✓</span>
                    </div>`;
                }).join("")}
                <div class="comboEmpty" hidden>Brak wyników</div>
            </div>
        </div>
    `;

    // Wire events (idempotent because we render fresh DOM)
    const ctl = hostEl.querySelector(".comboCtl");
    const menu = hostEl.querySelector(".comboMenu");
    const search = hostEl.querySelector(".comboSearch");
    const opts = hostEl.querySelector(".comboOptions");
    const empty = hostEl.querySelector(".comboEmpty");

    const open = () => {
        if (!menu) return;
        menu.hidden = false;
        ctl?.setAttribute("aria-expanded", "true");

        // Focus quirks: focusing an <input> during pointerdown can be flaky in some browsers.
        // Do it on next tick and force a filter pass so the list always matches what's in the box.
        setTimeout(() => {
            try {
                if (search) {
                    search.focus();
                    // don't select on purpose; user might be continuing typing
                    search.dispatchEvent(new Event("input"));
                }
            } catch {}
        }, 0);

        closeOtherCombos(hostEl);
    };
    const close = () => {
        if (!menu) return;
        menu.hidden = true;
        ctl?.setAttribute("aria-expanded", "false");
        if (search) search.value = "";
        // reset filter
        opts?.querySelectorAll(".comboOpt").forEach(o => o.hidden = false);
        if (empty) empty.hidden = true;
    };
    hostEl.__comboClose = close;

    const stop = (e) => { try { e.stopPropagation(); } catch {} };
    const stopHard = (e) => { try { e.preventDefault(); } catch {} stop(e); };

    // Use pointerdown so we beat "click-away" handlers and avoid flaky toggles.
    ctl?.addEventListener("pointerdown", (e) => {
        stopHard(e);
        if (menu?.hidden) open(); else close();
    });
    // Same label-focus fix as single-select: prevent label default from stealing focus.
    ctl?.addEventListener("click", stopHard);
    ctl?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (menu?.hidden) ? open() : close(); }
        if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    opts?.addEventListener("pointerdown", (e) => {
        stopHard(e);
        const el = e.target?.closest?.(".comboOpt");
        if (!el) return;
        const val = el.getAttribute("data-opt") || "";
        if (!val) return;
        if (selected.has(val)) selected.delete(val); else selected.add(val);
        comboMultiSetSelected(hostEl, Array.from(selected));
        hostEl.dispatchEvent(new Event("change", { bubbles: true }));
        // Re-render to refresh chips + states. Keep open, but do it next tick to avoid document handlers.
        comboMultiRender(hostEl, { options, selected: Array.from(selected), placeholder });
        setTimeout(() => {
            try {
                const m = hostEl.querySelector(".comboMenu");
                if (m) m.hidden = false;
                const s = hostEl.querySelector(".comboSearch");
                if (s) s.focus();
            } catch {}
        }, 0);
    });

    hostEl.querySelectorAll(".comboChip").forEach(chip => {
        chip.addEventListener("pointerdown", (e) => {
            stopHard(e);
            const v = chip.getAttribute("data-chip");
            if (!v) return;
            selected.delete(v);
            comboMultiSetSelected(hostEl, Array.from(selected));
            hostEl.dispatchEvent(new Event("change", { bubbles: true }));
            comboMultiRender(hostEl, { options, selected: Array.from(selected), placeholder });
        });
    });

    const applyMultiFilter = () => {
        const q = normalizeComboQuery(search?.value);
        let visible = 0;
        opts?.querySelectorAll(".comboOpt").forEach(o => {
            const t = normalizeComboText(o.dataset.norm || o.getAttribute("data-opt") || "");
            const show = q ? t.includes(q) : true;
            o.hidden = !show;
            if (show) visible++;
        });
        if (empty) empty.hidden = visible !== 0;
    };

    // Filter as you type (and also after IME composition).
    // Some edge cases (autofill, certain IME paths) can miss "input", so keep a lightweight fallback.
    search?.addEventListener("input", applyMultiFilter);
    search?.addEventListener("compositionend", applyMultiFilter);
    search?.addEventListener("keyup", applyMultiFilter);

    // click-away close
    if (!window.__comboMultiGlobalBound) {
        window.__comboMultiGlobalBound = true;
        document.addEventListener("pointerdown", (e) => {
            document.querySelectorAll(".comboMulti").forEach(node => {
                if (node.contains(e.target)) return;
                if (node.__comboClose) node.__comboClose();
            });
        }, true);
    }
}

// ---------- Single-select combobox (wrapping existing <select>) ----------

function normalizeComboText(s){
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeComboQuery(s){
    return normalizeComboText(s);
}

function initComboFromSelect(selectEl, cfg){
    if (!selectEl || selectEl.__comboBound) return;
    const placeholder = cfg?.placeholder || "Wybierz...";

    // Build wrapper right after select (keep select in DOM for existing listeners)
    const wrap = document.createElement("div");
    wrap.className = "comboWrap";

    const ctl = document.createElement("div");
    ctl.className = "comboCtl";
    ctl.setAttribute("tabindex", "0");
    ctl.setAttribute("role", "combobox");
    ctl.setAttribute("aria-expanded", "false");

    const valueEl = document.createElement("div");
    valueEl.className = "comboValue";
    const caret = document.createElement("div");
    caret.className = "comboCaret";
    caret.textContent = "▾";
    ctl.appendChild(valueEl);
    ctl.appendChild(caret);

    const menu = document.createElement("div");
    menu.className = "comboMenu";
    menu.hidden = true;
    const searchWrap = document.createElement("div");
    searchWrap.className = "comboSearchWrap";
    const search = document.createElement("input");
    search.className = "comboSearch";
    search.type = "text";
    search.placeholder = "Szukaj...";
    search.autocomplete = "off";
    searchWrap.appendChild(search);
    const options = document.createElement("div");
    options.className = "comboOptions";
    const empty = document.createElement("div");
    empty.className = "comboEmpty";
    empty.hidden = true;
    empty.textContent = "Brak wyników";
    options.appendChild(empty);
    menu.appendChild(searchWrap);
    menu.appendChild(options);

    wrap.appendChild(ctl);
    wrap.appendChild(menu);

    // Insert after select
    selectEl.insertAdjacentElement("afterend", wrap);
    selectEl.classList.add("comboNativeHidden");
    selectEl.__comboBound = true;
    selectEl.__comboWrap = wrap;

    const stop = (e) => { try { e.stopPropagation(); } catch {} };
    const stopHard = (e) => { try { e.preventDefault(); } catch {} stop(e); };

    const close = () => {
        menu.hidden = true;
        ctl.classList.remove("isOpen");
        ctl.setAttribute("aria-expanded", "false");
        search.value = "";
        // reset filter
        options.querySelectorAll(".comboOpt").forEach(o => o.hidden = false);
        empty.hidden = true;
    };
    const open = () => {
        if (selectEl.disabled) return;
        closeOtherCombos(wrap);
        menu.hidden = false;
        ctl.classList.add("isOpen");
        ctl.setAttribute("aria-expanded", "true");
        // focus after paint to avoid scroll jumps
        setTimeout(() => { try { search.focus(); } catch {} }, 0);
    };

    wrap.__comboClose = close;

    ctl.addEventListener("pointerdown", (e) => {
        stopHard(e);
        if (selectEl.disabled) return;
        menu.hidden ? open() : close();
    });

    // IMPORTANT: if this combobox lives inside a <label>, the label's default action can
    // steal focus back to the hidden <select> on click. Keep click default suppressed.
    ctl.addEventListener("click", stopHard);

    ctl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); menu.hidden ? open() : close(); }
        if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    menu.addEventListener("pointerdown", stop); // don’t bubble to click-away

    search.addEventListener("input", () => {
        const q = normalizeComboQuery(search.value);
        let visible = 0;
        options.querySelectorAll(".comboOpt").forEach(o => {
            const t = normalizeComboText(o.dataset.label);
            const show = q ? t.includes(q) : true;
            o.hidden = !show;
            if (show) visible++;
        });
        empty.hidden = visible !== 0;
    });

    options.addEventListener("pointerdown", (e) => {
        stopHard(e);
        const opt = e.target?.closest?.(".comboOpt");
        if (!opt) return;
        const val = opt.getAttribute("data-value") || "";
        selectEl.value = val;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        refreshComboFromSelect(selectEl, { placeholder });
        close();
    });

    // Global click-away for single comboboxes (bound once)
    if (!window.__comboSingleGlobalBound) {
        window.__comboSingleGlobalBound = true;
        document.addEventListener("pointerdown", (e) => {
            document.querySelectorAll(".comboWrap").forEach(node => {
                if (node.contains(e.target)) return;
                if (node.__comboClose) node.__comboClose();
            });
        }, true);
    }

    refreshComboFromSelect(selectEl, { placeholder });
}

function refreshComboFromSelect(selectEl, cfg){
    if (!selectEl || !selectEl.__comboWrap) return;
    const placeholder = cfg?.placeholder || "Wybierz...";
    const wrap = selectEl.__comboWrap;
    const ctl = wrap.querySelector(".comboCtl");
    const valueEl = wrap.querySelector(".comboValue");
    const options = wrap.querySelector(".comboOptions");
    const empty = wrap.querySelector(".comboEmpty");
    if (!ctl || !valueEl || !options) return;

    // disabled sync
    if (selectEl.disabled) ctl.classList.add("isDisabled");
    else ctl.classList.remove("isDisabled");

    // Selected label
    const selOpt = selectEl.selectedOptions && selectEl.selectedOptions[0];
    const hasValue = !!(selOpt && selOpt.value);
    if (!hasValue) {
        valueEl.innerHTML = `<span class="comboPlaceholder">${escapeHtml(placeholder)}</span>`;
    } else {
        valueEl.textContent = selOpt.textContent || selOpt.value;
    }

    // rebuild option list (keep empty at end)
    options.querySelectorAll(".comboOpt").forEach(n => n.remove());
    const frag = document.createDocumentFragment();
    Array.from(selectEl.options || []).forEach(o => {
        // Hide the redundant empty placeholder option from the custom dropdown list
        // (keep the "no selection" state via the combobox placeholder text).
        const isEmptyOpt = !String(o.value || "").trim();
        const optLabel = String(o.textContent || "").trim();
        const hideEmptyByDefault = !(cfg && cfg.showEmptyOption === true);
        if (hideEmptyByDefault && isEmptyOpt && (/^--\s*wybierz\s*--$/i.test(optLabel) || /wybierz/i.test(optLabel) || optLabel === "")) {
            return;
        }

        const div = document.createElement("div");
        div.className = "comboOpt";
        div.setAttribute("data-value", o.value);
        div.dataset.label = normalizeComboText(o.textContent || o.value);
        div.textContent = o.textContent || o.value;
        frag.appendChild(div);
    });
    // Insert before empty
    if (empty) options.insertBefore(frag, empty);
    else options.appendChild(frag);
}

function closeOtherCombos(currentNode){
    // Close multi
    document.querySelectorAll(".comboMulti").forEach(node => {
        if (node === currentNode) return;
        if (node.__comboClose) node.__comboClose();
    });
    // Close single
    document.querySelectorAll(".comboWrap").forEach(node => {
        if (node === currentNode) return;
        if (node.__comboClose) node.__comboClose();
    });
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

// === UTILS UI ===
function renderSelectOptions(select, values, displayMapFn = x => x) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">-- Wybierz --</option>' +
        values.map(v => `<option value="${v}">${displayMapFn(v)}</option>`).join("");
    if (values.includes(current)) select.value = current;

    // If the select is wrapped in a combobox, keep UI in sync.
    try {
        if (select.__comboWrap) refreshComboFromSelect(select);
    } catch {}
}

function toast(title, msg, type="ok") {
    // Defensive: ensure host exists (toast can be called before init() in edge-cases)
    let host = document.querySelector(".toastHost");
    if (!host) {
        host = document.createElement("div");
        host.className = "toastHost";
        document.body.appendChild(host);
    }

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div style="font-weight:bold">${title}</div><div>${msg}</div>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3000);
}
