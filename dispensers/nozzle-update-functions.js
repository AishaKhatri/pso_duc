// Store layout type for each nozzle
const nozzleLayoutType = new Map();

async function fetchNozzleData(customer_code, dispenser_id, nozzle_id) {
    try {
        const response = await fetch(`${API_BASE_URL}/nozzles?dispenser_id=${dispenser_id}&customer_code=${customer_code}`);
        if (!response.ok) throw new Error('Failed to fetch nozzles');
        const nozzles = await response.json();
        return nozzles.find(n => n.nozzle_id === nozzle_id);
    } catch (error) {
        console.error('Error fetching nozzle data:', error);
        return null;
    }
}

async function updateNozzleStatus(nozzleId, status) {
    const nozzleData = await getNozzleDataFromTopic(nozzleId);
    if (!nozzleData) return;

    const isActive = status === 1;
    nozzleData.status = isActive ? 'Active' : 'Inactive';
    nozzleData.lastUpdated = new Date().toLocaleString();

    updateNozzleUI(nozzleId, nozzleData);

    window.showNotification?.(
        `Nozzle ${nozzleData.nozzleId} is ${isActive ? 'Active' : 'Inactive'}`,
        isActive ? 'success' : 'error'
    );
}

async function getNozzleDataFromTopic(nozzleId) {
    const topic = nozzleId.split('-')[0];
    const shortNozzleId = nozzleId.split('-').pop();
    const dispenserCard = document.querySelector(`div[data-address="${topic}"]`);
    if (!dispenserCard) {
        console.warn(`No dispenser found for topic ${topic}`);
        return null;
    }

    const dispenserId = dispenserCard.id.split('-')[1];
    const customerCode = dispenserCard.querySelector('.card-title')?.textContent.split(': ')[1];

    const nozzle = await fetchNozzleData(customerCode, dispenserId, nozzleId);
    if (!nozzle) {
        console.warn(`No nozzle data found for ${nozzleId}`);
        return null;
    }

    const container = document.getElementById(`nozzle-${nozzleId}`);
    let layoutType = window.NOZZLE_LAYOUTS?.FULL || 'full';
    
    if (container && container.nozzleData) {
        layoutType = container.nozzleData.layoutType || layoutType;
    }
    
    const storedType = nozzleLayoutType.get(nozzleId);
    if (storedType) layoutType = storedType;

    return {
        nozzleId: shortNozzleId,
        fullNozzleId: nozzleId,
        dispenserId: nozzle.dispenser_id,
        fuelType: normalizeFuelType(nozzle.product),
        status: nozzle.status ? 'Active' : 'Inactive',
        price: parseFloat(nozzle.price) || 0.00,
        quantity: parseFloat(nozzle.quantity) || 0.00,
        pricePerLitre: parseFloat(nozzle.price_per_liter) || 0.00,
        totalQuantity: parseFloat(nozzle.total_quantity) || 0.00,
        totalSalesToday: parseFloat(nozzle.total_sales_today) || 0.00,
        totalPrice: parseFloat(nozzle.total_amount) || 0.00,
        lastUpdated: new Date().toLocaleString(),
        keypadStatus: nozzle.keypad_lock_status ? 'Locked' : 'Unlocked',
        locked: !!nozzle.lock_unlock,
        layoutType: layoutType
    };
}

function normalizeFuelType(product) {
    if (!product) return 'Premier';
    const lowerProduct = product.toLowerCase().trim();
    if (lowerProduct.includes('pmg')) return 'PMG';
    if (lowerProduct.includes('hsd')) return 'HSD';
    if (lowerProduct.includes('hobc')) return 'HOBC';
    return 'Premier';
}

function updateNozzleUI(nozzleId, nozzleData) {
    try {
        const container = document.getElementById(`nozzle-${nozzleId}`);
        if (!container) {
            console.warn(`Nozzle container nozzle-${nozzleId} not found`);
            return;
        }

        container.nozzleData = nozzleData;
        
        const layoutType = nozzleLayoutType.get(nozzleId) || nozzleData.layoutType || window.NOZZLE_LAYOUTS?.FULL || 'full';

        if (typeof window.createNozzleLayout === 'function') {
            setTimeout(() => {
                window.createNozzleLayout(`nozzle-${nozzleId}`, nozzleData, layoutType);
            }, 50);
        }
    } catch (error) {
        console.error('Error updating nozzle UI:', error);
    }
}

function NozzleData(nozzle) {
    const shortNozzleId = nozzle.nozzle_id.split('-').pop();
    const dispenserTopic = nozzle.nozzle_id.split('-')[0];
    
    return {
        nozzleId: shortNozzleId,
        fullNozzleId: nozzle.nozzle_id,
        dispenserId: nozzle.dispenser_id,
        dispenserTopic: dispenserTopic,
        address: dispenserTopic.replace(/^D/, ''),
        fuelType: normalizeFuelType(nozzle.product),
        status: nozzle.status ? 'Active' : 'Inactive',
        price: parseFloat(nozzle.price) || 0.00,
        quantity: parseFloat(nozzle.quantity) || 0.00,
        pricePerLitre: parseFloat(nozzle.price_per_liter) || 0.00,
        totalQuantity: parseFloat(nozzle.total_quantity) || 0.00,
        totalSalesToday: parseFloat(nozzle.total_sales_today) || 0.00,
        totalPrice: parseFloat(nozzle.total_amount) || 0.00,
        lastUpdated: new Date().toLocaleString(),
        keypadStatus: nozzle.keypad_lock_status ? 'Locked' : 'Unlocked',
        locked: !!nozzle.lock_unlock,
    };
}

function setNozzleLayoutType(nozzleId, layoutType) {
    nozzleLayoutType.set(nozzleId, layoutType);
}

function getNozzleLayoutType(nozzleId) {
    return nozzleLayoutType.get(nozzleId);
}

async function updateIRStatus(dispenserId, lockStatus) {
    const dispenserCard = document.querySelector(`div[data-address="${dispenserId}"]`);
    if (dispenserCard) {
        const irLockIcon = dispenserCard.querySelector('.ir-lock-icon');
        if (irLockIcon) {
            const isLocked = lockStatus === 1;
            irLockIcon.src = isLocked 
                ? 'assets/graphics/green-lock.png' 
                : 'assets/graphics/red-unlock.png';
            irLockIcon.alt = isLocked ? 'Locked' : 'Unlocked';
        }
    }
}

async function sendGetCommandsForDispenser(dispenser) {
    const topic = `D${dispenser.address}`;
    const dis_addr = `D${dispenser.address}`;
    
    // Configuration - comment out message types you don't want to request
    const messageTypesToRequest = {
        0: true,  // NOZ_STATUS
        1: true,  // PRICE
        2: true,  // TOTAL_VOLUME
        3: true,  // TOTAL_AMOUNT
        4: true,  // LOCK_UNLOCK
        5: true,  // KEYPAD_STATUS
        6: true   // IR_STATUS
    };

    // Delay between messages in milliseconds
    const DELAY_BETWEEN_MESSAGES = 500; // 500ms delay

    try {
        const response = await fetch(`${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}&customer_code=${dispenser.customer_code}`);
        if (!response.ok) throw new Error('Failed to fetch nozzles');
        const nozzles = await response.json();

        const existingNozzles = new Set();
        nozzles.forEach(nozzle => {
            const shortId = nozzle.nozzle_id.split('-').pop();
            existingNozzles.add(shortId);
        });

        const messagesToSend = [];
        
        ['A1', 'A2', 'B1', 'B2'].forEach(nozzleId => {
            if (existingNozzles.has(nozzleId)) {
                const side = nozzleId[0];
                const noz_number = nozzleId[1];
                
                Object.keys(messageTypesToRequest).forEach(msg_type => {
                    if (messageTypesToRequest[msg_type]) {
                        const message = {
                            dis_addr: dis_addr,
                            req_type: 1, // GET_VALUE
                            side: side,
                            noz_number: parseInt(noz_number),
                            msg_type: parseInt(msg_type),
                            message: "0"
                        };
                        
                        messagesToSend.push({
                            topic: topic,
                            message: JSON.stringify(message),
                            nozzleId: nozzleId,
                            msg_type: msg_type
                        });
                    }
                });
            }
        });

        // Send messages with delay between them
        let delay = 0;
        messagesToSend.forEach((msg, index) => {
            setTimeout(() => {
                publishMessage(msg.topic, msg.message, (err) => {
                    if (err) {
                        console.error(`Error sending GET command for ${msg.nozzleId} msg_type ${msg.msg_type}:`, err);
                    } else {
                        console.log(`Sent GET command for nozzle ${msg.nozzleId} msg_type ${msg.msg_type}`);
                    }
                });
            }, delay);
            
            delay += DELAY_BETWEEN_MESSAGES;
        });
        
        window.showNotification?.('Refresh commands sent for existing nozzles', 'info');
    } catch (error) {
        console.error('Error sending GET commands:', error);
        window.showNotification?.('Error sending refresh commands', 'error');
    }
}

// Export functions
window.NozzleData = NozzleData;
window.setNozzleLayoutType = setNozzleLayoutType;
window.getNozzleLayoutType = getNozzleLayoutType;
window.updateNozzleStatus = updateNozzleStatus;
window.updateIRStatus = updateIRStatus;
window.updateConnStatus = updateConnStatus;
window.getNozzleDataFromTopic = getNozzleDataFromTopic;
window.updateNozzleUI = updateNozzleUI;
window.sendGetCommandsForDispenser = sendGetCommandsForDispenser;
