import type { PaymentProvider, PayResult, ProductInfo } from '../core/shop';
import { ApiError, type ApiClient } from './api';

export interface VirtualPaymentParams {
  mode: string;
  signData: string;
  paySig: string;
  signature: string;
}

/** 微信小游戏：wx.requestVirtualPayment；reject 的 errCode -2 表示用户取消 */
export type VirtualPaymentBridge = (p: VirtualPaymentParams) => Promise<void>;

export class PaymentCancelled extends Error {}

/**
 * 走服务端的支付：服务端下单签名 → 微信收银台 → 服务端查单 / 收到发货通知后到账 → 客户端发放。
 * 开发环境（服务端 DEV_PAY=1）用确认框代替微信收银台，到账流程完全一致。
 */
export class ServerPaymentProvider implements PaymentProvider {
  constructor(
    private api: ApiClient,
    private bridge: VirtualPaymentBridge | null,
    private confirmDev: (p: ProductInfo) => Promise<boolean>,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private pollTimes = 8,
    private pollMs = 1500,
  ) {}

  async pay(product: ProductInfo): Promise<PayResult> {
    let order;
    try {
      order = await this.api.payCreate(product.id);
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.code : 'network' };
    }
    try {
      if (order.mode === 'dev') {
        if (!(await this.confirmDev(product))) return { ok: false, error: 'cancelled' };
        await this.api.payDevComplete(order.outTradeNo);
      } else {
        if (!this.bridge) return { ok: false, error: 'pay_bridge_missing' };
        await this.bridge({ mode: order.mode, signData: order.signData!, paySig: order.paySig!, signature: order.signature! });
      }
    } catch (e) {
      return { ok: false, error: e instanceof PaymentCancelled ? 'cancelled' : 'pay_failed' };
    }
    for (let i = 0; i < this.pollTimes; i++) {
      try {
        const r = await this.api.payConfirm(order.outTradeNo);
        if (r.status === 'delivered') return { ok: true, orderId: order.outTradeNo };
        if (r.status === 'closed') return { ok: false, error: 'order_closed' };
      } catch {
        // 网络波动，继续轮询
      }
      await this.sleep(this.pollMs);
    }
    // 微信侧已扣款但还没通知到账：之后启动时通过待发放订单补发
    return { ok: false, error: 'pending' };
  }
}
