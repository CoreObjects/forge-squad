import runesJson from './runes.json';
import battleJson from './battle.json';
import progressionJson from './progression.json';
import stagesJson from './stages.json';
import economyJson from './economy.json';
import shopJson from './shop.json';
import type { RuneType } from '../types';

export interface ComboDef {
  id: string;
  name: string;
  from: RuneType;
  to: RuneType;
  desc?: string;
  dmgBonus?: number;
  dmgBonusIfStun?: number;
  shieldToDmg?: number;
  stunChanceSet?: number;
  shieldBonus?: number;
}

export interface TripleDef {
  id: string;
  name: string;
  seq: RuneType[];
  dmgBonus: number;
}

export interface BattleConfig {
  feng: { dmg: number };
  ji: { nextBoost: number; boostAffectsStunChance: boolean };
  yu: { shieldPctMaxHp: number; stackMode: 'max' | 'add' };
  zhen: { dmg: number; stunChance: number };
  combos: ComboDef[];
  triples: TripleDef[];
  break: { durationNodes: number; dmgTakenBonus: number; instantDmg: number; maxPerRound: number };
  wrapAdjacency: boolean;
  stacking: 'additive' | 'multiplicative';
  maxRounds: number;
  defConstant: number;
  /** P0_BALANCE.md 验收基线 */
  p0: {
    player: { atk: number; hp: number; def: number; speed: number };
    boss: { name: string; hp: number; atk: number; def: number; speed: number; actEvery: number; weakness: RuneType[] };
    plainChain: RuneType[];
    tunedChain: RuneType[];
  };
}

export interface RunesConfig {
  typeWeights: Record<RuneType, number>;
  typeNames: Record<RuneType, string>;
  typeShort: Record<RuneType, string>;
  typeDesc: Record<RuneType, string>;
  typeBase: Record<RuneType, number>;
  statWeights: Record<RuneType, { atk: number; hp: number }>;
  furnaceCoefBase: number;
  qualityNames: string[];
  qualityMult: number[];
  qualityEffectMult: number[];
  rollMin: number;
  rollMax: number;
  qualityTable: number[][];
  meltXp: number[];
  pity: { rarePlusEvery: number; epicPlusEvery: number; legendPlusEvery: number; newbieEpicWithin: number };
  tutorialForcedTypes: RuneType[];
  confirmQualityFrom: number;
}

export interface FurnaceLevelDef {
  level: number;
  xp: number;
  chapter: number;
  gold: number;
}

export interface ProgressionConfig {
  character: {
    atkBase: number;
    /** 每级攻击提升（相对 1 级攻击的比例，线性） */
    atkPerLevel: number;
    hpPerAtk: number;
    def: number;
    speed: number;
    /** 升级花费 = costBase × 当前等级^costExp */
    costBase: number;
    costExp: number;
    maxLevel: number;
  };
  furnace: FurnaceLevelDef[];
  startResources: { hammers: number; gold: number };
  nodeUnlocks: { nodes: number; at: string }[];
  featureUnlocks: Record<string, string>;
  tutorialRewards: { bossWinHammers: number; doneHammers: number };
}

export interface SpecialStageDef {
  stage: number;
  kind: 'tutorialBoss' | 'miniBoss';
  name: string;
  weakness: RuneType[];
  factor?: number;
}

export interface StagesConfig {
  chapters: number;
  stagesPerChapter: number;
  chapterNames: string[];
  normalEnemyNames: string[];
  chapterBosses: { name: string; weakness: RuneType[]; tendency: string }[];
  specialStages: SpecialStageDef[];
  tutorialBossWeaknessCandidates: RuneType[][];
  powerCurve: [number, number][];
  normalFactor: { start: number; end: number };
  bossFactor: number[];
  normalStats: { hpPerPower: number; atkPerPower: number; actEvery: number; speed: number };
  bossStats: { hpPerPower: number; atkPerPower: number; actEvery: number; speed: number };
  rewards: {
    goldBase: number;
    goldPerStage: number;
    /** 前期首通锻造锤分段：[[截至第几关, 每关锻造锤], ...]；之后偶数关给 evenStageHammers */
    hammerSchedule: [number, number][];
    evenStageHammers: number;
    bossHammers: number;
  };
}

export interface DailyTaskDef {
  id: string;
  name: string;
  event: string;
  target: number;
  hammers: number;
  gold: number;
}

export interface EconomyConfig {
  idle: { hammerIntervalMinutes: number; freeCapHours: number; goldPerHourBase: number; goldPerHourPerStage: number };
  daily: {
    resetHour: number;
    tasks: DailyTaskDef[];
    goldScalePerStage: number;
    dailyBoss: { name: string; hammers: number; gold: number; powerFactor: number; weaknessRotation: RuneType[][] };
  };
  arena: {
    freeAttempts: number;
    startScore: number;
    winScore: { weak: number; close: number; strong: number };
    loseScore: number;
    rewardHammers: number;
    rewardGold: number;
    opponentPowerRatio: { weak: number; close: number; strong: number };
    botCount: number;
    botDailyGrowth: number;
    botLabel: string;
  };
  recommend: {
    powerWeight: number;
    comboWeight: number;
    weaknessWeight: number;
    effectivePowerPct: number;
    strongScore: number;
    /** 对当前关卡敌人的胜率变化权重（0 表示只看战力 / 连携 / 破绽） */
    battleWeight?: number;
    battleSeeds?: number;
  };
}

export interface ShopConfig {
  firstCharge: { id: string; name: string; price: number; hammers: number; epicGuarantee: boolean; cosmetic: string };
  monthlyCard: { id: string; name: string; price: number; days: number; dailyHammers: number; idleCapHours: number; idleGoldBonus: number };
  firstChargeShow: { minForges: number; needPlace: boolean; needMelt: boolean; needCombo: boolean; needBreak: boolean; needFail: boolean };
}

export interface GameConfig {
  runes: RunesConfig;
  battle: BattleConfig;
  progression: ProgressionConfig;
  stages: StagesConfig;
  economy: EconomyConfig;
  shop: ShopConfig;
}

/** 返回一份可修改的配置副本（GM / 测试可以改副本而不影响默认值）。 */
export function defaultConfig(): GameConfig {
  return JSON.parse(
    JSON.stringify({
      runes: runesJson,
      battle: battleJson,
      progression: progressionJson,
      stages: stagesJson,
      economy: economyJson,
      shop: shopJson,
    }),
  ) as GameConfig;
}
