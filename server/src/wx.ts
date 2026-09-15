import { createHash, createHmac } from 'node:crypto';
import type { ServerConfig } from './config';
import { HttpError } from './http';

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ json(): Promise<any> }>;

export function hmacSha256(key: string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

/** 服务端 API 的 pay_sig：HMAC-SHA256(AppKey, uri + '&' + body) */
export function apiPaySig(appKey: string, uri: string, body: string): string {
  return hmacSha256(appKey, `${uri}&${body}`);
}

/** wx.requestVirtualPayment 的 paySig：HMAC-SHA256(AppKey, 'requestVirtualPayment&' + signData) */
export function requestPaySig(appKey: string, signData: string): string {
  return hmacSha256(appKey, `requestVirtualPayment&${signData}`);
}

/** 用户态签名：HMAC-SHA256(session_key, signData) */
export function userSignature(sessionKey: string, signData: string): string {
  return hmacSha256(sessionKey, signData);
}

/** 消息推送 URL 校验：sha1(排序后拼接 token / timestamp / nonce) */
export function checkPushSignature(token: string, timestamp: string, nonce: string, signature: string): boolean {
  const s = [token, timestamp, nonce].sort().join('');
  return createHash('sha1').update(s).digest('hex') === signature;
}

/** 虚拟支付订单状态：2 已支付待发货，3 发货中，4 已发货 */
export const WX_ORDER_PAID_STATUSES = new Set([2, 3, 4]);

export class WxApi {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private cfg: ServerConfig,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private now: () => number = Date.now,
  ) {}

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const q = new URLSearchParams(params).toString();
    const res = await this.fetchImpl(`${this.cfg.wx.apiBase}${path}?${q}`);
    return res.json();
  }

  async code2Session(code: string): Promise<{ openid: string; session_key: string; unionid?: string }> {
    const r = await this.get('/sns/jscode2session', {
      appid: this.cfg.wx.appId,
      secret: this.cfg.wx.appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    });
    if (!r || r.errcode || !r.openid) throw new HttpError(401, 'wx_login_failed', `errcode ${r?.errcode ?? 'unknown'}`);
    return r;
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    const r = await this.get('/cgi-bin/token', { grant_type: 'client_credential', appid: this.cfg.wx.appId, secret: this.cfg.wx.appSecret });
    if (!r || !r.access_token) throw new HttpError(502, 'wx_token_failed', `errcode ${r?.errcode ?? 'unknown'}`);
    this.token = { value: r.access_token, expiresAt: this.now() + (Number(r.expires_in ?? 7200) - 300) * 1000 };
    return this.token.value;
  }

  private async xpay(uri: string, payload: Record<string, unknown>): Promise<any> {
    const body = JSON.stringify(payload);
    const at = await this.accessToken();
    const sig = apiPaySig(this.cfg.wx.appKey, uri, body);
    const res = await this.fetchImpl(`${this.cfg.wx.apiBase}${uri}?access_token=${encodeURIComponent(at)}&pay_sig=${sig}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.json();
  }

  async queryOrder(openid: string, outTradeNo: string): Promise<{ status: number; transactionId?: string } | null> {
    const r = await this.xpay('/xpay/query_order', { openid, env: this.cfg.wx.payEnv, order_id: outTradeNo });
    if (!r || r.errcode) return null;
    return { status: Number(r.order?.status ?? 0), transactionId: r.order?.wxpay_order_id };
  }

  /** 发货完成回告（推送失败时补发货后调用） */
  async notifyProvideGoods(outTradeNo: string): Promise<boolean> {
    const r = await this.xpay('/xpay/notify_provide_goods', { order_id: outTradeNo, env: this.cfg.wx.payEnv });
    return !!r && !r.errcode;
  }
}
