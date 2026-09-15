import type { GameConfig, FurnaceLevelDef } from './config';
import { runeStats } from './rune';
import type { Chain } from './types';

export interface Stats {
  atk: number;
  hp: number;
  def: number;
  speed: number;
}

export function characterStats(cfg: GameConfig, level: number): Stats {
  const c = cfg.progression.character;
  const atk = c.atkBase * Math.pow(c.atkGrowth, level - 1);
  return { atk, hp: atk * c.hpPerAtk, def: c.def, speed: c.speed };
}

export function totalStats(cfg: GameConfig, level: number, chain: Chain): Stats {
  const s = characterStats(cfg, level);
  for (const r of chain) {
    if (!r) continue;
    const rs = runeStats(cfg.runes, r);
    s.atk += rs.atk;
    s.hp += rs.hp;
  }
  return s;
}

/** 综合战力：只反映基础数值，不折算连携与破绽。 */
export function statsPower(s: Stats): number {
  return Math.round(s.atk + s.hp / 10 + s.def * 0.5);
}

export function playerPower(cfg: GameConfig, level: number, chain: Chain): number {
  return statsPower(totalStats(cfg, level, chain));
}

export function levelUpCost(cfg: GameConfig, level: number): number {
  const c = cfg.progression.character;
  return Math.round(c.costBase * Math.pow(c.costGrowth, level - 1));
}

export function furnaceDef(cfg: GameConfig, level: number): FurnaceLevelDef | null {
  return cfg.progression.furnace.find((f) => f.level === level) ?? null;
}

export interface FurnaceUpgradeCheck {
  next: FurnaceLevelDef | null;
  xpOk: boolean;
  chapterOk: boolean;
  goldOk: boolean;
  can: boolean;
}

export function checkFurnaceUpgrade(
  cfg: GameConfig,
  furnaceLevel: number,
  totalFireXp: number,
  chaptersCleared: number,
  gold: number,
): FurnaceUpgradeCheck {
  const next = furnaceDef(cfg, furnaceLevel + 1);
  if (!next) return { next: null, xpOk: false, chapterOk: false, goldOk: false, can: false };
  const xpOk = totalFireXp >= next.xp;
  const chapterOk = chaptersCleared >= next.chapter;
  const goldOk = gold >= next.gold;
  return { next, xpOk, chapterOk, goldOk, can: xpOk && chapterOk && goldOk };
}
