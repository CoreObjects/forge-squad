import { Game, type GameState } from '../core/game';
import { ApiError, type ApiClient, type KeyValueStore } from './api';

const META_KEY = 'forge_cloud_meta';

export interface SaveMeta {
  /** 本地存档基于的服务端版本 */
  serverVersion: number;
  /** 本地有未上传的改动 */
  dirty: boolean;
  userId: number;
}

export type SyncDecision = 'useServer' | 'upload' | 'noop';

/** 进度比较：主线进度优先，其次累计锻造次数 */
export function progressScore(s: Pick<GameState, 'stage' | 'counters'>): number {
  return s.stage.next * 1_000_000 + s.counters.forges;
}

/**
 * 云存档合并规则：
 * - 服务端没有存档：上传本地
 * - 本地就是基于服务端最新版本：有改动就上传，否则不动
 * - 服务端被其他设备更新过：本地没改动 → 用服务端；本地也有改动 → 进度高的一方胜出
 */
export function decideSync(local: GameState | null, meta: SaveMeta, server: { version: number; data: string | null }): SyncDecision {
  if (!server.data || server.version === 0) return local ? 'upload' : 'noop';
  if (!local) return 'useServer';
  if (server.version === meta.serverVersion) return meta.dirty ? 'upload' : 'noop';
  if (server.version < meta.serverVersion) return 'upload';
  if (!meta.dirty) return 'useServer';
  try {
    const remote = JSON.parse(server.data) as GameState;
    return progressScore(local) > progressScore(remote) ? 'upload' : 'useServer';
  } catch {
    return 'upload';
  }
}

export class CloudSave {
  meta: SaveMeta;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private uploading: Promise<void> | null = null;
  private applying = false;
  onReplaced: () => void = () => {};
  onError: (e: unknown) => void = () => {};

  constructor(
    private api: ApiClient,
    private game: Game,
    private store: KeyValueStore,
    private debounceMs = 3000,
  ) {
    this.meta = { serverVersion: 0, dirty: true, userId: 0 };
    try {
      const raw = store.get(META_KEY);
      if (raw) this.meta = { ...this.meta, ...JSON.parse(raw) };
    } catch {
      // 忽略损坏的元数据
    }
  }

  private persistMeta(): void {
    this.store.set(META_KEY, JSON.stringify(this.meta));
  }

  /** 登录后调用：拉取服务端存档并按规则合并。 */
  async bootstrap(): Promise<SyncDecision> {
    if (this.meta.userId && this.meta.userId !== this.api.userId) {
      // 换了账号：本地存档不属于这个账号，以服务端为准
      this.meta = { serverVersion: 0, dirty: false, userId: this.api.userId };
      const server = await this.api.getSave();
      if (server.data) this.applyServer(server.version, server.data);
      else this.meta.dirty = true;
      this.persistMeta();
      if (!server.data) await this.flush();
      return server.data ? 'useServer' : 'upload';
    }
    this.meta.userId = this.api.userId;
    const server = await this.api.getSave();
    const decision = decideSync(this.game.state, this.meta, server);
    if (decision === 'useServer' && server.data) this.applyServer(server.version, server.data);
    else if (decision === 'upload') {
      this.meta.dirty = true;
      if (server.version > this.meta.serverVersion) this.meta.serverVersion = server.version;
      await this.flush();
    }
    this.persistMeta();
    return decision;
  }

  private applyServer(version: number, data: string): void {
    const state = Game.loadState(this.game.cfg, data, this.game.now());
    if (!state) return;
    this.applying = true;
    try {
      this.game.replaceState(state);
    } finally {
      this.applying = false;
    }
    this.meta.serverVersion = version;
    this.meta.dirty = false;
    this.persistMeta();
    this.onReplaced();
  }

  /** 每次本地保存时调用 */
  markDirty(): void {
    if (this.applying) return;
    if (!this.meta.dirty) {
      this.meta.dirty = true;
      this.persistMeta();
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.uploading) return this.uploading;
    if (!this.meta.dirty || !this.api.loggedIn) return;
    this.uploading = this.doUpload().finally(() => {
      this.uploading = null;
    });
    return this.uploading;
  }

  private async doUpload(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const json = JSON.stringify(this.game.state);
      try {
        const r = await this.api.putSave(json, this.meta.serverVersion);
        this.meta.serverVersion = r.version;
        // 上传期间又有改动则保持 dirty
        this.meta.dirty = JSON.stringify(this.game.state) !== json;
        this.persistMeta();
        return;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const server = { version: Number(e.data?.version ?? 0), data: (e.data?.data as string) ?? null };
          const d = decideSync(this.game.state, this.meta, server);
          if (d === 'useServer' && server.data) {
            this.applyServer(server.version, server.data);
            return;
          }
          this.meta.serverVersion = server.version;
          continue;
        }
        this.onError(e);
        return;
      }
    }
  }
}
