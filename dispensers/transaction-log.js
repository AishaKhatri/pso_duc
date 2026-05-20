// transaction-log.js

async function showTransactionLogPopup(nozzle_id) {
    try {
        // Fetch transaction data
        let transactions = await fetchTransactions(nozzle_id);
        
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
        mainContainer.style.overflow = 'hidden';

        // Left column - Transaction table
        const leftColumn = document.createElement('div');
        leftColumn.style.flex = '3';
        leftColumn.style.display = 'flex';
        leftColumn.style.flexDirection = 'column';
        leftColumn.style.minWidth = '0';
        leftColumn.style.overflow = 'hidden';

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
        
        // Create fixed footer for buttons (keep as is)
        const footer = document.createElement('div');
        footer.style.paddingTop = '15px';
        footer.style.borderTop = '1px solid #eee';
        footer.style.borderBottomLeftRadius = '10px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'space-between';
        footer.style.alignItems = 'center';
        footer.style.flexShrink = '0';
        
        // Left side: Export to CSV button
        const leftButtonGroup = document.createElement('div');
        
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

        // Right column - Date Filter and Summary
        const rightColumn = document.createElement('div');
        rightColumn.style.flex = '1';
        rightColumn.style.minWidth = '300px';
        rightColumn.style.display = 'flex';
        rightColumn.style.flexDirection = 'column';
        rightColumn.style.marginLeft = '20px';
        rightColumn.style.gap = '20px';

        // Date Filter Section (replaces Get Transactions)
        const filterSection = createDateFilterSection();
        rightColumn.appendChild(filterSection);

        // Summary Section (replaces Delete Transactions)
        const summarySection = createSummarySection();
        rightColumn.appendChild(summarySection);

        // Add columns to modal
        mainContainer.appendChild(leftColumn);
        mainContainer.appendChild(rightColumn);
        modal.appendChild(mainContainer);

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Store current transactions and filter function
        let currentTransactions = transactions;
        
        function updateDisplay() {
            const startDate = document.getElementById('start-date')?.value;
            const endDate = document.getElementById('end-date')?.value;
            
            let filteredTransactions = [...currentTransactions];
            
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                filteredTransactions = filteredTransactions.filter(t => new Date(t.time) >= start);
            }
            
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                filteredTransactions = filteredTransactions.filter(t => new Date(t.time) <= end);
            }
            
            // Update summary
            updateSummary(filteredTransactions);
            
            // Update table
            const tableContainer = document.getElementById('transaction-table-container');
            if (tableContainer) {
                if (filteredTransactions.length === 0) {
                    tableContainer.innerHTML = '';
                    const noData = createNoDataMessage('No transactions found for selected date range');
                    noData.style.padding = '40px';
                    tableContainer.appendChild(noData);
                } else {
                    const table = createTransactionTable(filteredTransactions);
                    tableContainer.innerHTML = '';
                    tableContainer.appendChild(table);
                }
            }
        }
        
        // Set up filter event listeners
        const startDateInput = document.getElementById('start-date');
        const endDateInput = document.getElementById('end-date');
        const applyFilterBtn = document.getElementById('apply-filter');
        const clearFilterBtn = document.getElementById('clear-filter');

        if (applyFilterBtn) applyFilterBtn.addEventListener('click', updateDisplay);
        if (clearFilterBtn) {
            clearFilterBtn.addEventListener('click', () => {
                if (startDateInput) startDateInput.value = '';
                if (endDateInput) endDateInput.value = '';
                updateDisplay();
            });
        }
        
        // Update export button for filtered data
        const exportBtn = footer.querySelector('button');
        if (exportBtn) {
            const oldClickListener = exportBtn.onclick;
            exportBtn.addEventListener('click', () => {
                const startDate = document.getElementById('start-date')?.value;
                const endDate = document.getElementById('end-date')?.value;
                let filteredTransactions = [...currentTransactions];
                
                if (startDate) {
                    const start = new Date(startDate);
                    start.setHours(0, 0, 0, 0);
                    filteredTransactions = filteredTransactions.filter(t => new Date(t.time) >= start);
                }
                if (endDate) {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    filteredTransactions = filteredTransactions.filter(t => new Date(t.time) <= end);
                }
                
                exportToCSV(filteredTransactions, nozzle_id, startDate, endDate);
            });
        }
        
        // Initial display
        updateDisplay();

    } catch (error) {
        console.error('Error showing transaction log:', error);
        window.showNotification?.('Error loading transaction log', 'error');
    }
}

function createDateFilterSection() {
    const section = document.createElement('div');
    section.style.backgroundColor = 'var(--bg-surface)';
    section.style.color = 'var(--text-primary)';
    section.style.padding = '15px';
    section.style.borderRadius = '8px';
    section.style.border = '1px solid var(--border)';

    const sectionHeader = createHeader();
    
    const sectionTitle = createTitle();
    sectionTitle.textContent = 'Date Filter';
    sectionTitle.style.fontSize = '16px';

    sectionHeader.appendChild(sectionTitle);
    section.appendChild(sectionHeader);

    const filterContainer = document.createElement('div');
    filterContainer.style.display = 'flex';
    filterContainer.style.flexDirection = 'column';
    filterContainer.style.gap = '10px';
    filterContainer.style.marginTop = '10px';

    // Start Date
    const startDateContainer = document.createElement('div');
    startDateContainer.style.display = 'flex';
    startDateContainer.style.flexDirection = 'column';
    startDateContainer.style.gap = '5px';

    const startLabel = document.createElement('label');
    startLabel.textContent = 'Start Date';
    startLabel.style.fontSize = '12px';
    startLabel.style.fontWeight = 'bold';
    startLabel.style.color = 'var(--text-secondary)';

    const startDateInput = document.createElement('input');
    startDateInput.type = 'date';
    startDateInput.id = 'start-date';
    startDateInput.style.padding = '8px';
    startDateInput.style.border = '1px solid var(--border)';
    startDateInput.style.backgroundColor = 'var(--bg-surface)';
    startDateInput.style.color = 'var(--text-primary)';
    startDateInput.style.borderRadius = '4px';
    startDateInput.style.fontSize = '14px';

    startDateContainer.appendChild(startLabel);
    startDateContainer.appendChild(startDateInput);

    // End Date
    const endDateContainer = document.createElement('div');
    endDateContainer.style.display = 'flex';
    endDateContainer.style.flexDirection = 'column';
    endDateContainer.style.gap = '5px';

    const endLabel = document.createElement('label');
    endLabel.textContent = 'End Date';
    endLabel.style.fontSize = '12px';
    endLabel.style.fontWeight = 'bold';
    endLabel.style.color = 'var(--text-secondary)';

    const endDateInput = document.createElement('input');
    endDateInput.type = 'date';
    endDateInput.id = 'end-date';
    endDateInput.style.padding = '8px';
    endDateInput.style.border = '1px solid var(--border)';
    endDateInput.style.backgroundColor = 'var(--bg-surface)';
    endDateInput.style.color = 'var(--text-primary)';
    endDateInput.style.borderRadius = '4px';
    endDateInput.style.fontSize = '14px';

    endDateContainer.appendChild(endLabel);
    endDateContainer.appendChild(endDateInput);

    // Apply / Clear Filter Buttons
    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.gap = '8px';
    buttonRow.style.marginTop = '5px';

    const applyButton = createActionButton();
    applyButton.textContent = 'Apply';
    applyButton.id = 'apply-filter';
    applyButton.style.flex = '1';

    const clearButton = createActionButton('#6c757d', '#5a6268');
    clearButton.textContent = 'Clear Filter';
    clearButton.id = 'clear-filter';
    clearButton.style.flex = '1';

    buttonRow.appendChild(applyButton);
    buttonRow.appendChild(clearButton);

    filterContainer.appendChild(startDateContainer);
    filterContainer.appendChild(endDateContainer);
    filterContainer.appendChild(buttonRow);

    section.appendChild(filterContainer);
    return section;
}

function createSummarySection() {
    const section = document.createElement('div');
    section.style.backgroundColor = 'var(--bg-surface)';
    section.style.color = 'var(--text-primary)';
    section.style.padding = '15px';
    section.style.borderRadius = '8px';
    section.style.border = '1px solid var(--border)';

    const sectionHeader = createHeader();
    
    const sectionTitle = createTitle();
    sectionTitle.textContent = 'Summary';
    sectionTitle.style.fontSize = '16px';

    sectionHeader.appendChild(sectionTitle);
    section.appendChild(sectionHeader);

    const summaryContainer = document.createElement('div');
    summaryContainer.id = 'summary-container';
    summaryContainer.style.display = 'flex';
    summaryContainer.style.flexDirection = 'column';
    summaryContainer.style.gap = '10px';
    summaryContainer.style.marginTop = '10px';

    // Total Amount
    const amountContainer = document.createElement('div');
    amountContainer.style.display = 'flex';
    amountContainer.style.justifyContent = 'space-between';
    amountContainer.style.padding = '10px';
    amountContainer.style.backgroundColor = 'var(--bg-surface-2)';
    amountContainer.style.borderRadius = '6px';

    const amountLabel = document.createElement('span');
    amountLabel.textContent = 'Total Amount:';
    amountLabel.style.fontWeight = 'bold';
    amountLabel.style.color = 'var(--text-secondary)';

    const amountValue = document.createElement('span');
    amountValue.id = 'total-amount';
    amountValue.textContent = 'Rs. 0.00';
    amountValue.style.color = '#28a745';
    amountValue.style.fontWeight = 'bold';

    amountContainer.appendChild(amountLabel);
    amountContainer.appendChild(amountValue);

    // Total Volume
    const volumeContainer = document.createElement('div');
    volumeContainer.style.display = 'flex';
    volumeContainer.style.justifyContent = 'space-between';
    volumeContainer.style.padding = '10px';
    volumeContainer.style.backgroundColor = 'var(--bg-surface-2)';
    volumeContainer.style.borderRadius = '6px';

    const volumeLabel = document.createElement('span');
    volumeLabel.textContent = 'Total Volume:';
    volumeLabel.style.fontWeight = 'bold';
    volumeLabel.style.color = 'var(--text-secondary)';

    const volumeValue = document.createElement('span');
    volumeValue.id = 'total-volume';
    volumeValue.textContent = '0.00 Ltr';
    volumeValue.style.color = '#007bff';
    volumeValue.style.fontWeight = 'bold';

    volumeContainer.appendChild(volumeLabel);
    volumeContainer.appendChild(volumeValue);

    // Transaction Count
    const countContainer = document.createElement('div');
    countContainer.style.display = 'flex';
    countContainer.style.justifyContent = 'space-between';
    countContainer.style.padding = '10px';
    countContainer.style.backgroundColor = 'var(--bg-surface-2)';
    countContainer.style.borderRadius = '6px';

    const countLabel = document.createElement('span');
    countLabel.textContent = 'Transactions:';
    countLabel.style.fontWeight = 'bold';
    countLabel.style.color = 'var(--text-secondary)';

    const countValue = document.createElement('span');
    countValue.id = 'transaction-count';
    countValue.textContent = '0';
    countValue.style.color = '#17a2b8';
    countValue.style.fontWeight = 'bold';

    countContainer.appendChild(countLabel);
    countContainer.appendChild(countValue);

    summaryContainer.appendChild(amountContainer);
    summaryContainer.appendChild(volumeContainer);
    summaryContainer.appendChild(countContainer);

    section.appendChild(summaryContainer);
    return section;
}

function updateSummary(transactions) {
    const totalAmount = transactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const totalVolume = transactions.reduce((sum, t) => sum + parseFloat(t.volume), 0);
    const transactionCount = transactions.length;
    
    const amountElement = document.getElementById('total-amount');
    const volumeElement = document.getElementById('total-volume');
    const countElement = document.getElementById('transaction-count');
    
    if (amountElement) amountElement.textContent = `Rs. ${totalAmount.toFixed(2)}`;
    if (volumeElement) volumeElement.textContent = `${totalVolume.toFixed(2)} Ltr`;
    if (countElement) countElement.textContent = transactionCount.toString();
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
        row.style.backgroundColor = index % 2 === 0 ? 'var(--bg-surface-2)' : 'var(--bg-surface)';
        row.style.color = 'var(--text-primary)';
        
        const transactionDate = new Date(transaction.time);
        const formattedDate = transactionDate.toLocaleString();
        
        const cells = [
            (index + 1).toString(),
            formattedDate,
            `Rs. ${parseFloat(transaction.amount).toFixed(2)}`,
            `${parseFloat(transaction.volume).toFixed(2)} Ltr`
        ];
        
        cells.forEach((cellText) => {
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

function exportToCSV(transactions, nozzleId, startDate, endDate) {
    let filename = `transactions_${nozzleId}`;
    
    if (startDate) filename += `_from_${startDate}`;
    if (endDate) filename += `_to_${endDate}`;
    filename += `_${new Date().toISOString().split('T')[0]}.csv`;
    
    const totalAmount = transactions.reduce((sum, t) => sum + parseFloat(t.amount), 0);
    const totalVolume = transactions.reduce((sum, t) => sum + parseFloat(t.volume), 0);
    
    const csvContent = [
        [`Transaction Report - Nozzle: ${nozzleId}`],
        [`Date Range: ${startDate || 'All'} to ${endDate || 'All'}`],
        [`Total Amount: Rs. ${totalAmount.toFixed(2)}`],
        [`Total Volume: ${totalVolume.toFixed(2)} Ltr`],
        [`Total Transactions: ${transactions.length}`],
        [], // Empty row
        ['Sr. No.', 'Date', 'Time', 'Amount (PKR)', 'Volume (Ltr)'],
        ...transactions.map((transaction, index) => [
            (index + 1).toString(),
            new Date(transaction.time).toLocaleString(),
            parseFloat(transaction.amount).toFixed(2),
            parseFloat(transaction.volume).toFixed(2)
        ])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    
    window.showNotification?.('CSV export started', 'success');
}

// Make functions globally available
window.showTransactionLogPopup = showTransactionLogPopup;