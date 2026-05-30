const db = require('../database/db');

async function create(level, event, details) {
  try {
    await db.query('INSERT INTO logs (level, event, details) VALUES (?, ?, ?)', [level, event, details || '']);
  } catch (error) {
    console.warn('Log write failed:', error.message);
  }
}

async function list(limit = 100) {
  try {
    return db.query(`SELECT * FROM logs ORDER BY created_at DESC LIMIT ${Number(limit || 100)}`);
  } catch (error) {
    console.warn('Log read failed:', error.message);
    return [];
  }
}

module.exports = {
  create,
  list
};
