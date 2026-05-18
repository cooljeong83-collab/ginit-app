import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/src/config/public-env', () => ({
  publicEnv: { supabaseUrl: '', supabaseAnonKey: '' },
}));

import {
  collectUserConfirmedScheduleTimesByYmd,
  collectUserConfirmedScheduleYmdSet,
  type MeetingScheduleOverlapDoc,
} from './meeting-schedule-overlap';

const USER = 'user-abc';

function meeting(partial: Partial<MeetingScheduleOverlapDoc> & { id: string }): MeetingScheduleOverlapDoc {
  return {
    scheduleDate: null,
    scheduleTime: null,
    ...partial,
  };
}

describe('collectUserConfirmedScheduleYmdSet', () => {
  it('includes ymd for joined confirmed meetings', () => {
    const meetings: MeetingScheduleOverlapDoc[] = [
      meeting({
        id: 'm1',
        scheduleConfirmed: true,
        scheduleDate: '2026-05-20',
        scheduleTime: '19:00',
        createdBy: USER,
      }),
    ];
    const set = collectUserConfirmedScheduleYmdSet(meetings, USER);
    expect(set.has('2026-05-20')).toBe(true);
    expect(set.size).toBe(1);
  });

  it('excludes unconfirmed and non-joined meetings', () => {
    const meetings: MeetingScheduleOverlapDoc[] = [
      meeting({
        id: 'm1',
        scheduleConfirmed: false,
        scheduleDate: '2026-05-21',
        scheduleTime: '12:00',
        createdBy: USER,
      }),
      meeting({
        id: 'm2',
        scheduleConfirmed: true,
        scheduleDate: '2026-05-22',
        scheduleTime: '12:00',
        createdBy: 'other-user',
        participantIds: ['someone-else'],
      }),
    ];
    const set = collectUserConfirmedScheduleYmdSet(meetings, USER);
    expect(set.size).toBe(0);
  });
});

describe('collectUserConfirmedScheduleTimesByYmd', () => {
  it('maps confirmed meetings to ymd and HH:mm', () => {
    const meetings: MeetingScheduleOverlapDoc[] = [
      meeting({
        id: 'm1',
        scheduleConfirmed: true,
        scheduleDate: '2026-05-20',
        scheduleTime: '19:30',
        createdBy: USER,
      }),
    ];
    const byYmd = collectUserConfirmedScheduleTimesByYmd(meetings, USER);
    expect(byYmd['2026-05-20']).toEqual(['19:30']);
  });
});
