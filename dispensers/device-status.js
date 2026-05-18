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

// Helper function to create status rows
function createStatusRow(label, value) {
    const row = createBaseRow();
    
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.fontWeight = 'bold';
    labelSpan.style.color = 'var(--text-primary)';

    const valueSpan = document.createElement('span');
    valueSpan.textContent = value;
    valueSpan.style.color = 'var(--text-secondary)';
    
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    
    return row;
}

// Helper function to create status indicator
function createStatusIndicator(label, status, trueText = 'Yes', falseText = 'No') {
    const row = createBaseRow();
    
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.fontWeight = 'bold';
    labelSpan.style.color = 'var(--text-primary)';

    const valueSpan = document.createElement('span');
    valueSpan.textContent = status ? trueText : falseText;
    valueSpan.style.color = status ? 'var(--status-online)' : 'var(--status-offline)';
    valueSpan.style.fontWeight = 'bold';
    
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    
    return row;
}

// Function to create section header
function createSectionHeader(title, color = '#2e7d32') {
    const header = document.createElement('h3');
    header.textContent = title;
    header.style.color = color;
    header.style.margin = '0 0 15px 0';
    header.style.fontSize = '16px';
    header.style.borderBottom = `2px solid ${color}`;
    header.style.paddingBottom = '5px';
    return header;
}

// Function to create last updated text
function createLastUpdatedText(timestamp) {
    const lastUpdated = document.createElement('div');
    lastUpdated.textContent = `Last updated: ${new Date(timestamp).toLocaleString()}`;
    lastUpdated.style.color = 'var(--text-secondary)';
    lastUpdated.style.fontSize = '14px';
    lastUpdated.style.marginTop = '15px';
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
    
    const gsmButton = document.createElement('button');
    gsmButton.textContent = 'GSM';
    gsmButton.style.padding = '6px 16px';
    gsmButton.style.border = '1px solid var(--border)';
    gsmButton.style.background = 'var(--bg-surface-2)';
    gsmButton.style.color = 'var(--text-primary)';
    gsmButton.style.borderRadius = '4px';
    gsmButton.style.fontSize = '14px';
    gsmButton.style.cursor = gsmEnabled ? 'pointer' : 'not-allowed';
    gsmButton.disabled = !gsmEnabled;
    
    const wifiButton = document.createElement('button');
    wifiButton.textContent = 'WiFi';
    wifiButton.style.padding = '6px 16px';
    wifiButton.style.border = '1px solid var(--border)';
    wifiButton.style.background = 'var(--bg-surface-2)';
    wifiButton.style.color = 'var(--text-primary)';
    wifiButton.style.borderRadius = '4px';
    wifiButton.style.fontSize = '14px';
    wifiButton.style.cursor = wifiEnabled ? 'pointer' : 'not-allowed';
    wifiButton.disabled = !wifiEnabled;
    
    let activeButton = gsmEnabled ? 'gsm' : (wifiEnabled ? 'wifi' : 'gsm');
    
    const updateButtonStyles = () => {
        if (activeButton === 'gsm') {
            gsmButton.style.background = 'var(--status-online)';
            gsmButton.style.color = '#fff';
            gsmButton.style.border = '1px solid var(--status-online)';
            wifiButton.style.background = 'var(--bg-surface-2)';
            wifiButton.style.color = 'var(--text-primary)';
            wifiButton.style.border = '1px solid var(--border)';
        } else {
            wifiButton.style.background = 'var(--status-online)';
            wifiButton.style.color = '#fff';
            wifiButton.style.border = '1px solid var(--status-online)';
            gsmButton.style.background = 'var(--bg-surface-2)';
            gsmButton.style.color = 'var(--text-primary)';
            gsmButton.style.border = '1px solid var(--border)';
        }
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
function createMainTabs(onTabChange) {
    const tabsContainer = document.createElement('div');
    tabsContainer.style.display = 'flex';
    tabsContainer.style.marginBottom = '20px';
    tabsContainer.style.borderBottom = '2px solid var(--border)';

    const role = window.StationAuth?.getUserInfo?.()?.role;
    const showErrorsAndResets = role !== 'operator';

    const connectivityTab = document.createElement('button');
    connectivityTab.textContent = 'Connectivity Status';
    connectivityTab.style.padding = '10px 20px';
    connectivityTab.style.border = 'none';
    connectivityTab.style.background = 'none';
    connectivityTab.style.borderBottom = '3px solid #2e7d32';
    connectivityTab.style.fontWeight = 'bold';
    connectivityTab.style.color = '#2e7d32';
    connectivityTab.style.cursor = 'pointer';
    connectivityTab.style.fontSize = '16px';

    const errorLogsTab = document.createElement('button');
    errorLogsTab.textContent = 'Error Logs';
    errorLogsTab.style.padding = '10px 20px';
    errorLogsTab.style.border = 'none';
    errorLogsTab.style.background = 'none';
    errorLogsTab.style.fontWeight = 'normal';
    errorLogsTab.style.color = '#2e7d32';
    errorLogsTab.style.cursor = 'pointer';
    errorLogsTab.style.fontSize = '16px';

    const resetLogsTab = document.createElement('button');
    resetLogsTab.textContent = 'Reset Logs';
    resetLogsTab.style.padding = '10px 20px';
    resetLogsTab.style.border = 'none';
    resetLogsTab.style.background = 'none';
    resetLogsTab.style.fontWeight = 'normal';
    resetLogsTab.style.color = '#2e7d32';
    resetLogsTab.style.cursor = 'pointer';
    resetLogsTab.style.fontSize = '16px';
    
    const updateTabStyles = (activeTab) => {
        if (activeTab === 'connectivity') {
            connectivityTab.style.borderBottom = '3px solid #2e7d32';
            connectivityTab.style.fontWeight = 'bold';
            errorLogsTab.style.borderBottom = 'none';
            errorLogsTab.style.fontWeight = 'normal';
            resetLogsTab.style.borderBottom = 'none';
            resetLogsTab.style.fontWeight = 'normal';
        } else if (activeTab === 'errorLogs') {
            errorLogsTab.style.borderBottom = '3px solid #2e7d32';
            errorLogsTab.style.fontWeight = 'bold';
            connectivityTab.style.borderBottom = 'none';
            connectivityTab.style.fontWeight = 'normal';
            resetLogsTab.style.borderBottom = 'none';
            resetLogsTab.style.fontWeight = 'normal';
        } else {
            resetLogsTab.style.borderBottom = '3px solid #2e7d32';
            resetLogsTab.style.fontWeight = 'bold';
            connectivityTab.style.borderBottom = 'none';
            connectivityTab.style.fontWeight = 'normal';
            errorLogsTab.style.borderBottom = 'none';
            errorLogsTab.style.fontWeight = 'normal';
        }
    };
    
    connectivityTab.addEventListener('click', () => {
        updateTabStyles('connectivity');
        onTabChange('connectivity');
    });
    
    errorLogsTab.addEventListener('click', () => {
        updateTabStyles('errorLogs');
        onTabChange('errorLogs');
    });
    
    resetLogsTab.addEventListener('click', () => {
        updateTabStyles('resetLogs');
        onTabChange('resetLogs');
    });
    
    tabsContainer.appendChild(connectivityTab);
    if (showErrorsAndResets) {
        tabsContainer.appendChild(errorLogsTab);
        tabsContainer.appendChild(resetLogsTab);
    }

    return { tabsContainer, connectivityTab, errorLogsTab, resetLogsTab, showErrorsAndResets };
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
        pdpHeader.style.color = '#2e7d32';
        pdpHeader.style.fontSize = '14px';
        container.appendChild(pdpHeader);
        
        gsmStatus.pdpContexts.forEach((context, index) => {
            const contextDiv = createStyledContainer();
            contextDiv.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px;">Context ${context.ContextId || index + 1}</div>
                <div>APN: ${context.apn || 'N/A'}</div>
                <div>IPv4: ${context.ipv4 || 'N/A'}</div>
            `;
            container.appendChild(contextDiv);
        });
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
function createMqttStatusSection(mqttStatus, powerStatus) {
    const section = document.createElement('div');
    section.style.flex = '1';
    section.style.padding = '0 15px';
    
    section.appendChild(createSectionHeader('MQTT Communication Link', '#2e7d32'));
    
    if (!mqttStatus) {
        section.appendChild(createNoDataMessage('No MQTT status available'));
    } else {
        section.appendChild(createStatusIndicator('MQTT Started', mqttStatus.started));
        section.appendChild(createStatusIndicator('Client Acquired', mqttStatus.clientAcquired));
        section.appendChild(createStatusIndicator('Broker Connected', mqttStatus.brokerConnected));
        section.appendChild(createStatusRow('Subscribed Topics', mqttStatus.subscribedCount.toString()));
        
        if (mqttStatus.subscribedTopics && mqttStatus.subscribedTopics.length > 0) {
            const topicsList = createStyledContainer();
            topicsList.style.maxHeight = '120px';
            topicsList.style.overflowY = 'auto';
            
            mqttStatus.subscribedTopics.forEach(topic => {
                const topicItem = document.createElement('div');
                topicItem.textContent = topic;
                topicItem.style.padding = '2px 0';
                topicItem.style.fontFamily = 'monospace';
                topicItem.style.fontSize = '14px';
                topicsList.appendChild(topicItem);
            });
            
            section.appendChild(topicsList);
        }

        section.appendChild(createLastUpdatedText(mqttStatus.lastUpdated));
    }

    const sectionGap = document.createElement('div');
    sectionGap.style.flex = '1';
    sectionGap.style.padding = '15px 15px';
    section.appendChild(sectionGap);

    section.appendChild(createSectionHeader('Power Status', '#2e7d32'));
    
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
        messageDiv.style.fontSize = '14px';
        
        infoText.forEach(text => {
            const topicItem = document.createElement('div');
            topicItem.textContent = text;
            topicItem.style.padding = '2px 0';
            messageDiv.appendChild(topicItem);
        });
            
        section.appendChild(messageDiv);
        section.appendChild(createLastUpdatedText(latestStatus.lastUpdated));
    }
   
    return section;
}

// Function to create reset logs table
function createResetLogsTable(powerStatuses, dispenserAddress, onRefresh, currentClearedIds = new Set(), currentFilter = 'uncleared') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '15px';
    
    // Action bar with filter dropdown and stats
    const actionBar = document.createElement('div');
    actionBar.style.display = 'flex';
    actionBar.style.justifyContent = 'space-between';
    actionBar.style.alignItems = 'center';
    actionBar.style.padding = '10px';
    actionBar.style.backgroundColor = 'var(--bg-surface-2)';
    actionBar.style.borderRadius = '8px';
    actionBar.style.border = '1px solid var(--border)';
    
    // Create filter dropdown
    const filterDropdown = document.createElement('select');
    filterDropdown.style.padding = '8px';
    filterDropdown.style.border = '1px solid var(--border)';
    filterDropdown.style.backgroundColor = 'var(--bg-surface)';
    filterDropdown.style.color = 'var(--text-primary)';
    filterDropdown.style.borderRadius = '4px';
    filterDropdown.style.width = '200px';
    filterDropdown.style.marginBottom = '0';
    
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Resets';
    filterDropdown.appendChild(allOption);
    
    const unclearedOption = document.createElement('option');
    unclearedOption.value = 'uncleared';
    unclearedOption.textContent = 'Uncleared Only';
    filterDropdown.appendChild(unclearedOption);
    
    filterDropdown.value = currentFilter;
    
    // Stats display
    const totalCount = powerStatuses.length;
    const unclearedCount = powerStatuses.filter(status => !currentClearedIds.has(status.id)).length;
    const statsSpan = document.createElement('span');
    statsSpan.textContent = `Total: ${totalCount} | Uncleared: ${unclearedCount}`;
    statsSpan.style.fontSize = '14px';
    statsSpan.style.fontWeight = 'bold';
    statsSpan.style.color = 'var(--text-secondary)';
    
    // Mark as cleared button (admin-only)
    const resetMarkRole = window.StationAuth?.getUserInfo?.()?.role;
    const canMarkResetCleared = resetMarkRole === 'admin' || resetMarkRole === 'super_admin';

    const markClearedBtn = createActionButton('#2E7D32', '#1B5E20');
    markClearedBtn.textContent = '✓ Mark as Cleared';
    markClearedBtn.disabled = true;
    markClearedBtn.style.opacity = '0.5';
    markClearedBtn.style.cursor = 'not-allowed';

    actionBar.appendChild(filterDropdown);
    actionBar.appendChild(statsSpan);
    if (canMarkResetCleared) {
        actionBar.appendChild(markClearedBtn);
    }
    container.appendChild(actionBar);

    let selectedResetIds = new Set();
    
    const updateMarkButtonState = () => {
        const hasSelected = selectedResetIds.size > 0;
        markClearedBtn.disabled = !hasSelected;
        markClearedBtn.style.opacity = hasSelected ? '1' : '0.5';
        markClearedBtn.style.cursor = hasSelected ? 'pointer' : 'not-allowed';
    };
    
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
            row.style.backgroundColor = isCleared ? 'var(--bg-row-cleared)' : (index % 2 === 0 ? 'var(--bg-surface-2)' : 'var(--bg-surface)');
            row.style.color = 'var(--text-primary)';
            row.style.opacity = isCleared ? '0.6' : '1';
            
            // Checkbox cell
            const checkboxTd = document.createElement('td');
            checkboxTd.style.padding = '12px';
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
                td.style.padding = '12px';
                td.style.borderBottom = '1px solid var(--border)';
                if (isCleared) {
                    td.style.color = 'var(--text-secondary)';
                }
                row.appendChild(td);
            });
            
            tbody.appendChild(row);
        });
        
        const thead = tableContainer.querySelector('thead');
        const headerRow = thead.querySelector('tr');
        const firstTh = headerRow.querySelector('th');
        const selectAllContainer = document.createElement('div');
        selectAllContainer.style.display = 'flex';
        selectAllContainer.style.alignItems = 'center';
        selectAllContainer.style.gap = '5px';
        
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllCheckbox.style.margin = '0';
        if (!canMarkResetCleared) {
            selectAllCheckbox.style.visibility = 'hidden';
            selectAllCheckbox.disabled = true;
        }

        selectAllContainer.appendChild(selectAllCheckbox);
        firstTh.innerHTML = '';
        firstTh.appendChild(selectAllContainer);

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
    
    const actionBar = document.createElement('div');
    actionBar.style.display = 'flex';
    actionBar.style.justifyContent = 'space-between';
    actionBar.style.alignItems = 'center';
    actionBar.style.padding = '10px';
    actionBar.style.backgroundColor = 'var(--bg-surface-2)';
    actionBar.style.borderRadius = '8px';
    actionBar.style.border = '1px solid var(--border)';
    
    const filterDropdown = document.createElement('select');
    filterDropdown.style.padding = '8px';
    filterDropdown.style.border = '1px solid var(--border)';
    filterDropdown.style.backgroundColor = 'var(--bg-surface)';
    filterDropdown.style.color = 'var(--text-primary)';
    filterDropdown.style.borderRadius = '4px';
    filterDropdown.style.width = '200px';
    filterDropdown.style.marginBottom = '0';
    
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Errors';
    filterDropdown.appendChild(allOption);
    
    const unclearedOption = document.createElement('option');
    unclearedOption.value = 'uncleared';
    unclearedOption.textContent = 'Uncleared Only';
    filterDropdown.appendChild(unclearedOption);
    
    filterDropdown.value = currentFilterValue;

    const totalCount = errorLogs.length;
    const unclearedCount = errorLogs.filter(log => log.cleared !== 1).length;
    const statsSpan = document.createElement('span');
    statsSpan.textContent = `Total: ${totalCount} | Uncleared: ${unclearedCount}`;
    statsSpan.style.fontSize = '14px';
    statsSpan.style.fontWeight = 'bold';
    statsSpan.style.color = 'var(--text-secondary)';
    
    // Mark as cleared button (admin-only)
    const errorMarkRole = window.StationAuth?.getUserInfo?.()?.role;
    const canMarkErrorCleared = errorMarkRole === 'admin' || errorMarkRole === 'super_admin';

    const markClearedBtn = createActionButton('#2E7D32', '#1B5E20');
    markClearedBtn.textContent = '✓ Mark as Cleared';
    markClearedBtn.disabled = true;
    markClearedBtn.style.opacity = '0.5';
    markClearedBtn.style.cursor = 'not-allowed';

    actionBar.appendChild(filterDropdown);
    actionBar.appendChild(statsSpan);
    if (canMarkErrorCleared) {
        actionBar.appendChild(markClearedBtn);
    }
    container.appendChild(actionBar);

    let selectedErrorIds = new Set();
    
    const updateMarkButtonState = () => {
        const hasSelected = selectedErrorIds.size > 0;
        markClearedBtn.disabled = !hasSelected;
        markClearedBtn.style.opacity = hasSelected ? '1' : '0.5';
        markClearedBtn.style.cursor = hasSelected ? 'pointer' : 'not-allowed';
    };
    
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
            row.style.backgroundColor = log.cleared ? 'var(--bg-row-cleared)' : (index % 2 === 0 ? 'var(--bg-surface-2)' : 'var(--bg-surface)');
            row.style.color = 'var(--text-primary)';
            row.style.opacity = log.cleared ? '0.6' : '1';
            
            const checkboxTd = document.createElement('td');
            checkboxTd.style.padding = '12px';
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
            
            const errorCode = log.error_code || log.Code || 'N/A';
            const severity = log.severity || log.Sev || 'N/A';
            const file = log.file || log.File || 'N/A';
            const line = log.line || log.Line || 'N/A';
            const functionName = log.function || log.Func || 'N/A';
            const context = log.context || log.Cntx || 'N/A';
            const status = log.cleared ? 'Cleared' : 'Active';
            
            const cells = [log.unix_time || 'N/A', errorCode, severity, file, line, functionName, context, status];
            
            cells.forEach((cellText, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = cellText;
                td.style.padding = '12px';
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
        
        const thead = tableContainer.querySelector('thead');
        const headerRow = thead.querySelector('tr');
        const firstTh = headerRow.querySelector('th');
        const selectAllContainer = document.createElement('div');
        selectAllContainer.style.display = 'flex';
        selectAllContainer.style.alignItems = 'center';
        selectAllContainer.style.gap = '5px';
        
        const selectAllCheckbox = document.createElement('input');
        selectAllCheckbox.type = 'checkbox';
        selectAllCheckbox.style.margin = '0';
        if (!canMarkErrorCleared) {
            selectAllCheckbox.style.visibility = 'hidden';
            selectAllCheckbox.disabled = true;
        }

        selectAllContainer.appendChild(selectAllCheckbox);
        firstTh.innerHTML = '';
        firstTh.appendChild(selectAllContainer);

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
        border-top: 1px solid #ddd;
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
        modal.style.height = '700px';
        modal.style.maxHeight = '85%';
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
        
        const { tabsContainer, connectivityTab, errorLogsTab, resetLogsTab } = createMainTabs((tab) => {
            activeTab = tab === 'connectivity' ? 'connectivity' : (tab === 'errorLogs' ? 'errorLogs' : 'resetLogs');
            updateMainContent();
        });
        
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
                columnsContainer.appendChild(createMqttStatusSection(mqttStatus, powerStatus));
                
                currentContent = columnsContainer;
            } else if (activeTab === 'errorLogs') {
                const errorContainer = document.createElement('div');
                errorContainer.id = 'error-logs-container';
                errorContainer.style.height = '100%';
                errorContainer.style.overflow = 'auto';
                
                let currentFilterValue = 'uncleared';
                
                const loadErrors = async (showAll = false) => {
                    currentFilterValue = showAll ? 'all' : 'uncleared';
                    const response = await fetch(`${API_BASE_URL}/error-log/${dispenserAddress}`);
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
                    const response = await fetch(`${API_BASE_URL}/power-status/${dispenserTopic}`);
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
                                window.updateResetCount(dispenserAddress);
                            }
                        }, clearedIds, filter);
                        resetContainer.appendChild(table);
                    }
                };

                loadResets('uncleared');
                currentContent = resetContainer;
            }
            
            contentContainer.appendChild(currentContent);
        };
        
        const header = createModalHeader(dispenserTopic, overlay);
        
        modal.appendChild(header);
        modal.appendChild(tabsContainer);
        modal.appendChild(contentContainer);
        
        if (defaultTab === 'errorLogs') {
            connectivityTab.style.borderBottom = 'none';
            connectivityTab.style.fontWeight = 'normal';
            errorLogsTab.style.borderBottom = '3px solid #2e7d32';
            errorLogsTab.style.fontWeight = 'bold';
            resetLogsTab.style.borderBottom = 'none';
            resetLogsTab.style.fontWeight = 'normal';
        } else if (defaultTab === 'resetLogs') {
            connectivityTab.style.borderBottom = 'none';
            connectivityTab.style.fontWeight = 'normal';
            errorLogsTab.style.borderBottom = 'none';
            errorLogsTab.style.fontWeight = 'normal';
            resetLogsTab.style.borderBottom = '3px solid #2e7d32';
            resetLogsTab.style.fontWeight = 'bold';
        }
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