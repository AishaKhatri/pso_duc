// device-status-functions.js

// Helper function to create a base row element
function createBaseRow() {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.marginBottom = '10px';
    row.style.padding = '5px 0';
    row.style.borderBottom = '1px solid var(--border-soft)';
    return row;
}

// Label/value row: bold label on the left, value on the right. `valueStyle`
// overrides the value span's color/fontWeight (used by the status indicator).
function createLabelValueRow(label, valueText, valueStyle = {}) {
    const row = createBaseRow();

    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.fontWeight = 'bold';
    labelSpan.style.color = 'var(--text-primary)';

    const valueSpan = document.createElement('span');
    valueSpan.textContent = valueText;
    valueSpan.style.color = valueStyle.color || 'var(--text-secondary)';
    if (valueStyle.fontWeight) valueSpan.style.fontWeight = valueStyle.fontWeight;

    row.appendChild(labelSpan);
    row.appendChild(valueSpan);

    return row;
}

// Helper function to create status rows
function createStatusRow(label, value) {
    return createLabelValueRow(label, value);
}

// Function to create section header
function createSectionHeader(title, color = 'var(--text-heading)') {
    const header = document.createElement('h3');
    header.textContent = title;
    header.style.color = color;
    header.style.margin = '0 0 10px 0';
    header.style.fontSize = '14px';
    header.style.borderBottom = `2px solid ${color}`;
    header.style.paddingBottom = '5px';
    return header;
}

// Function to create last updated text
function createLastUpdatedText(timestamp) {
    const lastUpdated = document.createElement('div');
    lastUpdated.textContent = `Last updated: ${new Date(timestamp).toLocaleString()}`;
    lastUpdated.style.color = 'var(--text-secondary)';
    lastUpdated.style.fontSize = '12px';
    lastUpdated.style.marginTop = '10px';
    lastUpdated.style.textAlign = 'right';
    return lastUpdated;
}

// Function to create a styled container for content
function createStyledContainer(backgroundColor = 'var(--bg-surface-2)', padding = '10px', borderRadius = '5px') {
    const container = document.createElement('div');
    container.style.backgroundColor = backgroundColor;
    container.style.color = 'var(--text-primary)';
    container.style.padding = padding;
    container.style.borderRadius = borderRadius;
    return container;
}

// Function to create GSM/WiFi toggle buttons for wireless connectivity section
function createWirelessConnectivityButtons(gsmEnabled, wifiEnabled, onButtonChange) {
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'flex-end';
    buttonsContainer.style.gap = '10px';
    
    const makeConnButton = (label, enabled) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.padding = '6px 16px';
        btn.style.border = '1px solid var(--border)';
        btn.style.background = 'var(--bg-surface-2)';
        btn.style.color = 'var(--text-primary)';
        btn.style.borderRadius = '4px';
        btn.style.fontSize = '13px';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        btn.disabled = !enabled;
        return btn;
    };

    const gsmButton = makeConnButton('GSM', gsmEnabled);
    const wifiButton = makeConnButton('WiFi', wifiEnabled);
    
    let activeButton = gsmEnabled ? 'gsm' : (wifiEnabled ? 'wifi' : 'gsm');
    
    // Active = accent fill; inactive = secondary surface. Same rule for both
    // buttons, so derive each from whether it is the active mode.
    const setButtonActive = (btn, active) => {
        btn.style.background = active ? 'var(--accent)' : 'var(--bg-surface-2)';
        btn.style.color = active ? 'var(--text-on-accent)' : 'var(--text-primary)';
        btn.style.border = active ? '1px solid var(--accent)' : '1px solid var(--border)';
    };
    const updateButtonStyles = () => {
        setButtonActive(gsmButton, activeButton === 'gsm');
        setButtonActive(wifiButton, activeButton === 'wifi');
    };
    
    gsmButton.addEventListener('click', () => {
        if (gsmEnabled) {
            activeButton = 'gsm';
            updateButtonStyles();
            onButtonChange('gsm');
        }
    });
    
    wifiButton.addEventListener('click', () => {
        if (wifiEnabled) {
            activeButton = 'wifi';
            updateButtonStyles();
            onButtonChange('wifi');
        }
    });
    
    updateButtonStyles();
    
    buttonsContainer.appendChild(gsmButton);
    buttonsContainer.appendChild(wifiButton);
    
    return { buttonsContainer, gsmButton, wifiButton };
}

// Function to create main tabs (Connectivity Status, Error Logs, and Reset Logs)
function createMainTabs(onTabChange, initialActive = 'connectivity') {
    const tabsContainer = document.createElement('div');
    tabsContainer.style.display = 'flex';
    tabsContainer.style.marginBottom = '12px';
    tabsContainer.style.borderBottom = '2px solid var(--border)';

    const role = window.StationAuth?.getUserInfo?.()?.role;
    const showErrorsAndResets = role !== 'operator';

    const makeTab = (label) => {
        const tab = document.createElement('button');
        tab.textContent = label;
        tab.style.padding = '7px 16px';
        tab.style.border = 'none';
        tab.style.background = 'none';
        tab.style.cursor = 'pointer';
        tab.style.fontSize = '14px';
        // Sit on top of the container's border so the active 3px underline
        // visually replaces it rather than stacking below.
        tab.style.marginBottom = '-2px';
        return tab;
    };

    const connectivityTab = makeTab('Connectivity Status');
    const errorLogsTab = makeTab('Error Logs');
    const resetLogsTab = makeTab('Reset Logs');
    const remarksTab = makeTab('Remarks');

    // Active tab: accent underline + accent bold text. Inactive: muted, plain.
    const tabs = { connectivity: connectivityTab, errorLogs: errorLogsTab, resetLogs: resetLogsTab, remarks: remarksTab };
    const updateTabStyles = (activeTab) => {
        Object.entries(tabs).forEach(([key, tab]) => {
            const active = key === activeTab;
            tab.style.borderBottom = active ? '3px solid var(--accent)' : '3px solid transparent';
            tab.style.fontWeight = active ? 'bold' : 'normal';
            tab.style.color = active ? 'var(--accent)' : 'var(--text-secondary)';
        });
    };

    connectivityTab.addEventListener('click', () => { updateTabStyles('connectivity'); onTabChange('connectivity'); });
    errorLogsTab.addEventListener('click', () => { updateTabStyles('errorLogs'); onTabChange('errorLogs'); });
    resetLogsTab.addEventListener('click', () => { updateTabStyles('resetLogs'); onTabChange('resetLogs'); });
    remarksTab.addEventListener('click', () => { updateTabStyles('remarks'); onTabChange('remarks'); });

    updateTabStyles(initialActive);

    tabsContainer.appendChild(connectivityTab);
    if (showErrorsAndResets) {
        tabsContainer.appendChild(errorLogsTab);
        tabsContainer.appendChild(resetLogsTab);
    }
    // Remarks are viewable by every role (operators included).
    tabsContainer.appendChild(remarksTab);

    return { tabsContainer, connectivityTab, errorLogsTab, resetLogsTab, remarksTab, showErrorsAndResets };
}

// Function to create wireless connectivity section
function createWirelessConnectivitySection(gsmStatus, wifiStatus, gsmEnabled, wifiEnabled) {
    const section = document.createElement('div');
    section.style.flex = '1';
    section.style.padding = '0 15px';
    section.style.borderRight = '1px solid var(--border)';
    
    section.appendChild(createSectionHeader('Wireless Connectivity'));
   
    let activeWirelessMode = gsmEnabled ? 'gsm' : (wifiEnabled ? 'wifi' : 'gsm');
    let currentContent = null;
    
    const { buttonsContainer } = createWirelessConnectivityButtons(
        gsmEnabled, 
        wifiEnabled, 
        (mode) => {
            activeWirelessMode = mode;
            updateWirelessContent();
        }
    );
    
    section.appendChild(buttonsContainer);
    
    const updateWirelessContent = () => {
        if (currentContent) {
            section.removeChild(currentContent);
        }
        
        if (activeWirelessMode === 'gsm') {
            currentContent = createGsmStatusContent(gsmStatus);
        } else {
            currentContent = createWifiStatusContent(wifiStatus);
        }
        
        section.appendChild(currentContent);
    };
    
    updateWirelessContent();
    
    return section;
}

// Function to create GSM status content
function createGsmStatusContent(gsmStatus) {
    const container = document.createElement('div');
    
    if (!gsmStatus) {
        container.appendChild(createNoDataMessage('No GSM status available'));
        return container;
    }

    container.appendChild(createStatusRow('Signal Strength', `${gsmStatus.gsm.signalStrength} dB`));
    container.appendChild(createStatusRow('Master SIM', `${gsmStatus.gsm.masterSIM}`));
    
    if (gsmStatus.pdpContexts && gsmStatus.pdpContexts.length > 0) {
        const pdpHeader = document.createElement('h4');
        pdpHeader.textContent = 'PDP Contexts';
        pdpHeader.style.margin = '15px 0 10px 0';
        pdpHeader.style.color = 'var(--text-primary)';
        pdpHeader.style.fontSize = '13px';
        // Match the separator under the status rows above/below it.
        pdpHeader.style.paddingBottom = '5px';
        pdpHeader.style.borderBottom = '1px solid var(--border-soft)';
        container.appendChild(pdpHeader);

        // All contexts live in a single box, separated by a divider rather than
        // each sitting in its own box.
        const pdpBox = createStyledContainer();
        gsmStatus.pdpContexts.forEach((context, index) => {
            const contextDiv = document.createElement('div');
            if (index > 0) {
                contextDiv.style.marginTop = '10px';
                contextDiv.style.paddingTop = '10px';
                contextDiv.style.borderTop = '1px solid var(--border-soft)';
            }
            contextDiv.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px;">Context ${context.ContextId || index + 1}</div>
                <div>APN: ${context.apn || 'N/A'}</div>
                <div>IPv4: ${context.ipv4 || 'N/A'}</div>
            `;
            pdpBox.appendChild(contextDiv);
        });
        container.appendChild(pdpBox);
    }
    
    container.appendChild(createLastUpdatedText(gsmStatus.lastUpdated));
    
    return container;
}

// Function to create WiFi status content
function createWifiStatusContent(wifiStatus) {
    const container = document.createElement('div');
    
    if (!wifiStatus) {
        container.appendChild(createNoDataMessage('No Wi-Fi status available'));
        return container;
    }
    
    container.appendChild(createStatusRow('Wi-Fi Status', wifiStatus.status));
    
    if (wifiStatus.ssid) {
        container.appendChild(createStatusRow('SSID', wifiStatus.ssid));
    }
    
    if (wifiStatus.ip) {
        container.appendChild(createStatusRow('IP Address', wifiStatus.ip));
    }
    
    if (wifiStatus.signalStrength) {
        container.appendChild(createStatusRow('Signal Strength', `${wifiStatus.signalStrength} dB`));
    }
    
    container.appendChild(createLastUpdatedText(wifiStatus.lastUpdated));
    
    return container;
}

// Function to create MQTT status section
function createMqttStatusSection(mqttStatus, powerStatus, dispenserAddress) {
    const section = document.createElement('div');
    section.style.flex = '1';
    section.style.padding = '0 15px';
    
    section.appendChild(createSectionHeader('MQTT Communication Link'));
    
    if (!mqttStatus) {
        section.appendChild(createNoDataMessage('No MQTT status available'));
    } else {
        section.appendChild(createStatusRow('Subscribed Topics', mqttStatus.subscribedCount.toString()));
        
        if (mqttStatus.subscribedTopics && mqttStatus.subscribedTopics.length > 0) {
            const topicsList = createStyledContainer();
            topicsList.style.maxHeight = '100px';
            topicsList.style.overflowY = 'auto';
            
            mqttStatus.subscribedTopics.forEach(topic => {
                const topicItem = document.createElement('div');
                topicItem.textContent = topic;
                topicItem.style.padding = '2px 0';
                topicItem.style.fontFamily = 'monospace';
                topicItem.style.fontSize = '12px';
                topicsList.appendChild(topicItem);
            });
            
            section.appendChild(topicsList);
        }

        section.appendChild(createLastUpdatedText(mqttStatus.lastUpdated));
    }

    const sectionGap = document.createElement('div');
    sectionGap.style.flex = '1';
    sectionGap.style.padding = '8px';
    section.appendChild(sectionGap);

    section.appendChild(createSectionHeader('Power Status'));
    
    let powerStatuses = [];
    
    if (Array.isArray(powerStatus)) {
        powerStatuses = powerStatus;
    } else if (powerStatus) {
        powerStatuses = [powerStatus];
    }
    
    if (powerStatuses.length === 0) {
        section.appendChild(createNoDataMessage('No power-on status available'));
    } else {
        const recentPowerStatuses = powerStatuses
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
            .slice(0, 5);
        
        const latestStatus = recentPowerStatuses[0];
        
        section.appendChild(createStatusRow('Wakeup Time', (new Date(latestStatus.wakeupTime).toLocaleString())));  
        section.appendChild(createStatusRow('Last Downtime', ""));  

        const infoText = [`Die Time: ${new Date(latestStatus.dieTime).toLocaleString()}`,
                    `Duration: ${formatTimeString(latestStatus.downtimeMs)}`,
                    `Reason: ${latestStatus.message}`
        ];
        
        const messageDiv = createStyledContainer();
        messageDiv.style.fontFamily = 'monospace';
        messageDiv.style.fontSize = '13px';
        
        infoText.forEach(text => {
            const topicItem = document.createElement('div');
            topicItem.textContent = text;
            topicItem.style.padding = '2px 0';
            messageDiv.appendChild(topicItem);
        });
            
        section.appendChild(messageDiv);
        section.appendChild(createLastUpdatedText(latestStatus.lastUpdated));
    }

    // Super-admin-only "Restart Device" action for this dispenser.
    const restartBtn = createRestartDeviceButton(dispenserAddress);
    if (restartBtn) section.appendChild(restartBtn);

    return section;
}

// Build the "Restart Device" button shown in the Power Status section. Returns
// null for any non-super-admin role so the section stays unchanged for them.
// On click it confirms, then asks the backend to publish the broadcast restart
// command (req_type 0, msg_type 12, msg 1) on duc/broadcast/<D-addr>.
function createRestartDeviceButton(dispenserAddress) {
    const role = window.StationAuth?.getUserInfo?.()?.role;
    if (role !== 'super_admin') return null;

    const addrD = ensureDAddress(dispenserAddress);
    if (!addrD) return null;

    // Same styling as the GSM/WiFi buttons in the Wireless Connectivity section.
    const btn = document.createElement('button');
    btn.textContent = 'Restart Device';
    btn.style.marginTop = '15px';
    btn.style.padding = '6px 16px';
    btn.style.border = '1px solid var(--accent)';
    btn.style.background = 'var(--accent)';
    btn.style.color = 'var(--text-on-accent)';
    btn.style.borderRadius = '4px';
    btn.style.fontSize = '13px';
    btn.style.cursor = 'pointer';

    btn.addEventListener('click', () => {
        const { overlay, confirmButton } = createDeletePopup(
            `Send a restart command to device ${addrD}?`,
            {
                title: 'Restart Device',
                confirmText: 'Restart',
                confirmColor: '#D32F2F',
                confirmHoverColor: '#B71C1C'
            }
        );

        confirmButton.onclick = async () => {
            document.body.removeChild(overlay);
            const original = btn.textContent;
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.textContent = 'Restarting…';
            try {
                const resp = await fetch(`${API_BASE_URL}/dispensers/${encodeURIComponent(addrD)}/restart`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
                window.showNotification?.(`Restart command sent to ${addrD}`, 'success')
                    ?? alert(`Restart command sent to ${addrD}`);
            } catch (e) {
                console.error('restart device failed:', e);
                window.showNotification?.(`Restart failed: ${e.message}`, 'error')
                    ?? alert(`Restart failed: ${e.message}`);
            } finally {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.textContent = original;
            }
        };
    });

    return btn;
}

// Enable/disable the "Mark as Cleared" button based on the current selection.
function setMarkButtonEnabled(btn, enabled) {
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.5';
    btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
}

// Build the action bar shared by the error- and reset-log tables: a filter
// dropdown (All / Uncleared Only), a "Total | Uncleared" stat, and an
// admin-only "Mark as Cleared" button. Returns the pieces the caller wires up.
function buildLogActionBar({ allOptionText, currentFilter, totalCount, unclearedCount }) {
    const actionBar = document.createElement('div');
    actionBar.style.display = 'flex';
    actionBar.style.justifyContent = 'space-between';
    actionBar.style.alignItems = 'center';
    actionBar.style.padding = '8px';
    actionBar.style.backgroundColor = 'var(--bg-surface-2)';
    actionBar.style.borderRadius = '8px';
    actionBar.style.border = '1px solid var(--border)';

    const filterDropdown = document.createElement('select');
    filterDropdown.style.padding = '6px 8px';
    filterDropdown.style.fontSize = '13px';
    filterDropdown.style.border = '1px solid var(--border)';
    filterDropdown.style.backgroundColor = 'var(--bg-surface)';
    filterDropdown.style.color = 'var(--text-primary)';
    filterDropdown.style.borderRadius = '4px';
    filterDropdown.style.width = '170px';
    filterDropdown.style.marginBottom = '0';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = allOptionText;
    filterDropdown.appendChild(allOption);

    const unclearedOption = document.createElement('option');
    unclearedOption.value = 'uncleared';
    unclearedOption.textContent = 'Uncleared Only';
    filterDropdown.appendChild(unclearedOption);

    filterDropdown.value = currentFilter;

    const statsSpan = document.createElement('span');
    statsSpan.textContent = `Total: ${totalCount} | Uncleared: ${unclearedCount}`;
    statsSpan.style.fontSize = '13px';
    statsSpan.style.fontWeight = 'bold';
    statsSpan.style.color = 'var(--text-secondary)';

    const role = window.StationAuth?.getUserInfo?.()?.role;
    const canMarkCleared = role === 'admin' || role === 'super_admin';

    const markClearedBtn = createActionButton('var(--accent)', 'var(--accent-hover)');
    markClearedBtn.textContent = '✓ Mark as Cleared';
    markClearedBtn.disabled = true;
    markClearedBtn.style.opacity = '0.5';
    markClearedBtn.style.cursor = 'not-allowed';

    actionBar.appendChild(filterDropdown);
    actionBar.appendChild(statsSpan);
    if (canMarkCleared) {
        actionBar.appendChild(markClearedBtn);
    }

    return { actionBar, filterDropdown, statsSpan, markClearedBtn, canMarkCleared };
}

// Inject a select-all checkbox into the first header cell of a log table.
// Hidden for users who can't mark rows cleared. Returns the checkbox so the
// caller can wire its change/indeterminate behavior.
function injectSelectAllCheckbox(tableContainer, canMarkCleared) {
    const firstTh = tableContainer.querySelector('thead tr th');

    const selectAllContainer = document.createElement('div');
    selectAllContainer.style.display = 'flex';
    selectAllContainer.style.alignItems = 'center';
    selectAllContainer.style.gap = '5px';

    const selectAllCheckbox = document.createElement('input');
    selectAllCheckbox.type = 'checkbox';
    selectAllCheckbox.style.margin = '0';
    if (!canMarkCleared) {
        selectAllCheckbox.style.visibility = 'hidden';
        selectAllCheckbox.disabled = true;
    }

    selectAllContainer.appendChild(selectAllCheckbox);
    firstTh.innerHTML = '';
    firstTh.appendChild(selectAllContainer);

    return selectAllCheckbox;
}

// Function to create reset logs table
function createResetLogsTable(powerStatuses, dispenserAddress, onRefresh, currentClearedIds = new Set(), currentFilter = 'uncleared') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '15px';
    
    // Action bar: filter dropdown, stats, and admin-only mark-cleared button.
    const totalCount = powerStatuses.length;
    const unclearedCount = powerStatuses.filter(status => !currentClearedIds.has(status.id)).length;
    const { actionBar, filterDropdown, markClearedBtn, canMarkCleared: canMarkResetCleared } = buildLogActionBar({
        allOptionText: 'All Resets',
        currentFilter,
        totalCount,
        unclearedCount
    });
    container.appendChild(actionBar);

    let selectedResetIds = new Set();

    const updateMarkButtonState = () => setMarkButtonEnabled(markClearedBtn, selectedResetIds.size > 0);
    
    const renderTable = () => {
        const existingTable = container.querySelector('.reset-table-container');
        if (existingTable) {
            existingTable.remove();
        }
        
        // Filter based on dropdown selection
        let filteredStatuses = [...powerStatuses];
        if (currentFilter === 'uncleared') {
            filteredStatuses = filteredStatuses.filter(status => !currentClearedIds.has(status.id));
        }
        
        if (filteredStatuses.length === 0) {
            const noDataMsg = createNoDataMessage(
                currentFilter === 'uncleared' 
                    ? 'No uncleared resets found' 
                    : 'No reset logs found'
            );
            noDataMsg.style.padding = '40px';
            noDataMsg.classList.add('reset-table-container');
            container.appendChild(noDataMsg);
            return;
        }
        
        // Sort by lastUpdated descending (most recent first)
        const sortedStatuses = [...filteredStatuses].sort((a, b) => 
            new Date(b.lastUpdated) - new Date(a.lastUpdated)
        );
        
        const headers = ['', 'Wakeup Time', 'Die Time', 'Duration', 'Reason', 'Status'];
        const { tableContainer, tbody } = createTable(headers);
        tableContainer.classList.add('reset-table-container');
        
        selectedResetIds.clear();
        updateMarkButtonState();
        
        sortedStatuses.forEach((status, index) => {
            const isCleared = currentClearedIds.has(status.id);
            
            const row = document.createElement('tr');
            row.style.backgroundColor = isCleared ? 'var(--bg-row-cleared)' : (index % 2 === 1 ? 'var(--bg-surface-2)' : 'var(--bg-surface)');
            row.style.color = 'var(--text-primary)';
            row.style.opacity = isCleared ? '0.6' : '1';
            
            // Checkbox cell
            const checkboxTd = document.createElement('td');
            checkboxTd.style.padding = '7px 10px';
            checkboxTd.style.textAlign = 'center';
            checkboxTd.style.borderBottom = '1px solid var(--border)';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'reset-checkbox';
            checkbox.value = status.id;
            checkbox.disabled = isCleared || !canMarkResetCleared;

            if (!canMarkResetCleared) {
                checkbox.style.visibility = 'hidden';
            } else if (!isCleared) {
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        selectedResetIds.add(status.id);
                    } else {
                        selectedResetIds.delete(status.id);
                    }
                    updateMarkButtonState();
                    updateSelectAllCheckbox();
                });
            } else {
                checkbox.style.opacity = '0.5';
            }
            checkboxTd.appendChild(checkbox);
            row.appendChild(checkboxTd);
            
            // Data cells
            const wakeupTime = status.wakeupTime ? new Date(status.wakeupTime).toLocaleString() : 'N/A';
            const dieTime = status.dieTime ? new Date(status.dieTime).toLocaleString() : 'N/A';
            const duration = formatTimeString(status.downtimeMs);
            const reason = status.message || 'Unknown';
            const statusText = isCleared ? 'Cleared' : 'Active';
            
            const cells = [wakeupTime, dieTime, duration, reason, statusText];
            
            cells.forEach((cellText) => {
                const td = document.createElement('td');
                td.textContent = cellText;
                td.style.padding = '7px 10px';
                td.style.borderBottom = '1px solid var(--border)';
                if (isCleared) {
                    td.style.color = 'var(--text-secondary)';
                }
                row.appendChild(td);
            });
            
            tbody.appendChild(row);
        });
        
        const selectAllCheckbox = injectSelectAllCheckbox(tableContainer, canMarkResetCleared);

        const updateSelectAllCheckbox = () => {
            const checkboxes = document.querySelectorAll('.reset-checkbox:not([disabled])');
            const checkedCheckboxes = document.querySelectorAll('.reset-checkbox:checked:not([disabled])');
            selectAllCheckbox.checked = checkboxes.length > 0 && checkedCheckboxes.length === checkboxes.length;
            selectAllCheckbox.indeterminate = checkedCheckboxes.length > 0 && checkedCheckboxes.length < checkboxes.length;
        };

        if (canMarkResetCleared) {
            selectAllCheckbox.addEventListener('change', () => {
                const isChecked = selectAllCheckbox.checked;
                const checkboxes = document.querySelectorAll('.reset-checkbox:not([disabled])');
                checkboxes.forEach(checkbox => {
                    checkbox.checked = isChecked;
                    if (isChecked) {
                        selectedResetIds.add(checkbox.value);
                    } else {
                        selectedResetIds.delete(checkbox.value);
                    }
                });
                updateMarkButtonState();
            });
        }

        container.appendChild(tableContainer);
    };

    renderTable();

    // Filter dropdown handler
    filterDropdown.addEventListener('change', () => {
        const newFilter = filterDropdown.value;
        if (typeof onRefresh === 'function') {
            onRefresh(newFilter);
        }
    });
    
    // Mark as cleared button handler
    markClearedBtn.addEventListener('click', async () => {
        if (selectedResetIds.size === 0) return;
        
        if (confirm(`Are you sure you want to mark ${selectedResetIds.size} reset log(s) as cleared?`)) {
            try {
                const response = await fetch(`${API_BASE_URL}/reset-logs/mark-cleared`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        dispenserAddress: dispenserAddress,
                        resetIds: Array.from(selectedResetIds)
                    })
                });
                
                if (!response.ok) throw new Error('Failed to mark resets as cleared');
                const result = await response.json();
                if (window.showNotification) {
                    window.showNotification(result.message, 'success');
                }
                
                if (typeof onRefresh === 'function') {
                    onRefresh(filterDropdown.value);
                }
            } catch (error) {
                console.error('Error marking resets as cleared:', error);
                if (window.showNotification) {
                    window.showNotification('Failed to mark resets as cleared', 'error');
                }
            }
        }
    });
    
    return container;
}

// Function to create error logs table view
function createErrorsTable(errorLogs, dispenserAddress, onRefresh, currentFilterValue = 'uncleared') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '15px';
    
    const totalCount = errorLogs.length;
    const unclearedCount = errorLogs.filter(log => log.cleared !== 1).length;
    const { actionBar, filterDropdown, markClearedBtn, canMarkCleared: canMarkErrorCleared } = buildLogActionBar({
        allOptionText: 'All Errors',
        currentFilter: currentFilterValue,
        totalCount,
        unclearedCount
    });
    container.appendChild(actionBar);

    let selectedErrorIds = new Set();

    const updateMarkButtonState = () => setMarkButtonEnabled(markClearedBtn, selectedErrorIds.size > 0);
    
    const renderTable = () => {
        const existingTable = container.querySelector('.error-table-container');
        if (existingTable) {
            existingTable.remove();
        }
        
        // Filter based on dropdown selection
        let displayErrors = [...errorLogs];
        if (currentFilterValue === 'uncleared') {
            displayErrors = displayErrors.filter(log => log.cleared !== 1);
        }
        
        if (displayErrors.length === 0) {
            const noDataMsg = createNoDataMessage(
                currentFilterValue === 'uncleared' 
                    ? 'No uncleared errors found' 
                    : 'No errors found'
            );
            noDataMsg.style.padding = '40px';
            noDataMsg.classList.add('error-table-container');
            container.appendChild(noDataMsg);
            return;
        }
        
        const headers = ['', 'Log Time', 'Error Code', 'Severity', 'File', 'Line', 'Function', 'Context', 'Status'];
        const { tableContainer, tbody } = createTable(headers);
        tableContainer.classList.add('error-table-container');
        
        selectedErrorIds.clear();
        updateMarkButtonState();
        
        displayErrors.forEach((log, index) => {
            const row = document.createElement('tr');
            row.style.backgroundColor = log.cleared ? 'var(--bg-row-cleared)' : (index % 2 === 1 ? 'var(--bg-surface-2)' : 'var(--bg-surface)');
            row.style.color = 'var(--text-primary)';
            row.style.opacity = log.cleared ? '0.6' : '1';
            
            const checkboxTd = document.createElement('td');
            checkboxTd.style.padding = '7px 10px';
            checkboxTd.style.textAlign = 'center';
            checkboxTd.style.borderBottom = '1px solid var(--border)';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'error-checkbox';
            checkbox.value = log.id;
            checkbox.disabled = log.cleared === 1 || !canMarkErrorCleared;
            if (!canMarkErrorCleared) {
                checkbox.style.visibility = 'hidden';
            } else if (log.cleared === 0) {
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        selectedErrorIds.add(log.id);
                    } else {
                        selectedErrorIds.delete(log.id);
                    }
                    updateMarkButtonState();
                    updateSelectAllCheckbox();
                });
            } else {
                checkbox.style.opacity = '0.5';
            }
            checkboxTd.appendChild(checkbox);
            row.appendChild(checkboxTd);
            
            const logTime = log.unix_time ? new Date(log.unix_time * 1000).toLocaleString() : 'N/A';
            const errorCode = log.error_code || log.Code || 'N/A';
            const severity = log.severity || log.Sev || 'N/A';
            const file = log.file || log.File || 'N/A';
            const line = log.line || log.Line || 'N/A';
            const functionName = log.function || log.Func || 'N/A';
            const context = log.context || log.Cntx || 'N/A';
            const status = log.cleared ? 'Cleared' : 'Active';
            
            const cells = [logTime, errorCode, severity, file, line, functionName, context, status];
            
            cells.forEach((cellText, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = cellText;
                td.style.padding = '7px 10px';
                td.style.borderBottom = '1px solid var(--border)';
                if (cellIndex === cells.length - 2) {
                    td.style.maxWidth = '300px';
                    td.style.overflow = 'auto';
                    td.style.wordBreak = 'break-word';
                    td.style.whiteSpace = 'normal';
                }
                if (log.cleared) {
                    td.style.color = 'var(--text-secondary)';
                }
                row.appendChild(td);
            });
            
            tbody.appendChild(row);
        });
        
        const selectAllCheckbox = injectSelectAllCheckbox(tableContainer, canMarkErrorCleared);

        const updateSelectAllCheckbox = () => {
            const checkboxes = document.querySelectorAll('.error-checkbox');
            const checkedCount = document.querySelectorAll('.error-checkbox:checked').length;
            selectAllCheckbox.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
        };

        if (canMarkErrorCleared) {
            selectAllCheckbox.addEventListener('change', () => {
                const isChecked = selectAllCheckbox.checked;
                const checkboxes = document.querySelectorAll('.error-checkbox');
                checkboxes.forEach(checkbox => {
                    checkbox.checked = isChecked;
                    const errorId = parseInt(checkbox.value);
                    if (isChecked) {
                        selectedErrorIds.add(errorId);
                    } else {
                        selectedErrorIds.delete(errorId);
                    }
                });
                updateMarkButtonState();
            });
        }

        container.appendChild(tableContainer);
    };
    
    // Initial render
    renderTable();
    
    // Filter dropdown handler - just re-render, don't fetch again
    filterDropdown.addEventListener('change', () => {
        currentFilterValue = filterDropdown.value;
        renderTable();
    });
    
    markClearedBtn.addEventListener('click', async () => {
        if (selectedErrorIds.size === 0) return;
        
        if (confirm(`Are you sure you want to mark ${selectedErrorIds.size} error(s) as cleared?`)) {
            try {
                const response = await fetch(`${API_BASE_URL}/error-log/mark-cleared`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ errorIds: Array.from(selectedErrorIds) })
                });
                
                if (!response.ok) throw new Error('Failed to mark errors as cleared');
                const result = await response.json();
                if (window.showNotification) {
                    window.showNotification(result.message, 'success');
                }
                
                if (typeof onRefresh === 'function') {
                    onRefresh(filterDropdown.value === 'all');
                }
            } catch (error) {
                console.error('Error marking errors as cleared:', error);
                if (window.showNotification) {
                    window.showNotification('Failed to mark errors as cleared', 'error');
                }
            }
        }
    });
    
    return container;
}

// Remarks tab: an append-only history table on the left (no Clear option,
// unlike errors / resets) plus, for admin / super_admin, an "Add Remark" panel
// on the right. Keyed by the dispenser's D-address. Author + IP come from the
// history rows.
function createRemarksTab(dispenserTopic) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.alignItems = 'flex-start';
    container.style.gap = '15px';

    const role = window.StationAuth?.getUserInfo?.()?.role;
    const canEdit = role === 'admin' || role === 'super_admin';

    const tableHost = document.createElement('div');
    tableHost.style.flex = '1';
    tableHost.style.minWidth = '0';  // let a wide table scroll instead of overflowing

    const loadRemarks = async () => {
        tableHost.innerHTML = '';
        let rows = [];
        try {
            const resp = await fetch(`${API_BASE_URL}/dispensers/${encodeURIComponent(dispenserTopic)}/remarks`);
            if (resp.ok) rows = await resp.json();
        } catch (e) {
            console.error('Failed to load remarks:', e);
        }

        if (!Array.isArray(rows) || rows.length === 0) {
            const noData = createNoDataMessage('No remarks recorded for this dispenser yet.');
            noData.style.padding = '40px';
            tableHost.appendChild(noData);
            return;
        }

        const { tableContainer, tbody } = createTable(['Time', 'Remark', 'Added By', 'IP']);
        rows.forEach((r, index) => {
            const tr = document.createElement('tr');
            tr.style.backgroundColor = index % 2 === 1 ? 'var(--bg-surface-2)' : 'var(--bg-surface)';
            tr.style.color = 'var(--text-primary)';
            const time = r.created_at ? new Date(r.created_at).toLocaleString() : 'N/A';
            const cells = [time, r.remark || '', r.created_by || 'N/A', r.created_ip || 'N/A'];
            cells.forEach((text, i) => {
                const td = document.createElement('td');
                td.textContent = text;
                td.style.padding = '7px 10px';
                td.style.borderBottom = '1px solid var(--border)';
                if (i === 1) {  // Remark column: allow wrapping for long notes.
                    td.style.maxWidth = '420px';
                    td.style.whiteSpace = 'normal';
                    td.style.wordBreak = 'break-word';
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        tableHost.appendChild(tableContainer);
    };

    // Table on the left; the add-remark panel sits to its right.
    container.appendChild(tableHost);

    if (canEdit) {
        // Styled to match the Date Filter panel in the transaction-log popup.
        const addBox = document.createElement('div');
        addBox.style.backgroundColor = 'var(--bg-surface)';
        addBox.style.color = 'var(--text-primary)';
        addBox.style.padding = '10px 12px';
        addBox.style.borderRadius = '8px';
        addBox.style.border = '1px solid var(--border)';
        addBox.style.flex = '0 0 300px';
        addBox.style.width = '300px';

        const addHeader = createHeader();
        const addTitle = createTitle();
        addTitle.textContent = 'Add Remark';
        addTitle.style.fontSize = '14px';
        addHeader.appendChild(addTitle);
        addBox.appendChild(addHeader);

        const addInner = document.createElement('div');
        addInner.style.display = 'flex';
        addInner.style.flexDirection = 'column';
        addInner.style.gap = '10px';
        addInner.style.marginTop = '10px';

        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Add a remark…';
        textarea.rows = 3;
        Object.assign(textarea.style, {
            width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '60px',
            padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '4px',
            background: 'var(--bg-surface-2)', color: 'var(--text-primary)',
            fontSize: '14px', fontFamily: 'inherit'
        });

        const buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.alignItems = 'center';
        buttonRow.style.gap = '10px';
        buttonRow.style.marginTop = '5px';
        const addBtn = createActionButton();
        addBtn.textContent = 'Add';
        const status = document.createElement('span');
        status.style.fontSize = '13px';
        buttonRow.appendChild(addBtn);
        buttonRow.appendChild(status);

        addInner.appendChild(textarea);
        addInner.appendChild(buttonRow);
        addBox.appendChild(addInner);
        container.appendChild(addBox);

        addBtn.addEventListener('click', async () => {
            const value = textarea.value.trim();
            if (!value) {
                status.textContent = 'Enter a remark first';
                status.style.color = 'var(--text-secondary)';
                return;
            }
            addBtn.disabled = true;
            addBtn.style.opacity = '0.6';
            status.textContent = 'Saving…';
            status.style.color = 'var(--text-secondary)';
            try {
                const resp = await fetch(`${API_BASE_URL}/dispensers/${encodeURIComponent(dispenserTopic)}/remarks`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ remark: value })
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
                textarea.value = '';
                status.textContent = 'Added';
                status.style.color = 'var(--badge-online-text)';
                await loadRemarks();
            } catch (e) {
                status.textContent = `Failed: ${e.message}`;
                status.style.color = 'var(--danger)';
            } finally {
                addBtn.disabled = false;
                addBtn.style.opacity = '1';
            }
        });
    }

    loadRemarks();
    return container;
}

// Function to create modal header
function createModalHeader(address, overlay) {
    const header = createHeader();
    
    const title = createTitle();
    title.textContent = `Device Status - ${address}`;
    
    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    
    return header;
}

function addDeviceInfoFooter(popupElement, deviceIdentifier) {
    const footer = document.createElement('div');
    footer.style.cssText = `
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 5px 20px;
        border-top: 1px solid var(--border);
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        z-index: 1;
    `;
    
    popupElement.style.paddingBottom = '40px';
    
    const infoItems = [
        { id: 'temp', label: 'Device Temperature:' },
        { id: 'fw', label: 'Firmware Version:' },
        { id: 'hw', label: 'Hardware Version:' },
        { id: 'mac', label: 'MAC Address:' }
    ];
    
    const infoElements = {};
    
    infoItems.forEach(item => {
        const container = document.createElement('div');
        container.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
        `;
        
        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        labelSpan.style.fontWeight = '500';
        labelSpan.style.color = 'var(--text-secondary)';
        
        const valueSpan = document.createElement('span');
        
        container.appendChild(labelSpan);
        container.appendChild(valueSpan);
        footer.appendChild(container);
        
        infoElements[item.id] = valueSpan;
    });
    
    popupElement.appendChild(footer);
    
    fetchDeviceInfo(deviceIdentifier, infoElements);
}

async function fetchDeviceInfo(deviceIdentifier, infoElements) {
    try {
        const response = await fetch(`${API_BASE_URL}/device-info/${deviceIdentifier}`);
        if (!response.ok) {
            throw new Error('Failed to fetch device info');
        }
        
        const deviceInfo = await response.json();
        
        if (deviceInfo) {
            infoElements.temp.textContent = deviceInfo.temperature ? `${deviceInfo.temperature}°C` : 'N/A';
            infoElements.fw.textContent = deviceInfo.firmware_version || 'N/A';
            infoElements.hw.textContent = deviceInfo.hardware_version || 'N/A';
            infoElements.mac.textContent = deviceInfo.mac_address || 'N/A';
        }
    } catch (error) {
        console.error('Error fetching device info:', error);
    }
}

function formatTimeString(timeMs) {
    if (timeMs < 1000) {
        return 'Less than 1 second';
    }
    
    const seconds = Math.floor(timeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} day${days > 1 ? 's' : ''} ${hours % 24} hour${hours % 24 > 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''} ${minutes % 60} minute${minutes % 60 > 1 ? 's' : ''}`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes > 1 ? 's' : ''} ${seconds % 60} second${seconds % 60 > 1 ? 's' : ''}`;
    } else {
        return `${seconds} second${seconds > 1 ? 's' : ''}`;
    }
}

// Main function to show device status popup
async function showDevStatusPopup(dispenserTopic, defaultTab = 'connectivity') {
    try {
        // Operators cannot view error/reset logs
        const popupRole = window.StationAuth?.getUserInfo?.()?.role;
        if (popupRole === 'operator' && (defaultTab === 'errorLogs' || defaultTab === 'resetLogs')) {
            defaultTab = 'connectivity';
        }
        const dispenserAddress = stripDAddress(dispenserTopic);
        
        const [gsmResponse, wifiResponse, mqttResponse, powerResponse, errorsResponse, gsmConnResponse, wifiConnResponse] = await Promise.allSettled([
            fetch(`${API_BASE_URL}/gsm-status/${dispenserTopic}`),
            fetch(`${API_BASE_URL}/wifi-status/${dispenserTopic}`),
            fetch(`${API_BASE_URL}/mqtt-status/${dispenserTopic}`),
            fetch(`${API_BASE_URL}/power-status/${dispenserTopic}`),
            fetch(`${API_BASE_URL}/error-log/${dispenserAddress}`),
            fetch(`${API_BASE_URL}/gsm-connection-status/${dispenserTopic}`),
            fetch(`${API_BASE_URL}/wifi-connection-status/${dispenserTopic}`)
        ]);

        const gsmStatus = gsmResponse.status === 'fulfilled' && gsmResponse.value.ok ? await gsmResponse.value.json() : null;
        const wifiStatus = wifiResponse.status === 'fulfilled' && wifiResponse.value.ok ? await wifiResponse.value.json() : null;
        const mqttStatus = mqttResponse.status === 'fulfilled' && mqttResponse.value.ok ? await mqttResponse.value.json() : null;
        const powerStatus = powerResponse.status === 'fulfilled' && powerResponse.value.ok ? await powerResponse.value.json() : null;
        const errorLogs = errorsResponse.status === 'fulfilled' && errorsResponse.value.ok ? await errorsResponse.value.json() : null;
        const gsmConnData  = gsmConnResponse.status === 'fulfilled' && gsmConnResponse.value.ok ? await gsmConnResponse.value.json() : null;
        const wifiConnData  = wifiConnResponse.status === 'fulfilled' && wifiConnResponse.value.ok ? await wifiConnResponse.value.json() : null;

        // Ensure powerStatus is an array
        if (!Array.isArray(powerStatus)) {
            powerStatus = powerStatus ? [powerStatus] : [];
        }

        const gsmStatuses = gsmConnData?.status || [];
        const wifiStatuses = wifiConnData?.status || [];
        
        const gsmEnabled = gsmStatuses && gsmStatuses.length > 0 && gsmStatuses.some(status => status.message && status.message.includes('CONNECTED'));
        const wifiEnabled = wifiStatuses && wifiStatuses.length > 0 && wifiStatuses.some(status => status.message && status.message.includes('CONNECTED'));
        
        const overlay = createModalOverlay();
        
        const modal = document.createElement('div');
        modal.className = 'popup-modal';
        modal.style.width = '1200px';
        modal.style.maxWidth = '95%';
        modal.style.height = '620px';
        modal.style.maxHeight = 'calc(var(--vh100) - 40px)';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        dragPopup(overlay, modal);
        
        const contentContainer = document.createElement('div');
        contentContainer.style.flex = '1';
        contentContainer.style.overflow = 'auto';
        contentContainer.style.padding = '10px';
        
        let activeTab = defaultTab;
        let currentContent = null;
        let clearedResetIndices = new Set();
        
        // Load cleared resets from server
        try {
            const clearedResponse = await fetch(`${API_BASE_URL}/cleared-resets/${dispenserTopic}`);
            if (clearedResponse.ok) {
                const clearedData = await clearedResponse.json();
                clearedResetIndices = new Set(clearedData.indices || []);
            }
        } catch (error) {
            console.error('Error loading cleared resets:', error);
        }
        
        const { tabsContainer } = createMainTabs((tab) => {
            activeTab = tab;
            updateMainContent();
        }, defaultTab);
        
        const updateMainContent = () => {
            if (currentContent && contentContainer.contains(currentContent)) {
                contentContainer.removeChild(currentContent);
            }
            
            if (activeTab === 'connectivity') {
                const columnsContainer = document.createElement('div');
                columnsContainer.style.display = 'flex';
                columnsContainer.style.gap = '15px';
                columnsContainer.style.marginTop = '10px';
                
                columnsContainer.appendChild(createWirelessConnectivitySection(gsmStatus, wifiStatus, gsmEnabled, wifiEnabled));
                columnsContainer.appendChild(createMqttStatusSection(mqttStatus, powerStatus, dispenserTopic));
                
                currentContent = columnsContainer;
            } else if (activeTab === 'errorLogs') {
                const errorContainer = document.createElement('div');
                errorContainer.id = 'error-logs-container';
                errorContainer.style.height = '100%';
                errorContainer.style.overflow = 'auto';
                
                let currentFilterValue = 'uncleared';
                
                const loadErrors = async (showAll = false) => {
                    currentFilterValue = showAll ? 'all' : 'uncleared';
                    const response = await fetch(
                        `${API_BASE_URL}/error-log/${encodeURIComponent(dispenserAddress)}?showCleared=${showAll}`
                    );
                    if (response.ok) {
                        const allErrors = await response.json();
                        errorContainer.innerHTML = '';
                        const table = createErrorsTable(allErrors, dispenserAddress, (showAllErrors) => {
                            loadErrors(showAllErrors);
                        }, currentFilterValue);
                        errorContainer.appendChild(table);
                    }
                };
                
                loadErrors(false);
                currentContent = errorContainer;
            } else if (activeTab === 'resetLogs') {
                const resetContainer = document.createElement('div');
                resetContainer.id = 'reset-logs-container';
                resetContainer.style.height = '100%';
                resetContainer.style.overflow = 'auto';
                
                const loadResets = async (filter = 'uncleared') => {
                    const showCleared = filter === 'all';
                    const response = await fetch(
                        `${API_BASE_URL}/power-status/${encodeURIComponent(dispenserTopic)}?showCleared=${showCleared}`
                    );
                    if (response.ok) {
                        let freshPowerStatus = await response.json();
                        if (!Array.isArray(freshPowerStatus)) {
                            freshPowerStatus = freshPowerStatus ? [freshPowerStatus] : [];
                        }
                        
                        const clearedResponse = await fetch(`${API_BASE_URL}/cleared-resets/${dispenserTopic}`);
                        let clearedIds = new Set();
                        if (clearedResponse.ok) {
                            const clearedData = await clearedResponse.json();
                            clearedIds = new Set(clearedData.ids || []);
                        }
                        
                        resetContainer.innerHTML = '';
                        const table = createResetLogsTable(freshPowerStatus, dispenserTopic, (newFilter) => {
                            loadResets(newFilter);
                            if (typeof window.updateResetCount === 'function') {
                                // Bypass the bulk-prefetched cache — the count
                                // just changed, so re-read it live.
                                window.updateResetCount(dispenserAddress, true);
                            }
                        }, clearedIds, filter);
                        resetContainer.appendChild(table);
                    }
                };

                loadResets('uncleared');
                currentContent = resetContainer;
            } else if (activeTab === 'remarks') {
                currentContent = createRemarksTab(dispenserTopic);
            }

            contentContainer.appendChild(currentContent);
        };
        
        const header = createModalHeader(dispenserTopic, overlay);
        
        modal.appendChild(header);
        modal.appendChild(tabsContainer);
        modal.appendChild(contentContainer);
        
        updateMainContent();
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        addDeviceInfoFooter(modal, dispenserTopic);
        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
    } catch (error) {
        console.error('Error showing device status:', error);
        if (window.showNotification) {
            window.showNotification('Error loading device status', 'error');
        }
    }
}

// Make functions available globally
window.showDevStatusPopup = showDevStatusPopup;