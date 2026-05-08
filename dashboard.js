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
const PRODUCT_COLORS = {
    'PMG':  '#FF7043',
    'HSD':  '#FFB300',
    'HOBC': '#1E88E5'
};
const FALLBACK_PRODUCT_COLORS = ['#26a69a', '#7e57c2', '#ec407a', '#5c6bc0', '#9ccc65', '#ffa726'];

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

const dashboardState = {
    stations: [],
    stats: null,
    districts: [],
    selectedDistrict: 'ALL',
    selectedStatuses: new Set(STATUS_KEYS),
    map: null,
    markerLayer: null
};

function formatCurrency(value) {
    const num = Number(value) || 0;
    if (num >= 1_000_000) return 'Rs ' + (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return 'Rs ' + (num / 1_000).toFixed(1) + 'k';
    return 'Rs ' + num.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function formatCurrencyFull(value) {
    return 'Rs ' + (Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function formatCount(value) {
    return (Number(value) || 0).toLocaleString();
}

function buildStatsBlock(today, hourly) {
    const wrap = document.createElement('div');
    wrap.className = 'dashboard-stats';

    const txCard = document.createElement('div');
    txCard.className = 'stat-card';
    txCard.innerHTML = `
        <div class="stat-label">Transactions Today</div>
        <div class="stat-value">${formatCount(today.tx_count)}</div>
    `;
    wrap.appendChild(txCard);

    const salesCard = document.createElement('div');
    salesCard.className = 'stat-card online';
    salesCard.innerHTML = `
        <div class="stat-label">Sales Today</div>
        <div class="stat-value">${formatCurrencyFull(today.total_amount)}</div>
    `;
    wrap.appendChild(salesCard);

    const chartCard = document.createElement('div');
    chartCard.className = 'stat-card chart-card';
    const peak = hourly.reduce((m, h) => Math.max(m, Number(h.amount) || 0), 0);
    const safePeak = peak > 0 ? peak : 1;

    const label = document.createElement('div');
    label.className = 'stat-label';
    label.textContent = `Hourly Sales (peak: ${formatCurrencyFull(peak)})`;
    chartCard.appendChild(label);

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
        bar.dataset.tooltip = `${hourLabel} • ${txCount} tx • ${formatCurrencyFull(amount)}`;

        let tip = null;
        const showTip = () => {
            if (tip) return;
            tip = document.createElement('div');
            tip.className = 'chart-tooltip';
            tip.innerHTML = `<b>${hourLabel}</b><br>${txCount} transactions<br>${formatCurrencyFull(amount)}`;
            bar.appendChild(tip);
        };
        const hideTip = () => {
            if (tip) { tip.remove(); tip = null; }
        };
        bar.addEventListener('mouseenter', showTip);
        bar.addEventListener('mouseleave', hideTip);
        bar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tip) hideTip(); else showTip();
        });
        container.appendChild(bar);
    });
    chartCard.appendChild(container);

    const axis = document.createElement('div');
    axis.className = 'chart-axis-row';
    axis.innerHTML = '<span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>';
    chartCard.appendChild(axis);

    wrap.appendChild(chartCard);

    return wrap;
}

function buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'map-legend';
    STATUS_KEYS.forEach(key => {
        const item = document.createElement('span');
        const dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.style.background = statusColor(key);
        item.appendChild(dot);
        item.appendChild(document.createTextNode(STATUS_LABELS[key]));
        legend.appendChild(item);
    });
    return legend;
}

function makeMarkerIcon(status) {
    const color = statusColor(status);
    const html = `<div style="
        width: 18px; height: 18px;
        background: ${color};
        border: 3px solid #fff;
        border-radius: 50%;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.3);
    "></div>`;
    return L.divIcon({
        html,
        className: 'station-marker',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10]
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
            <div class="popup-row"><b>Status:</b> ${STATUS_LABELS[station.status]}</div>
            <div class="popup-row"><b>DUCs:</b> ${station.online_count} online / ${station.duc_count} installed (sheet: ${station.total_dus})</div>
            ${link}
        </div>
    `;
}

function getFilteredStations() {
    return dashboardState.stations.filter(s => {
        const districtOk = dashboardState.selectedDistrict === 'ALL'
            || (s.city || '').toLowerCase() === dashboardState.selectedDistrict.toLowerCase();
        const statusOk = dashboardState.selectedStatuses.has(s.status);
        return districtOk && statusOk;
    });
}

function refreshMarkers() {
    if (!dashboardState.map || !dashboardState.markerLayer) return;
    dashboardState.markerLayer.clearLayers();

    const filtered = getFilteredStations();
    const bounds = [];
    filtered.forEach(s => {
        const marker = L.marker([s.lat, s.lng], { icon: makeMarkerIcon(s.status) });
        marker.bindPopup(buildPopupHtml(s));
        marker.addTo(dashboardState.markerLayer);
        bounds.push([s.lat, s.lng]);
    });
    if (bounds.length > 0) {
        dashboardState.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
}

function buildFilterBar() {
    const bar = document.createElement('div');
    bar.className = 'filter-bar';

    const districts = Array.from(new Set(
        dashboardState.stations.map(s => (s.city || '').trim()).filter(Boolean)
    )).sort();
    dashboardState.districts = districts;

    const districtRow = document.createElement('div');
    districtRow.className = 'filter-row';
    const districtLabel = document.createElement('span');
    districtLabel.className = 'filter-label';
    districtLabel.textContent = 'District';
    districtRow.appendChild(districtLabel);

    const districtChips = [{ key: 'ALL', label: 'All' }, ...districts.map(d => ({ key: d, label: d }))];
    districtChips.forEach(({ key, label }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'filter-chip';
        if (dashboardState.selectedDistrict === key) chip.classList.add('active');

        const count = key === 'ALL'
            ? dashboardState.stations.length
            : dashboardState.stations.filter(s => (s.city || '').toLowerCase() === key.toLowerCase()).length;

        chip.innerHTML = `${label}<span class="chip-count">${count}</span>`;
        chip.addEventListener('click', () => {
            dashboardState.selectedDistrict = key;
            districtRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            refreshMarkers();
        });
        districtRow.appendChild(chip);
    });
    bar.appendChild(districtRow);

    const statusRow = document.createElement('div');
    statusRow.className = 'filter-row';
    const statusLabel = document.createElement('span');
    statusLabel.className = 'filter-label';
    statusLabel.textContent = 'Status';
    statusRow.appendChild(statusLabel);

    STATUS_KEYS.forEach(key => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `filter-chip ${STATUS_CHIP_CLASS[key]}`;
        if (dashboardState.selectedStatuses.has(key)) chip.classList.add('active');

        const count = dashboardState.stations.filter(s => s.status === key).length;
        chip.innerHTML = `${STATUS_LABELS[key]}<span class="chip-count">${count}</span>`;
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
    });
    bar.appendChild(statusRow);

    return bar;
}

function buildNetworkSummaryPanel(stations) {
    const counts = {
        total: stations.length,
        with_duc: 0,
        all_online: 0,
        partial: 0,
        all_offline: 0,
        no_duc: 0
    };
    let totalDucs = 0;
    let onlineDucs = 0;
    for (const s of stations) {
        if (s.duc_count > 0) counts.with_duc += 1;
        counts[s.status] = (counts[s.status] || 0) + 1;
        totalDucs += s.duc_count;
        onlineDucs += s.online_count;
    }
    const offlineDucs = totalDucs - onlineDucs;

    const panel = document.createElement('div');
    panel.className = 'side-panel';
    panel.innerHTML = `<h4>Network Summary</h4>`;

    const rows = [
        { label: 'Total Sites',      value: formatCount(counts.total),                    cls: '' },
        { label: 'Sites w/ DUC',     value: formatCount(counts.with_duc),                 cls: '' },
        { label: 'All Online',       value: formatCount(counts.all_online),               cls: 'online' },
        { label: 'Partial',          value: formatCount(counts.partial),                  cls: 'partial' },
        { label: 'All Offline',      value: formatCount(counts.all_offline),              cls: 'offline' },
        { label: 'No DUC',           value: formatCount(counts.no_duc),                   cls: 'no-duc' },
        { label: 'Total DUCs',       value: formatCount(totalDucs),                       cls: '' },
        { label: 'DUCs Online',      value: `${formatCount(onlineDucs)} / ${formatCount(totalDucs)}`, cls: 'online' },
        { label: 'DUCs Offline',     value: formatCount(offlineDucs),                     cls: 'offline' }
    ];

    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'side-stat-row';
        row.innerHTML = `<span class="label">${r.label}</span><span class="value ${r.cls}">${r.value}</span>`;
        panel.appendChild(row);
    });

    return panel;
}

function productColor(name, fallbackIdx) {
    return PRODUCT_COLORS[name?.toUpperCase?.()] || FALLBACK_PRODUCT_COLORS[fallbackIdx % FALLBACK_PRODUCT_COLORS.length];
}

function buildProductDonutPanel(products, totalAmount) {
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
        const pct = (Number(p.amount) || 0) / total * 100;
        const row = document.createElement('div');
        row.className = 'donut-legend-row';
        row.innerHTML = `
            <span class="swatch" style="background:${productColor(p.product, idx)}"></span>
            <span class="name">${p.product}</span>
            <span class="amt">${formatCurrency(p.amount)} · ${pct.toFixed(1)}%</span>
        `;
        legend.appendChild(row);
    });
    wrap.appendChild(legend);

    panel.appendChild(wrap);
    return panel;
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

    const { headerContainer } = renderPageHeader('Network Dashboard');
    content.appendChild(headerContainer);

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

    content.appendChild(buildStatsBlock(stats.today, stats.hourly));
    content.appendChild(buildFilterBar());

    const main = document.createElement('div');
    main.className = 'dashboard-main';

    const mapWrapper = document.createElement('div');
    mapWrapper.className = 'map-wrapper';
    const mapEl = document.createElement('div');
    mapEl.id = 'station-map';
    mapWrapper.appendChild(mapEl);
    mapWrapper.appendChild(buildLegend());
    main.appendChild(mapWrapper);

    const side = document.createElement('div');
    side.className = 'dashboard-side';
    side.appendChild(buildNetworkSummaryPanel(stations));
    side.appendChild(buildProductDonutPanel(stats.products || [], stats.today.total_amount));
    main.appendChild(side);

    content.appendChild(main);

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
        return;
    }

    refreshMarkers();
}

window.addEventListener('themechange', () => {
    if (dashboardState.markerLayer) refreshMarkers();
});

window.renderDashboard = renderDashboard;
