async function showCommandDispenserPopup(options = {}) {
    const presetCustomerCode = options.presetCustomerCode || null;
    const overlay = createModalOverlay();

    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '480px';
    popup.style.height = '520px';
    popup.style.maxHeight = 'calc(var(--vh100) - 40px)';
    dragPopup(overlay, popup);

    const header = createHeader();
        
    const title = createTitle();
    title.textContent = 'Dispenser Commands';

    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    // Opened from a customer-filtered dispenser page: the station is already
    // known, so skip the city/division/station/dispenser selectors and list
    // every dispenser of that site with its nozzles in one compact view.
    if (presetCustomerCode) {
        popup.style.height = 'auto';
        title.textContent = `Lock/Unlock — ${presetCustomerCode}`;
        overlay.appendChild(popup);
        document.body.appendChild(overlay);
        await renderStationLockControls(popup, presetCustomerCode);
        return;
    }

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
    selectorsContainer.style.marginBottom = '12px';
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
    statusContainer.style.marginBottom = '12px';
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
            noDispenserMsg.style.padding = '14px';
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

async function renderStationLockControls(popup, customerCode) {
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'dispenserControls';
    popup.appendChild(controlsContainer);

    const statusContainer = document.createElement('div');
    statusContainer.id = 'commandStatus';
    popup.appendChild(statusContainer);

    controlsContainer.textContent = 'Loading…';
    try {
        const resp = await fetch(`${API_BASE_URL}/dispensers-full?customer_code=${encodeURIComponent(customerCode)}`);
        if (!resp.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = (await resp.json()).filter(d => d.nozzles && d.nozzles.length > 0);

        controlsContainer.textContent = '';
        if (dispensers.length === 0) {
            controlsContainer.textContent = 'No dispensers available for this station';
            controlsContainer.style.padding = '14px';
            controlsContainer.style.textAlign = 'center';
            controlsContainer.style.color = 'var(--text-secondary)';
            return;
        }

        dispensers.forEach((dispenser, index) => {
            const city = dispenser.station?.city || '';
            createNozzlesSection(dispenser, controlsContainer, customerCode, city, `Dispenser ${index + 1}`);
        });
    } catch (error) {
        controlsContainer.textContent = '';
        showCommandStatusMessage(`Error fetching data: ${error.message}`, 'error');
    }
}

function showDispenserControls(dispenser, customerCode, city) {
    const controlsContainer = document.getElementById('dispenserControls');
    if (!controlsContainer) return;

    controlsContainer.innerHTML = '';
    createNozzlesSection(dispenser, controlsContainer, customerCode, city);
}

// One block per dispenser: a small heading followed by one compact row per
// nozzle (product badge, current state, Lock / Unlock buttons).
function createNozzlesSection(dispenser, container, customerCode, city, heading = 'Nozzles') {
    const dispenserTopic = ensureDAddress(dispenser.address);

    const section = document.createElement('div');
    section.style.marginBottom = '12px';

    const title = document.createElement('div');
    title.textContent = `${heading} (${dispenserTopic})`;
    title.style.fontWeight = 'bold';
    title.style.fontSize = '13px';
    title.style.color = 'var(--text-heading)';
    title.style.borderBottom = '1px solid var(--border)';
    title.style.paddingBottom = '4px';
    title.style.marginBottom = '6px';
    section.appendChild(title);

    const nozzles = [...dispenser.nozzles].sort((a, b) => a.nozzle_id.localeCompare(b.nozzle_id, undefined, { numeric: true }));
    nozzles.forEach(nozzle => {
        section.appendChild(createNozzleLockRow(dispenserTopic, nozzle, customerCode, city));
    });

    container.appendChild(section);
}

function createNozzleLockRow(dispenserTopic, nozzle, customerCode, city) {
    const product = normalizeFuelType(nozzle.product);
    const colorConfig = productColorConfig[product];
    const [, side, number] = nozzle.nozzle_id.match(/D\d+-([AB])(\d+)/);
    const nozzleLabel = `${side}${number}`;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '3px 0';

    const badge = document.createElement('span');
    badge.textContent = `${nozzleLabel} · ${product}`;
    badge.style.background = colorConfig.header;
    badge.style.color = '#111111';
    badge.style.fontWeight = 'bold';
    badge.style.fontSize = '12px';
    badge.style.padding = '3px 8px';
    badge.style.borderRadius = '4px';
    badge.style.minWidth = '80px';
    badge.style.textAlign = 'center';

    const state = document.createElement('span');
    state.textContent = nozzle.lock_unlock ? 'Locked' : 'Unlocked';
    state.style.flex = '1';
    state.style.fontSize = '12px';
    state.style.fontWeight = nozzle.lock_unlock ? 'bold' : 'normal';
    state.style.color = nozzle.lock_unlock ? 'var(--danger)' : 'var(--text-secondary)';

    row.appendChild(badge);
    row.appendChild(state);

    [{ value: '1', text: 'Lock' }, { value: '0', text: 'Unlock' }].forEach(action => {
        const button = createActionButton();
        button.textContent = action.text;
        button.style.padding = '4px 10px';
        button.style.fontSize = '12px';
        button.style.minWidth = '64px';
        button.addEventListener('click', () => sendDispenserCommand(dispenserTopic, customerCode, city, {
            dis_addr: dispenserTopic,
            req_type: 0,
            side: side,
            noz_number: parseInt(number),
            msg_type: 4,
            message: action.value
        }, button, `Nozzle ${nozzleLabel} ${action.text}`));
        row.appendChild(button);
    });

    return row;
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
        prompt.style.fontSize = '13px';
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