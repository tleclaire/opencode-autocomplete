import { useKeyboard } from "@opentui/solid"
import { onCleanup, onMount, Show } from "solid-js"
import { existsSync } from "node:fs"
import type { TuiPlugin, TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { bestMatch, databasePath, loadHistory, matchAll, type HistoryEntry } from "./history"
import { DEFAULT_PREVIEW_CHARS, previewOf } from "./preview"
import {
  configure as configureDiag,
  countRender,
  diag,
  observeHistory,
  observeMatch,
  observePoll,
  span,
} from "./diag"

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
  /**
   * Full instrumentation: lifecycle events, per-section timings (history
   * loads, matching, accepts) and a rolling summary every 5s, written to
   * `%TEMP%/opencode-autocomplete-diag.log`. Off by default. Default: false
   */
  debug?: boolean
}

// Distinct per module evaluation: recorded in every diag line (see diag.ts).
const moduleEvaluatedAt = new Date().toISOString()

// Registration state lives on globalThis, not in module scope: if opencode
// evaluates this module twice (e.g. the same origin resolved via both
// opencode.json and tui.json), a module-scope flag would be reset per instance
// and each one would mount its own prompt.
type Registry = { loads: number; registered: boolean }
const registryKey = "__opencodeAutocompleteRegistry"
const registry = ((globalThis as unknown as Record<string, Registry>)[registryKey] ??= {
  loads: 0,
  registered: false,
})

type ParsedCombo = { name: string; ctrl: boolean; shift: boolean; meta: boolean; alt: boolean }

// Runtime toggle (shared across slot instances; module scope survives remounts).
let runtimeEnabled = true
let previewChars: number = DEFAULT_PREVIEW_CHARS
let acceptKey: ParsedCombo = { name: "tab", ctrl: false, shift: false, meta: false, alt: false }
let cycleKey: ParsedCombo = { name: "down", ctrl: true, shift: false, meta: false, alt: false }
let cycleKeyBack: ParsedCombo = { name: "up", ctrl: true, shift: false, meta: false, alt: false }

const parseCombo = (spec: string | undefined, fallback: ParsedCombo): ParsedCombo => {
  if (!spec) return fallback
  const parts = spec.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return fallback
  const key = parts.pop() as string
  const combo: ParsedCombo = { name: key, ctrl: false, shift: false, meta: false, alt: false }
  for (const mod of parts) {
    if (mod === "ctrl" || mod === "control") combo.ctrl = true
    else if (mod === "shift") combo.shift = true
    else if (mod === "meta" || mod === "super" || mod === "cmd") combo.meta = true
    else if (mod === "alt" || mod === "option") combo.alt = true
  }
  // Common aliases -> opentui key names
  if (combo.name === "esc") combo.name = "escape"
  if (combo.name === "return") combo.name = "return"
  if (combo.name === "enter") combo.name = "return"
  return combo
}

const matchesCombo = (
  evt: { name?: string; ctrl?: boolean; shift?: boolean; meta?: boolean; option?: boolean },
  combo: ParsedCombo,
): boolean =>
  evt.name === combo.name &&
  Boolean(evt.ctrl) === combo.ctrl &&
  Boolean(evt.shift) === combo.shift &&
  Boolean(evt.meta) === combo.meta &&
  Boolean(evt.option) === combo.alt

/**
 * Solid's reactivity does NOT work across the plugin boundary: the plugin
 * bundles its own solid-js instance while the host TUI uses its own, so
 * signals never trigger host-side renders. Everything below therefore works
 * imperatively: a 50ms poll reads the focused editor, and the suggestion line
 * is updated by writing to the renderable directly.
 */
function PromptWithHistoryAutocomplete(props: {
  api: TuiPluginApi
  slot: string
  bindPrompt: (ref: TuiPromptRef | undefined) => void
  hostRef?: (ref: TuiPromptRef | undefined) => void
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
}) {
  let lineText: { content: string } | undefined
  const histT0 = performance.now()
  let entries: HistoryEntry[] = loadHistory()
  const histInitMs = performance.now() - histT0
  diag(`loadHistory@init ${histInitMs.toFixed(2)}ms entries=${entries.length} slot=${props.slot}`)
  observeHistory(histInitMs, entries.length)
  let matches: HistoryEntry[] = []
  let matchIndex = 0
  let dismissedInput = ""
  let lastInput = ""
  // Set on unmount. The slot is torn down whenever its view goes away (e.g. the
  // home prompt while a session is open), but timer ticks and event handlers can
  // still be in flight. Touching a disposed renderable takes down the native
  // renderer without a catchable JS error, so every write checks this first.
  let disposed = false

  const focusedText = (): string => {
    const ed = (props.api.renderer as unknown as { currentFocusedEditor?: { plainText?: string } })
      .currentFocusedEditor
    return typeof ed?.plainText === "string" ? ed.plainText : ""
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

  const label = (): string => {
    const match = matches[matchIndex]
    if (!match) return ""
    // Pasted blobs (whole mails) must never reach this line verbatim: the
    // container has flexShrink: 0 and would grow to the full entry height.
    // previewOf() is display-only — accept() still writes match.text in full.
    const preview = previewOf(match, previewChars)
    return matches.length > 1 ? `⇥ (${matchIndex + 1}/${matches.length}) ${preview}` : `⇥ ${preview}`
  }

  const render = () => {
    if (disposed || !lineText) return
    const text = label()
    if (lineText.content !== text) {
      lineText.content = text
      props.api.renderer.requestRender()
      countRender()
      if (text) diag(`render suggestion="${text.slice(0, 70)}"`)
    }
  }

  const update = () => {
    if (disposed) return
    const t0 = performance.now()
    const value = focusedText()
    const changed = value !== lastInput
    lastInput = value
    if (changed || (!runtimeEnabled && matches.length)) {
      matches = runtimeEnabled ? compute(value) : []
      matchIndex = 0
      render()
    }
    const ms = performance.now() - t0
    observePoll(ms)
    // Only log individual ticks when something happened or the tick was slow;
    // a line per 50ms tick would drown everything else.
    if (changed && value) diag(`poll changed len=${value.length} took=${ms.toFixed(2)}ms`)
    else if (ms > 2) diag(`poll slow ${ms.toFixed(2)}ms changed=${changed}`)
  }

  // Keep the line in sync even when the poll misses (e.g. history refresh).
  // The subscription MUST be released on unmount — an orphaned handler keeps
  // writing into a renderable that no longer exists.
  const unsubscribeIdle = props.api.event.on("session.idle", () => {
    if (disposed) return
    const endIdle = span("loadHistory@idle")
    entries = loadHistory()
    observeHistory(endIdle(`entries=${entries.length}`), entries.length)
    matches = runtimeEnabled ? compute(lastInput) : []
    matchIndex = 0
    render()
  })

  const cycle = (delta: number): boolean => {
    if (matches.length < 2) return false
    matchIndex = (matchIndex + delta + matches.length) % matches.length
    diag(`cycle delta=${delta} -> ${matchIndex + 1}/${matches.length}`)
    render()
    props.api.renderer.requestRender()
    return true
  }

  const accept = (): boolean => {
    const match = matches[matchIndex]
    if (!match || disposed) return false
    const endAccept = span("accept")
    const ed = (
      props.api.renderer as unknown as { currentFocusedEditor?: { setText(t: string): void; gotoBufferEnd(): void } }
    ).currentFocusedEditor
    let via = "promptRef"
    if (ed && typeof ed.setText === "function") {
      ed.setText(match.text)
      ed.gotoBufferEnd()
      via = "setText"
    } else {
      currentPromptRef?.set({ input: match.text, mode: currentPromptRef.current.mode, parts: [] })
    }
    dismissedInput = ""
    lastInput = match.text
    matches = []
    matchIndex = 0
    render()
    props.api.renderer.requestRender()
    endAccept(`via=${via} text="${match.text.slice(0, 60)}"`)
    return true
  }

  let currentPromptRef: TuiPromptRef | undefined
  const bind = (ref: TuiPromptRef | undefined) => {
    currentPromptRef = ref
    props.bindPrompt(ref)
    props.hostRef?.(ref)
  }

  onMount(() => {
    diag(
      `slot mounted: ${props.slot} entries=${entries.length} interval=${PROMPT_SYNC_MS}ms minLen=${MIN_INPUT_LENGTH}`,
    )
    const timer = setInterval(update, PROMPT_SYNC_MS)
    onCleanup(() => {
      diag(`slot unmounted: ${props.slot}`)
      disposed = true
      clearInterval(timer)
      unsubscribeIdle()
    })

    // Tab/Esc are handled here while the prompt is focused. Enter is NOT
    // intercepted: it always submits the prompt as-is.
    const keyGuard = (
      evt: {
        name?: string
        raw?: string
        sequence?: string
        ctrl?: boolean
        shift?: boolean
        meta?: boolean
        option?: boolean
        preventDefault: () => void
        stopPropagation: () => void
      },
    ): boolean => {
      if (!runtimeEnabled || disposed) return false
      if (matchesCombo(evt, cycleKey)) {
        if (cycle(1)) {
          evt.preventDefault()
          evt.stopPropagation()
          return true
        }
        return false
      }
      if (matchesCombo(evt, cycleKeyBack)) {
        if (cycle(-1)) {
          evt.preventDefault()
          evt.stopPropagation()
          return true
        }
        return false
      }
      if (matchesCombo(evt, acceptKey) && matches.length) {
        if (accept()) {
          evt.preventDefault()
          evt.stopPropagation()
          return true
        }
      }
      if (evt.name === "escape" && matches.length) {
        diag(`dismiss input="${lastInput.slice(0, 60)}" matches=${matches.length}`)
        dismissedInput = lastInput
        matches = []
        matchIndex = 0
        render()
        evt.preventDefault()
        evt.stopPropagation()
        return true
      }
      return false
    }

    const guard = (evt: never) => {
      keyGuard(evt as never)
    }
    props.api.renderer.keyInput.prependListener("keypress", guard as never)
    diag(`keypress listener attached: prependListener slot=${props.slot}`)
    onCleanup(() => {
      props.api.renderer.keyInput.removeListener("keypress", guard as never)
      diag(`keypress listener removed slot=${props.slot}`)
    })

    useKeyboard((evt) => {
      keyGuard(evt as never)
    })
    diag(`useKeyboard listener attached slot=${props.slot}`)
  })

  return (
    <box>
      <props.api.ui.Prompt
        sessionID={props.sessionID}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.onSubmit}
        ref={bind}
      />
      <box paddingLeft={1} paddingRight={1} flexShrink={0}>
        <text fg={props.api.theme.current.textMuted} wrapMode="none" ref={(el: unknown) => (lineText = el as { content: string })}>
          {""}
        </text>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api: TuiPluginApi, options?: AutocompleteOptions) => {
  const opts = (options ?? {}) as AutocompleteOptions
  // First act: without this call every diag/span below is a no-op.
  configureDiag(opts)
  const endTui = span("tui()")
  diag(
    `tui() entry options=${JSON.stringify({ enabled: opts.enabled, acceptKey: opts.acceptKey, cycleKey: opts.cycleKey, cycleKeyBack: opts.cycleKeyBack, debug: opts.debug })}`,
  )

  if (opts.enabled === false) {
    diag("tui() invoked but disabled via options")
    endTui("result=disabled")
    return
  }

  registry.loads++
  diag(
    `module evaluated ${moduleEvaluatedAt} | tui() loads=${registry.loads} registered=${registry.registered} pid=${process.pid}`,
  )
  const endDb = span("databasePath()")
  const resolvedDb = databasePath()
  endDb(`path=${resolvedDb} exists=${existsSync(resolvedDb)}`)

  // Register at most once across ALL module instances: the state lives on
  // globalThis, so a second evaluation of this module cannot mount a second
  // prompt. (A module-scope flag is not enough — it is per module instance.)
  if (registry.registered) {
    diag("tui() skipped: slot plugin already registered")
    endTui("result=already-registered")
    return
  }
  registry.registered = true
  diag("registering slot plugin")

  acceptKey = parseCombo(opts.acceptKey, { name: "tab", ctrl: false, shift: false, meta: false, alt: false })
  cycleKey = parseCombo(opts.cycleKey, { name: "down", ctrl: true, shift: false, meta: false, alt: false })
  cycleKeyBack = parseCombo(opts.cycleKeyBack, { name: "up", ctrl: true, shift: false, meta: false, alt: false })
  previewChars = opts.maxPreviewChars ?? DEFAULT_PREVIEW_CHARS
  runtimeEnabled = true
  diag(
    `combos accept=${JSON.stringify(acceptKey)} cycleFwd=${JSON.stringify(cycleKey)} cycleBack=${JSON.stringify(cycleKeyBack)}`,
  )

  let currentPrompt: TuiPromptRef | undefined
  const bindPrompt = (ref: TuiPromptRef | undefined) => {
    currentPrompt = ref
    diag(`prompt ref ${ref ? "bound" : "cleared"}`)
  }

  const endCommands = span("api.command.register")
  api.command?.register(() => [
    {
      title: "Toggle history autocomplete",
      value: "autocomplete.toggle",
      description: `Enable/disable history autocomplete (currently ${runtimeEnabled ? "on" : "off"})`,
      category: "Prompt",
      onSelect() {
        runtimeEnabled = !runtimeEnabled
        diag(`command autocomplete.toggle -> ${runtimeEnabled ? "on" : "off"}`)
        api.renderer.requestRender()
      },
    },
    {
      title: "Accept history suggestion",
      value: "autocomplete.accept",
      description: "Accept the current history autocomplete suggestion",
      category: "Prompt",
      onSelect() {
        if (!runtimeEnabled) return
        const endAccept = span("command autocomplete.accept")
        // Read the input from the focused editor — the prompt ref is not
        // reliably bound when the slot host passes its own ref.
        const ed = (api.renderer as unknown as {
          currentFocusedEditor?: { plainText?: string; setText(t: string): void; gotoBufferEnd(): void }
        }).currentFocusedEditor
        const value = typeof ed?.plainText === "string" ? ed.plainText : (currentPrompt?.current.input ?? "")
        if (value.length < MIN_INPUT_LENGTH) {
          endAccept("result=too-short")
          return
        }
        const endHist = span("loadHistory")
        const history = loadHistory()
        endHist(`entries=${history.length}`)
        const match = bestMatch(value, history)
        if (!match) {
          endAccept("result=no-match")
          return
        }
        if (ed && typeof ed.setText === "function") {
          ed.setText(match.text)
          ed.gotoBufferEnd()
        } else {
          currentPrompt?.set({ input: match.text, mode: currentPrompt.current.mode, parts: [] })
        }
        endAccept("result=accepted via=palette")
        api.renderer.requestRender()
      },
    },
  ])
  endCommands()

  // Runtime check (isHostSlotPlugin) requires a string id even though the
  // TuiSlotPlugin type forbids it (id?: never) — runtime wins.
  const slotPlugin = {
    id,
    order: 1,
    slots: {
      home_prompt(_ctx: unknown, value: any) {
        diag("slot factory called: home_prompt")
        return (
          <PromptWithHistoryAutocomplete api={api} slot="home" bindPrompt={bindPrompt} hostRef={value.ref} />
        )
      },
      session_prompt(_ctx: unknown, value: any) {
        diag(`slot factory called: session_prompt session_id=${value.session_id} visible=${value.visible} disabled=${value.disabled}`)
        return (
          <PromptWithHistoryAutocomplete
            api={api}
            slot="session"
            bindPrompt={bindPrompt}
            hostRef={value.ref}
            sessionID={value.session_id}
            visible={value.visible}
            disabled={value.disabled}
            onSubmit={value.on_submit}
          />
        )
      },
    },
  }
  const endSlots = span("api.slots.register")
  api.slots.register(slotPlugin as never)
  endSlots("slots=home_prompt,session_prompt")
  endTui("result=registered")
}

const plugin = {
  id,
  tui,
}

export default plugin
