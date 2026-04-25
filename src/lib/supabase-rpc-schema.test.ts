import { describe, expect, it } from 'vitest';

import { isSupabaseRpcMissingOrStaleSchema } from './supabase-rpc-schema';

describe('isSupabaseRpcMissingOrStaleSchema', () => {
  it('detects PostgREST schema cache / missing RPC messages', () => {
    expect(
      isSupabaseRpcMissingOrStaleSchema(
        'could not find the function public.ledger_meeting_create(p_doc, p_host_app_user_id) in the schema cache',
      ),
    ).toBe(true);
    expect(isSupabaseRpcMissingOrStaleSchema('Schema cache')).toBe(true);
    expect(isSupabaseRpcMissingOrStaleSchema('PGRST202: something')).toBe(true);
    expect(isSupabaseRpcMissingOrStaleSchema('duplicate key value violates unique constraint')).toBe(false);
  });
});
