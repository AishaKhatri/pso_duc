let stationsList = [];

const columns = ['ID', 'Username', 'Customer Code', 'Station ID', 'City', 'Created At', 'Actions'];

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

    addButton.addEventListener('click', () => {
        showStationFormPopup();
    });
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
            editBtn.addEventListener('click', () => {
                alert('Edit functionality coming soon');
            });
            
            const deleteBtn = createDeleteButton('Delete station');
            deleteBtn.addEventListener('click', () => showDeleteStationConfirmation(station));

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