const mqtt = require('mqtt');
const chalk = require('chalk');
const crypto = require('crypto');
const pool = require('./db');
const fs = require('fs').promises;
const { getFormattedTimestamp, logPing, writeToLogFile, logPriceDebug, logWithTimestamp, errorWithTimestamp, NotificationService, clearLongOutageForAddress, ensureDAddress, stripDAddress, addressOutSql } = require('./backend-services');

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
// device stays disconnected for this long.
const DISCONNECT_DEBOUNCE_MS = 30 * 60 * 1000;
const pendingDisconnects = new Map(); // addrD -> timeout handle

// Addresses queued by the "Refresh Conn Status" admin action. The next
// conn_status message that arrives for any address in this set bypasses ALL
// debounce / flap-suppression logic
const refreshForceCommit = new Set(); // Set<addrD>

// conn_status values stored in the dispensers table:
//   0 = disconnected, 1 = connected, 2 = unknown.
// "unknown" means a refresh (server reconnect / bulk refresh / per-card
// refresh) re-subscribed to the device's duc/conn_status topic and the broker
// redelivered NO retained message at all — we genuinely don't know its state.
const CONN_STATUS_UNKNOWN = 2;

// After a refresh re-subscribes to conn_status topics, the broker redelivers
// each device's retained message almost immediately. This is how long we wait
// for those retained messages before sweeping any still-silent address to
// "unknown" (2). An address is still-silent if it remains in refreshForceCommit
// after the window — a message would have consumed its entry in
// handleConnectionAlert.
const UNKNOWN_SWEEP_MS = 10 * 1000;

// Schedule a one-shot sweep: after UNKNOWN_SWEEP_MS, any of `addresses` still
// armed in refreshForceCommit never received a conn_status message since the
// refresh, so mark it unknown (2). Addresses that DID get a message were
// already committed (and de-armed) by handleConnectionAlert.
function scheduleUnknownSweep(addresses) {
    const armed = addresses.filter(Boolean);
    if (armed.length === 0) return;
    setTimeout(async () => {
        const silent = armed.filter(a => refreshForceCommit.has(a));
        if (silent.length === 0) return;
        for (const addrD of silent) refreshForceCommit.delete(addrD);
        try {
            // Match both stored forms (D-prefixed and naked) like the rest of
            // the conn_status writes do.
            const forms = [];
            const params = [CONN_STATUS_UNKNOWN];
            for (const addrD of silent) {
                forms.push('?', '?');
                params.push(addrD, stripDAddress(addrD));
            }
            // Stamp connected_at = now so the row records when the state went
            // unknown. It stays hidden in the UI for the unknown state.
            await pool.query(
                `UPDATE dispensers SET conn_status = ?, connected_at = NOW() WHERE address IN (${forms.join(', ')})`,
                params
            );
            logWithTimestamp(chalk.yellow,
                `Conn-status refresh: ${silent.length} dispenser(s) received no conn_status message — set to unknown`);
        } catch (err) {
            errorWithTimestamp(`Unknown-sweep write failed: ${err.message}`);
        }
    }, UNKNOWN_SWEEP_MS);
}

// Topic DUCs publish an ACK on after they apply a price-update message.
const PRICE_ACK_TOPIC = 'duc/acked_msgs';

// In-memory price-update job ledger. /api/admin/price-update/publish creates
// an entry per (city, customer, product) batch; ACKs from DUCs flip the
// per-device flag inside. The frontend polls /api/admin/price-update/acks/:id
// to render progress. Jobs are evicted after PRICE_JOB_TTL_MS — the operator
// can't track a stale job forever.
const priceUpdateJobs = new Map(); // jobId -> { createdAt, items: Array<{product, topic, ducs: Set<addrD>, acked: Map<addrD, isoTime>}> }
const PRICE_JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

if (!process.env.MQTT_BROKER_URL || !process.env.MQTT_USERNAME || !process.env.MQTT_PASSWORD) {
    errorWithTimestamp('MQTT_BROKER_URL / MQTT_USERNAME / MQTT_PASSWORD missing from .env');
    throw new Error('Missing MQTT broker configuration');
}
const mqttClient = mqtt.connect(process.env.MQTT_BROKER_URL, {
    clientId: process.env.MQTT_CLIENT_ID || 'server_local',
    // clientId: `server`,
    keepalive: 0.5 * 60,  // 30 seconds
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30 * 1000,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
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

// Outstanding GET_VALUE (req_type=1) requests published on behalf of the
// frontend. Devices publish req_type=0 value reports periodically on their own,
// so an incoming value report is only treated as a *reply* (and surfaced to the
// UI's "GET Data" log) when it matches one of these expectations. Keyed by
// `${D-addr}|${side}${noz}|${msg_type}`; each entry self-expires.
const pendingGetRequests = new Map();
const GET_REQUEST_TTL = 60000; // drop an unanswered expectation after 60s

function _getReqKey(disAddrD, side, noz_number, msg_type) {
    return `${disAddrD}|${side}${noz_number}|${msg_type}`;
}

function _normalizeSide(side) {
    if (side === '0' || side === 'A') return 'A';
    if (side === '1' || side === 'B') return 'B';
    return String(side);
}

// Called by the /api/dispensers/publish route whenever it publishes a GET_VALUE
// command, so the reply that comes back can be recognised and pushed to the UI.
function registerGetRequest(message) {
    if (!message || Number(message.req_type) !== 1) return;
    const key = _getReqKey(
        ensureDAddress(message.dis_addr),
        _normalizeSide(message.side),
        message.noz_number,
        message.msg_type
    );
    pendingGetRequests.set(key, Date.now());
    setTimeout(() => pendingGetRequests.delete(key), GET_REQUEST_TTL);
}

// Periodically check for nozzles that haven't sent msg_type: 0
function startOfflineCheck() {
    setInterval(async () => {
        try {
            const now = Date.now();
            for (const [nozzleId, { lastMessageTime, dispenser_id }] of lastStatusMessage) {
                if (now - lastMessageTime > OFFLINE_TIMEOUT) {
                    logWithTimestamp(chalk.red, `No ping received for nozzle ${nozzleId} in ${OFFLINE_TIMEOUT / 1000 / 60} minutes. Setting to offline (status=2).`);
                    await updateNozzleInDatabase(dispenser_id, nozzleId, { status: 2 }, true);
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
        const armedForSweep = [];
        for (const dispenser of dispensers) {
            // MQTT slave topic uses the numeric portion: s<naked>
            const addrNaked = stripDAddress(dispenser.address);
            const addrD = ensureDAddress(dispenser.address);
            const topic = `pso/${dispenser.city}/${dispenser.customer_code}/duc/s${addrNaked}`;
            await subscribeToTopic(topic, deviceTopics);

            // Arm a one-shot force-commit BEFORE (re)subscribing so the retained
            // conn_status the broker redelivers on this connect bypasses the
            // keepalive-dedup guard in handleConnectionAlert and writes the
            // broker's truth (conn_status + connected_at) immediately. This is
            // what restores the "a server reconnect refreshes every device's
            // status" behavior; steady-state dedup resumes from the next message.
            refreshForceCommit.add(addrD);
            armedForSweep.push(addrD);

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

        // Any device whose retained conn_status the broker doesn't redeliver
        // within the window is left "unknown".
        scheduleUnknownSweep(armedForSweep);
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

async function handlePowerOnMessage(dispenserAddr, message) {
    try {
        let parsedMessage;
        if (typeof message === 'string') {
            try {
                parsedMessage = JSON.parse(message);
            } catch {
                parsedMessage = { status: message };
            }
        } else {
            parsedMessage = message;
        }

        const statusType = parsedMessage.Status || parsedMessage.status || null;
        const dieTime = parsedMessage.DT ? new Date(parsedMessage.DT * 1000) : null;
        const wakeupTime = parsedMessage.WT ? new Date(parsedMessage.WT * 1000) : null;
        const downtimeMs = (wakeupTime && dieTime) ? (wakeupTime - dieTime) : null;

        const addrD = ensureDAddress(dispenserAddr);
        const addrNaked = stripDAddress(dispenserAddr);

        const [dispensers] = await pool.query(
            'SELECT customer_code FROM dispensers WHERE address IN (?, ?)',
            [addrD, addrNaked]
        );
        if (dispensers.length === 0) {
            errorWithTimestamp(`No dispenser found for address ${addrD} (power-on message)`);
            return null;
        }
        const customerCode = dispensers[0].customer_code;

        const dedupSource = [
            addrD,
            dieTime ? dieTime.toISOString() : '0',
            wakeupTime ? wakeupTime.toISOString() : '0',
            statusType || ''
        ].join('|');
        const dedupKey = crypto.createHash('md5').update(dedupSource).digest('hex');

        const [result] = await pool.query(
            `INSERT IGNORE INTO resets
             (customer_code, address, message, die_time, wakeup_time, downtime_ms, dedup_key)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [customerCode, addrD, statusType, dieTime, wakeupTime, downtimeMs, dedupKey]
        );

        if (result.affectedRows === 0) {
            // Duplicate caught by uq_resets_dedup_key — QoS retry or post-restart replay.
            logWithTimestamp(chalk.gray, `Reset for ${addrD} (${statusType}) already on file — duplicate dropped (dedup_key=${dedupKey.slice(0, 8)}…)`);
            return null;
        }

        logWithTimestamp(chalk.cyan, `Reset log persisted for ${addrD}: ${statusType} (id=${result.insertId})`);
        return { id: result.insertId, message: statusType, dieTime, wakeupTime, downtimeMs };
    } catch (error) {
        errorWithTimestamp('Error storing power-on message:', error.message);
        return null;
    }
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

// Helper function to handle connection/disconnection alerts.
//
// Two concerns are split here:
//   1. connections_history — EVERY conn_status message from the broker gets a
//      row, no debounce, no dedup. The history table is the audit log of
//      what the broker actually said and when.
//   2. dispensers / nozzles state — gated by the 30-minute disconnect
//      debounce so an unstable network that flaps every minute does NOT
//      cause the dispensers row to flip back and forth. Disconnect updates
//      the row only after 30 min of no reconnect; a reconnect that lands
//      first cancels the timer and leaves the row alone.
async function handleConnectionAlert(topic, alertData) {
    const clientId = alertData.clientid;
    const isConnection = alertData.status === 'Connected';
    const addrD = ensureDAddress(clientId);
    const addrNaked = stripDAddress(clientId);
    const eventAt = new Date(isConnection
        ? alertData.connected_at
        : alertData.disconnected_at);
    const conn_status = isConnection ? 1 : 0;

    // Look up the dispenser once — used for the history insert below AND
    // (potentially) the dispensers state change.
    const [dispRows] = await pool.query(
        'SELECT dispenser_id, customer_code, conn_status FROM dispensers WHERE address IN (?, ?)',
        [addrD, addrNaked]
    );
    if (dispRows.length === 0) {
        logWithTimestamp(chalk.yellow, `No dispenser found in database for address: ${addrD}`);
        return;
    }
    const { dispenser_id, customer_code } = dispRows[0];
    const currentDbStatus = Number(dispRows[0].conn_status);

    const action = isConnection ? 'connected' : 'disconnected';
    const color = isConnection ? chalk.green : chalk.red;
    const log = `Dispenser ${clientId} ${action}.`;
    logWithTimestamp(color, log);
    logPing(`${getFormattedTimestamp()} ${log} At ${getFormattedTimestamp(eventAt)} `);
    
    // Admin just hit "Refresh Conn Status" — commit broker truth for this
    // address right now, skipping debounce. Consumed on first delivery.
    if (refreshForceCommit.has(addrD)) {
        refreshForceCommit.delete(addrD);
        await applyDispenserStateChange(addrD, addrNaked, isConnection, eventAt, dispenser_id, customer_code);
        return;
    }

    // Stored state is "unknown" (2) — we had no baseline for this device, so
    // commit whatever the broker just told us (connect OR disconnect) right
    // away. No 30-minute disconnect debounce while the state is unknown.
    if (currentDbStatus === CONN_STATUS_UNKNOWN) {
        await applyDispenserStateChange(addrD, addrNaked, isConnection, eventAt, dispenser_id, customer_code);
        return;
    }

    if (isConnection) {
        // Reconnect during the disconnect debounce window — flap suppressed.
        // Cancel the pending timer; dispensers row stays as it was.
        const pending = pendingDisconnects.get(addrD);
        if (pending) {
            clearTimeout(pending);
            pendingDisconnects.delete(addrD);
            return;
        }
        // No pending disconnect. Only touch the dispensers row if the state
        // actually differs from what's stored — duplicate Connect events from
        // keepalive renewal would otherwise rewrite connected_at every minute.
        if (currentDbStatus === 1) return;
        await applyDispenserStateChange(addrD, addrNaked, true, eventAt, dispenser_id, customer_code);
        return;
    }

    // Disconnect: defer the dispensers update. If a timer is already running
    // for this address, leave it alone so the 30-min clock measures from the
    // first drop, not the latest duplicate.
    if (pendingDisconnects.has(addrD)) return;

    const handle = setTimeout(async () => {
        pendingDisconnects.delete(addrD);
        try {
            // Re-fetch in case the dispenser was reconfigured in the 30-min window.
            const [latest] = await pool.query(
                'SELECT dispenser_id, customer_code FROM dispensers WHERE address IN (?, ?)',
                [addrD, addrNaked]
            );
            if (latest.length === 0) return;
            await applyDispenserStateChange(addrD, addrNaked, false, eventAt, latest[0].dispenser_id, latest[0].customer_code);
        } catch (err) {
            errorWithTimestamp(`Deferred disconnect write failed for ${addrD}: ${err.message}`);
        }
    }, DISCONNECT_DEBOUNCE_MS);
    pendingDisconnects.set(addrD, handle);
}

// Commit the dispenser/nozzle state change implied by a connect/disconnect
// event. Does NOT touch connections_history — that's logged unconditionally
// by handleConnectionAlert before this is called.
async function applyDispenserStateChange(addrD, addrNaked, isConnection, eventAt, dispenser_id, customer_code) {
    const conn_status = isConnection ? 1 : 0;

    // Wipe nozzles to "no ping" only on disconnect — that's the case where
    // pings really have stopped arriving and the cached state is going stale.
    // On connect we leave nozzles alone: either they were already fresh (the
    // refresh-conn-status path runs this for devices that never actually
    // went offline), or the prior disconnect path already set them to 2 and
    // the next ping will repaint them correctly. Wiping on connect would
    // briefly flash "no ping" for currently-pinging devices.
    if (!isConnection) {
        await pool.query(
            'UPDATE nozzles SET status = 2 WHERE dispenser_id = ? && customer_code = ?',
            [dispenser_id, customer_code]
        );
    }

    await pool.query(
        'UPDATE dispensers SET conn_status = ?, connected_at = ? WHERE address IN (?, ?)',
        [conn_status, eventAt, addrD, addrNaked]
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
        if (updateData.touchPing) {
            fields.push('last_ping_at = NOW()');
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
            // Atomic increment in one statement — a read-then-write would let
            // two concurrent msg_type=7 messages for the same nozzle lose one
            // increment.
            const amountToAdd = Math.min(parseFloat(updateData.total_sales_today), MAX_DECIMAL_VALUE);
            fields.push('total_sales_today = LEAST(total_sales_today + ?, ?)');
            values.push(amountToAdd, MAX_DECIMAL_VALUE);
        }
        if (updateData.lock_unlock !== undefined) {
            fields.push('lock_unlock = ?');
            values.push(updateData.lock_unlock);
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
            // logWithTimestamp(null, `Nozzle ${nozzle_id} updated successfully`);
            recentUpdates.set(messageHash, [now]);
            setTimeout(() => recentUpdates.delete(messageHash), DEDUPE_WINDOW);
        } else {
            // errorWithTimestamp(`No rows affected for nozzle ${nozzle_id} update`);
        }
    } catch (error) {
        errorWithTimestamp('Nozzle update error:', error.message);
    }
}

async function updateDispenserInDatabase(dispenser_id, updateData) {
    try {
        const fields = [];
        const values = [];

        if (updateData.interface_lock_status !== undefined) {
            fields.push('interface_lock_status = ?');
            values.push(updateData.interface_lock_status);
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
            // logWithTimestamp(null, `Dispenser ${dispenser_id} updated successfully`);
        } else {
            // errorWithTimestamp(`No rows affected for dispenser ${dispenser_id} update`);
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
        
        // logWithTimestamp(null, `Transaction recorded for nozzle ${nozzle_id}: ${amount} ${volume}`);
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
                    customer_code, dispenser_id, nozzle_id, product, status, last_ping_at,
                    price_per_liter, total_quantity, total_amount, total_sales_today, lock_unlock
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    nozzle.customer_code,
                    nozzle.dispenser_id,
                    nozzle.nozzle_id,
                    nozzle.product,
                    nozzle.status,
                    nozzle.last_ping_at,
                    parseFloat(nozzle.price_per_liter),
                    parseFloat(nozzle.total_quantity),
                    parseFloat(nozzle.total_amount),
                    parseFloat(nozzle.total_sales_today),
                    nozzle.lock_unlock
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
        const payloadDispenserId = deviceData.DispenserId;     // legacy firmware: omitted
        const rawInterface = deviceData.Interface;             // legacy firmware: omitted
        const payloadInterface = rawInterface ? String(rawInterface).toLowerCase() : null;

        // Validate required fields
        if (!customerCode || !deviceAddress) {
            errorWithTimestamp('Missing required registration fields:', { customerCode, deviceAddress });
            return;
        }

        // Interface is optional (old firmware doesn't send it). When present it must be valid.
        if (payloadInterface !== null && payloadInterface !== 'ir' && payloadInterface !== 'keypad') {
            errorWithTimestamp(`Invalid Interface in registration message: "${rawInterface}". Must be "ir" or "keypad"`);
            return;
        }

        // Validate number of sides (accept Sides; fall back to NumberOfSides for legacy firmware)
        const numberOfSides = parseInt(deviceData.Sides ?? deviceData.NumberOfSides);
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
            // Prefer the dispenser_id supplied by the device. Fall back to
            // MAX+1 for legacy firmware that doesn't send DispenserId.
            if (payloadDispenserId) {
                finalDispenserId = String(payloadDispenserId);
            } else {
                try {
                    const [rows] = await pool.query(
                        'SELECT MAX(CAST(dispenser_id AS UNSIGNED)) AS max_id FROM dispensers WHERE customer_code = ?',
                        [customerCode]
                    );
                    finalDispenserId = String((rows[0].max_id || 0) + 1);
                } catch (error) {
                    errorWithTimestamp('Error getting next dispenser ID:', error.message);
                    return;
                }
            }
            isNewDispenser = true;

            // Legacy firmware: no Interface field — default to 'ir'.
            const dispenserInterface = payloadInterface || 'ir';

            // Create new dispenser — store address D-prefixed.
            await pool.query(
                `INSERT INTO dispensers
                 (customer_code, dispenser_id, address, conn_status, connected_at,
                  interface_type, interface_lock_status, number_of_nozzles, DispenserBrand, IMEI1, IMEI2)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    customerCode,
                    finalDispenserId,
                    deviceAddressD,
                    0, // conn_status - offline
                    null,
                    dispenserInterface,
                    1, // interface_lock_status - unlocked
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

            // Build an update for whichever fields the payload actually carries.
            // Old firmware omits Interface — don't overwrite stored value with a default.
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
            if (payloadInterface) {
                updateFields.push('interface_type = ?');
                updateValues.push(payloadInterface);
            }

            if (updateFields.length > 0) {
                updateValues.push(customerCode, deviceAddressD, deviceAddressNaked);
                await pool.query(
                    `UPDATE dispensers SET ${updateFields.join(', ')} WHERE customer_code = ? AND address IN (?, ?)`,
                    updateValues
                );
                logWithTimestamp(chalk.blue, `✓ Updated existing dispenser ${deviceAddressD}${payloadInterface ? ` (interface=${payloadInterface})` : ''}`);
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
                          total_sales_today, lock_unlock, price, quantity)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            customerCode, finalDispenserId, nozzleId, product,
                            0, 0.00, 0.00, 0.00, 0.00,
                            0, 0.00, 0.00
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
// Intervals are once-per-process — MQTT reconnects must NOT re-arm them, or
// every flap leaves another offline-checker and history-snapshotter running.
let backgroundTimersStarted = false;
mqttClient.on('connect', () => {
    logPing(`${getFormattedTimestamp()} Server connected to EMQX`);
    logWithTimestamp(null, 'MQTT client connected to broker');
    deviceTopics.clear(); // Clear subscriptions on new connection
    statusTopics.clear();
    lastStatusMessage.clear(); // Clear status tracking on new connection
    initializeMQTTSubscriptions(); // Subscribe to all dispenser topics

    if (!backgroundTimersStarted) {
        backgroundTimersStarted = true;
        startOfflineCheck();
        setInterval(recordNozzleHistory, HISTORY_RECORD_INTERVAL);
        setTimeout(recordNozzleHistory, 5000);
    }
});

mqttClient.on('message', async (receivedTopic, message) => {
    const messageStr = message.toString();

    // Price-update ACKs (duc/acked_msgs) — shape: {device, topic}. Handled
    // before the generic parser because the payload doesn't have msg_type /
    // dis_addr / clientid fields the rest of this handler keys off of.
    if (receivedTopic === PRICE_ACK_TOPIC) {
        try {
            if (!messageStr.trim()) return;
            const payload = JSON.parse(messageStr);
            logPriceDebug(`RX duc/acked_msgs: ${messageStr}`);
            handlePriceAck(payload);
        } catch (err) {
            logPriceDebug(`RX duc/acked_msgs PARSE ERROR: ${err.message} — raw: ${messageStr}`);
        }
        return;
    }

    let logColor = chalk.yellow;
    let parsedData;

    try {
        parsedData = JSON.parse(messageStr);
        if (parsedData.msg_type === 0) {
            logColor = chalk.green; // Use green for msg_type: 0
        } else if (parsedData.msg_type === 10 || parsedData.msg_type === 11 || parsedData.msg_type === 12) {
            logColor = chalk.cyan;
        }
        else if (parsedData.msg_type === 16 ) {
            logColor = chalk.magenta;
        }
    } catch (error) {
        errorWithTimestamp(`Failed to parse message on ${receivedTopic}: ${error.message}`);
        return;
    }

    const logMessage = `${getFormattedTimestamp()} Received message on ${receivedTopic}: ${messageStr}`;
    if (parsedData.msg_type === 0) {
        await logPing(logMessage);
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
            'SELECT dispenser_id, interface_type FROM dispensers WHERE address IN (?, ?)',
            [dbAddrD, dbAddrNaked]
        );

        if (dispensers.length === 0) {
            errorWithTimestamp(`No dispenser found for address ${dbAddress}`);
            return;
        }

        const { dispenser_id, interface_type: dispenserInterface } = dispensers[0];

        if (parsedData.req_type == 0 && parsedData.message !== '') {
            // If this value report answers an outstanding GET request, tell the
            // frontend a real reply arrived (routine periodic publishes have no
            // pending request registered, so they're ignored here).
            if (notificationService && data.msg_type >= 0 && data.msg_type <= 6) {
                const getKey = _getReqKey(dbAddrD, side, nozzleNum, data.msg_type);
                if (pendingGetRequests.has(getKey)) {
                    pendingGetRequests.delete(getKey);
                    notificationService.broadcastDispenserReply({
                        address: dbAddrD,
                        nozzleId,
                        side,
                        noz_number: nozzleNum,
                        msg_type: data.msg_type,
                        message: data.message
                    });
                }
            }

            // Update database based on message type
            switch(data.msg_type) {
                case 0: // Ping (msg_type=0). Both "0" and "1" prove the device is reachable;
                        // the value just tells us whether it's talking to the dispenser MB.
                        // Any ping resets the offline timer — a stream of msg=0 pings should
                        // NOT decay into status=2 (that's reserved for "no ping at all").
                    lastStatusMessage.set(nozzleId, { lastMessageTime: Date.now(), dispenser_id });
                    await updateNozzleInDatabase(dispenser_id, nozzleId, {
                        status: parseInt(data.message),
                        touchPing: true
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
                case 5: // Keypad lock — only valid when the dispenser's interface is 'keypad'
                    if (dispenserInterface !== 'keypad') {
                        errorWithTimestamp(`Invalid lock message: received msg_type=5 (keypad) for dispenser ${dbAddrD} with interface='${dispenserInterface}'`);
                        break;
                    }
                    await updateDispenserInDatabase(dispenser_id, {
                        interface_lock_status: parseInt(data.message)
                    });
                    break;
                case 6: // IR lock — only valid when the dispenser's interface is 'ir'
                    if (dispenserInterface !== 'ir') {
                        errorWithTimestamp(`Invalid lock message: received msg_type=6 (ir) for dispenser ${dbAddrD} with interface='${dispenserInterface}'`);
                        break;
                    }
                    await updateDispenserInDatabase(dispenser_id, {
                        interface_lock_status: parseInt(data.message)
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
                        await handlePowerOnMessage(dispenserAddr, data.message);
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
                        if (notificationService) {
                            await notificationService.sendConnectivityNotification(
                                dispenserAddr,
                                'Connectivity Status',
                                `Device ${dispenserAddr}: ${data.message}`,
                                notifType
                            );
                        }
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

// Stop the MQTT client cleanly. Cancels any pending disconnect debounce
// timers (they'd otherwise keep the event loop alive after server.close),
// then asks the mqtt client to send DISCONNECT and close its socket.
function shutdownMqtt() {
    for (const handle of pendingDisconnects.values()) clearTimeout(handle);
    pendingDisconnects.clear();
    return new Promise(resolve => {
        if (!mqttClient || mqttClient.disconnecting || mqttClient.disconnected) {
            return resolve();
        }
        mqttClient.end(false, {}, () => resolve());
    });
}

// Admin action: force re-subscribe to every dispenser's duc/conn_status/<D…>
// topic and clear any pending disconnect-debounce timers. Used when the broker
// state and the server's in-memory view of subscriptions / debounced
// disconnects have drifted apart (e.g. after broker restarts, network blips
// that didn't trigger a reconnect, or a long server uptime where some
// dispensers' status looks stuck "online").
// Promise-wrapped UNSUBSCRIBE — the broker only re-delivers a topic's
// retained message on a SUBSCRIBE if the client is NOT already subscribed
// to it. Resolves on SUBACK regardless of error so refresh can keep going.
function _mqttUnsubscribe(topic) {
    return new Promise((resolve) => {
        if (!mqttClient || !mqttClient.connected) return resolve();
        mqttClient.unsubscribe(topic, () => resolve());
    });
}

// Promise-wrapped SUBSCRIBE — same idea, waits for SUBACK so retained
// messages on this topic start arriving before the next iteration.
function _mqttSubscribe(topic) {
    return new Promise((resolve) => {
        if (!mqttClient || !mqttClient.connected) return resolve();
        mqttClient.subscribe(topic, { qos: 1 }, () => resolve());
    });
}

async function _cycleConnStatusTopic(addrD) {
    const topic = `duc/conn_status/${addrD}`;
    await _mqttUnsubscribe(topic);
    statusTopics.delete(topic);
    await _mqttSubscribe(topic);
    statusTopics.add(topic);
}

// Clear the in-flight disconnect-debounce timer for one address (if any) and
// mark it "next conn_status message wins" so both connect AND disconnect events
// bypass debounce on redelivery — see handleConnectionAlert. Returns 1 if a
// timer was cleared, else 0.
function _armConnStatusForceCommit(addrD) {
    refreshForceCommit.add(addrD);
    const handle = pendingDisconnects.get(addrD);
    if (handle) {
        clearTimeout(handle);
        pendingDisconnects.delete(addrD);
        return 1;
    }
    return 0;
}

async function refreshConnStatusSubscriptions() {
    // Cancel every pending DISCONNECT_DEBOUNCE_MS timer in flight so the
    // server starts fresh — they'd otherwise race with the immediate-commit
    // events about to arrive.
    let timersCleared = 0;
    for (const handle of pendingDisconnects.values()) {
        clearTimeout(handle);
        timersCleared++;
    }
    pendingDisconnects.clear();

    // Mark every dispenser address as "next conn_status message wins" BEFORE
    // re-subscribing. Both connect AND disconnect events bypass debounce —
    // see handleConnectionAlert.
    let resubscribed = 0;
    const [dispensers] = await pool.query(
        `SELECT ${addressOutSql('d')} AS address FROM dispensers d`
    );
    for (const d of dispensers) {
        const addrD = ensureDAddress(d.address);
        if (addrD) refreshForceCommit.add(addrD);
    }

    const armedForSweep = [];
    for (const d of dispensers) {
        const addrD = ensureDAddress(d.address);
        if (!addrD) continue;
        await _cycleConnStatusTopic(addrD);
        armedForSweep.push(addrD);
        resubscribed++;
    }

    // Addresses that get no redelivered conn_status within the window → unknown.
    scheduleUnknownSweep(armedForSweep);

    logWithTimestamp(chalk.cyan,
        `Conn-status refresh: cycled ${resubscribed} topics, cleared ${timersCleared} debounce timers, queued ${refreshForceCommit.size} addresses for immediate commit`);
    return { resubscribed, timersCleared };
}

// Per-dispenser equivalent of refreshConnStatusSubscriptions: re-cycle just one
// address's conn_status topic and clear its debounce timer. Used by the
// per-card "Refresh Status" action.
async function refreshConnStatusForAddress(address) {
    const addrD = ensureDAddress(address);
    if (!addrD) return { resubscribed: 0, timersCleared: 0 };

    const timersCleared = _armConnStatusForceCommit(addrD);
    await _cycleConnStatusTopic(addrD);

    // No redelivered conn_status within the window → mark this device unknown.
    scheduleUnknownSweep([addrD]);

    logWithTimestamp(chalk.cyan,
        `Conn-status refresh (single): cycled ${addrD}, cleared ${timersCleared} debounce timer(s)`);
    return { resubscribed: 1, timersCleared };
}

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

// ----- Price-update job ledger -----

// Register a freshly-published price update so incoming ACKs on
// duc/acked_msgs can be attributed back to it. `items` is an array of
// { product, topic, ducs: string[] } — one entry per (product) batch in the
// job. Returns the same jobId for chaining.
function registerPriceUpdateJob(jobId, items) {
    // GC old jobs first so the ledger doesn't grow unboundedly.
    const cutoff = Date.now() - PRICE_JOB_TTL_MS;
    for (const [id, j] of priceUpdateJobs) {
        if (j.createdAt < cutoff) priceUpdateJobs.delete(id);
    }
    priceUpdateJobs.set(jobId, {
        createdAt: Date.now(),
        items: items.map(it => ({
            product: it.product,
            topic: it.topic,
            ducs: new Set(it.ducs),
            // Echoed back in the ACK payload; used to reject stale/retained ACKs.
            expectedMessage: it.price != null ? String(it.price) : null,
            expectedDate: it.date != null ? String(it.date) : null,
            acked: new Map(),  // addrD -> ISO timestamp
        }))
    });
    return jobId;
}

// Plain-JSON snapshot of a job for the polling endpoint. Sets become arrays;
// Maps become objects.
function getPriceUpdateJob(jobId) {
    const job = priceUpdateJobs.get(jobId);
    if (!job) return null;
    return {
        jobId,
        createdAt: new Date(job.createdAt).toISOString(),
        items: job.items.map(it => ({
            product: it.product,
            topic: it.topic,
            ducs: Array.from(it.ducs),
            acked: Array.from(it.acked.entries()).map(([device, at]) => ({ device, at })),
            ackedCount: it.acked.size,
            totalDucs: it.ducs.size
        }))
    };
}

// ----- Price-ACK subscription lifecycle -----
//
// duc/acked_msgs is only useful in the window right after a price publish.
// Subscribing permanently means retained-message redelivery and device
// reconnects spray ACKs at the server forever. Instead we subscribe on demand
// and reference-count it, so overlapping jobs (e.g. a 5-min retained job still
// running when a 15-sec non-retained one starts and ends) keep the single
// subscription alive until the LAST in-flight job finalizes.
let priceAckSubCount = 0;
let priceAckSubscribed = false;   // reflects the broker SUBACK result

// SUBSCRIBE to the ACK topic, resolving with whether the broker accepted it
// (callback err === null). Lets the caller record subscription health.
function _subscribePriceAck() {
    return new Promise((resolve) => {
        if (!mqttClient || !mqttClient.connected) return resolve(false);
        mqttClient.subscribe(PRICE_ACK_TOPIC, { qos: 1 }, (err) => resolve(!err));
    });
}

// Bump the refcount; subscribe (waiting for SUBACK) if this is the first
// in-flight job. Returns true when it established a fresh subscription, so the
// caller can let it settle before publishing.
async function acquirePriceAckSubscription() {
    priceAckSubCount++;
    if (priceAckSubCount === 1) {
        priceAckSubscribed = await _subscribePriceAck();
        if (priceAckSubscribed) {
            logPriceDebug(`SUBSCRIBED to ${PRICE_ACK_TOPIC} (price-update active, refcount=1)`);
        } else {
            logPriceDebug(`FAILED to subscribe to ${PRICE_ACK_TOPIC} — ACKs will be missed`);
        }
        return true;
    }
    logPriceDebug(`subscription already active (refcount=${priceAckSubCount})`);
    return false;
}

// Drop the refcount; unsubscribe once no job needs ACKs anymore.
async function releasePriceAckSubscription() {
    if (priceAckSubCount === 0) return;
    priceAckSubCount--;
    if (priceAckSubCount === 0) {
        await _mqttUnsubscribe(PRICE_ACK_TOPIC);
        priceAckSubscribed = false;
        logPriceDebug(`UNSUBSCRIBED from ${PRICE_ACK_TOPIC} (no price-update active, refcount=0)`);
    } else {
        logPriceDebug(`released hold, subscription kept (refcount=${priceAckSubCount})`);
    }
}

// Whether the server currently holds an active duc/acked_msgs subscription.
function isPriceAckSubscribed() {
    return priceAckSubscribed;
}

// Whether a price-update job is currently in flight (published but not yet
// finalized). The refcount is the source of truth: >0 means at least one job is
// still inside its ACK-collection window.
function hasActivePriceUpdate() {
    return priceAckSubCount > 0;
}

// Called when a price-update ACK lands on duc/acked_msgs. Payload shape:
//   { device: 'D13846', topic: 'PSO/.../duc/price/pmg',
//     payload: { date: '...', req_type: 0, message: '272.50' } }
// Walks every active job; records the ack only if the item's topic matches, the
// device is in its expected DUC set, AND the echoed price+date match what the
// job published — the last check rejects stale/retained ACKs redelivered on
// (re)subscribe, which carry an older price/date.
function handlePriceAck(payload) {
    const device = payload && payload.device;
    const topic = payload && payload.topic;
    if (!device || !topic) return;
    const addrD = ensureDAddress(device);
    const topicLower = String(topic).toLowerCase();

    // Echoed price/date from the original message, if the broker includes them.
    const inner = (payload && typeof payload.payload === 'object') ? payload.payload : null;
    const ackMessage = inner && inner.message != null ? String(inner.message) : null;
    const ackDate = inner && inner.date != null ? String(inner.date) : null;

    let matched = 0;
    let topicSeen = false;       // some active item targets this topic
    let inDucSet = false;        // ...and the device is one of its expected DUCs
    let payloadMatched = false;  // ...and the echoed price/date match this job
    for (const job of priceUpdateJobs.values()) {
        for (const item of job.items) {
            if (item.topic !== topicLower) continue;
            topicSeen = true;
            if (!item.ducs.has(addrD)) continue;
            inDucSet = true;
            // Reject stale/retained ACKs: when the ACK echoes a price/date, it
            // must equal what this job published. (Lenient if the ACK omits them.)
            if (ackMessage != null && item.expectedMessage != null && ackMessage !== item.expectedMessage) continue;
            if (ackDate != null && item.expectedDate != null && ackDate !== item.expectedDate) continue;
            payloadMatched = true;
            if (item.acked.has(addrD)) continue;
            item.acked.set(addrD, new Date().toISOString());
            matched++;
        }
    }

    // Debug aid: ACKs that don't register are otherwise invisible. Logs why a
    // match did/didn't happen so mismatches surface.
    if (matched > 0) {
        logPriceDebug(`ACK MATCHED device=${addrD} topic=${topicLower} msg=${ackMessage} (${matched} item(s))`);
    } else {
        const active = [];
        for (const job of priceUpdateJobs.values()) {
            for (const item of job.items) {
                active.push(`${item.topic} ducs=[${Array.from(item.ducs).join(', ')}] price=${item.expectedMessage}`);
            }
        }
        const reason = !topicSeen ? 'no active job for this topic'
            : !inDucSet ? `device ${addrD} not in targeted DUC set`
            : !payloadMatched ? `echoed price/date (${ackMessage}/${ackDate}) doesn't match active job — stale/retained ACK`
            : 'already acked';
        logPriceDebug(`ACK DROPPED device=${addrD} topic=${topicLower} — ${reason}. ` +
            `Active items: ${active.join(' | ') || 'none'}`);
    }
}

module.exports = {
    setNotificationService,
    registerGetRequest,
    subscribeToTopic,
    unsubscribeFromTopic,
    getGsmConnectionStatus,
    getWifiConnectionStatus,
    getGsmStatus,
    getWiFiStatus,
    getMqttStatus,
    getErrorLog,
    getDeviceInfo,
    hasErrors,
    handleDeviceStatusMessage,
    handleGsmStatusMessage,
    handleWiFiStatusMessage,
    handleMqttStatusMessage,
    handlePowerOnMessage,
    handleErrorMessage,
    publishMessage,
    refreshConnStatusSubscriptions,
    refreshConnStatusForAddress,
    registerPriceUpdateJob,
    getPriceUpdateJob,
    acquirePriceAckSubscription,
    releasePriceAckSubscription,
    isPriceAckSubscribed,
    hasActivePriceUpdate,
    shutdownMqtt
};