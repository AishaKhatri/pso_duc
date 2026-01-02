// transaction-log.js

async function showTransactionLogPopup(nozzle_id) {
    try {
        // Fetch transaction data
        const transactions = await fetchTransactions(nozzle_id);
        
        // Create modal overlay
        const overlay = createModalOverlay();      
        
        const modal = document.createElement('div');
        modal.className = 'popup-modal';
        modal.style.width = '90%';
        modal.style.maxWidth = '1000px';
        modal.style.maxHeight = '80%';
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        dragPopup(overlay, modal);
        
        const header = createHeader();
        
        const title = createTitle();
        title.textContent = `Transaction Log - Nozzle ${nozzle_id}`;
        
        const closeButton = createCloseButton(overlay);
        
        header.appendChild(title);
        header.appendChild(closeButton);
        modal.appendChild(header);
        
        const mainContainer = document.createElement('div');
        mainContainer.style.display = 'flex';
        mainContainer.style.flexDirection = 'row';
        mainContainer.style.flex = '1';
        mainContainer.style.overflow = 'hidden'; // Prevent overflow

        // Left column - Transaction table
        const leftColumn = document.createElement('div');
        leftColumn.style.flex = '3';
        leftColumn.style.display = 'flex';
        leftColumn.style.flexDirection = 'column';
        leftColumn.style.minWidth = '0'; // Allow shrinking
        leftColumn.style.overflow = 'hidden'; // Prevent overflow

        // Create scrollable content area for transactions
        const content = document.createElement('div');
        content.style.flex = '1';
        content.style.overflowY = 'auto';
        content.style.padding = '0 10px';
        content.id = 'transaction-table-container';
        
        if (transactions.length === 0) {
            const noData = createNoDataMessage('No transactions found for this nozzle');
            noData.style.padding = '40px';
            content.appendChild(noData);
        } else {
            // Create transaction table
            const table = createTransactionTable(transactions);
            content.appendChild(table);
        }
        
        leftColumn.appendChild(content);
        
        // Create fixed footer for buttons
        const footer = document.createElement('div');
        footer.style.paddingTop = '15px';
        footer.style.borderTop = '1px solid #eee';
        footer.style.borderBottomLeftRadius = '10px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.flexShrink = '0'; // Prevent footer from shrinking
        
        // Left side: Export to CSV button
        const leftButtonGroup = document.createElement('div');
        
        // Export button (only show if there are transactions)
        if (transactions.length > 0) {
            const exportButton = createActionButton();
            exportButton.textContent = 'Export to CSV';
            exportButton.addEventListener('click', () => {
                exportToCSV(transactions, nozzle_id);
            });
            
            leftButtonGroup.appendChild(exportButton);
        }
        
        footer.appendChild(leftButtonGroup);
        leftColumn.appendChild(footer);

        // Right column - Device operations
        const rightColumn = document.createElement('div');
        rightColumn.style.flex = '1';
        rightColumn.style.minWidth = '300px';
        rightColumn.style.display = 'flex';
        rightColumn.style.flexDirection = 'column';
        rightColumn.style.marginLeft = '20px';
        rightColumn.style.gap = '20px';

        // Get Transactions from Device section
        const getTransactionsSection = createDeviceOperationSection('Get Transactions from Device');
        
        // Radio button group for transaction count selection
        const radioGroup = document.createElement('div');
        radioGroup.style.display = 'flex';
        radioGroup.style.flexDirection = 'column';
        radioGroup.style.gap = '10px';
        radioGroup.style.marginBottom = '15px';

        const transactionCounts = [100, 200, 500, 1000];
        let selectedCount = 100; // Default selection

        transactionCounts.forEach(count => {
            const radioContainer = document.createElement('div');
            radioContainer.style.display = 'flex';
            radioContainer.style.alignItems = 'center';
            radioContainer.style.gap = '8px';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'transactionCount';
            radio.value = count;
            radio.id = `count-${count}`;
            radio.checked = count === selectedCount;

            radio.addEventListener('change', () => {
                if (radio.checked) {
                    selectedCount = count;
                }
            });

            const label = document.createElement('label');
            label.htmlFor = `count-${count}`;
            label.textContent = `${count} transactions`;
            label.style.cursor = 'pointer';

            radioContainer.appendChild(radio);
            radioContainer.appendChild(label);
            radioGroup.appendChild(radioContainer);
        });

        getTransactionsSection.appendChild(radioGroup);

        // Get Transactions button
        const getTransactionsButton = createActionButton();
        getTransactionsButton.textContent = 'Get Transactions';
        getTransactionsButton.style.width = '100%';
        getTransactionsButton.style.marginBottom = '10px';

        getTransactionsButton.addEventListener('click', () => {
            if (typeof sendGetTransactionsCommand === 'function') {
                sendGetTransactionsCommand(dispenserTopic, shortNozzleId, selectedCount);
                
                // Disable temporarily to prevent spam
                getTransactionsButton.disabled = true;
                getTransactionsButton.textContent = 'Requesting...';
                getTransactionsButton.style.cursor = 'not-allowed';
                getTransactionsButton.style.opacity = '0.6';
                
                // Re-enable after 5 seconds
                setTimeout(() => {
                    getTransactionsButton.disabled = false;
                    getTransactionsButton.textContent = 'Get Transactions';
                    getTransactionsButton.style.cursor = 'pointer';
                    getTransactionsButton.style.opacity = '1';
                }, 5000);
            } else {
                window.showNotification?.('Transaction command function not available', 'error');
            }
        });

        getTransactionsSection.appendChild(getTransactionsButton);

        // Delete Transactions section
        const deleteSection = createDeviceOperationSection('Delete Transactions');
        
        const deleteInfo = document.createElement('p');
        deleteInfo.textContent = 'Permanently delete transactions from the device memory. This action cannot be undone.';
        deleteInfo.style.fontSize = '14px';
        deleteInfo.style.color = '#666';
        deleteInfo.style.marginBottom = '15px';
        deleteSection.appendChild(deleteInfo);

        // Delete button
        const deleteButton = createActionButton('#d32f2f', '#b71c1c');
        deleteButton.textContent = 'Delete All Transactions';
        deleteButton.style.width = '100%';

        deleteButton.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete ALL transactions from this nozzle? This action cannot be undone.')) {
                if (typeof sendDeleteTransactionsCommand === 'function') {
                    sendDeleteTransactionsCommand(dispenserTopic, shortNozzleId);
                    
                    // Disable temporarily
                    deleteButton.disabled = true;
                    deleteButton.textContent = 'Deleting...';
                    deleteButton.style.cursor = 'not-allowed';
                    deleteButton.style.opacity = '0.6';
                    
                    // Re-enable after 5 seconds
                    setTimeout(() => {
                        deleteButton.disabled = false;
                        deleteButton.textContent = 'Delete All Transactions';
                        deleteButton.style.cursor = 'pointer';
                        deleteButton.style.opacity = '1';
                    }, 5000);
                } else {
                    window.showNotification?.('Delete command function not available', 'error');
                }
            }
        });

        deleteSection.appendChild(deleteButton);

        // Add sections to right column
        rightColumn.appendChild(getTransactionsSection);
        rightColumn.appendChild(deleteSection);

        // Add columns to modal
        mainContainer.appendChild(leftColumn);
        mainContainer.appendChild(rightColumn);

        modal.appendChild(mainContainer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

    } catch (error) {
        console.error('Error showing transaction log:', error);
        window.showNotification?.('Error loading transaction log', 'error');
    }
}

// Helper function to create device operation sections
function createDeviceOperationSection(title) {
    const section = document.createElement('div');
    section.style.backgroundColor = 'white';
    section.style.padding = '15px';
    section.style.borderRadius = '8px';
    section.style.border = '1px solid #ddd';

    const sectionHeader = createHeader();
    
    const sectionTitle = createTitle();
    sectionTitle.textContent = title;
    sectionTitle.style.fontSize = '16px';

    sectionHeader.appendChild(sectionTitle);
    section.appendChild(sectionHeader);
    return section;
}

async function fetchTransactions(nozzle_id) {
    try {
        const response = await fetch(
            `${API_BASE_URL}/transactions/by-nozzle?nozzle_id=${encodeURIComponent(nozzle_id)}`
        );
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Error fetching transactions:', error);
        window.showNotification?.('Error fetching transactions', 'error');
        return [];
    }
}

function createTransactionTable(transactions) { 
    const headers = ['Sr No.', 'Date & Time', 'Amount (PKR)', 'Volume (Ltr)'];

    const { tableContainer, tbody } = createTable(headers);
    
    transactions.forEach((transaction, index) => {
        const row = document.createElement('tr');
        row.style.backgroundColor = index % 2 === 0 ? '#f9f9f9' : 'white';
        
        // Format date
        const transactionDate = new Date(transaction.time);
        const formattedDate = transactionDate.toLocaleString();
        
        // Create cells - Serial number first, then the rest
        const cells = [
            (index + 1).toString(), // Serial number
            formattedDate,
            `Rs. ${parseFloat(transaction.amount).toFixed(2)}`,
            `${parseFloat(transaction.volume).toFixed(2)} Ltr`
        ];
        
        cells.forEach((cellText, cellIndex) => {
            const td = document.createElement('td');
            td.textContent = cellText;
            td.style.padding = '12px';
            td.style.borderBottom = '1px solid #ddd';
                        
            row.appendChild(td);
        });
        
        tbody.appendChild(row);
    });
    
    return tableContainer;
}

// Updated function to accept transaction count parameter
async function sendGetTransactionsCommand(dispenserTopic, nozzleId, count = 100) {
    const dis_addr = dispenserTopic; // e.g., D55225
    const side = nozzleId[0] === 'A' ? '0' : '1'; // A -> 0, B -> 1
    const noz_number = parseInt(nozzleId[1]); // 1 or 2
    
    const message = {
        dis_addr: dis_addr,
        req_type: 1, // GET_VALUE
        side: side,
        noz_number: noz_number,
        msg_type: 7, // TRANSACTION_DATA
        count: count, // Add the count parameter
        message: ""
    };
    
    try {
        publishMessage(dis_addr, JSON.stringify(message), (err) => {
            if (err) {
                console.error(`Error sending GET transaction command for ${nozzleId}:`, err);
                window.showNotification?.('Error requesting transactions from device', 'error');
            } else {
                console.log(`Sent GET transaction command for nozzle ${nozzleId}, count: ${count}`);
                window.showNotification?.(`Transaction data request sent to device (${count} transactions)`, 'info');
            }
        });
    } catch (error) {
        console.error('Error sending transaction GET command:', error);
        window.showNotification?.('Error sending transaction request', 'error');
    }
}

// New function to handle delete transactions command
async function sendDeleteTransactionsCommand(dispenserTopic, nozzleId) {
    const dis_addr = dispenserTopic; // e.g., D55225
    const side = nozzleId[0] === 'A' ? '0' : '1'; // A -> 0, B -> 1
    const noz_number = parseInt(nozzleId[1]); // 1 or 2
    
    const message = {
        dis_addr: dis_addr,
        req_type: 3, // DELETE_VALUE (assuming 3 is for delete)
        side: side,
        noz_number: noz_number,
        msg_type: 7, // TRANSACTION_DATA
        message: ""
    };
    
    try {
        publishMessage(dis_addr, JSON.stringify(message), (err) => {
            if (err) {
                console.error(`Error sending DELETE transaction command for ${nozzleId}:`, err);
                window.showNotification?.('Error sending delete command to device', 'error');
            } else {
                console.log(`Sent DELETE transaction command for nozzle ${nozzleId}`);
                window.showNotification?.('Delete transaction command sent to device', 'info');
            }
        });
    } catch (error) {
        console.error('Error sending transaction DELETE command:', error);
        window.showNotification?.('Error sending delete request', 'error');
    }
}

function exportToCSV(transactions, nozzleId) {
    const csvContent = [
        ['Sr. No.', 'Date', 'Time', 'Amount (PKR)', 'Volume (Ltr)', 'Transaction ID'],
        ...transactions.map((transaction, index) => [
            (index + 1).toString(), // Serial number
            new Date(transaction.time).toLocaleString(),
            parseFloat(transaction.amount).toFixed(2),
            parseFloat(transaction.volume).toFixed(2),
            transaction.id
        ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `transactions_${nozzleId}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    window.showNotification?.('CSV export started', 'success');
}

// Make functions globally available
window.showTransactionLogPopup = showTransactionLogPopup;
window.sendGetTransactionsCommand = sendGetTransactionsCommand;
window.sendDeleteTransactionsCommand = sendDeleteTransactionsCommand;