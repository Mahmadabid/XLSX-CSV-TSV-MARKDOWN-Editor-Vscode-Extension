import * as path from 'path';
import { createHash } from 'crypto';
import * as vscode from 'vscode';

export const VERSION_HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000;
export const VERSION_HISTORY_SNAPSHOT_DEBOUNCE_MS = 1000;

function getHistoryKey(filePath: string): string {
    return createHash('sha1').update(filePath).digest('hex');
}

export function getVersionHistoryRoot(globalStoragePath: string): string {
    return path.join(globalStoragePath, '.history');
}

export function getVersionHistoryFile(
    globalStoragePath: string,
    filePath: string,
    kind: string,
    extension: string = 'json'
): string {
    return path.join(getVersionHistoryRoot(globalStoragePath), `${kind}-${getHistoryKey(filePath)}.${extension}`);
}

export function getVersionHistoryDir(globalStoragePath: string, filePath: string, kind: string): string {
    return path.join(getVersionHistoryRoot(globalStoragePath), `${kind}-${getHistoryKey(filePath)}`);
}

export function formatVersionHistoryGroupLabel(timestamp: number): string {
    const now = new Date();
    const entryDate = new Date(timestamp);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const entryDay = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
    const dayDiff = Math.round((today.getTime() - entryDay.getTime()) / (24 * 60 * 60 * 1000));

    if (dayDiff === 0) return 'Today';
    if (dayDiff === 1) return 'Yesterday';
    if (dayDiff >= 2 && dayDiff <= 6) return 'This Week';
    return entryDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatVersionHistoryTimestamp(timestamp: number): string {
    const entryDate = new Date(timestamp);
    return entryDate.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

export function buildGroupedVersionHistoryItems<T extends { timestamp: number }>(
    entries: T[],
    mapEntry: (entry: T) => vscode.QuickPickItem & { entry: T }
): Array<vscode.QuickPickItem & { entry?: T }> {
    const grouped = new Map<string, { sortKey: number; items: Array<ReturnType<typeof mapEntry>> }>();

    for (const entry of entries) {
        const label = formatVersionHistoryGroupLabel(entry.timestamp);
        const bucket = grouped.get(label);
        if (!bucket) {
            grouped.set(label, { sortKey: entry.timestamp, items: [mapEntry(entry)] });
        } else {
            bucket.items.push(mapEntry(entry));
        }
    }

    const sortedGroups = [...grouped.entries()].sort((a, b) => b[1].sortKey - a[1].sortKey);
    const result: Array<vscode.QuickPickItem & { entry?: T }> = [];

    for (const [label, { items }] of sortedGroups) {
        result.push({ label, kind: vscode.QuickPickItemKind.Separator });
        for (const item of items) {
            result.push(item);
        }
    }

    return result;
}
