const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./db');
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

const app = express();
app.use(cors());
app.use(express.json());

let notificationWebSocketServer;
let notificationService;

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// ==================== AUTHENTICATION MIDDLEWARE ====================

// Authentication middleware for API routes
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Admin-only middleware
function verifyAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Station access middleware (for operators)
function verifyStationAccess(req, res, next) {
  if (req.user.role === 'admin') {
    return next();
  }
  
  const requestedCustomerCode = req.params.customerCode || req.query.customer_code || req.body.customer_code;
  
  if (requestedCustomerCode && req.user.customer_code !== requestedCustomerCode) {
    return res.status(403).json({ error: 'Access denied. You can only access your own station.' });
  }
  
  next();
}

// ==================== USER MANAGEMENT APIS ====================

// Get all users (admin only)
app.get('/api/users', authenticate, verifyAdmin, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, role, customer_code, is_active, last_login, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get single user (admin only)
app.get('/api/users/:id', authenticate, verifyAdmin, async (req, res) => {
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

// Create new user (admin only)
app.post('/api/users', authenticate, verifyAdmin, async (req, res) => {
  try {
    const { username, password, role, customer_code } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    if (role === 'operator' && !customer_code) {
      return res.status(400).json({ error: 'Customer code is required for operator role' });
    }
    
    if (role === 'operator' && customer_code) {
      const [station] = await pool.query('SELECT customer_code FROM stations WHERE customer_code = ?', [customer_code]);
      if (station.length === 0) {
        return res.status(400).json({ error: 'Invalid customer code' });
      }
    }
    
    // In production, hash the password: const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPassword = password;
    
    const [result] = await pool.query(
      'INSERT INTO users (username, password, role, customer_code, is_active) VALUES (?, ?, ?, ?, ?)',
      [username, hashedPassword, role || 'viewer', customer_code || null, 1]
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

// Update user (admin only)
app.put('/api/users/:id', authenticate, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, role, customer_code, is_active, password } = req.body;
    
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

// Delete user (admin only)
app.delete('/api/users/:id', authenticate, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
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

// ==================== AUTHENTICATION APIS ====================

// Sign in - only for users (admin, operator, viewer)
app.post('/api/auth/signin', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide username and password' 
      });
    }

    // Only check in users table
    const [users] = await pool.query(
      'SELECT id, username, password, role, customer_code, is_active FROM users WHERE username = ?',
      [username]
    );
    
    if (users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }

    const user = users[0];
    
    // Check if account is active
    if (user.is_active === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Account is disabled. Please contact administrator.' 
      });
    }
    
    // Verify password (plain text for now)
    if (password !== user.password) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid username or password' 
      });
    }
    
    // Update last_login
    await pool.query(
      'UPDATE users SET last_login = NOW() WHERE id = ?',
      [user.id]
    );
    
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
    
    // Create session
    const sessionToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    await pool.query(
      'INSERT INTO sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)',
      [user.id, sessionToken, expiresAt]
    );
    
    // Remove password from response
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

// Sign out
app.post('/api/auth/signout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (token) {
      await pool.query('DELETE FROM sessions WHERE session_token = ?', [token]);
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

// Verify token
app.get('/api/auth/verify', authenticate, async (req, res) => {
  try {
    // authenticate middleware already verified the token and set req.user
    const user = req.user;
    
    // Get fresh user data from database
    const [users] = await pool.query(
      'SELECT id, username, role, customer_code FROM users WHERE id = ?',
      [user.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'User not found' 
      });
    }

    const userData = users[0];

    res.json({
      success: true,
      user: {
        id: userData.id,
        username: userData.username,
        role: userData.role,
        customerCode: userData.customer_code
      }
    });

  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

// ==================== STATION APIS ====================

app.get('/api/stations', authenticate, async (req, res) => {
  try {
    let query = 'SELECT id, customer_code, station_id, city, username, created_at FROM stations';
    let params = [];
    
    if (req.user.role !== 'admin' && req.user.customer_code) {
      query += ' WHERE customer_code = ?';
      params.push(req.user.customer_code);
    }
    
    query += ' ORDER BY customer_code';
    
    const [stations] = await pool.query(query, params);
    res.json(stations);
  } catch (error) {
    console.error('Get stations error:', error);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

app.get('/api/stations/:customerCode', authenticate, verifyStationAccess, async (req, res) => {
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

// ==================== DISPENSER APIS ====================

app.get('/api/dispensers', authenticate, verifyStationAccess, async (req, res) => {
  try {
    const { customer_code } = req.query;
    
    let query = `
      SELECT d.*, s.city 
      FROM dispensers d
      JOIN stations s ON d.customer_code = s.customer_code
    `;
    let params = [];
    
    if (req.user.role !== 'admin' && req.user.customer_code) {
      query += ' WHERE d.customer_code = ?';
      params.push(req.user.customer_code);
    } else if (customer_code) {
      query += ' WHERE d.customer_code = ?';
      params.push(customer_code);
    }
    
    query += ' ORDER BY d.customer_code, d.dispenser_id';
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to fetch dispensers' });
  }
});

app.get('/api/dispensers/next-id', authenticate, verifyStationAccess, async (req, res) => {
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

app.post('/api/dispensers', authenticate, verifyStationAccess, async (req, res) => {
  try {
    const { customer_code, dispenser_id, address, DispenserBrand, number_of_nozzles, ir_lock_status } = req.body;
    const conn_status = 0;
    const connected_at = null;

    if (!customer_code || !dispenser_id || !address || !DispenserBrand || !number_of_nozzles) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM dispensers WHERE customer_code = ? AND dispenser_id = ?',
      [customer_code, dispenser_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'This dispenser ID already exists for this customer' });
    }

    const [existingAddress] = await pool.query(
      'SELECT id FROM dispensers WHERE customer_code = ? AND address = ?',
      [customer_code, address]
    );

    if (existingAddress.length > 0) {
      return res.status(400).json({ error: 'This address already exists for this customer' });
    }

    const [stations] = await pool.query('SELECT city FROM stations WHERE customer_code = ?', [customer_code]);
    
    if (stations.length === 0) {
      return res.status(400).json({ error: 'Customer not found' });
    }
    
    const city = stations[0].city;

    const [result] = await pool.query(
      `INSERT INTO dispensers 
      (customer_code, dispenser_id, address, conn_status, connected_at, DispenserBrand, number_of_nozzles, ir_lock_status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [customer_code, dispenser_id, address, conn_status, connected_at, DispenserBrand, number_of_nozzles, ir_lock_status || 0]
    );

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

app.put('/api/dispensers/:dispenser_id', authenticate, verifyStationAccess, async (req, res) => {
  try {
    const { dispenser_id } = req.params;
    const { customer_code, address, DispenserBrand, number_of_nozzles, ir_lock_status, conn_status } = req.body;

    if (!customer_code) {
      return res.status(400).json({ error: 'customer_code is required' });
    }

    const fields = [];
    const values = [];

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

    if (fields.length === 0) {
      return res.status(400).json({ error: 'At least one field must be provided' });
    }

    values.push(customer_code, dispenser_id);

    const [result] = await pool.query(
      `UPDATE dispensers SET ${fields.join(', ')} WHERE customer_code = ? AND dispenser_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Dispenser not found' });
    }

    res.json({ success: true, message: 'Dispenser updated successfully' });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to update dispenser' });
  }
});

app.delete('/api/dispensers/:id', authenticate, verifyAdmin, async (req, res) => {
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
    
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    
    const deleteHistoryFlag = delete_history === 'true';
    
    if (deleteHistoryFlag) {
      await connection.query('DELETE FROM nozzle_history WHERE customer_code = ? AND dispenser_id = ?', [customer_code, dispenser_id]);
      await connection.query('DELETE FROM transactions WHERE customer_code = ? AND dispenser_id = ?', [customer_code, dispenser_id]);
    }
    
    await connection.query('DELETE FROM nozzles WHERE customer_code = ? AND dispenser_id = ?', [customer_code, dispenser_id]);
    await connection.query('DELETE FROM dispensers WHERE id = ? AND customer_code = ?', [id, customer_code]);
    
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    await connection.commit();
    
    if (typeof unsubscribeFromTopic === 'function') {
      unsubscribeFromTopic(`D${address}`);
      unsubscribeFromTopic(`duc/conn_status/D${address}`);
    }
    
    res.json({ success: true, message: deleteHistoryFlag ? 'Dispenser and all historical records deleted successfully' : 'Dispenser deleted (historical records preserved)' });
  } catch (error) {
    await connection.rollback();
    await pool.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to delete dispenser: ' + error.message });
  } finally {
    connection.release();
  }
});

// ==================== NOZZLE APIS ====================

app.get('/api/nozzles', authenticate, verifyStationAccess, async (req, res) => {
  try {
    const { dispenser_id, customer_code } = req.query;
    
    if (!dispenser_id || !customer_code) {
      return res.status(400).json({ error: 'dispenser_id and customer_code are required' });
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

app.post('/api/nozzles', authenticate, verifyStationAccess, async (req, res) => {
  try {
    const { 
      customer_code, dispenser_id, nozzle_id, product, status = 1, 
      lock_unlock = 1, keypad_lock_status = 1, price_per_liter = '0.00', 
      total_quantity = '0.00', total_amount = '0.00', total_sales_today = '0.00',
      price = '0.00', quantity = '0.00'
    } = req.body;

    if (!customer_code || !dispenser_id || !nozzle_id || !product) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

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
      [customer_code, dispenser_id, nozzle_id, product, status, lock_unlock, keypad_lock_status,
       parseFloat(price_per_liter), parseFloat(total_quantity), parseFloat(total_amount),
       parseFloat(total_sales_today), parseFloat(price), parseFloat(quantity)]
    );

    res.status(201).json({ success: true, id: result.insertId, message: 'Nozzle added successfully' });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to add nozzle: ' + error.message });
  }
});

app.put('/api/nozzles/:dispenser_id/:nozzle_id', authenticate, verifyStationAccess, async (req, res) => {
  try {
    const { dispenser_id, nozzle_id } = req.params;
    const { customer_code, product, status, price_per_liter, total_quantity, total_amount, 
            total_sales_today, lock_unlock, keypad_lock_status, price, quantity } = req.body;

    if (!customer_code) {
      return res.status(400).json({ error: 'customer_code is required' });
    }

    const fields = [];
    const values = [];

    if (total_quantity !== undefined) fields.push('total_quantity = ?'), values.push(parseFloat(total_quantity));
    if (total_amount !== undefined) fields.push('total_amount = ?'), values.push(parseFloat(total_amount));
    if (total_sales_today !== undefined) fields.push('total_sales_today = ?'), values.push(parseFloat(total_sales_today));
    if (price_per_liter !== undefined) fields.push('price_per_liter = ?'), values.push(parseFloat(price_per_liter));
    if (price !== undefined) fields.push('price = ?'), values.push(parseFloat(price));
    if (quantity !== undefined) fields.push('quantity = ?'), values.push(parseFloat(quantity));
    if (product !== undefined) fields.push('product = ?'), values.push(product);
    if (status !== undefined) fields.push('status = ?'), values.push(status);
    if (lock_unlock !== undefined) fields.push('lock_unlock = ?'), values.push(lock_unlock);
    if (keypad_lock_status !== undefined) fields.push('keypad_lock_status = ?'), values.push(keypad_lock_status);

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    values.push(customer_code, dispenser_id, decodeURIComponent(nozzle_id));

    const [result] = await pool.query(
      `UPDATE nozzles SET ${fields.join(', ')} WHERE customer_code = ? AND dispenser_id = ? AND nozzle_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Nozzle not found' });
    }

    res.json({ success: true, message: 'Nozzle updated successfully' });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Failed to update nozzle: ' + error.message });
  }
});

// ==================== OTHER APIS ====================

app.get('/api/error-log/:address', authenticate, verifyStationAccess, async (req, res) => {
  try {
    let { address } = req.params;
    address = address.replace(/^D/, '');
    const { showCleared } = req.query;

    let query = `SELECT id, customer_code, error_message, cleared, created_at FROM errors WHERE address = ?`;
    const queryParams = [address];
    
    if (showCleared === 'false' || showCleared === '0') {
      query += ' AND cleared = 0';
    }
    
    query += ' ORDER BY created_at DESC LIMIT 100';

    const [errors] = await pool.query(query, queryParams);
    
    const parsedErrors = errors.map(error => {
      try {
        const parsedMessage = error.error_message;
        return {
          id: error.id,
          customer_code: error.customer_code,
          timestamp: error.created_at,
          log_time: new Date(error.created_at).toLocaleString(),
          error_code: parsedMessage.Code || null,
          severity: parsedMessage.Sev || null,
          file: parsedMessage.File || null,
          line: parsedMessage.Line || null,
          function: parsedMessage.Func || null,
          context: parsedMessage.Cntx || null,
          cleared: error.cleared || 0
        };
      } catch (e) {
        return {
          id: error.id,
          customer_code: error.customer_code,
          timestamp: error.created_at,
          log_time: new Date(error.created_at).toLocaleString(),
          cleared: error.cleared || 0
        };
      }
    });
    
    res.json(parsedErrors);
  } catch (error) {
    console.error('Error fetching device errors:', error);
    res.status(500).json({ error: 'Failed to fetch device errors' });
  }
});

app.put('/api/error-log/mark-cleared', authenticate, verifyStationAccess, async (req, res) => {
  try {
    const { errorIds } = req.body;
    
    if (!errorIds || !Array.isArray(errorIds) || errorIds.length === 0) {
      return res.status(400).json({ error: 'errorIds array is required' });
    }
    
    const placeholders = errorIds.map(() => '?').join(',');
    const [result] = await pool.query(`UPDATE errors SET cleared = 1 WHERE id IN (${placeholders})`, errorIds);
    
    res.json({ success: true, message: `${result.affectedRows} error(s) marked as cleared`, affectedRows: result.affectedRows });
  } catch (error) {
    console.error('Error marking errors as cleared:', error);
    res.status(500).json({ error: 'Failed to mark errors as cleared' });
  }
});

app.get('/api/device-info/:address', authenticate, verifyStationAccess, async (req, res) => {
  try {
    let { address } = req.params;
    address = address.replace(/^[A-Za-z]+/, '');
    
    if (!address || !/^\d+$/.test(address)) {
      return res.json(null);
    }
    
    const [deviceInfo] = await pool.query(
      `SELECT customer_code, address, firmware_version, hardware_version, wifi_enable, last_die_time, wakeup_time, created_at
       FROM device_info WHERE address = ? ORDER BY created_at DESC LIMIT 1`,
      [address]
    );
    
    res.json(deviceInfo[0] || null);
  } catch (error) {
    console.error('Error fetching device info:', error);
    res.status(500).json({ error: 'Failed to fetch device information' });
  }
});

// GSM/WiFi/MQTT/Power status endpoints
app.get('/api/gsm-status/:dispenser_addr', authenticate, async (req, res) => {
  try {
    const status = getGsmStatus(req.params.dispenser_addr);
    if (!status) return res.status(404).json({ error: 'GSM status not found' });
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSM status' });
  }
});

app.get('/api/wifi-status/:dispenser_addr', authenticate, async (req, res) => {
  try {
    const status = getWiFiStatus(req.params.dispenser_addr);
    if (!status) return res.status(404).json({ error: 'Wi-Fi status not found' });
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch Wi-Fi status' });
  }
});

app.get('/api/mqtt-status/:dispenser_addr', authenticate, async (req, res) => {
  try {
    const status = getMqttStatus(req.params.dispenser_addr);
    if (!status) return res.status(404).json({ error: 'MQTT status not found' });
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch MQTT status' });
  }
});

app.get('/api/power-status/:dispenser_addr', authenticate, async (req, res) => {
  try {
    const status = getPowerOnStatus(req.params.dispenser_addr);
    let statusArray = status ? (Array.isArray(status) ? status : [status]) : [];
    const clearedIds = clearedResetsCache.get(req.params.dispenser_addr) || new Set();
    const statusWithCleared = statusArray.map(item => ({ ...item, cleared: clearedIds.has(item.id) }));
    res.json(statusWithCleared);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch power-on status' });
  }
});

app.get('/api/cleared-resets/:dispenser_addr', authenticate, async (req, res) => {
  try {
    const clearedIds = clearedResetsCache.get(req.params.dispenser_addr) || new Set();
    res.json({ ids: Array.from(clearedIds) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch cleared resets' });
  }
});

app.put('/api/reset-logs/mark-cleared', authenticate, async (req, res) => {
  try {
    const { dispenserAddress, resetIds } = req.body;
    if (!dispenserAddress || !resetIds || !Array.isArray(resetIds) || resetIds.length === 0) {
      return res.status(400).json({ error: 'dispenserAddress and resetIds array are required' });
    }
    if (!clearedResetsCache.has(dispenserAddress)) {
      clearedResetsCache.set(dispenserAddress, new Set());
    }
    resetIds.forEach(id => clearedResetsCache.get(dispenserAddress).add(id));
    res.json({ success: true, message: `${resetIds.length} reset log(s) marked as cleared` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark resets as cleared' });
  }
});

app.get('/api/gsm-connection-status/:dispenser_addr', authenticate, async (req, res) => {
  try {
    res.json({ status: getGsmConnectionStatus(req.params.dispenser_addr) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSM connection status' });
  }
});

app.get('/api/wifi-connection-status/:dispenser_addr', authenticate, async (req, res) => {
  try {
    res.json({ status: getWifiConnectionStatus(req.params.dispenser_addr) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch WiFi connection status' });
  }
});

// Start server
async function initializeServer() {
  try {
    await startMidnightResetService();
    console.log('Server initialization completed successfully');
  } catch (error) {
    console.error('Server initialization failed:', error);
    process.exit(1);
  }
}

initializeServer().then(() => {
  const PORT = 3001;
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    notificationWebSocketServer = new NotificationWebSocketServer(server);
    notificationService = new NotificationService(notificationWebSocketServer);
    setNotificationService(notificationService);
    console.log('WebSocket notification server initialized');
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});