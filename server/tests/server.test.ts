import { createHash } from 'node:crypto';
import { snapshotFighter } from '../../src/core/arena';
import { simulatePvp } from '../../src/core/battle';
import { defaultConfig } from '../../src/core/config';
import { hmacSha256 } from '../src/wx';
import { startServer, TEST_APP_KEY } from './helpers';

const gameCfg = defaultConfig();

function snapshot(power: number, types = ['feng', 'ji', 'feng', 'yu', 'zhen', 'feng']) {
  return {
    atk: power * 0.5,
    hp: power * 5,
    def: 0,
    speed: 100,
    power,
    chain: types.map((type) => ({ type, quality: 1, strength: 20 })),
    savedAt: 1,
  };
}

function pushQuery(token: string) {
  const timestamp = '1700000000';
  const nonce = 'abc';
  const signature = createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex');
  return `timestamp=${timestamp}&nonce=${nonce}&signature=${signature}`;
}

describe('账号', () => {
  it('微信登录：code2Session → 会话令牌；同一 openid 复用账号', async () => {
    const s = await startServer();
    try {
      const a = await s.call('POST', '/api/auth/wx-login', { code: 'code-alice' });
      expect(a.status).toBe(200);
      expect(a.data.isNew).toBe(true);
      const again = await s.call('POST', '/api/auth/wx-login', { code: 'code-alice' });
      expect(again.data.userId).toBe(a.data.userId);
      expect(again.data.isNew).toBe(false);
      const me = await s.call('GET', '/api/me', undefined, again.data.token);
      expect(me.data).toMatchObject({ userId: a.data.userId, wx: true });
      expect((await s.call('POST', '/api/auth/wx-login', { code: 'bad' })).status).toBe(401);
      expect((await s.call('GET', '/api/me')).status).toBe(401);
    } finally {
      await s.close();
    }
  });

  it('设备号登录默认关闭，开启后可用', async () => {
    const off = await startServer();
    expect((await off.call('POST', '/api/auth/dev-login', { deviceId: 'd1' })).status).toBe(403);
    await off.close();
    const on = await startServer({ devLogin: true });
    const r = await on.call('POST', '/api/auth/dev-login', { deviceId: 'd1' });
    expect(r.status).toBe(200);
    expect((await on.call('POST', '/api/auth/dev-login', { deviceId: 'd1' })).data.userId).toBe(r.data.userId);
    await on.close();
  });
});

describe('云存档', () => {
  it('乐观并发：基于旧版本写入返回 409 和服务端数据', async () => {
    const s = await startServer();
    try {
      const t = await s.wxUser('saver');
      expect((await s.call('GET', '/api/save', undefined, t)).data).toMatchObject({ version: 0, data: null });
      const w1 = await s.call('PUT', '/api/save', { data: JSON.stringify({ a: 1 }), baseVersion: 0 }, t);
      expect(w1.data.version).toBe(1);
      const stale = await s.call('PUT', '/api/save', { data: JSON.stringify({ a: 2 }), baseVersion: 0 }, t);
      expect(stale.status).toBe(409);
      expect(JSON.parse(stale.data.data)).toEqual({ a: 1 });
      const w2 = await s.call('PUT', '/api/save', { data: JSON.stringify({ a: 3 }), baseVersion: 1 }, t);
      expect(w2.data.version).toBe(2);
      const other = await s.wxUser('other');
      expect((await s.call('GET', '/api/save', undefined, other)).data.version).toBe(0);
      expect((await s.call('PUT', '/api/save', { data: 'not json', baseVersion: 2 }, t)).status).toBe(400);
    } finally {
      await s.close();
    }
  });
});

describe('异步竞技场（真实账号快照）', () => {
  it('多个账号：上传快照 → 互相匹配 → 服务端结算 → 客户端可复现 → 积分与排名更新', async () => {
    const s = await startServer();
    try {
      const a = await s.wxUser('a');
      const b = await s.wxUser('b');
      const c = await s.wxUser('c');
      expect((await s.call('POST', '/api/arena/opponents', {}, a)).status).toBe(409);
      await s.call('PUT', '/api/arena/snapshot', { snapshot: snapshot(1000) }, a);
      await s.call('PUT', '/api/arena/snapshot', { snapshot: snapshot(1000, ['yu', 'yu', 'feng', 'feng', 'ji', 'feng']) }, b);
      await s.call('PUT', '/api/arena/snapshot', { snapshot: snapshot(1120) }, c);
      expect((await s.call('PUT', '/api/arena/snapshot', { snapshot: { ...snapshot(10), chain: [] } }, a)).status).toBe(400);

      const offers = await s.call('POST', '/api/arena/opponents', {}, a);
      expect(offers.data.opponents.map((o: any) => o.tier)).toEqual(['weak', 'close', 'strong']);
      const close = offers.data.opponents[1];
      const strong = offers.data.opponents[2];
      expect(close.isTestData).toBe(false);
      expect(strong.isTestData).toBe(false);
      expect(offers.data.opponents[0].isTestData).toBe(true);
      expect(offers.data.opponents[0].name).toContain('测试账号');

      const fight = await s.call('POST', '/api/arena/challenge', { opponentId: close.opponentId }, a);
      expect(fight.status).toBe(200);
      const replay = simulatePvp(gameCfg, snapshotFighter('我', fight.data.attacker), snapshotFighter(close.name, fight.data.defender), fight.data.seed);
      expect(replay.win).toBe(fight.data.win);
      expect(fight.data.scoreDelta).toBe(fight.data.win ? gameCfg.economy.arena.winScore.close : gameCfg.economy.arena.loseScore);
      expect(fight.data.score).toBe(gameCfg.economy.arena.startScore + fight.data.scoreDelta);
      expect(fight.data.attemptsLeft).toBe(2);

      // 挑战后报价作废，必须重新刷新对手
      expect((await s.call('POST', '/api/arena/challenge', { opponentId: close.opponentId }, a)).status).toBe(409);
      for (let i = 0; i < 2; i++) {
        const o = await s.call('POST', '/api/arena/opponents', {}, a);
        expect((await s.call('POST', '/api/arena/challenge', { opponentId: o.data.opponents[1].opponentId }, a)).status).toBe(200);
      }
      const o4 = await s.call('POST', '/api/arena/opponents', {}, a);
      expect((await s.call('POST', '/api/arena/challenge', { opponentId: o4.data.opponents[1].opponentId }, a)).status).toBe(429);

      const st = await s.call('GET', '/api/arena/state', undefined, a);
      expect(st.data.wins + st.data.losses).toBe(3);
      const board = await s.call('GET', '/api/arena/leaderboard', undefined, b);
      expect(board.data.top.some((r: any) => r.isSelf)).toBe(true);
      const ranked = board.data.top.map((r: any) => r.score);
      expect([...ranked].sort((x: number, y: number) => y - x)).toEqual(ranked);

      // 第二天次数重置
      s.clock.t += 24 * 3600 * 1000;
      expect((await s.call('GET', '/api/arena/state', undefined, a)).data.attemptsLeft).toBe(3);
    } finally {
      await s.close();
    }
  });
});

describe('微信虚拟支付', () => {
  it('下单签名 → 查单确认到账 → 待发放 → 确认发放；首充不可重复', async () => {
    const s = await startServer();
    try {
      const t = await s.wxUser('payer');
      const order = await s.call('POST', '/api/pay/create', { productId: 'first_charge' }, t);
      expect(order.status).toBe(200);
      const { signData, paySig, signature, outTradeNo, mode } = order.data;
      expect(mode).toBe('short_series_goods');
      expect(JSON.parse(signData)).toMatchObject({ offerId: 'offer-1', buyQuantity: 1, currencyType: 'CNY', goodsPrice: 600, outTradeNo, env: 0 });
      expect(paySig).toBe(hmacSha256(TEST_APP_KEY, `requestVirtualPayment&${signData}`));
      expect(signature).toBe(hmacSha256('sk-payer', signData));

      expect((await s.call('POST', '/api/pay/confirm', { outTradeNo }, t)).data.status).toBe('created');
      s.fake.orders.set(outTradeNo, 2);
      expect((await s.call('POST', '/api/pay/confirm', { outTradeNo }, t)).data.status).toBe('delivered');
      expect(s.fake.provided).toContain(outTradeNo);

      const pending = await s.call('GET', '/api/pay/pending', undefined, t);
      expect(pending.data.orders).toEqual([{ outTradeNo, productId: 'first_charge', status: 'delivered', acked: false }]);
      await s.call('POST', '/api/pay/ack', { outTradeNo }, t);
      expect((await s.call('GET', '/api/pay/pending', undefined, t)).data.orders).toEqual([]);
      expect((await s.call('GET', '/api/pay/entitlements', undefined, t)).data).toEqual({ firstChargeBought: true, monthlyCards: 0 });
      expect((await s.call('POST', '/api/pay/create', { productId: 'first_charge' }, t)).status).toBe(409);

      const other = await s.wxUser('someone');
      expect((await s.call('POST', '/api/pay/confirm', { outTradeNo }, other)).status).toBe(404);
    } finally {
      await s.close();
    }
  });

  it('发货通知：签名校验、重复通知只发一次、openid 不符拒绝', async () => {
    const s = await startServer();
    try {
      const t = await s.wxUser('notified');
      const { outTradeNo } = (await s.call('POST', '/api/pay/create', { productId: 'monthly_card' }, t)).data;
      const msg = { Event: 'xpay_goods_deliver_notify', OpenId: 'openid-notified', OutTradeNo: outTradeNo, GoodsInfo: { ProductId: 'monthly_card' }, WeChatPayInfo: { TransactionId: 'tx1' } };
      expect((await s.call('POST', '/api/pay/wx-notify?timestamp=1&nonce=2&signature=bad', msg)).status).toBe(403);
      const q = pushQuery('push-token');
      const verify = await s.call('GET', `/api/pay/wx-notify?${q}&echostr=hello`);
      expect(verify.data).toBe('hello');
      const first = await s.call('POST', `/api/pay/wx-notify?${q}`, msg);
      expect(first.data.ErrCode).toBe(0);
      const second = await s.call('POST', `/api/pay/wx-notify?${q}`, msg);
      expect(second.data.ErrCode).toBe(0);
      expect((await s.call('GET', '/api/pay/pending', undefined, t)).data.orders).toHaveLength(1);
      const wrong = await s.call('POST', `/api/pay/wx-notify?${q}`, { ...msg, OpenId: 'openid-evil' });
      expect(wrong.data.ErrCode).toBe(1);
    } finally {
      await s.close();
    }
  });

  it('开发支付：只在开启时可用，走同一条到账流程', async () => {
    const s = await startServer({ devLogin: true, devPay: true });
    try {
      const t = (await s.call('POST', '/api/auth/dev-login', { deviceId: 'web-1' })).data.token;
      const order = await s.call('POST', '/api/pay/create', { productId: 'monthly_card' }, t);
      expect(order.data.mode).toBe('dev');
      expect((await s.call('POST', '/api/pay/dev-complete', { outTradeNo: order.data.outTradeNo }, t)).data.status).toBe('delivered');
      expect((await s.call('GET', '/api/pay/pending', undefined, t)).data.orders).toHaveLength(1);
    } finally {
      await s.close();
    }
    const prod = await startServer({ devLogin: true, devPay: false, wxOverrides: { offerId: '' } });
    const t2 = (await prod.call('POST', '/api/auth/dev-login', { deviceId: 'web-2' })).data.token;
    expect((await prod.call('POST', '/api/pay/create', { productId: 'monthly_card' }, t2)).status).toBe(503);
    await prod.close();
  });
});

describe('埋点与数据看板', () => {
  it('批量上报入库，报表能回答 MVP 数据问题', async () => {
    const s = await startServer();
    try {
      const t = await s.wxUser('tracked');
      const t0 = s.clock.t;
      const ev = (name: string, props: Record<string, unknown>, dt = 0) => ({ name, t: t0 + dt, session: 's1', props });
      const events = [
        ev('first_enter', {}),
        ev('session_start', { hammers: 5 }),
        ...Array.from({ length: 8 }, (_, i) => ev('forge', { type: i % 2 ? 'feng' : 'yu', quality: i === 0 ? 3 : 0, furnace: 1 }, i)),
        ev('rune_decision', { decision: 'recommend', effective: true, nonPurePower: false, combosGained: ['迅斩'], combosLost: [] }, 10),
        ev('rune_decision', { decision: 'manual', effective: true, nonPurePower: true, combosGained: [], combosLost: [] }, 11),
        ev('rune_decision', { decision: 'melt', effective: false }, 12),
        ev('chain_swap', {}, 13),
        ev('battle', { source: 'stage', stage: 6, win: false }, 20),
        ev('stuck_first_fail', { stage: 6, weaknessMatch: 0 }, 21),
        ev('stuck_next_action', { stage: 6, action: 'swap' }, 22),
        ev('stuck_pass', { stage: 6, durationMs: 120000, adjusted: true, weaknessImproved: true, paid: false }, 140000),
        ev('pay_show', { product: 'first_charge' }, 150000),
        ev('pay_success', { product: 'first_charge' }, 160000),
        ev('forge', { type: 'zhen', quality: 3, furnace: 1 }, 170000),
        ev('tutorial_complete', {}, 180000),
        { name: 'BAD NAME', t: t0, props: {} },
      ];
      const r = await s.call('POST', '/api/track', { events }, t);
      expect(r.data.accepted).toBe(events.length - 1);
      expect((await s.call('GET', '/api/admin/report?key=wrong')).status).toBe(403);
      const rep = (await s.call('GET', '/api/admin/report', undefined, undefined, { 'X-Admin-Key': 'admin' })).data;
      expect(rep.users).toBe(1);
      expect(rep.forge.perUserDay.p50).toBe(9);
      expect(rep.forge.runeTypeSharePercent.feng).toBeCloseTo(44.4, 1);
      expect(rep.chain.recommendAcceptRate).toBe(50);
      expect(rep.chain.manualAdjustRate).toBe(100);
      expect(rep.chain.nonPurePowerRate).toBe(50);
      expect(rep.chain.effectiveRuneRate).toBeCloseTo(66.7, 1);
      expect(rep.stuck.firstFailStageDistribution).toEqual({ 6: 1 });
      expect(rep.stuck.stuckStages[0]).toMatchObject({ stage: 6, firstFailUsers: 1, passes: 1, medianStuckMinutes: 2 });
      expect(rep.stuck.afterFirstFailNextActionPercent).toEqual({ swap: 100 });
      expect(rep.firstCharge).toMatchObject({ shownUsers: 1, buyers: 1, conversionRate: 100 });
      expect(rep.firstCharge.eventsWithin30MinAfter).toMatchObject({ forge: 1, tutorial_complete: 1 });
      expect(rep.retention.tutorialCompletionRate).toBe(100);
    } finally {
      await s.close();
    }
  });
});
