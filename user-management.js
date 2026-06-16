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

    // Only super_admin can create users. admin/viewer get a disabled Add button.
    if (userInfo?.role !== 'super_admin') {
        addButton.style.cursor = 'not-allowed';
        addButton.disabled = true;
        addButton.style.opacity = '0.6';
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

        const canEdit = userInfo?.role === 'super_admin';

        users.forEach(user => {
            const tr = createTableRow([
                user.id,
                user.username,
                user.role,
                user.last_login ? new Date(user.last_login).toLocaleString() : '-',
                new Date(user.created_at).toLocaleString()
            ]);

            appendRowActions(tr, {
                onEdit: () => alert('Edit functionality coming soon'),
                onDelete: () => showDeleteUserConfirmation(user),
                editTitle: 'Edit user', deleteTitle: 'Delete user',
                enabled: canEdit
            });
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error loading users:', error);
        const tbody = document.getElementById('dispenser-table-body');
        tbody.innerHTML = '';
        const errorRow = document.createElement('tr');
        const errorCell = document.createElement('td');
        errorCell.colSpan = columns.length;
        errorCell.style.color = 'var(--danger)';
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
    header.appendChild(title);
    header.appendChild(createCloseButton(overlay));
    popup.appendChild(header);

    const form = createFlexColumn('15px');

    const usernameInput = createTextInput({ value: user?.username || '', required: true });
    const passwordInput = !user ? createTextInput({ type: 'password', required: true }) : null;

    const roleSelect = createDropdown('Select Role');
    roleSelect.required = true;
    roleSelect.style.width = '100%';
    const roleOptions = [
        { value: 'super_admin', label: 'Super Admin' },
        { value: 'admin', label: 'Admin' },
        { value: 'operator', label: 'Operator' },
        { value: 'viewer', label: 'Viewer' }
    ];
    roleOptions.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.value;
        opt.textContent = r.label;
        if (user?.role?.toLowerCase() === r.value) opt.selected = true;
        roleSelect.appendChild(opt);
    });

    form.appendChild(createLabeledField({ label: 'Username', control: usernameInput, required: true }));
    if (passwordInput) form.appendChild(createLabeledField({ label: 'Password', control: passwordInput, required: true }));
    form.appendChild(createLabeledField({ label: 'Role', control: roleSelect, required: true }));

    popup.appendChild(form);

    const buttonContainer = createFlexRow({ justify: 'flex-end' });
    buttonContainer.style.marginTop = '20px';

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = 'Cancel';
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', () => document.body.removeChild(overlay));

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