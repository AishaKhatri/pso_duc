// user-management.js
const columns = ['ID', 'Username', 'Role', 'Customer Code', 'Status', 'Last Login', 'Created At', 'Actions'];

async function renderUserManagement() {
    const { content, addButton } = configPage('User Management', 'Back', 'index.html', 'Add New User');

    const { tableContainer, tbody } = createTable(columns);
    content.appendChild(tableContainer);

    addButton.addEventListener('click', () => {
        showUserFormPopup();
    });

    await loadUsers();
}

async function loadUsers() {
    try {
        const response = await authFetch(`${API_BASE_URL}/users`, {
            headers: getAuthHeaders()
        });
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
            const row = createRowInTableBody();

            createCellInTableBody(row, user.id);
            createCellInTableBody(row, user.username);
            createCellInTableBody(row, user.role);
            createCellInTableBody(row, user.customer_code || 'N/A');
            
            const statusSpan = document.createElement('span');
            statusSpan.textContent = user.is_active ? 'Active' : 'Inactive';
            statusSpan.style.color = user.is_active ? '#2e7d32' : '#c62828';
            statusSpan.style.fontWeight = 'bold';
            const statusCell = document.createElement('td');
            statusCell.appendChild(statusSpan);
            row.appendChild(statusCell);
            
            createCellInTableBody(row, user.last_login ? new Date(user.last_login).toLocaleString() : 'Never');
            createCellInTableBody(row, new Date(user.created_at).toLocaleString());

            createActionCellInTableBody(row, {
                editText: 'Edit User',
                deleteText: 'Delete User',
                onEdit: () => showUserFormPopup(user),
                onDelete: () => showDeleteUserConfirmation(user),
            });

            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading users:', error);
        const tbody = document.getElementById('dispenser-table-body');
        tbody.innerHTML = '';
        const errorRow = document.createElement('tr');
        const errorCell = document.createElement('td');
        errorCell.colSpan = columns.length;
        errorCell.style.color = '#ff4444';
        errorCell.style.textAlign = 'center';
        errorCell.style.padding = '20px';
        errorCell.textContent = 'Error loading users. Please try again.';
        errorRow.appendChild(errorCell);
        tbody.appendChild(errorRow);
    }
}

function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
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

    const form = document.createElement('form');
    form.style.display = 'flex';
    form.style.flexDirection = 'column';
    form.style.gap = '15px';

    // Username field
    const usernameWrapper = createField('Username *', user ? user.username : '', true);
    const usernameInput = usernameWrapper.querySelector('input');
    
    // Role dropdown
    const roleWrapper = document.createElement('div');
    const roleLabel = document.createElement('label');
    roleLabel.textContent = 'Role *';
    roleLabel.style.display = 'block';
    roleLabel.style.marginBottom = '5px';
    roleLabel.style.fontWeight = 'bold';
    const roleSelect = document.createElement('select');
    roleSelect.required = true;
    roleSelect.innerHTML = `
        <option value="viewer" ${user?.role === 'viewer' ? 'selected' : ''}>Viewer</option>
        <option value="operator" ${user?.role === 'operator' ? 'selected' : ''}>Operator</option>
        <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin</option>
    `;
    roleSelect.style.width = '100%';
    roleSelect.style.padding = '8px';
    roleSelect.style.border = '1px solid #ccc';
    roleSelect.style.borderRadius = '4px';
    roleWrapper.appendChild(roleLabel);
    roleWrapper.appendChild(roleSelect);
    
    // Password field (only for new users)
    let passwordWrapper = null;
    if (!user) {
        passwordWrapper = createField('Password *', '', true);
        passwordWrapper.querySelector('input').type = 'password';
    }
    
    // Customer code field (for operator role)
    const customerCodeWrapper = createField('Customer Code', user?.customer_code || '', false);
    const customerCodeInput = customerCodeWrapper.querySelector('input');
    customerCodeInput.placeholder = 'Required for Operator role';
    
    // Status field (for edit)
    let statusWrapper = null;
    if (user) {
        statusWrapper = document.createElement('div');
        const statusLabel = document.createElement('label');
        statusLabel.textContent = 'Status';
        statusLabel.style.display = 'block';
        statusLabel.style.marginBottom = '5px';
        statusLabel.style.fontWeight = 'bold';
        const statusSelect = document.createElement('select');
        statusSelect.innerHTML = `
            <option value="1" ${user.is_active ? 'selected' : ''}>Active</option>
            <option value="0" ${!user.is_active ? 'selected' : ''}>Inactive</option>
        `;
        statusSelect.style.width = '100%';
        statusSelect.style.padding = '8px';
        statusSelect.style.border = '1px solid #ccc';
        statusSelect.style.borderRadius = '4px';
        statusWrapper.appendChild(statusLabel);
        statusWrapper.appendChild(statusSelect);
    }
    
    form.appendChild(usernameWrapper);
    form.appendChild(roleWrapper);
    if (passwordWrapper) form.appendChild(passwordWrapper);
    form.appendChild(customerCodeWrapper);
    if (statusWrapper) form.appendChild(statusWrapper);
    
    popup.appendChild(form);
    
    // Show/hide customer code field based on role
    const toggleCustomerCodeField = () => {
        customerCodeWrapper.style.display = roleSelect.value === 'operator' ? 'block' : 'none';
        if (roleSelect.value === 'operator') {
            customerCodeInput.required = true;
        } else {
            customerCodeInput.required = false;
        }
    };
    roleSelect.addEventListener('change', toggleCustomerCodeField);
    toggleCustomerCodeField();

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
                role: roleSelect.value,
            };
            
            if (roleSelect.value === 'operator') {
                userData.customer_code = customerCodeInput.value.trim();
            }
            
            if (statusWrapper) {
                userData.is_active = parseInt(statusWrapper.querySelector('select').value);
            }
            
            if (!user && passwordWrapper) {
                userData.password = passwordWrapper.querySelector('input').value;
            }
            
            const url = user ? `${API_BASE_URL}/users/${user.id}` : `${API_BASE_URL}/users`;
            const method = user ? 'PUT' : 'POST';
            
            const response = await authFetch(url, {
                method: method,
                headers: getAuthHeaders(),
                body: JSON.stringify(userData)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || errorData.error || 'Failed to save user');
            }
            
            document.body.removeChild(overlay);
            await loadUsers();
            
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
            const response = await authFetch(`${API_BASE_URL}/users/${user.id}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete user');
            }
            
            document.body.removeChild(overlay);
            await loadUsers();
        } catch (error) {
            console.error('Error deleting user:', error);
            alert(`Error: ${error.message}`);
        }
    });
}

window.renderUserManagement = renderUserManagement;