const path = require('path');
const express = require('express');
const session = require('express-session');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const config = require('./config');
const db = require('./database/db');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const mediaRoutes = require('./routes/media');
const whatsappService = require('./services/whatsappService');
const { ensureLoggedIn } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'uploads')));

app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.use('/api/auth', authRoutes);
app.use('/api', ensureLoggedIn, apiRoutes);
app.use('/api/media', ensureLoggedIn, mediaRoutes);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'login.html')));
app.get('/dashboard', ensureLoggedIn, (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'dashboard.html')));
app.get('/qr', ensureLoggedIn, (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'pages', 'qr.html')));

io.on('connection', (socket) => {
  whatsappService.registerSocket(socket);
});

async function ignoreDuplicateColumn(sql) {
  try {
    await db.query(sql);
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}

async function ensureRuntimeSchema() {
  await ignoreDuplicateColumn("ALTER TABLE automations ADD COLUMN trigger_mode ENUM('first_message','every_message','cooldown') DEFAULT 'first_message' AFTER cooldown_hours");
  await ignoreDuplicateColumn('ALTER TABLE conversations ADD COLUMN automation_last_run_at DATETIME AFTER last_at');
}

server.listen(config.port, async () => {
  console.log(`Server running on http://localhost:${config.port}`);
  await ensureRuntimeSchema();
  await db.query(`
    CREATE TABLE IF NOT EXISTS scheduled_messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      chat_id VARCHAR(128) NOT NULL,
      type ENUM('text','image','audio') NOT NULL,
      text TEXT,
      media_id INT,
      scheduled_at DATETIME NOT NULL,
      status ENUM('pending','sent','failed') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  await whatsappService.initialize(io);
});

process.on('SIGINT', () => {
  console.log('Stopping server...');
  process.exit();
});
