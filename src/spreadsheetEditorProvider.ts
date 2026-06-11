import { getWebviewContent } from './spreadsheet/spreadsheetHtmlRenderer';
import * as vscode from 'vscode';
import * as Excel from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { VERSION_HISTORY_RETENTION_MS, buildGroupedVersionHistoryItems as buildSharedVersionHistoryItems, formatVersionHistoryTimestamp, getVersionHistoryDir } from './shared/versionHistory';
import { convertARGBToRGBA, isShadeOfBlack, isShadeOfWhite } from './spreadsheet/spreadsheetUtilities';
import { convertTabularFile, readTabularFile, detectTabularFileType, writeTabularFile, TabularFileType } from './shared/fileConversionService';
import { StyleStorageService } from './shared/styleStorageService';

function borderEditToCssValue(enabled: boolean, style?: string, color?: string): string {
    if (!enabled) return '';

    const normalizedStyle = String(style || 'thin');
    const lower = normalizedStyle.toLowerCase();
    const width = lower.includes('thick')
        ? '3px'
        : lower.includes('medium')
            ? '2px'
            : '1px';
    const pattern = lower.includes('double')
        ? 'double'
        : lower.includes('dash')
            ? 'dashed'
            : lower.includes('dot') || lower === 'hair'
                ? 'dotted'
                : 'solid';

    return `${width} ${pattern} ${color || '#202124'}`;
}

function normalizeBorderForRender(border: any): any {
    if (!border || typeof border !== 'object' || border.clear) {
        return undefined;
    }

    const color = typeof border.color === 'string' ? border.color : '#202124';
    const lineStyle = typeof border.style === 'string' ? border.style : 'thin';
    const normalized: any = {};

    (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
        const value = border[side];
        if (typeof value === 'string' && value.trim()) {
            normalized[side] = value;
        } else if (value === true) {
            normalized[side] = borderEditToCssValue(true, lineStyle, color);
        }
    });

    return Object.keys(normalized).length > 0 ? normalized : undefined;
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

/**
 * Normalize stored style format to CSS-renderable properties.
 * Stored format: { bold: true, italic: false, textColor: '#000000', ... }
 * CSS format: { fontWeight: 'bold', fontStyle: 'italic', color: '#000000', ... }
 */
function normalizeStoredStyle(stored: any): any {
    if (!stored || typeof stored !== 'object') {
        return {};
    }

    const normalized: any = {};

    const copyCssProp = (prop: string) => {
        if (stored[prop] !== undefined) {
            normalized[prop] = stored[prop];
        }
    };

    copyCssProp('fontWeight');
    copyCssProp('fontStyle');
    copyCssProp('color');
    copyCssProp('backgroundColor');
    copyCssProp('fontSize');
    copyCssProp('fontFamily');
    copyCssProp('textAlign');
    copyCssProp('verticalAlign');
    copyCssProp('whiteSpace');
    copyCssProp('wordWrap');
    copyCssProp('overflow');
    copyCssProp('textOverflow');
    copyCssProp('paddingLeft');
    copyCssProp('textDecoration');
    copyCssProp('textDecorationLine');
    copyCssProp('textDecorationThickness');
    copyCssProp('textDecorationSkipInk');

    if (stored.bgColor && typeof stored.bgColor === 'string') {
        normalized.backgroundColor = stored.bgColor;
    }

    // Font weight normalization
    if (stored.bold !== undefined) {
        normalized.fontWeight = stored.bold ? 'bold' : 'normal';
    }

    // Font style normalization
    if (stored.italic !== undefined) {
        normalized.fontStyle = stored.italic ? 'italic' : 'normal';
    }

    // Text decoration normalization
    if (stored.strike !== undefined) {
        if (stored.strike) {
            normalized.textDecorationLine = 'line-through';
            normalized.textDecorationThickness = '2px';
            normalized.textDecorationSkipInk = 'none';
        } else {
            normalized.textDecoration = '';
            normalized.textDecorationLine = '';
        }
    }

    // Color normalization
    if (stored.textColor && typeof stored.textColor === 'string') {
        normalized.color = stored.textColor;
    }

    if (stored.color && typeof stored.color === 'string') {
        normalized.color = stored.color;
    }

    // Background color normalization
    if (stored.backgroundColor && typeof stored.backgroundColor === 'string') {
        normalized.backgroundColor = stored.backgroundColor;
    }

    // Font size normalization
    if (stored.fontSize && typeof stored.fontSize === 'number') {
        normalized.fontSize = stored.fontSize + 'pt';
    }

    // Font family normalization
    if (stored.fontFamily && typeof stored.fontFamily === 'string') {
        normalized.fontFamily = stored.fontFamily;
    }

    // Text alignment normalization
    if (stored.horizontalAlign && typeof stored.horizontalAlign === 'string') {
        normalized.textAlign = stored.horizontalAlign;
    }

    // Vertical alignment normalization
    if (stored.verticalAlign && typeof stored.verticalAlign === 'string') {
        normalized.verticalAlign = stored.verticalAlign;
    }

    // Wrap mode normalization
    if (stored.wrapMode && typeof stored.wrapMode === 'string') {
        if (stored.wrapMode === 'wrap') {
            normalized.whiteSpace = 'pre-wrap';
            normalized.wordWrap = 'break-word';
            normalized.overflow = 'visible';
            normalized.textOverflow = 'clip';
        } else if (stored.wrapMode === 'overflow') {
            normalized.whiteSpace = 'nowrap';
            normalized.wordWrap = 'normal';
            normalized.overflow = 'visible';
            normalized.textOverflow = 'clip';
        } else if (stored.wrapMode === 'clip') {
            normalized.whiteSpace = 'nowrap';
            normalized.wordWrap = 'normal';
            normalized.overflow = 'hidden';
            normalized.textOverflow = 'clip';
        }
    }

    // Indent normalization
    if (stored.indent && typeof stored.indent === 'number') {
        normalized.paddingLeft = stored.indent * 8 + 'px';
    }

    const renderBorder = normalizeBorderForRender(stored.border);
    if (renderBorder) {
        normalized.border = renderBorder;
    }

    return normalized;
}

export class SpreadsheetEditorProvider implements vscode.CustomReadonlyEditorProvider {
    private readonly styleStorage: StyleStorageService;
    constructor(private readonly context: vscode.ExtensionContext) {
        this.styleStorage = new StyleStorageService(context);
    }

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
        const webview = webviewPanel.webview;

        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, 'resources'),
                vscode.Uri.joinPath(this.context.extensionUri, 'dist')
            ]
        };

        // Set the webview shell immediately; it will show its own loading overlay.
        webview.html = getWebviewContent(webviewPanel, this.context);

        let isWebviewReady = false;
        // Store parsed worksheet data for virtualization
        let worksheetsData: any[] = [];
        let rowHeaderWidth = 40;
        const filePath = document.uri.fsPath;
        let currentFileType: TabularFileType = detectTabularFileType(filePath) || 'xlsx';
        let hasActiveTemporaryStyles = false;
        let shouldOpenDelimitedInStyledMode = false;
        let currentIsPlainView = false;
        let isSaving = false;
        let lastSaveTime = 0;

        type VersionHistoryEntry = {
            id: string;
            timestamp: number;
            fileName: string;
            byteSize: number;
            hash: string;
            fileType: TabularFileType;
            snapshotFile: string;
        };

        let previewVersionId: string | null = null;
        let previewVersionTimestamp: number | null = null;
        let restoredVersionId: string | null = null;

        const getHistoryDir = () => {
            return getVersionHistoryDir(this.context.globalStorageUri.fsPath, filePath, currentFileType);
        };

        const getHistoryIndexPath = () => path.join(getHistoryDir(), 'index.json');
        const getSnapshotPath = (snapshotFile: string) => path.join(getHistoryDir(), snapshotFile);
        const getSnapshotFileType = (snapshotFile: string, fallbackType: TabularFileType): TabularFileType => {
            const extension = path.extname(snapshotFile).toLowerCase().replace(/^\./, '');
            if (extension === 'csv' || extension === 'tsv' || extension === 'xlsx') {
                return extension;
            }

            return fallbackType;
        };

        const parseStyleKey = (key: string): { row: number; col: number } | null => {
            const [rowText, colText] = key.split(':');
            const row = parseInt(rowText, 10);
            const col = parseInt(colText, 10);
            if (!Number.isFinite(row) || !Number.isFinite(col) || row <= 0 || col <= 0) {
                return null;
            }
            return { row, col };
        };

        const toARGB = (hexOrColor: unknown): string | undefined => {
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
        };

        const applyStyleEditToCell = (cell: Excel.Cell, styleEdit: any) => {
            if (!styleEdit || typeof styleEdit !== 'object') {
                return;
            }

            if (styleEdit.clearFormatting) {
                (cell as any).fill = undefined;
                (cell as any).font = undefined;
                (cell as any).alignment = undefined;
                (cell as any).border = undefined;
            }

            const bgArgb = toARGB(styleEdit.bgColor);
            if (bgArgb) {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: bgArgb }
                } as Excel.FillPattern;
            }

            const textArgb = toARGB(styleEdit.textColor);
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
            }
            if (typeof styleEdit.italic === 'boolean') {
                nextFont.italic = styleEdit.italic;
                hasFontEdit = true;
            }
            if (typeof styleEdit.strike === 'boolean') {
                nextFont.strike = styleEdit.strike;
                hasFontEdit = true;
            }
            if (hasFontEdit) {
                cell.font = nextFont as Partial<Excel.Font>;
            }

            const nextAlignment: any = cell.alignment ? { ...cell.alignment } : {};
            let hasAlignmentEdit = false;
            const hAlign = typeof styleEdit.horizontalAlign === 'string' ? styleEdit.horizontalAlign : '';
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
            }
            if (hasAlignmentEdit) {
                cell.alignment = nextAlignment as Partial<Excel.Alignment>;
            }

            if (styleEdit.border) {
                if (styleEdit.border.clear) {
                    (cell as any).border = undefined;
                } else {
                    const borderStyle = typeof styleEdit.border.style === 'string' ? styleEdit.border.style : 'thin';
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

                    const borderColorArgb = toARGB(styleEdit.border.color) || 'FF202124';
                    const toEdge = (enabled?: boolean) => {
                        if (!enabled) return undefined;
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
        };

        const applyStoredStylesToWorksheet = (worksheet: Excel.Worksheet, storedStyles: Record<string, any>) => {
            if (!storedStyles || typeof storedStyles !== 'object') {
                return;
            }

            for (const [key, styleEdit] of Object.entries(storedStyles)) {
                const address = parseStyleKey(key);
                if (!address) continue;

                const cell = worksheet.getRow(address.row).getCell(address.col);
                const cssStyle = normalizeStoredStyle(styleEdit);
                if (cssStyle.backgroundColor) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: toARGB(cssStyle.backgroundColor) || 'FFFFFFFF' }
                    } as Excel.FillPattern;
                }

                const currentFont = cell.font ? { ...cell.font } : {};
                let hasFontEdit = false;
                if (cssStyle.fontWeight) {
                    currentFont.bold = cssStyle.fontWeight === 'bold';
                    hasFontEdit = true;
                }
                if (cssStyle.fontStyle) {
                    currentFont.italic = cssStyle.fontStyle === 'italic';
                    hasFontEdit = true;
                }
                if (cssStyle.color) {
                    currentFont.color = { argb: toARGB(cssStyle.color) || 'FF000000' };
                    hasFontEdit = true;
                }
                if (cssStyle.fontSize) {
                    const parsedSize = parseFloat(cssStyle.fontSize);
                    if (Number.isFinite(parsedSize) && parsedSize > 0) {
                        currentFont.size = parsedSize;
                        hasFontEdit = true;
                    }
                }
                if (cssStyle.fontFamily) {
                    currentFont.name = cssStyle.fontFamily;
                    hasFontEdit = true;
                }
                if (cssStyle.textDecorationLine === 'line-through' || String(cssStyle.textDecoration || '').includes('line-through')) {
                    currentFont.strike = true;
                    hasFontEdit = true;
                }
                if (hasFontEdit) {
                    cell.font = currentFont as Partial<Excel.Font>;
                }

                const currentAlignment: any = cell.alignment ? { ...cell.alignment } : {};
                let hasAlignmentEdit = false;
                if (cssStyle.textAlign) {
                    currentAlignment.horizontal = cssStyle.textAlign;
                    hasAlignmentEdit = true;
                }
                if (cssStyle.verticalAlign) {
                    currentAlignment.vertical = cssStyle.verticalAlign;
                    hasAlignmentEdit = true;
                }
                if (typeof cssStyle.whiteSpace === 'string') {
                    currentAlignment.wrapText = cssStyle.whiteSpace === 'pre-wrap';
                    hasAlignmentEdit = true;
                }
                if (cssStyle.paddingLeft) {
                    const indentPx = parseFloat(cssStyle.paddingLeft);
                    if (Number.isFinite(indentPx)) {
                        currentAlignment.indent = Math.max(0, Math.round(indentPx / 8));
                        hasAlignmentEdit = true;
                    }
                }
                if (hasAlignmentEdit) {
                    cell.alignment = currentAlignment as Partial<Excel.Alignment>;
                }

                if (cssStyle.border) {
                    const border = cssStyle.border as any;
                    const toEdge = (value: unknown) => {
                        const parsed = parseCssBorderForExcel(value);
                        if (!parsed) return undefined;
                        return {
                            style: parsed.style,
                            color: { argb: toARGB(parsed.color || cssStyle.color || '#202124') || 'FF202124' }
                        };
                    };
                    cell.border = {
                        top: toEdge(border.top),
                        right: toEdge(border.right),
                        bottom: toEdge(border.bottom),
                        left: toEdge(border.left)
                    } as any;
                }
            }
        };

        const remapStylesForOperation = (styles: Record<string, any>, op: any): Record<string, any> => {
            const type = typeof op?.type === 'string' ? op.type : '';
            const index = typeof op?.index === 'number' ? op.index : 0;
            const row = typeof op?.row === 'number' ? op.row : 0;
            const col = typeof op?.col === 'number' ? op.col : 0;

            if (!type) {
                return styles;
            }

            const remapped: Record<string, any> = {};

            for (const [key, value] of Object.entries(styles)) {
                const address = parseStyleKey(key);
                if (!address) continue;

                let nextRow = address.row;
                let nextCol = address.col;
                let keep = true;

                switch (type) {
                    case 'insertRowAbove':
                        if (address.row >= index) nextRow = address.row + 1;
                        break;
                    case 'insertRowBelow':
                        if (address.row > index) nextRow = address.row + 1;
                        break;
                    case 'deleteRow':
                        if (address.row === index) {
                            keep = false;
                        } else if (address.row > index) {
                            nextRow = address.row - 1;
                        }
                        break;
                    case 'insertColumnLeft':
                        if (address.col >= index) nextCol = address.col + 1;
                        break;
                    case 'insertColumnRight':
                        if (address.col > index) nextCol = address.col + 1;
                        break;
                    case 'deleteColumn':
                        if (address.col === index) {
                            keep = false;
                        } else if (address.col > index) {
                            nextCol = address.col - 1;
                        }
                        break;
                    case 'insertCellShiftRight':
                        if (address.row === row && address.col >= col) {
                            nextCol = address.col + 1;
                        }
                        break;
                    case 'insertCellShiftDown':
                        if (address.col === col && address.row >= row) {
                            nextRow = address.row + 1;
                        }
                        break;
                    case 'deleteCellShiftLeft':
                        if (address.row === row && address.col === col) {
                            keep = false;
                        } else if (address.row === row && address.col > col) {
                            nextCol = address.col - 1;
                        }
                        break;
                    case 'deleteCellShiftUp':
                        if (address.col === col && address.row === row) {
                            keep = false;
                        } else if (address.col === col && address.row > row) {
                            nextRow = address.row - 1;
                        }
                        break;
                    default:
                        break;
                }

                if (keep) {
                    remapped[`${nextRow}:${nextCol}`] = value;
                }
            }

            return remapped;
        };

        const remapMergesForOperation = (
            merges: { startRow: number; startCol: number; endRow: number; endCol: number }[],
            op: any
        ): { startRow: number; startCol: number; endRow: number; endCol: number }[] => {
            const type = typeof op?.type === 'string' ? op.type : '';
            const index = typeof op?.index === 'number' ? op.index : 0;
            const row = typeof op?.row === 'number' ? op.row : 0;
            const col = typeof op?.col === 'number' ? op.col : 0;

            if (!type) {
                return merges;
            }

            const remapped: { startRow: number; startCol: number; endRow: number; endCol: number }[] = [];

            for (const merge of merges) {
                let { startRow, startCol, endRow, endCol } = merge;
                let keep = true;

                switch (type) {
                    case 'insertRowAbove':
                        if (startRow >= index) startRow += 1;
                        if (endRow >= index) endRow += 1;
                        break;
                    case 'insertRowBelow':
                        if (startRow > index) startRow += 1;
                        if (endRow > index) endRow += 1;
                        break;
                    case 'deleteRow':
                        if (startRow === index && endRow === index) {
                            keep = false;
                        } else {
                            if (startRow > index) {
                                startRow -= 1;
                            }
                            if (endRow >= index) {
                                endRow -= 1;
                            }
                            if (endRow < startRow) {
                                keep = false;
                            }
                        }
                        break;
                    case 'insertColumnLeft':
                        if (startCol >= index) startCol += 1;
                        if (endCol >= index) endCol += 1;
                        break;
                    case 'insertColumnRight':
                        if (startCol > index) startCol += 1;
                        if (endCol > index) endCol += 1;
                        break;
                    case 'deleteColumn':
                        if (startCol === index && endCol === index) {
                            keep = false;
                        } else {
                            if (startCol > index) {
                                startCol -= 1;
                            }
                            if (endCol >= index) {
                                endCol -= 1;
                            }
                            if (endCol < startCol) {
                                keep = false;
                            }
                        }
                        break;
                    case 'insertCellShiftRight':
                        if (row >= startRow && row <= endRow && col <= endCol) {
                            if (col <= startCol) {
                                startCol += 1;
                                endCol += 1;
                            } else {
                                keep = false;
                            }
                        }
                        break;
                    case 'insertCellShiftDown':
                        if (col >= startCol && col <= endCol && row <= endRow) {
                            if (row <= startRow) {
                                startRow += 1;
                                endRow += 1;
                            } else {
                                keep = false;
                            }
                        }
                        break;
                    case 'deleteCellShiftLeft':
                        if (row >= startRow && row <= endRow && col <= endCol) {
                            if (col < startCol) {
                                startCol -= 1;
                                endCol -= 1;
                            } else {
                                keep = false;
                            }
                        }
                        break;
                    case 'deleteCellShiftUp':
                        if (col >= startCol && col <= endCol && row <= endRow) {
                            if (row < startRow) {
                                startRow -= 1;
                                endRow -= 1;
                            } else {
                                keep = false;
                            }
                        }
                        break;
                    default:
                        break;
                }

                if (keep && startRow <= endRow && startCol <= endCol) {
                    remapped.push({ startRow, startCol, endRow, endCol });
                }
            }

            return remapped;
        };

        const applyDelimitedOperationsToRows = (rows: string[][], op: any) => {
            const type = typeof op?.type === 'string' ? op.type : '';
            const index = typeof op?.index === 'number' ? op.index : 0;
            const row = typeof op?.row === 'number' ? op.row : 0;
            const col = typeof op?.col === 'number' ? op.col : 0;

            switch (type) {
                case 'insertRowAbove':
                    if (index > 0) rows.splice(index - 1, 0, []);
                    break;
                case 'insertRowBelow':
                    if (index > 0) rows.splice(index, 0, []);
                    break;
                case 'deleteRow':
                    if (index > 0 && index <= rows.length) rows.splice(index - 1, 1);
                    break;
                case 'insertColumnLeft':
                    if (index > 0) {
                        rows.forEach(rowData => rowData.splice(index - 1, 0, ''));
                    }
                    break;
                case 'insertColumnRight':
                    if (index > 0) {
                        rows.forEach(rowData => rowData.splice(index, 0, ''));
                    }
                    break;
                case 'deleteColumn':
                    if (index > 0) {
                        rows.forEach(rowData => {
                            if (index - 1 < rowData.length) {
                                rowData.splice(index - 1, 1);
                            }
                        });
                    }
                    break;
                case 'insertCellShiftRight': {
                    if (row > 0 && col > 0 && row <= rows.length) {
                        const rowData = rows[row - 1];
                        if (!rowData) break;
                        while (rowData.length < col - 1) {
                            rowData.push('');
                        }
                        rowData.splice(col - 1, 0, '');
                    }
                    break;
                }
                case 'insertCellShiftDown': {
                    if (row > 0 && col > 0 && row <= rows.length) {
                        rows.push([]);
                        for (let r = rows.length - 2; r >= row - 1; r--) {
                            const sourceRow = rows[r];
                            let targetRow = rows[r + 1];
                            if (!targetRow) {
                                targetRow = [];
                                rows[r + 1] = targetRow;
                            }
                            while (targetRow.length < col) {
                                targetRow.push('');
                            }
                            const sourceValue = sourceRow && sourceRow.length >= col ? sourceRow[col - 1] : '';
                            targetRow[col - 1] = sourceValue ?? '';
                        }
                        const insertRow = rows[row - 1];
                        if (insertRow) {
                            while (insertRow.length < col) {
                                insertRow.push('');
                            }
                            insertRow[col - 1] = '';
                        }
                    }
                    break;
                }
                case 'deleteCellShiftLeft': {
                    if (row > 0 && col > 0 && row <= rows.length) {
                        const rowData = rows[row - 1];
                        if (col - 1 < rowData.length) {
                            rowData.splice(col - 1, 1);
                        }
                    }
                    break;
                }
                case 'deleteCellShiftUp': {
                    if (row > 0 && col > 0) {
                        for (let r = row - 1; r < rows.length - 1; r++) {
                            const nextValue = rows[r + 1][col - 1] ?? '';
                            rows[r][col - 1] = nextValue;
                        }
                        const lastRow = rows[rows.length - 1];
                        if (lastRow && col - 1 < lastRow.length) {
                            lastRow.splice(col - 1, 1);
                        }
                    }
                    break;
                }
            }
        };

        const applyDelimitedEditValues = (rows: string[][], edits: any[]) => {
            for (const edit of edits) {
                const row = typeof edit?.row === 'number' ? edit.row : 0;
                const col = typeof edit?.col === 'number' ? edit.col : 0;
                if (!row || !col) continue;

                while (rows.length < row) {
                    rows.push([]);
                }
                const rowData = rows[row - 1];
                while (rowData.length < col) {
                    rowData.push('');
                }
                rowData[col - 1] = typeof edit.value === 'string' ? edit.value : '';
            }
        };

        const saveDelimitedFileAndStyles = async (sourceType: TabularFileType, edits: any[], richEdits: any[], styleEdits: any[], operations: any[], isAutosave: boolean) => {
            const requiresWorkbookRefresh = edits.length > 0 || operations.length > 0 || styleEdits.length > 0 || richEdits.length > 0;
            const { workbook: tabularData } = await readTabularFile(document.uri.fsPath, sourceType);
            const rows = tabularData.sheets[0]?.rows ? tabularData.sheets[0].rows.map(row => [...row]) : [];

            for (const op of operations) {
                applyDelimitedOperationsToRows(rows, op);
            }

            applyDelimitedEditValues(rows, edits);

            const metadata = (await this.styleStorage.getMetadata(document.uri)) || { cells: {}, merges: [] };
            let cells = metadata.cells || {};
            let merges = metadata.merges || [];

            let nextStyles: Record<string, any> = {};
            let nextControls: Record<string, any> = {};

            for (const [key, cellMeta] of Object.entries(cells)) {
                if (cellMeta?.style) {
                    nextStyles[key] = cellMeta.style;
                }
                if (cellMeta?.control) {
                    nextControls[key] = cellMeta.control;
                }
            }

            for (const op of operations) {
                nextStyles = remapStylesForOperation(nextStyles, op);
                nextControls = remapStylesForOperation(nextControls, op);
                merges = remapMergesForOperation(merges, op);

                const opType = typeof op?.type === 'string' ? op.type : '';
                if (opType === 'mergeRange') {
                    const startRow = typeof op?.startRow === 'number' ? op.startRow : 0;
                    const startCol = typeof op?.startCol === 'number' ? op.startCol : 0;
                    const endRow = typeof op?.endRow === 'number' ? op.endRow : 0;
                    const endCol = typeof op?.endCol === 'number' ? op.endCol : 0;
                    if (startRow && startCol && endRow && endCol) {
                        merges = merges.filter(m => !(m.startRow === startRow && m.startCol === startCol && m.endRow === endRow && m.endCol === endCol));
                        merges.push({ startRow, startCol, endRow, endCol });
                    }
                } else if (opType === 'unmergeRange') {
                    const startRow = typeof op?.startRow === 'number' ? op.startRow : 0;
                    const startCol = typeof op?.startCol === 'number' ? op.startCol : 0;
                    const endRow = typeof op?.endRow === 'number' ? op.endRow : 0;
                    const endCol = typeof op?.endCol === 'number' ? op.endCol : 0;
                    if (startRow && startCol && endRow && endCol) {
                        merges = merges.filter(m => !(m.startRow === startRow && m.startCol === startCol && m.endRow === endRow && m.endCol === endCol));
                    }
                } else if (opType === 'insertControl') {
                    const row = typeof op?.row === 'number' ? op.row : 0;
                    const col = typeof op?.col === 'number' ? op.col : 0;
                    const controlType = typeof op?.controlType === 'string' ? op.controlType : '';
                    const defaultValue = typeof op?.defaultValue === 'string' ? op.defaultValue : '';
                    const dropdownOptions = Array.isArray(op?.dropdownOptions)
                        ? op.dropdownOptions.map((v: any) => String(v ?? '').trim()).filter((v: string) => !!v)
                        : [];
                    if (row && col && controlType) {
                        nextControls[`${row}:${col}`] = {
                            controlType,
                            dropdownOptions: dropdownOptions.length ? dropdownOptions : undefined,
                            defaultValue
                        };
                    }
                }
            }

            for (const richEdit of richEdits) {
                const row = typeof richEdit?.row === 'number' ? richEdit.row : 0;
                const col = typeof richEdit?.col === 'number' ? richEdit.col : 0;
                const runs = Array.isArray(richEdit?.runs) ? richEdit.runs : [];
                if (!row || !col) continue;

                const key = `${row}:${col}`;
                const nextStyle = { ...(nextStyles[key] || {}) };

                const boldValues: boolean[] = runs
                    .filter((run: any) => typeof run?.bold === 'boolean')
                    .map((run: any) => !!run.bold);
                if (boldValues.length === 0) {
                    delete nextStyle.bold;
                } else if (boldValues.every((v: boolean) => v === boldValues[0])) {
                    nextStyle.bold = boldValues[0];
                } else {
                    delete nextStyle.bold;
                }

                const italicValues: boolean[] = runs
                    .filter((run: any) => typeof run?.italic === 'boolean')
                    .map((run: any) => !!run.italic);
                if (italicValues.length === 0) {
                    delete nextStyle.italic;
                } else if (italicValues.every((v: boolean) => v === italicValues[0])) {
                    nextStyle.italic = italicValues[0];
                } else {
                    delete nextStyle.italic;
                }

                const colorValues = runs
                    .map((run: any) => (typeof run?.color === 'string' ? String(run.color).trim() : ''))
                    .filter((color: string) => color.length > 0);
                if (colorValues.length === 0) {
                    delete nextStyle.textColor;
                } else if (colorValues.every((color: string) => color.toLowerCase() === colorValues[0].toLowerCase())) {
                    nextStyle.textColor = colorValues[0];
                } else {
                    delete nextStyle.textColor;
                }

                if (Object.keys(nextStyle).length > 0) {
                    nextStyles[key] = nextStyle;
                } else {
                    delete nextStyles[key];
                }
            }

            for (const styleEdit of styleEdits) {
                const row = typeof styleEdit?.row === 'number' ? styleEdit.row : 0;
                const col = typeof styleEdit?.col === 'number' ? styleEdit.col : 0;
                if (!row || !col) continue;

                const key = `${row}:${col}`;
                if (styleEdit?.clearFormatting) {
                    delete nextStyles[key];
                    continue;
                }

                const nextStyle = { ...(nextStyles[key] || {}) };
                for (const [prop, value] of Object.entries(styleEdit)) {
                    if (prop === 'row' || prop === 'col' || prop === 'clearFormatting') {
                        continue;
                    }

                    if (value !== undefined) {
                        nextStyle[prop] = value;
                    }
                }
                nextStyles[key] = nextStyle;
            }

            await writeTabularFile(document.uri.fsPath, {
                sheets: [{ name: 'Sheet1', rows }]
            }, sourceType);
            lastSaveTime = Date.now();

            const finalCells: Record<string, { style?: any; control?: any }> = {};
            for (const key of new Set([...Object.keys(nextStyles), ...Object.keys(nextControls)])) {
                const style = nextStyles[key];
                const cssStyle = style ? normalizeStoredStyle(style) : null;
                const control = nextControls[key];

                const entry: { style?: any; control?: any } = {};
                if (cssStyle && Object.keys(cssStyle).length > 0) {
                    entry.style = cssStyle;
                }
                if (control) {
                    entry.control = control;
                }

                if (Object.keys(entry).length > 0) {
                    finalCells[key] = entry;
                }
            }

            await this.styleStorage.saveMetadata(document.uri, {
                cells: finalCells,
                merges
            });

            // Keep provider-side worksheet cache in sync so plain/styled mode toggles
            // re-render with the latest persisted style metadata.
            if (requiresWorkbookRefresh) {
                await loadWorkbookPayload();
            }

            try {
                webview.postMessage({ command: 'saveResult', ok: true, isAutosave });
            } catch {
                // ignore
            }
        };

        const convertCurrentFileToXlsx = async () => {
            const sourceType = detectTabularFileType(document.uri.fsPath);
            if (!sourceType || sourceType === 'xlsx') {
                return;
            }

            const parsedSourcePath = path.parse(document.uri.fsPath);
            const defaultTargetUri = vscode.Uri.file(path.join(parsedSourcePath.dir, `${parsedSourcePath.name}.xlsx`));
            const targetUri = await vscode.window.showSaveDialog({
                defaultUri: defaultTargetUri,
                filters: { XLSX: ['xlsx'] }
            });

            if (!targetUri) {
                return;
            }

            const targetPath = targetUri.fsPath.toLowerCase().endsWith('.xlsx') ? targetUri.fsPath : `${targetUri.fsPath}.xlsx`;

            await convertTabularFile({
                sourcePath: document.uri.fsPath,
                targetPath,
                sourceType,
                targetType: 'xlsx'
            });

            const storedStyles = (await this.styleStorage.getStyles(document.uri)) ?? {};
            if (Object.keys(storedStyles).length > 0) {
                const workbook = new Excel.Workbook();
                await workbook.xlsx.readFile(targetPath);
                const worksheet = workbook.worksheets[0];
                if (worksheet) {
                    applyStoredStylesToWorksheet(worksheet, storedStyles);
                    await workbook.xlsx.writeFile(targetPath);
                }
            }

            await this.styleStorage.clearStyles(document.uri);
            await this.styleStorage.clearPreferredViewMode(document.uri);
            hasActiveTemporaryStyles = false;
            shouldOpenDelimitedInStyledMode = false;

            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(targetPath), 'xlsxViewer.xlsx');
        };

        const ensureHistoryDir = async () => {
            await fs.promises.mkdir(getHistoryDir(), { recursive: true });
        };

        const loadHistory = async (): Promise<VersionHistoryEntry[]> => {
            try {
                const raw = await fs.promises.readFile(getHistoryIndexPath(), 'utf8');
                const parsed = JSON.parse(raw);
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
            await fs.promises.writeFile(getHistoryIndexPath(), JSON.stringify(entries), 'utf8');
        };

        const pruneHistory = async (entries?: VersionHistoryEntry[]) => {
            const now = Date.now();
            const source = entries ?? await loadHistory();
            const kept: VersionHistoryEntry[] = [];

            for (const entry of source) {
                if (!entry || typeof entry.snapshotFile !== 'string') {
                    continue;
                }

                const expired = now - entry.timestamp > VERSION_HISTORY_RETENTION_MS;
                const snapshotPath = getSnapshotPath(entry.snapshotFile);

                if (expired) {
                    try {
                        await fs.promises.unlink(snapshotPath);
                    } catch {
                        // ignore
                    }
                    continue;
                }

                try {
                    await fs.promises.access(snapshotPath, fs.constants.F_OK);
                    kept.push(entry);
                } catch {
                    // ignore missing snapshot files
                }
            }

            if (kept.length !== source.length) {
                await saveHistory(kept);
            }

            return kept;
        };

        const persistVersionSnapshot = async () => {
            try {
                const history = await pruneHistory();
                const snapshotBytes = await fs.promises.readFile(filePath);
                const snapshotHash = createHash('sha1').update(snapshotBytes).digest('hex');
                const last = history.length ? history[history.length - 1] : null;
                if (last?.hash === snapshotHash) {
                    return;
                }

                const now = Date.now();
                const id = `${now}-${Math.random().toString(36).slice(2, 8)}`;
                const snapshotFile = `${id}.${currentFileType}`;

                await ensureHistoryDir();
                await fs.promises.writeFile(getSnapshotPath(snapshotFile), snapshotBytes);

                history.push({
                    id,
                    timestamp: now,
                    fileName: path.basename(filePath),
                    byteSize: snapshotBytes.length,
                    hash: snapshotHash,
                    fileType: currentFileType,
                    snapshotFile
                });

                await saveHistory(history);
            } catch {
                // ignore history snapshot errors
            }
        };

        type SettingsScope = 'plain' | 'styled';
        type PersistedSpreadsheetSettings = {
            firstRowIsHeader: boolean;
            stickyToolbar: boolean;
            stickyHeader: boolean;
            autoSave: boolean;
            autoSaveMode: 'all' | 'controlsOnly';
            showManualSavePopup: boolean;
            allowInteractiveControlsOutsideEditMode: boolean;
            hyperlinkPreview: boolean;
            spaciousCells: boolean;
            mergeWarningEnabled: boolean;
            isDefaultEditor: boolean;
            textWrap: boolean;
        };
        type PersistedSettingsPayload = {
            settings: PersistedSpreadsheetSettings;
            plainSettings: PersistedSpreadsheetSettings;
            styledSettings: PersistedSpreadsheetSettings;
            settingsScope: SettingsScope;
        };

        const isDefaultEditorAssociationEnabled = (associations: any, fileType: TabularFileType): boolean => {
            const associationConfig = fileType === 'csv'
                ? { viewType: 'xlsxViewer.csv', extension: 'csv' }
                : fileType === 'tsv'
                    ? { viewType: 'xlsxViewer.tsv', extension: 'tsv' }
                    : { viewType: 'xlsxViewer.xlsx', extension: 'xlsx' };

            const directPattern = `*.${associationConfig.extension}`;
            const recursivePattern = `**/*.${associationConfig.extension}`;

            if (!associations) {
                return false;
            }

            if (Array.isArray(associations)) {
                return associations.some((entry: any) =>
                    entry?.viewType === associationConfig.viewType &&
                    (entry?.filenamePattern === directPattern || entry?.filenamePattern === recursivePattern)
                );
            }

            return associations[directPattern] === associationConfig.viewType || associations[recursivePattern] === associationConfig.viewType;
        };

        const getStyledSettings = (): PersistedSpreadsheetSettings => {
            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
            const globalCfg = vscode.workspace.getConfiguration('workbench');
            const associations: any = globalCfg.get('editorAssociations');
            const autoSaveModeSetting = cfg.get<string>('xlsx.autoSaveMode', 'all');
            return {
                firstRowIsHeader: cfg.get('xlsx.firstRowIsHeader', true),
                stickyToolbar: cfg.get('xlsx.stickyToolbar', true),
                stickyHeader: cfg.get('xlsx.stickyHeader', false),
                autoSave: cfg.get('xlsx.autoSave', false),
                autoSaveMode: autoSaveModeSetting === 'controlsOnly' ? 'controlsOnly' : 'all',
                showManualSavePopup: cfg.get('xlsx.showManualSavePopup', true),
                allowInteractiveControlsOutsideEditMode: cfg.get('xlsx.allowInteractiveControlsOutsideEditMode', true),
                hyperlinkPreview: cfg.get('xlsx.hyperlinkPreview', true),
                spaciousCells: cfg.get('xlsx.spaciousCells', false),
                mergeWarningEnabled: cfg.get('xlsx.mergeWarningEnabled', true),
                isDefaultEditor: isDefaultEditorAssociationEnabled(associations, 'xlsx'),
                textWrap: cfg.get('xlsx.textWrap', false)
            };
        };

        const getPlainSettings = (fileType: TabularFileType): PersistedSpreadsheetSettings => {
            const cfg = vscode.workspace.getConfiguration('xlsxViewer');
            const globalCfg = vscode.workspace.getConfiguration('workbench');
            const associations: any = globalCfg.get('editorAssociations');

            if (fileType === 'csv' || fileType === 'tsv') {
                return {
                    firstRowIsHeader: cfg.get(`${fileType}.firstRowIsHeader`, true),
                    stickyToolbar: cfg.get(`${fileType}.stickyToolbar`, true),
                    stickyHeader: cfg.get(`${fileType}.stickyHeader`, false),
                    autoSave: cfg.get(`${fileType}.autoSave`, true),
                    autoSaveMode: 'all',
                    showManualSavePopup: false,
                    allowInteractiveControlsOutsideEditMode: true,
                    hyperlinkPreview: true,
                    spaciousCells: cfg.get(`${fileType}.spaciousCells`, false),
                    mergeWarningEnabled: true,
                    isDefaultEditor: isDefaultEditorAssociationEnabled(associations, fileType),
                    textWrap: cfg.get(`${fileType}.textWrap`, false)
                };
            }

            return {
                firstRowIsHeader: cfg.get('xlsx.firstRowIsHeader', true),
                stickyToolbar: cfg.get('xlsx.stickyToolbar', true),
                stickyHeader: cfg.get('xlsx.stickyHeader', false),
                autoSave: cfg.get('xlsx.autoSave', true),
                autoSaveMode: 'all',
                showManualSavePopup: false,
                allowInteractiveControlsOutsideEditMode: cfg.get('xlsx.allowInteractiveControlsOutsideEditMode', true),
                hyperlinkPreview: cfg.get('xlsx.hyperlinkPreview', true),
                spaciousCells: cfg.get('xlsx.spaciousCells', false),
                mergeWarningEnabled: cfg.get('xlsx.mergeWarningEnabled', true),
                isDefaultEditor: isDefaultEditorAssociationEnabled(associations, 'xlsx'),
                textWrap: cfg.get('xlsx.textWrap', false)
            };
        };

        const getPersistedSettings = (): PersistedSettingsPayload => {
            const styledSettings = getStyledSettings();
            const plainSettings = getPlainSettings(currentFileType);
            if (currentFileType === 'csv' || currentFileType === 'tsv') {
                styledSettings.isDefaultEditor = plainSettings.isDefaultEditor;
            }
            const settingsScope: SettingsScope = currentIsPlainView ? 'plain' : (currentFileType === 'xlsx' ? 'styled' : 'plain');

            return {
                settings: settingsScope === 'plain' ? plainSettings : styledSettings,
                plainSettings,
                styledSettings,
                settingsScope
            };
        };

        const trySendSettings = () => {
            if (!isWebviewReady) return;
            try {
                const persisted = getPersistedSettings();
                webview.postMessage({
                    command: 'initSettings',
                    ...persisted
                });
            } catch {
                // ignore
            }
        };

        // Sync VS Code theme changes to the webview
        const themeChangeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
            try { webview.postMessage({ type: 'setTheme', kind: vscode.window.activeColorTheme.kind }); } catch { }
        });

        webviewPanel.onDidDispose(() => themeChangeDisposable.dispose());

        const trySendInit = () => {
            if (!isWebviewReady || !worksheetsData.length) return;
            try {
                // Send metadata for virtual scrolling instead of full data
                // Include row heights for stable scroll calculations
                const worksheetsMeta = worksheetsData.map((ws, index) => ({
                    name: ws.name,
                    index,
                    totalRows: ws.data.maxRow,
                    columnCount: ws.data.maxCol,
                    columnWidths: ws.data.columnWidths,
                    mergedCells: ws.data.mergedCells,
                    rowHeights: ws.data.rows.map((row: any) => row.height || 21)
                }));
                webview.postMessage({
                    command: 'initVirtualTable',
                    worksheets: worksheetsMeta,
                    rowHeaderWidth,
                    fileType: currentFileType,
                    isPlainView: currentIsPlainView,
                    previewMode: !!previewVersionId,
                    versionId: previewVersionId,
                    timestamp: previewVersionTimestamp
                });
            } catch {
                // ignore
            }
        };

        const loadWorkbookPayload = async (sourcePath: string = filePath, sourceTypeOverride?: TabularFileType) => {
            const fileType = sourceTypeOverride || detectTabularFileType(sourcePath) || 'xlsx';
            currentFileType = fileType;
            hasActiveTemporaryStyles = false;
            shouldOpenDelimitedInStyledMode = false;
            const workbook = new Excel.Workbook();

            if (fileType === 'xlsx') {
                await workbook.xlsx.readFile(sourcePath);
            } else {
                // Load CSV/TSV data
                const { workbook: tabularData } = await readTabularFile(sourcePath, fileType);
                const ws = workbook.addWorksheet('Data');
                if (tabularData.sheets.length > 0) {
                    const rows = tabularData.sheets[0].rows;
                    for (let r = 0; r < rows.length; r++) {
                        const rowData = rows[r];
                        for (let c = 0; c < rowData.length; c++) {
                            ws.getCell(r + 1, c + 1).value = rowData[c];
                        }
                    }
                }

                const preferredViewMode = this.styleStorage.getPreferredViewMode(document.uri);
                shouldOpenDelimitedInStyledMode = preferredViewMode === 'styled';

                const metadata = await this.styleStorage.getMetadata(document.uri);
                if (metadata) {
                    if (metadata.merges && metadata.merges.length > 0) {
                        for (const merge of metadata.merges) {
                            try {
                                ws.mergeCells(merge.startRow, merge.startCol, merge.endRow, merge.endCol);
                            } catch { }
                        }
                    }

                    if (metadata.cells) {
                        for (const [key, cellMeta] of Object.entries(metadata.cells)) {
                            if (cellMeta?.control) {
                                const address = parseStyleKey(key);
                                if (!address) continue;
                                const cell = ws.getRow(address.row).getCell(address.col);
                                const { controlType, dropdownOptions, defaultValue } = cellMeta.control;
                                if (controlType === 'checkbox') {
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: ['"TRUE,FALSE"']
                                    } as any;
                                } else if (controlType === 'dropdown' && dropdownOptions) {
                                    const inline = dropdownOptions.join(',');
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: [`"${inline}"`]
                                    } as any;
                                } else if (controlType === 'rating') {
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: ['"1,2,3,4,5"']
                                    } as any;
                                } else if (controlType === 'date') {
                                    cell.dataValidation = {
                                        type: 'date',
                                        operator: 'between',
                                        allowBlank: true,
                                        formulae: [new Date(1900, 0, 1), new Date(2199, 11, 31)]
                                    } as any;
                                }
                            }
                        }
                    }

                    const storedStyles: Record<string, any> = {};
                    if (metadata.cells) {
                        for (const [key, cellMeta] of Object.entries(metadata.cells)) {
                            if (cellMeta?.style) {
                                storedStyles[key] = cellMeta.style;
                            }
                        }
                    }
                    hasActiveTemporaryStyles = Object.keys(storedStyles).length > 0;
                    (workbook as any).__storedStyles = storedStyles;

                    const hasMergesOrControls = (metadata.merges && metadata.merges.length > 0) ||
                        (metadata.cells && Object.values(metadata.cells).some(c => !!c?.control));
                    shouldOpenDelimitedInStyledMode = preferredViewMode === 'styled' || hasActiveTemporaryStyles || !!hasMergesOrControls;
                }
            }

            // Derive the initial plain-view state from file type and preferences.
            // For XLSX: default to styled (false). For CSV/TSV: inverse of styled preference.
            currentIsPlainView = currentFileType === 'xlsx' ? false : !shouldOpenDelimitedInStyledMode;

            worksheetsData = workbook.worksheets.map((worksheet, index) => {
                const data = this.extractWorksheetData(worksheet, workbook);
                // If we have stored styles for CSV/TSV, merge them into the extracted data
                if ((workbook as any).__storedStyles) {
                    const styles = (workbook as any).__storedStyles;
                    for (const row of data.rows) {
                        for (const cell of row.cells) {
                            const key = `${cell.rowNumber}:${cell.colNumber}`;
                            if (styles[key]) {
                                // Normalize stored style format to CSS properties for rendering.
                                const cssStyle = normalizeStoredStyle(styles[key]);
                                cell.style = { ...cell.style, ...cssStyle };

                                // Update default/theme flags so stylesheet "!important" rules
                                // do not override the custom inline styling.
                                if (cssStyle.backgroundColor) {
                                    cell.hasDefaultBg = false;
                                    cell.hasWhiteBackground = isShadeOfWhite(cssStyle.backgroundColor);
                                    cell.hasBlackBackground = isShadeOfBlack(cssStyle.backgroundColor);
                                    cell.isEmpty = false;
                                }
                                if (cssStyle.color) {
                                    cell.isDefaultColor = false;
                                    cell.originalColor = cssStyle.color;
                                }
                                if (cssStyle.border) {
                                    cell.hasDefaultBorder = false;
                                }
                            }
                        }
                    }
                }
                return {
                    name: worksheet.name,
                    index,
                    data
                };
            });

            // Start compact and let the webview grow row header width only when needed for visible rows.
            rowHeaderWidth = 40;
        };

        // Listen for messages
        webview.onDidReceiveMessage(async message => {
            if (message?.command === 'webviewReady') {
                isWebviewReady = true;
                await pruneHistory();
                await persistVersionSnapshot();
                trySendSettings();
                trySendInit();
                // Send current theme info to webview
                try {
                    webview.postMessage({ type: 'setTheme', kind: vscode.window.activeColorTheme.kind });
                } catch { }
                return;
            }

            if (message?.command === 'showVersionHistory') {
                try {
                    const history = await pruneHistory();
                    if (!history.length) {
                        webview.postMessage({
                            command: 'versionHistoryError',
                            message: 'No saved versions available'
                        });
                        return;
                    }

                    const sorted = [...history].sort((a, b) => b.timestamp - a.timestamp);
                    const oldestVersionId = sorted.length ? sorted[sorted.length - 1].id : null;
                    const picked = await vscode.window.showQuickPick(
                        buildSharedVersionHistoryItems(sorted, (entry) => ({
                            label: entry.id === oldestVersionId && entry.id === restoredVersionId
                                ? 'Original File (Restored)'
                                : entry.id === oldestVersionId
                                    ? 'Original File'
                                    : entry.id === restoredVersionId
                                        ? 'Restored'
                                        : formatVersionHistoryTimestamp(entry.timestamp),
                            description: entry.id === oldestVersionId || entry.id === restoredVersionId
                                ? formatVersionHistoryTimestamp(entry.timestamp)
                                : `${entry.fileName} • ${(entry.byteSize / 1024).toFixed(1)} KB`,
                            detail: `Saved ${Math.max(1, Math.round((Date.now() - entry.timestamp) / 60000))} min ago`,
                            entry
                        })),
                        { placeHolder: `Version history (${sorted.length} versions)` }
                    );

                    if (!picked?.entry) {
                        return;
                    }

                    const snapshotFileType = getSnapshotFileType(picked.entry.snapshotFile, picked.entry.fileType || currentFileType);
                    await loadWorkbookPayload(getSnapshotPath(picked.entry.snapshotFile), snapshotFileType);
                    previewVersionId = picked.entry.id;
                    previewVersionTimestamp = picked.entry.timestamp;
                    trySendInit();
                } catch (err) {
                    webview.postMessage({
                        command: 'versionHistoryError',
                        message: `Version history failed: ${String(err)}`
                    });
                }
                return;
            }

            if (message?.command === 'cancelVersionPreview') {
                if (previewVersionId) {
                    previewVersionId = null;
                    previewVersionTimestamp = null;
                    restoredVersionId = null;
                    await loadWorkbookPayload(filePath, currentFileType);
                    trySendInit();
                    webview.postMessage({ command: 'versionPreviewCancelledXlsx' });
                }
                return;
            }

            if (message?.command === 'restoreVersion') {
                try {
                    isSaving = true;
                    const versionId = typeof message.versionId === 'string' ? message.versionId : '';
                    if (!versionId) {
                        return;
                    }

                    const history = await pruneHistory();
                    const entry = history.find(item => item.id === versionId);
                    if (!entry) {
                        webview.postMessage({
                            command: 'versionHistoryError',
                            message: 'Selected version is no longer available'
                        });
                        return;
                    }

                    const snapshotBuffer = await fs.promises.readFile(getSnapshotPath(entry.snapshotFile));
                    await vscode.workspace.fs.writeFile(document.uri, snapshotBuffer);

                    previewVersionId = null;
                    previewVersionTimestamp = null;
                    restoredVersionId = entry.id;
                    await loadWorkbookPayload(filePath, currentFileType);
                    trySendInit();
                    await persistVersionSnapshot();

                    webview.postMessage({
                        command: 'versionRestoredXlsx',
                        versionId: entry.id,
                        timestamp: entry.timestamp
                    });
                } catch (err) {
                    webview.postMessage({
                        command: 'versionHistoryError',
                        message: `Restore failed: ${String(err)}`
                    });
                } finally {
                    isSaving = false;
                }
                return;
            }

            if (message?.command === 'updateSettings') {
                try {
                    const s = message.settings || {};
                    const cfg = vscode.workspace.getConfiguration('xlsxViewer');
                    const scope = message.settingsScope === 'plain' ? 'plain' : 'styled';
                    const isDelimitedFile = currentFileType === 'csv' || currentFileType === 'tsv';
                    const firstRowIsHeader = !!s.firstRowIsHeader;
                    const stickyHeader = firstRowIsHeader ? !!s.stickyHeader : false;

                    if (scope === 'plain') {
                        // Plain mode settings: limited set matching CSV/TSV plain mode defaults
                        const prefix = isDelimitedFile ? currentFileType : 'xlsx';
                        await cfg.update(`${prefix}.firstRowIsHeader`, firstRowIsHeader, vscode.ConfigurationTarget.Global);
                        await cfg.update(`${prefix}.stickyToolbar`, !!s.stickyToolbar, vscode.ConfigurationTarget.Global);
                        await cfg.update(`${prefix}.stickyHeader`, stickyHeader, vscode.ConfigurationTarget.Global);
                        await cfg.update(`${prefix}.autoSave`, s.autoSave !== false, vscode.ConfigurationTarget.Global);
                        await cfg.update(`${prefix}.spaciousCells`, !!s.spaciousCells, vscode.ConfigurationTarget.Global);
                        await cfg.update(`${prefix}.textWrap`, !!s.textWrap, vscode.ConfigurationTarget.Global);
                    } else {
                        await cfg.update('xlsx.firstRowIsHeader', firstRowIsHeader, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.stickyToolbar', !!s.stickyToolbar, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.stickyHeader', stickyHeader, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.autoSave', !!s.autoSave, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.autoSaveMode', s.autoSaveMode === 'controlsOnly' ? 'controlsOnly' : 'all', vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.showManualSavePopup', !!s.showManualSavePopup, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.allowInteractiveControlsOutsideEditMode', !!s.allowInteractiveControlsOutsideEditMode, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.hyperlinkPreview', !!s.hyperlinkPreview, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.spaciousCells', !!s.spaciousCells, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.mergeWarningEnabled', !!s.mergeWarningEnabled, vscode.ConfigurationTarget.Global);
                        await cfg.update('xlsx.textWrap', !!s.textWrap, vscode.ConfigurationTarget.Global);
                    }
                } catch (err) {
                    console.error('Failed to persist XLSX settings:', err);
                }
                return;
            }

            if (message?.command === 'enableDefaultEditor' || message?.command === 'enableAsDefault') {
                const associationType = currentFileType === 'csv' || currentFileType === 'tsv' ? currentFileType : 'xlsx';
                await vscode.commands.executeCommand('xlsx-viewer.toggleAssociation', { type: associationType, enable: true });
                trySendSettings();
                return;
            }

            if (message?.command === 'disableDefaultEditor') {
                try {
                    const associationType = currentFileType === 'csv' || currentFileType === 'tsv' ? currentFileType : 'xlsx';
                    const result = await vscode.window.showWarningMessage(
                        `Are you sure you want to disable Spreadsheet Viewer for all .${associationType} files? You will be prompted to select a new default editor.`,
                        "Yes, Disable",
                        "Cancel"
                    );

                    if (result === "Yes, Disable") {
                        await vscode.commands.executeCommand('xlsx-viewer.toggleAssociation', { type: associationType, enable: false });
                        await vscode.commands.executeCommand('workbench.action.reopenWithEditor');
                    }
                } catch (err) {
                    vscode.window.showErrorMessage(`Error disabling editor: ${err}`);
                }
                return;
            }

            // Handle getRows request for virtual scrolling
            if (message?.command === 'getRows') {
                const { start, end, requestId, sheetIndex } = message;
                const wsIndex = typeof sheetIndex === 'number' ? sheetIndex : 0;
                const ws = worksheetsData[wsIndex];
                if (!ws) {
                    webview.postMessage({
                        command: 'rowsData',
                        rows: [],
                        start,
                        end,
                        requestId
                    });
                    return;
                }

                const clampedStart = Math.max(0, start);
                const clampedEnd = Math.min(ws.data.rows.length, end);
                const rows = ws.data.rows.slice(clampedStart, clampedEnd);

                webview.postMessage({
                    command: 'rowsData',
                    rows,
                    start: clampedStart,
                    end: clampedEnd,
                    requestId
                });
                return;
            }

            if (message?.command === 'toggleView') {
                if (!message.isTableView) {
                    await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
                    webviewPanel.dispose();
                }
                return;
            }

            if (message?.command === 'openExternal') {
                try {
                    const url = typeof message.url === 'string' ? message.url : '';
                    if (url) {
                        await vscode.env.openExternal(vscode.Uri.parse(url));
                    }
                } catch {
                    // ignore
                }
                return;
            }

            if (message?.command === 'getSystemDetails') {
                const ext = vscode.extensions.getExtension('muhammad-ahmad.xlsx-viewer');
                const editorName = vscode.env.appName || 'VS Code';
                webview.postMessage({
                    command: 'systemDetails',
                    vscodeVersion: vscode.version,
                    extensionVersion: ext?.packageJSON?.version ?? 'unknown',
                    osInfo: `${process.platform} ${process.arch}`,
                    editorName: editorName
                });
                return;
            }

            if (message?.command === 'submitFeedback') {
                try {
                    const https = await import('node:https');
                    const formData = message.data as Record<string, string>;
                    const body = Object.entries(formData)
                        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
                        .join('&');
                    const result = await new Promise<boolean>((resolve) => {
                        const req = https.request({
                            hostname: 'docs.google.com',
                            path: '/forms/d/e/1FAIpQLSe5AqE_f1-WqUlQmvuPn1as3Mkn4oLjA0EDhNssetzt63ONzA/formResponse',
                            method: 'POST',
                            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
                        }, (res: any) => resolve((res.statusCode ?? 500) < 400));
                        req.on('error', () => resolve(false));
                        req.write(body);
                        req.end();
                    });
                    webview.postMessage({ command: 'feedbackResult', ok: result });
                } catch {
                    webview.postMessage({ command: 'feedbackResult', ok: false });
                }
                return;
            }

            if (message?.command === 'convertFile') {
                try {
                    await vscode.commands.executeCommand('xlsx-viewer.convertFile', document.uri);
                } catch (err) {
                    vscode.window.showErrorMessage(`Error converting file: ${err}`);
                }
                return;
            }

            if (message?.command === 'setPreferredViewMode') {
                try {
                    const mode = message?.mode === 'styled' ? 'styled' : 'plain';
                    if (currentFileType === 'csv' || currentFileType === 'tsv') {
                        await this.styleStorage.setPreferredViewMode(document.uri, mode);
                        shouldOpenDelimitedInStyledMode = mode === 'styled';
                    }
                    // Keep provider-side plain-view state in sync with the webview
                    currentIsPlainView = mode === 'plain';
                } catch {
                    // ignore preferred view mode persistence errors
                }
                return;
            }

            if (message?.command === 'requestFreshData') {
                try {
                    await loadWorkbookPayload();
                    trySendInit();
                } catch {
                    // ignore reload errors
                }
                return;
            }

            if (message?.command === 'requestStyleMode') {
                try {
                    if (currentFileType === 'xlsx') {
                        webview.postMessage({ command: 'styleModeActivated' });
                        return;
                    }
                    webview.postMessage({ command: 'showStyleModeNotice' });
                } catch (err) {
                    webview.postMessage({ command: 'styleModeCancelled' });
                    vscode.window.showErrorMessage(`Unable to switch to styled mode: ${String(err)}`);
                }
                return;
            }

            if (message?.command === 'styleModeDecision') {
                try {
                    const decision = typeof message?.decision === 'string' ? message.decision : 'cancel';

                    if (decision === 'continue') {
                        webview.postMessage({ command: 'styleModeActivated' });
                        return;
                    }

                    if (decision === 'convert') {
                        await convertCurrentFileToXlsx();
                        return;
                    }

                    webview.postMessage({ command: 'styleModeCancelled' });
                } catch (err) {
                    webview.postMessage({ command: 'styleModeCancelled' });
                    vscode.window.showErrorMessage(`Unable to process style mode selection: ${String(err)}`);
                }
                return;
            }

            if (message?.command === 'saveXlsxEdits') {
                try {
                    isSaving = true;
                    if (previewVersionId) {
                        webview.postMessage({ command: 'saveResult', ok: false, error: 'Preview mode is read-only' });
                        return;
                    }

                    const edits = Array.isArray(message.edits) ? message.edits : [];
                    const richEdits = Array.isArray(message.richEdits) ? message.richEdits : [];
                    const styleEdits = Array.isArray(message.styleEdits) ? message.styleEdits : [];
                    const operations = Array.isArray(message.operations) ? message.operations : [];
                    const sheetIndex = typeof message.sheetIndex === 'number' ? message.sheetIndex : 0;
                    const isAutosave = !!message.isAutosave;

                    if (!edits.length && !operations.length && !styleEdits.length && !richEdits.length) {
                        try { webview.postMessage({ command: 'saveResult', ok: true, isAutosave }); } catch { }
                        return;
                    }

                    const sourceType = detectTabularFileType(document.uri.fsPath) || 'xlsx';
                    if (sourceType === 'csv' || sourceType === 'tsv') {
                        await saveDelimitedFileAndStyles(sourceType, edits, richEdits, styleEdits, operations, isAutosave);
                        return;
                    }

                    const workbook = new Excel.Workbook();
                    await workbook.xlsx.readFile(document.uri.fsPath);
                    const ws = workbook.worksheets[sheetIndex];
                    if (!ws) {
                        throw new Error('Worksheet not found');
                    }

                    for (const op of operations) {
                        const type = typeof op?.type === 'string' ? op.type : '';
                        const index = typeof op?.index === 'number' ? op.index : 0;
                        if (!type) continue;

                        switch (type) {
                            case 'insertRowAbove':
                                if (index > 0) ws.spliceRows(index, 0, []);
                                break;
                            case 'insertRowBelow':
                                if (index > 0) ws.spliceRows(index + 1, 0, []);
                                break;
                            case 'deleteRow':
                                if (index > 0 && ws.rowCount > 1) {
                                    ws.spliceRows(index, 1);
                                }
                                break;
                            case 'insertColumnLeft':
                                if (index > 0) ws.spliceColumns(index, 0, []);
                                break;
                            case 'insertColumnRight':
                                if (index > 0) ws.spliceColumns(index + 1, 0, []);
                                break;
                            case 'deleteColumn':
                                if (index > 0 && ws.columnCount > 1) {
                                    ws.spliceColumns(index, 1);
                                }
                                break;
                            case 'insertCellShiftRight': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) break;

                                const rowRef = ws.getRow(row);
                                const lastColumn = Math.max(ws.columnCount, rowRef.cellCount || 0);
                                for (let c = lastColumn + 1; c > col; c--) {
                                    const src = rowRef.getCell(c - 1);
                                    const dst = rowRef.getCell(c);
                                    dst.value = src.value as any;
                                }
                                rowRef.getCell(col).value = null;
                                break;
                            }
                            case 'insertCellShiftDown': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) break;

                                const lastRow = ws.rowCount;
                                ws.spliceRows(lastRow + 1, 0, []);
                                for (let r = lastRow + 1; r > row; r--) {
                                    const src = ws.getRow(r - 1).getCell(col);
                                    const dst = ws.getRow(r).getCell(col);
                                    dst.value = src.value as any;
                                }
                                ws.getRow(row).getCell(col).value = null;
                                break;
                            }
                            case 'deleteCellShiftLeft': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) break;

                                for (let c = col; c < ws.columnCount; c++) {
                                    const src = ws.getRow(row).getCell(c + 1);
                                    const dst = ws.getRow(row).getCell(c);
                                    dst.value = src.value as any;
                                }
                                ws.getRow(row).getCell(ws.columnCount).value = null;
                                break;
                            }
                            case 'deleteCellShiftUp': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                if (!row || !col) break;

                                for (let r = row; r < ws.rowCount; r++) {
                                    const src = ws.getRow(r + 1).getCell(col);
                                    const dst = ws.getRow(r).getCell(col);
                                    dst.value = src.value as any;
                                }
                                ws.getRow(ws.rowCount).getCell(col).value = null;
                                break;
                            }
                            case 'mergeRange': {
                                const startRow = typeof op?.startRow === 'number' ? op.startRow : 0;
                                const startCol = typeof op?.startCol === 'number' ? op.startCol : 0;
                                const endRow = typeof op?.endRow === 'number' ? op.endRow : 0;
                                const endCol = typeof op?.endCol === 'number' ? op.endCol : 0;
                                if (!startRow || !startCol || !endRow || !endCol) break;

                                try {
                                    ws.mergeCells(startRow, startCol, endRow, endCol);
                                } catch {
                                    // ignore invalid merge requests
                                }
                                break;
                            }
                            case 'unmergeRange': {
                                const startRow = typeof op?.startRow === 'number' ? op.startRow : 0;
                                const startCol = typeof op?.startCol === 'number' ? op.startCol : 0;
                                const endRow = typeof op?.endRow === 'number' ? op.endRow : 0;
                                const endCol = typeof op?.endCol === 'number' ? op.endCol : 0;
                                if (!startRow || !startCol || !endRow || !endCol) break;

                                try {
                                    ws.unMergeCells(startRow, startCol, endRow, endCol);
                                } catch {
                                    // ignore invalid unmerge requests
                                }
                                break;
                            }
                            case 'insertControl': {
                                const row = typeof op?.row === 'number' ? op.row : 0;
                                const col = typeof op?.col === 'number' ? op.col : 0;
                                const controlType = typeof op?.controlType === 'string' ? op.controlType : '';
                                const defaultValue = typeof op?.defaultValue === 'string' ? op.defaultValue : '';
                                const dropdownOptions = Array.isArray(op?.dropdownOptions)
                                    ? op.dropdownOptions.map((v: any) => String(v ?? '').trim()).filter((v: string) => !!v)
                                    : [];

                                if (!row || !col || !controlType) break;

                                const cell = ws.getRow(row).getCell(col);

                                if (controlType === 'checkbox') {
                                    const normalized = defaultValue.trim().toLowerCase();
                                    const next = normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y';
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: ['"TRUE,FALSE"']
                                    } as any;
                                    cell.value = next;
                                    break;
                                }

                                if (controlType === 'dropdown') {
                                    const options = dropdownOptions
                                        .map((item: string) => item.replace(/[\r\n,]/g, ' ').trim())
                                        .filter((item: string, idx: number, arr: string[]) => !!item && arr.indexOf(item) === idx)
                                        .slice(0, 80);
                                    if (!options.length) break;

                                    const first = options[0];
                                    const inline = options.join(',');
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: [`"${inline}"`]
                                    } as any;
                                    cell.value = defaultValue && options.includes(defaultValue) ? defaultValue : first;
                                    break;
                                }

                                if (controlType === 'rating') {
                                    const parsed = parseInt(defaultValue, 10);
                                    const rating = Number.isFinite(parsed) ? Math.max(0, Math.min(5, parsed)) : 3;
                                    cell.dataValidation = {
                                        type: 'list',
                                        allowBlank: true,
                                        formulae: ['"1,2,3,4,5"']
                                    } as any;
                                    cell.value = rating;
                                    break;
                                }

                                if (controlType === 'date') {
                                    const parsed = new Date(defaultValue || Date.now());
                                    const nextDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
                                    cell.dataValidation = {
                                        type: 'date',
                                        operator: 'between',
                                        allowBlank: true,
                                        formulae: [new Date(1900, 0, 1), new Date(2199, 11, 31)]
                                    } as any;
                                    cell.numFmt = 'yyyy-mm-dd';
                                    cell.value = nextDate;
                                }
                                break;
                            }
                        }
                    }

                    const richEditedKeys = new Set<string>();
                    for (const rich of richEdits) {
                        const row = typeof rich?.row === 'number' ? rich.row : 0;
                        const col = typeof rich?.col === 'number' ? rich.col : 0;
                        const runs = Array.isArray(rich?.runs) ? rich.runs : [];
                        if (!row || !col || !runs.length) continue;

                        const richText = runs
                            .map((r: any) => {
                                const text = typeof r?.text === 'string' ? r.text : '';
                                if (!text) return null;

                                const font: any = {};
                                if (r.bold === true) font.bold = true;
                                if (r.italic === true) font.italic = true;
                                const color = typeof r?.color === 'string' ? r.color : '';
                                const hex = color.match(/^#([0-9a-fA-F]{6})$/);
                                if (hex) font.color = { argb: ('FF' + hex[1]).toUpperCase() };

                                return Object.keys(font).length > 0 ? { text, font } : { text };
                            })
                            .filter((v: any) => !!v);

                        if (!richText.length) continue;

                        const cell = ws.getRow(row).getCell(col);
                        cell.value = { richText } as any;
                        richEditedKeys.add(row + ':' + col);
                    }

                    const parseBooleanText = (value: string): boolean | null => {
                        const normalized = value.trim().toLowerCase();
                        if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y') return true;
                        if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'n') return false;
                        return null;
                    };

                    const isBooleanValidationCell = (cell: Excel.Cell): boolean => {
                        const dv = (cell as any)?.dataValidation;
                        if (!dv || dv.type !== 'list') return false;
                        const formula = Array.isArray(dv.formulae) ? String(dv.formulae[0] || '').trim() : '';
                        const direct = formula.startsWith('=') ? formula.slice(1) : formula;
                        const inlineMatch = direct.match(/^"([\s\S]*)"$/);
                        if (!inlineMatch) return false;
                        const options = inlineMatch[1]
                            .split(',')
                            .map((item) => parseBooleanText(item))
                            .filter((item): item is boolean => item !== null);
                        return options.length >= 2 && new Set(options).size === 2;
                    };

                    const isRatingValidationCell = (cell: Excel.Cell): boolean => {
                        const options = this.getDropdownOptions(cell, ws, workbook);
                        return this.isRatingOptionList(options);
                    };

                    const parseDateInput = (value: string): Date | null => {
                        const raw = String(value || '').trim();
                        if (!raw) return null;

                        const parsed = new Date(raw);
                        if (Number.isNaN(parsed.getTime())) {
                            return null;
                        }

                        return parsed;
                    };

                    for (const edit of edits) {
                        const row = typeof edit.row === 'number' ? edit.row : undefined;
                        const col = typeof edit.col === 'number' ? edit.col : undefined;
                        if (!row || !col) continue;

                        if (richEditedKeys.has(row + ':' + col)) {
                            continue;
                        }

                        const newText = typeof edit.value === 'string' ? edit.value : '';
                        const cell = ws.getRow(row).getCell(col);
                        const asBool = parseBooleanText(newText);
                        const shouldStoreBoolean = asBool !== null && (typeof cell.value === 'boolean' || isBooleanValidationCell(cell));
                        const shouldStoreRating = isRatingValidationCell(cell);
                        const ratingValue = this.normalizeRatingValue(newText);
                        const shouldStoreDate = this.isDateValidationCell(cell) || cell.type === Excel.ValueType.Date || cell.value instanceof Date;
                        const parsedDate = parseDateInput(newText);

                        if (cell.type === Excel.ValueType.Hyperlink) {
                            const hyperlinkValue = cell.value as Excel.CellHyperlinkValue;
                            cell.value = {
                                text: newText,
                                hyperlink: hyperlinkValue.hyperlink
                            } as Excel.CellHyperlinkValue;
                        } else if (shouldStoreBoolean) {
                            cell.value = asBool;
                        } else if (shouldStoreRating) {
                            cell.value = ratingValue > 0 ? ratingValue : null;
                        } else if (shouldStoreDate) {
                            if (!newText.trim()) {
                                cell.value = null;
                            } else if (parsedDate) {
                                cell.numFmt = 'yyyy-mm-dd';
                                cell.value = parsedDate;
                            } else {
                                cell.value = newText;
                            }
                        } else {
                            cell.value = newText;
                        }
                    }

                    const toARGB = (hexOrColor: string): string | undefined => {
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
                    };

                    for (const s of styleEdits) {
                        const row = typeof s?.row === 'number' ? s.row : 0;
                        const col = typeof s?.col === 'number' ? s.col : 0;
                        if (!row || !col) continue;

                        const cell = ws.getRow(row).getCell(col);

                        if (s?.clearFormatting) {
                            (cell as any).fill = undefined;
                            (cell as any).font = undefined;
                            (cell as any).alignment = undefined;
                            (cell as any).border = undefined;
                        }

                        const bgArgb = toARGB(typeof s?.bgColor === 'string' ? s.bgColor : '');
                        if (bgArgb) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: bgArgb }
                            } as Excel.FillPattern;
                        }

                        const textArgb = toARGB(typeof s?.textColor === 'string' ? s.textColor : '');
                        if (textArgb) {
                            const currentFont = cell.font || {};
                            cell.font = {
                                ...currentFont,
                                color: { argb: textArgb }
                            } as Partial<Excel.Font>;
                        }

                        const nextFont: any = cell.font ? { ...cell.font } : {};
                        let hasFontEdit = false;
                        if (typeof s?.fontSize === 'number' && s.fontSize > 0) {
                            nextFont.size = s.fontSize;
                            hasFontEdit = true;
                        }
                        if (typeof s?.fontFamily === 'string' && s.fontFamily.trim().length > 0) {
                            nextFont.name = s.fontFamily.trim();
                            hasFontEdit = true;
                        }
                        if (typeof s?.bold === 'boolean') {
                            nextFont.bold = s.bold;
                            hasFontEdit = true;
                        }
                        if (typeof s?.italic === 'boolean') {
                            nextFont.italic = s.italic;
                            hasFontEdit = true;
                        }
                        if (typeof s?.strike === 'boolean') {
                            nextFont.strike = s.strike;
                            hasFontEdit = true;
                        }
                        if (hasFontEdit) {
                            cell.font = nextFont as Partial<Excel.Font>;
                        }

                        const nextAlignment: any = cell.alignment ? { ...cell.alignment } : {};
                        let hasAlignmentEdit = false;
                        const hAlign = typeof s?.horizontalAlign === 'string' ? s.horizontalAlign : '';
                        if (hAlign === 'left' || hAlign === 'center' || hAlign === 'right') {
                            nextAlignment.horizontal = hAlign;
                            hasAlignmentEdit = true;
                        }
                        const vAlign = typeof s?.verticalAlign === 'string' ? s.verticalAlign : '';
                        if (vAlign === 'top' || vAlign === 'middle' || vAlign === 'bottom') {
                            nextAlignment.vertical = vAlign;
                            hasAlignmentEdit = true;
                        }
                        const wrapMode = typeof s?.wrapMode === 'string' ? s.wrapMode : '';
                        if (wrapMode === 'wrap' || wrapMode === 'overflow' || wrapMode === 'clip') {
                            nextAlignment.wrapText = wrapMode === 'wrap';
                            hasAlignmentEdit = true;
                        }
                        if (typeof s?.indent === 'number') {
                            nextAlignment.indent = Math.max(0, Math.round(s.indent));
                            hasAlignmentEdit = true;
                        }
                        if (hasAlignmentEdit) {
                            cell.alignment = nextAlignment as Partial<Excel.Alignment>;
                        }

                        if (s?.border) {
                            if (s.border.clear) {
                                (cell as any).border = undefined;
                            } else {
                                const borderStyle = typeof s.border.style === 'string'
                                    ? s.border.style : 'thin';

                                const allowedStyles = [
                                    "thin", "dotted", "dashDot", "hair", "dashDotDot", "slantDashDot", "mediumDashed", "mediumDashDotDot", "mediumDashDot", "medium", "double", "thick"
                                ];

                                let finalBorderStyle = 'thin';
                                const sLower = borderStyle.toLowerCase();

                                if (sLower.includes('thick') && sLower.includes('dash')) finalBorderStyle = 'mediumDashed'; // no thickDashed in exceljs? mediumDashed is closest
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
                                else finalBorderStyle = 'thin';

                                const excelBorderStyle = finalBorderStyle;
                                const borderColorArgb = toARGB(typeof s.border.color === 'string' ? s.border.color : '') || 'FF202124';

                                const toEdge = (enabled?: boolean) => {
                                    if (!enabled) return undefined;
                                    return { style: excelBorderStyle as any, color: { argb: borderColorArgb } };
                                };

                                cell.border = {
                                    top: toEdge(s.border.top),
                                    right: toEdge(s.border.right),
                                    bottom: toEdge(s.border.bottom),
                                    left: toEdge(s.border.left)
                                } as any;
                            }
                        }
                    }

                    await workbook.xlsx.writeFile(document.uri.fsPath);
                    lastSaveTime = Date.now();
                    await persistVersionSnapshot();
                    previewVersionId = null;
                    previewVersionTimestamp = null;

                    if (operations.length > 0) {
                        const requiresFullRefresh = operations.some((op: any) => {
                            const type = typeof op?.type === 'string' ? op.type : '';
                            return type !== 'insertControl';
                        });

                        // Keep insert-control autosave smooth by avoiding a full webview re-init.
                        await loadWorkbookPayload();
                        if (requiresFullRefresh) {
                            trySendInit();
                        }
                    } else {
                        // For pure text/style edits, update worksheetsData internally but don't force a full webview re-render
                        await loadWorkbookPayload();
                    }
                    try { webview.postMessage({ command: 'saveResult', ok: true, isAutosave }); } catch { }
                } catch (err) {
                    try { webview.postMessage({ command: 'saveResult', ok: false, error: String(err), isAutosave: !!message?.isAutosave }); } catch { }
                } finally {
                    isSaving = false;
                }
            }
        });

        // Forward settings changes made outside the webview
        const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('xlsxViewer.xlsx') || e.affectsConfiguration('xlsxViewer') || e.affectsConfiguration('workbench.editorAssociations')) {
                try {
                    const persisted = getPersistedSettings();
                    webview.postMessage({ command: 'settingsUpdated', ...persisted });
                } catch {
                    // ignore
                }
            }
        });
        webviewPanel.onDidDispose(() => configChangeDisposable.dispose());

        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(path.dirname(filePath)), path.basename(filePath))
        );
        const watcherDisposable = watcher.onDidChange(async () => {
            if (isSaving || Date.now() - lastSaveTime < 1000) {
                return;
            }
            try {
                await loadWorkbookPayload();
                trySendInit();
            } catch {
                // ignore reload errors
            }
        });
        webviewPanel.onDidDispose(() => {
            watcherDisposable.dispose();
            watcher.dispose();
        });

        try {
            await loadWorkbookPayload();
            trySendSettings();
            trySendInit();
        } catch (error) {
            vscode.window.showErrorMessage(`Error reading XLSX file: ${error}`);
        }
    }

    private getLoadingContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loading XLSX File</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ffffff;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            flex-direction: column;
        }
        
        .loading-container {
            text-align: center;
        }
        
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #2196f3;
            border-radius: 50%;
            width: 60px;
            height: 60px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .loading-text {
            font-size: 18px;
            color: #333;
            margin-bottom: 10px;
        }
        
        .loading-subtext {
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="loading-container">
        <div class="spinner"></div>
        <div class="loading-text">Loading XLSX File...</div>
        <div class="loading-subtext">Please wait while we process your spreadsheet</div>
    </div>
</body>
</html>`;
    }

    private extractWorksheetData(worksheet: Excel.Worksheet, workbook: Excel.Workbook): any {
        const data: any = {
            rows: [],
            maxRow: 0,
            maxCol: 0,
            mergedCells: []
        };
        const imageMap = this.getWorksheetImageMap(workbook, worksheet);

        // Extract merged cell ranges
        try {
            // Check different ways ExcelJS might store merged cells
            let merges: any[] = [];

            // Method 1: Check worksheet.model.merges
            if ((worksheet as any).model && (worksheet as any).model.merges) {
                merges = (worksheet as any).model.merges;
            }

            // Method 2: Check worksheet._merges (fallback)
            if (merges.length === 0 && (worksheet as any)._merges) {
                merges = (worksheet as any)._merges;
            }

            // Method 3: Check worksheet.merged (another possible location)
            if (merges.length === 0 && (worksheet as any).merged) {
                merges = (worksheet as any).merged;
            }

            merges.forEach((merge: any) => {
                // Handle different merge formats
                let startRow, startCol, endRow, endCol;

                if (merge.top !== undefined) {
                    // Format: {top, left, bottom, right}
                    startRow = merge.top;
                    startCol = merge.left;
                    endRow = merge.bottom;
                    endCol = merge.right;
                } else if (merge.start && merge.end) {
                    // Format: {start: {row, col}, end: {row, col}}
                    startRow = merge.start.row;
                    startCol = merge.start.col;
                    endRow = merge.end.row;
                    endCol = merge.end.col;
                } else if (typeof merge === 'string') {
                    // Format: "A1:B2" - parse range string
                    const range = this.parseRange(merge);
                    if (range) {
                        startRow = range.startRow;
                        startCol = range.startCol;
                        endRow = range.endRow;
                        endCol = range.endCol;
                    }
                }

                if (startRow && startCol && endRow && endCol) {
                    data.mergedCells.push({
                        startRow,
                        startCol,
                        endRow,
                        endCol
                    });
                }
            });
        } catch {
            // Silently continue without merged cells if there's an error
        }

        // Find actual data bounds
        let maxRow = 0;
        let maxCol = 0;

        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            maxRow = Math.max(maxRow, rowNumber);
            row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                maxCol = Math.max(maxCol, colNumber);
            });
        });

        // Include at least some empty rows/cols for better display
        maxRow = Math.max(maxRow, 20);
        maxCol = Math.max(maxCol, 10);

        data.maxRow = maxRow;
        data.maxCol = maxCol;

        // Create a 2D grid to track merged cells
        const cellGrid: any[][] = [];
        for (let r = 0; r <= maxRow; r++) {
            cellGrid[r] = [];
        }

        // Mark merged cells in the grid
        data.mergedCells.forEach((range: any) => {
            for (let r = range.startRow; r <= range.endRow; r++) {
                for (let c = range.startCol; c <= range.endCol; c++) {
                    cellGrid[r][c] = {
                        isMerged: true,
                        isMaster: r === range.startRow && c === range.startCol,
                        rowspan: range.endRow - range.startRow + 1,
                        colspan: range.endCol - range.startCol + 1,
                        masterRow: range.startRow,
                        masterCol: range.startCol
                    };
                }
            }
        });

        // Extract all cell data
        for (let r = 1; r <= maxRow; r++) {
            const row = worksheet.getRow(r);
            const rowData: any = {
                rowNumber: r,
                cells: [],
                height: row.height || 15 // Default row height
            };

            for (let c = 1; c <= maxCol; c++) {
                const mergeInfo = cellGrid[r] && cellGrid[r][c];

                // Track covered merged positions so renderer can skip phantom placeholders.
                if (mergeInfo && mergeInfo.isMerged && !mergeInfo.isMaster) {
                    rowData.cells.push({
                        value: '',
                        hyperlink: '',
                        style: {},
                        colNumber: c,
                        rowNumber: r,
                        isDefaultColor: false,
                        hasDefaultBg: true,
                        hasWhiteBackground: false,
                        hasBlackBorder: false,
                        hasWhiteBorder: false,
                        hasBlackBackground: false,
                        hasDefaultBorder: true,
                        originalColor: 'rgb(0, 0, 0)',
                        isEmpty: true,
                        rowspan: mergeInfo.rowspan,
                        colspan: mergeInfo.colspan,
                        isMerged: true,
                        isMaster: false,
                        isMergeCovered: true,
                        masterRow: mergeInfo.masterRow,
                        masterCol: mergeInfo.masterCol
                    });
                    continue;
                }

                const cell = worksheet.getRow(r).getCell(c);
                const cellStyle = this.getCellStyle(cell);
                let cellValue = this.getCellValue(cell);
                const hyperlinkUrl = this.getCellHyperlink(cell);
                const dropdownOptions = this.getDropdownOptions(cell, worksheet, workbook);
                const imageSrc = imageMap.get(`${r}:${c}`) || '';
                const booleanFromValue = this.parseBooleanLike(cell.value);
                const booleanFromText = this.parseBooleanLike(cellValue);
                const isRating = this.isRatingOptionList(dropdownOptions);
                const dateInputValue = this.toIsoDateInputValue(cell.value) || this.toIsoDateInputValue(cellValue);
                const isDate = this.isDateValidationCell(cell) || !!dateInputValue;
                const isCheckbox = !isRating && this.isBooleanOptionList(dropdownOptions);

                const checkboxChecked = booleanFromValue ?? booleanFromText ?? false;
                const cellType = imageSrc
                    ? 'image'
                    : (isCheckbox
                        ? 'checkbox'
                        : (isRating
                            ? 'rating'
                            : (dropdownOptions.length > 0
                                ? 'dropdown'
                                : (isDate ? 'date' : 'text'))));

                if (cellType === 'checkbox') {
                    cellValue = checkboxChecked ? 'TRUE' : 'FALSE';
                } else if (cellType === 'rating') {
                    const rating = this.normalizeRatingValue(cellValue);
                    cellValue = rating > 0 ? String(rating) : '';
                } else if (cellType === 'date') {
                    cellValue = dateInputValue || '';
                }

                // For merged master cells, ensure we get the value
                if (mergeInfo && mergeInfo.isMaster && !cellValue) {
                    // Try to get value from any cell in the merged range
                    for (let mr = mergeInfo.masterRow; mr <= mergeInfo.masterRow + mergeInfo.rowspan - 1; mr++) {
                        for (let mc = mergeInfo.masterCol; mc <= mergeInfo.masterCol + mergeInfo.colspan - 1; mc++) {
                            const testCell = worksheet.getRow(mr).getCell(mc);
                            const testValue = this.getCellValue(testCell);
                            if (testValue) {
                                cellValue = testValue;
                                break;
                            }
                        }
                        if (cellValue) break;
                    }
                }

                const cellData: any = {
                    value: cellValue,
                    hyperlink: hyperlinkUrl,
                    style: cellStyle,
                    cellType,
                    dropdownOptions,
                    checkboxChecked,
                    imageSrc,
                    colNumber: c,
                    rowNumber: r,
                    // Add data attributes for proper color handling
                    isDefaultColor: cellStyle._isDefaultColor || false,
                    // True when cell had no explicit background defined in the file
                    hasDefaultBg: !cellStyle.backgroundColor,
                    // True when the cell had an explicit white (or near-white) background
                    hasWhiteBackground: cellStyle._hasWhiteBackground || false,
                    hasBlackBorder: cellStyle._hasBlackBorder || false,
                    hasWhiteBorder: cellStyle._hasWhiteBorder || false,
                    hasBlackBackground: cellStyle._hasBlackBackground || false,
                    // True when cell has no explicit border (should use theme default)
                    hasDefaultBorder: cellStyle._hasDefaultBorder || false,
                    originalColor: cellStyle.color || 'rgb(0, 0, 0)',
                    isEmpty: !cell || (cell.value === null && !cellStyle.backgroundColor),
                    // Merged cell info
                    rowspan: mergeInfo ? mergeInfo.rowspan : 1,
                    colspan: mergeInfo ? mergeInfo.colspan : 1,
                    isMerged: !!(mergeInfo && mergeInfo.isMerged),
                    isMaster: !!(mergeInfo && mergeInfo.isMaster),
                    isMergeCovered: false,
                    masterRow: mergeInfo ? mergeInfo.masterRow : r,
                    masterCol: mergeInfo ? mergeInfo.masterCol : c
                };

                rowData.cells.push(cellData);
            }

            data.rows.push(rowData);
        }

        // Column widths
        data.columnWidths = [];
        for (let c = 1; c <= maxCol; c++) {
            const col = worksheet.getColumn(c);
            data.columnWidths.push(col.width || 10);
        }

        return data;
    }

    private parseRange(rangeStr: string): any {
        try {
            const clean = String(rangeStr || '').trim().replace(/\$/g, '').toUpperCase();
            if (!clean) return null;

            const parts = clean.split(':');
            const start = parts[0];
            const end = parts[1] || parts[0];

            const startCoord = this.parseCell(start);
            const endCoord = this.parseCell(end);

            if (startCoord && endCoord) {
                return {
                    startRow: Math.min(startCoord.row, endCoord.row),
                    startCol: Math.min(startCoord.col, endCoord.col),
                    endRow: Math.max(startCoord.row, endCoord.row),
                    endCol: Math.max(startCoord.col, endCoord.col)
                };
            }

            const colOnly = start.match(/^([A-Z]+)$/);
            const endColOnly = end.match(/^([A-Z]+)$/);
            if (colOnly && endColOnly) {
                const startCol = this.columnLettersToIndex(colOnly[1]);
                const endCol = this.columnLettersToIndex(endColOnly[1]);
                return {
                    startRow: 1,
                    startCol: Math.min(startCol, endCol),
                    endRow: 1048576,
                    endCol: Math.max(startCol, endCol)
                };
            }
        } catch {
            // ignore parse failures
        }
        return null;
    }

    private columnLettersToIndex(colStr: string): number {
        let col = 0;
        for (let i = 0; i < colStr.length; i++) {
            col = col * 26 + (colStr.charCodeAt(i) - 64);
        }
        return col;
    }

    private parseCell(cellStr: string): any {
        try {
            const match = String(cellStr || '').trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
            if (match) {
                const colStr = match[1];
                const rowStr = match[2];

                const col = this.columnLettersToIndex(colStr);

                return {
                    row: parseInt(rowStr, 10),
                    col
                };
            }
        } catch {
            // ignore parse failures
        }
        return null;
    }

    private parseBooleanLike(value: unknown): boolean | null {
        if (typeof value === 'boolean') {
            return value;
        }

        if (value === null || value === undefined) {
            return null;
        }

        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true' || normalized === 'yes' || normalized === 'y') {
            return true;
        }
        if (normalized === 'false' || normalized === 'no' || normalized === 'n') {
            return false;
        }

        return null;
    }

    private isBooleanOptionList(options: string[]): boolean {
        if (!Array.isArray(options) || options.length < 2) {
            return false;
        }

        const parsed = options
            .map((item) => this.parseBooleanLike(item))
            .filter((item): item is boolean => item !== null);

        if (parsed.length < 2) {
            return false;
        }

        return new Set(parsed).size === 2;
    }

    private normalizeRatingValue(value: unknown): number {
        const parsed = parseInt(String(value ?? ''), 10);
        if (!Number.isFinite(parsed)) {
            return 0;
        }
        return Math.max(0, Math.min(5, parsed));
    }

    private isRatingOptionList(options: string[]): boolean {
        if (!Array.isArray(options) || options.length < 5) {
            return false;
        }

        const parsed = options
            .map((item) => this.normalizeRatingValue(item))
            .filter((item) => item >= 1 && item <= 5);

        if (!parsed.length) {
            return false;
        }

        const unique = new Set(parsed);
        return unique.size === 5 && [1, 2, 3, 4, 5].every((v) => unique.has(v));
    }

    private isDateValidationCell(cell: Excel.Cell): boolean {
        const dv = (cell as any)?.dataValidation;
        return !!dv && dv.type === 'date';
    }

    private toIsoDateInputValue(value: unknown): string {
        if (!value) return '';

        let asDate: Date | null = null;
        if (value instanceof Date) {
            asDate = value;
        } else if (typeof value === 'string') {
            const raw = value.trim();
            if (!raw) return '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(raw)) {
                return '';
            }
            const parsed = new Date(raw);
            if (!Number.isNaN(parsed.getTime())) {
                asDate = parsed;
            }
        }

        if (!asDate) {
            return '';
        }

        if (Number.isNaN(asDate.getTime())) {
            return '';
        }

        const yyyy = asDate.getFullYear();
        const mm = String(asDate.getMonth() + 1).padStart(2, '0');
        const dd = String(asDate.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    private getInlineListOptions(formula: string): string[] {
        const trimmed = formula.trim();
        const unwrapped = trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed;
        const quoted = unwrapped.match(/^"([\s\S]*)"$/);
        if (!quoted) {
            return [];
        }

        return quoted[1]
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }

    private getDropdownOptions(cell: Excel.Cell, worksheet: Excel.Worksheet, workbook: Excel.Workbook): string[] {
        try {
            const dataValidation = (cell as any)?.dataValidation;
            if (!dataValidation || dataValidation.type !== 'list') {
                return [];
            }

            const formula = Array.isArray(dataValidation.formulae) ? String(dataValidation.formulae[0] || '').trim() : '';
            if (!formula) {
                return [];
            }

            const inline = this.getInlineListOptions(formula);
            if (inline.length > 0) {
                return inline;
            }

            const normalized = formula.startsWith('=') ? formula.slice(1).trim() : formula.trim();
            const sheetRef = normalized.match(/^'([^']+)'!(.+)$/) || normalized.match(/^([A-Za-z0-9_]+)!(.+)$/);

            let targetWorksheet = worksheet;
            let rangeExpr = normalized;

            if (sheetRef) {
                const sheetName = sheetRef[1];
                const target = workbook.getWorksheet(sheetName);
                if (!target) return [];
                targetWorksheet = target;
                rangeExpr = sheetRef[2];
            }

            const cleanRange = rangeExpr.replace(/\$/g, '').replace(/^=/, '');
            const parsed = this.parseRange(cleanRange);
            if (!parsed) {
                return [];
            }

            const options: string[] = [];
            const seen = new Set<string>();

            const MAX_OPTIONS = 80;
            const MAX_ROWS = 5000;
            const maxRow = Math.min(parsed.endRow, Math.max(parsed.startRow, parsed.startRow + MAX_ROWS - 1));
            let blankStreak = 0;
            let hasStarted = false;

            for (let row = parsed.startRow; row <= maxRow; row++) {
                for (let col = parsed.startCol; col <= parsed.endCol; col++) {
                    const value = this.getCellValue(targetWorksheet.getRow(row).getCell(col))
                        .replace(/<[^>]*>/g, '')
                        .trim();
                    if (!value) {
                        if (hasStarted) {
                            blankStreak++;
                            if (blankStreak >= 20) {
                                return options;
                            }
                        }
                        continue;
                    }

                    blankStreak = 0;
                    hasStarted = true;
                    if (seen.has(value)) continue;
                    seen.add(value);
                    options.push(value);

                    if (options.length >= MAX_OPTIONS) {
                        return options;
                    }
                }
            }

            return options;
        } catch {
            return [];
        }
    }

    private getImageDataUri(image: any): string {
        try {
            if (!image) return '';

            const extRaw = typeof image.extension === 'string' ? image.extension.toLowerCase() : 'png';
            const ext = extRaw === 'jpg' ? 'jpeg' : extRaw;
            const mime = ext === 'png' || ext === 'jpeg' || ext === 'gif' || ext === 'webp'
                ? `image/${ext}`
                : 'image/png';

            if (typeof image.base64 === 'string' && image.base64.trim().length > 0) {
                const trimmed = image.base64.trim();
                if (trimmed.startsWith('data:')) {
                    return trimmed;
                }
                return `data:${mime};base64,${trimmed}`;
            }

            if (image.buffer) {
                const buffer: Buffer = Buffer.isBuffer(image.buffer)
                    ? image.buffer
                    : Buffer.from(image.buffer);
                return `data:${mime};base64,${buffer.toString('base64')}`;
            }
        } catch {
            // ignore image conversion errors
        }
        return '';
    }

    private getWorksheetImageMap(workbook: Excel.Workbook, worksheet: Excel.Worksheet): Map<string, string> {
        const map = new Map<string, string>();

        try {
            const images = typeof (worksheet as any).getImages === 'function'
                ? (worksheet as any).getImages()
                : [];

            if (!Array.isArray(images)) {
                return map;
            }

            images.forEach((imgRef: any) => {
                try {
                    const image = workbook.getImage(imgRef.imageId);
                    const uri = this.getImageDataUri(image);
                    if (!uri) return;

                    const range = imgRef.range;
                    let row = 0;
                    let col = 0;

                    if (range && typeof range === 'object' && range.tl) {
                        row = Math.floor(Number(range.tl.nativeRow ?? range.tl.row ?? 0)) + 1;
                        col = Math.floor(Number(range.tl.nativeCol ?? range.tl.col ?? 0)) + 1;
                    } else if (range && typeof range === 'string') {
                        const parsed = this.parseRange(range.replace(/\$/g, ''));
                        if (parsed) {
                            row = parsed.startRow;
                            col = parsed.startCol;
                        }
                    }

                    if (row > 0 && col > 0) {
                        map.set(`${row}:${col}`, uri);
                    }
                } catch {
                    // ignore invalid image anchors
                }
            });
        } catch {
            // ignore image extraction errors
        }

        return map;
    }

    private getCellValue(cell: Excel.Cell): string {
        if (!cell || !cell.value) return '';

        // Some ExcelJS hyperlink cells expose the URL via cell.hyperlink even when cell.type isn't Hyperlink.
        // In those cases, keep showing the displayed text/value.
        const anyCell = cell as any;
        if (typeof anyCell.hyperlink === 'string' && anyCell.hyperlink) {
            const v = cell.value as any;
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object' && typeof v.text === 'string') return v.text;
        }

        // Handle different value types with proper type checking
        if (cell.type === Excel.ValueType.Hyperlink) {
            const hyperlinkValue = cell.value as Excel.CellHyperlinkValue;
            return hyperlinkValue.text || '';
        } else if (cell.type === Excel.ValueType.Formula) {
            return cell.result?.toString() || '';
        } else if (cell.type === Excel.ValueType.RichText) {
            const richTextValue = cell.value as Excel.CellRichTextValue;
            return richTextValue.richText.map((rt: any) => {
                let txt = (rt.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                if (rt.font) {
                    if (rt.font.bold) txt = `<b>${txt}</b>`;
                    if (rt.font.italic) txt = `<i>${txt}</i>`;
                    if (rt.font.color && rt.font.color.argb) {
                        const argb = rt.font.color.argb;
                        let hex = argb;
                        if (argb.length === 8) {
                            hex = '#' + argb.substring(2);
                        } else if (argb.length === 6) {
                            hex = '#' + argb;
                        }
                        if (hex.startsWith('#')) {
                            txt = `<span style="color: ${hex};">${txt}</span>`;
                        }
                    }
                }
                return txt;
            }).join('');
        } else if (cell.type === Excel.ValueType.Date) {
            const dateValue = cell.value as Date;
            return dateValue.toLocaleDateString();
        } else if (cell.value instanceof Date) {
            // Additional check for Date objects
            return cell.value.toLocaleDateString();
        } else if (typeof cell.value === 'boolean') {
            return cell.value ? 'TRUE' : 'FALSE';
        } else {
            return cell.value.toString();
        }
    }

    private getCellHyperlink(cell: Excel.Cell): string {
        try {
            if (!cell) return '';

            const anyCell = cell as any;
            if (typeof anyCell.hyperlink === 'string' && anyCell.hyperlink) {
                return anyCell.hyperlink;
            }

            if (cell.type === Excel.ValueType.Hyperlink) {
                const hyperlinkValue = cell.value as Excel.CellHyperlinkValue;
                return hyperlinkValue.hyperlink || '';
            }

            const v = cell.value as any;
            if (v && typeof v === 'object' && typeof v.hyperlink === 'string') {
                return v.hyperlink;
            }
        } catch {
            // ignore
        }
        return '';
    }

    private getCellStyle(cell: Excel.Cell): any {
        const style: any = {};
        let isDefaultColor = false;
        let hasBlackBorder = false;
        let hasBlackBackground = false;
        let hasWhiteBackground = false;

        // Background color
        if (cell.fill && cell.fill.type === 'pattern' && (cell.fill as any).fgColor) {
            const color = (cell.fill as any).fgColor;
            if (color.argb) {
                const bgColor = convertARGBToRGBA(color.argb);
                style.backgroundColor = bgColor;
                // Check if background is black or shade of black - be very strict
                hasBlackBackground = isShadeOfBlack(bgColor);
                // Check if background is white or shade of white
                hasWhiteBackground = isShadeOfWhite(bgColor);
            }
        }

        // Font
        if (cell.font) {
            if (cell.font.color && cell.font.color.argb) {
                const fontColor = convertARGBToRGBA(cell.font.color.argb);
                style.color = fontColor;
                // If it's a shade of black, we can treat it as default color for theme switching
                if (isShadeOfBlack(fontColor)) {
                    isDefaultColor = true;
                }
            } else {
                // No custom font color set, defaults to black
                style.color = 'rgb(0, 0, 0)';
                isDefaultColor = true;
            }
            if (cell.font.bold) style.fontWeight = 'bold';
            if (cell.font.italic) style.fontStyle = 'italic';
            if (cell.font.underline) style.textDecoration = 'underline';
            if (cell.font.strike) style.textDecoration = (style.textDecoration || '') + ' line-through';
            if (cell.font.size) style.fontSize = `${cell.font.size}pt`;
            if (cell.font.name) style.fontFamily = cell.font.name;
        } else {
            // No font styling at all, defaults to black
            style.color = 'rgb(0, 0, 0)';
            isDefaultColor = true;
        }

        // Alignment
        if (cell.alignment) {
            if (cell.alignment.horizontal) {
                switch (cell.alignment.horizontal) {
                    case 'left':
                        style.textAlign = 'left';
                        break;
                    case 'center':
                        style.textAlign = 'center';
                        break;
                    case 'right':
                        style.textAlign = 'right';
                        break;
                    case 'justify':
                        style.textAlign = 'justify';
                        break;
                    default:
                        style.textAlign = cell.alignment.horizontal;
                }
            }
            if (cell.alignment.vertical) {
                switch (cell.alignment.vertical) {
                    case 'top':
                        style.verticalAlign = 'top';
                        break;
                    case 'middle':
                        style.verticalAlign = 'middle';
                        break;
                    case 'bottom':
                        style.verticalAlign = 'bottom';
                        break;
                    default:
                        style.verticalAlign = cell.alignment.vertical;
                }
            }
            if (cell.alignment.wrapText) {
                style.whiteSpace = 'pre-wrap';
                style.wordWrap = 'break-word';
            }
            if (cell.alignment.indent) {
                style.paddingLeft = `${cell.alignment.indent * 8}px`;
            }
        }

        // Borders
        let hasWhiteBorder = false;
        if (cell.border) {
            style.border = {};
            ['top', 'right', 'bottom', 'left'].forEach(side => {
                const border = (cell.border as any)[side];
                if (border && border.style) {
                    const originalColor = border.color && border.color.argb
                        ? convertARGBToRGBA(border.color.argb)
                        : 'rgba(0, 0, 0, 1)';

                    // Only mark as black border if it's actually black or a shade of black
                    const isBlack = isShadeOfBlack(originalColor);
                    if (isBlack) {
                        hasBlackBorder = true;
                    }

                    // Check for white borders
                    const isWhite = isShadeOfWhite(originalColor);
                    if (isWhite) {
                        hasWhiteBorder = true;
                    }

                    let width = '1px';
                    let styleStr = 'solid';

                    switch (border.style) {
                        case 'thin': width = '1px'; break;
                        case 'medium': width = '2px'; break;
                        case 'thick': width = '3px'; break;
                        case 'dotted': styleStr = 'dotted'; break;
                        case 'dashed': styleStr = 'dashed'; break;
                        case 'dashDot':
                        case 'dashDotDot':
                        case 'slantDashDot':
                            styleStr = 'dashed';
                            break;
                        case 'mediumDashed':
                        case 'mediumDashDot':
                        case 'mediumDashDotDot':
                            width = '2px';
                            styleStr = 'dashed';
                            break;
                        case 'hair':
                            styleStr = 'dotted';
                            break;
                        case 'double': styleStr = 'double'; width = '3px'; break;
                    }

                    style.border[side] = `${width} ${styleStr} ${originalColor}`;
                }
            });
        }

        // Track if cell has no explicit border (should use theme default)
        const hasExplicitBorder = cell.border && (
            cell.border.top || cell.border.right || cell.border.bottom || cell.border.left
        );

        // Add tracking properties for dark mode handling
        style._isDefaultColor = isDefaultColor;
        style._hasBlackBorder = hasBlackBorder;
        style._hasWhiteBorder = hasWhiteBorder;
        style._hasBlackBackground = hasBlackBackground;
        style._hasWhiteBackground = hasWhiteBackground;
        style._hasDefaultBorder = !hasExplicitBorder;

        return style;
    }

    private getExcelColumnLabel(n: number): string {
        let label = '';
        while (n > 0) {
            let rem = (n - 1) % 26;
            label = String.fromCharCode(65 + rem) + label;
            n = Math.floor((n - 1) / 26);
        }
        return label;
    }


}


