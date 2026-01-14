const PRODUCT_NAME_MAPPING = {
  'premier': 'Premier',
  'hicetane': 'Hi-Cetane Diesel',
  'octane-plus': 'Octane Plus'
};

async function saveDispenserToDB(dispenser, isUpdate = false, stationId = null) {
  try {
    if (!stationId) {
      const currentStation = JSON.parse(localStorage.getItem('currentStation'));
      if (!currentStation || !currentStation.station_id) {
        throw new Error('No station selected');
      }
      stationId = currentStation.station_id;
    }

    const dbDispenser = {
      station_id: stationId,
      dispenser_id: dispenser.dispenser_id,
      address: dispenser.address,
      vendor: dispenser.vendor,
      number_of_nozzles: dispenser.number_of_nozzles,
      ir_lock_status: dispenser.ir_lock_status || 1
    };

    const dispenserEndpoint = isUpdate 
      ? `${API_BASE_URL}/dispensers/${stationId}/${dispenser.dispenser_id}`
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
        `${API_BASE_URL}/nozzles?station_id=${stationId}&dispenser_id=${dbDispenser.dispenser_id}`
      );
      let existingNozzles = [];
      if (existingNozzlesResponse.ok) {
        existingNozzles = await existingNozzlesResponse.json();
      }

      // Map new nozzles by nozzle_id for comparison
      const newNozzles = dispenser.nozzles.map(nozzle => ({
        nozzle_id: nozzle.nozzleId,
        product: nozzle.product
      }));

      // Identify nozzles to update, insert, or delete
      const nozzlesToUpdate = [];
      const nozzlesToInsert = [];
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

      // Update existing nozzles
      for (const nozzle of nozzlesToUpdate) {
        const nozzleData = {
          station_id: stationId,
          dispenser_id: dbDispenser.dispenser_id,
          nozzle_id: nozzle.nozzle_id,
          product: nozzle.product,
          status: nozzle.status,
          lock_unlock: nozzle.lock_unlock,
          keypad_lock_status: nozzle.keypad_lock_status,
          price_per_liter: nozzle.price_per_liter,
          total_quantity: nozzle.total_quantity,
          total_amount: nozzle.total_amount
        };

        const nozzleResponse = await fetch(
          `${API_BASE_URL}/nozzles/${stationId}/${dbDispenser.dispenser_id}/${encodeURIComponent(nozzle.nozzle_id)}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(nozzleData)
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
        const nozzleData = {
          station_id: stationId,
          dispenser_id: dbDispenser.dispenser_id,
          nozzle_id: nozzle.nozzle_id,
          product: nozzle.product,
        };

        const nozzleResponse = await fetch(`${API_BASE_URL}/nozzles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(nozzleData)
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
          `${API_BASE_URL}/nozzles/${stationId}/${dbDispenser.dispenser_id}/${encodeURIComponent(nozzle.nozzle_id)}`,
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
    const currentStation = JSON.parse(localStorage.getItem('currentStation'));
    if (!currentStation || !currentStation.station_id) {
      throw new Error('No station selected');
    }

    const productOptions = ['PMG', 'HSD'];

    const dispenserResponse = await fetch(
      `${API_BASE_URL}/dispensers?station_id=${currentStation.station_id}`
    );
    
    if (!dispenserResponse.ok) {
      throw new Error('Failed to load dispensers');
    }
    
    const dbDispensers = await dispenserResponse.json();
    
    const dispensersWithNozzles = await Promise.all(dbDispensers.map(async dbDispenser => {
      const nozzleResponse = await fetch(
        `${API_BASE_URL}/nozzles?station_id=${currentStation.station_id}&dispenser_id=${dbDispenser.dispenser_id}`
      );
      
      let nozzles = [];
      if (nozzleResponse.ok) {
        nozzles = await nozzleResponse.json();
      }

      return {
        id: dbDispenser.id,
        address: dbDispenser.address,
        vendor: dbDispenser.vendor,
        number_of_nozzles: dbDispenser.number_of_nozzles,
        dispenser_id: dbDispenser.dispenser_id,
        ir_lock_status: dbDispenser.ir_lock_status,
        nozzles: nozzles.map(n => ({
          nozzleId: n.nozzle_id,
          product: n.product,
          status: n.status,
          lockStatus: n.lock_unlock,
          keypadLockStatus: n.keypad_lock_status,
          pricePerLiter: n.price_per_liter,
          totalQuantity: n.total_quantity,
          totalAmount: n.total_amount
        }))
      };
    }));

    return {
      dispensers: dispensersWithNozzles,
      products: productOptions
    };
  } catch (error) {
    console.error('Database load error:', error);
    return { dispensers: [], products: [] };
  }
}

async function renderConfigDispensers() {
    const currentStation = JSON.parse(localStorage.getItem('currentStation')) || {};
    if (!currentStation.station_id) {
        console.error('No station selected');
        content.innerHTML = '<div class="error">Please select a station first</div>';
        return;
    }
    
    const { content, addButton } = configPage('Configure Dispensers', 'Back to Dispensers', 'index.html', 'Add Dispenser');
    addButton.addEventListener('click', () => editDispenser(window.dispensers.length));

    let productOptions = [];
    try {
        const data = await loadDispensersFromDB();
        window.dispensers = data.dispensers;
        productOptions = data.products;
    } catch (error) {
        console.error('Load error:', error);
        content.innerHTML = '<div class="error">Failed to load dispensers</div>';
        return;
    }

    const vendorOptions = ['Tatsuno', 'Wayne'];
    const nozzleOptions = ['A1', 'A2', 'B1', 'B2'];

    const columns = ['Address', 'Nozzles', 'Products', 'Vendor', 'Action'];

    const { tableContainer , tbody } = createTable(columns);
    content.appendChild(tableContainer);

    function createDispenserModal() {
        const overlay = createModalOverlay();
        const popup = document.createElement('div');
        popup.className = 'popup-modal';
        popup.style.width = '300px';
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

        const addressContainer = createField('Address:', 'address');
        form.appendChild(addressContainer);
        
        const vendorSelect = createDropdown('Select Vendor');
        vendorSelect.name = 'vendor';
        vendorOptions.forEach(vendor => {
            const option = document.createElement('option');
            option.value = vendor;
            option.textContent = vendor;
            vendorSelect.appendChild(option);
        });

        const vendorContainer = createField('Vendor:', vendorSelect);
        form.appendChild(vendorContainer);

        // Nozzles configuration
        const nozzlesContainer = document.createElement('div');
        nozzlesContainer.id = 'nozzles-container';
        nozzlesContainer.style.display = 'grid';
        nozzlesContainer.style.gap = '10px';
        
        const nozzlesTitle = document.createElement('h4');
        nozzlesTitle.textContent = 'Nozzles';
        nozzlesTitle.style.margin = '0';
        nozzlesTitle.style.color = '#004D64';
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
                if (checkbox.checked) {
                    const select = createDropdown('Select Product');
                    select.name = `product-${nozzle}`;
                    select.required = true;

                    const container = createField(`Nozzle ${nozzle}:`, select);
                    
                    productOptions.forEach(opt => {
                        const displayName = PRODUCT_NAME_MAPPING[opt.toLowerCase()] || opt;
                        const option = document.createElement('option');
                        option.value = opt;
                        option.textContent = displayName;
                        select.appendChild(option);
                    });
                    
                    container.appendChild(select);
                    productsContainer.appendChild(container);
                }
            });
        }

        return { overlay, popup, form, updateProductSelectors };
    }

    refreshDispenserTable();

    function refreshDispenserTable() {
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        const displayDispensers = window.dispensers;

        if (displayDispensers.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.style.textAlign = 'center';
            td.style.borderBottom = '1px solid #ddd';
            td.style.padding = '10px';
            td.textContent = 'No dispensers configured';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        displayDispensers.forEach((dispenser, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #ddd';
            
            const addressTd = document.createElement('td');
            addressTd.style.padding = '12px';
            // addressTd.style.borderRight = '1px solid #ddd';
            addressTd.textContent = dispenser.address || '-';
            tr.appendChild(addressTd);
            
            const nozzlesTd = document.createElement('td');
            nozzlesTd.style.padding = '12px';
            // nozzlesTd.style.borderRight = '1px solid #ddd';
            nozzlesTd.textContent = dispenser.nozzles?.length > 0 ? 
                dispenser.nozzles.map(n => n.nozzleId.split('-')[1]).join(', ') : '-';
            tr.appendChild(nozzlesTd);
            
            const productsTd = document.createElement('td');
            productsTd.style.padding = '12px';
            // productsTd.style.borderRight = '1px solid #ddd';
            productsTd.textContent = dispenser.nozzles?.length > 0 ? 
                dispenser.nozzles.map(n => {
                    const productValue = n.product;
                    return PRODUCT_NAME_MAPPING[productValue.toLowerCase()] || productValue;
                }).join(', ') : '-';
            tr.appendChild(productsTd);
            
            const vendorTd = document.createElement('td');
            vendorTd.style.padding = '12px';
            // vendorTd.style.borderRight = '1px solid #ddd';
            vendorTd.textContent = dispenser.vendor || '-';
            tr.appendChild(vendorTd);
            
            const actionTd = document.createElement('td');
            actionTd.style.padding = '12px';
            // actionTd.style.textAlign = 'center';
            
            const editBtn = createEditButton('Edit this dispenser');
            editBtn.addEventListener('click', () => editDispenser(index));
            
            const deleteBtn =  createDeleteButton('Delete this dispenser');
            deleteBtn.addEventListener('click', () => deleteDispenserPopup(index, tr));

            actionTd.appendChild(editBtn);
            actionTd.appendChild(deleteBtn);
            
            tr.appendChild(actionTd);
            tbody.appendChild(tr);
        });
    }

    async function editDispenser(index) {
        const { overlay, popup, form, updateProductSelectors } = createDispenserModal();
        dragPopup(overlay, popup);
        
        const dispenser = window.dispensers[index] || { 
            address: '', 
            nozzles: [], 
            vendor: '',
            number_of_nozzles: 0,
            ir_lock_status: 1
        };
        
        form.address.value = dispenser.address || '';
        form.vendor.value = dispenser.vendor || '';

        nozzleOptions.forEach(nozzle => {
            const checkbox = form.querySelector(`input[name="nozzle-${nozzle}"]`);
            checkbox.checked = false;
        });

        dispenser.nozzles.forEach(nozzle => {
            const nozzleId = nozzle.nozzleId.split('-')[1];
            const checkbox = form.querySelector(`input[name="nozzle-${nozzleId}"]`);
            if (checkbox) {
                checkbox.checked = true;
            }
        });

        updateProductSelectors();

        dispenser.nozzles.forEach(nozzle => {
            const nozzleId = nozzle.nozzleId.split('-')[1];
            const productSelect = form.querySelector(`select[name="product-${nozzleId}"]`);
            if (productSelect) {
                productSelect.value = nozzle.product;
            }
        });     

        form.onsubmit = async (e) => {
            e.preventDefault();
            
            const addressInput = form.address.value;
            if (!addressInput || isNaN(addressInput) || 
                parseInt(addressInput) < 1 || parseInt(addressInput) > 65535) {
                alert('Please enter a valid dispenser address between 1 and 65535');
                return;
            }

            const isDuplicate = window.dispensers.some((d, i) => 
                i !== index && d.address === addressInput.padStart(5, '0'));
            if (isDuplicate) {
                alert('Dispenser address must be unique');
                return;
            }

            const selectedNozzles = nozzleOptions.filter(nozzle => {
                return form.querySelector(`input[name="nozzle-${nozzle}"]`).checked;
            });

            if (selectedNozzles.length === 0) {
                alert('Please select at least one nozzle');
                return;
            }

            const address = addressInput.padStart(5, '0');
            let dispenser_id = dispenser.dispenser_id;

            // Fetch next dispenser_id for new dispensers
            if (!dispenser_id) {
                const response = await fetch(
                    `${API_BASE_URL}/dispensers/next-id?station_id=${currentStation.station_id}`
                );
                if (!response.ok) {
                    throw new Error('Failed to get next dispenser ID');
                }
                const data = await response.json();
                dispenser_id = data.next_id;
            }

            const newDispenser = {
                id: dispenser.id,
                address: address,
                vendor: form.vendor.value,
                number_of_nozzles: selectedNozzles.length,
                dispenser_id: dispenser_id,
                ir_lock_status: dispenser.ir_lock_status || 1,
                nozzles: selectedNozzles.map(nozzle => ({
                    nozzleId: `D${address}-${nozzle}`,
                    product: form[`product-${nozzle}`].value
                }))
            };

            try {
                const savedDispenser = await saveDispenserToDB(
                    newDispenser, 
                    index < window.dispensers.length
                );
                
                const updatedDispenser = {
                    ...newDispenser,
                    id: savedDispenser.id,
                    dispenser_id: savedDispenser.dispenser_id || newDispenser.dispenser_id,
                    nozzles: selectedNozzles.map(nozzle => ({
                        nozzleId: `D${address}-${nozzle}`,
                        product: form[`product-${nozzle}`].value,
                        status: 0,
                        lockStatus: 1,
                        keypadLockStatus: 1,
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
        // First popup with checkbox
        const { overlay, popup, confirmButton, cancelButton, buttonContainer } = createDeletePopup('Are you sure you want to delete this dispenser?');
        
        // Add checkbox for deleting historical records
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
        checkboxLabel.style.color = '#666';
        
        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);

        popup.insertBefore(checkboxContainer, buttonContainer);

        // Warning message container (initially hidden)
        const warningContainer = document.createElement('div');
        warningContainer.id = 'warningContainer';
        warningContainer.style.display = 'none';
        warningContainer.style.margin = '10px 0';
        warningContainer.style.padding = '10px';
        warningContainer.style.backgroundColor = '#fff3cd';
        warningContainer.style.border = '1px solid #ffeaa7';
        warningContainer.style.borderRadius = '4px';
        warningContainer.style.color = '#856404';
        warningContainer.style.fontSize = '14px';
        
        const warningText = document.createElement('p');
        warningText.textContent = 'WARNING: This action is irreversible and will permanently delete all transactions and historical data.';
        warningText.style.margin = '0';
        
        warningContainer.appendChild(warningText);
        popup.insertBefore(warningContainer, buttonContainer);

        // Show/hide warning when checkbox is toggled
        checkbox.addEventListener('change', function() {
            warningContainer.style.display = this.checked ? 'block' : 'none';
        });

        confirmButton.onclick = async () => {
            const deleteHistory = checkbox.checked;
            const dispenser = window.dispensers[index];
            
            try {
                if (dispenser.id) {
                    // Delete with or without history based on checkbox
                    await deleteFromDB(`${API_BASE_URL}/dispensers/${dispenser.id}?delete_history=${deleteHistory}`);
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