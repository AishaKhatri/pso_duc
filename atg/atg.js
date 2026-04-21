const fuelConfig = {
    'PMG': { header: '#FF7043', accent: '#FFCCBC' },
    'HSD': { header: '#2196F3', accent: '#BBDEFB' },
    'pmg': { header: '#FF7043', accent: '#FFCCBC' }, // lowercase
    'hsd': { header: '#2196F3', accent: '#BBDEFB' }  // lowercase
};

let atgRefreshInterval;
let tanks = []; // This will now be populated from the database

async function renderATG() {
    const content = document.getElementById('content');
    content.innerHTML = ''; // Clear existing content

    const { headerContainer, optionsContainer, gridContainer } = renderPageHeader('Automatic Tank Guaging - ATG')    

    const configButton = createMainButton();
    configButton.textContent = 'Configure Tanks';
    configButton.addEventListener('click', () => {
        window.location.href = 'atg/config-tanks.html';
    });

    optionsContainer.appendChild(configButton);
    headerContainer.appendChild(optionsContainer)
    content.appendChild(headerContainer);

    gridContainer.id = 'atg-grid';

    content.appendChild(gridContainer);

    // Initialize connection status listener
    initializeATGConnectionListener();
    
    await refreshATGData(gridContainer);

    // Start auto-refresh (every 30 seconds)
    startATGRefresh(30000);
}


// Update the connection listener to handle all ATG addresses dynamically
function initializeATGConnectionListener() {
    if (window.notificationHandler && window.notificationHandler.handleSystemNotification) {
        const originalHandleSystemNotification = window.notificationHandler.handleSystemNotification.bind(window.notificationHandler);
        
        window.notificationHandler.handleSystemNotification = async function(notification) {
            console.log('ATG - Received system notification:', notification);
            
            // Check if this is an ATG connection notification for any ATG device
            if (notification.title === 'Connectivity Status' && 
                notification.message && 
                notification.message.includes('ATG')) {
                
                // Extract ATG address from notification message
                const match = notification.message.match(/ATG(\d+)/);
                if (match) {
                    const atgAddress = match[1];
                    
                    // Use notification type to determine connection status
                    const isConnected = notification.notificationType === 'success';
                    const isDisconnected = notification.notificationType === 'error';
                    
                    if (isConnected || isDisconnected) {
                        
                        const connectedAt = isConnected ? new Date().toISOString() : null;
                        
                        // Update the tank's connection status if we have it in our array
                        const tankIndex = tanks.findIndex(t => t.address === atgAddress);
                        if (tankIndex !== -1) {
                            tanks[tankIndex].conn_status = isConnected ? 1 : 0;
                            tanks[tankIndex].connected_at = connectedAt;
                        }
                        
                        // Update UI if needed
                        updateConnStatus(atgAddress, isConnected ? 1 : 0, connectedAt, 'atg');
                    }
                }
            }
            
            return originalHandleSystemNotification(notification);
        };
    }
}

async function refreshATGData(gridContainer) {
    try {
        const response = await fetch(`${API_BASE_URL}/tanks/atg-data`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const tanksData = await response.json();
        
        // Clear existing cards
        gridContainer.innerHTML = '';
        
        // Show message if no tanks
        if (!tanksData || tanksData.length === 0) {
            gridContainer.innerHTML = `
                <div style="text-align: center; padding: 40px; width: 100%;">
                    <h3>No Tanks Configured</h3>
                    <p>Click "Configure Tanks" to add your first tank.</p>
                </div>
            `;
            return;
        }
        
        // Update the global tanks array (optional, for other functions if needed)
        tanks = tanksData;
        
        // Create a card for each tank
        tanksData.forEach(tank => {
            // Prepare the tank data in the format expected by createTankCard
            const tankForCard = {
                id: tank.id,
                tankId: tank.tank_id,
                address: tank.address,
                product: tank.product,
                capacity: parseFloat(tank.max_capacity_ltr), // Default capacity or you could store this in DB
                // Use the new column names
                filled: parseFloat(tank.product_level_ltr) || 0,
                temperature: parseFloat(tank.temperature) || 0,
                waterLevel: parseFloat(tank.water_level_ltr) || 0,
                // ATG status mapping (0 = OK, other = Fault)
                status: (tank.status === 0 ? 'OK' : 'Fault'),
                last_updated: tank.last_updated,
                is_active: tank.is_active,
                conn_status: tank.conn_status,
                connected_at: tank.connected_at
            };
            
            createTankCard(tankForCard, gridContainer);

            // Update connection status with real data from cache
            updateConnStatus(tankForCard.address, tankForCard.conn_status, tankForCard.connected_at, 'atg');
        });
        
    } catch (error) {
        console.error('Error loading ATG data:', error);
        gridContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #D32F2F; width: 100%;">
                <h3>Error Loading ATG Data</h3>
                <p>${error.message}</p>
                <button onclick="renderATG()" style="margin-top: 20px; padding: 10px 20px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Retry
                </button>
            </div>
        `;
    }
}


// Optional: Function to update connection status in database
async function updateTankConnectionStatus(address, conn_status, connected_at) {
    try {
        // First, find the tank ID by address
        const tankResponse = await fetch(`${API_BASE_URL}/tanks/address/${address}/atg-data`);
        if (!tankResponse.ok) {
            console.error('Tank not found for address:', address);
            return;
        }
        
        const tank = await tankResponse.json();
        
        // Update connection status via PUT to tanks endpoint
        const updateResponse = await fetch(`${API_BASE_URL}/tanks/${tank.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                conn_status: conn_status,
                connected_at: connected_at
            })
        });
        
        if (!updateResponse.ok) {
            console.error('Failed to update tank connection status');
        }
    } catch (error) {
        console.error('Error updating tank connection status:', error);
    }
}

// Auto-refresh function for ATG data
function startATGRefresh(interval = 30000) { // Refresh every 30 seconds
    if (atgRefreshInterval) {
        clearInterval(atgRefreshInterval);
    }
    
    atgRefreshInterval = setInterval(async () => {
        console.log('Refreshing ATG data...');
        const gridContainer = document.getElementById('atg-grid');
        if (gridContainer) {
            await refreshATGData(gridContainer);
        }
    }, interval);
}

// Stop auto-refresh when needed
function stopATGRefresh() {
    if (atgRefreshInterval) {
        clearInterval(atgRefreshInterval);
        atgRefreshInterval = null;
    }
}

// Initialize when the page loads
window.addEventListener('load', () => {
    startATGRefresh();
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    stopATGRefresh();
});

window.renderATG = renderATG;
window.startATGRefresh = startATGRefresh;
window.stopATGRefresh = stopATGRefresh;