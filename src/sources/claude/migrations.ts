import { columnNames, tableExists } from "../../core/db";
import type { Migration } from "../../core/types";

export const claudeMigrations: Migration[] = [
  {
    // Baseline. Databases from before the foundation refactoring had unprefixed tables
    // (`sessions`, `imported_files`, `events`) and canvas columns on `sessions`; they are moved over here.
    version: 1,
    up(db) {
      if (tableExists(db, "sessions")) {
        db.exec(`ALTER TABLE sessions RENAME TO claude_sessions`);
        const cols = columnNames(db, "claude_sessions");
        for (const c of ["ai_title", "custom_title"]) if (!cols.has(c)) db.exec(`ALTER TABLE claude_sessions ADD COLUMN ${c} TEXT`);
        // Canvas state moves to the core's elements table (ADR-0008).
        if (cols.has("pos_x") || cols.has("archived_at")) {
          const x = cols.has("pos_x") ? "pos_x" : "NULL";
          const y = cols.has("pos_y") ? "pos_y" : "NULL";
          const a = cols.has("archived_at") ? "archived_at" : "NULL";
          db.exec(`
            INSERT INTO elements (id, ref, x, y, archived_at, updated_at)
            SELECT 'session:claude/' || id, 'session:claude/' || id, ${x}, ${y}, ${a}, updated_at
            FROM claude_sessions WHERE ${x} IS NOT NULL OR ${a} IS NOT NULL
            ON CONFLICT(id) DO NOTHING;
          `);
          for (const c of ["pos_x", "pos_y", "archived_at"]) if (cols.has(c)) db.exec(`ALTER TABLE claude_sessions DROP COLUMN ${c}`);
        }
        db.exec(`UPDATE claude_sessions SET status = 'inactive' WHERE status IN ('history', 'ended')`);
      } else {
        db.exec(`
          CREATE TABLE claude_sessions (
            id TEXT PRIMARY KEY, cwd TEXT, git_root TEXT, branch TEXT,
            status TEXT NOT NULL DEFAULT 'idle', title TEXT, ai_title TEXT, custom_title TEXT,
            last_message TEXT, transcript_path TEXT, acknowledged INTEGER NOT NULL DEFAULT 1,
            started_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          )`);
      }
      if (tableExists(db, "imported_files")) db.exec(`ALTER TABLE imported_files RENAME TO claude_imported_files`);
      else db.exec(`CREATE TABLE claude_imported_files (path TEXT PRIMARY KEY, mtime REAL NOT NULL, size INTEGER NOT NULL)`);
      if (tableExists(db, "events")) {
        db.exec(`
          INSERT INTO event_log (source, type, ref, payload, at)
          SELECT 'claude', 'hook.' || type, 'session:claude/' || session_id, payload, at FROM events;
          DROP TABLE events;
        `);
      }
    },
  },
  {
    // Where a session works (ADR-0017): the top of its checkout when that is a worktree, else NULL (main checkout).
    version: 2,
    up: (db) => db.exec(`ALTER TABLE claude_sessions ADD COLUMN work_tree TEXT`),
  },
  {
    // The pending permission question from the PermissionRequest hook, shown read-only on the board.
    version: 3,
    up: (db) => db.exec(`ALTER TABLE claude_sessions ADD COLUMN question TEXT`),
  },
  {
    // Branches a session worked on itself (ADR-0024). Existing sessions are filled from their transcripts at start.
    version: 4,
    up: (db) => db.exec(`ALTER TABLE claude_sessions ADD COLUMN own_branches TEXT`),
  },
  {
    // Why a waiting session waits (ADR-0027): permission, question or plan; and the progress of its task list (JSON).
    version: 5,
    up: (db) => db.exec(`ALTER TABLE claude_sessions ADD COLUMN question_kind TEXT; ALTER TABLE claude_sessions ADD COLUMN progress TEXT`),
  },
  {
    // The tool a permission prompt asks for (JSON name + input): only its PostToolUse ends the wait, not a parallel tool's.
    version: 6,
    up: (db) => db.exec(`ALTER TABLE claude_sessions ADD COLUMN pending_tool TEXT`),
  },
];
