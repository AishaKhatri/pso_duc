let updateInterval;

async function renderOverview() {
    const content = document.getElementById('content');
    if (!content) {
        console.error('Content element not found');
        return;
    }
    content.innerHTML = '';

    try {
        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();

        const {headerContainer, optionsContainer, gridContainer} = renderPageHeader('DUC - Overview')    
        content.appendChild(headerContainer);

        if (dispensers.length === 0) {
            const message = createNoDataMessage('No dispensers configured');
            message.style.padding = '40px';
            message.style.width = '100%';
            gridContainer.appendChild(message);
        } else {
            // Use station-wise rendering with SUMMARY layout
            await window.renderStationWiseDispensers(dispensers, gridContainer, createDispenserCard, { layoutType: window.NOZZLE_LAYOUTS.SUMMARY });
        }

        content.appendChild(gridContainer);

        if (dispensers.length > 0) {
            updateInterval = setInterval(async () => {
                console.log('Performing periodic update of dispenser data...');
                try {
                    const updatedDispensersResponse = await fetch(`${API_BASE_URL}/dispensers`);
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
        console.error('Error rendering overview:', error);
        content.innerHTML = `<div class="error">Error loading overview: ${error.message}</div>`;
    } 
}

async function createDispenserCard(dispenser, gridContainer, params = {}) {
    const layoutType = params.layoutType || window.NOZZLE_LAYOUTS.SUMMARY;
    
    const nozzlesResponse = await fetch(
        `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
    );
    if (!nozzlesResponse.ok) return;
    const nozzles = await nozzlesResponse.json();

    if (nozzles.length === 0) return;

    const paddedAddress = dispenser.address;
    const dispenserTopic = `D${paddedAddress}`;

    const { card, titleContainer } = createCard(dispenserTopic, `Station: ${dispenser.customer_code}`);

    card.id = `dispenser-${dispenser.dispenser_id}`;
    card.dataset.address = dispenserTopic;

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

        const nozzleData = window.NozzleData(nozzle);
        
        if (typeof window.setNozzleLayoutType === 'function') {
            window.setNozzleLayoutType(nozzle.nozzle_id, layoutType);
        }

        if (typeof window.createNozzleLayout === 'function') {
            try {
                setTimeout(() => {
                    window.createNozzleLayout(nozzleContainer.id, nozzleData, layoutType);
                }, 50);
            } catch (e) {
                console.error('Nozzle summary error:', e);
                nozzleContainer.innerHTML = `Error: ${e.message}`;
            }
        }
    });
}

async function updateDispenserCard(dispenser) {
    const card = document.getElementById(`dispenser-${dispenser.dispenser_id}`);
    if (!card) return;

    if (typeof window.updateConnStatus === 'function') {
        const dispenserAddr = dispenser.address;
        window.updateConnStatus(`D${dispenserAddr}`, dispenser.conn_status ? 1 : 0, dispenser.connected_at);
    }

    try {
        const nozzlesResponse = await fetch(
            `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
        );
        if (!nozzlesResponse.ok) return;
        const nozzles = await nozzlesResponse.json();

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