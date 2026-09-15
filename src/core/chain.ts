import type { BattleConfig, GameConfig } from './config';
import { playerPower } from './progression';
import { CHAIN_SIZE, type Chain, type Rune, type RuneType } from './types';

export interface ActiveCombo {
  id: string;
  name: string;
  from: number;
  to: number;
}

export interface ActiveTriple {
  id: string;
  name: string;
  nodes: [number, number, number];
}

export function emptyChain(): Chain {
  return new Array(CHAIN_SIZE).fill(null);
}

/** 链上 i 节点的“前一节点”下标（考虑环绕配置），不存在返回 -1。 */
export function prevIndex(i: number, battle: BattleConfig): number {
  if (i > 0) return i - 1;
  return battle.wrapAdjacency ? CHAIN_SIZE - 1 : -1;
}

export function activeCombos(chain: Chain, battle: BattleConfig): ActiveCombo[] {
  const out: ActiveCombo[] = [];
  for (let i = 0; i < CHAIN_SIZE; i++) {
    const p = prevIndex(i, battle);
    if (p < 0) continue;
    const a = chain[p];
    const b = chain[i];
    if (!a || !b) continue;
    for (const c of battle.combos) {
      if (c.from === a.type && c.to === b.type) out.push({ id: c.id, name: c.name, from: p, to: i });
    }
  }
  return out;
}

export function activeTriples(chain: Chain, battle: BattleConfig): ActiveTriple[] {
  const out: ActiveTriple[] = [];
  for (let i = 0; i < CHAIN_SIZE; i++) {
    const p1 = prevIndex(i, battle);
    if (p1 < 0) continue;
    const p2 = prevIndex(p1, battle);
    if (p2 < 0) continue;
    const a = chain[p2];
    const b = chain[p1];
    const c = chain[i];
    if (!a || !b || !c) continue;
    for (const t of battle.triples) {
      if (t.seq[0] === a.type && t.seq[1] === b.type && t.seq[2] === c.type) {
        out.push({ id: t.id, name: t.name, nodes: [p2, p1, i] });
      }
    }
  }
  return out;
}

export interface WeaknessMatch {
  /** 完整命中的次数 */
  full: number;
  /** 任意位置最长连续命中的前缀长度 */
  best: number;
  /** 第一个完整命中的节点下标 */
  nodes: number[] | null;
}

export function weaknessMatch(chain: Chain, weakness: RuneType[] | null, battle: BattleConfig): WeaknessMatch {
  if (!weakness || weakness.length === 0) return { full: 0, best: 0, nodes: null };
  let full = 0;
  let best = 0;
  let nodes: number[] | null = null;
  const maxStart = battle.wrapAdjacency ? CHAIN_SIZE : CHAIN_SIZE;
  for (let s = 0; s < maxStart; s++) {
    const idxs: number[] = [];
    let len = 0;
    for (let k = 0; k < weakness.length; k++) {
      const pos = s + k;
      if (pos >= CHAIN_SIZE && !battle.wrapAdjacency) break;
      const idx = pos % CHAIN_SIZE;
      const r = chain[idx];
      if (!r || r.type !== weakness[k]) break;
      idxs.push(idx);
      len++;
    }
    if (len > best) best = len;
    if (len === weakness.length) {
      full++;
      if (!nodes) nodes = idxs;
    }
  }
  return { full, best, nodes };
}

export function swapNodes(chain: Chain, i: number, j: number): Chain {
  const next = chain.slice();
  const t = next[i];
  next[i] = next[j];
  next[j] = t;
  return next;
}

export interface PlacementEval {
  node: number;
  overwritten: Rune | null;
  powerBefore: number;
  powerAfter: number;
  powerDeltaPct: number;
  combosBefore: ActiveCombo[];
  combosAfter: ActiveCombo[];
  gained: string[];
  lost: string[];
  weakBefore: number;
  weakAfter: number;
  weakBestBefore: number;
  weakBestAfter: number;
  score: number;
}

function multisetDiff(a: string[], b: string[]): string[] {
  const counts = new Map<string, number>();
  for (const x of b) counts.set(x, (counts.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const c = counts.get(x) ?? 0;
    if (c > 0) counts.set(x, c - 1);
    else out.push(x);
  }
  return out;
}

export function evaluatePlacement(
  cfg: GameConfig,
  charLevel: number,
  chain: Chain,
  rune: Rune,
  node: number,
  weakness: RuneType[] | null,
): PlacementEval {
  const after = chain.slice();
  after[node] = rune;
  const powerBefore = playerPower(cfg, charLevel, chain);
  const powerAfter = playerPower(cfg, charLevel, after);
  const combosBefore = activeCombos(chain, cfg.battle);
  const combosAfter = activeCombos(after, cfg.battle);
  const namesB = combosBefore.map((c) => c.name);
  const namesA = combosAfter.map((c) => c.name);
  const gained = multisetDiff(namesA, namesB);
  const lost = multisetDiff(namesB, namesA);
  const wb = weaknessMatch(chain, weakness, cfg.battle);
  const wa = weaknessMatch(after, weakness, cfg.battle);
  const powerDeltaPct = powerBefore > 0 ? ((powerAfter - powerBefore) / powerBefore) * 100 : 0;
  const w = cfg.economy.recommend;
  const score =
    powerDeltaPct * w.powerWeight +
    (gained.length - lost.length) * w.comboWeight +
    (wa.full - wb.full) * w.weaknessWeight +
    (wa.best - wb.best) * 0.5;
  return {
    node,
    overwritten: chain[node],
    powerBefore,
    powerAfter,
    powerDeltaPct,
    combosBefore,
    combosAfter,
    gained,
    lost,
    weakBefore: wb.full,
    weakAfter: wa.full,
    weakBestBefore: wb.best,
    weakBestAfter: wa.best,
    score,
  };
}

export type RecommendTag = 'strong' | 'structure' | 'ok' | 'melt';

export interface Recommendation {
  best: PlacementEval | null;
  all: PlacementEval[];
  tag: RecommendTag;
  effective: boolean;
}

export function recommendPlacement(
  cfg: GameConfig,
  charLevel: number,
  chain: Chain,
  unlockedNodes: number,
  rune: Rune,
  weakness: RuneType[] | null,
): Recommendation {
  const all: PlacementEval[] = [];
  for (let i = 0; i < Math.min(unlockedNodes, CHAIN_SIZE); i++) {
    all.push(evaluatePlacement(cfg, charLevel, chain, rune, i, weakness));
  }
  let best: PlacementEval | null = null;
  for (const e of all) {
    if (!best || e.score > best.score + 1e-9) best = e;
  }
  const w = cfg.economy.recommend;
  if (!best || best.score <= 0) {
    return { best, all, tag: 'melt', effective: false };
  }
  const structural = best.gained.length > best.lost.length || best.weakAfter > best.weakBefore;
  const effective = best.powerDeltaPct >= w.effectivePowerPct || structural;
  let tag: RecommendTag = 'ok';
  if (best.score >= w.strongScore) tag = 'strong';
  else if (structural && best.powerDeltaPct < w.effectivePowerPct) tag = 'structure';
  return { best, all, tag, effective };
}
