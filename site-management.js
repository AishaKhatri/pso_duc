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

function exportSiteStationsToCsv() {
    const rows = getFilteredSiteStations();
    const titleCase = s => (s || '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    const cols = [
        { header: 'ID',              key: 'id' },
        { header: 'Customer Code',   key: 'customer_code' },
        { header: 'Station ID',      key: 'station_id' },
        { header: 'Username',        key: 'username' },
        { header: 'City',            get: s => titleCase(s.city) },
        { header: 'District',        key: 'district' },
        { header: 'Division',        key: 'division' },
        { header: 'DUCs Installed',  key: 'duc_addresses' },
        { header: 'Created At',      get: s => s.created_at ? new Date(s.created_at).toLocaleString() : '' }
    ];
    const dateTag = new Date().toISOString().split('T')[0];
    downloadCsv(`stations-${dateTag}.csv`, rows, cols);
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

        // Export CSV — super-admin only.
        if (userInfo?.role === 'super_admin' || userInfo?.role === 'admin') {
            const exportBtn = createActionButton();
            exportBtn.textContent = 'Export to CSV';
            exportBtn.style.marginRight = '8px';
            exportBtn.addEventListener('click', () => exportSiteStationsToCsv());
            buttonRow.insertBefore(exportBtn, addButton);
        }
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

    if (userInfo?.role !== 'admin' && userInfo?.role !== 'super_admin') {
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

        const canEdit = userInfo?.role === 'admin' || userInfo?.role === 'super_admin';
        const titleCase = s => (s || '').split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

        stations.forEach(station => {
            const tr = createTableRow([
                station.id,
                station.customer_code,
                station.station_id,
                titleCase(station.city),
                station.district,
                station.division,
                station.duc_addresses,
                new Date(station.created_at).toLocaleString()
            ]);

            const editBtn = createEditButton('Edit station');
            if (!canEdit) editBtn.style.cursor = 'not-allowed';
            else editBtn.addEventListener('click', () => alert('Edit functionality coming soon'));

            const deleteBtn = createDeleteButton('Delete station');
            if (!canEdit) deleteBtn.style.cursor = 'not-allowed';
            else deleteBtn.addEventListener('click', () => showDeleteStationConfirmation(station));

            const actionWrap = document.createElement('div');
            actionWrap.appendChild(editBtn);
            actionWrap.appendChild(deleteBtn);
            appendCell(tr, actionWrap);
            tbody.appendChild(tr);
        });


    } catch (error) {
        console.error('Error loading stations:', error);
        const tbody = document.getElementById('dispenser-table-body');
        tbody.innerHTML = '';
        const errorRow = document.createElement('tr');
        const errorCell = document.createElement('td');
        errorCell.colSpan = 8;
        errorCell.style.color = 'var(--danger)';
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
    header.appendChild(title);
    header.appendChild(createCloseButton(overlay));
    popup.appendChild(header);

    const form = createFlexColumn('15px');
    // <form> semantics aren't load-bearing here; visual layout is what matters.

    const usernameInput     = createTextInput({ value: station?.username || '', required: true });
    const passwordInput     = !station ? createTextInput({ type: 'password', required: true }) : null;
    const customerCodeInput = createTextInput({ value: station?.customer_code || '', required: true });
    const stationIdInput    = createTextInput({ value: station?.station_id || '', required: true });
    const cityInput         = createTextInput({ value: station?.city || '', required: true });
    const districtInput     = createTextInput({ value: station?.district || '' });
    const divisionInput     = createTextInput({ value: station?.division || '' });

    form.appendChild(createLabeledField({ label: 'Username',      control: usernameInput,     required: true }));
    if (passwordInput) form.appendChild(createLabeledField({ label: 'Password', control: passwordInput, required: true }));
    form.appendChild(createLabeledField({ label: 'Customer Code', control: customerCodeInput, marginTop: '5px' }));
    form.appendChild(createLabeledField({ label: 'Station ID',    control: stationIdInput,    required: true }));
    form.appendChild(createLabeledField({ label: 'City',          control: cityInput,         required: true }));
    form.appendChild(createLabeledField({ label: 'District',      control: districtInput }));
    form.appendChild(createLabeledField({ label: 'Division',      control: divisionInput }));

    popup.appendChild(form);

    const buttonContainer = createFlexRow({ justify: 'flex-end' });
    buttonContainer.style.marginTop = '20px';

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = 'Cancel';
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', () => document.body.removeChild(overlay));

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