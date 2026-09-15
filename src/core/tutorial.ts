import { simulatePve } from './battle';
import { weaknessMatch } from './chain';
import type { GameConfig } from './config';
import { enemyFromPower } from './stages';
import type { Chain, ChainFighter, RuneType } from './types';

export type TutorialStep =
  | 'forge1'
  | 'place1'
  | 'battle1'
  | 'forge2'
  | 'place2'
  | 'battle2'
  | 'forge3'
  | 'place3'
  | 'forgeMore'
  | 'boss'
  | 'swap'
  | 'bossRetry'
  | 'done';

export const TUTORIAL_TEXT: Record<TutorialStep, string> = {
  forge1: '点击「锻造」，打造你的第一枚战纹',
  place1: '锋纹会在战斗中直接攻击。点击「推荐放入」',
  place2: '疾纹会强化紧邻它后面的战纹。放在锋纹前面！',
  battle1: '点击「挑战」，看看战纹在战斗里如何触发',
  forge2: '再锻造一次',
  battle2: '再次挑战：留意「疾 → 锋」会形成连携「迅斩」',
  forge3: '解锁了更多节点！继续锻造',
  place3: '这次自己选：点「手动放入」，挑一个节点',
  forgeMore: '继续锻造，把战纹链填满',
  boss: '小 Boss 出现了！它公开了自己的破绽谱，先挑战试试',
  swap: '调整顺序可以触发破势：打开战纹链，交换节点让破绽谱相邻',
  bossRetry: '破绽已对上，再次挑战！',
  done: '',
};

/** 二分查找：玩家能赢下的最高敌人战力（胜负随战力单调）。 */
export function winThreshold(
  cfg: GameConfig,
  fighter: ChainFighter,
  weakness: RuneType[] | null,
  name: string,
  seed: number,
  boss = true,
): number {
  const wins = (p: number) => simulatePve(cfg, fighter, enemyFromPower(cfg, p, boss, name, weakness), seed).win;
  let lo = 5;
  let hi = 5;
  if (!wins(lo)) return 0;
  while (wins(hi) && hi < 1e7) hi *= 2;
  for (let i = 0; i < 40 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2;
    if (wins(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function arrangementsBySwap(chain: Chain, unlocked: number): Chain[] {
  const out: Chain[] = [];
  for (let i = 0; i < unlocked; i++) {
    for (let j = i + 1; j < unlocked; j++) {
      if (!chain[i] && !chain[j]) continue;
      const c = chain.slice();
      const t = c[i];
      c[i] = c[j];
      c[j] = t;
      out.push(c);
    }
  }
  return out;
}

export interface TutorialBossSetup {
  weakness: RuneType[];
  power: number;
  skipSwap: boolean;
}

/**
 * 教程小 Boss 校准：挑一个“当前链没对上、交换一次就能对上”的破绽，
 * 并把 Boss 战力放在“当前链会输、换位后会赢”的区间中间。
 */
export function calibrateTutorialBoss(
  cfg: GameConfig,
  makeFighter: (chain: Chain) => ChainFighter,
  chain: Chain,
  unlocked: number,
  preferred: RuneType[],
  name: string,
  seed: number,
): TutorialBossSetup {
  const candidates: RuneType[][] = [preferred, ...cfg.stages.tutorialBossWeaknessCandidates];
  const swaps = arrangementsBySwap(chain, unlocked);
  for (const w of candidates) {
    if (weaknessMatch(chain, w, cfg.battle).full > 0) continue;
    const matching = swaps.filter((c) => weaknessMatch(c, w, cfg.battle).full > 0);
    if (matching.length === 0) continue;
    const thrCur = winThreshold(cfg, makeFighter(chain), w, name, seed);
    const thrSwap = Math.min(...matching.map((c) => winThreshold(cfg, makeFighter(c), w, name, seed)));
    if (thrSwap > thrCur * 1.03) {
      return { weakness: w, power: thrCur + (thrSwap - thrCur) * 0.5, skipSwap: false };
    }
  }
  const thr = winThreshold(cfg, makeFighter(chain), preferred, name, seed);
  return { weakness: preferred, power: Math.max(10, thr * 0.9), skipSwap: true };
}
