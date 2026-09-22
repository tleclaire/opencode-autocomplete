import type { HistoryEntry } from "./history"

/** Default cap for the history preview shown on the suggestion line. */
export const DEFAULT_PREVIEW_CHARS = 100

const limitOrDefault = (maxChars: number): number =>
  Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_PREVIEW_CHARS

/**
 * Shorten a history entry for display on the suggestion line.
 *
 * History contains pasted blobs (whole mails, code blocks) that can be several
 * kilobytes and dozens of lines. Writing those verbatim into the suggestion
 * line floods the layout: the line lives in a box with `flexShrink: 0`, so it
 * grows with its content instead of being clipped.
 *
 * The preview therefore shows the FIRST line only, collapsed to single spaces
 * and capped at `maxChars`, plus a hint how many further lines the entry
 * spans (`(+N lines)`). This is display-only — accepting a suggestion still
 * inserts the full, unmodified entry text.
 */
export function previewOf(entry: HistoryEntry, maxChars: number = DEFAULT_PREVIEW_CHARS): string {
  const limit = limitOrDefault(maxChars)
  const lines = entry.text.split(/\r?\n/)
  const head = lines[0].replace(/\s+/g, " ").trim()
  // Spread by code points so a surrogate pair (emoji) is never cut in half.
  const clipped = head.length > limit ? [...head].slice(0, limit).join("").trimEnd() + "…" : head
  const furtherLines = lines.length - 1
  return furtherLines > 0 ? `${clipped} (+${furtherLines} lines)` : clipped
}
