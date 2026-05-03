import type { AgentWeatherMood } from '@/src/lib/agentic-guide/types';

export function wmoCodeToAgentWeatherMood(code: number): AgentWeatherMood {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'clear';
  if (code === 3) return 'cloudy';
  if (code >= 45 && code <= 48) return 'cloudy';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 95) return 'rain';
  if (code >= 1 && code <= 3) return 'cloudy';
  return 'wind';
}
