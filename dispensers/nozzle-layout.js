// Common configuration for both layouts
const LAYOUT_CONFIG = {
    [NOZZLE_LAYOUTS.FULL]: {
        width: '190px',
        minWidth: '190px',
        maxWidth: '190px',
        iconSize: '32px',
        fontSize: '28px',
        showKeypad: true,
        showLockStatus: true,
        showMetrics: true,
        showTotals: true,
        showLastUpdated: false,
        headerPadding: '3px 7px 3px',
        sectionPadding: '8px 12px',
        statusFontSize: '12px'
    },
    [NOZZLE_LAYOUTS.SUMMARY]: {
        width: '160px',
        minWidth: '140px',
        maxWidth: '160px',
        iconSize: '25px',
        fontSize: '24px',
        showKeypad: false,
        showLockStatus: false,
        showMetrics: false,
        showPricePerLitre: true,
        showTotals: false,
        showLastUpdated: false,
        headerPadding: '2px 16px 2px',
        sectionPadding: '10px 10px',
        statusFontSize: '12px',
        ViewTransactionsFontSize: '12px'
    }
};

// Create the header section (common)
function createHeaderSection(fuelType, nozzleId, layoutType) {
    const config = LAYOUT_CONFIG[layoutType];
    const colorConfig = productColorConfig[fuelType];
    
    const header = document.createElement('div');
    header.style.background = colorConfig.header;
    header.style.color = '#111111';
    header.style.padding = config.headerPadding;
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.borderBottom = `4px solid ${colorConfig.accent}`;
    // Keep header readable in both themes — fuel header colors are brand identifiers

    // Left: Nozzle icon + number
    const nozzleLeft = document.createElement('div');
    nozzleLeft.style.display = 'flex';
    nozzleLeft.style.alignItems = 'center';
    nozzleLeft.style.gap = '8px';

    const nozzleIcon = createIconFromImage('assets/graphics/nozzle-icon.png', 'Nozzle Icon', config.iconSize, config.iconSize);
    nozzleIcon.style.objectFit = 'contain';

    const nozzleNumber = document.createElement('div');
    nozzleNumber.style.fontSize = config.fontSize;
    nozzleNumber.style.fontWeight = 'bold';
    nozzleNumber.textContent = nozzleId?.toString().padStart(2, '0') ?? '--';

    nozzleLeft.appendChild(nozzleIcon);
    nozzleLeft.appendChild(nozzleNumber);
    header.appendChild(nozzleLeft);
    
    return header;
}

// Create status section (common)
function createStatusSection(data, layoutType) {
    const safeNumber = (value) => isNaN(parseFloat(value)) ? 0 : parseFloat(value);
    const config = LAYOUT_CONFIG[layoutType];
    const section = document.createElement('div');
    section.style.padding = config.sectionPadding;

    const statusWrapper = document.createElement('div');
    statusWrapper.style.display = 'flex';
    statusWrapper.style.justifyContent = 'space-between';
    statusWrapper.style.alignItems = 'center';
    statusWrapper.style.marginBottom = '12px';

    // Compact price/litre (SUMMARY layout) — sits to the left of the status badge.
    if (config.showPricePerLitre) {
        const price = document.createElement('div');
        price.style.fontSize = '13px';
        price.style.fontWeight = '700';
        price.style.color = 'var(--metric-highlight-text)';
        price.textContent = `Rs. ${safeNumber(data.pricePerLitre).toFixed(2)}`;
        statusWrapper.appendChild(price);
    }

    // Keypad and lock/unlock icons (only for FULL layout)
    if (config.showKeypad && config.showLockStatus) {
        const keypadContainer = document.createElement('div');
        keypadContainer.style.display = 'flex';
        keypadContainer.style.alignItems = 'center';
        keypadContainer.style.gap = '8px';

        const keypadBox = document.createElement('div');
        keypadBox.style.border = '1px solid var(--text-primary)';
        keypadBox.style.borderRadius = '4px';
        keypadBox.style.padding = '2px';
        keypadBox.style.display = 'flex';
        keypadBox.style.alignItems = 'center';
        keypadBox.style.justifyContent = 'center';

        const keypadIcon = createIconFromImage('assets/graphics/keypad-icon.png', 'Keypad Icon', '16px');
        keypadBox.appendChild(keypadIcon);

        const lockIcon = document.createElement('img');
        lockIcon.src = data.keypadStatus === 'Locked' ? 'assets/graphics/green-lock.png' : 'assets/graphics/red-unlock.png';
        lockIcon.alt = data.keypadStatus === 'Locked' ? 'Locked' : 'Unlocked';
        lockIcon.style.height = '20px';

        keypadContainer.appendChild(keypadBox);
        keypadContainer.appendChild(lockIcon);
        statusWrapper.appendChild(keypadContainer);
    }

    // Status (right-aligned)
    const status = document.createElement('div');
    status.style.background = data.status === 'Active' ? 'var(--badge-online-bg)' : 'var(--badge-offline-bg)';
    status.style.color = data.status === 'Active' ? 'var(--badge-online-text)' : 'var(--badge-offline-text)';
    status.style.fontWeight = '500';
    status.style.padding = '4px 10px';
    status.style.borderRadius = '20px';
    status.style.fontSize = config.statusFontSize;
    status.textContent = data.status ?? 'Unknown';

    statusWrapper.appendChild(status);
    section.appendChild(statusWrapper);
    
    return section;
}

// Create metrics section (only for FULL layout)
function createMetricsSection(data) {
    const safeNumber = (value) => isNaN(parseFloat(value)) ? 0 : parseFloat(value);
    
    const section = document.createElement('div');
    section.style.padding = '0 12px';

    const metricBox = (label, value, opts = {}) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.marginBottom = '7px';

        const labelDiv = document.createElement('div');
        labelDiv.style.fontSize = '12px';
        labelDiv.style.color = 'var(--text-primary)';
        labelDiv.style.fontWeight = '500';
        labelDiv.textContent = label;

        const valueDiv = document.createElement('div');
        valueDiv.style.fontSize = '13px';
        valueDiv.style.fontWeight = '700';
        valueDiv.style.color = opts.highlight ? 'var(--metric-highlight-text)' : 'var(--metric-value-text)';
        valueDiv.style.background = opts.highlight ? 'var(--metric-highlight-bg)' : 'var(--metric-value-bg)';
        valueDiv.style.border = opts.highlight ? '1px solid var(--metric-highlight-border)' : '1px solid var(--border)';
        valueDiv.style.borderRadius = '2px';
        valueDiv.style.padding = '2px 5px';
        valueDiv.style.minWidth = '60px';
        valueDiv.style.textAlign = 'right';
        valueDiv.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
        valueDiv.style.fontFamily = "'Segoe UI', 'Arial', sans-serif";
        valueDiv.textContent = value;

        div.appendChild(labelDiv);
        div.appendChild(valueDiv);
        return div;
    };

    section.appendChild(metricBox("Price (PKR)", `${safeNumber(data.price).toFixed(2)}`));
    section.appendChild(metricBox("Quantity (Ltr)", `${safeNumber(data.quantity).toFixed(2)}`));
    section.appendChild(metricBox("Price/Ltr (PKR)", `${safeNumber(data.pricePerLitre).toFixed(2)}`, { highlight: true }));
    
    return section;
}

// Create totals footer (only for FULL layout)
function createTotalsFooter(data) {
    const safeNumber = (value) => isNaN(parseFloat(value)) ? 0 : parseFloat(value);
    
    const footer = document.createElement('div');
    footer.style.padding = '7px 14px';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.background = 'var(--bg-surface-2)';
    footer.style.color = 'var(--text-primary)';
    footer.style.fontSize = '12px';

    const totalQuantityDiv = document.createElement('div');
    totalQuantityDiv.style.marginBottom = '0px';
    totalQuantityDiv.innerHTML = `
        <div>Total Quantity:</div>
        <div style="text-align: right; font-weight: bold; color: var(--metric-value-text);">${safeNumber(data.totalQuantity).toFixed(2)} Ltr</div>
    `;

    const salesTodayDiv = document.createElement('div');
    salesTodayDiv.innerHTML = `
        <div>Sales Today:</div>
        <div style="text-align: right; font-weight: bold; color: var(--metric-value-text);">Rs. <span style="font-size: 22px;">${safeNumber(data.totalSalesToday).toFixed(2)}</span></div>
    `;
    
    footer.appendChild(totalQuantityDiv);
    footer.appendChild(salesTodayDiv);
    
    return footer;
}

// Create last updated section (only for FULL layout)
function createLastUpdatedSection(lastUpdated) {
    const updated = document.createElement('div');
    updated.style.textAlign = 'center';
    updated.style.fontSize = '11px';
    updated.style.borderTop = '1px solid var(--border)';
    updated.style.color = 'var(--text-secondary)';
    updated.style.padding = '4px 0 4px';
    updated.textContent = `Last Updated: ${lastUpdated ?? '-'}`;
    return updated;
}

// Create transaction log link (common)
function createTransactionLogLink(data, layoutType) {
    const config = LAYOUT_CONFIG[layoutType];

    const view_trans_log = createLink();
    view_trans_log.style.fontSize = config.ViewTransactionsFontSize;
    view_trans_log.style.borderTop = '1px solid var(--border)';
    view_trans_log.style.padding = '4px 0 4px';
    view_trans_log.textContent = `View Transactions ↗`;
    
    view_trans_log.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!data.dispenserId || !data.fullNozzleId) {
            console.error('Missing dispenserId or fullNozzleId in nozzle data:', data);
            window.showNotification?.('Nozzle information incomplete', 'error');
            return;
        }
        
        if (typeof window.showTransactionLogPopup === 'function') {
            window.showTransactionLogPopup(data.fullNozzleId);
        } else {
            const script = document.createElement('script');
            script.src = '../stations/transaction-log.js';
            script.onload = () => {
                if (typeof window.showTransactionLogPopup === 'function') {
                    window.showTransactionLogPopup(data.fullNozzleId);
                } else {
                    window.showNotification?.('Transaction log functionality not available', 'error');
                }
            };
            script.onerror = () => {
                window.showNotification?.('Failed to load transaction log functionality', 'error');
            };
            document.head.appendChild(script);
        }
    });
    
    return view_trans_log;
}

// Create disabled overlay (common)
function createDisabledOverlay() {
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'var(--disabled-overlay)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '1';

    const disabledImg = createIconFromImage('assets/graphics/disabled.png', 'Disabled', 'auto', '75%');
    disabledImg.style.opacity = '0.5';
    overlay.appendChild(disabledImg);
    
    return overlay;
}

// Main function to create nozzle layout (with type control)
window.createNozzleLayout = function(containerId, data, layoutType = NOZZLE_LAYOUTS.FULL) {
    try {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn(`Container ${containerId} not found, retrying...`);
            setTimeout(() => {
                const retryContainer = document.getElementById(containerId);
                if (retryContainer) {
                    window.createNozzleLayout(containerId, data, layoutType);
                }
            }, 50);
            return;
        }
        
        container.innerHTML = '';
        
        const config = LAYOUT_CONFIG[layoutType];
        const card = document.createElement('div');
        card.style.position = 'relative';
        card.style.width = config.width;
        card.style.minWidth = config.minWidth;
        card.style.maxWidth = config.maxWidth;
        card.style.borderRadius = '10px';
        card.style.background = 'var(--bg-surface)';
        card.style.fontFamily = 'Segoe UI, sans-serif';
        card.style.color = 'var(--text-primary)';
        card.style.boxShadow = 'var(--shadow-card)';
        card.style.overflow = 'hidden';
        card.style.flexShrink = '0';
        card.style.padding = '0px';
        card.style.border = data.locked ? '3px solid var(--danger)' : '0.5px solid var(--border)';
        
        // Header
        const header = createHeaderSection(data.fuelType, data.nozzleId, layoutType);
        card.appendChild(header);
        
        const bodyWrapper = document.createElement('div');
        bodyWrapper.style.position = 'relative';
        
        // Status section
        const statusSection = createStatusSection(data, layoutType);
        bodyWrapper.appendChild(statusSection);
        
        // Metrics section (only for FULL layout)
        if (config.showMetrics) {
            const metricsSection = createMetricsSection(data);
            bodyWrapper.appendChild(metricsSection);
        }

        // Totals footer (only for FULL layout)
        if (config.showTotals) {
            const totalsFooter = createTotalsFooter(data);
            bodyWrapper.appendChild(totalsFooter);
        }
        
        // Disabled overlay if locked
        if (data.locked) {
            const overlay = createDisabledOverlay();
            bodyWrapper.appendChild(overlay);
        }
        
        card.appendChild(bodyWrapper);
        
        // Transaction log link (common for both layouts)
        const transactionLink = createTransactionLogLink(data, layoutType);
        card.appendChild(transactionLink);
        
        // Last updated (only for FULL layout)
        if (config.showLastUpdated) {
            const lastUpdated = createLastUpdatedSection(data.lastUpdated);
            card.appendChild(lastUpdated);
        }
        
        container.appendChild(card);
        
    } catch (error) {
        console.error('Error in createNozzleLayout:', error);
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = `<div style="color:red">Error rendering nozzle: ${error.message}</div>`;
        }
    }
};

// Backward compatibility wrapper for full layout
window.createFullNozzleLayout = function(containerId, data) {
    window.createNozzleLayout(containerId, data, NOZZLE_LAYOUTS.FULL);
};

// Backward compatibility wrapper for summary layout
window.createNozzleSummary = function(containerId, data) {
    window.createNozzleLayout(containerId, data, NOZZLE_LAYOUTS.SUMMARY);
};

// Export constants for external use
window.NOZZLE_LAYOUTS = NOZZLE_LAYOUTS;