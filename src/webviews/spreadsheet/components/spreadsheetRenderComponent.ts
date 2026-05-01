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
    if (style.color) {
        const isDefaultColor = style._isDefaultColor === true;
        css += 'color: ' + style.color + (isDefaultColor ? '' : ' !important') + ';';
    }
    if (style.fontWeight) css += 'font-weight: ' + style.fontWeight + ';';
    if (style.fontStyle) css += 'font-style: ' + style.fontStyle + ';';
    if (style.textDecoration) css += 'text-decoration: ' + style.textDecoration + ';';
    if (style.textDecorationLine) css += 'text-decoration-line: ' + style.textDecorationLine + ';';
    if (style.textDecorationThickness) css += 'text-decoration-thickness: ' + style.textDecorationThickness + ';';
    if (style.textDecorationSkipInk) css += 'text-decoration-skip-ink: ' + style.textDecorationSkipInk + ';';
    if (style.fontSize) css += 'font-size: ' + style.fontSize + ';';
    if (style.fontFamily) css += 'font-family: ' + style.fontFamily + ';';
    if (style.textAlign) css += 'text-align: ' + style.textAlign + ';';
    if (style.verticalAlign) css += 'vertical-align: ' + style.verticalAlign + ';';
    if (style.whiteSpace) css += 'white-space: ' + style.whiteSpace + ';';
    if (style.wordWrap) css += 'word-wrap: ' + style.wordWrap + ';';
    if (style.overflow) css += 'overflow: ' + style.overflow + ';';
    if (style.textOverflow) css += 'text-overflow: ' + style.textOverflow + ';';
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

function escapeAttribute(input: string): string {
    return escapeHtml(input);
}

function parseBooleanLike(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;

    if (value === null || value === undefined) {
        return null;
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y') {
        return true;
    }
    if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'n') {
        return false;
    }

    return null;
}

function toCellType(cellData: any): string {
    const rawType = typeof cellData?.cellType === 'string' ? cellData.cellType.trim().toLowerCase() : '';
    if (rawType === 'checkbox' || rawType === 'dropdown' || rawType === 'image' || rawType === 'rating' || rawType === 'date') {
        return rawType;
    }
    return 'text';
}

function normalizeDateInputValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }

    const raw = String(value).trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
        return raw;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function normalizeDropdownOptions(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const unique = new Set<string>();
    raw.forEach((entry) => {
        const text = String(entry ?? '').trim();
        if (text) unique.add(text);
    });

    return Array.from(unique.values());
}

function toCellDisplayValue(cellData: any): string {
    const cellType = toCellType(cellData);
    if (cellType === 'checkbox') {
        const parsed = parseBooleanLike(cellData?.checkboxChecked ?? cellData?.value);
        return parsed ? 'TRUE' : 'FALSE';
    }

    if (cellType === 'rating') {
        const numeric = parseInt(String(cellData?.value ?? ''), 10);
        if (!Number.isFinite(numeric) || numeric < 1) {
            return '0';
        }
        return String(Math.min(5, numeric));
    }

    if (cellType === 'date') {
        return normalizeDateInputValue(cellData?.value);
    }

    return cellData?.value === null || cellData?.value === undefined
        ? ''
        : String(cellData.value);
}

export interface DropdownCellContentOptions {
    options: string[];
    selectedValue: string;
    allowInteractiveControls: boolean;
    showEditButton?: boolean;
}

export function renderDropdownCellContent(options: DropdownCellContentOptions): string {
    const normalizedOptions = normalizeDropdownOptions(options.options || []);
    const selectedValue = String(options.selectedValue || '');
    const disabledAttr = options.allowInteractiveControls ? '' : ' disabled';

    if (selectedValue && !normalizedOptions.includes(selectedValue)) {
        normalizedOptions.unshift(selectedValue);
    }

    if (!normalizedOptions.length) {
        normalizedOptions.push('');
    }

    const optionsHtml = normalizedOptions
        .map((option) => {
            const isSelected = option === selectedValue;
            return '<option value="' + escapeAttribute(option) + '"' + (isSelected ? ' selected' : '') + '>'
                + escapeHtml(option)
                + '</option>';
        })
        .join('');

    const editButtonHtml = options.showEditButton
        ? '<button type="button" class="xlsx-dropdown-edit-button" aria-label="Edit dropdown options" title="Edit options">Edit</button>'
        : '';

    return '<span class="cell-content cell-dropdown-content">'
        + '<select class="xlsx-cell-dropdown" aria-label="Cell dropdown"' + disabledAttr + '>'
        + optionsHtml
        + '</select>'
        + editButtonHtml
        + '</span>';
}

function renderCellContent(cellData: any, isPlainView: boolean, allowInteractiveControls: boolean, isEditMode: boolean): string {
    const cellType = toCellType(cellData);
    const cellDisplayValue = toCellDisplayValue(cellData);

    if (isPlainView) {
        return '<span class="cell-content">' + toPlainCellContent(cellDisplayValue) + '</span>';
    }

    if (cellType === 'checkbox') {
        const checked = parseBooleanLike(cellData?.checkboxChecked ?? cellData?.value) === true;
        const checkedAttr = checked ? ' checked' : '';
        const disabledAttr = allowInteractiveControls ? '' : ' disabled';
        const label = checked ? 'TRUE' : 'FALSE';
        return '<span class="cell-content cell-checkbox-content">'
            + '<input type="checkbox" class="xlsx-cell-checkbox" aria-label="Cell checkbox"'
            + checkedAttr
            + disabledAttr
            + ' />'
            + '<span class="checkbox-value">' + label + '</span>'
            + '</span>';
    }

    if (cellType === 'dropdown') {
        const options = normalizeDropdownOptions(cellData?.dropdownOptions);
        const selectedValue = cellDisplayValue;
        return renderDropdownCellContent({
            options,
            selectedValue,
            allowInteractiveControls,
            showEditButton: isEditMode
        });
    }

    if (cellType === 'rating') {
        const maxRating = 5;
        const parsed = parseInt(cellDisplayValue || '0', 10);
        const ratingValue = Number.isFinite(parsed) ? Math.max(0, Math.min(maxRating, parsed)) : 0;
        const disabledAttr = allowInteractiveControls ? '' : ' disabled';

        let starsHtml = '';
        for (let i = 1; i <= maxRating; i++) {
            const activeClass = i <= ratingValue ? ' active' : '';
            starsHtml += `<button type="button" class="xlsx-rating-star${activeClass}" data-rating-value="${i}" aria-label="Rate ${i} of ${maxRating}"${disabledAttr}>★</button>`;
        }

        return `<span class="cell-content cell-rating-content" data-rating-value="${ratingValue}">${starsHtml}<span class="rating-value">${ratingValue || ''}</span></span>`;
    }

    if (cellType === 'date') {
        const dateValue = normalizeDateInputValue(cellDisplayValue);
        const disabledAttr = allowInteractiveControls ? '' : ' disabled';
        const valueAttr = dateValue ? ` value="${escapeAttribute(dateValue)}"` : '';
        return `<span class="cell-content cell-date-content"><input type="date" class="xlsx-cell-date" aria-label="Cell date"${valueAttr}${disabledAttr} /></span>`;
    }

    if (cellType === 'image') {
        const src = typeof cellData?.imageSrc === 'string' ? cellData.imageSrc : '';
        const safeSrc = escapeAttribute(src);
        const fallbackText = cellDisplayValue ? '<span class="cell-image-label">' + escapeHtml(cellDisplayValue) + '</span>' : '';
        if (!safeSrc) {
            return '<span class="cell-content">' + (cellDisplayValue || '&nbsp;') + '</span>';
        }

        return '<span class="cell-content cell-image-content">'
            + '<img class="xlsx-cell-image" src="' + safeSrc + '" alt="Cell image" loading="lazy" />'
            + fallbackText
            + '</span>';
    }

    const text = cellData?.value || '&nbsp;';
    return '<span class="cell-content">' + text + '</span>';
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
    allowInteractiveControls: boolean;
}

export function createXlsxRowHtml(params: XlsxRowHtmlParams): string {
    const {
        rowData,
        rowIndex,
        rowHeight,
        columnCount,
        columnWidths,
        isPlainView,
        isEditMode,
        allowInteractiveControls
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

        if (cellData && cellData.isMergeCovered) {
            virtualColIndex++;
            continue;
        }

        if (cellData) {
            const styleStr = isPlainView ? '' : formatCellStyle(cellData.style || {});
            const cellHeight = rowHeight * (cellData.rowspan || 1);
            const cellWidth = columnWidths
                .slice(actualCol - 1, actualCol - 1 + (cellData.colspan || 1))
                .reduce((sum, w) => sum + (w || 80), 0);
            const cellType = toCellType(cellData);

            html += '<td';
            html += ' data-row="' + rowIndex + '"';
            html += ' data-col="' + virtualColIndex + '"';
            html += ' data-rownum="' + cellData.rowNumber + '"';
            html += ' data-colnum="' + cellData.colNumber + '"';
            html += ' data-cell-type="' + escapeAttribute(cellType) + '"';
            if (cellType === 'checkbox') {
                const checked = parseBooleanLike(cellData?.checkboxChecked ?? cellData?.value) === true;
                html += ' data-checkbox-checked="' + (checked ? 'true' : 'false') + '"';
            } else if (cellType === 'dropdown') {
                html += ' data-dropdown-value="' + escapeAttribute(String(cellData?.value ?? '')) + '"';
            } else if (cellType === 'rating') {
                const rating = parseInt(String(cellData?.value ?? '0'), 10);
                const safeRating = Number.isFinite(rating) ? Math.max(0, Math.min(5, rating)) : 0;
                html += ' data-rating-value="' + safeRating + '"';
            } else if (cellType === 'date') {
                html += ' data-date-value="' + escapeAttribute(normalizeDateInputValue(cellData?.value)) + '"';
            }

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
            }

            let classes = [];
            if (!isPlainView && cellData.isMerged) classes.push('merged-cell');
            if (isEditMode) classes.push('editable-cell');
            
            if (classes.length > 0) {
                html += ' class="' + classes.join(' ') + '"';
            }

            let cellStyleStr = styleStr;
            if (!isPlainView && cellData.isMerged) {
                cellStyleStr += 'height: ' + cellHeight + 'px; width: ' + cellWidth + 'px;';
            } else {
                cellStyleStr += 'height: ' + rowHeight + 'px;';
            }

            if (cellStyleStr) {
                html += ' style="' + cellStyleStr + '"';
            }
            html += '>';
            html += renderCellContent(cellData, isPlainView, allowInteractiveControls, isEditMode);
            html += '</td>';
        } else {
            html += '<td data-row="' + rowIndex + '" data-col="' + virtualColIndex + '"';
            html += ' data-rownum="' + (rowIndex + 1) + '"';
            html += ' data-colnum="' + actualCol + '"';
            html += ' data-cell-type="text"';
            if (!isPlainView) {
                html += ' data-default-bg="true" data-default-color="true" data-default-border="true"';
            }
            html += ' data-empty="true"';
            html += ' data-original-color="rgb(0, 0, 0)"';
            if (isEditMode) {
                html += ' class="editable-cell"';
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
