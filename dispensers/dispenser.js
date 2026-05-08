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

function buildStationDetailHeader(customerCode, station, stats, dispensers) {
    const formatNum = v => (Number(v) || 0).toLocaleString();
    const formatCurrencyFull = v => 'Rs ' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

    const totalDucs = dispensers.length;
    const onlineDucs = dispensers.filter(d => d.conn_status).length;
    const offlineDucs = totalDucs - onlineDucs;
    const cityName = station?.city
        ? station.city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        : '';
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
            <span class="station-header-meta-item"><b>Customer Code:</b> ${customerCode}</span>
            ${cityName ? `<span class="station-header-meta-item"><img src="assets/graphics/location-icon.png" alt="City" />${cityName}</span>` : ''}
        </div>
    `;
    top.appendChild(left);

    const right = document.createElement('div');
    right.className = 'station-header-right';
    top.appendChild(right);

    wrap.appendChild(top);

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
    wrap.appendChild(stats_grid);

    return { wrap, optionsContainer: right };
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

    try {
        const dispenserUrl = customerCodeFilter
            ? `${API_BASE_URL}/dispensers?customer_code=${encodeURIComponent(customerCodeFilter)}`
            : `${API_BASE_URL}/dispensers`;
        const dispensersResponse = await fetch(dispenserUrl);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();

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
            // Plain heading + action row, no card-style page header
            headerContainer = document.createElement('div');
            headerContainer.style.display = 'flex';
            headerContainer.style.justifyContent = 'space-between';
            headerContainer.style.alignItems = 'center';
            headerContainer.style.marginBottom = '16px';
            headerContainer.style.gap = '12px';
            headerContainer.style.flexWrap = 'wrap';

            const heading = document.createElement('h1');
            heading.textContent = 'Dispenser Unit Control - DUC';
            heading.style.margin = '0';
            headerContainer.appendChild(heading);

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
        const canCommand = role === 'admin' || role === 'operator';

        if (canCommand) {
            const configButton = createMainButton();
            configButton.textContent = 'Configure Dispensers';
            configButton.addEventListener('click', () => {
                window.location.href = 'dispensers/config-dispensers.html';
            });

            const commandDispenserButton = createMainButton();
            commandDispenserButton.textContent = 'Command Dispenser';
            commandDispenserButton.addEventListener('click', () => {
                if (typeof window.showCommandDispenserPopup === 'function') {
                    window.showCommandDispenserPopup();
                } else {
                    const script = document.createElement('script');
                    script.src = 'dispensers/command-dispenser.js';
                    script.onload = () => {
                        if (typeof window.showCommandDispenserPopup === 'function') {
                            window.showCommandDispenserPopup();
                        }
                    };
                    document.head.appendChild(script);
                }
            });

            optionsContainer.appendChild(commandDispenserButton);
            optionsContainer.appendChild(configButton);
        }

        if (!customerCodeFilter) {
            headerContainer.appendChild(optionsContainer);
        } else {
            // Back button styled like configPage's "Back" button — sits above the station header
            const backRow = document.createElement('div');
            backRow.style.display = 'flex';
            backRow.style.justifyContent = 'flex-start';
            backRow.style.marginBottom = '14px';
            const backBtn = createActionButton();
            backBtn.textContent = '← Back';
            backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
            backRow.appendChild(backBtn);
            content.appendChild(backRow);
        }
        content.appendChild(headerContainer);

        gridContainer.id = 'dispenser-grid';

        if (dispensers.length === 0) {
            const message = createNoDataMessage('No dispensers configured');
            message.style.padding = '40px';
            message.style.width = '100%';
            gridContainer.appendChild(message);
        } else if (customerCodeFilter) {
            // Single-station view: render dispensers directly, skip station grouping wrapper and filters
            for (const dispenser of dispensers) {
                await createDispenserCard(dispenser, gridContainer, { layoutType: window.NOZZLE_LAYOUTS.FULL });
            }
        } else {
            await window.renderStationWiseDispensers(dispensers, gridContainer, createDispenserCard, { layoutType: window.NOZZLE_LAYOUTS.FULL });
        }

        content.appendChild(gridContainer);

        if (dispensers.length > 0) {
            updateInterval = setInterval(async () => {
                console.log('Performing periodic update of dispenser data...');
                try {
                    const updatedDispensersResponse = await fetch(dispenserUrl);
                    if (!updatedDispensersResponse.ok) throw new Error('Failed to fetch dispensers');
                    const updatedDispensers = await updatedDispensersResponse.json();

                    for (const dispenser of updatedDispensers) {
                        await updateDispenserCard(dispenser);
                    }
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
    
    const nozzlesResponse = await fetch(
        `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
    );
    if (!nozzlesResponse.ok) return;
    const nozzles = await nozzlesResponse.json();

    if (nozzles.length === 0) return;

    const paddedAddress = dispenser.address;
    const dispenserTopic = `D${paddedAddress}`;

    const { card, titleContainer } = await createCard(dispenserTopic, `Station: ${dispenser.customer_code}`);

    card.id = `dispenser-${dispenser.dispenser_id}`;
    card.dataset.address = dispenserTopic;

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
    if (cardRole === 'admin' || cardRole === 'operator') {
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
}

async function updateDispenserCard(dispenser) {
    const card = document.getElementById(`dispenser-${dispenser.dispenser_id}`);
    if (!card) return;

    if (typeof window.updateIRStatus === 'function') {
        const dispenserAddr = dispenser.address;
        window.updateIRStatus(`D${dispenserAddr}`, dispenser.ir_lock_status ? 1 : 0);
    }

    if (typeof window.updateConnStatus === 'function') {
        const dispenserAddr = dispenser.address;
        window.updateConnStatus(`D${dispenserAddr}`, dispenser.conn_status ? 1 : 0, dispenser.connected_at);
    }

    // Update error count
    const dispenserTopic = `D${dispenser.address}`;
    if (typeof window.updateErrorCount === 'function') {
        await window.updateErrorCount(dispenserTopic);
    }

    // Update reset count
    if (typeof window.updateResetCount === 'function') {
        await window.updateResetCount(dispenserTopic);
    }

    try {
        const nozzlesResponse = await fetch(
            `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
        );
        if (!nozzlesResponse.ok) return;
        const nozzles = await nozzlesResponse.json();

        // Use Promise.all to handle async operations in parallel
        await Promise.all(nozzles.map(async (nozzle) => {
            const nozzleData = window.NozzleData(nozzle);

            // Add dispenserTopic if it doesn't exist
            if (!nozzleData.dispenserTopic) {
                nozzleData.dispenserTopic = `D${dispenser.address}`;
            }

            // Handle error count fetching properly
            if (typeof window.fetchErrorCount === 'function') {
                try {
                    const errorCount = await window.fetchErrorCount(nozzleData.dispenserTopic);
                    nozzleData.errorCount = errorCount;
                } catch (error) {
                    console.error('Error fetching error count for nozzle:', nozzle.nozzle_id, error);
                    nozzleData.errorCount = 0; // Default value
                }
            }

            if (typeof window.updateNozzleUI === 'function') {
                window.updateNozzleUI(nozzle.nozzle_id, nozzleData);
            }
        }));
    } catch (error) {
        console.error('Error updating nozzle data:', error);
    }
}

window.renderDispenser = renderDispenser;