export interface ServerConfig {
  port: number;
  host: string;
  dbPath: string;
  /** 允许的跨域来源（网页调试版用）；'*' 表示全部 */
  corsOrigins: string[];
  sessionTtlDays: number;
  /** 允许设备号登录（网页调试 / 内部测试），正式环境关闭 */
  devLogin: boolean;
  /** 允许开发支付（不走微信，直接到账），正式环境关闭 */
  devPay: boolean;
  adminKey: string;
  wx: {
    appId: string;
    appSecret: string;
    apiBase: string;
    /** 虚拟支付 OfferID */
    offerId: string;
    /** 虚拟支付 AppKey（正式 / 沙箱对应不同 key） */
    appKey: string;
    /** 0 正式环境，1 沙箱环境 */
    payEnv: 0 | 1;
    /** 消息推送 Token（接收发货通知） */
    msgToken: string;
    /** 首充 / 月卡在微信虚拟支付后台配置的道具 ID */
    productIds: Record<string, string>;
  };
  /** 竞技场每日次数按哪个时区的自然日重置（分钟偏移，北京时间 480） */
  tzOffsetMinutes: number;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): ServerConfig {
  const bool = (v: string | undefined, def: boolean) => (v === undefined ? def : v === '1' || v === 'true');
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DB_PATH ?? 'server/data/forge.db',
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
    sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
    devLogin: bool(env.DEV_LOGIN, false),
    devPay: bool(env.DEV_PAY, false),
    adminKey: env.ADMIN_KEY ?? '',
    wx: {
      appId: env.WX_APPID ?? '',
      appSecret: env.WX_APPSECRET ?? '',
      apiBase: env.WX_API_BASE ?? 'https://api.weixin.qq.com',
      offerId: env.WX_PAY_OFFER_ID ?? '',
      appKey: env.WX_PAY_APP_KEY ?? '',
      payEnv: env.WX_PAY_ENV === '1' ? 1 : 0,
      msgToken: env.WX_MSG_TOKEN ?? '',
      productIds: {
        first_charge: env.WX_PRODUCT_FIRST_CHARGE ?? 'first_charge',
        monthly_card: env.WX_PRODUCT_MONTHLY_CARD ?? 'monthly_card',
      },
    },
    tzOffsetMinutes: Number(env.TZ_OFFSET_MINUTES ?? 480),
  };
}

export function wxLoginConfigured(cfg: ServerConfig): boolean {
  return !!(cfg.wx.appId && cfg.wx.appSecret);
}

export function wxPayConfigured(cfg: ServerConfig): boolean {
  return wxLoginConfigured(cfg) && !!(cfg.wx.offerId && cfg.wx.appKey);
}
