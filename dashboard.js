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

const dashboardState = {
    stations: [],
    stats: null,
    divisions: [],
    selectedDivision: 'ALL',
    selectedCity: 'ALL',
    selectedStatuses: new Set(STATUS_KEYS),
    searchQuery: '',
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
    const counts = { all_online: 0, partial: 0, all_offline: 0, visited_no_install: 0, no_duc: 0 };
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
    container.className = 'chart-container chart-container-line';

    const svgNS = 'http://www.w3.org/2000/svg';
    const n = hourly.length;
    // Only draw up to the current hour — future hours have no data yet and
    // would otherwise pull the line down to the baseline.
    const currentHour = new Date().getHours();
    const points = hourly
        .map((h, i) => {
            const amount = Number(h.amount) || 0;
            const txCount = Number(h.tx_count) || 0;
            const x = n > 1 ? (i / (n - 1)) * 100 : 50;
            // Reserve 6% top padding so the peak point doesn't kiss the top edge.
            const y = 100 - (amount / safePeak) * 94;
            return { x, y, amount, txCount, hour: h.hour };
        })
        .filter(p => p.hour <= currentHour);

    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'chart-line-svg');

    if (points.length > 0) {
        const areaD =
            `M ${points[0].x} 100 ` +
            points.map(p => `L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join(' ') +
            ` L ${points[points.length - 1].x} 100 Z`;
        const area = document.createElementNS(svgNS, 'path');
        area.setAttribute('d', areaD);
        area.setAttribute('class', 'chart-line-area');
        svg.appendChild(area);

        const lineD = points.map((p, i) =>
            (i === 0 ? 'M' : 'L') + ` ${p.x.toFixed(3)} ${p.y.toFixed(3)}`
        ).join(' ');
        const line = document.createElementNS(svgNS, 'path');
        line.setAttribute('d', lineD);
        line.setAttribute('class', 'chart-line-path');
        line.setAttribute('fill', 'none');
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        svg.appendChild(line);
    }
    container.appendChild(svg);

    const hitWidthPct = 100 / Math.max(n, 1);
    points.forEach((p, idx) => {
        const isLast = idx === points.length - 1;
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

        const hourLabel = String(p.hour).padStart(2, '0') + ':00';
        let tip = null;
        const showTip = () => {
            if (tip) return;
            tip = document.createElement('div');
            tip.className = 'chart-tooltip';
            tip.innerHTML = `<b>${hourLabel}</b><br>${p.txCount} tx · ${formatCurrencyFull(p.amount)}`;
            tip.style.bottom = `calc(${(100 - p.y).toFixed(3)}% + 10px)`;
            hit.appendChild(tip);
        };
        const hideTip = () => { if (tip) { tip.remove(); tip = null; } };
        hit.addEventListener('mouseenter', showTip);
        hit.addEventListener('mouseleave', hideTip);
        hit.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tip) hideTip(); else showTip();
        });
        container.appendChild(hit);
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
            dashboardState.selectedCity = 'ALL';
            divisionRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderCityRow();
            refreshMarkers();
            refreshTiles();
        });
        divisionRow.appendChild(chip);
    });
    // Search lives at the right edge of the division row.
    divisionRow.appendChild(buildSearchControl());
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
    const counts = { all_online: 0, partial: 0, all_offline: 0, visited_no_install: 0, no_duc: 0 };
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
        device: `D${r.address}`,
        status: formatOfflineSince(r.offline_since),
        address: r.address,
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
            device: `D${data.address || ''}`,
            status: formatOfflineSince(data.offline_since),
            address: data.address,
            outageId: data.id
        };
    }
    return null; // ignore everything else
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
    fetchLongOutages().then(seedAlertsFromLongOutages);

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
