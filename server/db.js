import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'duniyaguessr.db')

let db = null
let saveTimeout = null

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout)
  saveTimeout = setTimeout(() => {
    if (!db) return
    try {
      const data = db.export()
      fs.writeFileSync(DB_PATH, Buffer.from(data))
    } catch (err) {
      console.error('DB save error:', err)
    }
    saveTimeout = null
  }, 2000)
}

function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}

export async function initDb() {
  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    games_played INTEGER DEFAULT 0,
    total_score REAL DEFAULT 0
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS game_sessions (
    id TEXT PRIMARY KEY,
    room_code TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'waiting',
    created_at TEXT DEFAULT (datetime('now'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS game_players (
    game_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    score REAL DEFAULT 0,
    PRIMARY KEY (game_id, profile_id),
    FOREIGN KEY (game_id) REFERENCES game_sessions(id),
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS location_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    country_code TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    used_count INTEGER DEFAULT 0
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    location_lat REAL NOT NULL,
    location_lng REAL NOT NULL,
    guess_lat REAL,
    guess_lng REAL,
    player_id TEXT NOT NULL,
    score REAL,
    FOREIGN KEY (game_id) REFERENCES game_sessions(id),
    FOREIGN KEY (player_id) REFERENCES profiles(id)
  )`)

  // Clean up stale waiting rooms older than 24 hours
  db.run(`DELETE FROM game_sessions WHERE status = 'waiting' AND created_at < datetime('now', '-1 day')`)
  // Clean up orphaned game_players and rounds for deleted sessions
  db.run(`DELETE FROM game_players WHERE game_id NOT IN (SELECT id FROM game_sessions)`)
  db.run(`DELETE FROM rounds WHERE game_id NOT IN (SELECT id FROM game_sessions)`)

  scheduleSave()
  return db
}

export function run(sql, params = []) {
  getDb().run(sql, params)
  scheduleSave()
}

export function get(sql, params = []) {
  const stmt = getDb().prepare(sql)
  if (params.length > 0) stmt.bind(params)
  if (stmt.step()) {
    const obj = stmt.getAsObject()
    stmt.free()
    return obj
  }
  stmt.free()
  return undefined
}

export function all(sql, params = []) {
  const stmt = getDb().prepare(sql)
  if (params.length > 0) stmt.bind(params)
  const results = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}
