import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'openxx.db');

let db;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS groups (
    jid TEXT PRIMARY KEY,
    name TEXT,
    welcome_enabled INTEGER DEFAULT 0,
    welcome_message TEXT DEFAULT 'Selamat datang di group! 🎉',
    spam_protection INTEGER DEFAULT 0,
    auto_reply_enabled INTEGER DEFAULT 0,
    muted INTEGER DEFAULT 0,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    chat_id TEXT,
    metadata TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT,
    version TEXT,
    description TEXT,
    entry_path TEXT,
    enabled INTEGER DEFAULT 1,
    permissions TEXT,
    installed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics(event);
  CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics(timestamp);
  CREATE INDEX IF NOT EXISTS idx_conversations_chat_id ON conversations(chat_id);
`;

export async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.exec(SCHEMA);
  saveDB();
  return db;
}

export function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params.map(p => p === undefined ? null : p));
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  db.run(sql, params.map(p => p === undefined ? null : p));
  saveDB();
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params.map(p => p === undefined ? null : p));
  const row = stmt.step() ? stmt.getAsObject() : undefined;
  stmt.free();
  return row;
}

// Groups
export function getGroup(jid) {
  return get('SELECT * FROM groups WHERE jid = ?', [jid]);
}

export function upsertGroup(jid, data) {
  const existing = getGroup(jid);
  if (existing) {
    const fields = Object.keys(data).map(k => `${k} = ?`).join(', ');
    run(`UPDATE groups SET ${fields} WHERE jid = ?`, [...Object.values(data), jid]);
  } else {
    run('INSERT INTO groups (jid, name, created_at) VALUES (?, ?, ?)', [jid, data.name, Date.now()]);
  }
  return getGroup(jid);
}

export function getAllGroups() {
  return all('SELECT * FROM groups');
}

// Analytics
export function trackEvent(event, chatId, metadata) {
  run('INSERT INTO analytics (event, chat_id, metadata, timestamp) VALUES (?, ?, ?, ?)', [event, chatId, metadata ? JSON.stringify(metadata) : null, Date.now()]);
}

export function getStats(since) {
  return all('SELECT event, COUNT(*) as count FROM analytics WHERE timestamp >= ? GROUP BY event', [since]);
}

// Plugins
export function getPlugin(id) {
  return get('SELECT * FROM plugins WHERE id = ?', [id]);
}

export function savePlugin(plugin) {
  const existing = getPlugin(plugin.id);
  if (existing) {
    run('UPDATE plugins SET name = ?, version = ?, description = ?, entry_path = ?, enabled = ?, permissions = ? WHERE id = ?', [plugin.name, plugin.version, plugin.description, plugin.entry_path, plugin.enabled ?? 1, plugin.permissions, plugin.id]);
  } else {
    run('INSERT INTO plugins (id, name, version, description, entry_path, enabled, permissions, installed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [plugin.id, plugin.name, plugin.version, plugin.description, plugin.entry_path, plugin.enabled ?? 1, plugin.permissions, Date.now()]);
  }
}

export function removePlugin(id) {
  run('DELETE FROM plugins WHERE id = ?', [id]);
}

export function listPlugins() {
  return all('SELECT * FROM plugins');
}

// Conversations
export function saveConversation(chatId, role, content) {
  run('INSERT INTO conversations (chat_id, role, content, timestamp) VALUES (?, ?, ?, ?)', [chatId, role, content, Date.now()]);
}

export function getConversations(chatId, limit = 50) {
  return all('SELECT * FROM conversations WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?', [chatId, limit]);
}

export function clearConversations(chatId) {
  run('DELETE FROM conversations WHERE chat_id = ?', [chatId]);
}

export { db };
