import type { LatLng } from '@/src/lib/geo-distance';

/**
 * Open-Meteo(키 없음) 현재 날씨 → 모임 제목용 짧은 한국어 수식어.
 * 실패 시 null.
 */
export async function fetchTitleWeatherMood(coords: LatLng, timeoutMs = 5000): Promise<string | null> {
  const { latitude, longitude } = coords;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(latitude))}&longitude=${encodeURIComponent(String(longitude))}&current=temperature_2m,weather_code&timezone=Asia%2FSeoul`;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number };
      };
      const code = data?.current?.weather_code;
      if (code == null || Number.isNaN(Number(code))) return null;
      const temp = typeof data?.current?.temperature_2m === 'number' ? data.current.temperature_2m : undefined;
      return wmoCodeToTitleMood(Number(code), temp);
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

/** WMO Weather interpretation codes (Open-Meteo) — 짧은 수식어만 */
function wmoCodeToTitleMood(code: number, tempC?: number): string {
  let sky: string;
  if (code === 0) sky = '맑은';
  else if (code === 1) sky = '대체로 맑은';
  else if (code === 2) sky = '구름 낀';
  else if (code === 3) sky = '흐린';
  else if (code >= 45 && code <= 48) sky = '안개 낀';
  else if (code >= 51 && code <= 57) sky = '이슬비';
  else if (code >= 61 && code <= 67) sky = '비 오는';
  else if (code >= 71 && code <= 77) sky = '눈 내리는';
  else if (code >= 80 && code <= 82) sky = '소나기';
  else if (code >= 95) sky = '천둥·번개';
  else sky = '';

  if (typeof tempC === 'number') {
    if (tempC <= 2) return sky ? `${sky}·매우 추운` : '매우 추운';
    if (tempC <= 8) return sky ? `${sky}·쌀쌀한` : '쌀쌀한';
    if (tempC >= 30) return sky ? `${sky}·무더운` : '무더운';
    if (tempC >= 24) return sky ? `${sky}·따뜻한` : '따뜻한';
  }

  return sky || '오늘';
}
