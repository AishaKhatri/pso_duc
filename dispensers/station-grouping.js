// station-grouping.js

// Store all dispensers for filtering
let allGroupedDispensers = {};
let allStationsData = [];

// Shared filter state — module-scope so newly-rendered station sections (added
// during the long render loop) can pick up filters the user has already
// applied while the render is still in flight. Exposed on window so the
// dispensers-page Alarms panel can apply the same filter to its mismatch list.
const _filterState = {
    city: 'all',
    station: 'all',
    connection: 'all',
    address: '',
    product: 'all'
};
if (typeof window !== 'undefined') window._filterState = _filterState;

function _applyFilterToSection(stationSection) {
    if (!stationSection) return false;
    const stationCode = stationSection.getAttribute('data-station-code');
    const stationCity = stationSection.getAttribute('data-city');
    const cityMatch = _filterState.city === 'all' || stationCity === _filterState.city;
    const stationMatch = _filterState.station === 'all' || stationCode === _filterState.station;

    if (!cityMatch || !stationMatch) {
        stationSection.style.display = 'none';
        return false;
    }

    const addrQuery = _filterState.address.trim().toLowerCase();
    const productFilter = _filterState.product;

    let anyCardVisible = false;
    stationSection.querySelectorAll('.app-dispenser-card').forEach(card => {
        const connStatus = card.dataset.connStatus || '';
        const connMatch = _filterState.connection === 'all' || connStatus === _filterState.connection;
        const cardAddress = (card.dataset.address || '').toLowerCase();
        const addrMatch = !addrQuery || cardAddress.includes(addrQuery);
        let productMatch = true;
        if (productFilter !== 'all') {
            const nozzles = card._dispenserNozzles || [];
            productMatch = nozzles.some(n => String(n.product || '').toUpperCase() === productFilter);
        }
        const visible = connMatch && addrMatch && productMatch;
        card.style.display = visible ? '' : 'none';
        if (visible) anyCardVisible = true;
    });
    stationSection.style.display = anyCardVisible ? 'block' : 'none';
    return anyCardVisible;
}

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

// Get unique cities from stations
async function getUniqueCities() {
    try {
        const response = await fetch(`${API_BASE_URL}/stations`);
        if (!response.ok) throw new Error('Failed to fetch stations');
        allStationsData = await response.json();
        const cities = [...new Set(allStationsData.map(s => s.city).filter(c => c))];
        return cities.sort();
    } catch (error) {
        console.error('Error fetching cities:', error);
        return [];
    }
}

// Get city for a station
function getStationCity(customerCode) {
    const station = allStationsData.find(s => s.customer_code === customerCode);
    return station ? station.city : '';
}

// Get station_id (the human-readable station name) for a customer_code
function getStationId(customerCode) {
    const station = allStationsData.find(s => s.customer_code === customerCode);
    return station ? (station.station_id || '') : '';
}

// Helper: build a "pick from a list" dropdown on top of the shared
// createSearchableDropdown primitive. Each item is { value, label }; the
// caller's state is updated via setSelected, and onPick fires afterwards.
//
// The "all" sentinel value is rendered as an empty input (placeholder shown)
// rather than pre-filling the label text — matches the stations-page UX where
// no typed text means no filter applied.
function buildPickerDropdown({ placeholder, width, options, getSelected, setSelected, onPick }) {
    const labelFor = (val) => {
        if (val === 'all') return '';
        const found = options.find(o => o.value === val);
        return found ? found.label : '';
    };

    const dd = createSearchableDropdown({
        placeholder,
        width,
        bgWhite: true,
        items: options,
        initialQuery: labelFor(getSelected()),
        onSelect: (value) => {
            setSelected(value);
            // Picking the "All …" sentinel resets the typed text so the placeholder shows again.
            if (value === 'all') dd.setQuery('');
            if (typeof onPick === 'function') onPick(value);
        }
    });

    return {
        wrap: dd.wrap,
        setValue: (v) => dd.setQuery(labelFor(v)),
        setItems: (newOptions) => {
            options = newOptions;
            dd.setItems(newOptions);
        }
    };
}

// Create filter container with city, station, and connection filters
async function createFilterContainer(stations, onFilterChange, actionsContainer = null) {
    // Shared module-scope state, so newly-added station sections during the
    // render loop can apply the current filter selection.
    const state = _filterState;

    // All three search bars share the same width.
    const FILTER_WIDTH = '210px';
    const FILTER_WIDTH_SMALL = '185px';

    const filterContainer = document.createElement('div');
    filterContainer.style.display = 'flex';
    filterContainer.style.alignItems = 'center';
    filterContainer.style.justifyContent = 'space-between';
    filterContainer.style.gap = '12px';
    filterContainer.style.marginBottom = '0px';
    filterContainer.style.backgroundColor = 'none';
    filterContainer.style.color = 'var(--text-primary)';
    filterContainer.style.borderRadius = '8px';
    filterContainer.style.width = '100%';
    filterContainer.style.flexWrap = 'wrap';

    const filtersLeft = document.createElement('div');
    filtersLeft.style.display = 'flex';
    filtersLeft.style.alignItems = 'center';
    filtersLeft.style.gap = '10px';
    filtersLeft.style.flexWrap = 'wrap';
    filtersLeft.style.flex = '1 1 auto';

    // --- Build option lists ---
    const cities = await getUniqueCities();
    const cityOptions = [
        { value: 'all', label: 'All Cities' },
        ...cities.map(c => ({
            value: c,
            label: c.charAt(0).toUpperCase() + c.slice(1).toLowerCase()
        }))
    ];

    const allStationCodes = Object.keys(stations).sort();
    const buildStationOptions = (forCity) => {
        const codes = forCity === 'all'
            ? allStationCodes
            : allStationCodes.filter(code => getStationCity(code) === forCity);
        return [
            { value: 'all', label: 'All Stations' },
            ...codes.map(code => ({
                value: code,
                label: code,
                secondary: getStationId(code)
            }))
        ];
    };

    const connectionOptions = [
        { value: 'all', label: 'All Connections' },
        { value: '1',   label: 'Connected' },
        { value: '0',   label: 'Disconnected' }
    ];

    // --- Build controls ---
    const cityCtl = buildPickerDropdown({
        placeholder: 'Search by City',
        width: FILTER_WIDTH,
        options: cityOptions,
        getSelected: () => state.city,
        setSelected: (v) => { state.city = v; },
        onPick: (v) => {
            // Rebuild station options scoped to the new city, reset station selection.
            state.station = 'all';
            stationCtl.setItems(buildStationOptions(v));
            stationCtl.setValue('all');
            emitChange();
        }
    });

    const stationCtl = buildPickerDropdown({
        placeholder: 'Search by Station',
        width: FILTER_WIDTH,
        options: buildStationOptions('all'),
        getSelected: () => state.station,
        setSelected: (v) => { state.station = v; },
        onPick: () => emitChange()
    });

    const connectionCtl = buildPickerDropdown({
        placeholder: 'Search by Connectivity',
        width: FILTER_WIDTH,
        options: connectionOptions,
        getSelected: () => state.connection,
        setSelected: (v) => { state.connection = v; },
        onPick: () => emitChange()
    });

    const productOptions = [
        { value: 'all', label: 'All Products' },
        ...PRODUCT_OPTIONS.map(p => ({ value: p, label: p }))
    ];

    const productCtl = buildPickerDropdown({
        placeholder: 'Search by Product',
        width: FILTER_WIDTH_SMALL,
        options: productOptions,
        getSelected: () => state.product,
        setSelected: (v) => { state.product = v; },
        onPick: () => emitChange()
    });

    // Address — free-text substring search with autocomplete suggestions
    // pulled from the unique D-addresses across all stations on this page.
    const addressOptions = (() => {
        const seen = new Set();
        const out = [];
        for (const code of allStationCodes) {
            for (const d of (stations[code]?.dispensers || [])) {
                const addr = d.address ? ensureDAddress(d.address) : '';
                if (addr && !seen.has(addr)) {
                    seen.add(addr);
                    out.push({ value: addr, label: addr });
                }
            }
        }
        return out.sort((a, b) => a.label.localeCompare(b.label));
    })();

    const addressCtl = createSearchableDropdown({
        placeholder: 'Search by Address',
        width: FILTER_WIDTH_SMALL,
        bgWhite: true,
        items: addressOptions,
        initialQuery: state.address,
        emptyText: 'No matching address',
        onInput: (q) => { state.address = q; emitChange(); },
        onSelect: (v) => { state.address = v; emitChange(); }
    });

    function emitChange() {
        if (typeof onFilterChange === 'function') {
            onFilterChange(state.station, state.city, state.connection);
        }
    }

    filtersLeft.appendChild(cityCtl.wrap);
    filtersLeft.appendChild(stationCtl.wrap);
    filtersLeft.appendChild(connectionCtl.wrap);
    filtersLeft.appendChild(productCtl.wrap);
    filtersLeft.appendChild(addressCtl.wrap);

    filterContainer.appendChild(filtersLeft);

    if (actionsContainer) {
        actionsContainer.style.marginLeft = 'auto';
        filterContainer.appendChild(actionsContainer);
    }

    return filterContainer;
}

// Create a station container with header
function createStationContainer(stationCode, dispenserCount, stationInfo = {}) {
    const stationSection = document.createElement('div');
    stationSection.className = 'station-section';
    stationSection.setAttribute('data-station-code', stationCode);
    stationSection.setAttribute('data-city', stationInfo.city || '');
    stationSection.style.marginBottom = '5px';
    stationSection.style.backgroundColor = 'var(--bg-surface-1)';
    stationSection.style.color = 'var(--text-primary)';
    stationSection.style.borderRadius = '10px';
    stationSection.style.padding = '8px';
    stationSection.style.border = '3px solid var(--border)';
    stationSection.style.boxShadow = 'var(--shadow-card)';
    stationSection.style.overflowX = 'hidden';
    
    // Station header
    const stationHeader = document.createElement('div');
    stationHeader.style.display = 'flex';
    stationHeader.style.justifyContent = 'space-between';
    stationHeader.style.alignItems = 'center';
    stationHeader.style.marginBottom = '5px';
    stationHeader.style.paddingBottom = '10px';
    stationHeader.style.borderBottom = `2px solid var(--accent)`;
    stationHeader.style.cursor = 'pointer';
    stationHeader.style.padding = '6px 10px 10px';
    stationHeader.style.transition = 'background-color 0.15s ease';
    stationHeader.title = `Open dispenser page for station ${stationCode}`;
    stationHeader.addEventListener('mouseenter', () => {
        stationHeader.style.backgroundColor = 'var(--bg-surface-2)';
    });
    stationHeader.addEventListener('mouseleave', () => {
        stationHeader.style.backgroundColor = '';
    });
    stationHeader.addEventListener('click', () => {
        window.location.href = `dispensers.html?customer_code=${encodeURIComponent(stationCode)}&back=dispensers.html`;
    });
    
    // Left side - Station title
    const stationTitle = document.createElement('h3');
    stationTitle.textContent = `${stationCode} - ${stationInfo.station_id}`;
    stationTitle.style.margin = '0';
    stationTitle.style.color = 'var(--text-primary)';
    stationTitle.style.fontSize = '22px';
    stationTitle.style.fontWeight = '650';
    
    // Center - Location info with icon
    const locationContainer = document.createElement('div');
    locationContainer.style.display = 'flex';
    locationContainer.style.alignItems = 'center';
    locationContainer.style.justifyContent = 'center';
    locationContainer.style.gap = '6px';
    locationContainer.style.flex = '1';
    
    const locationIcon = createIconFromImage('assets/graphics/location-icon.png', 'Location', '20px');
    
    const locationText = document.createElement('span');
    const cityName = titleCase(stationInfo.city || '');

    let locationString = '';
    if (cityName && stationInfo.division) {
        locationString = `${cityName}, ${stationInfo.division}`;
    } else if (cityName) {
        locationString = cityName; 
    } else {
        locationString = 'Location not available';
    }
    locationText.textContent = locationString;
    locationText.style.fontSize = '18px';
    locationText.style.fontWeight = '500';
    
    locationContainer.appendChild(locationIcon);
    locationContainer.appendChild(locationText);
    
    // Right side - Dispenser count
    const dispenserCountSpan = document.createElement('span');
    dispenserCountSpan.textContent = `${dispenserCount} Dispenser${dispenserCount !== 1 ? 's' : ''}`;
    dispenserCountSpan.style.backgroundColor = 'var(--bg-surface-2)';
    dispenserCountSpan.style.padding = '6px 16px';
    dispenserCountSpan.style.borderRadius = '20px';
    dispenserCountSpan.style.fontSize = '18px';
    dispenserCountSpan.style.fontWeight = '600';
    dispenserCountSpan.style.color = 'var(--text-secondary)';
    
    stationHeader.appendChild(stationTitle);
    stationHeader.appendChild(locationContainer);
    stationHeader.appendChild(dispenserCountSpan);
    
    // Wrapper for scrollable content
    const scrollWrapper = document.createElement('div');
    scrollWrapper.style.position = 'relative';
    scrollWrapper.style.display = 'flex';
    scrollWrapper.style.alignItems = 'center';
    scrollWrapper.style.gap = '10px';
    scrollWrapper.style.width = '100%';
    
    // Horizontal scroll container for dispensers
    const scrollContainer = document.createElement('div');
    scrollContainer.style.overflowX = 'auto';
    scrollContainer.style.overflowY = 'hidden';
    scrollContainer.style.whiteSpace = 'nowrap';
    scrollContainer.style.padding = '10px 0';
    scrollContainer.style.scrollBehavior = 'smooth';
    scrollContainer.style.flex = '1';
    scrollContainer.style.minWidth = '0';
    scrollContainer.style.scrollbarWidth = 'thin';
    
    // Simple flat scroll buttons — same understated look as the alarms panel's
    // collapse/expand toggle. Shown only when the strip overflows.
    const makeScrollBtn = (glyph, delta) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.innerHTML = glyph;
        Object.assign(btn.style, {
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '24px',
            lineHeight: '1',
            color: 'var(--text-secondary)',
            padding: '4px 6px',
            borderRadius: '3px',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: '0'
        });
        btn.addEventListener('mouseover', () => { btn.style.background = 'var(--bg-surface-2, transparent)'; });
        btn.addEventListener('mouseout', () => { btn.style.background = 'transparent'; });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            scrollContainer.scrollBy({ left: delta, behavior: 'smooth' });
        });
        return btn;
    };

    const leftScrollBtn = makeScrollBtn('‹', -300);
    const rightScrollBtn = makeScrollBtn('›', 300);
    
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
    
    // Function to check overflow and show/hide buttons
    const checkOverflow = () => {
        requestAnimationFrame(() => {
            if (scrollContainer && scrollContainer.parentElement) {
                const isOverflowing = scrollContainer.scrollWidth > scrollContainer.clientWidth;
                leftScrollBtn.style.display = isOverflowing ? 'flex' : 'none';
                rightScrollBtn.style.display = isOverflowing ? 'flex' : 'none';
            }
        });
    };
    
    // Use MutationObserver to watch for content changes
    const observer = new MutationObserver(() => {
        checkOverflow();
    });
    
    observer.observe(stationGrid, {
        childList: true,
        subtree: true,
        attributes: true
    });
    
    // Also observe the scrollContainer for size changes
    const resizeObserver = new ResizeObserver(() => {
        checkOverflow();
    });
    resizeObserver.observe(scrollContainer);
    
    // Initial check with delays to ensure all content is loaded
    setTimeout(checkOverflow, 100);
    setTimeout(checkOverflow, 300);
    setTimeout(checkOverflow, 500);
    setTimeout(checkOverflow, 1000);
    
    // Check on window resize
    window.addEventListener('resize', () => {
        setTimeout(checkOverflow, 100);
    });
    
    // Also check when scrollContainer is scrolled
    scrollContainer.addEventListener('scroll', () => {
        requestAnimationFrame(() => {
            const atStart = scrollContainer.scrollLeft <= 10;
            const atEnd = scrollContainer.scrollLeft + scrollContainer.clientWidth >= scrollContainer.scrollWidth - 10;
            leftScrollBtn.style.opacity = atStart ? '0.5' : '1';
            rightScrollBtn.style.opacity = atEnd ? '0.5' : '1';
        });
    });
    
    // Store cleanup function
    stationSection._cleanup = () => {
        observer.disconnect();
        resizeObserver.disconnect();
    };
    
    return { stationSection, stationGrid, scrollContainer, checkOverflow };
}

// Render all stations with their dispensers
async function renderStationWiseDispensers(dispensers, gridContainer, createCardFunction, additionalParams = {}, actionsContainer = null) {
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
    
    // Create filter container with city, station, and connection filters
    let filterContainer = null;
    // Empty-state message shown when filters hide every card.
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'no-data-message';
    emptyMsg.style.padding = '40px';
    emptyMsg.style.width = '100%';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.color = 'var(--text-secondary)';
    emptyMsg.textContent = 'No dispensers match the selected filters';
    emptyMsg.style.display = 'none';

    if (sortedStations.length > 0) {
        const applyFilters = () => {
            let anyStationVisible = false;
            for (const stationSection of Object.values(window.stationSections)) {
                if (_applyFilterToSection(stationSection)) anyStationVisible = true;
            }
            emptyMsg.style.display = anyStationVisible ? 'none' : 'block';
            // Tell the alarms panel its current scan is stale — different
            // filter selection means the user needs to re-run Check Prices.
            window.dispatchEvent(new CustomEvent('dispenser-filters-changed'));
        };
        filterContainer = await createFilterContainer(groupedDispensers, applyFilters, actionsContainer);
        gridContainer.appendChild(filterContainer);
        gridContainer.appendChild(emptyMsg);
    }
    
    // Build the station-info map. If dispensers already carry a `.station` field
    // (from /api/dispensers-full), use that — no extra fetches needed. Otherwise
    // fall back to fetching /stations/{code} in parallel for backward compat.
    const stationInfoMap = new Map();
    const stationsNeedingFetch = [];
    for (const stationCode of sortedStations) {
        const sampleDisp = groupedDispensers[stationCode]?.dispensers?.[0];
        if (sampleDisp && sampleDisp.station) {
            stationInfoMap.set(stationCode, {
                city: sampleDisp.station.city || '',
                station_id: sampleDisp.station.station_id || '',
                division: sampleDisp.station.division || ''
            });
        } else {
            stationsNeedingFetch.push(stationCode);
        }
    }
    if (stationsNeedingFetch.length > 0) {
        await Promise.all(stationsNeedingFetch.map(async (stationCode) => {
            try {
                const stationResponse = await fetch(`${API_BASE_URL}/stations/${stationCode}`);
                if (!stationResponse.ok) return;
                const stationData = await stationResponse.json();
                stationInfoMap.set(stationCode, {
                    city: stationData.station?.city || '',
                    station_id: stationData.station?.station_id || '',
                    division: stationData.station?.division || ''
                });
            } catch (error) {
                console.error('Error fetching station info:', error);
            }
        }));
    }

    for (const stationCode of sortedStations) {
        const stationData = groupedDispensers[stationCode];
        const stationInfo = stationInfoMap.get(stationCode) || {};

        const { stationSection, stationGrid, scrollContainer, checkOverflow } = createStationContainer(
            stationCode,
            stationData.dispensers.length,
            stationInfo
        );

        // Store grid reference for updates
        window.stationGrids[stationCode] = stationGrid;
        window.stationCheckOverflow[stationCode] = checkOverflow;
        window.stationSections[stationCode] = stationSection;

        gridContainer.appendChild(stationSection);

        // Create cards for each dispenser in this station
        for (const dispenser of stationData.dispensers) {
            await createCardFunction(dispenser, stationGrid, additionalParams);
        }
    }

    // Whole grid is built — apply current filter once so a deep-linked /
    // pre-selected filter takes effect before the page is revealed by the caller.
    for (const stationSection of Object.values(window.stationSections)) {
        _applyFilterToSection(stationSection);
    }
    emptyMsg.style.display = Object.values(window.stationSections)
        .some(s => s.style.display !== 'none') ? 'none' : 'block';

    return { filterContainer };
}

// Update a specific dispenser card within its station
async function updateStationDispenserCard(dispenser, updateCardFunction) {
    const card = document.getElementById(`dispenser-${ensureDAddress(dispenser.address)}`);
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
window.createFilterContainer = createFilterContainer;
window.createStationContainer = createStationContainer;
window.renderStationWiseDispensers = renderStationWiseDispensers;
window.updateStationDispenserCard = updateStationDispenserCard;
window.refreshAllDispensers = refreshAllDispensers;
window.getDispensersByStation = getDispensersByStation;