import type { Ctx } from '../context';
import { HttpError, type Router } from '../http';

const MAX_EVENTS = 200;
const NAME_RE = /^[a-z_][a-z0-9_]{0,48}$/;

export function registerTrack(router: Router, ctx: Ctx): void {
  router.post('/api/track', (req) => {
    const events = req.body?.events;
    if (!Array.isArray(events) || events.length === 0) throw new HttpError(400, 'bad_param', 'events');
    if (events.length > MAX_EVENTS) throw new HttpError(413, 'too_many_events');
    const now = ctx.now();
    const stmt = ctx.db.prepare('INSERT INTO events (user_id, session, name, t, props, received_at) VALUES (?, ?, ?, ?, ?, ?)');
    let accepted = 0;
    ctx.db.exec('BEGIN');
    try {
      for (const e of events) {
        if (!e || typeof e.name !== 'string' || !NAME_RE.test(e.name)) continue;
        const t = Number(e.t);
        const props = e.props && typeof e.props === 'object' ? JSON.stringify(e.props) : '{}';
        if (props.length > 8000) continue;
        stmt.run(req.userId, String(e.session ?? '').slice(0, 64), e.name, Number.isFinite(t) ? t : now, props, now);
        accepted++;
      }
      ctx.db.exec('COMMIT');
    } catch (err) {
      ctx.db.exec('ROLLBACK');
      throw err;
    }
    return { json: { accepted } };
  });
}
