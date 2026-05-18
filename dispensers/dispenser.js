let updateInterval;

async function fetchStationInfo(customerCode) {
    try {
        const resp = await fetch(`${API_BASE_URL}/stations/${encodeURIComponent(customerCode)}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        return data?.station || null;
    } catch (e) {
        console.error('Error fetching station info:', e);
        return null;
    }
}

async function fetchStationStats(customerCode) {
    try {
        const resp = await fetch(`${API_BASE_URL}/dashboard-stats?customer_code=${encodeURIComponent(customerCode)}`);
        if (!resp.ok) return null;
        return await resp.json();
    } catch (e) {
        console.error('Error fetching station stats:', e);
        return null;
    }
}

async function fetchDispenserHourly(customerCode, dispenserId) {
    try {
        const resp = await fetch(`${API_BASE_URL}/dashboard-stats?customer_code=${encodeURIComponent(customerCode)}&dispenser_id=${encodeURIComponent(dispenserId)}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        return Array.isArray(data?.hourly) ? data.hourly : null;
    } catch (e) {
        console.error('Error fetching dispenser hourly:', e);
        return null;
    }
}

function renderHourlySalesLineChart(container, hourly) {
    container.innerHTML = '';
    container.style.position = 'relative';

    const W = 320;
    const H = 140;
    const PAD_L = 38;
    const PAD_R = 10;
    const PAD_T = 12;
    const PAD_B = 22;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    const values = hourly.map(h => Number(h.amount) || 0);
    const max = Math.max(...values, 1);
    const niceMax = Math.pow(10, Math.floor(Math.log10(max))) * Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max))));
    const yMax = niceMax || 1;

    const xFor = i => PAD_L + (i / 23) * plotW;
    const yFor = v => PAD_T + plotH - (v / yMax) * plotH;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '140');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.display = 'block';

    // Gridlines (4 horizontal)
    for (let g = 0; g <= 4; g++) {
        const y = PAD_T + (g / 4) * plotH;
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', PAD_L);
        line.setAttribute('x2', PAD_L + plotW);
        line.setAttribute('y1', y);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', 'var(--border-soft)');
        line.setAttribute('stroke-width', '1');
        svg.appendChild(line);

        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', PAD_L - 6);
        label.setAttribute('y', y + 3);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('font-size', '9');
        label.setAttribute('fill', 'var(--text-secondary)');
        const tickValue = yMax * (1 - g / 4);
        label.textContent = tickValue >= 1000
            ? `${Math.round(tickValue / 1000)}k`
            : Math.round(tickValue).toString();
        svg.appendChild(label);
    }

    // X-axis hour labels (every 3 hours)
    for (let h = 0; h <= 23; h += 3) {
        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', xFor(h));
        label.setAttribute('y', H - 6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', '9');
        label.setAttribute('fill', 'var(--text-secondary)');
        label.textContent = `${h.toString().padStart(2, '0')}h`;
        svg.appendChild(label);
    }

    // Shaded area beneath the line
    const baselineY = PAD_T + plotH;
    const areaPoints = values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' L ');
    const areaPath = document.createElementNS(svgNS, 'path');
    areaPath.setAttribute('d', `M ${xFor(0).toFixed(1)},${baselineY} L ${areaPoints} L ${xFor(23).toFixed(1)},${baselineY} Z`);
    areaPath.setAttribute('fill', 'var(--chart-bar)');
    areaPath.setAttribute('fill-opacity', '0.18');
    areaPath.setAttribute('stroke', 'none');
    svg.appendChild(areaPath);

    // Polyline
    const points = values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
    const poly = document.createElementNS(svgNS, 'polyline');
    poly.setAttribute('points', points);
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'var(--chart-bar)');
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linejoin', 'round');
    poly.setAttribute('stroke-linecap', 'round');
    svg.appendChild(poly);

    // HTML tooltip overlay (positioned absolutely inside container)
    const tooltip = document.createElement('div');
    tooltip.className = 'hourly-chart-tooltip';
    tooltip.style.position = 'absolute';
    tooltip.style.background = 'var(--bg-topbar)';
    tooltip.style.color = '#fff';
    tooltip.style.padding = '6px 9px';
    tooltip.style.borderRadius = '4px';
    tooltip.style.fontSize = '11px';
    tooltip.style.lineHeight = '1.4';
    tooltip.style.pointerEvents = 'none';
    tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    tooltip.style.whiteSpace = 'nowrap';
    tooltip.style.zIndex = '10';
    tooltip.style.display = 'none';
    container.appendChild(tooltip);

    let pinnedIndex = -1;

    const fmtMoney = v => 'Rs ' + Math.round(v).toLocaleString();
    const fmtVolume = v => (Number(v) || 0).toFixed(2) + ' L';

    const showTooltipFor = (i, dot) => {
        const h = hourly[i];
        tooltip.innerHTML = `
            <div style="font-weight:600;margin-bottom:2px">${i.toString().padStart(2, '0')}:00 – ${((i + 1) % 24).toString().padStart(2, '0')}:00</div>
            <div>Sales: ${fmtMoney(h.amount)}</div>
            <div>Transactions: ${Number(h.tx_count) || 0}</div>
            <div>Volume: ${fmtVolume(h.volume)}</div>
        `;
        tooltip.style.display = 'block';
        const dotRect = dot.getBoundingClientRect();
        const cRect = container.getBoundingClientRect();
        const left = dotRect.left - cRect.left + dotRect.width / 2;
        const top = dotRect.top - cRect.top - 8;
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        tooltip.style.transform = 'translate(-50%, -100%)';
    };

    values.forEach((v, i) => {
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', xFor(i));
        dot.setAttribute('cy', yFor(v));
        dot.setAttribute('r', '2.5');
        dot.setAttribute('fill', 'var(--chart-bar)');
        svg.appendChild(dot);

        // Larger transparent hit-circle for easier hover/click targeting
        const hit = document.createElementNS(svgNS, 'circle');
        hit.setAttribute('cx', xFor(i));
        hit.setAttribute('cy', yFor(v));
        hit.setAttribute('r', '8');
        hit.setAttribute('fill', 'transparent');
        hit.style.cursor = 'pointer';
        hit.addEventListener('mouseenter', () => {
            if (pinnedIndex === -1) showTooltipFor(i, dot);
        });
        hit.addEventListener('mouseleave', () => {
            if (pinnedIndex === -1) tooltip.style.display = 'none';
        });
        hit.addEventListener('click', (e) => {
            e.stopPropagation();
            if (pinnedIndex === i) {
                pinnedIndex = -1;
                tooltip.style.display = 'none';
            } else {
                pinnedIndex = i;
                showTooltipFor(i, dot);
            }
        });
        svg.appendChild(hit);
    });

    // Click outside any point clears the pinned tooltip
    container.addEventListener('click', () => {
        if (pinnedIndex !== -1) {
            pinnedIndex = -1;
            tooltip.style.display = 'none';
        }
    });

    container.appendChild(svg);
    // Re-append tooltip so it sits above the SVG in z-order
    container.appendChild(tooltip);
}

async function attachDispenserHourlyChart(dispenser, parent) {
    const wrap = document.createElement('div');
    wrap.style.marginTop = '10px';
    wrap.style.paddingTop = '10px';
    wrap.style.borderTop = '1px solid var(--border-soft)';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'baseline';
    header.style.fontSize = '11px';
    header.style.textTransform = 'uppercase';
    header.style.letterSpacing = '0.5px';
    header.style.color = 'var(--text-secondary)';
    header.style.fontWeight = '600';
    header.style.marginBottom = '6px';
    header.style.padding = '0 4px';
    const title = document.createElement('span');
    title.textContent = 'Hourly Sales (Today)';
    const peak = document.createElement('span');
    peak.style.fontWeight = '500';
    peak.style.textTransform = 'none';
    peak.style.letterSpacing = '0';
    header.appendChild(title);
    header.appendChild(peak);
    wrap.appendChild(header);

    const chartContainer = document.createElement('div');
    chartContainer.style.width = '100%';
    wrap.appendChild(chartContainer);

    parent.appendChild(wrap);

    const hourly = await fetchDispenserHourly(dispenser.customer_code, dispenser.dispenser_id);
    if (!hourly) {
        chartContainer.textContent = 'No sales data available';
        chartContainer.style.color = 'var(--text-secondary)';
        chartContainer.style.fontSize = '12px';
        chartContainer.style.padding = '20px';
        chartContainer.style.textAlign = 'center';
        return;
    }
    const peakHour = hourly.reduce((best, cur) => cur.amount > best.amount ? cur : best, hourly[0]);
    peak.textContent = peakHour.amount > 0
        ? `Peak: ${peakHour.hour.toString().padStart(2, '0')}:00 (Rs ${Math.round(peakHour.amount).toLocaleString()})`
        : 'No transactions yet today';

    renderHourlySalesLineChart(chartContainer, hourly);
}

function buildStationDetailHeader(customerCode, station, stats, dispensers) {
    const formatNum = v => (Number(v) || 0).toLocaleString();
    const formatCurrencyFull = v => 'Rs ' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

    const totalDucs = dispensers.length;
    const onlineDucs = dispensers.filter(d => d.conn_status).length;
    const offlineDucs = totalDucs - onlineDucs;
    const cityName = station?.city
        ? station.city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        : '';
    const districtName = station?.district
        ? station.district : '';
    const stationId = station?.station_id || '';
    const sales = stats?.today?.total_amount || 0;
    const tx = stats?.today?.tx_count || 0;

    const wrap = document.createElement('div');
    wrap.className = 'station-header';

    const top = document.createElement('div');
    top.className = 'station-header-top';

    const left = document.createElement('div');
    left.className = 'station-header-left';
    left.innerHTML = `
        <h1 class="station-header-title">${stationId ? stationId : 'Station ' + customerCode}</h1>
        <div class="station-header-meta">
            <span class="station-header-meta-item"><b>Customer Code:</b>${customerCode}</span>
            ${cityName ? `<span class="station-header-meta-item"><img src="assets/graphics/location-icon-1.png" alt="City" />${cityName},</span>` : ''}
            ${districtName ? `<span class="station-header-meta-item">${districtName}</span>` : 'N/A'}
        </div>
    `;
    top.appendChild(left);

    const right = document.createElement('div');
    right.className = 'station-header-right';

    const stats_grid = document.createElement('div');
    stats_grid.className = 'station-header-stats';
    const cells = [
        { label: 'Total DUCs',     value: formatNum(totalDucs),                cls: '' },
        { label: 'DUCs Online',    value: formatNum(onlineDucs),               cls: 'online' },
        { label: 'DUCs Offline',   value: formatNum(offlineDucs),              cls: offlineDucs > 0 ? 'offline' : '' },
        { label: 'Tx Today',       value: formatNum(tx),                       cls: '' },
        { label: 'Sales Today',    value: formatCurrencyFull(sales),           cls: 'online' }
    ];
    cells.forEach(c => {
        const cell = document.createElement('div');
        cell.className = `station-header-stat ${c.cls}`;
        cell.innerHTML = `
            <div class="station-header-stat-label">${c.label}</div>
            <div class="station-header-stat-value">${c.value}</div>
        `;
        stats_grid.appendChild(cell);
    });
    right.appendChild(stats_grid);
    top.appendChild(right);

    wrap.appendChild(top);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'station-header-options';

    return { wrap, optionsContainer: optionsRow };
}

async function renderDispenser() {
    const content = document.getElementById('content');
    if (!content) {
        console.error('Content element not found');
        return;
    }
    content.innerHTML = '';

    if (updateInterval) {
        clearInterval(updateInterval);
    }

    // Optional ?customer_code=... filter scopes the page to a single station
    const params = new URLSearchParams(window.location.search);
    const customerCodeFilter = (params.get('customer_code') || '').trim();

    // Show a loader while the initial dispenser/nozzle data is being fetched.
    const loader = createPageLoader('Loading dispensers…');
    content.appendChild(loader);

    try {
        // /dispensers-full returns each dispenser with its nozzles[] and station
        // already attached, so the page can render with one round trip instead
        // of 1 + N (nozzles) + S (per-station info).
        const dispenserUrl = customerCodeFilter
            ? `${API_BASE_URL}/dispensers-full?customer_code=${encodeURIComponent(customerCodeFilter)}`
            : `${API_BASE_URL}/dispensers-full`;
        const dispensersResponse = await fetch(dispenserUrl);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();
        loader.remove();

        let headerContainer, optionsContainer, gridContainer;

        if (customerCodeFilter) {
            const [stationInfo, stationStats] = await Promise.all([
                fetchStationInfo(customerCodeFilter),
                fetchStationStats(customerCodeFilter)
            ]);
            const { wrap, optionsContainer: optsRight } =
                buildStationDetailHeader(customerCodeFilter, stationInfo, stationStats, dispensers);
            headerContainer = wrap;
            optionsContainer = optsRight;

            gridContainer = document.createElement('div');
            gridContainer.style.display = 'flex';
            gridContainer.style.flexWrap = 'wrap';
            gridContainer.style.gap = '15px';
            gridContainer.style.justifyContent = 'flex-start';
            gridContainer.style.marginTop = '20px';
        } else {
            // Buttons live inside the filter row (rendered by renderStationWiseDispensers)
            headerContainer = null;

            optionsContainer = document.createElement('div');
            optionsContainer.style.display = 'flex';
            optionsContainer.style.alignItems = 'center';
            optionsContainer.style.gap = '8px';

            gridContainer = document.createElement('div');
            gridContainer.style.display = 'flex';
            gridContainer.style.flexWrap = 'wrap';
            gridContainer.style.gap = '15px';
            gridContainer.style.justifyContent = 'flex-start';
        }

        // Viewers cannot command or configure dispensers
        const role = window.StationAuth?.getUserInfo?.()?.role;
        const canCommand = role === 'admin' || role === 'super_admin' || role === 'operator';

        if (canCommand) {
            const configButton = createMainButton();
            configButton.textContent = 'Configure';
            configButton.addEventListener('click', () => {
                const url = customerCodeFilter
                    ? `dispensers/config-dispensers.html?customer_code=${encodeURIComponent(customerCodeFilter)}`
                    : 'dispensers/config-dispensers.html';
                window.location.href = url;
            });

            const commandDispenserButton = createMainButton();
            commandDispenserButton.textContent = 'Lock/Unlock';
            commandDispenserButton.addEventListener('click', () => {
                const openPopup = () => {
                    if (typeof window.showCommandDispenserPopup === 'function') {
                        window.showCommandDispenserPopup({ presetCustomerCode: customerCodeFilter || null });
                    }
                };
                if (typeof window.showCommandDispenserPopup === 'function') {
                    openPopup();
                } else {
                    const script = document.createElement('script');
                    script.src = 'dispensers/command-dispenser.js';
                    script.onload = openPopup;
                    document.head.appendChild(script);
                }
            });

            optionsContainer.appendChild(commandDispenserButton);
            optionsContainer.appendChild(configButton);
        }

        // Single global "Last Updated" timestamp at top of page (replaces per-nozzle timestamps)
        const lastUpdatedEl = document.createElement('div');
        lastUpdatedEl.id = 'page-last-updated';
        lastUpdatedEl.style.fontSize = '12px';
        lastUpdatedEl.style.color = 'var(--text-secondary)';
        const refreshTimestamp = () => {
            lastUpdatedEl.textContent = `Last Updated: ${new Date().toLocaleString()}`;
        };
        refreshTimestamp();

        if (customerCodeFilter) {
            const topRow = document.createElement('div');
            topRow.style.display = 'flex';
            topRow.style.justifyContent = 'flex-end';
            topRow.style.marginBottom = '8px';
            topRow.appendChild(lastUpdatedEl);
            content.appendChild(topRow);

            const backRow = document.createElement('div');
            backRow.style.display = 'flex';
            backRow.style.justifyContent = 'space-between';
            backRow.style.alignItems = 'center';
            backRow.style.marginBottom = '14px';

            const backBtn = createActionButton();
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
            backRow.appendChild(backBtn);
            backRow.appendChild(optionsContainer);
            content.appendChild(backRow);
        } else {
            const topRow = document.createElement('div');
            topRow.style.display = 'flex';
            topRow.style.justifyContent = 'flex-end';
            topRow.style.marginBottom = '8px';
            topRow.appendChild(lastUpdatedEl);
            content.appendChild(topRow);
        }
        if (headerContainer) {
            content.appendChild(headerContainer);
        }

        gridContainer.id = 'dispenser-grid';
        // Attach gridContainer BEFORE rendering into it. createDispenserCard
        // schedules a setTimeout that calls document.getElementById('nozzle-…');
        // if cards are built into a detached gridContainer they aren't visible
        // to that lookup, which was leaving every nozzle blank until the 10-s
        // periodic tick finally populated them.
        content.appendChild(gridContainer);

        if (dispensers.length === 0) {
            const message = createNoDataMessage('No dispensers configured');
            message.style.padding = '40px';
            message.style.width = '100%';
            gridContainer.appendChild(message);
        } else if (customerCodeFilter) {
            // Single-station view: chart is rendered inside the card itself, below the nozzles
            for (const dispenser of dispensers) {
                await createDispenserCard(dispenser, gridContainer, {
                    layoutType: window.NOZZLE_LAYOUTS.FULL,
                    showHourlyChart: true
                });
            }
        } else {
            await window.renderStationWiseDispensers(dispensers, gridContainer, createDispenserCard, { layoutType: window.NOZZLE_LAYOUTS.FULL }, optionsContainer);
        }

        if (dispensers.length > 0) {
            updateInterval = setInterval(async () => {
                console.log('Performing periodic update of dispenser data...');
                try {
                    // dispenserUrl already points at /dispensers-full so each tick
                    // pulls dispensers + nozzles in one round trip instead of
                    // 1 + N fetches.
                    const updatedDispensersResponse = await fetch(dispenserUrl);
                    if (!updatedDispensersResponse.ok) throw new Error('Failed to fetch dispensers');
                    const updatedDispensers = await updatedDispensersResponse.json();

                    await Promise.all(updatedDispensers.map(updateDispenserCard));
                    refreshTimestamp();
                } catch (error) {
                    console.error('Error during periodic update:', error);
                }
            }, 10000);
        }
    } catch (error) {
        console.error('Error rendering dispenser:', error);
        content.innerHTML = `<div class="error">Error loading dispenser data: ${error.message}</div>`;
    }
}

async function createDispenserCard(dispenser, gridContainer, params = {}) {
    const layoutType = params.layoutType || window.NOZZLE_LAYOUTS.FULL;

    // Prefer the nozzles attached by /dispensers-full; fall back to a per-card
    // fetch if a caller hasn't migrated yet.
    let nozzles = Array.isArray(dispenser.nozzles) ? dispenser.nozzles : null;
    if (!nozzles) {
        const nozzlesResponse = await fetch(
            `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
        );
        if (!nozzlesResponse.ok) return;
        nozzles = await nozzlesResponse.json();
    }

    if (nozzles.length === 0) return;

    const paddedAddress = dispenser.address;
    const dispenserTopic = ensureDAddress(paddedAddress);

    const { card, titleContainer } = await createCard(dispenserTopic, `Station: ${dispenser.customer_code}`);

    card.id = `dispenser-${dispenser.dispenser_id}`;
    card.dataset.address = dispenserTopic;
    card.dataset.connStatus = dispenser.conn_status ? '1' : '0';

    const irStatusContainer = document.createElement('div');
    irStatusContainer.style.position = 'absolute';
    irStatusContainer.style.top = '0';
    irStatusContainer.style.left = '45%';
    irStatusContainer.style.transform = 'translateX(-25%)';
    irStatusContainer.style.display = 'flex';
    irStatusContainer.style.alignItems = 'center';
    irStatusContainer.style.gap = '8px';

    const irControlIcon = createIconFromImage('assets/graphics/ir-control-icon.png', 'IR Control', '20px');

    const irLockIcon = createIconFromImage('assets/graphics/ir-control-icon.png', null, '20px');
    irLockIcon.className = 'ir-lock-icon';
    irLockIcon.src = dispenser.ir_lock_status ? 
        'assets/graphics/green-lock.png' : 'assets/graphics/red-unlock.png';
    irLockIcon.alt = dispenser.ir_lock_status ? 'Locked' : 'Unlocked';

    irStatusContainer.appendChild(irControlIcon);
    irStatusContainer.appendChild(irLockIcon);
    titleContainer.appendChild(irStatusContainer);

    // Refresh button issues commands and is only available to admin/operator
    const cardRole = window.StationAuth?.getUserInfo?.()?.role;
    if (cardRole === 'admin' || cardRole === 'super_admin' || cardRole === 'operator') {
        const refreshButton = createIconFromImage('assets/graphics/refresh-icon.png', 'Refresh', '20px');
        refreshButton.style.position = 'absolute';
        refreshButton.style.top = '0';
        refreshButton.style.left = '65%';
        refreshButton.style.cursor = 'pointer';
        refreshButton.style.transition = 'transform 0.2s ease';
        refreshButton.title = 'Refresh';
        refreshButton.addEventListener('click', () => {
            sendGetCommandsForDispenser(dispenser);
        });

        refreshButton.addEventListener('mouseover', () => {
            refreshButton.style.transform = 'scale(1.05)';
        });

        refreshButton.addEventListener('mouseout', () => {
            refreshButton.style.transform = 'scale(1)';
        });

        titleContainer.appendChild(refreshButton);
    }

    const nozzleGrid = document.createElement('div');
    nozzleGrid.style.display = 'grid';
    nozzleGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    nozzleGrid.style.gap = '11px';
    nozzleGrid.style.marginTop = '8px';
    card.appendChild(nozzleGrid);
    gridContainer.appendChild(card);

    nozzles.forEach(nozzle => {
        const nozzleContainer = document.createElement('div');
        nozzleContainer.id = `nozzle-${nozzle.nozzle_id}`;
        nozzleGrid.appendChild(nozzleContainer);

        // Store layout type for this nozzle
        if (typeof window.setNozzleLayoutType === 'function') {
            window.setNozzleLayoutType(nozzle.nozzle_id, layoutType);
        }
    });

    // Small delay to ensure DOM is updated, then update UI
    setTimeout(() => {
        nozzles.forEach(nozzle => {
            const nozzleData = window.NozzleData(nozzle);
            if (typeof window.updateNozzleUI === 'function') {
                window.updateNozzleUI(nozzle.nozzle_id, nozzleData);
            }
        });
    }, 100);

    // Optional: per-dispenser hourly sales chart embedded inside the card
    if (params.showHourlyChart) {
        attachDispenserHourlyChart(dispenser, card);
    }
}

async function updateDispenserCard(dispenser) {
    const card = document.getElementById(`dispenser-${dispenser.dispenser_id}`);
    if (!card) return;

    card.dataset.connStatus = dispenser.conn_status ? '1' : '0';

    const dispenserTopic = ensureDAddress(dispenser.address);

    if (typeof window.updateIRStatus === 'function') {
        window.updateIRStatus(dispenserTopic, dispenser.ir_lock_status ? 1 : 0);
    }

    if (typeof window.updateConnStatus === 'function') {
        window.updateConnStatus(dispenserTopic, dispenser.conn_status ? 1 : 0, dispenser.connected_at);
    }

    // Fetch error count ONCE per dispenser per tick; shared between badge and
    // per-nozzle data so /error-log isn't called twice.
    let sharedErrorCount = 0;
    if (typeof window.fetchErrorCount === 'function') {
        try {
            sharedErrorCount = await window.fetchErrorCount(dispenserTopic);
        } catch (error) {
            console.error('Error fetching error count for dispenser:', dispenser.dispenser_id, error);
        }
    }

    // Prefer nozzles attached by /dispensers-full (no per-card fetch needed);
    // fall back to fetching only if the dispenser arrived without them.
    const nozzlesPromise = Array.isArray(dispenser.nozzles)
        ? Promise.resolve(dispenser.nozzles)
        : (async () => {
            const r = await fetch(
                `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
            );
            return r.ok ? r.json() : [];
        })();

    await Promise.all([
        typeof window.updateErrorCount === 'function'
            ? window.updateErrorCount(dispenserTopic, sharedErrorCount)
            : Promise.resolve(),
        typeof window.updateResetCount === 'function'
            ? window.updateResetCount(dispenserTopic)
            : Promise.resolve(),
        (async () => {
            try {
                const nozzles = await nozzlesPromise;
                nozzles.forEach((nozzle) => {
                    const nozzleData = window.NozzleData(nozzle);
                    if (!nozzleData.dispenserTopic) {
                        nozzleData.dispenserTopic = dispenserTopic;
                    }
                    nozzleData.errorCount = sharedErrorCount;

                    if (typeof window.updateNozzleUI === 'function') {
                        window.updateNozzleUI(nozzle.nozzle_id, nozzleData);
                    }
                });
            } catch (error) {
                console.error('Error updating nozzle data:', error);
            }
        })()
    ]);
}

window.renderDispenser = renderDispenser;