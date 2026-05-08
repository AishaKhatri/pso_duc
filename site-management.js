let stationsList = [];

const columns = ['ID', 'Username', 'Customer Code', 'Station ID', 'City', 'Created At', 'Actions'];
const userInfo = StationAuth.getUserInfo();

async function renderSiteManagement() {
    const { content, addButton } = configPage('Site Management', 'Back', 'index.html', 'Add Site');

    const { tableContainer, tbody } = createTable(columns);
    content.appendChild(tableContainer);

    try {
        stationsList = await loadStationsFromDB();
    } catch (error) {
        console.error('Load error:', error);
        content.innerHTML = '<div class="error">Failed to load stations</div>';
        return;
    }

    renderStationsTable(stationsList);

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
            tr.style.borderBottom = '1px solid #ddd';
            
            const idTd = document.createElement('td');
            idTd.style.padding = '12px';
            idTd.textContent = station.id;
            tr.appendChild(idTd);

            const usernameTd = document.createElement('td');
            usernameTd.style.padding = '12px';
            usernameTd.textContent = station.username;
            tr.appendChild(usernameTd);

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
                deleteBtn.addEventListener('click', () => showDeleteStationConfirmation(user));
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
    usernameInput.style.border = '1px solid #ccc';
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
        passwordInput.style.border = '1px solid #ccc';
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
    customerCodeInput.style.border = '1px solid #ccc';
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
    stationIdInput.style.border = '1px solid #ccc';
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
    cityInput.style.border = '1px solid #ccc';
    cityInput.style.borderRadius = '4px';
    
    cityContainer.appendChild(cityLabel);
    cityContainer.appendChild(cityInput);
    form.appendChild(cityContainer);

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
            city: cityInput.value.trim()
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
            renderStationsTable(stationsList);
            
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
            renderStationsTable(stationsList);
        } catch (error) {
            console.error('Error deleting station:', error);
            alert(`Error: ${error.message}`);
        }
    });
}

window.renderSiteManagement = renderSiteManagement;