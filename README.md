# opencode-autocomplete

History-based autocomplete for the [opencode](https://github.com/sst/opencode) TUI prompt.

As you type, the plugin shows your most recent matching prompt from history as a ghost-text line below the input. **Tab** accepts it, **Esc** dismisses it.

```
> können wir die tests ausf
  können wir die tests ausführen?        ← ghost text, Tab to accept
```

## How it works

- History is read directly from opencode's SQLite database via `bun:sqlite` (read-only, WAL-safe): `message` (role=user) joined with `part` (type=text), deduplicated, minimum length 4, newest first, capped at 2000 entries. The path mirrors opencode's own resolution: `OPENCODE_DB` wins (absolute path, `:memory:`, or a name inside the data dir), otherwise `<XDG_DATA_HOME || <homedir>/.local/share>/opencode/` → `opencode.db`, or `opencode-<channel>.db` on non-standard release channels. opencode uses that XDG layout on **every** platform — Windows and macOS included — so `os.homedir()` is the portable primitive (`process.env.HOME` is unset on Windows).
- The TUI module replaces the host prompt (`home_prompt` and `session_prompt`, both registered by the host with `mode: "replace"`) with its own prompt plus a suggestion line, and renders the suggestion imperatively — Solid reactivity does not work across the plugin/host boundary (separate solid-js instances), so the plugin polls the focused editor every 50 ms and writes the suggestion via `textRenderable.content`.
- Accept writes into the real host editor via `setText()` + `gotoBufferEnd()`.

## Install

Add the plugin path to **both** config files (the server module comes from `opencode.json`, the TUI module from `tui.json`):

`~/.config/opencode/opencode.json`:
```json
{
  "plugin": ["/path/to/opencode-autocomplete"]
}
```

`~/.config/opencode/tui.json`:
```json
{
  "plugin": ["/path/to/opencode-autocomplete"]
}
```

Then build:

```sh
bun install
bun run build
```

## Configuration

Options are passed as the second element of the plugin tuple in `tui.json`:

```json
{
  "plugin": [
    ["/path/to/opencode-autocomplete", { "enabled": true, "acceptKey": "tab", "cycleKey": "ctrl+n", "cycleKeyBack": "ctrl+p" }]
  ]
}
```

| Option        | Default     | Description                                                                                     |
| ------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `enabled`     | `true`      | `false` disables the plugin entirely (no slot, no suggestion line)                              |
| `acceptKey`   | `"tab"`     | Key that accepts the suggestion (combo like `"tab"`, `"right"`, `"ctrl+y"`)                     |
| `cycleKey`    | `"ctrl+n"`  | Cycle forward through multiple matches (wrap-around)                                            |
| `cycleKeyBack`| `"ctrl+p"`  | Cycle backward through multiple matches                                                        |

When several history entries match, the suggestion line shows the position (`⇥ (2/5) …`); cycle with `cycleKey`/`cycleKeyBack`, accept the visible one with `acceptKey`.
| `debug`     | `false` | Write lifecycle diagnostics to `%TEMP%/opencode-autocomplete-diag.log` (Linux/macOS: `/tmp`) — module evaluation, `tui()` invocations, slot mount/unmount. Nothing is written while it is off. |

At runtime you can toggle the plugin on/off via the command palette: **"Toggle history autocomplete"**. Enter always submits the prompt — it never accepts the suggestion.

## Gotchas (learned the hard way)

1. **TUI plugins load from `tui.json`, not `opencode.json`** — `TuiConfig.pluginOrigins()` only reads `tui.json` files. Register in both.
2. **Slot registration requires `id: string`** — `isHostSlotPlugin` checks for it at runtime, but the `TuiSlotPlugin` type forbids it (`id?: never`). Cast with `as never`.
3. **esbuild needs `--jsx=automatic --jsx-import-source=@opentui/solid`** — otherwise it emits `React.createElement`, the slot renderer returns React objects, and the TUI silently falls back to the default prompt.
4. **Solid reactivity does not cross the plugin boundary** — the plugin bundles its own solid-js/@opentui, the host TUI has its own. Signals don't fire across instances. Go fully imperative: poll `renderer.currentFocusedEditor.plainText`, write via `textRenderable.content` (`.text` doesn't exist — silent no-op).
5. **Accepting input**: `currentFocusedEditor.setText(text)` + `gotoBufferEnd()` writes to the real host editor. `TuiPromptRef.set()` is a no-op unless the ref *is* the focused editor.
6. **Only ONE prompt-replacing plugin may be registered.** The host registers `home_prompt`/`session_prompt` with `mode: "replace"`, and for `replace` it renders **every** contribution of that slot instead of picking a single winner. A second plugin that renders the prompt — e.g. `opencode-snippets`, which also ships a `PromptWithSnippetAutocomplete` with `order: 100` — shows up as a **second, unfocused prompt box** (smaller `order` renders on top). If you see two prompt boxes, check `tui.json` for another prompt plugin before suspecting this one.
7. **Everything that writes to a renderable must be unmount-guarded.** The slot is torn down when its view goes away, but a `setInterval` tick or an event handler can still be in flight. Writing to a disposed renderable kills the native renderer **without a catchable JS error and without any log entry** — it looks like a silent crash. Hence: a `disposed` flag set in `onCleanup`, checked before every write, and `api.event.on()` must be unsubscribed (it returns the unsubscribe function).

## Requirements

- opencode ≥ 1.18.31 (V1 plugin API)
- Bun (for `bun:sqlite`)

## License

MIT
