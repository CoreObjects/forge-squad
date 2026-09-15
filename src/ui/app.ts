import type { Game } from '../core/game';
import type { OnlineServices } from '../net/online';
import { TUTORIAL_TEXT } from '../core/tutorial';
import type { SfxName, SynthAudio } from '../platform/audio';
import type { Platform } from '../platform/platform';
import { C, H, W } from './theme';
import { Ui } from './ui';

export interface Scene {
  name: string;
  modal?: boolean;
  render(app: App, ui: Ui, dt: number): void;
}

interface Toast {
  text: string;
  color: string;
  t0: number;
}

const ALWAYS = ['confirm_*', 'battle_*', 'toast'];

const TUTORIAL_RULES: Record<string, { allow: string[]; highlight: string[] }> = {
  forge1: { allow: ['forge'], highlight: ['forge'] },
  place1: { allow: ['place_recommend'], highlight: ['place_recommend'] },
  battle1: { allow: ['challenge', 'result_*'], highlight: ['result_continue', 'challenge'] },
  forge2: { allow: ['forge', 'result_*'], highlight: ['result_continue', 'forge'] },
  place2: { allow: ['place_recommend'], highlight: ['place_recommend'] },
  battle2: { allow: ['challenge', 'result_*'], highlight: ['result_continue', 'challenge'] },
  forge3: { allow: ['forge', 'result_*'], highlight: ['result_continue', 'forge'] },
  place3: { allow: ['place_manual', 'manual_*'], highlight: ['manual_confirm', 'manual_node_*', 'place_manual'] },
  forgeMore: { allow: ['forge', 'place_*', 'manual_*', 'result_*'], highlight: ['result_continue', 'place_recommend', 'forge'] },
  boss: { allow: ['challenge', 'result_*'], highlight: ['challenge'] },
  swap: { allow: ['chain_open', 'chainpage_*', 'result_chain', 'challenge'], highlight: ['result_chain', 'chainpage_node_*', 'chain_open'] },
  bossRetry: { allow: ['challenge', 'chain_open', 'chainpage_*', 'result_*'], highlight: ['result_continue', 'chainpage_back', 'challenge'] },
};

function matches(id: string, pattern: string): boolean {
  return pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}

export class App {
  ui = new Ui();
  stack: Scene[] = [];
  private toasts: Toast[] = [];
  private lastT = 0;
  private downAt: { x: number; y: number } | null = null;
  private sizeKey = '';
  private audioUnlocked = false;
  sceneFactory: Record<string, (app: App) => Scene> = {};
  online: OnlineServices | null = null;

  constructor(
    public game: Game,
    public platform: Platform,
    public audio: SynthAudio,
  ) {
    this.ui.gate = (id) => this.tutorialAllows(id);
    this.ui.onDenied = () => this.toast('请先按引导操作', C.accent2);
    this.ui.onTap = () => this.sfx('click');
    audio.sfxOn = game.state.settings.sfx;
    audio.musicOn = game.state.settings.music;
  }

  sfx(name: SfxName): void {
    this.audio.play(name);
  }

  push(scene: Scene): void {
    this.stack.push(scene);
  }

  pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  popTo(name: string): void {
    while (this.stack.length > 1 && this.stack[this.stack.length - 1].name !== name) this.stack.pop();
  }

  top(): Scene {
    return this.stack[this.stack.length - 1];
  }

  open(name: string): void {
    const f = this.sceneFactory[name];
    if (f) this.push(f(this));
  }

  toast(text: string, color: string = C.text): void {
    this.toasts.push({ text, color, t0: this.ui.time });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  confirm(title: string, content: string, yes = '确定', no = '取消'): Promise<boolean> {
    return new Promise((resolve) => {
      const scene: Scene = {
        name: 'confirm',
        modal: true,
        render: (_app, ui) => {
          ui.mask(0.7);
          ui.blocker();
          const x = 85;
          const y = 470;
          const w = 580;
          const h = 390;
          ui.panel(x, y, w, h, C.panel2);
          ui.text(title, W / 2, y + 60, { size: 34, bold: true, align: 'center' });
          ui.wrap(content, x + 40, y + 110, w - 80, { size: 26, color: C.sub });
          const close = (v: boolean) => {
            const i = this.stack.indexOf(scene);
            if (i >= 0) this.stack.splice(i, 1);
            resolve(v);
          };
          ui.button('confirm_no', x + 40, y + h - 110, 230, 80, no, () => close(false), { fill: C.line, color: C.text });
          ui.button('confirm_yes', x + w - 270, y + h - 110, 230, 80, yes, () => close(true));
        },
      };
      this.push(scene);
    });
  }

  // ---------------------------------------------------------- 教程门禁

  tutorialAllows(id: string): boolean {
    const step = this.game.state.tutorial.step;
    if (step === 'done') return true;
    if (ALWAYS.some((p) => matches(id, p))) return true;
    const rule = TUTORIAL_RULES[step];
    if (!rule) return true;
    return rule.allow.some((p) => matches(id, p));
  }

  private drawTutorial(): void {
    const step = this.game.state.tutorial.step;
    if (step === 'done') return;
    const rule = TUTORIAL_RULES[step];
    const ui = this.ui;
    let target = null as { x: number; y: number; w: number; h: number } | null;
    for (const p of rule?.highlight ?? []) {
      target = ui.regionRect(p);
      if (target) break;
    }
    const text = TUTORIAL_TEXT[step];
    const topName = this.top().name;
    if (target) {
      const pad = 8 + ui.pulse(6) * 6;
      ui.rect(target.x - pad, target.y - pad, target.w + pad * 2, target.h + pad * 2, 'rgba(0,0,0,0)', 20, C.gold, 5);
      const ax = target.x + target.w / 2;
      const above = target.y > H / 2;
      const ay = above ? target.y - pad - 18 - ui.pulse(6) * 10 : target.y + target.h + pad + 18 + ui.pulse(6) * 10;
      ui.text(above ? '▼' : '▲', ax, ay, { size: 34, color: C.gold, align: 'center' });
    }
    if (!text || (topName === 'battle' && !target)) return;
    const safe = this.platform.safeTop;
    let by: number;
    if (topName === 'main') by = safe + 290;
    else if (topName === 'forgeResult') by = 130;
    else if (topName === 'chain') by = H - 150;
    else if (target) by = target.y > H / 2 ? Math.max(120, target.y - 190) : Math.min(H - 160, target.y + target.h + 60);
    else by = 120;
    this.bubble(text, by);
  }

  private bubble(text: string, y: number): void {
    const ui = this.ui;
    ui.rect(40, y, W - 80, 104, 'rgba(22,16,34,0.94)', 22, C.gold, 3);
    ui.wrap(text, 70, y + 18, W - 140, { size: 26, color: C.text, maxLines: 2, lineHeight: 36 });
  }

  // ---------------------------------------------------------- 主循环

  start(): void {
    const p = this.platform;
    p.onPointerDown((x, y) => {
      this.downAt = { x, y };
      if (!this.audioUnlocked) {
        this.audioUnlocked = true;
        this.audio.unlock();
      }
    });
    p.onPointerUp((x, y) => {
      const d = this.downAt;
      this.downAt = null;
      if (d && Math.hypot(d.x - x, d.y - y) < 30) this.ui.queueTap(x, y);
    });
    p.onHide(() => {
      this.game.endSession();
      this.online?.onHide();
      this.audio.suspend();
    });
    p.onShow(() => {
      this.game.startSession(false);
      this.online?.onShow();
      if (this.audioUnlocked) this.audio.unlock();
    });
    const loop = (t: number) => {
      this.frame(t);
      p.raf(loop);
    };
    p.raf(loop);
  }

  private frame(t: number): void {
    const p = this.platform;
    const { w, h, dpr } = p.size();
    const key = `${w}x${h}@${dpr}`;
    if (key !== this.sizeKey) {
      this.sizeKey = key;
      p.canvas.width = Math.round(w * dpr);
      p.canvas.height = Math.round(h * dpr);
    }
    const ctx = p.canvas.getContext('2d');
    if (!ctx) return;
    const dt = this.lastT ? Math.min(100, t - this.lastT) : 16;
    this.lastT = t;
    const ui = this.ui;
    ui.layout(w, h, dpr);
    ui.beginFrame(ctx, w, h, t);
    let base = this.stack.length - 1;
    while (base > 0 && this.stack[base].modal) base--;
    for (let i = base; i < this.stack.length; i++) this.stack[i].render(this, ui, dt);
    this.drawTutorial();
    this.drawToasts();
    ui.endFrame();
  }

  private drawToasts(): void {
    const ui = this.ui;
    const now = ui.time;
    this.toasts = this.toasts.filter((x) => now - x.t0 < 2200);
    this.toasts.forEach((x, i) => {
      const age = now - x.t0;
      const alpha = age < 1800 ? 1 : 1 - (age - 1800) / 400;
      ui.ctx.save();
      ui.ctx.globalAlpha = Math.max(0, alpha);
      const y = 560 + i * 80 - Math.min(20, age / 20);
      const tw = Math.min(W - 80, ui.measure(x.text, 28, true) + 60);
      ui.rect(W / 2 - tw / 2, y - 32, tw, 64, 'rgba(12,8,20,0.92)', 32, C.line);
      ui.text(x.text, W / 2, y, { size: 28, bold: true, color: x.color, align: 'center', maxWidth: W - 120 });
      ui.ctx.restore();
    });
  }
}
