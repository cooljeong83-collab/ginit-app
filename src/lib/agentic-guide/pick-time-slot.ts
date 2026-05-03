import type { AgentTimeSlot } from '@/src/lib/agentic-guide/types';

export function pickAgentTimeSlot(now: Date = new Date()): AgentTimeSlot {
  const h = now.getHours();
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 14) return 'lunch';
  if (h >= 14 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}
