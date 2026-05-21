const pool = require('./db');
const chalk = require('chalk');
const WebSocket = require('ws');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const rfs = require('rotating-file-stream');
const { v4: uuidv4 } = require('uuid');

const LOGS_DIR = path.join(__dirname, '../logs');
// Ensure the logs directory exists before any stream tries to write to it.
fsSync.mkdirSync(LOGS_DIR, { recursive: true });

// Rotate daily, gzip closed files, keep the last 30. Use a per-day filename
// so the active file is always logs/<name>.log and yesterday's becomes
// logs/<name>.log.YYYY-MM-DD.gz.
function makeRotatingStream(name) {
    return rfs.createStream(`${name}.log`, {
        path: LOGS_DIR,
        interval: '1d',
        maxFiles: 30,
        compress: 'gzip'
    });
}
const pingLogStream = makeRotatingStream('ping');
const allMessagesLogStream = makeRotatingStream('all_messages');
const errorLogStream = makeRotatingStream('errors');

// Surface stream-level write failures to stderr (e.g. disk full). Without
// this listener the stream would emit an unhandled 'error' that crashes the
// process.
for (const s of [pingLogStream, allMessagesLogStream, errorLogStream]) {
    s.on('error', err => console.error(chalk.red(`Log stream error: ${err.message}`)));
}

// Local CSVs with verified station coords (lat/lng/city/division). Used as the
// source of truth for stations whose customer_code appears in them; the live
// DUC status is then merged in from the dispensers table.
const BWP_STATIONS_CSV_PATH = path.join(__dirname, '..', 'sites', 'bwp-stations.csv');
const DIK_STATIONS_CSV_PATH = path.join(__dirname, '..', 'sites', 'dik-stations.csv');
let bwpStationsCache = null;
let dikStationsCache = null;

function logPing(message) {
    pingLogStream.write(message + '\n');
}

function writeToLogFile(message) {
    allMessagesLogStream.write(message + '\n');
}

// Utility function to format timestamp
function getFormattedTimestamp(time) {
    if (!time) {
        time = new Date();
    }
    const day = String(time.getDate()).padStart(2, '0');
    const month = String(time.getMonth() + 1).padStart(2, '0');
    const year = String(time.getFullYear()).slice(2);
    const hours = String(time.getHours()).padStart(2, '0');
    const minutes = String(time.getMinutes()).padStart(2, '0');
    const seconds = String(time.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds} --`;
}

function logWithTimestamp(color = null, ...args) {
    const message = `${getFormattedTimestamp()} ${args.join(' ')}`;
    const coloredMessage = color ? color(message) : message;
    process.stdout.write(`${coloredMessage}\n`);
}

function errorWithTimestamp(...args) {
    const message = `${getFormattedTimestamp()} ${args.join(' ')}`;
    console.error(chalk.red(message));
    errorLogStream.write(message + '\n');
}

// Function to calculate today's sales from transactions table and update nozzles
async function initializeDailyTotals() {
    try {
        logWithTimestamp(null, 'Initializing daily totals from transactions table...');
        
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Step 1: Reset all nozzles to 0 first
        // logWithTimestamp('Resetting all nozzles to 0...');
        await pool.query('UPDATE nozzles SET total_sales_today = 0.00');
        
        // Step 2: Get today's total sales for each nozzle from transactions table
        const [results] = await pool.query(`
            SELECT nozzle_id, SUM(amount) as daily_total 
            FROM transactions 
            WHERE DATE(time) = ? 
            GROUP BY nozzle_id
        `, [today]);
        
        logWithTimestamp(null, `Found ${results.length} nozzles with transactions today`);
        
        // Update each nozzle's total_amount with today's accumulated sales
        for (const result of results) {
            const { nozzle_id, daily_total } = result;
            
            await pool.query(`
                UPDATE nozzles 
                SET total_sales_today = ? 
                WHERE nozzle_id = ?
            `, [parseFloat(daily_total) || 0.00, nozzle_id]);
        }
        
        logWithTimestamp(null, 'Daily totals initialized successfully');
        
    } catch (error) {
        errorWithTimestamp('Error initializing daily totals:', error.message);
    }
}

// Midnight reset function
async function resetDailyTotals() {
    try {
        logWithTimestamp(null, 'Resetting daily totals for all nozzles...');
        
        const [result] = await pool.query(
            'UPDATE nozzles SET total_sales_today = 0.00'
        );
        
        logWithTimestamp(null, `Reset daily totals for ${result.affectedRows} nozzles`);
    } catch (error) {
        errorWithTimestamp('Error resetting daily totals:', error.message);
    }
}

// Schedule midnight reset
function scheduleMidnightReset() {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0); // Next midnight
    
    const timeUntilMidnight = midnight - now;
    
    logWithTimestamp(null, `Midnight reset scheduled in ${Math.round(timeUntilMidnight / 1000 / 60)} minutes`);
    
    setTimeout(() => {
        resetDailyTotals();
        // Schedule next reset for subsequent days (every 24 hours)
        setInterval(resetDailyTotals, 24 * 60 * 60 * 1000);
    }, timeUntilMidnight);
}

// Start the service
async function startMidnightResetService() {
    logWithTimestamp(null, 'Starting midnight reset service...');
    
    // First, initialize totals from today's transactions
    await initializeDailyTotals();
    
    // Then schedule the midnight reset
    scheduleMidnightReset();
}

class NotificationWebSocketServer {
    constructor(server) {
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws/notifications'
        });
        this.clients = new Map(); // userId -> WebSocket
        this.setupWebSocket();
    }

    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            const clientId = uuidv4();
            this.clients.set(clientId, ws);
            
            console.log(`Frontend connected: ${clientId} (Total: ${this.clients.size})`);

            // Send welcome message
            this.sendToClient(clientId, {
                type: 'connection_established',
                message: 'Connected to notification service'
            });

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    this.handleMessage(clientId, data);
                } catch (error) {
                    console.error('WebSocket message parse error:', error);
                }
            });

            ws.on('close', () => {
                this.clients.delete(clientId);
                console.log(`Frontend disconnected: ${clientId} (Remaining: ${this.clients.size})`);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error for ${clientId}:`, error);
                this.clients.delete(clientId);
            });
        });
    }

    handleMessage(clientId, data) {
        switch (data.type) {
            case 'ping':
                this.sendToClient(clientId, { type: 'pong' });
                break;
            case 'subscribe':
                console.log(`Client ${clientId} subscribed to: ${data.channel}`);
                break;
            default:
                console.log(`Received message from ${clientId}:`, data);
        }
    }

    // Send notification to specific client
    sendToClient(clientId, notification) {
        const ws = this.clients.get(clientId);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(notification));
        }
    }

    // Broadcast to all connected clients
    broadcast(notification) {
        const message = JSON.stringify(notification);
        this.clients.forEach((ws, clientId) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(message);
            }
        });
        // console.log(`Broadcasted to ${this.clients.size} clients:`, notification.type);
    }

    // Send to specific users (for user-specific notifications)
    sendToUsers(userIds, notification) {
        // In real app, you'd map userIds to WebSocket connections
        this.broadcast(notification); // Fallback to broadcast for now
    }

    getClientCount() {
        return this.clients.size;
    }
}

class NotificationService {
    constructor(webSocketServer) {
        this.wsServer = webSocketServer;
    }

    // System notifications (nozzle status, errors, etc.)
    async sendSystemNotification(title, message, type = 'info', data = {}) {
        const notification = {
            id: uuidv4(),
            type: 'system_notification',
            title,
            message,
            notificationType: type, // info, warning, error, success
            timestamp: new Date().toISOString(),
            data
        };

        this.wsServer.broadcast(notification);
        
        // Also log to console
        // console.log(`System Notification [${type}]: ${title} - ${message}`);
        
        return notification;
    }

    // User-specific notifications
    async sendUserNotification(userId, title, message, type = 'info') {
        const notification = {
            id: uuidv4(),
            type: 'user_notification',
            title,
            message,
            notificationType: type,
            timestamp: new Date().toISOString(),
            userId
        };

        this.wsServer.sendToUsers([userId], notification);
        return notification;
    }

    // Nozzle-specific notifications
    async sendNozzleNotification(nozzleId, title, message, type = 'info') {
        return this.sendSystemNotification(
            title,
            // `Nozzle ${nozzleId}: ${message}`,
            message,
            type,
            { nozzleId }
        );
    }

    async sendConnectivityNotification(dispenser_id, title, message, type = 'info') {
       return this.sendSystemNotification(
            title,
            message,
            type,
            { dispenser_id }
        );
    }
}

function parseCsvRow(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { cur += ch; }
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { out.push(cur); cur = ''; }
            else cur += ch;
        }
    }
    out.push(cur);
    return out;
}

async function loadStationCsvRows(csvPath, source) {
    let text;
    try {
        text = await fs.readFile(csvPath, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    const lines = text.split(/\r?\n/).filter(l => l.length > 0);
    if (lines.length < 2) return [];
    const headers = parseCsvRow(lines[0]).map(h => h.trim().toLowerCase());
    const colOf = name => headers.indexOf(name);
    const cCode = colOf('customer_code');
    const cName = colOf('station_name');
    const cCity = colOf('city');
    const cDistrict = colOf('district');
    const cDivision = colOf('division');
    const cProvince = colOf('province');
    const cLocation = colOf('location');
    const cLat = colOf('lat');
    const cLng = colOf('lng');
    const cTotal = colOf('total_dus');

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvRow(lines[i]);
        const customer_code = (cols[cCode] || '').trim();
        const lat = parseFloat(cols[cLat]);
        const lng = parseFloat(cols[cLng]);
        if (!customer_code || isNaN(lat) || isNaN(lng)) continue;
        rows.push({
            station_name: (cols[cName] || '').trim(),
            customer_code,
            city: (cols[cCity] || '').trim(),
            district: cDistrict >= 0 ? (cols[cDistrict] || '').trim() : '',
            division: cDivision >= 0 ? (cols[cDivision] || '').trim() : '',
            province: cProvince >= 0 ? (cols[cProvince] || '').trim() : '',
            location: cLocation >= 0 ? (cols[cLocation] || '').trim() : '',
            lat,
            lng,
            total_dus: parseInt(cols[cTotal]) || 0,
            source
        });
    }
    return rows;
}

async function loadBwpStationRows() {
    if (bwpStationsCache) return bwpStationsCache;
    bwpStationsCache = await loadStationCsvRows(BWP_STATIONS_CSV_PATH, 'bwp-sheet');
    return bwpStationsCache;
}

async function loadDikStationRows() {
    if (dikStationsCache) return dikStationsCache;
    dikStationsCache = await loadStationCsvRows(DIK_STATIONS_CSV_PATH, 'dik-sheet');
    return dikStationsCache;
}

async function fetchStationSheetRows() {
    const [bwpRows, dikRows] = await Promise.all([
        loadBwpStationRows(),
        loadDikStationRows()
    ]);
    const merged = new Map();
    for (const r of dikRows) merged.set(r.customer_code, r);
    for (const r of bwpRows) merged.set(r.customer_code, { ...(merged.get(r.customer_code) || {}), ...r });
    return Array.from(merged.values());
}

// Best-effort client IP extraction. Honors X-Forwarded-For when present.
// Loopback (::1) is normalized to 127.0.0.1 for readability when the client
// hits the server from the same machine.
function getClientIp(req) {
    if (!req) return null;
    const xff = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
    let raw = xff
        ? String(xff).split(',')[0].trim()
        : (req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '').toString();
    raw = raw.replace(/^::ffff:/, '');
    if (raw === '::1') raw = '127.0.0.1';
    return raw || null;
}

// Dispenser address normalization. The canonical on-disk form is D-prefixed
// (e.g. "D01"). Writes go through ensureDAddress so legacy code that still
// passes a naked numeric continues to land as "D…". Lookup helpers and SELECT
// projections also tolerate legacy rows that pre-date this convention and
// still contain a naked numeric.
function ensureDAddress(addr) {
    if (addr == null) return addr;
    const s = String(addr);
    if (s === '') return s;
    return s.startsWith('D') ? s : `D${s}`;
}

function stripDAddress(addr) {
    return String(addr ?? '').replace(/^D/, '');
}

// SQL fragment that yields the address as "Daa" regardless of whether the row
// stores it with or without the D prefix. Inline this into SELECT lists.
const ADDRESS_OUT_SQL = "IF(LEFT(`address`,1)='D', `address`, CONCAT('D', `address`))";
function addressOutSql(qualifier) {
    const col = qualifier ? `${qualifier}.address` : '`address`';
    return `IF(LEFT(${col},1)='D', ${col}, CONCAT('D', ${col}))`;
}

// Insert a row into activity_log. Never throws — logging must not break the
// caller. Pass `req` to auto-capture IP and authenticated user. Optional
// overrides via `extras` (entity_type, entity_id, details, user_id, username).
async function logActivity(req, action, extras = {}) {
    try {
        const ip = extras.ip_address || getClientIp(req);
        const user_id = extras.user_id ?? req?.authUser?.id ?? null;
        const username = extras.username ?? req?.authUser?.username ?? null;
        const entity_type = extras.entity_type ?? null;
        const entity_id = extras.entity_id != null ? String(extras.entity_id) : null;
        const details = extras.details ? JSON.stringify(extras.details) : null;
        await pool.query(
            `INSERT INTO activity_log
             (user_id, username, ip_address, action, entity_type, entity_id, details)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [user_id, username, ip, action, entity_type, entity_id, details]
        );
    } catch (err) {
        errorWithTimestamp('Failed to write activity_log:', err.message);
    }
}

// Derive a human-readable action label and key fields from an MQTT publish.
// Topic shape:   pso/<city>/<customer_code>/duc/d<address>
// Payload shape: { dis_addr, req_type, side, noz_number, msg_type, message }
function describeMqttCommand(topic, message) {
    const parts = String(topic || '').split('/');
    const customer_code = parts[2] || null;
    const dispenser_address = parts[4] || null;
    let m = message;
    if (typeof m === 'string') {
        try { m = JSON.parse(m); } catch { m = {}; }
    }
    if (!m || typeof m !== 'object') m = {};

    const isGet = Number(m.req_type) === 1;
    const isOn = String(m.message) === '1';
    let action;
    switch (Number(m.msg_type)) {
        case 0:  action = 'nozzle_status_request'; break;
        case 1:  action = isGet ? 'price_request' : 'price_update'; break;
        case 4:  action = isGet ? 'nozzle_lock_request' : (isOn ? 'nozzle_lock' : 'nozzle_unlock'); break;
        case 5:  action = isGet ? 'keypad_lock_request' : (isOn ? 'keypad_lock' : 'keypad_unlock'); break;
        case 6:  action = isGet ? 'ir_lock_request' : (isOn ? 'ir_lock' : 'ir_unlock'); break;
        default: action = isGet ? `data_request_${m.msg_type}` : `mqtt_publish_${m.msg_type}`;
    }
    return {
        action,
        customer_code,
        dispenser_address,
        side: m.side ?? null,
        nozzle_number: m.noz_number != null ? Number(m.noz_number) : null
    };
}

// ===== 12-hour disconnect detection =====
const LONG_OUTAGE_THRESHOLD_MS = 12 * 60 * 60 * 1000;
const LONG_OUTAGE_SCAN_INTERVAL_MS = 10 * 60 * 1000; // every 10 min
let longOutageNotificationService = null;

function setLongOutageNotificationService(svc) {
    longOutageNotificationService = svc;
}

// Scan once for dispensers that have been continuously disconnected for at
// least 12h. For each such device, ensure exactly one open long_outage_alerts
// row exists; on first detection, broadcast a WS notification.
async function scanLongOutages() {
    try {
        const cutoff = new Date(Date.now() - LONG_OUTAGE_THRESHOLD_MS);
        const [rows] = await pool.query(
            `SELECT d.dispenser_id, ${addressOutSql('d')} AS address, d.customer_code, d.connected_at
             FROM dispensers d
             WHERE d.conn_status = 0
               AND d.connected_at IS NOT NULL
               AND d.connected_at <= ?`,
            [cutoff]
        );

        for (const r of rows) {
            const addrD = ensureDAddress(r.address);
            const addrNaked = stripDAddress(r.address);
            const [existing] = await pool.query(
                `SELECT id FROM long_outage_alerts
                 WHERE address IN (?, ?) AND cleared_at IS NULL
                 LIMIT 1`,
                [addrD, addrNaked]
            );
            if (existing.length > 0) continue;

            const [ins] = await pool.query(
                `INSERT INTO long_outage_alerts
                 (dispenser_id, address, customer_code, offline_since)
                 VALUES (?, ?, ?, ?)`,
                [r.dispenser_id, addrD, r.customer_code || null, r.connected_at]
            );

            if (longOutageNotificationService) {
                await longOutageNotificationService.sendSystemNotification(
                    'Long Outage',
                    `Device ${addrD} offline for 12h+`,
                    'error',
                    {
                        event: 'long_outage',
                        id: ins.insertId,
                        address: r.address,
                        dispenser_id: r.dispenser_id,
                        customer_code: r.customer_code || null,
                        offline_since: r.connected_at
                    }
                );
            }
            logWithTimestamp(chalk.red,
                `Long outage detected: ${addrD} offline since ${r.connected_at}`);
        }
    } catch (err) {
        errorWithTimestamp('Long-outage scan failed:', err.message);
    }
}

// Mark any open long_outage row for this address as cleared. Returns the
// cleared row(s) so the caller can broadcast a 'long_outage_cleared' event.
async function clearLongOutageForAddress(address) {
    try {
        const addrD = ensureDAddress(address);
        const addrNaked = stripDAddress(address);
        const [open] = await pool.query(
            `SELECT id, dispenser_id, customer_code, offline_since
             FROM long_outage_alerts
             WHERE address IN (?, ?) AND cleared_at IS NULL`,
            [addrD, addrNaked]
        );
        if (open.length === 0) return [];
        await pool.query(
            `UPDATE long_outage_alerts
             SET cleared_at = CURRENT_TIMESTAMP
             WHERE address IN (?, ?) AND cleared_at IS NULL`,
            [addrD, addrNaked]
        );
        return open;
    } catch (err) {
        errorWithTimestamp('Failed to clear long_outage_alerts:', err.message);
        return [];
    }
}

function startLongOutageService() {
    logWithTimestamp(null, 'Starting long-outage (12h) detection service...');
    // First scan after a short delay so the rest of init can settle.
    setTimeout(scanLongOutages, 30 * 1000);
    setInterval(scanLongOutages, LONG_OUTAGE_SCAN_INTERVAL_MS);
}

module.exports = {
    logPing,
    writeToLogFile,
    getFormattedTimestamp,
    logWithTimestamp,
    errorWithTimestamp,
    initializeDailyTotals,
    startMidnightResetService,
    resetDailyTotals,
    NotificationWebSocketServer,
    NotificationService,
    fetchStationSheetRows,
    loadBwpStationRows,
    loadDikStationRows,
    getClientIp,
    logActivity,
    ensureDAddress,
    stripDAddress,
    ADDRESS_OUT_SQL,
    addressOutSql,
    describeMqttCommand,
    setLongOutageNotificationService,
    scanLongOutages,
    clearLongOutageForAddress,
    startLongOutageService
};