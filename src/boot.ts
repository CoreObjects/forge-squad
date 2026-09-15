import { defaultConfig } from './core/config';
import { Game } from './core/game';
import { MockPaymentProvider } from './core/shop';
import { SynthAudio } from './platform/audio';
import type { Platform } from './platform/platform';
import { App } from './ui/app';
import { ChainScene } from './ui/scenes/chain';
import { GmScene } from './ui/scenes/gm';
import { CharacterScene, FurnaceScene } from './ui/scenes/growth';
import { MainScene } from './ui/scenes/main';
import { ArenaScene, DailyScene, IdleScene, SettingsScene, ShopScene } from './ui/scenes/meta';

export const SAVE_KEY = 'forge_squad_save_v1';

export function boot(platform: Platform): App {
  const cfg = defaultConfig();
  const now = platform.now();
  const raw = platform.storageGet(SAVE_KEY);
  const loaded = Game.loadState(cfg, raw, now);
  const isFirst = !loaded;
  const state = loaded ?? Game.newState(cfg, now, Math.floor(Math.random() * 2 ** 31));
  const game = new Game(cfg, state, {
    now: () => platform.now(),
    save: (json) => platform.storageSet(SAVE_KEY, json),
  });
  game.analytics.addSink((e) => {
    if (platform.gmEnabled && typeof console !== 'undefined') console.debug('[track]', e.name, e.props);
  });

  const audio = new SynthAudio(() => platform.createAudioContext());
  const app = new App(game, platform, audio);

  game.setPayment(
    new MockPaymentProvider((p) =>
      platform.nativeConfirm
        ? platform.nativeConfirm('模拟支付', `测试环境：确认支付 ¥${p.price} 购买「${p.name}」？`)
        : app.confirm('模拟支付', `测试环境：确认支付 ¥${p.price} 购买「${p.name}」？`, '支付', '取消'),
    ),
  );

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
  return app;
}
