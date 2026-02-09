// === UI: Renderers and Components ===

// Defensive element cache - checks existence before accessing
const getEls = () => ({
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
    sideWarehouseTotal: document.getElementById('sideWarehouseTotal'),
    sideMissingSignals: document.getElementById('sideMissingSignals'),
    sideHealthLabel: document.getElementById('sideHealthLabel'),
    sideHealthHint: document.getElementById('sideHealthHint'),
    sideCriticalCount: document.getElementById('sideCriticalCount'),
    sideLowCount: document.getElementById('sideLowCount'),
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

// Batch group expansion state
const expandedBatchGroups = new Set();

const batchGroupKey = (lot) => {
    const sku = skuKey(lot.sku);
    const supplier = normalize(lot.supplier || "-").toLowerCase();
    const price = String(safeFloat(lot.unitPrice || 0));
    return `${sku}||${supplier}||${price}`;
};

// Batch group toggle handler
(function bindBatchGroupToggleOnce() {
    if (window.__batchGroupToggleBound) return;
    window.__batchGroupToggleBound = true;

    document.addEventListener("click", (e) => {
        const btn = e.target?.closest?.('[data-action="toggleBatchGroup"]');
        if (!btn) return;

        const key = btn.getAttribute("data-gkey");
        if (!key) return;

        if (expandedBatchGroups.has(key)) expandedBatchGroups.delete(key);
        else expandedBatchGroups.add(key);

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
        els.sideMissingSignals.innerHTML = `<div class="sideEmpty muted small">Brak danych.</div>`;
        return;
    }

    els.sideMissingSignals.innerHTML = rows.map(r => {
        const cls = r.qty <= LOW_DANGER ? "danger" : r.qty <= LOW_WARN ? "warn" : "ok";
        const status = r.qty <= LOW_DANGER ? "Krytyczne" : r.qty <= LOW_WARN ? "Niskie" : "OK";

        return `
            <button class="sideSignalRow" type="button" data-sku="${escapeHtml(String(r.sku))}" 
                    aria-label="Przejdź do części ${escapeHtml(String(r.sku))}">
                <span class="sigMain">
                    <span class="badge sigSku">${escapeHtml(String(r.sku))}</span>
                    <span class="sigName" title="${escapeHtml(String(r.name))}">${escapeHtml(String(r.name))}</span>
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
    const els = getEls();
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
    const els = getEls();
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

    els.sideHealthLabel.classList.remove("ok", "warn", "danger");

    if (critical > 0) {
        els.sideHealthLabel.classList.add("danger");
        els.sideHealthLabel.textContent = "Uwaga";
        els.sideHealthHint.textContent = `Krytyczne braki: ${critical}`;
    } else if (low > 0) {
        els.sideHealthLabel.classList.add("warn");
        els.sideHealthLabel.textContent = "Obserwuj";
        els.sideHealthHint.textContent = `Niskie stany: ${low}`;
    } else {
        els.sideHealthLabel.classList.add("ok");
        els.sideHealthLabel.textContent = "OK";
        els.sideHealthHint.textContent = "Brak krytycznych braków";
    }
}

function renderSidePanel() {
    renderSideHealth();
    renderSideMissingTop5();
    renderSideRecentActions5();
}

function renderWarehouse() {
    const els = getEls();
    if (!els.partsTable || !els.summaryTable) return;

    const searchInput = document.getElementById("searchParts");
    const q = normalize(searchInput?.value).toLowerCase();
    
    const summary = new Map();
    const qtyByKey = new Map();
    let grandTotal = 0;

    const filteredLots = (state.lots || []).filter(l =>
        !q ||
        String(l.sku || "").toLowerCase().includes(q) ||
        String(l.name || "").toLowerCase().includes(q) ||
        String(l.supplier || "").toLowerCase().includes(q)
    );

    const filteredLotsSorted = filteredLots
        .slice()
        .sort((a, b) => (safeQtyInt(a.qty) - safeQtyInt(b.qty)) || ((a.id || 0) - (b.id || 0)));

    filteredLotsSorted.forEach(lot => {
        const key = skuKey(lot.sku);
        if (!key) return;
        summary.set(key, summary.get(key) || { sku: lot.sku, name: lot.name, qty: 0, value: 0 });
        summary.get(key).qty += safeQtyInt(lot.qty);
        summary.get(key).value += safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0);
    });

    summary.forEach((item, key) => {
        qtyByKey.set(key, item.qty);
    });

    const split = document.getElementById("partsSplit");
    const view = split?.getAttribute("data-view") || "compact";

    if (view === "batches") {
        const groups = new Map();

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

            const rowClass = totalQtyForSku <= LOW_DANGER ? "stock-danger" : totalQtyForSku <= LOW_WARN ? "stock-warn" : "";
            const isOpen = expandedBatchGroups.has(g.key);

            const unitPrice = safeFloat(lot0.unitPrice || 0);
            const groupValue = g.sumQty * unitPrice;

            rowsHtml.push(`
                <tr class="batchGroupRow ${rowClass}">
                    <td>
                        <div class="batchMain">
                            <div class="batchTop">
                                <span class="badge">${escapeHtml(lot0.sku)}</span>
                                <span class="batchName">${escapeHtml(lot0.name || "")}</span>
                            </div>
                            <div class="batchMeta muted small">
                                ${escapeHtml(lot0.supplier || "-")} • ${fmtPLN.format(unitPrice)} • Partie: <strong>${g.lots.length}</strong>
                            </div>
                        </div>
                    </td>
                    <td>${escapeHtml(lot0.supplier || "-")}</td>
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

            if (isOpen) {
                const sortedLots = g.lots.slice().sort((a, b) => (a.id || 0) - (b.id || 0));
                sortedLots.forEach(lot => {
                    const val = safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0);
                    rowsHtml.push(`
                        <tr class="batchDetailRow ${rowClass}">
                            <td>
                                <div class="batchDetailIndent">
                                    <span class="muted small">Partia #${lot.id ?? "—"} • ${fmtDateISO(lot.dateIn)}</span><br>
                                    <span class="badge">${escapeHtml(lot.sku)}</span> ${escapeHtml(lot.name || "")}
                                </div>
                            </td>
                            <td>${escapeHtml(lot.supplier || "-")}</td>
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
        els.partsTable.innerHTML = filteredLotsSorted.map(lot => {
            const key = skuKey(lot.sku);
            const totalQty = qtyByKey.get(key) ?? safeQtyInt(lot.qty);
            const rowClass = totalQty <= LOW_DANGER ? "stock-danger" : totalQty <= LOW_WARN ? "stock-warn" : "";
            return `
                <tr class="${rowClass}">
                    <td><span class="badge">${escapeHtml(lot.sku)}</span> ${escapeHtml(lot.name || "")}</td>
                    <td>${escapeHtml(lot.supplier || "-")}</td>
                    <td class="right">${fmtPLN.format(safeFloat(lot.unitPrice || 0))}</td>
                    <td class="right">${safeQtyInt(lot.qty)}</td>
                    <td class="right">${fmtPLN.format(safeQtyInt(lot.qty) * safeFloat(lot.unitPrice || 0))}</td>
                    <td class="right"></td>
                </tr>
            `;
        }).join("");
    }

    summary.forEach(item => { grandTotal += item.value; });
    const totalFormatted = fmtPLN.format(grandTotal);

    if (els.sideWarehouseTotal) els.sideWarehouseTotal.textContent = totalFormatted;
    if (els.whTotal) els.whTotal.textContent = totalFormatted;

    els.summaryTable.innerHTML = Array.from(summary.values())
        .slice()
        .sort((a, b) => (safeQtyInt(a.qty) - safeQtyInt(b.qty)) || String(a.sku).localeCompare(String(b.sku), 'pl'))
        .map(item => `
            <tr class="${item.qty <= LOW_DANGER ? "stock-danger" : item.qty <= LOW_WARN ? "stock-warn" : ""}">
                <td><span class="badge">${escapeHtml(item.sku)}</span></td>
                <td>${escapeHtml(item.name || "")}</td>
                <td class="right">${item.qty}</td>
                <td class="right">${fmtPLN.format(item.value)}</td>
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
            <td><span class="badge">${escapeHtml(i.sku)}</span> ${escapeHtml(i.name || "")}</td>
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
    const els = getEls();
    if (!els.buildItems) return;

    els.buildItems.innerHTML = state.currentBuild.items.map(i => {
        const m = state.machineCatalog.find(x => x.code === i.machineCode);
        return `<tr>
            <td><span class="badge">${escapeHtml(i.machineCode)}</span> ${m ? escapeHtml(m.name) : "???"}</td>
            <td class="right">${i.qty}</td>
            <td class="right"><button class="iconBtn" onclick="removeBuildItem(${i.id})">✕</button></td>
        </tr>`;
    }).join("");

    const buildCountEl = document.getElementById("buildItemsCount");
    const finalizeBuildBtn = document.getElementById("finalizeBuildBtn");
    
    if (buildCountEl) buildCountEl.textContent = String(state.currentBuild.items.length);
    if (finalizeBuildBtn) finalizeBuildBtn.disabled = state.currentBuild.items.length === 0;

    if (els.missingBox) els.missingBox.hidden = true;
    if (els.manualBox) els.manualBox.hidden = true;

    const mode = document.getElementById("consumeMode")?.value || "fifo";
    if (mode === "manual" && state.currentBuild.items.length > 0) {
        renderManualConsume();
    }
}

function renderMissingParts(missing) {
    const els = getEls();
    if (!els.missingBox) return;
    
    els.missingBox.hidden = false;
    const list = byId("missingList");
    if (!list) return;
    
    list.innerHTML = missing.map(m =>
        `<li><strong>${escapeHtml(m.sku)}</strong> ${m.name ? `(${escapeHtml(m.name)})` : ""}: 
         Potrzeba ${m.needed}, stan: ${m.has} <span class="muted">(brakuje: ${m.missing})</span></li>`
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
        if (els.manualBox) els.manualBox.hidden = true;
        return;
    }

    const els = getEls();
    if (els.manualBox) els.manualBox.hidden = false;

    req.forEach((qtyNeeded, skuKeyStr) => {
        const part = state.partsCatalog.get(skuKeyStr);

        const lots = (state.lots || [])
            .filter(l => skuKey(l.sku) === skuKeyStr)
            .slice()
            .sort((a, b) => (a.id || 0) - (b.id || 0));

        const html = `
            <div class="consumePart">
                <div style="margin-bottom:6px">
                    <strong>${escapeHtml(part?.sku || skuKeyStr)}</strong>
                    ${part?.name ? `<span class="muted">- ${escapeHtml(part.name)}</span>` : ""}
                    <span class="muted">(Wymagane: ${qtyNeeded})</span>
                </div>
                ${lots.length ? lots.map(lot => {
                    const dateStr = lot?.dateIn ? fmtDateISO(lot.dateIn) : "—";
                    const supplier = lot?.supplier || "—";
                    const price = fmtPLN.format(safeFloat(lot?.unitPrice || 0));
                    const qtyAvail = safeQtyInt(lot?.qty || 0);
                    const lotId = lot?.id ?? "—";

                    return `
                        <div class="lotRow">
                            <span>
                                <strong>#${lotId}</strong>
                                • ${escapeHtml(supplier)} (${price})
                                • <span class="muted">Data:</span> <strong>${dateStr}</strong>
                                • <span class="muted">Dostępne:</span> <strong>${qtyAvail}</strong>
                            </span>
                            <input type="number" class="manual-lot-input"
                                data-lot-id="${lot?.id}"
                                data-sku="${skuKeyStr}"
                                max="${qtyAvail}" min="0" value="0"
                                aria-label="Ilość z partii ${lotId}">
                        </div>
                    `;
                }).join("") : `<div class="muted small">Brak partii dla tej części.</div>`}
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
            <td><span class="badge">${escapeHtml(m.code)}</span></td>
            <td>${escapeHtml(m.name)}</td>
            <td class="right"><strong>${m.qty}</strong></td>
        </tr>`).join("");
}

function getHistoryView() {
    const v = localStorage.getItem("magazyn_history_view");
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
        tbody.innerHTML = `<tr><td colspan="3" class="muted small">${msg}</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(ev => {
        const date = fmtDateISO(ev.dateISO);
        let summary = "";

        if (ev.type === "delivery") {
            const n = (ev.items || []).length;
            const total = (ev.items || []).reduce((s, i) => s + (safeFloat(i.price) * safeInt(i.qty)), 0);
            summary = `
                <span class="badge">${escapeHtml(ev.supplier || "—")}</span>
                <span class="muted small">• Pozycji: <strong>${n}</strong></span>
                <span class="muted small">• Suma: <strong class="historyMoney">${fmtPLN.format(total)}</strong></span>
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
                    <button class="secondary compact historyPreviewBtn" type="button" 
                            data-action="toggleHistory" data-hid="${ev.id}">Podgląd</button>
                </td>
            </tr>
            <tr class="historyDetailRow" data-hid-detail="${ev.id}" hidden>
                <td colspan="3">
                    <div class="historyDetails"></div>
                </td>
            </tr>
        `;
    }).join("");

    renderSideRecentActions5();
}

function buildHistoryDetails(ev) {
    if (!ev) return "";
    
    const typeLabel = ev.type === "delivery" ? "Dostawa" : "Produkcja";
    const metaBits = [];

    if (ev.type === "delivery") {
        if (ev.supplier) metaBits.push(`<span class="badge">${escapeHtml(ev.supplier)}</span>`);
        metaBits.push(`<span class="muted small">Pozycji: <strong>${(ev.items || []).length}</strong></span>`);
        const total = (ev.items || []).reduce((s, i) => s + (safeFloat(i.price) * safeInt(i.qty)), 0);
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
                                ${(ev.items || []).map(i => {
                                    const rowVal = safeInt(i.qty) * safeFloat(i.price);
                                    return `<tr>
                                        <td><span class="badge">${escapeHtml(i.sku)}</span> ${escapeHtml(i.name || "")}</td>
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

    // Build type
    metaBits.push(`<span class="muted small">Pozycji: <strong>${(ev.items || []).length}</strong></span>`);
    const totalQty = (ev.items || []).reduce((s, i) => s + safeInt(i.qty), 0);
    metaBits.push(`<span class="muted small">Sztuk: <strong>${totalQty}</strong></span>`);

    const totalConsumptionValue = (ev.items || []).reduce((sum, it) => {
        const machineVal = (it?.partsUsed || []).reduce((ms, p) => {
            const lots = Array.isArray(p?.lots) ? p.lots : [];
            return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
        }, 0);
        return sum + machineVal;
    }, 0);
    
    if (Number.isFinite(totalConsumptionValue) && totalConsumptionValue > 0) {
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
                            ${(ev.items || []).map((i, idx) => {
                                const bmid = `${ev.id}-${idx}`;
                                const hasParts = Array.isArray(i.partsUsed) && i.partsUsed.length > 0;

                                const machineConsumptionValue = (i?.partsUsed || []).reduce((ms, p) => {
                                    const lots = Array.isArray(p?.lots) ? p.lots : [];
                                    return ms + lots.reduce((ls, lot) => ls + (safeInt(lot?.qty) * safeFloat(lot?.unitPrice || 0)), 0);
                                }, 0);

                                const btn = hasParts
                                    ? `<button class="secondary compact" type="button" 
                                            data-action="toggleBuildMachine" data-bmid="${bmid}" 
                                            aria-expanded="false">Podgląd</button>`
                                    : `<span class="muted small">—</span>`;

                                const partsRows = (hasParts ? i.partsUsed : []).flatMap(p => {
                                    const lots = Array.isArray(p.lots) ? p.lots : [];
                                    if (!lots.length) return [];
                                    return lots.map(lot => {
                                        const d = lot.dateIn ? fmtDateISO(lot.dateIn) : "—";
                                        const price = fmtPLN.format(safeFloat(lot.unitPrice || 0));
                                        const rowVal = safeInt(lot.qty) * safeFloat(lot.unitPrice || 0);
                                        return `
                                            <tr>
                                                <td><span class="badge">${escapeHtml(lot.sku || p.sku || "—")}</span> ${escapeHtml(lot.name || p.name || "")}</td>
                                                <td>${escapeHtml(lot.supplier || "-")}</td>
                                                <td>${escapeHtml(d)}</td>
                                                <td class="right">${price}</td>
                                                <td class="right"><strong>${safeInt(lot.qty)}</strong></td>
                                                <td class="right">${fmtPLN.format(rowVal)}</td>
                                            </tr>
                                        `;
                                    });
                                }).join("");

                                const empty = !partsRows
                                    ? `<div class="muted small">Brak danych o zużyciu dla tej maszyny.</div>`
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
                                                <tbody>${partsRows}</tbody>
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

function renderAllSuppliers() {
    const table = byId("suppliersListTable");
    const tbody = table?.querySelector("tbody");
    if (!tbody) return;
    
    tbody.innerHTML = Array.from(state.suppliers.keys()).sort().map(name => `
        <tr>
            <td>${escapeHtml(name)}</td>
            <td class="right">
                <button class="success compact" onclick="openSupplierEditor('${escapeHtml(name)}')">Cennik</button>
                <button class="iconBtn" onclick="askDeleteSupplier('${escapeHtml(name)}')">Usuń</button>
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
            <td>${suppliers.length ? suppliers.map(s => escapeHtml(s)).join(", ") : '<span class="muted">-</span>'}</td>
            <td class="right">
                <button class="success compact" onclick="startEditPart('${escapeHtml(p.sku)}')">Edytuj</button>
                <button class="iconBtn" onclick="askDeletePart('${escapeHtml(p.sku)}')">Usuń</button>
            </td>
        </tr>`;
    }).join("");

    // Machines catalog
    els.machinesCatalog.innerHTML = state.machineCatalog.map(m => `
        <tr>
            <td><span class="badge">${escapeHtml(m.code)}</span></td>
            <td>${escapeHtml(m.name)}</td>
            <td class="right">${m.bom.length}</td>
            <td class="right">
                <button class="success compact" onclick="openMachineEditor('${escapeHtml(m.code)}')">Edytuj BOM</button>
                <button class="iconBtn" onclick="askDeleteMachine('${escapeHtml(m.code)}')">Usuń</button>
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

// === Multi-combobox (no deps) ===
// FIXED: Memory leak prevention - track and cleanup listeners
const _comboRegistry = new WeakMap();

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
    
    // Cleanup previous listeners to prevent memory leaks
    const prevHandlers = _comboRegistry.get(hostEl);
    if (prevHandlers) {
        prevHandlers.forEach(({ el, event, fn }) => {
            try { el.removeEventListener(event, fn); } catch {}
        });
    }
    
    const handlers = [];
    const track = (el, event, fn) => {
        el.addEventListener(event, fn);
        handlers.push({ el, event, fn });
    };
    
    const options = Array.isArray(cfg?.options) ? cfg.options : [];
    const selected = new Set(Array.isArray(cfg?.selected) ? cfg.selected : comboMultiGetSelected(hostEl));
    const placeholder = cfg?.placeholder || "Wybierz...";

    hostEl.dataset.options = options.join("|");
    hostEl.dataset.placeholder = placeholder;
    comboMultiSetSelected(hostEl, Array.from(selected));

    if (options.length === 0) {
        hostEl.innerHTML = `<span class="small muted">${escapeHtml(placeholder)}</span>`;
        _comboRegistry.set(hostEl, handlers);
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

    const ctl = hostEl.querySelector(".comboCtl");
    const menu = hostEl.querySelector(".comboMenu");
    const search = hostEl.querySelector(".comboSearch");
    const opts = hostEl.querySelector(".comboOptions");
    const empty = hostEl.querySelector(".comboEmpty");

    const open = () => {
        if (!menu) return;
        menu.hidden = false;
        ctl?.setAttribute("aria-expanded", "true");
        
        requestAnimationFrame(() => {
            try {
                if (search) {
                    search.focus();
                    search.dispatchEvent(new Event("input"));
                }
            } catch {}
        });

        closeOtherCombos(hostEl);
    };
    
    const close = () => {
        if (!menu) return;
        menu.hidden = true;
        ctl?.setAttribute("aria-expanded", "false");
        if (search) search.value = "";
        opts?.querySelectorAll(".comboOpt").forEach(o => o.hidden = false);
        if (empty) empty.hidden = true;
    };
    
    hostEl.__comboClose = close;

    const stop = (e) => { try { e.stopPropagation(); } catch {} };
    const stopHard = (e) => { try { e.preventDefault(); } catch {} stop(e); };

    track(ctl, "pointerdown", (e) => {
        stopHard(e);
        if (menu?.hidden) open(); else close();
    });
    
    track(ctl, "click", stopHard);
    track(ctl, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (menu?.hidden) ? open() : close(); }
        if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    track(opts, "pointerdown", (e) => {
        stopHard(e);
        const el = e.target?.closest?.(".comboOpt");
        if (!el) return;
        const val = el.getAttribute("data-opt") || "";
        if (!val) return;
        
        if (selected.has(val)) selected.delete(val); 
        else selected.add(val);
        
        comboMultiSetSelected(hostEl, Array.from(selected));
        hostEl.dispatchEvent(new Event("change", { bubbles: true }));
        comboMultiRender(hostEl, { options, selected: Array.from(selected), placeholder });
        
        requestAnimationFrame(() => {
            try {
                const m = hostEl.querySelector(".comboMenu");
                if (m) m.hidden = false;
                const s = hostEl.querySelector(".comboSearch");
                if (s) s.focus();
            } catch {}
        });
    });

    hostEl.querySelectorAll(".comboChip").forEach(chip => {
        track(chip, "pointerdown", (e) => {
            stopHard(e);
            const v = chip.getAttribute("data-chip");
            if (!v) return;
            selected.delete(v);
            comboMultiSetSelected(hostEl, Array.from(selected));
            hostEl.dispatchEvent(new Event("change", { bubbles: true }));
            comboMultiRender(hostEl, { options, selected: Array.from(selected), placeholder });
            // FIXED (B6): Restore focus to search after chip removal
            requestAnimationFrame(() => {
                try {
                    const m = hostEl.querySelector(".comboMenu");
                    if (m) m.hidden = false;
                    const s = hostEl.querySelector(".comboSearch");
                    if (s) s.focus();
                } catch {}
            });
        });
    });

  const applyMultiFilter = () => {
    const q = normalizeComboQuery(search?.value);
    let visible = 0;
    opts?.querySelectorAll(".comboOpt").forEach(o => {
        const optValue = o.getAttribute("data-opt") || "";
        const t = normalizeComboText(optValue);
        const show = q ? t.includes(q) : true;
        o.hidden = !show;
        if (show) visible++;
    });
    if (empty) empty.hidden = visible !== 0;
};

    track(search, "input", applyMultiFilter);
    track(search, "compositionend", applyMultiFilter);
    track(search, "keyup", applyMultiFilter);

    _comboRegistry.set(hostEl, handlers);
    
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

// === Single-select combobox ===
const _singleComboRegistry = new WeakMap();

function normalizeComboText(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeComboQuery(s) {
    return normalizeComboText(s);
}

function initComboFromSelect(selectEl, cfg) {
    if (!selectEl || selectEl.__comboBound) return;
    
    const placeholder = cfg?.placeholder || "Wybierz...";

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

    selectEl.insertAdjacentElement("afterend", wrap);
    selectEl.classList.add("comboNativeHidden");
    selectEl.__comboBound = true;
    selectEl.__comboWrap = wrap;

    const handlers = [];
    const track = (el, event, fn) => {
        el.addEventListener(event, fn);
        handlers.push({ el, event, fn });
    };

    const stop = (e) => { try { e.stopPropagation(); } catch {} };
    const stopHard = (e) => { try { e.preventDefault(); } catch {} stop(e); };

    const close = () => {
        menu.hidden = true;
        ctl.classList.remove("isOpen");
        ctl.setAttribute("aria-expanded", "false");
        search.value = "";
        options.querySelectorAll(".comboOpt").forEach(o => o.hidden = false);
        empty.hidden = true;
    };
    
    const open = () => {
        if (selectEl.disabled) return;
        closeOtherCombos(wrap);
        menu.hidden = false;
        ctl.classList.add("isOpen");
        ctl.setAttribute("aria-expanded", "true");
        requestAnimationFrame(() => { try { search.focus(); } catch {} });
    };

    wrap.__comboClose = close;

    track(ctl, "pointerdown", (e) => {
        stopHard(e);
        if (selectEl.disabled) return;
        menu.hidden ? open() : close();
    });
    
    track(ctl, "click", stopHard);
    track(ctl, "keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); menu.hidden ? open() : close(); }
        if (e.key === "Escape") { e.preventDefault(); close(); }
    });

    track(menu, "pointerdown", stop);

    track(search, "input", () => {
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

    track(options, "pointerdown", (e) => {
        stopHard(e);
        const opt = e.target?.closest?.(".comboOpt");
        if (!opt) return;
        const val = opt.getAttribute("data-value") || "";
        selectEl.value = val;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        refreshComboFromSelect(selectEl, { placeholder });
        // FIXED (B5): Ensure combobox closes with small delay for reliability
        setTimeout(close, 0);
    });

    _singleComboRegistry.set(wrap, handlers);

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

function refreshComboFromSelect(selectEl, cfg) {
    if (!selectEl || !selectEl.__comboWrap) return;
    
    const placeholder = cfg?.placeholder || "Wybierz...";
    const wrap = selectEl.__comboWrap;
    const ctl = wrap.querySelector(".comboCtl");
    const valueEl = wrap.querySelector(".comboValue");
    const options = wrap.querySelector(".comboOptions");
    const empty = wrap.querySelector(".comboEmpty");
    
    if (!ctl || !valueEl || !options) return;

    if (selectEl.disabled) ctl.classList.add("isDisabled");
    else ctl.classList.remove("isDisabled");

    const selOpt = selectEl.selectedOptions?.[0];
    const hasValue = !!(selOpt && selOpt.value);
    
    if (!hasValue) {
        valueEl.innerHTML = `<span class="comboPlaceholder">${escapeHtml(placeholder)}</span>`;
    } else {
        valueEl.textContent = selOpt.textContent || selOpt.value;
    }

    options.querySelectorAll(".comboOpt").forEach(n => n.remove());
    
    const frag = document.createDocumentFragment();
    Array.from(selectEl.options || []).forEach(o => {
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
    
    if (empty) options.insertBefore(frag, empty);
    else options.appendChild(frag);
}

function closeOtherCombos(currentNode) {
    document.querySelectorAll(".comboMulti").forEach(node => {
        if (node === currentNode) return;
        if (node.__comboClose) node.__comboClose();
    });
    document.querySelectorAll(".comboWrap").forEach(node => {
        if (node === currentNode) return;
        if (node.__comboClose) node.__comboClose();
    });
}

// === Utils ===
function renderSelectOptions(select, values, displayMapFn = x => x) {
    if (!select) return;
    
    const current = select.value;
    select.innerHTML = '<option value="">-- Wybierz --</option>' +
        values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(displayMapFn(v))}</option>`).join("");
    
    if (values.includes(current)) select.value = current;

    try {
        if (select.__comboWrap) refreshComboFromSelect(select);
    } catch {}
}

function toast(title, msg, type = "ok") {
    let host = document.querySelector(".toastHost");
    if (!host) {
        host = document.createElement("div");
        host.className = "toastHost";
        document.body.appendChild(host);
    }

    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div style="font-weight:bold">${escapeHtml(title)}</div><div>${escapeHtml(msg)}</div>`;
    host.appendChild(el);
    
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { 
        el.classList.remove("show"); 
        setTimeout(() => el.remove(), 300); 
    }, 4000);
}
