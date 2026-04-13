import * as vscode from 'vscode';
import * as path from 'path';
import { XLSXEditorProvider } from './xlsxEditorProvider';
import { CSVEditorProvider } from './csvEditorProvider';
import { TSVEditorProvider } from './tsvEditorProvider';
import { MDEditorProvider } from './mdEditorProvider';
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

export function activate(context: vscode.ExtensionContext) {
    const xlsxProvider = new XLSXEditorProvider(context);
    const csvProvider = new CSVEditorProvider(context);
    const tsvProvider = new TSVEditorProvider(context);
    const mdProvider = new MDEditorProvider(context);

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider('xlsxViewer.xlsx', xlsxProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.csv', csvProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            },
            supportsMultipleEditorsPerDocument: false
        }),
        vscode.window.registerCustomEditorProvider('xlsxViewer.tsv', tsvProvider, {
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
                    vscode.window.showInformationMessage(`XLSX Viewer is now set as the default editor for ${label} files.`);
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