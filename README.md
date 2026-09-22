# opencode-autocomplete

History-based autocomplete for the [opencode](https://github.com/sst/opencode) TUI prompt.

As you type, the plugin shows your most recent matching prompt from history as a ghost-text line below the input. **Tab** accepts it, **Esc** dismisses it.

```
> können wir die tests ausf
  können wir die tests ausführen?        ← ghost text, Tab to accept
```

## How it works

- History is read directly from opencode's SQLite database (`~/.local/share/opencode/opencode.db`) via `bun:sqlite` (read-only, WAL-safe): `message` (role=user) joined with `part` (type=text), deduplicated, minimum length 4, newest first, capped at 2000 entries.
- The TUI module registers a slot below the prompt (`home_prompt`) and renders the suggestion imperatively — Solid reactivity does not work across the plugin/host boundary (separate solid-js instances), so the plugin polls the focused editor every 50 ms and writes the suggestion via `textRenderable.content`.
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
    ["/path/to/opencode-autocomplete", { "enabled": true, "acceptKey": "tab" }]
  ]
}
```

| Option      | Default | Description                                                        |
| ----------- | ------- | ------------------------------------------------------------------ |
| `enabled`   | `true`  | `false` disables the plugin entirely (no slot, no suggestion line) |
| `acceptKey` | `"tab"` | Key that accepts the suggestion (opentui key name, e.g. `"right"`) |

At runtime you can toggle the plugin on/off via the command palette: **"Toggle history autocomplete"**. Enter always submits the prompt — it never accepts the suggestion.

## Gotchas (learned the hard way)

1. **TUI plugins load from `tui.json`, not `opencode.json`** — `TuiConfig.pluginOrigins()` only reads `tui.json` files. Register in both.
2. **Slot registration requires `id: string`** — `isHostSlotPlugin` checks for it at runtime, but the `TuiSlotPlugin` type forbids it (`id?: never`). Cast with `as never`.
3. **esbuild needs `--jsx=automatic --jsx-import-source=@opentui/solid`** — otherwise it emits `React.createElement`, the slot renderer returns React objects, and the TUI silently falls back to the default prompt.
4. **Solid reactivity does not cross the plugin boundary** — the plugin bundles its own solid-js/@opentui, the host TUI has its own. Signals don't fire across instances. Go fully imperative: poll `renderer.currentFocusedEditor.plainText`, write via `textRenderable.content` (`.text` doesn't exist — silent no-op).
5. **Accepting input**: `currentFocusedEditor.setText(text)` + `gotoBufferEnd()` writes to the real host editor. `TuiPromptRef.set()` is a no-op unless the ref *is* the focused editor.

## Requirements

- opencode ≥ 1.18.31 (V1 plugin API)
- Bun (for `bun:sqlite`)

## License

MIT
