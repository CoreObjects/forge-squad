/**
 * 经济节奏模拟：模拟“活跃免费玩家”，动作按真实耗时推进时间。
 * 输出首个 30 分钟每 5 分钟的战力分布，以及 D1–D14 的进度，对照 ECONOMY.md。
 * 运行：npm run sim  [-- --days 14 --seeds 20]
 */
import { firstThirtyMinutes, pct, snapshot, type Bot, type Checkpoint } from './bot';
import { defaultConfig } from '../src/core/config';

function firstRows(bot: Bot): Checkpoint[] {
  return bot.curve.filter((c) => c.minutes % 5 === 0);
}

declare const process: { argv: string[] };
const args = process.argv.slice(2);
const argNum = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const DAYS = argNum('days', 14);
const SEEDS = argNum('seeds', 20);

const TARGETS: Record<string, string> = {
  '10分': '180–220',
  '30分': '280–350',
  D1: '500–650',
  D3: '850–1100',
  D7: '1400–1800',
  D14: '2300–3200',
};

function runOne(seed: number): Checkpoint[] {
  const cfg = defaultConfig();
  const { g, clock, bot } = firstThirtyMinutes(seed, cfg);
  const rows = firstRows(bot);
  // 之后一天上线两次（早 9 点 / 晚 9 点）
  for (let day = 0; day < DAYS; day++) {
    clock.t = new Date(2026, 8, 16 + day, 9, 0, 0).getTime();
    bot.session();
    clock.t = new Date(2026, 8, 16 + day, 21, 0, 0).getTime();
    bot.session();
    if ([0, 2, 6, 13].includes(day)) rows.push(snapshot(g, `D${day + 1}`, 0));
  }
  return rows;
}

const all = Array.from({ length: SEEDS }, (_, i) => runOne(1000 + i * 7919));
console.log(`模拟 ${SEEDS} 个种子`);
console.log('检查点 | 战力 P10 / P50 / P90 | 目标 | 通关关卡 P50 | 炉级 P50 | 角色等级 P50 | 累计锻造 P50');
for (const label of all[0].map((r) => r.label)) {
  const rs = all.map((rows) => rows.find((r) => r.label === label)!);
  const powers = rs.map((r) => r.power);
  console.log(
    `${label.padEnd(5)} | ${pct(powers, 0.1)} / ${pct(powers, 0.5)} / ${pct(powers, 0.9)} | ${TARGETS[label] ?? '—'} | ${pct(rs.map((r) => r.stage), 0.5)} | ${pct(rs.map((r) => r.furnace), 0.5)} | ${pct(rs.map((r) => r.level), 0.5)} | ${pct(rs.map((r) => r.forges), 0.5)}`,
  );
}
