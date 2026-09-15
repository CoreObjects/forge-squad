import type { RunesConfig } from './config';
import type { Rng } from './rng';
import { RUNE_TYPES, type Rune, type RuneType } from './types';

export const Q_RARE = 2;
export const Q_EPIC = 3;
export const Q_LEGEND = 4;

export interface PityState {
  forgeCount: number;
  sinceRarePlus: number;
  sinceEpicPlus: number;
  sinceLegendPlus: number;
  newbieEpicDone: boolean;
  firstChargeEpicPending: boolean;
}

export type PityHit = 'rare' | 'epic' | 'legend' | 'newbieEpic' | 'firstCharge' | null;

export interface ForgeOptions {
  furnaceLevel: number;
  /** GM：强制下一次类型 */
  forcedType?: RuneType | null;
  /** GM：强制下一次品质 */
  forcedQuality?: number | null;
}

export interface ForgeOutcome {
  rune: Rune;
  pityHit: PityHit;
  tutorialScripted: boolean;
}

export function newPityState(): PityState {
  return {
    forgeCount: 0,
    sinceRarePlus: 0,
    sinceEpicPlus: 0,
    sinceLegendPlus: 0,
    newbieEpicDone: false,
    firstChargeEpicPending: false,
  };
}

export function qualityRow(cfg: RunesConfig, furnaceLevel: number): number[] {
  const idx = Math.max(0, Math.min(cfg.qualityTable.length - 1, furnaceLevel - 1));
  return cfg.qualityTable[idx];
}

export function legendAvailable(cfg: RunesConfig, furnaceLevel: number): boolean {
  const row = qualityRow(cfg, furnaceLevel);
  return row[Q_LEGEND] + (row[5] ?? 0) > 0;
}

export function runeStrength(cfg: RunesConfig, type: RuneType, quality: number, furnaceLevel: number, roll: number): number {
  const base = cfg.typeBase[type];
  const furnaceCoef = Math.pow(cfg.furnaceCoefBase, furnaceLevel - 1);
  return Math.max(1, Math.round(base * furnaceCoef * cfg.qualityMult[quality] * roll));
}

export function runeStats(cfg: RunesConfig, rune: Rune): { atk: number; hp: number } {
  const w = cfg.statWeights[rune.type];
  return { atk: rune.strength * w.atk, hp: rune.strength * w.hp };
}

export function meltValue(cfg: RunesConfig, rune: Rune): number {
  return cfg.meltXp[rune.quality] ?? 0;
}

/**
 * 生成一枚战纹并推进保底计数（会修改 pity）。
 * 顺序：类型（新手脚本 > GM 强制 > 权重）→ 品质（随机后套用保底下限）→ 强度。
 */
export function forgeRune(cfg: RunesConfig, rng: Rng, pity: PityState, opts: ForgeOptions, id: string): ForgeOutcome {
  let tutorialScripted = false;
  let type: RuneType;
  if (opts.forcedType) {
    type = opts.forcedType;
  } else if (pity.forgeCount < cfg.tutorialForcedTypes.length) {
    type = cfg.tutorialForcedTypes[pity.forgeCount];
    tutorialScripted = true;
  } else {
    type = RUNE_TYPES[rng.weighted(RUNE_TYPES.map((t) => cfg.typeWeights[t]))];
  }

  const row = qualityRow(cfg, opts.furnaceLevel);
  const rolled = rng.weighted(row);
  let minQ = 0;
  let hit: PityHit = null;
  const raise = (q: number, reason: PityHit) => {
    if (q > minQ) {
      minQ = q;
      hit = reason;
    }
  };

  if (pity.sinceRarePlus >= cfg.pity.rarePlusEvery - 1) raise(Q_RARE, 'rare');
  if (pity.sinceEpicPlus >= cfg.pity.epicPlusEvery - 1) raise(Q_EPIC, 'epic');
  if (!pity.newbieEpicDone && pity.forgeCount === cfg.pity.newbieEpicWithin - 1) raise(Q_EPIC, 'newbieEpic');
  if (pity.firstChargeEpicPending) raise(Q_EPIC, 'firstCharge');
  const legendOk = legendAvailable(cfg, opts.furnaceLevel);
  if (legendOk && pity.sinceLegendPlus >= cfg.pity.legendPlusEvery - 1) raise(Q_LEGEND, 'legend');

  let quality = Math.max(rolled, minQ);
  const pityHit: PityHit = rolled < minQ ? hit : null;
  if (opts.forcedQuality !== undefined && opts.forcedQuality !== null) quality = opts.forcedQuality;

  // 推进计数
  const firstChargeConsumed = pity.firstChargeEpicPending;
  pity.forgeCount += 1;
  pity.sinceRarePlus = quality >= Q_RARE ? 0 : pity.sinceRarePlus + 1;
  pity.sinceEpicPlus = quality >= Q_EPIC ? 0 : pity.sinceEpicPlus + 1;
  if (legendOk) pity.sinceLegendPlus = quality >= Q_LEGEND ? 0 : pity.sinceLegendPlus + 1;
  if (!pity.newbieEpicDone && (quality >= Q_EPIC || pity.forgeCount >= cfg.pity.newbieEpicWithin)) {
    pity.newbieEpicDone = true;
  }
  if (firstChargeConsumed) pity.firstChargeEpicPending = false;

  const roll = rng.range(cfg.rollMin, cfg.rollMax);
  const rune: Rune = {
    id,
    type,
    quality,
    furnaceLevel: opts.furnaceLevel,
    strength: runeStrength(cfg, type, quality, opts.furnaceLevel, roll),
  };
  return { rune, pityHit, tutorialScripted };
}
