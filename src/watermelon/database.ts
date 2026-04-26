import { Platform } from 'react-native';
import { Database } from '@nozbe/watermelondb';

import { schema } from './schema';

function createNativeDatabase(): Database {
  // 웹 번들에서 네이티브 SQLite를 끌어오지 않도록 require는 이 함수 안에만 둡니다.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SQLiteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default;
  const adapter = new SQLiteAdapter({
    schema,
    dbName: 'ginit',
    jsi: true,
  });
  return new Database({
    adapter,
    modelClasses: [],
  });
}

/** iOS/Android에서만 인스턴스가 있고, 웹에서는 `null`입니다. */
export const database: Database | null =
  Platform.OS === 'web' ? null : createNativeDatabase();
