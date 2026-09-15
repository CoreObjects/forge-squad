import { boot } from './boot';
import type { Platform } from './platform/platform';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

const toLocal = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

const platform: Platform = {
  name: 'web',
  now: () => Date.now(),
  storageGet: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  storageSet: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // 隐私模式等情况下无法持久化
    }
  },
  canvas,
  size: () => ({ w: canvas.clientWidth || window.innerWidth, h: canvas.clientHeight || window.innerHeight, dpr: Math.min(3, window.devicePixelRatio || 1) }),
  onPointerDown: (cb) =>
    canvas.addEventListener('pointerdown', (e) => {
      const p = toLocal(e);
      cb(p.x, p.y);
    }),
  onPointerMove: (cb) =>
    canvas.addEventListener('pointermove', (e) => {
      const p = toLocal(e);
      cb(p.x, p.y);
    }),
  onPointerUp: (cb) =>
    canvas.addEventListener('pointerup', (e) => {
      const p = toLocal(e);
      cb(p.x, p.y);
    }),
  onResize: (cb) => window.addEventListener('resize', cb),
  onHide: (cb) =>
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') cb();
    }),
  onShow: (cb) =>
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') cb();
    }),
  raf: (cb) => requestAnimationFrame(cb),
  createAudioContext: () => {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctor ? new Ctor() : null;
  },
  gmEnabled: __GM__ || params.get('gm') === '1',
  safeTop: 0,
};

const app = boot(platform);
(window as unknown as { forge: unknown }).forge = app;
