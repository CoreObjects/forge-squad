import { Game } from '../../core/game';
import { p0Boss, p0Chain, runP0 } from '../../core/p0';
import { hashSeed } from '../../core/rng';
import { stageInfo, totalStages } from '../../core/stages';
import { DAY, HOUR } from '../../core/time';
import { RUNE_TYPES, type RuneType } from '../../core/types';
import type { App, Scene } from '../app';
import { C, QUALITY_COLOR, RUNE_COLOR, W } from '../theme';
import type { Ui } from '../ui';
import { formatNum } from '../widgets';
import { BattleScene } from './battle';
import { drawPage } from './common';

const WEAKNESS_PRESETS: RuneType[][] = [
  ['zhen', 'feng'],
  ['ji', 'feng'],
  ['yu', 'feng'],
  ['ji', 'feng', 'feng'],
];

export class GmScene implements Scene {
  name = 'gm';
  private tab: 'main' | 'data' = 'main';

  render(app: App, ui: Ui): void {
    const g = app.game;
    const cfg = g.cfg;
    const s = g.state;
    let y = drawPage(app, ui, 'GM 测试面板');
    ui.button('gm_tab_main', 24, y - 10, 200, 56, '操作', () => (this.tab = 'main'), { fill: this.tab === 'main' ? C.accent : C.panel2, color: this.tab === 'main' ? '#1b1026' : C.text, size: 24 });
    ui.button('gm_tab_data', 236, y - 10, 200, 56, '数据', () => (this.tab = 'data'), { fill: this.tab === 'data' ? C.accent : C.panel2, color: this.tab === 'data' ? '#1b1026' : C.text, size: 24 });
    y += 66;
    if (this.tab === 'data') {
      this.renderData(app, ui, y);
      return;
    }

    const bw = 164;
    const bh = 58;
    const gap = 10;
    let col = 0;
    const row = (label: string) => {
      if (col !== 0) y += bh + gap;
      col = 0;
      ui.text(label, 30, y + 16, { size: 20, bold: true, color: C.sub });
      y += 32;
    };
    const btn = (id: string, label: string, cb: () => void, fill: string = C.panel2, color: string = C.text) => {
      if (col === 4) {
        col = 0;
        y += bh + gap;
      }
      ui.button(`gm_${id}`, 24 + col * (bw + gap), y, bw, bh, label, cb, { fill, color, size: 22, radius: 12 });
      col++;
    };

    row(`资源（锤 ${s.hammers} · 金币 ${formatNum(s.gold)} · 炉火 ${s.fireXpTotal}）`);
    btn('gold', '+1万金币', () => g.gm.addGold(10000));
    btn('gold10', '+10万金币', () => g.gm.addGold(100000));
    btn('ham', '+10锻造锤', () => g.gm.addHammers(10));
    btn('ham100', '+100锻造锤', () => g.gm.addHammers(100));

    row(`进度（炉 ${s.furnaceLevel} · 关卡 ${Math.min(s.stage.next, totalStages(cfg))} · 角色 ${s.charLevel}）`);
    btn('furn_down', '炉级 -1', () => g.gm.setFurnace(s.furnaceLevel - 1));
    btn('furn_up', '炉级 +1', () => g.gm.setFurnace(s.furnaceLevel + 1));
    btn('stage1', '关卡 +1', () => g.gm.setStage(s.stage.next + 1));
    btn('stage10', '关卡 +10', () => g.gm.setStage(s.stage.next + 10));
    btn('lv1', '角色 +1级', () => g.gm.setCharLevel(s.charLevel + 1));
    btn('lv10', '角色 +10级', () => g.gm.setCharLevel(s.charLevel + 10));
    btn('skiptut', '跳过新手', () => g.skipTutorial());
    btn('nodes', '解锁6节点', () => g.gm.unlockAllNodes());

    row(`强制下一次类型：${s.gm.forcedType ? cfg.runes.typeShort[s.gm.forcedType] : '无'}`);
    for (const t of RUNE_TYPES) btn(`type_${t}`, cfg.runes.typeNames[t], () => g.gm.forceNextType(t), RUNE_COLOR[t], '#1b1026');

    row(`强制下一次品质：${s.gm.forcedQuality !== null ? cfg.runes.qualityNames[s.gm.forcedQuality] : '无'}`);
    cfg.runes.qualityNames.forEach((n, i) => btn(`q_${i}`, n, () => g.gm.forceNextQuality(i), QUALITY_COLOR[i], '#1b1026'));
    btn('q_clear', '清除强制', () => {
      g.gm.forceNextQuality(null);
      g.gm.forceNextType(null);
    });

    const p = s.pity;
    row(`保底计数：稀有+ ${p.sinceRarePlus}/${cfg.runes.pity.rarePlusEvery} · 史诗+ ${p.sinceEpicPlus}/${cfg.runes.pity.epicPlusEvery} · 传说+ ${p.sinceLegendPlus}/${cfg.runes.pity.legendPlusEvery} · 首充 ${p.firstChargeEpicPending ? '待用' : '无'}`);
    row(`强制 Boss 破绽：${s.gm.forcedWeakness ? s.gm.forcedWeakness.map((t) => cfg.runes.typeShort[t]).join('→') : '无'}`);
    WEAKNESS_PRESETS.forEach((w, i) => btn(`weak_${i}`, w.map((t) => cfg.runes.typeShort[t]).join('→'), () => g.gm.forceWeakness(w)));
    btn('weak_clear', '清除破绽', () => g.gm.forceWeakness(null));

    row('商业化 / 时间');
    btn('monthly', '模拟月卡', () => g.gm.simulateMonthly());
    btn('clearfc', '清除首充', () => g.gm.clearFirstCharge());
    btn('t1h', '推进1小时', () => g.gm.advanceTime(HOUR));
    btn('t12h', '推进12小时', () => g.gm.advanceTime(12 * HOUR));
    btn('t1d', '推进1天', () => g.gm.advanceTime(DAY));

    row('P0 战斗验证（P0_BALANCE.md 基线）');
    btn('p0a', '无针对链', () => this.p0(app, cfg.battle.p0.plainChain));
    btn('p0b', '震→锋 链', () => this.p0(app, cfg.battle.p0.tunedChain));
    btn('reset', '重置账号', async () => {
      const ok = await app.confirm('重置账号', '清空全部进度，从新手开始。', '重置', '取消');
      if (!ok) return;
      const seed = Math.floor(Math.random() * 2 ** 31);
      g.state = Game.newState(cfg, g.now(), seed);
      g.save();
      app.popTo('main');
      g.startSession(true);
    }, '#6b2020', '#ffd0d0');
  }

  private p0(app: App, types: RuneType[]): void {
    const cfg = app.game.cfg;
    const enemy = p0Boss(cfg);
    const result = runP0(cfg, types, hashSeed('p0', Date.now()));
    const info = { ...stageInfo(cfg, 10), label: 'P0', name: enemy.name, weakness: enemy.weakness };
    app.push(
      new BattleScene({
        kind: 'daily',
        battle: { info, enemy, result, hints: [], rewards: { hammers: 0, gold: 0 }, playerChain: p0Chain(types), playerMaxHp: cfg.battle.p0.player.hp },
      }),
    );
  }

  private renderData(app: App, ui: Ui, y: number): void {
    const g = app.game;
    const s = g.state;
    const c = s.counters;
    const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '—');
    const lines = [
      `锻造 ${c.forges} 次 · 已处理 ${c.decidedRunes} 枚 · 熔炼 ${c.melts}`,
      `有效战纹率 ${pct(c.effectiveRunes, c.decidedRunes)}`,
      `推荐放置接受率 ${pct(c.recommendAccepted, c.placements)}`,
      `手动改位率（手动放入+换位 / 放置）${pct(c.manualPlacements + c.swaps, c.placements)}`,
      `非纯战力选择率 ${pct(c.nonPurePowerChoices, c.placements)}`,
      `换位 ${c.swaps} 次`,
      `卡点：${s.stuck ? `关卡 ${s.stuck.stage} 失败 ${s.stuck.fails} 次，失败后锻造 ${s.stuck.forgesSince}，调链 ${s.stuck.adjusted ? '是' : '否'}，破绽改善 ${s.stuck.weaknessImproved ? '是' : '否'}` : '无'}`,
      `新手步骤 ${s.tutorial.step}${s.tutorial.bossWeakness ? ` · 教程破绽 ${s.tutorial.bossWeakness.join('>')}` : ''}`,
      `会话 ${g.analytics.session}`,
    ];
    ui.panel(24, y, W - 48, 420);
    let ly = y + 20;
    for (const l of lines) ly += ui.wrap(l, 50, ly, W - 100, { size: 22 }) + 6;
    y += 440;
    ui.text('埋点事件计数（本次运行）', 30, y, { size: 22, bold: true, color: C.sub });
    y += 30;
    const counts = Object.entries(g.analytics.counts).sort((a, b) => b[1] - a[1]);
    counts.slice(0, 24).forEach(([name, n], i) => {
      const cx = 30 + (i % 2) * 350;
      const cy = y + Math.floor(i / 2) * 36;
      ui.text(`${name}`, cx, cy + 14, { size: 20, color: C.text });
      ui.text(String(n), cx + 320, cy + 14, { size: 20, bold: true, color: C.gold, align: 'right' });
    });
  }
}
