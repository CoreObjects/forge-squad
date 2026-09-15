import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openid TEXT UNIQUE,
  dev_id TEXT UNIQUE,
  session_key TEXT,
  nickname TEXT NOT NULL DEFAULT '',
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS saves (
  user_id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS arena_players (
  user_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  power INTEGER NOT NULL,
  score INTEGER NOT NULL,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  is_test INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_arena_power ON arena_players(is_test, power);
CREATE INDEX IF NOT EXISTS idx_arena_score ON arena_players(score);
CREATE TABLE IF NOT EXISTS arena_attempts (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS arena_offers (
  user_id INTEGER PRIMARY KEY,
  offers TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS arena_battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attacker INTEGER NOT NULL,
  defender INTEGER NOT NULL,
  tier TEXT NOT NULL,
  seed INTEGER NOT NULL,
  win INTEGER NOT NULL,
  score_delta INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  out_trade_no TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  product_id TEXT NOT NULL,
  price_fen INTEGER NOT NULL,
  status TEXT NOT NULL,
  channel TEXT NOT NULL,
  wx_transaction_id TEXT,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  delivered_at INTEGER,
  acked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, status);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session TEXT NOT NULL,
  name TEXT NOT NULL,
  t INTEGER NOT NULL,
  props TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, t);
CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, t);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// node:sqlite 返回的行是 null-prototype 对象，这里统一成普通类型
export function row<T>(v: unknown): T | undefined {
  return (v ?? undefined) as T | undefined;
}
