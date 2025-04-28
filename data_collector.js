// data_collector.js - Script to fetch mining data and store in database
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const path = require('path');

// Configuration
const CONFIG = {
  apiUrls: {
    btc: 'https://api.emcd.io/v1/btc/workers/4418bd07-5506-4901-bd7b-e38c6a507a8c',
    kas: 'https://api.emcd.io/v1/kas/workers/4418bd07-5506-4901-bd7b-e38c6a507a8c'
  },
  dbPath: path.join(__dirname, 'miner_history.db'),
  collectInterval: 15 * 60 * 1000, // 15 minutes in milliseconds
  retentionPeriod: 90 // days to keep detailed data
};

// Connect to database
const db = new sqlite3.Database(CONFIG.dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    process.exit(1);
  }
  console.log('Connected to the miner history database');
});

// Function to determine rack name from worker name
function getRackName(workerName) {
  // Handle C001 and C002 prefixes - direct prefix
  if (workerName.startsWith('C001_')) {
    return 'C001';
  }
  if (workerName.startsWith('C002_')) {
    return 'C002';
  }
  
  // Handle Oneminers format with C002 in the name
  if (workerName.includes('C002_') || workerName.match(/Oneminers\d+_C002/)) {
    return 'C002';
  }
  
  // Handle Oneminers format with C001 in the name
  if (workerName.includes('C001_') || workerName.match(/Oneminers\d+_C001/)) {
    return 'C001';
  }
  
  // Handle traditional rack naming: CH_XX, B_XX, etc.
  if (workerName.includes('_')) {
    const [first, second] = workerName.split('_');

    if (['CH', 'B', 'C', 'D', 'E', 'F'].includes(first)) {
      return first;
    }
    
    if (first === 'K' && ['01','02','03'].includes(second)) {
      return `${first}_${second}`;
    }
  }
  
  // Also check if it starts with CH, B, etc. without underscore
  if (workerName.startsWith('CH') || 
      workerName.startsWith('B') || 
      workerName.startsWith('C') || 
      workerName.startsWith('D') || 
      workerName.startsWith('E') || 
      workerName.startsWith('F')) {
    return workerName.substring(0, workerName.startsWith('CH') ? 2 : 1);
  }
  
  return 'others';
}

// Function to fetch and store data for a coin type
async function fetchAndStoreData(coinType) {
  try {
    console.log(`Fetching ${coinType.toUpperCase()} data...`);
    const response = await fetch(CONFIG.apiUrls[coinType]);
    const data = await response.json();
    
    if (!data.details || !Array.isArray(data.details)) {
      console.error(`Invalid response format for ${coinType}:`, data);
      return;
    }
    
    const timestamp = Math.floor(Date.now() / 1000); // Current Unix timestamp
    const workers = data.details;
    
    // Start a transaction for better performance with multiple inserts
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      const insertStmt = db.prepare(`
        INSERT INTO miner_readings 
        (timestamp, worker_name, hashrate, hashrate_1h, hashrate_24h, reject_rate, status, coin_type, rack) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      workers.forEach(worker => {
        const status = worker.new_status.toLowerCase();
        const rack = getRackName(worker.worker);
        
        insertStmt.run(
          timestamp,
          worker.worker,
          worker.hashrate || 0,
          worker.hashrate1h || 0,
          worker.hashrate24h || 0,
          worker.reject || 0,
          status,
          coinType,
          rack
        );
      });
      
      insertStmt.finalize();
      db.run('COMMIT', (err) => {
        if (err) console.error('Error committing transaction:', err);
        else console.log(`Successfully stored ${workers.length} ${coinType.toUpperCase()} miners data`);
      });
    });
    
  } catch (error) {
    console.error(`Error fetching or storing ${coinType} data:`, error);
  }
}

// Function to generate daily statistics
async function generateDailyStats() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD format
  
  console.log(`Generating daily statistics for ${dateStr}...`);
  
  // Calculate start and end timestamps for yesterday
  const startOfDay = new Date(dateStr);
  const endOfDay = new Date(dateStr);
  endOfDay.setHours(23, 59, 59, 999);
  
  const startTimestamp = Math.floor(startOfDay.getTime() / 1000);
  const endTimestamp = Math.floor(endOfDay.getTime() / 1000);
  
  // SQL to generate worker stats
  const workerStatsSQL = `
    INSERT OR REPLACE INTO daily_worker_stats
    (date, worker_name, avg_hashrate, max_hashrate, min_hashrate, uptime_percentage, 
     total_downtime_minutes, avg_reject_rate, coin_type)
    SELECT 
      '${dateStr}' as date,
      worker_name,
      AVG(hashrate) as avg_hashrate,
      MAX(hashrate) as max_hashrate,
      MIN(CASE WHEN hashrate > 0 THEN hashrate ELSE NULL END) as min_hashrate,
      (SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as uptime_percentage,
      (COUNT(*) - SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)) * 
        (${CONFIG.collectInterval / 60000}) as total_downtime_minutes,
      AVG(reject_rate) as avg_reject_rate,
      coin_type
    FROM miner_readings
    WHERE timestamp BETWEEN ${startTimestamp} AND ${endTimestamp}
    GROUP BY worker_name, coin_type
  `;
  
  // SQL to generate rack performance stats
  const rackStatsSQL = `
    INSERT OR REPLACE INTO rack_performance
    (date, rack_name, avg_hashrate, worker_count, active_worker_count, 
     efficiency_percentage, coin_type)
    SELECT 
      '${dateStr}' as date,
      rack,
      AVG(hashrate) as avg_hashrate,
      COUNT(DISTINCT worker_name) as worker_count,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) / 
        (COUNT(*) / COUNT(DISTINCT worker_name)) as active_worker_count,
      (SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) * 
        (COUNT(DISTINCT worker_name) / COUNT(*)) as efficiency_percentage,
      coin_type
    FROM miner_readings
    WHERE timestamp BETWEEN ${startTimestamp} AND ${endTimestamp}
    GROUP BY rack, coin_type
  `;
  
  // Execute stats generation
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    db.run(workerStatsSQL, (err) => {
      if (err) console.error('Error generating worker stats:', err);
      else console.log('Daily worker statistics generated');
    });
    
    db.run(rackStatsSQL, (err) => {
      if (err) console.error('Error generating rack stats:', err);
      else console.log('Daily rack statistics generated');
    });
    
    db.run('COMMIT', (err) => {
      if (err) console.error('Error committing stats transaction:', err);
      else console.log('Successfully generated all daily statistics');
    });
  });
}

// Function to clean up old data
function cleanupOldData() {
  const cutoffTimestamp = Math.floor(Date.now() / 1000) - (CONFIG.retentionPeriod * 24 * 60 * 60);
  
  console.log(`Cleaning up data older than ${CONFIG.retentionPeriod} days...`);
  
  db.run(`DELETE FROM miner_readings WHERE timestamp < ${cutoffTimestamp}`, function(err) {
    if (err) {
      console.error('Error cleaning up old data:', err);
    } else {
      console.log(`Deleted ${this.changes} old records`);
    }
  });
}

// Main function to collect data for all coins
async function collectAllData() {
  try {
    // Get current hour to determine if we should run daily stats
    const currentHour = new Date().getHours();
    
    // Fetch data for each coin type
    await fetchAndStoreData('btc');
    await fetchAndStoreData('kas');
    
    // Generate daily stats at 1 AM
    if (currentHour === 1) {
      await generateDailyStats();
      cleanupOldData();
    }
    
    console.log('Data collection completed successfully');
  } catch (error) {
    console.error('Error in data collection process:', error);
  }
}

// Run once immediately
collectAllData();

// Then schedule to run at the specified interval
setInterval(collectAllData, CONFIG.collectInterval);

console.log(`Data collector started. Running every ${CONFIG.collectInterval / 60000} minutes.`);

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
