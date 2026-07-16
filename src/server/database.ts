import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');

const USAGE_HISTORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_5m_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_1h_tokens INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  key_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_history_unique ON usage_history(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_history_created_at ON usage_history(created_at DESC);
`;

class ConnectionManager {
  private accountsDb: Database.Database;
  private cache = new Map<string, Database.Database>();

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.accountsDb = new Database(path.join(DATA_DIR, 'accounts.db'));
    this.accountsDb.pragma('journal_mode = WAL');
    this.accountsDb.pragma('foreign_keys = ON');
  }

  getDb(workspaceId?: string): Database.Database {
    if (!workspaceId) return this.accountsDb;
    const dbPath = path.join(DATA_DIR, `${workspaceId}.db`);
    if (this.cache.has(dbPath)) return this.cache.get(dbPath)!;
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(USAGE_HISTORY_SCHEMA);
    this.cache.set(dbPath, db);
    return db;
  }

  closeDb(workspaceId?: string): void {
    if (!workspaceId) {
      for (const db of this.cache.values()) db.close();
      this.cache.clear();
      return;
    }
    const dbPath = path.join(DATA_DIR, `${workspaceId}.db`);
    const db = this.cache.get(dbPath);
    if (db) {
      db.close();
      this.cache.delete(dbPath);
    }
  }

  closeAll(): void {
    this.closeDb();
    this.accountsDb.close();
  }
}

let manager: ConnectionManager | null = null;

export function getDb(workspaceId?: string): Database.Database {
  if (!manager) manager = new ConnectionManager();
  return manager.getDb(workspaceId);
}

export function closeDb(workspaceId?: string): void {
  if (!workspaceId) manager?.closeAll();
  else manager?.closeDb(workspaceId);
}
