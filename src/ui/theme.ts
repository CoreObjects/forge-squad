import type { RuneType } from '../core/types';

export const W = 750;
export const H = 1334;

export const C = {
  bg: '#15111e',
  bg2: '#1d1729',
  panel: '#261e36',
  panel2: '#302642',
  line: '#3d3155',
  text: '#f4ecff',
  sub: '#a99bc2',
  dim: '#6d6283',
  accent: '#ff8a3d',
  accent2: '#ffb347',
  gold: '#ffd166',
  good: '#5ee08a',
  bad: '#ff5d6c',
  shield: '#7fb8ff',
  fire: '#ff6a2b',
  mask: 'rgba(8,6,14,0.72)',
};

export const RUNE_COLOR: Record<RuneType, string> = {
  feng: '#ff5d5d',
  ji: '#35d6c0',
  yu: '#5f9dff',
  zhen: '#c27bff',
};

export const QUALITY_COLOR = ['#b9b4c4', '#5fd35f', '#4aa3ff', '#b36bff', '#ffab2e', '#ff4f6e'];

export const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

export function font(size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${size}px ${FONT}`;
}
