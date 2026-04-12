import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { VERSION_HISTORY_RETENTION_MS, VERSION_HISTORY_SNAPSHOT_DEBOUNCE_MS, getVersionHistoryFile } from './shared/versionHistory';

export class TSVEditorProvider implements vscode.CustomReadonlyEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) { }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => { } };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            const filePath = document.uri.fsPath;
            
            // Storage for parsed TSV data
            let allRows: string[][] = [];
            let columnCount = 0;
            let parseComplete = false;

            // TSV parsing helpers
            function parseRowString(rowStr: string): string[] {
                if (rowStr.endsWith('\r')) rowStr = rowStr.slice(0, -1);
                const fields: string[] = [];
                let field = '';
                let inQuotes = false;
                for (let i = 0; i < rowStr.length; i++) {
                    const ch = rowStr[i];
                    if (ch === '"') {
                        if (inQuotes && i + 1 < rowStr.length && rowStr[i + 1] === '"') {
                            field += '"';
                            i++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                        continue;
                    }
                    if (ch === '\t' && !inQuotes) {
                        fields.push(field);
                        field = '';
                        continue;
                    }
                    field += ch;
                }
                fields.push(field);
                return fields;
            }

            function parseTsvChunk(data: string): { rows: string[][]; leftover: string } {
                const rows: string[][] = [];
                let inQuotes = false;
                let lastRowEnd = 0;
                for (let i = 0; i < data.length; i++) {
                    const ch = data[i];
                    if (ch === '"') {
                        if (inQuotes && i + 1 < data.length && data[i + 1] === '"') {
                            i++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (!inQuotes && ch === '\n') {
                        const rowStr = data.slice(lastRowEnd, i);
                        rows.push(parseRowString(rowStr));
                        lastRowEnd = i + 1;
                    }
                }
                const leftover = data.slice(lastRowEnd);
                return { rows, leftover };
            }

            function excelColumnLabel(n: number): string {
                let label = '';
                while (n > 0) {
                    const rem = (n - 1) % 26;
                    label = String.fromCharCode(65 + rem) + label;
                    n = Math.floor((n - 1) / 26);
                }
                return label;
            }

            type VersionHistoryEntry = {
                id: string;
                timestamp: number;
                totalRows: number;
                columnCount: number;
                data: string[][];
            };

            type EditSnapshot = {
                data: string[][];
                columnCount: number;
            };

            const MAX_UNDO_HISTORY = 100;
            let undoStack: EditSnapshot[] = [];
            let redoStack: EditSnapshot[] = [];
            let previewEntry: VersionHistoryEntry | null = null;

            const cloneRows = (rows: string[][]): string[][] => rows.map(row => [...row]);

            const buildHeaderHtml = (cols: number) => {
                let headerHtml = '<tr><th class="row-header">&nbsp;</th>';
                for (let i = 1; i <= cols; i++) {
                    headerHtml += `<th class="col-header" data-col="${i - 1}">${excelColumnLabel(i)}<div class="col-resize-handle"></div></th>`;
                }
                headerHtml += '</tr>';
                return headerHtml;
            };

            const getVisibleRows = () => previewEntry?.data ?? allRows;
            const getVisibleColumnCount = () => previewEntry?.columnCount ?? columnCount;

            const snapshotsEqual = (left: EditSnapshot, right: EditSnapshot) => {
                if (left.columnCount !== right.columnCount || left.data.length !== right.data.length) {
                    return false;
                }

                for (let row = 0; row < left.data.length; row++) {
                    const leftRow = left.data[row] || [];
                    const rightRow = right.data[row] || [];
                    for (let col = 0; col < left.columnCount; col++) {
                        if ((leftRow[col] || '') !== (rightRow[col] || '')) {
                            return false;
                        }
                    }
                }

                return true;
            };

            const createEditSnapshot = (): EditSnapshot => ({
                data: cloneRows(allRows),
                columnCount
            });

            const pushUndoSnapshot = () => {
                if (previewEntry) return;

                const snapshot = createEditSnapshot();
                const last = undoStack[undoStack.length - 1];
                if (last && snapshotsEqual(last, snapshot)) {
                    return;
                }

                undoStack.push(snapshot);
                if (undoStack.length > MAX_UNDO_HISTORY) {
                    undoStack.shift();
                }
                redoStack = [];
            };

            const findChangedCell = (fromState: EditSnapshot, toState: EditSnapshot) => {
                const maxRows = Math.max(fromState.data.length, toState.data.length);
                const maxCols = Math.max(fromState.columnCount, toState.columnCount);

                for (let row = 0; row < maxRows; row++) {
                    const fromRow = fromState.data[row] || [];
                    const toRow = toState.data[row] || [];
                    for (let col = 0; col < maxCols; col++) {
                        if ((fromRow[col] || '') !== (toRow[col] || '')) {
                            return { row, col };
                        }
                    }
                }

                return null;
            };

            let versionSnapshotDebounceTimer: any = null;

            const getHistoryFilePath = () => {
                return getVersionHistoryFile(this.context.globalStorageUri.fsPath, filePath, 'tsv');
            };

            const ensureHistoryDir = async () => {
                const historyDir = path.dirname(getHistoryFilePath());
                await fs.promises.mkdir(historyDir, { recursive: true });
            };

            const loadHistory = async (): Promise<VersionHistoryEntry[]> => {
                const historyFile = getHistoryFilePath();
                try {
                    const content = await fs.promises.readFile(historyFile, 'utf8');
                    const parsed = JSON.parse(content);
                    if (!Array.isArray(parsed)) {
                        return [];
                    }
                    return parsed as VersionHistoryEntry[];
                } catch {
                    return [];
                }
            };

            const saveHistory = async (entries: VersionHistoryEntry[]) => {
                await ensureHistoryDir();
                await fs.promises.writeFile(getHistoryFilePath(), JSON.stringify(entries), 'utf8');
            };

            const pruneHistory = async (entries?: VersionHistoryEntry[]) => {
                const now = Date.now();
                const source = entries ?? await loadHistory();
                const pruned = source.filter(entry => now - entry.timestamp <= VERSION_HISTORY_RETENTION_MS);
                if (pruned.length !== source.length) {
                    await saveHistory(pruned);
                }
                return pruned;
            };

            const persistVersionSnapshot = async () => {
                const history = await pruneHistory();
                const currentSnapshot = createEditSnapshot();
                const last = history.length > 0 ? history[history.length - 1] : null;
                if (last) {
                    const lastSnapshot: EditSnapshot = {
                        data: last.data,
                        columnCount: last.columnCount
                    };
                    if (snapshotsEqual(lastSnapshot, currentSnapshot)) {
                        return;
                    }
                }

                const now = Date.now();
                history.push({
                    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
                    timestamp: now,
                    totalRows: allRows.length,
                    columnCount,
                    data: allRows.map(row => [...row])
                });
                await saveHistory(history);
            };

            const saveVersionSnapshot = () => {
                if (versionSnapshotDebounceTimer) {
                    clearTimeout(versionSnapshotDebounceTimer);
                }

                versionSnapshotDebounceTimer = setTimeout(() => {
                    versionSnapshotDebounceTimer = null;
                    void persistVersionSnapshot();
                }, VERSION_HISTORY_SNAPSHOT_DEBOUNCE_MS);
            };

            const serializeTsv = () => {
                let text = '';
                for (let i = 0; i < allRows.length; i++) {
                    const row = allRows[i] || [];
                    const rowStr = row.map(cell => {
                        const cellStr = cell === undefined || cell === null ? '' : String(cell);
                        return cellStr.replace(/\t/g, ' ').replace(/\n/g, ' ');
                    }).join('\t');
                    text += rowStr + '\n';
                }
                return text;
            };

            const applyVersionToEditor = async (entry: VersionHistoryEntry) => {
                allRows = entry.data.map(row => [...row]);
                columnCount = entry.columnCount;
                previewEntry = null;

                fs.writeFileSync(document.uri.fsPath, serializeTsv(), 'utf8');

                webviewPanel.webview.postMessage({
                    command: 'versionRestored',
                    headerHtml: buildHeaderHtml(columnCount),
                    totalRows: allRows.length,
                    columnCount,
                    rows: cloneRows(allRows),
                    format: 'tsv'
                });
            };

            // Set up webview
            webviewPanel.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
                    vscode.Uri.joinPath(this.context.extensionUri, 'dist')
                ]
            };
            webviewPanel.webview.html = this.getWebviewContent(webviewPanel);

            // Parse the entire TSV file
            const parseTSV = (): Promise<void> => {
                return new Promise((resolve, reject) => {
                    let leftover = '';
                    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });

                    webviewPanel.onDidDispose(() => {
                        try { fileStream.destroy(); } catch { }
                    });

                    fileStream.on('data', (chunk: string) => {
                        const parsed = parseTsvChunk(leftover + chunk);
                        leftover = parsed.leftover;
                        for (const row of parsed.rows) {
                            if (allRows.length === 0 && row.length > 0) {
                                columnCount = row.length;
                            }
                            allRows.push(row);
                        }
                    });

                    fileStream.on('end', () => {
                        // Handle final partial row
                        if (leftover && leftover.length > 0) {
                            const row = parseRowString(leftover);
                            if (allRows.length === 0 && row.length > 0) {
                                columnCount = row.length;
                            }
                            allRows.push(row);
                        }
                        parseComplete = true;
                        resolve();
                    });

                    fileStream.on('error', (err: any) => {
                        reject(err);
                    });
                });
            };

            // Handle messages from webview
            webviewPanel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'webviewReady':
                        try {
                            await pruneHistory();

                            if (!parseComplete) {
                                allRows = [];
                                columnCount = 0;
                                await parseTSV();
                            }

                            await persistVersionSnapshot();

                            // Send initial metadata to webview
                            webviewPanel.webview.postMessage({
                                command: 'initVirtualTable',
                                headerHtml: buildHeaderHtml(getVisibleColumnCount()),
                                totalRows: allRows.length,
                                columnCount,
                                format: 'tsv'
                            });

                            // Send settings
                            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                            const globalCfg = vscode.workspace.getConfiguration('workbench');
                            const associations: any = globalCfg.get('editorAssociations');
                            
                            let isDefault = false;
                            
                            if (associations) {
                                if (Array.isArray(associations)) {
                                    isDefault = associations.some(a => 
                                        a.viewType === 'xlsxViewer.tsv' && 
                                        (a.filenamePattern === '*.tsv' || a.filenamePattern === '**/*.tsv')
                                    );
                                } else {
                                    isDefault = associations["*.tsv"] === 'xlsxViewer.tsv' || associations["**/*.tsv"] === 'xlsxViewer.tsv';
                                }
                            }

                            const settings = {
                                firstRowIsHeader: cfg.get('tsv.firstRowIsHeader', false),
                                stickyHeader: cfg.get('tsv.stickyHeader', false),
                                stickyToolbar: cfg.get('tsv.stickyToolbar', true),
                                spaciousCells: cfg.get('tsv.spaciousCells', false),
                                isDefaultEditor: isDefault
                            };
                            webviewPanel.webview.postMessage({ command: 'initSettings', settings });

                            // Send theme
                            webviewPanel.webview.postMessage({ 
                                type: 'setTheme', 
                                kind: vscode.window.activeColorTheme.kind 
                            });
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error parsing TSV: ${err}`);
                        }
                        break;

                    case 'getRows':
                        if (parseComplete) {
                            const { start, end, requestId } = message;
                            const sourceRows = getVisibleRows();
                            const clampedStart = Math.max(0, start);
                            const clampedEnd = Math.min(sourceRows.length, end);
                            const rows = sourceRows.slice(clampedStart, clampedEnd);
                            
                            webviewPanel.webview.postMessage({
                                command: 'rowsData',
                                rows,
                                start: clampedStart,
                                end: clampedEnd,
                                requestId
                            });
                        }
                        break;

                    case 'getRowCount':
                        webviewPanel.webview.postMessage({
                            command: 'rowCount',
                            totalRows: getVisibleRows().length,
                            requestId: message.requestId
                        });
                        break;

                    case 'updateSettings':
                        try {
                            const s = message.settings || {};
                            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                            await cfg.update('tsv.firstRowIsHeader', !!s.firstRowIsHeader, vscode.ConfigurationTarget.Global);
                            await cfg.update('tsv.stickyHeader', !!s.stickyHeader, vscode.ConfigurationTarget.Global);
                            await cfg.update('tsv.stickyToolbar', !!s.stickyToolbar, vscode.ConfigurationTarget.Global);
                            await cfg.update('tsv.spaciousCells', !!s.spaciousCells, vscode.ConfigurationTarget.Global);
                        } catch (err) {
                            console.error('Failed to persist settings:', err);
                        }
                        break;

                    case 'enableDefaultEditor':
                        await vscode.commands.executeCommand('xlsx-viewer.toggleAssociation', { type: 'tsv', enable: true });
                        // Re-send settings to update UI
                        const cfg_e = vscode.workspace.getConfiguration('xlsxViewer');
                        webviewPanel.webview.postMessage({ 
                            command: 'initSettings', 
                            settings: {
                                firstRowIsHeader: cfg_e.get('tsv.firstRowIsHeader', false),
                                stickyHeader: cfg_e.get('tsv.stickyHeader', false),
                                stickyToolbar: cfg_e.get('tsv.stickyToolbar', true),
                                spaciousCells: cfg_e.get('tsv.spaciousCells', false),
                                isDefaultEditor: true
                            }
                        });
                        break;

                    case 'disableDefaultEditor':
                        try {
                            const result = await vscode.window.showWarningMessage(
                                "Are you sure you want to disable XLSX Viewer for all .tsv files? You will be prompted to select a new default editor.",
                                "Yes, Disable",
                                "Cancel"
                            );

                            if (result === "Yes, Disable") {
                                await vscode.commands.executeCommand('xlsx-viewer.toggleAssociation', { type: 'tsv', enable: false });
                                await vscode.commands.executeCommand('workbench.action.reopenWithEditor');
                            }
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error disabling editor: ${err}`);
                        }
                        break;

                    case 'toggleView':
                        if (!message.isTableView) {
                            await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
                            webviewPanel.dispose();
                        }
                        break;

                    case 'pushUndoSnapshot':
                        pushUndoSnapshot();
                        break;

                    case 'undo': {
                        if (previewEntry || undoStack.length === 0) {
                            break;
                        }

                        const current = createEditSnapshot();
                        const previous = undoStack.pop()!;
                        redoStack.push(current);

                        allRows = cloneRows(previous.data);
                        columnCount = previous.columnCount;

                        webviewPanel.webview.postMessage({
                            command: 'applyUndoRedoState',
                            headerHtml: buildHeaderHtml(columnCount),
                            totalRows: allRows.length,
                            columnCount,
                            focusCell: findChangedCell(current, previous),
                            hasStructuralChange: current.columnCount !== previous.columnCount || current.data.length !== previous.data.length,
                            rows: cloneRows(allRows),
                            format: 'tsv'
                        });
                        break;
                    }

                    case 'redo': {
                        if (previewEntry || redoStack.length === 0) {
                            break;
                        }

                        const current = createEditSnapshot();
                        const next = redoStack.pop()!;
                        undoStack.push(current);

                        allRows = cloneRows(next.data);
                        columnCount = next.columnCount;

                        webviewPanel.webview.postMessage({
                            command: 'applyUndoRedoState',
                            headerHtml: buildHeaderHtml(columnCount),
                            totalRows: allRows.length,
                            columnCount,
                            focusCell: findChangedCell(current, next),
                            hasStructuralChange: current.columnCount !== next.columnCount || current.data.length !== next.data.length,
                            rows: cloneRows(allRows),
                            format: 'tsv'
                        });
                        break;
                    }

                    case 'cancelVersionPreview':
                        if (previewEntry) {
                            previewEntry = null;
                            webviewPanel.webview.postMessage({
                                command: 'versionPreviewCancelled',
                                headerHtml: buildHeaderHtml(columnCount),
                                totalRows: allRows.length,
                                columnCount,
                                rows: cloneRows(allRows),
                                format: 'tsv'
                            });
                        }
                        break;

                    case 'restoreVersion':
                        try {
                            if (!message.versionId) break;
                            const history = await pruneHistory();
                            const entry = history.find(item => item.id === message.versionId);
                            if (entry) {
                                await applyVersionToEditor(entry);
                            }
                        } catch (err) {
                            webviewPanel.webview.postMessage({
                                command: 'versionHistoryError',
                                message: `Restore failed: ${String(err)}`
                            });
                        }
                        break;

                    case 'saveCsv':
                        try {
                            if (previewEntry) {
                                webviewPanel.webview.postMessage({ command: 'saveResult', ok: false, error: 'Preview mode is read-only', isAutosave: message.isAutosave });
                                break;
                            }
                            fs.writeFileSync(document.uri.fsPath, serializeTsv(), 'utf8');
                            saveVersionSnapshot();
                            webviewPanel.webview.postMessage({ command: 'saveResult', ok: true, isAutosave: message.isAutosave });
                        } catch (err) {
                            webviewPanel.webview.postMessage({ command: 'saveResult', ok: false, error: String(err), isAutosave: message.isAutosave });
                        }
                        break;

                    case 'showVersionHistory':
                        try {
                            const history = await pruneHistory();
                            if (history.length === 0) {
                                webviewPanel.webview.postMessage({
                                    command: 'versionHistoryError',
                                    message: 'No saved versions available'
                                });
                                break;
                            }

                            const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);
                            const picked = await vscode.window.showQuickPick(
                                sorted.map(entry => ({
                                    label: new Date(entry.timestamp).toLocaleString(),
                                    description: `${entry.totalRows} rows x ${entry.columnCount} cols`,
                                    detail: `Saved ${Math.max(1, Math.round((Date.now() - entry.timestamp) / 60000))} min ago`,
                                    entry
                                })),
                                {
                                    placeHolder: `Version history (${sorted.length} versions)`
                                }
                            );

                            if (picked?.entry) {
                                previewEntry = {
                                    ...picked.entry,
                                    data: cloneRows(picked.entry.data)
                                };

                                webviewPanel.webview.postMessage({
                                    command: 'previewVersion',
                                    versionId: previewEntry.id,
                                    timestamp: previewEntry.timestamp,
                                    headerHtml: buildHeaderHtml(previewEntry.columnCount),
                                    totalRows: previewEntry.totalRows,
                                    columnCount: previewEntry.columnCount,
                                    rows: cloneRows(previewEntry.data),
                                    format: 'tsv'
                                });
                            }
                        } catch (err) {
                            webviewPanel.webview.postMessage({
                                command: 'versionHistoryError',
                                message: `Version history failed: ${String(err)}`
                            });
                        }
                        break;

                    case 'updateRow':
                        if (previewEntry) break;
                        // Update a single row in memory (for edit mode)
                        if (message.rowIndex !== undefined && message.rowData) {
                            allRows[message.rowIndex] = message.rowData;
                        }
                        break;

                    case 'insertRow':
                        if (previewEntry) break;
                        if (message.rowIndex !== undefined) {
                            const newRow = new Array(columnCount).fill('');
                            allRows.splice(message.rowIndex, 0, newRow);
                        }
                        break;

                    case 'deleteRow':
                        if (previewEntry) break;
                        if (message.rowIndex !== undefined) {
                            allRows.splice(message.rowIndex, 1);
                        }
                        break;

                    case 'insertColumn':
                        if (previewEntry) break;
                        if (message.colIndex !== undefined) {
                            columnCount++;
                            for (let i = 0; i < allRows.length; i++) {
                                allRows[i].splice(message.colIndex, 0, '');
                            }
                        }
                        break;

                    case 'deleteColumn':
                        if (previewEntry) break;
                        if (message.colIndex !== undefined) {
                            columnCount--;
                            for (let i = 0; i < allRows.length; i++) {
                                allRows[i].splice(message.colIndex, 1);
                            }
                        }
                        break;

                    case 'deleteCellShiftLeft':
                        if (previewEntry) break;
                        if (message.rowIndex !== undefined && message.colIndex !== undefined) {
                            const row = allRows[message.rowIndex];
                            if (row) {
                                row.splice(message.colIndex, 1);
                                row.push('');
                            }
                        }
                        break;

                    case 'deleteCellShiftUp':
                        if (previewEntry) break;
                        if (message.rowIndex !== undefined && message.colIndex !== undefined) {
                            for (let i = message.rowIndex; i < allRows.length - 1; i++) {
                                if (allRows[i] && allRows[i + 1]) {
                                    allRows[i][message.colIndex] = allRows[i + 1][message.colIndex];
                                }
                            }
                            if (allRows.length > 0) {
                                const lastRow = allRows[allRows.length - 1];
                                if (lastRow) {
                                    lastRow[message.colIndex] = '';
                                }
                            }
                        }
                        break;

                    case 'openExternal':
                        try {
                            const url = typeof message.url === 'string' ? message.url : '';
                            if (url) {
                                await vscode.env.openExternal(vscode.Uri.parse(url));
                            }
                        } catch {
                            // ignore
                        }
                        break;

                    case 'copy':
                        if (typeof message.text === 'string') {
                            await vscode.env.clipboard.writeText(message.text);
                        }
                        break;

                    case 'readClipboard':
                        try {
                            const text = await vscode.env.clipboard.readText();
                            webviewPanel.webview.postMessage({ command: 'clipboardData', text });
                        } catch (err) {
                            console.error('Failed to read clipboard', err);
                        }
                        break;

                    case 'enableAsDefault':
                        try {
                            await vscode.commands.executeCommand('xlsx-viewer.toggleAssociation', { type: 'tsv', enable: true });
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error setting default editor: ${err}`);
                        }
                        break;
                }
            });

            // Forward settings changes
            const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('xlsxViewer.tsv') || e.affectsConfiguration('xlsxViewer') || e.affectsConfiguration('workbench.editorAssociations')) {
                    const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                    const globalCfg = vscode.workspace.getConfiguration('workbench');
                    const associations: any = globalCfg.get('editorAssociations');
                    let isDefault = false;
                    
                    if (associations) {
                        if (Array.isArray(associations)) {
                            isDefault = associations.some(a => 
                                a.viewType === 'xlsxViewer.tsv' && 
                                (a.filenamePattern === '*.tsv' || a.filenamePattern === '**/*.tsv')
                            );
                        } else {
                            isDefault = associations["*.tsv"] === 'xlsxViewer.tsv' || associations["**/*.tsv"] === 'xlsxViewer.tsv';
                        }
                    }

                    const settings = {
                        firstRowIsHeader: cfg.get('tsv.firstRowIsHeader', false),
                        stickyHeader: cfg.get('tsv.stickyHeader', false),
                        stickyToolbar: cfg.get('tsv.stickyToolbar', true),
                        spaciousCells: cfg.get('tsv.spaciousCells', false),
                        isDefaultEditor: isDefault
                    };
                    try { 
                        webviewPanel.webview.postMessage({ command: 'settingsUpdated', settings }); 
                    } catch { }
                }
            });

            // Theme change listener
            const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
                try { 
                    webviewPanel.webview.postMessage({ 
                        type: 'setTheme', 
                        kind: vscode.window.activeColorTheme.kind 
                    }); 
                } catch { }
            });

            webviewPanel.onDidDispose(() => { 
                if (versionSnapshotDebounceTimer) {
                    clearTimeout(versionSnapshotDebounceTimer);
                    versionSnapshotDebounceTimer = null;
                    void persistVersionSnapshot();
                }
                configChangeDisposable.dispose(); 
                themeChangeDisposable.dispose(); 
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error reading TSV file: ${error}`);
        }
    }

    private getWebviewContent(webviewPanel: vscode.WebviewPanel): string {
        const webview = webviewPanel.webview;
        const imgUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'table', 'view.png'));
        const svgUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'table', 'table.svg'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'table', 'tableWebview.js'));
        const themeStyleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'shared', 'theme.css'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'table', 'tableWebview.css'));
        const cspSource = webview.cspSource;

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>TSV Viewer</title>
            <link href="${themeStyleUri}" rel="stylesheet" />
            <link href="${styleUri}" rel="stylesheet" />
            <script>
                window.viewImgUri = "${imgUri}";
                window.logoSvgUri = "${svgUri}";
            </script>
        </head>
        <body>
            <div class="header-background"></div>
            <div class="toolbar" id="toolbar"></div>
            <div id="content">
                <div id="loadingIndicator" class="loading-indicator">Loading TSV...</div>
                <div class="table-scroll" id="tableContainer">
                    <table id="csv-table">
                        <colgroup></colgroup>
                        <thead></thead>
                        <tbody></tbody>
                    </table>
                </div>
            </div>
            <div class="selection-info" id="selectionInfo"></div>
            <noscript>
                <div style="padding: 8px; margin-top: 10px; background: #fff3cd; border: 1px solid #ffeeba;">
                    JavaScript is disabled in this webview, so the TSV table cannot load.
                </div>
            </noscript>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }
}
