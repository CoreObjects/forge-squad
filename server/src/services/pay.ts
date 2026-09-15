import { randomBytes } from 'node:crypto';
import { defaultConfig } from '../../../src/core/config';
import { wxPayConfigured } from '../config';
import { getUser, type Ctx } from '../context';
import { tx } from '../db';
import { HttpError, requireString, type Router } from '../http';
import { checkPushSignature, requestPaySig, userSignature, WX_ORDER_PAID_STATUSES } from '../wx';

const shop = defaultConfig().shop;

interface OrderRow {
  out_trade_no: string;
  user_id: number;
  product_id: string;
  price_fen: number;
  status: 'created' | 'delivered' | 'closed';
  channel: 'wx' | 'dev';
  wx_transaction_id: string | null;
  created_at: number;
  paid_at: number | null;
  delivered_at: number | null;
  acked_at: number | null;
}

function product(productId: string): { id: string; priceFen: number; name: string } {
  if (productId === shop.firstCharge.id) return { id: productId, priceFen: Math.round(shop.firstCharge.price * 100), name: shop.firstCharge.name };
  if (productId === shop.monthlyCard.id) return { id: productId, priceFen: Math.round(shop.monthlyCard.price * 100), name: shop.monthlyCard.name };
  throw new HttpError(400, 'unknown_product');
}

export function registerPay(router: Router, ctx: Ctx): void {
  const db = ctx.db;
  const getOrder = (no: string) => db.prepare('SELECT * FROM orders WHERE out_trade_no = ?').get(no) as unknown as OrderRow | undefined;

  /** 发货（幂等）：只有 created → delivered 一次 */
  const deliver = (no: string, transactionId: string | null): OrderRow => {
    return tx(db, () => {
      const o = getOrder(no);
      if (!o) throw new HttpError(404, 'order_not_found');
      if (o.status === 'delivered') return o;
      if (o.product_id === shop.firstCharge.id) {
        const dup = db.prepare("SELECT 1 FROM orders WHERE user_id = ? AND product_id = ? AND status = 'delivered'").get(o.user_id, o.product_id);
        if (dup) {
          // 首充已到账过：这笔标记关闭，不再发货（需人工退款）
          db.prepare("UPDATE orders SET status = 'closed' WHERE out_trade_no = ?").run(no);
          return getOrder(no)!;
        }
      }
      const now = ctx.now();
      db.prepare("UPDATE orders SET status = 'delivered', paid_at = COALESCE(paid_at, ?), delivered_at = ?, wx_transaction_id = COALESCE(?, wx_transaction_id) WHERE out_trade_no = ?").run(
        now,
        now,
        transactionId,
        no,
      );
      return getOrder(no)!;
    });
  };

  const view = (o: OrderRow) => ({ outTradeNo: o.out_trade_no, productId: o.product_id, status: o.status, acked: !!o.acked_at });

  router.post('/api/pay/create', (req) => {
    const p = product(requireString(req.body?.productId, 'productId', 64));
    if (p.id === shop.firstCharge.id) {
      const bought = db.prepare("SELECT 1 FROM orders WHERE user_id = ? AND product_id = ? AND status = 'delivered'").get(req.userId, p.id);
      if (bought) throw new HttpError(409, 'already_bought');
    }
    const user = getUser(ctx, req.userId);
    const useWx = wxPayConfigured(ctx.cfg) && !!user.openid;
    if (!useWx && !ctx.cfg.devPay) throw new HttpError(503, 'pay_not_available');
    const outTradeNo = `FS${ctx.now().toString(36)}${randomBytes(6).toString('hex')}`.toUpperCase();
    db.prepare("INSERT INTO orders (out_trade_no, user_id, product_id, price_fen, status, channel, created_at) VALUES (?, ?, ?, ?, 'created', ?, ?)").run(
      outTradeNo,
      req.userId,
      p.id,
      p.priceFen,
      useWx ? 'wx' : 'dev',
      ctx.now(),
    );
    if (!useWx) return { json: { outTradeNo, mode: 'dev', priceFen: p.priceFen } };
    if (!user.session_key) throw new HttpError(401, 'session_key_missing');
    const signData = JSON.stringify({
      offerId: ctx.cfg.wx.offerId,
      buyQuantity: 1,
      env: ctx.cfg.wx.payEnv,
      currencyType: 'CNY',
      productId: ctx.cfg.wx.productIds[p.id] ?? p.id,
      goodsPrice: p.priceFen,
      outTradeNo,
      attach: String(req.userId),
    });
    return {
      json: {
        outTradeNo,
        mode: 'short_series_goods',
        signData,
        paySig: requestPaySig(ctx.cfg.wx.appKey, signData),
        signature: userSignature(user.session_key, signData),
        priceFen: p.priceFen,
      },
    };
  });

  /** 客户端支付成功后确认：未到账时向微信查单，已支付则发货 */
  router.post('/api/pay/confirm', async (req) => {
    const o = getOrder(requireString(req.body?.outTradeNo, 'outTradeNo', 64));
    if (!o || o.user_id !== req.userId) throw new HttpError(404, 'order_not_found');
    if (o.status !== 'created' || o.channel !== 'wx') return { json: view(o) };
    const user = getUser(ctx, req.userId);
    const q = await ctx.wx.queryOrder(user.openid!, o.out_trade_no);
    if (q && WX_ORDER_PAID_STATUSES.has(q.status)) {
      const d = deliver(o.out_trade_no, q.transactionId ?? null);
      void ctx.wx.notifyProvideGoods(o.out_trade_no).catch(() => false);
      return { json: view(d) };
    }
    return { json: view(o) };
  });

  /** 开发支付：模拟“支付成功 + 微信发货通知” */
  router.post('/api/pay/dev-complete', (req) => {
    if (!ctx.cfg.devPay) throw new HttpError(403, 'dev_pay_disabled');
    const o = getOrder(requireString(req.body?.outTradeNo, 'outTradeNo', 64));
    if (!o || o.user_id !== req.userId || o.channel !== 'dev') throw new HttpError(404, 'order_not_found');
    return { json: view(deliver(o.out_trade_no, `dev-${o.out_trade_no}`)) };
  });

  /** 已到账但客户端还没确认发放的订单（例如支付后游戏被杀掉） */
  router.get('/api/pay/pending', (req) => {
    const rows = db.prepare("SELECT * FROM orders WHERE user_id = ? AND status = 'delivered' AND acked_at IS NULL ORDER BY delivered_at").all(req.userId) as unknown as OrderRow[];
    return { json: { orders: rows.map(view) } };
  });

  router.post('/api/pay/ack', (req) => {
    const no = requireString(req.body?.outTradeNo, 'outTradeNo', 64);
    const o = getOrder(no);
    if (!o || o.user_id !== req.userId) throw new HttpError(404, 'order_not_found');
    if (o.status !== 'delivered') throw new HttpError(409, 'not_delivered');
    db.prepare('UPDATE orders SET acked_at = COALESCE(acked_at, ?) WHERE out_trade_no = ?').run(ctx.now(), no);
    return { json: { ok: true } };
  });

  router.get('/api/pay/entitlements', (req) => {
    const rows = db.prepare("SELECT product_id, COUNT(*) AS n FROM orders WHERE user_id = ? AND status = 'delivered' GROUP BY product_id").all(req.userId) as { product_id: string; n: number }[];
    const count = (id: string) => rows.find((r) => r.product_id === id)?.n ?? 0;
    return { json: { firstChargeBought: count(shop.firstCharge.id) > 0, monthlyCards: count(shop.monthlyCard.id) } };
  });

  // 微信消息推送：URL 校验（GET）与虚拟支付发货通知（POST，明文 JSON 模式）
  router.get(
    '/api/pay/wx-notify',
    (req) => {
      const q = req.query;
      if (!ctx.cfg.wx.msgToken || !checkPushSignature(ctx.cfg.wx.msgToken, q.get('timestamp') ?? '', q.get('nonce') ?? '', q.get('signature') ?? '')) {
        throw new HttpError(403, 'bad_signature');
      }
      return { text: q.get('echostr') ?? '' };
    },
    false,
  );

  router.post(
    '/api/pay/wx-notify',
    (req) => {
      const q = req.query;
      if (!ctx.cfg.wx.msgToken || !checkPushSignature(ctx.cfg.wx.msgToken, q.get('timestamp') ?? '', q.get('nonce') ?? '', q.get('signature') ?? '')) {
        throw new HttpError(403, 'bad_signature');
      }
      const msg = req.body ?? {};
      if (msg.Event !== 'xpay_goods_deliver_notify') return { json: { ErrCode: 0, ErrMsg: 'ignored' } };
      const o = getOrder(String(msg.OutTradeNo ?? ''));
      if (!o) return { json: { ErrCode: 1, ErrMsg: 'order not found' } };
      const user = getUser(ctx, o.user_id);
      if (user.openid && msg.OpenId && user.openid !== msg.OpenId) return { json: { ErrCode: 1, ErrMsg: 'openid mismatch' } };
      const expectedProduct = ctx.cfg.wx.productIds[o.product_id] ?? o.product_id;
      if (msg.GoodsInfo?.ProductId && msg.GoodsInfo.ProductId !== expectedProduct) return { json: { ErrCode: 1, ErrMsg: 'product mismatch' } };
      const d = deliver(o.out_trade_no, msg.WeChatPayInfo?.TransactionId ?? null);
      return { json: { ErrCode: d.status === 'delivered' || d.status === 'closed' ? 0 : 1, ErrMsg: 'success' } };
    },
    false,
  );
}
