import type { Transport } from '../net/api';
import type { VirtualPaymentBridge } from '../net/payment';

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
  /** 系统确认框（用于支付确认）；未提供时用游戏内弹窗 */
  nativeConfirm?: (title: string, content: string) => Promise<boolean>;
  gmEnabled: boolean;
  safeTop: number;
  /** 游戏服务端地址；为空时离线运行（本地存档 / 模拟支付 / 本地测试对手） */
  apiBase?: string;
  transport?: Transport;
  /** 微信登录，返回 wx.login 的 code */
  wxLogin?: () => Promise<string>;
  /** 微信虚拟支付 */
  virtualPayment?: VirtualPaymentBridge;
  /** 设备号（网页调试版的账号标识） */
  deviceId: () => string;
}
