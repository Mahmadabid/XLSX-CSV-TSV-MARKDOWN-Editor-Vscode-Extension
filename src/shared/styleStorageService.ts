import * as vscode from 'vscode';

export interface FileStyleData {
    styles: Record<string, any> | StructuredStyleData;
    lastModified: number;
}

export interface StructuredStyleData {
    schemaVersion: 2;
    cells: Record<string, {
        style?: Record<string, any>;
        control?: {
            controlType: string;
            dropdownOptions?: string[];
            defaultValue?: string;
        }
    }>;
    merges?: { startRow: number; startCol: number; endRow: number; endCol: number }[];
}

export type FileMetadata = Omit<StructuredStyleData, 'schemaVersion'>;

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
        // Use normalized lowercase fsPath to avoid case sensitivity issues on Windows/macOS
        return `${STORAGE_KEY_PREFIX}${uri.fsPath.toLowerCase()}`;
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
            if (!path || seen.has(path.toLowerCase())) {
                continue;
            }

            seen.add(path.toLowerCase());
            normalized.push({ path, lastModified });
        }

        return normalized;
    }

    private async upsertIndexEntry(uri: vscode.Uri, lastModified: number): Promise<void> {
        const nextIndex = this.normalizeIndex(this.getIndex());
        const existingIndex = nextIndex.findIndex(entry => entry.path.toLowerCase() === uri.fsPath.toLowerCase());
        const nextEntry: StyleIndexEntry = { path: uri.fsPath, lastModified };

        if (existingIndex >= 0) {
            nextIndex[existingIndex] = nextEntry;
        } else {
            nextIndex.push(nextEntry);
        }

        await this.setIndex(nextIndex);
    }

    private async removeIndexEntry(uri: vscode.Uri): Promise<void> {
        const nextIndex = this.normalizeIndex(this.getIndex()).filter(entry => entry.path.toLowerCase() !== uri.fsPath.toLowerCase());
        await this.setIndex(nextIndex);
    }

    public async getMetadata(uri: vscode.Uri): Promise<FileMetadata | undefined> {
        const key = this.getStorageKey(uri);
        let data = this.context.workspaceState.get<FileStyleData>(key);

        // Migrate legacy case-sensitive key if it exists
        if (!data) {
            const legacyKey = `${STORAGE_KEY_PREFIX}${uri.fsPath}`;
            data = this.context.workspaceState.get<FileStyleData>(legacyKey);
            if (data) {
                await this.context.workspaceState.update(key, data);
                await this.context.workspaceState.update(legacyKey, undefined);
            }
        }

        if (!data) {
            return undefined;
        }

        const now = Date.now();
        if (now - data.lastModified > EXPIRATION_MS) {
            // Expired, clear them
            await this.clearStyles(uri);
            return undefined;
        }

        const payload = data.styles;
        if (!payload || typeof payload !== 'object') {
            return undefined;
        }

        if ((payload as any).schemaVersion === 2) {
            return {
                cells: (payload as any).cells || {},
                merges: (payload as any).merges || []
            };
        }

        // Legacy format (just styles mapping)
        const cells: StructuredStyleData['cells'] = {};
        for (const [cellKey, style] of Object.entries(payload)) {
            if (style && typeof style === 'object') {
                cells[cellKey] = { style };
            }
        }
        return { cells, merges: [] };
    }

    public async saveMetadata(uri: vscode.Uri, metadata: FileMetadata): Promise<void> {
        const key = this.getStorageKey(uri);
        const data: FileStyleData = {
            styles: {
                schemaVersion: 2,
                cells: metadata.cells || {},
                merges: metadata.merges || []
            },
            lastModified: Date.now()
        };
        await this.context.workspaceState.update(key, data);

        const hasAny = Object.keys(metadata.cells || {}).length > 0 || (metadata.merges || []).length > 0;
        if (hasAny) {
            await this.upsertIndexEntry(uri, data.lastModified);
        } else {
            await this.clearStyles(uri);
        }
    }

    public hasStyles(uri: vscode.Uri): boolean {
        return this.normalizeIndex(this.getIndex()).some(entry => entry.path.toLowerCase() === uri.fsPath.toLowerCase());
    }

    public async getStylesForPath(fsPath: string): Promise<Record<string, any> | undefined> {
        return this.getStyles(vscode.Uri.file(fsPath));
    }

    private getViewModeStorageKey(uri: vscode.Uri): string {
        return `${STORAGE_VIEW_MODE_KEY_PREFIX}${uri.fsPath.toLowerCase()}`;
    }

    /**
     * Loads styles for a specific URI and prunes them if they are older than 48 hours.
     * The lastModified timestamp tracks edit activity only and is not extended on read.
     */
    public async getStyles(uri: vscode.Uri): Promise<Record<string, any> | undefined> {
        const metadata = await this.getMetadata(uri);
        if (!metadata || !metadata.cells) {
            return undefined;
        }

        const styles: Record<string, any> = {};
        for (const [key, cell] of Object.entries(metadata.cells)) {
            if (cell?.style && typeof cell.style === 'object') {
                styles[key] = cell.style;
            }
        }
        return styles;
    }

    /**
     * Saves styles for a specific URI and updates the lastModified timestamp.
     */
    public async saveStyles(uri: vscode.Uri, styles: Record<string, any>): Promise<void> {
        const metadata = (await this.getMetadata(uri)) || { cells: {}, merges: [] };
        const cells = metadata.cells || {};

        // Clear old styles, keep controls
        for (const [key, cell] of Object.entries(cells)) {
            if (cell) {
                delete cell.style;
            }
        }

        // Add new styles
        for (const [key, style] of Object.entries(styles)) {
            if (style && typeof style === 'object') {
                if (!cells[key]) {
                    cells[key] = {};
                }
                cells[key].style = style;
            }
        }

        // Clean cells with neither style nor control
        for (const [key, cell] of Object.entries(cells)) {
            if (!cell || (!cell.style && !cell.control)) {
                delete cells[key];
            }
        }

        metadata.cells = cells;
        await this.saveMetadata(uri, metadata);
    }

    /**
     * Clears stored styles for a specific URI.
     */
    public async clearStyles(uri: vscode.Uri): Promise<void> {

        const key = this.getStorageKey(uri);
        await this.context.workspaceState.update(key, undefined);
        const legacyKey = `${STORAGE_KEY_PREFIX}${uri.fsPath}`;
        await this.context.workspaceState.update(legacyKey, undefined);
        await this.removeIndexEntry(uri);
    }

    public getPreferredViewMode(uri: vscode.Uri): 'plain' | 'styled' | undefined {
        const key = this.getViewModeStorageKey(uri);
        let stored = this.context.workspaceState.get<string>(key);
        if (!stored) {
            const legacyKey = `${STORAGE_VIEW_MODE_KEY_PREFIX}${uri.fsPath}`;
            stored = this.context.workspaceState.get<string>(legacyKey);
            if (stored) {
                // Migrate to case-insensitive key
                this.context.workspaceState.update(key, stored);
                this.context.workspaceState.update(legacyKey, undefined);
            }
        }
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
     * Utility to clean up all expired styles in workspaceState.
     */
    public async pruneAllExpiredStyles(): Promise<void> {
        const now = Date.now();
        const kept: StyleIndexEntry[] = [];

        for (const entry of this.normalizeIndex(this.getIndex())) {
            const key = `${STORAGE_KEY_PREFIX}${entry.path.toLowerCase()}`;
            const data = this.context.workspaceState.get<FileStyleData>(key);
            if (!data || now - data.lastModified > EXPIRATION_MS) {
                await this.context.workspaceState.update(key, undefined);
                const legacyKey = `${STORAGE_KEY_PREFIX}${entry.path}`;
                await this.context.workspaceState.update(legacyKey, undefined);
                continue;
            }

            kept.push({ path: entry.path, lastModified: data.lastModified });
        }

        await this.setIndex(kept);
    }
}
