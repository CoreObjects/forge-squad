import type { GameConfig } from './config';
import { Rng } from './rng';
import { RUNE_TYPES, type ChainFighter, type Rune, type RuneType } from './types';

export type ArenaTier = 'weak' | 'close' | 'strong';

export interface ArenaBot {
  id: string;
  name: string;
  ratio: number;
  basePower: number;
  chainTypes: RuneType[];
  quality: number;
  isTestData: true;
}

export interface ArenaOpponent {
  botId: string;
  tier: ArenaTier;
}

export interface DefenseSnapshot {
  atk: number;
  hp: number;
  def: number;
  speed: number;
  power: number;
  chain: (Pick<Rune, 'type' | 'quality' | 'strength'> | null)[];
  savedAt: number;
}

export function createBots(cfg: GameConfig, seed: number, playerPower: number, furnaceLevel: number): ArenaBot[] {
  const rng = new Rng(seed);
  const a = cfg.economy.arena;
  const bots: ArenaBot[] = [];
  for (let i = 0; i < a.botCount; i++) {
    const ratio = 0.55 + (1.25 * i) / Math.max(1, a.botCount - 1);
    const chainTypes: RuneType[] = [];
    for (let k = 0; k < 6; k++) chainTypes.push(RUNE_TYPES[rng.int(4)]);
    bots.push({
      id: `bot${i + 1}`,
      name: `测试对手 #${String(i + 1).padStart(2, '0')}`,
      ratio,
      basePower: Math.max(50, Math.round(playerPower * ratio)),
      chainTypes,
      quality: Math.max(0, Math.min(5, furnaceLevel - 1 + Math.round((ratio - 1) * 2))),
      isTestData: true,
    });
  }
  return bots;
}

export function botPower(cfg: GameConfig, bot: ArenaBot, daysSinceCreated: number): number {
  return Math.round(bot.basePower * Math.pow(cfg.economy.arena.botDailyGrowth, Math.max(0, daysSinceCreated)));
}

export function botScore(cfg: GameConfig, bot: ArenaBot, daysSinceCreated: number): number {
  const a = cfg.economy.arena;
  return Math.round(a.startScore + (bot.ratio - 1) * 600 + Math.max(0, daysSinceCreated) * 15 * bot.ratio);
}

export function botFighter(cfg: GameConfig, bot: ArenaBot, power: number): ChainFighter {
  return {
    name: bot.name,
    atk: power * 0.5,
    hp: power * 5,
    def: 0,
    speed: cfg.progression.character.speed - 5,
    chain: bot.chainTypes.map((type, i) => ({
      id: `${bot.id}-${i}`,
      type,
      quality: bot.quality,
      furnaceLevel: 1,
      strength: 0,
    })),
  };
}

export function snapshotFighter(name: string, s: DefenseSnapshot): ChainFighter {
  return {
    name,
    atk: s.atk,
    hp: s.hp,
    def: s.def,
    speed: s.speed,
    chain: s.chain.map((r, i) => (r ? { id: `snap-${i}`, type: r.type, quality: r.quality, furnaceLevel: 1, strength: r.strength } : null)),
  };
}

/** 从机器人池里挑“偏弱 / 接近 / 略强”三个对手。 */
export function pickOpponents(cfg: GameConfig, bots: ArenaBot[], playerPower: number, days: number, rng: Rng): ArenaOpponent[] {
  const ratios = cfg.economy.arena.opponentPowerRatio;
  const used = new Set<string>();
  const out: ArenaOpponent[] = [];
  (['weak', 'close', 'strong'] as ArenaTier[]).forEach((tier) => {
    const target = playerPower * ratios[tier];
    const ranked = bots
      .filter((b) => !used.has(b.id))
      .map((b) => ({ b, d: Math.abs(botPower(cfg, b, days) - target) * (0.9 + rng.next() * 0.2) }))
      .sort((x, y) => x.d - y.d);
    const pick = ranked[0]?.b;
    if (pick) {
      used.add(pick.id);
      out.push({ botId: pick.id, tier });
    }
  });
  return out;
}
