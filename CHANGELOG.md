# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
