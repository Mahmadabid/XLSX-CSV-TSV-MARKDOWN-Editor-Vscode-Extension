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

(function () {
    // ===== Configuration =====
    const { BUFFER_ROWS, CHUNK_SIZE } = VirtualScrollConfig;
    let ROW_HEIGHT = VirtualScrollConfig.ROW_HEIGHT;

    // ===== State =====
    let isTableView = true;
    let isSaving = false;
    let exitAfterSave = false;
    let saveTimeout: any = null;

    // Virtual scrolling state
    let totalRows = 0;
    let columnCount = 0;
    let rowCache = new Map<number, string[]>();
    const virtualLoader = new VirtualLoader<string[]>('getRows');
    let currentVisibleStart = 0;
    let currentVisibleEnd = 0;
    let isRequestingRows = false;

    // Selection state
    let isSelecting = false;
    let startCell: { row: number, col: number } | null = null;
    let endCell: { row: number, col: number } | null = null;
    const selectedCells = new Set<HTMLElement>();
    let activeCell: HTMLElement | null = null;
    const selectedRows = new Set<number>();
    const selectedColumns = new Set<number>();
    let lastSelectedRow: number | null = null;
    let lastSelectedColumn: number | null = null;

    // Track selected row/column indices for full copy
    const selectedRowIndices = new Set<number>();
    const selectedColumnIndices = new Set<number>();

    // Undo/Redo for edit mode
    interface CellCoord {
        row: number;
        col: number;
    }

    let isVersionPreviewMode = false;
    let previewVersionId: string | null = null;

    // Settings
    interface Settings {
        firstRowIsHeader: boolean;
        stickyToolbar: boolean;
        stickyHeader: boolean;
        spaciousCells?: boolean;
        isDefaultEditor?: boolean;
    }

    let currentSettings: Settings = {
        firstRowIsHeader: false,
        stickyToolbar: true,
        stickyHeader: false,
        spaciousCells: false,
        isDefaultEditor: true
    };

    // Current file format: 'csv' or 'tsv'
    let fileFormat = 'csv';

    // Toolbar manager (global for settings access)
    let toolbarManager: ToolbarManager | null = null;

    // ===== Utilities =====
    const $ = Utils.$;
    const normalizeCellText = Utils.normalizeCellText;
    const escapeHtml = Utils.escapeHtml;
    const showToast = Utils.showToast;
    const writeToClipboardAsync = Utils.writeToClipboardAsync;

    function escapeCsvCell(value: string): string {
        const v = value ?? '';
        // For CSV/TSV we need to escape quotes and newlines; also treat tab as special when serializing TSV
        const needsQuotes = /["\t,\n\r]/.test(v);
        if (!needsQuotes) return v;
        return '"' + v.replace(/"/g, '""') + '"';
    }

    function setButtonsEnabled(enabled: boolean) {
        const ids = ['toggleViewButton', 'toggleBackgroundButton', 'toggleExpandButton', 'versionHistoryButton', 'convertFileButton'];
        ids.forEach((id) => {
            const el = $(id) as HTMLButtonElement;
            if (el) el.disabled = !enabled;
        });
    }

    // ===== Virtual Scrolling Core =====

    function getTableContainer(): HTMLElement | null {
        return $('tableContainer');
    }

    function requestRows(start: number, end: number, timeout = 10000): Promise<string[][]> {
        return virtualLoader.requestRows(start, end, timeout);
    }

    function requestAllRows(): Promise<string[][]> {
        // Use longer timeout for full data fetch (30 seconds)
        return requestRows(0, totalRows, 30000);
    }

    function createRowHtml(rowData: string[], rowIndex: number): string {
        let html = `<tr data-virtual-row="${rowIndex}">`;
        html += `<th class="row-header" data-row="${rowIndex}">${rowIndex + 1}</th>`;

        for (let colIndex = 0; colIndex < columnCount; colIndex++) {
            const cellContent = (rowData && rowData[colIndex]) ? rowData[colIndex].trim() : '';
            const isEmpty = cellContent === '';
            const displayContent = isEmpty ? '&nbsp;' : escapeHtml(cellContent);

            html += `<td data-row="${rowIndex}" data-col="${colIndex}" `;
            html += `data-default-bg="true" data-default-color="true"`;
            if (isEmpty) html += ` data-empty="true"`;
            html += `>${displayContent}</td>`;
        }

        html += '</tr>';
        return html;
    }

    function renderVirtualRows(startIndex: number, endIndex: number, rowsData: string[][]) {
        const tbody = document.querySelector('#csv-table tbody');
        if (!tbody) return;

        rowsData.forEach((row, i) => {
            rowCache.set(startIndex + i, row);
        });

        const topSpacerHeight = startIndex * ROW_HEIGHT;
        const bottomSpacerHeight = Math.max(0, (totalRows - endIndex) * ROW_HEIGHT);

        let html = '';

        if (topSpacerHeight > 0) {
            html += `<tr class="virtual-spacer top-spacer"><td colspan="${columnCount + 1}" style="height: ${topSpacerHeight}px; padding: 0; border: none;"></td></tr>`;
        }

        for (let i = startIndex; i < endIndex; i++) {
            const rowData = rowCache.get(i) || [];
            html += createRowHtml(rowData, i);
        }

        if (bottomSpacerHeight > 0) {
            html += `<tr class="virtual-spacer bottom-spacer"><td colspan="${columnCount + 1}" style="height: ${bottomSpacerHeight}px; padding: 0; border: none;"></td></tr>`;
        }

        tbody.innerHTML = html;

        reapplySelection();
    }

    async function updateVisibleRows(force = false) {
        const container = getTableContainer();
        if (!container || totalRows === 0) return;

        if (isCellEditing) {
            stopEditing();
        }

        const scrollTop = container.scrollTop;
        const clientHeight = container.clientHeight;

        const firstVisibleRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
        const lastVisibleRow = Math.min(
            totalRows,
            Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + BUFFER_ROWS
        );

        const chunkStart = Math.floor(firstVisibleRow / CHUNK_SIZE) * CHUNK_SIZE;
        const chunkEnd = Math.min(totalRows, Math.ceil(lastVisibleRow / CHUNK_SIZE) * CHUNK_SIZE);

        if (!force && chunkStart === currentVisibleStart && chunkEnd === currentVisibleEnd) {
            return;
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

            const cachedRows: string[][] = [];
            for (let i = chunkStart; i < chunkEnd; i++) {
                cachedRows.push(rowCache.get(i) || []);
            }
            renderVirtualRows(chunkStart, chunkEnd, cachedRows);
        }
    }

    const onScroll = debounce(() => {
        updateVisibleRows();
    }, 16);

    function initializeVirtualScrolling() {
        const container = getTableContainer();
        if (!container) return;

        container.addEventListener('scroll', onScroll, { passive: true });
        updateVisibleRows();
    }

    // ===== Selection =====

    function clearSelection() {
        document.querySelectorAll(
            'td.selected, td.active-cell, td.column-selected, td.row-selected, th.column-selected, th.row-selected, th.row-header.row-selected, th.col-header.column-selected'
        ).forEach((el) => {
            el.classList.remove('selected', 'active-cell', 'column-selected', 'row-selected', 'copying');
        });
        selectedCells.clear();
        selectedRows.clear();
        selectedColumns.clear();
        selectedRowIndices.clear();
        selectedColumnIndices.clear();
        activeCell = null;
        lastSelectedRow = null;
        lastSelectedColumn = null;
        const selectionInfo = $('selectionInfo');
        if (selectionInfo) selectionInfo.style.display = 'none';
    }

    function reapplySelection() {
        // Re-apply column selection
        selectedColumnIndices.forEach(colIdx => {
            document.querySelectorAll(`td[data-col="${colIdx}"], th[data-col="${colIdx}"]`).forEach((cell) => {
                cell.classList.add('column-selected');
                if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                else if (cell.tagName === 'TH') cell.classList.add('column-selected');
            });
        });

        // Re-apply row selection
        selectedRowIndices.forEach(rowIdx => {
            const rowHeader = document.querySelector(`th[data-row="${rowIdx}"]`);
            if (rowHeader && rowHeader.parentElement) {
                rowHeader.parentElement.querySelectorAll('td, th').forEach((cell) => {
                    cell.classList.add('row-selected');
                    if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                });
            }
        });

        // Re-apply active cell
        if (activeCell) {
            const row = activeCell.dataset?.row;
            const col = activeCell.dataset?.col;
            if (row !== undefined && col !== undefined) {
                const newCell = document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement;
                if (newCell) {
                    newCell.classList.add('active-cell');
                    activeCell = newCell;
                }
            }
        }

        if (selectedCells.size > 0 && selectedRowIndices.size === 0 && selectedColumnIndices.size === 0) {
            const cellsArray = Array.from(selectedCells);
            const rows = new Set(cellsArray.map((cell) => parseInt(cell.dataset.row!, 10)));
            const cols = new Set(cellsArray.map((cell) => parseInt(cell.dataset.col!, 10)));
            rows.forEach(r => {
                const thRow = document.querySelector(`th.row-header[data-row="${r}"]`);
                if (thRow) thRow.classList.add('row-selected');
            });
            cols.forEach(c => {
                const thCol = document.querySelector(`th.col-header[data-col="${c}"]`);
                if (thCol) thCol.classList.add('column-selected');
            });
        }
    }

    function getCellCoordinates(cell: HTMLElement | null): { row: number, col: number } | null {
        if (!cell || !cell.dataset) return null;
        return {
            row: parseInt(cell.dataset.row!, 10),
            col: parseInt(cell.dataset.col!, 10),
        };
    }

    function updateSelectionInfo() {
        const selectionInfo = $('selectionInfo');
        if (!selectionInfo) return;

        // For full column/row selection, show total counts
        if (selectedColumnIndices.size > 0 || selectedRowIndices.size > 0) {
            let rowCount = selectedRowIndices.size > 0 ? selectedRowIndices.size : totalRows;
            let colCount = selectedColumnIndices.size > 0 ? selectedColumnIndices.size : columnCount;

            if (selectedRowIndices.size > 0 && selectedColumnIndices.size === 0) {
                colCount = columnCount;
            }
            if (selectedColumnIndices.size > 0 && selectedRowIndices.size === 0) {
                rowCount = totalRows;
            }

            selectionInfo.textContent = rowCount + 'R × ' + colCount + 'C';
            selectionInfo.style.display = 'block';
        } else if (selectedCells.size > 1) {
            const cellsArray = Array.from(selectedCells);
            const rows = new Set(cellsArray.map((cell) => parseInt(cell.dataset.row!, 10)));
            const cols = new Set(cellsArray.map((cell) => parseInt(cell.dataset.col!, 10)));
            selectionInfo.textContent = rows.size + 'R × ' + cols.size + 'C';
            selectionInfo.style.display = 'block';
        } else {
            selectionInfo.style.display = 'none';
        }
    }

    function selectCellsInRange(start: { row: number, col: number }, end: { row: number, col: number }) {
        if (!start || !end) return;

        const minRow = Math.min(start.row, end.row);
        const maxRow = Math.max(start.row, end.row);
        const minCol = Math.min(start.col, end.col);
        const maxCol = Math.max(start.col, end.col);

        document.querySelectorAll('td.selected, td.active-cell, th.row-selected, th.column-selected').forEach((el) => {
            el.classList.remove('selected', 'active-cell', 'row-selected', 'column-selected');
        });
        selectedCells.clear();

        document.querySelectorAll('td[data-row][data-col]').forEach((cell) => {
            const htmlCell = cell as HTMLElement;
            const coords = getCellCoordinates(htmlCell);
            if (!coords) return;
            if (coords.row >= minRow && coords.row <= maxRow &&
                coords.col >= minCol && coords.col <= maxCol) {
                htmlCell.classList.add('selected');
                selectedCells.add(htmlCell);
            }
        });

        // Add header highlighting
        for (let r = minRow; r <= maxRow; r++) {
            const thRow = document.querySelector(`th.row-header[data-row="${r}"]`) as HTMLElement;
            if (thRow) thRow.classList.add('row-selected');
        }
        for (let c = minCol; c <= maxCol; c++) {
            const thCol = document.querySelector(`th.col-header[data-col="${c}"]`) as HTMLElement;
            if (thCol) thCol.classList.add('column-selected');
        }

        const startCellElement = document.querySelector(
            `td[data-row="${start.row}"][data-col="${start.col}"]`
        ) as HTMLElement;
        if (startCellElement) {
            startCellElement.classList.add('active-cell');
            activeCell = startCellElement;
        }

        updateSelectionInfo();
    }

    function selectColumn(columnIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        if (!ctrlKey && !shiftKey) clearSelection();

        if (shiftKey && lastSelectedColumn !== null) {
            if (!ctrlKey) clearSelection();
            const minCol = Math.min(lastSelectedColumn, columnIndex);
            const maxCol = Math.max(lastSelectedColumn, columnIndex);
            for (let col = minCol; col <= maxCol; col++) {
                selectedColumns.add(col);
                selectedColumnIndices.add(col);
                document.querySelectorAll(`td[data-col="${col}"], th[data-col="${col}"]`).forEach((cell) => {
                    cell.classList.add('column-selected');
                    if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                });
            }
        } else if (ctrlKey) {
            if (selectedColumns.has(columnIndex)) {
                selectedColumns.delete(columnIndex);
                selectedColumnIndices.delete(columnIndex);
                document.querySelectorAll(`td[data-col="${columnIndex}"], th[data-col="${columnIndex}"]`).forEach((cell) => {
                    cell.classList.remove('column-selected');
                    if (cell.tagName === 'TD') selectedCells.delete(cell as HTMLElement);
                });
            } else {
                selectedColumns.add(columnIndex);
                selectedColumnIndices.add(columnIndex);
                document.querySelectorAll(`td[data-col="${columnIndex}"], th[data-col="${columnIndex}"]`).forEach((cell) => {
                    cell.classList.add('column-selected');
                    if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                });
            }
            lastSelectedColumn = columnIndex;
        } else {
            selectedColumns.add(columnIndex);
            selectedColumnIndices.add(columnIndex);
            document.querySelectorAll(`td[data-col="${columnIndex}"], th[data-col="${columnIndex}"]`).forEach((cell) => {
                cell.classList.add('column-selected');
                if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                else if (cell.tagName === 'TH') cell.classList.add('column-selected');
            });
            lastSelectedColumn = columnIndex;
        }
        updateSelectionInfo();
    }

    function selectRow(rowIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        if (!ctrlKey && !shiftKey) clearSelection();

        if (shiftKey && lastSelectedRow !== null) {
            if (!ctrlKey) clearSelection();
            const minRow = Math.min(lastSelectedRow, rowIndex);
            const maxRow = Math.max(lastSelectedRow, rowIndex);
            for (let row = minRow; row <= maxRow; row++) {
                selectedRows.add(row);
                selectedRowIndices.add(row);
                const rowHeader = document.querySelector(`th[data-row="${row}"]`);
                if (rowHeader && rowHeader.parentElement) {
                    rowHeader.parentElement.querySelectorAll('td, th').forEach((cell) => {
                        cell.classList.add('row-selected');
                        if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                    });
                }
            }
        } else if (ctrlKey) {
            if (selectedRows.has(rowIndex)) {
                selectedRows.delete(rowIndex);
                selectedRowIndices.delete(rowIndex);
                const rowHeader = document.querySelector(`th[data-row="${rowIndex}"]`);
                if (rowHeader && rowHeader.parentElement) {
                    rowHeader.parentElement.querySelectorAll('td, th').forEach((cell) => {
                        cell.classList.remove('row-selected');
                        if (cell.tagName === 'TD') selectedCells.delete(cell as HTMLElement);
                    });
                }
            } else {
                selectedRows.add(rowIndex);
                selectedRowIndices.add(rowIndex);
                const rowHeader = document.querySelector(`th[data-row="${rowIndex}"]`);
                if (rowHeader && rowHeader.parentElement) {
                    rowHeader.parentElement.querySelectorAll('td, th').forEach((cell) => {
                        cell.classList.add('row-selected');
                        if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                    });
                }
            }
            lastSelectedRow = rowIndex;
        } else {
            selectedRows.add(rowIndex);
            selectedRowIndices.add(rowIndex);
            const rowHeader = document.querySelector(`th[data-row="${rowIndex}"]`);
            if (rowHeader && rowHeader.parentElement) {
                rowHeader.parentElement.querySelectorAll('td, th').forEach((cell) => {
                    cell.classList.add('row-selected');
                    if (cell.tagName === 'TD') selectedCells.add(cell as HTMLElement);
                });
            }
            lastSelectedRow = rowIndex;
        }
        updateSelectionInfo();
    }

    // ===== Edit Mode =====

    function getCurrentFocusCell(): CellCoord | null {
        const coords = getCellCoordinates(editingCell || activeCell);
        if (coords) return coords;

        const firstSelected = selectedCells.values().next().value as HTMLElement | undefined;
        if (!firstSelected) return null;
        return getCellCoordinates(firstSelected);
    }

    function pushToUndo() {
        if (isVersionPreviewMode) return;
        vscode.postMessage({ command: 'pushUndoSnapshot' });
    }

    function focusAndHighlightCell(coord: CellCoord | null, options?: { preserveScroll?: boolean }) {
        if (!coord || totalRows <= 0 || columnCount <= 0) {
            return;
        }

        const row = Math.max(0, Math.min(totalRows - 1, coord.row));
        const col = Math.max(0, Math.min(columnCount - 1, coord.col));
        const preserveScroll = options?.preserveScroll === true;

        clearSelection();

        const container = getTableContainer();
        if (container && !preserveScroll) {
            const desiredTop = Math.max(0, row * ROW_HEIGHT - Math.floor(container.clientHeight / 2));
            container.scrollTop = desiredTop;
        }

        requestAnimationFrame(() => {
            const targetCell = document.querySelector(`td[data-row="${row}"][data-col="${col}"]`) as HTMLElement;
            if (!targetCell) {
                return;
            }

            targetCell.classList.add('selected', 'active-cell', 'history-flash');
            selectedCells.add(targetCell);
            activeCell = targetCell;
            startCell = { row, col };
            endCell = { row, col };

            const thRow = document.querySelector(`th.row-header[data-row="${row}"]`) as HTMLElement;
            if (thRow) thRow.classList.add('row-selected');
            const thCol = document.querySelector(`th.col-header[data-col="${col}"]`) as HTMLElement;
            if (thCol) thCol.classList.add('column-selected');

            updateSelectionInfo();
            setTimeout(() => {
                targetCell.classList.remove('history-flash');
            }, 700);
        });
    }

    function undo() {
        if (isVersionPreviewMode) return;
        vscode.postMessage({ command: 'undo' });
    }

    function redo() {
        if (isVersionPreviewMode) return;
        vscode.postMessage({ command: 'redo' });
    }

    function ensurePreviewBanner(): HTMLElement {
        let banner = $('versionPreviewBanner');
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

            const content = $('content');
            if (content) {
                content.insertBefore(banner, content.firstChild);
            } else {
                document.body.appendChild(banner);
            }

            const restoreBtn = $('restoreVersionButton') as HTMLButtonElement;
            const cancelBtn = $('cancelVersionPreviewButton') as HTMLButtonElement;
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
            const previewText = $('versionPreviewText');
            if (previewText) {
                previewText.textContent = label || 'Previewing selected version (read-only)';
            }
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
            previewVersionId = null;
        }
    }

    function captureOriginalCellValues() {
        // Store original data from cache for cancel functionality
        (window as any)._originalCacheSnapshot = new Map();
        rowCache.forEach((value, key) => {
            (window as any)._originalCacheSnapshot.set(key, [...value]);
        });
    }

    function restoreOriginalCellValues() { if ((window as any)._originalCacheSnapshot) { rowCache = new Map((window as any)._originalCacheSnapshot); (window as any)._originalCacheSnapshot = null; updateVisibleRows(true); } }

    let isCellEditing = false;
    let editingCell: HTMLElement | null = null;

    function startEditing(cell: HTMLElement, clear = false) {
        if (isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }
        if (isCellEditing) stopEditing();
        isCellEditing = true;
        editingCell = cell;
        cell.setAttribute('contenteditable', 'true');
        cell.focus();
        if (clear) {
            cell.textContent = '';
        } else {
            const range = document.createRange();
            range.selectNodeContents(cell);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }

    function stopEditing() {
        if (!isCellEditing || !editingCell) return;
        isCellEditing = false;
        editingCell.removeAttribute('contenteditable');
        
        const row = parseInt(editingCell.dataset.row!, 10);
        const col = parseInt(editingCell.dataset.col!, 10);
        const value = normalizeCellText(editingCell.textContent || '');

        let rowData = rowCache.get(row);
        if (!rowData) {
            rowData = [];
            rowCache.set(row, rowData);
        }
        if (rowData[col] !== value) {
            pushToUndo();
            const cloned = [...rowData];
            cloned[col] = value;
            rowCache.set(row, cloned);
            vscode.postMessage({ command: 'updateRow', rowIndex: row, rowData: cloned });
            scheduleSave();
        }
        editingCell = null;
    }

    function scheduleSave() {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            performSave(false, true);
        }, 1000);
    }



    function performSave(shouldExit = false, isAutosave = false) {
        if (isVersionPreviewMode) {
            showToast('Cannot save while previewing a version');
            return;
        }
        if (isSaving) return;
        isSaving = true;
        exitAfterSave = shouldExit;
        setButtonsEnabled(false);

        if (isCellEditing) {
            stopEditing();
        }

        // Commit current edits to cache
        let didMutate = false;
        let preSavePush = false;
        document.querySelectorAll('td[data-row][data-col]').forEach((cell) => {
            const htmlCell = cell as HTMLElement;
            const row = parseInt(htmlCell.dataset.row!, 10);
            const col = parseInt(htmlCell.dataset.col!, 10);
            const value = normalizeCellText(htmlCell.textContent || '');

            let rowData = rowCache.get(row);
            if (!rowData) {
                rowData = [];
                rowCache.set(row, rowData);
            }
            if (rowData[col] !== value) {
                if (!preSavePush) {
                    pushToUndo();
                    preSavePush = true;
                }
                const cloned = [...rowData];
                cloned[col] = value;
                rowCache.set(row, cloned);
                didMutate = true;
                vscode.postMessage({ command: 'updateRow', rowIndex: row, rowData: cloned });
            }
        });

        // pushToUndo now happens before mutating in loop

        if (document.activeElement && document.activeElement.tagName === 'TD') {
            (document.activeElement as HTMLElement).blur();
        }

        clearSelection();

        if (window.getSelection) {
            window.getSelection()!.removeAllRanges();
        }

        vscode.postMessage({ command: 'saveCsv', isAutosave });
    }

    // ===== Context Menu =====
    let contextMenu: HTMLElement | null = null;

    function hideContextMenu() {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
    }

    function showContextMenu(e: MouseEvent, target: HTMLElement) {
        e.preventDefault();
        hideContextMenu();

        if (isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

        const isRowHeader = target.classList.contains('row-header');
        const isColHeader = target.classList.contains('col-header');
        const isCell = target.tagName === 'TD';

        if (!isRowHeader && !isColHeader && !isCell) return;

        contextMenu = document.createElement('div');
        contextMenu.className = 'context-menu';
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;

        const createMenuItem = (label: string, onClick: () => void) => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.textContent = label;
            item.addEventListener('click', () => {
                hideContextMenu();
                onClick();
            });
            return item;
        };

        const createSeparator = () => {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            return sep;
        };

        if (isRowHeader) {
            const rowIdx = parseInt(target.dataset.row!, 10);
            contextMenu.appendChild(createMenuItem('Insert row above', () => {
                insertRowLocal(rowIdx);
                vscode.postMessage({ command: 'insertRow', rowIndex: rowIdx });
            }));
            contextMenu.appendChild(createMenuItem('Insert row below', () => {
                insertRowLocal(rowIdx + 1);
                vscode.postMessage({ command: 'insertRow', rowIndex: rowIdx + 1 });
            }));
            contextMenu.appendChild(createMenuItem('Delete row', () => {
                deleteRowLocal(rowIdx);
                vscode.postMessage({ command: 'deleteRow', rowIndex: rowIdx });
            }));
        }

        if (isRowHeader && isColHeader) {
            contextMenu.appendChild(createSeparator());
        }

        if (isColHeader) {
            const colIdx = parseInt(target.dataset.col!, 10);
            contextMenu.appendChild(createMenuItem('Insert column left', () => {
                insertColumnLocal(colIdx);
                vscode.postMessage({ command: 'insertColumn', colIndex: colIdx });
            }));
            contextMenu.appendChild(createMenuItem('Insert column right', () => {
                insertColumnLocal(colIdx + 1);
                vscode.postMessage({ command: 'insertColumn', colIndex: colIdx + 1 });
            }));
            contextMenu.appendChild(createMenuItem('Delete column', () => {
                deleteColumnLocal(colIdx);
                vscode.postMessage({ command: 'deleteColumn', colIndex: colIdx });
            }));
        }

        if (isCell) {
            const rowIdx = parseInt(target.dataset.row!, 10);
            const colIdx = parseInt(target.dataset.col!, 10);
            contextMenu.appendChild(createMenuItem('Insert row above', () => {
                insertRowLocal(rowIdx);
                vscode.postMessage({ command: 'insertRow', rowIndex: rowIdx });
            }));
            contextMenu.appendChild(createMenuItem('Insert row below', () => {
                insertRowLocal(rowIdx + 1);
                vscode.postMessage({ command: 'insertRow', rowIndex: rowIdx + 1 });
            }));
            contextMenu.appendChild(createMenuItem('Insert column left', () => {
                insertColumnLocal(colIdx);
                vscode.postMessage({ command: 'insertColumn', colIndex: colIdx });
            }));
            contextMenu.appendChild(createMenuItem('Insert column right', () => {
                insertColumnLocal(colIdx + 1);
                vscode.postMessage({ command: 'insertColumn', colIndex: colIdx + 1 });
            }));
            contextMenu.appendChild(createSeparator());
            contextMenu.appendChild(createMenuItem('Delete cell and shift left', () => {
                deleteCellShiftLeftLocal(rowIdx, colIdx);
                vscode.postMessage({ command: 'deleteCellShiftLeft', rowIndex: rowIdx, colIndex: colIdx });
            }));
            contextMenu.appendChild(createMenuItem('Delete cell and shift up', () => {
                deleteCellShiftUpLocal(rowIdx, colIdx);
                vscode.postMessage({ command: 'deleteCellShiftUp', rowIndex: rowIdx, colIndex: colIdx });
            }));
        }

        document.body.appendChild(contextMenu);
    }

    function deleteCellShiftLeftLocal(rowIdx: number, colIdx: number) {
        pushToUndo();
        const row = [...(rowCache.get(rowIdx) || new Array(columnCount).fill(''))];
        row.splice(colIdx, 1);
        row.push('');
        rowCache.set(rowIdx, row);
        updateVisibleRows(true);
        scheduleSave();
    }

    function deleteCellShiftUpLocal(rowIdx: number, colIdx: number) {
        pushToUndo();
        for (let i = rowIdx; i < totalRows - 1; i++) {
            const currentRow = [...(rowCache.get(i) || new Array(columnCount).fill(''))];
            const nextRow = rowCache.get(i + 1) || new Array(columnCount).fill('');
            currentRow[colIdx] = nextRow[colIdx];
            rowCache.set(i, currentRow);
        }
        const lastRow = [...(rowCache.get(totalRows - 1) || new Array(columnCount).fill(''))];
        lastRow[colIdx] = '';
        rowCache.set(totalRows - 1, lastRow);
        updateVisibleRows(true);
        scheduleSave();
    }

    function insertRowLocal(index: number) {
        pushToUndo();
        const newCache = new Map<number, string[]>();
        for (let i = 0; i < totalRows; i++) {
            if (i < index) newCache.set(i, rowCache.get(i) || []);
            else newCache.set(i + 1, rowCache.get(i) || []);
        }
        newCache.set(index, new Array(columnCount).fill(''));
        rowCache = newCache;
        totalRows++;
        updateVisibleRows(true);
        scheduleSave();
    }

    function deleteRowLocal(index: number) {
        pushToUndo();
        const newCache = new Map<number, string[]>();
        for (let i = 0; i < totalRows; i++) {
            if (i < index) newCache.set(i, rowCache.get(i) || []);
            else if (i > index) newCache.set(i - 1, rowCache.get(i) || []);
        }
        rowCache = newCache;
        totalRows--;
        updateVisibleRows(true);
        scheduleSave();
    }

    function insertColumnLocal(index: number) {
        pushToUndo();
        for (let i = 0; i < totalRows; i++) {
            const row = rowCache.get(i) || new Array(columnCount).fill('');
            row.splice(index, 0, '');
            rowCache.set(i, row);
        }
        columnCount++;
        updateHeadersLocal(); updateVisibleRows(true);
        scheduleSave();
    }

    function deleteColumnLocal(index: number) {
        pushToUndo();
        for (let i = 0; i < totalRows; i++) {
            const row = rowCache.get(i) || new Array(columnCount).fill('');
            row.splice(index, 1);
            rowCache.set(i, row);
        }
        columnCount--;
        updateHeadersLocal(); updateVisibleRows(true);
        scheduleSave();
    }

    function updateHeadersLocal() {
        const thead = document.querySelector('#csv-table thead');
        if (thead) {
            let headerHtml = '<tr><th class="row-header">&nbsp;</th>';
            for (let i = 1; i <= columnCount; i++) {
                let label = '';
                let n = i;
                while (n > 0) {
                    const rem = (n - 1) % 26;
                    label = String.fromCharCode(65 + rem) + label;
                    n = Math.floor((n - 1) / 26);
                }
                headerHtml += `<th class="col-header" data-col="${i - 1}">${label}</th>`;
            }
            headerHtml += '</tr>';
            thead.innerHTML = headerHtml;
        }
    }

    // ===== Copy =====

    let isCopying = false;
    let copyOperationTimeout: any = null;

    function resetCopyState() {
        isCopying = false;
        if (copyOperationTimeout) {
            clearTimeout(copyOperationTimeout);
            copyOperationTimeout = null;
        }
    }

    async function copySelectionToClipboard() {
        // Prevent duplicate operations but with a safety check
        if (isCopying) {
            console.warn('Copy operation already in progress');
            return;
        }

        const hasFullColumnSelection = selectedColumnIndices.size > 0;
        const hasFullRowSelection = selectedRowIndices.size > 0;

        if (!hasFullColumnSelection && !hasFullRowSelection && selectedCells.size === 0) {
            return;
        }

        isCopying = true;

        // Safety timeout - reset state after 60 seconds max to prevent permanent lock
        copyOperationTimeout = setTimeout(() => {
            if (isCopying) {
                console.warn('Copy operation timed out, resetting state');
                resetCopyState();
                showToast('Copy timed out');
            }
        }, 60000);

        try {
            showToast('Copying...');

            let outputLines: string[] = [];

            if (hasFullColumnSelection || hasFullRowSelection) {
                // Need to fetch all rows for complete copy
                const allRows = await requestAllRows();

                // Validate we got data back - don't corrupt cache with empty data
                if (!allRows || allRows.length === 0) {
                    showToast('Failed to fetch data');
                    return;
                }

                // Only cache if we got the expected amount of data
                if (allRows.length >= totalRows * 0.9) { // Allow some tolerance
                    allRows.forEach((row, i) => {
                        rowCache.set(i, row);
                    });
                }

                const rowCount = allRows.length;

                if (hasFullColumnSelection && !hasFullRowSelection) {
                    // Copy entire columns
                    const sortedCols = Array.from(selectedColumnIndices).sort((a, b) => a - b);

                    for (let r = 0; r < rowCount; r++) {
                        const rowData = allRows[r] || [];
                        const lineParts = sortedCols.map(c => rowData[c] || '');
                        outputLines.push(lineParts.join('\t'));
                    }
                } else if (hasFullRowSelection && !hasFullColumnSelection) {
                    // Copy entire rows
                    const sortedRows = Array.from(selectedRowIndices).sort((a, b) => a - b);

                    for (const r of sortedRows) {
                        if (r < rowCount) {
                            const rowData = allRows[r] || [];
                            const lineParts: string[] = [];
                            for (let c = 0; c < columnCount; c++) {
                                lineParts.push(rowData[c] || '');
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
                            const rowData = allRows[r] || [];
                            const lineParts = sortedCols.map(c => rowData[c] || '');
                            outputLines.push(lineParts.join('\t'));
                        }
                    }
                }

                const cellCount = hasFullColumnSelection ?
                    rowCount * selectedColumnIndices.size :
                    (hasFullRowSelection ? selectedRowIndices.size * columnCount : 0);

                const tsv = outputLines.join('\n');
                
                vscode.postMessage({ command: 'copy', text: tsv });

                // Flash visible selected cells
                selectedCells.forEach(cell => cell.classList.add('copying'));
                setTimeout(() => {
                    selectedCells.forEach(cell => cell.classList.remove('copying'));
                }, 300);

                showToast('Copied ' + cellCount + ' cells');
            } else {
                // Regular cell selection - use cached data
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
                    const rowData = rowCache.get(r) || [];
                    const lineParts = sortedCols.map(c => rowData[c] || '');
                    outputLines.push(lineParts.join('\t'));
                }

                const tsv = outputLines.join('\n');
                
                vscode.postMessage({ command: 'copy', text: tsv });

                selectedCells.forEach(cell => cell.classList.add('copying'));
                setTimeout(() => {
                    selectedCells.forEach(cell => cell.classList.remove('copying'));
                }, 300);

                showToast('Copied ' + cellsArray.length + ' cells');
            }
        } catch (err) {
            console.error('Copy operation failed:', err);
            showToast('Copy failed');
        } finally {
            resetCopyState();
        }
    }



    // ===== UI Helpers =====



    function adjustColumnWidths(mode: 'expand' | 'default') {
        try {
            const table = $('csv-table');
            if (!table) return;
            const colGroup = table.querySelector('colgroup');
            if (!colGroup) return;

            const headerCells = table.querySelectorAll('th.col-header');
            if (headerCells.length === 0) return;

            table.style.tableLayout = 'auto';
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.font = '13px "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

            const visibleRows = table.querySelectorAll('tbody tr:not(.virtual-spacer)');
            const limit = Math.min(visibleRows.length, 50);

            // Measure first (row header) column so it can grow to fit content (min 30px)
            let firstColMax = 30;
            for (let r = 0; r < limit; r++) {
                const row = visibleRows[r];
                const cell = row && row.children && row.children[0];
                if (cell) {
                    const width = ctx.measureText(cell.textContent!.trim()).width + 24; // include padding
                    if (width > firstColMax) firstColMax = width;
                }
            }

            let colGroupHtml = `<col style="width: ${firstColMax}px;">`;
            headerCells.forEach((th, index) => {
                let maxWidth = ctx.measureText(th.textContent!.trim()).width + 32;
                for (let r = 0; r < limit; r++) {
                    const row = visibleRows[r];
                    const cell = row.children[index + 1];
                    if (cell) {
                        const width = ctx.measureText(cell.textContent!.trim()).width + 32;
                        if (width > maxWidth) maxWidth = width;
                    }
                }
                const finalWidth = mode === 'expand' ? maxWidth : Math.min(maxWidth, 200);
                colGroupHtml += `<col style="width: ${finalWidth}px;">`;
            });

            colGroup.innerHTML = colGroupHtml;
            table.style.tableLayout = 'fixed';
            /* Keep table intrinsic so it doesn't expand to fill the viewport */
            table.style.width = 'max-content';
        } catch (e) {
            console.error('Error adjusting columns:', e);
        }
    }

    // ===== Toolbar Scroll Sync =====

    function syncToolbarScroll() {
        const area = $('buttonScrollArea');
        const bar = $('buttonScrollbar');
        const inner = $('scrollInner');
        if (!area || !bar || !inner) return;

        inner.style.width = area.scrollWidth + 'px';
        bar.scrollLeft = area.scrollLeft;

        if (!(area as any)._scrollWire) {
            let syncing = false;
            area.addEventListener('scroll', () => {
                if (syncing) return;
                syncing = true;
                bar.scrollLeft = area.scrollLeft;
                setTimeout(() => (syncing = false), 20);
            });
            bar.addEventListener('scroll', () => {
                if (syncing) return;
                syncing = true;
                area.scrollLeft = bar.scrollLeft;
                setTimeout(() => (syncing = false), 20);
            });
            (area as any)._scrollWire = true;
        }
    }

    // ===== Settings =====

    function applySettings(settings: Settings | null, saveLocal = false) {
        currentSettings = settings || {} as Settings;
        if (!settings) return;

        if (!settings.firstRowIsHeader) {
            settings.stickyHeader = false;
        }

        document.body.classList.toggle('first-row-as-header', !!settings.firstRowIsHeader);
        document.body.classList.toggle('sticky-header-enabled', !!settings.stickyHeader);
        document.body.classList.toggle('sticky-toolbar-enabled', !!settings.stickyToolbar);

        const chkHeader = $('chkHeaderRow') as HTMLInputElement;
        const chkSticky = $('chkStickyHeader') as HTMLInputElement;
        const chkToolbar = $('chkStickyToolbar') as HTMLInputElement;
        const chkSpacious = $('chkSpaciousCells') as HTMLInputElement;

        if (chkHeader) chkHeader.checked = !!settings.firstRowIsHeader;
        if (chkSticky) { chkSticky.checked = !!settings.stickyHeader; chkSticky.disabled = !settings.firstRowIsHeader; if (chkSticky.parentElement) { chkSticky.parentElement.style.opacity = !settings.firstRowIsHeader ? '0.5' : '1'; chkSticky.parentElement.style.pointerEvents = !settings.firstRowIsHeader ? 'none' : 'auto'; } }
        if (chkToolbar) chkToolbar.checked = !!settings.stickyToolbar;
        if (chkSpacious) chkSpacious.checked = !!settings.spaciousCells;
        if (chkSpacious) chkSpacious.checked = !!settings.spaciousCells;

        // Show/hide enable button based on whether this is the default editor
        if (toolbarManager) {
            toolbarManager.setButtonVisibility('enableAsDefaultButton', settings.isDefaultEditor === false);
        }

        // Bold first row when firstRowIsHeader is enabled
        const table = $('csv-table');
        if (table) {
            const firstRow = table.querySelector('tbody tr:not(.virtual-spacer)');
            if (firstRow) {
                if (settings.firstRowIsHeader) {
                    firstRow.classList.add('header-row');
                } else {
                    firstRow.classList.remove('header-row');
                }
            }
        }

        let rowHeightChanged = false;
        if (settings.spaciousCells) {
            document.body.classList.add('spacious-cells');
            if (ROW_HEIGHT !== 25) {
                ROW_HEIGHT = 25; // Approx height for spacious cells
                rowHeightChanged = true;
            }
        } else {
            document.body.classList.remove('spacious-cells');
            if (ROW_HEIGHT !== VirtualScrollConfig.ROW_HEIGHT) {
                ROW_HEIGHT = VirtualScrollConfig.ROW_HEIGHT;
                rowHeightChanged = true;
            }
        }

        // Update toolbar stickiness
        if (toolbarManager) {
            toolbarManager.applyStickyLayout(!!settings.stickyToolbar, 'content', '.table-scroll');
        }

        if (rowHeightChanged) {
            // Force re-render of virtual rows
            currentVisibleStart = -1;
            currentVisibleEnd = -1;
            updateVisibleRows();
        }

        if (chkSticky) chkSticky.disabled = !chkHeader?.checked;

        if (saveLocal) {
            vscode.postMessage({ command: 'updateSettings', settings });
        }
    }

    function wireSettingsUI() {
        const settings = [
            {
                id: 'chkHeaderRow',
                label: 'Header Row',
                onChange: (val: boolean) => {
                    const chkSticky = document.getElementById('chkStickyHeader') as HTMLInputElement;
                    if (chkSticky) {
                        chkSticky.disabled = !val;
                        if (!val) {
                            chkSticky.checked = false;
                            currentSettings.stickyHeader = false;
                        }
                    }
                    currentSettings.firstRowIsHeader = val;
                    applySettings(currentSettings, true);
                },
                defaultValue: currentSettings.firstRowIsHeader
            },
            {
                id: 'chkStickyHeader',
                label: 'Sticky Header',
                onChange: (val: boolean) => {
                    currentSettings.stickyHeader = val;
                    applySettings(currentSettings, true);
                },
                defaultValue: currentSettings.stickyHeader
            },
            {
                id: 'chkStickyToolbar',
                label: 'Sticky Toolbar',
                onChange: (val: boolean) => {
                    currentSettings.stickyToolbar = val;
                    applySettings(currentSettings, true);
                },
                defaultValue: currentSettings.stickyToolbar
            },
            {
                id: 'chkSpaciousCells',
                label: 'Spacious Cells',
                onChange: (val: boolean) => {
                    currentSettings.spaciousCells = val;
                    applySettings(currentSettings, true);
                },
                defaultValue: currentSettings.spaciousCells
            }
        ];

        SettingsManager.renderPanel(document.getElementById('toolbar')!, 'settingsPanel', 'settingsCancelButton', settings);

        new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settings, () => {
            updateHeaderHeight();
        });
    }

    function updateHeaderHeight() {
        if (toolbarManager) {
            toolbarManager.updateHeaderHeight();
        }
    }

    // ===== Event Handlers =====

    function initializeSelection() {
        const table = $('csv-table');
        if (!table || table.dataset.listenersAdded === 'true') return;
        table.dataset.listenersAdded = 'true';

        table.addEventListener('focusout', (e) => {
            if (isCellEditing && e.target === editingCell) {
                stopEditing();
            }
        });

        table.addEventListener('dblclick', (e) => {
            const target = (e.target as HTMLElement).closest('td') as HTMLElement;
            if (target) {
                startEditing(target);
            }
        });

        table.addEventListener('contextmenu', (e) => {
            const target = (e.target as HTMLElement).closest('td, th') as HTMLElement;
            if (target) {
                showContextMenu(e, target);
            }
        });

        table.addEventListener('mousedown', (e) => {
            if (e.button === 2) return; // Right click handled by contextmenu
            hideContextMenu();
            
            const target = (e.target as HTMLElement).closest('td, th') as HTMLElement;
            if (!target) return;

            if (isCellEditing && target !== editingCell) {
                stopEditing();
            }

            if (target === editingCell) return;

            const isHeaderInteraction =
                target.classList.contains('col-header') ||
                target.classList.contains('row-header');

            e.preventDefault();

            if (target.classList.contains('col-header')) {
                const colIdx = parseInt(target.dataset.col!, 10);
                if (!e.shiftKey) lastSelectedColumn = colIdx;
                selectColumn(colIdx, e.ctrlKey || e.metaKey, e.shiftKey);
                return;
            }
            if (target.classList.contains('row-header')) {
                const rowIdx = parseInt(target.dataset.row!, 10);
                if (!e.shiftKey) lastSelectedRow = rowIdx;
                selectRow(rowIdx, e.ctrlKey || e.metaKey, e.shiftKey);
                return;
            }
            if (target.tagName === 'TD') {
                const coords = getCellCoordinates(target);
                if (!coords) return;

                // Clear column/row selection when selecting individual cells
                selectedColumnIndices.clear();
                selectedRowIndices.clear();

                if (e.ctrlKey || e.metaKey) {
                    e.stopPropagation();
                    if (target.classList.contains('selected')) {
                        target.classList.remove('selected');
                        selectedCells.delete(target);
                        if (target === activeCell) activeCell = null;
                    } else {
                        target.classList.add('selected');
                        selectedCells.add(target);
                        if (activeCell) activeCell.classList.remove('active-cell');
                        target.classList.add('active-cell');
                        activeCell = target;
                        startCell = coords;
                    }
                } else if (e.shiftKey && startCell) {
                    e.stopPropagation();
                    selectCellsInRange(startCell, coords);
                } else {
                    clearSelection();
                    isSelecting = true;
                    startCell = coords;
                    endCell = coords;
                    target.classList.add('selected', 'active-cell');
                    selectedCells.add(target);
                    activeCell = target;

                    const thRow = document.querySelector(`th.row-header[data-row="${coords.row}"]`) as HTMLElement;
                    if (thRow) thRow.classList.add('row-selected');
                    const thCol = document.querySelector(`th.col-header[data-col="${coords.col}"]`) as HTMLElement;
                    if (thCol) thCol.classList.add('column-selected');
                }
                updateSelectionInfo();
            }
        });

        const focusWebviewSurface = () => {
            const container = $('tableContainer') as HTMLElement | null;
            if (!container) return;
            if (!container.hasAttribute('tabindex')) {
                container.setAttribute('tabindex', '-1');
            }
            container.focus({ preventScroll: true });
        };

        document.addEventListener('pointerdown', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            if (target.closest('#csv-table') || target.closest('#tableContainer') || target.closest('.toolbar')) {
                focusWebviewSurface();
            }
        }, true);

        table.addEventListener('mousemove', (e) => {
            if (isCellEditing || !isSelecting || !startCell) return;
            const target = (e.target as HTMLElement).closest('td') as HTMLElement;
            if (!target) return;
            const coords = getCellCoordinates(target);
            if (!coords || (endCell && coords.row === endCell.row && coords.col === endCell.col)) return;
            endCell = coords;
            selectCellsInRange(startCell, endCell);
        });

        document.addEventListener('mouseup', () => { isSelecting = false; });

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

            if (isCmdOrCtrl) {
                if (e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    if (isCellEditing) stopEditing();
                    if (e.shiftKey) redo();
                    else undo();
                    return;
                }
                if (e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    if (isCellEditing) stopEditing();
                    redo();
                    return;
                }
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
                e.preventDefault();
                performSave(false);
                return;
            }

            if (isCmdOrCtrl && isCellEditing) {
                // Allow native browser text string copy/select inside contenteditable
                return;
            }

            if (isCellEditing) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    stopEditing();
                    const coords = getCellCoordinates(editingCell || activeCell);
                    if (coords) {
                        const nextCell = document.querySelector(
                            `td[data-row="${coords.row + 1}"][data-col="${coords.col}"]`
                        ) as HTMLElement;
                        if (nextCell) {
                            clearSelection();
                            nextCell.classList.add('selected', 'active-cell');
                            selectedCells.add(nextCell);
                            activeCell = nextCell;
                            startCell = { row: coords.row + 1, col: coords.col };
                        }
                    }
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    stopEditing();
                    const coords = getCellCoordinates(editingCell || activeCell);
                    if (coords) {
                        const nextCell = document.querySelector(
                            `td[data-row="${coords.row}"][data-col="${coords.col + 1}"]`
                        ) as HTMLElement;
                        if (nextCell) {
                            clearSelection();
                            nextCell.classList.add('selected', 'active-cell');
                            selectedCells.add(nextCell);
                            activeCell = nextCell;
                            startCell = { row: coords.row, col: coords.col + 1 };
                        }
                    }
                }
                return;
            }

            if (activeCell && !isCmdOrCtrl && e.key.length === 1 && !e.altKey) {
                startEditing(activeCell, true);
                return;
            }

            if (activeCell && e.key === 'Enter') {
                e.preventDefault();
                startEditing(activeCell);
                return;
            }

            if (activeCell && (e.key === 'Backspace' || e.key === 'Delete')) {
                e.preventDefault();
                pushToUndo();
                selectedCells.forEach(cell => {
                    const row = parseInt(cell.dataset.row!, 10);
                    const col = parseInt(cell.dataset.col!, 10);
                    let rowData = rowCache.get(row);
                    if (!rowData) {
                        rowData = [];
                        rowCache.set(row, rowData);
                    }
                    rowData[col] = '';
                    cell.textContent = '';
                    vscode.postMessage({ command: 'updateRow', rowIndex: row, rowData });
                });
                scheduleSave();
                return;
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                copySelectionToClipboard();
            } else if (isCmdOrCtrl && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                pasteFromClipboard();
            } else if (isCmdOrCtrl && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                clearSelection();

                // Select all - mark all columns as selected
                for (let c = 0; c < columnCount; c++) {
                    selectedColumnIndices.add(c);
                }

                const all = document.querySelectorAll('td[data-row][data-col]');
                all.forEach(c => {
                    c.classList.add('selected');
                    selectedCells.add(c as HTMLElement);
                });
                if (all[0]) {
                    all[0].classList.add('active-cell');
                    activeCell = all[0] as HTMLElement;
                    startCell = getCellCoordinates(all[0] as HTMLElement);
                }
                updateSelectionInfo();
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key) && activeCell) {
                const coords = getCellCoordinates(activeCell);
                if (!coords) return;
                let nr = coords.row, nc = coords.col;
                if (e.key === 'ArrowUp' && nr > 0) nr--;
                else if (e.key === 'ArrowDown') nr++;
                else if (e.key === 'ArrowLeft' && nc > 0) nc--;
                else if (e.key === 'ArrowRight' || e.key === 'Tab') nc++;

                const next = document.querySelector(`td[data-row="${nr}"][data-col="${nc}"]`) as HTMLElement;
                if (next) {
                    e.preventDefault();
                    if (e.shiftKey && e.key !== 'Tab') {
                        selectCellsInRange(startCell || coords, { row: nr, col: nc });
                    } else {
                        clearSelection();
                        next.classList.add('selected', 'active-cell');
                        selectedCells.add(next);
                        activeCell = next;
                        startCell = { row: nr, col: nc };
                        
                        const thRow = document.querySelector(`th.row-header[data-row="${nr}"]`) as HTMLElement;
                        if (thRow) thRow.classList.add('row-selected');
                        const thCol = document.querySelector(`th.col-header[data-col="${nc}"]`) as HTMLElement;
                        if (thCol) thCol.classList.add('column-selected');
                        
                        // Scroll into view if needed
                        const container = $('tableContainer');
                        if (container) {
                            const rect = next.getBoundingClientRect();
                            const containerRect = container.getBoundingClientRect();
                            if (rect.bottom > containerRect.bottom) container.scrollTop += rect.bottom - containerRect.bottom + 20;
                            if (rect.top < containerRect.top) container.scrollTop -= containerRect.top - rect.top + 20;
                            if (rect.right > containerRect.right) container.scrollLeft += rect.right - containerRect.right + 20;
                            if (rect.left < containerRect.left) container.scrollLeft -= containerRect.left - rect.left + 20;
                        }
                    }
                    updateSelectionInfo();
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!(e.target as HTMLElement).closest('#csv-table') && !(e.target as HTMLElement).closest('.toolbar') && !(e.target as HTMLElement).closest('.context-menu')) {
                clearSelection();
                hideContextMenu();
            }
        });
    }

    async function pasteFromClipboard() {
        if (!activeCell) return;
        
        try {
            // Try navigator.clipboard first
            if (navigator.clipboard && navigator.clipboard.readText) {
                const text = await navigator.clipboard.readText();
                if (text) {
                    handlePasteData(text);
                    return;
                }
            }
        } catch (err) {
            console.warn('navigator.clipboard failed, falling back to vscode clipboard', err);
        }
        
        // Fallback to vscode clipboard
        vscode.postMessage({ command: 'readClipboard' });
    }

    function handlePasteData(text: string) {
        if (!activeCell || !text) return;
        pushToUndo();
        try {
            const rows = text.split(/\r?\n/);
            // Remove last empty row if it exists (common when copying from Excel/Sheets)
            if (rows.length > 0 && rows[rows.length - 1] === '') {
                rows.pop();
            }

            const startCoords = getCellCoordinates(activeCell);
            if (!startCoords) return;

            let maxRow = startCoords.row;
            let maxCol = startCoords.col;

            for (let r = 0; r < rows.length; r++) {
                const cols = rows[r].split('\t');
                const targetRow = startCoords.row + r;
                
                if (targetRow >= totalRows) {
                    // Need to insert a new row
                    insertRowLocal(totalRows);
                }
                
                let rowData = rowCache.get(targetRow);
                if (!rowData) {
                    rowData = new Array(columnCount).fill('');
                    rowCache.set(targetRow, rowData);
                }

                for (let c = 0; c < cols.length; c++) {
                    const targetCol = startCoords.col + c;
                    
                    if (targetCol >= columnCount) {
                        // Need to insert a new column
                        insertColumnLocal(columnCount);
                        rowData = rowCache.get(targetRow) || new Array(columnCount).fill(''); // Re-fetch as it might be recreated
                    }
                    
                    rowData[targetCol] = cols[c];
                    maxCol = Math.max(maxCol, targetCol);
                    
                    // Update DOM if cell is visible
                    const cell = document.querySelector(`td[data-row="${targetRow}"][data-col="${targetCol}"]`) as HTMLElement;
                    if (cell) {
                        cell.textContent = cols[c] === '' ? '\u00a0' : cols[c];
                    }
                }
                
                maxRow = Math.max(maxRow, targetRow);
                vscode.postMessage({ command: 'updateRow', rowIndex: targetRow, rowData });
            }

            scheduleSave();
            // Select the pasted area
            clearSelection();
            const endCoords = { row: maxRow, col: maxCol };
            selectCellsInRange(startCoords, endCoords);
            
            const startCellEl = document.querySelector(`td[data-row="${startCoords.row}"][data-col="${startCoords.col}"]`) as HTMLElement;
            if (startCellEl) {
                activeCell = startCellEl;
                startCellEl.classList.add('active-cell');
            }
            
            showToast(`Pasted ${rows.length} rows`);

        } catch (err) {
            console.error('Failed to read clipboard contents: ', err);
            showToast('Paste failed: ' + String(err));
        }
    }

    // ===== Resizing Logic =====
    let isResizing = false;
    let currentResizer: HTMLElement | null = null;
    let startX = 0;
    let startWidth = 0;
    let resizeColIndex = -1;

    document.addEventListener('mousedown', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('col-resize-handle')) {
            isResizing = true;
            currentResizer = target;
            const th = target.closest('th');
            if (th) {
                resizeColIndex = parseInt(th.getAttribute('data-col') || '-1', 10);
                const colgroup = document.querySelector('#csv-table colgroup');
                if (colgroup && resizeColIndex >= 0) {
                    const col = colgroup.children[resizeColIndex + 1] as HTMLElement; // +1 because of row-header
                    if (col) {
                        startX = e.pageX;
                        startWidth = col.offsetWidth || 150;
                        target.classList.add('resizing');
                        e.preventDefault();
                    }
                }
            }
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing || !currentResizer || resizeColIndex < 0) return;
        
        const dx = e.pageX - startX;
        const newWidth = Math.max(40, startWidth + dx); // Min width 40px
        
        const colgroup = document.querySelector('#csv-table colgroup');
        if (colgroup) {
            const col = colgroup.children[resizeColIndex + 1] as HTMLElement;
            if (col) {
                col.style.width = `${newWidth}px`;
                col.style.maxWidth = 'none'; // Remove max-width constraint when manually resizing
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            if (currentResizer) {
                currentResizer.classList.remove('resizing');
                currentResizer = null;
            }
            resizeColIndex = -1;
            updateHeaderHeight();
        }
    });

    // ===== Message Handler =====

    window.addEventListener('message', (event) => {
        const m = event.data;

        switch (m.command) {
            case 'initVirtualTable':
                const loading = $('loadingIndicator');
                if (loading) loading.style.display = 'none';

                // Set current format (csv or tsv)
                fileFormat = m.format || 'csv';

                totalRows = m.totalRows || 0;
                columnCount = m.columnCount || 0;

                const thead = document.querySelector('#csv-table thead');
                if (thead) thead.innerHTML = m.headerHtml || '';

                const table = $('csv-table');
                if (table) {
                    const colgroup = table.querySelector('colgroup');
                    if (colgroup) {
                        let colHtml = '<col style="width: 30px;">';
                        for (let i = 0; i < columnCount; i++) {
                            colHtml += '<col style="width: 150px;">';
                        }
                        colgroup.innerHTML = colHtml;
                    }
                }

                rowCache.clear();

                initializeVirtualScrolling();
                initializeSelection();

                setTimeout(() => {
                    adjustColumnWidths('default');
                    syncToolbarScroll();
                    applySettings(currentSettings, false);
                    setVersionPreviewMode(false);
                }, 200);
                break;

            case 'previewVersion':
            case 'versionRestored':
            case 'versionPreviewCancelled':
            case 'applyUndoRedoState':
                const shouldPreserveScroll = m.command === 'applyUndoRedoState' && m.hasStructuralChange === false;
                const stateContainer = getTableContainer();
                const prevScrollTop = stateContainer?.scrollTop ?? 0;
                const prevScrollLeft = stateContainer?.scrollLeft ?? 0;

                fileFormat = m.format || fileFormat;
                totalRows = m.totalRows || 0;
                columnCount = m.columnCount || 0;

                if (!shouldPreserveScroll) {
                    const stateHead = document.querySelector('#csv-table thead');
                    if (stateHead) stateHead.innerHTML = m.headerHtml || '';

                    const stateTable = $('csv-table');
                    if (stateTable) {
                        const stateColgroup = stateTable.querySelector('colgroup');
                        if (stateColgroup) {
                            let colHtml = '<col style="width: 30px;">';
                            for (let i = 0; i < columnCount; i++) {
                                colHtml += '<col style="width: 150px;">';
                            }
                            stateColgroup.innerHTML = colHtml;
                        }
                    }
                }

                rowCache.clear();
                if (Array.isArray(m.rows)) {
                    m.rows.forEach((row: string[], i: number) => {
                        rowCache.set(i, [...row]);
                    });
                }

                updateVisibleRows(true);

                if (shouldPreserveScroll && stateContainer) {
                    stateContainer.scrollTop = prevScrollTop;
                    stateContainer.scrollLeft = prevScrollLeft;
                    updateVisibleRows(true);
                }

                if (m.command === 'previewVersion') {
                    previewVersionId = m.versionId || null;
                    const previewLabel = m.timestamp
                        ? `Previewing ${new Date(m.timestamp).toLocaleString()} (read-only)`
                        : 'Previewing selected version (read-only)';
                    setVersionPreviewMode(true, previewLabel);
                } else {
                    setVersionPreviewMode(false);
                }

                if (m.command === 'versionRestored') {
                    showToast('Version restored');
                }

                if (m.command === 'versionPreviewCancelled') {
                    showToast('Preview canceled');
                }

                if (m.command === 'applyUndoRedoState') {
                    focusAndHighlightCell(m.focusCell || null, { preserveScroll: shouldPreserveScroll });
                    scheduleSave();
                }
                break;

            case 'rowsData':
                virtualLoader.resolveRequest(m.requestId, m.rows || []);
                break;

            case 'initSettings':
            case 'settingsUpdated':
                applySettings(m.settings, false);
                setTimeout(syncToolbarScroll, 20);
                break;

            case 'saveResult':
                isSaving = false;
                setButtonsEnabled(true);
                if (m.ok) {
                    showToast('Saved', m.isAutosave);
                    (window as any)._originalCacheSnapshot = null;
                    captureOriginalCellValues();
                } else {
                    showToast('Error saving', m.isAutosave);
                }
                break;

            case 'clipboardData':
                if (m.text) {
                    handlePasteData(m.text);
                }
                break;

            case 'versionHistoryError':
                showToast(m.message || 'Version history failed');
                break;
        }

        // Handle theme messages
        if (m.type === 'setTheme') {
            // Theme manager will handle this
        }
    });

    // ===== Button Handlers =====

    function wireButtons() {
        toolbarManager = new ToolbarManager('toolbar');
        
        toolbarManager.setButtons([
            {
                id: 'toggleViewButton',
                icon: Icons.EditFile,
                label: 'Edit File',
                tooltip: 'Edit File in Vscode Default Editor',
                onClick: () => {
                    isTableView = !isTableView;
                    vscode.postMessage({ command: 'toggleView', isTableView });
                }
            },
            {
                id: 'toggleExpandButton',
                icon: Icons.Expand,
                label: 'Expand',
                tooltip: 'Toggle Column Widths (Default / Expand All)',
                cls: 'edit-mode-hide',
                onClick: () => {
                    const btn = $('toggleExpandButton');
                    const state = btn?.getAttribute('data-state') || 'default';
                    if (state === 'default') {
                        btn?.setAttribute('data-state', 'expanded');
                        document.body.classList.add('expanded-mode');
                        if(btn) btn.innerHTML = Icons.Collapse + ' <span class="btn-label">Default</span>';
                        adjustColumnWidths('expand');
                    } else {
                        btn?.setAttribute('data-state', 'default');
                        document.body.classList.remove('expanded-mode');
                        if(btn) btn.innerHTML = Icons.Expand + ' <span class="btn-label">Expand</span>';
                        adjustColumnWidths('default');
                    }
                }
            },
            {
                id: 'openSettingsButton',
                icon: Icons.Settings,
                tooltip: 'CSV Settings',
                cls: 'icon-only',
                onClick: () => {}
            },
            {
                id: 'toggleBackgroundButton',
                icon: Icons.ThemeLight + Icons.ThemeDark + Icons.ThemeVSCode,
                tooltip: 'Toggle Theme',
                cls: 'edit-mode-hide',
                onClick: () => {}
            },
            {
                id: 'versionHistoryButton',
                icon: Icons.VersionHistory,
                tooltip: 'Version history',
                cls: 'edit-mode-hide icon-only',
                onClick: () => {
                    vscode.postMessage({ command: 'showVersionHistory' });
                }
            },
            {
                id: 'helpButton',
                icon: Icons.Help,
                tooltip: 'Help & Feedback',
                cls: 'icon-only',
                onClick: () => {
                    vscode.postMessage({
                        command: 'openExternal',
                        url: 'https://docs.google.com/forms/d/e/1FAIpQLSe5AqE_f1-WqUlQmvuPn1as3Mkn4oLjA0EDhNssetzt63ONzA/viewform'
                    });
                }
            },
            {
                id: 'convertFileButton',
                icon: Icons.Convert,
                label: 'Convert',
                tooltip: `Convert this ${fileFormat.toUpperCase()} file`,
                cls: 'edit-mode-hide',
                onClick: () => {
                    vscode.postMessage({ command: 'convertFile' });
                }
            },
            {
                id: 'enableAsDefaultButton',
                icon: Icons.Zap,
                label: 'Set as Default',
                tooltip: `Make XLSX Viewer the default editor for ${fileFormat.toUpperCase()} files`,
                cls: 'edit-mode-hide',
                hidden: true,
                onClick: () => {
                    vscode.postMessage({ command: 'enableAsDefault' });
                }
            }
        ]);

        // Inject tooltip if variables are present
        InfoTooltip.inject('toolbar', (window as any).viewImgUri, (window as any).logoSvgUri, 'table view');

        // Theme manager
        if (typeof ThemeManager !== 'undefined') {
            new ThemeManager('toggleBackgroundButton', {
                onBeforeCycle: () => !isCellEditing
            }, vscode);
        }
    }

    // ===== Initialize =====

    wireButtons();
    wireSettingsUI();
    updateHeaderHeight();
    window.addEventListener('resize', updateHeaderHeight);
    vscode.postMessage({ command: 'webviewReady' });
})();