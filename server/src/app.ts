import { createServer, type Server } from 'node:http';
import type { ServerConfig } from './config';
import type { Ctx } from './context';
import { openDb, type Db } from './db';
import { Router } from './http';
import { registerArena } from './services/arena';
import { registerAuth, resolveToken } from './services/auth';
import { registerPay } from './services/pay';
import { registerReport } from './services/report';
import { registerSave } from './services/save';
import { registerTrack } from './services/track';
import { WxApi, type FetchLike } from './wx';

export interface AppDeps {
  db?: Db;
  fetch?: FetchLike;
  now?: () => number;
}

export function createApp(cfg: ServerConfig, deps: AppDeps = {}): { server: Server; ctx: Ctx } {
  const now = deps.now ?? Date.now;
  const db = deps.db ?? openDb(cfg.dbPath);
  const ctx: Ctx = { cfg, db, wx: new WxApi(cfg, deps.fetch, now), now };
  const router = new Router((token) => resolveToken(ctx, token), cfg.corsOrigins);
  registerAuth(router, ctx);
  registerSave(router, ctx);
  registerArena(router, ctx);
  registerPay(router, ctx);
  registerTrack(router, ctx);
  registerReport(router, ctx);
  const server = createServer((req, res) => void router.handle(req, res));
  return { server, ctx };
}
