// `visited_no_install` is a placeholder status for sites the team has visited
// but where DUCs couldn't be installed. The backend will tag stations as such
// once the data source is wired up (CSV column / DB flag pending) — until then,
// the chip + map marker color are plumbed and will simply show 0 counts.
const STATUS_KEYS = ['all_online', 'partial', 'all_offline', 'visited_no_install', 'no_duc'];
const STATUS_LABELS = {
    all_online:         'Online',
    partial:            'Partially Online',
    all_offline:        'Offline',
    visited_no_install: 'Visited - Not Installed',
    no_duc:             'Not Installed'
};
const STATUS_CHIP_CLASS = {
    all_online:         'status-online',
    partial:            'status-partial',
    all_offline:        'status-offline',
    visited_no_install: 'status-visited',
    no_duc:             'status-no-duc'
};
const STATUS_BAR_CLASS = {
    all_online:         'online',
    partial:            'partial',
    all_offline:        'offline',
    visited_no_install: 'visited',
    no_duc:             'no-duc'
};
const FALLBACK_PRODUCT_COLORS = ['#26a69a', '#7e57c2', '#ec407a', '#5c6bc0', '#9ccc65', '#ffa726'];

const MAP_MARKER_COLORS = {
    all_online:         '#00e676',
    partial:             '#ffab00',
    all_offline:         '#ff1744',
    visited_no_install:  '#7e57c2',
    no_duc:              '#90a4ae'
};

function statusColor(key) {
    const css = getComputedStyle(document.documentElement);
    const map = {
        all_online:         '--status-online',
        partial:            '--status-partial',
        all_offline:        '--status-offline',
        visited_no_install: '--status-visited',
        no_duc:             '--status-no-duc'
    };
    return css.getPropertyValue(map[key] || '--status-no-duc').trim() || '#9e9e9e';
}

function markerColor(key) {
    return MAP_MARKER_COLORS[key] || MAP_MARKER_COLORS.no_duc;
}

const ALERTS_MAX = 100;

const SALES_RANGES = [
    { key: '6h',    label: '6h' },
    { key: 'day',   label: 'Daily' },
    { key: 'week',  label: 'Weekly' },
    { key: 'month', label: 'Monthly' }
];

const dashboardState = {
    stations: [],
    stats: null,
    divisions: [],
    selectedDivision: 'ALL',
    selectedStatuses: new Set(STATUS_KEYS),
    searchQuery: '',
    map: null,
    markerLayer: null,
    kpiStrip: null,
    statusChips: null,
    filterBarEl: null,
    salesPanelEl: null,
    salesRange: 'day',
    salesSeries: null,
    donutPanelEl: null,
    lastUpdatedEl: null,
    refreshTimer: null,
    alerts: [],
    alertsCollapsed: false,
    alertsListEl: null,
    alertsPanelEl: null,
    alertListenerAttached: false
};

function getRegionScopedStations() {
    const div = dashboardState.selectedDivision;
    return dashboardState.stations.filter(s =>
        div === 'ALL' || (s.division || '').toLowerCase() === div.toLowerCase()
    );
}

function refreshTiles() {
    const scoped = getRegionScopedStations();
    if (dashboardState.kpiStrip && dashboardState.stats) {
        populateKpiStrip(dashboardState.kpiStrip, scoped, dashboardState.stats.today);
    }
    refreshStatusChipCounts();
}

function refreshStatusChipCounts() {
    if (!dashboardState.statusChips) return;
    const scoped = getRegionScopedStations();
    const counts = { all_online: 0, partial: 0, all_offline: 0, visited_no_install: 0, no_duc: 0 };
    for (const s of scoped) counts[s.status] = (counts[s.status] || 0) + 1;
    dashboardState.statusChips.forEach((chip, key) => {
        const c = chip.querySelector('.chip-count');
        if (c) c.textContent = counts[key] || 0;
    });
}

function formatCurrency(value) {
    const num = Number(value) || 0;
    if (num >= 1_000_000) return 'Rs. ' + (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return 'Rs. ' + (num / 1_000).toFixed(1) + 'k';
    return 'Rs. ' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function formatCurrencyFull(value) {
    return 'Rs ' + (Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function formatVolume(value) {
    const num = Number(value) || 0;
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M L';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k L';
    return num.toFixed(0) + ' L';
}
function formatCount(value) {
    return (Number(value) || 0).toLocaleString();
}

function buildKpiStrip(stations, today) {
    const strip = document.createElement('div');
    strip.className = 'kpi-strip';
    populateKpiStrip(strip, stations, today);
    return strip;
}

function populateKpiStrip(strip, stations, today) {
    const counts = { total: stations.length, with_duc: 0 };
    let totalDucs = 0;
    let onlineDucs = 0;
    let notInstalled = 0;
    for (const s of stations) {
        if (s.duc_count > 0) counts.with_duc += 1;
        else notInstalled += 1;
        totalDucs += s.duc_count;
        onlineDucs += s.online_count;
    }
    const offlineDucs = totalDucs - onlineDucs;
    const onlinePct = totalDucs > 0 ? Math.round((onlineDucs / totalDucs) * 100) : 0;
    const txCount = Number(today.tx_count) || 0;
    const totalAmount = Number(today.total_amount) || 0;
    const totalVolume = Number(today.total_volume) || 0;

    const kpis = [
        { label: 'Sites with DUC', value: formatCount(counts.with_duc),  sub: `of ${formatCount(counts.total)} total`,      cls: 'accent' },
        { label: 'DUCs Connected',    value: formatCount(onlineDucs),       sub: `${onlinePct}% of ${formatCount(totalDucs)}`, cls: 'online' },
        { label: 'DUCs Disconnected',   value: formatCount(offlineDucs),      sub: '',                                            cls: offlineDucs > 0 ? 'offline' : '',
          onClick: offlineDucs > 0 ? showOfflineDucsPopup : null },
        { label: 'Total DUCs',     value: formatCount(totalDucs),        sub: `across ${formatCount(counts.with_duc)} sites`, cls: 'accent' },
        { label: 'Tx Today',       value: formatCount(txCount),          sub: '',                                            cls: 'accent' },
        { label: 'Sales Today',    value: formatCurrency(totalAmount),   sub: '',                                            cls: 'online' },
        { label: 'Volume Today',   value: formatVolume(totalVolume),     sub: '',                                            cls: '' }
    ];

    strip.innerHTML = '';
    kpis.forEach(k => {
        const cell = document.createElement('div');
        cell.className = `kpi ${k.cls || ''}`.trim();
        cell.innerHTML = `
            <div class="kpi-label">${k.label}</div>
            <div class="kpi-value">${k.value}</div>
            ${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}
        `;
        if (k.onClick) {
            cell.style.cursor = 'pointer';
            cell.title = 'Click to view list';
            cell.addEventListener('click', k.onClick);
        }
        strip.appendChild(cell);
    });
}

async function showOfflineDucsPopup() {
    let dispensers = [];
    try {
        const resp = await fetch(`${API_BASE_URL}/dispensers`);
        if (resp.ok) dispensers = await resp.json();
        else console.warn(`Failed to load dispensers: HTTP ${resp.status}`);
    } catch (err) {
        console.warn('Failed to load dispensers:', err.message);
    }

    // Use the scoped station set so the division filter narrows the list too.
    // We also drop any dispenser whose customer_code isn't in scope.
    const byCode = new Map(getRegionScopedStations().map(s => [s.customer_code, s]));

    const rows = dispensers
        .filter(d => Number(d.conn_status) === 0 && byCode.has(d.customer_code))
        .map(d => {
            const s = byCode.get(d.customer_code) || {};
            return {
                address: ensureDAddress(d.address),
                customer_code: d.customer_code,
                station_name: s.station_name || s.station_id || '',
                city: s.city || '',
                division: s.division || '',
                connected_at: d.connected_at
            };
        })
        .sort((a, b) =>
            String(a.division).localeCompare(String(b.division)) ||
            String(a.station_name).localeCompare(String(b.station_name)) ||
            String(a.address).localeCompare(String(b.address))
        );

    buildOfflineDucsPopup(rows);
}

function buildOfflineDucsPopup(rows) {
    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '760px';
    popup.style.maxWidth = '92vw';
    popup.style.maxHeight = '80vh';
    popup.style.display = 'flex';
    popup.style.flexDirection = 'column';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '12px';

    const title = document.createElement('h3');
    title.style.margin = '0';
    title.textContent = `Offline DUCs (${rows.length})`;

    header.appendChild(title);
    header.appendChild(createCloseButton(overlay));
    popup.appendChild(header);

    const tableWrap = document.createElement('div');
    tableWrap.style.overflow = 'auto';
    tableWrap.style.flex = '1 1 auto';

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '13px';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['Address', 'Station', 'Customer Code', 'City', 'Division', 'Last Event'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        th.style.textAlign = 'left';
        th.style.padding = '8px';
        th.style.background = 'var(--bg-table-head)';
        th.style.position = 'sticky';
        th.style.top = '0';
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.textContent = 'No offline DUCs in this scope.';
        td.style.padding = '16px';
        td.style.textAlign = 'center';
        td.style.color = 'var(--text-secondary)';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        rows.forEach(r => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-soft)';
            const cells = [
                r.address,
                r.station_name || '-',
                r.customer_code,
                r.city || '-',
                r.division || '-',
                r.connected_at ? new Date(r.connected_at).toLocaleString() : '-'
            ];
            cells.forEach(val => {
                const td = document.createElement('td');
                td.style.padding = '8px';
                td.textContent = val;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    popup.appendChild(tableWrap);

    dragPopup(overlay, popup);
}

// Pick axis tick labels so we end up with ~5 evenly-spaced markers
// regardless of how many series points the current range carries.
function pickAxisLabels(points) {
    if (!points.length) return [];
    const targets = Math.min(5, points.length);
    if (points.length <= targets) return points.map(p => p.label);
    const out = [];
    for (let i = 0; i < targets; i++) {
        const idx = Math.round(i * (points.length - 1) / (targets - 1));
        out.push(points[idx].label);
    }
    return out;
}

function renderSalesChartBody(panel, points, peak, range) {
    // Remove any prior chart body so range-switches don't accumulate elements.
    panel.querySelectorAll('.chart-container, .chart-axis-row, .chart-empty').forEach(el => el.remove());
    const peakEl = panel.querySelector('.chart-card-header .peak');
    if (peakEl) peakEl.textContent = `peak ${formatCurrency(peak)}`;

    if (!points.length) {
        const empty = document.createElement('div');
        empty.className = 'chart-empty';
        empty.textContent = 'No sales data for this range.';
        panel.appendChild(empty);
        return;
    }

    const container = document.createElement('div');
    container.className = 'chart-container chart-container-line';

    const svgNS = 'http://www.w3.org/2000/svg';
    const n = points.length;
    const safePeak = peak > 0 ? peak : 1;

    const plotted = points.map((p, i) => {
        const amount = Number(p.amount) || 0;
        const x = n > 1 ? (i / (n - 1)) * 100 : 50;
        // Reserve 6% top padding so the peak point doesn't kiss the top edge.
        const y = 100 - (amount / safePeak) * 94;
        return { x, y, amount, txCount: Number(p.tx_count) || 0, label: p.label };
    });

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'chart-line-svg');

    const areaD =
        `M ${plotted[0].x} 100 ` +
        plotted.map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ') +
        ` L ${plotted[plotted.length - 1].x} 100 Z`;
    const area = document.createElementNS(svgNS, 'path');
    area.setAttribute('d', areaD);
    area.setAttribute('class', 'chart-line-area');
    svg.appendChild(area);

    const lineD = plotted.map((p, i) =>
        (i === 0 ? 'M' : 'L') + ` ${p.x.toFixed(3)} ${p.y.toFixed(3)}`
    ).join(' ');
    const line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', lineD);
    line.setAttribute('class', 'chart-line-path');
    line.setAttribute('fill', 'none');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);
    container.appendChild(svg);

    // Shared "pin" state — tapping a point keeps its tooltip up until the
    // user taps the same point again (toggle off) or another point (switch).
    // Hover behavior is unchanged when nothing is pinned, so desktop users
    // still get the original mouse-driven tooltips.
    const pin = { idx: -1, hide: null };

    const hitWidthPct = 100 / Math.max(n, 1);
    plotted.forEach((p, idx) => {
        const isLast = idx === plotted.length - 1;
        const hit = document.createElement('div');
        hit.className = 'chart-line-hit'
            + (p.amount > 0 ? ' has-data' : '')
            + (isLast ? ' is-current' : '');
        hit.style.left = (p.x - hitWidthPct / 2).toFixed(3) + '%';
        hit.style.width = hitWidthPct.toFixed(3) + '%';

        const dot = document.createElement('div');
        dot.className = 'chart-line-dot';
        dot.style.bottom = `calc(${(100 - p.y).toFixed(3)}% - 5px)`;
        hit.appendChild(dot);

        let tip = null;
        const showTip = () => {
            if (tip) return;
            tip = document.createElement('div');
            tip.className = 'chart-tooltip';
            tip.innerHTML = `<b>${p.label}</b><br>${p.txCount} tx · ${formatCurrencyFull(p.amount)}`;
            tip.style.bottom = `calc(${(100 - p.y).toFixed(3)}% + 10px)`;
            hit.appendChild(tip);
        };
        const hideTip = () => { if (tip) { tip.remove(); tip = null; } };
        hit.addEventListener('mouseenter', () => {
            if (pin.idx !== -1 && pin.idx !== idx) {
                pin.hide();
                pin.idx = -1;
            }
            showTip();
        });
        hit.addEventListener('mouseleave', () => {
            if (pin.idx !== idx) hideTip();
        });
        hit.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pin.idx === idx) {
                pin.idx = -1;
                hideTip();
                return;
            }
            if (pin.idx !== -1) pin.hide();
            pin.idx = idx;
            pin.hide = hideTip;
            showTip();
        });
        container.appendChild(hit);
    });

    // Tap on empty chart area releases the pinned tooltip.
    container.addEventListener('click', () => {
        if (pin.idx !== -1) {
            pin.hide();
            pin.idx = -1;
        }
    });

    panel.appendChild(container);

    const axis = document.createElement('div');
    axis.className = 'chart-axis-row';
    axis.innerHTML = pickAxisLabels(points).map(l => `<span>${escapeHtml(l)}</span>`).join('');
    panel.appendChild(axis);
}

async function fetchSalesSeries(range) {
    try {
        const resp = await fetch(`${API_BASE_URL}/sales-series?range=${encodeURIComponent(range)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (err) {
        console.warn('Failed to load sales series:', err.message);
        return { range, points: [], peak: 0, total: 0 };
    }
}

function buildSalesChartPanel() {
    const panel = document.createElement('div');
    panel.className = 'side-panel chart-card-mini sales-chart-panel';

    const header = document.createElement('div');
    header.className = 'chart-card-header';
    header.innerHTML = `<span>Sales</span><span class="peak"></span>`;
    panel.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'chart-range-tabs';
    SALES_RANGES.forEach(r => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chart-range-tab';
        btn.dataset.range = r.key;
        btn.textContent = r.label;
        if (r.key === dashboardState.salesRange) btn.classList.add('active');
        btn.addEventListener('click', async () => {
            if (btn.classList.contains('active')) return;
            dashboardState.salesRange = r.key;
            tabs.querySelectorAll('.chart-range-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const data = await fetchSalesSeries(r.key);
            dashboardState.salesSeries = data;
            renderSalesChartBody(panel, data.points || [], data.peak || 0, r.key);
        });
        tabs.appendChild(btn);
    });
    panel.appendChild(tabs);

    // Show whatever we already have cached immediately, then refresh.
    const cached = dashboardState.salesSeries;
    if (cached && cached.range === dashboardState.salesRange) {
        renderSalesChartBody(panel, cached.points || [], cached.peak || 0, cached.range);
    }
    fetchSalesSeries(dashboardState.salesRange).then(data => {
        dashboardState.salesSeries = data;
        renderSalesChartBody(panel, data.points || [], data.peak || 0, data.range);
    });

    return panel;
}

function buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'map-legend';
    STATUS_KEYS.forEach(key => {
        const item = document.createElement('span');
        const dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.style.background = markerColor(key);
        item.appendChild(dot);
        item.appendChild(document.createTextNode(STATUS_LABELS[key]));
        legend.appendChild(item);
    });
    return legend;
}

function makeMarkerIcon(status) {
    const color = markerColor(status);
    const isOffline = status === 'all_offline';
    // Offline stations get a soft breathing halo behind the dot so they're
    // easy to spot on a busy map. Other statuses render the same dot,
    // unanimated, so the pulse always reads as "site is down".
    const html = isOffline
        ? `<div class="marker-dot-wrap" style="--dot-color: ${color}">
               <span class="marker-pulse"></span>
               <span class="marker-dot"></span>
           </div>`
        : `<div class="marker-dot" style="--dot-color: ${color}"></div>`;
    return L.divIcon({
        html,
        className: 'station-marker',
        iconSize: [12, 12],
        iconAnchor: [6, 6],
        popupAnchor: [0, -8]
    });
}

function buildPopupHtml(station) {
    const link = station.duc_count > 0
        ? `<a class="popup-link" href="dispensers.html?customer_code=${encodeURIComponent(station.customer_code)}">View Dispensers</a>`
        : `<span class="popup-link disabled">No DUCs Installed</span>`;
    return `
        <div class="station-popup">
            <div class="popup-title">${station.station_name || station.customer_code}</div>
            <div class="popup-row"><b>Customer Code:</b> ${station.customer_code}</div>
            <div class="popup-row"><b>City:</b> ${station.city || '-'}</div>
            ${station.district ? `<div class="popup-row"><b>District:</b> ${station.district}</div>` : ''}
            ${station.division ? `<div class="popup-row"><b>Division:</b> ${station.division}</div>` : ''}
            <div class="popup-row"><b>Status:</b> ${STATUS_LABELS[station.status]}</div>
            <div class="popup-row"><b>DUCs:</b> ${station.online_count} online / ${station.duc_count} installed (sheet: ${station.total_dus})</div>
            ${link}
        </div>
    `;
}

function getFilteredStations() {
    const q = (dashboardState.searchQuery || '').trim().toLowerCase();
    return getRegionScopedStations().filter(s => {
        if (!dashboardState.selectedStatuses.has(s.status)) return false;
        if (q) {
            const code = (s.customer_code || '').toLowerCase();
            const name = (s.station_name || '').toLowerCase();
            if (!code.includes(q) && !name.includes(q)) return false;
        }
        return true;
    });
}

function refreshMarkers(options = {}) {
    if (!dashboardState.map || !dashboardState.markerLayer) return;
    dashboardState.markerLayer.clearLayers();

    const filtered = getFilteredStations();
    const bounds = [];
    // Stack markers so the most attention-worthy status sits on top:
    //   offline (pulsing) > installed > not-installed.
    const Z_BY_STATUS = {
        all_offline:        2000,
        partial:            1500,
        all_online:         1000,
        visited_no_install: 500,
        no_duc:             0
    };
    filtered.forEach(s => {
        const marker = L.marker([s.lat, s.lng], {
            icon: makeMarkerIcon(s.status),
            zIndexOffset: Z_BY_STATUS[s.status] ?? 0
        });
        marker.bindPopup(buildPopupHtml(s));
        marker.addTo(dashboardState.markerLayer);
        bounds.push([s.lat, s.lng]);
    });
    if (options.fit !== false && bounds.length > 0) {
        dashboardState.map.fitBounds(bounds, { padding: [12, 12], maxZoom: 16 });
    }
}

function buildSearchControl() {
    const dd = createSearchableDropdown({
        placeholder: 'Search site...',
        items: () => (dashboardState.stations || []).map(s => ({
            value: s.customer_code || '',
            label: s.customer_code || '',
            secondary: s.station_name || '',
            // Carry the full record so onSelect can zoom the map / open the popup.
            station: s
        })),
        initialQuery: dashboardState.searchQuery || '',
        emptyText: 'No stations match',
        onInput: (q) => {
            dashboardState.searchQuery = q;
            refreshMarkers({ fit: false });
        },
        onSelect: (value, item) => {
            const s = item.station;
            dashboardState.searchQuery = s.customer_code;
            refreshMarkers({ fit: false });
            if (dashboardState.map && s.lat != null && s.lng != null) {
                dashboardState.map.setView([s.lat, s.lng], 14);
                if (dashboardState.markerLayer) {
                    dashboardState.markerLayer.eachLayer(m => {
                        const ll = m.getLatLng();
                        if (Math.abs(ll.lat - s.lat) < 1e-6 && Math.abs(ll.lng - s.lng) < 1e-6) {
                            m.openPopup();
                        }
                    });
                }
            }
        }
    });
    // Pill-shape the input to match the filter chip buttons in the dashboard's filter bar.
    dd.input.style.borderRadius = '16px';
    dd.input.style.height = '32px';
    return dd.wrap;
}

function buildFilterBar() {
    const bar = document.createElement('div');
    bar.className = 'filter-bar';

    const divisions = Array.from(new Set(
        dashboardState.stations.map(s => (s.division || '').trim()).filter(Boolean)
    )).sort();
    dashboardState.divisions = divisions;

    const divisionRow = document.createElement('div');
    divisionRow.className = 'filter-row';
    const divisionLabel = document.createElement('span');
    divisionLabel.className = 'filter-label';
    divisionLabel.textContent = 'Division';
    divisionRow.appendChild(divisionLabel);

    const divisionChips = [{ key: 'ALL', label: 'All' }, ...divisions.map(d => ({ key: d, label: d }))];
    divisionChips.forEach(({ key, label }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'filter-chip';
        if (dashboardState.selectedDivision === key) chip.classList.add('active');

        const count = key === 'ALL'
            ? dashboardState.stations.length
            : dashboardState.stations.filter(s => (s.division || '').toLowerCase() === key.toLowerCase()).length;

        chip.innerHTML = `${label}<span class="chip-count">${count}</span>`;
        chip.addEventListener('click', () => {
            dashboardState.selectedDivision = key;
            divisionRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            refreshMarkers();
            refreshTiles();
        });
        divisionRow.appendChild(chip);
    });
    // Search lives at the right edge of the division row.
    divisionRow.appendChild(buildSearchControl());
    bar.appendChild(divisionRow);

    const statusRow = document.createElement('div');
    statusRow.className = 'filter-row';
    const statusLabel = document.createElement('span');
    statusLabel.className = 'filter-label';
    statusLabel.textContent = 'Status';
    statusRow.appendChild(statusLabel);

    const statusChipMap = new Map();
    STATUS_KEYS.forEach(key => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `filter-chip ${STATUS_CHIP_CLASS[key]}`;
        if (dashboardState.selectedStatuses.has(key)) chip.classList.add('active');

        chip.innerHTML = `${STATUS_LABELS[key]}<span class="chip-count">0</span>`;
        chip.addEventListener('click', () => {
            if (dashboardState.selectedStatuses.has(key)) {
                if (dashboardState.selectedStatuses.size > 1) {
                    dashboardState.selectedStatuses.delete(key);
                    chip.classList.remove('active');
                }
            } else {
                dashboardState.selectedStatuses.add(key);
                chip.classList.add('active');
            }
            refreshMarkers();
        });
        statusRow.appendChild(chip);
        statusChipMap.set(key, chip);
    });
    dashboardState.statusChips = statusChipMap;
    bar.appendChild(statusRow);

    refreshStatusChipCounts();

    return bar;
}


function productColor(name, fallbackIdx) {
    const cfg = (typeof productColorConfig !== 'undefined') ? productColorConfig[name?.toUpperCase?.()] : null;
    return cfg?.header || FALLBACK_PRODUCT_COLORS[fallbackIdx % FALLBACK_PRODUCT_COLORS.length];
}

function buildProductDonutPanel(products) {
    const panel = document.createElement('div');
    panel.className = 'side-panel donut-panel';
    panel.innerHTML = `<h4>Sales by Product Today</h4>`;
    renderDonutBody(panel, products);
    return panel;
}

function renderDonutBody(panel, products) {
    // Refresh-friendly: drop any prior body but keep the header. Calling this
    // on the existing panel avoids the flash that replaceWith() causes when
    // the auto-refresh fires every 30 seconds.
    panel.querySelectorAll('.donut-wrapper, .donut-empty').forEach(el => el.remove());

    const total = products.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    if (total <= 0) {
        const empty = document.createElement('div');
        empty.className = 'donut-empty';
        empty.textContent = 'No sales recorded yet today.';
        panel.appendChild(empty);
        return;
    }

    const sorted = [...products].sort((a, b) => (b.amount || 0) - (a.amount || 0));

    const wrap = document.createElement('div');
    wrap.className = 'donut-wrapper';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 42 42');
    svg.setAttribute('class', 'donut-svg');

    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip donut-tooltip';
    tooltip.style.display = 'none';

    // Track which slice (if any) the user pinned via click/tap. Hover only
    // moves the tooltip when nothing is pinned, so touch users can read a
    // value without it vanishing the moment their finger lifts.
    let pinnedIdx = -1;
    const showFor = (idx, label, amount, pct) => {
        tooltip.innerHTML =
            `<b>${escapeHtml(label)}</b><br>` +
            `${formatCurrencyFull(amount)}<br>` +
            `${pct.toFixed(1)}%`;
        tooltip.style.display = 'block';
    };
    const positionAt = (clientX, clientY) => {
        const rect = wrap.getBoundingClientRect();
        tooltip.style.left = (clientX - rect.left + 12) + 'px';
        tooltip.style.top  = (clientY - rect.top  - 12) + 'px';
    };

    let cumulative = 0;
    sorted.forEach((p, idx) => {
        const pct = (Number(p.amount) || 0) / total * 100;
        const color = productColor(p.product, idx);
        const amount = Number(p.amount) || 0;
        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('cx', '21');
        circle.setAttribute('cy', '21');
        circle.setAttribute('r', '15.9155');
        circle.setAttribute('fill', 'transparent');
        circle.setAttribute('stroke', color);
        circle.setAttribute('stroke-width', '6');
        circle.setAttribute('stroke-dasharray', `${pct.toFixed(3)} ${(100 - pct).toFixed(3)}`);
        circle.setAttribute('stroke-dashoffset', (-cumulative).toFixed(3));
        circle.setAttribute('transform', 'rotate(-90 21 21)');
        circle.style.pointerEvents = 'stroke';
        circle.style.cursor = 'pointer';
        const label = (p.product || '').toUpperCase();
        circle.addEventListener('mouseenter', () => {
            if (pinnedIdx !== -1) return;
            showFor(idx, label, amount, pct);
        });
        circle.addEventListener('mousemove', (e) => {
            if (pinnedIdx !== -1) return;
            positionAt(e.clientX, e.clientY);
        });
        circle.addEventListener('mouseleave', () => {
            if (pinnedIdx !== -1) return;
            tooltip.style.display = 'none';
        });
        circle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pinnedIdx === idx) {
                pinnedIdx = -1;
                tooltip.style.display = 'none';
                return;
            }
            pinnedIdx = idx;
            showFor(idx, label, amount, pct);
            positionAt(e.clientX, e.clientY);
        });
        svg.appendChild(circle);
        cumulative += pct;
    });

    // Tapping outside the slices (on the wrap background or legend) unpins.
    wrap.addEventListener('click', () => {
        if (pinnedIdx !== -1) {
            pinnedIdx = -1;
            tooltip.style.display = 'none';
        }
    });

    const center = document.createElementNS(svgNS, 'text');
    center.setAttribute('x', '21');
    center.setAttribute('y', '20');
    center.setAttribute('class', 'donut-center');
    const amt = document.createElementNS(svgNS, 'tspan');
    amt.setAttribute('x', '21');
    amt.setAttribute('class', 'donut-amount');
    amt.textContent = formatCurrency(total);
    const lbl = document.createElementNS(svgNS, 'tspan');
    lbl.setAttribute('x', '21');
    lbl.setAttribute('dy', '4.5');
    lbl.setAttribute('class', 'donut-label');
    lbl.textContent = 'Total';
    center.appendChild(amt);
    center.appendChild(lbl);
    svg.appendChild(center);

    wrap.appendChild(svg);
    wrap.appendChild(tooltip);

    const legend = document.createElement('div');
    legend.className = 'donut-legend';
    sorted.forEach((p, idx) => {
        const amount = Number(p.amount) || 0;
        const volume = Number(p.volume) || 0;
        const row = document.createElement('div');
        row.className = 'donut-legend-row';
        row.innerHTML = `
            <span class="swatch" style="background:${productColor(p.product, idx)}"></span>
            <span class="name">${(p.product || '').toUpperCase()}</span>
            <div class="legend-value">
                <span class="amt">${formatCurrency(amount)}</span>
                <span class="vol">${formatVolume(volume)}</span>
            </div>
        `;
        legend.appendChild(row);
    });
    wrap.appendChild(legend);

    panel.appendChild(wrap);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function buildAlertsPanel() {
    const panel = document.createElement('div');
    panel.className = 'side-panel alerts-panel';
    if (dashboardState.alertsCollapsed) panel.classList.add('alerts-collapsed');

    const header = document.createElement('div');
    header.className = 'alerts-header';

    const title = document.createElement('h4');
    title.textContent = 'Alerts';

    const actions = document.createElement('div');
    actions.className = 'alerts-actions';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'alerts-clear';
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
        dashboardState.alerts = [];
        renderAlertsList();
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'alerts-collapse';
    collapseBtn.type = 'button';
    collapseBtn.setAttribute('aria-label', dashboardState.alertsCollapsed ? 'Expand alerts' : 'Collapse alerts');
    collapseBtn.title = dashboardState.alertsCollapsed ? 'Expand' : 'Collapse';
    collapseBtn.innerHTML = '<span class="chev"></span>';
    collapseBtn.addEventListener('click', () => {
        dashboardState.alertsCollapsed = !dashboardState.alertsCollapsed;
        panel.classList.toggle('alerts-collapsed', dashboardState.alertsCollapsed);
        collapseBtn.setAttribute('aria-label', dashboardState.alertsCollapsed ? 'Expand alerts' : 'Collapse alerts');
        collapseBtn.title = dashboardState.alertsCollapsed ? 'Expand' : 'Collapse';
    });

    actions.appendChild(clearBtn);
    actions.appendChild(collapseBtn);
    header.appendChild(title);
    header.appendChild(actions);
    panel.appendChild(header);

    const list = document.createElement('div');
    list.className = 'alerts-list';
    panel.appendChild(list);
    dashboardState.alertsListEl = list;

    renderAlertsList();
    return panel;
}

function formatAlertTime(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour12: false });
}

function renderAlertsList() {
    const list = dashboardState.alertsListEl;
    if (!list) return;
    list.innerHTML = '';
    if (!dashboardState.alerts.length) {
        const empty = document.createElement('div');
        empty.className = 'alerts-empty';
        empty.textContent = 'No alerts yet.';
        list.appendChild(empty);
        return;
    }
    const frag = document.createDocumentFragment();
    for (const a of dashboardState.alerts) {
        const row = document.createElement('div');
        row.className = `alert-row ${a.type || 'info'}`;
        const stationId = stationIdForCustomerCode(a.customerCode);
        const metaParts = [];
        if (a.customerCode) metaParts.push(escapeHtml(a.customerCode));
        if (stationId) metaParts.push(escapeHtml(stationId));
        const metaHtml = metaParts.length
            ? `<div class="alert-row-meta">${metaParts.join('<span class="alert-meta-sep">·</span>')}</div>`
            : '';
        row.innerHTML = `
            <div class="alert-row-main">
                <span class="alert-device">${escapeHtml(a.device)}</span>
                <span class="alert-status">${escapeHtml(a.status)}</span>
                <span class="alert-when">${escapeHtml(formatAlertTime(a.ts))}</span>
            </div>
            ${metaHtml}
        `;
        frag.appendChild(row);
    }
    list.appendChild(frag);
}

// Alerts panel only surfaces long-outage (>=12h) events now. Short-lived
// connect/disconnect blips are deliberately ignored.
function formatOfflineSince(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const hours = Math.floor((Date.now() - d.getTime()) / 3600000);
    return `${hours}h offline`;
}

function alertFromLongOutageRow(r) {
    return {
        id: `outage-${r.id}`,
        ts: r.created_at || r.offline_since,
        type: 'error',
        device: ensureDAddress(r.address),
        status: formatOfflineSince(r.offline_since),
        address: r.address,
        customerCode: r.customer_code || '',
        outageId: r.id
    };
}

function alertFromNotification(payload) {
    const data = payload.data || {};
    if (data.event === 'long_outage') {
        return {
            id: `outage-${data.id || data.address}-${payload.timestamp || Date.now()}`,
            ts: payload.timestamp || data.offline_since || Date.now(),
            type: 'error',
            device: ensureDAddress(data.address || ''),
            status: formatOfflineSince(data.offline_since),
            address: data.address,
            customerCode: data.customer_code || '',
            outageId: data.id
        };
    }
    return null; // ignore everything else
}

// Human-readable station name, looked up by customer_code. The CSV-driven
// station sheet exposes it as `station_name`; the DB `stations` table uses
// `station_id`. Check both so this works regardless of source.
function stationIdForCustomerCode(code) {
    if (!code) return '';
    const s = dashboardState.stations.find(x => x.customer_code === code);
    return s ? (s.station_id || s.station_name || '') : '';
}

function addAlert(payload) {
    const alert = alertFromNotification(payload);
    if (!alert) return;
    // De-dupe: if an alert already exists for this address, replace it.
    if (alert.address) {
        dashboardState.alerts = dashboardState.alerts.filter(a => a.address !== alert.address);
    }
    dashboardState.alerts.unshift(alert);
    if (dashboardState.alerts.length > ALERTS_MAX) {
        dashboardState.alerts.length = ALERTS_MAX;
    }
    renderAlertsList();
}

function removeAlertForAddress(address) {
    if (!address) return;
    const before = dashboardState.alerts.length;
    dashboardState.alerts = dashboardState.alerts.filter(a => a.address !== address);
    if (dashboardState.alerts.length !== before) renderAlertsList();
}

function seedAlertsFromLongOutages(rows) {
    dashboardState.alerts = rows.map(alertFromLongOutageRow).slice(0, ALERTS_MAX);
    renderAlertsList();
}

async function fetchLongOutages(limit = 100) {
    try {
        const resp = await fetch(`${API_BASE_URL}/long-outages?limit=${limit}`);
        if (!resp.ok) return [];
        return await resp.json();
    } catch (err) {
        console.warn('Failed to load long-outage alerts:', err.message);
        return [];
    }
}

// Dispensers in the DB whose customer_code doesn't match any sheet station.
// Surfaced as warning alerts so the data-drift is visible on the dashboard
// (these dispensers don't contribute to the Total DUCs count).
function alertFromOrphan(orphan) {
    const n = orphan.dispenser_count;
    return {
        id: `orphan-${orphan.customer_code}`,
        ts: Date.now(),
        type: 'warning',
        device: `Cust ${orphan.customer_code}`,
        status: `${n} DUC${n === 1 ? '' : 's'} not in station sheet`,
        address: '',
        customerCode: orphan.customer_code,
        orphan: true
    };
}

async function fetchOrphanDispensers() {
    try {
        const resp = await fetch(`${API_BASE_URL}/orphan-dispensers`);
        if (!resp.ok) return [];
        return await resp.json();
    } catch (err) {
        console.warn('Failed to load orphan dispensers:', err.message);
        return [];
    }
}

function mergeOrphanAlerts(orphans) {
    // Drop any prior orphan entries, then append fresh ones at the bottom so
    // they sit beneath real outage alerts (which are typically more urgent).
    dashboardState.alerts = dashboardState.alerts.filter(a => !a.orphan);
    for (const o of orphans) {
        if (dashboardState.alerts.length >= ALERTS_MAX) break;
        dashboardState.alerts.push(alertFromOrphan(o));
    }
    renderAlertsList();
}

function attachAlertListener() {
    if (dashboardState.alertListenerAttached) return;
    window.addEventListener('app-notification', (e) => {
        const payload = e.detail || {};
        const ev = payload.data?.event;
        if (ev === 'long_outage') {
            addAlert(payload);
        } else if (ev === 'long_outage_cleared') {
            removeAlertForAddress(payload.data?.address);
        }
    });
    dashboardState.alertListenerAttached = true;
}

async function fetchDashboardStats() {
    try {
        const resp = await fetch(`${API_BASE_URL}/dashboard-stats`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } catch (error) {
        console.error('Failed to load dashboard stats:', error);
        return {
            today: { tx_count: 0, total_amount: 0, total_volume: 0 },
            hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, tx_count: 0, amount: 0, volume: 0 })),
            products: []
        };
    }
}

async function fetchStationLocations() {
    const resp = await fetch(`${API_BASE_URL}/station-locations`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
}

async function renderDashboard() {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = '';
    content.classList.add('dashboard-page');

    const loader = createPageLoader('Loading dashboard…');
    content.appendChild(loader);

    let stations = [];
    let stats = null;
    try {
        [stations, stats] = await Promise.all([fetchStationLocations(), fetchDashboardStats()]);
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        loader.remove();
        const errEl = document.createElement('div');
        errEl.textContent = `Failed to load dashboard data: ${error.message}`;
        errEl.style.padding = '24px';
        errEl.style.color = 'var(--danger)';
        content.appendChild(errEl);
        return;
    }

    loader.remove();

    dashboardState.stations = stations;
    dashboardState.stats = stats;

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'flex-end';
    topRow.style.marginBottom = '8px';
    const lastUpdatedEl = document.createElement('div');
    lastUpdatedEl.id = 'page-last-updated';
    lastUpdatedEl.style.fontSize = '12px';
    lastUpdatedEl.style.color = 'var(--text-secondary)';
    lastUpdatedEl.textContent = `Last Updated: ${new Date().toLocaleString()}`;
    dashboardState.lastUpdatedEl = lastUpdatedEl;
    topRow.appendChild(lastUpdatedEl);
    content.appendChild(topRow);

    const kpiStrip = buildKpiStrip(stations, stats.today);
    dashboardState.kpiStrip = kpiStrip;
    content.appendChild(kpiStrip);

    const main = document.createElement('div');
    main.className = 'dashboard-main';

    const mapColumn = document.createElement('div');
    mapColumn.className = 'map-column';

    const filterBarEl = buildFilterBar();
    dashboardState.filterBarEl = filterBarEl;
    mapColumn.appendChild(filterBarEl);

    const mapWrapper = document.createElement('div');
    mapWrapper.className = 'map-wrapper';
    const mapEl = document.createElement('div');
    mapEl.id = 'station-map';
    mapWrapper.appendChild(mapEl);

    mapWrapper.appendChild(buildLegend());
    mapColumn.appendChild(mapWrapper);
    main.appendChild(mapColumn);

    const side = document.createElement('div');
    side.className = 'dashboard-side';
    const salesPanelEl = buildSalesChartPanel();
    dashboardState.salesPanelEl = salesPanelEl;
    side.appendChild(salesPanelEl);
    const donutPanelEl = buildProductDonutPanel(stats.products || []);
    dashboardState.donutPanelEl = donutPanelEl;
    side.appendChild(donutPanelEl);
    const alertsPanelEl = buildAlertsPanel();
    dashboardState.alertsPanelEl = alertsPanelEl;
    side.appendChild(alertsPanelEl);
    main.appendChild(side);

    content.appendChild(main);

    attachAlertListener();
    // Seed outage alerts first, then layer the orphan-dispenser warnings on top
    // (mergeOrphanAlerts preserves existing entries).
    fetchLongOutages()
        .then(seedAlertsFromLongOutages)
        .then(() => fetchOrphanDispensers())
        .then(mergeOrphanAlerts);

    dashboardState.map = L.map('station-map', { scrollWheelZoom: true })
        .setView([30.3753, 69.3451], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(dashboardState.map);

    dashboardState.markerLayer = L.layerGroup().addTo(dashboardState.map);

    // The map container resizes with the viewport now; Leaflet only redraws
    // tiles when told its size changed.
    if (!dashboardState.resizeListener) {
        dashboardState.resizeListener = () => {
            if (dashboardState.map) dashboardState.map.invalidateSize();
        };
        window.addEventListener('resize', dashboardState.resizeListener);
    }
    requestAnimationFrame(() => dashboardState.map.invalidateSize());

    if (stations.length === 0) {
        const msg = document.createElement('div');
        msg.textContent = 'No stations found in the source sheet.';
        msg.style.padding = '12px';
        msg.style.color = 'var(--text-secondary)';
        mapWrapper.insertBefore(msg, mapEl);
    } else {
        refreshMarkers();
    }

    startDashboardAutoRefresh();
}

async function refreshDashboardData() {
    let stations, stats;
    try {
        [stations, stats] = await Promise.all([fetchStationLocations(), fetchDashboardStats()]);
    } catch (error) {
        console.warn('Dashboard auto-refresh failed:', error.message);
        return;
    }

    dashboardState.stations = stations;
    dashboardState.stats = stats;

    if (dashboardState.filterBarEl) {
        const oldInput = dashboardState.filterBarEl.querySelector('.filter-search');
        const hadFocus = oldInput && document.activeElement === oldInput;
        const caret = oldInput ? oldInput.selectionStart : null;
        const newBar = buildFilterBar();
        dashboardState.filterBarEl.replaceWith(newBar);
        dashboardState.filterBarEl = newBar;
        if (hadFocus) {
            const newInput = newBar.querySelector('.filter-search');
            if (newInput) {
                newInput.focus();
                if (caret != null) newInput.setSelectionRange(caret, caret);
            }
        }
    }

    if (dashboardState.salesPanelEl) {
        // Refresh in place: fetch first, then patch only the chart body so
        // the tabs/header never blink to an empty state between rebuilds.
        const data = await fetchSalesSeries(dashboardState.salesRange);
        dashboardState.salesSeries = data;
        renderSalesChartBody(
            dashboardState.salesPanelEl,
            data.points || [],
            data.peak || 0,
            data.range
        );
    }

    if (dashboardState.donutPanelEl) {
        // Patch body in place — no replaceWith() so the panel never blinks.
        renderDonutBody(dashboardState.donutPanelEl, stats.products || []);
    }

    refreshTiles();
    refreshMarkers({ fit: false });

    if (dashboardState.lastUpdatedEl) {
        dashboardState.lastUpdatedEl.textContent = `Last Updated: ${new Date().toLocaleString()}`;
    }
}

function startDashboardAutoRefresh() {
    if (dashboardState.refreshTimer) {
        clearInterval(dashboardState.refreshTimer);
    }
    dashboardState.refreshTimer = setInterval(() => {
        if (document.hidden) return;
        refreshDashboardData();
    }, DASHBOARD_REFRESH_MS);
}

window.addEventListener('themechange', () => {
    if (dashboardState.markerLayer) refreshMarkers({ fit: false });
});

window.renderDashboard = renderDashboard;
