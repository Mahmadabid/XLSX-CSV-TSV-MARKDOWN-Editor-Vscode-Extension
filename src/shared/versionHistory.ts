import * as path from 'path';
import { createHash } from 'crypto';

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
