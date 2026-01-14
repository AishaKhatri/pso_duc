// user-management.js
const columns = ['ID', 'Username', 'Station ID', 'Station Name', 'City', 'Province', 'Created At', 'Actions'];

async function renderUserManagement() {
    const { content, addButton } = configPage(
        'User Management', 
        'Back', 
        'index.html', 
        'Add New User'
    );

    // Create table for users
    const { tableContainer, tbody } = createTable(columns);
    content.appendChild(tableContainer);

    // Add button event listener
    addButton.addEventListener('click', () => {
        showUserFormPopup();
    });

    // Load users data
    await loadUsers();
}

async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE_URL}/stations`);
        if (!response.ok) throw new Error('Failed to fetch users');
        
        const users = await response.json();
        const tbody = document.getElementById('dispenser-table-body');
        tbody.innerHTML = '';

        if (users.length === 0) {
            const noDataRow = document.createElement('tr');
            const noDataCell = document.createElement('td');
            noDataCell.colSpan = columns.length;
            noDataCell.appendChild(createNoDataMessage('No users found'));
            noDataRow.appendChild(noDataCell);
            tbody.appendChild(noDataRow);
            return;
        }

        users.forEach(user => {
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid #eee';
            row.style.transition = 'background-color 0.2s ease';

            // ID
            const idCell = document.createElement('td');
            idCell.textContent = user.id;
            idCell.style.padding = '12px';
            row.appendChild(idCell);

            // Username
            const usernameCell = document.createElement('td');
            usernameCell.textContent = user.username;
            usernameCell.style.padding = '12px';
            row.appendChild(usernameCell);

            // Station ID
            const stationIdCell = document.createElement('td');
            stationIdCell.textContent = user.station_id;
            stationIdCell.style.padding = '12px';
            row.appendChild(stationIdCell);

            // Station Name
            const stationNameCell = document.createElement('td');
            stationNameCell.textContent = user.station_name;
            stationNameCell.style.padding = '12px';
            row.appendChild(stationNameCell);

            // City
            const cityCell = document.createElement('td');
            cityCell.textContent = user.city;
            cityCell.style.padding = '12px';
            row.appendChild(cityCell);

            // Province
            const provinceCell = document.createElement('td');
            provinceCell.textContent = user.province || 'N/A';
            provinceCell.style.padding = '12px';
            row.appendChild(provinceCell);

            // Created At
            const createdAtCell = document.createElement('td');
            const date = new Date(user.created_at);
            createdAtCell.textContent = date.toLocaleString();
            createdAtCell.style.padding = '12px';
            row.appendChild(createdAtCell);

            // Actions
            const actionsCell = document.createElement('td');
            actionsCell.style.padding = '12px';
            actionsCell.style.display = 'flex';
            actionsCell.style.gap = '10px';

            // Edit button
            const editButton = createEditButton('Edit User');
            editButton.addEventListener('click', () => {
                showUserFormPopup(user);
            });
            actionsCell.appendChild(editButton);

            // Delete button
            const deleteButton = createDeleteButton('Delete User');
            deleteButton.addEventListener('click', () => {
                showDeleteUserConfirmation(user);
            });
            actionsCell.appendChild(deleteButton);

            row.appendChild(actionsCell);

            // Add hover effect
            row.addEventListener('mouseover', () => {
                row.style.backgroundColor = '#f9f9f9';
            });
            row.addEventListener('mouseout', () => {
                row.style.backgroundColor = '';
            });

            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading users:', error);
        const tbody = document.getElementById('dispenser-table-body');
        tbody.innerHTML = '';
        const errorRow = document.createElement('tr');
        const errorCell = document.createElement('td');
        errorCell.colSpan = 8;
        errorCell.style.color = '#ff4444';
        errorCell.style.textAlign = 'center';
        errorCell.style.padding = '20px';
        errorCell.textContent = 'Error loading users. Please try again.';
        errorRow.appendChild(errorCell);
        tbody.appendChild(errorRow);
    }
}

function showUserFormPopup(user = null) {
    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '500px';
    popup.style.maxWidth = '90vw';

    const header = createHeader();
    
    const title = createTitle();
    title.textContent = user ? 'Edit User' : 'Add New User';

    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    // Create form
    const form = document.createElement('form');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '15px';

    const username = createField('Username *', user ? user.username : '', true);
    const password = createField('Password *', user ? user.password : '', true);
    const stationId = createField('Station ID *', user ? user.station_id : '', true);
    const stationName = createField('Station Name *', user ? user.station_name : '', true);
    const city = createField('City *', user ? user.city : '', true);
    const province = createField('Province', user ? user.province : '', false);

    form.appendChild(username);
    form.appendChild(password);
    form.appendChild(stationId);
    form.appendChild(stationName);
    form.appendChild(city);
    form.appendChild(province);
    
    // Station Config field
    const configGroup = document.createElement('div');
    configGroup.style.display = 'flex';
    configGroup.style.flexDirection = 'column';
    configGroup.style.gap = '5px';

    const configLabel = document.createElement('label');
    configLabel.textContent = 'Station Configuration';
    configLabel.style.fontWeight = '600';
    configGroup.appendChild(configLabel);

    const configTextarea = document.createElement('textarea');
    configTextarea.rows = 6;
    configTextarea.style.padding = '10px';
    configTextarea.style.border = '1px solid #ccc';
    configTextarea.style.borderRadius = '4px';
    configTextarea.style.fontSize = '14px';
    configTextarea.style.fontFamily = 'monospace';
    configTextarea.placeholder = 'Enter JSON configuration';
    
    if (user && user.station_config) {
        try {
            configTextarea.value = JSON.stringify(user.station_config, null, 2);
        } catch (e) {
            configTextarea.value = JSON.stringify({});
        }
    } else {
        configTextarea.value = JSON.stringify({}, null, 2);
    }
    
    configGroup.appendChild(configTextarea);

    form.appendChild(configGroup);

    popup.appendChild(form);

    // Buttons
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
    submitButton.textContent = user ? 'Update User' : 'Add User';
    submitButton.type = 'submit';

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(submitButton);
    popup.appendChild(buttonContainer);

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
            const userData = {
                username: usernameInput.value.trim(),
                station_id: stationIdInput.value.trim(),
                station_name: stationNameInput.value.trim(),
                city: cityInput.value.trim(),
                province: provinceInput.value.trim() || null
            };

            // Add password for new users
            if (!user) {
                const passwordInput = form.querySelector('input[type="password"]');
                userData.password = passwordInput.value;
            }

            // Parse station config
            try {
                userData.station_config = JSON.parse(configTextarea.value);
            } catch (e) {
                alert('Invalid JSON format in Station Configuration');
                return;
            }

            const url = user ? `${API_BASE_URL}/users/${user.id}` : `${API_BASE_URL}/users`;
            const method = user ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(userData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to save user');
            }

            document.body.removeChild(overlay);
            await loadUsers(); // Refresh the list
            
        } catch (error) {
            console.error('Error saving user:', error);
            alert(`Error: ${error.message}`);
        }
    });

    dragPopup(overlay, popup);
}

function showDeleteUserConfirmation(user) {
    const { overlay, confirmButton } = createDeletePopup(
        `Are you sure you want to delete user "${user.username}" (${user.station_name})? This action cannot be undone.`
    );

    confirmButton.addEventListener('click', async () => {
        try {
            await deleteFromDB(`${API_BASE_URL}/users/${user.id}`);
            document.body.removeChild(overlay);
            await loadUsers(); // Refresh the list
        } catch (error) {
            console.error('Error deleting user:', error);
            alert('Failed to delete user. Please try again.');
        }
    });
}