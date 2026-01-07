// user-management.js
const columns = ['ID', 'Username', 'Station ID', 'Station Name', 'City', 'Province', 'Created At', 'Actions'];

async function renderUserManagement() {
    const { content, addButton } = configPage(
        'User Management', 
        'Back to Dashboard', 
        'dashboard.html', 
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

    // Username field
    const usernameGroup = document.createElement('div');
    usernameGroup.style.display = 'flex';
    usernameGroup.style.flexDirection = 'column';
    usernameGroup.style.gap = '5px';

    const usernameLabel = document.createElement('label');
    usernameLabel.textContent = 'Username *';
    usernameLabel.style.fontWeight = '600';
    usernameGroup.appendChild(usernameLabel);

    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.required = true;
    usernameInput.style.padding = '10px';
    usernameInput.style.border = '1px solid #ccc';
    usernameInput.style.borderRadius = '4px';
    usernameInput.style.fontSize = '14px';
    if (user) usernameInput.value = user.username;
    usernameGroup.appendChild(usernameInput);

    form.appendChild(usernameGroup);

    // Password field (only show for new users)
    if (!user) {
        const passwordGroup = document.createElement('div');
        passwordGroup.style.display = 'flex';
        passwordGroup.style.flexDirection = 'column';
        passwordGroup.style.gap = '5px';

        const passwordLabel = document.createElement('label');
        passwordLabel.textContent = 'Password *';
        passwordLabel.style.fontWeight = '600';
        passwordGroup.appendChild(passwordLabel);

        const passwordInput = document.createElement('input');
        passwordInput.type = 'password';
        passwordInput.required = true;
        passwordInput.style.padding = '10px';
        passwordInput.style.border = '1px solid #ccc';
        passwordInput.style.borderRadius = '4px';
        passwordInput.style.fontSize = '14px';
        passwordGroup.appendChild(passwordInput);

        form.appendChild(passwordGroup);
    }

    // Station ID field
    const stationIdGroup = document.createElement('div');
    stationIdGroup.style.display = 'flex';
    stationIdGroup.style.flexDirection = 'column';
    stationIdGroup.style.gap = '5px';

    const stationIdLabel = document.createElement('label');
    stationIdLabel.textContent = 'Station ID *';
    stationIdLabel.style.fontWeight = '600';
    stationIdGroup.appendChild(stationIdLabel);

    const stationIdInput = document.createElement('input');
    stationIdInput.type = 'text';
    stationIdInput.required = true;
    stationIdInput.style.padding = '10px';
    stationIdInput.style.border = '1px solid #ccc';
    stationIdInput.style.borderRadius = '4px';
    stationIdInput.style.fontSize = '14px';
    if (user) stationIdInput.value = user.station_id;
    stationIdGroup.appendChild(stationIdInput);

    form.appendChild(stationIdGroup);

    // Station Name field
    const stationNameGroup = document.createElement('div');
    stationNameGroup.style.display = 'flex';
    stationNameGroup.style.flexDirection = 'column';
    stationNameGroup.style.gap = '5px';

    const stationNameLabel = document.createElement('label');
    stationNameLabel.textContent = 'Station Name *';
    stationNameLabel.style.fontWeight = '600';
    stationNameGroup.appendChild(stationNameLabel);

    const stationNameInput = document.createElement('input');
    stationNameInput.type = 'text';
    stationNameInput.required = true;
    stationNameInput.style.padding = '10px';
    stationNameInput.style.border = '1px solid #ccc';
    stationNameInput.style.borderRadius = '4px';
    stationNameInput.style.fontSize = '14px';
    if (user) stationNameInput.value = user.station_name;
    stationNameGroup.appendChild(stationNameInput);

    form.appendChild(stationNameGroup);

    // City field
    const cityGroup = document.createElement('div');
    cityGroup.style.display = 'flex';
    cityGroup.style.flexDirection = 'column';
    cityGroup.style.gap = '5px';

    const cityLabel = document.createElement('label');
    cityLabel.textContent = 'City *';
    cityLabel.style.fontWeight = '600';
    cityGroup.appendChild(cityLabel);

    const cityInput = document.createElement('input');
    cityInput.type = 'text';
    cityInput.required = true;
    cityInput.style.padding = '10px';
    cityInput.style.border = '1px solid #ccc';
    cityInput.style.borderRadius = '4px';
    cityInput.style.fontSize = '14px';
    if (user) cityInput.value = user.city;
    cityGroup.appendChild(cityInput);

    form.appendChild(cityGroup);

    // Province field
    const provinceGroup = document.createElement('div');
    provinceGroup.style.display = 'flex';
    provinceGroup.style.flexDirection = 'column';
    provinceGroup.style.gap = '5px';

    const provinceLabel = document.createElement('label');
    provinceLabel.textContent = 'Province';
    provinceLabel.style.fontWeight = '600';
    provinceGroup.appendChild(provinceLabel);

    const provinceInput = document.createElement('input');
    provinceInput.type = 'text';
    provinceInput.style.padding = '10px';
    provinceInput.style.border = '1px solid #ccc';
    provinceInput.style.borderRadius = '4px';
    provinceInput.style.fontSize = '14px';
    if (user) provinceInput.value = user.province || '';
    provinceGroup.appendChild(provinceInput);

    form.appendChild(provinceGroup);

    // Station Config field
    const configGroup = document.createElement('div');
    configGroup.style.display = 'flex';
    configGroup.style.flexDirection = 'column';
    configGroup.style.gap = '5px';

    const configLabel = document.createElement('label');
    configLabel.textContent = 'Station Configuration (JSON)';
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