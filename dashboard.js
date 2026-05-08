const STATUS_COLORS = {
    all_online: '#2e7d32',
    partial:    '#f9a825',
    all_offline:'#d32f2f',
    no_duc:     '#9e9e9e'
};

const STATUS_LABELS = {
    all_online:  'All DUCs online',
    partial:     'Partially online',
    all_offline: 'All DUCs offline',
    no_duc:      'No DUC installed'
};

function buildStatsBlock(stations) {
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

    const wrap = document.createElement('div');
    wrap.className = 'dashboard-stats';

    const cards = [
        { label: 'Total Stations',  value: counts.total,                cls: '' },
        { label: 'Stations w/ DUC', value: counts.with_duc,             cls: 'online' },
        { label: 'All Online',      value: counts.all_online,           cls: 'online' },
        { label: 'Partial',         value: counts.partial,              cls: 'partial' },
        { label: 'All Offline',     value: counts.all_offline,          cls: 'offline' },
        { label: 'No DUC',          value: counts.no_duc,               cls: 'no-duc' },
        { label: 'Total DUCs',      value: totalDucs,                   cls: '' },
        { label: 'DUCs Online',     value: `${onlineDucs} / ${totalDucs}`, cls: 'online' }
    ];

    cards.forEach(c => {
        const card = document.createElement('div');
        card.className = `stat-card ${c.cls}`;
        const lbl = document.createElement('div');
        lbl.className = 'stat-label';
        lbl.textContent = c.label;
        const val = document.createElement('div');
        val.className = 'stat-value';
        val.textContent = c.value;
        card.appendChild(lbl);
        card.appendChild(val);
        wrap.appendChild(card);
    });

    return wrap;
}

function buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'map-legend';
    Object.keys(STATUS_LABELS).forEach(key => {
        const item = document.createElement('span');
        const dot = document.createElement('span');
        dot.className = 'legend-dot';
        dot.style.background = STATUS_COLORS[key];
        item.appendChild(dot);
        item.appendChild(document.createTextNode(STATUS_LABELS[key]));
        legend.appendChild(item);
    });
    return legend;
}

function makeMarkerIcon(status) {
    const color = STATUS_COLORS[status] || STATUS_COLORS.no_duc;
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
            <div class="popup-row"><b>DUCs:</b> ${station.online_count} online / ${station.duc_count} installed (sheet says ${station.total_dus})</div>
            ${link}
        </div>
    `;
}

async function renderDashboard() {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = '';

    const { headerContainer } = renderPageHeader('Network Dashboard');
    content.appendChild(headerContainer);

    const loading = document.createElement('div');
    loading.textContent = 'Loading station map…';
    loading.style.padding = '24px';
    loading.style.color = '#666';
    content.appendChild(loading);

    let stations = [];
    try {
        const resp = await fetch(`${API_BASE_URL}/station-locations`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        stations = await resp.json();
    } catch (error) {
        console.error('Failed to load station locations:', error);
        loading.style.color = '#d32f2f';
        loading.textContent = `Failed to load station data: ${error.message}`;
        return;
    }

    content.removeChild(loading);

    content.appendChild(buildStatsBlock(stations));

    const mapWrapper = document.createElement('div');
    mapWrapper.className = 'map-wrapper';

    const mapEl = document.createElement('div');
    mapEl.id = 'station-map';
    mapWrapper.appendChild(mapEl);
    mapWrapper.appendChild(buildLegend());
    content.appendChild(mapWrapper);

    const map = L.map('station-map', {
        scrollWheelZoom: true
    }).setView([30.3753, 69.3451], 6);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    if (stations.length === 0) {
        const msg = document.createElement('div');
        msg.textContent = 'No stations found in the source sheet.';
        msg.style.padding = '12px';
        msg.style.color = '#666';
        mapWrapper.insertBefore(msg, mapEl);
        return;
    }

    const bounds = [];
    stations.forEach(s => {
        const marker = L.marker([s.lat, s.lng], { icon: makeMarkerIcon(s.status) }).addTo(map);
        marker.bindPopup(buildPopupHtml(s));
        bounds.push([s.lat, s.lng]);
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40] });
    }
}

window.renderDashboard = renderDashboard;
