import type { App } from '../app';
import { C, H, W } from '../theme';
import type { Ui } from '../ui';
import { drawCoinIcon, drawFireIcon, drawHammerIcon, formatNum } from '../widgets';

export function drawBackground(ui: Ui): void {
  const g = ui.ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#221933');
  g.addColorStop(0.55, C.bg);
  g.addColorStop(1, '#0d0a14');
  ui.rect(0, 0, W, H, g);
}

export function drawPage(app: App, ui: Ui, title: string, backId = 'page_back', onBack?: () => void): number {
  drawBackground(ui);
  const top = app.platform.safeTop;
  ui.rect(0, 0, W, top + 110, 'rgba(10,7,16,0.6)');
  ui.button(backId, 24, top + 22, 120, 66, '‹ 返回', onBack ?? (() => app.pop()), { fill: C.panel2, color: C.text, size: 26 });
  ui.text(title, W / 2, top + 55, { size: 36, bold: true, align: 'center' });
  drawResources(app, ui, W - 24, top + 55, true);
  return top + 130;
}

/** 资源条（右对齐时 x 为右边界） */
export function drawResources(app: App, ui: Ui, x: number, y: number, rightAlign = false, compact = true): void {
  const s = app.game.state;
  const items: { icon: (x: number, y: number) => void; v: string }[] = [
    { icon: (ix, iy) => drawHammerIcon(ui, ix, iy, 0.9), v: formatNum(s.hammers) },
    { icon: (ix, iy) => drawCoinIcon(ui, ix, iy, 0.9), v: formatNum(s.gold) },
  ];
  if (!compact) items.push({ icon: (ix, iy) => drawFireIcon(ui, ix, iy, 0.9), v: formatNum(s.fireXpTotal) });
  const widths = items.map((it) => 40 + ui.measure(it.v, 24, true) + 18);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = rightAlign ? x - total : x;
  items.forEach((it, i) => {
    it.icon(cx + 14, y);
    ui.text(it.v, cx + 34, y, { size: 24, bold: true });
    cx += widths[i];
  });
}

export function tag(ui: Ui, text: string, x: number, y: number, color: string, size = 20): number {
  const w = ui.measure(text, size, true) + 22;
  ui.rect(x, y - size * 0.8, w, size * 1.6, color, size * 0.8);
  ui.text(text, x + w / 2, y + 1, { size, bold: true, color: '#1a0f22', align: 'center' });
  return w;
}

export function removeScene(app: App, scene: object): void {
  const i = app.stack.indexOf(scene as never);
  if (i >= 0) app.stack.splice(i, 1);
}
