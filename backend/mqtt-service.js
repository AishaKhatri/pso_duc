const mqtt = require('mqtt');
const chalk = require('chalk');
const pool = require('./db');
const fs = require('fs').promises;
const { getFormattedTimestamp, logPing, writeToLogFile, logWithTimestamp, errorWithTimestamp, NotificationService, clearLongOutageForAddress, ensureDAddress, stripDAddress, addressOutSql } = require('./backend-services');

const HISTORY_RECORD_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Maximum allowed values for DECIMAL(15,2)
const MAX_DECIMAL_VALUE = 9999999999999.99;

// Cache to deduplicate updates (using message hash)
const recentUpdates = new Map();
const DEDUPE_WINDOW = 5000; // 5 seconds

// Duration for offline timeout (in milliseconds)
const OFFLINE_TIMEOUT = 10 * 60 * 1000; // 10 minutes
// Track last msg_type: 0 message timestamp for each nozzle
const lastStatusMessage = new Map();

// Debounce disconnect alerts: only commit a disconnect to the DB if the
// device stays disconnected for this long. A reconnect that arrives inside
// the window cancels the pending write, so brief MQTT flaps no longer flip
// dispensers.conn_status to 0 or wipe nozzles.status.
const DISCONNECT_DEBOUNCE_MS = 2 * 60 * 1000;
const pendingDisconnects = new Map(); // addrD -> timeout handle

// const caPath = path.join(__dirname, 'ca_cert', 'rootCA.crt');

// Initialize MQTT client to connect to local EMQX via WebSocket
// const mqttClient = mqtt.connect('ws://localhost:8083/mqtt', {
// Initialize MQTT client to connect to HiveMQ public broker
// const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {

// const mqttClient = mqtt.connect('mqtts://72.255.62.111:8883', {
// const mqttClient = mqtt.connect('tcp://localhost:1883', {
const mqttClient = mqtt.connect('tcp://72.255.62.111:1883', {
    clientId: `server_local`,
    // clientId: `server`,
    keepalive: 0.5 * 60,  // 30 seconds
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30 * 1000,
    username: 'duc',
    password: 'SRT123',
//     rejectUnauthorized: true, // Validate server certificate
//     ca: fs.readFileSync('../assets/ca_cert/CAroot.crt'),
//     cert: fs.readFileSync('../assets/ca_cert/client.crt'),
//     key: fs.readFileSync('../assets/ca_cert/client.key')
});

const gsmConnectionCache = new Map(); // Track GSM connection state
const wifiConnectionCache = new Map(); // Track WiFi connection state
const gsmStatusCache = new Map(); // Cache for GSM status by dispenser address
const wifiStatusCache = new Map(); // Cache for Wi-Fi status by dispenser address
const mqttStatusCache = new Map();
const powerOnCache = new Map();
const clearedResetsCache = new Map();
const resetCounters = new Map();
const errorLogCache = new Map();
const deviceInfoCache = new Map();

// Track subscribed topics
const deviceTopics = new Set();
const statusTopics = new Set();

// Add notification service instance
let notificationService = null;

// Initialize notification service
function setNotificationService(service) {
    notificationService = service;
}

// Periodically check for nozzles that haven't sent msg_type: 0
function startOfflineCheck() {
    setInterval(async () => {
        try {
            const now = Date.now();
            for (const [nozzleId, { lastMessageTime, dispenser_id }] of lastStatusMessage) {
                if (now - lastMessageTime > OFFLINE_TIMEOUT) {
                    logWithTimestamp(chalk.red, `No ping received for nozzle ${nozzleId} in ${OFFLINE_TIMEOUT / 1000 / 60} minutes. Setting to offline.`);
                    // Update the specific nozzle's status to 0 (offline)
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { status: 0 }, true);
                    // Remove from tracking to avoid repeated updates
                    lastStatusMessage.delete(nozzleId);
                }
            }
        } catch (error) {
            errorWithTimestamp('Error in offline check:', error.message);
        }
    }, 10 * 1000); // Check every 10 seconds for more precise timing
}

async function initializeMQTTSubscriptions() {
    try {
        await subscribeToTopic('duc/registration', statusTopics);

        // Fetch all dispensers from the database — address normalized to D-prefixed.
        const [dispensers] = await pool.query(`
            SELECT d.dispenser_id, ${addressOutSql('d')} AS address, s.customer_code, s.city
            FROM dispensers d
            JOIN stations s ON d.customer_code = s.customer_code
        `);

        // Subscribe to each dispenser's topic and initialize nozzles
        const serverStartTime = Date.now();
        for (const dispenser of dispensers) {
            // MQTT slave topic uses the numeric portion: s<naked>
            const addrNaked = stripDAddress(dispenser.address);
            const addrD = ensureDAddress(dispenser.address);
            const topic = `pso/${dispenser.city}/${dispenser.customer_code}/duc/s${addrNaked}`;
            await subscribeToTopic(topic, deviceTopics);

            const conn_stat_topic = `duc/conn_status/${addrD}`;
            await subscribeToTopic(conn_stat_topic, statusTopics);

            // Fetch all nozzles for this dispenser
            const [nozzles] = await pool.query(
                'SELECT nozzle_id FROM nozzles WHERE dispenser_id = ?',
                [dispenser.dispenser_id]
            );
            // Initialize lastStatusMessage for each nozzle
            for (const nozzle of nozzles) {
                const nozzleId = nozzle.nozzle_id;
                if (!lastStatusMessage.has(nozzleId)) {
                    lastStatusMessage.set(nozzleId, {
                        lastMessageTime: serverStartTime - OFFLINE_TIMEOUT, // Mark as timed out immediately
                        dispenser_id: dispenser.dispenser_id
                    });
                }
            }
        }
    } catch (error) {
        errorWithTimestamp('Error fetching dispensers for MQTT subscriptions:', error.message);
    }
}

// Subscribe to a new dispenser topic
async function subscribeToTopic(topic, topicList) {
    if (topicList == null) {
        topicList = deviceTopics;
        if (topic.startsWith('S')) {
            const statusTopic = `duc/conn_status/D${topic.substring(1)}`;
            subscribeToTopic(statusTopic, statusTopics);
        } else{
            const statusTopic = `duc/conn_status/${topic}`;
            subscribeToTopic(statusTopic, statusTopics);
        }
    }
    
    if (!topicList.has(topic)) {
        mqttClient.subscribe(topic, { qos: 1 }, (err) => {
            if (!err) {
                logWithTimestamp(chalk.green, `Subscribed to ${topic}`);
                topicList.add(topic);
            } else {
                errorWithTimestamp(`Subscription error for ${topic}:`, err.message);
            }
        });
    }
}

// Unsubscribe from a dispenser topic
async function unsubscribeFromTopic(topic) {
    if (deviceTopics.has(topic)) {
        mqttClient.unsubscribe(topic, () => {
            logWithTimestamp(null, `Unsubscribed from ${topic}`);
            deviceTopics.delete(topic);
        });
    } else if (statusTopics.has(topic)) {
        mqttClient.unsubscribe(topic, () => {
            logWithTimestamp(null, `Unsubscribed from ${topic}`);
            statusTopics.delete(topic);
        });
    }
}

async function handleSalesMessage(customer_code, dispenser_id, nozzleId, message) {
    const transactions = parseTransactionMessage(message);

    if (!Array.isArray(transactions) || transactions.length === 0) {
        errorWithTimestamp(`Invalid data received in msg_type=7 for customer ${customer_code}, dispenser ${dispenser_id}, nozzle ${nozzleId}.`)
        return;
    }

    // Calculate total amount using reduce
    const total_sales_today = transactions.reduce((sum, tx) => sum + tx.amount, 0);                
    console.log(`Received ${transactions.length} transactions, total amount: ${total_sales_today}`);

    // Process each transaction in the message for the transactions table
    for (const tx of transactions) {
        await storeTransaction(
            customer_code,
            dispenser_id,
            nozzleId,
            tx.time,
            tx.amount,
            tx.volume
        );
    }

    // Update nozzles table with the last transaction's A and V
    const lastTransaction = transactions[transactions.length - 1];

    await updateNozzleInDatabase(dispenser_id, nozzleId, {
        price: parseFloat(lastTransaction.amount) || 0.00,
        quantity: parseFloat(lastTransaction.volume) || 0.00,
        total_sales_today: total_sales_today
    }, false);
}

function parseTransactionMessage(messageString) {
    const transactions = [];
    
    try {
        // Remove the outer curly braces and split by "},{" to get individual transactions
        const cleanedMessage = messageString.trim();
        
        // Extract individual transaction strings
        const transactionStrings = cleanedMessage.match(/\{[^}]+\}/g);
        
        if (!transactionStrings) {
            console.log('No transaction patterns found in message');
            return transactions;
        }

        for (const txString of transactionStrings) {
            try {
                // Remove the curly braces and split by commas
                const cleanTx = txString.replace(/[{}]/g, '');
                const parts = cleanTx.split(',').map(part => part.trim());
                
                if (parts.length >= 3) {
                    const timestamp = parseInt(parts[0]);
                    const amount = parseFloat(parts[1]);
                    const volume = parseFloat(parts[2]);
                    
                    // Validate the parsed values
                    if (!isNaN(timestamp) && !isNaN(amount) && !isNaN(volume)) {
                        const transactionTime = new Date(timestamp * 1000); // Convert Unix timestamp to JS Date
                        
                        transactions.push({
                            time: transactionTime,
                            amount: amount,
                            volume: volume,
                            raw: txString
                        });
                        
                        console.log(`Parsed transaction: Time=${transactionTime}, Amount=${amount}, Volume=${volume}`);
                    } else {
                        console.warn('Invalid transaction values:', parts);
                    }
                } else {
                    console.warn('Invalid transaction format, expected 3 parts:', parts);
                }
            } catch (txError) {
                console.error('Error parsing individual transaction:', txString, txError);
            }
        }
        
    } catch (error) {
        console.error('Error parsing transaction message:', error);
    }
    
    return transactions;
}

function handleDeviceStatusMessage(dispenserAddr, message) {
    try {
        let parsedMessage;
        let statusType;
        let timestamp;
        
        // Parse the message which could be string or object
        if (typeof message === 'string') {
            try {
                parsedMessage = JSON.parse(message);
            } catch {
                parsedMessage = { status: message };
            }
        } else {
            parsedMessage = message;
        }
        
        // Extract status and timestamp
        statusType = parsedMessage.Status || parsedMessage.status;
        timestamp = new Date(parsedMessage.T * 1000).toISOString();
        
        const status = {
            message: statusType,
            timestamp: timestamp,
            type: 'device_status',
            raw: parsedMessage
        };
        
        // Track GSM and WiFi connection states separately
        if (statusType.includes('GSM_') || statusType.includes('GPRS_')) {
            if (!gsmConnectionCache.has(dispenserAddr)) {
                gsmConnectionCache.set(dispenserAddr, []);
            }
            const gsmStatuses = gsmConnectionCache.get(dispenserAddr);
            gsmStatuses.push(status);
            // Keep only last 8 statuses
            if (gsmStatuses.length > 8) {
                gsmStatuses.shift();
            }
        } else if (statusType.includes('WIFI_')) {
            if (!wifiConnectionCache.has(dispenserAddr)) {
                wifiConnectionCache.set(dispenserAddr, []);
            }
            const wifiStatuses = wifiConnectionCache.get(dispenserAddr);
            wifiStatuses.push(status);
            // Keep only last 8 statuses
            if (wifiStatuses.length > 8) {
                wifiStatuses.shift();
            }
        }
        
        logWithTimestamp(null, `Device status updated for ${dispenserAddr}: ${statusType} at ${timestamp}`);
        return status;
    } catch (error) {
        errorWithTimestamp('Error parsing device status message:', error.message);
        return null;
    }
}

// Update get functions to return status history
function getGsmConnectionStatus(dispenserAddr) {
    return gsmConnectionCache.get(dispenserAddr) || [];
}

function getWifiConnectionStatus(dispenserAddr) {
    return wifiConnectionCache.get(dispenserAddr) || [];
}

async function handleGsmStatusMessage(dispenserAddr, gsmData) {
    try {
        const status = {
            gsm: {
                signalStrength: gsmData.GSM?.SignalStrength || 0,
                masterSIM: (() => {
                    const masterSimValue = gsmData.GSM?.MasterSim;
                    if (masterSimValue === 0) return 'SIM 1';
                    if (masterSimValue === 1) return 'SIM 2';
                    return 'UNKNOWN';
                })()
            },
            pdpContexts: gsmData.PdpContext ? gsmData.PdpContext.map(context => ({
                contextId: context.ContextId || 0,
                apn: context.Apn || '',
                ipv4: context.Ipv4 || context.IPv4 || '',
            })) : [],
            lastUpdated: new Date().toISOString()
        };
        
        gsmStatusCache.set(dispenserAddr, status);
        
        await storeNetworkStatusInDatabase(dispenserAddr, 'GSM', status);

        return status;
    } catch (error) {
        errorWithTimestamp('Error parsing GSM status:', error.message);
        return null;
    }
}

function getGsmStatus(dispenserAddr) {
    return gsmStatusCache.get(dispenserAddr) || null;
}

async function handleWiFiStatusMessage(dispenserAddr, wifiData) {
    try {
        const status = {
            status: wifiData.WIFI?.Status || null,
            ssid: wifiData.WIFI?.Ssid || null,
            ipv4: wifiData.WIFI?.Ipv4 || wifiData.WIFI?.IPv4 || null,
            signalStrength: wifiData.WIFI?.SignalStrength || null,
            lastUpdated: new Date().toISOString()
        };
        
        wifiStatusCache.set(dispenserAddr, status);
        await storeNetworkStatusInDatabase(dispenserAddr, 'WIFI', status);
        logWithTimestamp(chalk.null, `Wi-Fi status updated for ${dispenserAddr}`);
       
        return status;
    } catch (error) {
        errorWithTimestamp('Error parsing Wi-Fi status:', error.message);
        return null;
    }
}

function getWiFiStatus(dispenserAddr) {
    return wifiStatusCache.get(dispenserAddr) || null;
}

async function storeNetworkStatusInDatabase(deviceAddr, connectionType, statusData) {
    try {
        // deviceAddr can come in as either "D01" or "01" — normalize both forms
        // for the WHERE clause so legacy rows still match.
        const addrD = ensureDAddress(deviceAddr);
        const addrNaked = stripDAddress(deviceAddr);

        const [dispensers] = await pool.query(
            'SELECT customer_code FROM dispensers WHERE address IN (?, ?)',
            [addrD, addrNaked]
        );

        if (dispensers.length === 0) {
            errorWithTimestamp(`No dispenser found for address ${addrD}`);
            return;
        }
        const customerCode = dispensers[0].customer_code;
        const cleanAddr = addrD;

        let apn_ssid = null;
        let ipv4 = null;
        let signal_strength = null;
        let master_sim = null;

        if (connectionType === 'GSM') {
            // Extract from GSM status data
            if (statusData.pdpContexts && statusData.pdpContexts.length > 0) {
                const context = statusData.pdpContexts[0];
                apn_ssid = context.apn;
                ipv4 = context.ipv4;
            }
            signal_strength = statusData.gsm?.signalStrength || null;
            master_sim = statusData.gsm?.masterSIM === 'SIM 1' ? 0 : 
                        statusData.gsm?.masterSIM === 'SIM 2' ? 1 : null;
        } else if (connectionType === 'WIFI') {
            apn_ssid = statusData.ssid || null;
            ipv4 = statusData.ipv4 || null;
            signal_strength = statusData.signalStrength || null;
            master_sim = null; // Always null for WiFi
        }

        // Insert into database with customer_code
        await pool.query(
            `INSERT INTO network_status 
            (customer_code, address, connection_type, apn_ssid, ipv4, signal_strength, master_sim) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                customerCode,
                cleanAddr,
                connectionType,
                apn_ssid,
                ipv4,
                signal_strength,
                master_sim,
            ]
        );

        logWithTimestamp(null, `Network status stored in DB for ${deviceAddr} (${connectionType})`);
    } catch (error) {
        errorWithTimestamp('Error storing network status in database:', error.message);
    }
}

function handleMqttStatusMessage(dispenserAddr, mqttData) {
    try {
        const status = {
            started: mqttData.MQTT?.Started || false,
            clientAcquired: mqttData.MQTT?.ClientAcquired || false,
            brokerConnected: mqttData.MQTT?.BrokerConnected || false,
            subscribedTopics: mqttData.MQTT?.Subscribed || [],
            subscribedCount: mqttData.MQTT?.SubscribedCount || 0,
            lastUpdated: new Date().toISOString()
        };
        
        mqttStatusCache.set(dispenserAddr, status);
        logWithTimestamp(chalk.null, `MQTT status updated for ${dispenserAddr}`);
        return status;
    } catch (error) {
        errorWithTimestamp('Error parsing MQTT status:', error.message);
        return null;
    }
}

function getMqttStatus(dispenserAddr) {
    return mqttStatusCache.get(dispenserAddr) || null;
}

function handlePowerOnMessage(dispenserAddr, message) {
    try {       
        let parsedMessage;
        let statusType;
        let dieTime;
        let wakeupTime;
        let lastUpdated;
        let downtimeMs;
        
        if (typeof message === 'string') {
            try {
                parsedMessage = JSON.parse(message);
            } catch {
                parsedMessage = { status: message };
            }
        } else {
            parsedMessage = message;
        }
        
        statusType = parsedMessage.Status || parsedMessage.status;
        dieTime = parsedMessage.DT ? new Date(parsedMessage.DT * 1000) : null;
        wakeupTime = parsedMessage.WT ? new Date(parsedMessage.WT * 1000) : null;
        downtimeMs = wakeupTime && dieTime ? (wakeupTime - dieTime) : null;
        lastUpdated = new Date();
        
        // Get or create counter for this dispenser
        if (!resetCounters.has(dispenserAddr)) {
            resetCounters.set(dispenserAddr, 0);
        }
        const nextId = resetCounters.get(dispenserAddr) + 1;
        resetCounters.set(dispenserAddr, nextId);
        
        const status = {
            id: nextId,
            message: statusType,
            dieTime: dieTime,
            wakeupTime: wakeupTime,
            type: 'power_on',
            lastUpdated: lastUpdated,
            downtimeMs: downtimeMs
        };

        // Initialize array for this dispenser if it doesn't exist
        if (!powerOnCache.has(dispenserAddr)) {
            powerOnCache.set(dispenserAddr, []);
        }
        
        const powerOnStatuses = powerOnCache.get(dispenserAddr);
        powerOnStatuses.unshift(status);
        
        if (powerOnStatuses.length > 20) {
            powerOnStatuses.pop();
        }
        
        logWithTimestamp(chalk.cyan, `Power-on status updated for ${dispenserAddr}: ${statusType} (ID: ${nextId})`);
        
        return status;
    } catch (error) {
        errorWithTimestamp('Error parsing power-on message:', error.message);
        return null;
    }
}

function getPowerOnStatus(dispenserAddr) {
    return powerOnCache.get(dispenserAddr) || [];
}

async function handleErrorMessage(dispenserAddr, message) {
    try {
        logWithTimestamp(null, `Error logged for ${dispenserAddr}: ${message}`);
        
        // Also store in database for dispenser errors
        await storeErrorInDatabase(dispenserAddr, message);
        
    } catch (error) {
        errorWithTimestamp('Error processing error message:', error.message);
        return null;
    }
}

function getErrorLog(dispenserAddr) {
    return errorLogCache.get(dispenserAddr) || [];
}

function hasErrors(dispenserAddr) {
    const errors = errorLogCache.get(dispenserAddr);
    return errors && errors.length > 0;
}

async function storeErrorInDatabase(deviceAddr, errorMessage) {
    try {
        const addrD = ensureDAddress(deviceAddr);
        const addrNaked = stripDAddress(deviceAddr);

        const [dispensers] = await pool.query(
            'SELECT customer_code FROM dispensers WHERE address IN (?, ?)',
            [addrD, addrNaked]
        );

        if (dispensers.length === 0) {
            errorWithTimestamp(`No dispenser found for address ${addrD}`);
            return;
        }
        const customerCode = dispensers[0].customer_code;

        await pool.query(
            `INSERT INTO errors
            (customer_code, address, error_message)
            VALUES (?, ?, ?)`,
            [customerCode, addrD, errorMessage]
        );

        logWithTimestamp(null, `Error stored in database: ${customerCode} ${addrD} - ${errorMessage}`);
    } catch (error) {
        errorWithTimestamp('Error storing error in database:', error.message);
    }
}

async function handleDeviceInfoMessage(deviceAddr, deviceData, customerCode = null) {
    try {
        // Parse if string
        if (typeof deviceData === 'string') {
            try {
                deviceData = JSON.parse(deviceData);
            } catch (parseError) {
                errorWithTimestamp('Failed to parse device data string:', parseError.message);
                return null;
            }
        }

        const deviceInfo = {
            firmwareVersion: deviceData.FirmwareVersion || deviceData.fFirmwareVersion || null,
            hardwareVersion: deviceData.HardwareVersion || deviceData.fHardwareVersion || null,
            wifiEnable: deviceData.WifiEnable !== undefined ? deviceData.WifiEnable : 
                       (deviceData.fWifiEnable !== undefined ? deviceData.fWifiEnable : null),
            lastDieTime: deviceData.LastDieTime || deviceData.lLastDieTime || null,
            wakeupTime: deviceData.WakeUpTime || deviceData.lWakeUpTime || null,
            lastUpdated: new Date().toISOString()
        };
        
        deviceInfoCache.set(deviceAddr, deviceInfo);
        
        // Store in database
        await storeDeviceInfoInDatabase(deviceAddr, deviceInfo, customerCode);
        
        logWithTimestamp(null, `Device info updated for ${deviceAddr}:`);
        logWithTimestamp(null, `  Firmware: ${deviceInfo.firmwareVersion}`);
        logWithTimestamp(null, `  Hardware: ${deviceInfo.hardwareVersion}`);
        logWithTimestamp(null, `  WiFi Enable: ${deviceInfo.wifiEnable}`);
        logWithTimestamp(null, `  Last Die Time: ${deviceInfo.lastDieTime}`);
        logWithTimestamp(null, `  Wake Up Time: ${deviceInfo.wakeupTime}`);
        
        return deviceInfo;
    } catch (error) {
        errorWithTimestamp('Error parsing device info message:', error.message);
        return null;
    }
}

async function storeDeviceInfoInDatabase(deviceAddr, deviceInfo, customerCode = null) {
    try {
        // Only dispenser devices ("D…") have device info to store.
        if (!String(deviceAddr || '').startsWith('D')) return;

        const addrD = ensureDAddress(deviceAddr);
        const addrNaked = stripDAddress(deviceAddr);

        let finalCustomerCode = customerCode;
        if (!finalCustomerCode) {
            const [dispensers] = await pool.query(
                'SELECT customer_code FROM dispensers WHERE address IN (?, ?)',
                [addrD, addrNaked]
            );

            if (dispensers.length === 0) {
                errorWithTimestamp(`No dispenser found for address ${addrD}`);
                return;
            }
            finalCustomerCode = dispensers[0].customer_code;
        }

        const [result] = await pool.query(
            `INSERT INTO device_info
             (customer_code, address, firmware_version, hardware_version,
              wifi_enable, last_die_time, wakeup_time)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                finalCustomerCode,
                addrD,
                deviceInfo.firmwareVersion,
                deviceInfo.hardwareVersion,
                deviceInfo.wifiEnable,
                deviceInfo.lastDieTime,
                deviceInfo.wakeupTime
            ]
        );

        logWithTimestamp(null, `Device info stored for address ${addrD} - Record ID: ${result.insertId}`);
    } catch (error) {
        errorWithTimestamp('Error storing device info in database:', error.message);
    }
}

function getDeviceInfo(deviceAddr) {
    return deviceInfoCache.get(deviceAddr) || null;
}

// Helper function to handle connection/disconnection alerts
async function handleConnectionAlert(topic, alertData) {
    const clientId = alertData.clientid;
    if (!clientId || !clientId.startsWith('D')) return;

    const isConnection = alertData.status === 'Connected';
    const addrD = ensureDAddress(clientId);
    const addrNaked = stripDAddress(clientId);
    const eventAt = new Date(isConnection
        ? alertData.connected_at
        : alertData.disconnected_at);

    if (isConnection) {
        // If we were waiting out a debounce, this is a sub-minute flap —
        // the disconnect was never committed, so skip the connect work too
        // and let live state stay as it was.
        const pending = pendingDisconnects.get(addrD);
        if (pending) {
            clearTimeout(pending);
            pendingDisconnects.delete(addrD);
            logWithTimestamp(chalk.gray, `Dispenser ${clientId} reconnected within ${DISCONNECT_DEBOUNCE_MS / 1000}s — ignoring blip`);
            return;
        }
        await applyConnectionUpdate(addrD, addrNaked, clientId, true, eventAt);
        return;
    }

    // Disconnect: defer the write. If a timer is already running for this
    // address, leave it alone so the 1-minute clock measures from the first
    // drop (not the latest duplicate alert).
    if (pendingDisconnects.has(addrD)) return;

    const handle = setTimeout(() => {
        pendingDisconnects.delete(addrD);
        applyConnectionUpdate(addrD, addrNaked, clientId, false, eventAt)
            .catch(err => errorWithTimestamp(`Deferred disconnect write failed for ${addrD}: ${err.message}`));
    }, DISCONNECT_DEBOUNCE_MS);
    pendingDisconnects.set(addrD, handle);
}

async function applyConnectionUpdate(addrD, addrNaked, clientId, isConnection, eventAt) {
    const conn_status = isConnection ? 1 : 0;
    const action = isConnection ? 'connected' : 'disconnected';
    const color = isConnection ? chalk.green : chalk.red;

    const [dispensers] = await pool.query(
        'SELECT dispenser_id, customer_code FROM dispensers WHERE address IN (?, ?)',
        [addrD, addrNaked]
    );
    if (dispensers.length === 0) {
        logWithTimestamp(chalk.yellow, `No dispenser found in database for address: ${addrD}`);
        return;
    }

    const { dispenser_id, customer_code } = dispensers[0];
    const log = `Dispenser ${clientId} ${action}.`;
    logWithTimestamp(color, log);
    logPing(`${getFormattedTimestamp()} ${log} At ${getFormattedTimestamp(eventAt)} `);

    await pool.query(
        'INSERT INTO connections_history (dispenser_id, address, conn_status, connected_at) VALUES (?, ?, ?, ?)',
        [dispenser_id, addrD, conn_status, eventAt]
    );

    await pool.query(
        'UPDATE nozzles SET status = 0 WHERE dispenser_id = ?',
        [dispenser_id]
    );

    await pool.query(
        'UPDATE dispensers SET conn_status = ? WHERE address IN (?, ?)',
        [conn_status, addrD, addrNaked]
    );

    await pool.query(
        'UPDATE dispensers SET connected_at = ? WHERE address IN (?, ?)',
        [eventAt, addrD, addrNaked]
    );

    // Per-device connect/disconnect events no longer broadcast to the
    // dashboard alerts panel — only the 12h long-outage scanner raises
    // alerts (see backend-services.startLongOutageService). On reconnect,
    // close any open long-outage row for this address and notify the UI so
    // it can drop the alert.
    if (isConnection) {
        const cleared = await clearLongOutageForAddress(addrD);
        if (cleared.length > 0 && notificationService) {
            for (const row of cleared) {
                await notificationService.sendSystemNotification(
                    'Long Outage Cleared',
                    `Device ${addrD} back online`,
                    'success',
                    {
                        event: 'long_outage_cleared',
                        id: row.id,
                        address: addrD,
                        dispenser_id,
                        customer_code,
                        offline_since: row.offline_since
                    }
                );
            }
        }
    }
}

// Database update functions
async function updateNozzleInDatabase(dispenser_id, nozzle_id, updateData, bypassDeduplication = false) {
    try {
        const messageHash = JSON.stringify({ dispenser_id, nozzle_id, ...updateData });
        const now = Date.now();
        if (!bypassDeduplication && recentUpdates.has(messageHash)) {
            const [lastUpdateTime] = recentUpdates.get(messageHash);
            if (now - lastUpdateTime < DEDUPE_WINDOW) {
                logWithTimestamp(null, `Skipping duplicate update for ${dispenser_id}/${nozzle_id}`);
                return;
            }
        }

        const fields = [];
        const values = [];

        if (updateData.status !== undefined) {
            fields.push('status = ?');
            values.push(updateData.status);
        }
        if (updateData.price_per_liter !== undefined) {
            fields.push('price_per_liter = ?');
            values.push(Math.min(parseFloat(updateData.price_per_liter), MAX_DECIMAL_VALUE));
        }
        if (updateData.total_quantity !== undefined) {
            fields.push('total_quantity = ?');
            values.push(Math.min(parseFloat(updateData.total_quantity), MAX_DECIMAL_VALUE));
        }
        if (updateData.total_amount !== undefined) {
            fields.push('total_amount = ?');
            values.push(Math.min(parseFloat(updateData.total_amount), MAX_DECIMAL_VALUE));
        }
        if (updateData.total_sales_today !== undefined) {
            // FIX: Use simple addition with bounds checking in JavaScript
            const amountToAdd = Math.min(parseFloat(updateData.total_sales_today), MAX_DECIMAL_VALUE);
            
            // First get the current total_sales_today from the database
            const [currentRows] = await pool.query(
                'SELECT total_sales_today FROM nozzles WHERE dispenser_id = ? AND nozzle_id = ?',
                [dispenser_id, nozzle_id]
            );
            
            const currentTotal = currentRows[0] ? parseFloat(currentRows[0].total_sales_today) || 0 : 0;
            const newTotal = Math.min(currentTotal + amountToAdd, MAX_DECIMAL_VALUE);
            
            fields.push('total_sales_today = ?');
            values.push(newTotal);
        }
        if (updateData.lock_unlock !== undefined) {
            fields.push('lock_unlock = ?');
            values.push(updateData.lock_unlock);
        }
        if (updateData.keypad_lock_status !== undefined) {
            fields.push('keypad_lock_status = ?');
            values.push(updateData.keypad_lock_status);
        }
        if (updateData.price !== undefined) {
            fields.push('price = ?');
            values.push(Math.min(parseFloat(updateData.price), MAX_DECIMAL_VALUE));
        }
        if (updateData.quantity !== undefined) {
            fields.push('quantity = ?');
            values.push(Math.min(parseFloat(updateData.quantity), MAX_DECIMAL_VALUE));
        }

        if (fields.length === 0) {
            logWithTimestamp(null, `No fields to update for nozzle ${nozzle_id}`);
            return;
        }

        values.push(dispenser_id, nozzle_id);

        const [result] = await pool.query(
            `UPDATE nozzles SET ${fields.join(', ')}
            WHERE dispenser_id = ? AND nozzle_id = ?`,
            values
        );

        if (result.affectedRows > 0) {
            logWithTimestamp(null, `Nozzle ${nozzle_id} updated successfully`);
            recentUpdates.set(messageHash, [now]);
            setTimeout(() => recentUpdates.delete(messageHash), DEDUPE_WINDOW);
        } else {
            errorWithTimestamp(`No rows affected for nozzle ${nozzle_id} update`);
        }
    } catch (error) {
        errorWithTimestamp('Nozzle update error:', error.message);
    }
}

async function updateDispenserInDatabase(dispenser_id, updateData) {
    try {
        const fields = [];
        const values = [];

        if (updateData.ir_lock_status !== undefined) {
            fields.push('ir_lock_status = ?');
            values.push(updateData.ir_lock_status);
        }

        if (fields.length === 0) {
            logWithTimestamp(null, `No fields to update for dispenser ${dispenser_id}`);
            return;
        }

        values.push(dispenser_id);

        const [result] = await pool.query(
            `UPDATE dispensers SET ${fields.join(', ')}
            WHERE dispenser_id = ?`,
            values
        );

        if (result.affectedRows > 0) {
            logWithTimestamp(null, `Dispenser ${dispenser_id} updated successfully`);
        } else {
            errorWithTimestamp(`No rows affected for dispenser ${dispenser_id} update`);
        }
    } catch (error) {
        errorWithTimestamp('Dispenser update error:', error.message);
    }
}

async function storeTransaction(customer_code, dispenser_id, nozzle_id, time, amount, volume) {
    try {
        // First verify the nozzle exists with customer_code
        const [nozzles] = await pool.query(
            'SELECT id FROM nozzles WHERE customer_code = ? AND dispenser_id = ? AND nozzle_id = ?',
            [customer_code, dispenser_id, nozzle_id]
        );
        
        if (nozzles.length === 0) {
            errorWithTimestamp(`Nozzle not found: ${customer_code}/${dispenser_id}/${nozzle_id}`);
            return;
        }

        // Insert the transaction with customer_code
        await pool.query(
            `INSERT INTO transactions 
            (customer_code, dispenser_id, nozzle_id, time, amount, volume) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [
                customer_code,
                dispenser_id,
                nozzle_id,
                time,
                parseFloat(amount),
                parseFloat(volume)
            ]
        );
        
        logWithTimestamp(null, `Transaction recorded for nozzle ${nozzle_id}: ${amount} ${volume}`);
    } catch (error) {
        // errorWithTimestamp('Error storing transaction:', error.message);
    }
}

async function recordNozzleHistory() {
    try {
        logWithTimestamp(null, 'Starting nozzle history snapshot...');
        
        // Get all nozzles from the database
        const [nozzles] = await pool.query('SELECT * FROM nozzles');
        
        if (nozzles.length === 0) {
            logWithTimestamp(null, 'No nozzles found for history snapshot');
            return;
        }
        
        // Insert all current nozzle states into history
        for (const nozzle of nozzles) {
            await pool.query(
                `INSERT INTO nozzle_history (
                    customer_code, dispenser_id, nozzle_id, product, status, price_per_liter,
                    total_quantity, total_amount, total_sales_today, lock_unlock, keypad_lock_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    nozzle.customer_code,
                    nozzle.dispenser_id,
                    nozzle.nozzle_id,
                    nozzle.product,
                    nozzle.status,
                    parseFloat(nozzle.price_per_liter),
                    parseFloat(nozzle.total_quantity),
                    parseFloat(nozzle.total_amount),
                    parseFloat(nozzle.total_sales_today),
                    nozzle.lock_unlock,
                    nozzle.keypad_lock_status
                ]
            );
        }
        
        logWithTimestamp(null, `Successfully snapshotted ${nozzles.length} nozzles to history`);
    } catch (error) {
        errorWithTimestamp('Error during nozzle history snapshot:', error.message);
    }
}

async function registerNewDevice(message) {
    try {
        // Parse the nested message
        let deviceData = message;
        if (typeof message.message === 'string') {
            try {
                const parsedInnerMessage = JSON.parse(message.message);
                deviceData = { ...message, ...parsedInnerMessage };
            } catch (e) {
                errorWithTimestamp('Failed to parse registration message:', e.message);
                return;
            }
        }
        
        // Extract data from message
        const customerCode = deviceData.CustomerCode;
        const stationId = deviceData.StationId;
        const city = deviceData.City;
        const deviceAddress = (deviceData.dis_addr || deviceData.DeviceId || '').replace(/^D/, '');
        const imei1 = deviceData.IMEI1 || null;
        const imei2 = deviceData.IMEI2 || null;
        
        // Validate required fields
        if (!customerCode || !deviceAddress) {
            errorWithTimestamp('Missing required registration fields:', { customerCode, deviceAddress });
            return;
        }
        
        // Validate number of sides
        const numberOfSides = parseInt(deviceData.NumberOfSides);
        if (numberOfSides !== 1 && numberOfSides !== 2) {
            errorWithTimestamp(`Invalid number of sides: ${numberOfSides}. Must be 1 or 2`);
            return;
        }
        
        // Convert DispenserBrand from number to string
        let dispenserBrand = deviceData.DispenserBrand;
        if (dispenserBrand === '0' || dispenserBrand === 0) {
            dispenserBrand = 'Tatsuno';
        } else if (dispenserBrand === '1' || dispenserBrand === 1) {
            dispenserBrand = 'Wayne';
        } else {
            dispenserBrand = dispenserBrand || 'Unknown';
        }
        
        // Parse products
        const productsRaw = deviceData.Products || '';
        const productList = productsRaw.split(',').map(p => p.trim()).filter(p => p);
        
        if (productList.length === 0) {
            errorWithTimestamp('No products specified in registration message');
            return;
        }
        
        // Calculate nozzles per side
        const nozzlesPerSide = numberOfSides === 2 ? 1 : productList.length;
        const totalNozzles = numberOfSides * nozzlesPerSide;
        
        logWithTimestamp(null, `Processing registration for customer ${customerCode}:`);
        logWithTimestamp(null, `  City: ${city}, Address: ${deviceAddress}`);
        logWithTimestamp(null, `  Sides: ${numberOfSides}, Products: ${productList.join(', ')}`);
        
        // ===== 1. Check if station exists and create if not =====
        const [existingStations] = await pool.query(
            'SELECT id, customer_code FROM stations WHERE customer_code = ?',
            [customerCode]
        );
        
        if (existingStations.length === 0) {
            await pool.query(
                `INSERT INTO stations (username, password, customer_code, station_id, city) 
                 VALUES (?, ?, ?, ?, ?)`,
                [`station_${customerCode}`, 'default123', customerCode, stationId || customerCode, city || 'Unknown']
            );
            logWithTimestamp(chalk.green, `✓ New station registered: ${customerCode}`);
        } else {
            logWithTimestamp(chalk.blue, `✓ Station already exists: ${customerCode}`);
        }
        
        // ===== 2. Check if dispenser with this address already exists =====
        // deviceAddress comes from the device naked (e.g. "01"); accept either
        // stored form so legacy rows still match.
        const deviceAddressD = ensureDAddress(deviceAddress);
        const deviceAddressNaked = stripDAddress(deviceAddress);
        const [existingDispensers] = await pool.query(
            'SELECT customer_code, dispenser_id FROM dispensers WHERE address IN (?, ?) AND customer_code = ?',
            [deviceAddressD, deviceAddressNaked, customerCode]
        );
        
        let finalDispenserId;
        let isNewDispenser = false;
        
        if (existingDispensers.length === 0) {
            // Use the API to get next dispenser ID
            try {
                const response = await fetch(`http://localhost:3001/api/dispensers/next-id?customer_code=${customerCode}`);
                if (!response.ok) {
                    throw new Error('Failed to get next dispenser ID');
                }
                const data = await response.json();
                finalDispenserId = parseInt(data.next_id);
                isNewDispenser = true;
            } catch (error) {
                errorWithTimestamp('Error getting next dispenser ID:', error.message);
                return;
            }
            
            // Create new dispenser — store address D-prefixed.
            await pool.query(
                `INSERT INTO dispensers
                 (customer_code, dispenser_id, address, conn_status, connected_at,
                  ir_lock_status, number_of_nozzles, DispenserBrand, IMEI1, IMEI2)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    customerCode,
                    finalDispenserId,
                    deviceAddressD,
                    0, // conn_status - offline
                    null,
                    1, // ir_lock_status - unlocked
                    totalNozzles,
                    dispenserBrand,
                    imei1,
                    imei2
                ]
            );
            logWithTimestamp(chalk.green, `✓ New dispenser registered: ID ${finalDispenserId} (Address: ${deviceAddressD})`);

            // Slave topic uses the naked numeric portion; conn_status uses D-prefixed.
            const topic = `pso/${city}/${customerCode}/duc/s${deviceAddressNaked}`;
            await subscribeToTopic(topic, null);
            const connStatTopic = `duc/conn_status/${deviceAddressD}`;
            await subscribeToTopic(connStatTopic, statusTopics);
        } else {
            finalDispenserId = existingDispensers[0].dispenser_id;

            // Update IMEI fields if they exist and are different
            if (imei1 || imei2) {
                const updateFields = [];
                const updateValues = [];
                if (imei1) {
                    updateFields.push('imei1 = ?');
                    updateValues.push(imei1);
                }
                if (imei2) {
                    updateFields.push('imei2 = ?');
                    updateValues.push(imei2);
                }
                updateValues.push(customerCode, deviceAddressD, deviceAddressNaked);

                await pool.query(
                    `UPDATE dispensers SET ${updateFields.join(', ')} WHERE customer_code = ? AND address IN (?, ?)`,
                    updateValues
                );
                logWithTimestamp(chalk.blue, `✓ Updated IMEIs for existing dispenser: ${deviceAddressD}`);
            }

            logWithTimestamp(chalk.blue, `✓ Dispenser already exists: ID ${finalDispenserId}`);
        }

        // ===== 3. Register nozzles =====
        // Nozzle ID format: D{naked-address}-{side}{number}
        const dispenserAddressForNozzle = deviceAddressNaked;
        
        // Determine side-product mapping
        let sideProductMap = [];
        if (numberOfSides === 2) {
            sideProductMap = [
                { side: 'A', product: productList[0] || 'Unknown' },
                { side: 'B', product: productList[1] || productList[0] || 'Unknown' }
            ];
        } else {
            for (let i = 0; i < productList.length; i++) {
                sideProductMap.push({ side: 'A', product: productList[i] });
            }
        }
        
        let newNozzleCount = 0;
        
        for (const sideConfig of sideProductMap) {
            const side = sideConfig.side;
            const product = sideConfig.product;
            
            for (let nozzleNum = 1; nozzleNum <= nozzlesPerSide; nozzleNum++) {
                // nozzle_id is always D-prefixed, regardless of caller's form.
                const nozzleId = `${ensureDAddress(dispenserAddressForNozzle)}-${side}${nozzleNum}`;
                
                const [existingNozzles] = await pool.query(
                    'SELECT id FROM nozzles WHERE customer_code = ? AND dispenser_id = ? AND nozzle_id = ?',
                    [customerCode, finalDispenserId, nozzleId]
                );
                
                if (existingNozzles.length === 0) {
                    await pool.query(
                        `INSERT INTO nozzles 
                         (customer_code, dispenser_id, nozzle_id, product, status, 
                          price_per_liter, total_quantity, total_amount, 
                          total_sales_today, lock_unlock, keypad_lock_status, price, quantity) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            customerCode, finalDispenserId, nozzleId, product,
                            0, 0.00, 0.00, 0.00, 0.00,
                            0, 1, 0.00, 0.00
                        ]
                    );
                    newNozzleCount++;
                    logWithTimestamp(chalk.green, `  ✓ Added nozzle: ${nozzleId} (${product})`);
                } else {
                    logWithTimestamp(chalk.blue, `  ✓ Nozzle already exists: ${nozzleId}`);
                }
            }
        }
        
        if (newNozzleCount > 0) {
            logWithTimestamp(chalk.green, `✓ Added ${newNozzleCount} new nozzles`);
        }
        
        // ===== 4. Store device info =====
        if (deviceData.FirmwareVersion || deviceData.HardwareVersion || deviceData.WifiEnable !== undefined) {
            const deviceInfoMessage = {
                FirmwareVersion: deviceData.FirmwareVersion,
                HardwareVersion: deviceData.HardwareVersion,
                WifiEnable: deviceData.WifiEnable,
                LastDieTime: deviceData.LastDieTime,
                WakeUpTime: deviceData.WakeUpTime
            };
            await handleDeviceInfoMessage(deviceAddressD, deviceInfoMessage, customerCode);
        }

        logWithTimestamp(chalk.green.bold, `✅ Registration completed! Dispenser ID: ${finalDispenserId} (Address: ${deviceAddressD}) for customer ${customerCode}`);
        
    } catch (error) {
        errorWithTimestamp('Error registering new device:', error.message);
        errorWithTimestamp('Stack:', error.stack);
    }
}

// MQTT event handlers
mqttClient.on('connect', () => {
    logPing(`${getFormattedTimestamp()} Server connected to EMQX`);
    logWithTimestamp(null, 'MQTT client connected to broker');
    deviceTopics.clear(); // Clear subscriptions on new connection
    lastStatusMessage.clear(); // Clear status tracking on new connection
    initializeMQTTSubscriptions(); // Subscribe to all dispenser topics
    startOfflineCheck(); // Start periodic offline check

    // Start the periodic history snapshot
    setInterval(recordNozzleHistory, HISTORY_RECORD_INTERVAL);
    
    // Run the first snapshot immediately
    setTimeout(recordNozzleHistory, 5000);
});

mqttClient.on('message', async (receivedTopic, message) => {
    const messageStr = message.toString();
    let logColor = chalk.yellow;
    let parsedData;

    parsedData = JSON.parse(messageStr);
    const logMessage = `${getFormattedTimestamp()} Received message on ${receivedTopic}: ${messageStr}`;

    try {
        if (parsedData.msg_type === 0) {
            logColor = chalk.green; // Use green for msg_type: 0
            await logPing(logMessage);
        } else if (parsedData.msg_type === 10 || parsedData.msg_type === 11 || parsedData.msg_type === 12) {
            logColor = chalk.cyan; 
        } 
        else if (parsedData.msg_type === 16 ) {
            logColor = chalk.magenta; 
        }
    } catch (error) {
        errorWithTimestamp('Failed to parse message:', error.message);
        return;
    }

    logWithTimestamp(logColor, `Received message on ${receivedTopic}: ${messageStr}`);
    await writeToLogFile(logMessage);

    try {
        const data = parsedData;
        const dispenserAddr = data.dis_addr; // e.g., D55225
        const side = data.side === '0' || data.side === 'A' ? 'A' : 
                    data.side === '1' || data.side === 'B' ? 'B' : 
                    'Unknown';        
        const nozzleNum = data.noz_number;
        const nozzleId = `${dispenserAddr}-${side}${nozzleNum}`;
        let dbAddress;

        // Handle connection and disconnection alerts
        if (receivedTopic === `duc/conn_status/${data.clientid}`) {
            await handleConnectionAlert(receivedTopic, parsedData);
            return; // Exit after handling alert
        } else if (receivedTopic === 'duc/registration') {
            await registerNewDevice(parsedData);
            return;
        } else {
            // dispenserAddr from MQTT looks like "D55225"; keep both forms so
            // the lookup matches whichever the row stores.
            dbAddress = dispenserAddr;
        }

        // Find the corresponding dispenser in the database — match either stored form.
        const dbAddrD = ensureDAddress(dbAddress);
        const dbAddrNaked = stripDAddress(dbAddress);
        const [dispensers] = await pool.query(
            'SELECT dispenser_id FROM dispensers WHERE address IN (?, ?)',
            [dbAddrD, dbAddrNaked]
        );
        
        if (dispensers.length === 0) {
            errorWithTimestamp(`No dispenser found for address ${dbAddress}`);
            return;
        }

        const { dispenser_id } = dispensers[0];

        if (parsedData.req_type == 0 && parsedData.message !== '') {
            // Update database based on message type
            switch(data.msg_type) {
                case 0: // Online/offline status
                    if (data.message === "1") {
                        lastStatusMessage.set(nozzleId, { lastMessageTime: Date.now(), dispenser_id});
                    }
                    await pool.query(
                        'INSERT INTO ping_log (dispenser_id, nozzle_id, status) VALUES (?, ?, ?)',
                        [dispenser_id, nozzleId, data.message]
                    );
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { 
                        status: parseInt(data.message) 
                    }, false);
                    break;
                case 1: // Price per liter
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { 
                        price_per_liter: parseFloat(data.message) 
                    }, false);
                    break;
                case 2: // Total quantity
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { 
                        total_quantity: parseFloat(data.message) 
                    }, false);
                    break;
                case 3: // Total sales
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { 
                        total_amount: parseFloat(data.message) 
                    }, false);
                    break;
                case 4: // Nozzle lock
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { 
                        lock_unlock: parseInt(data.message) 
                    }, false);
                    break;
                case 5: // Keypad lock
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { 
                        keypad_lock_status: parseInt(data.message) 
                    }, false);
                    break;
                case 6: // IR lock
                    await updateDispenserInDatabase(dispenser_id, { 
                        ir_lock_status: parseInt(data.message) 
                    });
                    break;
                case 7: // Transaction data (T, A, V)
                    const [dispenserInfo] = await pool.query(
                        'SELECT customer_code FROM dispensers WHERE address IN (?, ?)',
                        [dbAddrD, dbAddrNaked]
                    );
                    if (dispenserInfo.length > 0) {
                        const customer_code = dispenserInfo[0].customer_code;
                        handleSalesMessage(customer_code, dispenser_id, nozzleId, data.message);
                    } else {
                        errorWithTimestamp(`Dispenser not found for ID: ${dispenser_id}`);
                    }
                    break;
                case 8: // Error message
                    await handleErrorMessage(dispenserAddr, data.message);
                    break;
                case 10: // Wireless connectivity status information
                    try {
                        if(data.message.includes('GSM')) {
                            const gsmData = JSON.parse(data.message);
                            handleGsmStatusMessage(dispenserAddr, gsmData);
                        } else if(data.message.includes('WIFI')) {
                            const wifiData = JSON.parse(data.message);
                            handleWiFiStatusMessage(dispenserAddr, wifiData);
                        }          
                    } catch (parseError) {
                        errorWithTimestamp('Failed to parse Wireless-Conn status message:', parseError.message);
                    }
                    break;
                case 11: // MQTT status information
                    try {
                        const mqttData = JSON.parse(data.message);
                        handleMqttStatusMessage(dispenserAddr, mqttData);
                    } catch (parseError) {
                        errorWithTimestamp('Failed to parse MQTT status message:', parseError.message);
                    }
                    break;
                case 12: // Power-on reset information
                    try {
                        handlePowerOnMessage(dispenserAddr, data.message);
                    } catch (parseError) {
                        errorWithTimestamp('Failed to parse Power-on status message:', parseError.message);
                    }
                    break;
                case 13: // Device status information (GPRS_CONNECTED, etc.)
                    try {
                        handleDeviceStatusMessage(dispenserAddr, data.message);
                        let notifType;
                        if (data.message === 'GPS_CONNECTED' || data.message === 'WIFI_CONNECTED' || data.message === 'GPRS_CONNECTED') {
                            notifType = 'success';
                        } else if (data.message === 'GPS_DISCONNECTED' || data.message === 'WIFI_DISCONNECTED' || data.message === 'GPRS_DISCONNECTED') {
                            notifType = 'error';
                        }                   
                        await notificationService.sendConnectivityNotification(
                            dispenserAddr,
                            'Connectivity Status',
                            `Device ${dispenserAddr}: ${data.message}`,
                            notifType
                        );
                    } catch (parseError) {
                        errorWithTimestamp('Failed to parse device status message:', parseError.message);
                    }
                    break;
                case 16: // Device information
                    try {
                        handleDeviceInfoMessage(dispenserAddr, data.message);
                    } catch (parseError) {
                        errorWithTimestamp('Failed to parse Device info message:', parseError.message);
                    }
                    break;
                default:
                    logWithTimestamp(null, 'Unknown message type:', data.msg_type);
            }
        } else {
            logWithTimestamp(chalk.red, `Invalid message received on topic ${receivedTopic}`);
        } 
    } catch (error) {
        errorWithTimestamp('Error processing MQTT message:', error.message);
    }
});

mqttClient.on('error', (err) => {
    errorWithTimestamp('MQTT client error:', err.message);
});

mqttClient.on('close', () => {
    logWithTimestamp(null, 'MQTT connection closed');
    deviceTopics.clear();
});

mqttClient.on('reconnect', () => {
    logWithTimestamp(null, 'Attempting to reconnect to MQTT broker');
});

mqttClient.on('offline', () => {
    logWithTimestamp(null, 'MQTT client is offline');
});

function publishMessage(topic, message, options = {}) {
    return new Promise((resolve, reject) => {
        if (!mqttClient || !mqttClient.connected) {
            return reject(new Error('MQTT client not connected'));
        }
        const publishOptions = { qos: 1, ...options };
        mqttClient.publish(topic, message, publishOptions, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

module.exports = {
    setNotificationService,
    subscribeToTopic,
    unsubscribeFromTopic,
    getGsmConnectionStatus,
    getWifiConnectionStatus,
    getGsmStatus,
    getWiFiStatus,
    getMqttStatus,
    getPowerOnStatus,
    clearedResetsCache,
    getErrorLog,
    getDeviceInfo,
    hasErrors,
    handleDeviceStatusMessage,
    handleGsmStatusMessage,
    handleWiFiStatusMessage,
    handleMqttStatusMessage,
    handlePowerOnMessage,
    handleErrorMessage,
    publishMessage
};