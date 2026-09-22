import { Database } from "bun:sqlite"
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

export type HistoryEntry = {
  text: string
  time: number
}

const MAX_ENTRIES = 2000
const MIN_LENGTH = 4
const DB_FILE = "opencode.db"

/**
 * opencode resolves its data directory XDG-style on *every* platform — its own
 * path module has no per-OS branch:
 *
 *   XDG_DATA_HOME || <homedir>/.local/share    then  /opencode
 *
 * That includes Windows (`%USERPROFILE%\.local\share\opencode`) and macOS (it
 * does not use `~/Library/Application Support`). `os.homedir()` is the portable
 * primitive — `process.env.HOME` is unset on Windows.
 */
export function dataDir(): string {
  const xdg = process.env.XDG_DATA_HOME?.trim()
  const base = xdg ? xdg : join(homedir(), ".local", "share")
  return join(base, "opencode")
}

/**
 * Prefer `opencode.db`; non-standard release channels store the database as
 * `opencode-<channel>.db` instead (see opencode's own DB resolution).
 */
const existingDbIn = (dir: string): string | undefined => {
  const preferred = join(dir, DB_FILE)
  if (existsSync(preferred)) return preferred
  try {
    const candidates = readdirSync(dir)
      .filter((name) => /^opencode-.*\.db$/.test(name))
      .sort()
    const last = candidates[candidates.length - 1]
    if (last) return join(dir, last)
  } catch {
    // directory missing or unreadable — fall through to the default path
  }
  return undefined
}

/**
 * Path of opencode's SQLite database.
 *
 * `OPENCODE_DB` takes precedence, mirroring opencode's own resolution:
 * `:memory:`, an absolute path, or a file name relative to the data directory.
 */
export function databasePath(): string {
  const override = process.env.OPENCODE_DB?.trim()
  if (override) {
    if (override === ":memory:") return override
    return isAbsolute(override) ? override : join(dataDir(), override)
  }
  return existingDbIn(dataDir()) ?? join(dataDir(), DB_FILE)
}

type Row = { text: string | null; time: number }

/**
 * Load recent user prompts from the opencode SQLite database.
 * Read-only access alongside the running server (WAL mode) is fine
 * for a same-user, same-machine reader.
 */
export function loadHistory(): HistoryEntry[] {
  let db: Database
  try {
    db = new Database(databasePath(), { readonly: true })
  } catch {
    return []
  }

  try {
    const rows = db
      .query(
        `SELECT json_extract(p.data, '$.text') AS text, m.time_created AS time
         FROM message m
         JOIN part p ON p.message_id = m.id
         WHERE json_extract(m.data, '$.role') = 'user'
           AND json_extract(p.data, '$.type') = 'text'
         ORDER BY m.time_created DESC
         LIMIT ${MAX_ENTRIES * 2}`,
      )
      .all() as Row[]

    const seen = new Set<string>()
    const out: HistoryEntry[] = []
    for (const row of rows) {
      const text = (row.text ?? "").trim()
      if (text.length < MIN_LENGTH || seen.has(text)) continue
      seen.add(text)
      out.push({ text, time: row.time })
      if (out.length >= MAX_ENTRIES) break
    }
    return out
  } catch {
    return []
  } finally {
    db.close()
  }
}

/**
 * Find the best history match for the current input.
 * Preference: prefix match (newest first), then substring match.
 * Never returns the input itself.
 */
export function bestMatch(input: string, entries: HistoryEntry[]): HistoryEntry | undefined {
  const value = input.trim()
  if (value.length < MIN_LENGTH) return undefined
  const lower = value.toLowerCase()

  let prefix: HistoryEntry | undefined
  let substring: HistoryEntry | undefined

  // Entries are newest-first; first hit wins ties.
  for (const entry of entries) {
    const text = entry.text
    if (text === value) continue
    const entryLower = text.toLowerCase()
    if (!prefix && entryLower.startsWith(lower)) {
      prefix = entry
    } else if (!substring && entryLower.includes(lower)) {
      substring = entry
    }
    if (prefix) break
  }

  return prefix ?? substring
}
