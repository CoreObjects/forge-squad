export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2D | null;
}

export interface Platform {
  name: 'web' | 'wx';
  now(): number;
  storageGet(key: string): string | null;
  storageSet(key: string, value: string): void;
  canvas: CanvasLike;
  /** 逻辑像素尺寸与像素比 */
  size(): { w: number; h: number; dpr: number };
  onPointerDown(cb: (x: number, y: number) => void): void;
  onPointerMove(cb: (x: number, y: number) => void): void;
  onPointerUp(cb: (x: number, y: number) => void): void;
  onResize(cb: () => void): void;
  onHide(cb: () => void): void;
  onShow(cb: () => void): void;
  raf(cb: (t: number) => void): void;
  createAudioContext(): AudioContext | null;
  /** 系统确认框（用于模拟支付）；返回 null 表示由游戏内弹窗处理 */
  nativeConfirm?: (title: string, content: string) => Promise<boolean>;
  gmEnabled: boolean;
  safeTop: number;
}
