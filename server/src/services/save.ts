import type { Ctx } from '../context';
import { HttpError, type Router } from '../http';

const MAX_SAVE = 512 * 1024;

interface SaveRow {
  version: number;
  data: string;
  updated_at: number;
}

/** 云存档：乐观并发（baseVersion 必须等于服务端当前版本）。 */
export function registerSave(router: Router, ctx: Ctx): void {
  router.get('/api/save', (req) => {
    const r = ctx.db.prepare('SELECT version, data, updated_at FROM saves WHERE user_id = ?').get(req.userId) as SaveRow | undefined;
    return { json: r ? { version: r.version, data: r.data, updatedAt: r.updated_at } : { version: 0, data: null, updatedAt: 0 } };
  });

  router.put('/api/save', (req) => {
    const data = req.body?.data;
    const baseVersion = Number(req.body?.baseVersion ?? -1);
    if (typeof data !== 'string' || data.length === 0) throw new HttpError(400, 'bad_param', 'data');
    if (data.length > MAX_SAVE) throw new HttpError(413, 'save_too_large');
    try {
      JSON.parse(data);
    } catch {
      throw new HttpError(400, 'bad_save');
    }
    const cur = ctx.db.prepare('SELECT version, data, updated_at FROM saves WHERE user_id = ?').get(req.userId) as SaveRow | undefined;
    const curVersion = cur ? cur.version : 0;
    if (baseVersion !== curVersion) {
      return { status: 409, json: { error: 'version_conflict', version: curVersion, data: cur?.data ?? null, updatedAt: cur?.updated_at ?? 0 } };
    }
    const now = ctx.now();
    const next = curVersion + 1;
    if (cur) ctx.db.prepare('UPDATE saves SET version = ?, data = ?, updated_at = ? WHERE user_id = ? AND version = ?').run(next, data, now, req.userId, curVersion);
    else ctx.db.prepare('INSERT INTO saves (user_id, version, data, updated_at) VALUES (?, ?, ?, ?)').run(req.userId, next, data, now);
    return { json: { version: next, updatedAt: now } };
  });
}
