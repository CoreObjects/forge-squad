import type { ArenaBattle, Game } from '../core/game';
import type { ProductInfo } from '../core/shop';
import { ApiClient, ApiError, type ArenaOpponentDto, type KeyValueStore, type LeaderboardRowDto, type Transport } from './api';
import { CloudSave, type SyncDecision } from './cloudSave';
import { ServerPaymentProvider, type VirtualPaymentBridge } from './payment';
import { RemoteAnalytics } from './remoteAnalytics';

export interface OnlineEnv {
  apiBase: string;
  transport: Transport;
  store: KeyValueStore;
  /** 微信：wx.login 拿 code；网页调试版不提供，走设备号登录 */
  wxLogin?: () => Promise<string>;
  deviceId: () => string;
  virtualPayment?: VirtualPaymentBridge;
  confirmDevPay: (p: ProductInfo) => Promise<boolean>;
}

export type OnlineStatus = 'connecting' | 'online' | 'offline';

export interface RemoteArenaView {
  score: number;
  rank: number;
  wins: number;
  losses: number;
  attemptsLeft: number;
  opponents: ArenaOpponentDto[];
  top: LeaderboardRowDto[];
  around: LeaderboardRowDto[];
}

/** 联网服务总入口：账号、云存档、支付到账、埋点上报、异步竞技场。 */
export class OnlineServices {
  api: ApiClient;
  cloud: CloudSave;
  analytics: RemoteAnalytics;
  status: OnlineStatus = 'connecting';
  lastError = '';
  syncDecision: SyncDecision | null = null;
  private uploadedSnapshotAt = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners: ((s: OnlineStatus) => void)[] = [];

  constructor(
    private game: Game,
    private env: OnlineEnv,
  ) {
    this.api = new ApiClient(env.apiBase, env.transport, env.store);
    this.cloud = new CloudSave(this.api, game, env.store);
    this.analytics = new RemoteAnalytics(this.api, env.store);
    game.analytics.addSink(this.analytics.sink);
    // 云存档被其他设备的版本替换后，立即按服务端订单重新校准付费权益
    this.cloud.addReplacedListener(() => {
      if (this.api.loggedIn) void this.reconcileEntitlements().catch(() => undefined);
    });
  }

  onStatus(cb: (s: OnlineStatus) => void): void {
    this.statusListeners.push(cb);
  }

  private setStatus(s: OnlineStatus): void {
    this.status = s;
    for (const cb of this.statusListeners) cb(s);
  }

  get online(): boolean {
    return this.status === 'online';
  }

  async start(): Promise<boolean> {
    this.setStatus('connecting');
    try {
      await this.login();
      this.game.setPayment(new ServerPaymentProvider(this.api, this.env.virtualPayment ?? null, this.env.confirmDevPay));
      this.analytics.start();
      this.syncDecision = await this.cloud.bootstrap();
      await this.reconcileEntitlements();
      await this.uploadSnapshotIfNeeded();
      this.game.onChange(() => this.scheduleSnapshot());
      void this.analytics.flush();
      this.setStatus('online');
      return true;
    } catch (e) {
      this.lastError = e instanceof ApiError ? e.code : String((e as Error)?.message ?? e);
      this.setStatus('offline');
      return false;
    }
  }

  private async login(): Promise<void> {
    if (this.api.loggedIn) {
      try {
        await this.api.me();
        return;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
    }
    if (this.env.wxLogin) await this.api.loginWx(await this.env.wxLogin());
    else await this.api.loginDev(this.env.deviceId());
  }

  private reconciling: Promise<{ restored: string[]; changed: boolean }> | null = null;

  /**
   * 付费权益校准：以服务端已到账订单为准，补发存档里缺失的订单、覆盖首充 / 月卡状态，
   * 再把校准后的存档上传。登录、云存档被替换（多设备冲突）、回到前台时都会调用。
   */
  reconcileEntitlements(): Promise<{ restored: string[]; changed: boolean }> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      const e = await this.api.payEntitlements();
      const r = this.game.applyEntitlements(e);
      if (r.changed) await this.cloud.flush();
      for (const o of e.orders) {
        if (!o.acked && this.game.state.shop.grantedOrders.includes(o.outTradeNo)) await this.api.payAck(o.outTradeNo).catch(() => undefined);
      }
      return r;
    })().finally(() => {
      this.reconciling = null;
    });
    return this.reconciling;
  }

  onShow(): void {
    if (this.online) void this.reconcileEntitlements().catch(() => undefined);
  }

  onOrderGranted(orderId: string): void {
    if (!this.api.loggedIn) return;
    // 先把含该订单的存档传上去，再告诉服务端已发放
    void this.cloud
      .flush()
      .then(() => this.api.payAck(orderId))
      .catch(() => undefined);
  }

  private scheduleSnapshot(): void {
    const snap = this.game.state.arena.snapshot;
    if (!this.game.state.arena.unlocked || !snap || snap.savedAt === this.uploadedSnapshotAt) return;
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      void this.uploadSnapshotIfNeeded().catch(() => undefined);
    }, 2000);
  }

  async uploadSnapshotIfNeeded(): Promise<void> {
    const snap = this.game.state.arena.snapshot;
    if (!this.game.state.arena.unlocked || !snap || snap.savedAt === this.uploadedSnapshotAt) return;
    await this.api.uploadSnapshot(snap);
    this.uploadedSnapshotAt = snap.savedAt;
  }

  async loadArena(): Promise<RemoteArenaView> {
    await this.uploadSnapshotIfNeeded();
    const [state, offers, board] = await Promise.all([this.api.arenaState(), this.api.arenaOpponents(), this.api.leaderboard()]);
    return {
      score: state.score ?? 0,
      rank: state.rank ?? 0,
      wins: state.wins ?? 0,
      losses: state.losses ?? 0,
      attemptsLeft: offers.attemptsLeft,
      opponents: offers.opponents,
      top: board.top,
      around: board.around,
    };
  }

  async challengeArena(opponentId: number): Promise<ArenaBattle> {
    await this.uploadSnapshotIfNeeded();
    const dto = await this.api.arenaChallenge(opponentId);
    return this.game.applyRemoteArena(dto);
  }

  onHide(): void {
    void this.cloud.flush();
    void this.analytics.flush();
  }
}
