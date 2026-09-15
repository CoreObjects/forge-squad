import { defaultConfig } from '../../src/core/config';
import { Game, type GameState } from '../../src/core/game';
import { fetchTransport, type KeyValueStore } from '../../src/net/api';
import { OnlineServices } from '../../src/net/online';
import type { startServer } from './helpers';

export class MemStore implements KeyValueStore {
  m = new Map<string, string>();
  get(k: string) {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string) {
    this.m.set(k, v);
  }
  clone(): MemStore {
    const c = new MemStore();
    for (const [k, v] of this.m) c.m.set(k, v);
    return c;
  }
}

export type Srv = Awaited<ReturnType<typeof startServer>>;

/** 模拟一台设备上的游戏客户端（与 boot.ts 同样的装配方式） */
export function device(srv: Srv, deviceId: string, opts: { state?: GameState; store?: MemStore; confirmPay?: boolean } = {}) {
  const cfg = defaultConfig();
  const store = opts.store ?? new MemStore();
  const clock = srv.clock;
  let online: OnlineServices | null = null;
  const state = opts.state ?? Game.newState(cfg, clock.t, Math.floor(Math.random() * 1e9));
  const game = new Game(cfg, state, {
    now: () => clock.t,
    save: (json) => {
      store.set('save', json);
      online?.cloud.markDirty();
    },
    onOrderGranted: (id) => online?.onOrderGranted(id),
  });
  online = new OnlineServices(game, {
    apiBase: srv.url,
    transport: fetchTransport,
    store,
    deviceId: () => deviceId,
    confirmDevPay: async () => opts.confirmPay ?? true,
  });
  return { game, online, store };
}

/** “关掉游戏再打开”：用该设备本地存档与本地存储重建客户端 */
export function reopen(srv: Srv, deviceId: string, d: { store: MemStore }) {
  const cfg = defaultConfig();
  const state = Game.loadState(cfg, d.store.get('save'), srv.clock.t)!;
  return device(srv, deviceId, { state, store: d.store });
}

export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
