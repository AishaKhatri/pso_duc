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
    getWifiConnectionStatus } = require('./mqtt-service');

const { 
    startMidnightResetService,
    NotificationService,
    NotificationWebSocketServer } = require('./backend-services');

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
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if session exists in database and is not expired
    const [sessions] = await pool.query(
      `SELECT s.*, st.username, st.customer_code, st.station_id, 
              st.city
       FROM sessions s
       JOIN stations st ON s.user_id = st.id
       WHERE s.session_token = ? AND s.expires_at > NOW()`,
      [token]
    );

    if (sessions.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Session expired or invalid' 
      });
    }

    const session = sessions[0];
    
    // Remove sensitive data
    const { password, ...stationData } = session;

    res.json({
      success: true,
      user: {
        id: stationData.user_id,
        username: stationData.username,
        customerCode: stationData.customer_code,
        stationId: stationData.station_id,
        city: stationData.city
      }
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      // Clean up expired session
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        await pool.query(
          'DELETE FROM sessions WHERE session_token = ?',
          [token]
        );
      }
      
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired' 
      });
    }
    
    console.error('Token verification error:', error);
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

// Add this endpoint to server.js if it doesn't exist
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
        const [rows] = await pool.query(
            'SELECT * FROM dispensers'
        );
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch dispensers' });
    }
});

app.get('/api/dispensers/next-id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT MAX(CAST(dispenser_id AS UNSIGNED)) as max_id FROM dispensers'
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
        const { dispenser_id } = req.query;
        if (!dispenser_id) {
            return res.status(400).json({ error: 'dispenser_id is required' });
        }

        const [rows] = await pool.query(
            'SELECT * FROM nozzles WHERE dispenser_id = ?',
            [dispenser_id]
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
        const status = getPowerOnStatus(dispenser_addr);
        
        if (!status) {
            return res.status(404).json({ error: 'Power-on status not found for this dispenser' });
        }
        
        res.json(status);
    } catch (error) {
        console.error('Error fetching power-on status:', error);
        res.status(500).json({ error: 'Failed to fetch power-on status' });
    }
});

app.get('/api/error-log/:address', async (req, res) => {
    try {
        let { address } = req.params;
        address = address.replace(/^D/, '');
        
        // Fetch errors at this address
        const [errors] = await pool.query(
            `SELECT 
                device_id,
                error_message, 
                created_at 
            FROM errors 
            WHERE address = ?
            ORDER BY created_at DESC
            LIMIT 100`,
            [address]
        );
        
        // Parse the error_message JSON and structure the data
        const parsedErrors = errors.map(error => {
            try {
                const parsedMessage = JSON.parse(error.error_message);
                return {
                    device_id: error.device_id,
                    timestamp: error.created_at,
                    log_time: new Date(error.created_at).toLocaleString(),
                    unix_time: parsedMessage.Time || null,
                    error_code: parsedMessage.Code || null,
                    severity: parsedMessage.Sev || null,
                    file: parsedMessage.File || null,
                    line: parsedMessage.Line || null,
                    function: parsedMessage.Func || null,
                    context: parsedMessage.Cntx || null,
                    raw_message: error.error_message
                };
            } catch (e) {
                // If parsing fails, return the raw data
                return {
                    device_id: error.device_id,
                    timestamp: error.created_at,
                    log_time: new Date(error.created_at).toLocaleString(),
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
                device_id,
                temperature,
                firmware_version,
                hardware_version,
                mac_address,
                serial_number,
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
    const [stations] = await pool.query(
      `SELECT id, username, password, customer_code, station_id, 
              city, created_at 
       FROM stations 
       WHERE username = ? OR customer_code = ?`,
      [username, username] // Allow login with either username or customer_code
    );

    if (stations.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    const station = stations[0];

    // Verify password (plain text comparison as per your table structure)
    // Note: In production, you should hash passwords!
    if (password !== station.password) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: station.id,
        username: station.username,
        customerCode: station.customer_code,
        stationId: station.station_id,
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Create session in database
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const sessionToken = require('crypto').randomBytes(64).toString('hex');
    
    await pool.query(
      'INSERT INTO sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)',
      [station.id, sessionToken, expiresAt]
    );

    // Remove password from response
    const { password: _, ...stationData } = station;

    // Return success response
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: stationData
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
        const { dispenser_id, address, DispenserBrand, number_of_nozzles, ir_lock_status } = req.body;
        const conn_status = 0;
        const connected_at = null;

        if (!dispenser_id || !address || !DispenserBrand || !number_of_nozzles) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const [existing] = await pool.query(
            'SELECT id FROM dispensers WHERE dispenser_id = ?', dispenser_id
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'This dispenser ID already exists' });
        }

        // if (!/^\d{5}$/.test(address)) {
        //     return res.status(400).json({ error: 'Address must be 5 digits' });
        // }

        const [result] = await pool.query(
            `INSERT INTO dispensers 
            (dispenser_id, address, conn_status, connected_at, DispenserBrand, number_of_nozzles, ir_lock_status) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [dispenser_id, address, conn_status, connected_at, DispenserBrand, number_of_nozzles, ir_lock_status || 0]
        );

        // Subscribe to the new dispenser's topic
        const topic = `S${address.padStart(5, '0')}`;
        subscribeToTopic(topic, null);

        res.status(201).json({ 
            success: true, 
            id: result.insertId,
            dispenser_id: dispenser_id,
            message: 'Dispenser added successfully'
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to add dispenser' });
    }
});

app.post('/api/nozzles', async (req, res) => {
    try {
        const { 
            dispenser_id, 
            nozzle_id, 
            product, 
            status = 0, 
            lock_unlock = 0, 
            keypad_lock_status = 1, 
            price_per_liter = '0.00', 
            total_quantity = '0.00', 
            total_amount = '0.00', 
            total_sales_today = '0.00',
            price = '0.00',
            quantity = '0.00'
        } = req.body;

        if (!dispenser_id || !nozzle_id || !product) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const numericFields = {
            price_per_liter: parseFloat(price_per_liter),
            total_quantity: parseFloat(total_quantity),
            total_amount: parseFloat(total_amount),
            total_sales_today: parseFloat(total_sales_today),
            price: parseFloat(price),
            quantity: parseFloat(quantity)
        };

        const [existing] = await pool.query(
            'SELECT id FROM nozzles WHERE dispenser_id = ? AND nozzle_id = ?',
            [dispenser_id, nozzle_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Nozzle ID already exists for this dispenser' });
        }

        const [result] = await pool.query(
            `INSERT INTO nozzles 
            (dispenser_id, nozzle_id, product, status, lock_unlock, keypad_lock_status, 
             price_per_liter, total_quantity, total_amount, total_sales_today, price, quantity) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
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
        res.status(500).json({ error: 'Failed to add nozzle' });
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

app.put('/api/dispensers/:dispenser_id', async (req, res) => {
    try {
        const { dispenser_id } = req.params;
        const { address, DispenserBrand, number_of_nozzles, ir_lock_status, conn_status } = req.body;

        // Check if at least one field is provided
        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: 'At least one field must be provided for update' });
        }

        const fields = [];
        const values = [];

        // Validate and add each field if provided
        if (address !== undefined) {
            // if (!/^\d{5}$/.test(address)) {
            //     return res.status(400).json({ error: 'Address must be 5 digits' });
            // }
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
        values.push(dispenser_id);

        const [result] = await pool.query(
            `UPDATE dispensers SET ${fields.join(', ')}
            WHERE dispenser_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Dispenser not found' });
        }

        // Update MQTT subscription if address changed
        if (address !== undefined) {
            const [oldDispenser] = await pool.query(
                'SELECT address FROM dispensers WHERE dispenser_id = ?',
                [dispenser_id]
            );
            if (oldDispenser.length > 0) {
                unsubscribeFromTopic(`D${oldDispenser[0].address}`);
                unsubscribeFromTopic(`duc/conn_status/D${oldDispenser[0].address}`);
            }
            const topic = `S${address.padStart(5, '0')}`;
            subscribeToTopic(topic, null);
        }

        res.json({ 
            success: true,
            message: 'Dispenser updated successfully',
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
        const { product, status, price_per_liter, total_quantity, total_amount, 
                total_sales_today, lock_unlock, keypad_lock_status, price, quantity } = req.body;

        // Generate a unique hash for deduplication
        const messageHash = JSON.stringify({ dispenser_id, nozzle_id, product, status, price_per_liter, total_quantity, total_amount, 
                                             total_sales_today, lock_unlock, keypad_lock_status, price, quantity });
        const now = Date.now();
        if (recentUpdates.has(messageHash)) {
            const [lastUpdateTime] = recentUpdates.get(messageHash);
            if (now - lastUpdateTime < DEDUPE_WINDOW) {
                console.log(`Skipping duplicate update for ${dispenser_id}/${nozzle_id}`);
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

        values.push(dispenser_id, decodeURIComponent(nozzle_id));

        // Update nozzles first
        const [result] = await pool.query(
            `UPDATE nozzles SET ${fields.join(', ')}
            WHERE dispenser_id = ? AND nozzle_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Nozzle not found' });
        }

        // Insert into nozzle_history after update to capture new state
        const [updatedNozzle] = await pool.query(
            'SELECT * FROM nozzles WHERE dispenser_id = ? AND nozzle_id = ?',
            [dispenser_id, decodeURIComponent(nozzle_id)]
        );
        if (updatedNozzle.length > 0) {
            await pool.query(
                `INSERT INTO nozzle_history (
                    dispenser_id, nozzle_id, product, status, price_per_liter,
                    total_quantity, total_amount, total_sales_today, lock_unlock, keypad_lock_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
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
        res.status(500).json({ error: 'Failed to update nozzle' });
    }
});

app.delete('/api/dispensers/:id', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const deleteHistory = req.query.delete_history === 'true';
        
        const [dispenser] = await connection.query(
            'SELECT address, dispenser_id FROM dispensers WHERE id = ?', 
            [id]
        );
        
        if (dispenser.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Dispenser not found' });
        }
        
        const { address, dispenser_id } = dispenser[0];
        
        // Temporarily disable foreign key checks
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        
        if (deleteHistory) {
            // Delete historical data first
            await connection.query(
                'DELETE FROM nozzle_history WHERE dispenser_id = ?',
                [dispenser_id]
            );
            
            await connection.query(
                'DELETE FROM transactions WHERE dispenser_id = ?',
                [dispenser_id]
            );
        }
        
        // Delete nozzles
        await connection.query('DELETE FROM nozzles WHERE dispenser_id = ?', [dispenser_id]);
        
        // Delete dispenser
        const [result] = await connection.query(
            'DELETE FROM dispensers WHERE id = ?',
            [id]
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

        unsubscribeFromTopic(`D${dispenser[0].address}`);
        unsubscribeFromTopic(`duc/conn_status/D${dispenser[0].address}`);
               
    } catch (error) {
        await connection.rollback();
        // Make sure to re-enable foreign key checks
        await pool.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to delete dispenser' });
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