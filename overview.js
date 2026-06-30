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

    const stage = document.createElement('div');
    stage.style.display = 'none';
    content.appendChild(stage);

    try {
        // /dispensers-full returns each dispenser with its nozzles[] and station
        // attached in one round trip (avoids 1 + N nozzle fetches + S station fetches).
        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers-full`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();

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
        stage.appendChild(topRow);

        const gridContainer = document.createElement('div');
        gridContainer.style.display = 'flex';
        gridContainer.style.flexWrap = 'wrap';
        gridContainer.style.gap = '15px';
        gridContainer.style.justifyContent = 'flex-start';
        stage.appendChild(gridContainer);

        // Sticky right-side Alarms panel (Check Prices etc.). Reserve right
        // padding on the stage so cards don't render under the fixed panel.
        // The panel broadcasts 'alarms-panel-resize' when collapsed/expanded
        // so the gutter can shrink/grow accordingly.
        if (typeof window.createAlarmsPanel === 'function') {
            const alarmsPanel = window.createAlarmsPanel();
            stage.appendChild(alarmsPanel);
            stage.style.paddingRight = '305px';
            window.addEventListener('alarms-panel-resize', (e) => {
                stage.style.paddingRight = `${e.detail.reservedRight}px`;
            });
        }

        if (dispensers.length === 0) {
            const message = createNoDataMessage('No dispensers configured');
            message.style.padding = '40px';
            message.style.width = '100%';
            gridContainer.appendChild(message);
        } else {
            // Use station-wise rendering with SUMMARY layout
            await window.renderStationWiseDispensers(dispensers, gridContainer, createDispenserCard, { layoutType: window.NOZZLE_LAYOUTS.SUMMARY });
        }

        // Build done — swap loader for the fully-assembled UI in one paint.
        loader.remove();
        stage.style.display = '';

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
            `${API_BASE_URL}/nozzles?dispenser_id=${encodeURIComponent(dispenser.dispenser_id)}&customer_code=${encodeURIComponent(dispenser.customer_code)}`
        );
        if (!nozzlesResponse.ok) return;
        nozzles = await nozzlesResponse.json();
    }

    if (nozzles.length === 0) return;

    const paddedAddress = dispenser.address;
    const dispenserTopic = ensureDAddress(paddedAddress);

    const { card, titleContainer } = await createCard(dispenserTopic, `Station: ${dispenser.customer_code}`, {
        dispenserId: dispenser.dispenser_id,
        brand: dispenser.DispenserBrand
    });

    // ID is the D-prefixed address — globally unique across stations.
    card.id = `dispenser-${dispenserTopic}`;
    card.dataset.address = dispenserTopic;
    card.dataset.connStatus = dispenser.conn_status ? '1' : '0';

    titleContainer.appendChild(createInterfaceStatusIndicator(dispenser));

    const nozzleGrid = document.createElement('div');
    nozzleGrid.style.display = 'grid';
    nozzleGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    nozzleGrid.style.gap = '15px';
    nozzleGrid.style.marginTop = '10px';
    // Reserve approximate vertical space so the page doesn't reflow violently
    // when off-screen cards eventually materialize as the user scrolls.
    nozzleGrid.style.minHeight = `${Math.ceil(nozzles.length / 2) * 90}px`;
    card.appendChild(nozzleGrid);

    card.appendChild(buildDispenserRemarkSection(dispenser));

    gridContainer.appendChild(card);

    // Apply the initial conn_status badge now — without this, the card shows
    // "Connecting…" until the first 10s periodic tick fires.
    if (typeof window.updateConnStatus === 'function') {
        window.updateConnStatus(
            dispenserTopic,
            dispenser.conn_status ? 1 : 0,
            dispenser.connected_at
        );
    }

    // Latest dispenser/nozzle data stays on the card so the periodic 10s tick
    // can refresh it for un-materialized cards too — materialize() reads from
    // here, not the closure, so deferred cards render fresh data when scrolled
    // into view instead of whatever was on screen at first render.
    card._dispenserData = dispenser;
    card._dispenserNozzles = nozzles;
    card._layoutType = layoutType;

    const materialize = () => {
        if (card._materialized) return;
        card._materialized = true;

        const currentNozzles = card._dispenserNozzles || nozzles;
        currentNozzles.forEach(nozzle => {
            const nozzleContainer = document.createElement('div');
            nozzleContainer.id = `nozzle-${nozzle.nozzle_id}`;
            nozzleGrid.appendChild(nozzleContainer);
            if (typeof window.setNozzleLayoutType === 'function') {
                window.setNozzleLayoutType(nozzle.nozzle_id, card._layoutType);
            }
        });
        // Drop the placeholder min-height now that real content fills it.
        nozzleGrid.style.minHeight = '';

        currentNozzles.forEach(nozzle => {
            const nozzleData = window.NozzleData(nozzle);
            if (typeof window.updateNozzleUI === 'function') {
                window.updateNozzleUI(nozzle.nozzle_id, nozzleData);
            }
        });
    };
    card._materialize = materialize;

    // IntersectionObserver materializes off-screen cards lazily. rootMargin
    // pre-renders cards ~400px before they scroll into view, hiding the
    // build latency from the user.
    if (typeof IntersectionObserver === 'function') {
        const io = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    materialize();
                    observer.disconnect();
                }
            });
        }, { rootMargin: '400px 0px' });
        io.observe(card);
    } else {
        // Fallback for ancient browsers — materialize everything immediately.
        materialize();
    }
}

async function updateDispenserCard(dispenser) {
    const card = document.getElementById(`dispenser-${ensureDAddress(dispenser.address)}`);
    if (!card) return;

    card.dataset.connStatus = dispenser.conn_status ? '1' : '0';

    // Refresh the cached payload so a card that hasn't materialized yet (still
    // off-screen) will pop in with fresh nozzle data once it scrolls into view.
    card._dispenserData = dispenser;
    if (Array.isArray(dispenser.nozzles)) {
        card._dispenserNozzles = dispenser.nozzles;
    }

    refreshDispenserRemarkSection(card, dispenser);

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

    // Skip per-nozzle DOM updates for cards that haven't materialized yet —
    // their nozzle <div>s don't exist, so updateNozzleUI would just log a
    // "container not found" warning for each one. Fresh data is already
    // cached on card._dispenserNozzles above, so materialize() will pick
    // it up when the card scrolls into view.
    if (!card._materialized) return;

    try {
        // Use attached nozzles when present (from /dispensers-full), else fetch.
        let nozzles = Array.isArray(dispenser.nozzles) ? dispenser.nozzles : null;
        if (!nozzles) {
            const nozzlesResponse = await fetch(
                `${API_BASE_URL}/nozzles?dispenser_id=${encodeURIComponent(dispenser.dispenser_id)}&customer_code=${encodeURIComponent(dispenser.customer_code)}`
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