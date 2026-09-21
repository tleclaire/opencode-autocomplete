import { appendHistory } from "./history";
/**
 * Server-side module: records every submitted user prompt into a JSONL
 * history file that the TUI module reads for autocomplete suggestions.
 */
export const AutocompletePlugin = async ({ directory }) => {
    // Global config dir so history is shared across projects.
    const configDir = process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`;
    const dir = `${configDir}/opencode`;
    return {
        "chat.message": async (_input, output) => {
            if (output.message.role !== "user")
                return;
            for (const part of output.parts) {
                if (part.type === "text" && !part.synthetic && !part.ignored) {
                    await appendHistory(dir, part.text);
                }
            }
        },
    };
};
export default AutocompletePlugin;
