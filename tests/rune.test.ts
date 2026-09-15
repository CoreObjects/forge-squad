import { defaultConfig } from '../src/core/config';
import { Rng } from '../src/core/rng';
import { forgeRune, newPityState, Q_EPIC, Q_LEGEND, Q_RARE, runeStrength } from '../src/core/rune';

describe('战纹生成', () => {
  it('新手前 4 次锻造四种类型各出现一次，第 5 次为锋纹', () => {
    const cfg = defaultConfig();
    const pity = newPityState();
    const rng = new Rng(1);
    const types = Array.from({ length: 5 }, (_, i) => forgeRune(cfg.runes, rng, pity, { furnaceLevel: 1 }, `r${i}`).rune.type);
    expect(new Set(types.slice(0, 4)).size).toBe(4);
    expect(types).toEqual(['feng', 'ji', 'yu', 'zhen', 'feng']);
  });

  it('前 12 次内必出史诗（新手保底只触发一次）', () => {
    const cfg = defaultConfig();
    cfg.runes.qualityTable[0] = [100, 0, 0, 0, 0, 0];
    cfg.runes.pity.rarePlusEvery = 1000;
    for (let seed = 1; seed <= 20; seed++) {
      const pity = newPityState();
      const rng = new Rng(seed);
      const qs = Array.from({ length: 30 }, (_, i) => forgeRune(cfg.runes, rng, pity, { furnaceLevel: 1 }, `r${i}`).rune.quality);
      expect(qs.slice(0, 12).some((q) => q >= Q_EPIC)).toBe(true);
      expect(qs.slice(12).some((q) => q >= Q_EPIC)).toBe(false);
    }
  });

  it('连续 9 次未出稀有+，第 10 次至少稀有', () => {
    const cfg = defaultConfig();
    cfg.runes.qualityTable[0] = [100, 0, 0, 0, 0, 0];
    cfg.runes.pity.newbieEpicWithin = 0;
    const pity = newPityState();
    pity.newbieEpicDone = true;
    const rng = new Rng(7);
    const qs = Array.from({ length: 30 }, (_, i) => forgeRune(cfg.runes, rng, pity, { furnaceLevel: 1 }, `r${i}`).rune.quality);
    expect(qs[9]).toBeGreaterThanOrEqual(Q_RARE);
    expect(qs[19]).toBeGreaterThanOrEqual(Q_RARE);
    expect(qs.filter((q) => q >= Q_RARE).length).toBe(3);
  });

  it('史诗 50 抽保底、传说 180 抽保底（仅在炉级开放传说时计数）', () => {
    const cfg = defaultConfig();
    cfg.runes.pity.newbieEpicWithin = 0;
    cfg.runes.qualityTable[0] = [100, 0, 0, 0, 0, 0];
    cfg.runes.qualityTable[3] = [100, 0, 0, 0, 0.0000001, 0];
    const pity = newPityState();
    pity.newbieEpicDone = true;
    const rng = new Rng(3);
    const low = Array.from({ length: 100 }, (_, i) => forgeRune(cfg.runes, rng, pity, { furnaceLevel: 1 }, `a${i}`));
    expect(low[49].rune.quality).toBeGreaterThanOrEqual(Q_EPIC);
    expect(pity.sinceLegendPlus).toBe(0);
    const high = Array.from({ length: 180 }, (_, i) => forgeRune(cfg.runes, rng, pity, { furnaceLevel: 4 }, `b${i}`));
    expect(high[179].rune.quality).toBe(Q_LEGEND);
    expect(high[179].pityHit).toBe('legend');
  });

  it('首充史诗保底：下一次至少史诗，之后状态清除', () => {
    const cfg = defaultConfig();
    cfg.runes.qualityTable[0] = [100, 0, 0, 0, 0, 0];
    const pity = newPityState();
    pity.forgeCount = 20;
    pity.newbieEpicDone = true;
    pity.firstChargeEpicPending = true;
    const rng = new Rng(9);
    const a = forgeRune(cfg.runes, rng, pity, { furnaceLevel: 1 }, 'x');
    expect(a.rune.quality).toBeGreaterThanOrEqual(Q_EPIC);
    expect(a.pityHit).toBe('firstCharge');
    expect(pity.firstChargeEpicPending).toBe(false);
    const b = forgeRune(cfg.runes, rng, pity, { furnaceLevel: 1 }, 'y');
    expect(b.pityHit).not.toBe('firstCharge');
  });

  it('品质与类型实际分布贴近配置概率', () => {
    const cfg = defaultConfig();
    cfg.runes.pity.rarePlusEvery = 1e9;
    cfg.runes.pity.epicPlusEvery = 1e9;
    const pity = newPityState();
    pity.forgeCount = 100;
    pity.newbieEpicDone = true;
    const rng = new Rng(123);
    const N = 100000;
    const q = [0, 0, 0, 0, 0, 0];
    const t: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      const r = forgeRune(cfg.runes, rng, pity, { furnaceLevel: 5 }, `r${i}`).rune;
      q[r.quality]++;
      t[r.type] = (t[r.type] ?? 0) + 1;
    }
    const row = cfg.runes.qualityTable[4];
    row.forEach((p, i) => expect(Math.abs((q[i] / N) * 100 - p)).toBeLessThan(0.6));
    for (const k of ['feng', 'ji', 'yu', 'zhen']) expect(Math.abs(t[k] / N - 0.25)).toBeLessThan(0.01);
  });

  it('强度 = 类型基础值 × 1.18^(炉级-1) × 品质系数 × 浮动', () => {
    const cfg = defaultConfig();
    const base = cfg.runes.typeBase.feng;
    expect(runeStrength(cfg.runes, 'feng', 0, 1, 1)).toBe(base);
    expect(runeStrength(cfg.runes, 'feng', 3, 3, 1)).toBe(Math.round(base * 1.18 * 1.18 * 1.32));
  });
});
