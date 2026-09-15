import { activeCombos, weaknessMatch } from '../core/chain';
import type { GameConfig } from '../core/config';
import type { Chain, Rune, RuneType } from '../core/types';
import { C, QUALITY_COLOR, RUNE_COLOR } from './theme';
import type { Ui } from './ui';

export function runeLabel(cfg: GameConfig, r: Rune): string {
  return `${cfg.runes.qualityNames[r.quality]} · ${cfg.runes.typeNames[r.type]}`;
}

/** 战纹图标：类型色六边形 + 汉字 + 品质描边 */
export function drawRune(ui: Ui, cfg: GameConfig, type: RuneType, quality: number, cx: number, cy: number, size: number, opts: { glow?: boolean; dim?: boolean } = {}): void {
  const ctx = ui.ctx;
  const r = size / 2;
  ctx.save();
  if (opts.dim) ctx.globalAlpha = 0.45;
  if (opts.glow || quality >= 3) {
    ctx.shadowColor = QUALITY_COLOR[quality];
    ctx.shadowBlur = quality >= 4 ? 26 : 14;
  }
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, lighten(RUNE_COLOR[type], 0.25));
  g.addColorStop(1, RUNE_COLOR[type]);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(3, size * 0.07);
  ctx.strokeStyle = QUALITY_COLOR[quality];
  ctx.stroke();
  ctx.restore();
  ui.text(cfg.runes.typeShort[type], cx, cy + 2, { size: Math.round(size * 0.46), bold: true, color: '#1a0f22', align: 'center' });
}

export function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) + 255 * amt));
  const g = Math.min(255, Math.round(((n >> 8) & 255) + 255 * amt));
  const b = Math.min(255, Math.round((n & 255) + 255 * amt));
  return `rgb(${r},${g},${b})`;
}

export interface ChainDrawOpts {
  x: number;
  y: number;
  node: number;
  gap: number;
  unlocked: number;
  idPrefix?: string;
  onTap?: (i: number) => void;
  selected?: number | null;
  lit?: number | null;
  litCombo?: [number, number] | null;
  weakness?: RuneType[] | null;
  ghost?: { node: number; rune: Rune } | null;
  showIndex?: boolean;
  showCombos?: boolean;
  highlightNodes?: number[];
}

export function chainWidth(node: number, gap: number): number {
  return node * 6 + gap * 5;
}

/** 6 节战纹链 */
export function drawChain(ui: Ui, cfg: GameConfig, chain: Chain, o: ChainDrawOpts): void {
  const display = chain.slice();
  if (o.ghost) display[o.ghost.node] = o.ghost.rune;
  const combos = o.showCombos !== false ? activeCombos(display, cfg.battle) : [];
  const wm = o.weakness ? weaknessMatch(display, o.weakness, cfg.battle) : null;
  const cx = (i: number) => o.x + o.node / 2 + i * (o.node + o.gap);
  const cy = o.y + o.node / 2;

  // 连线
  for (let i = 0; i < 5; i++) {
    const combo = combos.find((c) => c.from === i && c.to === i + 1);
    const lit = o.litCombo && o.litCombo[0] === i && o.litCombo[1] === i + 1;
    const color = lit ? '#fff3b0' : combo ? C.gold : C.line;
    ui.line(cx(i) + o.node * 0.42, cy, cx(i + 1) - o.node * 0.42, cy, color, lit ? 10 : combo ? 6 : 3);
    if (combo && o.node >= 70) {
      ui.text(combo.name, (cx(i) + cx(i + 1)) / 2, o.y - 12, { size: 18, color: lit ? '#fff3b0' : C.gold, align: 'center', bold: true });
    }
  }
  // 破绽匹配底框
  if (wm && wm.nodes) {
    const a = wm.nodes[0];
    const b = wm.nodes[wm.nodes.length - 1];
    ui.rect(cx(a) - o.node / 2 - 8, o.y - 8, cx(b) - cx(a) + o.node + 16, o.node + 16, 'rgba(255,90,60,0.12)', 18, C.fire, 3);
  }

  for (let i = 0; i < 6; i++) {
    const x = cx(i);
    const locked = i >= o.unlocked;
    const r = display[i];
    const sel = o.selected === i;
    const lit = o.lit === i;
    const hl = o.highlightNodes?.includes(i);
    if (lit) ui.circle(x, cy, o.node * 0.62, 'rgba(255,240,170,0.35)');
    ui.rect(x - o.node / 2, o.y, o.node, o.node, locked ? '#141019' : C.bg2, 18, sel ? C.gold : hl ? C.accent : C.line, sel || hl ? 4 : 2);
    if (locked) {
      ui.text('未解锁', x, cy, { size: Math.round(o.node * 0.18), align: 'center', color: C.dim });
    } else if (r) {
      const isGhost = o.ghost && o.ghost.node === i;
      drawRune(ui, cfg, r.type, r.quality, x, cy, o.node * 0.78, { glow: lit || !!isGhost });
      if (isGhost) ui.text('新', x + o.node * 0.34, o.y + 12, { size: 18, bold: true, color: C.gold, align: 'center' });
    } else {
      ui.text('空', x, cy, { size: Math.round(o.node * 0.24), align: 'center', color: C.dim });
    }
    if (o.showIndex !== false) ui.text(String(i + 1), x, o.y + o.node + 16, { size: 18, align: 'center', color: C.sub });
    if (o.onTap && !locked) {
      const cb = o.onTap;
      ui.hit(`${o.idPrefix ?? 'node'}_${i}`, x - o.node / 2 - o.gap / 2, o.y - 10, o.node + o.gap, o.node + 20, () => cb(i));
    }
  }
}

export function drawWeakness(ui: Ui, cfg: GameConfig, weakness: RuneType[], x: number, y: number, size = 40, matched = false): number {
  let cx = x;
  ui.text('破绽', cx, y, { size: 22, bold: true, color: matched ? C.good : C.fire });
  cx += 56;
  weakness.forEach((t, i) => {
    drawRune(ui, cfg, t, 0, cx + size / 2, y, size);
    cx += size;
    if (i < weakness.length - 1) {
      ui.text('→', cx + 12, y, { size: 22, color: C.sub, align: 'center' });
      cx += 24;
    }
  });
  if (matched) {
    ui.text('✓ 已匹配', cx + 12, y, { size: 20, color: C.good });
    cx += 90;
  }
  return cx - x;
}

export function drawHammerIcon(ui: Ui, x: number, y: number, s = 1): void {
  const ctx = ui.ctx;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.6);
  ui.rect(-3 * s, -2 * s, 6 * s, 26 * s, '#b07a4a', 2 * s);
  ui.rect(-12 * s, -12 * s, 24 * s, 12 * s, '#cfd6e6', 3 * s);
  ctx.restore();
}

export function drawCoinIcon(ui: Ui, x: number, y: number, s = 1): void {
  ui.circle(x, y, 12 * s, C.gold, '#b8860b', 2);
  ui.text('¥', x, y + 1, { size: Math.round(14 * s), bold: true, color: '#8a5a00', align: 'center' });
}

export function drawFireIcon(ui: Ui, x: number, y: number, s = 1): void {
  const ctx = ui.ctx;
  ctx.beginPath();
  ctx.moveTo(x, y - 14 * s);
  ctx.quadraticCurveTo(x + 13 * s, y, x + 7 * s, y + 11 * s);
  ctx.quadraticCurveTo(x, y + 15 * s, x - 7 * s, y + 11 * s);
  ctx.quadraticCurveTo(x - 13 * s, y, x, y - 14 * s);
  ctx.fillStyle = C.fire;
  ctx.fill();
  ui.circle(x, y + 6 * s, 4.5 * s, '#ffd166');
}

export function formatNum(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 100000000) return `${(v / 100000000).toFixed(2)}亿`;
  if (Math.abs(v) >= 100000) return `${(v / 10000).toFixed(1)}万`;
  return String(v);
}

export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`;
}

/** 主角：Q 版铁匠冒险者 */
export function drawHero(ui: Ui, cx: number, cy: number, s: number, opts: { flash?: number; cosmetic?: boolean; shield?: number } = {}): void {
  const ctx = ui.ctx;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  if (opts.cosmetic) {
    ctx.shadowColor = '#ff7a2b';
    ctx.shadowBlur = 30;
  }
  // 身体
  ui.rect(-46, -10, 92, 110, '#6b4a2f', 30);
  ui.rect(-40, 10, 80, 70, '#8e5f3a', 20);
  ctx.shadowBlur = 0;
  // 围裙
  ui.rect(-30, 20, 60, 72, '#3d2d22', 12);
  // 头
  ui.circle(0, -52, 44, '#f2c79b');
  ui.rect(-48, -104, 96, 34, '#c44b2b', 16);
  ui.circle(-16, -54, 5, '#2a1a12');
  ui.circle(16, -54, 5, '#2a1a12');
  ui.rect(-14, -34, 28, 6, '#a86b4a', 3);
  // 手臂与锤子
  ui.rect(44, -4, 20, 64, '#f2c79b', 10);
  ctx.save();
  ctx.translate(58, 20);
  ctx.rotate(-0.5 - (opts.flash ?? 0) * 0.8);
  ui.rect(-5, -70, 10, 80, '#8a5a34', 4);
  ui.rect(-26, -92, 52, 28, '#cfd6e6', 6, '#8d97ad', 3);
  ctx.restore();
  ui.rect(-64, -4, 20, 64, '#f2c79b', 10);
  if (opts.shield && opts.shield > 0) {
    ctx.globalAlpha = 0.35;
    ui.circle(0, 0, 120, C.shield);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** 敌人：按名字选色的魔物剪影 */
export function drawEnemy(ui: Ui, name: string, cx: number, cy: number, s: number, opts: { boss?: boolean; hit?: number; vulnerable?: boolean; stunned?: boolean } = {}): void {
  const ctx = ui.ctx;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const body = `hsl(${h},45%,${opts.boss ? 38 : 45}%)`;
  const dark = `hsl(${h},45%,25%)`;
  ctx.save();
  ctx.translate(cx + (opts.hit ? Math.sin(opts.hit * 40) * 8 * opts.hit : 0), cy);
  ctx.scale(s * (opts.boss ? 1.25 : 1), s * (opts.boss ? 1.25 : 1));
  if (opts.vulnerable) {
    ctx.shadowColor = C.fire;
    ctx.shadowBlur = 40;
  }
  ctx.beginPath();
  ctx.moveTo(-90, 80);
  ctx.quadraticCurveTo(-110, -40, -50, -90);
  ctx.quadraticCurveTo(0, -130, 50, -90);
  ctx.quadraticCurveTo(110, -40, 90, 80);
  ctx.closePath();
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowBlur = 0;
  ui.rect(-90, 60, 180, 26, dark, 12);
  // 角
  if (opts.boss) {
    ctx.beginPath();
    ctx.moveTo(-50, -92);
    ctx.lineTo(-78, -150);
    ctx.lineTo(-24, -104);
    ctx.moveTo(50, -92);
    ctx.lineTo(78, -150);
    ctx.lineTo(24, -104);
    ctx.fillStyle = '#e8dcc8';
    ctx.fill();
  }
  // 眼睛
  ui.circle(-30, -40, 16, '#fff');
  ui.circle(30, -40, 16, '#fff');
  ui.circle(-30, -38, 7, opts.stunned ? '#999' : '#1a0f22');
  ui.circle(30, -38, 7, opts.stunned ? '#999' : '#1a0f22');
  ui.rect(-36, 4, 72, 14, dark, 7);
  if (opts.hit) {
    ctx.globalAlpha = Math.min(0.25, opts.hit * 0.25);
    ui.circle(0, -10, 100, '#ffffff');
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (opts.stunned) ui.text('眩晕中', cx, cy - 160 * s, { size: 26, bold: true, color: C.gold, align: 'center' });
}
