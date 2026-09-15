import { weaknessMatch } from '../../core/chain';
import type { App, Scene } from '../app';
import { C, W } from '../theme';
import type { Ui } from '../ui';
import { drawRune, drawWeakness, formatDuration, formatNum } from '../widgets';
import { BattleScene } from './battle';
import { drawPage, tag } from './common';

export class IdleScene implements Scene {
  name = 'idle';

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    let y = drawPage(app, ui, '挂机收益');
    const pv = g.idlePreview();
    ui.panel(24, y, W - 48, 420);
    ui.text('已累计时间', 50, y + 50, { size: 26, color: C.sub });
    ui.text(`${formatDuration(pv.elapsedMs)} / ${formatDuration(pv.capMs)}`, W - 50, y + 50, { size: 28, bold: true, align: 'right', color: pv.capped ? C.bad : C.text });
    ui.bar(50, y + 84, W - 148, 28, pv.elapsedMs / pv.capMs, pv.capped ? C.bad : C.accent);
    if (pv.capped) ui.text('已达累计上限，收益不再增加', W / 2, y + 140, { size: 22, color: C.bad, align: 'center' });
    ui.text('锻造锤', 50, y + 200, { size: 28, color: C.sub });
    ui.text(`+${pv.hammers}`, W - 50, y + 200, { size: 40, bold: true, color: C.accent2, align: 'right' });
    ui.text('金币', 50, y + 260, { size: 28, color: C.sub });
    ui.text(`+${formatNum(pv.gold)}`, W - 50, y + 260, { size: 40, bold: true, color: C.gold, align: 'right' });
    ui.text(`效率：每 ${cfg.economy.idle.hammerIntervalMinutes} 分钟 1 锻造锤 · 金币 ${formatNum(pv.goldPerHour)}/小时`, 50, y + 320, { size: 22, color: C.sub });
    ui.text('主线推进越深，金币效率越高', 50, y + 360, { size: 22, color: C.dim });
    y += 450;

    ui.panel(24, y, W - 48, 150);
    const monthly = g.monthlyActive();
    ui.text(`免费累计上限：${cfg.economy.idle.freeCapHours} 小时`, 50, y + 46, { size: 26, color: monthly ? C.sub : C.text, bold: !monthly });
    ui.text(`月卡累计上限：${cfg.shop.monthlyCard.idleCapHours} 小时 · 挂机金币 +${Math.round(cfg.shop.monthlyCard.idleGoldBonus * 100)}%`, 50, y + 100, {
      size: 26,
      color: monthly ? C.gold : C.sub,
      bold: monthly,
    });
    if (monthly) tag(ui, '生效中', W - 150, y + 100, C.gold);
    y += 190;

    ui.button('idle_claim', 150, y, W - 300, 120, '一键领取', () => {
      const r = g.claimIdle();
      if (r && (r.hammers > 0 || r.gold > 0)) {
        app.sfx('coin');
        app.toast(`领取 锻造锤 +${r.hammers}  金币 +${formatNum(r.gold)}`, C.gold);
      }
    }, { size: 40, disabled: pv.hammers === 0 && pv.gold === 0 });
  }
}

export class DailyScene implements Scene {
  name = 'daily';

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    g.ensureDaily();
    let y = drawPage(app, ui, '日常');
    ui.text('每日 0 点重置 · 完成已有行为即可领取锻造锤', W / 2, y, { size: 22, color: C.sub, align: 'center' });
    y += 30;
    for (const t of cfg.economy.daily.tasks) {
      const prog = Math.min(t.target, s.daily.progress[t.id] ?? 0);
      const claimed = !!s.daily.claimed[t.id];
      const done = prog >= t.target;
      ui.panel(24, y, W - 48, 120);
      ui.text(t.name, 50, y + 38, { size: 28, bold: true, color: claimed ? C.dim : C.text });
      ui.bar(50, y + 76, 330, 20, prog / t.target, done ? C.good : C.accent);
      ui.text(`${prog}/${t.target}`, 395, y + 86, { size: 20, color: C.sub });
      ui.text(`锤 +${t.hammers}  金币 +${formatNum(Math.round(t.gold * g.dailyGoldScale()))}`, 470, y + 38, { size: 20, color: C.accent2 });
      ui.button(`daily_claim_${t.id}`, W - 200, y + 56, 150, 54, claimed ? '已领取' : done ? '领取' : '未完成', () => {
        if (g.claimTask(t.id)) {
          app.sfx('coin');
          app.toast(`锻造锤 +${t.hammers}`, C.gold);
        }
      }, { disabled: claimed || !done, size: 24, fill: C.good });
      y += 132;
    }

    y += 10;
    ui.panel(24, y, W - 48, 250, C.panel2);
    const unlocked = g.isUnlocked('dailyBoss');
    ui.text('每日 Boss', 50, y + 40, { size: 30, bold: true, color: C.fire });
    if (!unlocked) {
      ui.text('通关 1-10 后解锁', 50, y + 100, { size: 26, color: C.sub });
      return;
    }
    const enemy = g.dailyBossEnemy();
    const db = cfg.economy.daily.dailyBoss;
    ui.text(`${enemy.name} · 奖励 锻造锤 +${db.hammers}（每日一次）`, 50, y + 90, { size: 24 });
    if (enemy.weakness) drawWeakness(ui, cfg, enemy.weakness, 50, y + 140, 36, weaknessMatch(s.chain, enemy.weakness, cfg.battle).full > 0);
    ui.text(s.daily.dailyBossWon ? '今日已击败' : `敌方战力约 ${formatNum(enemy.hp / cfg.stages.bossStats.hpPerPower)}`, 50, y + 196, { size: 22, color: s.daily.dailyBossWon ? C.good : C.sub });
    ui.button('daily_boss', W - 260, y + 150, 210, 80, s.daily.dailyBossWon ? '再次挑战' : '挑战', () => {
      const b = g.challengeDailyBoss();
      if (b) app.push(new BattleScene({ kind: 'daily', battle: b }));
      else app.toast('先处理锻造结果', C.accent2);
    }, { fill: '#e2574c', color: '#fff', size: 28 });
  }
}

export class ArenaScene implements Scene {
  name = 'arena';

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    let y = drawPage(app, ui, '竞技场');
    const board = g.leaderboard();
    const me = board.find((r) => r.isSelf)!;
    const left = g.arenaAttemptsLeft();
    ui.panel(24, y, W - 48, 110);
    ui.text(`积分 ${s.arena.score}`, 50, y + 40, { size: 32, bold: true, color: C.gold });
    ui.text(`排名 第 ${me.rank} 名`, 50, y + 82, { size: 24 });
    ui.text(`今日剩余 ${left}/${cfg.economy.arena.freeAttempts} 次`, W - 50, y + 40, { size: 26, bold: true, align: 'right', color: left > 0 ? C.good : C.dim });
    ui.text(`胜 ${s.arena.wins} · 负 ${s.arena.losses}`, W - 50, y + 82, { size: 22, color: C.sub, align: 'right' });
    y += 130;

    const tierName = { weak: '偏弱', close: '接近', strong: '略强' } as const;
    const tierColor = { weak: C.good, close: C.gold, strong: C.bad } as const;
    g.arenaOpponents().forEach((o, i) => {
      ui.panel(24, y, W - 48, 150);
      tag(ui, tierName[o.tier], 44, y + 34, tierColor[o.tier]);
      ui.text(o.bot.name, 130, y + 34, { size: 26, bold: true });
      ui.text(cfg.economy.arena.botLabel, 130, y + 66, { size: 18, color: C.dim });
      ui.text(`战力 ${formatNum(o.power)}`, W - 50, y + 34, { size: 24, bold: true, align: 'right', color: C.gold });
      o.bot.chainTypes.forEach((t, k) => {
        drawRune(ui, cfg, t, o.bot.quality, 64 + k * 58, y + 112, 46);
        if (k < 5) ui.text('›', 92 + k * 58, y + 112, { size: 20, color: C.dim, align: 'center' });
      });
      ui.button(`arena_fight_${i}`, W - 220, y + 76, 170, 60, '挑战', () => {
        const b = g.challengeArena(i);
        if (b) app.push(new BattleScene({ kind: 'arena', battle: b }));
        else app.toast(left <= 0 ? '今日次数已用完' : '先处理锻造结果', C.accent2);
      }, { fill: '#e2574c', color: '#fff', size: 26, disabled: left <= 0 });
      y += 162;
    });

    y += 6;
    ui.text('排行榜', 40, y + 10, { size: 26, bold: true, color: C.sub });
    y += 34;
    const rows = [...board.slice(0, 5)];
    const idx = board.indexOf(me);
    for (let k = Math.max(5, idx - 2); k <= Math.min(board.length - 1, idx + 2); k++) rows.push(board[k]);
    const seen = new Set<number>();
    for (const r of rows) {
      if (seen.has(r.rank)) continue;
      seen.add(r.rank);
      ui.rect(24, y, W - 48, 44, r.isSelf ? 'rgba(255,209,102,0.18)' : C.panel, 10);
      ui.text(`${r.rank}`, 60, y + 22, { size: 22, bold: true, align: 'center', color: r.rank <= 3 ? C.gold : C.sub });
      ui.text(r.name, 100, y + 22, { size: 22, bold: r.isSelf, color: r.isSelf ? C.gold : C.text });
      ui.text(`战力 ${formatNum(r.power)}`, 430, y + 22, { size: 20, color: C.sub });
      ui.text(`${r.score}`, W - 50, y + 22, { size: 22, bold: true, align: 'right' });
      y += 48;
    }
  }
}

export class ShopScene implements Scene {
  name = 'shop';
  private busy = false;

  constructor(app: App) {
    app.game.noteShopShown();
  }

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    let y = drawPage(app, ui, '商店');

    const buy = async (id: string) => {
      if (this.busy) return;
      this.busy = true;
      const r = await g.purchase(id);
      this.busy = false;
      if (r.ok) {
        app.sfx('win');
        app.toast('购买成功，权益已到账', C.gold);
      } else if (r.error !== 'cancelled') app.toast('购买未完成', C.bad);
    };

    const fc = cfg.shop.firstCharge;
    if (g.firstChargeVisible() || s.shop.firstChargeBought) {
      ui.panel(24, y, W - 48, 380, '#3a2230', C.accent);
      ui.text(fc.name, 50, y + 50, { size: 38, bold: true, color: C.accent2 });
      ui.text(`¥${fc.price}`, W - 50, y + 50, { size: 44, bold: true, color: C.gold, align: 'right' });
      const lines = [
        `普通锻造锤 ×${fc.hammers}`,
        '一次性保底：下一次正常锻造至少史诗（类型随机，仍消耗 1 个锻造锤）',
        `纯展示外观：${fc.cosmetic}`,
      ];
      let ly = y + 100;
      for (const l of lines) ly += ui.wrap(`· ${l}`, 50, ly, W - 100, { size: 25 }) + 8;
      if (s.shop.firstChargeBought) {
        ui.text(s.pity.firstChargeEpicPending ? '已购买 · 史诗保底待使用' : '已购买', W / 2, y + 330, { size: 28, bold: true, color: C.good, align: 'center' });
      } else {
        ui.button('shop_first', 150, y + 290, W - 300, 76, `¥${fc.price} 购买`, () => void buy(fc.id), { size: 32 });
      }
      y += 410;
    }

    const mc = cfg.shop.monthlyCard;
    const active = g.monthlyActive();
    ui.panel(24, y, W - 48, 430, '#22283a', C.shield);
    ui.text(mc.name, 50, y + 50, { size: 38, bold: true, color: C.shield });
    ui.text(`¥${mc.price} / ${mc.days}天`, W - 50, y + 50, { size: 36, bold: true, color: C.gold, align: 'right' });
    const ml = [
      `每日领取普通锻造锤 ×${mc.dailyHammers}`,
      `离线累计上限 ${cfg.economy.idle.freeCapHours} 小时 → ${mc.idleCapHours} 小时`,
      `挂机金币 +${Math.round(mc.idleGoldBonus * 100)}%`,
      '不改变任何品质概率、类型概率与战斗规则',
    ];
    let ly = y + 100;
    for (const l of ml) ly += ui.wrap(`· ${l}`, 50, ly, W - 100, { size: 25, color: l.startsWith('不改变') ? C.sub : C.text }) + 8;
    if (active) {
      ui.text(`生效中 · 剩余 ${g.monthlyDaysLeft()} 天`, 50, y + 300, { size: 26, bold: true, color: C.good });
      const canClaim = g.canClaimMonthly();
      ui.button('shop_monthly_claim', 50, y + 334, 300, 76, canClaim ? `领取 ×${mc.dailyHammers}` : '今日已领取', () => {
        if (g.claimMonthly()) {
          app.sfx('coin');
          app.toast(`锻造锤 +${mc.dailyHammers}`, C.gold);
        }
      }, { fill: C.good, size: 28, disabled: !canClaim });
      ui.button('shop_monthly', W - 330, y + 334, 280, 76, '续费', () => void buy(mc.id), { fill: C.shield, size: 28 });
    } else {
      ui.button('shop_monthly', 150, y + 334, W - 300, 76, `¥${mc.price} 开通`, () => void buy(mc.id), { fill: C.shield, size: 32 });
    }
    y += 460;
    ui.text('当前为测试环境：支付为模拟流程', W / 2, y, { size: 20, color: C.dim, align: 'center' });
  }
}

export class SettingsScene implements Scene {
  name = 'settings';

  render(app: App, ui: Ui): void {
    const g = app.game;
    const s = g.state;
    let y = drawPage(app, ui, '设置');
    const toggle = (id: string, label: string, on: boolean, cb: () => void) => {
      ui.panel(24, y, W - 48, 100);
      ui.text(label, 50, y + 50, { size: 30 });
      ui.button(id, W - 210, y + 18, 160, 64, on ? '开' : '关', cb, { fill: on ? C.good : C.line, color: on ? '#10240f' : C.text, size: 28 });
      y += 120;
    };
    toggle('set_sfx', '音效', s.settings.sfx, () => {
      s.settings.sfx = !s.settings.sfx;
      app.audio.sfxOn = s.settings.sfx;
      g.save();
    });
    toggle('set_music', '音乐', s.settings.music, () => {
      s.settings.music = !s.settings.music;
      app.audio.musicOn = s.settings.music;
      app.audio.syncBgm();
      g.save();
    });
    ui.panel(24, y, W - 48, 160);
    ui.text('账户', 50, y + 44, { size: 30 });
    ui.text(`玩家 ID：${s.seed.toString(36).toUpperCase()}`, 50, y + 94, { size: 24, color: C.sub });
    ui.text(`创建于 ${new Date(s.createdAt).toLocaleDateString()}`, 50, y + 130, { size: 22, color: C.dim });
    y += 190;
    ui.text(`版本 0.1.0 · ${app.platform.name === 'wx' ? '微信小游戏' : '网页调试版'}`, W / 2, y, { size: 22, color: C.dim, align: 'center' });
  }
}
