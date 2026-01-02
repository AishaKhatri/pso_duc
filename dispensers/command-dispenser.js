async function showCommandDispenserPopup() {
    const overlay = createModalOverlay();

    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '500px';
    popup.style.maxHeight = '80vh';
    dragPopup(overlay, popup);

    const header = createHeader();
        
    const title = createTitle();
    title.textContent = 'Dispenser Commands';

    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const dispenserLabel = document.createElement('label');
    dispenserLabel.textContent = 'Select Dispenser:';
    dispenserLabel.style.display = 'block';
    dispenserLabel.style.marginBottom = '8px';
    dispenserLabel.style.fontWeight = 'bold';
    popup.appendChild(dispenserLabel);

    const dispenserSelect = createDropdown('Select dispenser');
    dispenserSelect.id = 'dispenserSelect';

    // Fetch dispensers from API
    let validDispensers = [];
    try {
        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();

        for (const dispenser of dispensers) {
            const nozzlesResponse = await fetch(
                `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}`
            );
            if (!nozzlesResponse.ok) continue;
            const nozzles = await nozzlesResponse.json();
            if (nozzles.length > 0) {
                validDispensers.push({ ...dispenser, nozzles });
            }
        }

        validDispensers.forEach((dispenser, index) => {
            const option = document.createElement('option');
            option.value = dispenser.address.padStart(5, '0');
            option.textContent = `Dispenser ${index + 1} (D${option.value})`;
            dispenserSelect.appendChild(option);
        });
    } catch (error) {
        showCommandStatusMessage(`Error fetching dispensers: ${error.message}`, 'error');
    }

    popup.appendChild(dispenserSelect);

    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'dispenserControls';
    controlsContainer.style.marginTop = '20px';
    popup.appendChild(controlsContainer);

    const statusContainer = document.createElement('div');
    statusContainer.id = 'commandStatus';
    statusContainer.style.marginBottom = '20px';
    popup.appendChild(statusContainer);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    initializeMQTTClient(null, (err) => {
        showCommandStatusMessage('MQTT connection error: ' + err.message, 'error');
    });

    dispenserSelect.addEventListener('change', () => {
        if (dispenserSelect.value) {
            showDispenserControls(dispenserSelect.value, validDispensers);
        } else {
            controlsContainer.innerHTML = '';
        }
    });

    if (validDispensers.length === 1) {
        dispenserSelect.value = validDispensers[0].address.padStart(5, '0');
        showDispenserControls(dispenserSelect.value, validDispensers);
    }
}

function showCommandStatusMessage(message, type) {
    const statusContainer = document.getElementById('commandStatus');
    statusContainer.innerHTML = '';

    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.style.padding = '10px';
    messageElement.style.borderRadius = '4px';
    messageElement.style.marginBottom = '10px';
    messageElement.style.marginTop = '20px';

    if (type === 'error') {
        messageElement.style.backgroundColor = '#ffebee';
        messageElement.style.color = '#c62828';
        messageElement.style.border = '1px solid #ef9a9a';
    } else {
        messageElement.style.backgroundColor = '#e8f5e9';
        messageElement.style.color = '#2e7d32';
        messageElement.style.border = '1px solid #a5d6a7';
    }

    statusContainer.appendChild(messageElement);
}

function showDispenserControls(dispenserAddr, dispensers) {
    const dispenser = dispensers.find(d => d.address.padStart(5, '0') === dispenserAddr);
    if (!dispenser) return;

    const controlsContainer = document.getElementById('dispenserControls');
    controlsContainer.innerHTML = '';

    const dispenserTopic = `D${dispenserAddr}`;

    // Create IR Control Section
    createIRControlSection(dispenserTopic, controlsContainer);

    // Create Nozzles Section
    createNozzlesSection(dispenserTopic, dispenser.nozzles, controlsContainer);
}

// Helper function to create control row with dropdown and confirm button
function createControlRow(label, dropdownId, value, options, onConfirm) {
    const controlRow = document.createElement('div');
    controlRow.style.display = 'flex';
    controlRow.style.alignItems = 'center';
    controlRow.style.marginBottom = '12px';
    controlRow.style.gap = '12px';

    const labelElement = document.createElement('label');
    labelElement.textContent = label;
    labelElement.style.fontWeight = 'bold';
    labelElement.style.fontSize = '14px';

    const dropdown = createDropdown();
    dropdown.id = dropdownId;
    dropdown.style.width = '100px';
    dropdown.style.marginBottom = '0';

    options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.text;
        if (option.value === value) {
            optionElement.selected = true;
        }
        dropdown.appendChild(optionElement);
    });

    const confirmButton = createActionButton();
    confirmButton.textContent = '✓';
    confirmButton.style.padding = '4px 10px';
    confirmButton.style.fontSize = '12px';
    confirmButton.addEventListener('click', onConfirm);

    controlRow.appendChild(labelElement);
    controlRow.appendChild(dropdown);
    controlRow.appendChild(confirmButton);

    return { controlRow, dropdown, confirmButton };
}

function createIRControlSection(dispenserTopic, container) {
    const irSection = document.createElement('div');
    irSection.style.marginBottom = '30px';

    const irTitle = document.createElement('h3');
    irTitle.textContent = 'IR Control';
    irTitle.style.marginTop = '0';
    irTitle.style.borderBottom = '1px solid #eee';
    irTitle.style.paddingBottom = '8px';
    irSection.appendChild(irTitle);

    const { controlRow, dropdown, confirmButton } = createControlRow(
        'IR Control:',
        'irControl',
        '0', // Default to Unlock
        [
            { value: '0', text: 'Unlock' },
            { value: '1', text: 'Lock' }
        ],
        () => sendDispenserCommand(dispenserTopic, {
            dis_addr: dispenserTopic,
            req_type: 0,
            side: '0',
            noz_number: 1,
            msg_type: 6,
            message: dropdown.value
        }, confirmButton, `IR ${dropdown.value === '0' ? 'Unlock' : 'Lock'}`)
    );

    irSection.appendChild(controlRow);
    container.appendChild(irSection);
}

function createNozzlesSection(dispenserTopic, nozzles, container) {
    const nozzlesTitle = document.createElement('h3');
    nozzlesTitle.textContent = 'Nozzle Controls';
    nozzlesTitle.style.marginTop = '0';
    nozzlesTitle.style.borderBottom = '1px solid #eee';
    nozzlesTitle.style.paddingBottom = '8px';
    container.appendChild(nozzlesTitle);

    const nozzlesGrid = document.createElement('div');
    nozzlesGrid.style.display = 'grid';
    nozzlesGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    nozzlesGrid.style.gap = '15px';
    nozzlesGrid.style.marginTop = '10px';

    const config = { header: '#FF7043', accent: '#FFCCBC' };

    nozzles.forEach(nozzle => {
        const nozzleCard = createNozzleCard(dispenserTopic, nozzle, config);
        nozzlesGrid.appendChild(nozzleCard);
    });

    container.appendChild(nozzlesGrid);
}

function createNozzleCard(dispenserTopic, nozzle, config) {
    const nozzleCard = document.createElement('div');
    nozzleCard.style.position = 'relative';
    nozzleCard.style.borderRadius = '8px';
    nozzleCard.style.background = '#ffffff';
    nozzleCard.style.fontFamily = 'Segoe UI, sans-serif';
    nozzleCard.style.color = '#333';
    nozzleCard.style.boxShadow = '0 3px 10px rgba(0, 0, 0, 0.06)';
    nozzleCard.style.overflow = 'hidden';
    nozzleCard.style.padding = '0';
    nozzleCard.style.border = nozzle.lock_unlock ? '2px solid #D32F2F' : '0.5px solid #dddddd';
    nozzleCard.style.width = '220px';

    // Create header
    const header = document.createElement('div');
    header.style.background = config.header;
    header.style.color = '#111111';
    header.style.padding = '4px 8px 4px';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.borderBottom = `4px solid ${config.accent}`;

    const nozzleLeft = document.createElement('div');
    nozzleLeft.style.display = 'flex';
    nozzleLeft.style.alignItems = 'center';
    nozzleLeft.style.gap = '8px';

    const nozzleIcon = document.createElement('img');
    nozzleIcon.src = 'assets/graphics/nozzle-icon.png';
    nozzleIcon.alt = 'Nozzle Icon';
    nozzleIcon.style.width = '40px';
    nozzleIcon.style.height = '40px';
    nozzleIcon.style.objectFit = 'contain';

    const nozzleNumber = document.createElement('div');
    nozzleNumber.style.fontSize = '36px';
    nozzleNumber.style.fontWeight = 'bold';
    const shortNozzleId = nozzle.nozzle_id.split('-').pop();
    nozzleNumber.textContent = shortNozzleId.padStart(2, '0');

    nozzleLeft.appendChild(nozzleIcon);
    nozzleLeft.appendChild(nozzleNumber);
    header.appendChild(nozzleLeft);
    nozzleCard.appendChild(header);

    // Create content with controls
    const content = document.createElement('div');
    content.style.padding = '12px';

    // Parse nozzle ID for side and number
    const [_, side, number] = nozzle.nozzle_id.match(/D\d+-([AB])(\d+)/);
    const sideValue = side === 'A' ? '0' : '1';
    const nozzleNum = parseInt(number);

    // Nozzle Lock Control
    const { controlRow: nozzleLockRow, dropdown: nozzleLockDropdown, confirmButton: nozzleLockButton } = createControlRow(
        'Nozzle:',
        `nozzleLock-${nozzle.nozzle_id}`,
        nozzle.lock_unlock ? '1' : '0',
        [
            { value: '0', text: 'Unlock' },
            { value: '1', text: 'Lock' }
        ],
        () => sendDispenserCommand(dispenserTopic, {
            dis_addr: dispenserTopic,
            req_type: 0,
            side: sideValue,
            noz_number: nozzleNum,
            msg_type: 4,
            message: nozzleLockDropdown.value
        }, nozzleLockButton, `Nozzle ${number} Lock ${nozzleLockDropdown.value === '0' ? 'Unlock' : 'Lock'}`)
    );
    content.appendChild(nozzleLockRow);

    // Keypad Lock Control
    const { controlRow: keypadLockRow, dropdown: keypadLockDropdown, confirmButton: keypadLockButton } = createControlRow(
        'Keypad:',
        `keypadLock-${nozzle.nozzle_id}`,
        nozzle.keypad_lock_status === 'Lock' ? '1' : '0',
        [
            { value: '0', text: 'Unlock' },
            { value: '1', text: 'Lock' }
        ],
        () => sendDispenserCommand(dispenserTopic, {
            dis_addr: dispenserTopic,
            req_type: 0,
            side: sideValue,
            noz_number: nozzleNum,
            msg_type: 5,
            message: keypadLockDropdown.value
        }, keypadLockButton, `Nozzle ${number} Keypad ${keypadLockDropdown.value === '0' ? 'Unlock' : 'Lock'}`)
    );
    content.appendChild(keypadLockRow);

    nozzleCard.appendChild(content);
    return nozzleCard;
}

// Common function to send any dispenser command
async function sendDispenserCommand(topic, message, button, commandName = 'Command') {
    const originalText = button.textContent;
    
    button.disabled = true;
    button.textContent = 'Sending...';
    
    try {
        console.group(`Sending ${commandName}`);
        console.log('Topic:', topic);
        console.log('Message:', message);
        console.log('Timestamp:', new Date().toISOString());

        const result = await new Promise((resolve) => {
            publishMessage(topic, JSON.stringify(message), (err) => {
                console.log(err ? 'Publish error:' : 'Publish successful:', err || 'OK');
                resolve({ success: !err, error: err });
            });
        });

        console.groupEnd();

        if (result.success) {
            showCommandStatusMessage(`${commandName} sent successfully`, 'success');
        } else {
            throw new Error(result.error || `Failed to send ${commandName}`);
        }
    } catch (error) {
        console.error(`${commandName} failed:`, error);
        showCommandStatusMessage(`Error: ${error.message}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

window.showCommandDispenserPopup = showCommandDispenserPopup;