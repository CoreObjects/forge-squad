import { randomInt } from 'node:crypto';
import { snapshotFighter, type ArenaTier, type DefenseSnapshot } from '../../../src/core/arena';
import { simulatePvp } from '../../../src/core/battle';
import { defaultConfig } from '../../../src/core/config';
import { statsPower } from '../../../src/core/progression';
import { Rng, hashSeed } from '../../../src/core/rng';
import { RUNE_TYPES, type RuneType } from '../../../src/core/types';
import { displayName, getUser, serverDay, type Ctx } from '../context';
import { tx } from '../db';
import { HttpError, requireString, type Router } from '../http';

const gameCfg = defaultConfig();
const TIERS: ArenaTier[] = ['weak', 'close', 'strong'];
/** 各档真实对手的战力区间（相对自己） */
const TIER_RANGE: Record<ArenaTier, [number, number]> = { weak: [0.6, 0.95], close: [0.9, 1.1], strong: [1.05, 1.4] };

interface ArenaRow {
  user_id: number;
  name: string;
  snapshot: string;
  power: number;
  score: number;
  wins: number;
  losses: number;
  is_test: number;
  updated_at: number;
}

interface Offer {
  opponentId: number;
  tier: ArenaTier;
}

const finite = (v: unknown, max = 1e9) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

export function validateSnapshot(s: any): DefenseSnapshot {
  if (!s || typeof s !== 'object') throw new HttpError(400, 'bad_snapshot');
  if (!finite(s.atk) || !finite(s.hp) || s.hp <= 0 || !finite(s.def) || !finite(s.speed, 10000)) throw new HttpError(400, 'bad_snapshot', 'stats');
  if (!Array.isArray(s.chain) || s.chain.length !== 6) throw new HttpError(400, 'bad_snapshot', 'chain');
  const chain = s.chain.map((r: any) => {
    if (r === null) return null;
    if (!r || !RUNE_TYPES.includes(r.type) || !Number.isInteger(r.quality) || r.quality < 0 || r.quality > 5 || !finite(r.strength, 1e7)) {
      throw new HttpError(400, 'bad_snapshot', 'rune');
    }
    return { type: r.type as RuneType, quality: r.quality as number, strength: r.strength as number };
  });
  const stats = { atk: s.atk, hp: s.hp, def: s.def, speed: s.speed };
  return { ...stats, power: statsPower(stats), chain, savedAt: finite(s.savedAt, 1e15) ? s.savedAt : 0 };
}

/** 测试人数不足时的系统测试账号快照（明确标记为测试数据） */
export function testSnapshot(power: number, seed: number): DefenseSnapshot {
  const rng = new Rng(seed);
  const quality = Math.max(0, Math.min(5, Math.floor(Math.log2(Math.max(1, power / 150)))));
  const chain = Array.from({ length: 6 }, () => ({ type: RUNE_TYPES[rng.int(4)], quality, strength: Math.round(power / 12) }));
  const stats = { atk: power * 0.5, hp: power * 5, def: 0, speed: gameCfg.progression.character.speed - 5 };
  return { ...stats, power: statsPower(stats), chain, savedAt: 0 };
}

function publicSnapshot(s: DefenseSnapshot) {
  return { power: s.power, chain: s.chain.map((r) => (r ? { type: r.type, quality: r.quality } : null)) };
}

export function registerArena(router: Router, ctx: Ctx): void {
  const db = ctx.db;
  const ac = gameCfg.economy.arena;

  const player = (userId: number) => db.prepare('SELECT * FROM arena_players WHERE user_id = ?').get(userId) as unknown as ArenaRow | undefined;
  const attemptsUsed = (userId: number) =>
    ((db.prepare('SELECT used FROM arena_attempts WHERE user_id = ? AND day = ?').get(userId, serverDay(ctx)) as { used: number } | undefined)?.used ?? 0);
  const rankOf = (score: number) => 1 + (db.prepare('SELECT COUNT(*) AS n FROM arena_players WHERE score > ?').get(score) as { n: number }).n;

  const ensureTestOpponent = (targetPower: number): ArenaRow => {
    const bucket = Math.max(50, Math.round(targetPower / 10) * 10);
    const devId = `system-test:${bucket}`;
    const now = ctx.now();
    let user = db.prepare('SELECT id FROM users WHERE dev_id = ?').get(devId) as { id: number } | undefined;
    if (!user) {
      const r = db.prepare('INSERT INTO users (dev_id, nickname, is_test, created_at, last_seen) VALUES (?, ?, 1, ?, ?)').run(devId, `测试账号·${bucket}`, now, now);
      user = { id: Number(r.lastInsertRowid) };
    }
    if (!player(user.id)) {
      const snap = testSnapshot(bucket, hashSeed('arena-test', bucket));
      db.prepare('INSERT INTO arena_players (user_id, name, snapshot, power, score, is_test, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
        user.id,
        `测试账号·${bucket}`,
        JSON.stringify(snap),
        snap.power,
        ac.startScore,
        now,
      );
    }
    return player(user.id)!;
  };

  router.put('/api/arena/snapshot', (req) => {
    const snap = validateSnapshot(req.body?.snapshot);
    const user = getUser(ctx, req.userId);
    const now = ctx.now();
    const name = displayName(user);
    if (player(req.userId)) {
      db.prepare('UPDATE arena_players SET snapshot = ?, power = ?, name = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(snap), snap.power, name, now, req.userId);
    } else {
      db.prepare('INSERT INTO arena_players (user_id, name, snapshot, power, score, is_test, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run(
        req.userId,
        name,
        JSON.stringify(snap),
        snap.power,
        ac.startScore,
        now,
      );
    }
    return { json: { power: snap.power } };
  });

  router.get('/api/arena/state', (req) => {
    const p = player(req.userId);
    if (!p) return { json: { registered: false, attemptsLeft: ac.freeAttempts } };
    return {
      json: { registered: true, score: p.score, rank: rankOf(p.score), wins: p.wins, losses: p.losses, power: p.power, attemptsLeft: Math.max(0, ac.freeAttempts - attemptsUsed(req.userId)) },
    };
  });

  router.post('/api/arena/opponents', (req) => {
    const me = player(req.userId);
    if (!me) throw new HttpError(409, 'no_snapshot');
    const used = new Set<number>([req.userId]);
    const offers: Offer[] = [];
    const out = [];
    for (const tier of TIERS) {
      const target = me.power * ac.opponentPowerRatio[tier];
      const [lo, hi] = TIER_RANGE[tier];
      const candidates = db
        .prepare('SELECT * FROM arena_players WHERE is_test = 0 AND power BETWEEN ? AND ? ORDER BY ABS(power - ?) LIMIT 8')
        .all(me.power * lo, me.power * hi, target) as unknown as ArenaRow[];
      const fresh = candidates.filter((c) => !used.has(c.user_id));
      let pick = fresh.length ? fresh[randomInt(Math.min(3, fresh.length))] : undefined;
      if (!pick) {
        pick = ensureTestOpponent(target);
        if (used.has(pick.user_id)) pick = ensureTestOpponent(target * (tier === 'weak' ? 0.9 : 1.1));
      }
      used.add(pick.user_id);
      offers.push({ opponentId: pick.user_id, tier });
      const snap = JSON.parse(pick.snapshot) as DefenseSnapshot;
      out.push({ opponentId: pick.user_id, tier, name: pick.name, score: pick.score, isTestData: !!pick.is_test, ...publicSnapshot(snap) });
    }
    db.prepare('INSERT INTO arena_offers (user_id, offers, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET offers = excluded.offers, created_at = excluded.created_at').run(
      req.userId,
      JSON.stringify(offers),
      ctx.now(),
    );
    return { json: { opponents: out, attemptsLeft: Math.max(0, ac.freeAttempts - attemptsUsed(req.userId)) } };
  });

  router.post('/api/arena/challenge', (req) => {
    const opponentId = Number(requireString(String(req.body?.opponentId ?? ''), 'opponentId', 20));
    return tx(db, () => {
      const me = player(req.userId);
      if (!me) throw new HttpError(409, 'no_snapshot');
      const offerRow = db.prepare('SELECT offers FROM arena_offers WHERE user_id = ?').get(req.userId) as { offers: string } | undefined;
      const offer = offerRow ? (JSON.parse(offerRow.offers) as Offer[]).find((o) => o.opponentId === opponentId) : undefined;
      if (!offer) throw new HttpError(409, 'offer_expired');
      const used = attemptsUsed(req.userId);
      if (used >= ac.freeAttempts) throw new HttpError(429, 'no_attempts');
      const opp = player(opponentId);
      if (!opp) throw new HttpError(404, 'opponent_missing');

      const attacker = JSON.parse(me.snapshot) as DefenseSnapshot;
      const defender = JSON.parse(opp.snapshot) as DefenseSnapshot;
      const seed = randomInt(0, 2 ** 31);
      const result = simulatePvp(gameCfg, snapshotFighter('我', attacker), snapshotFighter(opp.name, defender), seed);
      const scoreDelta = result.win ? ac.winScore[offer.tier] : ac.loseScore;
      const newScore = Math.max(0, me.score + scoreDelta);
      const now = ctx.now();
      db.prepare('UPDATE arena_players SET score = ?, wins = wins + ?, losses = losses + ?, updated_at = ? WHERE user_id = ?').run(
        newScore,
        result.win ? 1 : 0,
        result.win ? 0 : 1,
        now,
        req.userId,
      );
      db.prepare('INSERT INTO arena_attempts (user_id, day, used) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET used = used + 1').run(req.userId, serverDay(ctx));
      db.prepare('INSERT INTO arena_battles (attacker, defender, tier, seed, win, score_delta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        req.userId,
        opponentId,
        offer.tier,
        seed,
        result.win ? 1 : 0,
        scoreDelta,
        now,
      );
      db.prepare('DELETE FROM arena_offers WHERE user_id = ?').run(req.userId);
      return {
        json: {
          seed,
          win: result.win,
          tier: offer.tier,
          scoreDelta,
          score: newScore,
          rank: rankOf(newScore),
          attemptsLeft: Math.max(0, ac.freeAttempts - used - 1),
          attacker,
          defender,
          opponent: { id: opponentId, name: opp.name, power: defender.power, isTestData: !!opp.is_test },
        },
      };
    });
  });

  router.get('/api/arena/leaderboard', (req) => {
    const rows = (r: ArenaRow) => ({ userId: r.user_id, name: r.name, score: r.score, power: r.power, isTestData: !!r.is_test, isSelf: r.user_id === req.userId });
    const top = (db.prepare('SELECT * FROM arena_players ORDER BY score DESC, updated_at ASC LIMIT 10').all() as unknown as ArenaRow[]).map((r, i) => ({ rank: i + 1, ...rows(r) }));
    const me = player(req.userId);
    let around: ReturnType<typeof rows>[] & { rank?: number }[] = [];
    let myRank = 0;
    if (me) {
      myRank = rankOf(me.score);
      const start = Math.max(0, myRank - 3);
      around = (db.prepare('SELECT * FROM arena_players ORDER BY score DESC, updated_at ASC LIMIT 5 OFFSET ?').all(start) as unknown as ArenaRow[]).map((r, i) => ({
        rank: start + i + 1,
        ...rows(r),
      }));
    }
    return { json: { top, around, me: me ? { rank: myRank, score: me.score } : null } };
  });
}
