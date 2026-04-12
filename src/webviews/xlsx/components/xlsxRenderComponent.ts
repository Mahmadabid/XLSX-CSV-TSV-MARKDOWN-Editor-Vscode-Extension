/* eslint-disable @typescript-eslint/no-explicit-any */

export function getExcelColumnLabel(n: number): string {
    let label = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        label = String.fromCharCode(65 + rem) + label;
        n = Math.floor((n - 1) / 26);
    }
    return label;
}

export function formatCellStyle(style: any): string {
    let css = '';

    if (style.backgroundColor) css += 'background-color: ' + style.backgroundColor + ';';
    if (style.color) css += 'color: ' + style.color + ';';
    if (style.fontWeight) css += 'font-weight: ' + style.fontWeight + ';';
    if (style.fontStyle) css += 'font-style: ' + style.fontStyle + ';';
    if (style.textDecoration) css += 'text-decoration: ' + style.textDecoration + ';';
    if (style.fontSize) css += 'font-size: ' + style.fontSize + ';';
    if (style.fontFamily) css += 'font-family: ' + style.fontFamily + ';';
    if (style.textAlign) css += 'text-align: ' + style.textAlign + ';';
    if (style.verticalAlign) css += 'vertical-align: ' + style.verticalAlign + ';';
    if (style.whiteSpace) css += 'white-space: ' + style.whiteSpace + ';';
    if (style.wordWrap) css += 'word-wrap: ' + style.wordWrap + ';';
    if (style.paddingLeft) css += 'padding-left: ' + style.paddingLeft + ';';

    if (style.border) {
        if (style.border.top) css += 'border-top: ' + style.border.top + ';';
        if (style.border.right) css += 'border-right: ' + style.border.right + ';';
        if (style.border.bottom) css += 'border-bottom: ' + style.border.bottom + ';';
        if (style.border.left) css += 'border-left: ' + style.border.left + ';';
    }

    return css;
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toPlainCellContent(value: unknown): string {
    const raw = value === null || value === undefined ? '' : String(value);
    if (!raw) return '&nbsp;';

    const tmp = document.createElement('div');
    tmp.innerHTML = raw;
    const plain = (tmp.textContent || tmp.innerText || '').replace(/\u00a0/g, ' ').trim();

    return plain ? escapeHtml(plain) : '&nbsp;';
}

export interface XlsxRowHtmlParams {
    rowData: any;
    rowIndex: number;
    rowHeight: number;
    columnCount: number;
    columnWidths: number[];
    isPlainView: boolean;
    isEditMode: boolean;
}

export function createXlsxRowHtml(params: XlsxRowHtmlParams): string {
    const {
        rowData,
        rowIndex,
        rowHeight,
        columnCount,
        columnWidths,
        isPlainView,
        isEditMode
    } = params;

    const isHeaderRow = rowIndex === 0;

    let html = '<tr data-virtual-row="' + rowIndex + '" style="height: ' + rowHeight + 'px;"' + (isHeaderRow ? ' class="header-row"' : '') + '>';
    html += '<th class="row-header" data-row="' + rowIndex + '" style="height: ' + rowHeight + 'px;">';
    html += rowData.rowNumber || (rowIndex + 1);
    html += '<div class="row-resize-handle" data-row="' + rowIndex + '"></div>';
    html += '</th>';

    let virtualColIndex = 0;
    for (let actualCol = 1; actualCol <= columnCount; actualCol++) {
        const cellData = rowData.cells ? rowData.cells.find((cell: any) => cell.colNumber === actualCol) : null;

        if (cellData) {
            const styleStr = isPlainView ? '' : formatCellStyle(cellData.style || {});
            const cellHeight = rowHeight * (cellData.rowspan || 1);
            const cellWidth = columnWidths
                .slice(actualCol - 1, actualCol - 1 + (cellData.colspan || 1))
                .reduce((sum, w) => sum + (w || 80), 0);

            html += '<td';
            html += ' data-row="' + rowIndex + '"';
            html += ' data-col="' + virtualColIndex + '"';
            html += ' data-rownum="' + cellData.rowNumber + '"';
            html += ' data-colnum="' + cellData.colNumber + '"';

            if (!isPlainView) {
                if (cellData.hasDefaultBg) html += ' data-default-bg="true"';
                if (cellData.hasWhiteBackground) html += ' data-white-bg="true"';
                if (cellData.isDefaultColor) html += ' data-default-color="true"';
                if (cellData.hasBlackBorder) html += ' data-black-border="true"';
                if (cellData.hasWhiteBorder) html += ' data-white-border="true"';
                if (cellData.hasBlackBackground) html += ' data-black-bg="true"';
                if (cellData.hasDefaultBorder) html += ' data-default-border="true"';
            }
            if (cellData.isEmpty) html += ' data-empty="true"';
            if (cellData.hyperlink) html += ' data-hyperlink="' + String(cellData.hyperlink).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') + '"';
            html += ' data-original-color="' + (cellData.originalColor || 'rgb(0, 0, 0)') + '"';

            if (!isPlainView) {
                if (cellData.rowspan > 1) html += ' rowspan="' + cellData.rowspan + '"';
                if (cellData.colspan > 1) html += ' colspan="' + cellData.colspan + '"';
                if (cellData.isMerged) html += ' class="merged-cell"';
            }

            let cellStyleStr = styleStr;
            if (!isPlainView && cellData.isMerged) {
                cellStyleStr += 'height: ' + cellHeight + 'px; width: ' + cellWidth + 'px;';
            } else {
                cellStyleStr += 'height: ' + rowHeight + 'px;';
            }

            if (isEditMode) {
                html += ' contenteditable="true" spellcheck="false"';
            }

            if (cellStyleStr) {
                html += ' style="' + cellStyleStr + '"';
            }
            html += '>';
            const cellContent = isPlainView ? toPlainCellContent(cellData.value) : (cellData.value || '&nbsp;');
            html += '<span class="cell-content">' + cellContent + '</span>';
            html += '</td>';
        } else {
            html += '<td data-row="' + rowIndex + '" data-col="' + virtualColIndex + '"';
            html += ' data-rownum="' + (rowIndex + 1) + '"';
            html += ' data-colnum="' + actualCol + '"';
            if (!isPlainView) {
                html += ' data-default-bg="true" data-default-color="true" data-default-border="true"';
            }
            html += ' data-empty="true"';
            html += ' data-original-color="rgb(0, 0, 0)"';
            if (isEditMode) {
                html += ' contenteditable="true" spellcheck="false"';
            }
            html += ' style="height: ' + rowHeight + 'px;">';
            html += '<span class="cell-content">&nbsp;</span>';
            html += '</td>';
        }
        virtualColIndex++;
    }

    html += '</tr>';
    return html;
}
