import type { GameConfig, SpecialStageDef } from './config';
import type { EnemyDef, RuneType } from './types';

export interface StageInfo {
  /** 1-based 关卡序号 */
  index: number;
  chapter: number;
  stageInChapter: number;
  label: string;
  kind: 'normal' | 'chapterBoss' | 'miniBoss' | 'tutorialBoss';
  name: string;
  weakness: RuneType[] | null;
  tendency: string | null;
  factor: number;
  requiredPower: number;
  hammers: number;
  gold: number;
}

export function totalStages(cfg: GameConfig): number {
  return cfg.stages.chapters * cfg.stages.stagesPerChapter;
}

/** 到达“已通关 n 关”时的免费中位战力（分段线性插值）。 */
export function medianPowerAt(cfg: GameConfig, clearedStages: number): number {
  const curve = cfg.stages.powerCurve;
  if (clearedStages <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    const [x0, y0] = curve[i - 1];
    if (clearedStages <= x1) return y0 + ((y1 - y0) * (clearedStages - x0)) / (x1 - x0);
  }
  const [xa, ya] = curve[curve.length - 2];
  const [xb, yb] = curve[curve.length - 1];
  return yb + ((yb - ya) * (clearedStages - xb)) / (xb - xa);
}

function special(cfg: GameConfig, index: number): SpecialStageDef | undefined {
  return cfg.stages.specialStages.find((s) => s.stage === index);
}

export function stageInfo(cfg: GameConfig, index: number): StageInfo {
  const sc = cfg.stages;
  const per = sc.stagesPerChapter;
  const chapter = Math.floor((index - 1) / per) + 1;
  const stageInChapter = ((index - 1) % per) + 1;
  const label = `${chapter}-${stageInChapter}`;
  const total = totalStages(cfg);
  const sp = special(cfg, index);
  const isChapterBoss = stageInChapter === per;
  const r = sc.rewards;

  let kind: StageInfo['kind'] = 'normal';
  let name = sc.normalEnemyNames[(index * 7 + chapter) % sc.normalEnemyNames.length];
  let weakness: RuneType[] | null = null;
  let tendency: string | null = null;
  const t = total > 1 ? (index - 1) / (total - 1) : 0;
  const withinChapter = (stageInChapter - 1) / Math.max(1, per - 2);
  let factor = sc.normalFactor.start + (sc.normalFactor.end - sc.normalFactor.start) * Math.min(1, withinChapter * 0.6 + t * 0.4);

  if (isChapterBoss) {
    const boss = sc.chapterBosses[(chapter - 1) % sc.chapterBosses.length];
    kind = 'chapterBoss';
    name = boss.name;
    weakness = boss.weakness;
    tendency = boss.tendency;
    factor = sc.bossFactor[(chapter - 1) % sc.bossFactor.length];
  } else if (sp) {
    kind = sp.kind;
    name = sp.name;
    weakness = sp.weakness;
    if (sp.factor !== undefined) factor = sp.factor;
  }

  const requiredPower = medianPowerAt(cfg, index - 1) * factor;
  let hammers = 0;
  if (isChapterBoss) hammers = r.bossHammers;
  else if (index <= r.earlyStageCount) hammers = r.earlyHammers;
  else if (index % 2 === 0) hammers = r.evenStageHammers;
  const gold = Math.round(r.goldBase + r.goldPerStage * index);

  return { index, chapter, stageInChapter, label, kind, name, weakness, tendency, factor, requiredPower, hammers, gold };
}

export function enemyFromPower(
  cfg: GameConfig,
  power: number,
  boss: boolean,
  name: string,
  weakness: RuneType[] | null,
  tendency: string | null = null,
): EnemyDef {
  const st = boss ? cfg.stages.bossStats : cfg.stages.normalStats;
  return {
    name,
    hp: Math.round(power * st.hpPerPower),
    atk: Math.round(power * st.atkPerPower),
    def: 0,
    speed: st.speed,
    actEvery: st.actEvery,
    weakness,
    isBoss: boss,
    tendency: tendency ?? undefined,
  };
}

export function stageEnemy(cfg: GameConfig, info: StageInfo, scaleOverride?: number): EnemyDef {
  const boss = info.kind !== 'normal';
  const power = scaleOverride !== undefined ? scaleOverride : info.requiredPower;
  return enemyFromPower(cfg, power, boss, info.name, info.weakness, info.tendency);
}
