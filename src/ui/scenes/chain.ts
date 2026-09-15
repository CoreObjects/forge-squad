import { activeCombos, activeTriples, weaknessMatch } from '../../core/chain';
import type { App, Scene } from '../app';
import { C, QUALITY_COLOR, RUNE_COLOR, W } from '../theme';
import type { Ui } from '../ui';
import { chainWidth, drawChain, drawRune, drawWeakness, formatNum } from '../widgets';
import { drawPage } from './common';

export class ChainScene implements Scene {
  name = 'chain';
  private selected: number | null = null;

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    let y = drawPage(app, ui, '战纹链', 'chainpage_back');
    const target = g.targetWeakness();

    // 当前 Boss 破绽
    ui.panel(24, y, W - 48, 120);
    if (target) {
      const m = weaknessMatch(s.chain, target.weakness, cfg.battle);
      ui.text(`当前 Boss：${target.name}`, 50, y + 36, { size: 26, bold: true });
      drawWeakness(ui, cfg, target.weakness, 50, y + 84, 40, m.full > 0);
      if (m.full === 0) ui.text(`已连上 ${m.best}/${target.weakness.length}`, W - 50, y + 84, { size: 22, color: C.sub, align: 'right' });
    } else {
      ui.text('当前没有需要针对的破绽', 50, y + 60, { size: 26, color: C.sub });
    }
    y += 150;

    ui.text(this.selected === null ? '点击一个节点，再点另一个节点即可交换位置' : `已选节点 ${this.selected + 1}，点击另一个节点交换`, W / 2, y, {
      size: 24,
      color: this.selected === null ? C.sub : C.gold,
      align: 'center',
    });
    y += 50;
    const node = 104;
    const gap = 14;
    drawChain(ui, cfg, s.chain, {
      x: (W - chainWidth(node, gap)) / 2,
      y: y + 20,
      node,
      gap,
      unlocked: s.unlockedNodes,
      selected: this.selected,
      weakness: target?.weakness ?? null,
      idPrefix: 'chainpage_node',
      onTap: (i) => {
        if (this.selected === null) {
          if (s.chain[i] || i < s.unlockedNodes) this.selected = i;
        } else if (this.selected === i) {
          this.selected = null;
        } else {
          const before = activeCombos(s.chain, cfg.battle).length;
          g.swap(this.selected, i);
          const after = activeCombos(g.state.chain, cfg.battle).length;
          app.sfx(after > before ? 'combo' : 'place');
          if (target && weaknessMatch(g.state.chain, target.weakness, cfg.battle).full > 0) app.toast('破绽已对上！', C.good);
          this.selected = null;
        }
      },
    });
    y += 190;

    // 连携
    const combos = activeCombos(s.chain, cfg.battle);
    const triples = activeTriples(s.chain, cfg.battle);
    ui.panel(24, y, W - 48, 150);
    ui.text(`当前连携 ${combos.length}`, 50, y + 34, { size: 26, bold: true, color: C.gold });
    const text = combos.length
      ? combos.map((c) => `${c.name}（节点${c.from + 1}→${c.to + 1}）`).join('  ') + (triples.length ? `  三连：${triples.map((t) => t.name).join('、')}` : '')
      : '相邻节点形成 疾→锋 / 锋→锋 / 御→锋 / 震→锋 / 疾→震 / 御→御 会触发连携';
    ui.wrap(text, 50, y + 60, W - 100, { size: 22, color: combos.length ? C.text : C.sub, maxLines: 3 });
    y += 170;

    // 节点详情
    for (let i = 0; i < 6; i++) {
      const r = s.chain[i];
      const ry = y + i * 86;
      ui.rect(24, ry, W - 48, 76, i === this.selected ? C.panel2 : C.panel, 16, C.line);
      ui.text(`${i + 1}`, 52, ry + 38, { size: 24, bold: true, color: C.sub, align: 'center' });
      if (i >= s.unlockedNodes) {
        ui.text('未解锁', 100, ry + 38, { size: 24, color: C.dim });
        continue;
      }
      if (!r) {
        ui.text('空节点', 100, ry + 38, { size: 24, color: C.dim });
        continue;
      }
      drawRune(ui, cfg, r.type, r.quality, 110, ry + 38, 54);
      ui.text(`${cfg.runes.qualityNames[r.quality]}·${cfg.runes.typeNames[r.type]}`, 150, ry + 26, { size: 24, bold: true, color: QUALITY_COLOR[r.quality] });
      ui.text(cfg.runes.typeDesc[r.type], 150, ry + 56, { size: 20, color: C.sub });
      ui.text(`强度 ${formatNum(r.strength)}`, W - 50, ry + 38, { size: 24, bold: true, color: RUNE_COLOR[r.type], align: 'right' });
    }
  }
}
