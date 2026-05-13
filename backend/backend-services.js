const pool = require('./db');
const chalk = require('chalk');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PING_LOG_FILE_PATH = path.join(__dirname, '../logs/ping.log');
const LOG_FILE_PATH = path.join(__dirname, '../logs/all_messages.log');

// Local CSVs with verified station coords (lat/lng/city/division). Used as the
// source of truth for stations whose customer_code appears in them; the live
// DUC status is then merged in from the dispensers table.
const BWP_STATIONS_CSV_PATH = path.join(__dirname, '..', 'sites', 'bwp-stations.csv');
const DIK_STATIONS_CSV_PATH = path.join(__dirname, '..', 'sites', 'dik-stations.csv');
let bwpStationsCache = null;
let dikStationsCache = null;

async function logPing(message) {
    try {
        await fs.appendFile(PING_LOG_FILE_PATH, message + '\n', 'utf8');
    } catch (error) {
        errorWithTimestamp('Failed to log ping:', error.message);
    }
}

async function writeToLogFile(message) {
    try {
        await fs.appendFile(LOG_FILE_PATH, message + '\n', 'utf8');
    } catch (error) {
        errorWithTimestamp('Failed to write to log file:', error.message);
    }
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
            `SELECT d.dispenser_id, d.address, d.customer_code, d.connected_at
             FROM dispensers d
             WHERE d.conn_status = 0
               AND d.connected_at IS NOT NULL
               AND d.connected_at <= ?`,
            [cutoff]
        );

        for (const r of rows) {
            const [existing] = await pool.query(
                `SELECT id FROM long_outage_alerts
                 WHERE address = ? AND cleared_at IS NULL
                 LIMIT 1`,
                [r.address]
            );
            if (existing.length > 0) continue;

            const [ins] = await pool.query(
                `INSERT INTO long_outage_alerts
                 (dispenser_id, address, customer_code, offline_since)
                 VALUES (?, ?, ?, ?)`,
                [r.dispenser_id, r.address, r.customer_code || null, r.connected_at]
            );

            if (longOutageNotificationService) {
                await longOutageNotificationService.sendSystemNotification(
                    'Long Outage',
                    `Device D${r.address} offline for 12h+`,
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
                `Long outage detected: D${r.address} offline since ${r.connected_at}`);
        }
    } catch (err) {
        errorWithTimestamp('Long-outage scan failed:', err.message);
    }
}

// Mark any open long_outage row for this address as cleared. Returns the
// cleared row(s) so the caller can broadcast a 'long_outage_cleared' event.
async function clearLongOutageForAddress(address) {
    try {
        const [open] = await pool.query(
            `SELECT id, dispenser_id, customer_code, offline_since
             FROM long_outage_alerts
             WHERE address = ? AND cleared_at IS NULL`,
            [address]
        );
        if (open.length === 0) return [];
        await pool.query(
            `UPDATE long_outage_alerts
             SET cleared_at = CURRENT_TIMESTAMP
             WHERE address = ? AND cleared_at IS NULL`,
            [address]
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
    setLongOutageNotificationService,
    scanLongOutages,
    clearLongOutageForAddress,
    startLongOutageService
};