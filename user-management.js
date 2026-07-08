// user-management.js
let stationsList = [];
let usersList = [];

const columns = ['ID', 'Username', 'Role', 'Allow Price Update', 'Last Login', 'Created At', 'Actions'];
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
            // No user may change their own password (not even a super_admin);
            // password resets are always performed by a super_admin on another
            // account.
            const isSelf = userInfo?.id === user.id;

            const tr = createTableRow([
                user.id,
                user.username,
                user.role,
                createAllowPriceToggle(user, canEdit),
                user.last_login ? new Date(user.last_login).toLocaleString() : '-',
                new Date(user.created_at).toLocaleString()
            ]);

            appendRowActions(tr, {
                onEdit: () => alert('Edit functionality coming soon'),
                onDelete: () => showDeleteUserConfirmation(user),
                onChangePassword: (canEdit && !isSelf) ? () => showChangePasswordPopup(user) : undefined,
                editTitle: 'Edit user', deleteTitle: 'Delete user',
                changePasswordTitle: 'Change password',
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

// Checkbox cell for the "Allow Price Update" column. Interactive only for a
// super_admin (canEdit); toggling it PUTs the new grant and reverts on failure.
function createAllowPriceToggle(user, canEdit) {
    const label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.justifyContent = 'center';
    label.style.width = '100%';
    label.style.cursor = canEdit ? 'pointer' : 'not-allowed';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!user.allow_price_update;
    checkbox.disabled = !canEdit;
    checkbox.title = 'Allow this user to access the Upload Price File page';

    checkbox.addEventListener('change', async () => {
        const desired = checkbox.checked;
        checkbox.disabled = true;
        try {
            const response = await fetch(`${API_BASE_URL}/users/${user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allow_price_update: desired ? 1 : 0 })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || errorData.error || 'Failed to update');
            }
            user.allow_price_update = desired ? 1 : 0;
        } catch (error) {
            console.error('Error updating allow_price_update:', error);
            alert(`Error: ${error.message}`);
            checkbox.checked = !desired; // revert the visual toggle
        } finally {
            checkbox.disabled = !canEdit;
        }
    });

    label.appendChild(checkbox);
    return label;
}

// Super-admin-only popup to set a new password for another user. The password
// is hashed server-side (PUT /api/users/:id).
function showChangePasswordPopup(user) {
    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '400px';
    popup.style.maxWidth = '90vw';

    const header = createHeader();
    const title = createTitle();
    title.textContent = `Change Password — ${user.username}`;
    header.appendChild(title);
    header.appendChild(createCloseButton(overlay));
    popup.appendChild(header);

    const form = createFlexColumn('15px');
    const passwordInput = createTextInput({ type: 'password', required: true });
    form.appendChild(createLabeledField({ label: 'New Password', control: passwordInput, required: true }));
    popup.appendChild(form);

    const buttonContainer = createFlexRow({ justify: 'flex-end' });
    buttonContainer.style.marginTop = '20px';

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = 'Cancel';
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', () => document.body.removeChild(overlay));

    const submitButton = createActionButton('#004D64', '#00324C');
    submitButton.textContent = 'Update Password';
    submitButton.type = 'button';

    buttonContainer.appendChild(cancelButton);
    buttonContainer.appendChild(submitButton);
    popup.appendChild(buttonContainer);

    submitButton.addEventListener('click', async () => {
        const newPassword = passwordInput.value;
        if (!newPassword) {
            alert('Missing or invalid entry in required fields');
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/users/${user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: newPassword })
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || errorData.error || 'Failed to change password');
            }
            alert('Password changed successfully!');
            document.body.removeChild(overlay);
        } catch (error) {
            console.error('Error changing password:', error);
            alert(`Error: ${error.message}`);
        }
    });

    dragPopup(overlay, popup);
}

window.renderUserManagement = renderUserManagement;