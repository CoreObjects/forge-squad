import { C, font, H, W } from './theme';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Region extends Rect {
  id: string;
  cb: () => void;
  blocker: boolean;
}

export interface TextOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  maxWidth?: number;
}

export interface ButtonOpts {
  fill?: string;
  color?: string;
  size?: number;
  disabled?: boolean;
  badge?: boolean;
  radius?: number;
  stroke?: string;
  sub?: string;
}

/** 立即模式 UI：每帧绘制时登记可点区域，帧末按“后登记者在上”分发点击。 */
export class Ui {
  ctx!: CanvasRenderingContext2D;
  time = 0;
  private regions: Region[] = [];
  private lastRegions: Region[] = [];
  private taps: { x: number; y: number }[] = [];
  private scale = 1;
  private offX = 0;
  private offY = 0;
  private dpr = 1;
  /** 返回 false 时拒绝点击（教程限制） */
  gate: (id: string) => boolean = () => true;
  onDenied: (id: string) => void = () => {};
  onTap: (id: string) => void = () => {};

  layout(pxW: number, pxH: number, dpr: number): void {
    this.dpr = dpr;
    this.scale = Math.min(pxW / W, pxH / H);
    this.offX = (pxW - W * this.scale) / 2;
    this.offY = (pxH - H * this.scale) / 2;
  }

  /** 屏幕逻辑坐标 → 设计坐标 */
  toDesign(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.offX) / this.scale, y: (y - this.offY) / this.scale };
  }

  queueTap(screenX: number, screenY: number): void {
    this.taps.push(this.toDesign(screenX, screenY));
  }

  beginFrame(ctx: CanvasRenderingContext2D, pxW: number, pxH: number, time: number): void {
    this.ctx = ctx;
    this.time = time;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07050b';
    ctx.fillRect(0, 0, pxW, pxH);
    ctx.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.offX, this.dpr * this.offY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    this.regions = [];
  }

  endFrame(): void {
    this.ctx.restore();
    this.lastRegions = this.regions;
    const taps = this.taps;
    this.taps = [];
    for (const t of taps) {
      for (let i = this.lastRegions.length - 1; i >= 0; i--) {
        const r = this.lastRegions[i];
        if (t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h) {
          if (r.blocker) break;
          if (!this.gate(r.id)) {
            this.onDenied(r.id);
            break;
          }
          this.onTap(r.id);
          r.cb();
          break;
        }
      }
    }
  }

  regionRect(idPrefix: string): Rect | null {
    const match = (id: string) => (idPrefix.endsWith('*') ? id.startsWith(idPrefix.slice(0, -1)) : id === idPrefix);
    const r = this.lastRegions.find((x) => !x.blocker && match(x.id));
    return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null;
  }

  hit(id: string, x: number, y: number, w: number, h: number, cb: () => void): void {
    this.regions.push({ id, x, y, w, h, cb, blocker: false });
  }

  /** 模态层：吞掉下层点击 */
  blocker(): void {
    this.regions.push({ id: '__blocker', x: 0, y: 0, w: W, h: H, cb: () => {}, blocker: true });
  }

  rect(x: number, y: number, w: number, h: number, fill: string | CanvasGradient, radius = 0, stroke?: string, lineWidth = 2): void {
    const ctx = this.ctx;
    ctx.beginPath();
    if (radius > 0) roundRectPath(ctx, x, y, w, h, radius);
    else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  circle(x: number, y: number, r: number, fill: string, stroke?: string, lineWidth = 2): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 2): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  text(str: string, x: number, y: number, o: TextOpts = {}): number {
    const ctx = this.ctx;
    ctx.font = font(o.size ?? 26, o.bold);
    ctx.fillStyle = o.color ?? C.text;
    ctx.textAlign = o.align ?? 'left';
    ctx.textBaseline = o.baseline ?? 'middle';
    if (o.maxWidth) ctx.fillText(str, x, y, o.maxWidth);
    else ctx.fillText(str, x, y);
    return ctx.measureText(str).width;
  }

  measure(str: string, size: number, bold = false): number {
    this.ctx.font = font(size, bold);
    return this.ctx.measureText(str).width;
  }

  /** 中文按字符换行，返回占用高度 */
  wrap(str: string, x: number, y: number, maxWidth: number, o: TextOpts & { lineHeight?: number; maxLines?: number } = {}): number {
    const size = o.size ?? 24;
    const lh = o.lineHeight ?? size * 1.45;
    this.ctx.font = font(size, o.bold);
    const lines: string[] = [];
    let cur = '';
    for (const ch of str) {
      if (ch === '\n') {
        lines.push(cur);
        cur = '';
        continue;
      }
      if (this.ctx.measureText(cur + ch).width > maxWidth && cur) {
        lines.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    const shown = o.maxLines ? lines.slice(0, o.maxLines) : lines;
    shown.forEach((l, i) => this.text(l, x, y + i * lh, { ...o, baseline: 'top' }));
    return shown.length * lh;
  }

  button(id: string, x: number, y: number, w: number, h: number, label: string, cb: () => void, o: ButtonOpts = {}): void {
    const disabled = !!o.disabled;
    const fill = disabled ? '#3a3248' : (o.fill ?? C.accent);
    const radius = o.radius ?? Math.min(22, h / 2);
    this.ctx.save();
    if (!disabled) {
      this.ctx.shadowColor = 'rgba(0,0,0,0.35)';
      this.ctx.shadowBlur = 10;
      this.ctx.shadowOffsetY = 4;
    }
    this.rect(x, y, w, h, fill, radius, o.stroke);
    this.ctx.restore();
    const color = disabled ? C.dim : (o.color ?? '#1b1026');
    if (o.sub) {
      this.text(label, x + w / 2, y + h / 2 - (o.size ?? 30) * 0.42, { size: o.size ?? 30, bold: true, color, align: 'center' });
      this.text(o.sub, x + w / 2, y + h / 2 + (o.size ?? 30) * 0.55, { size: Math.round((o.size ?? 30) * 0.62), color, align: 'center' });
    } else {
      this.text(label, x + w / 2, y + h / 2 + 1, { size: o.size ?? 30, bold: true, color, align: 'center' });
    }
    if (o.badge) this.circle(x + w - 6, y + 6, 10, C.bad, '#fff', 2);
    if (!disabled) this.hit(id, x, y, w, h, cb);
  }

  bar(x: number, y: number, w: number, h: number, ratio: number, fill: string, bg = '#1a1424'): void {
    this.rect(x, y, w, h, bg, h / 2);
    const r = Math.max(0, Math.min(1, ratio));
    if (r > 0) this.rect(x, y, Math.max(h, w * r), h, fill, h / 2);
  }

  panel(x: number, y: number, w: number, h: number, fill = C.panel, stroke = C.line): void {
    this.rect(x, y, w, h, fill, 24, stroke, 2);
  }

  mask(alpha = 0.72): void {
    this.rect(0, 0, W, H, `rgba(8,6,14,${alpha})`);
  }

  pulse(speed = 3): number {
    return 0.5 + 0.5 * Math.sin(this.time * 0.001 * speed);
  }
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}
