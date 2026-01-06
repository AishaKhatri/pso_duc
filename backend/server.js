const express = require('express');
const cors = require('cors');
const multer = require('multer');
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

// Configure storage relative to your project root
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use path relative to your server.js location
    const uploadDir = path.join(__dirname, '..', 'assets', 'dip-charts');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use the exact original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.xlsx', '.xls', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: ${allowedTypes.join(', ')}`));
    }
  }
});

app.get('/api/stations/:station_id', async (req, res) => {
    try {
        const { station_id } = req.params;
        const [rows] = await pool.query(
            'SELECT * FROM stations WHERE station_id = ?',
            [station_id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Station not found' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch station' });
    }
});

app.get('/api/tanks/atg-data', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT 
                id, tank_id, address, product, 
                conn_status, connected_at, dip_chart_path,
                max_capacity_mm, max_capacity_ltr,
                status, temperature, 
                product_level_mm, product_level_ltr,
                water_level_mm, water_level_ltr,
                last_updated,
                CASE 
                    WHEN last_updated IS NULL THEN 0
                    WHEN TIMESTAMPDIFF(MINUTE, last_updated, NOW()) > 5 THEN 0
                    ELSE 1 
                END as is_active
            FROM tanks 
            ORDER BY tank_id`
        );
        
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch ATG data' });
    }
});

app.get('/api/dispensers', async (req, res) => {
    try {
        const stationId = req.query.station_id;
        if (!stationId) return res.status(400).json({ error: 'station_id is required' });
        
        const [rows] = await pool.query(
            'SELECT * FROM dispensers WHERE station_id = ?',
            [stationId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch dispensers' });
    }
});

app.get('/api/dispensers/next-id', async (req, res) => {
    try {
        const { station_id } = req.query;
        if (!station_id) {
            return res.status(400).json({ error: 'station_id is required' });
        }

        const [rows] = await pool.query(
            'SELECT MAX(CAST(dispenser_id AS UNSIGNED)) as max_id FROM dispensers WHERE station_id = ?',
            [station_id]
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
        const { station_id, dispenser_id } = req.query;
        if (!station_id || !dispenser_id) {
            return res.status(400).json({ error: 'Both station_id and dispenser_id are required' });
        }

        const [rows] = await pool.query(
            'SELECT * FROM nozzles WHERE station_id = ? AND dispenser_id = ?',
            [station_id, dispenser_id]
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

app.get('/api/tanks', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM tanks'
        );
        res.json(rows);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to fetch tanks' });
    }
});

app.get('/api/tanks/next-id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT MAX(CAST(tank_id AS UNSIGNED)) as max_id FROM tanks'
        );

        const next_id = (rows[0].max_id || 0) + 1;
        res.json({ next_id: next_id.toString() });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to get next tank ID' });
    }
});

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
        
        // Fetch errors for both dispenser and tank at this address
        const [errors] = await pool.query(
            `SELECT 
                station_id,
                device_type,
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
                    station_id: error.station_id,
                    device_type: error.device_type,
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
                    station_id: error.station_id,
                    device_type: error.device_type,
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
                station_id,
                device_type,
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

app.post('/api/tanks', async (req, res) => {
    try {
        const { tank_id, address, product, dip_chart_path, max_capacity_mm, max_capacity_ltr } = req.body;
        const conn_status = 0;
        const connected_at = null;

        if (!tank_id || !address || !product || !dip_chart_path) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const [existing] = await pool.query(
            'SELECT id FROM tanks WHERE tank_id = ? && address = ?', [tank_id, address]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'This ATG number already exists for this address' });
        }

        if (!/^\d{5}$/.test(address)) {
            return res.status(400).json({ error: 'Address must be 5 digits' });
        }

        const [result] = await pool.query(
            `INSERT INTO tanks 
            (tank_id, address, product, conn_status, connected_at, dip_chart_path, max_capacity_mm, max_capacity_ltr) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tank_id, address, product, conn_status, connected_at, dip_chart_path, max_capacity_mm || 0, max_capacity_ltr || 0]
        );

        // Subscribe to the new dispenser's topic
        const topic = `T${address.padStart(5, '0')}`;
        subscribeToTopic(topic, null);

        res.status(201).json({ 
            success: true, 
            id: result.insertId,
            tank_id: tank_id,
            message: 'Tank added successfully',
            max_capacity_mm: max_capacity_mm || 0,
            max_capacity_ltr: max_capacity_ltr || 0
        });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ error: 'Failed to add tank' });
    }
});

// File upload endpoint
app.post('/api/tanks/upload-dip-chart', upload.single('dipChart'), (req, res) => {
    try {
        if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
        }

        // Return path relative to assets folder
        const relativePath = `../assets/dip-charts/${req.file.filename}`;
    
        // Get file extension and validate
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        const allowedExtensions = ['.csv', '.xlsx', '.xls', '.txt'];
        
        if (!allowedExtensions.includes(fileExt)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Invalid file format. Supported formats: CSV, Excel, TXT' });
        }

        // Parse the CSV to get max values
        let maxMm = 0;
        let maxLtr = 0;
        
        if (fileExt === '.csv') {
            const fileContent = fs.readFileSync(req.file.path, 'utf-8');
            const lines = fileContent.trim().split('\n');
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            
            // Find column indices
            const mmIndex = headers.findIndex(h => h.includes('mm'));
            const litersIndex = headers.findIndex(h => h.includes('liters') || h.includes('litres'));
            
            if (mmIndex !== -1 && litersIndex !== -1) {
                // Parse all rows to find max values
                for (let i = 1; i < lines.length; i++) {
                    const row = lines[i].split(',').map(cell => cell.trim());
                    if (row.length > Math.max(mmIndex, litersIndex)) {
                        const mm = parseFloat(row[mmIndex]);
                        const liters = parseFloat(row[litersIndex]);
                        
                        if (!isNaN(mm) && !isNaN(liters)) {
                            if (mm > maxMm) maxMm = mm;
                            if (liters > maxLtr) maxLtr = liters;
                        }
                    }
                }
            }
        }

        res.json({ 
            success: true,
            filePath: relativePath,  // This will be stored in DB
            fileName: req.file.originalname,
            fileSize: req.file.size,
            uploadedAt: new Date().toISOString(),
            max_capacity_mm: maxMm,
            max_capacity_ltr: maxLtr
        });
        
    } catch (error) {
        console.error('Upload error:', error);
        
        res.status(500).json({ error: 'Failed to upload dip chart file' });
    }
});

// Make the entire dip-charts directory publicly accessible
app.use('/dip-charts', express.static(path.join(__dirname, 'assets', 'dip-charts')));

app.post('/api/dispensers', async (req, res) => {
    try {
        const { station_id, dispenser_id, address, vendor, number_of_nozzles, ir_lock_status } = req.body;
        const conn_status = 0;
        const connected_at = null;

        if (!station_id || !dispenser_id || !address || !vendor || !number_of_nozzles) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const [existing] = await pool.query(
            'SELECT id FROM dispensers WHERE dispenser_id = ?', dispenser_id
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'This dispenser ID already exists' });
        }

        if (!/^\d{5}$/.test(address)) {
            return res.status(400).json({ error: 'Address must be 5 digits' });
        }

        const [result] = await pool.query(
            `INSERT INTO dispensers 
            (station_id,dispenser_id, address, conn_status, connected_at, vendor, number_of_nozzles, ir_lock_status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [station_id, dispenser_id, address, conn_status, connected_at, vendor, number_of_nozzles, ir_lock_status || 0]
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
            station_id,
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

        if (!station_id || !dispenser_id || !nozzle_id || !product) {
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
            'SELECT id FROM nozzles WHERE station_id = ? AND dispenser_id = ? AND nozzle_id = ?',
            [station_id, dispenser_id, nozzle_id]
        );

        if (existing.length > 0) {
            return res.status(400).json({ error: 'Nozzle ID already exists for this dispenser' });
        }

        const [result] = await pool.query(
            `INSERT INTO nozzles 
            (station_id, dispenser_id, nozzle_id, product, status, lock_unlock, keypad_lock_status, 
             price_per_liter, total_quantity, total_amount, total_sales_today, price, quantity) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                station_id,
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

app.put('/api/dispensers/:station_id/:dispenser_id', async (req, res) => {
    try {
        const { station_id, dispenser_id } = req.params;
        const { address, vendor, number_of_nozzles, ir_lock_status, conn_status } = req.body;

        // Check if at least one field is provided
        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ error: 'At least one field must be provided for update' });
        }

        const fields = [];
        const values = [];

        // Validate and add each field if provided
        if (address !== undefined) {
            if (!/^\d{5}$/.test(address)) {
                return res.status(400).json({ error: 'Address must be 5 digits' });
            }
            fields.push('address = ?');
            values.push(address);
        }

        if (vendor !== undefined) {
            fields.push('vendor = ?');
            values.push(vendor);
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
        values.push(station_id, dispenser_id);

        const [result] = await pool.query(
            `UPDATE dispensers SET ${fields.join(', ')}
            WHERE station_id = ? AND dispenser_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Dispenser not found' });
        }

        // Update MQTT subscription if address changed
        if (address !== undefined) {
            const [oldDispenser] = await pool.query(
                'SELECT address FROM dispensers WHERE station_id = ? AND dispenser_id = ?',
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

app.put('/api/nozzles/:station_id/:dispenser_id/:nozzle_id', async (req, res) => {
    try {
        const { station_id, dispenser_id, nozzle_id } = req.params;
        const { product, status, price_per_liter, total_quantity, total_amount, 
                total_sales_today, lock_unlock, keypad_lock_status, price, quantity } = req.body;

        // Generate a unique hash for deduplication
        const messageHash = JSON.stringify({ station_id, dispenser_id, nozzle_id, product, status, price_per_liter, total_quantity, total_amount, 
                                             total_sales_today, lock_unlock, keypad_lock_status, price, quantity });
        const now = Date.now();
        if (recentUpdates.has(messageHash)) {
            const [lastUpdateTime] = recentUpdates.get(messageHash);
            if (now - lastUpdateTime < DEDUPE_WINDOW) {
                console.log(`Skipping duplicate update for ${station_id}/${dispenser_id}/${nozzle_id}`);
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
            WHERE station_id = ? AND dispenser_id = ? AND nozzle_id = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Nozzle not found' });
        }

        // Insert into nozzle_history after update to capture new state
        const [updatedNozzle] = await pool.query(
            'SELECT * FROM nozzles WHERE station_id = ? AND dispenser_id = ? AND nozzle_id = ?',
            [station_id, dispenser_id, decodeURIComponent(nozzle_id)]
        );
        if (updatedNozzle.length > 0) {
            await pool.query(
                `INSERT INTO nozzle_history (
                    station_id, dispenser_id, nozzle_id, product, status, price_per_liter,
                    total_quantity, total_amount, total_sales_today, lock_unlock, keypad_lock_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    updatedNozzle[0].station_id,
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

app.delete('/api/tanks/:id', async (req, res) => {
    try {
        const tankId = req.params.id;
        
        // Get tank info first
        const [tank] = await pool.query('SELECT address FROM tanks WHERE id = ?', [tankId]);
        
        if (tank.length > 0) {
            unsubscribeFromTopic(`T${tank.address}`);
            unsubscribeFromTopic(`duc/conn_status/T${tank.address}`);
        }
              
        // Delete from database
        await pool.query('DELETE FROM tanks WHERE id = ?', [tankId]);
        
        res.json({ 
        success: true,
        message: 'Tank deleted successfully'
        });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete tank' });
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