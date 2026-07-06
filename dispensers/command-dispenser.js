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
                `${API_BASE_URL}/nozzles?dispenser_id=${encodeURIComponent(dispenser.dispenser_id)}&customer_code=${encodeURIComponent(dispenser.customer_code)}`
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
            option.textContent = `Dispenser ${index + 1} (${ensureDAddress(dispenser.address)})`;
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
            noDispenserMsg.style.color = 'var(--text-secondary)';
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
        messageElement.style.backgroundColor = 'var(--badge-error-bg)';
        messageElement.style.color = 'var(--badge-error-text)';
        messageElement.style.border = '1px solid var(--badge-error-text)';
    } else {
        messageElement.style.backgroundColor = 'var(--badge-online-bg)';
        messageElement.style.color = 'var(--badge-online-text)';
        messageElement.style.border = '1px solid var(--badge-online-text)';
    }

    statusContainer.appendChild(messageElement);
}

function showDispenserControls(dispenser, customerCode, city) {
    const controlsContainer = document.getElementById('dispenserControls');
    if (!controlsContainer) return;
    
    controlsContainer.innerHTML = '';

    const dispenserTopic = ensureDAddress(dispenser.address);

    createInterfaceControlSection(dispenserTopic, controlsContainer, customerCode, city, dispenser.interface_type || 'ir');
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

function createInterfaceControlSection(dispenserTopic, container, customerCode, city, dispenserInterface) {
    const isKeypad = (dispenserInterface || 'ir').toLowerCase() === 'keypad';
    const sectionLabel = isKeypad ? 'Keypad Control' : 'IR Control';
    const msgType = isKeypad ? 5 : 6;

    const section = document.createElement('div');
    section.style.marginBottom = '30px';

    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = sectionLabel;
    sectionTitle.style.marginTop = '0';
    sectionTitle.style.borderBottom = '1px solid var(--border)';
    sectionTitle.style.paddingBottom = '8px';
    sectionTitle.style.color = 'var(--text-primary)';
    section.appendChild(sectionTitle);

    const { controlRow, dropdown, confirmButton } = createControlRow(
        `${sectionLabel}:`,
        'interfaceControl',
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
            msg_type: msgType,
            message: dropdown.value
        }, confirmButton, `${sectionLabel} ${dropdown.value === '0' ? 'Unlock' : 'Lock'}`)
    );

    section.appendChild(controlRow);
    container.appendChild(section);
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

    nozzleCard.appendChild(content);
    return nozzleCard;
}

function normalizeFuelType(product) {
    // Canonical product code (e.g. 'pmg' -> 'PMG'); unknown products fall back to HOBC.
    const p = (product || '').toUpperCase();
    return PRODUCT_OPTIONS.includes(p) ? p : 'HOBC';
}

// Second-factor gate: before publishing a lock/unlock command, require the
// signed-in user to re-enter their account password. Resolves true only when
// the server confirms the password; false on cancel, mismatch, or error.
function confirmCommandPassword(commandName = 'this command') {
    return new Promise((resolve) => {
        const overlay = createModalOverlay();

        const popup = document.createElement('div');
        popup.className = 'popup-modal';
        popup.style.width = '360px';

        const header = createHeader();
        const title = createTitle();
        title.textContent = 'Confirm Password';
        const closeButton = createCloseButton(overlay);
        header.appendChild(title);
        header.appendChild(closeButton);
        popup.appendChild(header);

        const prompt = document.createElement('div');
        prompt.textContent = `Re-enter your password to publish "${commandName}".`;
        prompt.style.marginBottom = '14px';
        prompt.style.fontSize = '14px';
        prompt.style.color = 'var(--text-secondary)';
        popup.appendChild(prompt);

        const input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'Password';
        input.autocomplete = 'off';
        input.style.width = '100%';
        input.style.boxSizing = 'border-box';
        input.style.padding = '10px';
        input.style.marginBottom = '10px';
        input.style.border = '1px solid var(--border)';
        input.style.borderRadius = '4px';
        input.style.background = 'var(--bg-surface)';
        input.style.color = 'var(--text-primary)';
        popup.appendChild(input);

        const errorMsg = document.createElement('div');
        errorMsg.style.color = 'var(--danger)';
        errorMsg.style.fontSize = '13px';
        errorMsg.style.minHeight = '18px';
        errorMsg.style.marginBottom = '10px';
        popup.appendChild(errorMsg);

        const buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.justifyContent = 'flex-end';
        buttonRow.style.gap = '10px';

        const cancelBtn = createActionButton('#6c757d', '#5a6268');
        cancelBtn.textContent = 'Cancel';
        const confirmBtn = createActionButton();
        confirmBtn.textContent = 'Confirm';
        buttonRow.appendChild(cancelBtn);
        buttonRow.appendChild(confirmBtn);
        popup.appendChild(buttonRow);

        // dragPopup appends the popup to the overlay and the overlay to the body.
        dragPopup(overlay, popup);
        setTimeout(() => input.focus(), 0);

        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            overlay.remove();
            resolve(result);
        };

        // Cancel / close / click-outside all resolve as "not confirmed".
        cancelBtn.addEventListener('click', () => finish(false));
        closeButton.addEventListener('click', () => finish(false));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });

        const submit = async () => {
            const password = input.value;
            if (!password) {
                errorMsg.textContent = 'Please enter your password.';
                return;
            }
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Verifying…';
            errorMsg.textContent = '';
            try {
                const token = (typeof StationAuth !== 'undefined' && StationAuth.getToken && StationAuth.getToken()) || null;
                const resp = await fetch(`${API_BASE_URL}/auth/confirm-password`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                    },
                    body: JSON.stringify({ password })
                });
                const result = await resp.json().catch(() => ({}));
                if (resp.ok && result.success) {
                    finish(true);
                } else {
                    errorMsg.textContent = result.message || 'Incorrect password.';
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = 'Confirm';
                    input.select();
                }
            } catch (err) {
                errorMsg.textContent = 'Verification failed. Please try again.';
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Confirm';
            }
        };

        confirmBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    });
}

async function sendDispenserCommand(topic, customerCode, city, message, button, commandName = 'Command') {
    // Double-protection: no lock/unlock is published until the user re-confirms
    // their password. Abort silently (leaving the controls as-is) if they don't.
    const confirmed = await confirmCommandPassword(commandName);
    if (!confirmed) return;

    const originalText = button.textContent;

    button.disabled = true;
    button.textContent = 'Sending...';

    try {
        const address = stripDAddress(topic);
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