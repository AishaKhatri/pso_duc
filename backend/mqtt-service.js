const mqtt = require('mqtt');
const chalk = require('chalk');
const pool = require('./db');
const fs = require('fs').promises;
const { getFormattedTimestamp, logPing, writeToLogFile, logWithTimestamp, errorWithTimestamp, NotificationService } = require('./backend-services');
const dipChartService = require('./dip-chart-service');

const HISTORY_RECORD_INTERVAL = 30 * 60 * 1000; // 30 minutes

// Maximum allowed values for DECIMAL(15,2)
const MAX_DECIMAL_VALUE = 9999999999999.99;

// Cache to deduplicate updates (using message hash)
const recentUpdates = new Map();
const DEDUPE_WINDOW = 5000; // 5 seconds

// Duration for offline timeout (in milliseconds)
const OFFLINE_TIMEOUT = 3 * 60 * 1000; // 1 minute
// Track last msg_type: 0 message timestamp for each nozzle
const lastStatusMessage = new Map();

// const caPath = path.join(__dirname, 'ca_cert', 'rootCA.crt');

// Initialize MQTT client to connect to local EMQX via WebSocket
// const mqttClient = mqtt.connect('ws://localhost:8083/mqtt', {
// Initialize MQTT client to connect to HiveMQ public broker
// const mqttClient = mqtt.connect('wss://broker.hivemq.com:8884/mqtt', {

// const mqttClient = mqtt.connect('mqtts://72.255.62.111:8883', {
const mqttClient = mqtt.connect('tcp://localhost:1883', {
// const mqttClient = mqtt.connect('tcp://72.255.62.111:1883', {
    clientId: `server`,
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
        // Fetch all dispensers from the database
        const [dispensers] = await pool.query('SELECT dispenser_id, address FROM dispensers');
        
        // Subscribe to each dispenser's topic and initialize nozzles
        const serverStartTime = Date.now();
        for (const dispenser of dispensers) {
            // const topic = `S${dispenser.address.padStart(5, '0')}`;
            // const topic = `pso/karachi/103088/duc/s${dispenser.address.padStart(5, '0')}`;
            const topic = `pso/deraismailkhan/115610/duc/s${dispenser.address.padStart(5, '0')}`;
            await subscribeToTopic(topic, deviceTopics);
            
            const conn_stat_topic = `duc/conn_status/D${dispenser.address.padStart(5, '0')}`; 
            await subscribeToTopic(conn_stat_topic, statusTopics);

            await subscribeToTopic('duc/registration', statusTopics);

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
                logWithTimestamp(null, `Subscribed to ${topic}`);
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

async function handleSalesMessage(dispenser_id, nozzleId, message) {
    const transactions = parseTransactionMessage(message);

    if (!Array.isArray(transactions) || transactions.length === 0) {
        errorWithTimestamp(`Invalid data received in msg_type=7 for dispenser ${dispenser_id}, nozzle ${nozzleId}.`)
        return;
    }

    // Calculate total amount using reduce
    const total_sales_today = transactions.reduce((sum, tx) => sum + tx.amount, 0);                
    console.log(`Received ${transactions.length} transactions, total amount: ${total_sales_today}`);

    // Process each transaction in the message for the transactions table
    for (const tx of transactions) {
        await storeTransaction(
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
                status: gsmData.GSM?.Status || 'UNKNOWN',
                simInserted: gsmData.GSM?.SimInserted || false,
                registered: gsmData.GSM?.Registered || 0,
                cops: gsmData.GSM?.Cops || 0,
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
                // Store additional fields if they exist
                ...(context.ContextType && { contextType: context.ContextType }),
                ...(context.Username && { username: context.Username }),
                ...(context.Password && { password: context.Password })
            })) : [],
            lastUpdated: new Date().toISOString()
        };
        
        gsmStatusCache.set(dispenserAddr, status);
        
        await storeNetworkStatusInDatabase(dispenserAddr, 'GSM', status);

        logWithTimestamp(null, `GSM status updated for ${dispenserAddr}:`);
        logWithTimestamp(null, `  GSM Status: ${status.gsm.status}`);
        logWithTimestamp(null, `  Signal Strength: ${status.gsm.signalStrength}`);
        logWithTimestamp(null, `  Master SIM: ${status.gsm.masterSIM}`);
        logWithTimestamp(null, `  PDP Contexts: ${status.pdpContexts.length}`);
        
        status.pdpContexts.forEach(context => {
            logWithTimestamp(null, `    Context ${context.contextId}: ${context.apn} -> ${context.ipv4}`);
        });
        
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
        let deviceType, deviceId, cleanAddr;
        
        // Check if this is a dispenser device
        if (deviceAddr.startsWith('D')) {
            deviceType = 'dispenser';
            cleanAddr = deviceAddr.substring(1); // Remove 'D' prefix
            
            // Get dispenser_id from address
            const [dispensers] = await pool.query(
                'SELECT dispenser_id FROM dispensers WHERE address = ?',
                [cleanAddr]
            );
            
            if (dispensers.length === 0) {
                errorWithTimestamp(`No dispenser found for address ${cleanAddr}`);
                return;
            } else {
                deviceId = dispensers[0].dispenser_id;
            }
        }

        let apn_ssid = null;
        let ipv4 = null;
        let signal_strength = null;
        let master_sim = null;

        if (connectionType === 'GSM') {
            // Extract from PDP contexts (use the first one if available)
            if (statusData.pdpContexts && statusData.pdpContexts.length > 0) {
                const context = statusData.pdpContexts[0];
                apn_ssid = context.apn;
                ipv4 = context.ipv4;
            }
            signal_strength = statusData.gsm.signalStrength;
            master_sim = statusData.gsm.masterSIM === 'SIM 1' ? 0 : 
                        statusData.gsm.masterSIM === 'SIM 2' ? 1 : null;
        } else if (connectionType === 'WIFI') {
            apn_ssid = statusData.ssid;
            ipv4 = statusData.ipv4;
            signal_strength = statusData.signalStrength;
            master_sim = null; // Always null for WiFi
        }

        // Insert into database
        await pool.query(
            `INSERT INTO network_status 
            (device_id, address, connection_type, apn_ssid, ipv4, signal_strength, master_sim) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                deviceId,
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
        dieTime = parsedMessage.DT ? new Date(parsedMessage.DT * 1000) : null;
        wakeupTime = parsedMessage.WT ? new Date(parsedMessage.WT * 1000) : null;
        downtimeMs = wakeupTime - dieTime;
        lastUpdated = new Date();
        
        const status = {
            message: statusType,
            dieTime: dieTime,
            wakeupTime: wakeupTime,
            type: 'power_on',
            // raw: message.includes('raw=') ? parseInt(message.split('raw=')[1]) : null,
            lastUpdated: lastUpdated,
            downtimeMs: downtimeMs
        };

        if (!powerOnCache.has(dispenserAddr)) {
            powerOnCache.set(dispenserAddr, []);
        }
        const powerOnStatuses = powerOnCache.get(dispenserAddr);
        powerOnStatuses.push(status);
        // Keep only last 5 statuses
        if (powerOnStatuses.length > 5) {
            powerOnStatuses.shift();
        }

        // powerOnCache.set(dispenserAddr, status);
        logWithTimestamp(chalk.null, `Power-on status updated for ${dispenserAddr}: ${message}`);
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
        let deviceType, deviceId, cleanAddr;
        
        // Check if this is a dispenser device
        if (deviceAddr.startsWith('D')) {
            deviceType = 'dispenser';
            cleanAddr = deviceAddr.substring(1); // Remove 'D' prefix
            
            // Get dispenser_id from address
            const [dispensers] = await pool.query(
                'SELECT dispenser_id FROM dispensers WHERE address = ?',
                [cleanAddr]
            );
            
            if (dispensers.length === 0) {
                errorWithTimestamp(`No dispenser found for address ${cleanAddr}`);
                return;
            } else {
                deviceId = dispensers[0].dispenser_id;
            }
        } 
        await pool.query(
            `INSERT INTO errors 
            (device_id, address, error_message) 
            VALUES (?, ?, ?)`,
            [deviceId, cleanAddr, errorMessage]
        );
        
        logWithTimestamp(null, `Error stored in database: ${deviceType} ${deviceId} - ${errorMessage}`);
    } catch (error) {
        errorWithTimestamp('Error storing error in database:', error.message);
    }
}

async function handleDeviceInfoMessage(deviceAddr, deviceData) {
    try {
        if (typeof deviceData === 'string') {
            try {
                deviceData = JSON.parse(deviceData);
            } catch (parseError) {
                errorWithTimestamp('Failed to parse device data string:', parseError.message);
                return null;
            }
        }

        const deviceInfo = {
            temperature: parseFloat(deviceData.fTemperature) || 0.00,
            firmwareVersion: deviceData.fFirmwareVersion || 'Unknown',
            hardwareVersion: deviceData.fHardwareVersion || 'Unknown',
            macAddress: deviceData.achMacAddress || 'Unknown',
            serialNumber: deviceData.fSerialNumber || 'Unknown',
            lastDieTime: deviceData.lLastDieTime || 0,
            wakeupTime: deviceData.lWakeUpTime || 0,
            lastUpdated: new Date().toISOString()
        };
        
        deviceInfoCache.set(deviceAddr, deviceInfo);
        
        // Store in database as history
        await storeDeviceInfoInDatabase(deviceAddr, deviceInfo);
        
        logWithTimestamp(null, `Device info updated for ${deviceAddr}:`);
        logWithTimestamp(null, `  Firmware: ${deviceInfo.firmwareVersion}`);
        logWithTimestamp(null, `  Hardware: ${deviceInfo.hardwareVersion}`);
        logWithTimestamp(null, `  MAC: ${deviceInfo.macAddress}`);
        logWithTimestamp(null, `  Serial: ${deviceInfo.serialNumber}`);
        logWithTimestamp(null, `  Temperature: ${deviceInfo.temperature}°C`);
        
        return deviceInfo;
    } catch (error) {
        errorWithTimestamp('Error parsing device info message:', error.message);
        return null;
    }
}

async function storeDeviceInfoInDatabase(deviceAddr, deviceInfo) {
    try {
        let deviceType, deviceId, cleanAddr;
         
        // Check if this is a dispenser device
        if (deviceAddr.startsWith('D')) {
            deviceType = 'dispenser';
            cleanAddr = deviceAddr.substring(1); // Remove 'D' prefix
            
            // Get dispenser_id from address
            const [dispensers] = await pool.query(
                'SELECT dispenser_id FROM dispensers WHERE address = ?',
                [cleanAddr]
            );
            
            if (dispensers.length === 0) {
                errorWithTimestamp(`No dispenser found for address ${cleanAddr}`);
                return;
            } else {
                deviceId = dispensers[0].dispenser_id;
            }
        } 

        // Always insert new record - no unique constraint to prevent this
        const [result] = await pool.query(
            `INSERT INTO device_info 
            (device_id, address, temperature, firmware_version, hardware_version, 
             mac_address, serial_number, last_die_time, wakeup_time) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                deviceId,
                cleanAddr,
                deviceInfo.temperature,
                deviceInfo.firmwareVersion,
                deviceInfo.hardwareVersion,
                deviceInfo.macAddress,
                deviceInfo.serialNumber,
                deviceInfo.lastDieTime,
                deviceInfo.wakeupTime
            ]
        );

        logWithTimestamp(null, `Device info stored for ${deviceType} ${deviceId} (${cleanAddr}) - Record ID: ${result.insertId}`);
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

    const isConnection = alertData.status === 'Connected';
    const conn_status = isConnection ? 1 : 0;
    const action = isConnection ? 'connected' : 'disconnected';
    const color = isConnection ? chalk.green : chalk.red;
    const notifType = isConnection ? 'success' : 'error';

    // Check if this is a dispenser client (starts with 'D')
    if (clientId && (clientId.startsWith('D'))) {
        let deviceType = 'dispenser';
        let deviceAddr = clientId.substring(1); // Remove 'D' prefix
        let connectedAt;

        // await notificationService.sendConnectivityNotification(
        //     clientId,
        //     'Connectivity Status',
        //     `Device ${clientId} ${action}`,
        //     notifType
        // );

        // Update connected_at timestamp
        if (isConnection) {
            connectedAt = new Date(alertData.connected_at);                  
        } else {
            connectedAt = new Date(alertData.disconnected_at);                  
        }

        // For dispensers, update database as before
        if (deviceType === 'dispenser') {
            const [dispensers] = await pool.query(
                'SELECT dispenser_id FROM dispensers WHERE address = ?',
                [deviceAddr]
            );
            
            if (dispensers.length > 0) {
                const { dispenser_id } = dispensers[0];
                const log = `Dispenser ${clientId} ${action}.`;
                logWithTimestamp(color, log);
                logPing(`${getFormattedTimestamp()} ${log} At ${getFormattedTimestamp(connectedAt)} `);

                await pool.query(
                    'INSERT INTO connections_history (dispenser_id, address, conn_status, connected_at) VALUES (?, ?, ?, ?)',
                    [dispenser_id, deviceAddr, conn_status, connectedAt]
                );
                
                await pool.query(
                    'UPDATE nozzles SET status = 0 WHERE dispenser_id = ?',
                    [dispenser_id]
                );

                await pool.query(
                    'UPDATE dispensers SET conn_status = ? WHERE dispenser_id = ?',
                    [conn_status, dispenser_id]
                );

                await pool.query(
                    'UPDATE dispensers SET connected_at = ? WHERE dispenser_id = ?',
                    [connectedAt, dispenser_id]
                );
            } else {
                logWithTimestamp(chalk.yellow, `No dispenser found in database for address: ${deviceAddr}`);
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

async function storeTransaction(dispenser_id, nozzle_id, time, amount, volume) {
    try {
        // First verify the nozzle exists
        const [nozzles] = await pool.query(
            'SELECT id FROM nozzles WHERE dispenser_id = ? AND nozzle_id = ?',
            [dispenser_id, nozzle_id]
        );
        
        if (nozzles.length === 0) {
            errorWithTimestamp(`Nozzle not found: ${dispenser_id}/${nozzle_id}`);
            return;
        }

        // Insert the transaction
        await pool.query(
            `INSERT INTO transactions 
            (dispenser_id, nozzle_id, time, amount, volume) 
            VALUES (?, ?, ?, ?, ?)`,
            [
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
                    dispenser_id, nozzle_id, product, status, price_per_liter,
                    total_quantity, total_amount, total_sales_today, lock_unlock, keypad_lock_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
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
        const nozzles = message.nozzles || {};

        const nozzlesInfo = Object.keys(nozzles).map(nozzleId => ({
            nozzleId: `D${message.address}-${nozzleId}`,
            product: nozzles[nozzleId] || 'Unknown'
        }));

        const newDispenser = {
            // station_id: message.stationID,
            address: message.address,
            vendor: message.vendor,
            dispenser_id: message.disp_number,
            number_of_nozzles: nozzlesInfo.length,
            ir_lock_status: message.ir_lock_status || 1,
            nozzles: nozzlesInfo
        }

        const dispenserResponse = await fetch(`http://localhost:3001/api/dispensers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(newDispenser)
        });

        if (!dispenserResponse.ok) {
            const errorData = await dispenserResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to save dispenser');
        }

        for (const nozzle of newDispenser.nozzles) {
            const nozzleData = {
                // station_id: newDispenser.station_id,
                dispenser_id: newDispenser.dispenser_id,
                nozzle_id: nozzle.nozzleId,
                product: nozzle.product,
            };

            const nozzleResponse = await fetch(`http://localhost:3001/api/nozzles`, {
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
    } catch (error) {
        errorWithTimestamp('Error registering new device:', error.message);
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

    // Initialize dip chart cache
    initializeDipChartCache();

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
            // Convert Sxxxxx topic to xxxxx address for database query
            // dbAddress = receivedTopic.replace(/^S/, ''); // Remove 'S' prefix
            dbAddress = dispenserAddr.replace(/^D/, ''); // Remove 'S' prefix
        }
        
        // Find the corresponding dispenser in the database
        const [dispensers] = await pool.query(
            'SELECT dispenser_id FROM dispensers WHERE address = ?',
            [dbAddress]
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
                    handleSalesMessage(dispenser_id, nozzleId, data.message);
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
    getErrorLog,
    getDeviceInfo,
    hasErrors,
    handleDeviceStatusMessage,
    handleGsmStatusMessage,
    handleWiFiStatusMessage,
    handleMqttStatusMessage,
    handlePowerOnMessage,
    handleErrorMessage
};