const host_PC_IP = 'localhost';
const API_BASE_URL = `http://${host_PC_IP}:3001/api`;

const pages = {};

const cityMap = {
    'Karachi' : 'KHI',
    'Lahore' : 'LHE',
    'Islamabad' : 'ISB',
}

function renderApp() {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div id="topbar"></div>
        <div id="sidebar"></div>
        <div class="content-wrapper" id="content"></div>
    `;
    renderTopbar();
    renderSidebar();
}

function createCloseButton(overlay) {
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.className = 'modal-close-button';
    closeButton.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });
    return closeButton;
}

function createModalOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
    return overlay;
}

function dragPopup(overlay, popup, centerPopupVertically = true) {
    document.body.appendChild(popup);

    function centerPopup() {
        const initialX = (window.innerWidth - popup.offsetWidth) / 2;
        const initialY = (window.innerHeight - popup.offsetHeight) / 2;
        popup.style.left = `${initialX}px`;
        popup.style.top = `${initialY}px`;
        return { x: initialX, y: initialY };
    }

    requestAnimationFrame(() => {
        let position = centerPopupVertically ? centerPopup() : { 
            x: (window.innerWidth - popup.offsetWidth) / 2,
            y: parseFloat(popup.style.top) || 0
        };

        let currentX = position.x;
        let currentY = position.y;
        let isDragging = false;
        let initialXOffset = 0;
        let initialYOffset = 0;

        popup.addEventListener('mousedown', (e) => {
            isDragging = true;
            initialXOffset = e.clientX - currentX;
            initialYOffset = e.clientY - currentY;
            popup.style.cursor = 'move';
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialXOffset;
                currentY = e.clientY - initialYOffset;
                currentX = Math.max(0, Math.min(currentX, window.innerWidth - popup.offsetWidth));
                currentY = Math.max(0, Math.min(currentY, window.innerHeight - popup.offsetHeight));
                popup.style.left = `${currentX}px`;
                popup.style.top = `${currentY}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            popup.style.cursor = 'default';
        });

        if (centerPopupVertically) {
            const resizeObserver = new ResizeObserver(() => {
                if (!isDragging) {
                    position = centerPopup();
                    currentX = position.x;
                    currentY = position.y;
                }
            });
            resizeObserver.observe(popup);
        }
    });

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    return popup;
}

function renderMainContainer(pageTitle) {
    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-container';
    
    const mainHeader = document.createElement('div');
    mainHeader.className = 'main-header';
    const title = document.createElement('h2');
    title.textContent = pageTitle;
    mainHeader.appendChild(title);
    mainContainer.appendChild(mainHeader);

    return { mainHeader, mainContainer };
}

function createHeader(){
    const header = document.createElement('div');
    header.style.paddingBottom = '5px';
    header.style.borderBottom = '2px solid #004D64';
    header.style.marginBottom = '15px';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    
    return header;
}

function createTitle() {
    const title = document.createElement('h2');
    title.style.color = '#004D64';
    title.style.margin = '0';
    title.style.fontSize = '18px';
    
    return title;
}

function createLink() {
    const link = document.createElement('div');
    link.style.fontSize = '16px';
    link.style.color = '#006effff';
    link.style.cursor = 'pointer';
    link.style.transition = 'text-decoration 0.2s ease';
    link.style.textAlign = 'center';

    link.addEventListener('mouseover', () => {
        link.style.textDecoration = 'underline';
    });
    
    link.addEventListener('mouseout', () => {
        link.style.textDecoration = 'none';
    });

    return link;
}

function createActionButton(mainColor, hoverColor) {
    const button = document.createElement('button');
    button.className = 'action-button';
    button.style.backgroundColor = mainColor || '#004D64';

    button.addEventListener('mouseover', () => {
        button.style.backgroundColor = hoverColor || '#00324C';
    });

    button.addEventListener('mouseout', () => {
        button.style.backgroundColor = mainColor || '#004D64';
    });

    return button;
}

function createMainButton() {
    const button = createActionButton('#004D64', '#00324C');
    button.style.borderRadius = '8px';
    button.style.padding = '12px 16px';
    button.style.marginLeft = '10px';
    button.style.width = '120px';
    button.style.fontSize = '15px';
    button.style.boxShadow = '0 4px 4px rgba(0,0,0,0.4)';

    return button;
};

function createNoDataMessage(message) {
    const noData = document.createElement('div');
    noData.textContent = message;
    noData.style.color = '#666';
    noData.style.textAlign = 'center';
    noData.style.padding = '20px';
    return noData;
}

function createTable(columns) { 
    const tableContainer = document.createElement('div');
    tableContainer.style.backgroundColor = 'white';
    tableContainer.style.borderRadius = '5px';
    tableContainer.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    tableContainer.style.overflow = 'hidden';

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontFamily = 'Arial, sans-serif';
    table.style.fontSize = '14px';

    const thead = document.createElement('thead');
    
    const headerRow = document.createElement('tr');
    headerRow.style.backgroundColor = '#C0DAF0';
    columns.forEach(headerText => {
        const th = document.createElement('th');
        th.style.padding = '12px';
        th.style.textAlign = 'left';
        th.style.borderBottom = '1px solid #ddd';
        // th.style.borderRight = '1px solid #ddd';
        th.style.fontWeight = '600';
        th.style.color = '#333';
        th.textContent = headerText;
        headerRow.appendChild(th);
    });
    headerRow.lastChild.style.borderRight = 'none';
    
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.id = 'dispenser-table-body';
    table.appendChild(tbody);

    tableContainer.appendChild(table);

    return { tableContainer , tbody };
}

function createDropdown(placeholderText) {
    const dropdown = document.createElement('select');
    dropdown.style.padding = '8px';
    dropdown.style.border = '1px solid #ccc';
    dropdown.style.borderRadius = '4px';
    dropdown.style.width = '100%';
    dropdown.style.marginBottom = '20px';

    if (placeholderText != null) {
        const placeholderOption = createPlaceholder(placeholderText);
        dropdown.appendChild(placeholderOption);
    }
    return dropdown;
}

function createPlaceholder(text) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = text;
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.style.color = '#666';
    
    return placeholder;
}

async function updateConnStatus(deviceId, connStatus, connected_at, deviceType = 'dispenser') {
    let deviceCard;
    
    if (deviceType === 'dispenser') {
        deviceCard = document.querySelector(`div[data-address="${deviceId}"]`);
    } else if (deviceType === 'atg') {
        deviceCard = document.querySelector(`div[data-tank-address="${deviceId}"]`);
    }
    
    if (deviceCard) {
        const connStatusText = deviceCard.querySelector('.conn-status');
        const uptime = deviceCard.querySelector('.uptime');
        
        connStatusText.style.background = connStatus === 1 ? '#e1f3e3' : '#f9d6d5';
        connStatusText.style.color = connStatus === 1 ? '#014421' : '#a00000';
        connStatusText.style.fontWeight = '500';
        connStatusText.style.padding = '4px 10px';
        connStatusText.style.borderRadius = '20px';
        connStatusText.style.fontSize = '14px';
        connStatusText.style.width = 'fit-content';
        connStatusText.textContent = connStatus === 1 ? 'CONNECTED' : 'DISCONNECTED';  
        
        const connectedTime = new Date(connected_at).toLocaleString();
        
        if (connStatus === 1 && connected_at) {            
            uptime.textContent = `Connected at: ${connectedTime}`;
        } else {
            uptime.textContent = `Disconnected at: ${connectedTime}`;
        }
    } else {
        console.error(`❌ Device card not found for ${deviceType} with ID: ${deviceId}`);
    }
}

function createCard(title, address) {
    const card = document.createElement('div');
    Object.assign(card.style, {
        backgroundColor: '#fff',
        border: '1px solid #ddd',
        borderRadius: '10px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 'fit-content',
        width: 'fit-content',
        padding: '15px'
    });

    const titleContainer = document.createElement('div');
    titleContainer.style.display = 'flex';
    titleContainer.style.justifyContent = 'space-between';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.marginBottom = '5px';
    titleContainer.style.marginLeft = '5px';
    titleContainer.style.marginRight = '5px';
    titleContainer.style.position = 'relative';

    const titleText = document.createElement('h2');
    titleText.textContent = title;

    const statusText = createLink();
    statusText.className = 'conn-status';
    statusText.textContent = 'Connecting...';
    statusText.style.color = '#666';
    statusText.title = 'Click to view details';
    statusText.addEventListener('click', () => {
        showDevStatusPopup(address);
    });

    titleContainer.appendChild(titleText);
    titleContainer.appendChild(statusText);
    card.appendChild(titleContainer);

    const nextContainer = document.createElement('div');
    nextContainer.style.display = 'flex';
    nextContainer.style.justifyContent = 'space-between';
    nextContainer.style.alignItems = 'center';
    nextContainer.style.marginLeft = '5px';
    nextContainer.style.marginRight = '5px';
    nextContainer.style.position = 'relative';

    const addressText = document.createElement('div');
    addressText.textContent = `Address: ${address}`;
    addressText.style.fontSize = '14px';
    addressText.style.color = '#666';

    const uptime = document.createElement('div');
    uptime.className = 'uptime';
    uptime.style.fontSize = '12px';
    uptime.style.color = '#999';
    
    nextContainer.appendChild(addressText);
    nextContainer.appendChild(uptime);
    card.appendChild(nextContainer);

    return { card, titleContainer };
}

function renderPageHeader(pageTitleText) {
    const headerContainer = document.createElement('div');
    headerContainer.style.display = 'flex';
    headerContainer.style.justifyContent = 'space-between';
    headerContainer.style.alignItems = 'center';
    headerContainer.style.backgroundColor = '#fff';
    headerContainer.style.padding = '20px';
    headerContainer.style.border = '1px solid #ddd';
    headerContainer.style.borderRadius = '10px';
    headerContainer.style.marginBottom = '20px';
    headerContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';

    const pageTitle = document.createElement('h1');
    pageTitle.style.fontSize = '32px';
    pageTitle.textContent = pageTitleText;
    headerContainer.appendChild(pageTitle);

    const optionsContainer = document.createElement('div');
    optionsContainer.style.display = 'flex';
    optionsContainer.style.alignItems = 'center';

    const gridContainer = document.createElement('div');
    gridContainer.style.display = 'flex';
    gridContainer.style.flexWrap = 'wrap';
    gridContainer.style.gap = '15px';
    gridContainer.style.justifyContent = 'flex-start';

    return { headerContainer, optionsContainer, gridContainer };
}

function createDeletePopup(confirmationQuestion) {
    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '300px';
    popup.style.maxWidth = '90vw';
    
    const header = createHeader();
    
    const title = createTitle();
    title.textContent = 'Confirm Deletion';

    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const message = document.createElement('p');
    message.textContent = confirmationQuestion;
    message.style.marginBottom = '20px';
    message.style.textAlign = 'center';
    popup.appendChild(message);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.gap = '10px';

    const confirmButton = createActionButton('#D32F2F', '#B71C1C');
    confirmButton.textContent = 'Yes';

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = 'No';
    cancelButton.onclick = () => {
        document.body.removeChild(overlay);
    };

    buttonContainer.appendChild(confirmButton);
    buttonContainer.appendChild(cancelButton);
    popup.appendChild(buttonContainer);
    dragPopup(overlay, popup);

    return { overlay, popup, confirmButton, cancelButton, buttonContainer };
}

function createDeleteButton(titleText) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.style.background = 'none';
    deleteBtn.style.border = 'none';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.padding = '0';
    
    const deleteIcon = document.createElement('img');
    deleteIcon.className = 'icon';
    deleteIcon.src = 'assets/graphics/delete-icon.png';
    deleteIcon.title = titleText;
    deleteIcon.style.width = '20px';
    deleteIcon.style.height = '20px';
    deleteBtn.appendChild(deleteIcon);

    return deleteBtn    
}

function createEditButton(titleText) {
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.style.background = 'none';
    editBtn.style.border = 'none';
    editBtn.style.cursor = 'pointer';
    editBtn.style.padding = '0';
    
    const editIcon = document.createElement('img');
    editIcon.className = 'icon';
    editIcon.src = 'assets/graphics/edit-icon.png';
    editIcon.title = titleText;
    editIcon.style.width = '20px';
    editIcon.style.height = '20px';
    editBtn.appendChild(editIcon);
                        
    return editBtn
}

async function deleteFromDB(url) {
    try {
    const response = await fetch(
      url, 
      {
        method: 'DELETE'
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to delete');
    }
  } catch (error) {
    console.error('Database delete error:', error);
    throw error;
  }
}

function configPage(pageTitle, backButtonText, backToPage, addButtonText) {
    const content = document.getElementById('content');
    if (!content) {
        console.error('Content element not found');
        return;
    }
    content.innerHTML = '';

    const headerContainer = document.createElement('div');
    headerContainer.style.display = 'flex';
    headerContainer.style.justifyContent = 'space-between';
    headerContainer.style.alignItems = 'center';
    headerContainer.style.marginBottom = '20px';
    headerContainer.style.width = '100%';

    const heading = document.createElement('h1');
    heading.textContent = pageTitle;
    headerContainer.appendChild(heading);

    const backButton = createActionButton();
    backButton.textContent = backButtonText;
    backButton.addEventListener('click', () => {
        window.location.href = backToPage;
    });

    headerContainer.appendChild(backButton);
    content.appendChild(headerContainer);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.marginBottom = '20px';

    const addButton = createActionButton();
    addButton.textContent = addButtonText;
    
    buttonContainer.appendChild(addButton);
    content.appendChild(buttonContainer);

    return { content, addButton };
}

function createIconFromImage(imagePath, titleText, height, width = null) {
    const icon = document.createElement('img');
    icon.src = imagePath;
    icon.style.height = height;
    icon.style.width = width || 'auto';
    if (titleText) {
        icon.alt = titleText;
        icon.title = titleText;
    }

    return icon;
}