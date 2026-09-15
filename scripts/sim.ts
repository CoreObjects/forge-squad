/**
 * 经济节奏模拟：用一个“活跃免费玩家”机器人跑 D0–D14，输出每个检查点的进度，
 * 对照 ECONOMY.md 的战力 / 炉级 / 章节目标。
 * 运行：npm run sim  [-- --days 14 --seeds 5]
 */
import { simulatePve } from '../src/core/battle';
import { weaknessMatch } from '../src/core/chain';
import { defaultConfig } from '../src/core/config';
import { Game } from '../src/core/game';
import { MINUTE } from '../src/core/time';
import type { Chain } from '../src/core/types';

declare const process: { argv: string[] };
const args = process.argv.slice(2);
const argNum = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const DAYS = argNum('days', 14);
const SEEDS = argNum('seeds', 5);
const VERBOSE = args.includes('--verbose');

function permutations(chain: Chain, unlocked: number): Chain[] {
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
      const key = items[i] ? items[i]!.id : 'null';
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

/** 失败后“调顺序”：挑胜率最高的排列（模拟玩家看破绽调链）。 */
function optimizeOrder(g: Game): boolean {
  const enemy = g.stageEnemyNow();
  const s = g.state;
  let best = s.chain;
  let bestScore = -1;
  for (const c of permutations(s.chain, s.unlockedNodes)) {
    let wins = 0;
    for (let k = 0; k < 3; k++) if (simulatePve(g.cfg, g.fighter(c), enemy, 1000 + k).win) wins++;
    const score = wins * 10 + (enemy.weakness ? weaknessMatch(c, enemy.weakness, g.cfg.battle).full : 0);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best === s.chain) return false;
  // 通过交换实现目标排列
  for (let i = 0; i < s.unlockedNodes; i++) {
    const want = best[i];
    const j = s.chain.findIndex((r, idx) => idx >= i && r === want);
    if (j > i) g.swap(i, j);
  }
  return true;
}

function spendGold(g: Game) {
  for (let guard = 0; guard < 500; guard++) {
    if (g.upgradeFurnace()) continue;
    const next = g.furnaceCheck().next;
    // 炉子差金币时优先攒钱
    if (next && g.furnaceCheck().xpOk && g.furnaceCheck().chapterOk && g.state.gold < next.gold) break;
    if (!g.levelUp()) break;
  }
}

function session(g: Game, maxAttemptsPerStage = 3) {
  g.ensureDaily();
  g.claimIdle();
  for (let loop = 0; loop < 200; loop++) {
    while (g.state.hammers > 0) {
      g.forge(g.state.hammers >= 10 && g.isUnlocked('tenPull') ? 10 : 1);
      while (g.currentPending()) g.decidePending({ kind: 'recommend' });
    }
    spendGold(g);
    if (g.allStagesCleared()) break;
    let progressed = false;
    for (let a = 0; a < maxAttemptsPerStage; a++) {
      const b = g.challengeStage();
      if (!b) break;
      if (b.result.win) {
        progressed = true;
        break;
      }
      if (!optimizeOrder(g)) break;
    }
    for (const t of g.cfg.economy.daily.tasks) g.claimTask(t.id);
    if (!progressed && g.state.hammers === 0) break;
  }
  if (g.isUnlocked('dailyBoss') && !g.state.daily.dailyBossWon) {
    g.challengeDailyBoss();
  }
  while (g.state.arena.unlocked && g.arenaAttemptsLeft() > 0) g.challengeArena(1);
  for (const t of g.cfg.economy.daily.tasks) g.claimTask(t.id);
  while (g.state.hammers > 0) {
    g.forge(g.state.hammers >= 10 ? 10 : 1);
    while (g.currentPending()) g.decidePending({ kind: 'recommend' });
  }
  spendGold(g);
}

interface Row {
  label: string;
  power: number;
  stage: number;
  furnace: number;
  level: number;
  forges: number;
  hammerStock: number;
}

function runOne(seed: number): Row[] {
  const cfg = defaultConfig();
  let t = new Date(2026, 8, 15, 9, 0, 0).getTime();
  const state = Game.newState(cfg, t, seed);
  const g = new Game(cfg, state, { now: () => t });
  g.startSession(true);
  const rows: Row[] = [];
  const snap = (label: string) =>
    rows.push({
      label,
      power: g.power(),
      stage: g.cleared(),
      furnace: g.state.furnaceLevel,
      level: g.state.charLevel,
      forges: g.state.counters.forges,
      hammerStock: g.state.hammers,
    });

  // 新手 + 首个 30 分钟：按“每 2 分钟一次小会话”推进
  playTutorial(g);
  for (let m = 0; m <= 30; m += 2) {
    session(g, 2);
    if (m === 10) snap('10 分钟');
    t += 2 * MINUTE;
  }
  snap('30 分钟');
  // 之后一天两次上线（早 9 点 / 晚 9 点）
  for (let day = 0; day < DAYS; day++) {
    t = new Date(2026, 8, 15 + day, 21, 0, 0).getTime();
    session(g);
    t = new Date(2026, 8, 16 + day, 9, 0, 0).getTime();
    session(g);
    if ([0, 2, 6, 13].includes(day)) snap(`D${day + 1}`);
    if (VERBOSE && seed === 1000) {
      const info = g.currentStage();
      console.log(`  [seed ${seed}] D${day + 1} 通关 ${g.cleared()} 战力 ${g.power()} 当前关 ${info.label}(${info.kind}) 需求 ${Math.round(info.requiredPower)} 炉 ${g.state.furnaceLevel} 级 ${g.state.charLevel} 金币 ${g.state.gold}`);
    }
  }
  return rows;
}

function playTutorial(g: Game) {
  const s = g.state;
  for (let guard = 0; guard < 100 && s.tutorial.step !== 'done'; guard++) {
    const step = s.tutorial.step;
    if (step.startsWith('forge') && s.pending.length === 0) g.forge(1);
    else if (s.pending.length > 0) g.decidePending(step === 'place3' ? { kind: 'place', node: 2 } : { kind: 'recommend' });
    else if (step === 'swap') {
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
      if (!done) g.skipTutorial();
    } else g.challengeStage();
  }
}

const all = Array.from({ length: SEEDS }, (_, i) => runOne(1000 + i * 7919));
const labels = all[0].map((r) => r.label);
console.log('检查点 | 战力 P10/P50/P90 | 通关关卡 P50 | 炉级 P50 | 角色等级 P50 | 累计锻造 P50 | 库存锤 P50');
const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
for (const label of labels) {
  const rs = all.map((rows) => rows.find((r) => r.label === label)!);
  const powers = rs.map((r) => r.power);
  console.log(
    `${label.padEnd(6)} | ${pct(powers, 0.1)}/${pct(powers, 0.5)}/${pct(powers, 0.9)} | ${pct(rs.map((r) => r.stage), 0.5)} | ${pct(rs.map((r) => r.furnace), 0.5)} | ${pct(rs.map((r) => r.level), 0.5)} | ${pct(rs.map((r) => r.forges), 0.5)} | ${pct(rs.map((r) => r.hammerStock), 0.5)}`,
  );
}
