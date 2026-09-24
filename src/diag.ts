import { createWriteStream, type WriteStream } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Opt-in diagnostics for the autocomplete plugin.
 *
 * Nothing is recorded or written unless `configure({ debug: true })` ran
 * (the TUI entry calls it as its first act). When enabled:
 *
 *  - every event line is timestamped with the module instance id,
 *  - `span(name)` measures wall-clock ms around critical sections,
 *  - rolling counters (poll, match, history loads, renders) are flushed as a
 *    summary line every SUMMARY_MS so slow paths show up as numbers, not as
 *    a haystack of individual lines.
 *
 * Diagnostics must never break the plugin: every write is wrapped in try/catch.
 */

const DIAG_FILE = join(tmpdir(), "opencode-autocomplete-diag.log")
const SUMMARY_MS = 5_000

// Distinct per module evaluation: two entries with different values mean the
// module was loaded twice (e.g. via two differently-normalised paths).
const moduleInstance = Math.random().toString(36).slice(2, 8)

let enabled = false
let summaryTimer: ReturnType<typeof setInterval> | undefined
// Async append stream: appendFileSync blocks the event loop on every log
// line — with debug on that cost landed on each keystroke. Buffered writes
// go to the kernel instead; errors are swallowed (diagnostics never throw).
let logStream: WriteStream | undefined

const getStream = (): WriteStream | undefined => {
  if (logStream) return logStream
  try {
    logStream = createWriteStream(DIAG_FILE, { flags: "a" })
    logStream.on("error", () => {
      logStream = undefined
    })
    return logStream
  } catch {
    return undefined
  }
}

// Rolling stats for the summary line. `sum`/`max`/`n` are per window and
// reset with each flush so a one-off spike and a sustained regression are
// distinguishable.
type Stat = { n: number; sum: number; max: number }
const newStat = (): Stat => ({ n: 0, sum: 0, max: 0 })

const stats = {
  poll: newStat(),
  match: newStat(),
  history: newStat(),
  historyEntries: 0,
  render: 0,
}

const observe = (stat: Stat, ms: number) => {
  stat.n++
  stat.sum += ms
  if (ms > stat.max) stat.max = ms
}

const fmtStat = (label: string, stat: Stat): string =>
  `${label}=${stat.n} avg=${stat.n ? (stat.sum / stat.n).toFixed(2) : "0"} max=${stat.max.toFixed(2)}ms`

const flushSummary = () => {
  if (!enabled) return
  const { poll, match, history, historyEntries, render } = stats
  if (!poll.n && !match.n && !history.n && !render) return
  write(
    `summary ${fmtStat("poll", poll)} | ${fmtStat("matchAll", match)} | ` +
      `${fmtStat("history", history)} entries=${historyEntries} | renders=${render}`,
  )
  stats.poll = newStat()
  stats.match = newStat()
  stats.history = newStat()
  stats.render = 0
}

const write = (message: string) => {
  if (!enabled) return
  try {
    getStream()?.write(`${new Date().toISOString()} [${moduleInstance}] ${message}\n`)
  } catch {
    // diagnostics must never break the plugin
  }
}

/** Enable diagnostics and start the summary flusher. Idempotent. */
export function configure(options: { debug?: boolean } | undefined): void {
  enabled = options?.debug === true
  if (!enabled || summaryTimer) return
  summaryTimer = setInterval(flushSummary, SUMMARY_MS)
  // Never keep a process alive just for diagnostics.
  summaryTimer.unref?.()
}

export const isEnabled = (): boolean => enabled

/** Plain event log line (no-op when disabled). */
export const diag = (message: string): void => {
  write(message)
}

/**
 * Start a timed section. Returns an end function that logs
 * `<name> <ms>ms [extra]` — cheap enough to call unconditionally; when
 * diagnostics are off it is a no-op that still returns 0.
 *
 *   const end = span("loadHistory")
 *   const entries = loadHistory()
 *   end(`entries=${entries.length}`)
 */
export function span(name: string): (extra?: string) => number {
  if (!enabled) return () => 0
  const t0 = performance.now()
  let ended = false
  return (extra?: string): number => {
    if (ended) return 0
    ended = true
    const ms = performance.now() - t0
    write(`${name} ${ms.toFixed(2)}ms${extra ? ` ${extra}` : ""}`)
    return ms
  }
}

/** Record one poll-tick duration into the summary stats. */
export const observePoll = (ms: number): void => {
  if (enabled) observe(stats.poll, ms)
}

/** Record one matchAll() run into the summary stats. */
export const observeMatch = (ms: number): void => {
  if (enabled) observe(stats.match, ms)
}

/** Record one history load into the summary stats. */
export const observeHistory = (ms: number, entries: number): void => {
  if (!enabled) return
  observe(stats.history, ms)
  stats.historyEntries = entries
}

/** Count a suggestion-line write. */
export const countRender = (): void => {
  if (enabled) stats.render++
}
