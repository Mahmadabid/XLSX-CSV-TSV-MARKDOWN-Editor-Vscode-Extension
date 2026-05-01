import * as vscode from 'vscode';

export function getWebviewContent(webviewPanel: vscode.WebviewPanel, context: vscode.ExtensionContext): string {
        const webview = webviewPanel.webview;

        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'spreadsheet', 'spreadsheetWebview.js')
        );
        const themeStyleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'resources', 'shared', 'theme.css')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'resources', 'spreadsheet', 'spreadsheetWebview.css')
        );
        const feedbackStyleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'resources', 'shared', 'feedback.css')
        );
        const imgUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'resources', 'spreadsheet', 'spreadsheetView.png')
        );
        const svgUri = webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'resources', 'spreadsheet', 'spreadsheet.svg')
        );
        const cspSource = webview.cspSource;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Spreadsheet Viewer</title>
    <link href="${themeStyleUri}" rel="stylesheet" />
    <link href="${styleUri}" rel="stylesheet" />
    <link href="${feedbackStyleUri}" rel="stylesheet" />
    <script>
        window.viewImgUri = "${imgUri}";
        window.logoSvgUri = "${svgUri}";
    </script>
</head>
<body>
    <div class="header-background"></div>

    <div class="loading-overlay" id="loadingOverlay">
        <div class="spinner"></div>
        <div class="loading-text">Rendering worksheet...</div>
    </div>

    <div class="toolbar-wrapper"><div class="toolbar" id="toolbar"></div></div>
    <div id="content">
        <div id="tableContainer"></div>
    </div>
    <div class="selection-info" id="selectionInfo"></div>
    <div class="resize-indicator" id="resizeIndicator"></div>

    <noscript>
        <div style="padding: 8px; margin-top: 10px; background: #fff3cd; border: 1px solid #ffeeba;">
            JavaScript is disabled in this webview, so the spreadsheet table cannot load.
        </div>
    </noscript>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
