import { Analytics } from './analytics';
import {
  botFighter,
  botPower,
  botScore,
  createBots,
  pickOpponents,
  snapshotFighter,
  type ArenaBot,
  type ArenaOpponent,
  type ArenaTier,
  type DefenseSnapshot,
} from './arena';
import { failureHints, simulatePve, simulatePvp, type BattleResult } from './battle';
import { activeCombos, emptyChain, recommendPlacement, swapNodes, weaknessMatch, type Recommendation } from './chain';
import type { GameConfig } from './config';
import {
  characterStats,
  checkFurnaceUpgrade,
  levelUpCost,
  playerPower,
  statsPower,
  totalStats,
  type FurnaceUpgradeCheck,
  type Stats,
} from './progression';
import { hashSeed, Rng } from './rng';
import { forgeRune, meltValue, newPityState, type PityHit, type PityState } from './rune';
import type { PaymentProvider, ProductInfo } from './shop';
import { enemyFromPower, medianPowerAt, stageEnemy, stageInfo, totalStages, type StageInfo } from './stages';
import { DAY, dayIndex, dayKey, HOUR, MINUTE } from './time';
import { calibrateTutorialBoss, type TutorialStep } from './tutorial';
import { CHAIN_SIZE, type Chain, type ChainFighter, type EnemyDef, type Rune, type RuneType } from './types';

export const SAVE_VERSION = 1;

export interface PendingRune {
  rune: Rune;
  pityHit: PityHit;
}

export interface DailyState {
  dayKey: string;
  progress: Record<string, number>;
  claimed: Record<string, boolean>;
  dailyBossWon: boolean;
  arenaAttemptsUsed: number;
  monthlyClaimed: boolean;
}

export interface StuckState {
  stage: number;
  firstFailAt: number;
  fails: number;
  forgesSince: number;
  adjusted: boolean;
  weaknessAtFail: number;
  weaknessImproved: boolean;
  paid: boolean;
  awaitingNextAction: boolean;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  createdAt: number;
  nextRuneId: number;
  hammers: number;
  gold: number;
  fireXpTotal: number;
  furnaceLevel: number;
  charLevel: number;
  chain: Chain;
  unlockedNodes: number;
  pending: PendingRune[];
  pity: PityState;
  stage: { next: number; attempts: Record<string, number> };
  idle: { unlocked: boolean; lastHammerAt: number; lastGoldAt: number };
  daily: DailyState;
  arena: {
    unlocked: boolean;
    score: number;
    bots: ArenaBot[];
    botsDay: number;
    opponents: ArenaOpponent[];
    snapshot: DefenseSnapshot | null;
    wins: number;
    losses: number;
  };
  shop: {
    firstChargeBought: boolean;
    cosmeticOwned: boolean;
    monthlyStart: number;
    monthlyEnd: number;
    grantedOrders: string[];
  };
  tutorial: {
    step: TutorialStep;
    flags: string[];
    bossWeakness: RuneType[] | null;
    bossPower: number | null;
    skipSwap: boolean;
  };
  milestones: {
    placed: boolean;
    melted: boolean;
    comboSeen: boolean;
    breakSeen: boolean;
    failed: boolean;
    firstChargeShown: boolean;
  };
  stuck: StuckState | null;
  counters: {
    forges: number;
    melts: number;
    placements: number;
    manualPlacements: number;
    recommendAccepted: number;
    nonPurePowerChoices: number;
    swaps: number;
    effectiveRunes: number;
    decidedRunes: number;
    returnDaysLogged: number[];
  };
  gm: {
    timeOffset: number;
    forcedType: RuneType | null;
    forcedQuality: number | null;
    forcedWeakness: RuneType[] | null;
  };
  settings: { sfx: boolean; music: boolean };
}

export type Decision = { kind: 'recommend' } | { kind: 'place'; node: number } | { kind: 'melt' };

export interface DecisionResult {
  placedNode: number | null;
  overwritten: Rune | null;
  fireXp: number;
}

export interface StageBattle {
  info: StageInfo;
  enemy: EnemyDef;
  result: BattleResult;
  hints: string[];
  rewards: { hammers: number; gold: number };
  playerChain: Chain;
  playerMaxHp: number;
}

export interface ArenaBattle {
  opponent: ArenaBot;
  opponentPower: number;
  tier: ArenaTier;
  result: BattleResult;
  scoreDelta: number;
  rewards: { hammers: number; gold: number };
  playerChain: Chain;
  opponentChain: Chain;
}

export interface IdlePreview {
  elapsedMs: number;
  capMs: number;
  hammers: number;
  gold: number;
  goldPerHour: number;
  capped: boolean;
}

export interface GameDeps {
  now: () => number;
  save?: (json: string) => void;
  payment?: PaymentProvider;
}

type Listener = () => void;

export class Game {
  analytics: Analytics;
  private listeners: Listener[] = [];

  constructor(
    public cfg: GameConfig,
    public state: GameState,
    private deps: GameDeps,
  ) {
    this.analytics = new Analytics(() => this.now());
  }

  // ------------------------------------------------------------ 基础

  static newState(cfg: GameConfig, now: number, seed: number): GameState {
    return {
      version: SAVE_VERSION,
      seed,
      rng: hashSeed(seed, 'rng'),
      createdAt: now,
      nextRuneId: 1,
      hammers: cfg.progression.startResources.hammers,
      gold: cfg.progression.startResources.gold,
      fireXpTotal: 0,
      furnaceLevel: 1,
      charLevel: 1,
      chain: emptyChain(),
      unlockedNodes: 2,
      pending: [],
      pity: newPityState(),
      stage: { next: 1, attempts: {} },
      idle: { unlocked: false, lastHammerAt: now, lastGoldAt: now },
      daily: { dayKey: dayKey(now, cfg.economy.daily.resetHour), progress: {}, claimed: {}, dailyBossWon: false, arenaAttemptsUsed: 0, monthlyClaimed: false },
      arena: { unlocked: false, score: cfg.economy.arena.startScore, bots: [], botsDay: 0, opponents: [], snapshot: null, wins: 0, losses: 0 },
      shop: { firstChargeBought: false, cosmeticOwned: false, monthlyStart: 0, monthlyEnd: 0, grantedOrders: [] },
      tutorial: { step: 'forge1', flags: [], bossWeakness: null, bossPower: null, skipSwap: false },
      milestones: { placed: false, melted: false, comboSeen: false, breakSeen: false, failed: false, firstChargeShown: false },
      stuck: null,
      counters: {
        forges: 0,
        melts: 0,
        placements: 0,
        manualPlacements: 0,
        recommendAccepted: 0,
        nonPurePowerChoices: 0,
        swaps: 0,
        effectiveRunes: 0,
        decidedRunes: 0,
        returnDaysLogged: [],
      },
      gm: { timeOffset: 0, forcedType: null, forcedQuality: null, forcedWeakness: null },
      settings: { sfx: true, music: true },
    };
  }

  static loadState(cfg: GameConfig, json: string | null, now: number): GameState | null {
    if (!json) return null;
    try {
      const s = JSON.parse(json) as GameState;
      if (!s || s.version !== SAVE_VERSION || !Array.isArray(s.chain)) return null;
      // 向前兼容：补齐新字段
      const fresh = Game.newState(cfg, now, s.seed ?? 1);
      return { ...fresh, ...s, counters: { ...fresh.counters, ...s.counters }, gm: { ...fresh.gm, ...s.gm }, settings: { ...fresh.settings, ...s.settings } };
    } catch {
      return null;
    }
  }

  onChange(l: Listener): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  now(): number {
    return this.deps.now() + this.state.gm.timeOffset;
  }

  save(): void {
    this.deps.save?.(JSON.stringify(this.state));
  }

  private commit(): void {
    this.save();
    for (const l of this.listeners) l();
  }

  private withRng<T>(fn: (rng: Rng) => T): T {
    const rng = new Rng(this.state.rng);
    const out = fn(rng);
    this.state.rng = rng.state;
    return out;
  }

  setPayment(p: PaymentProvider): void {
    this.deps.payment = p;
  }

  // ------------------------------------------------------------ 会话 / 埋点

  startSession(isFirst: boolean): void {
    this.analytics.newSession();
    if (isFirst) this.analytics.track('first_enter', {});
    this.analytics.track('session_start', { stage: this.state.stage.next, power: this.power() });
    this.ensureDaily();
    this.refreshUnlocks();
    if (this.state.tutorial.step === 'boss' && this.state.tutorial.bossPower === null) this.setupTutorialBoss();
    this.commit();
  }

  endSession(): void {
    this.noteNextAction('exit');
    this.analytics.track('session_end', { stage: this.state.stage.next, power: this.power() });
    this.save();
  }

  private noteNextAction(action: string): void {
    const st = this.state.stuck;
    if (st && st.awaitingNextAction) {
      st.awaitingNextAction = false;
      this.analytics.track('stuck_next_action', { stage: st.stage, action, fails: st.fails });
    }
  }

  // ------------------------------------------------------------ 派生数据

  cleared(): number {
    return this.state.stage.next - 1;
  }

  chaptersCleared(): number {
    return Math.floor(this.cleared() / this.cfg.stages.stagesPerChapter);
  }

  allStagesCleared(): boolean {
    return this.cleared() >= totalStages(this.cfg);
  }

  stats(chain: Chain = this.state.chain): Stats {
    return totalStats(this.cfg, this.state.charLevel, chain);
  }

  power(chain: Chain = this.state.chain): number {
    return playerPower(this.cfg, this.state.charLevel, chain);
  }

  fighter(chain: Chain = this.state.chain): ChainFighter {
    const s = this.stats(chain);
    return { name: '锻造师', atk: s.atk, hp: s.hp, def: s.def, speed: s.speed, chain };
  }

  currentStage(): StageInfo {
    const idx = Math.min(this.state.stage.next, totalStages(this.cfg));
    const info = stageInfo(this.cfg, idx);
    if (info.kind === 'tutorialBoss' && this.state.tutorial.step !== 'done') {
      if (this.state.tutorial.bossWeakness) info.weakness = this.state.tutorial.bossWeakness;
      if (this.state.tutorial.bossPower !== null) info.requiredPower = this.state.tutorial.bossPower;
    }
    if (this.state.gm.forcedWeakness && info.kind !== 'normal') info.weakness = this.state.gm.forcedWeakness;
    return info;
  }

  /** “当前 Boss”：当前关带破绽则取当前关，否则取本章 Boss。 */
  targetWeakness(): { name: string; weakness: RuneType[] } | null {
    const cur = this.currentStage();
    if (cur.weakness) return { name: cur.name, weakness: cur.weakness };
    if (this.allStagesCleared()) return null;
    const per = this.cfg.stages.stagesPerChapter;
    const bossIdx = Math.min(totalStages(this.cfg), cur.chapter * per);
    const boss = stageInfo(this.cfg, bossIdx);
    const w = this.state.gm.forcedWeakness ?? boss.weakness;
    return w ? { name: boss.name, weakness: w } : null;
  }

  isUnlocked(feature: string): boolean {
    const rule = this.cfg.progression.featureUnlocks[feature];
    if (!rule) return true;
    return this.ruleSatisfied(rule);
  }

  private ruleSatisfied(rule: string): boolean {
    if (rule === 'start') return true;
    const [kind, arg] = rule.split(':');
    if (kind === 'stage') return this.cleared() >= Number(arg);
    if (kind === 'tutorial') return arg === 'done' ? this.state.tutorial.step === 'done' : this.state.tutorial.flags.includes(arg) || this.state.tutorial.step === 'done';
    return false;
  }

  private refreshUnlocks(): void {
    const s = this.state;
    let nodes = 0;
    for (const u of this.cfg.progression.nodeUnlocks) if (this.ruleSatisfied(u.at)) nodes = Math.max(nodes, u.nodes);
    if (nodes > s.unlockedNodes) {
      s.unlockedNodes = Math.min(CHAIN_SIZE, nodes);
      this.analytics.track('node_unlock', { nodes: s.unlockedNodes });
    }
    if (!s.idle.unlocked && this.isUnlocked('idle')) {
      s.idle.unlocked = true;
      s.idle.lastHammerAt = this.now();
      s.idle.lastGoldAt = this.now();
      this.analytics.track('feature_unlock', { feature: 'idle' });
    }
    if (!s.arena.unlocked && this.isUnlocked('arena')) {
      s.arena.unlocked = true;
      s.arena.bots = createBots(this.cfg, hashSeed(s.seed, 'bots'), this.power(), s.furnaceLevel);
      s.arena.botsDay = dayIndex(this.now(), this.cfg.economy.daily.resetHour);
      this.refreshOpponents();
      this.updateSnapshot();
      this.analytics.track('feature_unlock', { feature: 'arena' });
    }
  }

  // ------------------------------------------------------------ 锻造 / 放入 / 熔炼

  canForge(n: number): boolean {
    return this.state.pending.length === 0 && this.state.hammers >= n && (n === 1 || this.isUnlocked('tenPull'));
  }

  forge(n: 1 | 10): PendingRune[] {
    const s = this.state;
    if (!this.canForge(n)) return [];
    this.noteNextAction('forge');
    s.hammers -= n;
    const out: PendingRune[] = [];
    this.withRng((rng) => {
      for (let i = 0; i < n; i++) {
        const outcome = forgeRune(
          this.cfg.runes,
          rng,
          s.pity,
          { furnaceLevel: s.furnaceLevel, forcedType: s.gm.forcedType, forcedQuality: s.gm.forcedQuality },
          `r${s.nextRuneId++}`,
        );
        s.gm.forcedType = null;
        s.gm.forcedQuality = null;
        out.push({ rune: outcome.rune, pityHit: outcome.pityHit });
        this.analytics.track('forge', {
          furnace: s.furnaceLevel,
          hammers: 1,
          batch: n,
          type: outcome.rune.type,
          quality: outcome.rune.quality,
          strength: outcome.rune.strength,
          pityHit: outcome.pityHit,
        });
        if (outcome.pityHit === 'firstCharge') {
          this.analytics.track('first_charge_rune', { type: outcome.rune.type, quality: outcome.rune.quality });
        }
      }
    });
    s.pending.push(...out);
    s.counters.forges += n;
    this.dailyProgress('forge', n);
    if (s.stuck) s.stuck.forgesSince += n;
    const step = s.tutorial.step;
    if (step === 'forge1') this.setTutorial('place1');
    else if (step === 'forge2') this.setTutorial('place2');
    else if (step === 'forge3') this.setTutorial('place3');
    this.commit();
    return out;
  }

  currentPending(): PendingRune | null {
    return this.state.pending[0] ?? null;
  }

  /** 教程中强制的推荐节点。 */
  private tutorialForcedNode(): number | null {
    const step = this.state.tutorial.step;
    if (step === 'place1') return 1;
    if (step === 'place2') return 0;
    return null;
  }

  recommendationFor(rune: Rune, chain: Chain = this.state.chain): Recommendation {
    const target = this.targetWeakness();
    const rec = recommendPlacement(this.cfg, this.state.charLevel, chain, this.state.unlockedNodes, rune, target ? target.weakness : null);
    const forced = this.tutorialForcedNode();
    if (forced !== null) {
      const e = rec.all[forced];
      if (e) return { ...rec, best: e, tag: 'strong', effective: true };
    }
    return rec;
  }

  needsConfirm(decision: Decision): Rune | null {
    const p = this.currentPending();
    if (!p) return null;
    const from = this.cfg.runes.confirmQualityFrom;
    if (decision.kind === 'melt') return p.rune.quality >= from ? p.rune : null;
    let node: number | null = null;
    if (decision.kind === 'place') node = decision.node;
    else {
      const rec = this.recommendationFor(p.rune);
      node = rec.tag === 'melt' || !rec.best ? null : rec.best.node;
      if (node === null) return p.rune.quality >= from ? p.rune : null;
    }
    const old = this.state.chain[node];
    return old && old.quality >= from ? old : null;
  }

  decidePending(decision: Decision): DecisionResult | null {
    const s = this.state;
    const p = s.pending[0];
    if (!p) return null;
    const rune = p.rune;
    const rec = this.recommendationFor(rune);
    let node: number | null = null;
    let kind: 'recommend' | 'manual' | 'melt' = 'melt';
    if (decision.kind === 'recommend') {
      node = rec.tag === 'melt' || !rec.best ? null : rec.best.node;
      kind = node === null ? 'melt' : 'recommend';
    } else if (decision.kind === 'place') {
      if (decision.node < 0 || decision.node >= s.unlockedNodes) return null;
      node = decision.node;
      kind = 'manual';
    }

    const weakBefore = this.targetWeakness();
    const matchBefore = weakBefore ? weaknessMatch(s.chain, weakBefore.weakness, this.cfg.battle).full : 0;
    const result: DecisionResult = { placedNode: null, overwritten: null, fireXp: 0 };
    s.counters.decidedRunes++;
    if (rec.effective) s.counters.effectiveRunes++;

    if (node === null) {
      result.fireXp = meltValue(this.cfg.runes, rune);
      s.fireXpTotal += result.fireXp;
      s.counters.melts++;
      s.milestones.melted = true;
      this.dailyProgress('melt', 1);
      this.noteNextAction('melt');
      this.analytics.track('melt', { type: rune.type, quality: rune.quality, source: 'active', fireXp: result.fireXp });
    } else {
      const evalChosen = rec.all[node];
      const old = s.chain[node];
      if (old) {
        const xp = meltValue(this.cfg.runes, old);
        result.fireXp = xp;
        result.overwritten = old;
        s.fireXpTotal += xp;
        s.counters.melts++;
        s.milestones.melted = true;
        this.dailyProgress('melt', 1);
        this.analytics.track('melt', { type: old.type, quality: old.quality, source: 'overwrite', fireXp: xp });
      }
      s.chain = s.chain.slice();
      s.chain[node] = rune;
      result.placedNode = node;
      s.counters.placements++;
      s.milestones.placed = true;
      if (kind === 'manual') s.counters.manualPlacements++;
      else s.counters.recommendAccepted++;
      const maxPower = Math.max(...rec.all.map((e) => e.powerDeltaPct));
      const nonPure = evalChosen && evalChosen.powerDeltaPct < maxPower - 0.01;
      if (nonPure) s.counters.nonPurePowerChoices++;
      this.noteNextAction('place');
      this.analytics.track('rune_decision', {
        decision: kind,
        type: rune.type,
        quality: rune.quality,
        strength: rune.strength,
        recommendedNode: rec.best ? rec.best.node : null,
        finalNode: node,
        powerDeltaPct: evalChosen ? evalChosen.powerDeltaPct : 0,
        combosGained: evalChosen ? evalChosen.gained : [],
        combosLost: evalChosen ? evalChosen.lost : [],
        weaknessBefore: evalChosen ? evalChosen.weakBefore : 0,
        weaknessAfter: evalChosen ? evalChosen.weakAfter : 0,
        nonPurePower: nonPure,
      });
    }
    if (node === null) {
      this.analytics.track('rune_decision', {
        decision: 'melt',
        type: rune.type,
        quality: rune.quality,
        strength: rune.strength,
        recommendedNode: rec.best && rec.tag !== 'melt' ? rec.best.node : null,
        finalNode: null,
      });
    }
    s.pending.shift();
    this.afterChainChange(matchBefore);

    const step = s.tutorial.step;
    if (step === 'place1') this.setTutorial('battle1');
    else if (step === 'place2') this.setTutorial('battle2');
    else if (step === 'place3') this.setTutorial('forgeMore');
    if (s.tutorial.step === 'forgeMore' && s.pending.length === 0 && s.pity.forgeCount >= this.cfg.runes.tutorialForcedTypes.length) {
      this.setTutorial('boss');
    }
    this.commit();
    return result;
  }

  swap(i: number, j: number): void {
    const s = this.state;
    if (i === j || i < 0 || j < 0 || i >= s.unlockedNodes || j >= s.unlockedNodes) return;
    const weak = this.targetWeakness();
    const matchBefore = weak ? weaknessMatch(s.chain, weak.weakness, this.cfg.battle).full : 0;
    const before = s.chain;
    s.chain = swapNodes(s.chain, i, j);
    s.counters.swaps++;
    this.noteNextAction('swap');
    const combosB = activeCombos(before, this.cfg.battle).length;
    const combosA = activeCombos(s.chain, this.cfg.battle).length;
    const matchAfter = weak ? weaknessMatch(s.chain, weak.weakness, this.cfg.battle).full : 0;
    this.analytics.track('chain_swap', {
      from: i,
      to: j,
      powerBefore: this.power(before),
      powerAfter: this.power(),
      combosBefore: combosB,
      combosAfter: combosA,
      weaknessBefore: matchBefore,
      weaknessAfter: matchAfter,
    });
    this.afterChainChange(matchBefore);
    this.commit();
  }

  private afterChainChange(matchBefore: number): void {
    const s = this.state;
    const weak = this.targetWeakness();
    const matchAfter = weak ? weaknessMatch(s.chain, weak.weakness, this.cfg.battle).full : 0;
    if (s.stuck) {
      s.stuck.adjusted = true;
      if (matchAfter > s.stuck.weaknessAtFail) s.stuck.weaknessImproved = true;
    }
    if (s.tutorial.step === 'swap' && weak && matchAfter > 0 && matchAfter > matchBefore - 1) {
      this.setTutorial('bossRetry');
    } else if (s.tutorial.step === 'bossRetry' && weak && matchAfter === 0) {
      this.setTutorial('swap');
    }
    this.updateSnapshot();
  }

  // ------------------------------------------------------------ 教程

  private setTutorial(step: TutorialStep): void {
    const t = this.state.tutorial;
    if (t.step === step) return;
    t.step = step;
    this.analytics.track('tutorial_step', { step });
    if (step === 'forge3' && !t.flags.includes('afterBattle2')) t.flags.push('afterBattle2');
    if (step === 'boss') this.setupTutorialBoss();
    if (step === 'done') {
      this.state.hammers += this.cfg.progression.tutorialRewards.doneHammers;
      this.analytics.track('tutorial_complete', { forges: this.state.counters.forges });
    }
    this.refreshUnlocks();
  }

  private setupTutorialBoss(): void {
    const info = stageInfo(this.cfg, this.state.stage.next);
    const sp = this.cfg.stages.specialStages.find((x) => x.kind === 'tutorialBoss');
    const preferred = sp ? sp.weakness : (['ji', 'feng'] as RuneType[]);
    const setup = calibrateTutorialBoss(
      this.cfg,
      (c) => this.fighter(c),
      this.state.chain,
      this.state.unlockedNodes,
      preferred,
      info.name,
      this.tutorialSeed(),
    );
    this.state.tutorial.bossWeakness = setup.weakness;
    this.state.tutorial.bossPower = setup.power;
    this.state.tutorial.skipSwap = setup.skipSwap;
  }

  private tutorialSeed(): number {
    return hashSeed(this.state.seed, 'tutorialBoss');
  }

  skipTutorial(): void {
    const s = this.state;
    if (s.tutorial.step === 'done') return;
    if (!s.tutorial.flags.includes('afterBattle2')) s.tutorial.flags.push('afterBattle2');
    s.pity.forgeCount = Math.max(s.pity.forgeCount, this.cfg.runes.tutorialForcedTypes.length);
    if (s.stage.next <= 3) s.stage.next = 4;
    this.setTutorial('done');
    this.commit();
  }

  // ------------------------------------------------------------ 主线战斗

  stageEnemyNow(): EnemyDef {
    const info = this.currentStage();
    return stageEnemy(this.cfg, info);
  }

  challengeStage(): StageBattle | null {
    const s = this.state;
    if (this.allStagesCleared() || s.pending.length > 0) return null;
    this.ensureDaily();
    const step = s.tutorial.step;
    if (step !== 'done' && !['battle1', 'battle2', 'boss', 'bossRetry', 'swap'].includes(step)) return null;
    this.noteNextAction('retry');
    const info = this.currentStage();
    const enemy = stageEnemy(this.cfg, info);
    const key = String(info.index);
    s.stage.attempts[key] = (s.stage.attempts[key] ?? 0) + 1;
    const seed = info.kind === 'tutorialBoss' && step !== 'done' ? this.tutorialSeed() : hashSeed(s.seed, 'stage', info.index, s.stage.attempts[key]);
    const chain = s.chain.slice();
    const fighter = this.fighter(chain);
    const result = simulatePve(this.cfg, fighter, enemy, seed);
    const combos = activeCombos(chain, this.cfg.battle);
    const weakMatch = enemy.weakness ? weaknessMatch(chain, enemy.weakness, this.cfg.battle).full : 0;

    this.dailyProgress('stage', 1);
    if (Object.keys(result.stats.combos).some((k) => result.stats.combos[k] > 0)) s.milestones.comboSeen = true;
    if (result.stats.breaks > 0) s.milestones.breakSeen = true;

    this.analytics.track('battle', {
      source: 'stage',
      stage: info.index,
      kind: info.kind,
      playerPower: this.power(chain),
      enemyPower: Math.round(info.requiredPower),
      chainTypes: chain.map((r) => (r ? r.type : null)),
      combosTriggered: result.stats.combos,
      breaks: result.stats.breaks,
      win: result.win,
      reason: result.reason,
      rounds: result.stats.rounds,
      attempt: s.stage.attempts[key],
    });

    const rewards = { hammers: 0, gold: 0 };
    if (result.win) {
      rewards.hammers = info.hammers;
      rewards.gold = info.gold;
      if (info.kind === 'tutorialBoss' && step !== 'done') rewards.hammers += this.cfg.progression.tutorialRewards.bossWinHammers;
      s.hammers += rewards.hammers;
      s.gold += rewards.gold;
      s.stage.next = info.index + 1;
      if (s.stuck && s.stuck.stage === info.index) {
        this.analytics.track('stuck_pass', {
          stage: info.index,
          fails: s.stuck.fails,
          durationMs: this.now() - s.stuck.firstFailAt,
          forgesSince: s.stuck.forgesSince,
          adjusted: s.stuck.adjusted,
          weaknessImproved: s.stuck.weaknessImproved,
          paid: s.stuck.paid,
        });
        s.stuck = null;
      }
      if (step === 'battle1') this.setTutorial('forge2');
      else if (step === 'battle2') this.setTutorial('forge3');
      else if (step === 'boss' || step === 'bossRetry' || step === 'swap') this.setTutorial('done');
      this.refreshUnlocks();
    } else {
      s.milestones.failed = true;
      if (!s.stuck || s.stuck.stage !== info.index) {
        s.stuck = {
          stage: info.index,
          firstFailAt: this.now(),
          fails: 1,
          forgesSince: 0,
          adjusted: false,
          weaknessAtFail: weakMatch,
          weaknessImproved: false,
          paid: false,
          awaitingNextAction: true,
        };
        this.analytics.track('stuck_first_fail', { stage: info.index, power: this.power(chain), enemyPower: Math.round(info.requiredPower), weaknessMatch: weakMatch });
      } else {
        s.stuck.fails++;
        s.stuck.awaitingNextAction = true;
      }
      if (step === 'boss' || step === 'bossRetry') this.setTutorial('swap');
    }

    const hints = failureHints(result, { cfg: this.cfg, enemyWeakness: enemy.weakness, comboCount: combos.length });
    this.commit();
    return { info, enemy, result, hints, rewards, playerChain: chain, playerMaxHp: fighter.hp };
  }

  // ------------------------------------------------------------ 成长

  furnaceCheck(): FurnaceUpgradeCheck {
    const s = this.state;
    return checkFurnaceUpgrade(this.cfg, s.furnaceLevel, s.fireXpTotal, this.chaptersCleared(), s.gold);
  }

  upgradeFurnace(): boolean {
    const c = this.furnaceCheck();
    if (!c.can || !c.next) return false;
    const s = this.state;
    s.gold -= c.next.gold;
    s.furnaceLevel = c.next.level;
    this.analytics.track('furnace_upgrade', { level: s.furnaceLevel, sinceStartMs: this.now() - s.createdAt, fireXp: s.fireXpTotal });
    this.commit();
    return true;
  }

  levelUpCost(): number {
    return levelUpCost(this.cfg, this.state.charLevel);
  }

  levelUp(): boolean {
    const s = this.state;
    if (s.charLevel >= this.cfg.progression.character.maxLevel) return false;
    const cost = this.levelUpCost();
    if (s.gold < cost) return false;
    s.gold -= cost;
    s.charLevel++;
    this.analytics.track('char_level', { level: s.charLevel, cost });
    this.updateSnapshot();
    this.commit();
    return true;
  }

  characterBaseStats(): Stats {
    return characterStats(this.cfg, this.state.charLevel);
  }

  // ------------------------------------------------------------ 挂机

  monthlyActive(): boolean {
    return this.now() < this.state.shop.monthlyEnd;
  }

  idleCapMs(): number {
    const e = this.cfg.economy.idle;
    const hours = this.monthlyActive() ? this.cfg.shop.monthlyCard.idleCapHours : e.freeCapHours;
    return hours * HOUR;
  }

  goldPerHour(): number {
    const e = this.cfg.economy.idle;
    const base = e.goldPerHourBase + e.goldPerHourPerStage * this.cleared();
    return base * (this.monthlyActive() ? 1 + this.cfg.shop.monthlyCard.idleGoldBonus : 1);
  }

  idlePreview(): IdlePreview {
    const s = this.state;
    const now = this.now();
    const capMs = this.idleCapMs();
    if (!s.idle.unlocked) return { elapsedMs: 0, capMs, hammers: 0, gold: 0, goldPerHour: this.goldPerHour(), capped: false };
    const interval = this.cfg.economy.idle.hammerIntervalMinutes * MINUTE;
    const hElapsed = Math.min(Math.max(0, now - s.idle.lastHammerAt), capMs);
    const gElapsed = Math.min(Math.max(0, now - s.idle.lastGoldAt), capMs);
    return {
      elapsedMs: gElapsed,
      capMs,
      hammers: Math.floor(hElapsed / interval),
      gold: Math.floor((gElapsed / HOUR) * this.goldPerHour()),
      goldPerHour: this.goldPerHour(),
      capped: now - s.idle.lastGoldAt >= capMs,
    };
  }

  claimIdle(): IdlePreview | null {
    const s = this.state;
    if (!s.idle.unlocked) return null;
    const pv = this.idlePreview();
    if (pv.hammers === 0 && pv.gold === 0) return pv;
    const now = this.now();
    const interval = this.cfg.economy.idle.hammerIntervalMinutes * MINUTE;
    s.hammers += pv.hammers;
    s.gold += pv.gold;
    if (now - s.idle.lastHammerAt >= pv.capMs) s.idle.lastHammerAt = now;
    else s.idle.lastHammerAt += pv.hammers * interval;
    s.idle.lastGoldAt = now;
    this.analytics.track('idle_claim', { hammers: pv.hammers, gold: pv.gold, elapsedMs: pv.elapsedMs, capped: pv.capped, monthly: this.monthlyActive() });
    this.commit();
    return pv;
  }

  // ------------------------------------------------------------ 日常 / 每日 Boss

  ensureDaily(): void {
    const s = this.state;
    const now = this.now();
    const reset = this.cfg.economy.daily.resetHour;
    const key = dayKey(now, reset);
    if (s.daily.dayKey !== key) {
      s.daily = { dayKey: key, progress: {}, claimed: {}, dailyBossWon: false, arenaAttemptsUsed: 0, monthlyClaimed: false };
      if (s.arena.unlocked) this.withRng((rng) => this.refreshOpponents(rng));
    }
    const days = dayIndex(now, reset) - dayIndex(s.createdAt, reset);
    for (const d of [1, 3, 7]) {
      if (days === d && !s.counters.returnDaysLogged.includes(d)) {
        s.counters.returnDaysLogged.push(d);
        this.analytics.track('day_return', { day: d });
      }
    }
  }

  private dailyProgress(event: string, n: number): void {
    if (!this.isUnlocked('daily')) return;
    this.ensureDaily();
    const p = this.state.daily.progress;
    for (const t of this.cfg.economy.daily.tasks) {
      if (t.event === event) p[t.id] = (p[t.id] ?? 0) + n;
    }
  }

  dailyGoldScale(): number {
    return 1 + this.cleared() * this.cfg.economy.daily.goldScalePerStage;
  }

  claimTask(id: string): boolean {
    this.ensureDaily();
    const t = this.cfg.economy.daily.tasks.find((x) => x.id === id);
    const d = this.state.daily;
    if (!t || d.claimed[id] || (d.progress[id] ?? 0) < t.target) return false;
    d.claimed[id] = true;
    const gold = Math.round(t.gold * this.dailyGoldScale());
    this.state.hammers += t.hammers;
    this.state.gold += gold;
    this.analytics.track('daily_claim', { task: id, hammers: t.hammers, gold });
    this.commit();
    return true;
  }

  dailyBossEnemy(): EnemyDef {
    const db = this.cfg.economy.daily.dailyBoss;
    const idx = dayIndex(this.now(), this.cfg.economy.daily.resetHour);
    const weakness = this.state.gm.forcedWeakness ?? db.weaknessRotation[idx % db.weaknessRotation.length];
    const power = medianPowerAt(this.cfg, this.cleared()) * db.powerFactor;
    return enemyFromPower(this.cfg, power, true, db.name, weakness, '每日一次的资源战');
  }

  challengeDailyBoss(): StageBattle | null {
    if (!this.isUnlocked('dailyBoss') || this.state.pending.length > 0) return null;
    this.ensureDaily();
    const s = this.state;
    const enemy = this.dailyBossEnemy();
    const chain = s.chain.slice();
    const fighter = this.fighter(chain);
    const seed = hashSeed(s.seed, 'daily', s.daily.dayKey, s.counters.forges, s.counters.swaps);
    const result = simulatePve(this.cfg, fighter, enemy, seed);
    const rewards = { hammers: 0, gold: 0 };
    if (result.win && !s.daily.dailyBossWon) {
      const db = this.cfg.economy.daily.dailyBoss;
      s.daily.dailyBossWon = true;
      rewards.hammers = db.hammers;
      rewards.gold = Math.round(db.gold * this.dailyGoldScale());
      s.hammers += rewards.hammers;
      s.gold += rewards.gold;
      this.dailyProgress('dailyBossWin', 1);
    }
    if (result.stats.breaks > 0) s.milestones.breakSeen = true;
    this.analytics.track('battle', {
      source: 'dailyBoss',
      playerPower: this.power(chain),
      enemyPower: Math.round(medianPowerAt(this.cfg, this.cleared())),
      chainTypes: chain.map((r) => (r ? r.type : null)),
      combosTriggered: result.stats.combos,
      breaks: result.stats.breaks,
      win: result.win,
      reason: result.reason,
      rounds: result.stats.rounds,
    });
    const info: StageInfo = {
      ...stageInfo(this.cfg, Math.max(1, Math.min(this.state.stage.next, totalStages(this.cfg)))),
      kind: 'miniBoss',
      name: enemy.name,
      label: '每日',
      weakness: enemy.weakness,
      tendency: enemy.tendency ?? null,
      hammers: rewards.hammers,
      gold: rewards.gold,
    };
    const hints = failureHints(result, { cfg: this.cfg, enemyWeakness: enemy.weakness, comboCount: activeCombos(chain, this.cfg.battle).length });
    this.commit();
    return { info, enemy, result, hints, rewards, playerChain: chain, playerMaxHp: fighter.hp };
  }

  // ------------------------------------------------------------ 竞技场

  arenaDays(): number {
    return dayIndex(this.now(), this.cfg.economy.daily.resetHour) - this.state.arena.botsDay;
  }

  private refreshOpponents(rng?: Rng): void {
    const a = this.state.arena;
    if (!a.unlocked) return;
    const run = (r: Rng) => {
      a.opponents = pickOpponents(this.cfg, a.bots, this.power(), this.arenaDays(), r);
    };
    if (rng) run(rng);
    else this.withRng(run);
  }

  private updateSnapshot(): void {
    const a = this.state.arena;
    if (!a.unlocked) return;
    const st = this.stats();
    a.snapshot = {
      atk: st.atk,
      hp: st.hp,
      def: st.def,
      speed: st.speed,
      power: statsPower(st),
      chain: this.state.chain.map((r) => (r ? { type: r.type, quality: r.quality, strength: r.strength } : null)),
      savedAt: this.now(),
    };
  }

  arenaAttemptsLeft(): number {
    this.ensureDaily();
    return Math.max(0, this.cfg.economy.arena.freeAttempts - this.state.daily.arenaAttemptsUsed);
  }

  arenaOpponents(): { bot: ArenaBot; tier: ArenaTier; power: number }[] {
    const a = this.state.arena;
    return a.opponents
      .map((o) => {
        const bot = a.bots.find((b) => b.id === o.botId);
        return bot ? { bot, tier: o.tier, power: botPower(this.cfg, bot, this.arenaDays()) } : null;
      })
      .filter((x): x is { bot: ArenaBot; tier: ArenaTier; power: number } => !!x);
  }

  challengeArena(slot: number): ArenaBattle | null {
    const s = this.state;
    if (!s.arena.unlocked || this.arenaAttemptsLeft() <= 0 || s.pending.length > 0) return null;
    const opp = this.arenaOpponents()[slot];
    if (!opp) return null;
    const ac = this.cfg.economy.arena;
    s.daily.arenaAttemptsUsed++;
    const chain = s.chain.slice();
    const fighter = this.fighter(chain);
    const oppFighter = botFighter(this.cfg, opp.bot, opp.power);
    const seed = hashSeed(s.seed, 'arena', s.daily.dayKey, s.daily.arenaAttemptsUsed, opp.bot.id);
    const result = simulatePvp(this.cfg, fighter, oppFighter, seed);
    const scoreDelta = result.win ? ac.winScore[opp.tier] : ac.loseScore;
    s.arena.score = Math.max(0, s.arena.score + scoreDelta);
    if (result.win) s.arena.wins++;
    else s.arena.losses++;
    const rewards = { hammers: ac.rewardHammers, gold: Math.round(ac.rewardGold * this.dailyGoldScale()) };
    s.hammers += rewards.hammers;
    s.gold += rewards.gold;
    this.dailyProgress('arena', 1);
    this.analytics.track('arena_challenge', {
      tier: opp.tier,
      opponentPower: opp.power,
      playerPower: this.power(chain),
      win: result.win,
      scoreDelta,
      score: s.arena.score,
      chainTypes: chain.map((r) => (r ? r.type : null)),
    });
    this.refreshOpponents();
    this.commit();
    return { opponent: opp.bot, opponentPower: opp.power, tier: opp.tier, result, scoreDelta, rewards, playerChain: chain, opponentChain: oppFighter.chain };
  }

  leaderboard(): { rank: number; name: string; score: number; power: number; isSelf: boolean; isTestData: boolean }[] {
    const a = this.state.arena;
    const days = this.arenaDays();
    const rows = a.bots.map((b) => ({ name: b.name, score: botScore(this.cfg, b, days), power: botPower(this.cfg, b, days), isSelf: false, isTestData: true }));
    rows.push({ name: '我', score: a.score, power: this.power(), isSelf: true, isTestData: false });
    rows.sort((x, y) => y.score - x.score || (x.isSelf ? -1 : 1));
    return rows.map((r, i) => ({ rank: i + 1, ...r }));
  }

  snapshotAsFighter(): ChainFighter | null {
    const snap = this.state.arena.snapshot;
    return snap ? snapshotFighter('我的防守', snap) : null;
  }

  // ------------------------------------------------------------ 商业化

  firstChargeVisible(): boolean {
    const s = this.state;
    if (s.shop.firstChargeBought || !this.isUnlocked('shop')) return false;
    const c = this.cfg.shop.firstChargeShow;
    const m = s.milestones;
    const ok =
      s.counters.forges >= c.minForges &&
      (!c.needPlace || m.placed) &&
      (!c.needMelt || m.melted) &&
      (!c.needCombo || m.comboSeen) &&
      (!c.needBreak || m.breakSeen) &&
      (!c.needFail || m.failed);
    return ok;
  }

  noteShopShown(): void {
    const s = this.state;
    if (this.firstChargeVisible() && !s.milestones.firstChargeShown) {
      s.milestones.firstChargeShown = true;
      this.analytics.track('pay_show', { product: this.cfg.shop.firstCharge.id, forges: s.counters.forges, stage: s.stage.next });
      this.save();
    }
    this.analytics.track('monthly_show', { active: this.monthlyActive() });
    this.noteNextAction('shop_open');
  }

  products(): { firstCharge: ProductInfo; monthlyCard: ProductInfo } {
    const f = this.cfg.shop.firstCharge;
    const m = this.cfg.shop.monthlyCard;
    return { firstCharge: { id: f.id, name: f.name, price: f.price }, monthlyCard: { id: m.id, name: m.name, price: m.price } };
  }

  async purchase(productId: string): Promise<{ ok: boolean; error?: string }> {
    const s = this.state;
    const prods = this.products();
    const product = productId === prods.firstCharge.id ? prods.firstCharge : productId === prods.monthlyCard.id ? prods.monthlyCard : null;
    if (!product) return { ok: false, error: 'unknown_product' };
    if (product.id === prods.firstCharge.id && s.shop.firstChargeBought) return { ok: false, error: 'already_bought' };
    if (!this.deps.payment) return { ok: false, error: 'no_payment' };
    this.analytics.track('pay_click', { product: product.id });
    this.analytics.track('pay_order', { product: product.id, price: product.price });
    const res = await this.deps.payment.pay(product);
    if (!res.ok || !res.orderId) {
      this.analytics.track('pay_fail', { product: product.id, error: res.error });
      return { ok: false, error: res.error };
    }
    const granted = this.grantOrder(product.id, res.orderId);
    return granted ? { ok: true } : { ok: false, error: 'duplicate_order' };
  }

  /** 到账（幂等：同一订单只发一次）。 */
  grantOrder(productId: string, orderId: string): boolean {
    const s = this.state;
    if (s.shop.grantedOrders.includes(orderId)) return false;
    const f = this.cfg.shop.firstCharge;
    const m = this.cfg.shop.monthlyCard;
    if (productId === f.id) {
      if (s.shop.firstChargeBought) return false;
      s.shop.firstChargeBought = true;
      s.shop.cosmeticOwned = true;
      s.hammers += f.hammers;
      if (f.epicGuarantee) s.pity.firstChargeEpicPending = true;
    } else if (productId === m.id) {
      const now = this.now();
      if (!this.monthlyActive()) {
        s.shop.monthlyStart = now;
        s.shop.monthlyEnd = now + m.days * DAY;
      } else {
        s.shop.monthlyEnd += m.days * DAY;
      }
      this.analytics.track('monthly_buy', { end: s.shop.monthlyEnd });
    } else {
      return false;
    }
    s.shop.grantedOrders.push(orderId);
    if (s.stuck) s.stuck.paid = true;
    this.analytics.track('pay_success', { product: productId, orderId, stage: s.stage.next, power: this.power() });
    this.commit();
    return true;
  }

  monthlyDaysLeft(): number {
    if (!this.monthlyActive()) return 0;
    return Math.ceil((this.state.shop.monthlyEnd - this.now()) / DAY);
  }

  canClaimMonthly(): boolean {
    this.ensureDaily();
    return this.monthlyActive() && !this.state.daily.monthlyClaimed;
  }

  claimMonthly(): boolean {
    if (!this.canClaimMonthly()) return false;
    const n = this.cfg.shop.monthlyCard.dailyHammers;
    this.state.daily.monthlyClaimed = true;
    this.state.hammers += n;
    this.analytics.track('monthly_claim', { hammers: n, daysLeft: this.monthlyDaysLeft() });
    this.commit();
    return true;
  }

  // ------------------------------------------------------------ GM（仅内部测试）

  gm = {
    addGold: (n: number) => {
      this.state.gold += n;
      this.commit();
    },
    addHammers: (n: number) => {
      this.state.hammers += n;
      this.commit();
    },
    setFurnace: (lv: number) => {
      const max = this.cfg.progression.furnace.length;
      this.state.furnaceLevel = Math.max(1, Math.min(max, lv));
      this.commit();
    },
    setStage: (next: number) => {
      this.state.stage.next = Math.max(1, Math.min(totalStages(this.cfg) + 1, next));
      if (this.state.stage.next > 3 && this.state.tutorial.step !== 'done') this.skipTutorial();
      this.refreshUnlocks();
      this.commit();
    },
    setCharLevel: (lv: number) => {
      this.state.charLevel = Math.max(1, Math.min(this.cfg.progression.character.maxLevel, lv));
      this.updateSnapshot();
      this.commit();
    },
    forceNextType: (t: RuneType | null) => {
      this.state.gm.forcedType = t;
      this.commit();
    },
    forceNextQuality: (q: number | null) => {
      this.state.gm.forcedQuality = q;
      this.commit();
    },
    forceWeakness: (w: RuneType[] | null) => {
      this.state.gm.forcedWeakness = w;
      this.commit();
    },
    clearFirstCharge: () => {
      const s = this.state;
      s.shop.firstChargeBought = false;
      s.shop.cosmeticOwned = false;
      s.pity.firstChargeEpicPending = false;
      s.milestones.firstChargeShown = false;
      this.commit();
    },
    simulateMonthly: () => {
      this.grantOrder(this.cfg.shop.monthlyCard.id, `gm-${this.now()}`);
    },
    advanceTime: (ms: number) => {
      this.state.gm.timeOffset += ms;
      this.ensureDaily();
      this.commit();
    },
    unlockAllNodes: () => {
      this.state.unlockedNodes = CHAIN_SIZE;
      this.commit();
    },
  };
}
