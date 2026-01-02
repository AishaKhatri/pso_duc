let updateInterval;

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

    try {
        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();

        const {headerContainer, optionsContainer, gridContainer} = renderPageHeader('Dispenser Unit Control - DUC')    
        
        const configButton = createMainButton();
        configButton.textContent = 'Configure Dispensers';
        configButton.addEventListener('click', () => {
            window.location.href = 'dispensers/config-dispensers.html';
        });

        const updatePricesButton = createMainButton();
        updatePricesButton.textContent = 'Update Prices';
        updatePricesButton.addEventListener('click', () => {
            if (typeof window.showPriceUpdatePopup === 'function') {
                window.showPriceUpdatePopup();
            } else {
                const script = document.createElement('script');
                script.src = 'dispensers/price-update.js';
                script.onload = () => {
                    if (typeof window.showPriceUpdatePopup === 'function') {
                        window.showPriceUpdatePopup();
                    }
                };
                document.head.appendChild(script);
            }
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
        optionsContainer.appendChild(updatePricesButton);
        optionsContainer.appendChild(configButton);
        headerContainer.appendChild(optionsContainer);
        content.appendChild(headerContainer);

        gridContainer.id = 'dispenser-grid';

        if (dispensers.length === 0) {
            const message = createNoDataMessage('No dispensers configured');
            message.style.padding = '40px';
            message.style.width = '100%';
            gridContainer.appendChild(message);
        } else {
            for (const dispenser of dispensers) {
                await createDispenserCard(dispenser, gridContainer);
            }
        }

        content.appendChild(gridContainer);

        if (dispensers.length > 0) {
            initializeMQTT(dispensers);

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
        console.error('Error rendering dispenser:', error);
        content.innerHTML = `<div class="error">Error loading dispenser data: ${error.message}</div>`;
    }
}

async function createDispenserCard(dispenser, gridContainer) {
    const nozzlesResponse = await fetch(
        `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}`
    );
    if (!nozzlesResponse.ok) return;
    const nozzles = await nozzlesResponse.json();

    if (nozzles.length === 0) return;

    const paddedAddress = dispenser.address.padStart(5, '0');
    const dispenserTopic = `D${paddedAddress}`;

    const { card, titleContainer } = createCard(`Dispenser ${dispenser.dispenser_id}`, dispenserTopic);

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

    const irControlIcon = createIconFromImage('assets/graphics/ir-control-icon.png', 'IR Control', '25px');

    const irLockIcon = createIconFromImage('assets/graphics/ir-control-icon.png', null, '25px');
    irLockIcon.className = 'ir-lock-icon';
    irLockIcon.src = dispenser.ir_lock_status ? 
        'assets/graphics/green-lock.png' : 'assets/graphics/red-unlock.png';
    irLockIcon.alt = dispenser.ir_lock_status ? 'Locked' : 'Unlocked';

    irStatusContainer.appendChild(irControlIcon);
    irStatusContainer.appendChild(irLockIcon);
    titleContainer.appendChild(irStatusContainer);

    const refreshButton = createIconFromImage('assets/graphics/refresh-icon.png', 'Refresh', '25px');
    refreshButton.style.position = 'absolute';
    refreshButton.style.top = '0';
    refreshButton.style.left = '65%';
    refreshButton.style.cursor = 'pointer';
    refreshButton.style.transition = 'transform 0.2s ease'; // Add smooth transition
    refreshButton.title = 'Refresh';
    refreshButton.addEventListener('click', () => {
        sendGetCommandsForDispenser(dispenser);
    });

    // Add hover effect to enlarge the button slightly
    refreshButton.addEventListener('mouseover', () => {
        refreshButton.style.transform = 'scale(1.05)'; // Enlarge by 10%
    });

    // Return to normal size when mouse leaves
    refreshButton.addEventListener('mouseout', () => {
        refreshButton.style.transform = 'scale(1)'; // Return to original size
    });

    titleContainer.appendChild(refreshButton);

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

        if (typeof window.createNozzleLayout === 'function') {
            try {
                setTimeout(() => {
                    window.createNozzleLayout(nozzleContainer.id, nozzleData);
                }, 50);
            } catch (e) {
                console.error('Nozzle layout error:', e);
                nozzleContainer.innerHTML = `Error: ${e.message}`;
            }
        }
    });
}

async function updateDispenserCard(dispenser) {
    const card = document.getElementById(`dispenser-${dispenser.dispenser_id}`);
    if (!card) return;

    if (typeof window.updateIRStatus === 'function') {
        const dispenserAddr = dispenser.address.padStart(5, '0');
        window.updateIRStatus(`D${dispenserAddr}`, dispenser.ir_lock_status ? 1 : 0);
    } else {
        console.warn('updateIRStatus function not available');
    }

    if (typeof window.updateConnStatus === 'function') {
        const dispenserAddr = dispenser.address.padStart(5, '0');
        window.updateConnStatus(`D${dispenserAddr}`, dispenser.conn_status ? 1 : 0, dispenser.connected_at);
    } else {
        console.warn('updateConnStatus function not available');
    }

    try {
        const nozzlesResponse = await fetch(
            `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}`
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

function initializeMQTT(dispensers) {
    initializeMQTTClient(() => {
        dispensers.forEach(dispenser => {
            const topic = `S${dispenser.address.padStart(5, '0')}`;
            subscribeToTopic(topic, async (receivedTopic, message) => {
                const messageStr = message.toString();
                console.log(`Received message on ${receivedTopic}: ${messageStr}`);

                try {
                    const data = JSON.parse(messageStr);
                    const dispenserAddr = data.dis_addr;
                    const side = data.side === '0' || data.side === 'A' ? 'A' : 
                                 data.side === '1' || data.side === 'B' ? 'B' : 
                                 'Unknown';                      
                    const nozzleNum = data.noz_number;
                    const nozzleId = `${dispenserAddr}-${side}${nozzleNum}`;

                    switch(data.msg_type) {
                        case 0: // Online/offline status
                            window.updateNozzleStatus?.(nozzleId, parseInt(data.message));
                            // await generateNotification('Online', `Nozzle ${nozzleId} is online`, type = 'success')
                            break;
                        case 1: // Price per liter
                            window.updatePricePerLiter?.(nozzleId, parseFloat(data.message));
                            break;
                        case 2: // Total quantity
                            window.updateTotalQuantity?.(nozzleId, parseFloat(data.message));
                            break;
                        case 3: // Total sales
                            window.updateTotalSales?.(nozzleId, parseFloat(data.message));
                            break;
                        case 4: // Nozzle lock
                            window.updateNozzleLockStatus?.(nozzleId, parseInt(data.message));
                            break;
                        case 5: // Keypad lock
                            window.updateKeypadLockStatus?.(nozzleId, parseInt(data.message));
                            break;
                        case 6: // IR lock
                            window.updateIRStatus?.(dispenserAddr, parseInt(data.message));
                            break;
                        case 7: // Transaction data
                            window.updateNozzleTransaction?.(nozzleId, data.message);
                            break;
                        default:
                            // console.warn('Unknown message type:', data.msg_type);
                    }
                } catch (error) {
                    console.error('Error processing MQTT message:', error);
                }
            });
        });
    }, (err) => {
        console.error('MQTT connection error:', err);
    });
}

window.renderDispenser = renderDispenser;