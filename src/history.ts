import { Database } from "bun:sqlite"

export type HistoryEntry = {
  text: string
  time: number
}

const MAX_ENTRIES = 2000
const MIN_LENGTH = 4

export function databasePath(): string {
  const dataHome = process.env.XDG_DATA_HOME || `${process.env.HOME}/.local/share`
  return `${dataHome}/opencode/opencode.db`
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
