export interface ProductInfo {
  id: string;
  name: string;
  price: number;
}

export interface PayResult {
  ok: boolean;
  orderId?: string;
  error?: string;
}

/** 支付通道接口。微信正式接入时实现 wx.requestMidasPayment + 服务端验单。 */
export interface PaymentProvider {
  pay(product: ProductInfo): Promise<PayResult>;
}

let orderSeq = 0;

/** 模拟支付：由界面弹确认框，确认即视为支付成功。 */
export class MockPaymentProvider implements PaymentProvider {
  constructor(private confirm: (p: ProductInfo) => Promise<boolean>) {}

  async pay(product: ProductInfo): Promise<PayResult> {
    const ok = await this.confirm(product);
    if (!ok) return { ok: false, error: 'cancelled' };
    orderSeq += 1;
    return { ok: true, orderId: `mock-${Date.now().toString(36)}-${orderSeq}` };
  }
}
