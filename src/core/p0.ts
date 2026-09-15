import { simulatePve, type BattleResult } from './battle';
import type { GameConfig } from './config';
import type { Chain, ChainFighter, EnemyDef, RuneType } from './types';

/** P0_BALANCE.md 基线战纹链（品质普通、强度不计入属性）。 */
export function p0Chain(types: RuneType[]): Chain {
  const chain: Chain = types.map((type, i) => ({ id: `p0-${i}`, type, quality: 0, furnaceLevel: 1, strength: 0 }));
  while (chain.length < 6) chain.push(null);
  return chain;
}

export function p0Fighter(cfg: GameConfig, types: RuneType[]): ChainFighter {
  const p = cfg.battle.p0.player;
  return { name: 'P0 基线', atk: p.atk, hp: p.hp, def: p.def, speed: p.speed, chain: p0Chain(types) };
}

export function p0Boss(cfg: GameConfig, weakness: RuneType[] | null = cfg.battle.p0.boss.weakness): EnemyDef {
  const b = cfg.battle.p0.boss;
  return { name: b.name, hp: b.hp, atk: b.atk, def: b.def, speed: b.speed, actEvery: b.actEvery, weakness, isBoss: true };
}

export function runP0(cfg: GameConfig, types: RuneType[], seed: number, weakness?: RuneType[] | null): BattleResult {
  return simulatePve(cfg, p0Fighter(cfg, types), p0Boss(cfg, weakness === undefined ? cfg.battle.p0.boss.weakness : weakness), seed);
}

export function p0WinRate(cfg: GameConfig, types: RuneType[], runs: number, weakness?: RuneType[] | null): number {
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) if (runP0(cfg, types, seed, weakness).win) wins++;
  return wins / runs;
}
