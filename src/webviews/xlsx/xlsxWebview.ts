/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { ThemeManager } from '../shared/themeManager';
import { SettingsManager } from '../shared/settingsManager';
import { ToolbarManager } from '../shared/toolbarManager';
import { Utils } from '../shared/utils';
import { Icons } from '../shared/icons';
import { vscode, VirtualScrollConfig, debounce } from '../shared/common';
import { VirtualLoader } from '../shared/virtualLoader';
import { InfoTooltip } from '../shared/infoTooltip';
import { createXlsxRowHtml, getExcelColumnLabel } from './components/xlsxRenderComponent';
import { XlsxSelectionManager } from './components/xlsxSelectionComponent';
import { createXlsxToolbarButtons } from './components/xlsxToolbarComponent';
import {
    XlsxViewSettings,
    defaultXlsxViewSettings,
    normalizeXlsxSettings,
    syncSettingsCheckboxes,
    createXlsxSettingsDefinitions
} from './components/xlsxSettingsComponent';

(function () {
    // ===== Virtual Scrolling Configuration =====
    const { ROW_HEIGHT, BUFFER_ROWS, CHUNK_SIZE } = VirtualScrollConfig;
    const textColorIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M8.5 16h7"/><path d="M12 4l4 12"/><path d="M12 4L8 16"/></svg>';
    const bgColorIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l8 8-6 6-8-8z"/><path d="M2 20h20"/></svg>';

    // Data injected from the extension via postMessage
    let worksheetsMeta: any[] = [];
    let currentWorksheet = 0;

    // Virtual scrolling state
    let totalRows = 0;
    let columnCount = 0;
    let columnWidths: number[] = [];
    let mergedCells: any[] = [];
    let allRowHeights: number[] = []; // Pre-loaded row heights from extension
    let totalContentHeight = 0; // Pre-calculated total height
    let rowCache = new Map<number, any>();
    const virtualLoader = new VirtualLoader<any[]>('getRows');
    let currentVisibleStart = 0;
    let currentVisibleEnd = 0;
    let isRequestingRows = false;
    let isRendering = false; // Prevent re-render during render

    // Selection state
    const selectedCells = new Set<HTMLElement>();
    let activeCell: HTMLElement | null = null;
    let isSelecting = false;
    let selectionStart: { row: number, col: number } | null = null;
    let selectionEnd: { row: number, col: number } | null = null;
    const selectedRows = new Set<number>();
    const selectedColumns = new Set<number>();
    let lastSelectedRow: number | null = null;
    let lastSelectedColumn: number | null = null;

    // Track selected row/column indices for full copy (virtualization support)
    const selectedRowIndices = new Set<number>();
    const selectedColumnIndices = new Set<number>();

    const selectionManager = new XlsxSelectionManager({
        selectedCells,
        selectedRows,
        selectedColumns,
        selectedRowIndices,
        selectedColumnIndices,
        getActiveCell: () => activeCell,
        setActiveCell: (cell) => {
            activeCell = cell;
        },
        getLastSelectedRow: () => lastSelectedRow,
        setLastSelectedRow: (value) => {
            lastSelectedRow = value;
        },
        getLastSelectedColumn: () => lastSelectedColumn,
        setLastSelectedColumn: (value) => {
            lastSelectedColumn = value;
        },
        getTotalRows: () => totalRows,
        getColumnCount: () => columnCount
    });

    // Resize state
    let isResizing = false;
    let resizeType: 'column' | 'row' | null = null; // 'column' or 'row'
    let resizeIndex = -1;
    let resizeStartPos = 0;
    let resizeStartSize = 0;

    // Auto-scroll while dragging selection
    let autoScrollRequest: any = null;
    let lastMousePos: { x: number, y: number } | null = null; // { x, y }
    const AUTO_SCROLL_THRESHOLD = 40; // px
    const AUTO_SCROLL_STEP = 20; // px per frame

    let handlersAttached = false;
    let selectionGlobalListenersAttached = false;
    let toolbarManager: ToolbarManager | null = null;

    // Settings (persisted by extension)
    let currentSettings: XlsxViewSettings = { ...defaultXlsxViewSettings };

    // Table edit mode (text-only)
    let isEditMode = false;
    let lastEditRange: Range | null = null;
    let lastFocusedEditableCell: HTMLElement | null = null;
    type StructuralOpType = 'insertRowAbove' | 'insertRowBelow' | 'deleteRow' | 'insertColumnLeft' | 'insertColumnRight' | 'deleteColumn';
    type WorksheetOpType = StructuralOpType | 'deleteCellShiftLeft' | 'deleteCellShiftUp';
    interface StructuralOp {
        type: StructuralOpType;
        index: number; // 1-based row or column index
    }
    interface WorksheetOp {
        type: WorksheetOpType;
        index?: number;
        row?: number;
        col?: number;
    }
    interface CellStyleEdit {
        row: number;
        col: number;
        bgColor?: string;
        textColor?: string;
    }
    let pendingWorksheetOps: WorksheetOp[] = [];
    const pendingCellStyleEdits = new Map<string, CellStyleEdit>();
    let headerContextMenuEl: HTMLElement | null = null;
    let colorPaletteEl: HTMLElement | null = null;
    let activeColorTarget: 'text' | 'background' | null = null;
    let selectedTextColor = '#202124';
    let selectedBgColor = '#ffffff';

    // Save state (CSV-parity)
    let isSaving = false;
    let exitAfterSave = false;
    let isVersionPreviewMode = false;
    let previewVersionId: string | null = null;

    // Plain view mode (removes all XLSX styling)
    let isPlainView = false;

    // Hyperlink hover tooltip
    let linkTooltip: HTMLElement | null = null;
    let linkTooltipHideTimer: any = null;

    // Toast
    let toastEl: HTMLElement | null = null;

    // Copy state (CSV-parity: avoid concurrent copies)
    let isCopying = false;

    function setButtonsEnabled(enabled: boolean) {
        const saveBtn = document.getElementById('saveTableEditsButton') as HTMLButtonElement;
        const cancelBtn = document.getElementById('cancelTableEditsButton') as HTMLButtonElement;
        if (saveBtn) saveBtn.disabled = !enabled;
        if (cancelBtn) cancelBtn.disabled = !enabled;
    }

    async function ensureAllRowsLoadedForStructureEdits() {
        if (rowCache.size >= totalRows && totalRows > 0) return true;

        setLoadingText('Preparing full sheet for structure changes...');
        showLoading();

        try {
            const allRows = await requestAllRows();
            if (!allRows || allRows.length === 0) {
                showToast('Unable to load rows for structure edit');
                return false;
            }

            rowCache.clear();
            for (let i = 0; i < allRows.length; i++) {
                rowCache.set(i, allRows[i] || { cells: [], rowNumber: i + 1, height: allRowHeights[i] || ROW_HEIGHT });
            }

            if (allRows.length > totalRows) {
                totalRows = allRows.length;
            }

            return true;
        } finally {
            hideLoading();
            setLoadingText('Rendering worksheet...');
        }
    }

    function getMutableRowsSnapshot(): any[] {
        const rows: any[] = [];
        for (let i = 0; i < totalRows; i++) {
            rows.push(rowCache.get(i) || { cells: [], rowNumber: i + 1, height: allRowHeights[i] || ROW_HEIGHT });
        }
        return rows;
    }

    function getEffectiveRowHeightFromValue(height: number): number {
        if (!currentSettings.spaciousCells) return height;
        return Math.max(height + 8, 28);
    }

    function getEffectiveRowHeightByIndex(rowIndex: number): number {
        const base = allRowHeights[rowIndex] || ROW_HEIGHT;
        return getEffectiveRowHeightFromValue(base);
    }

    function getCellFromRow(row: any, colNumber: number): any | null {
        if (!row || !Array.isArray(row.cells)) return null;
        return row.cells.find((cell: any) => cell.colNumber === colNumber) || null;
    }

    function cloneCellData(cell: any): any {
        return JSON.parse(JSON.stringify(cell));
    }

    function setCellOnRow(row: any, colNumber: number, sourceCell: any | null) {
        if (!row || !Array.isArray(row.cells)) row.cells = [];
        const existingIndex = row.cells.findIndex((cell: any) => cell.colNumber === colNumber);

        if (!sourceCell) {
            if (existingIndex >= 0) {
                row.cells.splice(existingIndex, 1);
            }
            return;
        }

        const nextCell = cloneCellData(sourceCell);
        nextCell.colNumber = colNumber;
        nextCell.rowNumber = row.rowNumber;

        if (existingIndex >= 0) {
            row.cells[existingIndex] = nextCell;
        } else {
            row.cells.push(nextCell);
        }

        row.cells.sort((a: any, b: any) => a.colNumber - b.colNumber);
    }

    function normalizeRowsAfterStructureChange(rows: any[]) {
        rows.forEach((row, rowIndex) => {
            row.rowNumber = rowIndex + 1;
            if (!Array.isArray(row.cells)) row.cells = [];
            row.cells.forEach((cell: any) => {
                cell.rowNumber = rowIndex + 1;
            });
        });

        rowCache.clear();
        rows.forEach((row, idx) => {
            rowCache.set(idx, row);
        });
    }

    function rerenderCurrentSheetFromLocalState() {
        const container = document.getElementById('tableContainer');
        if (!container) return;

        currentVisibleStart = 0;
        currentVisibleEnd = 0;
        isRendering = false;

        container.innerHTML = createTableShell();
        initializeSelection();
        initializeResize();
        initializeHyperlinkHover();
        initializeVirtualScrolling();
    }

    async function applyStructureOperation(op: StructuralOp) {
        if (!isEditMode) return;

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) return;

        const rows = getMutableRowsSnapshot();
        const target = op.index;
        const prevSelectedRows = Array.from(selectedRowIndices.values()).sort((a, b) => a - b);
        const prevSelectedCols = Array.from(selectedColumnIndices.values()).sort((a, b) => a - b);

        if (op.type === 'insertRowAbove' || op.type === 'insertRowBelow' || op.type === 'deleteRow') {
            if (op.type === 'deleteRow' && totalRows <= 1) {
                showToast('Cannot delete the last row');
                return;
            }

            const insertAt = op.type === 'insertRowAbove' ? target - 1 : target;
            if (op.type === 'insertRowAbove' || op.type === 'insertRowBelow') {
                rows.splice(Math.max(0, insertAt), 0, { cells: [], rowNumber: 0, height: ROW_HEIGHT });
                allRowHeights.splice(Math.max(0, insertAt), 0, ROW_HEIGHT);
                totalRows += 1;
            } else {
                rows.splice(Math.max(0, target - 1), 1);
                allRowHeights.splice(Math.max(0, target - 1), 1);
                totalRows = Math.max(1, totalRows - 1);
            }
        } else {
            if (op.type === 'deleteColumn' && columnCount <= 1) {
                showToast('Cannot delete the last column');
                return;
            }

            const atCol = op.type === 'insertColumnLeft' ? target : (op.type === 'insertColumnRight' ? target + 1 : target);

            rows.forEach((row: any) => {
                if (!Array.isArray(row.cells)) row.cells = [];

                if (op.type === 'deleteColumn') {
                    row.cells = row.cells
                        .filter((cell: any) => cell.colNumber !== atCol)
                        .map((cell: any) => {
                            if (cell.colNumber > atCol) cell.colNumber -= 1;
                            return cell;
                        });
                } else {
                    row.cells = row.cells.map((cell: any) => {
                        if (cell.colNumber >= atCol) cell.colNumber += 1;
                        return cell;
                    });
                }
            });

            if (op.type === 'deleteColumn') {
                columnWidths.splice(Math.max(0, atCol - 1), 1);
                columnCount = Math.max(1, columnCount - 1);
            } else {
                columnWidths.splice(Math.max(0, atCol - 1), 0, 80);
                columnCount += 1;
            }
        }

        pendingWorksheetOps.push(op);
        normalizeRowsAfterStructureChange(rows);
        mergedCells = [];

        selectedCells.clear();
        activeCell = null;

        if (op.type === 'insertRowAbove' || op.type === 'insertRowBelow' || op.type === 'deleteRow') {
            selectedRowIndices.clear();
            const pivot = op.type === 'insertRowAbove' ? target - 1 : (op.type === 'insertRowBelow' ? target : target - 1);
            prevSelectedRows.forEach(r => {
                let next = r;
                if (op.type === 'insertRowAbove' && r >= pivot) next = r + 1;
                if (op.type === 'insertRowBelow' && r > pivot) next = r + 1;
                if (op.type === 'deleteRow') {
                    if (r === pivot) {
                        next = Math.min(pivot, totalRows - 1);
                    } else if (r > pivot) {
                        next = r - 1;
                    }
                }
                next = Math.max(0, Math.min(totalRows - 1, next));
                selectedRowIndices.add(next);
            });
            selectedRows.clear();
            selectedRowIndices.forEach(v => selectedRows.add(v));
        } else {
            selectedColumnIndices.clear();
            const pivot = op.type === 'insertColumnLeft' ? target - 1 : (op.type === 'insertColumnRight' ? target : target - 1);
            prevSelectedCols.forEach(c => {
                let next = c;
                if (op.type === 'insertColumnLeft' && c >= pivot) next = c + 1;
                if (op.type === 'insertColumnRight' && c > pivot) next = c + 1;
                if (op.type === 'deleteColumn') {
                    if (c === pivot) {
                        next = Math.min(pivot, columnCount - 1);
                    } else if (c > pivot) {
                        next = c - 1;
                    }
                }
                next = Math.max(0, Math.min(columnCount - 1, next));
                selectedColumnIndices.add(next);
            });
            selectedColumns.clear();
            selectedColumnIndices.forEach(v => selectedColumns.add(v));
        }

        hideHeaderContextMenu();
        rerenderCurrentSheetFromLocalState();
    }

    async function applyCellDeleteOperation(type: 'deleteCellShiftLeft' | 'deleteCellShiftUp', rowNumber: number, colNumber: number) {
        if (!isEditMode) return;
        if (rowNumber <= 0 || colNumber <= 0) return;

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) return;

        const rows = getMutableRowsSnapshot();

        if (type === 'deleteCellShiftLeft') {
            const rowIndex = rowNumber - 1;
            const row = rows[rowIndex];
            if (!row) return;

            for (let col = colNumber; col < columnCount; col++) {
                const nextCell = getCellFromRow(row, col + 1);
                setCellOnRow(row, col, nextCell ? cloneCellData(nextCell) : null);
            }
            setCellOnRow(row, columnCount, null);
        } else {
            for (let row = rowNumber; row < totalRows; row++) {
                const srcRow = rows[row];
                const dstRow = rows[row - 1];
                const sourceCell = getCellFromRow(srcRow, colNumber);
                if (dstRow) {
                    setCellOnRow(dstRow, colNumber, sourceCell ? cloneCellData(sourceCell) : null);
                }
            }

            const lastRow = rows[totalRows - 1];
            if (lastRow) {
                setCellOnRow(lastRow, colNumber, null);
            }
        }

        pendingWorksheetOps.push({ type, row: rowNumber, col: colNumber });
        normalizeRowsAfterStructureChange(rows);

        selectedCells.clear();
        activeCell = null;
        hideHeaderContextMenu();
        rerenderCurrentSheetFromLocalState();
    }

    function ensureHeaderContextMenu() {
        if (headerContextMenuEl) return headerContextMenuEl;

        const menu = document.createElement('div');
        menu.id = 'headerContextMenu';
        menu.className = 'header-context-menu hidden';
        document.body.appendChild(menu);
        headerContextMenuEl = menu;
        return menu;
    }

    function hideHeaderContextMenu() {
        if (!headerContextMenuEl) return;
        headerContextMenuEl.classList.add('hidden');
        headerContextMenuEl.innerHTML = '';
    }

    function showHeaderContextMenu(e: MouseEvent, targetType: 'row' | 'column', targetIndexZeroBased: number) {
        if (!isEditMode) return;

        const menu = ensureHeaderContextMenu();
        menu.innerHTML = '';

        const targetIndexOneBased = targetIndexZeroBased + 1;
        const items: Array<{ label: string; op: StructuralOpType }> = targetType === 'row'
            ? [
                { label: 'Insert row above', op: 'insertRowAbove' },
                { label: 'Insert row below', op: 'insertRowBelow' },
                { label: 'Delete row', op: 'deleteRow' }
            ]
            : [
                { label: 'Insert column left', op: 'insertColumnLeft' },
                { label: 'Insert column right', op: 'insertColumnRight' },
                { label: 'Delete column', op: 'deleteColumn' }
            ];

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'header-context-item';
            btn.textContent = item.label;
            btn.addEventListener('click', () => {
                applyStructureOperation({ type: item.op, index: targetIndexOneBased });
            });
            menu.appendChild(btn);
        });

        menu.classList.remove('hidden');

        const rect = menu.getBoundingClientRect();
        const left = Math.min(Math.max(8, e.clientX), window.innerWidth - rect.width - 8);
        const top = Math.min(Math.max(8, e.clientY), window.innerHeight - rect.height - 8);
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    function showCellContextMenu(e: MouseEvent, cell: HTMLElement) {
        if (!isEditMode) return;

        const menu = ensureHeaderContextMenu();
        menu.innerHTML = '';

        const rowNumber = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const colNumber = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (!rowNumber || !colNumber) return;

        const appendAction = (label: string, onClick: () => void, cls = 'header-context-item') => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = cls;
            btn.textContent = label;
            btn.addEventListener('click', () => {
                onClick();
            });
            menu.appendChild(btn);
        };

        appendAction('Insert row above', () => applyStructureOperation({ type: 'insertRowAbove', index: rowNumber }));
        appendAction('Insert row below', () => applyStructureOperation({ type: 'insertRowBelow', index: rowNumber }));
        appendAction('Insert column left', () => applyStructureOperation({ type: 'insertColumnLeft', index: colNumber }));
        appendAction('Insert column right', () => applyStructureOperation({ type: 'insertColumnRight', index: colNumber }));

        const separator = document.createElement('div');
        separator.className = 'header-context-separator';
        menu.appendChild(separator);

        appendAction('Delete cell and shift left', () => applyCellDeleteOperation('deleteCellShiftLeft', rowNumber, colNumber));
        appendAction('Delete cell and shift up', () => applyCellDeleteOperation('deleteCellShiftUp', rowNumber, colNumber));

        menu.classList.remove('hidden');

        const rect = menu.getBoundingClientRect();
        const left = Math.min(Math.max(8, e.clientX), window.innerWidth - rect.width - 8);
        const top = Math.min(Math.max(8, e.clientY), window.innerHeight - rect.height - 8);
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    function captureEditSelectionRange() {
        if (!isEditMode) return;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const element = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
        if (!element) return;

        const editableCell = element.closest('td[contenteditable="true"]');
        if (!editableCell) return;

        lastEditRange = range.cloneRange();
    }

    function restoreEditSelectionRange() {
        if (!lastEditRange) return false;

        const node = lastEditRange.commonAncestorContainer;
        const element = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
        if (!element) return false;

        const editableCell = element.closest('td[contenteditable="true"]') as HTMLElement | null;
        if (!editableCell || !document.contains(editableCell)) return false;

        editableCell.focus();
        const selection = window.getSelection();
        if (!selection) return false;
        selection.removeAllRanges();
        selection.addRange(lastEditRange);
        return true;
    }

    function applyInlineStyleToSelection(styleName: 'color' | 'backgroundColor', value: string) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (range.collapsed) return;

        const wrapper = document.createElement('span');
        wrapper.style[styleName] = value;

        try {
            const extracted = range.extractContents();
            wrapper.appendChild(extracted);
            range.insertNode(wrapper);

            const newRange = document.createRange();
            newRange.selectNodeContents(wrapper);
            selection.removeAllRanges();
            selection.addRange(newRange);
            lastEditRange = newRange.cloneRange();
        } catch {
            // Ignore range failures and keep editor functional.
        }
    }

    function applyEditFormatting(command: string, value?: string) {
        if (!isEditMode) return;

        const selection = window.getSelection();
        const hasLiveSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;

        if (!hasLiveSelection && !restoreEditSelectionRange()) {
            showToast('Select text to format');
            return;
        }

        document.execCommand('styleWithCSS', false, 'true');
        const ok = value !== undefined
            ? document.execCommand(command, false, value)
            : document.execCommand(command, false);

        if (!ok && value !== undefined) {
            if (command === 'hiliteColor') {
                const fallbackOk = document.execCommand('backColor', false, value);
                if (!fallbackOk) applyInlineStyleToSelection('backgroundColor', value);
            } else if (command === 'foreColor') {
                // Fallback for engines that only support lower-case command alias.
                const fallbackOk = document.execCommand('forecolor', false, value);
                if (!fallbackOk) applyInlineStyleToSelection('color', value);
            }
        }

        captureEditSelectionRange();
    }

    function getEditTargetCells(): HTMLElement[] {
        if (isEditMode) {
            if (activeCell && document.contains(activeCell) && activeCell.tagName === 'TD' && activeCell.getAttribute('contenteditable') === 'true') {
                return [activeCell];
            }

            const focused = document.activeElement as HTMLElement | null;
            if (focused && focused.tagName === 'TD' && focused.getAttribute('contenteditable') === 'true') {
                return [focused];
            }

            if (lastFocusedEditableCell && document.contains(lastFocusedEditableCell)) {
                return [lastFocusedEditableCell];
            }

            const activeInDom = document.querySelector('td.active-cell[contenteditable="true"]') as HTMLElement | null;
            if (activeInDom) {
                return [activeInDom];
            }

            // In edit mode, color operations must never fan out to multi-cell selections.
            return [];
        }

        const targets = Array.from(selectedCells)
            .filter(cell => document.contains(cell) && cell.tagName === 'TD')
            .map(cell => {
                const row = cell.getAttribute('data-row');
                const col = cell.getAttribute('data-col');
                return document.querySelector('td[data-row="' + row + '"][data-col="' + col + '"]') as HTMLElement | null;
            })
            .filter(Boolean) as HTMLElement[];

        if (targets.length > 0) return targets;

        const focused = document.activeElement as HTMLElement | null;
        if (focused && focused.tagName === 'TD' && focused.getAttribute('contenteditable') === 'true') {
            return [focused];
        }

        if (lastEditRange) {
            const node = lastEditRange.commonAncestorContainer;
            const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
            const td = el ? el.closest('td[contenteditable="true"]') as HTMLElement | null : null;
            if (td) return [td];
        }

        if (lastFocusedEditableCell && document.contains(lastFocusedEditableCell)) {
            return [lastFocusedEditableCell];
        }

        return [];
    }

    function recordCellStyleEdit(cell: HTMLElement, style: Partial<CellStyleEdit>) {
        const row = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const col = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (!row || !col) return;

        const key = row + ':' + col;
        const existing = pendingCellStyleEdits.get(key) || { row, col };
        const merged: CellStyleEdit = { ...existing, ...style, row, col };
        pendingCellStyleEdits.set(key, merged);
    }

    function applyCellBackgroundColor(color: string) {
        const cells = getEditTargetCells();
        if (cells.length === 0) {
            showToast('Select a cell to apply background');
            return;
        }

        if (isEditMode) {
            clearSelection();
            selectCell(cells[0]);
        }

        cells.forEach(cell => {
            cell.style.backgroundColor = color;
            cell.removeAttribute('data-default-bg');
            cell.removeAttribute('data-white-bg');
            cell.removeAttribute('data-black-bg');
            recordCellStyleEdit(cell, { bgColor: color });
        });
    }

    function applyTextColor(color: string) {
        const selection = window.getSelection();
        const hasTextSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;

        if (hasTextSelection || restoreEditSelectionRange()) {
            const currentSelection = window.getSelection();
            if (currentSelection && currentSelection.rangeCount > 0 && !currentSelection.isCollapsed) {
                const range = currentSelection.getRangeAt(0);
                const startNode = range.startContainer;
                const endNode = range.endContainer;
                const startEl = (startNode.nodeType === Node.ELEMENT_NODE ? startNode : startNode.parentElement) as HTMLElement | null;
                const endEl = (endNode.nodeType === Node.ELEMENT_NODE ? endNode : endNode.parentElement) as HTMLElement | null;
                const startCell = startEl ? startEl.closest('td[contenteditable="true"]') : null;
                const endCell = endEl ? endEl.closest('td[contenteditable="true"]') : null;

                // In edit mode, text color formatting should not span across multiple cells.
                if (!isEditMode || (startCell && endCell && startCell === endCell)) {
                    applyEditFormatting('foreColor', color);
                    return;
                }
            }
        }

        const cells = getEditTargetCells();
        if (cells.length === 0) {
            showToast('Select text or a cell to apply text color');
            return;
        }

        if (isEditMode) {
            clearSelection();
            selectCell(cells[0]);
        }

        cells.forEach(cell => {
            cell.style.color = color;
            cell.removeAttribute('data-default-color');
            recordCellStyleEdit(cell, { textColor: color });
        });
    }

    function normalizeColorToHex(color: string): string | undefined {
        const value = (color || '').trim();
        const hexMatch = value.match(/^#([0-9a-fA-F]{6})$/);
        if (hexMatch) return ('#' + hexMatch[1]).toLowerCase();

        const rgbMatch = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!rgbMatch) return undefined;
        const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10)));
        const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10)));
        const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)));
        return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    }

    function collectRichRunsFromNode(node: Node, inherited: { bold?: boolean; italic?: boolean; color?: string }, output: Array<{ text: string; bold?: boolean; italic?: boolean; color?: string }>) {
        if (node.nodeType === Node.TEXT_NODE) {
            const txt = node.textContent || '';
            if (!txt) return;
            output.push({ text: txt, ...inherited });
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();

        const next = { ...inherited };
        if (tag === 'b' || tag === 'strong') next.bold = true;
        if (tag === 'i' || tag === 'em') next.italic = true;

        const style = window.getComputedStyle(el);
        const fw = style.fontWeight || '';
        if (fw === 'bold' || parseInt(fw, 10) >= 600) next.bold = true;
        if (style.fontStyle === 'italic') next.italic = true;
        const explicitColor = el.style && el.style.color ? el.style.color : '';
        if (explicitColor) {
            const hexColor = normalizeColorToHex(explicitColor);
            if (hexColor) next.color = hexColor;
        }

        for (const child of Array.from(el.childNodes)) {
            collectRichRunsFromNode(child, next, output);
        }
    }

    function collapseRuns(runs: Array<{ text: string; bold?: boolean; italic?: boolean; color?: string }>) {
        const merged: Array<{ text: string; bold?: boolean; italic?: boolean; color?: string }> = [];
        runs.forEach(run => {
            if (!run.text) return;
            const prev = merged[merged.length - 1];
            if (prev && prev.bold === run.bold && prev.italic === run.italic && prev.color === run.color) {
                prev.text += run.text;
            } else {
                merged.push({ ...run });
            }
        });
        return merged;
    }

    function getCellRichRuns(cell: HTMLElement) {
        const rawRuns: Array<{ text: string; bold?: boolean; italic?: boolean; color?: string }> = [];
        for (const child of Array.from(cell.childNodes)) {
            collectRichRunsFromNode(child, {}, rawRuns);
        }
        return collapseRuns(rawRuns).map(r => ({
            text: r.text.replace(/\u00a0/g, ' '),
            bold: !!r.bold,
            italic: !!r.italic,
            color: r.color
        })).filter(r => r.text.length > 0);
    }

    function hasRunFormatting(runs: Array<{ text: string; bold?: boolean; italic?: boolean; color?: string }>): boolean {
        return runs.some(r => !!r.bold || !!r.italic || !!r.color);
    }

    function ensureColorPalette() {
        if (colorPaletteEl) return colorPaletteEl;

        const palette = document.createElement('div');
        palette.id = 'sheetsColorPalette';
        palette.className = 'sheets-color-palette hidden';

        const swatches = [
            '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
            '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
            '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'
        ];

        const title = document.createElement('div');
        title.className = 'sheets-color-title';
        title.textContent = 'Colors';
        palette.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'sheets-color-grid';
        swatches.forEach(color => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'sheets-color-swatch';
            sw.style.backgroundColor = color;
            sw.setAttribute('data-color', color);
            sw.addEventListener('click', () => {
                if (activeColorTarget === 'text') {
                    selectedTextColor = color;
                    applyTextColor(color);
                    const btn = document.getElementById('formatTextColorButton');
                    if (btn) btn.style.setProperty('--format-color-preview', color);
                } else {
                    selectedBgColor = color;
                    applyCellBackgroundColor(color);
                    const btn = document.getElementById('formatBackgroundColorButton');
                    if (btn) btn.style.setProperty('--format-color-preview', color);
                }
                hideColorPalette();
            });
            grid.appendChild(sw);
        });
        palette.appendChild(grid);

        const customWrap = document.createElement('div');
        customWrap.className = 'sheets-color-custom';
        const customInput = document.createElement('input');
        customInput.type = 'color';
        customInput.id = 'sheetsCustomColorInput';
        customInput.value = selectedTextColor;
        customInput.addEventListener('input', () => {
            const color = customInput.value;
            if (activeColorTarget === 'text') {
                selectedTextColor = color;
                applyTextColor(color);
                const btn = document.getElementById('formatTextColorButton');
                if (btn) btn.style.setProperty('--format-color-preview', color);
            } else {
                selectedBgColor = color;
                applyCellBackgroundColor(color);
                const btn = document.getElementById('formatBackgroundColorButton');
                if (btn) btn.style.setProperty('--format-color-preview', color);
            }
        });
        customWrap.appendChild(customInput);
        palette.appendChild(customWrap);

        document.body.appendChild(palette);
        colorPaletteEl = palette;
        return palette;
    }

    function hideColorPalette() {
        if (!colorPaletteEl) return;
        colorPaletteEl.classList.add('hidden');
        activeColorTarget = null;
    }

    function showColorPalette(anchor: HTMLElement, target: 'text' | 'background') {
        const palette = ensureColorPalette();
        activeColorTarget = target;

        const input = palette.querySelector('#sheetsCustomColorInput') as HTMLInputElement | null;
        if (input) {
            input.value = target === 'text' ? selectedTextColor : selectedBgColor;
        }

        palette.classList.remove('hidden');
        const rect = anchor.getBoundingClientRect();
        const paletteRect = palette.getBoundingClientRect();
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - paletteRect.width - 8);
        const top = Math.min(rect.bottom + 6, window.innerHeight - paletteRect.height - 8);
        palette.style.left = left + 'px';
        palette.style.top = top + 'px';
    }

    function wireEditFormattingControls() {
        const buttonIds = [
            'formatBoldButton',
            'formatItalicButton',
            'formatTextColorButton',
            'formatBackgroundColorButton'
        ];

        buttonIds.forEach(id => {
            const button = document.getElementById(id);
            if (!button) return;
            button.addEventListener('mousedown', (e) => {
                // Keep text selection in the editable cell while clicking toolbar controls.
                e.preventDefault();
                captureEditSelectionRange();
            });
        });

        const textColorButton = document.getElementById('formatTextColorButton') as HTMLButtonElement | null;
        if (textColorButton) {
            textColorButton.classList.add('color-format-button');
            textColorButton.style.setProperty('--format-color-preview', selectedTextColor);
            textColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(textColorButton, 'text');
            });
        }

        const bgColorButton = document.getElementById('formatBackgroundColorButton') as HTMLButtonElement | null;
        if (bgColorButton) {
            bgColorButton.classList.add('color-format-button');
            bgColorButton.style.setProperty('--format-color-preview', selectedBgColor);
            bgColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(bgColorButton, 'background');
            });
        }

        document.addEventListener('selectionchange', () => {
            captureEditSelectionRange();
        });

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('#sheetsColorPalette') && !target.closest('#formatTextColorButton') && !target.closest('#formatBackgroundColorButton')) {
                hideColorPalette();
            }
        });
    }

    function normalizeCellText(text: string | null | undefined): string {
        if (!text) return '';
        return String(text).replace(/\u00a0/g, '').replace(/\r?\n/g, ' ').trimEnd();
    }

    function yieldToMain() {
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                setTimeout(resolve, 0);
            });
        });
    }

    async function writeToClipboardAsync(text: string) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch {
                // fall through to execCommand
            }
        }

        await new Promise<void>((resolve, reject) => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.cssText = `
                position: fixed;
                left: -9999px;
                top: 0;
                width: 2px;
                height: 2px;
                padding: 0;
                border: none;
                outline: none;
                opacity: 0;
                pointer-events: none;
            `;

            document.body.appendChild(textarea);

            try {
                textarea.focus();
                textarea.select();
                textarea.setSelectionRange(0, text.length);
                const ok = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (ok) resolve();
                else reject(new Error('execCommand("copy") returned false'));
            } catch (err) {
                document.body.removeChild(textarea);
                reject(err);
            }
        });
    }

    // ===== Virtual Scrolling Core =====

    function getTableContainer(): HTMLElement | null {
        return document.querySelector('.table-scroll');
    }

    function requestRows(start: number, end: number, timeout = 10000): Promise<any[]> {
        return virtualLoader.requestRows(start, end, timeout, { sheetIndex: currentWorksheet });
    }

    function requestAllRows(): Promise<any[]> {
        return requestRows(0, totalRows, 30000);
    }

    function createRowHtml(rowData: any, rowIndex: number): string {
        const baseHeight = rowData.height || ROW_HEIGHT;
        const height = getEffectiveRowHeightFromValue(baseHeight);
        return createXlsxRowHtml({
            rowData,
            rowIndex,
            rowHeight: height,
            columnCount,
            columnWidths,
            isPlainView,
            isEditMode
        });
    }

    function adjustColumnWidths(mode: 'expand' | 'default') {
        try {
            const table = document.getElementById('xlsxTable') as HTMLTableElement | null;
            if (!table) return;

            const headerCells = table.querySelectorAll('th.col-header');
            if (headerCells.length === 0) return;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.font = '10pt Arial, sans-serif';

            const visibleRows = table.querySelectorAll('tbody tr:not(.virtual-spacer)');
            const limit = Math.min(visibleRows.length, 80);

            let firstColMax = 30;
            for (let r = 0; r < limit; r++) {
                const row = visibleRows[r] as HTMLTableRowElement;
                const cell = row.children[0] as HTMLElement | undefined;
                if (!cell) continue;
                const width = ctx.measureText((cell.textContent || '').trim()).width + 24;
                if (width > firstColMax) firstColMax = width;
            }

            const cornerCell = table.querySelector('th.corner-cell') as HTMLElement | null;
            if (cornerCell) {
                cornerCell.style.width = `${Math.ceil(firstColMax)}px`;
                cornerCell.style.minWidth = `${Math.ceil(firstColMax)}px`;
            }

            headerCells.forEach((th, index) => {
                const headerEl = th as HTMLElement;
                const headerText = (headerEl.innerText || headerEl.textContent || '').trim();

                const baseWidth = Math.max(40, Math.round(columnWidths[index] || 80));
                let maxWidth = Math.max(ctx.measureText(headerText).width + 32, baseWidth);

                for (let r = 0; r < limit; r++) {
                    const row = visibleRows[r] as HTMLTableRowElement;
                    const cell = row.children[index + 1] as HTMLElement | undefined;
                    if (!cell) continue;
                    const width = ctx.measureText((cell.textContent || '').trim()).width + 32;
                    if (width > maxWidth) maxWidth = width;
                }

                const finalWidth = mode === 'expand'
                    ? Math.ceil(maxWidth)
                    : Math.min(Math.ceil(maxWidth), 200);

                headerEl.style.width = `${finalWidth}px`;
                headerEl.style.minWidth = `${finalWidth}px`;
            });
        } catch {
            // ignore width-sync errors to keep rendering responsive
        }
    }

    const syncColumnWidthsToCurrentMode = debounce(() => {
        if (isEditMode) return;
        adjustColumnWidths(document.body.classList.contains('expanded-mode') ? 'expand' : 'default');
    }, 100);

    function renderVirtualRows(startIndex: number, endIndex: number, rowsData: any[]) {
        if (isRendering) return;
        isRendering = true;

        const tbody = document.querySelector('#xlsxTable tbody');
        if (!tbody) {
            isRendering = false;
            return;
        }

        // Cache rows
        rowsData.forEach((row, i) => {
            rowCache.set(startIndex + i, row);
        });

        // Calculate spacer heights using pre-loaded heights (stable)
        let topSpacerHeight = 0;
        for (let i = 0; i < startIndex; i++) {
            topSpacerHeight += getEffectiveRowHeightByIndex(i);
        }

        let bottomSpacerHeight = 0;
        for (let i = endIndex; i < totalRows; i++) {
            bottomSpacerHeight += getEffectiveRowHeightByIndex(i);
        }

        let html = '';

        if (topSpacerHeight > 0) {
            html += '<tr class="virtual-spacer top-spacer"><td colspan="' + (columnCount + 1) + '" style="height: ' + topSpacerHeight + 'px; padding: 0; border: none;"></td></tr>';
        }

        for (let i = startIndex; i < endIndex; i++) {
            const rowData = rowCache.get(i) || { cells: [], rowNumber: i + 1 };
            html += createRowHtml(rowData, i);
        }

        if (bottomSpacerHeight > 0) {
            html += '<tr class="virtual-spacer bottom-spacer"><td colspan="' + (columnCount + 1) + '" style="height: ' + bottomSpacerHeight + 'px; padding: 0; border: none;"></td></tr>';
        }

        tbody.innerHTML = html;
        reapplySelection();
        syncColumnWidthsToCurrentMode();
        isRendering = false;
    }

    async function updateVisibleRows() {
        if (isRendering) return;
        
        const container = getTableContainer();
        if (!container || totalRows === 0) return;

        const scrollTop = container.scrollTop;
        const clientHeight = container.clientHeight;

        // Calculate which rows are visible using pre-loaded heights
        let accumulatedHeight = 0;
        let firstVisibleRow = 0;
        
        for (let i = 0; i < totalRows; i++) {
            const rowHeight = getEffectiveRowHeightByIndex(i);
            if (accumulatedHeight + rowHeight > scrollTop) {
                firstVisibleRow = i;
                break;
            }
            accumulatedHeight += rowHeight;
            if (i === totalRows - 1) {
                firstVisibleRow = totalRows - 1;
            }
        }
        
        // Find last visible row
        let lastVisibleRow = firstVisibleRow;
        let visibleHeight = 0;
        for (let i = firstVisibleRow; i < totalRows; i++) {
            const rowHeight = getEffectiveRowHeightByIndex(i);
            visibleHeight += rowHeight;
            lastVisibleRow = i + 1;
            if (visibleHeight >= clientHeight) {
                break;
            }
        }

        // Add buffer
        const bufferedStart = Math.max(0, firstVisibleRow - BUFFER_ROWS);
        const bufferedEnd = Math.min(totalRows, lastVisibleRow + BUFFER_ROWS);

        // Align to chunk boundaries
        let chunkStart = Math.floor(bufferedStart / CHUNK_SIZE) * CHUNK_SIZE;
        let chunkEnd = Math.ceil(bufferedEnd / CHUNK_SIZE) * CHUNK_SIZE;
        
        // Clamp to totalRows
        chunkEnd = Math.min(totalRows, chunkEnd);

        // CRITICAL FIX: If we're within 2 chunks of the end, just render to the end
        // This prevents fluctuation at boundaries like 2224 rows (22.24 chunks)
        const remainingRows = totalRows - chunkEnd;
        if (remainingRows > 0 && remainingRows < CHUNK_SIZE * 2) {
            chunkEnd = totalRows;
        }

        // Skip if we're already showing these rows (with some tolerance)
        if (chunkStart === currentVisibleStart && chunkEnd === currentVisibleEnd) {
            return;
        }

        // Check if current range still covers what we need
        if (currentVisibleStart <= bufferedStart && currentVisibleEnd >= bufferedEnd) {
            return; // Current render still covers visible area
        }

        let needsFetch = false;
        for (let i = chunkStart; i < chunkEnd; i++) {
            if (!rowCache.has(i)) {
                needsFetch = true;
                break;
            }
        }

        if (needsFetch && !isRequestingRows) {
            isRequestingRows = true;

            try {
                const rows = await requestRows(chunkStart, chunkEnd);

                if (rows && rows.length > 0) {
                    currentVisibleStart = chunkStart;
                    currentVisibleEnd = chunkStart + rows.length;
                    renderVirtualRows(chunkStart, chunkStart + rows.length, rows);
                }
            } finally {
                isRequestingRows = false;
            }
        } else if (!needsFetch) {
            currentVisibleStart = chunkStart;
            currentVisibleEnd = chunkEnd;

            const cachedRows: any[] = [];
            for (let i = chunkStart; i < chunkEnd; i++) {
                cachedRows.push(rowCache.get(i) || { cells: [], rowNumber: i + 1 });
            }
            renderVirtualRows(chunkStart, chunkEnd, cachedRows);
        }
    }

    const onScroll = debounce(() => {
        updateVisibleRows();
    }, 50); // Increased debounce to reduce fluctuation

    function initializeVirtualScrolling() {
        const container = getTableContainer();
        if (!container) return;

        // Remove any existing listener first
        container.removeEventListener('scroll', onScroll);
        container.addEventListener('scroll', onScroll, { passive: true });
        updateVisibleRows();
    }

    function reapplySelection() {
        selectionManager.reapplySelection();
    }

    function createTableShell(): string {
        let html = '<div class="table-scroll"><table id="xlsxTable">';

        // Header row
        html += '<thead><tr>';
        html += '<th class="corner-cell"></th>';
        for (let c = 1; c <= columnCount; c++) {
            const width = columnWidths[c - 1] || 80;
            html += '<th class="col-header" data-col="' + (c - 1) + '" style="width: ' + width + 'px; min-width: ' + width + 'px;">';
            html += getExcelColumnLabel(c);
            html += '<div class="col-resize-handle" data-col="' + (c - 1) + '"></div>';
            html += '</th>';
        }
        html += '</tr></thead><tbody></tbody></table></div>';
        return html;
    }

    const showToast = Utils.showToast;

    function ensurePreviewBanner(): HTMLElement {
        let banner = document.getElementById('versionPreviewBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'versionPreviewBanner';
            banner.className = 'version-preview-banner hidden';
            banner.innerHTML = `
                <span id="versionPreviewText" class="version-preview-text"></span>
                <div class="version-preview-actions">
                    <button id="restoreVersionButton" class="toggle-button" type="button">Restore</button>
                    <button id="cancelVersionPreviewButton" class="toggle-button" type="button">Cancel</button>
                </div>
            `;

            const content = document.getElementById('content');
            if (content) {
                content.insertBefore(banner, content.firstChild);
            } else {
                document.body.appendChild(banner);
            }

            const restoreBtn = document.getElementById('restoreVersionButton') as HTMLButtonElement | null;
            const cancelBtn = document.getElementById('cancelVersionPreviewButton') as HTMLButtonElement | null;
            restoreBtn?.addEventListener('click', () => {
                if (!previewVersionId) return;
                vscode.postMessage({ command: 'restoreVersion', versionId: previewVersionId });
            });
            cancelBtn?.addEventListener('click', () => {
                vscode.postMessage({ command: 'cancelVersionPreview' });
            });
        }
        return banner;
    }

    function setVersionPreviewMode(isPreview: boolean, label?: string) {
        isVersionPreviewMode = isPreview;
        document.body.classList.toggle('preview-mode', isPreview);

        const banner = ensurePreviewBanner();
        if (isPreview) {
            const text = document.getElementById('versionPreviewText');
            if (text) {
                text.textContent = label || 'Previewing selected version (read-only)';
            }
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
            previewVersionId = null;
        }
    }

    function setLoadingText(text: string) {
        const el = document.querySelector('.loading-text');
        if (el) el.textContent = text;
    }

    function showLoading() {
        const el = document.getElementById('loadingOverlay');
        if (el) el.classList.remove('hidden');
    }

    function hideLoading() {
        const el = document.getElementById('loadingOverlay');
        if (el) el.classList.add('hidden');
    }

    function renderWorksheet(index: number) {
        if (!worksheetsMeta || !worksheetsMeta.length) return;

        showLoading();

        // Reset virtual scrolling state for new worksheet
        rowCache.clear();
        currentVisibleStart = 0;
        currentVisibleEnd = 0;
        virtualLoader.clear();
        isRendering = false;

        const wsMeta = worksheetsMeta[index];
        totalRows = wsMeta.totalRows || 0;
        columnCount = wsMeta.columnCount || 0;
        columnWidths = wsMeta.columnWidths || [];
        mergedCells = wsMeta.mergedCells || [];
        allRowHeights = wsMeta.rowHeights || [];
        
        // Pre-calculate total content height for stable scrolling
        totalContentHeight = 0;
        for (let i = 0; i < totalRows; i++) {
            totalContentHeight += getEffectiveRowHeightByIndex(i);
        }

        // Allow the overlay to render
        setTimeout(() => {
            const container = document.getElementById('tableContainer');
            if (!container) return;

            container.innerHTML = createTableShell();
            initializeSelection();
            initializeResize();
            initializeHyperlinkHover();
            initializeVirtualScrolling();
            hideLoading();
        }, 100);
    }

    function initializeResize() {
        const table = document.querySelector('table');
        if (!table) return;

        // Column/row resize handles
        table.addEventListener('mousedown', (e) => {
            if (isEditMode) return;
            const target = e.target as HTMLElement;
            if (target && target.classList && target.classList.contains('col-resize-handle')) {
                e.preventDefault();
                e.stopPropagation();

                isResizing = true;
                resizeType = 'column';
                resizeIndex = parseInt(target.dataset.col!, 10);
                resizeStartPos = e.clientX;

                const header = target.parentElement;
                resizeStartSize = header ? header.offsetWidth : 0;

                document.body.style.cursor = 'col-resize';
                const indicator = document.getElementById('resizeIndicator');
                if (indicator) indicator.style.display = 'block';
                return false;
            }

            if (target && target.classList && target.classList.contains('row-resize-handle')) {
                e.preventDefault();
                e.stopPropagation();

                isResizing = true;
                resizeType = 'row';
                resizeIndex = parseInt(target.dataset.row!, 10);
                resizeStartPos = e.clientY;

                const header = target.parentElement;
                resizeStartSize = header ? header.offsetHeight : 0;

                document.body.style.cursor = 'row-resize';
                const indicator = document.getElementById('resizeIndicator');
                if (indicator) indicator.style.display = 'block';
                return false;
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isEditMode) return;
            if (!isResizing) return;

            const tableEl = document.querySelector('table');
            if (!tableEl) return;

            const indicator = document.getElementById('resizeIndicator');

            if (resizeType === 'column') {
                const delta = e.clientX - resizeStartPos;
                const newSize = Math.max(20, resizeStartSize + delta);

                const headers = tableEl.querySelectorAll('th.col-header[data-col="' + resizeIndex + '"]') as NodeListOf<HTMLElement>;
                const cells = tableEl.querySelectorAll('td[data-col="' + resizeIndex + '"]') as NodeListOf<HTMLElement>;

                headers.forEach(header => {
                    header.style.width = newSize + 'px';
                    header.style.minWidth = newSize + 'px';
                });

                cells.forEach(cell => {
                    if (!cell.getAttribute('colspan') || cell.getAttribute('colspan') === '1') {
                        cell.style.width = newSize + 'px';
                        cell.style.minWidth = newSize + 'px';
                    }
                });

                if (indicator) {
                    indicator.style.left = e.clientX + 'px';
                    indicator.style.top = e.clientY + 'px';
                    indicator.textContent = newSize + 'px';
                }
            } else if (resizeType === 'row') {
                const delta = e.clientY - resizeStartPos;
                const newSize = Math.max(15, resizeStartSize + delta);

                const headers = tableEl.querySelectorAll('th.row-header[data-row="' + resizeIndex + '"]') as NodeListOf<HTMLElement>;
                const row = tableEl.querySelectorAll('tr')[resizeIndex + 1] as HTMLElement; // +1 for header row

                headers.forEach(header => {
                    header.style.height = newSize + 'px';
                });

                if (row) {
                    row.style.height = newSize + 'px';
                    const cells = row.querySelectorAll('td') as NodeListOf<HTMLElement>;
                    cells.forEach(cell => {
                        if (!cell.getAttribute('rowspan') || cell.getAttribute('rowspan') === '1') {
                            cell.style.height = newSize + 'px';
                        }
                    });
                }

                if (indicator) {
                    indicator.style.left = e.clientX + 'px';
                    indicator.style.top = e.clientY + 'px';
                    indicator.textContent = newSize + 'px';
                }
            }
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                resizeType = null;
                resizeIndex = -1;
                document.body.style.cursor = '';
                const indicator = document.getElementById('resizeIndicator');
                if (indicator) indicator.style.display = 'none';
            }
        });

        // Double-click to auto-fit
        table.addEventListener('dblclick', (e) => {
            if (isEditMode) return;
            const target = e.target as HTMLElement;
            if (target && target.classList && target.classList.contains('col-resize-handle')) {
                e.preventDefault();
                autoFitColumn(parseInt(target.dataset.col!, 10));
            } else if (target && target.classList && target.classList.contains('row-resize-handle')) {
                e.preventDefault();
                autoFitRow(parseInt(target.dataset.row!, 10));
            }
        });
    }

    function autoFitColumn(colIndex: number) {
        const cells = document.querySelectorAll('td[data-col="' + colIndex + '"], th[data-col="' + colIndex + '"]') as NodeListOf<HTMLElement>;
        let maxWidth = 50;

        cells.forEach(cell => {
            const content = (cell.textContent || '').trim();
            const tempSpan = document.createElement('span');
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            tempSpan.style.whiteSpace = 'nowrap';
            tempSpan.style.font = window.getComputedStyle(cell).font;
            tempSpan.textContent = content;
            document.body.appendChild(tempSpan);

            const contentWidth = tempSpan.offsetWidth + 10; // padding
            maxWidth = Math.max(maxWidth, contentWidth);

            document.body.removeChild(tempSpan);
        });

        maxWidth = Math.min(maxWidth, 300); // Cap at 300px

        cells.forEach(cell => {
            cell.style.width = maxWidth + 'px';
            cell.style.minWidth = maxWidth + 'px';
        });
    }

    function autoFitRow(rowIndex: number) {
        const row = document.querySelectorAll('tr')[rowIndex + 1] as HTMLElement; // +1 for header row
        if (!row) return;

        const cells = row.querySelectorAll('td') as NodeListOf<HTMLElement>;
        let maxHeight = 20;

        cells.forEach(cell => {
            const content = (cell.textContent || '').trim();
            if (content.length > 50) {
                maxHeight = Math.max(maxHeight, 40);
            }
        });

        row.style.height = maxHeight + 'px';
        const headers = document.querySelectorAll('th.row-header[data-row="' + rowIndex + '"]') as NodeListOf<HTMLElement>;
        headers.forEach(header => {
            header.style.height = maxHeight + 'px';
        });

        cells.forEach(cell => {
            if (!cell.getAttribute('rowspan') || cell.getAttribute('rowspan') === '1') {
                cell.style.height = maxHeight + 'px';
            }
        });
    }

    function autoFitAllColumns() {
        if (!worksheetsMeta || !worksheetsMeta.length) return;
        // Note: worksheetsData was not defined in original JS, assuming it meant worksheetsMeta or similar
        // But autoFitAllColumns was not called anywhere in the original JS.
        // Keeping it but commenting out usage if any.
        /*
        const data = worksheetsMeta[currentWorksheet].data;
        for (let c = 0; c < data.maxCol; c++) {
            autoFitColumn(c);
        }
        */
    }

    function clearSelection() {
        selectionManager.clearSelection();
    }

    function selectCell(cell: HTMLElement, isMulti = false) {
        selectionManager.selectCell(cell, isMulti);
    }

    function selectRange(startRow: number, startCol: number, endRow: number, endCol: number) {
        selectionManager.selectRange(startRow, startCol, endRow, endCol);
    }

    function selectRow(rowIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        selectionManager.selectRow(rowIndex, ctrlKey, shiftKey);
    }

    function selectColumn(colIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        selectionManager.selectColumn(colIndex, ctrlKey, shiftKey);
    }

    function updateSelectionInfo() {
        selectionManager.updateSelectionInfo();
    }

    function copySelection() {
        copySelectionToClipboard();
    }

    async function copySelectionToClipboard() {
        const hasFullColumnSelection = selectedColumnIndices.size > 0;
        const hasFullRowSelection = selectedRowIndices.size > 0;

        if (!hasFullColumnSelection && !hasFullRowSelection && selectedCells.size === 0) return;
        if (isCopying) return;

        isCopying = true;

        try {
            showToast('Copying...');
            await yieldToMain();

            let outputLines: string[] = [];

            if (hasFullColumnSelection || hasFullRowSelection) {
                // Need to fetch all rows for complete copy
                const allRows = await requestAllRows();

                if (!allRows || allRows.length === 0) {
                    showToast('Failed to fetch data');
                    isCopying = false;
                    return;
                }

                // Cache the fetched rows
                if (allRows.length >= totalRows * 0.9) {
                    allRows.forEach((row, i) => {
                        rowCache.set(i, row);
                    });
                }

                const rowCount = allRows.length;

                if (hasFullColumnSelection && !hasFullRowSelection) {
                    // Copy entire columns
                    const sortedCols = Array.from(selectedColumnIndices).sort((a, b) => a - b);

                    for (let r = 0; r < rowCount; r++) {
                        const rowData = allRows[r] || { cells: [] };
                        const lineParts = sortedCols.map(c => {
                            const cellData = rowData.cells ? rowData.cells.find((cell: any) => cell.colNumber === c + 1) : null;
                            return cellData ? normalizeCellText(cellData.value || '') : '';
                        });
                        outputLines.push(lineParts.join('\t'));
                    }
                } else if (hasFullRowSelection && !hasFullColumnSelection) {
                    // Copy entire rows
                    const sortedRows = Array.from(selectedRowIndices).sort((a, b) => a - b);

                    for (const r of sortedRows) {
                        if (r < rowCount) {
                            const rowData = allRows[r] || { cells: [] };
                            const lineParts: string[] = [];
                            for (let c = 0; c < columnCount; c++) {
                                const cellData = rowData.cells ? rowData.cells.find((cell: any) => cell.colNumber === c + 1) : null;
                                lineParts.push(cellData ? normalizeCellText(cellData.value || '') : '');
                            }
                            outputLines.push(lineParts.join('\t'));
                        }
                    }
                } else {
                    // Both rows and columns selected - intersection
                    const sortedRows = Array.from(selectedRowIndices).sort((a, b) => a - b);
                    const sortedCols = Array.from(selectedColumnIndices).sort((a, b) => a - b);

                    for (const r of sortedRows) {
                        if (r < rowCount) {
                            const rowData = allRows[r] || { cells: [] };
                            const lineParts = sortedCols.map(c => {
                                const cellData = rowData.cells ? rowData.cells.find((cell: any) => cell.colNumber === c + 1) : null;
                                return cellData ? normalizeCellText(cellData.value || '') : '';
                            });
                            outputLines.push(lineParts.join('\t'));
                        }
                    }
                }

                const cellCount = hasFullColumnSelection ?
                    rowCount * selectedColumnIndices.size :
                    (hasFullRowSelection ? selectedRowIndices.size * columnCount : 0);

                const tsv = outputLines.join('\n');
                await writeToClipboardAsync(tsv);

                selectedCells.forEach(cell => cell.classList.add('copying'));
                setTimeout(() => selectedCells.forEach(cell => cell.classList.remove('copying')), 300);

                showToast('Copied ' + cellCount + ' cells');
            } else {
                // Regular cell selection - use DOM/cache
                const cellsArray = Array.from(selectedCells);
                const rowSet = new Set<number>();
                const colSet = new Set<number>();

                cellsArray.forEach(td => {
                    const r = parseInt(td.dataset.row!, 10);
                    const c = parseInt(td.dataset.col!, 10);
                    if (!isNaN(r) && !isNaN(c)) {
                        rowSet.add(r);
                        colSet.add(c);
                    }
                });

                const sortedRows = Array.from(rowSet).sort((a, b) => a - b);
                const sortedCols = Array.from(colSet).sort((a, b) => a - b);

                for (const r of sortedRows) {
                    const lineParts = sortedCols.map(c => {
                        const cell = document.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]');
                        return normalizeCellText(cell ? (cell.textContent || '') : '');
                    });
                    outputLines.push(lineParts.join('\t'));
                }

                const tsv = outputLines.join('\n');
                await writeToClipboardAsync(tsv);

                selectedCells.forEach(cell => cell.classList.add('copying'));
                setTimeout(() => selectedCells.forEach(cell => cell.classList.remove('copying')), 300);

                showToast('Copied ' + cellsArray.length + ' cells');
            }
        } catch (err) {
            console.error('Copy operation failed:', err);
            showToast('Copy failed');
        } finally {
            isCopying = false;
        }
    }

    function invertColor(color: string) {
        const match = String(color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return color;

        const r = 255 - parseInt(match[1], 10);
        const g = 255 - parseInt(match[2], 10);
        const b = 255 - parseInt(match[3], 10);
        const a = match[4] ? match[4] : '1';
        return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    function initializeSelection() {
        const tableContainer = document.getElementById('tableContainer');
        const table = tableContainer ? tableContainer.querySelector('table') : null;
        if (!table) return;

        table.addEventListener('contextmenu', (e) => {
            if (!isEditMode) return;

            const target = e.target as HTMLElement;
            const rowHeader = target.closest('th.row-header') as HTMLElement | null;
            const colHeader = target.closest('th.col-header') as HTMLElement | null;
            const cell = target.closest('td') as HTMLElement | null;
            if (!rowHeader && !colHeader && !cell) return;

            e.preventDefault();
            e.stopPropagation();

            if (cell) {
                showCellContextMenu(e, cell);
                return;
            }

            if (rowHeader) {
                const row = parseInt(rowHeader.dataset.row || '-1', 10);
                if (row >= 0) showHeaderContextMenu(e, 'row', row);
                return;
            }

            if (colHeader) {
                const col = parseInt(colHeader.dataset.col || '-1', 10);
                if (col >= 0) showHeaderContextMenu(e, 'column', col);
            }
        });

        table.addEventListener('selectstart', (e) => {
            if (isEditMode) return;
            e.preventDefault();
            return false;
        });

        table.addEventListener('mousedown', (e) => {
            const target = e.target as HTMLElement;
            if (target && target.classList && (target.classList.contains('col-resize-handle') || target.classList.contains('row-resize-handle'))) {
                return;
            }

            const cellTarget = target.closest('td, th') as HTMLElement;
            if (!cellTarget) return;

            const isHeaderInteraction =
                cellTarget.classList.contains('col-header') ||
                cellTarget.classList.contains('row-header') ||
                cellTarget.classList.contains('corner-cell');

            if (isEditMode && !isHeaderInteraction) {
                if (cellTarget.tagName === 'TD') {
                    if (selectedCells.size > 1 || !selectedCells.has(cellTarget)) {
                        clearSelection();
                        selectCell(cellTarget);
                    }
                }
                return;
            }

            e.preventDefault();

            if (cellTarget.classList.contains('col-header')) {
                const colIndex = parseInt(cellTarget.dataset.col!, 10);
                if (!e.shiftKey) {
                    lastSelectedColumn = colIndex;
                }
                selectColumn(colIndex, e.ctrlKey || e.metaKey, e.shiftKey);
                return;
            }

            if (cellTarget.classList.contains('row-header')) {
                const rowIndex = parseInt(cellTarget.dataset.row!, 10);
                if (!e.shiftKey) {
                    lastSelectedRow = rowIndex;
                }
                selectRow(rowIndex, e.ctrlKey || e.metaKey, e.shiftKey);
                return;
            }

            if (cellTarget.classList.contains('corner-cell')) {
                clearSelection();
                const allCells = table.querySelectorAll('td') as NodeListOf<HTMLElement>;
                allCells.forEach(cell => {
                    cell.classList.add('selected');
                    selectedCells.add(cell);
                });
                if (allCells.length > 0) {
                    allCells[0].classList.add('active-cell');
                    activeCell = allCells[0];
                }
                updateSelectionInfo();
                return;
            }

            if (cellTarget.tagName === 'TD') {
                const row = parseInt(cellTarget.dataset.row!, 10);
                const col = parseInt(cellTarget.dataset.col!, 10);

                if (e.ctrlKey || e.metaKey) {
                    if (cellTarget.classList.contains('selected')) {
                        cellTarget.classList.remove('selected');
                        selectedCells.delete(cellTarget);
                        if (cellTarget === activeCell) {
                            cellTarget.classList.remove('active-cell');
                            activeCell = null;

                            const remainingSelected = document.querySelector('td.selected') as HTMLElement;
                            if (remainingSelected) {
                                remainingSelected.classList.add('active-cell');
                                activeCell = remainingSelected;
                            }
                        }
                    } else {
                        cellTarget.classList.add('selected');
                        selectedCells.add(cellTarget);
                        if (activeCell) {
                            activeCell.classList.remove('active-cell');
                        }
                        cellTarget.classList.add('active-cell');
                        activeCell = cellTarget;
                    }
                    updateSelectionInfo();
                } else if (e.shiftKey && activeCell) {
                    const startRow = parseInt(activeCell.dataset.row!, 10);
                    const startCol = parseInt(activeCell.dataset.col!, 10);
                    selectRange(startRow, startCol, row, col);
                } else {
                    isSelecting = true;
                    selectionStart = { row, col };
                    selectCell(cellTarget);
                }
            }
        });

        table.addEventListener('mousemove', (e) => {
            if (isEditMode) return;
            if (!isSelecting || !selectionStart) return;

            // Track last mouse position for auto-scroll
            lastMousePos = { x: e.clientX, y: e.clientY };

            const target = (e.target as HTMLElement).closest('td') as HTMLElement;
            if (!target) return;

            const row = parseInt(target.dataset.row!, 10);
            const col = parseInt(target.dataset.col!, 10);

            if (!selectionEnd || selectionEnd.row !== row || selectionEnd.col !== col) {
                selectionEnd = { row, col };
                selectRange(selectionStart.row, selectionStart.col, row, col);
            }

            // Start auto-scroll loop if needed
            startAutoScroll();
        });

        function startAutoScroll() {
            if (autoScrollRequest) return;
            autoScrollLoop();
        }

        function stopAutoScroll() {
            if (autoScrollRequest) {
                cancelAnimationFrame(autoScrollRequest);
                autoScrollRequest = null;
            }
        }

        function autoScrollLoop() {
            autoScrollRequest = requestAnimationFrame(() => {
                if (!isSelecting || !lastMousePos) {
                    stopAutoScroll();
                    return;
                }

                const tableContainer = document.getElementById('tableContainer');
                const scrollArea = tableContainer ? tableContainer.querySelector('.table-scroll') : null;
                if (!scrollArea) {
                    stopAutoScroll();
                    return;
                }

                const rect = scrollArea.getBoundingClientRect();
                let dx = 0;
                let dy = 0;

                if (lastMousePos.x < rect.left + AUTO_SCROLL_THRESHOLD) dx = -AUTO_SCROLL_STEP;
                else if (lastMousePos.x > rect.right - AUTO_SCROLL_THRESHOLD) dx = AUTO_SCROLL_STEP;

                if (lastMousePos.y < rect.top + AUTO_SCROLL_THRESHOLD) dy = -AUTO_SCROLL_STEP;
                else if (lastMousePos.y > rect.bottom - AUTO_SCROLL_THRESHOLD) dy = AUTO_SCROLL_STEP;

                if (dx !== 0 || dy !== 0) {
                    scrollArea.scrollBy({ left: dx, top: dy, behavior: 'auto' });

                    // After scrolling, determine the element under the pointer and update selection
                    const el = document.elementFromPoint(lastMousePos.x, lastMousePos.y);
                    const nearestCell = el ? el.closest && el.closest('td') : null;
                    if (nearestCell) {
                        const htmlCell = nearestCell as HTMLElement;
                        const r = parseInt(htmlCell.dataset.row!, 10);
                        const c = parseInt(htmlCell.dataset.col!, 10);
                        if (!selectionEnd || selectionEnd.row !== r || selectionEnd.col !== c) {
                            selectionEnd = { row: r, col: c };
                            selectRange(selectionStart!.row, selectionStart!.col, r, c);
                        }
                    }
                }

                // Continue loop
                autoScrollLoop();
            });
        }

        if (selectionGlobalListenersAttached) return;
        selectionGlobalListenersAttached = true;

        document.addEventListener('pointerdown', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (!(target.closest('#tableContainer') || target.closest('.toolbar') || target.closest('#xlsxTable'))) return;

            const container = document.getElementById('tableContainer') as HTMLElement | null;
            if (!container) return;
            if (!container.hasAttribute('tabindex')) {
                container.setAttribute('tabindex', '-1');
            }
            container.focus({ preventScroll: true });
        }, true);

        document.addEventListener('mouseup', () => {
            isSelecting = false;
            selectionStart = null;
            selectionEnd = null;
            lastMousePos = null;
            stopAutoScroll();
        });

        document.addEventListener('keydown', (e) => {
            const isCmdOrCtrl = e.ctrlKey || e.metaKey;

            if (isVersionPreviewMode) {
                const key = e.key.toLowerCase();
                const allowNavigation = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', 'end'].includes(key);

                if (e.key === 'Escape') {
                    e.preventDefault();
                    vscode.postMessage({ command: 'cancelVersionPreview' });
                    return;
                }

                if (isCmdOrCtrl && key === 'c') {
                    e.preventDefault();
                    copySelectionToClipboard();
                    return;
                }

                if (!allowNavigation) {
                    e.preventDefault();
                    showToast('Version preview is read-only');
                    return;
                }
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
                e.preventDefault();
                saveEdits(false);
                return;
            }

            if (isEditMode) {
                if (isCmdOrCtrl && (e.key.toLowerCase() === 'z')) {
                    e.preventDefault();
                    const active = document.activeElement as HTMLElement | null;
                    const isEditingCell = !!active && active.tagName === 'TD' && active.getAttribute('contenteditable') === 'true';
                    if (isEditingCell) {
                        if (e.shiftKey) document.execCommand('redo');
                        else document.execCommand('undo');
                    } else if (e.shiftKey) {
                        document.execCommand('redo');
                    } else {
                        document.execCommand('undo');
                    }
                    return;
                }

                if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    const active = document.activeElement as HTMLElement | null;
                    const isEditingCell = !!active && active.tagName === 'TD' && active.getAttribute('contenteditable') === 'true';
                    if (isEditingCell) {
                        document.execCommand('redo');
                    } else {
                        document.execCommand('redo');
                    }
                    return;
                }

                if (isCmdOrCtrl && e.key.toLowerCase() === 'b') {
                    e.preventDefault();
                    applyEditFormatting('bold');
                    return;
                }

                if (isCmdOrCtrl && e.key.toLowerCase() === 'i') {
                    e.preventDefault();
                    applyEditFormatting('italic');
                    return;
                }

                if (e.key === 'Enter') {
                    e.preventDefault();
                    const active = document.activeElement as HTMLElement;
                    if (active && active.tagName === 'TD') {
                        const r = parseInt(active.getAttribute('data-row') || '0', 10);
                        const c = parseInt(active.getAttribute('data-col') || '0', 10);
                        const next = document.querySelector('td[data-row="' + (r + 1) + '"][data-col="' + c + '"]') as HTMLElement;
                        if (next) {
                            next.focus();
                            const range = document.createRange();
                            const sel = window.getSelection();
                            range.selectNodeContents(next);
                            range.collapse(false);
                            sel!.removeAllRanges();
                            sel!.addRange(range);
                        }
                    }
                }
                return;
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditMode) {
                e.preventDefault();
                return;
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                copySelectionToClipboard();
                return;
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                const currentTable = document.querySelector('#tableContainer table');
                if (!currentTable) return;
                const allCells = currentTable.querySelectorAll('td') as NodeListOf<HTMLElement>;
                clearSelection();
                allCells.forEach(cell => {
                    cell.classList.add('selected');
                    selectedCells.add(cell);
                });
                if (allCells.length > 0) {
                    allCells[0].classList.add('active-cell');
                    activeCell = allCells[0];
                }
                updateSelectionInfo();
            }
        });

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (headerContextMenuEl && !headerContextMenuEl.classList.contains('hidden')) {
                if (!target.closest('#headerContextMenu') && !target.closest('th.row-header') && !target.closest('th.col-header')) {
                    hideHeaderContextMenu();
                }
            }

            if (isEditMode) return;
            if (!target.closest('table') && !target.closest('.toolbar')) {
                clearSelection();
            }
        });
    }

    function ensureLinkTooltip(): HTMLElement {
        if (linkTooltip) return linkTooltip;
        linkTooltip = document.createElement('div');
        linkTooltip.id = 'linkTooltip';
        linkTooltip.className = 'link-tooltip hidden';
        linkTooltip.innerHTML = `
            <div class="link-tooltip-url" id="linkTooltipUrl"></div>
            <div class="link-tooltip-actions">
                <button type="button" id="linkTooltipOpen" class="toggle-button">Open in Browser</button>
                <button type="button" id="linkTooltipCopy" class="toggle-button">Copy Link</button>
            </div>
        `;

        linkTooltip.addEventListener('mouseenter', () => {
            if (linkTooltipHideTimer) {
                clearTimeout(linkTooltipHideTimer);
                linkTooltipHideTimer = null;
            }
        });

        linkTooltip.addEventListener('mouseleave', () => {
            scheduleHideLinkTooltip();
        });

        document.body.appendChild(linkTooltip);
        return linkTooltip;
    }

    function showLinkTooltipForCell(cellEl: HTMLElement | null) {
        if (!currentSettings.hyperlinkPreview) return;
        if (!cellEl) return;
        const url = cellEl.getAttribute('data-hyperlink') || '';
        if (!url) return;

        const tt = ensureLinkTooltip();
        const urlEl = tt.querySelector('#linkTooltipUrl');
        if (urlEl) urlEl.textContent = url;

        const openBtn = tt.querySelector('#linkTooltipOpen') as HTMLElement;
        const copyBtn = tt.querySelector('#linkTooltipCopy') as HTMLElement;

        if (openBtn) {
            openBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ command: 'openExternal', url });
                hideLinkTooltip();
            };
        }
        if (copyBtn) {
            copyBtn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                    await writeToClipboardAsync(url);
                    showToast('Copied URL');
                    hideLinkTooltip();
                } catch {
                    // ignore
                }
            };
        }

        tt.classList.remove('hidden');

        const rect = cellEl.getBoundingClientRect();
        // Measure after showing
        const ttRect = tt.getBoundingClientRect();
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - ttRect.width - 8);
        const top = Math.min(rect.bottom, window.innerHeight - ttRect.height - 2);
        tt.style.left = left + 'px';
        tt.style.top = top + 'px';
    }

    function hideLinkTooltip() {
        if (!linkTooltip) return;
        linkTooltip.classList.add('hidden');
        linkTooltip.style.left = '';
        linkTooltip.style.top = '';
    }

    function scheduleHideLinkTooltip() {
        if (linkTooltipHideTimer) clearTimeout(linkTooltipHideTimer);
        linkTooltipHideTimer = setTimeout(() => {
            hideLinkTooltip();
            linkTooltipHideTimer = null;
        }, 120);
    }

    function initializeHyperlinkHover() {
        const table = document.querySelector('table');
        if (!table) return;

        table.addEventListener('mouseover', (e) => {
            if (isEditMode) return;
            const t = e && (e.target as HTMLElement);
            const el = t && t.nodeType === 3 ? t.parentElement : t;
            const cell = el && el.closest ? el.closest('td[data-hyperlink]') : null;
            if (!cell) return;
            if (linkTooltipHideTimer) {
                clearTimeout(linkTooltipHideTimer);
                linkTooltipHideTimer = null;
            }
            showLinkTooltipForCell(cell as HTMLElement);
        });

        table.addEventListener('mouseout', (e) => {
            if (isEditMode) return;
            const toEl = e.relatedTarget as HTMLElement;
            if (!toEl) {
                scheduleHideLinkTooltip();
                return;
            }

            // If we are moving to an element inside the same cell, don't hide
            const fromCell = (e.target as HTMLElement).closest('td[data-hyperlink]');
            const toCell = toEl.closest ? toEl.closest('td[data-hyperlink]') : null;
            if (fromCell && toCell === fromCell) {
                return;
            }

            // If we are moving to the tooltip itself, don't hide
            if (linkTooltip && linkTooltip.contains(toEl)) {
                return;
            }

            scheduleHideLinkTooltip();
        });
    }

    function applySettings(settings: any) {
        const previousSpacious = !!currentSettings.spaciousCells;
        currentSettings = normalizeXlsxSettings(settings, currentSettings);

        // Show/hide enable button based on whether this is the default editor
        if (toolbarManager) {
            toolbarManager.setButtonVisibility('enableAsDefaultButton', currentSettings.isDefaultEditor === false);
        }

        syncSettingsCheckboxes(currentSettings);

        document.body.classList.toggle('sticky-header-enabled', !!currentSettings.stickyHeader);
        document.body.classList.toggle('first-row-as-header', !!currentSettings.firstRowIsHeader);
        document.body.classList.toggle('spacious-cells', !!currentSettings.spaciousCells);

        if (toolbarManager) {
            toolbarManager.applyStickyLayout(!!currentSettings.stickyToolbar, 'content', '.table-scroll');
            setTimeout(() => toolbarManager?.updateHeaderHeight(), 0);
        } else {
            document.body.classList.toggle('sticky-toolbar-enabled', !!currentSettings.stickyToolbar);
        }

        if (!currentSettings.hyperlinkPreview) hideLinkTooltip();

        const spaciousChanged = previousSpacious !== !!currentSettings.spaciousCells;
        if (spaciousChanged && worksheetsMeta.length > 0) {
            currentVisibleStart = 0;
            currentVisibleEnd = 0;
            rerenderCurrentSheetFromLocalState();
        }
    }

    function postSettings() {
        vscode.postMessage({ command: 'updateSettings', settings: currentSettings });
    }

    function setEditMode(enabled: boolean) {
        if (enabled && isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

        isEditMode = !!enabled;
        document.body.classList.toggle('edit-mode', isEditMode);

        const sheetSelector = document.getElementById('sheetSelector');
        const toggleExpandButton = document.getElementById('toggleExpandButton');
        const togglePlainViewButton = document.getElementById('togglePlainViewButton');
        const versionHistoryButton = document.getElementById('versionHistoryButton');
        const openSettingsButton = document.getElementById('openSettingsButton');
        const toggleBackgroundButton = document.getElementById('toggleBackgroundButton');
        const helpButton = document.getElementById('helpButton');

        const toggleTableEditButton = document.getElementById('toggleTableEditButton');
        const saveTableEditsButton = document.getElementById('saveTableEditsButton');
        const cancelTableEditsButton = document.getElementById('cancelTableEditsButton');
        const formatBoldButton = document.getElementById('formatBoldButton');
        const formatItalicButton = document.getElementById('formatItalicButton');
        const formatTextColorButton = document.getElementById('formatTextColorButton');
        const formatBackgroundColorButton = document.getElementById('formatBackgroundColorButton');

        if (toolbarManager) {
            toolbarManager.setButtonVisibility('toggleTableEditButton', !isEditMode);
            toolbarManager.setButtonVisibility('saveTableEditsButton', isEditMode);
            toolbarManager.setButtonVisibility('cancelTableEditsButton', isEditMode);
            toolbarManager.setButtonVisibility('formatBoldButton', isEditMode);
            toolbarManager.setButtonVisibility('formatItalicButton', isEditMode);
            toolbarManager.setButtonVisibility('formatTextColorButton', isEditMode);
            toolbarManager.setButtonVisibility('formatBackgroundColorButton', isEditMode);
        } else {
            if (toggleTableEditButton) toggleTableEditButton.classList.toggle('hidden', isEditMode);
            if (saveTableEditsButton) saveTableEditsButton.classList.toggle('hidden', !isEditMode);
            if (cancelTableEditsButton) cancelTableEditsButton.classList.toggle('hidden', !isEditMode);
            if (formatBoldButton) formatBoldButton.classList.toggle('hidden', !isEditMode);
            if (formatItalicButton) formatItalicButton.classList.toggle('hidden', !isEditMode);
            if (formatTextColorButton) formatTextColorButton.classList.toggle('hidden', !isEditMode);
            if (formatBackgroundColorButton) formatBackgroundColorButton.classList.toggle('hidden', !isEditMode);
        }

        if (sheetSelector) sheetSelector.classList.toggle('hidden', isEditMode);
        if (toggleExpandButton) toggleExpandButton.classList.toggle('hidden', isEditMode);
        if (togglePlainViewButton) togglePlainViewButton.classList.toggle('hidden', isEditMode);
        if (versionHistoryButton) versionHistoryButton.classList.toggle('hidden', isEditMode);
        if (openSettingsButton) openSettingsButton.classList.toggle('hidden', isEditMode);
        if (toggleBackgroundButton) toggleBackgroundButton.classList.toggle('hidden', isEditMode);
        if (helpButton) helpButton.classList.toggle('hidden', isEditMode);

        if (!isEditMode) {
            hideLinkTooltip();
            hideHeaderContextMenu();
            hideColorPalette();
            clearSelection();
            lastEditRange = null;
            pendingWorksheetOps = [];
            pendingCellStyleEdits.clear();
            return;
        }

        clearSelection();

        // Enable contenteditable for table cells
        const table = document.querySelector('#tableContainer table');
        if (!table) return;
        table.querySelectorAll('td').forEach(td => {
            td.setAttribute('contenteditable', 'true');
            td.setAttribute('spellcheck', 'false');
            td.classList.add('editable-cell');
            const htmlTd = td as HTMLElement;
            const currentText = normalizeCellText(htmlTd.textContent || '');
            htmlTd.dataset.originalText = currentText;
            htmlTd.dataset.originalHtml = htmlTd.innerHTML;
            td.addEventListener('focus', () => {
                lastFocusedEditableCell = td as HTMLElement;
                if (selectedCells.size !== 1 || !selectedCells.has(td as HTMLElement)) {
                    clearSelection();
                    selectCell(td as HTMLElement);
                }
            });
        });

        captureOriginalCellValues();
    }

    function captureOriginalCellValues() {
        const table = document.querySelector('#tableContainer table');
        if (!table) return;
        table.querySelectorAll('td[contenteditable="true"]').forEach(td => {
            const htmlTd = td as HTMLElement;
            const currentText = normalizeCellText(htmlTd.textContent || '');
            htmlTd.dataset.originalText = currentText;
            htmlTd.dataset.originalHtml = htmlTd.innerHTML;
        });
    }

    function saveEdits(shouldExit = false) {
        if (isSaving || !isEditMode) return;
        const table = document.querySelector('#tableContainer table');
        if (!table) return;

        isSaving = true;
        exitAfterSave = !!shouldExit;
        setButtonsEnabled(false);

        if (document.activeElement && document.activeElement.tagName === 'TD') {
            (document.activeElement as HTMLElement).blur();
        }
        clearSelection();
        if (window.getSelection) {
            window.getSelection()!.removeAllRanges();
        }

        const edits: any[] = [];
        const richEdits: any[] = [];
        table.querySelectorAll('td[contenteditable="true"]').forEach(td => {
            const htmlTd = td as HTMLElement;
            const row = parseInt(htmlTd.getAttribute('data-rownum') || '0', 10);
            const col = parseInt(htmlTd.getAttribute('data-colnum') || '0', 10);
            if (!row || !col) return;

            const original = (htmlTd.dataset.originalText || '').replace(/\u00a0/g, '');
            const current = (htmlTd.textContent || '').replace(/\u00a0/g, '');
            const originalHtml = (htmlTd.dataset.originalHtml || '').trim();
            const currentHtml = (htmlTd.innerHTML || '').trim();

            const runs = getCellRichRuns(htmlTd);
            const shouldSaveRuns = hasRunFormatting(runs) || currentHtml !== originalHtml;

            if (shouldSaveRuns) {
                richEdits.push({ row, col, runs });
            }

            if (current !== original) {
                edits.push({ row, col, value: current });
            }
        });

        setLoadingText('Saving worksheet...');
        showLoading();
        const styleEdits = Array.from(pendingCellStyleEdits.values());
        vscode.postMessage({ command: 'saveXlsxEdits', sheetIndex: currentWorksheet, edits, richEdits, styleEdits, operations: pendingWorksheetOps });
    }

    function setExpandedMode(isExpanded: boolean) {
        document.body.classList.toggle('expanded-mode', !!isExpanded);

        const expandIcon = document.getElementById('expandIcon');
        const collapseIcon = document.getElementById('collapseIcon');
        const text = document.getElementById('expandButtonText');

        if (expandIcon) expandIcon.style.display = isExpanded ? 'none' : 'block';
        if (collapseIcon) collapseIcon.style.display = isExpanded ? 'block' : 'none';
        if (text) text.textContent = isExpanded ? 'Default' : 'Expand';

        adjustColumnWidths(isExpanded ? 'expand' : 'default');
    }

    function wireSettingsUI() {
        const settings = createXlsxSettingsDefinitions(
            () => currentSettings,
            (next) => {
                currentSettings = next;
                applySettings(currentSettings);
            },
            () => {
                postSettings();
            }
        );

        SettingsManager.renderPanel(document.getElementById('toolbar')!, 'settingsPanel', 'settingsCancelButton', settings);

        new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settings, () => {
            toolbarManager?.updateHeaderHeight();
        });
    }

    function attachHandlersOnce() {
        if (handlersAttached) return;
        handlersAttached = true;

        toolbarManager = new ToolbarManager('toolbar');
        const toolbar = toolbarManager;

        // Sheet Selector
        const sheetSelector = document.createElement('select');
        sheetSelector.id = 'sheetSelector';
        sheetSelector.className = 'sheet-selector';
        sheetSelector.title = 'Select sheet';
        sheetSelector.addEventListener('change', (e) => {
            if (isEditMode) return;
            currentWorksheet = parseInt((e.target as HTMLSelectElement).value, 10);
            clearSelection();
            renderWorksheet(currentWorksheet);
        });
        
        toolbar.setButtons(createXlsxToolbarButtons({
            textColorIcon,
            bgColorIcon,
            onToggleTableEdit: () => setEditMode(true),
            onSaveTableEdits: () => saveEdits(true),
            onCancelTableEdits: () => {
                setEditMode(false);
                renderWorksheet(currentWorksheet);
            },
            onFormatBold: () => applyEditFormatting('bold'),
            onFormatItalic: () => applyEditFormatting('italic'),
            onFormatTextColor: () => {},
            onFormatBackgroundColor: () => {},
            onToggleExpand: () => {
                if (isEditMode) return;
                const btn = document.getElementById('toggleExpandButton');
                const state = btn?.getAttribute('data-state') || 'default';
                if (state === 'default') {
                    btn?.setAttribute('data-state', 'expanded');
                    if (btn) btn.innerHTML = Icons.Collapse + ' <span class="btn-label">Default</span>';
                    setExpandedMode(true);
                } else {
                    btn?.setAttribute('data-state', 'default');
                    if (btn) btn.innerHTML = Icons.Expand + ' <span class="btn-label">Expand</span>';
                    setExpandedMode(false);
                }
            },
            onTogglePlainView: () => {
                if (isEditMode) return;
                isPlainView = !isPlainView;
                document.body.classList.toggle('plain-view', isPlainView);

                const btn = document.getElementById('togglePlainViewButton');
                if (btn) {
                    const labelSpan = btn.querySelector('.btn-label');
                    if (labelSpan) labelSpan.textContent = isPlainView ? 'Styled' : 'Plain';
                }

                rowCache.clear();
                currentVisibleStart = 0;
                currentVisibleEnd = 0;
                renderWorksheet(currentWorksheet);
            },
            onVersionHistory: () => {
                if (isEditMode) return;
                vscode.postMessage({ command: 'showVersionHistory' });
            },
            onOpenSettings: () => {},
            onToggleBackground: () => {},
            onHelp: () => {
                vscode.postMessage({
                    command: 'openExternal',
                    url: 'https://docs.google.com/forms/d/e/1FAIpQLSe5AqE_f1-WqUlQmvuPn1as3Mkn4oLjA0EDhNssetzt63ONzA/viewform'
                });
            },
            onEnableAsDefault: () => {
                vscode.postMessage({ command: 'enableAsDefault' });
            }
        }));

        toolbar.prependElement(sheetSelector);

        // Inject tooltip if variables are present
        InfoTooltip.inject('toolbar', (window as any).viewImgUri, (window as any).logoSvgUri, 'table view');

        // Ensure the "Plain/Styled" toggle shows the correct label on initial render
        const togglePlainViewBtn = document.getElementById('togglePlainViewButton');
        if (togglePlainViewBtn) {
            const labelSpan = togglePlainViewBtn.querySelector('.btn-label');
            if (labelSpan) labelSpan.textContent = isPlainView ? 'Styled' : 'Plain';
        }

        wireEditFormattingControls();

        if (typeof ThemeManager !== 'undefined') {
            new ThemeManager('toggleBackgroundButton', {
                onBeforeCycle: () => !isEditMode
            }, vscode);
        }

        wireSettingsUI();
        window.addEventListener('resize', () => {
            toolbarManager?.updateHeaderHeight();
        });
    }

    function populateSheetSelector() {
        const selector = document.getElementById('sheetSelector') as HTMLSelectElement;
        if (!selector) return;

        selector.innerHTML = '';
        worksheetsMeta.forEach((ws, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            
            // Format name to "Sheet X" if generic
            let name = ws.name || `Sheet ${i + 1}`;
            const genericRegex = /^sheet\s*(\d+)$/i;
            if (genericRegex.test(name)) {
                const match = name.match(genericRegex);
                if (match) {
                    name = `Sheet ${match[1]}`;
                }
            }
            
            opt.textContent = name;
            selector.appendChild(opt);
        });
        selector.value = '0';
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;

        if (message.command === 'initSettings') {
            applySettings(message.settings || {});
            return;
        }

        if (message.command === 'settingsUpdated') {
            applySettings(message.settings || {});
            return;
        }

        if (message.command === 'saveResult') {
            hideLoading();
            setLoadingText('Rendering worksheet...');
            isSaving = false;
            setButtonsEnabled(true);
            if (message.ok) {
                showToast('Saved');
                pendingWorksheetOps = [];
                pendingCellStyleEdits.clear();
                if (exitAfterSave) {
                    setEditMode(false);
                } else {
                    captureOriginalCellValues();
                }
            } else {
                showToast('Error saving');
            }
            return;
        }

        if (message.command === 'versionHistoryError') {
            showToast(message.message || 'Version history failed');
            return;
        }

        if (message.command === 'versionRestoredXlsx') {
            showToast('Version restored');
            return;
        }

        if (message.command === 'versionPreviewCancelledXlsx') {
            showToast('Preview canceled');
            return;
        }

        // Handle rowsData response for virtual scrolling
        if (message.command === 'rowsData') {
            virtualLoader.resolveRequest(message.requestId, message.rows || []);
            return;
        }

        // Handle initVirtualTable for virtual scrolling
        if (message.command === 'initVirtualTable') {
            const previousWorksheet = currentWorksheet;
            worksheetsMeta = Array.isArray(message.worksheets) ? message.worksheets : [];
            currentWorksheet = Math.min(Math.max(previousWorksheet, 0), Math.max(worksheetsMeta.length - 1, 0));

            const rowHeaderWidth = typeof message.rowHeaderWidth === 'number' ? message.rowHeaderWidth : 60;
            document.documentElement.style.setProperty('--row-header-width', rowHeaderWidth + 'px');

            attachHandlersOnce();
            populateSheetSelector();
            const selector = document.getElementById('sheetSelector') as HTMLSelectElement | null;
            if (selector) selector.value = String(currentWorksheet);
            
            if (currentSettings) {
                applySettings(currentSettings);
            }
            const expandBtn = document.getElementById('toggleExpandButton');
            if (expandBtn) expandBtn.setAttribute('data-state', 'default');
            setExpandedMode(false);

            if (message.previewMode) {
                previewVersionId = typeof message.versionId === 'string' ? message.versionId : null;
                const previewLabel = message.timestamp
                    ? `Previewing ${new Date(message.timestamp).toLocaleString()} (read-only)`
                    : 'Previewing selected version (read-only)';
                setVersionPreviewMode(true, previewLabel);
            } else {
                setVersionPreviewMode(false);
            }

            renderWorksheet(currentWorksheet);
            return;
        }

        // Legacy init handler (for backwards compatibility)
        if (message.command === 'init') {
            const previousWorksheet = currentWorksheet;
            // Convert old format to new format
            const worksheets = Array.isArray(message.worksheets) ? message.worksheets : [];
            worksheetsMeta = worksheets.map((ws: any, index: number) => ({
                name: ws.name,
                index,
                totalRows: ws.data ? ws.data.maxRow : 0,
                columnCount: ws.data ? ws.data.maxCol : 0,
                columnWidths: ws.data ? ws.data.columnWidths : [],
                mergedCells: ws.data ? ws.data.mergedCells : []
            }));
            // Also cache all rows since they were sent
            worksheets.forEach((ws: any, wsIndex: number) => {
                if (ws.data && ws.data.rows) {
                    ws.data.rows.forEach((row: any, rowIndex: number) => {
                        if (wsIndex === 0) {
                            rowCache.set(rowIndex, row);
                        }
                    });
                }
            });
            currentWorksheet = Math.min(Math.max(previousWorksheet, 0), Math.max(worksheetsMeta.length - 1, 0));

            const rowHeaderWidth = typeof message.rowHeaderWidth === 'number' ? message.rowHeaderWidth : 60;
            document.documentElement.style.setProperty('--row-header-width', rowHeaderWidth + 'px');

            attachHandlersOnce();
            populateSheetSelector();
            const selector = document.getElementById('sheetSelector') as HTMLSelectElement | null;
            if (selector) selector.value = String(currentWorksheet);
            const expandBtn = document.getElementById('toggleExpandButton');
            if (expandBtn) expandBtn.setAttribute('data-state', 'default');
            setExpandedMode(false);
            setVersionPreviewMode(false);
            renderWorksheet(currentWorksheet);
        }
    });

    document.addEventListener('DOMContentLoaded', () => {
        vscode.postMessage({ command: 'webviewReady' });
    });
})();
