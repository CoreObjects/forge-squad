import { furnaceDef, playerPower } from '../../core/progression';
import type { App, Scene } from '../app';
import { C, QUALITY_COLOR, W } from '../theme';
import type { Ui } from '../ui';
import { chainWidth, drawChain, formatNum } from '../widgets';
import { drawPage } from './common';

export class FurnaceScene implements Scene {
  name = 'furnace';

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    let y = drawPage(app, ui, '铁匠炉');
    const check = g.furnaceCheck();
    ui.panel(24, y, W - 48, 300);
    ui.text(`铁匠炉 Lv.${s.furnaceLevel}`, 50, y + 50, { size: 40, bold: true, color: C.accent2 });
    ui.text(`累计炉火经验 ${formatNum(s.fireXpTotal)}`, 50, y + 104, { size: 26 });
    if (check.next) {
      const cur = furnaceDef(cfg, s.furnaceLevel)!;
      const ratio = (s.fireXpTotal - cur.xp) / Math.max(1, check.next.xp - cur.xp);
      ui.bar(50, y + 134, W - 148, 26, ratio, C.fire);
      ui.text(`${formatNum(s.fireXpTotal)} / ${formatNum(check.next.xp)}`, W / 2, y + 147, { size: 20, bold: true, align: 'center' });
      const req = (ok: boolean, text: string, ry: number) => {
        ui.text(ok ? '✓' : '✗', 60, ry, { size: 26, bold: true, color: ok ? C.good : C.bad, align: 'center' });
        ui.text(text, 90, ry, { size: 24, color: ok ? C.text : C.sub });
      };
      req(check.xpOk, `炉火经验 ${formatNum(check.next.xp)}`, y + 196);
      req(check.goldOk, `金币 ${formatNum(check.next.gold)}（拥有 ${formatNum(s.gold)}）`, y + 232);
      req(check.chapterOk, `通关第 ${check.next.chapter} 章（已通关 ${g.chaptersCleared()} 章）`, y + 268);
    } else {
      ui.text('已达到当前版本最高炉级', 50, y + 160, { size: 26, color: C.gold });
    }
    y += 330;

    const drawRow = (label: string, level: number, ry: number) => {
      const row = cfg.runes.qualityTable[Math.min(cfg.runes.qualityTable.length, level) - 1];
      ui.text(label, 50, ry, { size: 24, bold: true });
      let bx = 50;
      const bw = W - 100;
      row.forEach((p, i) => {
        const w = (bw * p) / 100;
        if (w > 0) ui.rect(bx, ry + 24, Math.max(2, w), 30, QUALITY_COLOR[i]);
        bx += w;
      });
      cfg.runes.qualityNames.forEach((n, i) => {
        const cx = 50 + (i * (W - 100)) / 6;
        ui.text(`${n} ${row[i]}%`, cx, ry + 80, { size: 19, color: row[i] > 0 ? QUALITY_COLOR[i] : C.dim });
      });
    };
    ui.panel(24, y, W - 48, check.next ? 290 : 160);
    drawRow(`当前品质概率（Lv.${s.furnaceLevel}）`, s.furnaceLevel, y + 40);
    if (check.next) drawRow(`升级后（Lv.${check.next.level}）`, check.next.level, y + 170);
    y += check.next ? 320 : 190;

    ui.panel(24, y, W - 48, 150);
    ui.wrap('熔炼不需要的战纹获得炉火经验。炉级越高，高品质概率越高、战纹强度区间越高（每级约 +18%）。升级需要同时满足炉火、金币与主线进度。', 50, y + 24, W - 100, { size: 22, color: C.sub });
    y += 180;

    ui.button('furnace_upgrade', 150, y, W - 300, 110, check.next ? '升级铁匠炉' : '已满级', () => {
      if (g.upgradeFurnace()) {
        app.sfx('quality');
        app.toast(`铁匠炉升到 Lv.${g.state.furnaceLevel}！装备池提升`, C.gold);
      }
    }, { disabled: !check.can, size: 36 });
    if (check.next && !check.can) {
      const why = !check.xpOk ? '炉火经验不足：熔炼更多战纹' : !check.chapterOk ? `需要先通关第 ${check.next.chapter} 章` : '金币不足';
      ui.text(why, W / 2, y + 140, { size: 22, color: C.sub, align: 'center' });
    }
  }
}

export class CharacterScene implements Scene {
  name = 'character';
  private detail = false;

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    let y = drawPage(app, ui, '角色');
    const base = g.characterBaseStats();
    const total = g.stats();
    ui.panel(24, y, W - 48, 330);
    ui.text(`锻造师 Lv.${s.charLevel}`, 50, y + 50, { size: 38, bold: true });
    ui.text(`综合战力 ${formatNum(g.power())}`, W - 50, y + 50, { size: 30, bold: true, color: C.gold, align: 'right' });
    const rows: [string, number, number][] = [
      ['攻击', total.atk, base.atk],
      ['生命', total.hp, base.hp],
      ['防御', total.def, base.def],
      ['速度', total.speed, base.speed],
    ];
    rows.forEach(([n, v, b], i) => {
      const ry = y + 110 + i * 52;
      ui.text(n, 60, ry, { size: 26, color: C.sub });
      ui.text(formatNum(v), 200, ry, { size: 28, bold: true });
      if (v !== b) ui.text(`（角色 ${formatNum(b)} + 战纹 ${formatNum(v - b)}）`, 330, ry, { size: 22, color: C.dim });
    });
    y += 350;

    const cost = g.levelUpCost();
    const nextPower = playerPower(cfg, s.charLevel + 1, s.chain);
    ui.button('char_levelup', 60, y, W - 120, 110, '升级', () => {
      if (g.levelUp()) app.sfx('coin');
      else app.toast('金币不足：挂机与主线可获得金币', C.accent2);
    }, { size: 36, sub: `消耗金币 ${formatNum(cost)} · 战力 +${formatNum(nextPower - g.power())}`, disabled: s.gold < cost });
    y += 140;

    ui.panel(24, y, W - 48, 200);
    ui.text('6 节战纹概览', 50, y + 34, { size: 24, bold: true, color: C.sub });
    drawChain(ui, cfg, s.chain, { x: (W - chainWidth(86, 14)) / 2, y: y + 70, node: 86, gap: 14, unlocked: s.unlockedNodes });
    y += 230;

    ui.button('char_detail', 24, y, W - 48, 70, this.detail ? '收起详细属性 ▲' : '详细属性 ▼', () => (this.detail = !this.detail), {
      fill: C.panel2,
      color: C.text,
      size: 24,
    });
    y += 90;
    if (this.detail) {
      const b = cfg.battle;
      const lines = [
        `锋纹：造成 ${Math.round(b.feng.dmg * 100)}% 攻击力伤害`,
        `疾纹：紧邻下一枚战纹效果 +${Math.round(b.ji.nextBoost * 100)}%`,
        `御纹：获得最大生命 ${Math.round(b.yu.shieldPctMaxHp * 100)}% 的护盾（只保留较高值）`,
        `震纹：${Math.round(b.zhen.dmg * 100)}% 攻击力伤害，${Math.round(b.zhen.stunChance * 100)}% 使敌人跳过下一次行动`,
        `破势：受到伤害 +${Math.round(b.break.dmgTakenBonus * 100)}%，持续 ${b.break.durationNodes} 节点，触发时追加 ${Math.round(b.break.instantDmg * 100)}% 攻击力伤害`,
        `品质效果加成：${cfg.runes.qualityNames.map((n, i) => `${n}×${cfg.runes.qualityEffectMult[i]}`).join(' ')}`,
        `暴击 / 命中 / 抗性：本版本不参与计算`,
      ];
      ui.panel(24, y, W - 48, 330);
      let ly = y + 20;
      for (const l of lines) ly += ui.wrap(l, 50, ly, W - 100, { size: 21, color: C.sub }) + 4;
    }
  }
}
