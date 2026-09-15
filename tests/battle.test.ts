import { failureHints, simulatePve, simulatePvp } from '../src/core/battle';
import { defaultConfig } from '../src/core/config';
import { p0Boss, p0WinRate, runP0 } from '../src/core/p0';
import type { RuneType } from '../src/core/types';
import { chainOf } from './helpers';

const cfg = defaultConfig();
const P0 = cfg.battle.p0;

/** P0_BALANCE.md 基线：玩家攻击 100 / 生命 1000；重甲守卫 生命 1500 / 攻击 180 / 每 2 节行动 / 破绽 震→锋 */
function p0Player(types: RuneType[]) {
  return { name: 'P0', atk: 100, hp: 1000, def: 0, speed: 100, chain: chainOf(types) };
}
const guard = p0Boss(cfg);

describe('P0 验收：换位前输、换位后赢（1000 次）', () => {
  it('配置为最终数值：重甲守卫 生命 1500 / 攻击 180', () => {
    expect(P0.boss).toMatchObject({ hp: 1500, atk: 180, actEvery: 2, weakness: ['zhen', 'feng'] });
    expect(P0.player).toMatchObject({ atk: 100, hp: 1000 });
  });

  it('无针对链「锋锋疾锋御锋」1000 次全部失败', () => {
    expect(p0WinRate(cfg, P0.plainChain, 1000)).toBe(0);
    for (let seed = 1; seed <= 1000; seed++) expect(runP0(cfg, P0.plainChain, seed).stats.breaks).toBe(0);
  });

  it('针对链「震锋疾锋御锋」1000 次胜率 ≥ 95%，每场都触发破势', () => {
    let wins = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const r = runP0(cfg, P0.tunedChain, seed);
      expect(r.stats.breaks).toBeGreaterThan(0);
      if (r.win) wins++;
    }
    expect(wins / 1000).toBeGreaterThanOrEqual(0.95);
  });

  it('破势带来胜率提升：同一针对链去掉 Boss 破绽后胜率明显下降', () => {
    const withBreak = p0WinRate(cfg, P0.tunedChain, 1000);
    const withoutBreak = p0WinRate(cfg, P0.tunedChain, 1000, null);
    expect(withBreak - withoutBreak).toBeGreaterThan(0.15);
  });

  it('两条验收链只有节点 1 不同（锋 → 震）', () => {
    expect(P0.plainChain.slice(1)).toEqual(P0.tunedChain.slice(1));
  });
});

describe('P0 战斗数值基线', () => {
  it('节点按 1→6 顺序触发，敌人每 2 个节点行动一次', () => {
    const r = simulatePve(cfg, p0Player(['feng', 'feng', 'ji', 'feng', 'yu', 'feng']), guard, 1);
    const seq = r.events.slice(0, 9).map((e) => (e.k === 'node' ? `n${e.idx}` : e.k));
    expect(seq).toEqual(['n0', 'n1', 'attack', 'n2', 'n3', 'attack', 'n4', 'n5', 'attack']);
  });

  it('锋 100% / 追斩 +30% / 疾+迅斩 +55% / 御 12% 护盾 / 反攻 护盾×60%', () => {
    const r = simulatePve(cfg, p0Player(['feng', 'feng', 'ji', 'feng', 'yu', 'feng']), guard, 1);
    const nodes = r.events.filter((e) => e.k === 'node').slice(0, 6);
    const dmg = nodes.map((e) => (e.k === 'node' ? Math.round(e.dmg) : 0));
    expect(dmg).toEqual([100, 130, 0, 155, 0, 172]);
    const yu = nodes[4];
    expect(yu.k === 'node' && Math.round(yu.shieldGain)).toBe(120);
  });

  it('破势触发瞬间追加 80% 攻击力伤害', () => {
    const t = simulatePve(cfg, p0Player(P0.tunedChain), guard, 1);
    const brk = t.events.find((e) => e.k === 'break');
    expect(brk && brk.k === 'break' && Math.round(brk.dmg)).toBe(80);
  });

  it('破势期间 2 个节点受伤 +50%，每轮最多 1 次', () => {
    const r = simulatePve(cfg, p0Player(['zhen', 'feng', 'feng', 'zhen', 'feng', 'feng']), { ...guard, hp: 1e9, atk: 0 }, 5);
    const round1 = r.events.filter((e) => e.k === 'node' && e.round === 1);
    const vulnerable = round1.filter((e) => e.k === 'node' && e.vulnerable).map((e) => (e.k === 'node' ? e.idx : -1));
    expect(vulnerable).toEqual([2, 3]);
    expect(r.events.filter((e) => e.k === 'break').length).toBe(cfg.battle.maxRounds);
  });

  it('疾→震 先制：控制必定成功，敌人下一次行动被跳过', () => {
    const r = simulatePve(cfg, p0Player(['ji', 'zhen', 'feng', 'feng', 'feng', 'feng']), { ...guard, hp: 1e9 }, 11);
    const zhen = r.events.filter((e) => e.k === 'node' && e.type === 'zhen');
    expect(zhen.every((e) => e.k === 'node' && e.stunOk)).toBe(true);
    const firstAttack = r.events.find((e) => e.k === 'attack');
    expect(firstAttack && firstAttack.k === 'attack' && firstAttack.skipped).toBe(true);
  });

  it('超过最大回合按剩余生命比例结算', () => {
    const r = simulatePve(cfg, p0Player(['yu', 'yu']), { ...guard, hp: 1e9, atk: 1 }, 1);
    expect(r.reason).toBe('timeout');
    expect(r.stats.rounds).toBe(cfg.battle.maxRounds);
  });

  it('同一输入同一种子结果一致', () => {
    const a = simulatePve(cfg, p0Player(['zhen', 'feng', 'zhen', 'feng', 'zhen', 'feng']), guard, 99);
    const b = simulatePve(cfg, p0Player(['zhen', 'feng', 'zhen', 'feng', 'zhen', 'feng']), guard, 99);
    expect(a).toEqual(b);
  });

  it('PVP：双方链交替触发，结果可复现', () => {
    const p = p0Player(['ji', 'feng', 'feng', 'yu', 'zhen', 'feng']);
    const o = { ...p0Player(['yu', 'yu', 'feng', 'feng', 'ji', 'feng']), name: '对手', speed: 90 };
    const a = simulatePvp(cfg, p, o, 3);
    const b = simulatePvp(cfg, p, o, 3);
    expect(a).toEqual(b);
    const first = a.events.filter((e) => e.k === 'node').slice(0, 4).map((e) => (e.k === 'node' ? e.side : ''));
    expect(first).toEqual(['p', 'e', 'p', 'e']);
  });

  it('失败解释最多 2 条，未命中破绽时优先提示破绽', () => {
    const r = simulatePve(cfg, p0Player(['feng']), { ...guard, hp: 100000 }, 1);
    const hints = failureHints(r, { cfg, enemyWeakness: guard.weakness, comboCount: 0 });
    expect(hints.length).toBeLessThanOrEqual(2);
    expect(hints[0]).toContain('破绽');
  });
});
