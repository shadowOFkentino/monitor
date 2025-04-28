# Mining Monitor: Deployment & Configuration Guide

This guide will walk you through setting up the complete mining monitoring system with historical data tracking.

## System Architecture

The system consists of:

1. **Database** - SQLite database to store historical mining data
2. **Data Collector** - Node.js script that fetches and stores data periodically
3. **API Server** - Express server that provides access to the historical data
4. **Dashboard** - Enhanced HTML/JS dashboard with charts and statistics

## Prerequisites

- Node.js v14+ installed
- npm package manager
- A web server (Apache, Nginx, or similar) for hosting the dashboard
- A system for running cron jobs or scheduled tasks

## Setup Instructions

### 1. Set up the Database

```bash
# Create a project directory
mkdir miner-monitor
cd miner-monitor

# Create a database directory
mkdir data

# Initialize the database with the schema
sqlite3 data/miner_history.db < db-schema.sql
```

### 2. Install the Data Collector

```bash
# Install required Node.js packages
npm init -y
npm install node-fetch sqlite3 cron

# Copy the data_collector.js file to your project directory
cp /path/to/data_collector.js ./

# Create a script to run the collector as a service
cat > start-collector.sh << 'EOF'
#!/bin/bash
node data_collector.js >> collector.log 2>&1 &
echo $! > collector.pid
EOF

chmod +x start-collector.sh
```

### 3. Set up the API Server

```bash
# Install additional required packages
npm install express cors

# Copy the api_server.js file to your project directory
cp /path/to/api_server.js ./

# Create a script to run the API server as a service
cat > start-api.sh << 'EOF'
#!/bin/bash
node api_server.js >> api.log 2>&1 &
echo $! > api.pid
EOF

chmod +x start-api.sh
```

### 4. Configure the Dashboard

```bash
# Create a public directory for the dashboard
mkdir -p public

# Copy the enhanced dashboard HTML to the public directory
cp /path/to/enhanced-dashboard.html public/index.html

# Modify the API endpoint in index.html
# Find this line: const API_BASE_URL = 'http://localhost:3000/api';
# Change it to your API server's address
```

### 5. Start the Services

```bash
# Start the data collector
./start-collector.sh

# Start the API server
./start-api.sh
```

### 6. Set up Automatic Service Restart

Create a crontab entry to ensure the services restart after a system reboot:

```bash
crontab -e
```

Add these lines:

```
@reboot cd /path/to/miner-monitor && ./start-collector.sh
@reboot cd /path/to/miner-monitor && ./start-api.sh
```

## Configuration Options

### Data Collector (data_collector.js)

Edit the CONFIG object at the top of the file:

```javascript
const CONFIG = {
  apiUrls: {
    btc: 'https://api.emcd.io/v1/btc/workers/YOUR-API-KEY',
    kas: 'https://api.emcd.io/v1/kas/workers/YOUR-API-KEY'
  },
  dbPath: path.join(__dirname, 'data/miner_history.db'),
  collectInterval: 15 * 60 * 1000, // 15 minutes in milliseconds
  retentionPeriod: 90 // days to keep detailed data
};
```

Adjust:
- `apiUrls`: Your pool's API endpoint
- `collectInterval`: How often to collect data (in milliseconds)
- `retentionPeriod`: How long to keep detailed data before cleanup

### API Server (api_server.js)

Edit the top of the file:

```javascript
const port = process.env.PORT || 3000;
const dbPath = path.join(__dirname, 'data/miner_history.db');
```

Adjust:
- `port`: The port the API server will run on
- `dbPath`: Path to your SQLite database

## Troubleshooting

### Data Collector Issues

Check the collector log file:

```bash
tail -f collector.log
```

Common issues:
- API connection errors: Check your API URLs and internet connection
- Database errors: Ensure the database file exists and has correct permissions

### API Server Issues

Check the API server log file:

```bash
tail -f api.log
```

Common issues:
- Port conflicts: Change the port in api_server.js if port 3000 is already in use
- Database errors: Ensure the database file exists and has correct permissions

### Dashboard Issues

- **Charts not loading**: Open browser developer tools (F12) and check the console for errors
- **No data in charts**: Verify the API server is running and accessible
- **API connection errors**: Check if the API_BASE_URL is correctly set in the dashboard HTML

## Advanced Configuration

### Setting up HTTPS

For production use, it's recommended to secure your API server with HTTPS:

1. Generate SSL certificates with Let's Encrypt
2. Configure your web server (Nginx/Apache) as a reverse proxy to your API server
3. Update the dashboard's API_BASE_URL to use https://

### Using a Production Database

For larger deployments, consider replacing SQLite with a production database:

1. Install PostgreSQL or MySQL
2. Adapt the database schema for your chosen database
3. Update the database connection code in data_collector.js and api_server.js

### Docker Deployment

For containerized deployment, create a Dockerfile and docker-compose.yml:

```dockerfile
# Dockerfile
FROM node:14-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "api_server.js"]
```

```yaml
# docker-compose.yml
version: '3'
services:
  api:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    restart: always
  
  collector:
    build: .
    command: node data_collector.js
    volumes:
      - ./data:/app/data
    restart: always
```

## Regular Maintenance

1. **Backup your database** regularly:
   ```bash
   sqlite3 data/miner_history.db .dump > backup_$(date +%Y%m%d).sql
   ```

2. **Monitor disk space** as the database grows:
   ```bash
   du -h data/miner_history.db
   ```

3. **Check logs** for any errors:
   ```bash
   grep ERROR collector.log
   grep ERROR api.log
   ```
