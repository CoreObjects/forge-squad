import type { DefenseSnapshot } from '../core/arena';
import type { AnalyticsEvent } from '../core/analytics';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  body?: unknown;
  headers: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  data: any;
}

export type Transport = (req: HttpRequest) => Promise<HttpResponse>;

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public data: any,
  ) {
    super(`${status} ${code}`);
  }
}

const TOKEN_KEY = 'forge_api_token';

export interface ArenaOpponentDto {
  opponentId: number;
  tier: 'weak' | 'close' | 'strong';
  name: string;
  score: number;
  isTestData: boolean;
  power: number;
  chain: ({ type: string; quality: number } | null)[];
}

export interface ArenaChallengeDto {
  seed: number;
  win: boolean;
  tier: 'weak' | 'close' | 'strong';
  scoreDelta: number;
  score: number;
  rank: number;
  attemptsLeft: number;
  attacker: DefenseSnapshot;
  defender: DefenseSnapshot;
  opponent: { id: number; name: string; power: number; isTestData: boolean };
}

export interface LeaderboardRowDto {
  rank: number;
  userId: number;
  name: string;
  score: number;
  power: number;
  isTestData: boolean;
  isSelf: boolean;
}

export interface PayOrderDto {
  outTradeNo: string;
  mode: 'dev' | 'short_series_goods';
  signData?: string;
  paySig?: string;
  signature?: string;
  priceFen: number;
}

export interface OrderViewDto {
  outTradeNo: string;
  productId: string;
  status: 'created' | 'delivered' | 'closed';
  acked: boolean;
}

/** 游戏服务端 API 客户端（网页 fetch / 微信 wx.request 通过 Transport 注入）。 */
export class ApiClient {
  token: string | null;
  userId = 0;
  userName = '';

  constructor(
    private base: string,
    private transport: Transport,
    private store: KeyValueStore,
  ) {
    this.token = store.get(TOKEN_KEY);
  }

  get loggedIn(): boolean {
    return !!this.token;
  }

  private async req<T = any>(method: HttpRequest['method'], path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await this.transport({ method, url: this.base + path, body, headers });
    if (res.status >= 200 && res.status < 300) return res.data as T;
    if (res.status === 401 && auth) this.setToken(null);
    throw new ApiError(res.status, res.data?.error ?? 'http_error', res.data);
  }

  private setToken(token: string | null): void {
    this.token = token;
    this.store.set(TOKEN_KEY, token ?? '');
  }

  private applyLogin(r: { token: string; userId: number; name: string }): void {
    this.setToken(r.token);
    this.userId = r.userId;
    this.userName = r.name;
  }

  async me(): Promise<{ userId: number; name: string }> {
    const r = await this.req('GET', '/api/me');
    this.userId = r.userId;
    this.userName = r.name;
    return r;
  }

  async loginWx(code: string): Promise<void> {
    this.applyLogin(await this.req('POST', '/api/auth/wx-login', { code }, false));
  }

  async loginDev(deviceId: string): Promise<void> {
    this.applyLogin(await this.req('POST', '/api/auth/dev-login', { deviceId }, false));
  }

  getSave(): Promise<{ version: number; data: string | null; updatedAt: number }> {
    return this.req('GET', '/api/save');
  }

  putSave(data: string, baseVersion: number): Promise<{ version: number; updatedAt: number }> {
    return this.req('PUT', '/api/save', { data, baseVersion });
  }

  uploadSnapshot(snapshot: DefenseSnapshot): Promise<{ power: number }> {
    return this.req('PUT', '/api/arena/snapshot', { snapshot });
  }

  arenaState(): Promise<{ registered: boolean; score?: number; rank?: number; wins?: number; losses?: number; attemptsLeft: number }> {
    return this.req('GET', '/api/arena/state');
  }

  arenaOpponents(): Promise<{ opponents: ArenaOpponentDto[]; attemptsLeft: number }> {
    return this.req('POST', '/api/arena/opponents', {});
  }

  arenaChallenge(opponentId: number): Promise<ArenaChallengeDto> {
    return this.req('POST', '/api/arena/challenge', { opponentId });
  }

  leaderboard(): Promise<{ top: LeaderboardRowDto[]; around: LeaderboardRowDto[]; me: { rank: number; score: number } | null }> {
    return this.req('GET', '/api/arena/leaderboard');
  }

  payCreate(productId: string): Promise<PayOrderDto> {
    return this.req('POST', '/api/pay/create', { productId });
  }

  payConfirm(outTradeNo: string): Promise<OrderViewDto> {
    return this.req('POST', '/api/pay/confirm', { outTradeNo });
  }

  payDevComplete(outTradeNo: string): Promise<OrderViewDto> {
    return this.req('POST', '/api/pay/dev-complete', { outTradeNo });
  }

  payPending(): Promise<{ orders: OrderViewDto[] }> {
    return this.req('GET', '/api/pay/pending');
  }

  payAck(outTradeNo: string): Promise<{ ok: boolean }> {
    return this.req('POST', '/api/pay/ack', { outTradeNo });
  }

  track(events: AnalyticsEvent[]): Promise<{ accepted: number }> {
    return this.req('POST', '/api/track', { events });
  }
}

/** 浏览器 / Node 的 fetch 传输层 */
export const fetchTransport: Transport = async (req) => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
};
