import * as vscode from 'vscode';
import * as path from 'path';
import * as Excel from 'exceljs';
import { SpreadsheetEditorProvider } from './spreadsheetEditorProvider';
import { MDEditorProvider } from './mdEditorProvider';
import { StyleStorageService } from './shared/styleStorageService';
import {
    convertTabularFile,
    detectTabularFileType,
    getTabularFileTypeInfo,
    getTargetTabularFileTypes,
    TabularFileType
} from './shared/fileConversionService';

function resolveDocumentUri(uri?: vscode.Uri): vscode.Uri | undefined {
    if (uri instanceof vscode.Uri) {
        return uri;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return activeEditor.document.uri;
    }

    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (activeTab?.input instanceof (vscode as any).TabInputCustom || activeTab?.input instanceof (vscode as any).TabInputText) {
        return (activeTab.input as any).uri;
    }

    return undefined;
}

function getViewTypeForFileType(fileType: TabularFileType): string | undefined {
    if (fileType === 'csv') {
        return 'xlsxViewer.csv';
    }
    if (fileType === 'tsv') {
        return 'xlsxViewer.tsv';
    }
    if (fileType === 'xlsx') {
        return 'xlsxViewer.xlsx';
    }
    return undefined;
}

function parseStyleKey(key: string): { row: number; col: number } | null {
    const [rowText, colText] = key.split(':');
    const row = parseInt(rowText, 10);
    const col = parseInt(colText, 10);
    if (!Number.isFinite(row) || !Number.isFinite(col) || row <= 0 || col <= 0) {
        return null;
    }
    return { row, col };
}

function toARGB(hexOrColor: unknown): string | undefined {
    if (typeof hexOrColor !== 'string') return undefined;
    const value = hexOrColor.trim();
    const hexMatch = value.match(/^#([0-9a-fA-F]{6})$/);
    if (hexMatch) return ('FF' + hexMatch[1]).toUpperCase();

    const rgbMatch = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
        const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10)));
        const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10)));
        const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)));
        return ('FF' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')).toUpperCase();
    }

    return undefined;
}

function parseCssBorderForExcel(value: unknown): { style: Excel.BorderStyle; color?: string } | undefined {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }

    const raw = value.trim();
    const lower = raw.toLowerCase();
    const style: Excel.BorderStyle = lower.includes('double')
        ? 'double'
        : lower.includes('dash')
            ? 'dashed'
            : lower.includes('dot')
                ? 'dotted'
                : lower.includes('3px') || lower.includes('thick')
                    ? 'thick'
                    : lower.includes('2px') || lower.includes('medium')
                        ? 'medium'
                        : 'thin';
    const colorMatch = raw.match(/(#[0-9a-fA-F]{6}|rgba?\([^)]+\))/);
    return {
        style,
        color: colorMatch ? colorMatch[1] : undefined
    };
}

function applyStyleEditToCell(cell: Excel.Cell, styleEdit: any) {
    if (!styleEdit || typeof styleEdit !== 'object') {
        return;
    }

    const bgArgb = toARGB(styleEdit.bgColor || styleEdit.backgroundColor);
    if (bgArgb) {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bgArgb }
        } as Excel.FillPattern;
    }

    const textArgb = toARGB(styleEdit.textColor || styleEdit.color);
    if (textArgb) {
        const currentFont = cell.font || {};
        cell.font = {
            ...currentFont,
            color: { argb: textArgb }
        } as Partial<Excel.Font>;
    }

    const nextFont: any = cell.font ? { ...cell.font } : {};
    let hasFontEdit = false;
    if (typeof styleEdit.fontSize === 'number' && styleEdit.fontSize > 0) {
        nextFont.size = styleEdit.fontSize;
        hasFontEdit = true;
    }
    if (typeof styleEdit.fontFamily === 'string' && styleEdit.fontFamily.trim().length > 0) {
        nextFont.name = styleEdit.fontFamily.trim();
        hasFontEdit = true;
    }
    if (typeof styleEdit.bold === 'boolean') {
        nextFont.bold = styleEdit.bold;
        hasFontEdit = true;
    } else if (typeof styleEdit.fontWeight === 'string') {
        nextFont.bold = styleEdit.fontWeight === 'bold';
        hasFontEdit = true;
    }
    if (typeof styleEdit.italic === 'boolean') {
        nextFont.italic = styleEdit.italic;
        hasFontEdit = true;
    } else if (typeof styleEdit.fontStyle === 'string') {
        nextFont.italic = styleEdit.fontStyle === 'italic';
        hasFontEdit = true;
    }
    if (typeof styleEdit.strike === 'boolean') {
        nextFont.strike = styleEdit.strike;
        hasFontEdit = true;
    } else if (styleEdit.textDecorationLine === 'line-through' || String(styleEdit.textDecoration || '').includes('line-through')) {
        nextFont.strike = true;
        hasFontEdit = true;
    }
    if (hasFontEdit) {
        cell.font = nextFont as Partial<Excel.Font>;
    }

    const nextAlignment: any = cell.alignment ? { ...cell.alignment } : {};
    let hasAlignmentEdit = false;
    const hAlign = typeof styleEdit.horizontalAlign === 'string' ? styleEdit.horizontalAlign : (typeof styleEdit.textAlign === 'string' ? styleEdit.textAlign : '');
    if (hAlign === 'left' || hAlign === 'center' || hAlign === 'right') {
        nextAlignment.horizontal = hAlign;
        hasAlignmentEdit = true;
    }
    const vAlign = typeof styleEdit.verticalAlign === 'string' ? styleEdit.verticalAlign : '';
    if (vAlign === 'top' || vAlign === 'middle' || vAlign === 'bottom') {
        nextAlignment.vertical = vAlign;
        hasAlignmentEdit = true;
    }
    const wrapMode = typeof styleEdit.wrapMode === 'string' ? styleEdit.wrapMode : '';
    if (wrapMode === 'wrap' || wrapMode === 'overflow' || wrapMode === 'clip') {
        nextAlignment.wrapText = wrapMode === 'wrap';
        hasAlignmentEdit = true;
    }
    if (typeof styleEdit.indent === 'number') {
        nextAlignment.indent = Math.max(0, Math.round(styleEdit.indent));
        hasAlignmentEdit = true;
    } else if (typeof styleEdit.paddingLeft === 'string') {
        const indentPx = parseFloat(styleEdit.paddingLeft);
        if (Number.isFinite(indentPx)) {
            nextAlignment.indent = Math.max(0, Math.round(indentPx / 8));
            hasAlignmentEdit = true;
        }
    }
    if (hasAlignmentEdit) {
        cell.alignment = nextAlignment as Partial<Excel.Alignment>;
    }

    if (styleEdit.border) {
        if (styleEdit.border.clear) {
            (cell as any).border = undefined;
        } else {
            const firstCssBorder = parseCssBorderForExcel(styleEdit.border.top)
                || parseCssBorderForExcel(styleEdit.border.right)
                || parseCssBorderForExcel(styleEdit.border.bottom)
                || parseCssBorderForExcel(styleEdit.border.left);
            const borderStyle = typeof styleEdit.border.style === 'string' ? styleEdit.border.style : (firstCssBorder?.style || 'thin');
            const allowedStyles = [
                'thin', 'dotted', 'dashDot', 'hair', 'dashDotDot', 'slantDashDot', 'mediumDashed', 'mediumDashDotDot', 'mediumDashDot', 'medium', 'double', 'thick'
            ];

            let finalBorderStyle = 'thin';
            const sLower = borderStyle.toLowerCase();

            if (sLower.includes('thick') && sLower.includes('dash')) finalBorderStyle = 'mediumDashed';
            else if (sLower.includes('thick') && sLower.includes('dot')) finalBorderStyle = 'mediumDashDot';
            else if (sLower.includes('medium') && sLower.includes('dash')) finalBorderStyle = 'mediumDashed';
            else if (sLower.includes('medium') && sLower.includes('dot')) finalBorderStyle = 'mediumDashDot';
            else if (sLower.includes('dashdotdot')) finalBorderStyle = 'dashDotDot';
            else if (sLower.includes('dashdot')) finalBorderStyle = 'dashDot';
            else if (sLower.includes('dashed') || sLower === 'dashed' || sLower.includes('dash')) finalBorderStyle = 'mediumDashed';
            else if (allowedStyles.includes(borderStyle)) finalBorderStyle = borderStyle;
            else if (sLower === 'thick') finalBorderStyle = 'thick';
            else if (sLower === 'medium') finalBorderStyle = 'medium';
            else if (sLower === 'dotted') finalBorderStyle = 'dotted';
            else if (sLower === 'double') finalBorderStyle = 'double';

            const borderColorArgb = toARGB(styleEdit.border.color || firstCssBorder?.color) || 'FF202124';
            const toEdge = (enabled?: boolean | string) => {
                if (!enabled) return undefined;
                const parsed = parseCssBorderForExcel(enabled);
                if (parsed) {
                    return { style: parsed.style, color: { argb: toARGB(parsed.color || styleEdit.border.color || firstCssBorder?.color) || borderColorArgb } };
                }
                return { style: finalBorderStyle as any, color: { argb: borderColorArgb } };
            };

            cell.border = {
                top: toEdge(styleEdit.border.top),
                right: toEdge(styleEdit.border.right),
                bottom: toEdge(styleEdit.border.bottom),
                left: toEdge(styleEdit.border.left)
            } as any;
        }
    }
}

async function applyStoredStylesToXlsxFile(filePath: string, storedStyles: Record<string, any>): Promise<void> {
    if (!storedStyles || typeof storedStyles !== 'object' || !Object.keys(storedStyles).length) {
        return;
    }

    const workbook = new Excel.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
        return;
    }

    for (const [key, styleEdit] of Object.entries(storedStyles)) {
        const address = parseStyleKey(key);
        if (!address) continue;

        applyStyleEditToCell(worksheet.getRow(address.row).getCell(address.col), styleEdit);
    }

    await workbook.xlsx.writeFile(filePath);
}

export function activate(context: vscode.ExtensionContext) {
    const spreadsheetProvider = new SpreadsheetEditorProvider(context);
    const mdProvider = new MDEditorProvider(context);
    const styleStorage = new StyleStorageService(context);
    const stylePruneIntervalMs = 24 * 60 * 60 * 1000;

    void styleStorage.pruneAllExpiredStyles().catch(() => {
        // Ignore cleanup failures so extension activation is never blocked.
    });

    const stylePruneTimer = setInterval(() => {
        void styleStorage.pruneAllExpiredStyles().catch(() => {
            // Ignore cleanup failures so background maintenance never interrupts editing.
        });
    }, stylePruneIntervalMs);

    context.subscriptions.push(new vscode.Disposable(() => {
        clearInterval(stylePruneTimer);
    }));

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('xlsxViewer.xlsx', spreadsheetProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.csv', spreadsheetProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.tsv', spreadsheetProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.md', mdProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.goBackToTableView', async (uri?: vscode.Uri) => {
            if (uri instanceof vscode.Uri) {
                const path = uri.fsPath.toLowerCase();
                const viewType = path.endsWith('.tsv') ? 'xlsxViewer.tsv' : 'xlsxViewer.csv';
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
                return;
            }

            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const docUri = activeEditor.document.uri;
                const path = docUri.fsPath.toLowerCase();
                if (path.endsWith('.csv')) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.commands.executeCommand('vscode.openWith', docUri, 'xlsxViewer.csv');
                } else if (path.endsWith('.tsv')) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.commands.executeCommand('vscode.openWith', docUri, 'xlsxViewer.tsv');
                }
            } else {
                // Try to get URI from active tab if not a text editor
                const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (activeTab?.input instanceof (vscode as any).TabInputCustom || activeTab?.input instanceof (vscode as any).TabInputText) {
                    const tabUri = (activeTab.input as any).uri;
                    if (tabUri) {
                        const path = tabUri.fsPath.toLowerCase();
                        if (path.endsWith('.csv')) {
                            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                            await vscode.commands.executeCommand('vscode.openWith', tabUri, 'xlsxViewer.csv');
                        } else if (path.endsWith('.tsv')) {
                            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                            await vscode.commands.executeCommand('vscode.openWith', tabUri, 'xlsxViewer.tsv');
                        }
                    }
                }
            }
        }),

        vscode.commands.registerCommand('xlsx-viewer.goBackToXlsxView', async (uri?: vscode.Uri) => {
            if (uri instanceof vscode.Uri) {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await vscode.commands.executeCommand('vscode.openWith', uri, 'xlsxViewer.xlsx');
                return;
            }

            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const docUri = activeEditor.document.uri;
                if (docUri.fsPath.toLowerCase().endsWith('.xlsx')) {
                    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    await vscode.commands.executeCommand('vscode.openWith', docUri, 'xlsxViewer.xlsx');
                }
            } else {
                // Try to get URI from active tab if not a text editor
                const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
                if (activeTab?.input instanceof (vscode as any).TabInputCustom || activeTab?.input instanceof (vscode as any).TabInputText) {
                    const tabUri = (activeTab.input as any).uri;
                    if (tabUri && tabUri.fsPath.toLowerCase().endsWith('.xlsx')) {
                        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                        await vscode.commands.executeCommand('vscode.openWith', tabUri, 'xlsxViewer.xlsx');
                    }
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.goBackToMdPreview', async (uri?: vscode.Uri) => {
            if (uri instanceof vscode.Uri) {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await vscode.commands.executeCommand('vscode.openWith', uri, 'xlsxViewer.md');
                return;
            }

            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                const docUri = activeEditor.document.uri;
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                await vscode.commands.executeCommand('vscode.openWith', docUri, 'xlsxViewer.md');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.toggleAssociation', async (params: { type: 'xlsx' | 'csv' | 'tsv' | 'md', enable: boolean }) => {
            try {
                const { type, enable } = params;
                const patternMap = {
                    'md': '*.md',
                    'xlsx': '*.xlsx',
                    'csv': '*.csv',
                    'tsv': '*.tsv'
                };
                const viewTypeMap = {
                    'md': 'xlsxViewer.md',
                    'xlsx': 'xlsxViewer.xlsx',
                    'csv': 'xlsxViewer.csv',
                    'tsv': 'xlsxViewer.tsv'
                };
                const labelMap = {
                    'md': 'Markdown',
                    'xlsx': 'XLSX',
                    'csv': 'CSV',
                    'tsv': 'TSV'
                };

                const pattern = patternMap[type];
                const viewType = viewTypeMap[type];
                const label = labelMap[type];

                const cfg = vscode.workspace.getConfiguration();
                const associations: any = cfg.get('workbench.editorAssociations') || {};
                let newAssociations: any;

                if (enable) {
                    if (Array.isArray(associations)) {
                        newAssociations = associations.filter(a => a.filenamePattern !== pattern && a.filenamePattern !== `**/${pattern}`);
                        newAssociations.push({ viewType: viewType, filenamePattern: pattern });
                    } else {
                        newAssociations = { ...associations };
                        newAssociations[pattern] = viewType;
                    }
                    await cfg.update('workbench.editorAssociations', newAssociations, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`Spreadsheet Viewer is now set as the default editor for ${label} files.`);
                } else {
                    const inspect = cfg.inspect('workbench.editorAssociations');
                    const targets: Array<{ target: vscode.ConfigurationTarget; value: any }> = [
                        { target: vscode.ConfigurationTarget.Global, value: inspect?.globalValue },
                        { target: vscode.ConfigurationTarget.Workspace, value: inspect?.workspaceValue },
                        { target: vscode.ConfigurationTarget.WorkspaceFolder, value: inspect?.workspaceFolderValue }
                    ];

                    for (const t of targets) {
                        if (!t.value) {
                            continue;
                        }

                        if (Array.isArray(t.value)) {
                            newAssociations = t.value.filter(a => a.viewType !== viewType); // Remove all associations for this viewer
                        } else {
                            newAssociations = { ...t.value };
                            Object.keys(newAssociations).forEach(key => {
                                if (newAssociations[key] === viewType) {
                                    delete newAssociations[key];
                                }
                            });
                        }

                        await cfg.update('workbench.editorAssociations', newAssociations, t.target);
                    }

                    vscode.window.showInformationMessage(`${label} association has been removed from settings.`);
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Error updating association: ${err}`);
            }
        })
    );

    // Keep the old command for backward compatibility if needed, but point it to the new one
    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.toggleMdAssociation', async (enable: boolean) => {
            await vscode.commands.executeCommand('xlsx-viewer.toggleAssociation', { type: 'md', enable });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xlsx-viewer.convertFile', async (uri?: vscode.Uri) => {
            const sourceUri = resolveDocumentUri(uri);
            if (!sourceUri) {
                vscode.window.showWarningMessage('No file is selected for conversion.');
                return;
            }

            if (sourceUri.scheme !== 'file') {
                vscode.window.showErrorMessage('Only local files can be converted.');
                return;
            }

            const sourceType = detectTabularFileType(sourceUri.fsPath);
            if (!sourceType) {
                vscode.window.showErrorMessage('Supported source formats are CSV, TSV, and XLSX.');
                return;
            }

            const targetTypes = getTargetTabularFileTypes(sourceType);
            if (!targetTypes.length) {
                vscode.window.showErrorMessage('No target formats are available for conversion.');
                return;
            }

            const picked = await vscode.window.showQuickPick(
                targetTypes.map(type => {
                    const info = getTabularFileTypeInfo(type);
                    return {
                        label: info.label,
                        description: `.${info.extension}`,
                        type
                    };
                }),
                {
                    title: 'Convert File To',
                    placeHolder: `Choose target format for ${path.basename(sourceUri.fsPath)}`
                }
            );

            if (!picked) {
                return;
            }

            const targetInfo = getTabularFileTypeInfo(picked.type);
            const sourceFilePath = sourceUri.fsPath;
            const parsedSourcePath = path.parse(sourceFilePath);
            const defaultTargetUri = vscode.Uri.file(
                path.join(parsedSourcePath.dir, `${parsedSourcePath.name}.${targetInfo.extension}`)
            );

            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: defaultTargetUri,
                filters: {
                    [targetInfo.label]: [targetInfo.extension]
                }
            });

            if (!targetUri) {
                return;
            }

            const requiredExtension = `.${targetInfo.extension.toLowerCase()}`;
            const requestedPath = targetUri.fsPath;
            const finalTargetPath = path.extname(requestedPath).toLowerCase() === requiredExtension
                ? requestedPath
                : `${requestedPath}${requiredExtension}`;
            const finalTargetUri = vscode.Uri.file(finalTargetPath);

            try {
                const result = await convertTabularFile({
                    sourcePath: sourceFilePath,
                    targetPath: finalTargetPath,
                    sourceType,
                    targetType: picked.type
                });

                if ((sourceType === 'csv' || sourceType === 'tsv') && result.targetType === 'xlsx') {
                    const storedStyles = await styleStorage.getStyles(sourceUri);
                    if (storedStyles) {
                        await applyStoredStylesToXlsxFile(finalTargetPath, storedStyles);
                        await styleStorage.clearStyles(sourceUri);
                    }
                }

                const message = result.droppedSheets
                    ? `Converted to ${targetInfo.label}. Only the first worksheet was kept because ${targetInfo.label} supports a single sheet.`
                    : `Converted to ${targetInfo.label}.`;
                vscode.window.showInformationMessage(message);

                const targetViewType = getViewTypeForFileType(result.targetType);
                if (targetViewType) {
                    await vscode.commands.executeCommand('vscode.openWith', finalTargetUri, targetViewType);
                } else {
                    await vscode.commands.executeCommand('vscode.open', finalTargetUri);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Conversion failed: ${String(error)}`);
            }
        })
    );
}

export function deactivate() { }
