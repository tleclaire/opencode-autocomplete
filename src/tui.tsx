import { useKeyboard } from "@opentui/solid"
import { onCleanup, onMount, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { bestMatch, loadHistory, type HistoryEntry } from "./history"

const id = "opencode-autocomplete"
const PROMPT_SYNC_MS = 50
const MIN_INPUT_LENGTH = 4

/**
 * Solid's reactivity does NOT work across the plugin boundary: the plugin
 * bundles its own solid-js instance while the host TUI uses its own, so
 * signals never trigger host-side renders. Everything below therefore works
 * imperatively: a 50ms poll reads the focused editor, and the suggestion line
 * is updated by writing to the renderable directly.
 */
function PromptWithHistoryAutocomplete(props: {
  api: TuiPluginApi
  bindPrompt: (ref: TuiPromptRef | undefined) => void
  hostRef?: (ref: TuiPromptRef | undefined) => void
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
}) {
  let lineText: { content: string } | undefined
  let entries: HistoryEntry[] = loadHistory()
  let currentSuggestion: HistoryEntry | undefined
  let dismissedInput = ""
  let lastInput = ""

  const focusedText = (): string => {
    const ed = (props.api.renderer as unknown as { currentFocusedEditor?: { plainText?: string } })
      .currentFocusedEditor
    return typeof ed?.plainText === "string" ? ed.plainText : ""
  }

  const compute = (value: string): HistoryEntry | undefined => {
    if (value.length < MIN_INPUT_LENGTH) return undefined
    if (dismissedInput === value) return undefined
    return bestMatch(value, entries)
  }

  const render = (label: string) => {
    if (lineText && lineText.content !== label) {
      lineText.content = label
      props.api.renderer.requestRender()
    }
  }

  const update = () => {
    const value = focusedText()
    const changed = value !== lastInput
    lastInput = value
    if (changed) {
      currentSuggestion = compute(value)
      const label = currentSuggestion ? `⇥ ${currentSuggestion.text}` : ""
      render(label)
    }
  }

  // Keep the line in sync even when the poll misses (e.g. history refresh).
  props.api.event.on("session.idle", () => {
    entries = loadHistory()
    currentSuggestion = compute(lastInput)
    render(currentSuggestion ? `⇥ ${currentSuggestion.text}` : "")
  })

  const accept = (): boolean => {
    const match = currentSuggestion
    if (!match) return false
    const ed = (
      props.api.renderer as unknown as { currentFocusedEditor?: { setText(t: string): void; gotoBufferEnd(): void } }
    ).currentFocusedEditor
    if (ed && typeof ed.setText === "function") {
      ed.setText(match.text)
      ed.gotoBufferEnd()
    } else {
      currentPromptRef?.set({ input: match.text, mode: currentPromptRef.current.mode, parts: [] })
    }
    dismissedInput = ""
    lastInput = match.text
    currentSuggestion = undefined
    render("")
    props.api.renderer.requestRender()
    return true
  }

  let currentPromptRef: TuiPromptRef | undefined
  const bind = (ref: TuiPromptRef | undefined) => {
    currentPromptRef = ref
    props.bindPrompt(ref)
    props.hostRef?.(ref)
  }

  onMount(() => {
    const timer = setInterval(update, PROMPT_SYNC_MS)
    onCleanup(() => clearInterval(timer))

    // Tab/Esc are handled here while the prompt is focused; Enter must be
    // intercepted BEFORE the host submits, so it goes through the keyInput
    // queue directly.
    const keyGuard = (
      evt: { name?: string; raw?: string; sequence?: string; preventDefault: () => void; stopPropagation: () => void },
    ): boolean => {
      const isSubmit =
        evt.name === "return" || evt.name === "linefeed" || evt.name === "enter" ||
        evt.raw === "\r" || evt.raw === "\n" ||
        evt.sequence === "\r" || evt.sequence === "\n"
      if (isSubmit && currentSuggestion) {
        if (accept()) {
          evt.preventDefault()
          evt.stopPropagation()
          return true
        }
        return false
      }
      if (evt.name === "tab" && currentSuggestion) {
        if (accept()) {
          evt.preventDefault()
          evt.stopPropagation()
          return true
        }
      }
      if (evt.name === "escape" && currentSuggestion) {
        dismissedInput = lastInput
        currentSuggestion = undefined
        render("")
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
    onCleanup(() => {
      props.api.renderer.keyInput.removeListener("keypress", guard as never)
    })

    useKeyboard((evt) => {
      keyGuard(evt as never)
    })
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

const tui: TuiPlugin = async (api: TuiPluginApi) => {
  let currentPrompt: TuiPromptRef | undefined
  const bindPrompt = (ref: TuiPromptRef | undefined) => {
    currentPrompt = ref
  }

  api.command?.register(() => [
    {
      title: "Accept history suggestion",
      value: "autocomplete.accept",
      description: "Accept the current history autocomplete suggestion",
      category: "Prompt",
      hidden: !currentPrompt,
      onSelect() {
        if (!currentPrompt) return
        const value = currentPrompt.current.input
        if (value.length < MIN_INPUT_LENGTH) return
        const match = bestMatch(value, loadHistory())
        if (!match) return
        currentPrompt.set({ input: match.text, mode: currentPrompt.current.mode, parts: [] })
        currentPrompt.focus()
        api.renderer.requestRender()
      },
    },
  ])

  // Runtime check (isHostSlotPlugin) requires a string id even though the
  // TuiSlotPlugin type forbids it (id?: never) — runtime wins.
  const slotPlugin = {
    id,
    order: 1,
    slots: {
      home_prompt(_ctx: unknown, value: any) {
        return (
          <PromptWithHistoryAutocomplete api={api} bindPrompt={bindPrompt} hostRef={value.ref} />
        )
      },
      session_prompt(_ctx: unknown, value: any) {
        return (
          <PromptWithHistoryAutocomplete
            api={api}
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
  api.slots.register(slotPlugin as never)
}

const plugin = {
  id,
  tui,
}

export default plugin
