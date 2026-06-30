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
        footer.style.borderTop = '1px solid var(--border-soft)';
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

// A labeled <input type="date"> column, used for both the start and end filters.
function createLabeledDateField(labelText, inputId) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '5px';

    const label = document.createElement('label');
    label.textContent = labelText;
    label.style.fontSize = '12px';
    label.style.fontWeight = 'bold';
    label.style.color = 'var(--text-secondary)';

    const input = document.createElement('input');
    input.type = 'date';
    input.id = inputId;
    input.style.padding = '8px';
    input.style.border = '1px solid var(--border)';
    input.style.backgroundColor = 'var(--bg-surface)';
    input.style.color = 'var(--text-primary)';
    input.style.borderRadius = '4px';
    input.style.fontSize = '14px';

    container.appendChild(label);
    container.appendChild(input);
    return container;
}

// One "Label: value" stat row in the summary panel (amount / volume / count).
function createSummaryRow(labelText, valueId, valueColor, initialText) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.justifyContent = 'space-between';
    container.style.padding = '10px';
    container.style.backgroundColor = 'var(--bg-surface-2)';
    container.style.borderRadius = '6px';

    const label = document.createElement('span');
    label.textContent = labelText;
    label.style.fontWeight = 'bold';
    label.style.color = 'var(--text-secondary)';

    const value = document.createElement('span');
    value.id = valueId;
    value.textContent = initialText;
    value.style.color = valueColor;
    value.style.fontWeight = 'bold';

    container.appendChild(label);
    container.appendChild(value);
    return container;
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

    const startDateContainer = createLabeledDateField('Start Date', 'start-date');
    const endDateContainer = createLabeledDateField('End Date', 'end-date');

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

    summaryContainer.appendChild(createSummaryRow('Total Amount:', 'total-amount', '#28a745', 'Rs. 0.00'));
    summaryContainer.appendChild(createSummaryRow('Total Volume:', 'total-volume', '#007bff', '0.00 Ltr'));
    summaryContainer.appendChild(createSummaryRow('Transactions:', 'transaction-count', '#17a2b8', '0'));

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
        row.style.backgroundColor = index % 2 === 1 ? 'var(--bg-surface-2)' : 'var(--bg-surface)';
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
            td.style.borderBottom = '1px solid var(--border)';
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