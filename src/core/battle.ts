import type { BattleConfig, GameConfig } from './config';
import { prevIndex } from './chain';
import { Rng } from './rng';
import type { Chain, ChainFighter, EnemyDef, RuneType } from './types';

export type Side = 'p' | 'e';

export interface NodeEvent {
  k: 'node';
  side: Side;
  idx: number;
  type: RuneType;
  round: number;
  skipped: boolean;
  dmg: number;
  absorbed: number;
  shieldGain: number;
  stunTried: boolean;
  stunOk: boolean;
  combos: string[];
  triple: string | null;
  boosted: boolean;
  vulnerable: boolean;
  pHp: number;
  eHp: number;
  pShield: number;
  eShield: number;
}

export interface BreakEvent {
  k: 'break';
  side: Side;
  idx: number;
  dmg: number;
  pHp: number;
  eHp: number;
}

export interface AttackEvent {
  k: 'attack';
  side: Side;
  dmg: number;
  absorbed: number;
  skipped: boolean;
  pHp: number;
  eHp: number;
  pShield: number;
  eShield: number;
}

export interface EndEvent {
  k: 'end';
  win: boolean;
  reason: 'kill' | 'dead' | 'timeout';
}

export type BattleEvent = NodeEvent | BreakEvent | AttackEvent | EndEvent;

export interface BattleStats {
  combos: Record<string, number>;
  triples: Record<string, number>;
  breaks: number;
  stunsTried: number;
  stunsOk: number;
  dmgDealt: number;
  dmgTaken: number;
  shieldAbsorbed: number;
  nodes: number;
  rounds: number;
}

export interface BattleResult {
  win: boolean;
  reason: 'kill' | 'dead' | 'timeout';
  events: BattleEvent[];
  stats: BattleStats;
  pMaxHp: number;
  eMaxHp: number;
  pHpEnd: number;
  eHpEnd: number;
}

interface Actor {
  side: Side;
  name: string;
  atk: number;
  maxHp: number;
  hp: number;
  def: number;
  speed: number;
  shield: number;
  stunned: boolean;
  chain: Chain | null;
  filled: number[];
  pointer: number;
  round: number;
  lastIdx: number;
  lastStunOk: boolean;
  seq: RuneType[];
  breaksThisRound: number;
  vulnerableNodes: number;
  weakness: RuneType[] | null;
  actEvery: number;
  counter: number;
}

function makeChainActor(side: Side, f: ChainFighter, weakness: RuneType[] | null = null): Actor {
  const filled: number[] = [];
  f.chain.forEach((r, i) => {
    if (r) filled.push(i);
  });
  return {
    side,
    name: f.name,
    atk: f.atk,
    maxHp: f.hp,
    hp: f.hp,
    def: f.def,
    speed: f.speed,
    shield: 0,
    stunned: false,
    chain: f.chain,
    filled,
    pointer: 0,
    round: 0,
    lastIdx: -1,
    lastStunOk: false,
    seq: [],
    breaksThisRound: 0,
    vulnerableNodes: 0,
    weakness,
    actEvery: 0,
    counter: 0,
  };
}

function makeSimpleActor(side: Side, e: EnemyDef): Actor {
  return {
    side,
    name: e.name,
    atk: e.atk,
    maxHp: e.hp,
    hp: e.hp,
    def: e.def,
    speed: e.speed,
    shield: 0,
    stunned: false,
    chain: null,
    filled: [],
    pointer: 0,
    round: 0,
    lastIdx: -1,
    lastStunOk: false,
    seq: [],
    breaksThisRound: 0,
    vulnerableNodes: 0,
    weakness: e.weakness,
    actEvery: Math.max(1, e.actEvery),
    counter: 0,
  };
}

function combine(base: number, bonuses: number[], mode: BattleConfig['stacking']): number {
  if (mode === 'multiplicative') return bonuses.reduce((v, b) => v * (1 + b), base);
  return base * (1 + bonuses.reduce((a, b) => a + b, 0));
}

function endsWith(seq: RuneType[], pattern: RuneType[]): boolean {
  if (seq.length < pattern.length) return false;
  const off = seq.length - pattern.length;
  for (let i = 0; i < pattern.length; i++) if (seq[off + i] !== pattern[i]) return false;
  return true;
}

class Sim {
  events: BattleEvent[] = [];
  stats: BattleStats = {
    combos: {},
    triples: {},
    breaks: 0,
    stunsTried: 0,
    stunsOk: 0,
    dmgDealt: 0,
    dmgTaken: 0,
    shieldAbsorbed: 0,
    nodes: 0,
    rounds: 0,
  };

  constructor(
    private cfg: GameConfig,
    private rng: Rng,
    public p: Actor,
    public e: Actor,
  ) {}

  private defFactor(target: Actor): number {
    const K = this.cfg.battle.defConstant;
    return K / (K + Math.max(0, target.def));
  }

  private applyDamage(target: Actor, amount: number): number {
    const absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed;
    target.hp -= amount - absorbed;
    if (target.side === 'e') this.stats.dmgDealt += amount;
    else {
      this.stats.dmgTaken += amount - absorbed;
      this.stats.shieldAbsorbed += absorbed;
    }
    return absorbed;
  }

  private snapshot() {
    return {
      pHp: Math.max(0, this.p.hp),
      eHp: Math.max(0, this.e.hp),
      pShield: this.p.shield,
      eShield: this.e.shield,
    };
  }

  /** 执行一个战纹节点。返回 true 表示本步有节点被“消耗”（含眩晕跳过）。 */
  chainStep(self: Actor, target: Actor): void {
    const b = this.cfg.battle;
    const rc = this.cfg.runes;
    if (self.filled.length === 0) {
      self.round++;
      return;
    }
    if (self.pointer === 0) {
      self.round++;
      self.breaksThisRound = 0;
      if (!b.wrapAdjacency) {
        self.lastIdx = -1;
        self.seq = [];
        self.lastStunOk = false;
      }
    }
    const idx = self.filled[self.pointer];
    self.pointer = (self.pointer + 1) % self.filled.length;
    const chain = self.chain!;
    const rune = chain[idx]!;

    if (self.stunned) {
      self.stunned = false;
      self.lastIdx = -1;
      self.seq = [];
      self.lastStunOk = false;
      this.events.push({
        k: 'node',
        side: self.side,
        idx,
        type: rune.type,
        round: self.round,
        skipped: true,
        dmg: 0,
        absorbed: 0,
        shieldGain: 0,
        stunTried: false,
        stunOk: false,
        combos: [],
        triple: null,
        boosted: false,
        vulnerable: false,
        ...this.snapshot(),
      });
      return;
    }

    const p = prevIndex(idx, b);
    const adjacent = p >= 0 && self.lastIdx === p;
    const prevRune = adjacent ? chain[p] : null;
    if (adjacent) self.seq.push(rune.type);
    else self.seq = [rune.type];
    if (self.seq.length > 8) self.seq.shift();

    const combos = prevRune ? b.combos.filter((c) => c.from === prevRune.type && c.to === rune.type) : [];
    const triple = b.triples.find((t) => endsWith(self.seq, t.seq)) ?? null;
    const qm = rc.qualityEffectMult[rune.quality] ?? 1;
    const boost = prevRune && prevRune.type === 'ji' ? b.ji.nextBoost * (rc.qualityEffectMult[prevRune.quality] ?? 1) : 0;
    const boosts: number[] = boost > 0 ? [boost] : [];

    let dmg = 0;
    let shieldGain = 0;
    let stunTried = false;
    let stunOk = false;

    switch (rune.type) {
      case 'feng': {
        const bonuses = [...boosts];
        for (const c of combos) {
          if (c.dmgBonus) bonuses.push(c.dmgBonus);
          if (c.dmgBonusIfStun && self.lastStunOk) bonuses.push(c.dmgBonusIfStun);
        }
        if (triple) bonuses.push(triple.dmgBonus);
        dmg = combine(self.atk * b.feng.dmg * qm, bonuses, b.stacking);
        for (const c of combos) if (c.shieldToDmg) dmg += self.shield * c.shieldToDmg;
        break;
      }
      case 'zhen': {
        const bonuses = [...boosts];
        if (triple) bonuses.push(triple.dmgBonus);
        dmg = combine(self.atk * b.zhen.dmg * qm, bonuses, b.stacking);
        let chance = b.zhen.stunChance + (b.ji.boostAffectsStunChance ? boost : 0);
        for (const c of combos) if (c.stunChanceSet !== undefined) chance = Math.max(chance, c.stunChanceSet);
        stunTried = true;
        stunOk = this.rng.next() < chance;
        this.stats.stunsTried++;
        if (stunOk) {
          target.stunned = true;
          this.stats.stunsOk++;
        }
        break;
      }
      case 'yu': {
        const bonuses = [...boosts];
        for (const c of combos) if (c.shieldBonus) bonuses.push(c.shieldBonus);
        shieldGain = combine(self.maxHp * b.yu.shieldPctMaxHp * qm, bonuses, b.stacking);
        self.shield = b.yu.stackMode === 'add' ? self.shield + shieldGain : Math.max(self.shield, shieldGain);
        break;
      }
      case 'ji':
        break;
    }

    const vulnerable = target.vulnerableNodes > 0;
    let absorbed = 0;
    let dealt = 0;
    if (dmg > 0) {
      dealt = dmg * (vulnerable ? 1 + b.break.dmgTakenBonus : 1) * this.defFactor(target);
      absorbed = this.applyDamage(target, dealt);
    }
    if (target.vulnerableNodes > 0) target.vulnerableNodes--;

    for (const c of combos) this.stats.combos[c.id] = (this.stats.combos[c.id] ?? 0) + (self.side === 'p' ? 1 : 0);
    if (triple && self.side === 'p') this.stats.triples[triple.id] = (this.stats.triples[triple.id] ?? 0) + 1;
    if (self.side === 'p') this.stats.nodes++;

    this.events.push({
      k: 'node',
      side: self.side,
      idx,
      type: rune.type,
      round: self.round,
      skipped: false,
      dmg: dealt,
      absorbed,
      shieldGain,
      stunTried,
      stunOk,
      combos: combos.map((c) => c.id),
      triple: triple ? triple.id : null,
      boosted: boost > 0,
      vulnerable,
      ...this.snapshot(),
    });

    self.lastIdx = idx;
    self.lastStunOk = rune.type === 'zhen' && stunOk;

    // 破绽：本方连续触发的类型顺序与对方破绽谱一致
    if (target.weakness && target.weakness.length > 0 && self.breaksThisRound < b.break.maxPerRound && target.hp > 0) {
      if (endsWith(self.seq, target.weakness)) {
        const instant = self.atk * b.break.instantDmg * this.defFactor(target);
        this.applyDamage(target, instant);
        target.vulnerableNodes = b.break.durationNodes;
        self.breaksThisRound++;
        if (self.side === 'p') this.stats.breaks++;
        this.events.push({ k: 'break', side: self.side, idx, dmg: instant, pHp: Math.max(0, this.p.hp), eHp: Math.max(0, this.e.hp) });
      }
    }
  }

  simpleAttack(self: Actor, target: Actor): void {
    if (self.stunned) {
      self.stunned = false;
      this.events.push({ k: 'attack', side: self.side, dmg: 0, absorbed: 0, skipped: true, ...this.snapshot() });
      return;
    }
    const dmg = self.atk * this.defFactor(target);
    const absorbed = this.applyDamage(target, dmg);
    this.events.push({ k: 'attack', side: self.side, dmg, absorbed, skipped: false, ...this.snapshot() });
  }

  dead(): 'p' | 'e' | null {
    if (this.e.hp <= 0) return 'e';
    if (this.p.hp <= 0) return 'p';
    return null;
  }

  finish(reason: 'kill' | 'dead' | 'timeout'): BattleResult {
    let win: boolean;
    if (reason === 'timeout') {
      win = Math.max(0, this.p.hp) / this.p.maxHp > Math.max(0, this.e.hp) / this.e.maxHp;
    } else {
      win = reason === 'kill';
    }
    this.stats.rounds = this.p.round;
    this.events.push({ k: 'end', win, reason });
    return {
      win,
      reason,
      events: this.events,
      stats: this.stats,
      pMaxHp: this.p.maxHp,
      eMaxHp: this.e.maxHp,
      pHpEnd: Math.max(0, this.p.hp),
      eHpEnd: Math.max(0, this.e.hp),
    };
  }
}

/** PVE：玩家战纹链 vs 无链敌人（主线 / Boss / 每日 Boss）。 */
export function simulatePve(cfg: GameConfig, player: ChainFighter, enemy: EnemyDef, seed: number): BattleResult {
  const sim = new Sim(cfg, new Rng(seed), makeChainActor('p', player), makeSimpleActor('e', enemy));
  const { p, e } = sim;
  if (e.speed > p.speed) {
    sim.simpleAttack(e, p);
    if (sim.dead() === 'p') return sim.finish('dead');
  }
  const maxRounds = cfg.battle.maxRounds;
  for (;;) {
    if (p.pointer === 0 && p.round >= maxRounds) return sim.finish('timeout');
    sim.chainStep(p, e);
    const d = sim.dead();
    if (d === 'e') return sim.finish('kill');
    e.counter++;
    if (e.counter >= e.actEvery) {
      e.counter = 0;
      sim.simpleAttack(e, p);
      if (sim.dead() === 'p') return sim.finish('dead');
    }
  }
}

/** PVP：双方都有战纹链（异步竞技场），双方节点交替触发，速度高者先手。 */
export function simulatePvp(cfg: GameConfig, player: ChainFighter, opponent: ChainFighter, seed: number): BattleResult {
  const sim = new Sim(cfg, new Rng(seed), makeChainActor('p', player), makeChainActor('e', opponent));
  const { p, e } = sim;
  const order: [Actor, Actor][] = e.speed > p.speed ? [[e, p], [p, e]] : [[p, e], [e, p]];
  const maxRounds = cfg.battle.maxRounds;
  for (;;) {
    for (const [a, t] of order) {
      if (a === p && p.pointer === 0 && p.round >= maxRounds) return sim.finish('timeout');
      sim.chainStep(a, t);
      const d = sim.dead();
      if (d === 'e') return sim.finish('kill');
      if (d === 'p') return sim.finish('dead');
    }
  }
}

export interface HintContext {
  cfg: GameConfig;
  enemyWeakness: RuneType[] | null;
  comboCount: number;
}

/** 规则化失败解释，最多 2 条。 */
export function failureHints(result: BattleResult, ctx: HintContext): string[] {
  if (result.win) return [];
  const short = ctx.cfg.runes.typeShort;
  const hints: string[] = [];
  const eRatio = result.eHpEnd / result.eMaxHp;
  if (ctx.enemyWeakness && result.stats.breaks === 0) {
    hints.push(`当前破绽未匹配：把「${ctx.enemyWeakness.map((t) => short[t]).join('→')}」按顺序相邻排列可触发破势`);
  }
  if (eRatio > 0.6) {
    hints.push('当前数值明显不足，需要继续成长（锻造 / 升级 / 挂机）');
  } else if (result.reason === 'dead') {
    hints.push('生存不足：放入御纹，或让御纹紧接在锋纹前面');
  } else {
    hints.push('基础输出不足：提高锋纹品质，或把疾纹放在锋纹前面');
  }
  if (hints.length < 2 && ctx.comboCount < 2) {
    hints.push('连携过少：试试「疾→锋」「御→锋」「震→锋」这类相邻顺序');
  }
  return hints.slice(0, 2);
}
