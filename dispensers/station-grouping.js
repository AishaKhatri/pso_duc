// station-grouping.js

// Store all dispensers for filtering
let allGroupedDispensers = {};

// Group dispensers by station
function groupDispensersByStation(dispensers) {
    const grouped = {};
    
    dispensers.forEach(dispenser => {
        const stationKey = dispenser.customer_code;
        if (!grouped[stationKey]) {
            grouped[stationKey] = {
                customer_code: dispenser.customer_code,
                dispensers: []
            };
        }
        grouped[stationKey].dispensers.push(dispenser);
    });
    
    return grouped;
}

// Create station filter dropdown
function createStationFilterDropdown(stations, onFilterChange) {
    const filterContainer = document.createElement('div');
    filterContainer.style.display = 'flex';
    filterContainer.style.alignItems = 'center';
    filterContainer.style.justifyContent = 'flex-end';
    filterContainer.style.gap = '15px';
    filterContainer.style.marginBottom = '0px';
    filterContainer.style.padding = '10px 15px';
    filterContainer.style.backgroundColor = '#f8f9fa';
    filterContainer.style.borderRadius = '8px';
    filterContainer.style.border = '1px solid #e0e0e0';
    filterContainer.style.width = '100%';
    
    const filterLabel = document.createElement('label');
    filterLabel.textContent = 'Filter by Station:';
    filterLabel.style.fontWeight = 'bold';
    filterLabel.style.color = '#333';
    filterLabel.style.fontSize = '14px';
    
    const filterDropdown = createDropdown('All Stations');
    filterDropdown.id = 'station-filter-dropdown';
    filterDropdown.style.width = '250px';
    filterDropdown.style.marginBottom = '0';
    
    // Add "All Stations" option
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Stations';
    filterDropdown.appendChild(allOption);
    
    // Add each station option
    const sortedStations = Object.keys(stations).sort();
    sortedStations.forEach(stationCode => {
        const option = document.createElement('option');
        option.value = stationCode;
        option.textContent = `${stationCode} (${stations[stationCode].dispensers.length} dispensers)`;
        filterDropdown.appendChild(option);
    });
    
    filterDropdown.addEventListener('change', (e) => {
        const selectedStation = e.target.value;
        if (typeof onFilterChange === 'function') {
            onFilterChange(selectedStation);
        }
    });
    
    filterContainer.appendChild(filterLabel);
    filterContainer.appendChild(filterDropdown);
    
    return filterContainer;
}

// Create a station container with header
function createStationContainer(stationCode, dispenserCount) {
    const stationSection = document.createElement('div');
    stationSection.className = 'station-section';
    stationSection.setAttribute('data-station-code', stationCode);
    stationSection.style.marginBottom = '5px';
    stationSection.style.backgroundColor = '#fff';
    stationSection.style.borderRadius = '10px';
    stationSection.style.padding = '15px';
    stationSection.style.border = '1px solid #ddd';
    stationSection.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
    
    // Station header
    const stationHeader = document.createElement('div');
    stationHeader.style.display = 'flex';
    stationHeader.style.justifyContent = 'space-between';
    stationHeader.style.alignItems = 'center';
    stationHeader.style.marginBottom = '5px';
    stationHeader.style.paddingBottom = '10px';
    stationHeader.style.borderBottom = `2px solid #2E7D32`;
    
    const stationTitle = document.createElement('h3');
    stationTitle.textContent = `Station: ${stationCode}`;
    stationTitle.style.margin = '0';
    stationTitle.style.color = '#2E7D32';
    stationTitle.style.fontSize = '22px';
    stationTitle.style.fontWeight = '650';
    
    const dispenserCountSpan = document.createElement('span');
    dispenserCountSpan.textContent = `${dispenserCount} Dispenser${dispenserCount !== 1 ? 's' : ''}`;
    dispenserCountSpan.style.backgroundColor = '#e9ecef';
    dispenserCountSpan.style.padding = '4px 12px';
    dispenserCountSpan.style.borderRadius = '20px';
    dispenserCountSpan.style.fontSize = '14px';
    dispenserCountSpan.style.color = '#495057';
    
    stationHeader.appendChild(stationTitle);
    stationHeader.appendChild(dispenserCountSpan);
    
    // Horizontal scroll container for dispensers
    const scrollContainer = document.createElement('div');
    scrollContainer.style.overflowX = 'auto';
    scrollContainer.style.overflowY = 'hidden';
    scrollContainer.style.whiteSpace = 'nowrap';
    scrollContainer.style.padding = '10px 0';
    scrollContainer.style.scrollBehavior = 'smooth';
    
    // Add scroll buttons container
    const scrollWrapper = document.createElement('div');
    scrollWrapper.style.position = 'relative';
    scrollWrapper.style.display = 'flex';
    scrollWrapper.style.alignItems = 'center';
    scrollWrapper.style.gap = '10px';
    
    // Left scroll button
    const leftScrollBtn = document.createElement('button');
    leftScrollBtn.innerHTML = '‹';
    leftScrollBtn.style.width = '40px';
    leftScrollBtn.style.height = '40px';
    leftScrollBtn.style.borderRadius = '50%';
    leftScrollBtn.style.border = `1px solid #2E7D32`;
    leftScrollBtn.style.backgroundColor = '#fff';
    leftScrollBtn.style.color = '#2E7D32';
    leftScrollBtn.style.fontSize = '28px';
    leftScrollBtn.style.fontWeight = 'bold';
    leftScrollBtn.style.cursor = 'pointer';
    leftScrollBtn.style.display = 'flex';
    leftScrollBtn.style.alignItems = 'center';
    leftScrollBtn.style.justifyContent = 'center';
    leftScrollBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    leftScrollBtn.style.transition = 'all 0.2s ease';
    leftScrollBtn.style.flexShrink = '0';
    
    leftScrollBtn.addEventListener('mouseenter', () => {
        leftScrollBtn.style.backgroundColor = '#2E7D32';
        leftScrollBtn.style.color = '#fff';
    });
    leftScrollBtn.addEventListener('mouseleave', () => {
        leftScrollBtn.style.backgroundColor = '#fff';
        leftScrollBtn.style.color = '#2E7D32';
    });
    leftScrollBtn.addEventListener('click', () => {
        scrollContainer.scrollBy({ left: -300, behavior: 'smooth' });
    });
    
    // Right scroll button
    const rightScrollBtn = document.createElement('button');
    rightScrollBtn.innerHTML = '›';
    rightScrollBtn.style.width = '40px';
    rightScrollBtn.style.height = '40px';
    rightScrollBtn.style.borderRadius = '50%';
    rightScrollBtn.style.border = `1px solid #2E7D32`;
    rightScrollBtn.style.backgroundColor = '#fff';
    rightScrollBtn.style.color = '#2E7D32';
    rightScrollBtn.style.fontSize = '28px';
    rightScrollBtn.style.fontWeight = 'bold';
    rightScrollBtn.style.cursor = 'pointer';
    rightScrollBtn.style.display = 'flex';
    rightScrollBtn.style.alignItems = 'center';
    rightScrollBtn.style.justifyContent = 'center';
    rightScrollBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    rightScrollBtn.style.transition = 'all 0.2s ease';
    rightScrollBtn.style.flexShrink = '0';
    
    rightScrollBtn.addEventListener('mouseenter', () => {
        rightScrollBtn.style.backgroundColor = '#2E7D32';
        rightScrollBtn.style.color = '#fff';
    });
    rightScrollBtn.addEventListener('mouseleave', () => {
        rightScrollBtn.style.backgroundColor = '#fff';
        rightScrollBtn.style.color = '#2E7D32';
    });
    rightScrollBtn.addEventListener('click', () => {
        scrollContainer.scrollBy({ left: 300, behavior: 'smooth' });
    });
    
    // Grid container for dispensers in this station (horizontal layout)
    const stationGrid = document.createElement('div');
    stationGrid.style.display = 'inline-flex';
    stationGrid.style.gap = '20px';
    stationGrid.style.padding = '5px';
    stationGrid.style.whiteSpace = 'normal';
    
    scrollContainer.appendChild(stationGrid);
    scrollWrapper.appendChild(leftScrollBtn);
    scrollWrapper.appendChild(scrollContainer);
    scrollWrapper.appendChild(rightScrollBtn);
    
    stationSection.appendChild(stationHeader);
    stationSection.appendChild(scrollWrapper);
    
    // Hide scroll buttons if content doesn't overflow
    const checkOverflow = () => {
        const isOverflowing = scrollContainer.scrollWidth > scrollContainer.clientWidth;
        leftScrollBtn.style.display = isOverflowing ? 'flex' : 'none';
        rightScrollBtn.style.display = isOverflowing ? 'flex' : 'none';
    };
    
    // Check overflow after content is added
    setTimeout(checkOverflow, 100);
    
    // Also check on window resize
    window.addEventListener('resize', checkOverflow);
    
    return { stationSection, stationGrid, scrollContainer, checkOverflow };
}

// Render all stations with their dispensers
async function renderStationWiseDispensers(dispensers, gridContainer, createCardFunction, additionalParams = {}) {
    if (!dispensers || dispensers.length === 0) {
        const message = createNoDataMessage('No dispensers configured');
        message.style.padding = '40px';
        message.style.width = '100%';
        gridContainer.appendChild(message);
        return { filterContainer: null };
    }
    
    // Group dispensers by station
    const groupedDispensers = groupDispensersByStation(dispensers);
    allGroupedDispensers = groupedDispensers;
    
    // Sort stations by customer_code
    const sortedStations = Object.keys(groupedDispensers).sort();
    
    // Store references to station grids for updates
    window.stationGrids = window.stationGrids || {};
    window.stationCheckOverflow = window.stationCheckOverflow || {};
    window.stationSections = window.stationSections || {};
    
    // Create filter dropdown
    let filterContainer = null;
    if (sortedStations.length > 1) {
        filterContainer = createStationFilterDropdown(groupedDispensers, (selectedStation) => {
            // Show/hide station sections based on filter
            for (const [stationCode, stationSection] of Object.entries(window.stationSections)) {
                if (selectedStation === 'all' || stationCode === selectedStation) {
                    stationSection.style.display = 'block';
                } else {
                    stationSection.style.display = 'none';
                }
            }
        });
        gridContainer.appendChild(filterContainer);
    }
    
    for (const stationCode of sortedStations) {
        const stationData = groupedDispensers[stationCode];
        const { stationSection, stationGrid, scrollContainer, checkOverflow } = createStationContainer(stationCode, stationData.dispensers.length);
        
        // Store grid reference for updates
        window.stationGrids[stationCode] = stationGrid;
        window.stationCheckOverflow[stationCode] = checkOverflow;
        window.stationSections[stationCode] = stationSection;
        
        // Create cards for each dispenser in this station
        for (const dispenser of stationData.dispensers) {
            await createCardFunction(dispenser, stationGrid, additionalParams);
        }
        
        gridContainer.appendChild(stationSection);
    }
    
    return { filterContainer };
}

// Update a specific dispenser card within its station
async function updateStationDispenserCard(dispenser, updateCardFunction) {
    const card = document.getElementById(`dispenser-${dispenser.dispenser_id}`);
    if (card && typeof updateCardFunction === 'function') {
        await updateCardFunction(dispenser);
    }
}

// Re-render all dispensers maintaining station grouping
async function refreshAllDispensers(gridContainer, createCardFunction, updateCardFunction, additionalParams = {}) {
    try {
        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();
        
        // Clear the grid container
        gridContainer.innerHTML = '';
        
        // Re-render with station grouping
        await renderStationWiseDispensers(dispensers, gridContainer, createCardFunction, additionalParams);
        
        // Store dispensers for periodic updates
        window.currentDispensers = dispensers;
        
        return dispensers;
    } catch (error) {
        console.error('Error refreshing dispensers:', error);
        throw error;
    }
}

// Get all dispensers grouped by station (for use in periodic updates)
function getDispensersByStation() {
    if (!window.currentDispensers) return {};
    return groupDispensersByStation(window.currentDispensers);
}

// Make functions globally available
window.groupDispensersByStation = groupDispensersByStation;
window.createStationFilterDropdown = createStationFilterDropdown;
window.createStationContainer = createStationContainer;
window.renderStationWiseDispensers = renderStationWiseDispensers;
window.updateStationDispenserCard = updateStationDispenserCard;
window.refreshAllDispensers = refreshAllDispensers;
window.getDispensersByStation = getDispensersByStation;