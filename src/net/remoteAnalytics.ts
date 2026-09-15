import type { AnalyticsEvent } from '../core/analytics';
import type { ApiClient, KeyValueStore } from './api';

const QUEUE_KEY = 'forge_track_queue';
const MAX_QUEUE = 2000;

/** 埋点上报：批量发送，失败保留在本地队列下次重试。 */
export class RemoteAnalytics {
  private queue: AnalyticsEvent[] = [];
  private sending = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private api: ApiClient,
    private store: KeyValueStore,
    private batchSize = 50,
    private intervalMs = 10_000,
  ) {
    try {
      const raw = store.get(QUEUE_KEY);
      if (raw) this.queue = JSON.parse(raw);
    } catch {
      this.queue = [];
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  sink = (e: AnalyticsEvent): void => {
    this.queue.push(e);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.persist();
    if (this.queue.length >= this.batchSize) void this.flush();
  };

  start(): void {
    if (!this.timer) this.timer = setInterval(() => void this.flush(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private persist(): void {
    try {
      this.store.set(QUEUE_KEY, JSON.stringify(this.queue));
    } catch {
      // 存储满时丢弃持久化，内存队列仍会发送
    }
  }

  async flush(): Promise<void> {
    if (this.sending || this.queue.length === 0 || !this.api.loggedIn) return;
    this.sending = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, 200);
        await this.api.track(batch);
        this.queue.splice(0, batch.length);
        this.persist();
      }
    } catch {
      // 网络失败：留在队列里
    } finally {
      this.sending = false;
    }
  }
}
