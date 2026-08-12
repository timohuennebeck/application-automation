import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrate';

/* Opens (or creates) the database and brings it to the current schema.
   WAL only applies to real files; :memory: databases reject it. */
export function openDb(filePath: string): DatabaseSync {
  const db = new DatabaseSync(filePath);
  if (filePath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}
