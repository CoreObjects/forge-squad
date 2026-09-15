import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app';
import { loadConfig, type ServerConfig } from '../src/config';
import { openDb } from '../src/db';
import { apiPaySig, type FetchLike } from '../src/wx';

export const TEST_APP_KEY = 'test-app-key';

/** 假的微信服务端：code2Session / access_token / 虚拟支付查单，按官方签名规则校验 */
export class FakeWx {
  orders = new Map<string, number>();
  provided: string[] = [];
  calls: string[] = [];

  fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    this.calls.push(u.pathname);
    const ok = (data: unknown) => ({ json: async () => data });
    if (u.pathname === '/sns/jscode2session') {
      const code = u.searchParams.get('js_code') ?? '';
      if (!code.startsWith('code-')) return ok({ errcode: 40029, errmsg: 'invalid code' });
      return ok({ openid: `openid-${code.slice(5)}`, session_key: `sk-${code.slice(5)}` });
    }
    if (u.pathname === '/cgi-bin/token') return ok({ access_token: 'AT', expires_in: 7200 });
    if (u.pathname.startsWith('/xpay/')) {
      const body = init?.body ?? '';
      if (u.searchParams.get('pay_sig') !== apiPaySig(TEST_APP_KEY, u.pathname, body)) return ok({ errcode: 268490004, errmsg: 'bad pay_sig' });
      const payload = JSON.parse(body);
      if (u.pathname === '/xpay/query_order') {
        const status = this.orders.get(payload.order_id);
        return status === undefined ? ok({ errcode: 268490007, errmsg: 'order not exist' }) : ok({ errcode: 0, order: { status, wxpay_order_id: `wx-${payload.order_id}` } });
      }
      if (u.pathname === '/xpay/notify_provide_goods') {
        this.provided.push(payload.order_id);
        return ok({ errcode: 0 });
      }
    }
    return ok({ errcode: -1 });
  };
}

export async function startServer(overrides: Partial<ServerConfig> & { wxOverrides?: Partial<ServerConfig['wx']> } = {}) {
  const base = loadConfig({});
  const cfg: ServerConfig = {
    ...base,
    dbPath: ':memory:',
    adminKey: 'admin',
    ...overrides,
    wx: {
      ...base.wx,
      appId: 'wx-test',
      appSecret: 'secret',
      offerId: 'offer-1',
      appKey: TEST_APP_KEY,
      msgToken: 'push-token',
      ...(overrides.wxOverrides ?? {}),
    },
  };
  const fake = new FakeWx();
  const clock = { t: new Date('2026-09-16T10:00:00+08:00').getTime() };
  const { server, ctx } = createApp(cfg, { db: openDb(':memory:'), fetch: fake.fetch, now: () => clock.t });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const base_url = `http://127.0.0.1:${port}`;

  async function call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
    const res = await fetch(base_url + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {
      // 纯文本响应
    }
    return { status: res.status, data };
  }

  async function wxUser(name: string) {
    const r = await call('POST', '/api/auth/wx-login', { code: `code-${name}` });
    return r.data.token as string;
  }

  return { cfg, ctx, fake, clock, url: base_url, call, wxUser, close: () => new Promise<void>((r) => server.close(() => r())) };
}
