const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dgram = require('dgram');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./password-utils');
const pool = require('./db'); // Use shared pool from db.js
const {
    setNotificationService,
    registerGetRequest,
    subscribeToTopic,
    unsubscribeFromTopic,
    getGsmStatus,
    getWiFiStatus,
    getMqttStatus,
    getGsmConnectionStatus,
    getWifiConnectionStatus,
    publishMessage,
    refreshConnStatusSubscriptions,
    refreshConnStatusForAddress,
    registerPriceUpdateJob,
    getPriceUpdateJob,
    acquirePriceAckSubscription,
    releasePriceAckSubscription,
    isPriceAckSubscribed,
    hasActivePriceUpdate,
    shutdownMqtt } = require('./mqtt-service');

const {
    startMidnightResetService,
    NotificationService,
    NotificationWebSocketServer,
    fetchStationSheetRows,
    getClientIp,
    requireApiKey,
    denyUnlessRole,
    logActivity,
    logPriceDebug,
    ensureDAddress,
    stripDAddress,
    addressOutSql,
    describeMqttCommand,
    setLongOutageNotificationService,
    startLongOutageService } = require('./backend-services');

const { txnFilters } = require('./stats-service');
const { parsePriceSheet, stationPriceForProduct, archivePriceChanges } = require('./price-service');

const { log } = require('console');
const console = require('console');

const app = express();
// Only honor X-Forwarded-For when the request actually came from loopback
// (i.e. a reverse proxy running on the same box). A blanket `true` would let
// any remote client set XFF and trivially bypass the sign-in rate limiter.
// If you later add a reverse proxy on a different host, list its IP(s) here.
app.set('trust proxy', 'loopback');

// Security headers. CSP is left default — the frontend pulls Leaflet from
// unpkg.com via <script src> tags, so a strict default-src 'self' policy
// would break the map. Tighten this once those assets are vendored locally.
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: empty CORS_ORIGINS means same-origin only (frontend and API share
// this port). To allow other origins, set CORS_ORIGINS in .env to a
// comma-separated list, e.g. "https://duc.example.com,http://192.168.10.51:4414".
const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
app.use(cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true
}));

app.use(express.json());

// Static frontend. The HTML/JS/CSS live one level up from backend/. With this
// in place there is no need for a separate http-server process — the same
// Node listener serves both the API and the dashboard.
app.use(express.static(path.join(__dirname, '..')));

// Liveness probe for monitors and reverse proxies. Reports MySQL reachability.
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'ok', uptime_s: Math.round(process.uptime()) });
    } catch (err) {
        res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
    }
});

// Best-effort attach the authenticated user to req for activity logging on
// mutating routes. Failures here are silent — the actual auth gates live in
// their own checks (/api/auth/verify); this middleware only enriches logs.
app.use(async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token && JWT_SECRET) {
            const decoded = jwt.verify(token, JWT_SECRET);
            req.authUser = {
                id: decoded.userId || decoded.id || decoded.user_id || null,
                username: decoded.username || null,
                role: decoded.role || null
            };
        }
    } catch (_) { /* unauthenticated or invalid — ignore */ }
    next();
});

// Add WebSocket server initialization
let notificationWebSocketServer;
let notificationService;

// Maximum allowed values for DECIMAL(15,2)
const MAX_DECIMAL_VALUE = 9999999999999.99;

// Cache to deduplicate updates (using message hash)
const recentUpdates = new Map();
const DEDUPE_WINDOW = 5000; // 5 seconds
const JWT_SECRET = process.env.JWT_SECRET;

// Start the midnight reset service when server starts
async function initializeServer() {
    try {
        await startMidnightResetService();
        console.log('Server initialization completed successfully');
    } catch (error) {
        console.error('Server initialization failed:', error);
        process.exit(1);
    }
}

// Initialize server before starting
initializeServer().then(() => {
    const PORT = parseInt(process.env.PORT || '4414', 10);
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);

        // Initialize WebSocket server for notifications
        notificationWebSocketServer = new NotificationWebSocketServer(server);
        notificationService = new NotificationService(notificationWebSocketServer);

        // Pass notification service to MQTT service
        setNotificationService(notificationService);
        // Give the long-outage scanner the same broadcaster.
        setLongOutageNotificationService(notificationService);

        console.log('WebSocket notification server initialized');

        // Start periodic 12h-disconnect detection
        startLongOutageService();
    });

    // Integration port: same Express app, separate listener for external
    // service-to-service traffic (Price Update python app, etc.). Forward
    // ONLY this port through the firewall; keep the main port LAN-only.
    const INTEGRATION_PORT = parseInt(process.env.INTEGRATION_PORT || '7717', 10);
    const integrationServer = app.listen(INTEGRATION_PORT, () => {
        console.log(`Integration API listening on port ${INTEGRATION_PORT}`);
    });

    // Graceful shutdown: stop accepting new connections, close MQTT, drain
    // the DB pool, then exit. Without this, SIGTERM (e.g. from NSSM or a
    // service-manager restart) leaves messages mid-flight and connections
    // half-open.
    let shuttingDown = false;
    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`${signal} received — shutting down`);

        const forceExit = setTimeout(() => {
            console.error('Forced exit after 10s — shutdown timed out');
            process.exit(1);
        }, 10_000);
        forceExit.unref();

        try {
            await new Promise(r => server.close(r));
            await new Promise(r => integrationServer.close(r));
            if (typeof shutdownMqtt === 'function') await shutdownMqtt();
            await pool.end();
            console.log('Clean shutdown complete');
            process.exit(0);
        } catch (err) {
            console.error('Error during shutdown:', err);
            process.exit(1);
        }
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.get('/api/station-locations', async (req, res) => {
    try {
        const stations = await fetchStationSheetRows();

        const [dispenserRows] = await pool.query(
            'SELECT customer_code, conn_status FROM dispensers'
        );
        const dispenserStats = new Map();
        for (const d of dispenserRows) {
            const stats = dispenserStats.get(d.customer_code) || { total: 0, online: 0 };
            stats.total += 1;
            if (Number(d.conn_status) === 1) stats.online += 1;
            dispenserStats.set(d.customer_code, stats);
        }

        const result = stations.map(s => {
            const stats = dispenserStats.get(s.customer_code) || { total: 0, online: 0 };
            const offline = stats.total - stats.online;
            let status;
            if (stats.total === 0) status = 'no_duc';
            else if (stats.online === 0) status = 'all_offline';
            else if (offline === 0) status = 'all_online';
            else status = 'partial';
            return {
                ...s,
                duc_count: stats.total,
                online_count: stats.online,
                offline_count: offline,
                status
            };
        });

        res.json(result);
    } catch (error) {
        console.error('Error building station locations:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch station locations' });
    }
});

// Dispensers in the DB whose customer_code is NOT present in the station sheet.
// These are invisible to dashboard counts (which sum over sheet stations only),
// so we surface them as alerts to flag the data drift.
app.get('/api/orphan-dispensers', async (req, res) => {
    try {
        const sheet = await fetchStationSheetRows();
        const sheetCodes = new Set(sheet.map(s => String(s.customer_code || '').trim()).filter(Boolean));

        const [rows] = await pool.query(
            `SELECT customer_code,
                    COUNT(*)                                    AS dispenser_count,
                    GROUP_CONCAT(${addressOutSql()} ORDER BY dispenser_id) AS addresses
             FROM dispensers
             WHERE customer_code IS NOT NULL AND customer_code <> ''
             GROUP BY customer_code`
        );
        const orphans = rows
            .filter(r => !sheetCodes.has(String(r.customer_code).trim()))
            .map(r => ({
                customer_code: r.customer_code,
                dispenser_count: Number(r.dispenser_count) || 0,
                addresses: (r.addresses || '').split(',').filter(Boolean)
            }));
        res.json(orphans);
    } catch (error) {
        console.error('Error building orphan dispensers list:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch orphan dispensers' });
    }
});

app.get('/api/dashboard-stats', async (req, res) => {
    try {
        const f = await txnFilters(req);
        if (!f) {
            return res.json({
                today: { tx_count: 0, total_amount: 0, total_volume: 0 },
                hourly: Array.from({ length: 24 }, (_, h) => ({ hour: h, tx_count: 0, amount: 0, volume: 0 })),
                products: []
            });
        }
        const filterClause = f.clause;
        const filterParams = f.params;

        const [totalsRows] = await pool.query(
            `SELECT
                COUNT(*) AS total_count,
                COALESCE(SUM(amount), 0) AS total_amount,
                COALESCE(SUM(volume), 0) AS total_volume
             FROM transactions
             WHERE DATE(time) = CURDATE() ${filterClause}`,
            filterParams
        );

        const [hourlyRows] = await pool.query(
            `SELECT
                HOUR(time) AS hour,
                COUNT(*) AS tx_count,
                COALESCE(SUM(amount), 0) AS amount,
                COALESCE(SUM(volume), 0) AS volume
             FROM transactions
             WHERE DATE(time) = CURDATE() ${filterClause}
             GROUP BY HOUR(time)`,
            filterParams
        );

        const hourly = Array.from({ length: 24 }, (_, h) => ({
            hour: h, tx_count: 0, amount: 0, volume: 0
        }));
        for (const r of hourlyRows) {
            const h = Number(r.hour);
            if (h >= 0 && h < 24) {
                hourly[h] = {
                    hour: h,
                    tx_count: Number(r.tx_count) || 0,
                    amount: Number(r.amount) || 0,
                    volume: Number(r.volume) || 0
                };
            }
        }

        const productFilterClause = f.tClause;
        const [productRows] = await pool.query(
            `SELECT
                COALESCE(n.product, 'Unknown') AS product,
                COUNT(*) AS tx_count,
                COALESCE(SUM(t.amount), 0) AS amount,
                COALESCE(SUM(t.volume), 0) AS volume
             FROM transactions t
             LEFT JOIN nozzles n
               ON n.customer_code = t.customer_code
              AND n.dispenser_id  = t.dispenser_id
              AND n.nozzle_id     = t.nozzle_id
             WHERE DATE(t.time) = CURDATE() ${productFilterClause}
             GROUP BY n.product`,
            filterParams
        );

        const products = productRows.map(r => ({
            product: r.product || 'Unknown',
            tx_count: Number(r.tx_count) || 0,
            amount:   Number(r.amount) || 0,
            volume:   Number(r.volume) || 0
        }));

        res.json({
            today: {
                tx_count: Number(totalsRows[0].total_count) || 0,
                total_amount: Number(totalsRows[0].total_amount) || 0,
                total_volume: Number(totalsRows[0].total_volume) || 0
            },
            hourly,
            products
        });
    } catch (error) {
        console.error('Error building dashboard stats:', error);
        res.status(500).json({ error: error.message || 'Failed to build dashboard stats' });
    }
});

// Time-series for the dashboard Sales chart. `range` controls bucket size:
//   6h     -> last 6 hours, hourly buckets
//   day    -> today's 24 hourly buckets (default)
//   week   -> last 7 days, daily buckets
//   month  -> last 30 days, daily buckets
app.get('/api/sales-series', async (req, res) => {
    try {
        const range = (req.query.range || 'day').toLowerCase();
        const f = await txnFilters(req);
        if (!f) return res.json({ range, points: [], peak: 0, total: 0 });
        const filterClause = f.clause;
        const params = f.params;

        let points = [];

        if (range === '6h') {
            const [rows] = await pool.query(
                `SELECT DATE_FORMAT(time, '%Y-%m-%d %H:00:00') AS bucket,
                        COUNT(*) AS tx_count,
                        COALESCE(SUM(amount), 0) AS amount,
                        COALESCE(SUM(volume), 0) AS volume
                   FROM transactions
                  WHERE time >= DATE_SUB(NOW(), INTERVAL 6 HOUR) ${filterClause}
               GROUP BY bucket
               ORDER BY bucket ASC`,
                params
            );
            const map = new Map(rows.map(r => [r.bucket.toString().slice(0, 13), r]));
            const now = new Date();
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now.getTime() - i * 3600000);
                d.setMinutes(0, 0, 0);
                const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}`;
                const r = map.get(key);
                points.push({
                    label: String(d.getHours()).padStart(2, '0') + ':00',
                    iso: d.toISOString(),
                    tx_count: r ? Number(r.tx_count) || 0 : 0,
                    amount:   r ? Number(r.amount)   || 0 : 0,
                    volume:   r ? Number(r.volume)   || 0 : 0
                });
            }
        } else if (range === 'week' || range === 'month') {
            const days = range === 'week' ? 7 : 30;
            const [rows] = await pool.query(
                `SELECT DATE(time) AS bucket,
                        COUNT(*) AS tx_count,
                        COALESCE(SUM(amount), 0) AS amount,
                        COALESCE(SUM(volume), 0) AS volume
                   FROM transactions
                  WHERE DATE(time) >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ${filterClause}
               GROUP BY DATE(time)
               ORDER BY bucket ASC`,
                [days - 1, ...params]
            );
            const map = new Map(rows.map(r => {
                const d = new Date(r.bucket);
                const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                return [key, r];
            }));
            const now = new Date();
            for (let i = days - 1; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
                const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                const r = map.get(key);
                const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
                points.push({
                    label: range === 'week'
                        ? weekdays[d.getDay()]
                        : `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`,
                    iso: d.toISOString(),
                    tx_count: r ? Number(r.tx_count) || 0 : 0,
                    amount:   r ? Number(r.amount)   || 0 : 0,
                    volume:   r ? Number(r.volume)   || 0 : 0
                });
            }
        } else {
            // day (default): 24 hourly buckets for today, truncated at current hour
            const [rows] = await pool.query(
                `SELECT HOUR(time) AS hour,
                        COUNT(*) AS tx_count,
                        COALESCE(SUM(amount), 0) AS amount,
                        COALESCE(SUM(volume), 0) AS volume
                   FROM transactions
                  WHERE DATE(time) = CURDATE() ${filterClause}
               GROUP BY HOUR(time)`,
                params
            );
            const byHour = new Map(rows.map(r => [Number(r.hour), r]));
            const currentHour = new Date().getHours();
            for (let h = 0; h <= currentHour; h++) {
                const r = byHour.get(h);
                points.push({
                    label: String(h).padStart(2, '0') + ':00',
                    iso: null,
                    tx_count: r ? Number(r.tx_count) || 0 : 0,
                    amount:   r ? Number(r.amount)   || 0 : 0,
                    volume:   r ? Number(r.volume)   || 0 : 0
                });
            }
        }

        const peak  = points.reduce((m, p) => Math.max(m, p.amount), 0);
        const total = points.reduce((s, p) => s + p.amount, 0);

        res.json({ range, points, peak, total });
    } catch (error) {
        console.error('Error building sales series:', error);
        res.status(500).json({ error: error.message || 'Failed to build sales series' });
    }
});

// Active long-outage alerts: devices that have been offline >=12h continuously
// and have not yet reconnected. Drives the dashboard Alerts panel.
app.get('/api/long-outages', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        const [rows] = await pool.query(
            `SELECT id, dispenser_id, ${addressOutSql()} AS address, customer_code,
                    offline_since, created_at, cleared_at
             FROM long_outage_alerts
             WHERE cleared_at IS NULL
             ORDER BY id DESC
             LIMIT ?`,
            [limit]
        );
        res.json(rows);
    } catch (error) {
        console.error('Error fetching long-outage alerts:', error);
        res.status(500).json({ error: error.message || 'Failed to fetch long-outage alerts' });
    }
});

app.get('/api/auth/verify', async (req, res) => {
  // Auth state must always be revalidated against the live session — never
  // served stale from any HTTP cache. Without this, a browser can hand a
  // reopened tab a cached "authenticated" 200 (page renders), then return the
  // real 401 on the next navigation, bouncing the user to signin.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      console.log('No token provided');
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    // Verify JWT (automatically checks expiration)
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        console.log('Token has expired');
        // Update session to signed_in = 0 if expired
        await pool.query(
          'UPDATE sessions SET signed_in = 0 WHERE session_token = ?',
          [token]
        );
        return res.status(401).json({ success: false, message: 'Token expired' });
      }
      console.log('JWT verification failed:', jwtError.message);
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    
    const userId = decoded.userId || decoded.id || decoded.user_id;
    
    if (!userId) {
      console.log('No user ID found in token');
      return res.status(401).json({ success: false, message: 'Invalid token format' });
    }
       
    // Check if session exists and is signed in
    const [sessions] = await pool.query(
      'SELECT * FROM sessions WHERE session_token = ? AND signed_in = 1',
      [token]
    );

    if (sessions.length === 0) {
      console.log('No active session found for token');
      return res.status(401).json({ success: false, message: 'Session not active' });
    }
    
    // Get user from database
    const [users] = await pool.query(
      'SELECT id, username, role, customer_code, is_active, allow_price_update FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      console.log('User not found in database for ID:', userId);
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const user = users[0];
    
    if (user.is_active === 0) {
      console.log('Account is disabled');
      // Update session to signed_in = 0
      await pool.query(
        'UPDATE sessions SET signed_in = 0 WHERE session_token = ?',
        [token]
      );
      return res.status(401).json({ success: false, message: 'Account disabled' });
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        customer_code: user.customer_code,
        allow_price_update: user.allow_price_update
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Re-confirm the signed-in user's password without any of the side effects of
// a full sign-in (no rate-limit counter, no last_login bump, no new session
// token, no activity log). Used as a second-factor gate before high-impact
// actions such as publishing a dispenser lock/unlock command. The identity is
// taken from the bearer token — the caller can only confirm their OWN password.
app.post('/api/auth/confirm-password', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const token = req.headers.authorization?.split(' ')[1];
    const { password } = req.body || {};

    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    const userId = decoded.userId || decoded.id || decoded.user_id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Invalid token format' });
    }

    const [users] = await pool.query(
      'SELECT password, is_active FROM users WHERE id = ?',
      [userId]
    );
    if (users.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if (users[0].is_active === 0) {
      return res.status(401).json({ success: false, message: 'Account disabled' });
    }

    // Verify against the stored hash (see /api/auth/signin). A mismatch is a 200
    // with success:false — it's an expected outcome of the gate, not a
    // server/auth error.
    if (!verifyPassword(password, users[0].password)) {
      return res.status(200).json({ success: false, message: 'Incorrect password' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Confirm password error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/auth/station/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [stations] = await pool.query(
      `SELECT id, username, customer_code, station_id, 
              city, created_at 
       FROM stations 
       WHERE id = ? OR customer_code = ?`,
      [id, id]
    );

    if (stations.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Station not found' 
      });
    }

    const station = stations[0];
    
    res.json({
      success: true,
      station
    });

  } catch (error) {
    console.error('Get station error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

app.get('/api/users', async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, username, role, customer_code, allow_price_update, last_login, created_at FROM users'
        );
        res.json(users);
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [users] = await pool.query(
            'SELECT id, username, role, customer_code, is_active, allow_price_update, last_login, created_at FROM users WHERE id = ?',
            [id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(users[0]);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ error: 'Failed to fetch user' });
    }
});

// Get all stations
app.get('/api/stations', async (req, res) => {
    try {
        // GROUP_CONCAT pulls every dispenser's address for the station so the
        // sites table can show "DUCs installed" as a comma-separated list
        // without a second round trip. Each address is normalized to the
        // D-prefixed canonical form regardless of how the row was stored.
        const [stations] = await pool.query(
            `SELECT s.id, s.customer_code, s.station_id, s.city, s.district,
                    s.division, s.username, s.created_at,
                    GROUP_CONCAT(${addressOutSql('d')} ORDER BY d.address SEPARATOR ', ') AS duc_addresses
             FROM stations s
             LEFT JOIN dispensers d ON d.customer_code = s.customer_code
             GROUP BY s.id
             ORDER BY s.id`
        );
        res.json(stations);
    } catch (error) {
        console.error('Get stations error:', error);
        res.status(500).json({ error: 'Failed to fetch stations' });
    }
});

// In-memory multer storage for the prices upload — file is parsed end-to-end
// in the request handler and discarded; never touches disk. 5 MB cap is well
// above the ~1 MB real files seen so far.
const pricesUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// In-handler gate for the Upload Price File page endpoints. Read fresh each call 
// so a revoked grant takes effect at once rather than lingering until the 4h JWT 
// expires. Returns true (and sends 401/403/500) when access is denied.
async function denyUnlessPriceAccess(req, res) {
    const userId = req.authUser?.id;
    if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return true;
    }
    try {
        const [rows] = await pool.query(
            'SELECT allow_price_update FROM users WHERE id = ?',
            [userId]
        );
        if (rows.length && rows[0].allow_price_update) return false;
    } catch (error) {
        console.error('Price access check failed:', error);
        res.status(500).json({ error: 'Server error' });
        return true;
    }
    res.status(403).json({ error: 'Price-file access not granted' });
    return true;
}

app.post('/api/admin/upload-prices', pricesUpload.single('file'), async (req, res) => {
    if (await denyUnlessPriceAccess(req, res)) return;
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
    }

    let conn;
    try {
        const XLSX = require('xlsx');
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });

        const sheetByProduct = {
            PMG:  workbook.Sheets['PMG_PRICE_CHANGE'],
            HSD:  workbook.Sheets['HSD_PRICE_CHANGE'],
            HOBC: workbook.Sheets['HOBC_PRICE_CHANGE']
        };
        if (!sheetByProduct.PMG && !sheetByProduct.HSD && !sheetByProduct.HOBC) {
            return res.status(400).json({ error: 'No PMG/HSD/HOBC price sheets found in this workbook' });
        }

        const pricesByProduct = {
            PMG:  sheetByProduct.PMG  ? parsePriceSheet(sheetByProduct.PMG)  : new Map(),
            HSD:  sheetByProduct.HSD  ? parsePriceSheet(sheetByProduct.HSD)  : new Map(),
            HOBC: sheetByProduct.HOBC ? parsePriceSheet(sheetByProduct.HOBC) : new Map()
        };

        const [stationRows] = await pool.query('SELECT customer_code, station_id, city, district FROM stations');
        const known = new Set(stationRows.map(r => r.customer_code));
        const stationByCode = new Map(stationRows.map(r => [r.customer_code, r]));
        const stationNameByCode = new Map(stationRows.map(r => [r.customer_code, r.station_id || '']));

        // Which stations actually have a nozzle (DUC) for each product. A station
        // is only flagged as missing-price / not-listed for a product if it has
        // a DUC for that product — otherwise the price is irrelevant to it.
        const [nozzleRows] = await pool.query(
            `SELECT DISTINCT customer_code, UPPER(product) AS product
               FROM nozzles
              WHERE product IS NOT NULL AND product <> ''`
        );
        const ducCodesByProduct = { PMG: new Set(), HSD: new Set(), HOBC: new Set() };
        for (const r of nozzleRows) {
            const p = (r.product || '').toUpperCase();
            if (ducCodesByProduct[p]) ducCodesByProduct[p].add(r.customer_code);
        }

        const updatedByProduct = { PMG: 0, HSD: 0, HOBC: 0 };
        const archiveEntries = [];  // one per (station, product) actually written

        conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            for (const product of ['PMG', 'HSD', 'HOBC']) {
                const priceMap = pricesByProduct[product].prices;
                if (!priceMap.size) continue;
                const col = `price_${product.toLowerCase()}`;

                for (const [code, price] of priceMap.entries()) {
                    // Codes in the file but not in the DB are silently
                    // skipped (no list returned for these).
                    if (!known.has(code)) continue;
                    await conn.query(
                        `UPDATE stations SET \`${col}\` = ?, prices_updated_at = NOW() WHERE customer_code = ?`,
                        [price, code]
                    );
                    updatedByProduct[product]++;
                    const st = stationByCode.get(code);
                    archiveEntries.push({
                        customer_code: code,
                        station_id: st?.station_id || null,
                        city: st?.city || null,
                        district: st?.district || null,
                        product,
                        price
                    });
                }
            }

            // Sync nozzles.actual_price from each station's matching product
            // price. JOIN is one round trip per product, regardless of nozzle count.
            for (const product of ['PMG', 'HSD', 'HOBC']) {
                const col = `price_${product.toLowerCase()}`;
                await conn.query(
                    `UPDATE nozzles n
                     JOIN stations s ON s.customer_code = n.customer_code
                        SET n.actual_price = s.\`${col}\`
                      WHERE UPPER(n.product) = ?`,
                    [product]
                );
            }

            // Log every written (station, product) price into the archive so the
            // change history survives the next overwrite. Same transaction.
            await archivePriceChanges(conn, archiveEntries, 'upload', req.authUser);

            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        }

        // Per product, split the stations that have a DUC for that product into
        // two problem lists (skipping any product whose sheet wasn't in the file):
        //   missingPrice — listed in the sheet but with no usable price.
        //   notListed    — not present in the sheet at all.
        const sheetsPresent = {
            PMG:  !!sheetByProduct.PMG,
            HSD:  !!sheetByProduct.HSD,
            HOBC: !!sheetByProduct.HOBC
        };
        const missingPriceByProduct = { PMG: [], HSD: [], HOBC: [] };
        const notListedByProduct    = { PMG: [], HSD: [], HOBC: [] };
        const byCodeAsc = (a, b) => String(a.customer_code).localeCompare(String(b.customer_code));
        for (const product of ['PMG', 'HSD', 'HOBC']) {
            if (!sheetsPresent[product]) continue;
            const { prices: priceMap, listed } = pricesByProduct[product];
            const ducCodes = ducCodesByProduct[product];
            for (const code of ducCodes) {
                if (!known.has(code)) continue;  // nozzle without a station row — ignore
                const entry = { customer_code: code, station_id: stationNameByCode.get(code) || '' };
                if (!listed.has(code)) notListedByProduct[product].push(entry);
                else if (!priceMap.has(code)) missingPriceByProduct[product].push(entry);
            }
            missingPriceByProduct[product].sort(byCodeAsc);
            notListedByProduct[product].sort(byCodeAsc);
        }

        await logActivity(req, 'upload_prices', { entity_type: 'prices', details: {
            file: req.file.originalname,
            updated: updatedByProduct,
            missing_price_counts: {
                PMG: missingPriceByProduct.PMG.length,
                HSD: missingPriceByProduct.HSD.length,
                HOBC: missingPriceByProduct.HOBC.length
            },
            not_listed_counts: {
                PMG: notListedByProduct.PMG.length,
                HSD: notListedByProduct.HSD.length,
                HOBC: notListedByProduct.HOBC.length
            }
        }});

        res.json({
            ok: true,
            updated: updatedByProduct,
            sheetsPresent,
            missingPrice: missingPriceByProduct,
            notListed: notListedByProduct
        });
    } catch (error) {
        console.error('upload-prices failed:', error);
        res.status(500).json({ error: error.message || 'Upload failed' });
    } finally {
        if (conn) conn.release();
    }
});

// Manual price entry from the Prices page. Same propagation as the file
// upload (stations.price_* → nozzles.actual_price via JOIN), but for one
// customer_code and any subset of the three products. NULL fields are
// untouched; at least one must be present so we never write an empty update.
app.post('/api/admin/prices/manual', async (req, res) => {
    if (await denyUnlessPriceAccess(req, res)) return;

    const { customer_code, price_pmg, price_hsd, price_hobc } = req.body || {};
    if (!customer_code) {
        return res.status(400).json({ error: 'customer_code is required' });
    }

    // Parse the three optional price inputs. Empty/null/undefined → not provided.
    const raw = { pmg: price_pmg, hsd: price_hsd, hobc: price_hobc };
    const parsed = { pmg: null, hsd: null, hobc: null };
    for (const [k, v] of Object.entries(raw)) {
        if (v == null || v === '') continue;
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) {
            return res.status(400).json({ error: `Invalid ${k.toUpperCase()} price: ${v}` });
        }
        parsed[k] = n;
    }

    if (parsed.pmg == null && parsed.hsd == null && parsed.hobc == null) {
        return res.status(400).json({ error: 'At least one price must be provided' });
    }

    // Station must exist — bail loudly rather than silently no-op'ing.
    const [stationRows] = await pool.query(
        'SELECT customer_code, station_id, city, district FROM stations WHERE customer_code = ?',
        [customer_code]
    );
    if (stationRows.length === 0) {
        return res.status(404).json({ error: `Customer code ${customer_code} not found in stations` });
    }
    const station = stationRows[0];

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            // Build the UPDATE so we only touch columns the user actually
            // entered — NULLs stay NULL, existing prices stay if not provided.
            const fields = [];
            const values = [];
            for (const [k, n] of Object.entries(parsed)) {
                if (n == null) continue;
                fields.push(`price_${k} = ?`);
                values.push(n);
            }
            fields.push('prices_updated_at = NOW()');
            values.push(customer_code);
            await conn.query(
                `UPDATE stations SET ${fields.join(', ')} WHERE customer_code = ?`,
                values
            );

            // Propagate to nozzles.actual_price for each product the user
            // updated. Scoped to this customer_code only.
            for (const [k, n] of Object.entries(parsed)) {
                if (n == null) continue;
                const product = k.toUpperCase();
                const col = `price_${k}`;
                await conn.query(
                    `UPDATE nozzles n
                     JOIN stations s ON s.customer_code = n.customer_code
                        SET n.actual_price = s.\`${col}\`
                      WHERE n.customer_code = ? AND UPPER(n.product) = ?`,
                    [customer_code, product]
                );
            }

            // Archive one row per product the user set, in the same transaction.
            const archiveEntries = Object.entries(parsed)
                .filter(([, n]) => n != null)
                .map(([k, n]) => ({
                    customer_code,
                    station_id: station.station_id || null,
                    city: station.city || null,
                    district: station.district || null,
                    product: k.toUpperCase(),
                    price: n
                }));
            await archivePriceChanges(conn, archiveEntries, 'manual', req.authUser);

            await conn.commit();
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        }

        await logActivity(req, 'manual_price_entry', {
            entity_type: 'prices',
            entity_id: customer_code,
            details: {
                customer_code,
                price_pmg: parsed.pmg,
                price_hsd: parsed.hsd,
                price_hobc: parsed.hobc
            }
        });

        res.json({ ok: true, customer_code, updated: parsed });
    } catch (error) {
        console.error('manual-prices failed:', error);
        res.status(500).json({ error: error.message || 'Manual price entry failed' });
    } finally {
        if (conn) conn.release();
    }
});

// Listing for the Prices page. Returns one row per station with its current
// PMG/HSD/HOBC prices and when they were last refreshed.
app.get('/api/admin/prices', async (req, res) => {
    if (await denyUnlessPriceAccess(req, res)) return;
    try {
        const [rows] = await pool.query(
            `SELECT customer_code, station_id, city, division,
                    price_pmg, price_hsd, price_hobc, prices_updated_at
               FROM stations
               ORDER BY customer_code`
        );
        res.json(rows);
    } catch (error) {
        console.error('Get prices error:', error);
        res.status(500).json({ error: 'Failed to fetch prices' });
    }
});

app.post('/api/admin/refresh-conn-status', async (req, res) => {
    if (denyUnlessRole(req, res, 'super_admin')) return;
    try {
        const result = await refreshConnStatusSubscriptions();
        await logActivity(req, 'refresh_conn_status', {
            entity_type: 'mqtt',
            details: result
        });
        res.json({ ok: true, ...result });
    } catch (error) {
        console.error('refresh-conn-status failed:', error);
        res.status(500).json({ error: error.message || 'Refresh failed' });
    }
});

// Per-dispenser conn_status refresh — the per-card "Refresh Status" action.
// Available to any authenticated user (mirrors the publish endpoint, which is
// likewise open to all roles including viewer).
app.post('/api/dispensers/refresh-conn-status', async (req, res) => {
    try {
        const { address } = req.body || {};
        if (!address) {
            return res.status(400).json({ error: 'address is required' });
        }
        const result = await refreshConnStatusForAddress(address);
        await logActivity(req, 'refresh_conn_status_single', {
            entity_type: 'mqtt',
            entity_id: ensureDAddress(address),
            details: result
        });
        res.json({ ok: true, ...result });
    } catch (error) {
        console.error('refresh-conn-status (single) failed:', error);
        res.status(500).json({ error: error.message || 'Refresh failed' });
    }
});

// ----- Price Update over MQTT (admin + super_admin) -----
//
// Web equivalent of price_update_app/python/manual_entry.py. Publishes a price
// update to PSO/<city>/<customer>/duc/price/<product> for each non-null price
// the operator entered. DUCs are expected to reply on duc/acked_msgs after
// applying the new price; mqtt-service tracks those ACKs against the returned
// job_id so the page can poll /price-update/acks/:job_id and render progress.
const PRICE_PRODUCTS = ['PMG', 'HSD', 'HOBC'];

// Grace period after a fresh duc/acked_msgs subscription before we publish, so
// the SUBACK has fully settled and no early ACK is missed.
const PRICE_ACK_SETTLE_MS = 2000;

// Snapshot of the single in-flight price-update job (publish payload + identity),
// or null when none is active. Lets a refreshed page restore the job view.
let _activePriceUpdate = null;
// Control handle for the in-flight job: { jobId, finalize(status) }. Lets the
// dismiss endpoint finalize the job early. Not serialized to clients.
let _activeJobControl = null;

// Milliseconds until the active job finalizes (its window closes and a new
// publish is allowed). 0 when none is active. The client uses this to keep the
// Publish button disabled for exactly that long.
function _priceUpdateFinalizeInMs() {
    if (!_activePriceUpdate || !_activePriceUpdate.finalizesAt) return 0;
    return Math.max(0, _activePriceUpdate.finalizesAt - Date.now());
}

// nozzles.status tri-state, same mapping the dispensers page shows:
//   1 = Auto (device + MB reachable), 0 = Manual (device up, MB silent),
//   2 = No Ping (no recent ping). Used to annotate the audit trail.
const NOZZLE_STATUS_LABELS = { 0: 'Manual', 1: 'Auto', 2: 'No Ping' };

// Snapshot the DUCs targeted by a price update: every D-address that has a
// nozzle for one of the published products, annotated with its connection
// state, whether it ACKed (per product), and the status of each of its nozzles
// (Auto/Manual/No Ping, per product). Scoped to `products` so we don't record
// nozzle states for products that weren't part of this update.
//
// `ackByProduct` is { PRODUCT -> Set<addrD> } of DUCs that ACKed each product.
// Best-effort: returns [] on failure so logging never blocks anything.
async function _collectDucNozzleStatus(customer_code, products, ackByProduct) {
    const productList = Array.from(products);
    if (productList.length === 0) return [];
    try {
        const placeholders = productList.map(() => '?').join(', ');
        const [rows] = await pool.query(
            `SELECT ${addressOutSql('d')} AS address,
                    d.conn_status         AS conn_status,
                    UPPER(n.product)      AS product,
                    n.nozzle_id           AS nozzle_id,
                    n.status              AS status
               FROM dispensers d
               JOIN nozzles n
                    ON n.dispenser_id = d.dispenser_id
                   AND n.customer_code = d.customer_code
              WHERE d.customer_code = ?
                AND UPPER(n.product) IN (${placeholders})
              ORDER BY address, product, n.nozzle_id`,
            [customer_code, ...productList]
        );

        const byAddr = new Map();
        for (const r of rows) {
            const address = ensureDAddress(r.address);
            if (!byAddr.has(address)) {
                byAddr.set(address, {
                    addr: address,
                    conn: Number(r.conn_status) === 1 ? 'Connected'
                        : Number(r.conn_status) === 2 ? 'N/A' : 'Disconnected',
                    products: {}
                });
            }
            const entry = byAddr.get(address);
            const product = r.product;
            if (!entry.products[product]) {
                const ackMap = ackByProduct[product];
                const ackedAt = ackMap ? ackMap.get(address) : undefined;
                entry.products[product] = ackedAt
                    ? { ack: true, ackedAt, noz: {} }
                    : { ack: false, noz: {} };
            }
            // nozzle_id is "D<addr>-<side><number>" (e.g. "D01-A1"); key the
            // status by the short "A1"/"B1" label after the dash.
            const dash = String(r.nozzle_id || '').lastIndexOf('-');
            const nozLabel = dash >= 0 ? r.nozzle_id.slice(dash + 1) : (r.nozzle_id || '?');
            entry.products[product].noz[nozLabel] = NOZZLE_STATUS_LABELS[Number(r.status)] || 'Unknown';
        }
        return Array.from(byAddr.values());
    } catch (e) {
        console.error('collect DUC nozzle status failed:', e);
        return [];
    }
}

// Deferred audit write for a price update. Runs on a timer after the publish
// response has already returned, so ACKs (which land on duc/acked_msgs over the
// following seconds/minutes) are captured in the same log entry — no second
// row to correlate by hand. For retained publishes it also clears the retained
// message off the broker first, so DUCs connecting later don't pick up a stale
// price. `actor` carries the captured user/ip since `req` is no longer live.
async function _finalizePriceUpdateLog({ actor, jobId, cityLower, customer_code, validPrices, effectiveAt, effMinutes, publishedAt, retain, retainTimeoutMs, clearRetained, ackSubscribed, status, items, skipped }) {
  try {
    logPriceDebug(`FINALIZE START jobId=${jobId} status=${status} customer=${customer_code} retain=${!!retain} clearRetained=${!!clearRetained}`);
    // Clear retained price messages unless the operator chose to keep them.
    if (retain && clearRetained) {
        for (const it of items) {
            try {
                await publishMessage(it.topic, '', { qos: 1, retain: true });
            } catch (e) {
                console.error(`failed to clear retained price on ${it.topic}:`, e);
            }
        }
    }

    // Pull the final ACK tally from the in-memory job ledger.
    const job = getPriceUpdateJob(jobId);
    const ackByProduct = {};          // PRODUCT -> Map<addrD, ackedAt ISO>
    const ackedCountByProduct = {};   // PRODUCT -> number
    if (job) {
        for (const it of job.items) {
            const product = String(it.product).toUpperCase();
            ackByProduct[product] = new Map(it.acked.map(a => [a.device, a.at]));
            ackedCountByProduct[product] = it.ackedCount;
        }
    }

    const publishedProducts = new Set(items.map(it => String(it.product).toUpperCase()));
    const ducs = await _collectDucNozzleStatus(customer_code, publishedProducts, ackByProduct);

    // Key order is intentional: identity first (city, customer, prices), then
    // delivery flags, then the per-product/per-DUC breakdown.
    await logActivity(null, 'price_update_publish', {
        user_id: actor.user_id,
        username: actor.username,
        ip_address: actor.ip_address,
        entity_type: 'prices',
        entity_id: customer_code,
        details: {
            city: cityLower,
            customer_code,
            status,
            prices: validPrices,
            retained: !!retain,
            ...(retain ? { retainTimeoutMs, retainedCleared: !!clearRetained } : {}),
            ackSubscribed: !!ackSubscribed,
            effectiveAt,
            effectiveInMinutes: effMinutes,
            publishedAt,
            // Time the job actually ended, labelled by how it ended.
            [status === 'dismissed' ? 'dismissedAt' : 'completedAt']: new Date().toISOString(),
            skipped,
            published: items.map(it => ({
                product: it.product,
                ducCount: it.ducs.length,
                acked: ackedCountByProduct[String(it.product).toUpperCase()] ?? 0
            })),
            ducs
        }
    });
    const ackSummary = items.map(it =>
        `${it.product}:${ackedCountByProduct[String(it.product).toUpperCase()] ?? 0}/${it.ducs.length}`).join(', ');
    logPriceDebug(`FINALIZE DONE jobId=${jobId} status=${status} — activity-log entry written. ACKs [${ackSummary}]`);
  } finally {
    // Job's window is over: clear the in-flight snapshot/control (if still this
    // job) and drop our hold on the ACK subscription. A leaked refcount would
    // keep duc/acked_msgs subscribed indefinitely.
    if (_activePriceUpdate && _activePriceUpdate.jobId === jobId) _activePriceUpdate = null;
    if (_activeJobControl && _activeJobControl.jobId === jobId) _activeJobControl = null;
    await releasePriceAckSubscription();
  }
}

app.post('/api/admin/price-update/publish', async (req, res) => {
    if (denyUnlessRole(req, res, 'admin', 'super_admin')) return;
    const { city, customer_code, prices, retain, effectiveInMinutes } = req.body || {};
    if (!city || !customer_code || !prices || typeof prices !== 'object') {
        return res.status(400).json({ error: 'city, customer_code, and prices required' });
    }

    // Effective delay: 0 = now, else N whole minutes from now. Defaults to 0.
    const effMinutes = effectiveInMinutes == null ? 0 : Number(effectiveInMinutes);
    if (!Number.isInteger(effMinutes) || effMinutes < 0) {
        return res.status(400).json({ error: 'effectiveInMinutes must be a non-negative integer' });
    }

    // Validate and normalize each provided price into a two-decimal string —
    // matches the on-wire format the Python tool publishes ("X.XX").
    const validPrices = {};
    for (const product of PRICE_PRODUCTS) {
        const raw = prices[product];
        if (raw == null || raw === '') continue;
        const num = Number(raw);
        if (!Number.isFinite(num) || num <= 0) {
            return res.status(400).json({ error: `Invalid ${product} price: ${raw}` });
        }
        validPrices[product] = num.toFixed(2);
    }
    if (Object.keys(validPrices).length === 0) {
        return res.status(400).json({ error: 'At least one valid price required' });
    }

    // One price update at a time: while a job is still inside its ACK-collection
    // window, reject a new publish so jobs don't overlap (which muddies ACK
    // attribution and the shared duc/acked_msgs subscription).
    if (hasActivePriceUpdate()) {
        logPriceDebug(`PUBLISH REJECTED customer=${customer_code} — a price update is already in progress`);
        return res.status(409).json({
            error: 'A price update is already in progress. Please wait for it to finish before publishing another.',
            finalizeInMs: _priceUpdateFinalizeInMs()
        });
    }

    const cityLower = String(city).toLowerCase();
    // Effective time (unix seconds): now, or `effMinutes` minutes out — the
    // operator's choice. It's the `date` field in the on-wire payload (when the
    // DUC applies the new price); also returned/logged so the UI can show it.
    const effectiveAt = Math.floor(Date.now() / 1000) + effMinutes * 60;
    const date = String(effectiveAt);

    // Phase 1 — resolve which DUCs each product targets. No MQTT publish yet:
    // we want to subscribe to ACKs *before* anything goes out, so we first work
    // out whether there's anything to publish at all. Empty product lists are
    // surfaced as "skipped" so the operator can see what didn't go out.
    const skipped = [];
    const targets = [];

    try {
        for (const product of Object.keys(validPrices)) {
            const [ducRows] = await pool.query(
                `SELECT DISTINCT ${addressOutSql('d')} AS address
                   FROM dispensers d
                   JOIN nozzles n
                        ON n.dispenser_id = d.dispenser_id
                       AND n.customer_code = d.customer_code
                  WHERE d.customer_code = ?
                    AND UPPER(n.product) = ?`,
                [customer_code, product]
            );
            const ducs = ducRows.map(r => ensureDAddress(r.address)).filter(Boolean);
            if (ducs.length === 0) {
                skipped.push(product);
                continue;
            }
            const topic = `pso/${cityLower}/${customer_code}/duc/price/${product.toLowerCase()}`;
            const payload = JSON.stringify({ date, req_type: 0, message: validPrices[product] });
            // `date` + `price` are echoed back in the ACK payload, so the job
            // ledger stores them to tell a fresh ACK from a stale/retained one.
            targets.push({ product, topic, ducs, price: validPrices[product], date, payload });
        }
    } catch (e) {
        console.error('price-update target lookup failed:', e);
        return res.status(500).json({ error: `Publish failed: ${e.message}` });
    }

    if (targets.length === 0) {
        return res.status(404).json({
            error: 'No registered DUCs match the selected products',
            skipped
        });
    }

    // Phase 2 — subscribe to duc/acked_msgs and register the job BEFORE
    // publishing, so an ACK that comes back during the settle/publish window
    // still matches (otherwise it's dropped as "no active job" — a real race we
    // saw in testing). Stale/retained ACKs redelivered on subscribe can't
    // false-match because matching also checks the echoed price + date. The
    // subscription is released when this job finalizes (→ _finalizePriceUpdateLog).
    const jobId = crypto.randomUUID();
    const FINALIZE_DELAY_MS = retain ? 5 * 60 * 1000 : 15 * 1000;
    const items = targets;
    let subAcquired = false;
    let ackSubscribed = false;
    try {
        // Mark held before awaiting so the catch always releases the refcount.
        subAcquired = true;
        const freshSub = await acquirePriceAckSubscription();
        ackSubscribed = isPriceAckSubscribed();
        registerPriceUpdateJob(jobId, items);
        if (freshSub) await new Promise(r => setTimeout(r, PRICE_ACK_SETTLE_MS));
        for (const it of items) {
            await publishMessage(it.topic, it.payload, { qos: 1, retain: !!retain });
        }
    } catch (e) {
        if (subAcquired) await releasePriceAckSubscription();
        logPriceDebug(`PUBLISH FAILED customer=${customer_code}: ${e.message}`);
        console.error('price-update publish failed:', e);
        return res.status(500).json({ error: `Publish failed: ${e.message}` });
    }

    logPriceDebug(`PUBLISHED customer=${customer_code} retain=${!!retain} ackSubscribed=${ackSubscribed} ` +
        `products=[${items.map(it => `${it.product}:${it.price}(${it.ducs.length} ducs)`).join(', ')}] ` +
        `jobId=${jobId} — will finalize in ${FINALIZE_DELAY_MS / 1000}s`);

    // Audit logging is deferred so the entry can carry the DUCs' ACK statuses,
    // which trickle in over the next seconds/minutes. We wait longer for
    // retained publishes (the 5-min effective window, after which we also clear
    // the retained message); for non-retained, a short window is enough since
    // online DUCs ACK promptly. Capture the actor now — `req` won't be live when
    // the timer fires.
    const actor = {
        user_id: req.authUser?.id ?? null,
        username: req.authUser?.username ?? null,
        ip_address: getClientIp(req)
    };
    const publishedAt = new Date().toISOString();
    const finalizesAt = Date.now() + FINALIZE_DELAY_MS;

    // Finalize runner — fires automatically when the window elapses (status
    // 'completed') or early when the operator dismisses (status 'dismissed').
    // Guarded so it runs exactly once regardless of which path triggers it.
    let finalized = false;
    let finalizeTimer = null;
    const runFinalize = async (status, clearRetained = true) => {
        if (finalized) return;
        finalized = true;
        if (finalizeTimer) { clearTimeout(finalizeTimer); finalizeTimer = null; }
        try {
            await _finalizePriceUpdateLog({
                actor, jobId, cityLower, customer_code, validPrices, effectiveAt, effMinutes,
                publishedAt, retain: !!retain, retainTimeoutMs: FINALIZE_DELAY_MS, clearRetained,
                ackSubscribed, status, items, skipped
            });
        } catch (e) {
            logPriceDebug(`FINALIZE FAILED jobId=${jobId}: ${e.message}`);
            console.error('price-update audit finalize failed:', e);
        }
    };
    finalizeTimer = setTimeout(() => runFinalize('completed'), FINALIZE_DELAY_MS);
    _activeJobControl = { jobId, finalize: runFinalize };

    const responseItems = items.map(it => ({
        product: it.product,
        topic: it.topic,
        price: it.price,
        payload: it.payload,
        totalDucs: it.ducs.length,
        ducs: it.ducs
    }));

    // Snapshot the in-flight job so a page that loads/refreshes mid-job can
    // restore the same view (published list + ACK table) instead of looking
    // blank. Cleared when the job finalizes. Mirrors the publish response.
    _activePriceUpdate = {
        jobId, city: cityLower, customer_code,
        effectiveAt, retained: !!retain, publishedAt, finalizesAt,
        items: responseItems, skipped
    };

    res.json({
        jobId, effectiveAt, retained: !!retain,
        items: responseItems, skipped,
        finalizeInMs: FINALIZE_DELAY_MS
    });
});

// Returns the price-update job currently in flight (published, not yet
// finalized) so the page can rebuild its state after a refresh. The live ACK
// state is what the /acks/:job_id poll provides; this just restores the job
// identity + published payload.
app.get('/api/admin/price-update/active', (req, res) => {
    if (denyUnlessRole(req, res, 'admin', 'super_admin')) return;
    if (!_activePriceUpdate || !hasActivePriceUpdate()) {
        return res.json({ active: false });
    }
    res.json({ active: true, ..._activePriceUpdate, finalizeInMs: _priceUpdateFinalizeInMs() });
});

// Operator-initiated early end: finalize the in-flight job NOW with status
// 'dismissed' (writes the audit log, clears any retained message, frees the
// ACK subscription) so a new publish can start immediately.
app.post('/api/admin/price-update/dismiss', async (req, res) => {
    if (denyUnlessRole(req, res, 'admin', 'super_admin')) return;
    const ctrl = _activeJobControl;
    if (!ctrl || !hasActivePriceUpdate()) {
        return res.json({ dismissed: false });
    }
    // Default to clearing the retained message unless the operator chose to keep it.
    const clearRetained = (req.body && req.body.clearRetained === false) ? false : true;
    logPriceDebug(`DISMISS requested jobId=${ctrl.jobId} clearRetained=${clearRetained}`);
    await ctrl.finalize('dismissed', clearRetained);
    res.json({ dismissed: true });
});

app.get('/api/admin/price-update/acks/:job_id', (req, res) => {
    if (denyUnlessRole(req, res, 'admin', 'super_admin')) return;
    const job = getPriceUpdateJob(req.params.job_id);
    if (!job) return res.status(404).json({ error: 'Job not found or expired' });
    res.json(job);
});

// Activity log feed for the super_admin Activity Logs page. Date range is
// required (UI sends from/to before fetching) — keeps the query bounded so
// the table never tries to render the entire history.
app.get('/api/activity-log', async (req, res) => {
    try {
        const { from, to, limit } = req.query;
        if (!from || !to) {
            return res.status(400).json({ error: 'from and to dates are required' });
        }
        const cap = Math.min(parseInt(limit, 10) || 1000, 5000);
        const [rows] = await pool.query(
            `SELECT id, user_id, username, ip_address, action, entity_type,
                    entity_id, details, created_at
             FROM activity_log
             WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
            [from, to, cap]
        );
        res.json(rows);
    } catch (error) {
        console.error('Get activity log error:', error);
        res.status(500).json({ error: 'Failed to fetch activity log' });
    }
});

// Service-to-service: flat list of every nozzle joined with its dispenser
// and station. Consumed by the Price Update python app to build its DUC
// dataframe. Protected by X-API-Key so it can be exposed on the
// integration port without giving up the whole DB.
app.get('/api/ducs', requireApiKey, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT
                 n.id            AS sno,
                 s.customer_code AS customer_code,
                 s.station_id    AS station_id,
                 s.division      AS division,
                 s.city          AS city,
                 s.price_pmg     AS price_pmg,
                 s.price_hsd     AS price_hsd,
                 s.price_hobc    AS price_hobc,
                 s.prices_updated_at AS prices_updated_at,
                 ${addressOutSql('d')} AS duc_address,
                 d.conn_status   AS conn_status,
                 n.dispenser_id  AS dispenser_id,
                 n.nozzle_id     AS nozzle_id,
                 n.status        AS nozzle_status,
                 n.last_ping_at  AS last_ping_at,
                 n.product       AS product
             FROM nozzles n
             JOIN dispensers d
               ON n.customer_code = d.customer_code
              AND n.dispenser_id  = d.dispenser_id
             JOIN stations s
               ON s.customer_code = n.customer_code
             ORDER BY s.customer_code, d.address, n.nozzle_id`
        );
        res.json(rows);
    } catch (error) {
        console.error('Get ducs error:', error);
        res.status(500).json({ error: 'Failed to fetch ducs' });
    }
});

app.get('/api/stations/:customerCode', async (req, res) => {
    try {
        const { customerCode } = req.params;
        
        const [stations] = await pool.query(
            'SELECT id, username, customer_code, station_id, city, district, division, created_at FROM stations WHERE customer_code = ?',
            [customerCode]
        );
        
        if (stations.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Station not found' 
            });
        }
        
        res.json({
            success: true,
            station: stations[0]
        });
    } catch (error) {
        console.error('Get station error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

app.get('/api/dispensers', async (req, res) => {
    try {
        const { customer_code } = req.query;

        // Explicit columns — drops IMEI1/IMEI2 from the response (only
        // used server-side) so the payload stays small over the network.
        let query = `SELECT id, customer_code, dispenser_id, ${addressOutSql()} AS address, conn_status,
                            connected_at, interface_type, interface_lock_status, number_of_nozzles, DispenserBrand, created_at,
                            remark, remark_at
                     FROM dispensers`;
        let params = [];

        if (customer_code) {
            query += ' WHERE customer_code = ?';
            params.push(customer_code);
        }

        query += ' ORDER BY customer_code, dispenser_id';

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch dispensers' });
    }
});

// Aggregated endpoint: returns every dispenser with its nozzles and station info
// nested in a single response. Used by the dispensers and overview pages so
// they can render with one round trip instead of 1 + N (per-dispenser nozzles)
// + S (per-station info).
app.get('/api/dispensers-full', async (req, res) => {
    try {
        const { customer_code } = req.query;
        const params = [];
        const whereCustomer = customer_code ? 'WHERE customer_code = ?' : '';
        if (customer_code) params.push(customer_code);

        const [dispensers, nozzles, stations] = await Promise.all([
            pool.query(
                `SELECT id, customer_code, dispenser_id, ${addressOutSql()} AS address, conn_status,
                        connected_at, interface_type, interface_lock_status, number_of_nozzles, DispenserBrand, created_at,
                        remark, remark_at
                 FROM dispensers
                 ${whereCustomer}
                 ORDER BY customer_code, dispenser_id`,
                params
            ),
            pool.query(
                `SELECT customer_code, dispenser_id, nozzle_id, product, status, last_ping_at,
                        price_per_liter, actual_price, total_quantity, total_amount, total_sales_today,
                        lock_unlock, price, quantity
                 FROM nozzles
                 ${whereCustomer}`,
                params
            ),
            pool.query(
                `SELECT customer_code, station_id, city, district, division
                 FROM stations
                 ${whereCustomer}`,
                params
            )
        ]);

        // Index nozzles by "customer_code|dispenser_id" and stations by customer_code.
        const nozzlesByDispenser = new Map();
        for (const n of nozzles[0]) {
            const key = `${n.customer_code}|${n.dispenser_id}`;
            if (!nozzlesByDispenser.has(key)) nozzlesByDispenser.set(key, []);
            // Pre-coerce decimals to numbers (matches the /api/nozzles handler).
            nozzlesByDispenser.get(key).push({
                ...n,
                price_per_liter: parseFloat(n.price_per_liter),
                actual_price: n.actual_price == null ? null : parseFloat(n.actual_price),
                total_quantity: parseFloat(n.total_quantity),
                total_amount: parseFloat(n.total_amount),
                total_sales_today: parseFloat(n.total_sales_today),
                price: parseFloat(n.price),
                quantity: parseFloat(n.quantity)
            });
        }

        const stationByCode = new Map();
        for (const s of stations[0]) stationByCode.set(s.customer_code, s);

        // Stitch nozzles + station onto each dispenser.
        const result = dispensers[0].map(d => ({
            ...d,
            nozzles: nozzlesByDispenser.get(`${d.customer_code}|${d.dispenser_id}`) || [],
            station: stationByCode.get(d.customer_code) || null
        }));

        res.json(result);
    } catch (error) {
        console.error('Database error in /api/dispensers-full:', error);
        res.status(500).json({ error: 'Failed to fetch dispensers' });
    }
});

// Add a dispenser remark. Admin / super_admin only — everyone else can read
// (the latest ships in /api/dispensers[-full]; the full timeline is served by
// the GET below) but cannot write. Append-only: each call inserts a history row
// AND refreshes the latest-remark snapshot on the dispenser, in one transaction.
// Keyed by address (matches errors/resets + the device-status popup). Records
// who added it (username + id), their IP, and when.
app.post('/api/dispensers/:address/remarks', async (req, res) => {
    if (denyUnlessRole(req, res, 'admin', 'super_admin')) return;
    const addrD = ensureDAddress(req.params.address);
    const addrNaked = stripDAddress(req.params.address);
    const remark = (req.body?.remark ?? '').toString().trim();
    if (remark === '') {
        return res.status(400).json({ error: 'Remark text is required' });
    }
    const ip = getClientIp(req);
    const username = req.authUser?.username || null;
    const userId = req.authUser?.id || null;

    let conn;
    try {
        conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            // Resolve the dispenser (by either stored address form) — confirms it
            // exists and gives us its customer_code to stamp on the history row.
            const [drows] = await conn.query(
                `SELECT customer_code FROM dispensers WHERE address IN (?, ?) LIMIT 1`,
                [addrD, addrNaked]
            );
            if (drows.length === 0) {
                await conn.rollback();
                return res.status(404).json({ error: 'Dispenser not found' });
            }
            const customerCode = drows[0].customer_code;

            // Refresh the latest-remark snapshot (text + time only).
            await conn.query(
                `UPDATE dispensers SET remark = ?, remark_at = NOW()
                  WHERE address IN (?, ?)`,
                [remark, addrD, addrNaked]
            );
            // Append to the permanent history (archive) — author + IP recorded
            // here. Store the canonical D-prefixed address + the customer_code.
            const [ins] = await conn.query(
                `INSERT INTO dispenser_remarks
                    (address, customer_code, remark, created_by_id, created_by, created_ip)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [addrD, customerCode, remark, userId, username, ip]
            );
            await conn.commit();

            const [rows] = await conn.query(
                `SELECT id, remark, created_by, created_ip, created_at
                   FROM dispenser_remarks WHERE id = ?`,
                [ins.insertId]
            );
            await logActivity(req, 'dispenser_remark', {
                entity_type: 'dispenser',
                entity_id: addrD,
                details: { remark_id: ins.insertId }
            });
            res.json({ ok: true, ...(rows[0] || {}) });
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        }
    } catch (error) {
        console.error('Save dispenser remark error:', error);
        res.status(500).json({ error: 'Failed to save remark' });
    } finally {
        if (conn) conn.release();
    }
});

// Full remark timeline for one dispenser (newest first). Readable by any role —
// the "Remarks" tab in the device-status popup uses it.
app.get('/api/dispensers/:address/remarks', async (req, res) => {
    const addrD = ensureDAddress(req.params.address);
    const addrNaked = stripDAddress(req.params.address);
    try {
        const [rows] = await pool.query(
            `SELECT id, remark, created_by, created_ip, created_at
               FROM dispenser_remarks
              WHERE address IN (?, ?)
              ORDER BY created_at DESC, id DESC`,
            [addrD, addrNaked]
        );
        res.json(rows);
    } catch (error) {
        console.error('Fetch dispenser remarks error:', error);
        res.status(500).json({ error: 'Failed to fetch remarks' });
    }
});

app.get('/api/dispensers/next-id', async (req, res) => {
    try {
        const { customer_code } = req.query;
        
        if (!customer_code) {
            return res.status(400).json({ error: 'customer_code is required' });
        }
        
        const [rows] = await pool.query(
            'SELECT MAX(CAST(dispenser_id AS UNSIGNED)) as max_id FROM dispensers WHERE customer_code = ?',
            [customer_code]
        );

        const next_id = (rows[0].max_id || 0) + 1;
        res.json({ next_id: next_id.toString() });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to get next dispenser ID' });
    }
});

app.get('/api/nozzles', async (req, res) => {
    try {
        const { dispenser_id, customer_code } = req.query;
        
        if (!dispenser_id) {
            return res.status(400).json({ error: 'dispenser_id is required' });
        }
        
        if (!customer_code) {
            return res.status(400).json({ error: 'customer_code is required' });
        }

        const [rows] = await pool.query(
            `SELECT customer_code, dispenser_id, nozzle_id, product, status, last_ping_at,
                    price_per_liter, total_quantity, total_amount, total_sales_today,
                    lock_unlock, price, quantity
             FROM nozzles
             WHERE customer_code = ? AND dispenser_id = ?`,
            [customer_code, dispenser_id]
        );
        
        const nozzles = rows.map(nozzle => ({
            ...nozzle,
            price_per_liter: parseFloat(nozzle.price_per_liter),
            total_quantity: parseFloat(nozzle.total_quantity),
            total_amount: parseFloat(nozzle.total_amount),
            total_sales_today: parseFloat(nozzle.total_sales_today),
            price: parseFloat(nozzle.price),
            quantity: parseFloat(nozzle.quantity)
        }));
        
        res.json(nozzles);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch nozzles' });
    }
});

app.get('/api/transactions/by-nozzle', async (req, res) => {
    try {
        const { nozzle_id } = req.query;

        if (!nozzle_id) {
            return res.status(400).json({ error: 'nozzle_id is required' });
        }

        // Decode the nozzle_id if it was URL encoded
        const decodedNozzleId = decodeURIComponent(nozzle_id);

        const [rows] = await pool.query(
            `SELECT * FROM transactions 
             WHERE nozzle_id = ?
             ORDER BY time DESC 
             LIMIT 1000`,
            [decodedNozzleId]
        );

        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// GSM connection status endpoint
app.get('/api/gsm-connection-status/:dispenser_addr', (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const status = getGsmConnectionStatus(dispenser_addr);
        
        res.json({ status });
    } catch (error) {
        console.error('Error fetching GSM connection status:', error);
        res.status(500).json({ error: 'Failed to fetch GSM connection status' });
    }
});

// WiFi connection status endpoint
app.get('/api/wifi-connection-status/:dispenser_addr', (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const status = getWifiConnectionStatus(dispenser_addr);
        
        res.json({ status });
    } catch (error) {
        console.error('Error fetching WiFi connection status:', error);
        res.status(500).json({ error: 'Failed to fetch WiFi connection status' });
    }
});

// GSM status endpoints
app.get('/api/gsm-status/:dispenser_addr', (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const status = getGsmStatus(dispenser_addr);
        
        if (!status) {
            return res.status(404).json({ error: 'GSM status not found for this dispenser' });
        }
        
        res.json(status);
    } catch (error) {
        console.error('Error fetching GSM status:', error);
        res.status(500).json({ error: 'Failed to fetch GSM status' });
    }
});

// WiFi status endpoint (placeholder)
app.get('/api/wifi-status/:dispenser_addr', (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const status = getWiFiStatus(dispenser_addr);
        
        if (!status) {
            return res.status(404).json({ error: 'Wi-Fi status not found for this dispenser' });
        }
        
        res.json(status);
    } catch (error) {
        console.error('Error fetching WiFi status:', error);
        res.status(500).json({ error: 'Failed to fetch WiFi status' });
    }
});

// MQTT status endpoint
app.get('/api/mqtt-status/:dispenser_addr', (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const status = getMqttStatus(dispenser_addr);
        
        if (!status) {
            return res.status(404).json({ error: 'MQTT status not found for this dispenser' });
        }
        
        res.json(status);
    } catch (error) {
        console.error('Error fetching MQTT status:', error);
        res.status(500).json({ error: 'Failed to fetch MQTT status' });
    }
});

app.get('/api/power-status/:dispenser_addr', async (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const { showCleared } = req.query;
        const addrD = ensureDAddress(dispenser_addr);
        const addrNaked = stripDAddress(dispenser_addr);

        let query = `
            SELECT id, customer_code, message, die_time, wakeup_time, downtime_ms, cleared, created_at
            FROM resets
            WHERE address IN (?, ?)
        `;
        const params = [addrD, addrNaked];

        if (showCleared === 'false' || showCleared === '0') {
            query += ' AND cleared = 0';
        }

        query += ' ORDER BY created_at DESC LIMIT 1000';

        const [rows] = await pool.query(query, params);

        // Shape matches the legacy in-memory format so the existing frontend renderer just works.
        const result = rows.map(r => ({
            id: r.id,
            message: r.message,
            dieTime: r.die_time,
            wakeupTime: r.wakeup_time,
            type: 'power_on',
            lastUpdated: r.created_at,
            downtimeMs: r.downtime_ms != null ? Number(r.downtime_ms) : null,
            cleared: !!r.cleared
        }));

        res.json(result);
    } catch (error) {
        console.error('Error fetching power-on status:', error);
        res.status(500).json({ error: 'Failed to fetch power-on status' });
    }
});

app.get('/api/cleared-resets/:dispenser_addr', async (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const addrD = ensureDAddress(dispenser_addr);
        const addrNaked = stripDAddress(dispenser_addr);

        const [rows] = await pool.query(
            'SELECT id FROM resets WHERE address IN (?, ?) AND cleared = 1',
            [addrD, addrNaked]
        );
        res.json({ ids: rows.map(r => r.id) });
    } catch (error) {
        console.error('Error fetching cleared resets:', error);
        res.status(500).json({ error: 'Failed to fetch cleared resets' });
    }
});

// Bulk uncleared-error counts for every dispenser (optionally scoped to one
// station). Lets the dispensers page replace N per-dispenser /error-log calls
// with a single round trip. Returns { "<D-address>": count, ... }; addresses
// with zero uncleared errors are simply absent from the map.
app.get('/api/error-counts', async (req, res) => {
    try {
        const { customer_code } = req.query;
        const params = [];
        let query = `
            SELECT ${addressOutSql()} AS addr, COUNT(*) AS cnt
            FROM errors
            WHERE cleared = 0
        `;
        if (customer_code) {
            query += ' AND customer_code = ?';
            params.push(customer_code);
        }
        query += ' GROUP BY addr';

        const [rows] = await pool.query(query, params);
        const counts = {};
        for (const r of rows) counts[r.addr] = Number(r.cnt) || 0;
        res.json(counts);
    } catch (error) {
        console.error('Database error in /api/error-counts:', error);
        res.status(500).json({ error: 'Failed to fetch error counts' });
    }
});

// Bulk uncleared-reset counts for every dispenser (optionally scoped to one
// station). Replaces N×2 per-dispenser /power-status + /cleared-resets calls
// with a single round trip. Returns { "<D-address>": count, ... }; addresses
// with zero uncleared resets are simply absent from the map.
app.get('/api/reset-counts', async (req, res) => {
    try {
        const { customer_code } = req.query;
        const params = [];
        let query = `
            SELECT ${addressOutSql()} AS addr, COUNT(*) AS cnt
            FROM resets
            WHERE cleared = 0
        `;
        if (customer_code) {
            query += ' AND customer_code = ?';
            params.push(customer_code);
        }
        query += ' GROUP BY addr';

        const [rows] = await pool.query(query, params);
        const counts = {};
        for (const r of rows) counts[r.addr] = Number(r.cnt) || 0;
        res.json(counts);
    } catch (error) {
        console.error('Database error in /api/reset-counts:', error);
        res.status(500).json({ error: 'Failed to fetch reset counts' });
    }
});

app.get('/api/error-log/:address', async (req, res) => {
    try {
        const { address: rawAddress } = req.params;
        // Match rows whether they were stored D-prefixed (new) or numeric (legacy).
        const addrD = ensureDAddress(rawAddress);
        const addrNaked = stripDAddress(rawAddress);

        const { showCleared } = req.query;

        let query = `
            SELECT
                id,
                customer_code,
                error_message,
                cleared,
                created_at
            FROM errors
            WHERE address IN (?, ?)
        `;

        const queryParams = [addrD, addrNaked];

        // Filter by cleared status if specified
        if (showCleared === 'false' || showCleared === '0') {
            query += ' AND cleared = 0';
        }

        query += ' ORDER BY created_at DESC LIMIT 500';

        const [errors] = await pool.query(query, queryParams);
        
        // Parse the error_message JSON and structure the data
        const parsedErrors = errors.map(error => {
            try {
                const parsedMessage = error.error_message;
                return {
                    id: error.id,
                    customer_code: error.customer_code,
                    timestamp: error.created_at,
                    log_time: new Date(error.created_at).toLocaleString(),
                    unix_time: parsedMessage.Time || null,
                    error_code: parsedMessage.Code || null,
                    severity: parsedMessage.Sev || null,
                    file: parsedMessage.File || null,
                    line: parsedMessage.Line || null,
                    function: parsedMessage.Func || null,
                    context: parsedMessage.Cntx || null,
                    cleared: error.cleared || 0,
                    raw_message: error.error_message
                };
            } catch (e) {
                // If parsing fails, return the raw data
                return {
                    id: error.id,
                    customer_code: error.customer_code,
                    timestamp: error.created_at,
                    log_time: new Date(error.created_at).toLocaleString(),
                    cleared: error.cleared || 0,
                    raw_message: error.error_message
                };
            }
        });
        
        res.json(parsedErrors);
    } catch (error) {
        console.error('Error fetching device errors from database:', error);
        res.status(500).json({ error: 'Failed to fetch device errors' });
    }
});

app.get('/api/device-info/:address', async (req, res) => {
    try {
        const { address: rawAddress } = req.params;

        // Accept either "D01" or "01"; the numeric form must be digits.
        const naked = String(rawAddress || '').replace(/^[A-Za-z]+/, '');
        if (!naked || !/^\d+$/.test(naked)) {
            return res.json(null);
        }
        const addrD = `D${naked}`;

        // Get the latest device info for this address — match either stored form.
        const [deviceInfo] = await pool.query(
            `SELECT
                customer_code,
                ${addressOutSql()} AS address,
                firmware_version,
                hardware_version,
                wifi_enable,
                last_die_time,
                wakeup_time,
                created_at
            FROM device_info
            WHERE address IN (?, ?)
            ORDER BY created_at DESC
            LIMIT 1`,
            [addrD, naked]
        );
        
        res.json(deviceInfo[0] || null);
    } catch (error) {
        console.error('Error fetching device info:', error);
        res.status(500).json({ error: 'Failed to fetch device information' });
    }
});

// Brute-force guard: 5 attempts per 15 minutes, scoped per account+IP.
// Successful sign-ins don't count toward the limit, so a normal user never
// hits it.
const signinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
        const username = (req.body && req.body.username ? String(req.body.username) : '')
            .trim()
            .toLowerCase();
        const ip = getClientIp(req) || 'unknown';
        return `${ip}|${username}`;
    },
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' }
});

app.post('/api/auth/signin', signinLimiter, async (req, res) => {
  const ip = getClientIp(req);
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username and password'
      });
    }

    const [users] = await pool.query(
      `SELECT id, username, password, role, customer_code, is_active,
              allow_price_update, last_login, created_at
       FROM users
       WHERE username = ?`,
      [username]
    );

    if (users.length === 0) {
      logActivity(req, 'signin_failed', { username, ip_address: ip, details: { reason: 'unknown_user' } });
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const user = users[0];

    if (!verifyPassword(password, user.password)) {
      logActivity(req, 'signin_failed', {
        user_id: user.id, username: user.username,
        ip_address: ip, details: { reason: 'bad_password' }
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    // Generate JWT token with 4 hours expiration
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        customerCode: user.customer_code
      },
      JWT_SECRET,
      { expiresIn: '4h' }
    );

    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours

    // Insert new session with signed_in = 1 and capture client IP.
    await pool.query(
      'INSERT INTO sessions (user_id, ip_address, session_token, expires_at, signed_in) VALUES (?, ?, ?, ?, ?)',
      [user.id, ip, token, expiresAt, 1]
    );

    // Record last login on the user — driven by successful session insert
    await pool.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );
    user.last_login = new Date();

    logActivity(req, 'signin', {
      user_id: user.id, username: user.username, ip_address: ip,
      details: { role: user.role }
    });

    const { password: _, ...userData } = user;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userData
    });

  } catch (error) {
    console.error('Sign in error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.post('/api/auth/signout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (token) {
        await pool.query(
            'UPDATE sessions SET signed_in = 0 WHERE session_token = ?',
            [token]
      );
    }
    logActivity(req, 'signout');

    res.json({
      success: true,
      message: 'Signed out successfully'
    });
  } catch (error) {
    console.error('Sign out error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.post('/api/users', async (req, res) => {
    try {
        const { username, password, role, customer_code } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        // Check if username exists
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Verify customer_code exists in stations table for operator
        if (role === 'operator' && customer_code) {
            const [station] = await pool.query('SELECT customer_code FROM stations WHERE customer_code = ?', [customer_code]);
            if (station.length === 0) {
                return res.status(400).json({ error: 'Invalid customer code' });
            }
        }
        
        // Store a salted hash, never the plaintext password.
        // Price-file access is granted by default only to super_admins; every
        // other role starts disallowed and must be granted by a super_admin.
        const finalRole = role || 'viewer';
        const allowPriceUpdate = finalRole === 'super_admin' ? 1 : 0;
        const [result] = await pool.query(
            'INSERT INTO users (username, password, role, customer_code, is_active, allow_price_update) VALUES (?, ?, ?, ?, ?, ?)',
            [username, hashPassword(password), finalRole, customer_code || null, 1, allowPriceUpdate]
        );

        logActivity(req, 'user_create', {
            entity_type: 'user', entity_id: result.insertId,
            details: { username, role: role || 'viewer', customer_code: customer_code || null }
        });

        res.status(201).json({
            success: true,
            id: result.insertId,
            message: 'User created successfully'
        });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

app.post('/api/stations', async (req, res) => {
    try {
        const { username, password, customer_code, station_id, city, district, division } = req.body;

        // Check if station already exists
        const [existing] = await pool.query(
            'SELECT id FROM stations WHERE customer_code = ?',
            [customer_code]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Station already exists'
            });
        }

        const [result] = await pool.query(
            `INSERT INTO stations (username, password, customer_code, station_id, city, district, division)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [username, password, customer_code, station_id, city, district || null, division || null]
        );

        logActivity(req, 'station_create', {
            entity_type: 'station', entity_id: customer_code,
            details: { customer_code, station_id, city, district, division }
        });

        res.status(201).json({
            success: true,
            id: result.insertId,
            message: 'Station created successfully'
        });
    } catch (error) {
        console.error('Create station error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

app.post('/api/dispensers', async (req, res) => {
    try {
        const { customer_code, dispenser_id, address, DispenserBrand, number_of_nozzles, interface_type, interface_lock_status } = req.body;
        const dispenserInterface = (interface_type || 'ir').toLowerCase();
        if (dispenserInterface !== 'ir' && dispenserInterface !== 'keypad') {
            return res.status(400).json({ error: "interface_type must be 'ir' or 'keypad'" });
        }
        const conn_status = 0;
        const connected_at = null;

        // Validate required fields
        if (!customer_code || !dispenser_id || !address || !DispenserBrand || !number_of_nozzles) {
            return res.status(400).json({ error: 'All fields are required: customer_code, dispenser_id, address, DispenserBrand, number_of_nozzles' });
        }

        // Canonicalize address: store with D prefix.
        const addrD = ensureDAddress(address);
        const addrNaked = stripDAddress(address);

        // Check if dispenser already exists for this customer
        const [existing] = await pool.query(
            'SELECT id FROM dispensers WHERE customer_code = ? AND dispenser_id = ?',
            [customer_code, dispenser_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'This dispenser ID already exists for this customer' });
        }

        // Check if address is unique for this customer — accept either stored form.
        const [existingAddress] = await pool.query(
            'SELECT id FROM dispensers WHERE customer_code = ? AND address IN (?, ?)',
            [customer_code, addrD, addrNaked]
        );

        if (existingAddress.length > 0) {
            return res.status(400).json({ error: 'This address already exists for this customer' });
        }

        // Get customer's city for topic construction
        const [stations] = await pool.query(
            'SELECT city FROM stations WHERE customer_code = ?',
            [customer_code]
        );

        if (stations.length === 0) {
            return res.status(400).json({ error: 'Customer not found' });
        }

        const city = stations[0].city;

        // Insert the dispenser (D-prefixed)
        const [result] = await pool.query(
            `INSERT INTO dispensers
            (customer_code, dispenser_id, address, conn_status, connected_at, DispenserBrand, number_of_nozzles, interface_type, interface_lock_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [customer_code, dispenser_id, addrD, conn_status, connected_at, DispenserBrand, number_of_nozzles, dispenserInterface, interface_lock_status ?? 1]
        );

        // MQTT slave topic uses the numeric address (s<naked>).
        const topic = `pso/${city}/${customer_code}/duc/s${addrNaked}`;
        if (typeof subscribeToTopic === 'function') {
            await subscribeToTopic(topic, null);
        }

        logActivity(req, 'dispenser_create', {
            entity_type: 'dispenser', entity_id: `${customer_code}/${dispenser_id}`,
            details: { customer_code, dispenser_id, address: addrD, DispenserBrand, number_of_nozzles }
        });

        res.status(201).json({
            success: true,
            id: result.insertId,
            customer_code: customer_code,
            dispenser_id: dispenser_id,
            message: 'Dispenser added successfully'
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to add dispenser: ' + error.message });
    }
});

// Publish an MQTT command from the server on behalf of the frontend.
// Frontend never speaks MQTT directly.
app.post('/api/dispensers/publish', async (req, res) => {
    try {
        const { topic, message, retain, userId, username } = req.body;
        if (!topic || message === undefined || message === null) {
            return res.status(400).json({ success: false, error: 'topic and message are required' });
        }
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        await publishMessage(topic, payload, retain ? { retain: true } : {});

        // Track GET_VALUE (req_type=1) commands so their reply can be matched and
        // surfaced live to the UI's GET Data log. No-op for anything else.
        try {
            registerGetRequest(typeof message === 'string' ? JSON.parse(message) : message);
        } catch { /* payload isn't JSON / isn't a GET command — nothing to track */ }

        const meta = describeMqttCommand(topic, message);
        logActivity(req, meta.action, {
            user_id: userId,
            username: username,
            entity_type: 'mqtt_topic',
            entity_id: topic,
            details: {
                customer_code: meta.customer_code,
                dispenser_address: meta.dispenser_address,
                side: meta.side,
                nozzle_number: meta.nozzle_number,
                retain: !!retain,
                payload: typeof payload === 'string' && payload.length <= 512 ? payload : '[truncated]'
            }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('MQTT publish error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to publish' });
    }
});

// Identity the central server presents in broadcast control messages.
const SCAN_BROADCAST_TOPIC = 'duc/broadcast';
const SERVER_CLIENT_ID = process.env.MQTT_CLIENT_ID || 'unknown';

// Host of the MQTT broker, parsed from MQTT_BROKER_URL (e.g. tcp://1.2.3.4:1883).
// Used as the route target when resolving this server's outbound IP.
function getBrokerHost() {
    try {
        return new URL(process.env.MQTT_BROKER_URL).hostname || null;
    } catch {
        return null;
    }
}

function getServerIp() {
    return new Promise((resolve) => {
        const target = getBrokerHost() || '8.8.8.8'; // any routable host works
        const socket = dgram.createSocket('udp4');
        let settled = false;
        const finish = (ip) => {
            if (settled) return;
            settled = true;
            try { socket.close(); } catch { /* already closed */ }
            resolve(ip);
        };
        try {
            socket.connect(1883, target, () => {
                try {
                    finish(socket.address().address || null);
                } catch {
                    finish(null);
                }
            });
            socket.on('error', () => finish(null));
        } catch {
            finish(null);
        }
    });
}

// Trigger a fleet-wide dispenser scan: publish a broadcast control message
// (msg_type 16, request_type 1) on duc/broadcast that every DUC listens for.
// Super-admin-only action surfaced by the sidebar "Scan Dispensers" button.
app.post('/api/dispensers/scan', async (req, res) => {
    try {
        const { userId, username } = req.body || {};
        const payload = JSON.stringify({
            clientid: SERVER_CLIENT_ID,
            ip: await getServerIp(),
            msg_type: 16,
            request_type: 1
        });
        await publishMessage(SCAN_BROADCAST_TOPIC, payload);

        logActivity(req, 'dispenser_scan', {
            user_id: userId,
            username: username,
            entity_type: 'mqtt_topic',
            entity_id: SCAN_BROADCAST_TOPIC,
            details: { payload }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Dispenser scan publish error:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to start scan' });
    }
});

app.post('/api/nozzles', async (req, res) => {
    try {
        const {
            customer_code,
            dispenser_id,
            nozzle_id,
            product,
            status = 1,
            lock_unlock = 1,
            price_per_liter = '0.00',
            total_quantity = '0.00',
            total_amount = '0.00',
            total_sales_today = '0.00',
            price = '0.00',
            quantity = '0.00'
        } = req.body;

        if (!customer_code || !dispenser_id || !nozzle_id || !product) {
            return res.status(400).json({ error: 'Missing required fields: customer_code, dispenser_id, nozzle_id, product' });
        }

        const numericFields = {
            price_per_liter: parseFloat(price_per_liter),
            total_quantity: parseFloat(total_quantity),
            total_amount: parseFloat(total_amount),
            total_sales_today: parseFloat(total_sales_today),
            price: parseFloat(price),
            quantity: parseFloat(quantity)
        };

        // Check if nozzle already exists
        const [existing] = await pool.query(
            'SELECT id FROM nozzles WHERE customer_code = ? AND dispenser_id = ? AND nozzle_id = ?',
            [customer_code, dispenser_id, nozzle_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Nozzle ID already exists for this dispenser' });
        }

        // Inherit actual_price from the station's price for this product, so
        // a freshly-added nozzle picks up the official filed price without
        // waiting for the next price-file upload.
        const actualPrice = await stationPriceForProduct(customer_code, product);

        const [result] = await pool.query(
            `INSERT INTO nozzles
            (customer_code, dispenser_id, nozzle_id, product, status, lock_unlock,
             price_per_liter, actual_price, total_quantity, total_amount, total_sales_today, price, quantity)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                customer_code,
                dispenser_id,
                nozzle_id,
                product,
                status,
                lock_unlock,
                numericFields.price_per_liter,
                actualPrice,
                numericFields.total_quantity,
                numericFields.total_amount,
                numericFields.total_sales_today,
                numericFields.price,
                numericFields.quantity
            ]
        );

        logActivity(req, 'nozzle_create', {
            entity_type: 'nozzle', entity_id: `${customer_code}/${dispenser_id}/${nozzle_id}`,
            details: { customer_code, dispenser_id, nozzle_id, product }
        });

        res.status(201).json({
            success: true,
            id: result.insertId,
            message: 'Nozzle added successfully'
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to add nozzle: ' + error.message });
    }
});

app.post('/api/nozzles/delete-by-dispenser', async (req, res) => {
    try {
        const { dispenser_id } = req.body;
        if (!dispenser_id) {
            return res.status(400).json({ error: 'dispenser_id is required' });
        }

        await pool.query(
            'DELETE FROM nozzles WHERE dispenser_id = ?',
            [dispenser_id]
        );

        logActivity(req, 'nozzle_delete_by_dispenser', {
            entity_type: 'dispenser', entity_id: dispenser_id
        });

        res.json({ success: true, message: 'Nozzles deleted successfully' });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to delete nozzles' });
    }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username, role, customer_code, is_active, password, allow_price_update } = req.body;
        
        // Check if user exists
        const [existing] = await pool.query('SELECT id FROM users WHERE id = ?', [id]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const updates = [];
        const values = [];
        
        if (username) {
            updates.push('username = ?');
            values.push(username);
        }
        if (role) {
            updates.push('role = ?');
            values.push(role);
        }
        if (customer_code !== undefined) {
            updates.push('customer_code = ?');
            values.push(customer_code);
        }
        if (is_active !== undefined) {
            updates.push('is_active = ?');
            values.push(is_active);
        }
        if (password) {
            updates.push('password = ?');
            values.push(hashPassword(password));
        }
        if (allow_price_update !== undefined) {
            updates.push('allow_price_update = ?');
            values.push(allow_price_update ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        values.push(id);
        
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

        const changedKeys = [];
        if (username) changedKeys.push('username');
        if (role) changedKeys.push('role');
        if (customer_code !== undefined) changedKeys.push('customer_code');
        if (is_active !== undefined) changedKeys.push('is_active');
        if (password) changedKeys.push('password');
        if (allow_price_update !== undefined) changedKeys.push('allow_price_update');
        logActivity(req, 'user_update', {
            entity_type: 'user', entity_id: id,
            details: { changed: changedKeys }
        });

        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

app.put('/api/dispensers/:dispenser_id', async (req, res) => {
    try {
        const { dispenser_id } = req.params;
        const {
            customer_code, address, DispenserBrand, number_of_nozzles,
            interface_type, interface_lock_status, conn_status,
            dispenser_id: newDispenserIdRaw
        } = req.body;

        if (!customer_code) {
            return res.status(400).json({ error: 'customer_code is required' });
        }
        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: 'At least one field must be provided for update' });
        }

        const newDispenserId = newDispenserIdRaw !== undefined && String(newDispenserIdRaw) !== String(dispenser_id)
            ? String(newDispenserIdRaw)
            : null;

        // Collect the non-identity field updates.
        const fields = [];
        const values = [];
        if (address !== undefined) { fields.push('address = ?'); values.push(ensureDAddress(address)); }
        if (DispenserBrand !== undefined) { fields.push('DispenserBrand = ?'); values.push(DispenserBrand); }
        if (number_of_nozzles !== undefined) { fields.push('number_of_nozzles = ?'); values.push(number_of_nozzles); }
        if (interface_type !== undefined) {
            const v = String(interface_type).toLowerCase();
            if (v !== 'ir' && v !== 'keypad') {
                return res.status(400).json({ error: "interface_type must be 'ir' or 'keypad'" });
            }
            fields.push('interface_type = ?'); values.push(v);
        }
        if (interface_lock_status !== undefined) { fields.push('interface_lock_status = ?'); values.push(interface_lock_status); }
        if (conn_status !== undefined) { fields.push('conn_status = ?'); values.push(conn_status); }

        // Validate a rename up front, before opening a transaction.
        if (newDispenserId !== null) {
            if (!newDispenserId.trim()) {
                return res.status(400).json({ error: 'dispenser_id cannot be empty' });
            }
            const [collision] = await pool.query(
                'SELECT id FROM dispensers WHERE customer_code = ? AND dispenser_id = ?',
                [customer_code, newDispenserId]
            );
            if (collision.length > 0) {
                return res.status(409).json({ error: `dispenser_id "${newDispenserId}" already exists for customer ${customer_code}` });
            }
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // Rename (if requested). FK ON UPDATE CASCADE propagates to nozzles,
            // nozzle_history and transactions. 
            if (newDispenserId !== null) {
                const [renameResult] = await connection.query(
                    'UPDATE dispensers SET dispenser_id = ? WHERE customer_code = ? AND dispenser_id = ?',
                    [newDispenserId, customer_code, dispenser_id]
                );
                if (renameResult.affectedRows === 0) {
                    await connection.rollback();
                    return res.status(404).json({ error: 'Dispenser not found' });
                }
            }

            const effectiveDispenserId = newDispenserId ?? dispenser_id;

            if (fields.length > 0) {
                const [result] = await connection.query(
                    `UPDATE dispensers SET ${fields.join(', ')}
                     WHERE customer_code = ? AND dispenser_id = ?`,
                    [...values, customer_code, effectiveDispenserId]
                );
                if (result.affectedRows === 0 && newDispenserId === null) {
                    await connection.rollback();
                    return res.status(404).json({ error: 'Dispenser not found' });
                }
            }

            await connection.commit();

            logActivity(req, 'dispenser_update', {
                entity_type: 'dispenser',
                entity_id: `${customer_code}/${effectiveDispenserId}`,
                details: {
                    fields: fields.map(f => f.replace(' = ?', '')),
                    renamed_from: newDispenserId !== null ? dispenser_id : undefined,
                    renamed_to: newDispenserId !== null ? newDispenserId : undefined
                }
            });

            res.json({
                success: true,
                message: 'Dispenser updated successfully',
                customer_code,
                dispenser_id: effectiveDispenserId,
                renamed: newDispenserId !== null
            });
        } catch (err) {
            try { await connection.rollback(); } catch {}
            throw err;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to update dispenser: ' + error.message });
    }
});

app.put('/api/nozzles/:dispenser_id/:nozzle_id', async (req, res) => {
    try {
        const { dispenser_id, nozzle_id } = req.params;
        const { customer_code, product, status, price_per_liter, total_quantity, total_amount,
                total_sales_today, lock_unlock, price, quantity } = req.body;

        if (!customer_code) {
            return res.status(400).json({ error: 'customer_code is required' });
        }

        // Generate a unique hash for deduplication
        const messageHash = JSON.stringify({ customer_code, dispenser_id, nozzle_id, product, status, price_per_liter, total_quantity, total_amount,
                                             total_sales_today, lock_unlock, price, quantity });
        const now = Date.now();
        if (recentUpdates.has(messageHash)) {
            const [lastUpdateTime] = recentUpdates.get(messageHash);
            if (now - lastUpdateTime < DEDUPE_WINDOW) {
                console.log(`Skipping duplicate update for ${customer_code}/${dispenser_id}/${nozzle_id}`);
                return res.json({ resInboundError: true, message: 'Duplicate update skipped' });
            }
        }

        const fields = [];
        const values = [];

        // Validate numeric fields
        const parsedTotalQuantity = total_quantity !== undefined ? parseFloat(total_quantity) : undefined;
        const parsedTotalAmount = total_amount !== undefined ? parseFloat(total_amount) : undefined;
        const parsedTotalSalesToday = total_sales_today !== undefined ? parseFloat(total_sales_today) : undefined;
        const parsedPricePerLiter = price_per_liter !== undefined ? parseFloat(price_per_liter) : undefined;
        const parsedPrice = price !== undefined ? parseFloat(price) : undefined;
        const parsedQuantity = quantity !== undefined ? parseFloat(quantity) : undefined;

        if (parsedTotalQuantity !== undefined) {
            if (isNaN(parsedTotalQuantity) || parsedTotalQuantity < 0 || parsedTotalQuantity > MAX_DECIMAL_VALUE) {
                console.error(`Invalid total_quantity: ${total_quantity}`);
                return res.status(400).json({ error: `total_quantity must be between 0 and ${MAX_DECIMAL_VALUE}` });
            }
            fields.push('total_quantity = ?');
            values.push(parsedTotalQuantity);
        }

        if (parsedTotalAmount !== undefined) {
            if (isNaN(parsedTotalAmount) || parsedTotalAmount < 0 || parsedTotalAmount > MAX_DECIMAL_VALUE) {
                console.error(`Invalid total_amount: ${total_amount}`);
                return res.status(400).json({ error: `total_amount must be between 0 and ${MAX_DECIMAL_VALUE}` });
            }
            fields.push('total_amount = ?');
            values.push(parsedTotalAmount);
        }

        if (parsedTotalSalesToday !== undefined) {
            if (isNaN(parsedTotalSalesToday) || parsedTotalSalesToday < 0 || parsedTotalSalesToday > MAX_DECIMAL_VALUE) {
                console.error(`Invalid total_sales_today: ${total_sales_today}`);
                return res.status(400).json({ error: `total_sales_today must be between 0 and ${MAX_DECIMAL_VALUE}` });
            }
            fields.push('total_sales_today = ?');
            values.push(parsedTotalSalesToday);
        }

        if (parsedPricePerLiter !== undefined) {
            if (isNaN(parsedPricePerLiter) || parsedPricePerLiter < 0) {
                console.error(`Invalid price_per_liter: ${price_per_liter}`);
                return res.status(400).json({ error: 'price_per_liter must be a non-negative number' });
            }
            fields.push('price_per_liter = ?');
            values.push(parsedPricePerLiter);
        }

        if (parsedPrice !== undefined) {
            if (isNaN(parsedPrice) || parsedPrice < 0) {
                console.error(`Invalid price: ${price}`);
                return res.status(400).json({ error: 'price must be a non-negative number' });
            }
            fields.push('price = ?');
            values.push(parsedPrice);
        }

        if (parsedQuantity !== undefined) {
            if (isNaN(parsedQuantity) || parsedQuantity < 0) {
                console.error(`Invalid quantity: ${quantity}`);
                return res.status(400).json({ error: 'quantity must be a non-negative number' });
            }
            fields.push('quantity = ?');
            values.push(parsedQuantity);
        }

        if (product !== undefined) {
            fields.push('product = ?');
            values.push(product);

            // Product changed — re-derive actual_price from the station's
            // current price for the new product. NULL if station has no price
            // filed yet for it.
            fields.push('actual_price = ?');
            values.push(await stationPriceForProduct(customer_code, product));
        }
        if (status !== undefined) {
            fields.push('status = ?');
            values.push(status);
        }
        if (lock_unlock !== undefined) {
            fields.push('lock_unlock = ?');
            values.push(lock_unlock);
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }

        values.push(customer_code, dispenser_id, decodeURIComponent(nozzle_id));

        // Update nozzles first
        const [result] = await pool.query(
            `UPDATE nozzles SET ${fields.join(', ')}
            WHERE customer_code = ? AND dispenser_id = ? AND nozzle_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Nozzle not found' });
        }

        // Insert into nozzle_history after update to capture new state
        const [updatedNozzle] = await pool.query(
            'SELECT * FROM nozzles WHERE customer_code = ? AND dispenser_id = ? AND nozzle_id = ?',
            [customer_code, dispenser_id, decodeURIComponent(nozzle_id)]
        );
        if (updatedNozzle.length > 0) {
            await pool.query(
                `INSERT INTO nozzle_history (
                    customer_code, dispenser_id, nozzle_id, product, status, last_ping_at,
                    price_per_liter, total_quantity, total_amount, total_sales_today, lock_unlock
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    updatedNozzle[0].customer_code,
                    updatedNozzle[0].dispenser_id,
                    updatedNozzle[0].nozzle_id,
                    updatedNozzle[0].product,
                    updatedNozzle[0].status,
                    updatedNozzle[0].last_ping_at,
                    parseFloat(updatedNozzle[0].price_per_liter),
                    parseFloat(updatedNozzle[0].total_quantity),
                    parseFloat(updatedNozzle[0].total_amount),
                    parseFloat(updatedNozzle[0].total_sales_today),
                    updatedNozzle[0].lock_unlock
                ]
            );
        }

        // Store update in cache for deduplication
        recentUpdates.set(messageHash, [now]);
        // Clean up old entries
        setTimeout(() => recentUpdates.delete(messageHash), DEDUPE_WINDOW);

        logActivity(req, 'nozzle_update', {
            entity_type: 'nozzle',
            entity_id: `${customer_code}/${dispenser_id}/${decodeURIComponent(nozzle_id)}`,
            details: { fields: fields.map(f => f.replace(' = ?', '')) }
        });

        res.json({
            success: true,
            message: 'Nozzle updated successfully'
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to update nozzle: ' + error.message });
    }
});

app.put('/api/reset-logs/mark-cleared', async (req, res) => {
    try {
        const { dispenserAddress, resetIds } = req.body;

        if (!dispenserAddress || !resetIds || !Array.isArray(resetIds) || resetIds.length === 0) {
            return res.status(400).json({ error: 'dispenserAddress and resetIds array are required' });
        }

        const addrD = ensureDAddress(dispenserAddress);
        const addrNaked = stripDAddress(dispenserAddress);

        const placeholders = resetIds.map(() => '?').join(',');
        const [result] = await pool.query(
            `UPDATE resets SET cleared = 1
             WHERE address IN (?, ?) AND id IN (${placeholders})`,
            [addrD, addrNaked, ...resetIds]
        );

        logActivity(req, 'resets_clear', {
            entity_type: 'dispenser_address', entity_id: dispenserAddress,
            details: { count: result.affectedRows, ids: resetIds }
        });

        res.json({
            success: true,
            message: `${result.affectedRows} reset log(s) marked as cleared`,
            affectedRows: result.affectedRows
        });
    } catch (error) {
        console.error('Error marking resets as cleared:', error);
        res.status(500).json({ error: 'Failed to mark resets as cleared' });
    }
});

app.put('/api/error-log/mark-cleared', async (req, res) => {
    try {
        const { errorIds } = req.body;
        
        if (!errorIds || !Array.isArray(errorIds) || errorIds.length === 0) {
            return res.status(400).json({ error: 'errorIds array is required' });
        }
        
        const placeholders = errorIds.map(() => '?').join(',');
        const [result] = await pool.query(
            `UPDATE errors SET cleared = 1 WHERE id IN (${placeholders})`,
            errorIds
        );

        logActivity(req, 'errors_clear', {
            entity_type: 'errors', entity_id: errorIds.join(','),
            details: { count: result.affectedRows }
        });

        res.json({
            success: true,
            message: `${result.affectedRows} error(s) marked as cleared`,
            affectedRows: result.affectedRows
        });
    } catch (error) {
        console.error('Error marking errors as cleared:', error);
        res.status(500).json({ error: 'Failed to mark errors as cleared' });
    }
});

app.delete('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // Don't allow deleting the last super admin
        const [super_admins] = await pool.query('SELECT id FROM users WHERE role = "super_admin"');
        if (super_admins.length === 1) {
            const [user] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
            if (user[0]?.role === 'super_admin') {
                return res.status(400).json({ error: 'Cannot delete the last super admin user' });
            }
        }
        
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        logActivity(req, 'user_delete', { entity_type: 'user', entity_id: id });

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.delete('/api/stations/:id', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        await connection.beginTransaction();

        // Look up the station row first so we can include it (and its
        // cascade-deleted descendants) in the activity log details.
        const [stationRows] = await connection.query(
            'SELECT * FROM stations WHERE id = ?', [id]
        );
        if (stationRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Station not found' });
        }
        const station = stationRows[0];
        const customer_code = station.customer_code;

        // Snapshot everything the DB-level CASCADE is about to wipe.
        const [dispenserRowsRaw] = await connection.query(
            'SELECT * FROM dispensers WHERE customer_code = ?', [customer_code]
        );
        const dispenserRows = dispenserRowsRaw.map(d => ({
            ...d,
            address: ensureDAddress(d.address)
        }));
        const [nozzleRows] = await connection.query(
            'SELECT * FROM nozzles WHERE customer_code = ?', [customer_code]
        );
        const [historyRows] = await connection.query(
            'SELECT * FROM nozzle_history WHERE customer_code = ?', [customer_code]
        );

        // Persist history to the archive so it survives the CASCADE.
        if (historyRows.length > 0) {
            const archiveValues = historyRows.map(r => [
                r.id, r.customer_code, r.dispenser_id, r.nozzle_id, r.product,
                r.status, r.last_ping_at, r.price_per_liter, r.total_quantity, r.total_amount,
                r.total_sales_today, r.lock_unlock,
                r.created_at, 'station_delete'
            ]);
            await connection.query(
                `INSERT INTO nozzle_history_archive
                 (original_id, customer_code, dispenser_id, nozzle_id, product,
                  status, last_ping_at, price_per_liter, total_quantity, total_amount,
                  total_sales_today, lock_unlock,
                  original_created_at, archived_reason)
                 VALUES ?`,
                [archiveValues]
            );
        }

        const [result] = await connection.query('DELETE FROM stations WHERE id = ?', [id]);

        await connection.commit();

        logActivity(req, 'station_delete', {
            entity_type: 'station',
            entity_id: id,
            details: {
                station,
                cascaded: {
                    dispensers: dispenserRows,
                    nozzles: nozzleRows,
                    nozzle_history_count: historyRows.length,
                    nozzle_history_archived: historyRows.length
                }
            }
        });

        res.json({ success: true, message: 'Station deleted successfully' });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Error deleting station:', error);
        res.status(500).json({ error: 'Failed to delete station' });
    } finally {
        connection.release();
    }
});

app.delete('/api/dispensers/:id', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const { customer_code, delete_history } = req.query;
        
        if (!customer_code) {
            await connection.rollback();
            return res.status(400).json({ error: 'customer_code is required' });
        }
        
        const [dispenser] = await connection.query(
            'SELECT * FROM dispensers WHERE id = ? AND customer_code = ?',
            [id, customer_code]
        );

        if (dispenser.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Dispenser not found' });
        }

        const dispenserRow = dispenser[0];
        // Normalize for downstream topic strings — keeps both forms callable
        // regardless of which form the row was stored in.
        dispenserRow.address = ensureDAddress(dispenserRow.address);
        const { address, dispenser_id } = dispenserRow;
        const addrNaked = stripDAddress(address);

        // Snapshot affected nozzles + history before they get wiped (either
        // explicitly below or via CASCADE on the nozzles delete).
        const [nozzleRows] = await connection.query(
            'SELECT * FROM nozzles WHERE customer_code = ? AND dispenser_id = ?',
            [customer_code, dispenser_id]
        );
        const [historyRows] = await connection.query(
            'SELECT * FROM nozzle_history WHERE customer_code = ? AND dispenser_id = ?',
            [customer_code, dispenser_id]
        );

        // Always archive history before delete — keeps the audit trail even
        // when delete_history=false, since the FK CASCADE on nozzles would
        // otherwise wipe nozzle_history below.
        if (historyRows.length > 0) {
            const archiveValues = historyRows.map(r => [
                r.id, r.customer_code, r.dispenser_id, r.nozzle_id, r.product,
                r.status, r.last_ping_at, r.price_per_liter, r.total_quantity, r.total_amount,
                r.total_sales_today, r.lock_unlock,
                r.created_at, 'dispenser_delete'
            ]);
            await connection.query(
                `INSERT INTO nozzle_history_archive
                 (original_id, customer_code, dispenser_id, nozzle_id, product,
                  status, last_ping_at, price_per_liter, total_quantity, total_amount,
                  total_sales_today, lock_unlock,
                  original_created_at, archived_reason)
                 VALUES ?`,
                [archiveValues]
            );
        }

        // Temporarily disable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        const deleteHistory = delete_history === 'true';

        if (deleteHistory) {
            // Delete historical data first
            await connection.query(
                'DELETE FROM nozzle_history WHERE customer_code = ? AND dispenser_id = ?',
                [customer_code, dispenser_id]
            );

            await connection.query(
                'DELETE FROM transactions WHERE customer_code = ? AND dispenser_id = ?',
                [customer_code, dispenser_id]
            );
        }

        // Delete nozzles
        await connection.query(
            'DELETE FROM nozzles WHERE customer_code = ? AND dispenser_id = ?',
            [customer_code, dispenser_id]
        );
        
        // Delete dispenser
        const [result] = await connection.query(
            'DELETE FROM dispensers WHERE id = ? AND customer_code = ?',
            [id, customer_code]
        );
        
        // Re-enable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        
        await connection.commit();

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Dispenser not found' });
        }

        logActivity(req, 'dispenser_delete', {
            entity_type: 'dispenser',
            entity_id: `${customer_code}/${dispenser_id}`,
            details: {
                delete_history: deleteHistory,
                address,
                dispenser: dispenserRow,
                cascaded: {
                    nozzles: nozzleRows,
                    nozzle_history_count: historyRows.length,
                    nozzle_history_archived: historyRows.length
                }
            }
        });

        res.json({
            success: true,
            message: deleteHistory
                ? 'Dispenser and all historical records deleted successfully'
                : 'Dispenser deleted (historical records preserved)'
        });

        // Unsubscribe from MQTT topics — address is canonical D-prefixed.
        if (typeof unsubscribeFromTopic === 'function') {
            unsubscribeFromTopic(address);
            unsubscribeFromTopic(`duc/conn_status/${address}`);
        }
               
    } catch (error) {
        await connection.rollback();
        // Make sure to re-enable foreign key checks
        await pool.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to delete dispenser: ' + error.message });
    } finally {
        connection.release();
    }
});

// TODO: a future DELETE /api/dispensers/:id should archive the dispenser's
// nozzles/transactions/history into archive tables before deleting, rather than
// relying on cascade. Not yet implemented.