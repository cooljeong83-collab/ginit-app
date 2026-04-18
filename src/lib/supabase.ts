import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { publicEnv } from '@/src/config/public-env';

const supabaseUrl = publicEnv.supabaseUrl;
const supabaseAnonKey = publicEnv.supabaseAnonKey;

if (__DEV__ && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    '[supabase] env/.env의 SUPABASE_URL·SUPABASE_ANON_KEY(또는 expo.extra)가 비어 있습니다.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
