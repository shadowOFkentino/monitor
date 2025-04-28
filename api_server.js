// api_server.js - Simple Express server to provide access to mining history data
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Connect to SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'miner_history.db'), (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log('Connected to the miner history database');
});

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Route to get all workers
app.get('/api/workers', (req, res) => {
  const coin = req.query.coin || 'btc';
  
  const query = `
    SELECT DISTINCT worker_name 
    FROM miner_readings 
    WHERE coin_type = ? 
    ORDER BY worker_name
  `;
  
  db.all(query, [coin], (err, rows) => {
    if (err) {
      console.error('Error querying workers:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    const workers = rows.map(row => row.worker_name);
    res.json({ workers });
  });
});

// Route to get all racks
app.get('/api/racks', (req, res) => {
  const coin = req.query.coin || 'btc';
  
  const query = `
    SELECT DISTINCT rack 
    FROM miner_readings 
    WHERE coin_type = ? AND rack IS NOT NULL
    ORDER BY rack
  `;
  
  db.all(query, [coin], (err, rows) => {
    if (err) {
      console.error('Error querying racks:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    const racks = rows.map(row => row.rack);
    res.json({ racks });
  });
});

// Route to get historical hashrate data
app.get('/api/history/hashrate', (req, res) => {
  const { coin, worker, rack, start_date, end_date, interval } = req.query;
  
  // Validate parameters
  if (!coin) {
    return res.status(400).json({ error: 'Coin parameter is required' });
  }
  
  // Convert dates to timestamps
  const startTimestamp = start_date ? Math.floor(new Date(start_date).getTime() / 1000) : Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
  const endTimestamp = end_date ? Math.floor(new Date(end_date).getTime() / 1000) : Math.floor(Date.now() / 1000);
  
  // Determine grouping interval (hourly, daily)
  const timeGrouping = interval === 'hour' ? 
    "strftime('%Y-%m-%d %H:00', datetime(timestamp, 'unixepoch'))" : 
    "strftime('%Y-%m-%d', datetime(timestamp, 'unixepoch'))";
  
  let query, params;
  
  // Query for a specific worker
  if (worker && worker !== 'all') {
    query = `
      SELECT 
        ${timeGrouping} as time_period,
        AVG(hashrate) as avg_hashrate,
        AVG(hashrate_1h) as avg_hashrate_1h,
        AVG(hashrate_24h) as avg_hashrate_24h,
        COUNT(CASE WHEN status = 'active' THEN 1 END) * 100.0 / COUNT(*) as uptime_percentage
      FROM miner_readings
      WHERE coin_type = ? AND worker_name = ? AND timestamp BETWEEN ? AND ?
      GROUP BY time_period
      ORDER BY time_period
    `;
    params = [coin, worker, startTimestamp, endTimestamp];
  }
  // Query for a specific rack
  else if (rack && rack !== 'all') {
    query = `
      SELECT 
        ${timeGrouping} as time_period,
        AVG(hashrate) as avg_hashrate,
        AVG(hashrate_1h) as avg_hashrate_1h,
        AVG(hashrate_24h) as avg_hashrate_24h,
        COUNT(CASE WHEN status = 'active' THEN 1 END) * 100.0 / COUNT(*) as uptime_percentage
      FROM miner_readings
      WHERE coin_type = ? AND rack = ? AND timestamp BETWEEN ? AND ?
      GROUP BY time_period
      ORDER BY time_period
    `;
    params = [coin, rack, startTimestamp, endTimestamp];
  }
  // Query for all miners
  else {
    query = `
      SELECT 
        ${timeGrouping} as time_period,
        AVG(hashrate) as avg_hashrate,
        AVG(hashrate_1h) as avg_hashrate_1h,
        AVG(hashrate_24h) as avg_hashrate_24h,
        COUNT(CASE WHEN status = 'active' THEN 1 END) * 100.0 / COUNT(*) as uptime_percentage
      FROM miner_readings
      WHERE coin_type = ? AND timestamp BETWEEN ? AND ?
      GROUP BY time_period
      ORDER BY time_period
    `;
    params = [coin, startTimestamp, endTimestamp];
  }
  
  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error querying hashrate history:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.json({
      data: rows.map(row => ({
        time_period: row.time_period,
        avg_hashrate: row.avg_hashrate / (coin === 'btc' ? 1e12 : 1e9), // Convert to TH/s or GH/s
        avg_hashrate_1h: row.avg_hashrate_1h / (coin === 'btc' ? 1e12 : 1e9),
        avg_hashrate_24h: row.avg_hashrate_24h / (coin === 'btc' ? 1e12 : 1e9),
        uptime_percentage: row.uptime_percentage
      }))
    });
  });
});

// Route to get miner statistics
app.get('/api/stats/miners', (req, res) => {
  const { coin, period } = req.query;
  
  // Validate parameters
  if (!coin) {
    return res.status(400).json({ error: 'Coin parameter is required' });
  }
  
  // Calculate start timestamp based on period
  let startTimestamp;
  const endTimestamp = Math.floor(Date.now() / 1000);
  
  switch(period) {
    case 'day':
      startTimestamp = endTimestamp - (24 * 60 * 60);
      break;
    case 'week':
      startTimestamp = endTimestamp - (7 * 24 * 60 * 60);
      break;
    case 'month':
    default:
      startTimestamp = endTimestamp - (30 * 24 * 60 * 60);
      break;
  }
  
  const query = `
    SELECT 
      worker_name,
      AVG(hashrate) as avg_hashrate,
      MAX(hashrate) as max_hashrate,
      MIN(CASE WHEN hashrate > 0 THEN hashrate ELSE NULL END) as min_hashrate,
      COUNT(CASE WHEN status = 'active' THEN 1 END) * 100.0 / COUNT(*) as uptime_percentage,
      (COUNT(*) - COUNT(CASE WHEN status = 'active' THEN 1 END)) * 15 / 60.0 as downtime_hours,
      AVG(reject_rate) as avg_reject_rate
    FROM miner_readings
    WHERE coin_type = ? AND timestamp BETWEEN ? AND ?
    GROUP BY worker_name
    ORDER BY avg_hashrate DESC
  `;
  
  db.all(query, [coin, startTimestamp, endTimestamp], (err, rows) => {
    if (err) {
      console.error('Error querying miner stats:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.json({
      data: rows.map(row => ({
        name: row.worker_name,
        avg_hashrate: row.avg_hashrate / (coin === 'btc' ? 1e12 : 1e9),
        max_hashrate: row.max_hashrate / (coin === 'btc' ? 1e12 : 1e9),
        min_hashrate: row.min_hashrate ? row.min_hashrate / (coin === 'btc' ? 1e12 : 1e9) : 0,
        uptime_percentage: row.uptime_percentage,
        downtime_hours: row.downtime_hours,
        reject_rate: row.avg_reject_rate
      }))
    });
  });
});

// Route to get rack statistics
app.get('/api/stats/racks', (req, res) => {
  const { coin, period } = req.query;
  
  // Validate parameters
  if (!coin) {
    return res.status(400).json({ error: 'Coin parameter is required' });
  }
  
  // Calculate start timestamp based on period
  let startTimestamp;
  const endTimestamp = Math.floor(Date.now() / 1000);
  
  switch(period) {
    case 'day':
      startTimestamp = endTimestamp - (24 * 60 * 60);
      break;
    case 'week':
      startTimestamp = endTimestamp - (7 * 24 * 60 * 60);
      break;
    case 'month':
    default:
      startTimestamp = endTimestamp - (30 * 24 * 60 * 60);
      break;
  }
  
  const query = `
    SELECT 
      rack,
      AVG(hashrate) as avg_hashrate,
      COUNT(DISTINCT worker_name) as worker_count,
      COUNT(DISTINCT CASE WHEN status = 'active' THEN worker_name END) as active_worker_count,
      COUNT(DISTINCT CASE WHEN status = 'active' THEN worker_name END) * 100.0 / 
        COUNT(DISTINCT worker_name) as efficiency_percentage
    FROM miner_readings
    WHERE coin_type = ? AND timestamp BETWEEN ? AND ? AND rack IS NOT NULL
    GROUP BY rack
    ORDER BY avg_hashrate DESC
  `;
  
  db.all(query, [coin, startTimestamp, endTimestamp], (err, rows) => {
    if (err) {
      console.error('Error querying rack stats:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    
    res.json({
      data: rows.map(row => ({
        name: row.rack,
        avg_hashrate: (row.avg_hashrate * row.worker_count) / (coin === 'btc' ? 1e12 : 1e9),
        worker_count: row.worker_count,
        active_worker_count: row.active_worker_count,
        efficiency_percentage: row.efficiency_percentage
      }))
    });
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Mining history API server running on port ${port}`);
});

// Handle application shutdown
process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});
