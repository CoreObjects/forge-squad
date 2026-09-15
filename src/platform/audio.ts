export type SfxName =
  | 'click'
  | 'forge'
  | 'quality'
  | 'place'
  | 'melt'
  | 'combo'
  | 'break'
  | 'hit'
  | 'stun'
  | 'shield'
  | 'win'
  | 'lose'
  | 'coin';

interface Note {
  f: number;
  d: number;
  type?: OscillatorType;
  v?: number;
  slide?: number;
  delay?: number;
}

const SFX: Record<SfxName, Note[]> = {
  click: [{ f: 880, d: 0.05, type: 'square', v: 0.05 }],
  forge: [
    { f: 180, d: 0.08, type: 'square', v: 0.12, slide: 90 },
    { f: 1400, d: 0.12, type: 'triangle', v: 0.08, delay: 0.05 },
  ],
  quality: [
    { f: 660, d: 0.1, type: 'triangle', v: 0.1 },
    { f: 880, d: 0.1, type: 'triangle', v: 0.1, delay: 0.09 },
    { f: 1320, d: 0.22, type: 'triangle', v: 0.1, delay: 0.18 },
  ],
  place: [{ f: 520, d: 0.08, type: 'sine', v: 0.12, slide: 780 }],
  melt: [{ f: 300, d: 0.25, type: 'sawtooth', v: 0.05, slide: 120 }],
  combo: [
    { f: 784, d: 0.08, type: 'square', v: 0.07 },
    { f: 1175, d: 0.14, type: 'square', v: 0.07, delay: 0.07 },
  ],
  break: [
    { f: 120, d: 0.3, type: 'sawtooth', v: 0.16, slide: 40 },
    { f: 1568, d: 0.25, type: 'triangle', v: 0.09, delay: 0.05 },
  ],
  hit: [{ f: 220, d: 0.07, type: 'square', v: 0.07, slide: 110 }],
  stun: [{ f: 900, d: 0.2, type: 'sine', v: 0.07, slide: 400 }],
  shield: [{ f: 400, d: 0.18, type: 'sine', v: 0.08, slide: 640 }],
  win: [
    { f: 523, d: 0.12, type: 'triangle', v: 0.1 },
    { f: 659, d: 0.12, type: 'triangle', v: 0.1, delay: 0.12 },
    { f: 784, d: 0.12, type: 'triangle', v: 0.1, delay: 0.24 },
    { f: 1047, d: 0.3, type: 'triangle', v: 0.1, delay: 0.36 },
  ],
  lose: [
    { f: 392, d: 0.2, type: 'triangle', v: 0.1 },
    { f: 330, d: 0.2, type: 'triangle', v: 0.1, delay: 0.2 },
    { f: 262, d: 0.4, type: 'triangle', v: 0.1, delay: 0.4 },
  ],
  coin: [
    { f: 988, d: 0.06, type: 'square', v: 0.05 },
    { f: 1319, d: 0.12, type: 'square', v: 0.05, delay: 0.06 },
  ],
};

const BGM_MAIN = [262, 330, 392, 330, 294, 349, 440, 349, 262, 330, 392, 523, 494, 392, 330, 294];
const BGM_BATTLE = [196, 196, 233, 196, 262, 196, 233, 175, 196, 196, 233, 196, 294, 262, 233, 175];

/** 合成音效与简易循环 BGM（无需音频资源文件）。 */
export class SynthAudio {
  sfxOn = true;
  musicOn = true;
  private ctx: AudioContext | null = null;
  private bgmTimer: ReturnType<typeof setInterval> | null = null;
  private bgmStep = 0;
  private bgmTrack: number[] = BGM_MAIN;

  constructor(private factory: () => AudioContext | null) {}

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = this.factory();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** 首次用户交互时调用以解锁音频 */
  unlock(): void {
    this.ensure();
    this.syncBgm();
  }

  private tone(n: Note): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (n.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type ?? 'sine';
    osc.frequency.setValueAtTime(n.f, t0);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, n.slide), t0 + n.d);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(n.v ?? 0.1, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + n.d + 0.05);
  }

  play(name: SfxName): void {
    if (!this.sfxOn) return;
    if (!this.ensure()) return;
    for (const n of SFX[name]) this.tone(n);
  }

  setTrack(track: 'main' | 'battle'): void {
    this.bgmTrack = track === 'battle' ? BGM_BATTLE : BGM_MAIN;
  }

  syncBgm(): void {
    if (this.musicOn && !this.bgmTimer && this.ctx) {
      this.bgmTimer = setInterval(() => {
        if (!this.ctx || this.ctx.state !== 'running') return;
        const f = this.bgmTrack[this.bgmStep % this.bgmTrack.length];
        this.bgmStep++;
        this.tone({ f, d: 0.26, type: 'triangle', v: 0.025 });
        if (this.bgmStep % 4 === 1) this.tone({ f: f / 2, d: 0.5, type: 'sine', v: 0.03 });
      }, 280);
    } else if (!this.musicOn && this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => {});
  }
}
