import { firstThirtyMinutes, pct } from '../scripts/bot';

/**
 * 前 30 分钟成长曲线（ECONOMY.md §15.1 / §4.2）。
 * 模拟玩家的每个动作都消耗真实时间；两组独立种子各 20 个，分别检查 P50。
 */
const SEED_SETS: [string, (i: number) => number][] = [
  ['A', (i) => 1000 + i * 7919],
  ['B', (i) => 424242 + i * 31337],
];

describe.each(SEED_SETS)('前 30 分钟成长曲线（种子组 %s，20 个）', (_name, seedOf) => {
  const runs = Array.from({ length: 20 }, (_, i) => firstThirtyMinutes(seedOf(i)));
  const at = (m: number) => runs.map((r) => r.curve[m - 1].power);

  it('10 分钟战力 P50 在 180–220', () => {
    const p50 = pct(at(10), 0.5);
    expect(p50).toBeGreaterThanOrEqual(180);
    expect(p50).toBeLessThanOrEqual(220);
  });

  it('30 分钟战力 P50 在 280–350', () => {
    const p50 = pct(at(30), 0.5);
    expect(p50).toBeGreaterThanOrEqual(280);
    expect(p50).toBeLessThanOrEqual(350);
  });

  it('10–20 分钟持续成长（P50 至少 +60），不是 10 分钟就到顶', () => {
    expect(pct(at(15), 0.5)).toBeGreaterThan(pct(at(10), 0.5));
    expect(pct(at(20), 0.5) - pct(at(10), 0.5)).toBeGreaterThanOrEqual(60);
  });

  it('前 30 分钟锻造机会 35–45 次', () => {
    const forges = pct(runs.map((r) => r.g.state.counters.forges), 0.5);
    expect(forges).toBeGreaterThanOrEqual(35);
    expect(forges).toBeLessThanOrEqual(45);
  });

  it('第一次软卡（1-6）90% 的玩家在 15 分钟内突破', () => {
    const cleared = runs.map((r) => r.curve.find((c) => c.stage >= 6)?.minutes ?? 99);
    expect(pct(cleared, 0.9)).toBeLessThanOrEqual(15);
  });
}, 300_000);
