import { useKeyboard } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPromptRef } from "@opencode-ai/plugin/tui"
import { bestMatch, loadHistory, type HistoryEntry } from "./history"

const id = "opencode-autocomplete"
const PROMPT_SYNC_MS = 50
const MIN_INPUT_LENGTH = 4

function PromptWithHistoryAutocomplete(props: {
  api: TuiPluginApi
  bindPrompt: (ref: TuiPromptRef | undefined) => void
  hostRef?: (ref: TuiPromptRef | undefined) => void
  sessionID?: string
  visible?: boolean
  disabled?: boolean
  onSubmit?: () => void
}) {
  const [prompt, setPrompt] = createSignal<TuiPromptRef>()
  const [input, setInput] = createSignal("")
  const [dismissedInput, setDismissedInput] = createSignal<string>()
  const [history, { refetch }] = createResource(
    () => props.api.state.path.config,
    (configDir) => loadHistory(configDir),
    { initialValue: [] as HistoryEntry[] },
  )

  const bind = (ref: TuiPromptRef | undefined) => {
    setPrompt(ref)
    props.bindPrompt(ref)
    props.hostRef?.(ref)
  }

  // The prompt ref exposes current state but no onInput hook, so mirror it.
  createEffect(() => {
    const ref = prompt()
    if (!ref) {
      setInput("")
      return
    }
    const sync = () => {
      const next = ref.current.input
      setInput((prev) => (prev === next ? prev : next))
    }
    sync()
    const timer = setInterval(sync, PROMPT_SYNC_MS)
    onCleanup(() => clearInterval(timer))
  })

  // Refresh history when a session goes idle (a prompt was just submitted).
  createEffect(() => {
    props.api.event.on("session.idle", () => {
      void refetch()
    })
  })

  const suggestion = createMemo(() => {
    if (props.disabled || props.visible === false) return undefined
    const value = input()
    if (value.length < MIN_INPUT_LENGTH) return undefined
    if (dismissedInput() === value) return undefined
    return bestMatch(value, history())
  })

  const accept = () => {
    const ref = prompt()
    const match = suggestion()
    if (!ref || !match) return false
    ref.set({ input: match.text, mode: ref.current.mode, parts: [...ref.current.parts] })
    setInput(match.text)
    setDismissedInput(undefined)
    ref.focus()
    props.api.renderer.requestRender()
    return true
  }

  useKeyboard((evt) => {
    if (!suggestion()) return
    if (evt.name === "tab") {
      if (accept()) {
        evt.preventDefault()
        evt.stopPropagation()
      }
      return
    }
    if (evt.name === "escape") {
      setDismissedInput(input())
      evt.preventDefault()
      evt.stopPropagation()
      return
    }
  })

  onMount(() => {
    // Intercept Enter before the prompt submits when a suggestion is visible.
    const submitGuard = (evt: { name?: string; raw?: string; sequence?: string; preventDefault: () => void; stopPropagation: () => void }) => {
      if (!suggestion()) return
      const name = evt.name?.toLowerCase()
      const isSubmit =
        name === "return" || name === "linefeed" || name === "enter" ||
        evt.raw === "\r" || evt.raw === "\n" ||
        evt.sequence === "\r" || evt.sequence === "\n"
      if (!isSubmit) return
      if (accept()) {
        evt.preventDefault()
        evt.stopPropagation()
      }
    }
    props.api.renderer.keyInput.prependListener("keypress", submitGuard as never)
    onCleanup(() => {
      props.api.renderer.keyInput.removeListener("keypress", submitGuard as never)
    })
  })

  return (
    <box>
      <Show when={suggestion()}>
        <box
          position="absolute"
          top={-1}
          left={0}
          right={0}
          zIndex={100}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={props.api.theme.current.backgroundPanel}
        >
          <text fg={props.api.theme.current.textMuted} wrapMode="none">
            {suggestion()!.text}
          </text>
        </box>
      </Show>
      <props.api.ui.Prompt
        sessionID={props.sessionID}
        visible={props.visible}
        disabled={props.disabled}
        onSubmit={props.onSubmit}
        ref={bind}
      />
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
        void loadHistory(api.state.path.config).then((entries) => {
          const match = bestMatch(value, entries)
          if (!match) return
          currentPrompt!.set({ input: match.text, mode: currentPrompt!.current.mode, parts: [...currentPrompt!.current.parts] })
          currentPrompt!.focus()
          api.renderer.requestRender()
        })
      },
    },
  ])

  api.slots.register({
    order: 100,
    slots: {
      home_prompt(_ctx, value) {
        return (
          <PromptWithHistoryAutocomplete
            api={api}
            bindPrompt={bindPrompt}
            hostRef={value.ref}
          />
        )
      },
      session_prompt(_ctx, value) {
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
  })
}

const plugin = {
  id,
  tui,
}

export default plugin
