async function fetchNozzleData(dispenser_id, nozzle_id) {
    try {
        const response = await fetch(`http://localhost:3001/api/nozzles?dispenser_id=${dispenser_id}`);
        if (!response.ok) throw new Error('Failed to fetch nozzles');
        const nozzles = await response.json();
        return nozzles.find(n => n.nozzle_id === nozzle_id);
    } catch (error) {
        console.error('Error fetching nozzle data:', error);
        return null;
    }
}

async function updateNozzleTransaction(nozzleId, transactionData) {
    const nozzleData = await getNozzleDataFromTopic(nozzleId);
    if (!nozzleData) return;

    // Sort transaction keys numerically and get the last entry
    const transactionKeys = Object.keys(transactionData).sort((a, b) => parseInt(a) - parseInt(b));
    const lastTransaction = transactionData[transactionKeys[transactionKeys.length - 1]];

    nozzleData.price = parseFloat(lastTransaction.A) || 0.00;
    nozzleData.quantity = parseFloat(lastTransaction.V) || 0.00;
    nozzleData.lastUpdated = new Date().toLocaleString();

    // Update total sales for the day
    // nozzleData.totalPrice = await updateTotalSales(nozzleId);

    // console.log(`Nozzle ${nozzleId} sales computed: Price ${nozzleData.totalPrice}`);

    updateNozzleUI(nozzleId, nozzleData);

    window.showNotification?.(
        `Nozzle ${nozzleData.nozzleId} transaction updated: Price ${nozzleData.price.toFixed(2)}, Quantity ${nozzleData.quantity.toFixed(2)}`,
        'success'
    );
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

async function updateKeypadLockStatus(nozzleId, lockStatus) {
    const nozzleData = await getNozzleDataFromTopic(nozzleId);
    if (!nozzleData) return;

    const isLocked = lockStatus === 1;
    nozzleData.keypadStatus = isLocked ? 'Locked' : 'Unlocked';
    nozzleData.lastUpdated = new Date().toLocaleString();

    updateNozzleUI(nozzleId, nozzleData);

    window.showNotification?.(
        `Nozzle ${nozzleData.nozzleId} keypad ${isLocked ? 'locked' : 'unlocked'}`,
        isLocked ? 'warning' : 'success'
    );
}

async function updatePricePerLiter(nozzleId, price) {
    const nozzleData = await getNozzleDataFromTopic(nozzleId);
    if (!nozzleData) return;

    nozzleData.pricePerLitre = typeof price === 'string' ? parseFloat(price) : price;
    nozzleData.lastUpdated = new Date().toLocaleString();

    updateNozzleUI(nozzleId, nozzleData);
}

async function updateTotalQuantity(nozzleId, quantity) {
    const nozzleData = await getNozzleDataFromTopic(nozzleId);
    if (!nozzleData) return;

    nozzleData.totalQuantity = typeof quantity === 'string' ? parseFloat(quantity) : quantity;
    nozzleData.lastUpdated = new Date().toLocaleString();

    updateNozzleUI(nozzleId, nozzleData);
}

async function updateTotalSales(nozzleId, totalSales) {
    const nozzleData = await getNozzleDataFromTopic(nozzleId);
    if (!nozzleData) return;

    // nozzleData.totalPrice = typeof totalSales === 'string' ? parseFloat(totalSales) : totalSales;
    nozzleData.totalSalesToday = 0.00;
    nozzleData.lastUpdated = new Date().toLocaleString();

    updateNozzleUI(nozzleId, nozzleData);
}

// async function updateTotalSales(nozzleId) {
//     try {
//         const response = await fetch(
//             `${API_BASE_URL}/transactions/by-nozzle?nozzle_id=${encodeURIComponent(nozzleId)}`
//         );
        
//         if (!response.ok) {
//             throw new Error(`HTTP error! status: ${response.status}`);
//         }

//         const transactions = await response.json();

//         // console.log(`computing total sales for nozzle ${nozzleId}`);

//         // Calculate total sales for today
//         const today = new Date().toDateString();
//         const todaySales = transactions.reduce((total, transaction) => {
//             const transactionDate = new Date(transaction.time).toDateString();
//             if (transactionDate === today) {
//                 return total + parseFloat(transaction.amount);
//             }
//             return total;
//         }, 0);

//         // console.log(`total sales for nozzle ${nozzleId}: `, todaySales);
        
//         return todaySales;

//     } catch (error) {
//         console.error('Error updating total sales: ', error);
//     }
// }

async function updateNozzleLockStatus(nozzleId, lockStatus) {
    const nozzleData = await getNozzleDataFromTopic(nozzleId);
    if (!nozzleData) return;

    const isLocked = lockStatus === 1;
    nozzleData.locked = isLocked;
    nozzleData.lastUpdated = new Date().toLocaleString();

    updateNozzleUI(nozzleId, nozzleData);

    window.showNotification?.(
        `Nozzle ${nozzleData.nozzleId} ${isLocked ? 'locked' : 'unlocked'}`,
        isLocked ? 'warning' : 'success'
    );
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

async function getNozzleDataFromTopic(nozzleId) {
    const topic = nozzleId.split('-')[0]; // e.g., D55225
    const shortNozzleId = nozzleId.split('-').pop(); // e.g., A1
    const dispenserCard = document.querySelector(`div[data-address="${topic}"]`);
    if (!dispenserCard) {
        console.warn(`No dispenser found for topic ${topic}`);
        return null;
    }

    const dispenserId = dispenserCard.id.split('-')[1];

    const nozzle = await fetchNozzleData(dispenserId, nozzleId);
    if (!nozzle) {
        console.warn(`No nozzle data found for ${nozzleId}`);
        return null;
    }

    // Cache existing nozzleData to preserve price and quantity
    const container = document.getElementById(`nozzle-${nozzleId}`);
    let existingNozzleData = null;
    if (container && container.nozzleData) {
        existingNozzleData = container.nozzleData;
    }

    return {
        nozzleId: shortNozzleId,
        fullNozzleId: nozzleId,
        fuelType: normalizeFuelType(nozzle.product),
        status: nozzle.status ? 'Active' : 'Inactive',
        price: parseFloat(nozzle.price) || 0.00,
        quantity: parseFloat(nozzle.quantity) || 0.00,
        pricePerLitre: parseFloat(nozzle.price_per_liter) || 0.00,
        totalQuantity: parseFloat(nozzle.total_quantity) || 0.00,
        totalPrice: parseFloat(nozzle.total_amount) || 0.00,
        totalSalesToday: parseFloat(nozzle.total_sales_today) || 0.00,
        lastUpdated: new Date().toLocaleString(),
        keypadStatus: nozzle.keypad_lock_status ? 'Locked' : 'Unlocked',
        locked: !!nozzle.lock_unlock
    };
}

function normalizeFuelType(product) {
    if (!product) return 'Premier';
    const lowerProduct = product.toLowerCase().trim();
    if (lowerProduct.includes('pmg')) return 'PMG';
    if (lowerProduct.includes('hsd')) return 'HSD';
    return 'Premier';
}

function updateNozzleUI(nozzleId, nozzleData) {
    try {
        const container = document.getElementById(`nozzle-${nozzleId}`);
        if (!container) {
            console.warn(`Nozzle container nozzle-${nozzleId} not found`);
            return;
        }

        // Store nozzleData on the container for future reference
        container.nozzleData = nozzleData;

        console.debug(`Found nozzle container: nozzle-${nozzleId}`);
        if (typeof window.createNozzleLayout === 'function') {
            setTimeout(() => {
                window.createNozzleLayout(`nozzle-${nozzleId}`, nozzleData);
            }, 50);
        } else {
            console.warn('createNozzleLayout function not found');
        }
    } catch (error) {
        console.error('Error updating nozzle UI:', error);
    }
}

function NozzleData(nozzle) {
    const shortNozzleId = nozzle.nozzle_id.split('-').pop();
    return {
        nozzleId: shortNozzleId,
        fullNozzleId: nozzle.nozzle_id,
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
        locked: !!nozzle.lock_unlock
    };
}

async function sendGetCommandsForDispenser(dispenser) {
    const topic = `D${dispenser.address.padStart(5, '0')}`;
    const dis_addr = `D${dispenser.address.padStart(5, '0')}`;
    
    // Configuration - comment out message types you don't want to request
    const messageTypesToRequest = {
        0: true,  // NOZ_STATUS
        1: true,  // PRICE
        2: true,  // TOTAL_VOLUME
        3: true,  // TOTAL_AMOUNT
        // 4: true,  // LOCK_UNLOCK
        // 5: true,  // KEYPAD_STATUS
        // 6: true   // IR_STATUS
    };

    // Delay between messages in milliseconds
    const DELAY_BETWEEN_MESSAGES = 500; // 500ms delay

    try {
        // Fetch the actual nozzles for this dispenser
        const response = await fetch(`${API_BASE_URL}/nozzles?dispenser_id=${dispenser.dispenser_id}`);
        if (!response.ok) throw new Error('Failed to fetch nozzles');
        const nozzles = await response.json();

        // Create a set of existing nozzle IDs (like "A1", "B2", etc.)
        const existingNozzles = new Set();
        nozzles.forEach(nozzle => {
            const shortId = nozzle.nozzle_id.split('-').pop(); // Extract A1/B1/etc.
            existingNozzles.add(shortId);
        });

        // Collect all messages to be sent
        const messagesToSend = [];
        
        ['A1', 'A2', 'B1', 'B2'].forEach(nozzleId => {
            if (existingNozzles.has(nozzleId)) {
                const side = nozzleId[0] === 'A' ? '0' : '1';
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

window.NozzleData = NozzleData;
window.updateNozzleTransaction = updateNozzleTransaction;
window.updateNozzleStatus = updateNozzleStatus;
window.updateKeypadLockStatus = updateKeypadLockStatus;
window.updatePricePerLiter = updatePricePerLiter;
window.updateTotalQuantity = updateTotalQuantity;
window.updateTotalSales = updateTotalSales;
window.updateNozzleLockStatus = updateNozzleLockStatus;
window.updateIRStatus = updateIRStatus;
window.getNozzleDataFromTopic = getNozzleDataFromTopic;
window.updateNozzleUI = updateNozzleUI;
window.sendGetCommandsForDispenser = sendGetCommandsForDispenser;