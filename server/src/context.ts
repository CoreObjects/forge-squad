import { randomBytes } from 'node:crypto';
import type { ServerConfig } from './config';
import type { Db } from './db';
import type { WxApi } from './wx';

export interface Ctx {
  cfg: ServerConfig;
  db: Db;
  wx: WxApi;
  now: () => number;
}

export interface UserRow {
  id: number;
  openid: string | null;
  dev_id: string | null;
  session_key: string | null;
  nickname: string;
  is_test: number;
  created_at: number;
  last_seen: number;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function getUser(ctx: Ctx, id: number): UserRow {
  return ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
}

/** 按时区偏移算“自然日” */
export function serverDay(ctx: Ctx, t = ctx.now()): string {
  return new Date(t + ctx.cfg.tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function displayName(user: Pick<UserRow, 'id' | 'nickname'>): string {
  return user.nickname || `玩家${String(user.id).padStart(5, '0')}`;
}
