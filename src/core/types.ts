export type RuneType = 'feng' | 'ji' | 'yu' | 'zhen';

export const RUNE_TYPES: RuneType[] = ['feng', 'ji', 'yu', 'zhen'];

export const CHAIN_SIZE = 6;

export interface Rune {
  id: string;
  type: RuneType;
  /** 0 普通 … 5 神话 */
  quality: number;
  furnaceLevel: number;
  strength: number;
}

export type Chain = (Rune | null)[];

/** 战斗双方中“有战纹链”的一方（玩家 / 竞技场快照）。 */
export interface ChainFighter {
  name: string;
  atk: number;
  hp: number;
  def: number;
  speed: number;
  chain: Chain;
}

/** 不带战纹链的 PVE 敌人：每触发 N 个玩家节点行动一次。 */
export interface EnemyDef {
  name: string;
  hp: number;
  atk: number;
  def: number;
  speed: number;
  actEvery: number;
  weakness: RuneType[] | null;
  isBoss: boolean;
  tendency?: string;
}
