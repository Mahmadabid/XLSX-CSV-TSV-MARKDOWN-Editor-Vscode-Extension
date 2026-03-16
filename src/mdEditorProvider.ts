import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class MDEditorProvider implements vscode.CustomReadonlyEditorProvider {
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
            const documentDirUri = vscode.Uri.file(path.dirname(filePath));
            const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];

            // Set up webview
            webviewPanel.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
                    vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
                    documentDirUri,
                    ...workspaceFolders
                ]
            };
            webviewPanel.webview.html = this.getWebviewContent(webviewPanel);

            // Handle messages from webview
            webviewPanel.webview.onDidReceiveMessage(async message => {
                switch (message.command) {
                    case 'webviewReady':
                        try {
                            // Read the markdown file
                            const content = await fs.promises.readFile(filePath, 'utf-8');

                            // Send content to webview
                            webviewPanel.webview.postMessage({
                                command: 'initMarkdown',
                                content,
                                fileName: vscode.workspace.asRelativePath(document.uri),
                                documentUri: document.uri.toString(),
                                documentDirUri: documentDirUri.toString(),
                                workspaceFolderUri: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() || null
                            });

                            // Calculate if MD is enabled as default
                            const globalCfg = vscode.workspace.getConfiguration('workbench');
                            const associations: any = globalCfg.get('editorAssociations');
                            let isMdEnabled = false;
                            
                            if (associations) {
                                if (Array.isArray(associations)) {
                                    isMdEnabled = associations.some(a => a.viewType === 'xlsxViewer.md' && (a.filenamePattern === '*.md' || a.filenamePattern === '**/*.md'));
                                } else {
                                    isMdEnabled = associations["*.md"] === 'xlsxViewer.md' || associations["**/*.md"] === 'xlsxViewer.md';
                                }
                            }

                            // Send settings
                            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                            const settings = {
                                stickyToolbar: cfg.get('md.stickyToolbar', true),
                                wordWrap: cfg.get('md.wordWrap', true),
                                syncScroll: cfg.get('md.syncScroll', true),
                                previewPosition: cfg.get('md.previewPosition', 'right'),
                                showOutline: cfg.get('md.showOutline', true),
                                showLineNumbers: cfg.get('md.showLineNumbers', true),
                                isMdEnabled: isMdEnabled
                            };
                            webviewPanel.webview.postMessage({ command: 'initSettings', settings });

                            // Send theme
                            webviewPanel.webview.postMessage({
                                type: 'setTheme',
                                kind: vscode.window.activeColorTheme.kind
                            });
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error reading Markdown file: ${err}`);
                        }
                        break;

                    case 'resolveImageUris':
                        try {
                            const requestedSources = Array.isArray(message.sources) ? message.sources : [];
                            const resolved: Record<string, string> = {};

                            for (const source of requestedSources) {
                                if (typeof source !== 'string') {
                                    continue;
                                }

                                const trimmed = source.trim();
                                if (!trimmed) {
                                    continue;
                                }

                                const resolvedUri = this.resolveMarkdownImageUri(trimmed, document.uri, webviewPanel.webview);
                                if (resolvedUri) {
                                    resolved[trimmed] = resolvedUri;
                                }
                            }

                            webviewPanel.webview.postMessage({
                                command: 'resolvedImageUris',
                                resolved
                            });
                        } catch (err) {
                            console.error('Failed resolving markdown image URIs:', err);
                        }
                        break;

                    case 'updateSettings':
                        try {
                            const s = message.settings || {};
                            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                            await cfg.update('md.stickyToolbar', !!s.stickyToolbar, vscode.ConfigurationTarget.Global);
                            await cfg.update('md.wordWrap', !!s.wordWrap, vscode.ConfigurationTarget.Global);
                            await cfg.update('md.syncScroll', !!s.syncScroll, vscode.ConfigurationTarget.Global);
                            await cfg.update('md.previewPosition', s.previewPosition || 'right', vscode.ConfigurationTarget.Global);
                            if (typeof s.showOutline === 'boolean') {
                                await cfg.update('md.showOutline', !!s.showOutline, vscode.ConfigurationTarget.Global);
                            }
                            if (typeof s.showLineNumbers === 'boolean') {
                                await cfg.update('md.showLineNumbers', !!s.showLineNumbers, vscode.ConfigurationTarget.Global);
                            }
                        } catch (err) {
                            console.error('Failed to persist settings:', err);
                        }
                        break;

                    case 'toggleView':
                        if (!message.isPreviewView) {
                            await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
                            webviewPanel.dispose();
                        }
                        break;

                    case 'saveMarkdown':
                        try {
                            const text = typeof message.text === 'string' ? message.text : '';
                            await vscode.workspace.fs.writeFile(document.uri, Buffer.from(text, 'utf8'));
                            webviewPanel.webview.postMessage({ command: 'saveResult', ok: true });
                        } catch (err) {
                            webviewPanel.webview.postMessage({ command: 'saveResult', ok: false, error: String(err) });
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

                    case 'disableMdEditor':
                        try {
                            const result = await vscode.window.showWarningMessage(
                                "Are you sure you want to disable XLSX Viewer for all Markdown files? You will be prompted to select a new default editor.",
                                "Yes, Disable",
                                "Cancel"
                            );

                            if (result === "Yes, Disable") {
                                // 1. First remove our association so it's not the default anymore
                                await vscode.commands.executeCommand('xlsx-viewer.toggleMdAssociation', false);
                                
                                // 2. Trigger the "Reopen With..." picker which allows selecting a new default
                                // We use this command as it is more widely available than changeDefaultViewType
                                await vscode.commands.executeCommand('workbench.action.reopenWithEditor');
                            }
                        } catch (err) {
                            vscode.window.showErrorMessage(`Error disabling MD editor: ${err}`);
                        }
                        break;
                    
                    case 'enableMdEditor':
                        try {
                            await vscode.commands.executeCommand('xlsx-viewer.toggleMdAssociation', true);
                            
                             // Send updated settings
                             const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                             const settings = {
                                 stickyToolbar: cfg.get('md.stickyToolbar', true),
                                 wordWrap: cfg.get('md.wordWrap', true),
                                 syncScroll: cfg.get('md.syncScroll', true),
                                 previewPosition: cfg.get('md.previewPosition', 'right'),
                                 showOutline: cfg.get('md.showOutline', true),
                                 showLineNumbers: cfg.get('md.showLineNumbers', true),
                                 isMdEnabled: true
                             };
                             webviewPanel.webview.postMessage({ command: 'initSettings', settings });

                        } catch (err) {
                            vscode.window.showErrorMessage(`Error enabling MD editor: ${err}`);
                        }
                        break;
                    
                    case 'toggleMdAssociation':
                        await vscode.commands.executeCommand('xlsx-viewer.toggleMdAssociation', !!message.enable);
                        break;
                }
            });

            // Forward settings changes
            const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('xlsxViewer.md') || e.affectsConfiguration('xlsxViewer') || e.affectsConfiguration('workbench.editorAssociations')) {
                    const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                    const globalCfg = vscode.workspace.getConfiguration('workbench');
                    const associations: any = globalCfg.get('editorAssociations');
                    let isMdEnabled = false;
                    
                    if (associations) {
                        if (Array.isArray(associations)) {
                            isMdEnabled = associations.some(a => a.viewType === 'xlsxViewer.md' && (a.filenamePattern === '*.md' || a.filenamePattern === '**/*.md'));
                        } else {
                            isMdEnabled = associations["*.md"] === 'xlsxViewer.md' || associations["**/*.md"] === 'xlsxViewer.md';
                        }
                    }

                    const settings = {
                        stickyToolbar: cfg.get('md.stickyToolbar', true),
                        wordWrap: cfg.get('md.wordWrap', true),
                        syncScroll: cfg.get('md.syncScroll', true),
                        previewPosition: cfg.get('md.previewPosition', 'right'),
                        showOutline: cfg.get('md.showOutline', true),
                        showLineNumbers: cfg.get('md.showLineNumbers', true),
                        isMdEnabled: isMdEnabled
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
                configChangeDisposable.dispose();
                themeChangeDisposable.dispose();
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Error reading Markdown file: ${error}`);
        }
    }

    private getWebviewContent(webviewPanel: vscode.WebviewPanel): string {
        const webview = webviewPanel.webview;
        const imgUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'md', 'view.png'));
        const svgUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'md', 'logo.svg'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'md', 'mdWebview.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'md', 'mdWebview.css'));
        const themeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'shared', 'theme.css'));
        const highlightUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'md', 'highlight.css'));
        const cspSource = webview.cspSource;

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Markdown Viewer</title>
            <link href="${themeUri}" rel="stylesheet" />
            <link href="${styleUri}" rel="stylesheet" />
            <link href="${highlightUri}" rel="stylesheet" />
            <script>
                window.viewImgUri = "${imgUri}";
                window.logoSvgUri = "${svgUri}";
            </script>
        </head>
        <body>
            <div id="readingProgressBar" class="reading-progress-bar"></div>
            <div class="header-background"></div>
            <div class="toolbar" id="toolbar"></div>

            <div id="formattingToolbar" class="formatting-toolbar hidden">
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="bold" title="Bold (Ctrl+B)"></button>
                    <button class="fmt-btn" data-format="italic" title="Italic (Ctrl+I)"></button>
                    <button class="fmt-btn" data-format="strikethrough" title="Strikethrough (Ctrl+Shift+X)"></button>
                    <button class="fmt-btn" data-format="inlineCode" title="Inline Code (Ctrl+E)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="heading1" title="Heading 1 (Ctrl+1)"></button>
                    <button class="fmt-btn" data-format="heading2" title="Heading 2 (Ctrl+2)"></button>
                    <button class="fmt-btn" data-format="heading3" title="Heading 3 (Ctrl+3)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="bulletList" title="Bullet List (Ctrl+L)"></button>
                    <button class="fmt-btn" data-format="orderedList" title="Ordered List (Ctrl+Shift+L)"></button>
                    <button class="fmt-btn" data-format="checkbox" title="Checkbox List"></button>
                    <button class="fmt-btn" data-format="blockquote" title="Blockquote"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="link" title="Insert Link (Ctrl+K)"></button>
                    <button class="fmt-btn" data-format="image" title="Insert Image"></button>
                    <button class="fmt-btn" data-format="table" title="Insert Table"></button>
                    <button class="fmt-btn" data-format="codeBlock" title="Code Block (Ctrl+Shift+E)"></button>
                    <button class="fmt-btn" data-format="hr" title="Horizontal Rule"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="undo" title="Undo (Ctrl+Z)"></button>
                    <button class="fmt-btn" data-format="redo" title="Redo (Ctrl+Shift+Z)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="duplicateLine" title="Duplicate Line (Ctrl+Shift+D)"></button>
                    <button class="fmt-btn" data-format="deleteLine" title="Delete Line (Ctrl+Shift+K)"></button>
                    <button class="fmt-btn" data-format="moveUp" title="Move Line Up (Alt+&#x2191;)"></button>
                    <button class="fmt-btn" data-format="moveDown" title="Move Line Down (Alt+&#x2193;)"></button>
                </div>
                <div class="fmt-sep"></div>
                <div class="fmt-group">
                    <button class="fmt-btn" data-format="uppercase" title="UPPERCASE (Ctrl+Shift+U)"></button>
                    <button class="fmt-btn" data-format="lowercase" title="lowercase (Ctrl+U)"></button>
                    <button class="fmt-btn" data-format="titlecase" title="Title Case"></button>
                    <button class="fmt-btn" data-format="sortLines" title="Sort Lines A-Z"></button>
                    <button class="fmt-btn" data-format="trimWhitespace" title="Trim Trailing Whitespace"></button>
                    <button class="fmt-btn" data-format="jumpToLine" title="Go to Line (Ctrl+G)"></button>
                </div>
            </div>

            <div id="searchOverlay" class="search-overlay">
                <div class="search-bar">
                    <input type="text" id="searchInput" class="search-input" placeholder="Search in preview..." autocomplete="off" />
                    <span id="searchCount" class="search-count"></span>
                    <button id="searchPrev" class="search-nav-btn" title="Previous (Shift+Enter)">&#9650;</button>
                    <button id="searchNext" class="search-nav-btn" title="Next (Enter)">&#9660;</button>
                    <button id="searchClose" class="search-close-btn" title="Close (Esc)">&times;</button>
                </div>
            </div>

            <div id="content">
                <div id="loadingIndicator" class="loading-indicator">Loading Markdown...</div>
                <div class="markdown-container" id="markdownContainer">
                    <aside id="tocPanel" class="toc-panel hidden" aria-label="Outline">
                        <div class="toc-header">
                            <span class="toc-title">Outline</span>
                            <button id="tocCloseButton" class="toc-close" title="Hide outline">x</button>
                        </div>
                        <div id="tocBody" class="toc-body"></div>
                    </aside>
                    <div class="editor-wrapper">
                        <textarea id="markdownEditor" class="markdown-editor" spellcheck="false"></textarea>
                    </div>
                    <div id="markdownPreview" class="markdown-preview"></div>
                </div>
            </div>

            <div class="status-info" id="statusInfo"></div>

            <div id="lightboxOverlay" class="lightbox-overlay">
                <button id="lightboxClose" class="lightbox-close">&times;</button>
                <img id="lightboxImage" class="lightbox-image" />
            </div>

            <noscript>
                <div style="padding: 8px; margin-top: 10px; background: #fff3cd; border: 1px solid #ffeeba;">
                    JavaScript is disabled in this webview, so the Markdown preview cannot load.
                </div>
            </noscript>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }

    private resolveMarkdownImageUri(rawSource: string, documentUri: vscode.Uri, webview: vscode.Webview): string | null {
        if (!rawSource || /^https?:\/\//i.test(rawSource) || /^data:/i.test(rawSource) || /^#/.test(rawSource)) {
            return null;
        }

        // Keep query/hash on final URL after converting the base file URI.
        const match = rawSource.match(/^([^?#]*)([?#].*)?$/);
        const sourcePath = (match?.[1] || '').trim();
        const suffix = match?.[2] || '';
        if (!sourcePath) {
            return null;
        }

        const normalized = sourcePath.replace(/\\/g, '/');

        try {
            if (/^file:/i.test(normalized)) {
                return webview.asWebviewUri(vscode.Uri.parse(normalized)).toString() + suffix;
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri)?.uri;

            if (/^\//.test(normalized) && workspaceFolder) {
                const rel = normalized.replace(/^\/+/, '');
                const absolute = path.join(workspaceFolder.fsPath, rel);
                return webview.asWebviewUri(vscode.Uri.file(absolute)).toString() + suffix;
            }

            if (path.isAbsolute(normalized)) {
                return webview.asWebviewUri(vscode.Uri.file(normalized)).toString() + suffix;
            }

            const absolute = path.resolve(path.dirname(documentUri.fsPath), normalized);
            return webview.asWebviewUri(vscode.Uri.file(absolute)).toString() + suffix;
        } catch {
            return null;
        }
    }
}