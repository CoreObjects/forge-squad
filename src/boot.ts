import { defaultConfig } from './core/config';
import { Game } from './core/game';
import { MockPaymentProvider, type PaymentProvider, type ProductInfo } from './core/shop';
import { OnlineServices } from './net/online';
import { SynthAudio } from './platform/audio';
import type { Platform } from './platform/platform';
import { App } from './ui/app';
import { ChainScene } from './ui/scenes/chain';
import { GmScene } from './ui/scenes/gm';
import { CharacterScene, FurnaceScene } from './ui/scenes/growth';
import { MainScene } from './ui/scenes/main';
import { ArenaScene, DailyScene, IdleScene, SettingsScene, ShopScene } from './ui/scenes/meta';
import { C } from './ui/theme';

export const SAVE_KEY = 'forge_squad_save_v1';

/** 配置了服务端但连不上时：不允许支付（避免离线白拿权益） */
const unavailablePayment: PaymentProvider = {
  async pay() {
    return { ok: false, error: 'offline' };
  },
};

export function boot(platform: Platform): App {
  const cfg = defaultConfig();
  const now = platform.now();
  const raw = platform.storageGet(SAVE_KEY);
  const loaded = Game.loadState(cfg, raw, now);
  const isFirst = !loaded;
  const state = loaded ?? Game.newState(cfg, now, Math.floor(Math.random() * 2 ** 31));
  let online: OnlineServices | null = null;
  const game = new Game(cfg, state, {
    now: () => platform.now(),
    save: (json) => {
      platform.storageSet(SAVE_KEY, json);
      online?.cloud.markDirty();
    },
    onOrderGranted: (orderId) => online?.onOrderGranted(orderId),
  });
  game.analytics.addSink((e) => {
    if (platform.gmEnabled && typeof console !== 'undefined') console.debug('[track]', e.name, e.props);
  });

  const audio = new SynthAudio(() => platform.createAudioContext());
  const app = new App(game, platform, audio);
  const confirmPay = (p: ProductInfo, title: string) => {
    const text = `确认支付 ¥${p.price} 购买「${p.name}」？`;
    return platform.nativeConfirm ? platform.nativeConfirm(title, text) : app.confirm(title, text, '支付', '取消');
  };

  if (platform.apiBase && platform.transport) {
    online = new OnlineServices(game, {
      apiBase: platform.apiBase,
      transport: platform.transport,
      store: { get: (k) => platform.storageGet(k), set: (k, v) => platform.storageSet(k, v) },
      wxLogin: platform.wxLogin,
      deviceId: platform.deviceId,
      virtualPayment: platform.virtualPayment,
      confirmDevPay: (p) => confirmPay(p, '开发支付（服务端测试环境）'),
    });
    app.online = online;
    game.setPayment(unavailablePayment);
    online.cloud.addReplacedListener(() => {
      app.popTo('main');
      app.toast('已载入云存档', C.good);
    });
  } else {
    game.setPayment(new MockPaymentProvider((p) => confirmPay(p, '模拟支付（未连接服务端）')));
  }

  app.sceneFactory = {
    chain: () => new ChainScene(),
    furnace: () => new FurnaceScene(),
    character: () => new CharacterScene(),
    idle: () => new IdleScene(),
    daily: () => new DailyScene(),
    arena: () => new ArenaScene(),
    shop: (a) => new ShopScene(a),
    settings: () => new SettingsScene(),
    gm: () => new GmScene(),
  };
  app.push(new MainScene());
  game.startSession(isFirst);
  app.start();
  if (online) {
    const o = online;
    void o.start().then((ok) => {
      if (!ok) app.toast('服务器连接失败，当前为离线模式', C.accent2);
    });
  }
  return app;
}
