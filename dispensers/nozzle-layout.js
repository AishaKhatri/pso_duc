window.createNozzleLayout = function (containerId, data) {
    try {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn(`Container ${containerId} not found, retrying...`);
            setTimeout(() => {
                const retryContainer = document.getElementById(containerId);
                if (retryContainer) {
                    window.createNozzleLayout(containerId, data);
                }
            }, 50);
            return;
        }
    
    container.innerHTML = '';

    const card = document.createElement('div');
    // Add position relative to contain the absolute positioned overlay
    card.style.position = 'relative';
    card.style.width = '220px';
    card.style.minWidth = '220px';
    card.style.maxWidth = '220px';
    card.style.borderRadius = '10px';
    card.style.background = '#ffffff';
    card.style.fontFamily = 'Segoe UI, sans-serif';
    card.style.color = '#333';
    card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.06)';
    card.style.overflow = 'hidden';
    card.style.flexShrink = '0';
    card.style.padding = '0px';
    card.style.border = data.locked ? '3px solid #D32F2F' : '0.5px solid #dddddd';

    const fuelConfig = {
      'PMG': { header: '#FF7043', accent: '#FFCCBC' }, // Coral, Peach
      // 'HSD': { header: '#FFB300', accent: '#FFE0B2' }, // Amber, Golden
      'HSD': { header: '#1E88E5', accent: '#90CAF9' } // Terracotta, Beige
    };

    const fuelType = data.fuelType;
    const config = fuelConfig[fuelType];

    // Header with nozzle ID
    const header = document.createElement('div');
    header.style.background = config.header;
    header.style.color = '#111111';
    header.style.padding = '4px 8px 4px';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.borderBottom = `4px solid ${config.accent}`;

    // Left: Nozzle icon + number
    const nozzleLeft = document.createElement('div');
    nozzleLeft.style.display = 'flex';
    nozzleLeft.style.alignItems = 'center';
    nozzleLeft.style.gap = '8px';

    const nozzleIcon = createIconFromImage('assets/graphics/nozzle-icon.png', 'Nozzle Icon', '40px', '40px');
    nozzleIcon.style.objectFit = 'contain';

    const nozzleNumber = document.createElement('div');
    nozzleNumber.style.fontSize = '36px';
    nozzleNumber.style.fontWeight = 'bold';
    nozzleNumber.textContent = data.nozzleId?.toString().padStart(2, '0') ?? '--';

    nozzleLeft.appendChild(nozzleIcon);
    nozzleLeft.appendChild(nozzleNumber);

    header.appendChild(nozzleLeft);
    card.appendChild(header);

    const bodyWrapper = document.createElement('div');
    bodyWrapper.style.position = 'relative';

    // Main metrics section
    const section = document.createElement('div');
    section.style.padding = '10px 15px';

    const statusWrapper = document.createElement('div');
    statusWrapper.style.display = 'flex';
    statusWrapper.style.justifyContent = 'space-between';
    statusWrapper.style.alignItems = 'center';
    statusWrapper.style.marginBottom = '12px';

    // Keypad and lock/unlock icons (left-aligned)
    const keypadContainer = document.createElement('div');
    keypadContainer.style.display = 'flex';
    keypadContainer.style.alignItems = 'center';
    keypadContainer.style.gap = '8px';

    const keypadBox = document.createElement('div');
    keypadBox.style.border = '1px solid #000000';
    keypadBox.style.borderRadius = '4px';
    keypadBox.style.padding = '2px';
    keypadBox.style.display = 'flex';
    keypadBox.style.alignItems = 'center';
    keypadBox.style.justifyContent = 'center';

    const keypadIcon = createIconFromImage('assets/graphics/keypad-icon.png', 'Keypad Icon', '20px');
    keypadBox.appendChild(keypadIcon);

    const lockIcon = document.createElement('img');
    lockIcon.src = data.keypadStatus === 'Locked' ? 'assets/graphics/green-lock.png' : 'assets/graphics/red-unlock.png';
    lockIcon.alt = data.keypadStatus === 'Locked' ? 'Locked' : 'Unlocked';
    lockIcon.style.height = '25px';

    keypadContainer.appendChild(keypadBox);
    keypadContainer.appendChild(lockIcon);

    // Status (right-aligned)
    const status = document.createElement('div');
    status.style.background = data.status === 'Active' ? '#e1f3e3' : '#f9d6d5';
    status.style.color = data.status === 'Active' ? '#014421' : '#a00000';
    status.style.fontWeight = '500';
    status.style.padding = '4px 10px';
    status.style.borderRadius = '20px';
    status.style.fontSize = '14px';
    status.textContent = data.status ?? 'Unknown';

    statusWrapper.appendChild(keypadContainer);
    statusWrapper.appendChild(status);
    section.appendChild(statusWrapper);

    const safeNumber = (value) => isNaN(parseFloat(value)) ? 0 : parseFloat(value);

    const metricBox = (label, value) => `
      <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      ">
        <div style="
          font-size: 14px;
          color: #333;
          font-weight: 500;
        ">
          ${label}
        </div>
        <div style="
          font-size: 16px;
          font-weight: 600;
          color: #014421;
          background: linear-gradient(to bottom, #f8f8f8, rgb(241, 241, 241));
          border: 1px solid #ccc;
          border-radius: 2px;
          padding: 3px 6px;
          min-width: 75px;
          text-align: right;
          box-shadow: inset 1px 1px 2px rgba(0,0,0,0.2);
          font-family: 'Segoe UI', 'Arial', sans-serif;
        ">
          ${value}
        </div>
      </div>
    `;

    section.innerHTML += `
      ${metricBox("Price (PKR)", `${safeNumber(data.price).toFixed(2)}`)}
      ${metricBox("Quantity (Ltr)", `${safeNumber(data.quantity).toFixed(2)}`)}
      ${metricBox("Price/Ltr (PKR)", `${safeNumber(data.pricePerLitre).toFixed(2)}`)}
    `;
    // card.appendChild(section);

    // Totals
    const footer = document.createElement('div');
    footer.style.padding = '8px 20px 8px';
    footer.style.borderTop = '1px solid #999999';
    footer.style.background = 'rgb(248, 248, 248)';
    footer.style.fontSize = '14px';

    const row = (label, value) => `
      <div style="margin-bottom: 0px;">
        <div>${label}</div>
        <div style="text-align: right; font-weight: bold; color: #014421;">${value}</div>
      </div>
    `;

    footer.innerHTML = `
      ${row("Total Quantity:", `${safeNumber(data.totalQuantity).toFixed(2)} Ltr`)}
      ${row("Sales Today:", `Rs. </span><span style="font-size: 28px;">${safeNumber(data.totalSalesToday).toFixed(2)}</span>`)}
    `;

    bodyWrapper.appendChild(section);
    bodyWrapper.appendChild(footer);

    // Disabled overlay if locked
    if (data.locked) {
      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.background = 'rgba(255, 255, 255, 0.7)';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.zIndex = '1';

      const disabledImg = createIconFromImage('assets/graphics/disabled.png', 'Disabled', 'auto', '75%');
      disabledImg.style.opacity = '0.5';

      overlay.appendChild(disabledImg);
      bodyWrapper.appendChild(overlay);
    }

    card.appendChild(bodyWrapper);

    // View transaction log
    const view_trans_log = createLink();
    view_trans_log.style.fontSize = '14px';
    view_trans_log.style.borderTop = '1px solid #999999';
    view_trans_log.style.padding = '4px 0 4px';
    view_trans_log.textContent = `View Transactions ↗`;
    card.appendChild(view_trans_log);

    view_trans_log.addEventListener('click', () => {
        // Make sure we have the required data
        if (!data.dispenserId || !data.fullNozzleId) {
            console.error('Missing dispenserId or fullNozzleId in nozzle data:', data);
            window.showNotification?.('Nozzle information incomplete', 'error');
            return;
        }
        
        if (typeof window.showTransactionLogPopup === 'function') {
            window.showTransactionLogPopup(data.fullNozzleId);
        } else {
            // Load the script with correct relative path
            const script = document.createElement('script');
            script.src = '../stations/transaction-log.js'; // Use ../ if dispenser.html is in root
            
            script.onload = () => {
                if (typeof window.showTransactionLogPopup === 'function') {
                    window.showTransactionLogPopup(data.fullNozzleId);
                } else {
                    window.showNotification?.('Transaction log functionality not available', 'error');
                }
            };
            
            script.onerror = (error) => {
                console.error('Failed to load transaction log script:', error);
                window.showNotification?.('Failed to load transaction log functionality', 'error');
            };
            
            document.head.appendChild(script);
        }
    });

    // Last updated time
    const updated = document.createElement('div');
    updated.style.textAlign = 'center';
    updated.style.fontSize = '11px';
    updated.style.borderTop = '1px solid #999999';
    updated.style.color = '#666';
    updated.style.padding = '4px 0 4px';
    updated.textContent = `Last Updated: ${data.lastUpdated ?? '-'}`;
    card.appendChild(updated);

    container.appendChild(card);

  } catch (error) {
    console.error('Error in createNozzleLayout:', error);
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = `<div style="color:red">Error rendering nozzle: ${error.message}</div>`;
    }
  }
};