import * as vscode from 'vscode';

export interface FileStyleData {
    styles: Record<string, any> | StructuredStyleData;
    lastModified: number;
}

export interface StructuredStyleData {
    schemaVersion: 2;
    cells: Record<string, { style: Record<string, any> }>;
}

const STORAGE_KEY_PREFIX = 'xlsxViewer.styles.';
const STORAGE_INDEX_KEY = 'xlsxViewer.styleIndex';
const STORAGE_VIEW_MODE_KEY_PREFIX = 'xlsxViewer.viewMode.';
// 48 hours in milliseconds
const EXPIRATION_MS = 48 * 60 * 60 * 1000;

interface StyleIndexEntry {
    path: string;
    lastModified: number;
}

export class StyleStorageService {
    constructor(private readonly context: vscode.ExtensionContext) { }

    private getStorageKey(uri: vscode.Uri): string {
        // Use fsPath as the key to scope styles per file path
        return `${STORAGE_KEY_PREFIX}${uri.fsPath}`;
    }

    private getIndex(): StyleIndexEntry[] {
        return this.context.workspaceState.get<StyleIndexEntry[]>(STORAGE_INDEX_KEY, []);
    }

    private async setIndex(index: StyleIndexEntry[]): Promise<void> {
        await this.context.workspaceState.update(STORAGE_INDEX_KEY, index);
    }

    private normalizeIndex(index: StyleIndexEntry[]): StyleIndexEntry[] {
        const seen = new Set<string>();
        const normalized: StyleIndexEntry[] = [];

        for (const entry of index) {
            const path = typeof entry?.path === 'string' ? entry.path : '';
            const lastModified = typeof entry?.lastModified === 'number' ? entry.lastModified : 0;
            if (!path || seen.has(path)) {
                continue;
            }

            seen.add(path);
            normalized.push({ path, lastModified });
        }

        return normalized;
    }

    private async upsertIndexEntry(uri: vscode.Uri, lastModified: number): Promise<void> {
        const nextIndex = this.normalizeIndex(this.getIndex());
        const existingIndex = nextIndex.findIndex(entry => entry.path === uri.fsPath);
        const nextEntry: StyleIndexEntry = { path: uri.fsPath, lastModified };

        if (existingIndex >= 0) {
            nextIndex[existingIndex] = nextEntry;
        } else {
            nextIndex.push(nextEntry);
        }

        await this.setIndex(nextIndex);
    }

    private async removeIndexEntry(uri: vscode.Uri): Promise<void> {
        const nextIndex = this.normalizeIndex(this.getIndex()).filter(entry => entry.path !== uri.fsPath);
        await this.setIndex(nextIndex);
    }

    private unpackStyles(payload: FileStyleData['styles'] | undefined): Record<string, any> | undefined {
        if (!payload || typeof payload !== 'object') {
            return undefined;
        }

        if ((payload as StructuredStyleData).schemaVersion === 2 && (payload as StructuredStyleData).cells) {
            const cells = (payload as StructuredStyleData).cells;
            const styles: Record<string, any> = {};
            for (const [key, cell] of Object.entries(cells)) {
                if (cell?.style && typeof cell.style === 'object') {
                    styles[key] = cell.style;
                }
            }
            return styles;
        }

        return payload as Record<string, any>;
    }

    private packStyles(styles: Record<string, any>): StructuredStyleData {
        const cells: StructuredStyleData['cells'] = {};
        for (const [key, style] of Object.entries(styles)) {
            if (style && typeof style === 'object') {
                cells[key] = { style };
            }
        }

        return {
            schemaVersion: 2,
            cells
        };
    }

    public hasStyles(uri: vscode.Uri): boolean {
        return this.normalizeIndex(this.getIndex()).some(entry => entry.path === uri.fsPath);
    }

    public async getStylesForPath(fsPath: string): Promise<Record<string, any> | undefined> {
        const key = `${STORAGE_KEY_PREFIX}${fsPath}`;
        const data = this.context.workspaceState.get<FileStyleData>(key);

        if (!data) {
            return undefined;
        }

        const now = Date.now();
        if (now - data.lastModified > EXPIRATION_MS) {
            await this.context.workspaceState.update(key, undefined);
            await this.removeIndexEntry(vscode.Uri.file(fsPath));
            return undefined;
        }

        data.lastModified = now;
        await this.context.workspaceState.update(key, data);
        await this.upsertIndexEntry(vscode.Uri.file(fsPath), now);

        return this.unpackStyles(data.styles);
    }

    private getViewModeStorageKey(uri: vscode.Uri): string {
        return `${STORAGE_VIEW_MODE_KEY_PREFIX}${uri.fsPath}`;
    }

    /**
     * Loads styles for a specific URI and prunes them if they are older than 48 hours.
     * The lastModified timestamp tracks edit activity only and is not extended on read.
     */
    public async getStyles(uri: vscode.Uri): Promise<Record<string, any> | undefined> {
        if (!this.hasStyles(uri)) {
            return undefined;
        }

        const key = this.getStorageKey(uri);
        const data = this.context.workspaceState.get<FileStyleData>(key);

        if (!data) {
            return undefined;
        }

        const now = Date.now();
        if (now - data.lastModified > EXPIRATION_MS) {
            // Expired, clear them
            await this.clearStyles(uri);
            return undefined;
        }

        data.lastModified = now;
        await this.context.workspaceState.update(key, data);
        await this.upsertIndexEntry(uri, now);

        return this.unpackStyles(data.styles);
    }

    /**
     * Saves styles for a specific URI and updates the lastModified timestamp.
     */
    public async saveStyles(uri: vscode.Uri, styles: Record<string, any>): Promise<void> {
        const key = this.getStorageKey(uri);
        const normalizedStyles = styles && typeof styles === 'object' ? styles : {};
        const data: FileStyleData = {
            styles: this.packStyles(normalizedStyles),
            lastModified: Date.now()
        };
        await this.context.workspaceState.update(key, data);

        if (Object.keys(normalizedStyles).length > 0) {
            await this.upsertIndexEntry(uri, data.lastModified);
        } else {
            await this.clearStyles(uri);
        }
    }

    /**
     * Clears stored styles for a specific URI.
     */
    public async clearStyles(uri: vscode.Uri): Promise<void> {
        const key = this.getStorageKey(uri);
        await this.context.workspaceState.update(key, undefined);
        await this.removeIndexEntry(uri);
    }

    public getPreferredViewMode(uri: vscode.Uri): 'plain' | 'styled' | undefined {
        const key = this.getViewModeStorageKey(uri);
        const stored = this.context.workspaceState.get<string>(key);
        if (stored === 'plain' || stored === 'styled') {
            return stored;
        }
        return undefined;
    }

    public async setPreferredViewMode(uri: vscode.Uri, mode: 'plain' | 'styled'): Promise<void> {
        const key = this.getViewModeStorageKey(uri);
        await this.context.workspaceState.update(key, mode);
    }

    public async clearPreferredViewMode(uri: vscode.Uri): Promise<void> {
        const key = this.getViewModeStorageKey(uri);
        await this.context.workspaceState.update(key, undefined);
    }

    /**
     * Optional: Utility to clean up all expired styles in workspaceState.
     */
    public async pruneAllExpiredStyles(): Promise<void> {
        const now = Date.now();
        const kept: StyleIndexEntry[] = [];

        for (const entry of this.normalizeIndex(this.getIndex())) {
            const key = `${STORAGE_KEY_PREFIX}${entry.path}`;
            const data = this.context.workspaceState.get<FileStyleData>(key);
            if (!data || now - data.lastModified > EXPIRATION_MS) {
                await this.context.workspaceState.update(key, undefined);
                continue;
            }

            kept.push({ path: entry.path, lastModified: data.lastModified });
        }

        await this.setIndex(kept);
    }
}
