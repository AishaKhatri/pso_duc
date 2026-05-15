// user-management.js
let stationsList = [];
let usersList = [];

const columns = ['ID', 'Username', 'Role', 'Last Login', 'Created At', 'Actions'];
const userInfo = StationAuth.getUserInfo();

async function renderUserManagement() {
    const { content, addButton } = configPage('User Management', '← Back', 'index.html', 'Add User');

    const { tableContainer, tbody } = createTable(columns);
    content.appendChild(tableContainer);

    try {
        stationsList = await loadStationsFromDB();
        usersList = await loadUsersFromDB();
    } catch (error) {
        console.error('Load error:', error);
        content.innerHTML = '<div class="error">Failed to load stations</div>';
        return;
    }

    renderUsersTable(usersList);

    if (userInfo?.role !== 'admin') {
        addButton.style.cursor = 'not-allowed';
    } else {
        addButton.addEventListener('click', () => {
            showUserFormPopup();
        });
    }    
}

async function renderUsersTable(users) {
    try {
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
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border)';
            
            const idTd = document.createElement('td');
            idTd.style.padding = '12px';
            idTd.textContent = user.id;
            tr.appendChild(idTd);

            const usernameTd = document.createElement('td');
            usernameTd.style.padding = '12px';
            usernameTd.textContent = user.username;
            tr.appendChild(usernameTd);

            const roleTd = document.createElement('td');
            roleTd.style.padding = '12px';
            roleTd.textContent = user.role || '-';
            tr.appendChild(roleTd);

            const lastLoginTd = document.createElement('td');
            lastLoginTd.style.padding = '12px';
            lastLoginTd.textContent = user.last_login ? new Date(user.last_login).toLocaleString() : '-';
            tr.appendChild(lastLoginTd);

            const createdAtTd = document.createElement('td');
            createdAtTd.style.padding = '12px';
            createdAtTd.textContent = new Date(user.created_at).toLocaleString() || '-';
            tr.appendChild(createdAtTd);

            const actionTd = document.createElement('td');
            actionTd.style.padding = '12px';
            
            const editBtn = createEditButton('Edit user');
            if (userInfo?.role !== 'admin') {
                editBtn.style.cursor = 'not-allowed';
            } else {
                editBtn.addEventListener('click', () => {
                    alert('Edit functionality coming soon');
                });
            }
            
            const deleteBtn = createDeleteButton('Delete user');
            if (userInfo?.role !== 'admin') {
                deleteBtn.style.cursor = 'not-allowed';
            } else {
                deleteBtn.addEventListener('click', () => showDeleteUserConfirmation(user));
            }
            actionTd.appendChild(editBtn);
            actionTd.appendChild(deleteBtn);
            
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
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
    popup.style.width = '400px';
    popup.style.maxWidth = '90vw';

    const header = createHeader();
    
    const title = createTitle();
    title.textContent = user ? 'Edit User' : 'Add New User';

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
    usernameInput.value = user ? user.username : '';
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
    if (!user) {
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

    // Role dropdown
    const roleContainer = document.createElement('div');
    roleContainer.style.display = 'flex';
    roleContainer.style.flexDirection = 'column';
    roleContainer.style.gap = '5px';
    
    const roleLabel = document.createElement('label');
    roleLabel.textContent = 'Role *';
    roleLabel.style.fontWeight = 'bold';
    
    const roleSelect = createDropdown('Select Role');
    roleSelect.required = true;
    roleSelect.style.width = '100%';
    
    const roleOptions = [
        { value: 'admin', label: 'Admin' },
        { value: 'operator', label: 'Operator' },
        { value: 'viewer', label: 'Viewer' }
    ];
    
    roleOptions.forEach(roleOption => {
        const option = document.createElement('option');
        option.value = roleOption.value;
        option.textContent = roleOption.label;
        if (user && user.role && user.role.toLowerCase() === roleOption.value) {
            option.selected = true;
        }
        roleSelect.appendChild(option);
    });
    
    roleContainer.appendChild(roleLabel);
    roleContainer.appendChild(roleSelect);
    form.appendChild(roleContainer);

    // Customer code dropdown
    const customerCodeContainer = document.createElement('div');
    customerCodeContainer.style.display = 'flex';
    customerCodeContainer.style.flexDirection = 'column';
    customerCodeContainer.style.gap = '5px';
    customerCodeContainer.style.marginTop = '5px';
    
    const customerCodeLabel = document.createElement('label');
    customerCodeLabel.textContent = 'Customer Code';
    customerCodeLabel.style.fontWeight = 'bold';
    
    const customerCodeSelect = createDropdown('Select Customer Code');
    customerCodeSelect.name = 'customer_code';
    customerCodeSelect.style.width = '100%';
    customerCodeSelect.style.padding = '8px';
    customerCodeSelect.style.border = '1px solid var(--border)';
    customerCodeSelect.style.backgroundColor = 'var(--bg-surface)';
    customerCodeSelect.style.color = 'var(--text-primary)';
    customerCodeSelect.style.borderRadius = '4px';
    
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select Customer Code';
    defaultOption.disabled = true;
    defaultOption.selected = true;
    customerCodeSelect.appendChild(defaultOption);
    
    if (stationsList && stationsList.length > 0) {
        stationsList.forEach(station => {
            const option = document.createElement('option');
            option.value = station.customer_code;
            option.textContent = `${station.customer_code} - ${station.station_id || station.city || 'Unknown'}`;
            if (user && user.customer_code === station.customer_code) {
                option.selected = true;
            }
            customerCodeSelect.appendChild(option);
        });
    } else {
        const noStationOption = document.createElement('option');
        noStationOption.value = '';
        noStationOption.textContent = 'No stations available';
        noStationOption.disabled = true;
        customerCodeSelect.appendChild(noStationOption);
    }
    
    customerCodeContainer.appendChild(customerCodeLabel);
    customerCodeContainer.appendChild(customerCodeSelect);
    form.appendChild(customerCodeContainer);

    const updateCustomerCodeState = () => {
        if (roleSelect.value === 'operator') {
            customerCodeSelect.disabled = false;
            customerCodeSelect.style.opacity = '1';
            customerCodeSelect.style.backgroundColor = 'var(--bg-surface)';
        } else {
            customerCodeSelect.disabled = true;
            customerCodeSelect.style.opacity = '0.6';
            customerCodeSelect.style.backgroundColor = 'var(--bg-surface-2)';
        }
    };
    
    updateCustomerCodeState();
    
    roleSelect.addEventListener('change', updateCustomerCodeState);

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
    submitButton.textContent = user ? 'Update User' : 'Add User';
    submitButton.type = 'button';
    
    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(submitButton);
    popup.appendChild(buttonContainer);

    submitButton.addEventListener('click', async () => {
        const userData = {
            username: usernameInput.value.trim(),
            role: roleSelect.value,
        };
        
        // if (roleSelect.value === 'operator') {
        //     if (!customerCodeSelect.value) {
        //         alert('Please select a customer code for operator role');
        //         return;
        //     }
        //     userData.customer_code = customerCodeSelect.value;
        // }
        
        if (!user && passwordInput) {
            if (!passwordInput.value) {
                alert('Missing or invalid entry in required fields');
                return;
            }
            userData.password = passwordInput.value;
        }

        const url = user ? `${API_BASE_URL}/users/${user.id}` : `${API_BASE_URL}/users`;
        const method = user ? 'PUT' : 'POST';

        try {
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(userData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || errorData.error || 'Failed to save user');
            }

            alert('User saved successfully!');
            document.body.removeChild(overlay);
            usersList = await loadUsersFromDB();
            renderUsersTable(usersList);
            
        } catch (error) {
            console.error('Error saving user:', error);
            alert(`Error: ${error.message}`);
        }
    });

    dragPopup(overlay, popup);
}

function showDeleteUserConfirmation(user) {
    const { overlay, confirmButton } = createDeletePopup(
        `Are you sure you want to delete user "${user.username}"? This action cannot be undone.`
    );

    confirmButton.addEventListener('click', async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/users/${user.id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete user');
            }
            
            document.body.removeChild(overlay);
            usersList = await loadUsersFromDB();
            renderUsersTable(usersList);
        } catch (error) {
            console.error('Error deleting user:', error);
            alert(`Error: ${error.message}`);
        }
    });
}

window.renderUserManagement = renderUserManagement;