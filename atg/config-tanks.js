// config-tanks.js

const PRODUCT_NAME_MAPPING = {
  'pmg': 'PMG',
  'hsd': 'HSD'
};

async function saveTankToDB(tank, isUpdate = false) {
  try {
    const dbTank = {
      tank_id: tank.tank_id,
      address: tank.address,
      product: tank.product,
      dip_chart_path: tank.dip_chart_path || null,
      max_capacity_mm: tank.max_capacity_mm || 0,
      max_capacity_ltr: tank.max_capacity_ltr || 0
    };

    const tankEndpoint = isUpdate 
      ? `${API_BASE_URL}/tanks/${tank.tank_id}`
      : `${API_BASE_URL}/tanks`;
    
    const method = isUpdate ? 'PUT' : 'POST';

    const tankResponse = await fetch(tankEndpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dbTank)
    });
    
    if (!tankResponse.ok) {
      const errorData = await tankResponse.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to save tank');
    }

    const savedTank = await tankResponse.json();
    return savedTank;
  } catch (error) {
    console.error('Database save error:', error);
    throw error;
  }
}

async function loadTanksFromDB() {
  try {
    const tankResponse = await fetch(`${API_BASE_URL}/tanks`);
    
    if (!tankResponse.ok) {
      throw new Error('Failed to load tanks');
    }
    
    const dbTanks = await tankResponse.json();
    
    const tanks = dbTanks.map(dbTank => ({
      id: dbTank.id,
      address: dbTank.address,
      product: dbTank.product,
      tank_id: dbTank.tank_id,
      dip_chart_path: dbTank.dip_chart_path,
      max_capacity_mm: dbTank.max_capacity_mm,
      max_capacity_ltr: dbTank.max_capacity_ltr
    }));

    return {
      tanks: tanks,
      products: Object.keys(PRODUCT_NAME_MAPPING)
    };
  } catch (error) {
    console.error('Database load error:', error);
    return { tanks: [], products: [] };
  }
}

async function validateDipChartCSV(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const content = e.target.result;
                const firstLine = content.split('\n')[0].toLowerCase();

                if (firstLine.length === 0) {
                    reject(new Error('File is empty'));
                    return;
                }
                
                const requiredHeaders = [
                    'mm', 'liters', 'tank no.',
                    'length (internal) (m)', 'diameter (internal) (m)',
                    'date of calibration', 'ref. method', 'type', 'omc', 'location',
                    'total capacity (ltr)', 'max tank level (m)', 
                    'safe fill height (ltr)', 'safe fill height (m)'
                ];
                
                // Check if all required headers exist in the first line
                for (const header of requiredHeaders) {
                    if (!firstLine.includes(header.toLowerCase())) {
                        reject(new Error(`Missing header: ${header}`));
                        return;
                    }
                }
                
                resolve();
            } catch (error) {
                reject(new Error(`Invalid File format. ${error.message}`));
            }
        };
        
        reader.onerror = function() {
            reject(new Error('Failed to read file'));
        };
        
        reader.readAsText(file);
    });
}

async function uploadDipChartFile(file) {
    try {
        const formData = new FormData();
        formData.append('dipChart', file);
        
        const response = await fetch(`${API_BASE_URL}/tanks/upload-dip-chart`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to upload dip chart');
        }
        
        const result = await response.json();
        return result; // Returns relative path like "dip-charts/tank_12345.csv"
    } catch (error) {
        console.error('File upload error:', error);
        throw error;
    }
}

async function renderConfigTanks() {
    const { content, addButton } = configPage('Configure Tanks', 'Back to Tanks', 'atg.html', 'Add Tank');
    addButton.addEventListener('click', () => editTank(window.tanks.length));
   
    let productOptions = [];
    try {
        const data = await loadTanksFromDB();
        window.tanks = data.tanks;
        productOptions = data.products;
    } catch (error) {
        console.error('Load error:', error);
        content.innerHTML = '<div class="error">Failed to load tanks</div>';
        return;
    }

    const columns = ['Address', 'ATG Number', 'Product', 'Dip Chart', 'Max Capacity', 'Action'];
    const { tableContainer, tbody } = createTable(columns);
    content.appendChild(tableContainer);

    function createTankModal() {
        const overlay = createModalOverlay();
        const popup = document.createElement('div');
        popup.className = 'popup-modal';
        popup.style.width = '400px';
        popup.style.maxWidth = '90vw';

        const header = createHeader();
        
        const title = createTitle();
        title.textContent = 'Configure Tank';

        const closeButton = createCloseButton(overlay);
        
        header.appendChild(title);
        header.appendChild(closeButton);
        popup.appendChild(header);

        const form = document.createElement('form');
        form.id = 'tank-form';
        form.style.display = 'grid';
        form.style.gap = '15px';

        const addressContainer = createField('Address:', 'address');
        form.appendChild(addressContainer);

        const atgContainer = createField('ATG Number:', 'tank_id');
        form.appendChild(atgContainer);

        const productSelect = createDropdown('Select Product');
        productSelect.name = 'product';
        productOptions.forEach(product => {
            const option = document.createElement('option');
            option.value = product;
            option.textContent = PRODUCT_NAME_MAPPING[product.toLowerCase()] || product;
            productSelect.appendChild(option);
        });

        const productContainer = createField('Product:', productSelect);
        form.appendChild(productContainer);
        
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.name = 'dipChart';
        // fileInput.accept = '.csv,.xlsx,.xls,.txt';
        fileInput.accept = '.csv';
        fileInput.style.padding = '8px';
        fileInput.style.border = '1px solid #ddd';
        fileInput.style.borderRadius = '4px';
        fileInput.style.width = '90%';

        const dipChartContainer = createField('Dip Chart:', fileInput);
        form.appendChild(dipChartContainer);

        // Current file display (for edits)
        const currentFileContainer = document.createElement('div');
        currentFileContainer.id = 'current-file-container';
        currentFileContainer.style.display = 'none';
        currentFileContainer.style.padding = '8px';
        currentFileContainer.style.backgroundColor = '#f5f5f5';
        currentFileContainer.style.borderRadius = '4px';
        currentFileContainer.style.fontSize = '14px';
        form.appendChild(currentFileContainer);

        // Submit button
        const submitButton = createActionButton();
        submitButton.type = 'submit';
        submitButton.textContent = 'Save';
        form.appendChild(submitButton);

        popup.appendChild(form);

        return { overlay, popup, form, fileInput, currentFileContainer };
    }

    refreshTankTable();

    function refreshTankTable() {
        if (!tbody) return;
        
        tbody.innerHTML = '';
        
        const displayTanks = window.tanks;

        if (displayTanks.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6;
            td.style.textAlign = 'center';
            td.style.borderBottom = '1px solid #ddd';
            td.style.padding = '10px';
            td.textContent = 'No tanks configured';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        displayTanks.forEach((tank, index) => {
            const row = createRowInTableBody();

            createCellInTableBody(row, tank.address || '-');
            createCellInTableBody(row, tank.tank_id || '-');
            createCellInTableBody(row, tank.product || PRODUCT_NAME_MAPPING[productValue.toLowerCase()] || '-');
            createCellInTableBody(row, tank.dip_chart_path.split('/').pop() || 'No file');
            createCellInTableBody(row, `${tank.max_capacity_mm || 0} mm (${tank.max_capacity_ltr} L)` || '-');
            
            createActionCellInTableBody(row, {
                editText: 'Edit Tank',
                deleteText: 'Delete Tank',
                onEdit: () => editTank(index),
                onDelete: () => deleteTankPopup(index, row),
            });
            
            tbody.appendChild(tr);
        });
    }

    async function editTank(index) {
        const { overlay, popup, form, fileInput, currentFileContainer } = createTankModal();
        
        const tank = window.tanks[index] || { 
            address: '', 
            tank_id: '',
            product: '',
            conn_status: 0,
            connected_at: null,
            dip_chart_path: null
        };
        
        form.address.value = tank.address || '';
        form.tank_id.value = tank.tank_id || '';
        form.product.value = tank.product || '';

        // Show current file if exists
        if (tank.dip_chart_path) {
            currentFileContainer.style.display = 'block';
            const fileName = tank.dip_chart_path.split('/').pop();
            currentFileContainer.innerHTML = `<strong>Current file:</strong> ${fileName}`;
        }

        dragPopup(overlay, popup);

        form.onsubmit = async (e) => {
            e.preventDefault();
            
            const addressInput = form.address.value;
            if (!addressInput || isNaN(addressInput) || 
                parseInt(addressInput) < 1 || parseInt(addressInput) > 65535) {
                alert('Please enter a valid tank address between 1 and 65535');
                return;
            }
            
            let tank_id = tank.tank_id;

            const isDuplicate = window.tanks.some((t, i) => 
                i !== index && 
                t.address === addressInput.padStart(5, '0') && 
                t.tank_id === tank_id);
                
            if (isDuplicate) {
                alert('ATG number already exists at this address');
                return;
            }

            const address = addressInput.padStart(5, '0');

            // Get next tank_id for new tanks
            if (!tank_id) {
                const response = await fetch(`${API_BASE_URL}/tanks/next-id`);
                if (!response.ok) {
                    throw new Error('Failed to get next tank ID');
                }
                const data = await response.json();
                tank_id = data.next_id;
            }

            let max_capacity_mm = tank.max_capacity_mm || 0;
            let max_capacity_ltr = tank.max_capacity_ltr || 0;

            // Handle file upload if new file selected
            if (fileInput.files.length > 0) {
                try {
                    // First validate the file format
                    await validateDipChartCSV(fileInput.files[0]);
                    
                    const uploadResult = await uploadDipChartFile(fileInput.files[0]);
                    dip_chart_path = uploadResult.filePath;
                    max_capacity_mm = uploadResult.max_capacity_mm;
                    max_capacity_ltr = uploadResult.max_capacity_ltr;
                    
                    // Show preview of max values
                    alert(`Dip chart loaded successfully!\nMax capacity: ${max_capacity_mm} mm (${max_capacity_ltr} liters)`);
                } catch (error) {
                    // alert(`File validation failed: ${error.message}`);
                    alert(`Invalid File format.`);
                    return;
                }
            }

            const newTank = {
                id: tank.id,
                address: address,
                product: form.product.value,
                tank_id: form.tank_id.value,
                conn_status: tank.conn_status || 0,
                connected_at: tank.connected_at || null,
                dip_chart_path: dip_chart_path,
                max_capacity_mm: max_capacity_mm,
                max_capacity_ltr: max_capacity_ltr
            };

            try {
                const savedTank = await saveTankToDB(newTank, index < window.tanks.length);
                
                const updatedTank = {
                    ...newTank,
                    id: savedTank.id,
                    tank_id: savedTank.tank_id || newTank.tank_id,
                    max_capacity_mm: savedTank.max_capacity_mm || max_capacity_mm,
                    max_capacity_ltr: savedTank.max_capacity_ltr || max_capacity_ltr
                };

                if (index >= window.tanks.length) {
                    window.tanks.push(updatedTank);
                } else {
                    window.tanks[index] = updatedTank;
                }
                
                refreshTankTable();
                document.body.removeChild(overlay);
            } catch (error) {
                console.error('Save failed:', error);
                alert('Failed to save tank. Please try again.');
            }
        };
    }

    function deleteTankPopup(index, row) {
        const { overlay, popup, confirmButton, cancelButton, buttonContainer } = createDeletePopup('Are you sure you want to delete this tank?');

        confirmButton.onclick = async () => {
            const tank = window.tanks[index];
            
            try {
                if (tank.id) {
                    await deleteFromDB(`${API_BASE_URL}/tanks/${tank.id}`);
                }
                
                window.tanks.splice(index, 1);
                row.remove();
                document.body.removeChild(overlay);
                
                if (window.tanks.length === 0) {
                    refreshTankTable();
                }
            } catch (error) {
                console.error('Delete failed:', error);
                alert('Failed to delete tank. Please try again.');
            }
        };
    }
}

window.renderConfigTanks = renderConfigTanks;