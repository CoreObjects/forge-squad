import { activeCombos, activeTriples, recommendPlacement, swapNodes, weaknessMatch } from '../src/core/chain';
import { defaultConfig } from '../src/core/config';
import { chainOf, rune } from './helpers';

describe('战纹链', () => {
  const cfg = defaultConfig();

  it('识别 6 个双连携', () => {
    const c = chainOf(['ji', 'feng', 'feng', 'yu', 'feng', null]);
    expect(activeCombos(c, cfg.battle).map((x) => x.name)).toEqual(['迅斩', '追斩', '反攻']);
    const d = chainOf(['zhen', 'feng', 'ji', 'zhen', 'yu', 'yu']);
    expect(activeCombos(d, cfg.battle).map((x) => x.name)).toEqual(['破袭', '先制', '固守']);
  });

  it('空节点打断相邻关系；默认第 6 节不与第 1 节相邻', () => {
    expect(activeCombos(chainOf(['ji', null, 'feng']), cfg.battle)).toHaveLength(0);
    expect(activeCombos(chainOf(['feng', null, null, null, null, 'ji']), cfg.battle)).toHaveLength(0);
    const wrapCfg = defaultConfig();
    wrapCfg.battle.wrapAdjacency = true;
    expect(activeCombos(chainOf(['feng', null, null, null, null, 'ji']), wrapCfg.battle).map((x) => x.name)).toEqual(['迅斩']);
  });

  it('三连奖励', () => {
    expect(activeTriples(chainOf(['ji', 'feng', 'feng']), cfg.battle).map((x) => x.name)).toEqual(['疾风追斩']);
  });

  it('破绽匹配', () => {
    const c = chainOf(['feng', 'zhen', 'feng', 'ji']);
    expect(weaknessMatch(c, ['zhen', 'feng'], cfg.battle)).toMatchObject({ full: 1, best: 2, nodes: [1, 2] });
    expect(weaknessMatch(c, ['ji', 'feng'], cfg.battle)).toMatchObject({ full: 0, best: 1 });
    expect(weaknessMatch(swapNodes(c, 0, 3), ['ji', 'feng'], cfg.battle).full).toBe(0);
    expect(weaknessMatch(swapNodes(c, 1, 3), ['ji', 'feng'], cfg.battle).full).toBe(1);
  });

  it('推荐节点：空节点优先；形成连携/破绽加分；无收益推荐熔炼', () => {
    const c = chainOf(['feng', null]);
    const rec = recommendPlacement(cfg, 1, c, 2, rune('ji'), null);
    expect(rec.best?.node).toBe(1);

    const full = chainOf(['feng', 'feng', 'yu', 'feng', 'zhen', 'feng']);
    const weakCombo = recommendPlacement(cfg, 1, full, 6, rune('ji', 0, 20), ['ji', 'feng']);
    expect(weakCombo.best?.gained.length).toBeGreaterThan(0);
    expect(weakCombo.best?.weakAfter).toBe(1);

    const junk = recommendPlacement(cfg, 1, chainOf(['feng', 'feng', 'feng', 'feng', 'feng', 'feng']).map((r) => r && { ...r, strength: 200 }), 6, rune('yu', 0, 5), null);
    expect(junk.tag).toBe('melt');
  });
});
