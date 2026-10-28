# opencode-autocomplete

History-based autocomplete for the [opencode](https://github.com/sst/opencode) TUI prompt.

As you type, the plugin shows your most recent matching prompt from history as a ghost-text line in the prompt footer, directly under the input. **Tab** accepts it, **Esc** dismisses it.

```
> können wir die tests ausf
  ⇥ können wir die tests ausführen?        ← ghost text, Tab to accept
```

## How it works

- History is read directly from opencode's SQLite database via `bun:sqlite` (read-only, WAL-safe): `message` (role=user) joined with `part` (type=text), deduplicated, minimum length 4, newest first, capped at 2000 entries. The path mirrors opencode's own resolution: `OPENCODE_DB` wins (absolute path, `:memory:`, or a name inside the data dir), otherwise `<XDG_DATA_HOME || <homedir>/.local/share>/opencode/` → `opencode.db`, or `opencode-<channel>.db` on non-standard release channels. opencode uses that XDG layout on **every** platform — Windows and macOS included — so `os.homedir()` is the portable primitive (`process.env.HOME` is unset on Windows).
- The TUI module adds a contribution to the host's `prompt.footer` slot (`prepend`, so it sits under the start of the input) and never touches the host prompt itself. The suggestion is rendered imperatively inside that slot — Solid reactivity does not work across the plugin/host boundary (separate solid-js instances), so the plugin polls the focused editor every 50 ms.
- Accept writes into the real host editor via `currentFocusedEditor.setText()` + `gotoBufferEnd()`.
- Accepted text is recorded as the last seen input, so the line does not immediately reappear for the text you just inserted.

## Install

Add the plugin path to `~/.config/opencode/cli.json` (V2 TUI config). The TUI module is what provides the feature; no server-side entry is needed.

```json
{
  "plugins": ["/path/to/opencode-autocomplete"]
}
```

Then build:

```sh
bun install
bun run build
```

`src/index.ts` still exports a valid V2 server plugin definition (a no-op), so the package can additionally be listed in `opencode.json` without breaking anything — but it registers no behaviour there.

## Configuration

Options are passed per plugin entry through the object form of `cli.json`:

```json
{
  "plugins": [
    {
      "package": "/path/to/opencode-autocomplete",
      "options": { "acceptKey": "tab", "cycleKey": "ctrl+down", "cycleKeyBack": "ctrl+up" }
    }
  ]
}
```

The bare-string form still works and uses all defaults.

| Option        | Default     | Description                                                                                     |
| ------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `enabled`     | `true`      | `false` disables the plugin entirely (no slot, no suggestion line)                              |
| `acceptKey`   | `"tab"`     | Key that accepts the suggestion (combo like `"tab"`, `"right"`, `"ctrl+y"`)                     |
| `cycleKey`    | `"ctrl+down"`  | Cycle forward through multiple matches (wrap-around)                                            |
| `cycleKeyBack`| `"ctrl+up"`    | Cycle backward through multiple matches                                                        |
| `maxPreviewChars` | `100`      | Cap for the history preview on the suggestion line: first line only, truncated with `…`, multi-line entries annotated `(+N lines)`. Display-only — accepting still inserts the full entry |
| `debug`       | `false` | Full instrumentation to `%TEMP%/opencode-autocomplete-diag.log` (Linux/macOS: `/tmp`): lifecycle (`setup()` entry/options, DB path, slot register/dispose/cleanup, skipped setup), per-section timings (`loadHistory` at init and on palette reload, `matchAll`, `accept`, poll ticks with avg/max), command events (accept/cycle/dismiss/toggle) and a rolling summary every 5s for spotting plugin-induced delays. Nothing is written while it is off. |

When several history entries match, the suggestion line shows the position (`⇥ (2/5) …`); cycle with `ctrl+down`/`ctrl+up`, accept the visible one with `acceptKey`. Inputs starting with `/` never trigger history completion — slash commands belong to the host.

At runtime you can toggle the plugin on/off via the command palette: **"Toggle history autocomplete"** (there is also **"Accept history suggestion (palette)"** for a single accept). Enter always submits the prompt — it never accepts the suggestion.

## Gotchas (learned the hard way)

1. **TUI plugins load from `cli.json`, not `opencode.json`.** `opencode.json`'s `plugin` list is the server-side plugin list; a TUI-only plugin registered there does nothing. Register in `cli.json` (V1 `tui.json` is migrated once and should not be edited anymore).
2. **esbuild needs `--jsx=automatic --jsx-import-source=@opentui/solid`** — otherwise it emits `React.createElement`, the slot renderer returns React objects, and the TUI silently renders nothing.
3. **Solid reactivity does not cross the plugin boundary** — the plugin bundles its own solid-js/@opentui, the host TUI has its own. Signals don't fire across instances, so the poller is imperative and only the footer line is reactive.
4. **V2 has no prompt-text API.** `ctx.renderer.currentFocusedEditor.plainText` is the only way to see what is being typed, which is why the 50 ms poll exists. Accept writes back through the same object: `setText()` + `gotoBufferEnd()`.
5. **`ctx.keymap.layer()` needs both `commands` and `bindings`.** Only command ids listed in `bindings` get key bindings — everything else stays palette-only. Commands must `return false` when they have nothing to do, otherwise `tab` (agent cycle) and `escape` (interrupt) get swallowed.
6. **The prompt footer is a right-aligned status row.** `prepend: "prompt.footer"` puts the suggestion under the start of the input; `append` lands in the bottom-right corner next to the host's own status text.
7. **Reload must dispose, not re-register.** The setup returns a disposer that clears the poll timer and unregisters the slot; a globalThis registry disposes the previous instance first, so a plugin reload replaces the line instead of stacking a second one or losing it. Writing to a disposed renderable kills the native renderer without a catchable JS error and without a log entry — it looks like a silent crash.

## Requirements

- opencode ≥ 2.2.0 (V2 TUI plugin API: `{ id, setup(ctx) }`)
- Bun (for `bun:sqlite`)

## License

MIT
