import type { Ctx } from '../context';
import { HttpError, type Router } from '../http';

interface Ev {
  user_id: number;
  name: string;
  t: number;
  props: Record<string, any>;
}

const DAY = 86_400_000;

const pct = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round((s.length - 1) * p))];
};
const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const avg = (arr: number[]) => (arr.length ? Math.round((arr.reduce((x, y) => x + y, 0) / arr.length) * 10) / 10 : 0);

/** MVP_SPEC §36.2 “数据完整”要回答的问题，全部从 events 表计算。 */
export function buildReport(ctx: Ctx, opts: { sinceMs?: number } = {}) {
  const since = opts.sinceMs ?? 0;
  const rows = ctx.db.prepare('SELECT user_id, name, t, props FROM events WHERE t >= ? ORDER BY user_id, t').all(since) as { user_id: number; name: string; t: number; props: string }[];
  const events: Ev[] = rows.map((r) => ({ user_id: r.user_id, name: r.name, t: r.t, props: safeJson(r.props) }));
  const by = (name: string) => events.filter((e) => e.name === name);
  const users = new Set(events.map((e) => e.user_id));
  const firstSeen = new Map<number, number>();
  for (const e of events) if (!firstSeen.has(e.user_id)) firstSeen.set(e.user_id, e.t);
  const dayOf = (e: Ev) => Math.floor((e.t - (firstSeen.get(e.user_id) ?? e.t)) / DAY);

  // 锻造
  const forges = by('forge');
  const perUserDay = new Map<string, number>();
  for (const e of forges) {
    const k = `${e.user_id}:${dayOf(e)}`;
    perUserDay.set(k, (perUserDay.get(k) ?? 0) + 1);
  }
  const forgeCounts = [...perUserDay.values()];
  const typeCount: Record<string, number> = {};
  const qualityByFurnace: Record<string, number[]> = {};
  for (const e of forges) {
    typeCount[e.props.type] = (typeCount[e.props.type] ?? 0) + 1;
    const f = String(e.props.furnace ?? '?');
    (qualityByFurnace[f] ??= [0, 0, 0, 0, 0, 0])[Number(e.props.quality) || 0]++;
  }
  const typeShare = Object.fromEntries(Object.entries(typeCount).map(([k, v]) => [k, rate(v, forges.length)]));
  const qualityShare = Object.fromEntries(
    Object.entries(qualityByFurnace).map(([f, arr]) => {
      const n = arr.reduce((a, b) => a + b, 0);
      return [f, { samples: n, percent: arr.map((v) => rate(v, n)) }];
    }),
  );

  // 放置决策
  const decisions = by('rune_decision');
  const placements = decisions.filter((e) => e.props.decision === 'recommend' || e.props.decision === 'manual');
  const manual = placements.filter((e) => e.props.decision === 'manual').length;
  const swaps = by('chain_swap').length;
  const effective = decisions.filter((e) => e.props.effective === true).length;
  const nonPure = placements.filter((e) => e.props.nonPurePower === true).length;
  const comboChanged = placements.filter((e) => (e.props.combosGained?.length ?? 0) + (e.props.combosLost?.length ?? 0) > 0).length;

  // 卡点
  const firstFails = by('stuck_first_fail');
  const passes = by('stuck_pass');
  const nextActions = by('stuck_next_action');
  const stageFail: Record<string, number> = {};
  for (const e of firstFails) stageFail[e.props.stage] = (stageFail[e.props.stage] ?? 0) + 1;
  const stageDur: Record<string, number[]> = {};
  for (const e of passes) (stageDur[e.props.stage] ??= []).push(Number(e.props.durationMs) || 0);
  const stuckStages = Object.entries(stageFail)
    .map(([stage, n]) => ({ stage: Number(stage), firstFailUsers: n, passes: stageDur[stage]?.length ?? 0, medianStuckMinutes: Math.round(pct(stageDur[stage] ?? [], 0.5) / 600) / 100 }))
    .sort((a, b) => b.firstFailUsers - a.firstFailUsers)
    .slice(0, 15);
  const bossFails = firstFails.filter((e) => Number(e.props.stage) % 10 === 0 || Number(e.props.weaknessMatch ?? -1) >= 0);
  const nextActionShare: Record<string, number | null> = {};
  for (const e of nextActions) nextActionShare[e.props.action] = (nextActionShare[e.props.action] ?? 0) + 1;
  for (const k of Object.keys(nextActionShare)) nextActionShare[k] = rate(nextActionShare[k]!, nextActions.length);

  // 首次失败关卡（每个玩家第一次失败）
  const firstFailByUser = new Map<number, number>();
  for (const e of by('battle')) if (e.props.source === 'stage' && e.props.win === false && !firstFailByUser.has(e.user_id)) firstFailByUser.set(e.user_id, Number(e.props.stage));
  const firstFailStage: Record<string, number> = {};
  for (const s of firstFailByUser.values()) firstFailStage[s] = (firstFailStage[s] ?? 0) + 1;

  // 首充前后
  const paySuccess = by('pay_success');
  const firstChargeBuys = paySuccess.filter((e) => e.props.product === 'first_charge');
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  for (const buy of firstChargeBuys) {
    const mine = events.filter((e) => e.user_id === buy.user_id);
    const idx = mine.indexOf(buy);
    for (const e of mine.slice(Math.max(0, idx - 10), idx)) before[e.name] = (before[e.name] ?? 0) + 1;
    for (const e of mine.slice(idx + 1).filter((x) => x.t - buy.t <= 30 * 60_000).slice(0, 20)) after[e.name] = (after[e.name] ?? 0) + 1;
  }
  const payShowUsers = new Set(by('pay_show').map((e) => e.user_id)).size;

  // 月卡：同日龄的主线进度对比
  const monthlyUsers = new Set(paySuccess.filter((e) => e.props.product === 'monthly_card').map((e) => e.user_id));
  const stageAtDay = (uids: number[], day: number) =>
    pct(
      uids.map((u) => Math.max(0, ...events.filter((e) => e.user_id === u && e.name === 'battle' && e.props.win === true && dayOf(e) <= day).map((e) => Number(e.props.stage) || 0))),
      0.5,
    );
  const all = [...users];
  const monthlyCompare = [1, 3, 7].map((d) => {
    const eligible = all.filter((u) => events.some((e) => e.user_id === u && dayOf(e) >= d));
    const m = eligible.filter((u) => monthlyUsers.has(u));
    const f = eligible.filter((u) => !monthlyUsers.has(u));
    return { day: d, monthlyUsers: m.length, freeUsers: f.length, monthlyMedianStage: stageAtDay(m, d), freeMedianStage: stageAtDay(f, d) };
  });

  // 留存与库存
  const tutorialDone = new Set(by('tutorial_complete').map((e) => e.user_id)).size;
  const returned = (d: number) => new Set(by('day_return').filter((e) => e.props.day === d).map((e) => e.user_id)).size;
  const hammerStock = by('session_start').map((e) => Number(e.props.hammers) || 0);

  return {
    generatedAt: ctx.now(),
    users: users.size,
    events: events.length,
    retention: { tutorialCompletionRate: rate(tutorialDone, users.size), d1Users: returned(1), d3Users: returned(3), d7Users: returned(7) },
    forge: {
      perUserDay: { avg: avg(forgeCounts), p50: pct(forgeCounts, 0.5), p90: pct(forgeCounts, 0.9) },
      runeTypeSharePercent: typeShare,
      qualitySharePercentByFurnace: qualityShare,
    },
    chain: {
      effectiveRuneRate: rate(effective, decisions.length),
      recommendAcceptRate: rate(placements.length - manual, placements.length),
      manualAdjustRate: rate(manual + swaps, placements.length),
      nonPurePowerRate: rate(nonPure, placements.length),
      comboChangeRate: rate(comboChanged, placements.length),
      swaps,
    },
    stuck: {
      firstFailStageDistribution: firstFailStage,
      stuckStages,
      afterFirstFailNextActionPercent: nextActionShare,
      bossFirstFails: bossFails.length,
      adjustedChainBeforePassRate: rate(passes.filter((e) => e.props.adjusted).length, passes.length),
      weaknessImprovedBeforePassRate: rate(passes.filter((e) => e.props.weaknessImproved).length, passes.length),
      paidBeforePassRate: rate(passes.filter((e) => e.props.paid).length, passes.length),
    },
    inventory: { hammersAtSessionStart: { p50: pct(hammerStock, 0.5), p90: pct(hammerStock, 0.9) } },
    firstCharge: {
      shownUsers: payShowUsers,
      buyers: firstChargeBuys.length,
      conversionRate: rate(firstChargeBuys.length, payShowUsers),
      eventsBefore: before,
      eventsWithin30MinAfter: after,
    },
    monthlyCard: { buyers: monthlyUsers.size, progressByDay: monthlyCompare },
  };
}

function safeJson(s: string): Record<string, any> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function registerReport(router: Router, ctx: Ctx): void {
  router.get(
    '/api/admin/report',
    (req) => {
      const key = String(req.headers['x-admin-key'] ?? req.query.get('key') ?? '');
      if (!ctx.cfg.adminKey || key !== ctx.cfg.adminKey) throw new HttpError(403, 'forbidden');
      const days = Number(req.query.get('days') ?? 0);
      return { json: buildReport(ctx, { sinceMs: days > 0 ? ctx.now() - days * DAY : 0 }) };
    },
    false,
  );
}
