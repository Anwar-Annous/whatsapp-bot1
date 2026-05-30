const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  port: process.env.PORT || 4000,
  sessionSecret: process.env.SESSION_SECRET || 'crm-secret-key',
  authUser: {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'whatsappcrm',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  },
  whatsapp: {
    sessionDir: path.join(__dirname, '..', 'backend', 'session'),
    puppeteer: {
      headless: false,
      executablePath: process.env.CHROME_PATH || detectChromePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  }
};

function detectChromePath() {
  const defaultPaths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ];

  for (const chromePath of defaultPaths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  return undefined;
}
