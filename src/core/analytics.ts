export interface AnalyticsEvent {
  name: string;
  t: number;
  session: string;
  props: Record<string, unknown>;
}

export type AnalyticsSink = (e: AnalyticsEvent) => void;

/** 埋点：内存缓冲 + 可替换上报通道。正式环境把 sink 换成服务端上报即可。 */
export class Analytics {
  buffer: AnalyticsEvent[] = [];
  counts: Record<string, number> = {};
  session: string;
  private sinks: AnalyticsSink[] = [];

  constructor(
    private now: () => number,
    private maxBuffer = 2000,
  ) {
    this.session = `s${now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  addSink(sink: AnalyticsSink): void {
    this.sinks.push(sink);
  }

  newSession(): void {
    this.session = `s${this.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  track(name: string, props: Record<string, unknown> = {}): void {
    const e: AnalyticsEvent = { name, t: this.now(), session: this.session, props };
    this.buffer.push(e);
    if (this.buffer.length > this.maxBuffer) this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    this.counts[name] = (this.counts[name] ?? 0) + 1;
    for (const s of this.sinks) {
      try {
        s(e);
      } catch {
        // 上报失败不影响游戏
      }
    }
  }
}
