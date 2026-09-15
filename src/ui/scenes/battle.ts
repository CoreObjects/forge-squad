import type { BattleEvent } from '../../core/battle';
import { prevIndex } from '../../core/chain';
import type { ArenaBattle, StageBattle } from '../../core/game';
import type { Chain } from '../../core/types';
import type { App, Scene } from '../app';
import { C, W } from '../theme';
import type { Ui } from '../ui';
import { chainWidth, drawChain, drawEnemy, drawHero, drawWeakness, formatNum } from '../widgets';
import { drawBackground } from './common';

export type BattleSpec = { kind: 'stage' | 'daily'; battle: StageBattle } | { kind: 'arena'; battle: ArenaBattle };

interface Floater {
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
  t: number;
}

const STEP_MS = 430;

export class BattleScene implements Scene {
  name = 'battle';
  private idx = 0;
  private timer = 0;
  private speed = 1;
  private done = false;
  private pHp: number;
  private eHp: number;
  private pShield = 0;
  private eShield = 0;
  private lit: number | null = null;
  private litCombo: [number, number] | null = null;
  private eLit: number | null = null;
  private floaters: Floater[] = [];
  private comboName = '';
  private comboT = 0;
  private breakT = 0;
  private vulnerable = false;
  private enemyStunned = false;
  private heroFlash = 0;
  private enemyHit = 0;
  private heroHit = 0;
  private events: BattleEvent[];
  private pMax: number;
  private eMax: number;
  private endT = 0;

  constructor(private spec: BattleSpec) {
    const r = spec.battle.result;
    this.events = r.events;
    this.pMax = r.pMaxHp;
    this.eMax = r.eMaxHp;
    this.pHp = r.pMaxHp;
    this.eHp = r.eMaxHp;
  }

  private get chain(): Chain {
    return this.spec.battle.playerChain;
  }

  private float(text: string, x: number, y: number, color: string, size = 34): void {
    const near = this.floaters.filter((f) => Math.abs(f.y - y) < 120 && f.t < 500).length;
    this.floaters.push({ text, x: x + (Math.random() - 0.5) * 40, y: y - near * 44, color, size, t: 0 });
  }

  private apply(app: App, e: BattleEvent): number {
    const cfg = app.game.cfg;
    switch (e.k) {
      case 'node': {
        this.pHp = e.pHp;
        this.eHp = e.eHp;
        this.pShield = e.pShield;
        this.eShield = e.eShield;
        if (e.side === 'p') {
          this.lit = e.idx;
          this.eLit = null;
          this.vulnerable = e.vulnerable;
          if (e.skipped) {
            this.float('被眩晕 跳过', 375, 700, C.sub, 28);
            this.litCombo = null;
            return STEP_MS;
          }
          if (e.combos.length) {
            const p = prevIndex(e.idx, cfg.battle);
            this.litCombo = p >= 0 ? [p, e.idx] : null;
            this.comboName = e.combos.map((id) => cfg.battle.combos.find((c) => c.id === id)?.name ?? id).join(' + ');
            if (e.triple) this.comboName += ` · ${cfg.battle.triples.find((t) => t.id === e.triple)?.name ?? ''}`;
            this.comboT = 900;
            app.sfx('combo');
          } else this.litCombo = null;
          if (e.dmg > 0) {
            this.heroFlash = 1;
            this.enemyHit = 1;
            this.float(`-${formatNum(e.dmg)}`, 375, 330, e.vulnerable ? C.fire : e.combos.length ? C.gold : '#fff', e.vulnerable || e.combos.length ? 46 : 36);
            app.sfx('hit');
          }
          if (e.shieldGain > 0) {
            this.float(`护盾 +${formatNum(e.shieldGain)}`, 375, 640, C.shield, 30);
            app.sfx('shield');
          }
          if (e.stunTried) {
            this.float(e.stunOk ? '眩晕!' : '眩晕未命中', 375, 250, e.stunOk ? C.gold : C.dim, e.stunOk ? 36 : 26);
            if (e.stunOk) {
              this.enemyStunned = true;
              app.sfx('stun');
            }
          }
          if (e.type === 'ji') this.float('强化下一节点', 375, 640, '#35d6c0', 26);
        } else {
          // 竞技场对手节点
          this.eLit = e.idx;
          if (e.skipped) {
            this.float('对手被眩晕', 375, 250, C.gold, 28);
            this.enemyStunned = false;
            return STEP_MS;
          }
          if (e.dmg > 0) {
            this.heroHit = 1;
            this.float(`-${formatNum(e.dmg - e.absorbed)}`, 375, 700, C.bad, 34);
            app.sfx('hit');
          }
          if (e.shieldGain > 0) this.float(`护盾 +${formatNum(e.shieldGain)}`, 375, 260, C.shield, 28);
          if (e.stunTried && e.stunOk) this.float('你被眩晕!', 375, 700, C.gold, 30);
        }
        return STEP_MS;
      }
      case 'break': {
        this.pHp = e.pHp;
        this.eHp = e.eHp;
        this.breakT = 1300;
        this.vulnerable = true;
        this.enemyHit = 1;
        this.float(`破势 -${formatNum(e.dmg)}`, 375, 280, C.fire, 50);
        app.sfx('break');
        return STEP_MS * 1.6;
      }
      case 'attack': {
        this.pHp = e.pHp;
        this.pShield = e.pShield;
        this.lit = null;
        this.litCombo = null;
        if (e.skipped) {
          this.float('敌人眩晕 跳过行动', 375, 250, C.gold, 30);
          this.enemyStunned = false;
        } else {
          this.heroHit = 1;
          if (e.absorbed > 0) this.float(`护盾抵挡 ${formatNum(e.absorbed)}`, 375, 620, C.shield, 26);
          const real = e.dmg - e.absorbed;
          if (real > 0) this.float(`-${formatNum(real)}`, 375, 700, C.bad, 36);
          app.sfx('hit');
        }
        return STEP_MS;
      }
      case 'end': {
        this.done = true;
        this.lit = null;
        this.litCombo = null;
        app.sfx(e.win ? 'win' : 'lose');
        return 0;
      }
    }
  }

  render(app: App, ui: Ui, dt: number): void {
    const g = app.game;
    const cfg = g.cfg;
    const top = app.platform.safeTop;
    if (!this.done) {
      this.timer -= dt * this.speed;
      while (this.timer <= 0 && !this.done && this.idx < this.events.length) {
        this.timer += this.apply(app, this.events[this.idx++]);
      }
    } else this.endT += dt;
    this.heroFlash = Math.max(0, this.heroFlash - dt / 250);
    this.enemyHit = Math.max(0, this.enemyHit - dt / 250);
    this.heroHit = Math.max(0, this.heroHit - dt / 250);
    this.comboT = Math.max(0, this.comboT - dt);
    this.breakT = Math.max(0, this.breakT - dt);

    drawBackground(ui);
    const spec = this.spec;
    const isArena = spec.kind === 'arena';
    const enemyName = isArena ? spec.battle.opponent.name : spec.battle.enemy.name;
    const title = isArena ? `竞技场 · ${enemyName}` : spec.kind === 'daily' ? `每日 Boss · ${enemyName}` : `${spec.battle.info.label} · ${enemyName}`;
    ui.text(title, W / 2, top + 44, { size: 32, bold: true, align: 'center' });

    // 敌人
    const weakness = !isArena ? spec.battle.enemy.weakness : null;
    if (weakness) drawWeakness(ui, cfg, weakness, 40, top + 100, 34);
    if (isArena) {
      ui.text('系统测试数据', W / 2, top + 80, { size: 18, color: C.dim, align: 'center' });
      const oc = spec.battle.opponentChain;
      drawChain(ui, cfg, oc, { x: (W - chainWidth(48, 10)) / 2, y: top + 98, node: 48, gap: 10, unlocked: 6, lit: this.eLit, showIndex: false, showCombos: false });
    }
    const ey = top + 390;
    ui.bar(120, ey - 230, 510, 26, this.eHp / this.eMax, this.vulnerable ? C.fire : C.bad);
    if (this.eShield > 0) ui.bar(120, ey - 198, 510 * Math.min(1, this.eShield / this.eMax), 10, 1, C.shield, 'rgba(0,0,0,0)');
    ui.text(`${formatNum(this.eHp)} / ${formatNum(this.eMax)}`, W / 2, ey - 217, { size: 20, bold: true, align: 'center' });
    if (isArena) drawHero(ui, W / 2, ey + 10, 0.9, {});
    else drawEnemy(ui, enemyName, W / 2, ey, 1, { boss: spec.battle.enemy.isBoss, hit: this.enemyHit, vulnerable: this.vulnerable, stunned: this.enemyStunned });

    // 玩家
    const py = top + 760;
    drawHero(ui, W / 2, py, 0.9, { flash: this.heroFlash, shield: this.pShield, cosmetic: g.state.shop.cosmeticOwned });
    if (this.heroHit > 0) {
      ui.ctx.save();
      ui.ctx.globalAlpha = this.heroHit * 0.35;
      ui.circle(W / 2, py, 130, C.bad);
      ui.ctx.restore();
    }
    ui.bar(120, py + 140, 510, 26, this.pHp / this.pMax, C.good);
    if (this.pShield > 0) ui.bar(120, py + 172, 510 * Math.min(1, this.pShield / this.pMax), 10, 1, C.shield, 'rgba(0,0,0,0)');
    ui.text(`${formatNum(this.pHp)} / ${formatNum(this.pMax)}${this.pShield > 0 ? `  护盾 ${formatNum(this.pShield)}` : ''}`, W / 2, py + 153, { size: 20, bold: true, align: 'center' });

    // 战纹链
    const node = 96;
    const gap = 16;
    drawChain(ui, cfg, this.chain, {
      x: (W - chainWidth(node, gap)) / 2,
      y: top + 980,
      node,
      gap,
      unlocked: 6,
      lit: this.lit,
      litCombo: this.litCombo,
      weakness,
    });

    // 连携名 / 破势
    if (this.comboT > 0) {
      ui.ctx.save();
      ui.ctx.globalAlpha = Math.min(1, this.comboT / 300);
      ui.text(this.comboName, W / 2, top + 590, { size: 40, bold: true, color: C.gold, align: 'center' });
      ui.ctx.restore();
    }
    if (this.breakT > 0) {
      const k = this.breakT / 1300;
      ui.ctx.save();
      ui.ctx.globalAlpha = Math.min(1, k * 2);
      ui.ctx.shadowColor = C.fire;
      ui.ctx.shadowBlur = 40;
      ui.text('破 势 !', W / 2, top + 520, { size: 96 + (1 - k) * 30, bold: true, color: C.fire, align: 'center' });
      ui.ctx.restore();
    }

    // 飘字
    this.floaters = this.floaters.filter((f) => f.t < 900);
    for (const f of this.floaters) {
      f.t += dt;
      ui.ctx.save();
      ui.ctx.globalAlpha = Math.max(0, 1 - f.t / 900);
      ui.text(f.text, f.x, top + f.y - f.t / 12, { size: f.size, bold: true, color: f.color, align: 'center' });
      ui.ctx.restore();
    }

    if (!this.done) {
      ui.button('battle_speed', 40, top + 1150, 180, 76, `速度 ×${this.speed}`, () => (this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 4 : 1), {
        fill: C.panel2,
        color: C.text,
        size: 26,
      });
      ui.button('battle_skip', W - 220, top + 1150, 180, 76, '跳过', () => this.skip(app), { fill: C.panel2, color: C.text, size: 26 });
    } else if (this.endT > 350) {
      this.drawResult(app, ui);
    }
  }

  private skip(app: App): void {
    while (!this.done && this.idx < this.events.length) {
      const e = this.events[this.idx++];
      if (e.k === 'end') {
        this.done = true;
        app.sfx(e.win ? 'win' : 'lose');
      } else if (e.k === 'node' || e.k === 'attack' || e.k === 'break') {
        this.pHp = e.pHp;
        this.eHp = e.eHp;
      }
    }
    this.floaters = [];
    this.lit = null;
    this.litCombo = null;
    this.endT = 1000;
  }

  private drawResult(app: App, ui: Ui): void {
    const g = app.game;
    const spec = this.spec;
    const r = spec.battle.result;
    ui.mask(0.55);
    ui.blocker();
    const x = 50;
    const w = W - 100;
    const h = r.win || spec.kind === 'arena' ? 480 : 700;
    const y = r.win || spec.kind === 'arena' ? 400 : 300;
    ui.panel(x, y, w, h, C.panel2);
    ui.text(r.win ? '胜 利' : '失 败', W / 2, y + 80, { size: 64, bold: true, color: r.win ? C.gold : C.bad, align: 'center' });
    let ly = y + 160;
    const s = r.stats;
    const comboTotal = Object.values(s.combos).reduce((a, b) => a + b, 0);
    ui.text(`触发连携 ${comboTotal} 次 · 破势 ${s.breaks} 次 · 眩晕 ${s.stunsOk}/${s.stunsTried}`, W / 2, ly, { size: 24, color: C.sub, align: 'center' });
    ly += 60;
    if (spec.kind === 'arena') {
      const b = spec.battle;
      ui.text(`积分 ${b.scoreDelta >= 0 ? '+' : ''}${b.scoreDelta}（当前 ${g.state.arena.score}）`, W / 2, ly, { size: 30, bold: true, color: b.scoreDelta >= 0 ? C.good : C.bad, align: 'center' });
      ly += 56;
      ui.text(`奖励：锻造锤 +${b.rewards.hammers}  金币 +${formatNum(b.rewards.gold)}`, W / 2, ly, { size: 26, align: 'center' });
    } else {
      const b = spec.battle;
      if (r.win) {
        if (b.rewards.hammers || b.rewards.gold) ui.text(`奖励：锻造锤 +${b.rewards.hammers}  金币 +${formatNum(b.rewards.gold)}`, W / 2, ly, { size: 28, bold: true, align: 'center' });
        else if (spec.kind === 'daily') ui.text('今日奖励已领取', W / 2, ly, { size: 26, color: C.sub, align: 'center' });
        if (s.breaks > 0) ui.text('命中破绽，破势是本场的关键！', W / 2, ly + 60, { size: 26, color: C.fire, align: 'center' });
      } else {
        ui.text('失败原因', x + 40, ly, { size: 26, bold: true, color: C.accent2 });
        ly += 40;
        for (const hint of b.hints) {
          ly += ui.wrap(`· ${hint}`, x + 40, ly, w - 80, { size: 25, color: C.text }) + 10;
        }
      }
    }

    const by = y + h - 120;
    if (r.win || spec.kind === 'arena') {
      ui.button('result_continue', x + 150, by, w - 300, 90, '继续', () => app.popTo('main'), { size: 32 });
    } else {
      ui.button('result_chain', x + 30, by, 190, 90, '调整战纹链', () => {
        app.popTo('main');
        app.open('chain');
      }, { fill: C.gold, size: 26 });
      ui.button('result_forge', x + 240, by, 170, 90, '去锻造', () => app.popTo('main'), { fill: C.panel, color: C.text, size: 26 });
      ui.button('result_retry', x + 430, by, 190, 90, '再次挑战', () => {
        const nb = spec.kind === 'daily' ? g.challengeDailyBoss() : g.challengeStage();
        if (nb) {
          app.popTo('main');
          app.push(new BattleScene({ kind: spec.kind, battle: nb }));
        }
      }, { fill: '#e2574c', color: '#fff', size: 26 });
    }
  }
}
