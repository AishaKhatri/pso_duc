let updateInterval;

async function renderOverview() {
    const content = document.getElementById('content');
    if (!content) {
        console.error('Content element not found');
        return;
    }
    content.innerHTML = '';

    const loader = createPageLoader('Loading overview…');
    content.appendChild(loader);

    try {
        // /dispensers-full returns each dispenser with its nozzles[] and station
        // attached in one round trip (avoids 1 + N nozzle fetches + S station fetches).
        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers-full`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();
        loader.remove();

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.justifyContent = 'flex-end';
        topRow.style.marginBottom = '8px';
        const lastUpdatedEl = document.createElement('div');
        lastUpdatedEl.id = 'page-last-updated';
        lastUpdatedEl.style.fontSize = '12px';
        lastUpdatedEl.style.color = 'var(--text-secondary)';
        const refreshTimestamp = () => {
            lastUpdatedEl.textContent = `Last Updated: ${new Date().toLocaleString()}`;
        };
        refreshTimestamp();
        topRow.appendChild(lastUpdatedEl);
        content.appendChild(topRow);

        const gridContainer = document.createElement('div');
        gridContainer.style.display = 'flex';
        gridContainer.style.flexWrap = 'wrap';
        gridContainer.style.gap = '15px';
        gridContainer.style.justifyContent = 'flex-start';
        // Attach BEFORE rendering — see the matching comment in dispenser.js for why.
        content.appendChild(gridContainer);

        if (dispensers.length === 0) {
            const message = createNoDataMessage('No dispensers configured');
            message.style.padding = '40px';
            message.style.width = '100%';
            gridContainer.appendChild(message);
        } else {
            // Use station-wise rendering with SUMMARY layout
            await window.renderStationWiseDispensers(dispensers, gridContainer, createDispenserCard, { layoutType: window.NOZZLE_LAYOUTS.SUMMARY });
        }

        if (dispensers.length > 0) {
            updateInterval = setInterval(async () => {
                console.log('Performing periodic update of dispenser data...');
                try {
                    const updatedDispensersResponse = await fetch(`${API_BASE_URL}/dispensers-full`);
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
        console.error('Error rendering overview:', error);
        content.innerHTML = `<div class="error">Error loading overview: ${error.message}</div>`;
    } 
}

async function createDispenserCard(dispenser, gridContainer, params = {}) {
    const layoutType = params.layoutType || window.NOZZLE_LAYOUTS.SUMMARY;

    // Prefer nozzles attached by /dispensers-full; fall back to a per-card fetch.
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

    const nozzleGrid = document.createElement('div');
    nozzleGrid.style.display = 'grid';
    nozzleGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    nozzleGrid.style.gap = '15px';
    nozzleGrid.style.marginTop = '10px';
    card.appendChild(nozzleGrid);
    gridContainer.appendChild(card);

    nozzles.forEach(nozzle => {
        const nozzleContainer = document.createElement('div');
        nozzleContainer.id = `nozzle-${nozzle.nozzle_id}`;
        nozzleGrid.appendChild(nozzleContainer);

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

    card.dataset.connStatus = dispenser.conn_status ? '1' : '0';

    if (typeof window.updateConnStatus === 'function') {
        window.updateConnStatus(ensureDAddress(dispenser.address), dispenser.conn_status ? 1 : 0, dispenser.connected_at);
    }

    // Update error count
    const dispenserTopic = ensureDAddress(dispenser.address);
    if (typeof window.updateErrorCount === 'function') {
        await window.updateErrorCount(dispenserTopic);
    }

    // Update reset count
    if (typeof window.updateResetCount === 'function') {
        await window.updateResetCount(dispenserTopic);
    }

    try {
        // Use attached nozzles when present (from /dispensers-full), else fetch.
        let nozzles = Array.isArray(dispenser.nozzles) ? dispenser.nozzles : null;
        if (!nozzles) {
            const nozzlesResponse = await fetch(
                `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
            );
            if (!nozzlesResponse.ok) return;
            nozzles = await nozzlesResponse.json();
        }

        nozzles.forEach(nozzle => {
            const nozzleData = window.NozzleData(nozzle);

            if (typeof window.updateNozzleUI === 'function') {
                window.updateNozzleUI(nozzle.nozzle_id, nozzleData);
            }
        });
    } catch (error) {
        console.error('Error updating nozzle data:', error);
    }
}

window.renderOverview = renderOverview;