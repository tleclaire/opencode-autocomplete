# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-10-28

### Added
- `maxPreviewChars` option (default `100`): cap for the history preview shown on the suggestion line.
- Full opt-in instrumentation behind `debug: true` (`src/diag.ts`): lifecycle events at every critical load point (module eval, `setup()` entry with options, DB path, slot register/dispose/cleanup, skipped setup), per-section timings (`loadHistory` at init and on palette reload, `matchAll`, `accept`, poll ticks), command events (accept, cycle, dismiss, toggle) and a rolling summary every 5 s (poll/match/history avg+max, render count) to spot plugin-induced delays. Zero overhead while off; log at `%TEMP%/opencode-autocomplete-diag.log`.

### Changed
- **Breaking:** ported the TUI module to the OpenCode V2 plugin API — default export is `{ id, setup(ctx) }` instead of `{ id, tui }`, options are read from `ctx.options` (V2 config: object form `{ "package": "…", "options": {…} }` in `~/.config/opencode/cli.json`), and keys are registered through `ctx.keymap.layer()`. Requires opencode ≥ 2.2.0 (was ≥ 1.18.31).
- The suggestion is now a contribution to the host's `prompt.footer` slot instead of replacing the prompt (`home_prompt` / `session_prompt`). The host prompt, its history and its key handling stay untouched, and there are no host refs left to tear down when a view unmounts.
- Key commands return `false` when there is nothing to accept/cycle/dismiss, so `tab` (agent cycle) and `escape` (interrupt) keep their host behaviour.
- `src/index.ts` is a V2 no-op server plugin definition; all behaviour lives in the TUI entry.
- Suggestion previews show the entry's first line only — collapsed whitespace, truncated with `…`, and annotated with `(+N lines)` when the entry spans several lines — so pasted blobs (whole mails, code) no longer flood the prompt layout. Accepting still inserts the full entry.
- Matching runs on a precomputed lowercase copy of each history entry instead of lowercasing up to 2000 entries per keystroke.
- Debug log is appended through a buffered async stream instead of `appendFileSync`, so logging no longer blocks the keystroke path.

### Fixed
- Suggestion line is prepended to the prompt footer instead of appended: the footer's own status content sits at the right edge, so appending landed in the bottom-right corner away from the input.
- Reloading the plugin now disposes the previous slot registration and poll timer before registering again, so the line is replaced instead of stacking twice or vanishing.
- Inputs starting with `/` no longer trigger history completion (slash commands were delayed/fought over by the suggestion line); the palette accept command bails out the same way before reloading history.

## [0.1.0] - 2026-09-22

### Added
- History-based autocomplete for the opencode TUI prompt: suggestion line below the input, **Tab** accepts, **Esc** dismisses (for that input).
- History read directly from `opencode.db` via `bun:sqlite` (read-only); cross-platform DB path with `OPENCODE_DB` override and channel-suffix fallback.
- Config options in `tui.json`: `enabled`, `acceptKey`, `cycleKey`, `cycleKeyBack`, `debug`.
- Runtime toggle command (palette, `ctrl+p`).
- Multi-match cycling through all prefix/substring matches (newest first) with position indicator (`⇥ (2/5) …`); defaults `ctrl+down` / `ctrl+up`.
- Opt-in debug logging (`debug: true` → temp-dir diagnostic log).
- Crash-safe slot lifecycle (globalThis registry against double-load).

### Changed
- Enter always submits the prompt; it never accepts a suggestion (Tab is the only accept key by default).
- Palette commands no longer gated on an unbound prompt ref; input is read from the focused editor.

### Fixed
- TUI slot registration requires `id` (runtime requirement).
- esbuild must bundle with `--jsx=automatic --jsx-import-source=@opentui/solid`.
- Suggestion line rendered in normal flow below the prompt (absolute overlay was clipped).
- Solid reactivity does not cross the plugin boundary → imperative update pipeline (read focused editor, write via content setter).

### Removed
- JSONL history store (replaced by direct `opencode.db` reads).

[Unreleased]: https://github.com/tleclaire/opencode-autocomplete/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/tleclaire/opencode-autocomplete/releases/tag/v0.2.0
[0.1.0]: https://github.com/tleclaire/opencode-autocomplete/releases/tag/v0.1.0
