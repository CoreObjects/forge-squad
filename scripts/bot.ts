/**
 * 模拟玩家（经济节奏验证用）。所有动作都消耗“游戏内时间”，
 * 这样“10 分钟 / 30 分钟战力”才是真实玩家在这段时间里能达到的值。
 */
import { simulatePve } from '../src/core/battle';
import { weaknessMatch } from '../src/core/chain';
import { defaultConfig, type GameConfig } from '../src/core/config';
import { Game } from '../src/core/game';
import { MINUTE } from '../src/core/time';
import type { Chain } from '../src/core/types';

/** 动作耗时（秒） */
export const ACTION_SECONDS = {
  forge1: 2,
  forge10: 3,
  /** 看锻造结果卡（战力 / 连携 / 破绽变化）并选择 */
  decide: 5,
  manualDecide: 8,
  battleResult: 4,
  optimizeChain: 30,
  levelUp: 2,
  furnace: 5,
  claim: 3,
  tutorialRead: 5,
  waitStep: 60,
};

const NODE_SECONDS = 0.43;

export class Clock {
  t: number;
  constructor(start: number) {
    this.t = start;
  }
  now = () => this.t;
  spend(seconds: number) {
    this.t += seconds * 1000;
  }
}

export function permutations(chain: Chain, unlocked: number): Chain[] {
  const items = chain.slice(0, unlocked);
  const out: Chain[] = [];
  const used = new Array(items.length).fill(false);
  const cur: Chain = [];
  const rec = () => {
    if (cur.length === items.length) {
      out.push([...cur, ...chain.slice(unlocked)]);
      return;
    }
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      const key = items[i] ? items[i]!.type + items[i]!.quality : 'null';
      if (seen.has(key)) continue;
      seen.add(key);
      used[i] = true;
      cur.push(items[i]);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return out;
}

/** 失败后调顺序：挑胜率最高的排列（代表“看破绽、调链”的玩家）。返回是否改变了链。 */
export function optimizeOrder(g: Game): boolean {
  const enemy = g.stageEnemyNow();
  const s = g.state;
  let best = s.chain;
  let bestScore = -1;
  for (const c of permutations(s.chain, s.unlockedNodes)) {
    let wins = 0;
    for (let k = 0; k < 6; k++) if (simulatePve(g.cfg, g.fighter(c), enemy, 1000 + k).win) wins++;
    const score = wins * 10 + (enemy.weakness ? weaknessMatch(c, enemy.weakness, g.cfg.battle).full : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  let changed = false;
  for (let i = 0; i < s.unlockedNodes; i++) {
    const want = best[i];
    if (s.chain[i] === want) continue;
    const j = s.chain.findIndex((r, idx) => idx > i && r === want);
    if (j > i) {
      g.swap(i, j);
      changed = true;
    }
  }
  return changed;
}

function battleSeconds(events: { k: string }[]): number {
  let n = 0;
  for (const e of events) if (e.k === 'node' || e.k === 'attack') n++;
  // 默认 1 倍速观看（GAME_DESIGN：单局 10–25 秒）
  return n * NODE_SECONDS + ACTION_SECONDS.battleResult;
}

export class Bot {
  lastFailStage = 0;
  optimizedFor = 0;
  stuckSteps = 0;
  curve: Checkpoint[] = [];

  constructor(
    public g: Game,
    public clock: Clock,
  ) {}

  forgeAll(): void {
    const g = this.g;
    while (g.state.hammers > 0 || g.state.pending.length > 0) {
      if (g.state.pending.length === 0) {
        const ten = g.state.hammers >= 10 && g.isUnlocked('tenPull');
        g.forge(ten ? 10 : 1);
        this.clock.spend(ten ? ACTION_SECONDS.forge10 : ACTION_SECONDS.forge1);
      }
      while (g.currentPending()) {
        g.decidePending({ kind: 'recommend' });
        this.clock.spend(ACTION_SECONDS.decide);
      }
    }
  }

  spendGold(): void {
    const g = this.g;
    for (let guard = 0; guard < 500; guard++) {
      if (g.upgradeFurnace()) {
        this.clock.spend(ACTION_SECONDS.furnace);
        continue;
      }
      const c = g.furnaceCheck();
      if (c.next && c.xpOk && c.chapterOk && g.state.gold < c.next.gold) break;
      if (!g.levelUp()) break;
      this.clock.spend(ACTION_SECONDS.levelUp);
    }
  }

  claims(): void {
    const g = this.g;
    const idle = g.claimIdle();
    if (idle && idle.hammers + idle.gold > 0) this.clock.spend(ACTION_SECONDS.claim);
    for (const t of g.cfg.economy.daily.tasks) if (g.claimTask(t.id)) this.clock.spend(ACTION_SECONDS.claim);
    if (g.claimMonthly()) this.clock.spend(ACTION_SECONDS.claim);
  }

  /** 新手引导（按真实步骤走） */
  tutorial(): void {
    const g = this.g;
    const s = g.state;
    for (let guard = 0; guard < 100 && s.tutorial.step !== 'done'; guard++) {
      const step = s.tutorial.step;
      this.clock.spend(ACTION_SECONDS.tutorialRead);
      if (step.startsWith('forge') && s.pending.length === 0) {
        g.forge(1);
        this.clock.spend(ACTION_SECONDS.forge1);
      } else if (s.pending.length > 0) {
        g.decidePending(step === 'place3' ? { kind: 'place', node: 2 } : { kind: 'recommend' });
        this.clock.spend(step === 'place3' ? ACTION_SECONDS.manualDecide : ACTION_SECONDS.decide);
      } else if (step === 'swap') {
        const w = s.tutorial.bossWeakness!;
        let done = false;
        for (let i = 0; i < s.unlockedNodes && !done; i++)
          for (let j = i + 1; j < s.unlockedNodes && !done; j++) {
            const c = s.chain.slice();
            [c[i], c[j]] = [c[j], c[i]];
            if (weaknessMatch(c, w, g.cfg.battle).full > 0) {
              g.swap(i, j);
              done = true;
            }
          }
        this.clock.spend(ACTION_SECONDS.optimizeChain);
        if (!done) g.skipTutorial();
      } else {
        const b = g.challengeStage();
        if (b) this.clock.spend(battleSeconds(b.result.events));
      }
    }
  }

  /** 连续游玩直到 until（毫秒时间戳）或彻底卡住。 */
  playUntil(until: number, opts: { waitWhenStuck: boolean } = { waitWhenStuck: true }): void {
    const g = this.g;
    while (this.clock.t < until) {
      g.ensureDaily();
      this.claims();
      this.forgeAll();
      this.spendGold();
      if (g.allStagesCleared()) {
        if (!opts.waitWhenStuck) return;
        this.clock.spend(ACTION_SECONDS.waitStep);
        continue;
      }
      const b = g.challengeStage();
      if (!b) return;
      this.clock.spend(battleSeconds(b.result.events));
      if (b.result.win) continue;
      // 失败：先调链（每关只在链变化后调一次），再不行就等资源
      const stage = b.info.index;
      if (this.optimizedFor !== stage || this.lastFailStage !== stage) {
        this.lastFailStage = stage;
        this.optimizedFor = stage;
        this.clock.spend(ACTION_SECONDS.optimizeChain);
        if (optimizeOrder(g)) continue;
      }
      if (!opts.waitWhenStuck) return;
      // 卡住：等一会儿（挂机积累）；有新资源或每隔几分钟会重新看一次链
      this.clock.spend(ACTION_SECONDS.waitStep);
      this.stuckSteps++;
      if (g.state.hammers > 0 || g.idlePreview().hammers > 0 || this.stuckSteps % 5 === 0) this.optimizedFor = 0;
    }
  }

  /** 一次短会话：领资源、用完、推到卡住为止 */
  session(): void {
    this.playUntil(this.clock.t + 20 * MINUTE, { waitWhenStuck: false });
    const g = this.g;
    if (g.isUnlocked('dailyBoss') && !g.state.daily.dailyBossWon) g.challengeDailyBoss();
    while (g.state.arena.unlocked && g.arenaAttemptsLeft() > 0) g.challengeArena(1);
    this.claims();
    this.forgeAll();
    this.spendGold();
  }
}

export interface Checkpoint {
  label: string;
  minutes: number;
  power: number;
  stage: number;
  furnace: number;
  level: number;
  forges: number;
}

export function snapshot(g: Game, label: string, minutes: number): Checkpoint {
  return { label, minutes, power: g.power(), stage: g.cleared(), furnace: g.state.furnaceLevel, level: g.state.charLevel, forges: g.state.counters.forges };
}

/** 首个 30 分钟：连续游玩，每分钟采样一次战力 */
export function firstThirtyMinutes(seed: number, cfg: GameConfig = defaultConfig()) {
  const start = new Date(2026, 8, 15, 20, 0, 0).getTime();
  const clock = new Clock(start);
  const g = new Game(cfg, Game.newState(cfg, start, seed), { now: clock.now });
  g.startSession(true);
  const bot = new Bot(g, clock);
  bot.tutorial();
  const curve: Checkpoint[] = [];
  for (let m = 1; m <= 30; m++) {
    bot.playUntil(start + m * MINUTE);
    curve.push(snapshot(g, `${m}分`, m));
  }
  bot.curve = curve;
  return { g, clock, bot, curve };
}

export function pct(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round((s.length - 1) * p))];
}
