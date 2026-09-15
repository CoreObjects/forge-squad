import { wxLoginConfigured } from '../config';
import { displayName, getUser, newToken, type Ctx, type UserRow } from '../context';
import { HttpError, requireString, type Router } from '../http';

const DAY = 86_400_000;

export function resolveToken(ctx: Ctx, token: string): number | null {
  const s = ctx.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as { user_id: number; expires_at: number } | undefined;
  if (!s || s.expires_at < ctx.now()) return null;
  return s.user_id;
}

function issueSession(ctx: Ctx, userId: number): { token: string; expiresAt: number } {
  const token = newToken();
  const now = ctx.now();
  const expiresAt = now + ctx.cfg.sessionTtlDays * DAY;
  ctx.db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(token, userId, now, expiresAt);
  ctx.db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(userId, now);
  ctx.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userId);
  return { token, expiresAt };
}

function loginResponse(ctx: Ctx, user: UserRow, isNew: boolean) {
  const s = issueSession(ctx, user.id);
  return { json: { token: s.token, expiresAt: s.expiresAt, userId: user.id, name: displayName(user), isNew } };
}

export function registerAuth(router: Router, ctx: Ctx): void {
  router.post(
    '/api/auth/wx-login',
    async (req) => {
      if (!wxLoginConfigured(ctx.cfg)) throw new HttpError(503, 'wx_not_configured');
      const code = requireString(req.body?.code, 'code');
      const sess = await ctx.wx.code2Session(code);
      const now = ctx.now();
      let user = ctx.db.prepare('SELECT * FROM users WHERE openid = ?').get(sess.openid) as unknown as UserRow | undefined;
      const isNew = !user;
      if (!user) {
        const r = ctx.db.prepare('INSERT INTO users (openid, session_key, created_at, last_seen) VALUES (?, ?, ?, ?)').run(sess.openid, sess.session_key, now, now);
        user = getUser(ctx, Number(r.lastInsertRowid));
      } else {
        ctx.db.prepare('UPDATE users SET session_key = ? WHERE id = ?').run(sess.session_key, user.id);
      }
      return loginResponse(ctx, user, isNew);
    },
    false,
  );

  router.post(
    '/api/auth/dev-login',
    (req) => {
      if (!ctx.cfg.devLogin) throw new HttpError(403, 'dev_login_disabled');
      const deviceId = requireString(req.body?.deviceId, 'deviceId', 64);
      const now = ctx.now();
      let user = ctx.db.prepare('SELECT * FROM users WHERE dev_id = ?').get(deviceId) as unknown as UserRow | undefined;
      const isNew = !user;
      if (!user) {
        const r = ctx.db.prepare('INSERT INTO users (dev_id, created_at, last_seen) VALUES (?, ?, ?)').run(deviceId, now, now);
        user = getUser(ctx, Number(r.lastInsertRowid));
      }
      if (user.is_test) throw new HttpError(403, 'reserved_account');
      return loginResponse(ctx, user, isNew);
    },
    false,
  );

  router.get('/api/me', (req) => {
    const u = getUser(ctx, req.userId);
    return { json: { userId: u.id, name: displayName(u), createdAt: u.created_at, wx: !!u.openid } };
  });

  router.get(
    '/api/health',
    () => ({ json: { ok: true, wxLogin: wxLoginConfigured(ctx.cfg), devLogin: ctx.cfg.devLogin, devPay: ctx.cfg.devPay } }),
    false,
  );
}
