export type HistoryEntry = {
    text: string;
    time: number;
};
export declare function historyFilePath(configDir: string): string;
export declare function appendHistory(configDir: string, text: string): Promise<void>;
export declare function loadHistory(configDir: string): Promise<HistoryEntry[]>;
/**
 * Find the best history match for the current input.
 * Preference: exact prefix match (longest history entry first), then substring match.
 * Never returns the input itself.
 */
export declare function bestMatch(input: string, entries: HistoryEntry[]): HistoryEntry | undefined;
