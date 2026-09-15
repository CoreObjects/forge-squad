import { defaultConfig } from '../../src/core/config';
import { Game, type GameState } from '../../src/core/game';
import { fetchTransport } from '../../src/net/api';
import { decideSync, progressScore, type SaveMeta } from '../../src/net/cloudSave';
import { OnlineServices } from '../../src/net/online';
import { buildReport } from '../src/services/report';
import { playTutorial } from '../../tests/helpers';
import { device, MemStore } from './device';
import { startServer } from './helpers';

const meta = (m: Partial<SaveMeta>): SaveMeta => ({ serverVersion: 1, dirty: false, userId: 1, ...m });

describe('云存档合并规则', () => {
  const cfg = defaultConfig();
  const s = (stage: number, forges: number) => {
    const st = Game.newState(cfg, 0, 1);
    st.stage.next = stage;
    st.counters.forges = forges;
    return st;
  };
  it.each([
    ['服务端无存档 → 上传', s(2, 1), meta({}), { version: 0, data: null }, 'upload'],
    ['本地无存档 → 用服务端', null, meta({}), { version: 3, data: '{}' }, 'useServer'],
    ['同版本、本地无改动 → 不动', s(2, 1), meta({ serverVersion: 3 }), { version: 3, data: '{}' }, 'noop'],
    ['同版本、本地有改动 → 上传', s(2, 1), meta({ serverVersion: 3, dirty: true }), { version: 3, data: '{}' }, 'upload'],
    ['其他设备更新过、本地无改动 → 用服务端', s(9, 9), meta({ serverVersion: 2 }), { version: 3, data: JSON.stringify(s(2, 1)) }, 'useServer'],
    ['双方都有改动、本地进度更高 → 上传', s(9, 1), meta({ serverVersion: 2, dirty: true }), { version: 3, data: JSON.stringify(s(5, 99)) }, 'upload'],
    ['双方都有改动、服务端进度更高 → 用服务端', s(5, 1), meta({ serverVersion: 2, dirty: true }), { version: 3, data: JSON.stringify(s(9, 1)) }, 'useServer'],
  ] as const)('%s', (_n, local, m, server, expected) => {
    expect(decideSync(local as GameState | null, m, server)).toBe(expected);
  });
  it('进度比较以主线为主', () => {
    expect(progressScore(s(3, 0))).toBeGreaterThan(progressScore(s(2, 999)));
  });
});

describe('联网客户端 × 真实服务端', () => {
  it('云存档：设备 A 的进度在设备 B（同账号）上恢复；关闭重进仍正确', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const a = device(srv, 'phone-1');
      expect(await a.online.start()).toBe(true);
      playTutorial(a.game);
      a.game.swap(0, 1);
      await a.online.cloud.flush();
      expect(a.online.cloud.meta.dirty).toBe(false);

      // 同一账号换一台设备（本地没有存档）
      const b = device(srv, 'phone-1');
      expect(await b.online.start()).toBe(true);
      expect(b.online.syncDecision).toBe('useServer');
      expect(b.game.state.chain.map((r) => r?.id)).toEqual(a.game.state.chain.map((r) => r?.id));
      expect(b.game.state.tutorial.step).toBe('done');

      // A 继续玩并上传，B 本地没改动 → 重进时拿到新进度
      a.game.gm.addGold(777);
      await a.online.cloud.flush();
      const b2 = device(srv, 'phone-1', { state: b.game.state, store: b.store });
      await b2.online.start();
      expect(b2.game.state.gold).toBe(a.game.state.gold);
    } finally {
      await srv.close();
    }
  });

  it('支付：服务端下单 → 到账 → 发放进存档 → 服务端确认已发放；首充不可重复', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const d = device(srv, 'payer-1');
      await d.online.start();
      playTutorial(d.game);
      const hammers = d.game.state.hammers;
      const r = await d.game.purchase('first_charge');
      expect(r.ok).toBe(true);
      expect(d.game.state.hammers).toBe(hammers + 20);
      expect(d.game.state.pity.firstChargeEpicPending).toBe(true);
      await new Promise((res) => setTimeout(res, 50));
      await d.online.cloud.flush();
      await new Promise((res) => setTimeout(res, 50));
      expect((await d.online.api.payPending()).orders).toEqual([]);
      expect((await d.game.purchase('first_charge')).ok).toBe(false);

      const cancelled = device(srv, 'payer-2', { confirmPay: false });
      await cancelled.online.start();
      expect(await cancelled.game.purchase('monthly_card')).toEqual({ ok: false, error: 'cancelled' });
    } finally {
      await srv.close();
    }
  });

  it('支付后游戏被关掉：下次启动自动补发，且只发一次', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const d = device(srv, 'killed');
      await d.online.start();
      // 直接走服务端到账，但客户端没来得及发放
      const order = await d.online.api.payCreate('monthly_card');
      await d.online.api.payDevComplete(order.outTradeNo);
      expect(d.game.monthlyActive()).toBe(false);

      const again = device(srv, 'killed', { state: d.game.state, store: d.store });
      await again.online.start();
      expect(again.game.monthlyActive()).toBe(true);
      expect(again.game.state.shop.grantedOrders).toContain(order.outTradeNo);
      await new Promise((res) => setTimeout(res, 50));
      const third = device(srv, 'killed', { state: again.game.state, store: again.store });
      await third.online.start();
      expect(third.game.state.shop.grantedOrders.filter((x) => x === order.outTradeNo)).toHaveLength(1);
      expect((await third.online.api.payPending()).orders).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  it('异步竞技场：两个真实账号互相匹配，服务端结算，客户端复现并更新积分', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const p1 = device(srv, 'arena-1');
      const p2 = device(srv, 'arena-2');
      for (const p of [p1, p2]) {
        await p.online.start();
        playTutorial(p.game);
        p.game.gm.setStage(11);
        await p.online.uploadSnapshotIfNeeded();
      }
      const view = await p1.online.loadArena();
      expect(view.attemptsLeft).toBe(3);
      const real = view.opponents.find((o) => !o.isTestData);
      expect(real).toBeTruthy();
      expect(view.opponents.filter((o) => o.isTestData).every((o) => o.name.includes('测试账号'))).toBe(true);
      const before = p1.game.state.hammers;
      const battle = await p1.online.challengeArena(real!.opponentId);
      expect(battle.opponent.isTestData).toBe(false);
      expect(p1.game.state.arena.score).toBe(defaultConfig().economy.arena.startScore + battle.scoreDelta);
      expect(p1.game.state.hammers).toBe(before + 1);
      expect(battle.result.events[battle.result.events.length - 1]).toMatchObject({ k: 'end', win: battle.result.win });
      const after = await p1.online.loadArena();
      expect(after.attemptsLeft).toBe(2);
      expect([...after.top, ...after.around].some((r) => r.isSelf && r.score === p1.game.state.arena.score)).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('埋点：客户端事件上报到服务端，报表可查', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const d = device(srv, 'tracked-1');
      await d.online.start();
      playTutorial(d.game);
      await d.online.analytics.flush();
      expect(d.online.analytics.pending).toBe(0);
      const rep = buildReport(srv.ctx);
      expect(rep.users).toBe(1);
      expect(rep.retention.tutorialCompletionRate).toBe(100);
      expect(rep.forge.perUserDay.p50).toBeGreaterThanOrEqual(5);
      expect(rep.chain.recommendAcceptRate).not.toBeNull();
      expect(rep.stuck.firstFailStageDistribution).toHaveProperty('3');
    } finally {
      await srv.close();
    }
  });

  it('服务端不可用：离线运行，支付不可用', async () => {
    const cfg = defaultConfig();
    const store = new MemStore();
    const game = new Game(cfg, Game.newState(cfg, Date.now(), 5), { now: Date.now, save: (j) => store.set('save', j) });
    const online = new OnlineServices(game, {
      apiBase: 'http://127.0.0.1:9',
      transport: fetchTransport,
      store,
      deviceId: () => 'x',
      confirmDevPay: async () => true,
    });
    game.setPayment({ pay: async () => ({ ok: false, error: 'offline' }) });
    expect(await online.start()).toBe(false);
    expect(online.status).toBe('offline');
    expect((await game.purchase('monthly_card')).ok).toBe(false);
  });
});
