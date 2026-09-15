import type { PlacementEval } from '../../core/chain';
import type { Decision } from '../../core/game';
import type { App, Scene } from '../app';
import { C, QUALITY_COLOR, W } from '../theme';
import type { Ui } from '../ui';
import { chainWidth, drawChain, drawRune, formatNum, runeLabel } from '../widgets';
import { removeScene, tag } from './common';

const PITY_TEXT: Record<string, string> = {
  rare: '稀有保底',
  epic: '史诗保底',
  legend: '传说保底',
  newbieEpic: '新手史诗保底',
  firstCharge: '首充史诗保底',
};

export class ForgeResultScene implements Scene {
  name = 'forgeResult';
  modal = true;
  private manual = false;
  private selected: number | null = null;
  private runeId = '';
  private appear = 0;
  private busy = false;

  render(app: App, ui: Ui, dt: number): void {
    const g = app.game;
    const cfg = g.cfg;
    const p = g.currentPending();
    if (!p) {
      removeScene(app, this);
      return;
    }
    const rune = p.rune;
    if (rune.id !== this.runeId) {
      this.runeId = rune.id;
      this.manual = false;
      this.selected = null;
      this.appear = 0;
      if (rune.quality >= 3) app.sfx('quality');
    }
    this.appear = Math.min(1, this.appear + dt / 260);

    ui.mask(0.78);
    ui.blocker();
    const x = 30;
    const y = 120;
    const w = W - 60;
    const h = 1100;
    ui.panel(x, y, w, h, C.panel);
    ui.text('锻造结果', x + 36, y + 50, { size: 30, bold: true });
    if (g.state.pending.length > 1) ui.text(`待处理 ${g.state.pending.length} 枚`, x + w - 36, y + 50, { size: 24, color: C.sub, align: 'right' });

    // 战纹
    const qc = QUALITY_COLOR[rune.quality];
    if (rune.quality >= 3) {
      const rg = ui.ctx.createRadialGradient(W / 2, y + 200, 10, W / 2, y + 200, 200);
      rg.addColorStop(0, qc);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ui.ctx.save();
      ui.ctx.globalAlpha = 0.35 + ui.pulse(4) * 0.2;
      ui.rect(W / 2 - 220, y + 10, 440, 380, rg);
      ui.ctx.restore();
    }
    const scale = 0.6 + 0.4 * easeOutBack(this.appear);
    drawRune(ui, cfg, rune.type, rune.quality, W / 2, y + 200, 170 * scale, { glow: true });
    ui.text(runeLabel(cfg, rune), W / 2, y + 320, { size: 34, bold: true, color: qc, align: 'center' });
    ui.text(`强度 ${rune.strength}  ·  ${cfg.runes.typeDesc[rune.type]}`, W / 2, y + 366, { size: 24, color: C.sub, align: 'center' });
    if (p.pityHit) tag(ui, PITY_TEXT[p.pityHit] ?? '保底', W / 2 + 150, y + 116, C.gold, 20);

    const rec = g.recommendationFor(rune);
    const shown: PlacementEval | null = this.manual ? (this.selected !== null ? rec.all[this.selected] : null) : rec.tag === 'melt' ? null : rec.best;
    const target = g.targetWeakness();

    // 推荐信息
    let iy = y + 430;
    ui.rect(x + 30, iy - 10, w - 60, 330, C.bg2, 20, C.line);
    iy += 30;
    if (!this.manual) {
      if (rec.tag === 'melt' || !rec.best) {
        ui.text('建议熔炼', x + 60, iy, { size: 30, bold: true, color: C.accent2 });
        tag(ui, '无明显提升', x + 210, iy, C.sub);
        ui.text('放进任何节点都不会让战纹链变强', x + 60, iy + 50, { size: 24, color: C.sub });
      } else {
        ui.text(`推荐放入：节点 ${rec.best.node + 1}`, x + 60, iy, { size: 30, bold: true, color: C.gold });
        const t = rec.tag === 'strong' ? ['强烈推荐', C.good] : rec.tag === 'structure' ? ['有结构价值', C.shield] : ['可以放入', C.sub];
        tag(ui, t[0], x + 360, iy, t[1]);
      }
    } else {
      ui.text(this.selected === null ? '点击下方节点预览' : `预览：放入节点 ${this.selected + 1}`, x + 60, iy, { size: 30, bold: true, color: C.gold });
    }
    if (shown) {
      iy += 52;
      const pc = shown.powerDeltaPct >= 0 ? C.good : C.bad;
      ui.text('综合战力', x + 60, iy, { size: 24, color: C.sub });
      ui.text(`${shown.powerDeltaPct >= 0 ? '+' : ''}${shown.powerDeltaPct.toFixed(1)}%（${formatNum(shown.powerBefore)} → ${formatNum(shown.powerAfter)}）`, x + 200, iy, { size: 24, bold: true, color: pc });
      iy += 42;
      ui.text('新增连携', x + 60, iy, { size: 24, color: C.sub });
      ui.text(shown.gained.length ? shown.gained.join('、') : '无', x + 200, iy, { size: 24, bold: true, color: shown.gained.length ? C.gold : C.dim });
      iy += 42;
      ui.text('失去连携', x + 60, iy, { size: 24, color: C.sub });
      ui.text(shown.lost.length ? shown.lost.join('、') : '无', x + 200, iy, { size: 24, bold: true, color: shown.lost.length ? C.bad : C.dim });
      iy += 42;
      if (target) {
        ui.text('破绽匹配', x + 60, iy, { size: 24, color: C.sub });
        const better = shown.weakAfter > shown.weakBefore;
        const worse = shown.weakAfter < shown.weakBefore;
        ui.text(`${target.name}：${shown.weakBefore} → ${shown.weakAfter}`, x + 200, iy, { size: 24, bold: true, color: better ? C.good : worse ? C.bad : C.text });
        iy += 42;
      }
      if (shown.overwritten) {
        const o = shown.overwritten;
        ui.text(`将替换 ${runeLabel(cfg, o)}（熔炼 +${cfg.runes.meltXp[o.quality]} 炉火）`, x + 60, iy, { size: 22, color: C.accent2 });
      }
    } else if (!this.manual) {
      ui.text(`熔炼获得 ${cfg.runes.meltXp[rune.quality]} 炉火经验`, x + 60, iy + 100, { size: 24, color: C.text });
    }

    // 链预览
    const node = 90;
    const gap = 14;
    const cx = (W - chainWidth(node, gap)) / 2;
    const ghostNode = shown ? shown.node : null;
    drawChain(ui, cfg, g.state.chain, {
      x: cx,
      y: y + 800,
      node,
      gap,
      unlocked: g.state.unlockedNodes,
      ghost: ghostNode !== null ? { node: ghostNode, rune } : null,
      weakness: target?.weakness ?? null,
      selected: this.manual ? this.selected : null,
      idPrefix: 'manual_node',
      onTap: this.manual ? (i) => (this.selected = i) : undefined,
    });

    // 按钮
    const by = y + h - 130;
    if (!this.manual) {
      const recMelt = rec.tag === 'melt' || !rec.best;
      ui.button('place_recommend', x + 30, by, 250, 96, recMelt ? '按推荐熔炼' : '推荐放入', () => this.decide(app, { kind: 'recommend' }), {
        fill: recMelt ? C.accent2 : C.good,
        size: 30,
      });
      ui.button('place_manual', x + 300, by, 180, 96, '手动放入', () => (this.manual = true), { fill: C.panel2, color: C.text, size: 28 });
      ui.button('place_melt', x + 500, by, 160, 96, '熔炼', () => this.decide(app, { kind: 'melt' }), {
        fill: '#5a3a2a',
        color: C.accent2,
        size: 28,
        sub: `+${cfg.runes.meltXp[rune.quality]} 炉火`,
      });
    } else {
      ui.button('manual_back', x + 30, by, 220, 96, '返回', () => {
        this.manual = false;
        this.selected = null;
      }, { fill: C.panel2, color: C.text, size: 28 });
      const sel = this.selected;
      ui.button(
        'manual_confirm',
        x + 270,
        by,
        390,
        96,
        sel === null ? '选择节点' : `放入节点 ${sel + 1}`,
        () => {
          if (sel !== null) this.decide(app, { kind: 'place', node: sel });
        },
        { fill: C.good, size: 30, disabled: sel === null },
      );
    }
  }

  private async decide(app: App, d: Decision): Promise<void> {
    if (this.busy) return;
    const g = app.game;
    const cfg = g.cfg;
    const needs = g.needsConfirm(d);
    if (needs) {
      this.busy = true;
      const ok = await app.confirm('确认操作', `这会熔炼 ${runeLabel(cfg, needs)}（强度 ${needs.strength}），熔炼后无法找回。`, '确认', '再想想');
      this.busy = false;
      if (!ok) return;
    }
    const res = g.decidePending(d);
    if (!res) return;
    if (res.placedNode !== null) {
      app.sfx('place');
      if (res.overwritten) app.toast(`替换并熔炼：+${res.fireXp} 炉火`, C.accent2);
    } else {
      app.sfx('melt');
      app.toast(`熔炼：+${res.fireXp} 炉火`, C.accent2);
    }
    if (g.furnaceCheck().can && g.state.pending.length === 0) app.toast('炉火充足，可以升级铁匠炉了！', C.gold);
    if (!g.currentPending()) removeScene(app, this);
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
