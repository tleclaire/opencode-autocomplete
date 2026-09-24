# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `maxPreviewChars` option (default `100`): cap for the history preview shown on the suggestion line.
- Full opt-in instrumentation behind `debug: true` (`src/diag.ts`): lifecycle events at every critical load point (module eval, `tui()` entry with options, DB path, command/slot registration, slot factory/mount/unmount, key-listener attach), per-section timings (`loadHistory` at init/idle/palette, `matchAll`, `accept`, poll ticks), key events (accept/cycle/dismiss with combo) and a rolling summary every 5 s (poll/match/history avg+max, render count) to spot plugin-induced delays. Zero overhead while off; log at `%TEMP%/opencode-autocomplete-diag.log`.

### Changed
- Suggestion previews show the entry's first line only — collapsed whitespace, truncated with `…`, and annotated with `(+N lines)` when the entry spans several lines — so pasted blobs (whole mails, code) no longer flood the prompt layout. Accepting still inserts the full entry.
- Matching runs on a precomputed lowercase copy of each history entry instead of lowercasing up to 2000 entries per keystroke.
- Debug log is appended through a buffered async stream instead of `appendFileSync`, so logging no longer blocks the keystroke path.

### Fixed
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

[Unreleased]: https://github.com/tleclaire/opencode-autocomplete/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tleclaire/opencode-autocomplete/releases/tag/v0.1.0
