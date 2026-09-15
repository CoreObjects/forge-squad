import { Game } from '../src/core/game';
import { DAY, HOUR } from '../src/core/time';
import { newGame, playTutorial } from './helpers';

describe('新手流程（3 分钟：锻造→排序→连携→破绽→结果变化）', () => {
  it.each([1, 2, 3, 42, 777, 2026])('种子 %i：小 Boss 换位前输、换位后触发破势并获胜', (seed) => {
    const { game } = newGame({ seed });
    const log = playTutorial(game);
    expect(log.bossFirstWin).toBe(false);
    expect(log.bossRetryWin).toBe(true);
    expect(log.breaks).toBeGreaterThan(0);
    expect(game.state.tutorial.step).toBe('done');
    expect(game.state.unlockedNodes).toBe(5);
    expect(game.state.milestones.comboSeen).toBe(true);
  });

  it('前两枚战纹被放成「疾 → 锋」', () => {
    const { game } = newGame();
    game.startSession(true);
    game.forge(1);
    game.decidePending({ kind: 'recommend' });
    game.challengeStage();
    game.forge(1);
    game.decidePending({ kind: 'recommend' });
    expect(game.state.chain.slice(0, 2).map((r) => r?.type)).toEqual(['ji', 'feng']);
    const battle = game.challengeStage()!;
    expect(battle.result.stats.combos.xunzhan).toBeGreaterThan(0);
  });
});

describe('资源与结算', () => {
  it('覆盖旧战纹只熔炼一次、炉火正确到账', () => {
    const { game, cfg } = newGame();
    playTutorial(game);
    game.gm.addHammers(5);
    game.forge(1);
    const old = game.state.chain[0]!;
    const xpBefore = game.state.fireXpTotal;
    const meltsBefore = game.state.counters.melts;
    const res = game.decidePending({ kind: 'place', node: 0 })!;
    expect(res.overwritten?.id).toBe(old.id);
    expect(game.state.fireXpTotal - xpBefore).toBe(cfg.runes.meltXp[old.quality]);
    expect(game.state.counters.melts - meltsBefore).toBe(1);
    expect(game.decidePending({ kind: 'melt' })).toBeNull();
  });

  it('废战纹熔炼不返还锻造锤', () => {
    const { game } = newGame();
    playTutorial(game);
    game.gm.addHammers(10);
    const h = game.state.hammers;
    game.forge(10);
    while (game.currentPending()) game.decidePending({ kind: 'melt' });
    expect(game.state.hammers).toBe(h - 10);
  });

  it('十连与单抽使用同一保底计数', () => {
    const { game } = newGame();
    playTutorial(game);
    game.gm.addHammers(20);
    const before = game.state.pity.forgeCount;
    game.forge(10);
    expect(game.state.pity.forgeCount).toBe(before + 10);
    expect(game.state.pending).toHaveLength(10);
    expect(game.canForge(1)).toBe(false);
  });

  it('存档往返：关闭→重进后战纹链顺序和关键状态一致', () => {
    const { game, cfg, clock, saves } = newGame();
    playTutorial(game);
    game.swap(0, 1);
    const json = saves[saves.length - 1];
    const loaded = Game.loadState(cfg, json, clock.now())!;
    expect(loaded).toEqual(JSON.parse(json));
    expect(loaded.chain.map((r) => r?.id)).toEqual(game.state.chain.map((r) => r?.id));
    expect(loaded.tutorial.step).toBe('done');
  });

  it('铁匠炉升级需要炉火 + 金币 + 主线门槛', () => {
    const { game } = newGame();
    playTutorial(game);
    game.state.fireXpTotal = 20;
    game.gm.addGold(1000);
    expect(game.furnaceCheck().chapterOk).toBe(false);
    expect(game.upgradeFurnace()).toBe(false);
    game.gm.setStage(11);
    expect(game.upgradeFurnace()).toBe(true);
    expect(game.state.furnaceLevel).toBe(2);
  });

  it('炉 1 → 炉 6 可达', () => {
    const { game, cfg } = newGame();
    playTutorial(game);
    game.gm.setStage(91);
    game.state.fireXpTotal = 850;
    game.gm.addGold(1e6);
    for (let i = 0; i < 5; i++) expect(game.upgradeFurnace()).toBe(true);
    expect(game.state.furnaceLevel).toBe(6);
    expect(cfg.progression.furnace[5].level).toBe(6);
  });
});

describe('挂机', () => {
  it('40 分钟 1 锤，免费上限 12 小时（最多 18 锤）', () => {
    const { game, clock } = newGame();
    playTutorial(game);
    game.gm.setStage(6);
    clock.advance(30 * HOUR);
    const pv = game.idlePreview();
    expect(pv.hammers).toBe(18);
    expect(pv.capped).toBe(true);
    const h = game.state.hammers;
    game.claimIdle();
    expect(game.state.hammers).toBe(h + 18);
    expect(game.idlePreview().hammers).toBe(0);
  });

  it('未满上限时保留不足 40 分钟的进度', () => {
    const { game, clock } = newGame();
    playTutorial(game);
    game.gm.setStage(6);
    clock.advance(100 * 60_000);
    expect(game.claimIdle()!.hammers).toBe(2);
    clock.advance(20 * 60_000);
    expect(game.idlePreview().hammers).toBe(1);
  });

  it('月卡：上限 18 小时、金币 +10%', async () => {
    const { game, clock } = newGame();
    playTutorial(game);
    game.gm.setStage(6);
    const freeGph = game.goldPerHour();
    await game.purchase('monthly_card');
    expect(game.goldPerHour()).toBeCloseTo(freeGph * 1.1);
    clock.advance(30 * HOUR);
    expect(game.idlePreview().hammers).toBe(27);
  });
});

describe('商业化', () => {
  it('首充只能买一次；+20 锤；下一次锻造至少史诗且只触发一次；不产生新资源', async () => {
    const { game } = newGame();
    playTutorial(game);
    const h = game.state.hammers;
    expect((await game.purchase('first_charge')).ok).toBe(true);
    expect(game.state.hammers).toBe(h + 20);
    expect((await game.purchase('first_charge')).ok).toBe(false);
    expect(game.state.hammers).toBe(h + 20);
    game.forge(1);
    expect(game.currentPending()!.rune.quality).toBeGreaterThanOrEqual(3);
    expect(game.currentPending()!.pityHit).toBe('firstCharge');
    game.decidePending({ kind: 'melt' });
    expect(game.state.pity.firstChargeEpicPending).toBe(false);
    expect(Object.keys(game.state).filter((k) => /coin|ticket|token/i.test(k))).toHaveLength(0);
  });

  it('同一订单重复到账被拒绝', () => {
    const { game } = newGame();
    playTutorial(game);
    expect(game.grantOrder('monthly_card', 'order-1')).toBe(true);
    const end = game.state.shop.monthlyEnd;
    expect(game.grantOrder('monthly_card', 'order-1')).toBe(false);
    expect(game.state.shop.monthlyEnd).toBe(end);
  });

  it('月卡 30 天：每日 8 锤领取一次，到期失效', async () => {
    const { game, clock } = newGame();
    playTutorial(game);
    await game.purchase('monthly_card');
    expect(game.monthlyDaysLeft()).toBe(30);
    const h = game.state.hammers;
    expect(game.claimMonthly()).toBe(true);
    expect(game.claimMonthly()).toBe(false);
    expect(game.state.hammers).toBe(h + 8);
    clock.advance(DAY);
    expect(game.claimMonthly()).toBe(true);
    clock.advance(29 * DAY + HOUR);
    expect(game.monthlyActive()).toBe(false);
    expect(game.claimMonthly()).toBe(false);
  });
});

describe('日常 / 每日 Boss / 竞技场', () => {
  it('日常任务进度、领取与跨天重置', () => {
    const { game, clock } = newGame();
    playTutorial(game);
    game.gm.setStage(11);
    game.gm.addHammers(20);
    game.forge(10);
    while (game.currentPending()) game.decidePending({ kind: 'melt' });
    game.forge(10);
    while (game.currentPending()) game.decidePending({ kind: 'melt' });
    expect(game.claimTask('forge')).toBe(true);
    expect(game.claimTask('forge')).toBe(false);
    expect(game.claimTask('melt')).toBe(true);
    clock.advance(DAY);
    game.ensureDaily();
    expect(game.state.daily.progress.forge ?? 0).toBe(0);
    expect(game.state.daily.claimed.forge).toBeUndefined();
  });

  it('每日 Boss 奖励一天一次', () => {
    const { game } = newGame();
    playTutorial(game);
    game.gm.setStage(11);
    game.gm.setCharLevel(80);
    const h = game.state.hammers;
    const a = game.challengeDailyBoss()!;
    expect(a.result.win).toBe(true);
    expect(game.state.hammers).toBe(h + 4);
    game.challengeDailyBoss();
    expect(game.state.hammers).toBe(h + 4);
  });

  it('竞技场：3 个对手、每日次数、积分与排名更新，测试对手有标记', () => {
    const { game } = newGame();
    playTutorial(game);
    game.gm.setStage(11);
    const opps = game.arenaOpponents();
    expect(opps.map((o) => o.tier)).toEqual(['weak', 'close', 'strong']);
    expect(opps.every((o) => o.bot.isTestData)).toBe(true);
    const score = game.state.arena.score;
    const b = game.challengeArena(0)!;
    expect(game.state.arena.score).toBe(score + b.scoreDelta);
    game.challengeArena(0);
    game.challengeArena(0);
    expect(game.challengeArena(0)).toBeNull();
    const board = game.leaderboard();
    expect(board.filter((r) => r.isSelf)).toHaveLength(1);
    expect(game.state.arena.snapshot?.chain.length).toBe(6);
  });
});
