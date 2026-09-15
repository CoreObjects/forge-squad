export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 本地日期键（考虑每日重置小时）。 */
export function dayKey(now: number, resetHour: number): string {
  const d = new Date(now - resetHour * HOUR);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

/** 本地日序号（用于 D1/D3/D7 计算、轮换）。 */
export function dayIndex(now: number, resetHour: number): number {
  const d = new Date(now - resetHour * HOUR);
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor(local / DAY);
}
