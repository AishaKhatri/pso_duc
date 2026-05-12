const STATUS_KEYS = ['all_online', 'partial', 'all_offline', 'no_duc'];
const STATUS_LABELS = {
    all_online:  'Online',
    partial:     'Partially Online',
    all_offline: 'Offline',
    no_duc:      'Not Installed'
};
const STATUS_CHIP_CLASS = {
    all_online:  'status-online',
    partial:     'status-partial',
    all_offline: 'status-offline',
    no_duc:      'status-no-duc'
};
const STATUS_BAR_CLASS = {
    all_online:  'online',
    partial:     'partial',
    all_offline: 'offline',
    no_duc:      'no-duc'
};
const FALLBACK_PRODUCT_COLORS = ['#26a69a', '#7e57c2', '#ec407a', '#5c6bc0', '#9ccc65', '#ffa726'];

const MAP_MARKER_COLORS = {
    all_online:  '#00e676',
    partial:     '#ffab00',
    all_offline: '#ff1744',
    no_duc:      '#90a4ae'
};

function statusColor(key) {
    const css = getComputedStyle(document.documentElement);
    const map = {
        all_online:  '--status-online',
        partial:     '--status-partial',
        all_offline: '--status-offline',
        no_duc:      '--status-no-duc'
    };
    return css.getPropertyValue(map[key] || '--status-no-duc').trim() || '#9e9e9e';
}

function markerColor(key) {
    return MAP_MARKER_COLORS[key] || MAP_MARKER_COLORS.no_duc;
}

const ALERTS_MAX = 100;

const dashboardState = {
    stations: [],
    stats: null,
    divisions: [],
    selectedDivision: 'ALL',
    selectedCity: 'ALL',
    selectedStatuses: new Set(STATUS_KEYS),
    map: null,
    markerLayer: null,
    kpiStrip: null,
    networkBars: null,
    cityRow: null,
    statusChips: null,
    filterBarEl: null,
    hourlyPanelEl: null,
    donutPanelEl: null,
    lastUpdatedEl: null,
    refreshTimer: null,
    alerts: [],
    alertsListEl: null,
    alertsPanelEl: null,
    alertListenerAttached: false
};

function getRegionScopedStations() {
    const div = dashboardState.selectedDivision;
    const city = dashboardState.selectedCity;
    return dashboardState.stations.filter(s => {
        const divOk = div === 'ALL'
            || (s.division || '').toLowerCase() === div.toLowerCase();
        const cityOk = city === 'ALL'
            || (s.city || '').toLowerCase() === city.toLowerCase();
        return divOk && cityOk;
    });
}

function refreshTiles() {
    const scoped = getRegionScopedStations();
    if (dashboardState.kpiStrip && dashboardState.stats) {
        populateKpiStrip(dashboardState.kpiStrip, scoped, dashboardState.stats.today);
    }
    if (dashboardState.networkBars) {
        populateNetworkBreakdown(dashboardState.networkBars, scoped);
    }
    refreshStatusChipCounts();
}

function refreshStatusChipCounts() {
    if (!dashboardState.statusChips) return;
    const scoped = getRegionScopedStations();
    const counts = { all_online: 0, partial: 0, all_offline: 0, no_duc: 0 };
    for (const s of scoped) counts[s.status] = (counts[s.status] || 0) + 1;
    dashboardState.statusChips.forEach((chip, key) => {
        const c = chip.querySelector('.chip-count');
        if (c) c.textContent = counts[key] || 0;
    });
}

function citiesInDivision(div) {
    if (!div || div === 'ALL') return [];
    const target = div.toLowerCase();
    const set = new Set();
    for (const s of dashboardState.stations) {
        if ((s.division || '').toLowerCase() !== target) continue;
        const c = (s.city || '').trim();
        if (c) set.add(c);
    }
    return Array.from(set).sort();
}

function formatCurrency(value) {
    const num = Number(value) || 0;
    if (num >= 1_000_000) return 'Rs ' + (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return 'Rs ' + (num / 1_000).toFixed(1) + 'k';
    return 'Rs ' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
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
        { label: 'Sites',          value: formatCount(counts.total),    sub: `${counts.with_duc} with DUC`,                cls: 'accent' },
        { label: 'DUCs Online',    value: formatCount(onlineDucs),       sub: `${onlinePct}% of ${formatCount(totalDucs)}`, cls: 'online' },
        { label: 'DUCs Offline',   value: formatCount(offlineDucs),      sub: '',                                            cls: offlineDucs > 0 ? 'offline' : '' },
        { label: 'Not Installed',  value: formatCount(notInstalled),     sub: '',                                            cls: 'no-duc' },
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
        strip.appendChild(cell);
    });
}

function buildHourlyChartPanel(hourly) {
    const panel = document.createElement('div');
    panel.className = 'side-panel chart-card-mini';

    const peak = hourly.reduce((m, h) => Math.max(m, Number(h.amount) || 0), 0);
    const safePeak = peak > 0 ? peak : 1;

    const header = document.createElement('div');
    header.className = 'chart-card-header';
    header.innerHTML = `<span>Hourly Sales</span><span class="peak">peak ${formatCurrency(peak)}</span>`;
    panel.appendChild(header);

    const container = document.createElement('div');
    container.className = 'chart-container';
    hourly.forEach(h => {
        const amount = Number(h.amount) || 0;
        const txCount = Number(h.tx_count) || 0;
        const heightPct = (amount / safePeak) * 100;
        const bar = document.createElement('div');
        bar.className = amount > 0 ? 'chart-bar has-data' : 'chart-bar';
        bar.style.height = heightPct.toFixed(1) + '%';
        const hourLabel = String(h.hour).padStart(2, '0') + ':00';

        let tip = null;
        const showTip = () => {
            if (tip) return;
            tip = document.createElement('div');
            tip.className = 'chart-tooltip';
            tip.innerHTML = `<b>${hourLabel}</b><br>${txCount} tx · ${formatCurrencyFull(amount)}`;
            bar.appendChild(tip);
        };
        const hideTip = () => { if (tip) { tip.remove(); tip = null; } };
        bar.addEventListener('mouseenter', showTip);
        bar.addEventListener('mouseleave', hideTip);
        bar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tip) hideTip(); else showTip();
        });
        container.appendChild(bar);
    });
    panel.appendChild(container);

    const axis = document.createElement('div');
    axis.className = 'chart-axis-row';
    axis.innerHTML = '<span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>';
    panel.appendChild(axis);

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
    const html = `<div style="
        width: 12px; height: 12px;
        background: ${color};
        border-radius: 50%;
        box-shadow: 0 0 2px ${color}, 0 0 0 1px rgba(0,0,0,0.2);
    "></div>`;
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
    return getRegionScopedStations().filter(s => dashboardState.selectedStatuses.has(s.status));
}

function refreshMarkers(options = {}) {
    if (!dashboardState.map || !dashboardState.markerLayer) return;
    dashboardState.markerLayer.clearLayers();

    const filtered = getFilteredStations();
    const bounds = [];
    filtered.forEach(s => {
        const isNoDuc = s.status === 'no_duc';
        const marker = L.marker([s.lat, s.lng], {
            icon: makeMarkerIcon(s.status),
            zIndexOffset: isNoDuc ? 0 : 1000
        });
        marker.bindPopup(buildPopupHtml(s));
        marker.addTo(dashboardState.markerLayer);
        bounds.push([s.lat, s.lng]);
    });
    if (options.fit !== false && bounds.length > 0) {
        dashboardState.map.fitBounds(bounds, { padding: [12, 12], maxZoom: 16 });
    }
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
            dashboardState.selectedCity = 'ALL';
            divisionRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderCityRow();
            refreshMarkers();
            refreshTiles();
        });
        divisionRow.appendChild(chip);
    });
    bar.appendChild(divisionRow);

    const cityRow = document.createElement('div');
    cityRow.className = 'filter-row filter-row-city';
    dashboardState.cityRow = cityRow;
    bar.appendChild(cityRow);
    renderCityRow();

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

function renderCityRow() {
    const row = dashboardState.cityRow;
    if (!row) return;
    row.innerHTML = '';

    const cities = citiesInDivision(dashboardState.selectedDivision);
    if (cities.length === 0) {
        row.style.display = 'none';
        return;
    }
    row.style.display = '';

    const lbl = document.createElement('span');
    lbl.className = 'filter-label';
    lbl.textContent = 'City';
    row.appendChild(lbl);

    const divKey = dashboardState.selectedDivision;
    const inDiv = dashboardState.stations.filter(
        s => (s.division || '').toLowerCase() === divKey.toLowerCase()
    );
    const chips = [{ key: 'ALL', label: 'All' }, ...cities.map(c => ({ key: c, label: c }))];
    chips.forEach(({ key, label }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'filter-chip';
        if (dashboardState.selectedCity === key) chip.classList.add('active');

        const count = key === 'ALL'
            ? inDiv.length
            : inDiv.filter(s => (s.city || '').toLowerCase() === key.toLowerCase()).length;

        chip.innerHTML = `${label}<span class="chip-count">${count}</span>`;
        chip.addEventListener('click', () => {
            dashboardState.selectedCity = key;
            row.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            refreshMarkers();
            refreshTiles();
        });
        row.appendChild(chip);
    });
}

function buildNetworkBreakdownPanel(stations) {
    const panel = document.createElement('div');
    panel.className = 'side-panel';
    panel.innerHTML = `<h4>Network Status</h4>`;
    const bars = document.createElement('div');
    bars.className = 'network-bars';
    panel.appendChild(bars);
    populateNetworkBreakdown(bars, stations);
    return panel;
}

function populateNetworkBreakdown(bars, stations) {
    const counts = { all_online: 0, partial: 0, all_offline: 0, no_duc: 0 };
    for (const s of stations) {
        counts[s.status] = (counts[s.status] || 0) + 1;
    }
    const total = stations.length || 1;

    bars.innerHTML = '';
    STATUS_KEYS.forEach(key => {
        const c = counts[key] || 0;
        const pct = (c / total) * 100;
        const row = document.createElement('div');
        row.className = `network-bar-row ${STATUS_BAR_CLASS[key]}`;
        row.innerHTML = `
            <span class="nb-label">${STATUS_LABELS[key]}</span>
            <span class="nb-track"><span class="nb-fill" style="width:${pct.toFixed(1)}%"></span></span>
            <span class="nb-count">${c}</span>
        `;
        bars.appendChild(row);
    });
}

function productColor(name, fallbackIdx) {
    const cfg = (typeof productColorConfig !== 'undefined') ? productColorConfig[name?.toUpperCase?.()] : null;
    return cfg?.header || FALLBACK_PRODUCT_COLORS[fallbackIdx % FALLBACK_PRODUCT_COLORS.length];
}

function buildProductDonutPanel(products) {
    const panel = document.createElement('div');
    panel.className = 'side-panel';
    panel.innerHTML = `<h4>Sales by Product Today</h4>`;

    const total = products.reduce((s, p) => s + (Number(p.amount) || 0), 0);

    if (total <= 0) {
        const empty = document.createElement('div');
        empty.className = 'donut-empty';
        empty.textContent = 'No sales recorded yet today.';
        panel.appendChild(empty);
        return panel;
    }

    const sorted = [...products].sort((a, b) => (b.amount || 0) - (a.amount || 0));

    const wrap = document.createElement('div');
    wrap.className = 'donut-wrapper';

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 42 42');
    svg.setAttribute('class', 'donut-svg');

    let cumulative = 0;
    sorted.forEach((p, idx) => {
        const pct = (Number(p.amount) || 0) / total * 100;
        const color = productColor(p.product, idx);
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
        svg.appendChild(circle);
        cumulative += pct;
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

    const legend = document.createElement('div');
    legend.className = 'donut-legend';
    sorted.forEach((p, idx) => {
        const amount = Number(p.amount) || 0;
        const row = document.createElement('div');
        row.className = 'donut-legend-row';
        row.innerHTML = `
            <span class="swatch" style="background:${productColor(p.product, idx)}"></span>
            <span class="name">${(p.product || '').toUpperCase()}</span>
            <span class="amt">${formatCurrency(amount)}</span>
        `;
        legend.appendChild(row);
    });
    wrap.appendChild(legend);

    panel.appendChild(wrap);
    return panel;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function buildAlertsPanel() {
    const panel = document.createElement('div');
    panel.className = 'side-panel alerts-panel';

    const header = document.createElement('div');
    header.className = 'alerts-header';
    const title = document.createElement('h4');
    title.textContent = 'Alerts';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'alerts-clear';
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
        dashboardState.alerts = [];
        renderAlertsList();
    });
    header.appendChild(title);
    header.appendChild(clearBtn);
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
        row.innerHTML = `
            <span class="alert-device">${escapeHtml(a.device)}</span>
            <span class="alert-status">${escapeHtml(a.status)}</span>
            <span class="alert-when">${escapeHtml(formatAlertTime(a.ts))}</span>
        `;
        frag.appendChild(row);
    }
    list.appendChild(frag);
}

function alertFromNotification(payload) {
    const data = payload.data || {};
    const ts = payload.timestamp || data.connected_at || data.at || Date.now();
    let device = '';
    let status = '';
    let type = payload.notificationType || payload.type || 'info';

    if (data.event === 'station_offline') {
        device = `Station ${data.customer_code || '?'}`;
        status = 'ALL DUCS OFFLINE';
        type = 'error';
    } else if (data.event === 'connectivity' || data.address) {
        device = `D${data.address || ''}`;
        const isUp = !!data.conn_status;
        status = isUp ? 'CONNECTED' : 'DISCONNECTED';
        type = isUp ? 'success' : 'error';
    } else {
        device = payload.title || 'Alert';
        status = payload.message || '';
    }
    return {
        id: payload.id || `${ts}-${Math.random().toString(36).slice(2, 8)}`,
        ts, type, device, status
    };
}

function addAlert(payload) {
    if (!payload) return;
    dashboardState.alerts.unshift(alertFromNotification(payload));
    if (dashboardState.alerts.length > ALERTS_MAX) {
        dashboardState.alerts.length = ALERTS_MAX;
    }
    renderAlertsList();
}

function seedAlertsFromConnectionEvents(rows) {
    // API returns newest first; preserve that order in the alerts list.
    dashboardState.alerts = rows.map(r => {
        const isUp = !!r.conn_status;
        return {
            id: `seed-${r.address}-${r.created_at || r.connected_at}`,
            ts: r.created_at || r.connected_at,
            type: isUp ? 'success' : 'error',
            device: `D${r.address}`,
            status: isUp ? 'CONNECTED' : 'DISCONNECTED'
        };
    }).slice(0, ALERTS_MAX);
    renderAlertsList();
}

async function fetchConnectionEvents(limit = 50) {
    try {
        const resp = await fetch(`${API_BASE_URL}/connection-events?limit=${limit}`);
        if (!resp.ok) return [];
        return await resp.json();
    } catch (err) {
        console.warn('Failed to load connection events:', err.message);
        return [];
    }
}

function attachAlertListener() {
    if (dashboardState.alertListenerAttached) return;
    window.addEventListener('app-notification', (e) => addAlert(e.detail));
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

    const loading = document.createElement('div');
    loading.textContent = 'Loading dashboard…';
    loading.style.padding = '24px';
    loading.style.color = 'var(--text-secondary)';
    content.appendChild(loading);

    let stations = [];
    let stats = null;
    try {
        [stations, stats] = await Promise.all([fetchStationLocations(), fetchDashboardStats()]);
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        loading.style.color = 'var(--danger)';
        loading.textContent = `Failed to load dashboard data: ${error.message}`;
        return;
    }

    content.removeChild(loading);

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
    const hourlyPanelEl = buildHourlyChartPanel(stats.hourly);
    dashboardState.hourlyPanelEl = hourlyPanelEl;
    side.appendChild(hourlyPanelEl);
    const donutPanelEl = buildProductDonutPanel(stats.products || []);
    dashboardState.donutPanelEl = donutPanelEl;
    side.appendChild(donutPanelEl);
    const networkPanel = buildNetworkBreakdownPanel(stations);
    dashboardState.networkBars = networkPanel.querySelector('.network-bars');
    side.appendChild(networkPanel);
    main.appendChild(side);

    const alertsColumn = document.createElement('div');
    alertsColumn.className = 'alerts-column';
    const alertsPanelEl = buildAlertsPanel();
    dashboardState.alertsPanelEl = alertsPanelEl;
    alertsColumn.appendChild(alertsPanelEl);
    main.appendChild(alertsColumn);

    content.appendChild(main);

    attachAlertListener();
    fetchConnectionEvents().then(seedAlertsFromConnectionEvents);

    dashboardState.map = L.map('station-map', { scrollWheelZoom: true })
        .setView([30.3753, 69.3451], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(dashboardState.map);

    dashboardState.markerLayer = L.layerGroup().addTo(dashboardState.map);

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
        const newBar = buildFilterBar();
        dashboardState.filterBarEl.replaceWith(newBar);
        dashboardState.filterBarEl = newBar;
    }

    if (dashboardState.hourlyPanelEl) {
        const newHourly = buildHourlyChartPanel(stats.hourly);
        dashboardState.hourlyPanelEl.replaceWith(newHourly);
        dashboardState.hourlyPanelEl = newHourly;
    }

    if (dashboardState.donutPanelEl) {
        const newDonut = buildProductDonutPanel(stats.products || []);
        dashboardState.donutPanelEl.replaceWith(newDonut);
        dashboardState.donutPanelEl = newDonut;
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
