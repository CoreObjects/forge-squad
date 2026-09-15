import { defaultConfig, type GameConfig } from '../src/core/config';
import { Game, type GameState } from '../src/core/game';
import type { PaymentProvider } from '../src/core/shop';
import type { Chain, Rune, RuneType } from '../src/core/types';

export function rune(type: RuneType, quality = 0, strength = 20, id?: string): Rune {
  return { id: id ?? `${type}-${Math.random().toString(36).slice(2, 7)}`, type, quality, furnaceLevel: 1, strength };
}

export function chainOf(types: (RuneType | null)[]): Chain {
  const c: Chain = types.map((t) => (t ? rune(t) : null));
  while (c.length < 6) c.push(null);
  return c;
}

export class Clock {
  t = new Date(2026, 8, 15, 10, 0, 0).getTime();
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export const autoPay: PaymentProvider = {
  async pay() {
    return { ok: true, orderId: `test-${Math.random().toString(36).slice(2)}` };
  },
};

export function newGame(opts: { cfg?: GameConfig; seed?: number; clock?: Clock; saves?: string[] } = {}) {
  const cfg = opts.cfg ?? defaultConfig();
  const clock = opts.clock ?? new Clock();
  const saves = opts.saves ?? [];
  const state: GameState = Game.newState(cfg, clock.now(), opts.seed ?? 42);
  const game = new Game(cfg, state, { now: clock.now, save: (j) => saves.push(j), payment: autoPay });
  return { game, cfg, clock, saves };
}

/** 按教程推进到完成（返回过程中关键结果）。 */
export function playTutorial(game: Game) {
  const log: { bossFirstWin?: boolean; bossRetryWin?: boolean; breaks?: number } = {};
  game.startSession(true);
  game.forge(1);
  game.decidePending({ kind: 'recommend' });
  game.challengeStage();
  game.forge(1);
  game.decidePending({ kind: 'recommend' });
  game.challengeStage();
  game.forge(1);
  game.decidePending({ kind: 'place', node: 2 });
  while (game.state.tutorial.step === 'forgeMore') {
    if (game.state.pending.length === 0) game.forge(1);
    game.decidePending({ kind: 'recommend' });
  }
  const first = game.challengeStage();
  log.bossFirstWin = first?.result.win;
  if (game.state.tutorial.step === 'swap') {
    const w = game.state.tutorial.bossWeakness!;
    const chain = game.state.chain;
    // 找一次能对上破绽的交换
    outer: for (let i = 0; i < game.state.unlockedNodes; i++) {
      for (let j = i + 1; j < game.state.unlockedNodes; j++) {
        const c = chain.slice();
        [c[i], c[j]] = [c[j], c[i]];
        for (let s = 0; s + w.length <= 6; s++) {
          if (w.every((t, k) => c[s + k]?.type === t)) {
            game.swap(i, j);
            break outer;
          }
        }
      }
    }
    const retry = game.challengeStage();
    log.bossRetryWin = retry?.result.win;
    log.breaks = retry?.result.stats.breaks;
  }
  return log;
}
