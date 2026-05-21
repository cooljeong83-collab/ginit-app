import { describe, expect, it } from 'vitest';

import {
  buildMeetingFlowHref,
  readReturnToFromParams,
  sanitizeMeetingFlowReturnTo,
} from '@/src/lib/meeting-flow-navigation';

const SAMPLE_ID = 'a1b2c3d4-e5f6-4789-a012-3456789abcde';

describe('meeting-flow-navigation', () => {
  it('sanitizeMeetingFlowReturnTo allows tabs and meeting paths', () => {
    expect(sanitizeMeetingFlowReturnTo('/(tabs)')).toBe('/(tabs)');
    expect(sanitizeMeetingFlowReturnTo('/(tabs)/chat')).toBe('/(tabs)/chat');
    expect(sanitizeMeetingFlowReturnTo(`/meeting/${SAMPLE_ID}`)).toBe(`/meeting/${SAMPLE_ID}`);
    expect(sanitizeMeetingFlowReturnTo(`/meeting-chat/${SAMPLE_ID}`)).toBe(
      `/meeting-chat/${SAMPLE_ID}`,
    );
  });

  it('sanitizeMeetingFlowReturnTo rejects open redirects', () => {
    expect(sanitizeMeetingFlowReturnTo('https://evil.example')).toBe('/(tabs)');
    expect(sanitizeMeetingFlowReturnTo('/admin')).toBe('/(tabs)');
    expect(sanitizeMeetingFlowReturnTo(`/meeting/not-a-uuid`)).toBe('/(tabs)');
  });

  it('readReturnToFromParams reads array param', () => {
    expect(
      readReturnToFromParams({ returnTo: [`/meeting/${SAMPLE_ID}`] }, '/(tabs)'),
    ).toBe(`/meeting/${SAMPLE_ID}`);
  });

  it('buildMeetingFlowHref embeds returnTo param', () => {
    const href = buildMeetingFlowHref(
      { kind: 'meeting-review', meetingId: SAMPLE_ID },
      '/(tabs)',
    );
    expect(href).toMatchObject({
      pathname: `/meeting-review/${encodeURIComponent(SAMPLE_ID)}`,
      params: { returnTo: '/(tabs)' },
    });
  });
});
