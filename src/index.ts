import type { Plugin } from "@opencode-ai/plugin"

/**
 * Server-side module: no-op. History comes straight from the opencode
 * SQLite database, read by the TUI module. This entry only exists so the
 * server plugin loader accepts the package without errors.
 */
export const AutocompletePlugin: Plugin = async () => {
  return {}
}

export default AutocompletePlugin
