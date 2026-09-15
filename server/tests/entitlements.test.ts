import { defaultConfig } from '../../src/core/config';
import { Game } from '../../src/core/game';
import { playTutorial } from '../../tests/helpers';
import { device, reopen, tick } from './device';
import { startServer } from './helpers';

const DAY = 86_400_000;
const shop = defaultConfig().shop;

async function devBuy(d: ReturnType<typeof device>, productId: string) {
  const r = await d.game.purchase(productId);
  expect(r.ok).toBe(true);
  await tick();
  await d.online.cloud.flush();
  await tick();
}

describe('服务端权益计算', () => {
  it('月卡：有效期内续费顺延，过期后重新开始；已确认发放的订单仍计入；首充只算一次', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      let t = (await srv.call('POST', '/api/auth/dev-login', { deviceId: 'ent-1' })).data.token;
      const buy = async (productId: string) => {
        const o = (await srv.call('POST', '/api/pay/create', { productId }, t)).data;
        await srv.call('POST', '/api/pay/dev-complete', { outTradeNo: o.outTradeNo }, t);
        await srv.call('POST', '/api/pay/ack', { outTradeNo: o.outTradeNo }, t);
        return o.outTradeNo as string;
      };
      const t0 = srv.clock.t;
      await buy('monthly_card');
      srv.clock.t += 10 * DAY;
      await buy('monthly_card');
      let e = (await srv.call('GET', '/api/pay/entitlements', undefined, t)).data;
      expect(e.monthlyCard).toEqual({ start: t0, end: t0 + 60 * DAY });
      expect(e.orders.every((o: any) => o.acked)).toBe(true);
      expect(e.firstCharge).toBeNull();

      srv.clock.t = t0 + 90 * DAY;
      // 会话 30 天过期，重新登录
      t = (await srv.call('POST', '/api/auth/dev-login', { deviceId: 'ent-1' })).data.token;
      await buy('monthly_card');
      e = (await srv.call('GET', '/api/pay/entitlements', undefined, t)).data;
      expect(e.monthlyCard).toEqual({ start: t0 + 90 * DAY, end: t0 + 120 * DAY });

      const fc = await buy('first_charge');
      e = (await srv.call('GET', '/api/pay/entitlements', undefined, t)).data;
      expect(e.firstCharge.outTradeNo).toBe(fc);
      expect(e.orders.filter((o: any) => o.productId === 'first_charge')).toHaveLength(1);
    } finally {
      await srv.close();
    }
  });
});

describe('客户端权益校准（Game.applyEntitlements）', () => {
  const cfg = defaultConfig();
  const now = new Date('2026-09-16T10:00:00+08:00').getTime();
  const mk = () => new Game(cfg, Game.newState(cfg, now, 1), { now: () => now });

  it('补发缺失的首充订单一次；重复校准不再变化', () => {
    const g = mk();
    const h = g.state.hammers;
    const e = { serverNow: now, firstCharge: { outTradeNo: 'FC1' }, monthlyCard: { start: 0, end: 0 }, orders: [{ outTradeNo: 'FC1', productId: 'first_charge' }] };
    expect(g.applyEntitlements(e)).toEqual({ restored: ['FC1'], changed: true });
    expect(g.state.hammers).toBe(h + shop.firstCharge.hammers);
    expect(g.state.shop).toMatchObject({ firstChargeBought: true, cosmeticOwned: true });
    expect(g.state.pity.firstChargeEpicPending).toBe(true);
    expect(g.applyEntitlements(e)).toEqual({ restored: [], changed: false });
    expect(g.state.hammers).toBe(h + shop.firstCharge.hammers);
  });

  it('已发放过的订单不重复给资源，但标记以服务端为准', () => {
    const g = mk();
    g.state.shop.grantedOrders.push('FC1');
    g.state.pity.firstChargeEpicPending = false; // 已经用掉
    const h = g.state.hammers;
    g.applyEntitlements({ serverNow: now, firstCharge: { outTradeNo: 'FC1' }, monthlyCard: { start: 0, end: 0 }, orders: [{ outTradeNo: 'FC1', productId: 'first_charge' }] });
    expect(g.state.hammers).toBe(h);
    expect(g.state.pity.firstChargeEpicPending).toBe(false);
    expect(g.state.shop.firstChargeBought).toBe(true);
  });

  it('月卡到期时间按服务端换算到本机时钟；毫秒级偏差不改存档', () => {
    const g = mk();
    const serverNow = now - 5000; // 本机比服务端快 5 秒
    const e = { serverNow, firstCharge: null, monthlyCard: { start: serverNow - DAY, end: serverNow + 29 * DAY }, orders: [{ outTradeNo: 'M1', productId: 'monthly_card' }] };
    g.applyEntitlements(e);
    expect(g.state.shop.monthlyEnd).toBe(now + 29 * DAY);
    expect(g.monthlyDaysLeft()).toBe(29);
    expect(g.applyEntitlements({ ...e, serverNow: serverNow - 800 }).changed).toBe(false);
  });

  it('存档里没有订单支撑的权益被收回（首充标记、月卡时长）', () => {
    const g = mk();
    g.state.shop.firstChargeBought = true;
    g.state.shop.cosmeticOwned = true;
    g.state.pity.firstChargeEpicPending = true;
    g.state.shop.monthlyEnd = now + 365 * DAY;
    g.applyEntitlements({ serverNow: now, firstCharge: null, monthlyCard: { start: 0, end: 0 }, orders: [] });
    expect(g.state.shop).toMatchObject({ firstChargeBought: false, cosmeticOwned: false, monthlyEnd: 0 });
    expect(g.state.pity.firstChargeEpicPending).toBe(false);
    expect(g.monthlyActive()).toBe(false);
  });
});

describe('跨设备存档冲突不会丢失已购买权益', () => {
  it('旧设备进度更高、覆盖了含购买记录的云存档：首充与月卡恢复，锻造锤只补一次', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      // 设备 B 先玩并上传，然后离线继续推进（本地有未上传改动）
      const b = device(srv, 'account-x');
      await b.online.start();
      playTutorial(b.game);
      await b.online.cloud.flush();
      const bStore = b.store.clone();
      const bOffline = reopen(srv, 'account-x', { store: bStore });
      bOffline.game.gm.setStage(40);
      bOffline.game.gm.addHammers(7);
      expect(bOffline.online.cloud.meta.dirty).toBe(true);

      // 设备 A（同账号）拉到云存档后购买首充 + 月卡，已确认发放（不再出现在待发放里）
      const a = device(srv, 'account-x');
      await a.online.start();
      expect(a.online.syncDecision).toBe('useServer');
      await devBuy(a, 'first_charge');
      await devBuy(a, 'monthly_card');
      expect((await a.online.api.payPending()).orders).toEqual([]);
      const aMonthlyEnd = a.game.state.shop.monthlyEnd;

      // B 重新联网：本地进度更高 → 用 B 的存档覆盖云端（B 的存档里没有购买记录）
      const hammersBeforeB = bOffline.game.state.hammers;
      await bOffline.online.start();
      expect(bOffline.online.syncDecision).toBe('upload');
      const bs = bOffline.game.state;
      expect(bs.stage.next).toBe(40);
      expect(bs.shop.firstChargeBought).toBe(true);
      expect(bs.shop.cosmeticOwned).toBe(true);
      expect(bs.pity.firstChargeEpicPending).toBe(true);
      expect(bOffline.game.monthlyActive()).toBe(true);
      expect(Math.abs(bs.shop.monthlyEnd - aMonthlyEnd)).toBeLessThan(60_000);
      expect(bs.hammers).toBe(hammersBeforeB + shop.firstCharge.hammers);
      expect(bs.shop.grantedOrders).toHaveLength(2);

      // 云端存档已经包含恢复后的权益
      const cloud = JSON.parse((await bOffline.online.api.getSave()).data!);
      expect(cloud.shop.firstChargeBought).toBe(true);
      expect(cloud.shop.grantedOrders).toHaveLength(2);

      // A 重开：拿到 B 的存档，权益仍在，锻造锤没有被再补一次
      const aAgain = reopen(srv, 'account-x', a);
      await aAgain.online.start();
      expect(aAgain.online.syncDecision).toBe('useServer');
      expect(aAgain.game.state.stage.next).toBe(40);
      expect(aAgain.game.state.hammers).toBe(bs.hammers);
      expect(aAgain.game.state.shop.firstChargeBought).toBe(true);
      expect(aAgain.game.monthlyActive()).toBe(true);

      // 再次校准：两边都不再变化
      expect((await aAgain.online.reconcileEntitlements()).changed).toBe(false);
      expect((await bOffline.online.reconcileEntitlements()).changed).toBe(false);
    } finally {
      await srv.close();
    }
  });

  it('刚买完还没上传，就被另一台进度更高的设备覆盖：本地被替换后立即补回', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const a = device(srv, 'account-y');
      await a.online.start();
      playTutorial(a.game);
      await a.online.cloud.flush();

      const b = device(srv, 'account-y');
      await b.online.start();
      b.game.gm.setStage(50);
      await b.online.cloud.flush();

      // A 基于旧版本购买 → 上传时冲突 → 云端进度更高 → A 的本地存档被替换
      const r = await a.game.purchase('monthly_card');
      expect(r.ok).toBe(true);
      await a.online.cloud.flush();
      await tick(50);
      await a.online.reconcileEntitlements();
      expect(a.game.state.stage.next).toBe(50);
      expect(a.game.monthlyActive()).toBe(true);
      expect(a.game.state.shop.grantedOrders).toHaveLength(1);

      const bAgain = reopen(srv, 'account-y', b);
      await bAgain.online.start();
      expect(bAgain.game.monthlyActive()).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('被篡改的本地存档（无订单却有首充 / 超长月卡）联网后恢复为服务端状态并上传', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const d = device(srv, 'account-z');
      await d.online.start();
      d.game.state.shop.firstChargeBought = true;
      d.game.state.shop.monthlyEnd = srv.clock.t + 999 * DAY;
      d.game.save();
      const reopened = reopen(srv, 'account-z', d);
      await reopened.online.start();
      expect(reopened.game.state.shop.firstChargeBought).toBe(false);
      expect(reopened.game.monthlyActive()).toBe(false);
      const cloud = JSON.parse((await reopened.online.api.getSave()).data!);
      expect(cloud.shop.monthlyEnd).toBe(0);
      expect((await reopened.game.purchase('first_charge')).ok).toBe(true);
    } finally {
      await srv.close();
    }
  });

  it('离线期间的存档不影响：回到前台时再次校准', async () => {
    const srv = await startServer({ devLogin: true, devPay: true });
    try {
      const d = device(srv, 'account-w');
      await d.online.start();
      await devBuy(d, 'monthly_card');
      d.game.state.shop.monthlyEnd = 0;
      d.online.onShow();
      await tick(80);
      await d.online.reconcileEntitlements();
      expect(d.game.monthlyActive()).toBe(true);
    } finally {
      await srv.close();
    }
  });
});

