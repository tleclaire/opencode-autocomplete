import { appendFile, mkdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export type HistoryEntry = {
  text: string
  time: number
}

const MAX_ENTRIES = 5000
const MIN_LENGTH = 4

export function historyFilePath(configDir: string): string {
  return join(configDir, "autocomplete-history.jsonl")
}

export async function appendHistory(configDir: string, text: string): Promise<void> {
  const trimmed = text.trim()
  if (trimmed.length < MIN_LENGTH) return
  const file = historyFilePath(configDir)
  await mkdir(dirname(file), { recursive: true })
  const line = JSON.stringify({ text: trimmed, time: Date.now() }) + "\n"
  await appendFile(file, line, "utf8")
}

export async function loadHistory(configDir: string): Promise<HistoryEntry[]> {
  let raw: string
  try {
    raw = await readFile(historyFilePath(configDir), "utf8")
  } catch {
    return []
  }
  const entries: HistoryEntry[] = []
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as HistoryEntry
      if (typeof parsed.text === "string" && typeof parsed.time === "number") {
        entries.push({ text: parsed.text, time: parsed.time })
      }
    } catch {
      // skip malformed lines
    }
  }
  return entries.slice(-MAX_ENTRIES)
}

/**
 * Find the best history match for the current input.
 * Preference: exact prefix match (longest history entry first), then substring match.
 * Never returns the input itself.
 */
export function bestMatch(
  input: string,
  entries: HistoryEntry[],
): HistoryEntry | undefined {
  const value = input.trim()
  if (value.length < MIN_LENGTH) return undefined
  const lower = value.toLowerCase()

  let prefix: HistoryEntry | undefined
  let substring: HistoryEntry | undefined

  // Newest entries win ties: iterate from the end.
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!
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
