// Server-side module: no-op, V2 shape.
//
// All behaviour lives in the TUI entry (`./tui` → src/tui.tsx). This entry only
// exists so the package is a valid OpenCode plugin package; it registers
// nothing. V2 requires `{ id, setup }` — the V1 `async () => ({})` form throws
// "Plugin must export a default definition with an id and an effect or setup
// function".

export default {
  id: "opencode-autocomplete",

  setup() {
    // Intentionally empty: history is read straight from the OpenCode SQLite
    // database by the TUI module.
  },
}
