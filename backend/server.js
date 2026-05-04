const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const pool = require('./db'); // Use shared pool from db.js
const { 
    setNotificationService,
    subscribeToTopic, 
    unsubscribeFromTopic, 
    getGsmStatus, 
    getWiFiStatus,
    getMqttStatus, 
    getPowerOnStatus, 
    getGsmConnectionStatus,
    getWifiConnectionStatus,
    clearedResetsCache } = require('./mqtt-service');

const { 
    startMidnightResetService,
    NotificationService,
    NotificationWebSocketServer } = require('./backend-services');
const { log } = require('console');

const app = express();
app.use(cors());
app.use(express.json());

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
    const PORT = 3001;
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        
        // Initialize WebSocket server for notifications
        notificationWebSocketServer = new NotificationWebSocketServer(server);
        notificationService = new NotificationService(notificationWebSocketServer);
        
        // Pass notification service to MQTT service
        setNotificationService(notificationService);
        
        console.log('WebSocket notification server initialized');
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

app.get('/api/auth/verify', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, role, customer_code FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    res.json({
      success: true,
      user: users[0]
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
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
            'SELECT id, username, role, customer_code, last_login, created_at FROM users'
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
            'SELECT id, username, role, customer_code, is_active, last_login, created_at FROM users WHERE id = ?',
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
        const [stations] = await pool.query(
            'SELECT id, customer_code, station_id, city, username, created_at FROM stations ORDER BY customer_code'
        );
        res.json(stations);
    } catch (error) {
        console.error('Get stations error:', error);
        res.status(500).json({ error: 'Failed to fetch stations' });
    }
});

app.get('/api/stations/:customerCode', async (req, res) => {
    try {
        const { customerCode } = req.params;
        
        const [stations] = await pool.query(
            'SELECT id, username, customer_code, station_id, city, created_at FROM stations WHERE customer_code = ?',
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
        
        let query = 'SELECT * FROM dispensers';
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
            'SELECT * FROM nozzles WHERE customer_code = ? AND dispenser_id = ?',
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

app.get('/api/power-status/:dispenser_addr', (req, res) => {
    try {
        const { dispenser_addr } = req.params;       
        let status = getPowerOnStatus(dispenser_addr);        
        let statusArray = [];
        if (status) {
            statusArray = Array.isArray(status) ? status : [status];
        }
        
        const clearedIds = clearedResetsCache.get(dispenser_addr) || new Set();
        
        const statusWithCleared = statusArray.map((item) => ({
            ...item,
            cleared: clearedIds.has(item.id)
        }));
        
        res.json(statusWithCleared);
    } catch (error) {
        console.error('Error fetching power-on status:', error);
        res.status(500).json({ error: 'Failed to fetch power-on status' });
    }
});

app.get('/api/cleared-resets/:dispenser_addr', (req, res) => {
    try {
        const { dispenser_addr } = req.params;
        const clearedIds = clearedResetsCache.get(dispenser_addr) || new Set();
        res.json({ ids: Array.from(clearedIds) });
    } catch (error) {
        console.error('Error fetching cleared resets:', error);
        res.status(500).json({ error: 'Failed to fetch cleared resets' });
    }
});

app.get('/api/error-log/:address', async (req, res) => {
    try {
        let { address } = req.params;
        address = address.replace(/^D/, '');

        const { showCleared } = req.query;

        let query = `
            SELECT 
                id,
                customer_code,
                error_message, 
                cleared,
                created_at 
            FROM errors 
            WHERE address = ?
        `;
        
        const queryParams = [address];
        
        // Filter by cleared status if specified
        if (showCleared === 'false' || showCleared === '0') {
            query += ' AND cleared = 0';
        }
        
        query += ' ORDER BY created_at DESC LIMIT 1000';

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
        let { address } = req.params;
        
        // Extract numeric address by removing any non-numeric prefix
        address = address.replace(/^[A-Za-z]+/, '');
        
        if (!address || !/^\d+$/.test(address)) {
            return res.json(null);
        }
        
        // Get the latest device info for this address
        const [deviceInfo] = await pool.query(
            `SELECT 
                customer_code,
                address,
                firmware_version,
                hardware_version,
                wifi_enable,
                last_die_time,
                wakeup_time,
                created_at
            FROM device_info 
            WHERE address = ?
            ORDER BY created_at DESC
            LIMIT 1`,
            [address]
        );
        
        res.json(deviceInfo[0] || null);
    } catch (error) {
        console.error('Error fetching device info:', error);
        res.status(500).json({ error: 'Failed to fetch device information' });
    }
});

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide username and password' 
      });
    }

    // Find station/user in database
    const [users] = await pool.query(
      `SELECT id, username, password, role, customer_code, is_active, 
              last_login, created_at 
       FROM users 
       WHERE username = ?`,
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    const user = users[0];

    // Verify password (plain text comparison as per your table structure)
    // Note: In production, you should hash passwords!
    if (password !== user.password) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        username: user.username,
        role: user.role,
        customerCode: user.customer_code
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Create session in database
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const sessionToken = require('crypto').randomBytes(64).toString('hex');
    
    await pool.query(
      'INSERT INTO sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)',
      [user.id, sessionToken, expiresAt]
    );

    // Remove password from response
    const { password: _, ...userData } = user;

    // Return success response
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
      // Delete session from database
      await pool.query(
        'DELETE FROM sessions WHERE session_token = ?',
        [token]
      );
    }
    
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
        
        // For operator role, customer_code is required
        if (role === 'operator' && !customer_code) {
            return res.status(400).json({ error: 'Customer code is required for operator role' });
        }
        
        // Verify customer_code exists in stations table for operator
        if (role === 'operator' && customer_code) {
            const [station] = await pool.query('SELECT customer_code FROM stations WHERE customer_code = ?', [customer_code]);
            if (station.length === 0) {
                return res.status(400).json({ error: 'Invalid customer code' });
            }
        }
        
        const [result] = await pool.query(
            'INSERT INTO users (username, password, role, customer_code, is_active) VALUES (?, ?, ?, ?, ?)',
            [username, password, role || 'viewer', customer_code || null, 1]
        );
        
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
        const { username, password, customer_code, station_id, city } = req.body;
        
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
            `INSERT INTO stations (username, password, customer_code, station_id, city) 
             VALUES (?, ?, ?, ?, ?)`,
            [username, password, customer_code, station_id, city]
        );
        
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
        const { customer_code, dispenser_id, address, DispenserBrand, number_of_nozzles, ir_lock_status } = req.body;
        const conn_status = 0;
        const connected_at = null;

        // Validate required fields
        if (!customer_code || !dispenser_id || !address || !DispenserBrand || !number_of_nozzles) {
            return res.status(400).json({ error: 'All fields are required: customer_code, dispenser_id, address, DispenserBrand, number_of_nozzles' });
        }

        // Check if dispenser already exists for this customer
        const [existing] = await pool.query(
            'SELECT id FROM dispensers WHERE customer_code = ? AND dispenser_id = ?',
            [customer_code, dispenser_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'This dispenser ID already exists for this customer' });
        }

        // Check if address is unique for this customer
        const [existingAddress] = await pool.query(
            'SELECT id FROM dispensers WHERE customer_code = ? AND address = ?',
            [customer_code, address]
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

        // Insert the dispenser
        const [result] = await pool.query(
            `INSERT INTO dispensers 
            (customer_code, dispenser_id, address, conn_status, connected_at, DispenserBrand, number_of_nozzles, ir_lock_status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [customer_code, dispenser_id, address, conn_status, connected_at, DispenserBrand, number_of_nozzles, ir_lock_status || 0]
        );

        // Subscribe to the new dispenser's topic using new format
        const topic = `pso/${city}/${customer_code}/duc/s${address}`;
        if (typeof subscribeToTopic === 'function') {
            await subscribeToTopic(topic, null);
        }

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

app.post('/api/nozzles', async (req, res) => {
    try {
        const { 
            customer_code,
            dispenser_id, 
            nozzle_id, 
            product, 
            status = 1, 
            lock_unlock = 1, 
            keypad_lock_status = 1, 
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

        const [result] = await pool.query(
            `INSERT INTO nozzles 
            (customer_code, dispenser_id, nozzle_id, product, status, lock_unlock, keypad_lock_status, 
             price_per_liter, total_quantity, total_amount, total_sales_today, price, quantity) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                customer_code,
                dispenser_id, 
                nozzle_id, 
                product, 
                status, 
                lock_unlock, 
                keypad_lock_status,
                numericFields.price_per_liter,
                numericFields.total_quantity,
                numericFields.total_amount,
                numericFields.total_sales_today,
                numericFields.price,
                numericFields.quantity
            ]
        );

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

        res.json({ success: true, message: 'Nozzles deleted successfully' });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to delete nozzles' });
    }
});

app.put('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username, role, customer_code, is_active, password } = req.body;
        
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
            values.push(password);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        
        values.push(id);
        
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
        
        res.json({ success: true, message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

app.put('/api/dispensers/:dispenser_id', async (req, res) => {
    try {
        const { dispenser_id } = req.params;
        const { customer_code, address, DispenserBrand, number_of_nozzles, ir_lock_status, conn_status } = req.body;

        if (!customer_code) {
            return res.status(400).json({ error: 'customer_code is required' });
        }

        // Check if at least one field is provided
        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: 'At least one field must be provided for update' });
        }

        const fields = [];
        const values = [];

        // Validate and add each field if provided
        if (address !== undefined) {
            fields.push('address = ?');
            values.push(address);
        }

        if (DispenserBrand !== undefined) {
            fields.push('DispenserBrand = ?');
            values.push(DispenserBrand);
        }

        if (number_of_nozzles !== undefined) {
            fields.push('number_of_nozzles = ?');
            values.push(number_of_nozzles);
        }

        if (ir_lock_status !== undefined) {
            fields.push('ir_lock_status = ?');
            values.push(ir_lock_status);
        }

        if (conn_status !== undefined) {
            fields.push('conn_status = ?');
            values.push(conn_status);
        }

        // Add WHERE clause parameters
        values.push(customer_code, dispenser_id);

        const [result] = await pool.query(
            `UPDATE dispensers SET ${fields.join(', ')}
            WHERE customer_code = ? AND dispenser_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Dispenser not found' });
        }

        res.json({ 
            success: true,
            message: 'Dispenser updated successfully',
            customer_code,
            dispenser_id
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to update dispenser' });
    }
});

app.put('/api/nozzles/:dispenser_id/:nozzle_id', async (req, res) => {
    try {
        const { dispenser_id, nozzle_id } = req.params;
        const { customer_code, product, status, price_per_liter, total_quantity, total_amount, 
                total_sales_today, lock_unlock, keypad_lock_status, price, quantity } = req.body;

        if (!customer_code) {
            return res.status(400).json({ error: 'customer_code is required' });
        }

        // Generate a unique hash for deduplication
        const messageHash = JSON.stringify({ customer_code, dispenser_id, nozzle_id, product, status, price_per_liter, total_quantity, total_amount, 
                                             total_sales_today, lock_unlock, keypad_lock_status, price, quantity });
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
        }
        if (status !== undefined) {
            fields.push('status = ?');
            values.push(status);
        }
        if (lock_unlock !== undefined) {
            fields.push('lock_unlock = ?');
            values.push(lock_unlock);
        }
        if (keypad_lock_status !== undefined) {
            fields.push('keypad_lock_status = ?');
            values.push(keypad_lock_status);
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
                    customer_code, dispenser_id, nozzle_id, product, status, price_per_liter,
                    total_quantity, total_amount, total_sales_today, lock_unlock, keypad_lock_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    updatedNozzle[0].customer_code,
                    updatedNozzle[0].dispenser_id,
                    updatedNozzle[0].nozzle_id,
                    updatedNozzle[0].product,
                    updatedNozzle[0].status,
                    parseFloat(updatedNozzle[0].price_per_liter),
                    parseFloat(updatedNozzle[0].total_quantity),
                    parseFloat(updatedNozzle[0].total_amount),
                    parseFloat(updatedNozzle[0].total_sales_today),
                    updatedNozzle[0].lock_unlock,
                    updatedNozzle[0].keypad_lock_status
                ]
            );
        }

        // Store update in cache for deduplication
        recentUpdates.set(messageHash, [now]);
        // Clean up old entries
        setTimeout(() => recentUpdates.delete(messageHash), DEDUPE_WINDOW);

        res.json({ 
            success: true,
            message: 'Nozzle updated successfully'
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to update nozzle: ' + error.message });
    }
});

app.put('/api/reset-logs/mark-cleared', (req, res) => {
    try {
        const { dispenserAddress, resetIds } = req.body;
        
        if (!dispenserAddress || !resetIds || !Array.isArray(resetIds) || resetIds.length === 0) {
            return res.status(400).json({ error: 'dispenserAddress and resetIds array are required' });
        }
        
        // Get or create cleared set for this dispenser
        if (!clearedResetsCache.has(dispenserAddress)) {
            clearedResetsCache.set(dispenserAddress, new Set());
        }
        
        const clearedSet = clearedResetsCache.get(dispenserAddress);
        resetIds.forEach(id => clearedSet.add(id));
        
        res.json({ 
            success: true, 
            message: `${resetIds.length} reset log(s) marked as cleared`,
            affectedRows: resetIds.length
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
        
        // Don't allow deleting the last admin
        const [admins] = await pool.query('SELECT id FROM users WHERE role = "admin"');
        if (admins.length === 1) {
            const [user] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
            if (user[0]?.role === 'admin') {
                return res.status(400).json({ error: 'Cannot delete the last admin user' });
            }
        }
        
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
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
            'SELECT address, dispenser_id, customer_code FROM dispensers WHERE id = ? AND customer_code = ?', 
            [id, customer_code]
        );
        
        if (dispenser.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Dispenser not found' });
        }
        
        const { address, dispenser_id } = dispenser[0];
        
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
        
        res.json({ 
            success: true,
            message: deleteHistory 
                ? 'Dispenser and all historical records deleted successfully'
                : 'Dispenser deleted (historical records preserved)'
        });

        // Unsubscribe from MQTT topics
        if (typeof unsubscribeFromTopic === 'function') {
            unsubscribeFromTopic(`D${address}`);
            unsubscribeFromTopic(`duc/conn_status/D${address}`);
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

// Instead of keeping data in history table, make a new archives table for deleted dispensers
// ------ NOT TESTED ------
// app.delete('/api/dispensers/:id', async (req, res) => {
//     const connection = await pool.getConnection();
//     try {
//         await connection.beginTransaction();
        
//         const { id } = req.params;
//         const deleteHistory = req.query.delete_history === 'true';
        
//         // Get dispenser info
//         const [dispenser] = await connection.query(
//             'SELECT address, dispenser_id FROM dispensers WHERE id = ?', 
//             [id]
//         );
        
//         if (dispenser.length === 0) {
//             await connection.rollback();
//             return res.status(404).json({ error: 'Dispenser not found' });
//         }
        
//         const { address, dispenser_id } = dispenser[0];
        
//         // Unsubscribe from topics
//         unsubscribeFromTopic(`D${address}`);
//         unsubscribeFromTopic(`duc/conn_status/D${address}`);
        
//         if (!deleteHistory) {
//             // Archive historical data before deletion
//             // 1. Archive nozzle_history
//             await connection.query(`
//                 CREATE TABLE IF NOT EXISTS archived_nozzle_history LIKE nozzle_history
//             `);
            
//             await connection.query(`
//                 INSERT INTO archived_nozzle_history 
//                 SELECT * FROM nozzle_history WHERE dispenser_id = ?
//             `, [dispenser_id]);
            
//             // 2. Archive transactions
//             await connection.query(`
//                 CREATE TABLE IF NOT EXISTS archived_transactions LIKE transactions
//             `);
            
//             await connection.query(`
//                 INSERT INTO archived_transactions 
//                 SELECT * FROM transactions WHERE dispenser_id = ?
//             `, [dispenser_id]);
            
//             // 3. Archive nozzles (optional)
//             await connection.query(`
//                 CREATE TABLE IF NOT EXISTS archived_nozzles LIKE nozzles
//             `);
            
//             await connection.query(`
//                 INSERT INTO archived_nozzles 
//                 SELECT * FROM nozzles WHERE dispenser_id = ?
//             `, [dispenser_id]);
//         }
        
//         // Delete from main tables (cascade will handle nozzle_history and transactions if deleteHistory=true)
//         // If deleteHistory=false, we've already archived the data
//         const [result] = await connection.query(
//             'DELETE FROM dispensers WHERE id = ?',
//             [id]
//         );
        
//         await connection.commit();
        
//         if (result.affectedRows === 0) {
//             await connection.rollback();
//             return res.status(404).json({ error: 'Dispenser not found' });
//         }
        
//         res.json({ 
//             success: true,
//             message: deleteHistory 
//                 ? 'Dispenser and all historical records deleted successfully'
//                 : 'Dispenser deleted (historical records archived)'
//         });
        
//     } catch (error) {
//         await connection.rollback();
//         console.error('Database error:', error);
//         res.status(500).json({ error: 'Failed to delete dispenser' });
//     } finally {
//         connection.release();
//     }
// });