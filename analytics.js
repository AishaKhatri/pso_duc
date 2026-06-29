// Analytics page: aggregate, fleet-wide bar charts with a collapsible right-side
// list-viewer panel (same fixed/sticky pattern as the dispensers Alarms panel).
//   Chart 1 — devices (dispensers) by connection state: Connected / Disconnected,
//             derived from each dispenser's conn_status (1 = connected).
//   Chart 2 — nozzles by operating state: Auto / Manual / No Ping, derived from
//             nozzle.status (1 = Auto, 0 = Manual, 2 = No Ping). View tabs switch
//             this chart between nozzle-wise (every nozzle) and dispenser-wise
//             (each dispenser once by its nozzles' shared status, else Ambiguous).
// Each chart's "View List" button opens that chart's rows in the right panel.
// Everything comes from a single /api/dispensers-full call.

const ANALYSIS_REFRESH_MS = 30 * 1000;
let analysisRefreshTimer = null;

// Tallest bar in a chart fills this many px; the rest scale proportionally.
const CHART_MAX_BAR_PX = 240;

// The list panel's width now lives in CSS (.analysis-viewer-panel max-width).
// Only its collapsed-state persistence key remains here.
const VIEWER_COLLAPSED_KEY = 'analyticsViewerCollapsed';

// Render state kept across refreshes / toggles so switching views doesn't
// re-fetch and the chosen views survive auto-refresh.
let latestDispensers = [];
let nozzleMode = 'nozzle';  // 'nozzle' | 'dispenser'  (nozzle chart aggregation)
let viewerMode = null;      // null | 'device' | 'nozzle'  (which list the panel shows)
let chartsColEl = null;
let nozzleCardEl = null;
let priceCardEl = null;
let priceMatchDecimals = 1;  // 1 | 2  — precision the price chart compares at (1 = first decimal only)

// Viewer-panel element refs + state (set by createViewerPanel).
let viewerBodyEl = null;
let viewerTitleEl = null;
let viewerCountEl = null;
let viewerCollapsed = false;
let setViewerCollapsedFn = null;

// List sort/search state. viewerSort.col is a column index (null = unsorted),
// dir 1 = ascending, -1 = descending. Both reset when the shown list changes
// (different mode/filter) but persist across the 30s auto-refresh.
let viewerSearchEl = null;
let viewerSearchRowEl = null;
let viewerTableHostEl = null;
let viewerSort = { col: null, dir: 1 };
let viewerSearch = '';
let currentSpec = null;
let lastViewerKey = null;

// ---- status → display metadata (label + pill color "kind") ----
function deviceStatusMeta(connStatus) {
    return connStatus
        ? { label: 'Connected', kind: 'online' }
        : { label: 'Disconnected', kind: 'offline' };
}
function nozzleStatusMeta(code) {
    switch (Number(code)) {
        case 1: return { label: 'Auto', kind: 'online' };
        case 0: return { label: 'Manual', kind: 'reset' };
        case 2: return { label: 'No Ping', kind: 'offline' };
        default: return { label: 'Unknown', kind: 'accent' };
    }
}
function dispenserStatusMeta(nozzles) {
    const codes = new Set((nozzles || []).map(n => Number(n.status)));
    if (codes.size === 1) {
        const meta = nozzleStatusMeta(codes.values().next().value);
        if (meta.label !== 'Unknown') return meta;
    }
    return { label: 'Ambiguous', kind: 'accent' };
}

// ---- chart aggregation ----
function computeDeviceStats(dispensers) {
    let connected = 0, disconnected = 0;
    for (const d of dispensers) {
        if (d.conn_status) connected++;
        else disconnected++;
    }
    return [
        { label: 'Connected',    value: connected,    color: 'var(--status-online)' },
        { label: 'Disconnected', value: disconnected, color: 'var(--status-offline)' },
    ];
}
function computeNozzleStatsNozzleWise(dispensers) {
    let auto = 0, manual = 0, noPing = 0;
    for (const d of dispensers) {
        for (const n of (d.nozzles || [])) {
            const code = Number(n.status);
            if (code === 1) auto++;
            else if (code === 0) manual++;
            else if (code === 2) noPing++;
        }
    }
    return [
        { label: 'Auto',    value: auto,   color: 'var(--status-online)' },
        { label: 'Manual',  value: manual, color: 'var(--status-partial)' },
        { label: 'No Ping', value: noPing, color: 'var(--status-offline)' },
    ];
}
function computeNozzleStatsDispenserWise(dispensers) {
    let auto = 0, manual = 0, noPing = 0, ambiguous = 0;
    for (const d of dispensers) {
        const nozzles = d.nozzles || [];
        if (nozzles.length === 0) continue;
        switch (dispenserStatusMeta(nozzles).label) {
            case 'Auto': auto++; break;
            case 'Manual': manual++; break;
            case 'No Ping': noPing++; break;
            default: ambiguous++;
        }
    }
    return [
        { label: 'Auto',      value: auto,      color: 'var(--status-online)' },
        { label: 'Manual',    value: manual,    color: 'var(--status-partial)' },
        { label: 'No Ping',   value: noPing,    color: 'var(--status-offline)' },
        { label: 'Ambiguous', value: ambiguous, color: 'var(--accent)' },
    ];
}

// ---- price match classification (mirrors the dispensers Alarms "Check Prices") ----
//   filed = nozzle.actual_price    (the station's filed / notified price)
//   live  = nozzle.price_per_liter (the price the nozzle is actually set to)
// Missing filed (or live) price → "Unlisted"; otherwise the two prices are
// keyed at the current precision (priceMatchDecimals) and compared for equality.
// Snap to exact paisa first (kills float noise); at 1-decimal precision the last
// paisa digit is dropped (truncate, not round), so 272.34 and 272.37 both key to
// 2723 → "Matched"; at full precision they're compared paisa-for-paisa.
function priceKey(x, decimals) {
    const paisa = Math.round(x * 100);
    return decimals >= 2 ? paisa : Math.floor(paisa / 10);
}
function priceMatchMeta(n) {
    const filed = Number(n.actual_price);
    const live = Number(n.price_per_liter);
    if (!(Number.isFinite(filed) && filed > 0) || !Number.isFinite(live)) {
        return { label: 'Unlisted', kind: 'accent' };
    }
    return priceKey(filed, priceMatchDecimals) === priceKey(live, priceMatchDecimals)
        ? { label: 'Matched', kind: 'online' }
        : { label: 'Mismatched', kind: 'offline' };
}
function computePriceStats(dispensers) {
    let matched = 0, mismatched = 0, unlisted = 0;
    for (const d of dispensers) {
        for (const n of (d.nozzles || [])) {
            switch (priceMatchMeta(n).label) {
                case 'Matched': matched++; break;
                case 'Mismatched': mismatched++; break;
                default: unlisted++;
            }
        }
    }
    return [
        { label: 'Matched',    value: matched,    color: 'var(--status-online)' },
        { label: 'Mismatched', value: mismatched, color: 'var(--status-offline)' },
        { label: 'Unlisted',   value: unlisted,   color: 'var(--accent)' },
    ];
}

// ---- small UI helpers ----
const PILL_STYLES = {
    online:  { bg: 'var(--badge-online-bg)',  color: 'var(--badge-online-text)',  border: 'transparent' },
    offline: { bg: 'var(--badge-offline-bg)', color: 'var(--badge-offline-text)', border: 'transparent' },
    reset:   { bg: 'var(--badge-reset-bg)',   color: 'var(--badge-reset-text)',   border: 'transparent' },
    accent:  { bg: 'transparent',             color: 'var(--accent)',             border: 'var(--accent)' },
};
function statusPill(label, kind) {
    const s = PILL_STYLES[kind] || PILL_STYLES.accent;
    const span = document.createElement('span');
    span.className = 'status-pill';
    span.textContent = label;
    span.style.background = s.bg;
    span.style.color = s.color;
    span.style.border = `1px solid ${s.border}`;
    return span;
}
function shortNozzleId(id) {
    return String(id ?? '').split('-').pop() || '—';
}
function addrCompare(a, b) {
    return String(ensureDAddress(a)).localeCompare(String(ensureDAddress(b)), undefined, { numeric: true });
}
// Format a timestamp as "YYYY-MM-DD HH:mm" — compact, and (unlike a locale
// string) it sorts chronologically as plain text, so the column's click-sort
// orders by time. Null/invalid → "Never".
function formatTimestamp(ts) {
    if (!ts) return 'Never';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return 'Never';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Price as a 2-decimal string; missing/zero/non-numeric → "—".
function formatPrice(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '—';
}
// Most-recent last_ping_at (ms) across a dispenser's nozzles, or null if none.
function latestPing(nozzles) {
    let best = null;
    for (const n of (nozzles || [])) {
        if (!n.last_ping_at) continue;
        const t = new Date(n.last_ping_at).getTime();
        if (!isNaN(t) && (best === null || t > best)) best = t;
    }
    return best;
}

// Build one labeled vertical bar chart card from a list of {label, value, color}.
// opts.action  → element placed in the header (right of the total).
// opts.toolbar → element placed as a control row between header and chart.
function buildBarChartCard(title, bars, opts = {}) {
    const card = document.createElement('div');
    card.className = 'analysis-card';
    if (opts.sourceKey) card.dataset.source = opts.sourceKey;

    const total = bars.reduce((sum, b) => sum + b.value, 0);

    const header = document.createElement('div');
    header.className = 'analysis-card-header';
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const right = document.createElement('div');
    right.className = 'analysis-header-right';
    const totalEl = document.createElement('span');
    totalEl.className = 'analysis-card-total';
    totalEl.textContent = `Total: ${formatCount(total)}`;
    right.appendChild(totalEl);
    if (opts.action) right.appendChild(opts.action);
    header.appendChild(h2);
    header.appendChild(right);
    card.appendChild(header);

    if (opts.toolbar) card.appendChild(opts.toolbar);

    const chart = document.createElement('div');
    chart.className = 'bar-chart';
    const maxValue = bars.reduce((m, b) => Math.max(m, b.value), 0);
    bars.forEach(b => {
        const col = document.createElement('div');
        col.className = 'bar-col';

        const valueEl = document.createElement('div');
        valueEl.className = 'bar-value';
        valueEl.textContent = formatCount(b.value);

        const bar = document.createElement('div');
        bar.className = 'bar';
        const px = maxValue > 0 ? Math.round((b.value / maxValue) * CHART_MAX_BAR_PX) : 0;
        bar.style.height = `${b.value > 0 ? Math.max(px, 4) : 0}px`;
        bar.style.background = b.color;
        bar.title = `${b.label}: ${formatCount(b.value)}`;

        const labelEl = document.createElement('div');
        labelEl.className = 'bar-label';
        labelEl.textContent = b.label;

        col.appendChild(valueEl);
        col.appendChild(bar);
        col.appendChild(labelEl);
        chart.appendChild(col);
    });
    card.appendChild(chart);
    return card;
}

// "View List" pill button — opens this chart's list in the right panel (and
// expands the panel if it was collapsed).
function makeViewListButton(listKey) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chart-range-tab analysis-list-btn';
    btn.dataset.list = listKey;
    btn.textContent = 'View List';
    if (viewerMode === listKey) btn.classList.add('active');
    btn.addEventListener('click', () => {
        viewerMode = listKey;
        if (setViewerCollapsedFn) setViewerCollapsedFn(false);
        renderViewer();
        syncActiveStates();
    });
    return btn;
}

// View tabs for the nozzle chart — same pill vocabulary as the dashboard sales tabs.
function buildNozzleViewTabs() {
    const tabs = document.createElement('div');
    tabs.className = 'chart-range-tabs analysis-view-tabs';
    [['nozzle', 'Nozzle-wise'], ['dispenser', 'Dispenser-wise']].forEach(([value, text]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chart-range-tab';
        btn.dataset.mode = value;
        btn.textContent = text;
        if (value === nozzleMode) btn.classList.add('active');
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            nozzleMode = value;
            rebuildNozzleCard();
        });
        tabs.appendChild(btn);
    });
    return tabs;
}

// Full chart titles — reused verbatim in the list-panel header.
const DEVICE_CHART_TITLE = 'Devices — Connection Status';
const NOZZLE_CHART_TITLE = 'Operating Modes — Status';
const PRICE_CHART_TITLE = 'Prices — Match Status';
function nozzleFilterLabel() {
    return nozzleMode === 'dispenser' ? 'Dispenser-wise' : 'Nozzle-wise';
}

function buildDeviceCard(dispensers) {
    return buildBarChartCard(DEVICE_CHART_TITLE, computeDeviceStats(dispensers), {
        action: makeViewListButton('device'),
        sourceKey: 'device',
    });
}
function buildNozzleCard(dispensers) {
    const bars = nozzleMode === 'dispenser'
        ? computeNozzleStatsDispenserWise(dispensers)
        : computeNozzleStatsNozzleWise(dispensers);
    return buildBarChartCard(NOZZLE_CHART_TITLE, bars, {
        action: makeViewListButton('nozzle'),
        toolbar: buildNozzleViewTabs(),
        sourceKey: 'nozzle',
    });
}
function buildPriceCard(dispensers) {
    return buildBarChartCard(PRICE_CHART_TITLE, computePriceStats(dispensers), {
        action: makeViewListButton('price'),
        toolbar: buildPricePrecisionTabs(),
        sourceKey: 'price',
    });
}

// Toggle the precision the price chart matches at: first decimal only vs. full
// price. Mirrors buildNozzleViewTabs.
function buildPricePrecisionTabs() {
    const tabs = document.createElement('div');
    tabs.className = 'chart-range-tabs analysis-view-tabs';
    [[1, '1 Decimal'], [2, 'Full Price']].forEach(([value, text]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chart-range-tab';
        btn.dataset.mode = String(value);
        btn.textContent = text;
        if (value === priceMatchDecimals) btn.classList.add('active');
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            priceMatchDecimals = value;
            rebuildPriceCard();
        });
        tabs.appendChild(btn);
    });
    return tabs;
}

// Highlight the active chart's "View List" button and ring its card.
function syncActiveStates() {
    if (!chartsColEl) return;
    chartsColEl.querySelectorAll('.analysis-list-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.list === viewerMode);
    });
    chartsColEl.querySelectorAll('.analysis-card').forEach(c => {
        c.classList.toggle('active-source', !!viewerMode && c.dataset.source === viewerMode);
    });
}

function rebuildNozzleCard() {
    if (!chartsColEl) return;
    const fresh = buildNozzleCard(latestDispensers);
    if (nozzleCardEl && nozzleCardEl.parentNode === chartsColEl) {
        chartsColEl.replaceChild(fresh, nozzleCardEl);
    } else {
        chartsColEl.appendChild(fresh);
    }
    nozzleCardEl = fresh;
    syncActiveStates();
    if (viewerMode === 'nozzle') renderViewer();
}

function rebuildPriceCard() {
    if (!chartsColEl) return;
    const fresh = buildPriceCard(latestDispensers);
    if (priceCardEl && priceCardEl.parentNode === chartsColEl) {
        chartsColEl.replaceChild(fresh, priceCardEl);
    } else {
        chartsColEl.appendChild(fresh);
    }
    priceCardEl = fresh;
    syncActiveStates();
    if (viewerMode === 'price') renderViewer();
}

// ---- collapsible viewer panel (in-flow flex item) ----
function createViewerPanel() {
    viewerCollapsed = localStorage.getItem(VIEWER_COLLAPSED_KEY) === '1';

    const panel = document.createElement('div');
    panel.className = 'analysis-viewer-panel';

    const header = document.createElement('div');
    header.className = 'analysis-viewer-header';

    const titleBox = document.createElement('div');
    titleBox.className = 'analysis-viewer-title-box';
    viewerTitleEl = document.createElement('h2');
    viewerTitleEl.textContent = 'List';
    viewerCountEl = document.createElement('span');
    viewerCountEl.className = 'analysis-viewer-count';
    titleBox.appendChild(viewerTitleEl);
    titleBox.appendChild(viewerCountEl);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'analysis-viewer-toggle';

    header.appendChild(titleBox);
    header.appendChild(toggleBtn);
    panel.appendChild(header);

    viewerBodyEl = document.createElement('div');
    viewerBodyEl.className = 'analysis-viewer-body';

    // Search box (persistent — re-filters rows on input without being rebuilt,
    // so the caret/focus survives typing and the auto-refresh).
    viewerSearchRowEl = document.createElement('div');
    viewerSearchRowEl.className = 'analysis-viewer-search-row';
    viewerSearchEl = document.createElement('input');
    viewerSearchEl.type = 'text';
    viewerSearchEl.placeholder = 'Search…';
    viewerSearchEl.className = 'analysis-viewer-search';
    viewerSearchEl.addEventListener('input', () => {
        viewerSearch = viewerSearchEl.value.trim().toLowerCase();
        renderViewerRows();
    });
    viewerSearchRowEl.appendChild(viewerSearchEl);
    viewerBodyEl.appendChild(viewerSearchRowEl);

    // Table re-renders here on sort/search/refresh; the search box above stays put.
    viewerTableHostEl = document.createElement('div');
    viewerTableHostEl.className = 'analysis-viewer-table-host';
    viewerBodyEl.appendChild(viewerTableHostEl);

    panel.appendChild(viewerBodyEl);

    const applyCollapsedChrome = () => {
        panel.classList.toggle('collapsed', viewerCollapsed);
        toggleBtn.textContent = viewerCollapsed ? '◀' : '▶';
        toggleBtn.title = viewerCollapsed ? 'Expand list' : 'Collapse list';
    };

    setViewerCollapsedFn = (collapsed) => {
        viewerCollapsed = collapsed;
        localStorage.setItem(VIEWER_COLLAPSED_KEY, collapsed ? '1' : '0');
        applyCollapsedChrome();
    };

    toggleBtn.addEventListener('click', () => setViewerCollapsedFn(!viewerCollapsed));

    applyCollapsedChrome();
    return panel;
}

// ---- viewer content ----
// Returns { title, columns, rows } where each row is { cells: [...] } and each
// cell is { v } (plain text) or { v, kind } (rendered as a colored status pill).
// `cells` are in the same order as `columns`, so column order is fully
// data-driven (timestamps sit last). `v` is the value used for sort + search.
function textCell(v) { return { v: v == null ? '—' : String(v) }; }
function pillCell(meta) { return { v: meta.label, kind: meta.kind }; }

function getViewerSpec() {
    if (viewerMode === 'device') {
        const items = latestDispensers.slice().sort((a, b) =>
            (a.customer_code || '').localeCompare(b.customer_code || '') || addrCompare(a.address, b.address));
        return {
            title: DEVICE_CHART_TITLE,
            columns: ['Dispenser', 'Station', 'Status', 'Connected At'],
            rows: items.map(d => ({
                cells: [
                    textCell(ensureDAddress(d.address)),
                    textCell(d.customer_code || '—'),
                    pillCell(deviceStatusMeta(d.conn_status)),
                    textCell(formatTimestamp(d.connected_at)),
                ],
            })),
        };
    }

    if (viewerMode === 'nozzle' && nozzleMode === 'dispenser') {
        const items = latestDispensers
            .filter(d => (d.nozzles || []).length > 0)
            .sort((a, b) => (a.customer_code || '').localeCompare(b.customer_code || '') || addrCompare(a.address, b.address));
        return {
            title: `${NOZZLE_CHART_TITLE} · ${nozzleFilterLabel()}`,
            columns: ['Dispenser', 'Station', 'Status', 'Last Ping'],
            rows: items.map(d => ({
                cells: [
                    textCell(ensureDAddress(d.address)),
                    textCell(d.customer_code || '—'),
                    pillCell(dispenserStatusMeta(d.nozzles)),
                    textCell(formatTimestamp(latestPing(d.nozzles))),
                ],
            })),
        };
    }

    if (viewerMode === 'price') {
        const items = [];
        latestDispensers.forEach(d => (d.nozzles || []).forEach(n => items.push({ d, n })));
        items.sort((x, y) =>
            (x.d.customer_code || '').localeCompare(y.d.customer_code || '') ||
            addrCompare(x.d.address, y.d.address) ||
            String(shortNozzleId(x.n.nozzle_id)).localeCompare(String(shortNozzleId(y.n.nozzle_id)), undefined, { numeric: true }));
        return {
            title: PRICE_CHART_TITLE,
            columns: ['Dispenser', 'Nozzle', 'Product', 'Actual', 'Filed', 'Match'],
            rows: items.map(({ d, n }) => ({
                cells: [
                    textCell(ensureDAddress(d.address)),
                    textCell(shortNozzleId(n.nozzle_id)),
                    textCell(n.product || '—'),
                    textCell(formatPrice(n.price_per_liter)),
                    textCell(formatPrice(n.actual_price)),
                    pillCell(priceMatchMeta(n)),
                ],
            })),
        };
    }

    const flat = [];
    latestDispensers.forEach(d => (d.nozzles || []).forEach(n => flat.push({ d, n })));
    flat.sort((x, y) =>
        (x.d.customer_code || '').localeCompare(y.d.customer_code || '') ||
        addrCompare(x.d.address, y.d.address) ||
        String(shortNozzleId(x.n.nozzle_id)).localeCompare(String(shortNozzleId(y.n.nozzle_id)), undefined, { numeric: true }));
    return {
        title: `${NOZZLE_CHART_TITLE} · ${nozzleFilterLabel()}`,
        columns: ['Dispenser', 'Nozzle', 'Product', 'Status', 'Last Ping'],
        rows: flat.map(({ d, n }) => ({
            cells: [
                textCell(ensureDAddress(d.address)),
                textCell(shortNozzleId(n.nozzle_id)),
                textCell(n.product || '—'),
                pillCell(nozzleStatusMeta(n.status)),
                textCell(formatTimestamp(n.last_ping_at)),
            ],
        })),
    };
}

function renderViewer() {
    if (!viewerBodyEl) return;

    if (!viewerMode) {
        viewerTitleEl.textContent = 'List';
        viewerCountEl.textContent = '';
        currentSpec = null;
        lastViewerKey = null;
        if (viewerSearchRowEl) viewerSearchRowEl.style.display = 'none';
        viewerTableHostEl.innerHTML = '';
        const ph = document.createElement('div');
        ph.className = 'analysis-viewer-placeholder';
        ph.textContent = 'Click “View List” on a chart to see its details here.';
        viewerTableHostEl.appendChild(ph);
        return;
    }

    // Reset sort + search whenever the underlying list changes (mode/filter).
    const key = `${viewerMode}|${nozzleMode}`;
    if (key !== lastViewerKey) {
        lastViewerKey = key;
        viewerSort = { col: null, dir: 1 };
        viewerSearch = '';
        if (viewerSearchEl) viewerSearchEl.value = '';
    }

    currentSpec = getViewerSpec();
    viewerTitleEl.textContent = currentSpec.title;
    if (viewerSearchRowEl) viewerSearchRowEl.style.display = currentSpec.rows.length ? 'block' : 'none';
    renderViewerRows();
}

// Apply the current search filter + sort to currentSpec and (re)draw the table.
function renderViewerRows() {
    if (!currentSpec || !viewerTableHostEl) return;

    let rows = currentSpec.rows;
    if (viewerSearch) {
        rows = rows.filter(r => r.cells.map(c => c.v).join(' ').toLowerCase().includes(viewerSearch));
    }
    if (viewerSort.col != null) {
        const ci = viewerSort.col, dir = viewerSort.dir;
        rows = rows.slice().sort((a, b) =>
            String(a.cells[ci].v).localeCompare(String(b.cells[ci].v), undefined,
                { numeric: true, sensitivity: 'base' }) * dir);
    }

    const total = currentSpec.rows.length;
    viewerCountEl.textContent = viewerSearch
        ? `${formatCount(rows.length)} of ${formatCount(total)}`
        : `${formatCount(total)} ${total === 1 ? 'row' : 'rows'}`;

    viewerTableHostEl.innerHTML = '';
    if (rows.length === 0) {
        viewerTableHostEl.appendChild(createNoDataMessage(viewerSearch ? 'No matches' : 'No matching records'));
        return;
    }
    viewerTableHostEl.appendChild(buildSortableTable(currentSpec.columns, rows));
}

// A table whose headers sort on click (1st click asc, 2nd desc, …) and whose
// header row stays pinned while the panel scrolls.
function buildSortableTable(columns, rows) {
    const container = document.createElement('div');
    container.className = 'app-table-container';
    container.style.background = 'var(--bg-surface)';
    container.style.borderRadius = '5px';
    container.style.boxShadow = 'var(--shadow-card)';
    container.style.overflow = 'hidden';

    const table = document.createElement('table');
    table.className = 'app-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '14px';
    table.style.color = 'var(--text-primary)';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    columns.forEach((label, ci) => {
        const th = document.createElement('th');
        const active = viewerSort.col === ci;
        Object.assign(th.style, {
            padding: '10px 12px',
            textAlign: 'left',
            borderBottom: '1px solid var(--border)',
            fontWeight: '600',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            position: 'sticky',
            top: '0',
            zIndex: '1',
            background: 'var(--bg-table-head)',
        });
        th.className = 'analysis-sortable-th';
        th.textContent = label + (active ? (viewerSort.dir === 1 ? '  ▲' : '  ▼') : '');
        th.title = `Sort by ${label}`;
        th.addEventListener('click', () => {
            if (viewerSort.col === ci) viewerSort.dir = -viewerSort.dir;
            else { viewerSort.col = ci; viewerSort.dir = 1; }
            renderViewerRows();
        });
        hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(row => {
        const tr = document.createElement('tr');
        row.cells.forEach(cell => {
            const td = document.createElement('td');
            td.style.padding = '10px 12px';
            td.style.borderBottom = '1px solid var(--border-soft)';
            td.style.whiteSpace = 'nowrap';
            if (cell.kind) td.appendChild(statusPill(cell.v, cell.kind));
            else td.textContent = cell.v;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
    return container;
}

async function renderAnalysis() {
    const content = document.getElementById('content');
    if (!content) {
        console.error('Content element not found');
        return;
    }

    if (analysisRefreshTimer) {
        clearInterval(analysisRefreshTimer);
        analysisRefreshTimer = null;
    }

    content.innerHTML = '';
    const loader = createPageLoader('Loading analytics…');
    content.appendChild(loader);

    const stage = document.createElement('div');
    stage.style.display = 'none';
    content.appendChild(stage);

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'flex-end';
    topRow.style.marginBottom = '8px';
    const lastUpdatedEl = document.createElement('div');
    lastUpdatedEl.id = 'page-last-updated';
    lastUpdatedEl.style.fontSize = '12px';
    lastUpdatedEl.style.color = 'var(--text-secondary)';
    topRow.appendChild(lastUpdatedEl);
    stage.appendChild(topRow);

    const layout = document.createElement('div');
    layout.className = 'analysis-layout';
    stage.appendChild(layout);

    const chartsCol = document.createElement('div');
    chartsCol.className = 'analysis-charts';
    layout.appendChild(chartsCol);
    chartsColEl = chartsCol;

    // In-flow collapsible list panel: sits beside the charts and wraps to a
    // full-width row below them when the viewport is too narrow for both.
    layout.appendChild(createViewerPanel());
    renderViewer(); // show placeholder until a "View List" is clicked

    const paint = (dispensers) => {
        latestDispensers = dispensers;
        chartsCol.innerHTML = '';
        chartsCol.appendChild(buildDeviceCard(dispensers));
        nozzleCardEl = buildNozzleCard(dispensers);
        chartsCol.appendChild(nozzleCardEl);
        priceCardEl = buildPriceCard(dispensers);
        chartsCol.appendChild(priceCardEl);
        syncActiveStates();
        renderViewer();
        lastUpdatedEl.textContent = `Last Updated: ${new Date().toLocaleString()}`;
    };

    try {
        const response = await fetch(`${API_BASE_URL}/dispensers-full`);
        if (!response.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await response.json();

        if (dispensers.length === 0) {
            const message = createNoDataMessage('No dispensers configured');
            message.style.padding = '40px';
            chartsCol.appendChild(message);
        } else {
            paint(dispensers);
        }

        loader.remove();
        stage.style.display = '';

        if (dispensers.length > 0) {
            analysisRefreshTimer = setInterval(async () => {
                try {
                    const r = await fetch(`${API_BASE_URL}/dispensers-full`);
                    if (!r.ok) throw new Error('Failed to fetch dispensers');
                    paint(await r.json());
                } catch (error) {
                    console.error('Error during analytics refresh:', error);
                }
            }, ANALYSIS_REFRESH_MS);
        }
    } catch (error) {
        console.error('Error rendering analytics:', error);
        content.innerHTML = `<div class="error">Error loading analytics: ${error.message}</div>`;
    }
}

window.renderAnalysis = renderAnalysis;
