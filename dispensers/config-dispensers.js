// Global variable to store stations list
let stationsList = [];
const configFilters = {
    address: '',          // substring match (case-insensitive)
    city: 'all',          // 'all' or a city name from stationsList
    station: 'all',       // 'all' or a customer_code
    product: 'all'        // 'all' or one of PRODUCT_OPTIONS
};

// Label + control laid out as a two-column grid row, used throughout the
// dispenser configuration modal. `control` is any input/select element.
function createFormRow(labelText, control, labelWidth = '100px') {
    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 2fr';
    container.style.alignItems = 'center';

    const label = document.createElement('label');
    label.className = 'label-text';
    label.textContent = labelText;
    label.style.width = labelWidth;

    container.appendChild(label);
    container.appendChild(control);
    return container;
}

function getFilteredConfigDispensers() {
    const all = window.dispensers || [];
    const addr = configFilters.address.trim().toLowerCase();
    const cityFilter = configFilters.city;
    const stationFilter = configFilters.station;
    const productFilter = configFilters.product;

    const stationByCode = new Map(stationsList.map(s => [s.customer_code, s]));

    return all.filter(d => {
        if (addr && !String(d.address || '').toLowerCase().includes(addr)) return false;
        if (cityFilter !== 'all') {
            const dCity = stationByCode.get(d.customer_code)?.city || '';
            if (dCity !== cityFilter) return false;
        }
        if (stationFilter !== 'all' && d.customer_code !== stationFilter) return false;
        if (productFilter !== 'all') {
            const dProducts = (d.nozzles || []).map(n => (n.product || '').toUpperCase());
            if (!dProducts.includes(productFilter)) return false;
        }
        return true;
    });
}

// Build the row of filter controls (City, Station, Product, Address) — mirrors
// the main dispensers page so the two screens feel consistent.
function buildConfigFilters(onChange) {
    const FILTER_WIDTH = '220px';
    const fire = () => { if (typeof onChange === 'function') onChange(); };

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexWrap = 'wrap';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '10px';
    wrap.style.flex = '1 1 auto';

    // --- City ---
    const cityOptions = [
        { value: 'all', label: 'All Cities' },
        ...[...new Set(stationsList.map(s => s.city).filter(Boolean))]
            .sort()
            .map(c => ({ value: c, label: titleCase(c) }))
    ];

    // --- Station options are scoped to the currently selected city. ---
    const buildStationOptions = (forCity) => {
        const stationByCode = new Map(stationsList.map(s => [s.customer_code, s]));
        const unique = [...new Set((window.dispensers || []).map(d => d.customer_code).filter(Boolean))];
        const filtered = forCity === 'all'
            ? unique
            : unique.filter(code => stationByCode.get(code)?.city === forCity);
        return [
            { value: 'all', label: 'All Stations' },
            ...filtered.sort().map(code => ({
                value: code,
                label: code,
                secondary: stationByCode.get(code)?.station_id || ''
            }))
        ];
    };

    const labelFor = (options, val) => {
        if (val === 'all') return '';
        return options.find(o => o.value === val)?.label || '';
    };

    let stationCtl;

    const cityCtl = createSearchableDropdown({
        placeholder: 'Search by City',
        width: FILTER_WIDTH,
        bgWhite: true,
        items: cityOptions,
        initialQuery: labelFor(cityOptions, configFilters.city),
        onSelect: (value) => {
            configFilters.city = value;
            if (value === 'all') cityCtl.setQuery('');
            // City change resets the station selection and re-scopes options.
            configFilters.station = 'all';
            if (stationCtl) {
                stationCtl.setItems(buildStationOptions(value));
                stationCtl.setQuery('');
            }
            fire();
        }
    });

    stationCtl = createSearchableDropdown({
        placeholder: 'Search by Station',
        width: FILTER_WIDTH,
        bgWhite: true,
        items: buildStationOptions(configFilters.city),
        initialQuery: configFilters.station === 'all' ? '' : configFilters.station,
        onSelect: (value) => {
            configFilters.station = value;
            if (value === 'all') stationCtl.setQuery('');
            fire();
        }
    });

    // --- Product ---
    const productOptions = [
        { value: 'all', label: 'All Products' },
        ...PRODUCT_OPTIONS.map(p => ({ value: p, label: p }))
    ];

    const productCtl = createSearchableDropdown({
        placeholder: 'Search by Product',
        width: FILTER_WIDTH,
        bgWhite: true,
        items: productOptions,
        initialQuery: labelFor(productOptions, configFilters.product),
        onSelect: (value) => {
            configFilters.product = value;
            if (value === 'all') productCtl.setQuery('');
            fire();
        }
    });

    // --- Address (free-text substring; suggestions show unique addresses) ---
    const addressCtl = createSearchableDropdown({
        placeholder: 'Search by Address',
        width: FILTER_WIDTH,
        bgWhite: true,
        items: () => {
            const seen = new Set();
            const out = [];
            for (const d of (window.dispensers || [])) {
                const addr = d.address ? ensureDAddress(d.address) : '';
                if (addr && !seen.has(addr)) {
                    seen.add(addr);
                    out.push({ value: addr, label: addr });
                }
            }
            return out.sort((a, b) => a.label.localeCompare(b.label));
        },
        initialQuery: configFilters.address,
        emptyText: 'No matching address',
        onInput: (q) => {
            configFilters.address = q;
            fire();
        },
        onSelect: (value) => {
            configFilters.address = value;
            fire();
        }
    });

    wrap.appendChild(cityCtl.wrap);
    wrap.appendChild(stationCtl.wrap);
    wrap.appendChild(productCtl.wrap);
    wrap.appendChild(addressCtl.wrap);
    return wrap;
}

async function saveDispenserToDB(dispenser, isUpdate = false, originalDispenserId = null) {
  try {
    const dbDispenser = {
      customer_code: dispenser.customer_code,
      dispenser_id: dispenser.dispenser_id,
      address: dispenser.address,
      DispenserBrand: dispenser.DispenserBrand,
      number_of_nozzles: dispenser.number_of_nozzles,
      interface_type: dispenser.interface_type || 'ir',
      interface_lock_status: dispenser.interface_lock_status ?? 1
    };

    // For an UPDATE the URL must use the *original* dispenser_id (the row to
    // look up) — body.dispenser_id is the target value, which may differ if
    // the user renamed it. Server propagates the rename via FK cascade.
    const lookupId = isUpdate ? (originalDispenserId ?? dispenser.dispenser_id) : null;
    const dispenserEndpoint = isUpdate
      ? `${API_BASE_URL}/dispensers/${encodeURIComponent(lookupId)}?customer_code=${encodeURIComponent(dispenser.customer_code)}`
      : `${API_BASE_URL}/dispensers`;
    
    const method = isUpdate ? 'PUT' : 'POST';

    const dispenserResponse = await fetch(dispenserEndpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dbDispenser)
    });
    
    if (!dispenserResponse.ok) {
      const errorData = await dispenserResponse.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to save dispenser');
    }

    const savedDispenser = await dispenserResponse.json();

    if (dispenser.nozzles && dispenser.nozzles.length > 0) {
      // Fetch existing nozzles
      const existingNozzlesResponse = await fetch(
        `${API_BASE_URL}/nozzles?dispenser_id=${encodeURIComponent(dbDispenser.dispenser_id)}&customer_code=${encodeURIComponent(dispenser.customer_code)}`
      );
      let existingNozzles = [];
      if (existingNozzlesResponse.ok) {
        existingNozzles = await existingNozzlesResponse.json();
      }

      // Map new nozzles by nozzle_id for comparison
      const newNozzles = dispenser.nozzles.map(nozzle => ({
        customer_code: dispenser.customer_code,
        dispenser_id: dbDispenser.dispenser_id,
        nozzle_id: `${ensureDAddress(dbDispenser.address)}-${nozzle.nozzleId.split('-')[1]}`,
        product: nozzle.product,
        status: 0,
        lock_unlock: 0,
        price_per_liter: '0.00',
        total_quantity: '0.00',
        total_amount: '0.00'
      }));

      // Identify nozzles to update, insert, or delete
      const nozzlesToUpdate = [];
      const nozzlesToInsert = [];
      const existingNozzleIds = existingNozzles.map(n => n.nozzle_id);
      const newNozzleIds = newNozzles.map(n => n.nozzle_id);

      // Nozzles to update (exist in both sets)
      for (const newNozzle of newNozzles) {
        const existingNozzle = existingNozzles.find(n => n.nozzle_id === newNozzle.nozzle_id);
        if (existingNozzle) {
          nozzlesToUpdate.push(newNozzle);
        } else {
          nozzlesToInsert.push(newNozzle);
        }
      }

      // Nozzles to delete (exist in DB but not in new set)
      const nozzlesToDelete = existingNozzles.filter(n => !newNozzleIds.includes(n.nozzle_id));

      // Persisted shape for an existing/updated nozzle row (same for PUT and POST).
      const toNozzlePayload = nozzle => ({
        customer_code: dispenser.customer_code,
        dispenser_id: dbDispenser.dispenser_id,
        nozzle_id: nozzle.nozzle_id,
        product: nozzle.product,
        status: nozzle.status,
        lock_unlock: nozzle.lock_unlock,
        price_per_liter: nozzle.price_per_liter,
        total_quantity: nozzle.total_quantity,
        total_amount: nozzle.total_amount
      });

      // Update existing nozzles
      for (const nozzle of nozzlesToUpdate) {
        const nozzleResponse = await fetch(
          `${API_BASE_URL}/nozzles/${encodeURIComponent(dbDispenser.dispenser_id)}/${encodeURIComponent(nozzle.nozzle_id)}?customer_code=${encodeURIComponent(dispenser.customer_code)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(toNozzlePayload(nozzle))
          }
        );

        if (!nozzleResponse.ok) {
          const errorData = await nozzleResponse.json().catch(() => ({}));
          console.error('Nozzle update error details:', errorData);
          throw new Error(errorData.error || 'Failed to update nozzle');
        }
      }

      // Insert new nozzles
      for (const nozzle of nozzlesToInsert) {
        const nozzleResponse = await fetch(`${API_BASE_URL}/nozzles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(toNozzlePayload(nozzle))
        });

        if (!nozzleResponse.ok) {
          const errorData = await nozzleResponse.json().catch(() => ({}));
          console.error('Nozzle save error details:', errorData);
          throw new Error(errorData.error || 'Failed to save nozzle');
        }
      }

      // Delete removed nozzles
      for (const nozzle of nozzlesToDelete) {
        await fetch(
          `${API_BASE_URL}/nozzles/${encodeURIComponent(dbDispenser.dispenser_id)}/${encodeURIComponent(nozzle.nozzle_id)}?customer_code=${encodeURIComponent(dispenser.customer_code)}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            }
          }
        );
      }
    }

    return savedDispenser;
  } catch (error) {
    console.error('Database save error:', error);
    throw error;
  }
}

async function loadDispensersFromDB() {
  try {
    const dispenserResponse = await fetch(
      `${API_BASE_URL}/dispensers`
    );
    
    if (!dispenserResponse.ok) {
      throw new Error('Failed to load dispensers');
    }
    
    const dbDispensers = await dispenserResponse.json();
    
    const dispensersWithNozzles = await Promise.all(dbDispensers.map(async dbDispenser => {
      const nozzleResponse = await fetch(
        `${API_BASE_URL}/nozzles?dispenser_id=${encodeURIComponent(dbDispenser.dispenser_id)}&customer_code=${encodeURIComponent(dbDispenser.customer_code)}`
      );
      
      let nozzles = [];
      if (nozzleResponse.ok) {
        nozzles = await nozzleResponse.json();
      }

      return {
        id: dbDispenser.id,
        customer_code: dbDispenser.customer_code,
        address: dbDispenser.address,
        DispenserBrand: dbDispenser.DispenserBrand,
        number_of_nozzles: dbDispenser.number_of_nozzles,
        dispenser_id: dbDispenser.dispenser_id,
        interface_type: dbDispenser.interface_type,
        interface_lock_status: dbDispenser.interface_lock_status,
        conn_status: dbDispenser.conn_status,
        connected_at: dbDispenser.connected_at,
        created_at: dbDispenser.created_at,
        nozzles: nozzles.map(n => ({
          nozzleId: n.nozzle_id,
          product: n.product,
          status: n.status,
          lockStatus: n.lock_unlock,
          pricePerLiter: n.price_per_liter,
          totalQuantity: n.total_quantity,
          totalAmount: n.total_amount
        }))
      };
    }));

    return {
      dispensers: dispensersWithNozzles,
      products: PRODUCT_OPTIONS
    };
  } catch (error) {
    console.error('Database load error:', error);
    return { dispensers: [], products: [] };
  }
}

function exportConfigDispensersToCsv() {
    const rows = getFilteredConfigDispensers();
    const stationByCode = new Map((stationsList || []).map(s => [s.customer_code, s]));
    const cols = [
        { header: 'Customer Code',     get: d => d.customer_code },
        { header: 'Station ID',        get: d => stationByCode.get(d.customer_code)?.station_id || '' },
        { header: 'City',              get: d => titleCase(stationByCode.get(d.customer_code)?.city || '') },
        { header: 'District',          get: d => stationByCode.get(d.customer_code)?.district || '' },
        { header: 'Division',          get: d => stationByCode.get(d.customer_code)?.division || '' },
        { header: 'Dispenser ID',      get: d => d.dispenser_id },
        { header: 'Address',           get: d => d.address },
        { header: 'Nozzles',           get: d => (d.nozzles || []).map(n => n.nozzleId.split('-')[1]).join('; ') },
        { header: 'Products',          get: d => (d.nozzles || []).map(n => (n.product || '').toUpperCase()).join('; ') },
        { header: 'Dispenser Brand',   get: d => d.DispenserBrand || '' },
        { header: 'Status',            get: d => Number(d.conn_status) === 1 ? 'Connected' : 'Disconnected' },
        { header: 'Time',              get: d => d.connected_at ? new Date(d.connected_at).toLocaleString() : '' },
        { header: 'Created At',        get: d => d.created_at ? new Date(d.created_at).toLocaleString() : '' }
    ];
    const dateTag = new Date().toISOString().split('T')[0];
    downloadCsv(`dispensers-${dateTag}.csv`, rows, cols);
}

async function renderConfigDispensers() {
    const params = new URLSearchParams(window.location.search);
    const customerCodeFilter = (params.get('customer_code') || '').trim();
    const backTarget = params.get('back')
        || (customerCodeFilter
            ? `dispensers.html?customer_code=${encodeURIComponent(customerCodeFilter)}`
            : 'dispensers.html');

    const { content, addButton } = configPage('Configure Dispensers', '← Back', backTarget, 'Add Dispenser');
    addButton.addEventListener('click', () => editDispenser(window.dispensers.length));

    // Reserve an empty placeholder slot in the button row now so the layout
    // doesn't jump once filters get appended after data loads.
    const buttonRow = addButton.parentElement;
    let searchesGroup = null;
    if (buttonRow) {
        buttonRow.style.justifyContent = 'space-between';
        buttonRow.style.flexWrap = 'wrap';

        searchesGroup = document.createElement('div');
        searchesGroup.style.display = 'flex';
        searchesGroup.style.flexWrap = 'wrap';
        searchesGroup.style.gap = '10px';
        searchesGroup.style.alignItems = 'center';
        searchesGroup.style.flex = '1 1 auto';
        buttonRow.insertBefore(searchesGroup, addButton);

        // Export CSV — super-admin only.
        const role = StationAuth.getUserInfo()?.role;
        if (role === 'super_admin') {
            const exportBtn = createActionButton();
            exportBtn.textContent = 'Export to CSV';
            exportBtn.style.marginRight = '8px';
            exportBtn.addEventListener('click', () => exportConfigDispensersToCsv());
            buttonRow.insertBefore(exportBtn, addButton);
        }
    }

    let productOptions = [];
    try {
        // Load stations first
        stationsList = await loadStationsFromDB();
        const data = await loadDispensersFromDB();
        window.dispensers = customerCodeFilter
            ? data.dispensers.filter(d => d.customer_code === customerCodeFilter)
            : data.dispensers;
        productOptions = data.products;
    } catch (error) {
        console.error('Load error:', error);
        content.innerHTML = '<div class="error">Failed to load dispensers</div>';
        return;
    }

    // Build the filter controls now that stationsList and window.dispensers
    // are populated — building before this would leave the City/Station
    // dropdowns with only their "All …" entry.
    if (searchesGroup) {
        searchesGroup.appendChild(buildConfigFilters(refreshDispenserTable));
    }

    const DispenserBrandOptions = ['Tatsuno', 'Wayne'];
    const nozzleOptions = ['A1', 'A2', 'B1', 'B2'];

    const columns = ['Customer Code', 'City', 'District', 'Address', 'Nozzles', 'Products', 'Dispenser Brand', 'Status', 'Created At', 'Action'];

    const stationByCode = new Map(stationsList.map(s => [s.customer_code, s]));

    const { tableContainer , tbody } = createTable(columns);
    content.appendChild(tableContainer);

    function createDispenserModal() {
        const overlay = createModalOverlay();
        const popup = document.createElement('div');
        popup.className = 'popup-modal';
        popup.style.width = '350px';
        popup.style.maxWidth = '90vw';

        const header = createHeader();
        
        const title = createTitle();
        title.textContent = 'Configure Dispenser';

        const closeButton = createCloseButton(overlay);
        
        header.appendChild(title);
        header.appendChild(closeButton);
        popup.appendChild(header);

        const form = document.createElement('form');
        form.id = 'dispenser-form';
        form.style.display = 'grid';
        form.style.gap = '15px';

        // Customer Code field (dropdown from stations)
        const customerCodeSelect = createDropdown('Select Customer Code');
        customerCodeSelect.name = 'customer_code';
        customerCodeSelect.required = true;
        
        // Populate customer codes from stationsList
        if (stationsList.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No stations available';
            option.disabled = true;
            option.selected = true;
            customerCodeSelect.appendChild(option);
        } else {
            const defaultOption = document.createElement('option');
            defaultOption.value = '';
            defaultOption.textContent = 'Select Customer Code';
            defaultOption.disabled = true;
            defaultOption.selected = true;
            customerCodeSelect.appendChild(defaultOption);
            
            stationsList.forEach(station => {
                const option = document.createElement('option');
                option.value = station.customer_code;
                option.textContent = `${station.customer_code} - ${station.station_id || station.city || 'Unknown'}`;
                customerCodeSelect.appendChild(option);
            });
        }
        
        form.appendChild(createFormRow('Customer Code:', customerCodeSelect));

        // Address field
        const addressInput = createTextInput({ name: 'address', required: true });
        addressInput.style.width = '90%';
        form.appendChild(createFormRow('Address:', addressInput));

        // Dispenser ID field (editable; rename cascades server-side)
        const dispenserIdInput = createTextInput({ name: 'dispenser_id', required: true });
        dispenserIdInput.style.width = '90%';
        form.appendChild(createFormRow('Dispenser ID:', dispenserIdInput));

        // DispenserBrand field
        const DispenserBrandSelect = applyInputStyles(document.createElement('select'));
        DispenserBrandSelect.name = 'DispenserBrand';
        DispenserBrandSelect.required = true;
        DispenserBrandSelect.style.width = '100%';
        DispenserBrandSelect.innerHTML = '<option value="" disabled selected style="color: grey;">Select Dispenser Brand</option>' +
            DispenserBrandOptions.map(opt => `<option value="${opt}">${opt}</option>`).join('');
        form.appendChild(createFormRow('Dispenser Brand:', DispenserBrandSelect));

        // Interface field (ir / keypad)
        const interfaceSelect = applyInputStyles(document.createElement('select'));
        interfaceSelect.name = 'interface_type';
        interfaceSelect.required = true;
        interfaceSelect.style.width = '100%';
        interfaceSelect.innerHTML =
            '<option value="ir">IR</option>' +
            '<option value="keypad">Keypad</option>';
        form.appendChild(createFormRow('Interface:', interfaceSelect));

        // Nozzles configuration
        const nozzlesContainer = document.createElement('div');
        nozzlesContainer.id = 'nozzles-container';
        nozzlesContainer.style.display = 'grid';
        nozzlesContainer.style.gap = '10px';
        
        const nozzlesTitle = document.createElement('h4');
        nozzlesTitle.textContent = 'Nozzles';
        nozzlesTitle.style.margin = '0';
        nozzlesTitle.style.color = 'var(--text-heading)';
        nozzlesContainer.appendChild(nozzlesTitle);
        
        const nozzlesGrid = document.createElement('div');
        nozzlesGrid.style.display = 'grid';
        nozzlesGrid.style.gridTemplateColumns = 'repeat(2, 1fr)';
        nozzlesGrid.style.gap = '10px';
        
        nozzleOptions.forEach(nozzle => {
            const nozzleItem = document.createElement('div');
            nozzleItem.style.display = 'flex';
            nozzleItem.style.alignItems = 'center';
            nozzleItem.style.gap = '8px';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `nozzle-${nozzle}`;
            checkbox.name = `nozzle-${nozzle}`;
            checkbox.value = nozzle;
            checkbox.addEventListener('change', () => {
                updateProductSelectors();
            });
            
            const label = document.createElement('label');
            label.htmlFor = `nozzle-${nozzle}`;
            label.textContent = nozzle;
            
            nozzleItem.appendChild(checkbox);
            nozzleItem.appendChild(label);
            nozzlesGrid.appendChild(nozzleItem);
        });
        
        nozzlesContainer.appendChild(nozzlesGrid);
        form.appendChild(nozzlesContainer);

        // Products container
        const productsContainer = document.createElement('div');
        productsContainer.id = 'products-container';
        productsContainer.style.display = 'grid';
        productsContainer.style.gap = '10px';
        form.appendChild(productsContainer);

        // Submit button
        const submitButton = createActionButton();
        submitButton.type = 'submit';
        submitButton.textContent = 'Save';
        form.appendChild(submitButton);

        popup.appendChild(form);

        function updateProductSelectors() {
            productsContainer.innerHTML = '';
            
            nozzleOptions.forEach(nozzle => {
                const checkbox = form.querySelector(`input[name="nozzle-${nozzle}"]`);
                if (checkbox && checkbox.checked) {
                    const select = createDropdown('Select Product');
                    select.name = `product-${nozzle}`;
                    select.required = true;
                    select.style.marginBottom = '0';

                    productOptions.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt;
                        option.textContent = opt;
                        select.appendChild(option);
                    });

                    productsContainer.appendChild(createFormRow(`Product for ${nozzle}:`, select, '130px'));
                }
            });
        }

        return { overlay, popup, form, updateProductSelectors };
    }

    refreshDispenserTable();

    function refreshDispenserTable() {
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        const displayDispensers = getFilteredConfigDispensers();

        if (displayDispensers.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = columns.length;
            td.style.textAlign = 'center';
            td.style.borderBottom = '1px solid var(--border)';
            td.style.padding = '10px';
            const anyFilterActive = configFilters.address.trim() !== '' ||
                configFilters.city !== 'all' ||
                configFilters.station !== 'all' ||
                configFilters.product !== 'all';
            td.textContent = anyFilterActive
                ? 'No dispensers match'
                : 'No dispensers configured';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        displayDispensers.forEach((dispenser) => {
            // Resolve back to the real index in window.dispensers so edit/delete
            // hit the right entry even when the table is filtered.
            const index = window.dispensers.indexOf(dispenser);
            const station = stationByCode.get(dispenser.customer_code);

            const nozzleList = dispenser.nozzles?.length
                ? dispenser.nozzles.map(n => n.nozzleId.split('-')[1]).join(', ')
                : null;
            const productList = dispenser.nozzles?.length
                ? dispenser.nozzles.map(n => n.product.toUpperCase()).join(', ')
                : null;

            const createdAt = dispenser.created_at
                ? new Date(dispenser.created_at).toLocaleString()
                : null;

            const connStatus = Number(dispenser.conn_status) === 1 ? 'Connected' : 'Disconnected';

            const tr = createTableRow([
                dispenser.customer_code,
                station?.city ? titleCase(station.city) : null,
                station?.division,
                dispenser.address,
                nozzleList,
                productList,
                dispenser.DispenserBrand,
                `${connStatus} - ${dispenser.connected_at ? new Date(dispenser.connected_at).toLocaleString() : 'N/A'}`,
                createdAt
            ]);

            appendRowActions(tr, {
                onEdit: () => editDispenser(index),
                onDelete: () => deleteDispenserPopup(index, tr),
                editTitle: 'Edit this dispenser', deleteTitle: 'Delete this dispenser'
            });
            tbody.appendChild(tr);
        });
    }

    async function editDispenser(index) {
        const { overlay, popup, form, updateProductSelectors } = createDispenserModal();
        dragPopup(overlay, popup);
        
        const dispenser = window.dispensers[index] || {
            customer_code: '',
            address: '',
            nozzles: [],
            DispenserBrand: '',
            number_of_nozzles: 0,
            interface_type: 'ir',
            interface_lock_status: 1
        };
        
        const isExistingEdit = index < window.dispensers.length;

        // Set form values
        if (dispenser.customer_code) {
            form.customer_code.value = dispenser.customer_code;
        }
        // Input expects naked numeric; backend re-prepends D on save.
        form.address.value = stripDAddress(dispenser.address || '');
        form.DispenserBrand.value = dispenser.DispenserBrand || '';
        form.interface_type.value = (dispenser.interface_type || 'ir').toLowerCase();
        form.dispenser_id.value = dispenser.dispenser_id != null ? String(dispenser.dispenser_id) : '';

        // Customer code and address identify the dispenser — locking them on
        // edit prevents accidental re-targeting of an unrelated row.
        if (isExistingEdit) {
            form.customer_code.disabled = true;
            form.customer_code.style.opacity = '0.6';
            form.address.readOnly = true;
            form.address.style.cursor = 'auto';
            form.address.style.opacity = '0.6';
        }

        nozzleOptions.forEach(nozzle => {
            const checkbox = form.querySelector(`input[name="nozzle-${nozzle}"]`);
            if (checkbox) checkbox.checked = false;
        });

        if (dispenser.nozzles) {
            dispenser.nozzles.forEach(nozzle => {
                const nozzleId = nozzle.nozzleId.split('-')[1];
                const checkbox = form.querySelector(`input[name="nozzle-${nozzleId}"]`);
                if (checkbox) {
                    checkbox.checked = true;
                }
            });
        }

        updateProductSelectors();

        if (dispenser.nozzles) {
            dispenser.nozzles.forEach(nozzle => {
                const nozzleId = nozzle.nozzleId.split('-')[1];
                const productSelect = form.querySelector(`select[name="product-${nozzleId}"]`);
                if (productSelect && nozzle.product) {
                    // Match case-insensitively — DB-stored product casing may
                    // differ from the dropdown's option values ('PMG' etc).
                    const target = String(nozzle.product).toUpperCase();
                    const opt = Array.from(productSelect.options).find(
                        o => o.value.toUpperCase() === target
                    );
                    if (opt) productSelect.value = opt.value;
                }
            });
        }

        form.onsubmit = async (e) => {
            e.preventDefault();
            
            const customerCode = form.customer_code.value;
            if (!customerCode) {
                alert('Please select a customer code');
                return;
            }
            
            const addressInput = form.address.value;
            if (!addressInput || isNaN(addressInput) || parseInt(addressInput) < 1) {
                alert('Please enter a valid dispenser address (positive number)');
                return;
            }

            // Check for duplicate address within same customer. Compare in
            // canonical D-prefixed form so a user typing "01" still matches a
            // row stored as "D01".
            const newAddrCanon = ensureDAddress(addressInput);
            const isDuplicate = window.dispensers.some((d, i) =>
                i !== index && d.customer_code === customerCode &&
                ensureDAddress(d.address) === newAddrCanon);
            if (isDuplicate) {
                alert('Dispenser address must be unique for this customer');
                return;
            }

            const selectedNozzles = nozzleOptions.filter(nozzle => {
                const checkbox = form.querySelector(`input[name="nozzle-${nozzle}"]`);
                return checkbox && checkbox.checked;
            });

            if (selectedNozzles.length === 0) {
                alert('Please select at least one nozzle');
                return;
            }

            const address = addressInput;
            const originalDispenserId = dispenser.dispenser_id;
            const enteredDispenserId = (form.dispenser_id.value || '').trim();

            // For new dispensers, fall back to next-id if the user left it blank.
            let dispenser_id = enteredDispenserId;
            if (!dispenser_id) {
                if (isExistingEdit) {
                    alert('Dispenser ID cannot be empty');
                    return;
                }
                const response = await fetch(
                    `${API_BASE_URL}/dispensers/next-id?customer_code=${customerCode}`
                );
                if (!response.ok) {
                    throw new Error('Failed to get next dispenser ID');
                }
                const data = await response.json();
                dispenser_id = String(data.next_id);
            }

            // Block collisions client-side too (the server enforces this anyway).
            const idCollision = window.dispensers.some((d, i) =>
                i !== index && d.customer_code === customerCode &&
                String(d.dispenser_id) === String(dispenser_id));
            if (idCollision) {
                alert(`Dispenser ID "${dispenser_id}" already exists for this customer`);
                return;
            }

            const newDispenser = {
                id: dispenser.id,
                customer_code: customerCode,
                address: address,
                DispenserBrand: form.DispenserBrand.value,
                number_of_nozzles: selectedNozzles.length,
                dispenser_id: dispenser_id,
                interface_type: form.interface_type.value || 'ir',
                interface_lock_status: dispenser.interface_lock_status ?? 1,
                nozzles: selectedNozzles.map(nozzle => ({
                    nozzleId: `${ensureDAddress(address)}-${nozzle}`,
                    product: form[`product-${nozzle}`].value
                }))
            };

            try {
                const savedDispenser = await saveDispenserToDB(
                    newDispenser,
                    isExistingEdit,
                    isExistingEdit ? originalDispenserId : null
                );
                
                const updatedDispenser = {
                    ...newDispenser,
                    id: savedDispenser.id,
                    dispenser_id: savedDispenser.dispenser_id || newDispenser.dispenser_id,
                    conn_status: dispenser.conn_status,
                    connected_at: dispenser.connected_at,
                    created_at: dispenser.created_at,
                    nozzles: selectedNozzles.map(nozzle => ({
                        nozzleId: `D${dispenser_id}-${nozzle}`,
                        product: form[`product-${nozzle}`].value,
                        status: 0,
                        lockStatus: 0,
                        pricePerLiter: 0.00,
                        totalQuantity: 0.00,
                        totalAmount: 0.00
                    }))
                };

                if (index >= window.dispensers.length) {
                    window.dispensers.push(updatedDispenser);
                } else {
                    window.dispensers[index] = updatedDispenser;
                }
                
                refreshDispenserTable();
                
                document.body.removeChild(overlay);
            } catch (error) {
                console.error('Save failed:', error);
                alert('Failed to save dispenser. Please try again.');
            }
        };
    }

    function deleteDispenserPopup(index, row) {
        const { overlay, popup, confirmButton, cancelButton, buttonContainer } = createDeletePopup('Are you sure you want to delete this dispenser?');
        
        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.margin = '15px 0';
        checkboxContainer.style.display = 'flex';
        checkboxContainer.style.alignItems = 'center';
        checkboxContainer.style.gap = '8px';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'deleteHistory';
        
        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = 'deleteHistory';
        checkboxLabel.textContent = 'Delete all historical records (transactions, sales history)';
        checkboxLabel.style.fontSize = '14px';
        checkboxLabel.style.color = 'var(--text-secondary)';
        
        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);

        popup.insertBefore(checkboxContainer, buttonContainer);

        const warningContainer = document.createElement('div');
        warningContainer.id = 'warningContainer';
        warningContainer.style.display = 'none';
        warningContainer.style.margin = '10px 0';
        warningContainer.style.padding = '10px';
        warningContainer.style.backgroundColor = 'var(--badge-reset-bg)';
        warningContainer.style.border = '1px solid var(--badge-reset-text)';
        warningContainer.style.borderRadius = '4px';
        warningContainer.style.color = 'var(--badge-reset-text)';
        warningContainer.style.fontSize = '14px';
        
        const warningText = document.createElement('p');
        warningText.textContent = 'WARNING: This action is irreversible and will permanently delete all transactions and historical data.';
        warningText.style.margin = '0';
        
        warningContainer.appendChild(warningText);
        popup.insertBefore(warningContainer, buttonContainer);

        checkbox.addEventListener('change', function() {
            warningContainer.style.display = this.checked ? 'block' : 'none';
        });

        confirmButton.onclick = async () => {
            const deleteHistory = checkbox.checked;
            const dispenser = window.dispensers[index];
            
            try {
                if (dispenser.id) {
                    await deleteFromDB(`${API_BASE_URL}/dispensers/${dispenser.id}?customer_code=${dispenser.customer_code}&delete_history=${deleteHistory}`);
                }
                
                window.dispensers.splice(index, 1);
                
                row.remove();
                
                document.body.removeChild(overlay);
                
                if (window.dispensers.length === 0) {
                    refreshDispenserTable();
                }
            } catch (error) {
                console.error('Delete failed:', error);
                alert('Failed to delete dispenser. Please try again.');
            }
        };
        
        cancelButton.onclick = () => {
            document.body.removeChild(overlay);
        };
    }
}

window.renderConfigDispensers = renderConfigDispensers;