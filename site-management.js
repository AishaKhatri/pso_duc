let stationsList = [];
let siteSearchQuery = '';
let siteCityQuery = '';
let siteDivisionQuery = '';

const columns = ['ID', 'Customer Code', 'Station ID', 'City', 'District', 'Division', 'DUCs Installed', 'Created At', 'Actions'];
const userInfo = StationAuth.getUserInfo();

function getFilteredSiteStations() {
    const q  = siteSearchQuery.trim().toLowerCase();
    const cq = siteCityQuery.trim().toLowerCase();
    const dq = siteDivisionQuery.trim().toLowerCase();
    return stationsList.filter(s => {
        if (q) {
            const matchesMain =
                (s.customer_code || '').toLowerCase().includes(q) ||
                (s.username || '').toLowerCase().includes(q) ||
                (s.station_id || '').toLowerCase().includes(q);
            if (!matchesMain) return false;
        }
        if (cq && !(s.city || '').toLowerCase().includes(cq)) return false;
        if (dq && !(s.division || '').toLowerCase().includes(dq)) return false;
        return true;
    });
}

// Distinct, sorted values of a station field. Used to populate field-search dropdowns.
function uniqueStationFieldValues(fieldKey) {
    const set = new Set();
    for (const s of stationsList) {
        const v = (s[fieldKey] || '').trim();
        if (v) set.add(v);
    }
    return Array.from(set).sort().map(v => ({ value: v, label: v }));
}

function buildSiteCitySearchControl() {
    // items is a function so it re-reads stationsList whenever the dropdown opens
    // (e.g. after a station is added/edited/deleted).
    const dd = createSearchableDropdown({
        placeholder: 'Search by city',
        width: '220px',
        bgWhite: true,
        items: () => uniqueStationFieldValues('city'),
        initialQuery: siteCityQuery,
        onInput: (q) => {
            siteCityQuery = q;
            renderStationsTable(getFilteredSiteStations());
        },
        onSelect: (value) => {
            siteCityQuery = value;
            renderStationsTable(getFilteredSiteStations());
        }
    });
    return dd.wrap;
}

function buildSiteDivisionSearchControl() {
    const dd = createSearchableDropdown({
        placeholder: 'Search by division',
        width: '220px',
        bgWhite: true,
        items: () => uniqueStationFieldValues('division'),
        initialQuery: siteDivisionQuery,
        onInput: (q) => {
            siteDivisionQuery = q;
            renderStationsTable(getFilteredSiteStations());
        },
        onSelect: (value) => {
            siteDivisionQuery = value;
            renderStationsTable(getFilteredSiteStations());
        }
    });
    return dd.wrap;
}

function buildSiteSearchControl() {
    // Customer_code is the label; station_id + username form the secondary line
    // and are also included as search keys.
    const dd = createSearchableDropdown({
        placeholder: 'Search by customer code or station ID',
        bgWhite: true,
        items: () => stationsList.map(s => ({
            value: s.customer_code || s.username || s.station_id || '',
            label: s.customer_code || '',
            secondary: [s.username, s.station_id].filter(Boolean).join(' · '),
            search: [s.username, s.station_id]
        })),
        initialQuery: siteSearchQuery,
        emptyText: 'No stations match',
        onInput: (q) => {
            siteSearchQuery = q;
            renderStationsTable(getFilteredSiteStations());
        },
        onSelect: (value) => {
            siteSearchQuery = value;
            renderStationsTable(getFilteredSiteStations());
        }
    });
    return dd.wrap;
}

async function renderSiteManagement() {
    const { content, addButton } = configPage('Site Management', '← Back', 'index.html', 'Add Site');

    // Inject a left-aligned group of search controls into the Add-Site button row.
    const buttonRow = addButton.parentElement;
    if (buttonRow) {
        buttonRow.style.justifyContent = 'space-between';
        buttonRow.style.flexWrap = 'wrap';

        const searchesGroup = document.createElement('div');
        searchesGroup.style.display = 'flex';
        searchesGroup.style.flexWrap = 'wrap';
        searchesGroup.style.gap = '10px';
        searchesGroup.style.alignItems = 'center';
        searchesGroup.style.flex = '1 1 auto';
        searchesGroup.appendChild(buildSiteSearchControl());
        searchesGroup.appendChild(buildSiteCitySearchControl());
        searchesGroup.appendChild(buildSiteDivisionSearchControl());

        buttonRow.insertBefore(searchesGroup, addButton);
    }

    const { tableContainer, tbody } = createTable(columns);
    content.appendChild(tableContainer);

    try {
        stationsList = await loadStationsFromDB();
    } catch (error) {
        console.error('Load error:', error);
        content.innerHTML = '<div class="error">Failed to load stations</div>';
        return;
    }

    renderStationsTable(getFilteredSiteStations());

    if (userInfo?.role !== 'admin') {
        addButton.style.cursor = 'not-allowed';
    } else {
        addButton.addEventListener('click', () => {
            showStationFormPopup();
        });
    }
}

function renderStationsTable(stations) {
    try {
        const tbody = document.getElementById('dispenser-table-body');
        tbody.innerHTML = '';

        if (stations.length === 0) {
            const noDataRow = document.createElement('tr');
            const noDataCell = document.createElement('td');
            noDataCell.colSpan = columns.length;
            noDataCell.appendChild(createNoDataMessage('No stations found'));
            noDataRow.appendChild(noDataCell);
            tbody.appendChild(noDataRow);
            return;
        }

        stations.forEach(station => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border)';
            
            const idTd = document.createElement('td');
            idTd.style.padding = '12px';
            idTd.textContent = station.id;
            tr.appendChild(idTd);

            const customerCodeTd = document.createElement('td');
            customerCodeTd.style.padding = '12px';
            customerCodeTd.textContent = station.customer_code;
            tr.appendChild(customerCodeTd);

            const stationIdTd = document.createElement('td');
            stationIdTd.style.padding = '12px';
            stationIdTd.textContent = station.station_id;
            tr.appendChild(stationIdTd);

            const cityTd = document.createElement('td');
            cityTd.style.padding = '12px';
            cityTd.textContent = station.city;
            tr.appendChild(cityTd);

            const districtTd = document.createElement('td');
            districtTd.style.padding = '12px';
            districtTd.textContent = station.district || '-';
            tr.appendChild(districtTd);

            const divisionTd = document.createElement('td');
            divisionTd.style.padding = '12px';
            divisionTd.textContent = station.division || '-';
            tr.appendChild(divisionTd);

            const ducsTd = document.createElement('td');
            ducsTd.style.padding = '12px';
            ducsTd.textContent = station.duc_addresses || '-';
            tr.appendChild(ducsTd);

            const createdAtTd = document.createElement('td');
            createdAtTd.style.padding = '12px';
            createdAtTd.textContent = new Date(station.created_at).toLocaleString() || '-';
            tr.appendChild(createdAtTd);

            const actionTd = document.createElement('td');
            actionTd.style.padding = '12px';
            
            const editBtn = createEditButton('Edit station');
            if (userInfo?.role !== 'admin') {
                editBtn.style.cursor = 'not-allowed';
            } else {
                editBtn.addEventListener('click', () => {
                    alert('Edit functionality coming soon');
                });
            }
            
            const deleteBtn = createDeleteButton('Delete station');
            if (userInfo?.role !== 'admin') {
                deleteBtn.style.cursor = 'not-allowed';
            } else {
                deleteBtn.addEventListener('click', () => showDeleteStationConfirmation(station));
            }

            actionTd.appendChild(editBtn);
            actionTd.appendChild(deleteBtn);
            
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        });


    } catch (error) {
        console.error('Error loading stations:', error);
        const tbody = document.getElementById('dispenser-table-body');
        tbody.innerHTML = '';
        const errorRow = document.createElement('tr');
        const errorCell = document.createElement('td');
        errorCell.colSpan = 8;
        errorCell.style.color = '#ff4444';
        errorCell.style.textAlign = 'center';
        errorCell.style.padding = '20px';
        errorCell.textContent = 'Error loading stations. Please try again.';
        errorRow.appendChild(errorCell);
        tbody.appendChild(errorRow);
    }
}

function showStationFormPopup(station = null) {
    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '400px';
    popup.style.maxWidth = '90vw';

    const header = createHeader();
    
    const title = createTitle();
    title.textContent = station ? 'Edit Station' : 'Add New Station';

    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const form = document.createElement('form');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '15px';

    // Username field
    const usernameContainer = document.createElement('div');
    usernameContainer.style.display = 'flex';
    usernameContainer.style.flexDirection = 'column';
    usernameContainer.style.gap = '5px';
    
    const usernameLabel = document.createElement('label');
    usernameLabel.textContent = 'Username *';
    usernameLabel.style.fontWeight = 'bold';
    
    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.value = station ? station.username : '';
    usernameInput.required = true;
    usernameInput.style.padding = '8px';
    usernameInput.style.border = '1px solid var(--border)';
    usernameInput.style.backgroundColor = 'var(--bg-surface)';
    usernameInput.style.color = 'var(--text-primary)';
    usernameInput.style.borderRadius = '4px';
    
    usernameContainer.appendChild(usernameLabel);
    usernameContainer.appendChild(usernameInput);
    form.appendChild(usernameContainer);

    // Password field (only for new users)
    let passwordInput = null;
    if (!station) {
        const passwordContainer = document.createElement('div');
        passwordContainer.style.display = 'flex';
        passwordContainer.style.flexDirection = 'column';
        passwordContainer.style.gap = '5px';
        
        const passwordLabel = document.createElement('label');
        passwordLabel.textContent = 'Password *';
        passwordLabel.style.fontWeight = 'bold';
        
        passwordInput = document.createElement('input');
        passwordInput.type = 'password';
        passwordInput.required = true;
        passwordInput.style.padding = '8px';
        passwordInput.style.border = '1px solid var(--border)';
        passwordInput.style.backgroundColor = 'var(--bg-surface)';
        passwordInput.style.color = 'var(--text-primary)';
        passwordInput.style.borderRadius = '4px';
        
        passwordContainer.appendChild(passwordLabel);
        passwordContainer.appendChild(passwordInput);
        form.appendChild(passwordContainer);
    }

    // Customer code field
    const customerCodeContainer = document.createElement('div');
    customerCodeContainer.style.display = 'flex';
    customerCodeContainer.style.flexDirection = 'column';
    customerCodeContainer.style.gap = '5px';
    customerCodeContainer.style.marginTop = '5px';
    
    const customerCodeLabel = document.createElement('label');
    customerCodeLabel.textContent = 'Customer Code';
    customerCodeLabel.style.fontWeight = 'bold';
    
    const customerCodeInput = document.createElement('input');
    customerCodeInput.type = 'text';
    customerCodeInput.value = station ? station.customer_code : '';
    customerCodeInput.required = true;
    customerCodeInput.style.padding = '8px';
    customerCodeInput.style.border = '1px solid var(--border)';
    customerCodeInput.style.backgroundColor = 'var(--bg-surface)';
    customerCodeInput.style.color = 'var(--text-primary)';
    customerCodeInput.style.borderRadius = '4px';
    
    customerCodeContainer.appendChild(customerCodeLabel);
    customerCodeContainer.appendChild(customerCodeInput);
    form.appendChild(customerCodeContainer);

    // Station ID field
    const stationIdContainer = document.createElement('div');
    stationIdContainer.style.display = 'flex';
    stationIdContainer.style.flexDirection = 'column';
    stationIdContainer.style.gap = '5px';
    
    const stationIdLabel = document.createElement('label');
    stationIdLabel.textContent = 'Station ID *';
    stationIdLabel.style.fontWeight = 'bold';
    
    const stationIdInput = document.createElement('input');
    stationIdInput.type = 'text';
    stationIdInput.value = station ? station.station_id : '';
    stationIdInput.required = true;
    stationIdInput.style.padding = '8px';
    stationIdInput.style.border = '1px solid var(--border)';
    stationIdInput.style.backgroundColor = 'var(--bg-surface)';
    stationIdInput.style.color = 'var(--text-primary)';
    stationIdInput.style.borderRadius = '4px';
    
    stationIdContainer.appendChild(stationIdLabel);
    stationIdContainer.appendChild(stationIdInput);
    form.appendChild(stationIdContainer);

    // City field
    const cityContainer = document.createElement('div');
    cityContainer.style.display = 'flex';
    cityContainer.style.flexDirection = 'column';
    cityContainer.style.gap = '5px';

    const cityLabel = document.createElement('label');
    cityLabel.textContent = 'City *';
    cityLabel.style.fontWeight = 'bold';

    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.value = station ? station.city : '';
    cityInput.required = true;
    cityInput.style.padding = '8px';
    cityInput.style.border = '1px solid var(--border)';
    cityInput.style.backgroundColor = 'var(--bg-surface)';
    cityInput.style.color = 'var(--text-primary)';
    cityInput.style.borderRadius = '4px';

    cityContainer.appendChild(cityLabel);
    cityContainer.appendChild(cityInput);
    form.appendChild(cityContainer);

    // District field
    const districtContainer = document.createElement('div');
    districtContainer.style.display = 'flex';
    districtContainer.style.flexDirection = 'column';
    districtContainer.style.gap = '5px';

    const districtLabel = document.createElement('label');
    districtLabel.textContent = 'District';
    districtLabel.style.fontWeight = 'bold';

    const districtInput = document.createElement('input');
    districtInput.type = 'text';
    districtInput.value = station && station.district ? station.district : '';
    districtInput.style.padding = '8px';
    districtInput.style.border = '1px solid var(--border)';
    districtInput.style.backgroundColor = 'var(--bg-surface)';
    districtInput.style.color = 'var(--text-primary)';
    districtInput.style.borderRadius = '4px';

    districtContainer.appendChild(districtLabel);
    districtContainer.appendChild(districtInput);
    form.appendChild(districtContainer);

    // Division field
    const divisionContainer = document.createElement('div');
    divisionContainer.style.display = 'flex';
    divisionContainer.style.flexDirection = 'column';
    divisionContainer.style.gap = '5px';

    const divisionLabel = document.createElement('label');
    divisionLabel.textContent = 'Division';
    divisionLabel.style.fontWeight = 'bold';

    const divisionInput = document.createElement('input');
    divisionInput.type = 'text';
    divisionInput.value = station && station.division ? station.division : '';
    divisionInput.style.padding = '8px';
    divisionInput.style.border = '1px solid var(--border)';
    divisionInput.style.backgroundColor = 'var(--bg-surface)';
    divisionInput.style.color = 'var(--text-primary)';
    divisionInput.style.borderRadius = '4px';

    divisionContainer.appendChild(divisionLabel);
    divisionContainer.appendChild(divisionInput);
    form.appendChild(divisionContainer);

    popup.appendChild(form);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.marginTop = '20px';

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = 'Cancel';
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    const submitButton = createActionButton('#004D64', '#00324C');
    submitButton.textContent = station ? 'Update Station' : 'Add Station';
    submitButton.type = 'button';
    
    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(submitButton);
    popup.appendChild(buttonContainer);

    submitButton.addEventListener('click', async () => {
        const stationData = {
            username: usernameInput.value.trim(),
            station_id: stationIdInput.value.trim(),
            city: cityInput.value.trim(),
            district: districtInput.value.trim(),
            division: divisionInput.value.trim()
        };

        if (!station && passwordInput && customerCodeInput) {
            if (!passwordInput.value || !customerCodeInput.value) {
                alert('Missing or invalid entry in required fields');
                return;
            }
            stationData.password = passwordInput.value;
            stationData.customer_code = customerCodeInput.value.trim();
        }

        const url = station ? `${API_BASE_URL}/stations/${station.id}` : `${API_BASE_URL}/stations`;
        const method = station ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(stationData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || errorData.error || 'Failed to save station');
            }

            alert('Station saved successfully!');
            document.body.removeChild(overlay);
            stationsList = await loadStationsFromDB();
            renderStationsTable(getFilteredSiteStations());
            
        } catch (error) {
            console.error('Error saving station:', error);
            alert(`Error: ${error.message}`);
        }
    });

    dragPopup(overlay, popup);
}

function showDeleteStationConfirmation(station) {
    const { overlay, confirmButton } = createDeletePopup(
        `Are you sure you want to delete station "${station.username}"? This action cannot be undone.`
    );

    confirmButton.addEventListener('click', async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/stations/${station.id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete station');
            }
            
            document.body.removeChild(overlay);
            stationsList = await loadStationsFromDB();
            renderStationsTable(getFilteredSiteStations());
        } catch (error) {
            console.error('Error deleting station:', error);
            alert(`Error: ${error.message}`);
        }
    });
}

window.renderSiteManagement = renderSiteManagement;