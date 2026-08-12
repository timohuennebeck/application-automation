import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema';

function userVersion(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
}

/* Applies every migration past the database's user_version, each in its own
   transaction, and bumps user_version as it goes. Idempotent. */
export function migrate(db: DatabaseSync): void {
  for (let v = userVersion(db); v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
