let updateInProgress = false;

async function showPriceUpdatePopup() {
    const overlay = createModalOverlay();

    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '300px';
    popup.style.maxHeight = '80vh';
    dragPopup(overlay, popup);

    const header = createHeader();
        
    const title = createTitle();
    title.textContent = 'Update Product Prices';

    const closeButton = createCloseButton(overlay);
    
    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const contentContainer = document.createElement('div');
    contentContainer.style.display = 'flex';
    contentContainer.style.gap = '20px';

    const formContainer = document.createElement('div');
    formContainer.style.flex = '1';
    formContainer.style.maxWidth = '300px';

    // Product selection dropdown
    const productLabel = document.createElement('label');
    productLabel.textContent = 'Select Product:';
    productLabel.style.display = 'block';
    productLabel.style.marginBottom = '8px';
    formContainer.appendChild(productLabel);

    const productSelect = createDropdown('Select product');
    
    const placeholderOption = createPlaceholder('Select product');
    productSelect.appendChild(placeholderOption);
    productSelect.disabled = false;
    productSelect.innerHTML = '';

    const products = ['PMG', 'HSD'];
    products.forEach(product => {
        const option = document.createElement('option');
        option.value = product;
        option.textContent = product;
        productSelect.appendChild(option);
    });

    formContainer.appendChild(productSelect);

    const priceLabel = document.createElement('label');
    priceLabel.textContent = 'New Price:';
    priceLabel.style.display = 'block';
    priceLabel.style.marginBottom = '8px';
    formContainer.appendChild(priceLabel);

    const priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.step = '0.01';
    priceInput.min = '0';
    priceInput.style.width = '100%';
    priceInput.style.maxWidth = '280px';
    priceInput.style.padding = '8px';
    priceInput.style.marginBottom = '20px';
    formContainer.appendChild(priceInput);

    contentContainer.appendChild(formContainer);
    popup.appendChild(contentContainer);

    const nozzlesContainer = document.createElement('div');
    nozzlesContainer.id = 'nozzlesList';
    nozzlesContainer.style.marginBottom = '20px';
    popup.appendChild(nozzlesContainer);

    const statusContainer = document.createElement('div');
    statusContainer.id = 'updateStatus';
    statusContainer.style.marginBottom = '20px';
    popup.appendChild(statusContainer);

    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.display = 'flex';
    buttonsContainer.style.justifyContent = 'flex-end';
    buttonsContainer.style.gap = '10px';

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    const updateButton = createActionButton();
    updateButton.textContent = 'Update Prices';
    
    updateButton.addEventListener('click', async () => {
        if (updateInProgress) return;

        const product = productSelect.value;
        const price = parseFloat(priceInput.value);

        if (!product || isNaN(price)) {
            showStatusMessage('Please select a product and enter a valid price', 'error');
            return;
        }

        updateInProgress = true;
        updateButton.disabled = true;
        updateButton.style.opacity = '0.7';
        updateButton.textContent = 'Updating...';

        try {
            await updatePrices(product, price, nozzlesContainer);
            showStatusMessage('Price update completed', 'success');
        } catch (error) {
            showStatusMessage('Error updating prices: ' + error.message, 'error');
        } finally {
            updateInProgress = false;
            updateButton.disabled = false;
            updateButton.style.opacity = '1';
            updateButton.textContent = 'Update Prices';
        }
    });

    buttonsContainer.appendChild(cancelButton);
    buttonsContainer.appendChild(updateButton);
    popup.appendChild(buttonsContainer);

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    initializeMQTTClient(null, (err) => {
        showStatusMessage('MQTT connection error: ' + err.message, 'error');
    });
}

function showStatusMessage(message, type) {
    const statusContainer = document.getElementById('updateStatus');
    statusContainer.innerHTML = '';

    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.style.padding = '10px';
    messageElement.style.borderRadius = '4px';
    messageElement.style.marginBottom = '10px';

    if (type === 'error') {
        messageElement.style.backgroundColor = '#ffebee';
        messageElement.style.color = '#c62828';
        messageElement.style.border = '1px solid #ef9a9a';
    } else {
        messageElement.style.backgroundColor = '#e8f5e9';
        messageElement.style.color = '#277158';
        messageElement.style.border = '1px solid #a5d6a7';
    }

    statusContainer.appendChild(messageElement);
}

async function updatePrices(product, newPrice, nozzlesContainer) {
    const statusIcons = nozzlesContainer.querySelectorAll('[id^="status-"]');
    statusIcons.forEach(icon => {
        icon.textContent = '';
        icon.style.color = '';
    });

    const nozzlesToUpdate = [];

    try {
        const dispensersResponse = await fetch(`${API_BASE_URL}/dispensers`);
        if (!dispensersResponse.ok) throw new Error('Failed to fetch dispensers');
        const dispensers = await dispensersResponse.json();

        for (const dispenser of dispensers) {
            const nozzlesResponse = await fetch(
                `${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}`
            );
            if (!nozzlesResponse.ok) continue;
            const nozzles = await nozzlesResponse.json();

            nozzles.forEach(nozzle => {
                const displayProduct = nozzle.product;
                if (displayProduct === product) {
                    nozzlesToUpdate.push({
                        nozzle,
                        dispenserAddr: dispenser.address.padStart(5, '0')
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error fetching nozzles for update:', error);
        throw error;
    }

    console.group('Starting price update process');
    console.log(`Product: ${product}`);
    console.log(`New Price: ${newPrice}`);
    console.log(`Nozzles to update: ${nozzlesToUpdate.length}`);
    console.groupEnd();

    const results = [];
    for (let i = 0; i < nozzlesToUpdate.length; i++) {
        const { nozzle, dispenserAddr } = nozzlesToUpdate[i];
        const [_, side, number] = nozzle.nozzle_id.match(/D\d+-([AB])(\d+)/);

        const message = {
            dis_addr: `D${dispenserAddr}`,
            req_type: 0,
            side: side === 'A' ? '0' : '1',
            noz_number: parseInt(number),
            msg_type: 1,
            message: newPrice.toString()
        };

        const statusIcon = document.getElementById(`status-${nozzle.nozzle_id}`);
        if (statusIcon) {
            statusIcon.textContent = '⏳';
            statusIcon.style.color = '#FFA500';
        }

        console.group(`Updating nozzle ${i+1}/${nozzlesToUpdate.length}`);
        console.log('Nozzle ID:', nozzle.nozzle_id);
        console.log('Message:', message);

        try {
            const result = await new Promise((resolve) => {
                publishPriceUpdate(`D${dispenserAddr}`, JSON.stringify(message), (err) => {
                    if (err) {
                        console.error('Publish error:', err);
                        if (statusIcon) {
                            statusIcon.textContent = '❌';
                            statusIcon.style.color = '#FF0000';
                        }
                        resolve({ success: false, error: err });
                    } else {
                        console.log('Publish successful');
                        if (statusIcon) {
                            statusIcon.textContent = '✓';
                            statusIcon.style.color = '#00AA00';
                        }
                        resolve({ success: true });
                    }
                });
            });

            results.push({ ...result, nozzleId: nozzle.nozzle_id });
        } catch (error) {
            console.error('Update failed:', error);
            results.push({
                success: false,
                nozzleId: nozzle.nozzle_id,
                error: error.message
            });
            if (statusIcon) {
                statusIcon.textContent = '❌';
                statusIcon.style.color = '#FF0000';
            }
        } finally {
            console.groupEnd();
        }
    }

    const failedUpdates = results.filter(r => !r.success);
    if (failedUpdates.length > 0) {
        console.group('Failed updates');
        failedUpdates.forEach(failed => {
            console.error(`Nozzle ${failed.nozzleId}:`, failed.error);
        });
        console.groupEnd();
        throw new Error(`${failedUpdates.length} nozzles failed to update`);
    }

    console.log('Price update completed successfully');
    return results;
}

window.showPriceUpdatePopup = showPriceUpdatePopup;