async function showCommandDispenserPopup(options = {}) {
    const presetCustomerCode = options.presetCustomerCode || null;
    const overlay = createModalOverlay();

    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '480px';
    popup.style.height = '560px';
    popup.style.maxHeight = '80vh';
    dragPopup(overlay, popup);

    const header = createHeader();
        
    const title = createTitle();
    title.textContent = 'Dispenser Commands';

    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const makeSelectorBlock = (labelText, dropdown) => {
        const container = document.createElement('div');
        container.style.flex = '1 1 calc(50% - 10px)';
        const label = document.createElement('label');
        label.textContent = labelText;
        label.style.display = 'block';
        label.style.marginBottom = '6px';
        label.style.fontWeight = 'bold';
        label.style.fontSize = '13px';
        container.appendChild(label);
        dropdown.style.width = '100%';
        dropdown.style.marginBottom = '0';
        container.appendChild(dropdown);
        return container;
    };

    // Selectors container — city + division on top row, station + dispenser below
    const selectorsContainer = document.createElement('div');
    selectorsContainer.style.display = 'flex';
    selectorsContainer.style.flexWrap = 'wrap';
    selectorsContainer.style.gap = '20px';
    selectorsContainer.style.marginBottom = '20px';
    selectorsContainer.style.width = '100%';

    const citySelect = createDropdown('All Cities');
    citySelect.id = 'citySelect';
    const divisionSelect = createDropdown('All Divisions');
    divisionSelect.id = 'divisionSelect';
    const stationSelect = createDropdown('All Stations');
    stationSelect.id = 'stationSelect';
    const dispenserSelect = createDropdown('Select dispenser');
    dispenserSelect.id = 'dispenserSelect';

    selectorsContainer.appendChild(makeSelectorBlock('Select City:', citySelect));
    selectorsContainer.appendChild(makeSelectorBlock('Select Division:', divisionSelect));
    selectorsContainer.appendChild(makeSelectorBlock('Select Station:', stationSelect));
    selectorsContainer.appendChild(makeSelectorBlock('Select Dispenser:', dispenserSelect));
    popup.appendChild(selectorsContainer);

    // Make all four selectors typeable.
    enhanceSelectAsSearchable(citySelect);
    enhanceSelectAsSearchable(divisionSelect);
    enhanceSelectAsSearchable(stationSelect);
    enhanceSelectAsSearchable(dispenserSelect);

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

    // Store all dispensers and stations data
    let allDispensers = [];
    let stationsMap = new Map();

    // Fetch stations and dispensers
    try {
        const stationsResponse = await fetch(`${API_BASE_URL}/stations`);
        if (!stationsResponse.ok) throw new Error('Failed to fetch stations');
        const stations = await stationsResponse.json();
        
        stations.forEach(station => {
            stationsMap.set(station.customer_code, {
                city: station.city || '',
                division: station.division || '',
                station_id: station.station_id || '',
                customer_code: station.customer_code,
                dispensers: []
            });
        });

        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();

        for (const dispenser of dispensers) {
            const nozzlesResponse = await fetch(
                `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`
            );
            if (!nozzlesResponse.ok) continue;
            const nozzles = await nozzlesResponse.json();
            if (nozzles.length > 0) {
                const dispenserWithNozzles = { ...dispenser, nozzles };
                allDispensers.push(dispenserWithNozzles);
                
                if (stationsMap.has(dispenser.customer_code)) {
                    stationsMap.get(dispenser.customer_code).dispensers.push(dispenserWithNozzles);
                }
            }
        }

        const titleCase = s => (s || '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        const stationsWithDispensers = Array.from(stationsMap.values()).filter(s => s.dispensers.length > 0);

        // Populate City dropdown
        citySelect.innerHTML = '';
        const allCitiesOpt = document.createElement('option');
        allCitiesOpt.value = 'all';
        allCitiesOpt.textContent = 'All Cities';
        citySelect.appendChild(allCitiesOpt);
        const cities = [...new Set(stationsWithDispensers.map(s => s.city).filter(Boolean))].sort();
        cities.forEach(city => {
            const opt = document.createElement('option');
            opt.value = city;
            opt.textContent = titleCase(city);
            citySelect.appendChild(opt);
        });

        const populateDivisionDropdown = (selectedCity) => {
            divisionSelect.innerHTML = '';
            const allOpt = document.createElement('option');
            allOpt.value = 'all';
            allOpt.textContent = 'All divisions';
            divisionSelect.appendChild(allOpt);
            const filtered = selectedCity === 'all'
                ? stationsWithDispensers
                : stationsWithDispensers.filter(s => s.city === selectedCity);
            const divisions = [...new Set(filtered.map(s => s.division).filter(Boolean))].sort();
            divisions.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d;
                opt.textContent = titleCase(d);
                divisionSelect.appendChild(opt);
            });
        };

        const populateStationDropdown = (selectedCity, selectedDivision) => {
            stationSelect.innerHTML = '';
            const allOpt = document.createElement('option');
            allOpt.value = 'all';
            allOpt.textContent = 'All Stations';
            stationSelect.appendChild(allOpt);
            const matches = stationsWithDispensers.filter(s =>
                (selectedCity === 'all' || s.city === selectedCity) &&
                (selectedDivision === 'all' || s.division === selectedDivision)
            );
            matches.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.customer_code;
                const cityName = titleCase(s.city);
                opt.textContent = `${s.customer_code}${cityName ? ` - ${cityName}` : ''} (${s.dispensers.length} dispensers)`;
                stationSelect.appendChild(opt);
            });
        };

        populateDivisionDropdown('all');
        populateStationDropdown('all', 'all');

        // If invoked from a customer-filtered dispenser page, pre-select that station's
        // city/division/station so the operator does not have to drill back down.
        if (presetCustomerCode) {
            const presetStation = stationsMap.get(presetCustomerCode);
            if (presetStation && presetStation.dispensers.length > 0) {
                if (presetStation.city) {
                    citySelect.value = presetStation.city;
                    populateDivisionDropdown(presetStation.city);
                }
                if (presetStation.division) {
                    divisionSelect.value = presetStation.division;
                }
                populateStationDropdown(citySelect.value, divisionSelect.value);
                stationSelect.value = presetCustomerCode;
            }
        }

        citySelect.addEventListener('change', () => {
            populateDivisionDropdown(citySelect.value);
            populateStationDropdown(citySelect.value, divisionSelect.value);
            populateDispenserDropdown(stationSelect.value);
            controlsContainer.innerHTML = '';
        });

        divisionSelect.addEventListener('change', () => {
            populateStationDropdown(citySelect.value, divisionSelect.value);
            populateDispenserDropdown(stationSelect.value);
            controlsContainer.innerHTML = '';
        });

    } catch (error) {
        showCommandStatusMessage(`Error fetching data: ${error.message}`, 'error');
    }

    function populateDispenserDropdown(selectedStation) {
        dispenserSelect.innerHTML = '';

        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select dispenser';
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        dispenserSelect.appendChild(placeholderOption);

        let dispensersToShow = [];

        if (selectedStation === 'all' || !selectedStation) {
            // Cascade from city/division selections: only stations visible in stationSelect contribute
            const visibleStationCodes = Array.from(stationSelect.options)
                .map(o => o.value)
                .filter(v => v && v !== 'all');
            const visibleSet = new Set(visibleStationCodes);
            dispensersToShow = allDispensers.filter(d => visibleSet.has(d.customer_code));
        } else {
            const stationInfo = stationsMap.get(selectedStation);
            if (stationInfo) {
                dispensersToShow = stationInfo.dispensers;
            }
        }
        
        dispensersToShow.forEach((dispenser, index) => {
            const option = document.createElement('option');
            option.value = dispenser.address;
            option.textContent = `Dispenser ${index + 1} (D${dispenser.address})`;
            option.dataset.customerCode = dispenser.customer_code;
            option.dataset.city = stationsMap.get(dispenser.customer_code)?.city || '';
            dispenserSelect.appendChild(option);
        });
        
        if (dispensersToShow.length === 0) {
            controlsContainer.innerHTML = '';
            const noDispenserMsg = document.createElement('div');
            noDispenserMsg.textContent = 'No dispensers available for this station';
            noDispenserMsg.style.padding = '20px';
            noDispenserMsg.style.textAlign = 'center';
            noDispenserMsg.style.color = '#666';
            controlsContainer.appendChild(noDispenserMsg);
        } else {
            controlsContainer.innerHTML = '';
        }
    }

    stationSelect.addEventListener('change', () => {
        const selectedStation = stationSelect.value;
        populateDispenserDropdown(selectedStation);
        controlsContainer.innerHTML = '';
    });

    dispenserSelect.addEventListener('change', () => {
        const selectedAddress = dispenserSelect.value;
        if (selectedAddress) {
            const selectedOption = dispenserSelect.selectedOptions[0];
            const customerCode = selectedOption?.dataset.customerCode;
            const city = selectedOption?.dataset.city;
            const dispenser = allDispensers.find(d => d.address === selectedAddress && d.customer_code === customerCode);
            if (dispenser) {
                showDispenserControls(dispenser, customerCode, city);
            }
        } else {
            controlsContainer.innerHTML = '';
        }
    });

    if (allDispensers.length > 0) {
        populateDispenserDropdown(stationSelect.value || 'all');
    }
}

function showCommandStatusMessage(message, type) {
    const statusContainer = document.getElementById('commandStatus');
    if (!statusContainer) return;
    
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

function showDispenserControls(dispenser, customerCode, city) {
    const controlsContainer = document.getElementById('dispenserControls');
    if (!controlsContainer) return;
    
    controlsContainer.innerHTML = '';

    const dispenserTopic = `D${dispenser.address}`;

    createIRControlSection(dispenserTopic, controlsContainer, customerCode, city);
    createNozzlesSection(dispenserTopic, dispenser.nozzles, controlsContainer, customerCode, city);
}

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

function createIRControlSection(dispenserTopic, container, customerCode, city) {
    const irSection = document.createElement('div');
    irSection.style.marginBottom = '30px';

    const irTitle = document.createElement('h3');
    irTitle.textContent = 'IR Control';
    irTitle.style.marginTop = '0';
    irTitle.style.borderBottom = '1px solid var(--border)';
    irTitle.style.paddingBottom = '8px';
    irTitle.style.color = 'var(--text-primary)';
    irSection.appendChild(irTitle);

    const { controlRow, dropdown, confirmButton } = createControlRow(
        'IR Control:',
        'irControl',
        '0',
        [
            { value: '0', text: 'Unlock' },
            { value: '1', text: 'Lock' }
        ],
        () => sendDispenserCommand(dispenserTopic, customerCode, city, {
            dis_addr: dispenserTopic,
            req_type: 0,
            side: 'A',
            noz_number: 1,
            msg_type: 6,
            message: dropdown.value
        }, confirmButton, `IR ${dropdown.value === '0' ? 'Unlock' : 'Lock'}`)
    );

    irSection.appendChild(controlRow);
    container.appendChild(irSection);
}

function createNozzlesSection(dispenserTopic, nozzles, container, customerCode, city) {
    const nozzlesTitle = document.createElement('h3');
    nozzlesTitle.textContent = 'Nozzle Controls';
    nozzlesTitle.style.marginTop = '0';
    nozzlesTitle.style.borderBottom = '1px solid var(--border)';
    nozzlesTitle.style.paddingBottom = '8px';
    nozzlesTitle.style.color = 'var(--text-primary)';
    container.appendChild(nozzlesTitle);

    const nozzlesGrid = document.createElement('div');
    nozzlesGrid.style.display = 'grid';
    nozzlesGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    nozzlesGrid.style.gap = '15px';
    nozzlesGrid.style.marginTop = '10px';

    nozzles.forEach(nozzle => {
        const product = normalizeFuelType(nozzle.product);
        const nozzleCard = createNozzleCard(dispenserTopic, nozzle, customerCode, city, productColorConfig[product]);
        nozzlesGrid.appendChild(nozzleCard);
    });

    container.appendChild(nozzlesGrid);
}

function createNozzleCard(dispenserTopic, nozzle, customerCode, city, colorConfig) {
    const nozzleCard = document.createElement('div');
    nozzleCard.style.position = 'relative';
    nozzleCard.style.borderRadius = '8px';
    nozzleCard.style.background = 'var(--bg-surface)';
    nozzleCard.style.fontFamily = 'Segoe UI, sans-serif';
    nozzleCard.style.color = 'var(--text-primary)';
    nozzleCard.style.boxShadow = 'var(--shadow-card)';
    nozzleCard.style.overflow = 'hidden';
    nozzleCard.style.padding = '0';
    nozzleCard.style.border = nozzle.lock_unlock ? '2px solid var(--danger)' : '0.5px solid var(--border)';
    nozzleCard.style.width = '100%';
    nozzleCard.style.minWidth = '0';

    const header = document.createElement('div');
    header.style.background = colorConfig.header;
    header.style.color = '#111111';
    header.style.padding = '4px 8px 4px';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.borderBottom = `4px solid ${colorConfig.accent}`;

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

    const content = document.createElement('div');
    content.style.padding = '12px';

    const [_, side, number] = nozzle.nozzle_id.match(/D\d+-([AB])(\d+)/);
    const nozzleNum = parseInt(number);

    const { controlRow: nozzleLockRow, dropdown: nozzleLockDropdown, confirmButton: nozzleLockButton } = createControlRow(
        'Nozzle:',
        `nozzleLock-${nozzle.nozzle_id}`,
        nozzle.lock_unlock ? '1' : '0',
        [
            { value: '0', text: 'Unlock' },
            { value: '1', text: 'Lock' }
        ],
        () => sendDispenserCommand(dispenserTopic, customerCode, city, {
            dis_addr: dispenserTopic,
            req_type: 0,
            side: side,
            noz_number: nozzleNum,
            msg_type: 4,
            message: nozzleLockDropdown.value
        }, nozzleLockButton, `Nozzle ${number} Lock ${nozzleLockDropdown.value === '0' ? 'Unlock' : 'Lock'}`)
    );
    content.appendChild(nozzleLockRow);

    const { controlRow: keypadLockRow, dropdown: keypadLockDropdown, confirmButton: keypadLockButton } = createControlRow(
        'Keypad:',
        `keypadLock-${nozzle.nozzle_id}`,
        nozzle.keypad_lock_status === 'Lock' ? '1' : '0',
        [
            { value: '0', text: 'Unlock' },
            { value: '1', text: 'Lock' }
        ],
        () => sendDispenserCommand(dispenserTopic, customerCode, city, {
            dis_addr: dispenserTopic,
            req_type: 0,
            side: side,
            noz_number: nozzleNum,
            msg_type: 5,
            message: keypadLockDropdown.value
        }, keypadLockButton, `Nozzle ${number} Keypad ${keypadLockDropdown.value === '0' ? 'Unlock' : 'Lock'}`)
    );
    content.appendChild(keypadLockRow);

    nozzleCard.appendChild(content);
    return nozzleCard;
}

function normalizeFuelType(product) {
    const productMap = {
        'pmg': 'PMG',
        'hsd': 'HSD',
        'hobc': 'HOBC',
        'pmg 95': 'PMG',
        'high speed diesel': 'HSD',
        'hoc': 'HOBC'
    };
    return productMap[product?.toLowerCase()] || 'HOBC';
}

async function sendDispenserCommand(topic, customerCode, city, message, button, commandName = 'Command') {
    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = 'Sending...';

    try {
        const address = topic.replace(/^D/, '');
        const publishTopic = `pso/${city}/${customerCode}/duc/d${address}`;

        console.group(`Sending ${commandName}`);
        console.log('Publish Topic:', publishTopic);
        console.log('Customer Code:', customerCode);
        console.log('City:', city);
        console.log('Message:', message);
        console.log('Timestamp:', new Date().toISOString());

        const userInfo = (typeof StationAuth !== 'undefined' && StationAuth.getUserInfo()) || null;
        const response = await fetch(`${API_BASE_URL}/dispensers/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: publishTopic,
                message,
                userId: userInfo?.id ?? null,
                username: userInfo?.username ?? null
            })
        });

        const result = await response.json().catch(() => ({}));
        console.log(response.ok ? 'Publish successful:' : 'Publish error:', result);
        console.groupEnd();

        if (response.ok && result.success) {
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