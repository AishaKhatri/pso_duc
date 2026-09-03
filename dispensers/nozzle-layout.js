// Common configuration for both layouts
const LAYOUT_CONFIG = {
    [NOZZLE_LAYOUTS.FULL]: {
        width: '175px',
        minWidth: '175px',
        maxWidth: '195px',
        iconSize: '28px',
        fontSize: '26px',
        showLockStatus: true,
        showMetrics: true,
        showTotals: true,
        showLastUpdated: false,
        headerPadding: '0 20px 0 8px',
        sectionPadding: '6px 12px',
        statusFontSize: '12px',
        ViewTransactionsFontSize: '12px',
        cardTopPadding: '4px'
    },
    [NOZZLE_LAYOUTS.SUMMARY]: {
        width: '160px',
        minWidth: '145px',
        maxWidth: '160px',
        iconSize: '26px',
        fontSize: '24px',
        showLockStatus: false,
        showMetrics: false,
        showPricePerLitre: true,
        showTotals: false,
        showLastUpdated: false,
        headerPadding: '2px 14px 2px 6px',
        sectionPadding: '10px 10px',
        statusFontSize: '12px',
        ViewTransactionsFontSize: '12px',
        cardTopPadding: '2px'
    }
};

// parseFloat that treats non-numeric input as 0.
function safeNumber(value) {
    return isNaN(parseFloat(value)) ? 0 : parseFloat(value);
}

function createNozzleTag(fuelType, nozzleId, layoutType) {
    const config = LAYOUT_CONFIG[layoutType];
    const colorConfig = productColorConfig[fuelType];

    const tag = document.createElement('div');
    Object.assign(tag.style, {
        position: 'absolute',
        top: '0',
        left: '-3px',
        transform: 'translateY(18%)',
        zIndex: '3',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: config.headerPadding,
        background: colorConfig.header,
        color: '#111111',
        // Accent strip on the left edge only.
        borderLeft: `4px solid ${colorConfig.accent}`,
        // Square on the left, strongly rounded on the right — a tab look.
        borderRadius: '10px 18px 18px 0',
        boxShadow: 'var(--shadow-card)',
        whiteSpace: 'nowrap'
    });
    // Keep tag readable in both themes — fuel colours are brand identifiers

    const nozzleIcon = createIconFromImage('assets/graphics/nozzle-icon.png', 'Nozzle Icon', config.iconSize, config.iconSize);
    nozzleIcon.style.objectFit = 'contain';

    const nozzleNumber = document.createElement('div');
    nozzleNumber.style.fontSize = config.fontSize;
    nozzleNumber.style.fontWeight = 'bold';
    nozzleNumber.style.letterSpacing = '-2px';
    nozzleNumber.textContent = nozzleId?.toString().padStart(2, '0') ?? '--';

    tag.appendChild(nozzleIcon);
    tag.appendChild(nozzleNumber);
    return tag;
}

function createStatusBadge(data, config) {
    // Tri-state palette:
    //   1 → green (badge-online)   = device + MB OK
    //   0 → amber (badge-reset)    = device online, MB silent
    //   2 → red   (badge-offline)  = no recent ping
    const status = document.createElement('div');
    const code = Number(data.statusCode);
    let bgVar = 'var(--badge-offline-bg)';
    let txtVar = 'var(--badge-offline-text)';
    if (code === 1) {
        bgVar = 'var(--badge-online-bg)';
        txtVar = 'var(--badge-online-text)';
    } else if (code === 0) {
        bgVar = 'var(--badge-reset-bg)';
        txtVar = 'var(--badge-reset-text)';
    }
    status.style.background = bgVar;
    status.style.color = txtVar;
    status.style.fontWeight = '500';
    status.style.padding = '4px 10px';
    status.style.borderRadius = '20px';
    status.style.fontSize = config.statusFontSize;
    status.style.cursor = 'pointer';
    status.style.userSelect = 'none';
    status.style.whiteSpace = 'nowrap';
    status.textContent = data.status ?? 'Unknown';
    status.title = data.lastPingAt
        ? `Last ping: ${formatRelativeTime(data.lastPingAt)} (${new Date(data.lastPingAt).toLocaleString()})`
        : 'No ping received yet';

    // Tap-to-reveal "Last ping" — touch panels can't surface the title= tooltip,
    // so the same info toggles inline in the body on tap/click of the badge.
    const pingNote = document.createElement('div');
    pingNote.style.fontSize = '10px';
    pingNote.style.color = 'var(--text-secondary)';
    pingNote.style.textAlign = 'right';
    pingNote.style.marginTop = '10px';
    // Show the last-ping timestamp by default; the badge click below toggles it.
    pingNote.textContent = data.lastPingAt
        ? `${formatRelativeTime(data.lastPingAt)} (${new Date(data.lastPingAt).toLocaleString()})`
        : 'No ping received yet';
    pingNote.style.display = 'block';

    status.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = pingNote.style.display !== 'none';
        if (open) {
            pingNote.style.display = 'none';
        } else {
            // Refresh the relative time at open so a long-idle card doesn't show stale "2m ago".
            pingNote.textContent = data.lastPingAt
                ? `${formatRelativeTime(data.lastPingAt)} (${new Date(data.lastPingAt).toLocaleString()})`
                : 'No ping received yet';
            pingNote.style.display = 'block';
        }
    });

    return { badge: status, pingNote };
}

function createStatusSection(data, layoutType) {
    const config = LAYOUT_CONFIG[layoutType];
    const section = document.createElement('div');
    section.style.padding = config.sectionPadding;
    section.style.borderBottom = '2px solid var(--border)';
    section.style.marginBottom = '8px';

    const { badge, pingNote } = createStatusBadge(data, config);

    const statusWrapper = document.createElement('div');
    statusWrapper.style.display = 'flex';
    statusWrapper.style.justifyContent = 'flex-end';
    statusWrapper.style.alignItems = 'center';
    statusWrapper.style.marginBottom = '8px';

    statusWrapper.appendChild(badge);
    section.appendChild(statusWrapper);
    section.appendChild(pingNote);

    // Price/litre as a metric row below the ping note (SUMMARY layout). Placed here,
    if (config.showPricePerLitre) {
        const priceRow = document.createElement('div');
        priceRow.style.display = 'flex';
        priceRow.style.justifyContent = 'space-between';
        priceRow.style.alignItems = 'center';
        priceRow.style.marginTop = '8px';

        const label = document.createElement('div');
        label.style.fontSize = '12px';
        label.style.fontWeight = '500';
        label.style.color = 'var(--text-primary)';
        label.textContent = 'Price/Ltr';

        const value = document.createElement('div');
        value.style.fontSize = '13px';
        value.style.fontWeight = '700';
        value.style.color = 'var(--metric-highlight-text)';
        value.style.background = 'var(--metric-highlight-bg)';
        value.style.border = '1px solid var(--metric-highlight-border)';
        value.style.borderRadius = '2px';
        value.style.padding = '2px 5px';
        value.style.minWidth = '60px';
        value.style.textAlign = 'right';
        value.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
        value.textContent = safeNumber(data.pricePerLitre).toFixed(2);

        priceRow.appendChild(label);
        priceRow.appendChild(value);
        section.appendChild(priceRow);
    }

    return section;
}

// Small helper — renders "2m ago", "1h 13m ago", etc. Used in the tooltip and
// (for the FULL layout) below the status badge.
function formatRelativeTime(ts) {
    if (!ts) return 'never';
    const then = new Date(ts).getTime();
    if (Number.isNaN(then)) return 'unknown';
    const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const hr = Math.floor(diffMin / 60);
    const min = diffMin % 60;
    if (hr < 24) return min ? `${hr}h ${min}m ago` : `${hr}h ago`;
    const day = Math.floor(hr / 24);
    const hrRem = hr % 24;
    return hrRem ? `${day}d ${hrRem}h ago` : `${day}d ago`;
}

// Create metrics section (only for FULL layout)
function createMetricsSection(data) {
    const section = document.createElement('div');

    const metricBox = (label, value, opts = {}) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.marginBottom = '6px';
        div.style.padding = '0 12px';

        const labelDiv = document.createElement('div');
        labelDiv.style.fontSize = '11px';
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
        valueDiv.style.minWidth = '55px';
        valueDiv.style.textAlign = 'right';
        valueDiv.style.boxShadow = 'inset 1px 1px 2px rgba(0,0,0,0.2)';
        valueDiv.style.fontFamily = "'Segoe UI', 'Arial', sans-serif";
        valueDiv.textContent = value;

        div.appendChild(labelDiv);
        div.appendChild(valueDiv);
        return div;
    };

    // "Last Sale" groups Amount + Volume under a shared heading.
    const lastSale = document.createElement('div');
    lastSale.style.marginBottom = '6px';
    lastSale.style.borderBottom = '2px solid var(--border)';

    const printSaleIcon = createIconFromImage('assets/graphics/printer-icon.svg', 'Print Receipt', '20px', '20px');
    printSaleIcon.style.position = 'absolute';
    printSaleIcon.style.left = '12px';
    printSaleIcon.style.cursor = 'pointer';
    printSaleIcon.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            // Send the same last-sale figures shown on this card; the backend
            // formats and prints the PSO receipt.
            const resp = await fetch(`${API_BASE_URL}/print-receipt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    product: data.fuelType,
                    volume: safeNumber(data.quantity),
                    pricePerLitre: safeNumber(data.pricePerLitre),
                    amount: safeNumber(data.price),
                    customerCode: data.customerCode,
                    stationId: data.stationId,
                })
            });
            if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
            window.showNotification?.('Receipt sent to printer', 'success');
        } catch (err) {
            window.showNotification?.(`Print failed: ${err.message}`, 'error');
        }
    });
    lastSale.appendChild(printSaleIcon);
    
    const lastSaleHeading = document.createElement('div');
    lastSaleHeading.style.fontSize = '11px';
    lastSaleHeading.style.fontWeight = '700';
    lastSaleHeading.style.color = 'var(--text-secondary)';
    lastSaleHeading.style.textAlign = 'center';
    lastSaleHeading.style.textTransform = 'uppercase';
    lastSaleHeading.style.letterSpacing = '0.5px';
    lastSaleHeading.style.padding = '0 12px';
    lastSaleHeading.style.marginBottom = '10px';
    lastSaleHeading.style.marginTop = '4px';
    lastSaleHeading.textContent = 'Last Sale';
    lastSale.appendChild(lastSaleHeading);

    const amountRow = metricBox("Amount (PKR)", `${safeNumber(data.price).toFixed(2)}`);
    const volumeRow = metricBox("Volume (Ltr)", `${safeNumber(data.quantity).toFixed(2)}`);
    lastSale.appendChild(amountRow);
    lastSale.appendChild(volumeRow);
    section.appendChild(lastSale);

    section.appendChild(metricBox("Price/Ltr (PKR)", `${safeNumber(data.pricePerLitre).toFixed(2)}`, { highlight: true }));
    

    return section;
}

// Create totals footer (only for FULL layout)
function createTotalsFooter(data) {
    const footer = document.createElement('div');
    footer.style.padding = '7px 14px';
    footer.style.borderTop = '1px solid var(--border)';
    footer.style.background = 'var(--bg-surface-2)';
    footer.style.color = 'var(--text-primary)';
    footer.style.fontSize = '12px';

    const formatWithCommas = (value) => safeNumber(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const totalQuantityDiv = document.createElement('div');
    totalQuantityDiv.style.marginBottom = '0px';
    totalQuantityDiv.innerHTML = `
        <div>Total Quantity:</div>
        <div style="text-align: right; font-weight: bold; color: var(--metric-value-text);">${formatWithCommas(data.totalQuantity)} Ltr</div>
    `;

    const salesTodayDiv = document.createElement('div');
    salesTodayDiv.innerHTML = `
        <div>Sales Today:</div>
        <div style="text-align: right; font-weight: bold; color: var(--metric-value-text);">Rs. <span style="font-size: 18px;">${formatWithCommas(data.totalSalesToday)}</span></div>
    `;
    
    footer.appendChild(totalQuantityDiv);
    footer.appendChild(salesTodayDiv);
    
    return footer;
}

// Create last updated section (only for FULL layout)
function createLastUpdatedSection(lastUpdated, lastPingAt) {
    const wrap = document.createElement('div');
    wrap.style.textAlign = 'center';
    wrap.style.fontSize = '11px';
    wrap.style.borderTop = '1px solid var(--border)';
    wrap.style.color = 'var(--text-secondary)';
    wrap.style.padding = '4px 0';

    const updatedLine = document.createElement('div');
    updatedLine.textContent = `Last Updated: ${lastUpdated ?? '-'}`;
    wrap.appendChild(updatedLine);

    const pingLine = document.createElement('div');
    pingLine.textContent = lastPingAt
        ? `Last Ping: ${formatRelativeTime(lastPingAt)} ${new Date(lastPingAt).toLocaleString()}`
        : 'Last Ping: never';
    if (lastPingAt) {
        pingLine.title = new Date(lastPingAt).toLocaleString();
    }
    wrap.appendChild(pingLine);

    return wrap;
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
        card.style.background = 'var(--bg-surface-3)';
        card.style.fontFamily = 'Segoe UI, sans-serif';
        card.style.color = 'var(--text-primary)';
        // Flat tile (no shadow) inside the dispenser card; a hairline border + grid
        // gap define each nozzle without adding background tinting or shadow clutter.
        card.style.boxShadow = 'var(--shadow-card)';
        // Visible (not hidden) so the floating tag/badge can straddle the top edge.
        card.style.overflow = 'visible';
        card.style.flexShrink = '0';
        card.style.padding = `${config.cardTopPadding} 0 0`;
        card.style.border = data.locked ? '3px solid var(--danger)' : '2px solid var(--border)';

        // Floating nozzle tag straddling the top-left corner like the dispenser
        // card's floating tab.
        const nozzleTag = createNozzleTag(data.fuelType, data.nozzleId, layoutType);
        card.appendChild(nozzleTag);

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
            const lastUpdated = createLastUpdatedSection(data.lastUpdated, data.lastPingAt);
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
window.LAYOUT_CONFIG = LAYOUT_CONFIG;