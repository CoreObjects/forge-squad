import { boot } from './boot';
import type { Transport } from './net/api';
import { PaymentCancelled } from './net/payment';
import type { CanvasLike, Platform } from './platform/platform';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const wx: any;
declare const GameGlobal: any;

const info = wx.getSystemInfoSync();
const canvas: CanvasLike = wx.createCanvas();
const safeTop = info.safeArea ? Math.max(0, info.safeArea.top) : info.statusBarHeight || 0;

const firstTouch = (e: any) => {
  const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
  return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
};

const wxTransport: Transport = (req) =>
  new Promise((resolve, reject) =>
    wx.request({
      url: req.url,
      method: req.method,
      data: req.body === undefined ? undefined : JSON.stringify(req.body),
      header: req.headers,
      dataType: 'json',
      success: (r: any) => resolve({ status: r.statusCode, data: r.data }),
      fail: (e: any) => reject(new Error(e?.errMsg ?? 'request failed')),
    }),
  );

const platform: Platform = {
  name: 'wx',
  now: () => Date.now(),
  storageGet: (k) => {
    try {
      const v = wx.getStorageSync(k);
      return typeof v === 'string' && v ? v : null;
    } catch {
      return null;
    }
  },
  storageSet: (k, v) => {
    try {
      wx.setStorageSync(k, v);
    } catch {
      // 存储已满等异常
    }
  },
  canvas,
  size: () => ({ w: info.windowWidth, h: info.windowHeight, dpr: Math.min(3, info.pixelRatio || 2) }),
  onPointerDown: (cb) =>
    wx.onTouchStart((e: any) => {
      const p = firstTouch(e);
      cb(p.x, p.y);
    }),
  onPointerMove: (cb) =>
    wx.onTouchMove((e: any) => {
      const p = firstTouch(e);
      cb(p.x, p.y);
    }),
  onPointerUp: (cb) =>
    wx.onTouchEnd((e: any) => {
      const p = firstTouch(e);
      cb(p.x, p.y);
    }),
  onResize: (cb) => {
    if (wx.onWindowResize) wx.onWindowResize(cb);
  },
  onHide: (cb) => wx.onHide(cb),
  onShow: (cb) => wx.onShow(cb),
  raf: (cb) => requestAnimationFrame(cb),
  createAudioContext: () => (wx.createWebAudioContext ? wx.createWebAudioContext() : null),
  nativeConfirm: (title, content) =>
    new Promise((resolve) =>
      wx.showModal({
        title,
        content,
        confirmText: '支付',
        success: (r: any) => resolve(!!r.confirm),
        fail: () => resolve(false),
      }),
    ),
  gmEnabled: __GM__,
  safeTop: designSafeTop(),
  apiBase: __API_BASE__.replace(/\/$/, ''),
  transport: wxTransport,
  wxLogin: () =>
    new Promise((resolve, reject) =>
      wx.login({
        success: (r: any) => (r.code ? resolve(r.code) : reject(new Error('no code'))),
        fail: (e: any) => reject(new Error(e?.errMsg ?? 'wx.login failed')),
      }),
    ),
  virtualPayment: (p) =>
    new Promise((resolve, reject) =>
      wx.requestVirtualPayment({
        mode: p.mode,
        signData: p.signData,
        paySig: p.paySig,
        signature: p.signature,
        success: () => resolve(),
        fail: (e: any) => reject(e?.errCode === -2 || /cancel/i.test(e?.errMsg ?? '') ? new PaymentCancelled() : new Error(e?.errMsg ?? 'pay failed')),
      }),
    ),
  deviceId: () => 'wx',
};

/** 把系统安全区顶部换算到设计坐标（设计区域在屏幕内等比居中）。 */
function designSafeTop(): number {
  const scale = Math.min(info.windowWidth / 750, info.windowHeight / 1334);
  const offY = (info.windowHeight - 1334 * scale) / 2;
  return Math.max(0, Math.round((safeTop - offY) / scale));
}

const app = boot(platform);
if (typeof GameGlobal !== 'undefined') GameGlobal.forge = app;
