import { createSignal, Show } from "solid-js"
import { existsSync } from "node:fs"
import { bestMatch, databasePath, loadHistory, matchAll, type HistoryEntry } from "./history"
import { DEFAULT_PREVIEW_CHARS, previewOf } from "./preview"
import { configure as configureDiag, countRender, diag, observeHistory, observeMatch, observePoll, span } from "./diag"

// OpenCode V2 TUI plugin.
//
// Ported from the V1 implementation (`tui: async (api, options) => {...}`), which
// cannot load in V2: V1 registered `home_prompt` / `session_prompt` slot
// overrides that re-rendered the host's own Prompt component, and read the
// prompt text through `api.renderer.currentFocusedEditor`.
//
// V2 shape:
//   { id, setup(context) }                 instead of { id, tui }
//   context.ui.slot({ append: "prompt.footer", render })
//   context.keymap.layer(() => ({ commands }))
//   context.options                          instead of the second argument
//
// What stays identical on purpose:
//   • the 50ms poll of `renderer.currentFocusedEditor.plainText` — V2's TUI
//     context exposes no prompt-text API, and the renderer is the same OpenTUI
//     renderer, so this remains the only way to see what is being typed.
//   • history loading/matching (history.ts) and the preview formatting
//     (preview.ts) — unchanged and untyped against the host.
//
// The suggestion is appended to `prompt.footer` instead of replacing the prompt.
// That loses the V1 "own the prompt component" trick but needs no host refs, so
// there is nothing to tear down when a view unmounts.

const id = "opencode-autocomplete"
const PROMPT_SYNC_MS = 50
const MIN_INPUT_LENGTH = 4

export type AutocompleteOptions = {
  /** Master switch. Set to false to disable the plugin entirely. Default: true */
  enabled?: boolean
  /** Key that accepts the suggestion. Default: "tab" */
  acceptKey?: string
  /** Key that cycles forward through multiple matches. Default: "ctrl+down" */
  cycleKey?: string
  /** Key that cycles backward through multiple matches. Default: "ctrl+up" */
  cycleKeyBack?: string
  /**
   * Cap for the history preview on the suggestion line: first line only,
   * truncated with `…`, multi-line entries annotated `(+N lines)`.
   * Display-only — accepting still inserts the full entry. Default: 100
   */
  maxPreviewChars?: number
  /** Full instrumentation to `%TEMP%/opencode-autocomplete-diag.log`. Default: false */
  debug?: boolean
}

// --- shared state ---------------------------------------------------------
// One slot and one poller per process, whatever happens to module evaluation
// or a plugin reload. The previous instance is disposed before a new one
// registers, so a reload cannot leave a stale line behind or stack two of them.
type Registry = { loads: number; dispose?: () => void }
const registryKey = "__opencodeAutocompleteRegistry"
const registry = ((globalThis as unknown as Record<string, Registry>)[registryKey] ??= {
  loads: 0,
})

let runtimeEnabled = true
let previewChars: number = DEFAULT_PREVIEW_CHARS
let entries: HistoryEntry[] = []
let matches: HistoryEntry[] = []
let matchIndex = 0
let dismissedInput = ""
let lastInput = ""

// Reactive only for the footer line; everything else is imperative because the
// poller runs outside a Solid computation.
const [label, setLabel] = createSignal("")

type Editor = {
  plainText?: string
  setText?(text: string): void
  gotoBufferEnd?(): void
}

type TuiContext = {
  app?: { version?: string }
  options?: AutocompleteOptions
  renderer: {
    currentFocusedEditor?: Editor
    keyInput?: { prependListener(event: string, fn: (evt: unknown) => void): void; removeListener(event: string, fn: (evt: unknown) => void): void }
  }
  theme?: { text?: Record<string, string> }
  ui: {
    slot(definition: { append?: string; prepend?: string; render: () => unknown }): (() => void) | void
  }
  keymap: {
    layer(factory: () => {
      mode: string
      priority?: number
      commands: Array<{
        id: string
        title?: string
        group?: string
        bind?: string
        palette?: boolean
        enabled?: () => boolean
        run: (input?: string) => unknown
      }>
      bindings?: string[]
    }): unknown
  }
}

const editor = (ctx: TuiContext): Editor | undefined => ctx.renderer?.currentFocusedEditor
const focusedText = (ctx: TuiContext): string => {
  const value = editor(ctx)?.plainText
  return typeof value === "string" ? value : ""
}

const compute = (value: string): HistoryEntry[] => {
  if (value.length < MIN_INPUT_LENGTH) return []
  if (dismissedInput === value) return []
  const t0 = performance.now()
  const result = matchAll(value, entries)
  const ms = performance.now() - t0
  observeMatch(ms)
  diag(`matchAll ${ms.toFixed(2)}ms input="${value.slice(0, 60)}" matches=${result.length}`)
  return result
}

const currentLabel = (): string => {
  const match = matches[matchIndex]
  if (!match) return ""
  const preview = previewOf(match, previewChars)
  return matches.length > 1 ? `⇥ (${matchIndex + 1}/${matches.length}) ${preview}` : `⇥ ${preview}`
}

const paint = () => {
  const text = currentLabel()
  if (label() === text) return
  if (text) {
    setLabel(text)
    countRender()
    diag(`render suggestion="${text.slice(0, 70)}"`)
  } else {
    setLabel("")
  }
}

const poll = (ctx: TuiContext) => {
  const t0 = performance.now()
  const value = focusedText(ctx)
  const changed = value !== lastInput
  lastInput = value
  if (changed || (!runtimeEnabled && matches.length)) {
    matches = runtimeEnabled ? compute(value) : []
    matchIndex = 0
    paint()
  }
  const ms = performance.now() - t0
  observePoll(ms)
  if (changed && value) diag(`poll changed len=${value.length} took=${ms.toFixed(2)}ms`)
  else if (ms > 2) diag(`poll slow ${ms.toFixed(2)}ms changed=${changed}`)
}

const cycle = (delta: number): boolean => {
  if (matches.length < 2) return false
  matchIndex = (matchIndex + delta + matches.length) % matches.length
  diag(`cycle delta=${delta} -> ${matchIndex + 1}/${matches.length}`)
  paint()
  return true
}

const accept = (ctx: TuiContext): boolean => {
  const match = matches[matchIndex]
  if (!match) return false
  const endAccept = span("accept")
  const ed = editor(ctx)
  let via = "no-editor"
  if (ed && typeof ed.setText === "function") {
    ed.setText(match.text)
    ed.gotoBufferEnd?.()
    via = "setText"
  } else {
    // Nothing to write into; keep the suggestion visible rather than lie.
    endAccept("via=no-editor result=skipped")
    return false
  }
  dismissedInput = ""
  lastInput = match.text
  matches = []
  matchIndex = 0
  paint()
  endAccept(`via=${via} text="${match.text.slice(0, 60)}"`)
  return true
}

const dismiss = () => {
  diag(`dismiss input="${lastInput.slice(0, 60)}" matches=${matches.length}`)
  dismissedInput = lastInput
  matches = []
  matchIndex = 0
  paint()
}

export default {
  id,

  setup(ctx: TuiContext) {
    const opts = (ctx.options ?? {}) as AutocompleteOptions
    configureDiag(opts)

    // Guard: this build targets V2 only. A V1 host would hand over a different
    // context shape; failing quietly is better than breaking the TUI.
    if (!ctx.ui?.slot || !ctx.keymap?.layer) {
      diag("setup skipped: host context has no ui.slot/keymap.layer (V1 host?)")
      return
    }
    if (opts.enabled === false) {
      diag("setup skipped: disabled via options")
      return
    }

    registry.loads++
    diag(`setup entry loads=${registry.loads} pid=${process.pid}`)

    // A reload must replace the previous instance, not skip registration.
    if (registry.dispose) {
      diag("setup: disposing previous instance")
      registry.dispose()
      registry.dispose = undefined
    }

    previewChars = opts.maxPreviewChars ?? DEFAULT_PREVIEW_CHARS
    runtimeEnabled = true

    const dbPath = databasePath()
    diag(`database path=${dbPath} exists=${existsSync(dbPath)}`)

    const histT0 = performance.now()
    entries = loadHistory()
    const histMs = performance.now() - histT0
    observeHistory(histMs, entries.length)
    diag(`loadHistory ${histMs.toFixed(2)}ms entries=${entries.length}`)

    // --- suggestion line ---------------------------------------------------
    // `prepend`, not `append`: the prompt footer is a status row whose own
    // content sits at the right edge, so an appended contribution lands there
    // too (observed in 2.2.0). Prepending puts the suggestion left, directly
    // under the start of the input.
    const muted = ctx.theme?.text?.muted
    const unregisterSlot = ctx.ui.slot({
      prepend: "prompt.footer",
      render: () => (
        <Show when={label()}>
          <text wrapMode="none" flexShrink={0} fg={muted}>
            {label()}
          </text>
        </Show>
      ),
    })

    // --- keys --------------------------------------------------------------
    // Returning false keeps the key going to the host binding (tab cycles the
    // agent, escape interrupts), so the bindings only fire while a suggestion
    // exists.
    ctx.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "autocomplete.accept",
          title: "Accept history suggestion",
          group: "Prompt",
          bind: opts.acceptKey ?? "tab",
          palette: true,
          enabled: () => runtimeEnabled,
          run: () => (matches.length ? accept(ctx) : false),
        },
        {
          id: "autocomplete.cycle.forward",
          title: "Next history suggestion",
          group: "Prompt",
          bind: opts.cycleKey ?? "ctrl+down",
          enabled: () => runtimeEnabled,
          run: () => (matches.length > 1 ? cycle(1) : false),
        },
        {
          id: "autocomplete.cycle.back",
          title: "Previous history suggestion",
          group: "Prompt",
          bind: opts.cycleKeyBack ?? "ctrl+up",
          enabled: () => runtimeEnabled,
          run: () => (matches.length > 1 ? cycle(-1) : false),
        },
        {
          id: "autocomplete.dismiss",
          title: "Dismiss history suggestion",
          group: "Prompt",
          bind: "escape",
          enabled: () => matches.length > 0,
          run: () => {
            if (!matches.length) return false
            dismiss()
          },
        },
        {
          id: "autocomplete.toggle",
          title: "Toggle history autocomplete",
          group: "Prompt",
          palette: true,
          run: () => {
            runtimeEnabled = !runtimeEnabled
            diag(`command autocomplete.toggle -> ${runtimeEnabled ? "on" : "off"}`)
            if (!runtimeEnabled) {
              matches = []
              matchIndex = 0
              paint()
            }
          },
        },
        {
          id: "autocomplete.accept.palette",
          title: "Accept history suggestion (palette)",
          group: "Prompt",
          palette: true,
          run: () => {
            if (!runtimeEnabled) return false
            const value = focusedText(ctx)
            if (value.length < MIN_INPUT_LENGTH || value.startsWith("/")) return false
            if (!matches.length) {
              const history = loadHistory()
              entries = history
              matches = compute(value)
              matchIndex = 0
            }
            return accept(ctx)
          },
        },
      ],
      bindings: [
        "autocomplete.accept",
        "autocomplete.cycle.forward",
        "autocomplete.cycle.back",
        "autocomplete.dismiss",
      ],
    }))

    // --- poller ------------------------------------------------------------
    const timer = setInterval(() => poll(ctx), PROMPT_SYNC_MS)
    diag(`poll started interval=${PROMPT_SYNC_MS}ms minLen=${MIN_INPUT_LENGTH}`)

    const dispose = () => {
      diag("setup cleanup")
      clearInterval(timer)
      if (typeof unregisterSlot === "function") unregisterSlot()
      setLabel("")
    }
    registry.dispose = dispose
    return dispose
  },
}
