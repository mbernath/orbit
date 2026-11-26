import { Database } from "bun:sqlite";
import type { Migration } from "./types";

export function openDatabase(file: string) {
  const db = new Database(file);
  db.exec(`PRAGMA journal_mode = WAL;`);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (source TEXT PRIMARY KEY, version INTEGER NOT NULL)`);
  return db;
}

/**
 * Applies the migrations of one source (or the core) in order, each in a transaction.
 * Versions are tracked per source, so sources stay independent (ADR-0007).
 * Applied migrations must never be edited — add a new one instead.
 */
export function migrate(db: Database, source: string, migrations: Migration[]) {
  const row = db.query(`SELECT version FROM schema_migrations WHERE source = ?`).get(source) as { version: number } | null;
  let current = row?.version ?? 0;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      db.run(
        `INSERT INTO schema_migrations (source, version) VALUES (?, ?)
         ON CONFLICT(source) DO UPDATE SET version = excluded.version`,
        [source, m.version],
      );
    })();
    current = m.version;
  }
}

export const tableExists = (db: Database, name: string) =>
  !!db.query(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);

export const columnNames = (db: Database, table: string) =>
  new Set((db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
