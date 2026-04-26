import { appSchema } from '@nozbe/watermelondb';

/**
 * 테이블을 추가할 때 `tableSchema`로 정의하고 `version`을 올리세요.
 * @see https://watermelondb.dev/docs/Schema
 */
export const schema = appSchema({
  version: 1,
  tables: [],
});
