import { activeCombos, weaknessMatch } from '../../core/chain';
import type { App, Scene } from '../app';
import { C, H, W } from '../theme';
import type { Ui } from '../ui';
import { chainWidth, drawChain, drawCoinIcon, drawFireIcon, drawHammerIcon, drawHero, drawWeakness, formatNum } from '../widgets';
import { BattleScene } from './battle';
import { drawBackground, tag } from './common';
import { ForgeResultScene } from './forgeResult';

interface Floater {
  text: string;
  color: string;
  t: number;
}

export class MainScene implements Scene {
  name = 'main';
  private lastPower = -1;
  private floaters: Floater[] = [];
  private forgeFlash = 0;

  render(app: App, ui: Ui, dt: number): void {
    const g = app.game;
    const s = g.state;
    const top = app.platform.safeTop;
    drawBackground(ui);

    const power = g.power();
    if (this.lastPower >= 0 && power !== this.lastPower) {
      const d = power - this.lastPower;
      this.floaters.push({ text: `${d > 0 ? '+' : ''}${formatNum(d)}`, color: d > 0 ? C.good : C.bad, t: 0 });
    }
    this.lastPower = power;

    // 自动打开未处理的锻造结果（例如重进游戏时）
    if (s.pending.length > 0 && app.top() === this) app.push(new ForgeResultScene());

    this.drawTopBar(app, ui, top, power);
    this.drawStageCard(app, ui, top + 118);
    this.drawHeroArea(app, ui, top + 300, dt);
    this.drawChainArea(app, ui, top + 640);
    this.drawActions(app, ui);
    this.drawNav(app, ui);
  }

  private drawTopBar(app: App, ui: Ui, y: number, power: number): void {
    const g = app.game;
    const s = g.state;
    ui.rect(20, y + 14, 300, 84, 'rgba(10,7,16,0.55)', 20, C.line);
    ui.text('综合战力', 44, y + 40, { size: 20, color: C.sub });
    ui.text(formatNum(power), 44, y + 74, { size: 38, bold: true, color: C.gold });
    this.floaters = this.floaters.filter((f) => f.t < 1400);
    this.floaters.forEach((f, i) => {
      f.t += 16;
      ui.ctx.save();
      ui.ctx.globalAlpha = Math.max(0, 1 - f.t / 1400);
      ui.text(f.text, 250, y + 60 - f.t / 30 - i * 30, { size: 28, bold: true, color: f.color, align: 'center' });
      ui.ctx.restore();
    });

    const items: [(x: number, y: number) => void, string][] = [
      [(x, yy) => drawHammerIcon(ui, x, yy), formatNum(s.hammers)],
      [(x, yy) => drawCoinIcon(ui, x, yy), formatNum(s.gold)],
      [(x, yy) => drawFireIcon(ui, x, yy), formatNum(s.fireXpTotal)],
    ];
    items.forEach(([icon, v], i) => {
      const bx = 334 + i * 118;
      ui.rect(bx, y + 26, 110, 56, 'rgba(10,7,16,0.55)', 28, C.line);
      icon(bx + 26, y + 54);
      ui.text(v, bx + 46, y + 55, { size: 22, bold: true, maxWidth: 60 });
    });
    ui.button('settings', W - 80, y + 104, 60, 50, '设置', () => app.open('settings'), { fill: C.panel2, color: C.sub, size: 18 });
    if (app.platform.gmEnabled) ui.button('gm', W - 150, y + 104, 60, 50, 'GM', () => app.open('gm'), { fill: '#4a2b2b', color: '#ffb3b3', size: 18 });
  }

  private drawStageCard(app: App, ui: Ui, y: number): void {
    const g = app.game;
    const cfg = g.cfg;
    ui.panel(20, y, W - 180, 170, 'rgba(38,30,54,0.92)');
    if (g.allStagesCleared()) {
      ui.text('主线已全部通关', 50, y + 60, { size: 30, bold: true, color: C.gold });
      ui.text('等待后续章节开放', 50, y + 110, { size: 24, color: C.sub });
      return;
    }
    const info = g.currentStage();
    const chName = cfg.stages.chapterNames[(info.chapter - 1) % cfg.stages.chapterNames.length];
    ui.text(`第${info.chapter}章 ${chName} · ${info.label}`, 44, y + 34, { size: 22, color: C.sub });
    const nameW = ui.text(info.name, 44, y + 76, { size: 32, bold: true });
    if (info.kind === 'chapterBoss') tag(ui, '章节 Boss', 60 + nameW, y + 76, C.bad);
    else if (info.kind !== 'normal') tag(ui, '小 Boss', 60 + nameW, y + 76, C.accent2);
    const ratio = info.requiredPower / Math.max(1, g.power());
    const danger =
      ratio <= 0.9 ? ['轻松', C.good] : ratio <= 1.0 ? ['正常', '#9be07a'] : ratio <= 1.08 ? ['有压力', C.gold] : ratio <= 1.2 ? ['危险', C.accent] : ['极危', C.bad];
    const dw = ui.text(`危险度 ${danger[0]}`, 44, y + 116, { size: 22, bold: true, color: danger[1] });
    ui.text(`敌方战力约 ${formatNum(info.requiredPower)}`, 64 + dw, y + 116, { size: 22, color: C.sub });
    if (info.weakness) {
      const m = weaknessMatch(g.state.chain, info.weakness, cfg.battle).full > 0;
      drawWeakness(ui, cfg, info.weakness, 44, y + 150, 30, m);
    } else if (info.tendency) {
      ui.text(info.tendency, 44, y + 150, { size: 20, color: C.sub });
    }
  }

  private drawHeroArea(app: App, ui: Ui, y: number, dt: number): void {
    const g = app.game;
    const s = g.state;
    const ctx = ui.ctx;
    // 铁匠炉
    const fx = 130;
    const fy = y + 130;
    const glow = ctx.createRadialGradient(fx, fy, 10, fx, fy, 150 + ui.pulse(2) * 20);
    glow.addColorStop(0, 'rgba(255,120,40,0.55)');
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ui.rect(fx - 180, fy - 180, 360, 360, glow);
    ui.rect(fx - 80, fy - 90, 160, 190, '#3b2c3f', 30, '#5a4660', 4);
    ui.rect(fx - 50, fy - 30, 100, 80, '#140c12', 40);
    ui.circle(fx, fy + 20, 34 + ui.pulse(5) * 6, C.fire);
    ui.circle(fx, fy + 26, 18, C.gold);
    ui.text(`铁匠炉 Lv.${s.furnaceLevel}`, fx, fy + 124, { size: 24, bold: true, color: C.accent2, align: 'center' });
    // 砧台 + 主角
    ui.rect(520, y + 200, 170, 46, '#4a4f5e', 12);
    ui.rect(560, y + 242, 90, 36, '#353946', 8);
    this.forgeFlash = Math.max(0, this.forgeFlash - dt / 300);
    drawHero(ui, 420, y + 160, 1.0, { flash: this.forgeFlash, cosmetic: s.shop.cosmeticOwned });
    ui.text(`Lv.${s.charLevel} 锻造师`, 420, y + 36, { size: 22, color: C.sub, align: 'center' });
  }

  private drawChainArea(app: App, ui: Ui, y: number): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    const node = 100;
    const gap = 16;
    const x = (W - chainWidth(node, gap)) / 2;
    const target = g.targetWeakness();
    ui.rect(14, y - 40, W - 28, 210, 'rgba(10,7,16,0.45)', 26, C.line);
    ui.text('战纹链', 36, y - 16, { size: 22, bold: true, color: C.sub });
    drawChain(ui, cfg, s.chain, { x, y: y + 16, node, gap, unlocked: s.unlockedNodes, weakness: target?.weakness ?? null });
    ui.hit('chain_open', 14, y - 40, W - 28, 210, () => app.open('chain'));
    const combos = activeCombos(s.chain, cfg.battle).length;
    const m = target ? weaknessMatch(s.chain, target.weakness, cfg.battle).full : 0;
    const label = target ? `连携 ${combos} · ${target.name} 破绽匹配 ${m} · 点击调整 ›` : `连携 ${combos} · 点击调整 ›`;
    ui.text(label, W - 36, y - 16, { size: 20, color: C.sub, align: 'right' });
  }

  private drawActions(app: App, ui: Ui): void {
    const g = app.game;
    const s = g.state;
    const y = 880;
    const tenUnlocked = g.isUnlocked('tenPull');
    if (tenUnlocked) {
      ui.button('forge10', 30, y, 200, 110, '十连', () => this.forge(app, 10), {
        fill: C.panel2,
        color: C.text,
        sub: '锻造锤 ×10',
        size: 32,
        disabled: s.hammers < 10 && s.pending.length === 0,
      });
    }
    const stageLabel = g.allStagesCleared() ? '已通关' : `挑战 ${g.currentStage().label}`;
    ui.button('challenge', 470, y, 250, 110, stageLabel, () => this.challenge(app), {
      fill: '#e2574c',
      color: '#fff',
      size: 34,
      disabled: g.allStagesCleared(),
    });
    const fy = 1010;
    const pulse = s.hammers > 0 ? ui.pulse(3) : 0;
    ui.ctx.save();
    ui.ctx.shadowColor = C.fire;
    ui.ctx.shadowBlur = 20 + pulse * 20;
    ui.button('forge', 170, fy, 410, 140, '锻  造', () => this.forge(app, 1), {
      fill: C.accent,
      color: '#2a1206',
      size: 48,
      sub: `锻造锤 ${s.hammers}`,
      radius: 40,
    });
    ui.ctx.restore();
  }

  private forge(app: App, n: 1 | 10): void {
    const g = app.game;
    if (g.state.pending.length > 0) {
      app.push(new ForgeResultScene());
      return;
    }
    if (g.state.hammers < n) {
      app.toast(g.isUnlocked('idle') ? '锻造锤不足：去领取挂机收益或完成日常' : '锻造锤不足：继续推进主线获得', C.accent2);
      return;
    }
    const out = g.forge(n);
    if (out.length === 0) return;
    this.forgeFlash = 1;
    app.sfx('forge');
    app.push(new ForgeResultScene());
  }

  private challenge(app: App): void {
    const g = app.game;
    const b = g.challengeStage();
    if (!b) {
      if (g.state.pending.length > 0) app.push(new ForgeResultScene());
      else app.toast('先完成当前引导', C.accent2);
      return;
    }
    app.push(new BattleScene({ kind: 'stage', battle: b }));
  }

  private drawNav(app: App, ui: Ui): void {
    const g = app.game;
    const s = g.state;
    const y = H - 150;
    ui.rect(0, y - 14, W, 164, 'rgba(10,7,16,0.75)');
    const idle = g.idlePreview();
    const dailyClaimable = g.cfg.economy.daily.tasks.some((t) => !s.daily.claimed[t.id] && (s.daily.progress[t.id] ?? 0) >= t.target);
    const items: { id: string; label: string; scene: string; unlocked: boolean; lockText: string; badge: boolean }[] = [
      { id: 'nav_furnace', label: '铁匠炉', scene: 'furnace', unlocked: true, lockText: '', badge: g.furnaceCheck().can },
      { id: 'nav_char', label: '角色', scene: 'character', unlocked: true, lockText: '', badge: s.gold >= g.levelUpCost() && s.tutorial.step === 'done' },
      { id: 'nav_idle', label: '挂机', scene: 'idle', unlocked: g.isUnlocked('idle'), lockText: '通关 1-5 解锁挂机', badge: idle.hammers > 0 },
      { id: 'nav_daily', label: '日常', scene: 'daily', unlocked: g.isUnlocked('daily'), lockText: '通关 1-5 解锁日常', badge: dailyClaimable || (g.isUnlocked('dailyBoss') && !s.daily.dailyBossWon) },
      { id: 'nav_arena', label: '竞技场', scene: 'arena', unlocked: g.isUnlocked('arena'), lockText: '通关 1-10 解锁竞技场', badge: s.arena.unlocked && g.arenaAttemptsLeft() > 0 },
      {
        id: 'nav_shop',
        label: g.firstChargeVisible() ? '首充' : '月卡',
        scene: 'shop',
        unlocked: g.isUnlocked('shop'),
        lockText: '完成新手引导后开放',
        badge: g.canClaimMonthly() || (g.firstChargeVisible() && !s.milestones.firstChargeShown),
      },
    ];
    const bw = (W - 40) / items.length;
    items.forEach((it, i) => {
      const bx = 20 + i * bw;
      ui.button(
        it.id,
        bx + 6,
        y,
        bw - 12,
        110,
        it.label,
        () => {
          if (!it.unlocked) app.toast(it.lockText, C.sub);
          else app.open(it.scene);
        },
        { fill: it.unlocked ? C.panel2 : '#1e1829', color: it.unlocked ? C.text : C.dim, size: 26, badge: it.unlocked && it.badge, radius: 22 },
      );
    });
  }
}
