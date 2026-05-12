const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ymdFromDateLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function hmFromDateLocal(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function dateFromYmdLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  const d = new Date(y, mo - 1, da, 0, 0, 0, 0);
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
  return d;
}

export function formatYmdWithKoWeekday(ymd: string): string {
  const raw = ymd.trim();
  const d = dateFromYmdLocal(raw);
  if (!d) return raw;
  return `${raw}(${WEEKDAY_KO[d.getDay()]})`;
}

export function formatDateWithKoWeekday(d: Date): string {
  return formatYmdWithKoWeekday(ymdFromDateLocal(d));
}

export function formatDateTimeWithKoWeekday(d: Date): string {
  return `${formatDateWithKoWeekday(d)} ${hmFromDateLocal(d)}`;
}

export function formatYmdHmWithKoWeekday(ymd: string, hm?: string | null, separator = ' '): string {
  const date = formatYmdWithKoWeekday(ymd);
  const time = (hm ?? '').trim();
  if (!date) return time;
  return time ? `${date}${separator}${time}` : date;
}
