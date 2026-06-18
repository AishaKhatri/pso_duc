// Store layout type for each nozzle
const nozzleLayoutType = new Map();

// nozzles.status is tri-state from the backend:
//   1 = device + dispenser MB both reachable (msg_type=0 with value "1")
//   0 = device reachable but MB silent       (msg_type=0 with value "0")
//   2 = no recent ping                       (offline detector after 10 min)
function nozzleStatusLabel(code) {
    switch (Number(code)) {
        // case 1: return 'Active';
        // case 0: return 'Inactive';
        case 1: return 'Auto';
        case 0: return 'Manual';
        case 2: return 'No Ping';
        default: return 'Unknown';
    }
}

function normalizeFuelType(product) {
    if (!product) return 'Premier';
    const lowerProduct = product.toLowerCase().trim();
    if (lowerProduct.includes('pmg')) return 'PMG';
    if (lowerProduct.includes('hsd')) return 'HSD';
    if (lowerProduct.includes('hobc')) return 'HOBC';
    return 'Premier';
}

async function fetchNozzleData(customer_code, dispenser_id, nozzle_id) {
    try {
        const response = await fetch(`${API_BASE_URL}/nozzles?dispenser_id=${encodeURIComponent(dispenser_id)}&customer_code=${encodeURIComponent(customer_code)}`);
        if (!response.ok) throw new Error('Failed to fetch nozzles');
        const nozzles = await response.json();
        return nozzles.find(n => n.nozzle_id === nozzle_id);
    } catch (error) {
        console.error('Error fetching nozzle data:', error);
        return null;
    }
}

function updateNozzleUI(nozzleId, nozzleData) {
    try {
        const container = document.getElementById(`nozzle-${nozzleId}`);
        if (!container) return;

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
        address: stripDAddress(dispenserTopic),
        fuelType: normalizeFuelType(nozzle.product),
        statusCode: Number(nozzle.status),
        status: nozzleStatusLabel(nozzle.status),
        lastPingAt: nozzle.last_ping_at || null,
        price: parseFloat(nozzle.price) || 0.00,
        quantity: parseFloat(nozzle.quantity) || 0.00,
        pricePerLitre: parseFloat(nozzle.price_per_liter) || 0.00,
        totalQuantity: parseFloat(nozzle.total_quantity) || 0.00,
        totalSalesToday: parseFloat(nozzle.total_sales_today) || 0.00,
        totalPrice: parseFloat(nozzle.total_amount) || 0.00,
        lastUpdated: new Date().toLocaleString(),
        locked: !!nozzle.lock_unlock,
    };
}

function setNozzleLayoutType(nozzleId, layoutType) {
    nozzleLayoutType.set(nozzleId, layoutType);
}

function getNozzleLayoutType(nozzleId) {
    return nozzleLayoutType.get(nozzleId);
}

async function updateInterfaceLockStatus(dispenserId, lockStatus) {
    const dispenserCard = document.querySelector(`div[data-address="${dispenserId}"]`);
    if (dispenserCard) {
        const lockIcon = dispenserCard.querySelector('.interface-lock-icon');
        if (lockIcon) {
            const isLocked = lockStatus === 1;
            lockIcon.src = isLocked
                ? 'assets/graphics/green-lock.png'
                : 'assets/graphics/red-unlock.png';
            lockIcon.alt = isLocked ? 'Locked' : 'Unlocked';
        }
    }
}

async function sendGetCommandsForDispenser(dispenser) {
    const dis_addr = ensureDAddress(dispenser.address);

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
        const response = await fetch(`${API_BASE_URL}/nozzles?dispenser_id=${encodeURIComponent(dispenser.dispenser_id)}&customer_code=${encodeURIComponent(dispenser.customer_code)}`);
        if (!response.ok) throw new Error('Failed to fetch nozzles');
        const nozzles = await response.json();

        const existingNozzles = new Set();
        nozzles.forEach(nozzle => {
            const shortId = nozzle.nozzle_id.split('-').pop();
            existingNozzles.add(shortId);
        });

        const customerCode = dispenser.customer_code;

        let city = window.currentStation?.city || dispenser.city;
        if (!city) {
            try {
                const stationResp = await fetch(`${API_BASE_URL}/stations/${encodeURIComponent(customerCode)}`);
                if (stationResp.ok) {
                    const stationData = await stationResp.json();
                    city = stationData?.station?.city || '';
                }
            } catch (err) {
                console.error('Error fetching station city:', err);
            }
        }
        if (!city) city = 'NA';

        const publishTopic = `pso/${city}/${customerCode}/duc/d${stripDAddress(dispenser.address)}`;

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
                            topic: publishTopic,
                            message: message,
                            nozzleId: nozzleId,
                            msg_type: msg_type
                        });
                    }
                });
            }
        });

        // Send messages with delay between them via backend publish endpoint
        let delay = 0;
        messagesToSend.forEach((msg) => {
            setTimeout(async () => {
                try {
                    const userInfo = (typeof StationAuth !== 'undefined' && StationAuth.getUserInfo()) || null;
                    const resp = await fetch(`${API_BASE_URL}/dispensers/publish`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            topic: msg.topic,
                            message: msg.message,
                            userId: userInfo?.id ?? null,
                            username: userInfo?.username ?? null
                        })
                    });
                    if (!resp.ok) {
                        const err = await resp.json().catch(() => ({}));
                        console.error(`Error sending GET command for ${msg.nozzleId} msg_type ${msg.msg_type}:`, err.error || resp.statusText);
                    } else {
                        console.log(`Sent GET command for nozzle ${msg.nozzleId} msg_type ${msg.msg_type}`);
                        console.log(`topic:`, msg.topic);
                        console.log(`Message:`, msg.message);
                    }
                } catch (err) {
                    console.error(`Error sending GET command for ${msg.nozzleId} msg_type ${msg.msg_type}:`, err);
                }
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
window.nozzleStatusLabel = nozzleStatusLabel;
window.setNozzleLayoutType = setNozzleLayoutType;
window.getNozzleLayoutType = getNozzleLayoutType;
window.updateInterfaceLockStatus = updateInterfaceLockStatus;
window.updateNozzleUI = updateNozzleUI;
window.sendGetCommandsForDispenser = sendGetCommandsForDispenser;
