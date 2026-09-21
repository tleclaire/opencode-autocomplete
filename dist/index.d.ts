import type { Plugin } from "@opencode-ai/plugin";
/**
 * Server-side module: records every submitted user prompt into a JSONL
 * history file that the TUI module reads for autocomplete suggestions.
 */
export declare const AutocompletePlugin: Plugin;
export default AutocompletePlugin;
