// device-status-functions.js

// Helper function to create a base row element
function createBaseRow() {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.justifyContent = 'space-between';
    row.style.marginBottom = '10px';
    row.style.padding = '5px 0';
    row.style.borderBottom = '1px solid #eee';
    return row;
}

// Helper function to create status rows
function createStatusRow(label, value) {
    const row = createBaseRow();
    
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.fontWeight = 'bold';
    labelSpan.style.color = '#333';
    
    const valueSpan = document.createElement('span');
    valueSpan.textContent = value;
    valueSpan.style.color = '#666';
    
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
    labelSpan.style.color = '#333';
    
    const valueSpan = document.createElement('span');
    valueSpan.textContent = status ? trueText : falseText;
    valueSpan.style.color = status ? '#2e7d32' : '#d32f2f';
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
    lastUpdated.style.color = '#999';
    lastUpdated.style.fontSize = '14px';
    lastUpdated.style.marginTop = '15px';
    lastUpdated.style.textAlign = 'right';
    return lastUpdated;
}

// Function to create a styled container for content
function createStyledContainer(backgroundColor = '#f5f5f5', padding = '10px', borderRadius = '5px') {
    const container = document.createElement('div');
    container.style.backgroundColor = backgroundColor;
    container.style.padding = padding;
    container.style.borderRadius = borderRadius;
    return container;
}

// Function to create GSM/WiFi toggle buttons for wireless connectivity section
function createWirelessConnectivityButtons(gsmEnabled, wifiEnabled, onButtonChange) {
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'flex-end';
    // buttonsContainer.style.marginBottom = '15px';
    buttonsContainer.style.gap = '10px';
    
    const gsmButton = document.createElement('button');
    gsmButton.textContent = 'GSM';
    gsmButton.style.padding = '6px 16px';
    gsmButton.style.border = '1px solid #ddd';
    gsmButton.style.background = '#f5f5f5';
    gsmButton.style.borderRadius = '4px';
    gsmButton.style.fontSize = '14px';
    gsmButton.style.cursor = gsmEnabled ? 'pointer' : 'not-allowed';
    gsmButton.disabled = !gsmEnabled;
    
    const wifiButton = document.createElement('button');
    wifiButton.textContent = 'WiFi';
    wifiButton.style.padding = '6px 16px';
    wifiButton.style.border = '1px solid #ddd';
    wifiButton.style.background = '#f5f5f5';
    wifiButton.style.borderRadius = '4px';
    wifiButton.style.fontSize = '14px';
    wifiButton.style.cursor = wifiEnabled ? 'pointer' : 'not-allowed';
    wifiButton.disabled = !wifiEnabled;
    
    // Set initial active button based on availability
    let activeButton = gsmEnabled ? 'gsm' : (wifiEnabled ? 'wifi' : 'gsm');
    
    const updateButtonStyles = () => {
        if (activeButton === 'gsm') {
            gsmButton.style.background = '#2e7d32';
            gsmButton.style.color = 'white';
            gsmButton.style.border = '1px solid #2e7d32';
            wifiButton.style.background = '#f5f5f5';
            wifiButton.style.color = '#333';
            wifiButton.style.border = '1px solid #ddd';
        } else {
            wifiButton.style.background = '#2e7d32';
            wifiButton.style.color = 'white';
            wifiButton.style.border = '1px solid #2e7d32';
            gsmButton.style.background = '#f5f5f5';
            gsmButton.style.color = '#333';
            gsmButton.style.border = '1px solid #ddd';
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
    
    // Initialize styles
    updateButtonStyles();
    
    buttonsContainer.appendChild(gsmButton);
    buttonsContainer.appendChild(wifiButton);
    
    return { buttonsContainer, gsmButton, wifiButton };
}

// Function to create main tabs (Connectivity Status and Error Logs)
function createMainTabs(onTabChange) {
    const tabsContainer = document.createElement('div');
    tabsContainer.style.display = 'flex';
    tabsContainer.style.marginBottom = '20px';
    tabsContainer.style.borderBottom = '2px solid #ddd';
    
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
    
    const updateTabStyles = (activeTab) => {
        if (activeTab === 'connectivity') {
            connectivityTab.style.borderBottom = '3px solid #2e7d32';
            connectivityTab.style.fontWeight = 'bold';
            connectivityTab.style.color = '#2e7d32';
            errorLogsTab.style.borderBottom = 'none';
            errorLogsTab.style.fontWeight = 'normal';
            errorLogsTab.style.color = '#2e7d32';
        } else {
            errorLogsTab.style.borderBottom = '3px solid #2e7d32';
            errorLogsTab.style.fontWeight = 'bold';
            errorLogsTab.style.color = '#2e7d32';
            connectivityTab.style.borderBottom = 'none';
            connectivityTab.style.fontWeight = 'normal';
            connectivityTab.style.color = '#2e7d32';
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
    
    tabsContainer.appendChild(connectivityTab);
    tabsContainer.appendChild(errorLogsTab);
    
    return { tabsContainer, connectivityTab, errorLogsTab };
}

// Function to create wireless connectivity section (combined GSM/WiFi)
function createWirelessConnectivitySection(gsmStatus, wifiStatus, gsmEnabled, wifiEnabled) {
    const section = document.createElement('div');
    section.style.flex = '1';
    section.style.padding = '0 15px';
    section.style.borderRight = '1px solid #ddd';
    
    section.appendChild(createSectionHeader('Wireless Connectivity'));
   
    // Create toggle buttons
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
    
    // Function to update wireless content based on active mode
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
    
    // Initialize with GSM or WiFi content
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
    
    // GSM Status
    container.appendChild(createStatusRow('GSM Status', gsmStatus.gsm.status));
    
    // Signal Strength
    container.appendChild(createStatusRow('Signal Strength', `${gsmStatus.gsm.signalStrength} dB`));

    // Master SIM
    container.appendChild(createStatusRow('Master SIM', `${gsmStatus.gsm.masterSIM}`));
    
    // SIM Status
    const simStatus = gsmStatus.gsm.simInserted ? 'Inserted' : 'Not Inserted';
    container.appendChild(createStatusRow('SIM Status', simStatus));
    
    // Network Registration
    const regStatus = gsmStatus.gsm.registered === 1 ? 'Registered' : 'Not Registered';
    container.appendChild(createStatusRow('Network Registration', regStatus));
    
    // PDP Contexts
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
    
    // Last Updated
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
    
    // WiFi Status
    container.appendChild(createStatusRow('Wi-Fi Status', wifiStatus.status));
    
    // Connection details
    if (wifiStatus.ssid) {
        container.appendChild(createStatusRow('SSID', wifiStatus.ssid));
    }
    
    if (wifiStatus.ip) {
        container.appendChild(createStatusRow('IP Address', wifiStatus.ip));
    }
    
    if (wifiStatus.signalStrength) {
        container.appendChild(createStatusRow('Signal Strength', `${wifiStatus.signalStrength} dB`));
    }
    
    // Last Updated
    container.appendChild(createLastUpdatedText(wifiStatus.lastUpdated));
    
    return container;
}

// Function to create MQTT status section with power status included
function createMqttStatusSection(mqttStatus, powerStatus) {
    const section = document.createElement('div');
    section.style.flex = '1';
    section.style.padding = '0 15px';
    
    section.appendChild(createSectionHeader('MQTT Communication Link', '#2e7d32'));
    
    if (!mqttStatus) {
        section.appendChild(createNoDataMessage('No MQTT status available'));
    } else {
        // MQTT Status indicators
        section.appendChild(createStatusIndicator('MQTT Started', mqttStatus.started));
        section.appendChild(createStatusIndicator('Client Acquired', mqttStatus.clientAcquired));
        section.appendChild(createStatusIndicator('Broker Connected', mqttStatus.brokerConnected));
        section.appendChild(createStatusRow('Subscribed Topics', mqttStatus.subscribedCount.toString()));
        
        // Subscribed topics list
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
    
    // Handle powerStatus whether it's an array or single object
    let powerStatuses = [];
    
    if (Array.isArray(powerStatus)) {
        powerStatuses = powerStatus;
    } else if (powerStatus) {
        // If it's a single object, convert to array
        powerStatuses = [powerStatus];
    }
    
    if (powerStatuses.length === 0) {
        section.appendChild(createNoDataMessage('No power-on status available'));
    } else {
        // Get the last 5 power statuses (most recent first)
        const recentPowerStatuses = powerStatuses
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
            .slice(0, 5);
        
        // Show latest event type
        const latestStatus = recentPowerStatuses[0];
        
        section.appendChild(createStatusRow('Wakeup Time', (new Date(latestStatus.wakeupTime).toLocaleString())));  
        section.appendChild(createStatusRow('Last Downtime', ""));  

        const infoText = [`Die Time: ${new Date(latestStatus.dieTime).toLocaleString()}`,
                    `Duration: ${formatTimeString(latestStatus.downtimeMs)}`,
                    `Reason: ${latestStatus.message}`
        ]
        
        // Message details
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
       
        // Last updated using the latest event
        section.appendChild(createLastUpdatedText(latestStatus.lastUpdated));
    }
   
    return section;
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

// Function to create error logs table view
function createErrorsTable(errorLogs, dispenserAddress, onRefresh, currentFilterValue = 'uncleared') {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '15px';
    
    // Action bar
    const actionBar = document.createElement('div');
    actionBar.style.display = 'flex';
    actionBar.style.justifyContent = 'space-between';
    actionBar.style.alignItems = 'center';
    actionBar.style.padding = '10px';
    actionBar.style.backgroundColor = '#f8f9fa';
    actionBar.style.borderRadius = '8px';
    actionBar.style.border = '1px solid #e0e0e0';
    
    // Create filter dropdown
    const filterDropdown = document.createElement('select');
    filterDropdown.style.padding = '8px';
    filterDropdown.style.border = '1px solid #ccc';
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
    
    // Set the dropdown value based on currentFilter
    filterDropdown.value = currentFilterValue;
    
    // Mark as cleared button
    const markClearedBtn = createActionButton('#2E7D32', '#1B5E20');
    markClearedBtn.textContent = '✓ Mark as Cleared';
    markClearedBtn.disabled = true;
    markClearedBtn.style.opacity = '0.5';
    markClearedBtn.style.cursor = 'not-allowed';
    
    actionBar.appendChild(filterDropdown);
    actionBar.appendChild(markClearedBtn);
    container.appendChild(actionBar);
    
    let selectedErrorIds = new Set();
    
    const updateMarkButtonState = () => {
        const hasSelected = selectedErrorIds.size > 0;
        markClearedBtn.disabled = !hasSelected;
        markClearedBtn.style.opacity = hasSelected ? '1' : '0.5';
        markClearedBtn.style.cursor = hasSelected ? 'pointer' : 'not-allowed';
    };
    
    // Function to render the table
    const renderTable = (errors) => {
        // Remove existing table
        const existingTable = container.querySelector('.error-table-container');
        if (existingTable) {
            existingTable.remove();
        }
        
        // Check if no errors
        if (errors.length === 0) {
            const noDataMsg = createNoDataMessage(
                filterDropdown.value === 'uncleared' 
                    ? 'No uncleared errors found' 
                    : 'No errors found'
            );
            noDataMsg.style.padding = '40px';
            noDataMsg.classList.add('error-table-container');
            container.appendChild(noDataMsg);
            return;
        }
        
        // Create table
        const headers = ['', 'Log Time', 'Error Code', 'Severity', 'File', 'Line', 'Function', 'Context', 'Status'];
        const { tableContainer, tbody } = createTable(headers);
        tableContainer.classList.add('error-table-container');
        
        selectedErrorIds.clear();
        updateMarkButtonState();
        
        errors.forEach((log, index) => {
            const row = document.createElement('tr');
            row.style.backgroundColor = log.cleared ? '#f5f5f5' : (index % 2 === 0 ? '#f9f9f9' : 'white');
            row.style.opacity = log.cleared ? '0.6' : '1';
            
            // Checkbox cell
            const checkboxTd = document.createElement('td');
            checkboxTd.style.padding = '12px';
            checkboxTd.style.textAlign = 'center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'error-checkbox';
            checkbox.value = log.id;
            checkbox.disabled = log.cleared === 1;
            if (log.cleared === 0) {
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
            
            // Data cells
            const errorCode = log.error_code || log.Code || 'N/A';
            const severity = log.severity || log.Sev || 'N/A';
            const file = log.file || log.File || 'N/A';
            const line = log.line || log.Line || 'N/A';
            const functionName = log.function || log.Func || 'N/A';
            const context = log.context || log.Cntx || 'N/A';
            const status = log.cleared ? 'Cleared' : 'Active';
            
            const cells = [log.log_time || 'N/A', errorCode, severity, file, line, functionName, context, status];
            
            cells.forEach((cellText, cellIndex) => {
                const td = document.createElement('td');
                td.textContent = cellText;
                td.style.padding = '12px';
                td.style.borderBottom = '1px solid #ddd';
                if (cellIndex === cells.length - 2) {
                    td.style.maxWidth = '300px';
                    td.style.overflow = 'auto';
                    td.style.wordBreak = 'break-word';
                    td.style.whiteSpace = 'normal';
                }
                if (log.cleared) {
                    td.style.color = '#999';
                }
                row.appendChild(td);
            });
            
            tbody.appendChild(row);
        });
        
        // Select all checkbox in header
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
        
        selectAllContainer.appendChild(selectAllCheckbox);
        firstTh.innerHTML = '';
        firstTh.appendChild(selectAllContainer);
        
        const updateSelectAllCheckbox = () => {
            const allCheckboxes = document.querySelectorAll('.error-checkbox');
            const checkedCount = document.querySelectorAll('.error-checkbox:checked').length;
            selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < allCheckboxes.length;
        };
        
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
        
        container.appendChild(tableContainer);
    };
    
    // Initial render
    renderTable(errorLogs);
    
    // Mark as cleared button click handler
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
                window.showNotification?.(result.message, 'success');
                
                if (typeof onRefresh === 'function') {
                    onRefresh(filterDropdown.value === 'all');
                }
            } catch (error) {
                console.error('Error marking errors as cleared:', error);
                window.showNotification?.('Failed to mark errors as cleared', 'error');
            }
        }
    });
    
    // Filter dropdown handler
    filterDropdown.addEventListener('change', async () => {
        const showAll = filterDropdown.value === 'all';
        if (typeof onRefresh === 'function') {
            onRefresh(showAll);
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
    // Create footer container that sticks to bottom
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
    
    popupElement.style.paddingBottom = '40px'; // Make space for footer
    
    // Create 4 info items in one row
    const infoItems = [
        { id: 'temp', label: 'Device Temperature:' },
        { id: 'fw', label: 'Firmware Version:' },
        { id: 'hw', label: 'Hardware Version:' },
        { id: 'mac', label: 'MAC Address:' }
    ];
    
    // Store element references
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
        labelSpan.style.color = '#666';
        
        const valueSpan = document.createElement('span');
        
        container.appendChild(labelSpan);
        container.appendChild(valueSpan);
        footer.appendChild(container);
        
        infoElements[item.id] = valueSpan;
    });
    
    // Add footer to popup
    popupElement.appendChild(footer);
    
    // Fetch device info
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
        } else {
            // No data - already set to N/A by default
        }
    } catch (error) {
        console.error('Error fetching device info:', error);
        // Keep N/A values
    }
}

// Main function to show device status popup
async function showDevStatusPopup(dispenserTopic, defaultTab = 'connectivity') {
    try {
        // Remove 'D' prefix for API calls
        const dispenserAddress = dispenserTopic.replace(/^D/, '');
        
        // Fetch GSM, WiFi, MQTT, power status, error logs, and connection statuses
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

        const gsmStatuses = gsmConnData?.status || [];
        const wifiStatuses = wifiConnData?.status || [];
        
        // Determine GSM/WiFi enabled state
        const gsmEnabled = gsmStatuses && gsmStatuses.length > 0 && gsmStatuses.some(status => status.message && status.message.includes('CONNECTED'));
        const wifiEnabled = wifiStatuses && wifiStatuses.length > 0 && wifiStatuses.some(status => status.message && status.message.includes('CONNECTED'));
        
        // Create modal overlay
        const overlay = createModalOverlay();
        
        // Create modal content
        const modal = document.createElement('div');
        modal.className = 'popup-modal';
        modal.style.width = '1200px';
        modal.style.maxWidth = '95%';
        modal.style.height = '700px';
        modal.style.maxHeight = '85%';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        dragPopup(overlay, modal);
        
        // Create main content container
        const contentContainer = document.createElement('div');
        contentContainer.style.flex = '1';
        contentContainer.style.overflow = 'auto';
        contentContainer.style.padding = '10px';
        
        // Create main tabs
        let activeTab = defaultTab;
        let currentContent = null;
        
        const { tabsContainer, connectivityTab, errorLogsTab } = createMainTabs((tab) => {
            activeTab = tab === 'connectivity' ? 'connectivity' : 'errorLogs';
            updateMainContent();
        });
        
        // Function to refresh errors
        const refreshErrors = async (showCleared = true) => {
            const url = showCleared 
                ? `${API_BASE_URL}/error-log/${dispenserAddress}`
                : `${API_BASE_URL}/error-log/${dispenserAddress}?showCleared=false`;
            const response = await fetch(url);
            if (response.ok) {
                const newErrors = await response.json();
                return newErrors;
            }
            return [];
        };
        
        // Function to update main content based on active tab
        const updateMainContent = () => {
            // Remove existing content if it exists and is a child
            if (currentContent && contentContainer.contains(currentContent)) {
                contentContainer.removeChild(currentContent);
            }
            
            if (activeTab === 'connectivity') {
                // Create connectivity status view
                const columnsContainer = document.createElement('div');
                columnsContainer.style.display = 'flex';
                columnsContainer.style.gap = '15px';
                columnsContainer.style.marginTop = '10px';
                
                // Add wireless connectivity section
                columnsContainer.appendChild(createWirelessConnectivitySection(gsmStatus, wifiStatus, gsmEnabled, wifiEnabled));
                
                // Add MQTT status section
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
                    const url = showAll 
                        ? `${API_BASE_URL}/error-log/${dispenserAddress}`
                        : `${API_BASE_URL}/error-log/${dispenserAddress}?showCleared=false`;
                    const response = await fetch(url);
                    if (response.ok) {
                        const errors = await response.json();
                        errorContainer.innerHTML = '';
                        const table = createErrorsTable(errors, dispenserAddress, (showAllErrors) => {
                            loadErrors(showAllErrors);
                        }, currentFilterValue);
                        errorContainer.appendChild(table);
                    }
                };
                
                // Initial load (uncleared only)
                loadErrors(false);
                currentContent = errorContainer;
            }
            
            contentContainer.appendChild(currentContent);
        };
        
        // Add header
        const header = createModalHeader(dispenserTopic, overlay);
        
        modal.appendChild(header);
        modal.appendChild(tabsContainer);
        modal.appendChild(contentContainer);
        
        // Initialize with the default tab
        if (defaultTab === 'errorLogs') {
            // Trigger error logs tab style
            connectivityTab.style.borderBottom = 'none';
            connectivityTab.style.fontWeight = 'normal';
            errorLogsTab.style.borderBottom = '3px solid #2e7d32';
            errorLogsTab.style.fontWeight = 'bold';
        }
        updateMainContent();
        
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        
        // Add device info footer
        addDeviceInfoFooter(modal, dispenserTopic);
        
        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });
        
    } catch (error) {
        console.error('Error showing device status:', error);
        window.showNotification?.('Error loading device status', 'error');
    }
}

// Make functions available globally
window.showDevStatusPopup = showDevStatusPopup;