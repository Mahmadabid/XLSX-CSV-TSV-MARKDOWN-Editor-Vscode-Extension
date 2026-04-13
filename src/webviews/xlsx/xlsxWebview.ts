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
import {
    BorderLineStyle,
    BorderThickness,
    BorderPattern,
    BorderMode,
    buildBorderCss as buildBorderCssValue,
    composeBorderLineStyle,
    decomposeBorderLineStyle,
    inferBorderLineStyleFromCss,
    inferBorderModeFromStyle,
    getActiveBorderModes
} from './components/xlsxBorderComponent';
import type {
    StructuralOpType,
    WorksheetOpType,
    HorizontalAlign,
    VerticalAlign,
    WrapMode,
    StructuralOp,
    BorderStyleEdit,
    WorksheetOp,
    CellStyleEdit,
    CellUndoState,
    EditUndoEntry,
    WorksheetStateSnapshot
} from './components/xlsxTypes';
import {
    cloneCellData,
    getCellFromRow,
    setCellOnRow,
    normalizeRowsAfterStructureChange,
    cloneWorksheetOps
} from './components/xlsxSheetDataComponent';
import {
    normalizeColorToHex,
    getCellRichRuns,
    hasRunFormatting
} from './components/xlsxRichTextComponent';
import { XlsxFindManager } from './components/xlsxFindComponent';
import { copySelectionToClipboard as copySelectionToClipboardHelper, writeToClipboardAsync } from './components/xlsxCopyComponent';

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
    let pendingEditCell: HTMLElement | null = null;
    let pendingEditDrag = false;
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
    let isCellEditing = false;
    let lastEditRange: Range | null = null;
    let lastFocusedEditableCell: HTMLElement | null = null;

    let pendingWorksheetOps: WorksheetOp[] = [];
    const pendingCellStyleEdits = new Map<string, CellStyleEdit>();
    let headerContextMenuEl: HTMLElement | null = null;
    let colorPaletteEl: HTMLElement | null = null;
    let activeColorTarget: 'text' | 'background' | 'border' | null = null;
    let selectedTextColor = '#202124';
    let selectedBgColor = '#ffffff';
    let selectedBorderColor = '#202124';
    let selectedBorderLineStyle: BorderLineStyle = 'thin';
    let selectedBorderThickness: BorderThickness = 'thin';
    let selectedBorderPattern: BorderPattern = 'solid';
    let selectedBorderMode: BorderMode = 'all';
    let editFormattingStripEl: HTMLElement | null = null;
    let borderPopupEl: HTMLElement | null = null;
    let mergeWarningPopupEl: HTMLElement | null = null;
    let mergeWarningResolver: ((confirmed: boolean) => void) | null = null;
    let formatPainterStyle: Partial<CellStyleEdit> | null = null;
    let formatPainterArmed = false;
    let formatPainterExecuting = false;
    const MERGE_WARNING_SUPPRESS_UNTIL_KEY = 'xlsx.mergeWarningSuppressUntil';

    const editUndoStack: EditUndoEntry[] = [];
    const editRedoStack: EditUndoEntry[] = [];

    let findManager: XlsxFindManager | null = null;

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

    function updateColorPreview(target: 'text' | 'background' | 'border', color: string) {
        const ids = target === 'text'
            ? ['formatTextColorButton', 'stripTextColorButton']
            : target === 'background'
                ? ['formatBackgroundColorButton', 'stripBgColorButton']
                : ['stripBorderColorButton'];
        ids.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.style.setProperty('--format-color-preview', color);
        });
    }

    function buildBorderCss(enabled: boolean, style?: BorderLineStyle, color?: string) {
        if (!enabled) return '';
        const nextStyle = style || selectedBorderLineStyle;
        const nextColor = color || selectedBorderColor;
        return buildBorderCssValue(true, nextStyle, nextColor);
    }

    function syncBorderStyleFromControls() {
        selectedBorderLineStyle = composeBorderLineStyle(selectedBorderThickness, selectedBorderPattern);
    }

    function syncBorderControlsFromStyle(style: BorderLineStyle) {
        const decomposed = decomposeBorderLineStyle(style);
        selectedBorderThickness = decomposed.thickness;
        selectedBorderPattern = decomposed.pattern;
    }

    function getSelectedBorderMode(): BorderMode {
        return selectedBorderMode;
    }

    function updateBorderPopupActiveButtons(border?: BorderStyleEdit) {
        if (!borderPopupEl) return;
        const activeModes = getActiveBorderModes(border);
        borderPopupEl.querySelectorAll('.border-mode-btn').forEach((btn) => {
            const mode = (btn as HTMLElement).getAttribute('data-mode') as BorderMode | null;
            if (!mode) return;
            btn.classList.toggle('active', activeModes.has(mode));
        });
    }

    function syncBorderControlsToUi() {
        const thicknessEl = document.getElementById('editBorderThickness') as HTMLSelectElement | null;
        if (thicknessEl) thicknessEl.value = selectedBorderThickness;

        const patternEl = document.getElementById('editBorderPattern') as HTMLSelectElement | null;
        if (patternEl) patternEl.value = selectedBorderPattern;

        updateColorPreview('border', selectedBorderColor);
    }

    function syncBorderSelectionFromCell(cell: HTMLElement | null) {
        if (!cell) return;

        const rowNum = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const colNum = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        const key = rowNum > 0 && colNum > 0 ? `${rowNum}:${colNum}` : '';
        const pending = key ? pendingCellStyleEdits.get(key) : undefined;

        const copied = copyFormattingFromCell(cell);
        const border = (pending?.border || copied.border) as BorderStyleEdit | undefined;
        if (!border) return;

        selectedBorderMode = inferBorderModeFromStyle(border, selectedBorderMode);
        if (border.style) {
            selectedBorderLineStyle = border.style;
            syncBorderControlsFromStyle(border.style);
        }
        if (border.color) {
            selectedBorderColor = border.color;
        }

        syncBorderControlsToUi();
        updateBorderPopupActiveButtons(border);
    }

    function hideBorderPopup() {
        if (borderPopupEl) {
            borderPopupEl.classList.add('hidden');
        }
    }

    function ensureBorderPopup() {
        if (borderPopupEl) {
            return borderPopupEl;
        }

        const popup = document.createElement('div');
        popup.id = 'xlsxBorderPopup';
        popup.className = 'xlsx-border-popup hidden';
        popup.innerHTML = `
            <div class="border-popup-title">Borders</div>
            <div class="border-popup-grid">
                <button type="button" class="border-mode-btn" data-mode="all" title="All borders">All</button>
                <button type="button" class="border-mode-btn" data-mode="outside" title="Outside borders">Outer</button>
                <button type="button" class="border-mode-btn" data-mode="inner" title="Inner borders">Inner</button>
                <button type="button" class="border-mode-btn" data-mode="top" title="Top border">Top</button>
                <button type="button" class="border-mode-btn" data-mode="right" title="Right border">Right</button>
                <button type="button" class="border-mode-btn" data-mode="bottom" title="Bottom border">Bottom</button>
                <button type="button" class="border-mode-btn" data-mode="left" title="Left border">Left</button>
                <button type="button" class="border-mode-btn" data-mode="none" title="No borders">None</button>
            </div>
        `;

        popup.querySelectorAll('.border-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = (btn as HTMLElement).getAttribute('data-mode') as BorderMode | null;
                if (!mode) return;
                selectedBorderMode = mode;
                applyBorderPreset(mode);
                if (activeCell) {
                    syncBorderSelectionFromCell(activeCell);
                }
            });
        });

        document.body.appendChild(popup);
        borderPopupEl = popup;
        return popup;
    }

    function showBorderPopup(anchor: HTMLElement) {
        const popup = ensureBorderPopup();
        popup.classList.remove('hidden');

        const rect = anchor.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - popupRect.width - 8);
        const top = Math.min(rect.bottom + 6, window.innerHeight - popupRect.height - 8);
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
    }

    function isMergeWarningSuppressedForToday() {
        try {
            const raw = window.localStorage.getItem(MERGE_WARNING_SUPPRESS_UNTIL_KEY);
            const until = raw ? parseInt(raw, 10) : 0;
            if (!until || Number.isNaN(until)) return false;
            return Date.now() < until;
        } catch {
            return false;
        }
    }

    function suppressMergeWarningForOneDay() {
        try {
            const oneDayMs = 24 * 60 * 60 * 1000;
            window.localStorage.setItem(MERGE_WARNING_SUPPRESS_UNTIL_KEY, String(Date.now() + oneDayMs));
        } catch {
            // ignore storage errors
        }
    }

    function hideMergeWarningPopup(confirmed: boolean) {
        if (!mergeWarningPopupEl || !mergeWarningResolver) return;

        const skip = mergeWarningPopupEl.querySelector('#mergeWarningSkipDay') as HTMLInputElement | null;
        if (confirmed && skip?.checked) {
            suppressMergeWarningForOneDay();
        }

        mergeWarningPopupEl.classList.add('hidden');
        const resolver = mergeWarningResolver;
        mergeWarningResolver = null;
        resolver(confirmed);
    }

    function ensureMergeWarningPopup() {
        if (mergeWarningPopupEl) return mergeWarningPopupEl;

        const popup = document.createElement('div');
        popup.id = 'xlsxMergeWarningPopup';
        popup.className = 'xlsx-merge-warning-popup hidden';
        popup.innerHTML = `
            <div class="xlsx-merge-warning-dialog" role="dialog" aria-modal="true" aria-labelledby="mergeWarningTitle">
                <div id="mergeWarningTitle" class="merge-warning-title">Merge Cells</div>
                <div class="merge-warning-message">Only the top-left cell content will be preserved. Continue?</div>
                <label class="merge-warning-skip">
                    <input id="mergeWarningSkipDay" type="checkbox" />
                    Don't show this for 1 day
                </label>
                <div class="merge-warning-actions">
                    <button id="mergeWarningCancel" type="button" class="toggle-button">Cancel</button>
                    <button id="mergeWarningConfirm" type="button" class="toggle-button">Merge</button>
                </div>
            </div>
        `;

        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                hideMergeWarningPopup(false);
            }
        });

        const cancelBtn = popup.querySelector('#mergeWarningCancel') as HTMLButtonElement | null;
        const confirmBtn = popup.querySelector('#mergeWarningConfirm') as HTMLButtonElement | null;

        cancelBtn?.addEventListener('click', () => hideMergeWarningPopup(false));
        confirmBtn?.addEventListener('click', () => hideMergeWarningPopup(true));

        document.body.appendChild(popup);
        mergeWarningPopupEl = popup;
        return popup;
    }

    async function confirmMergePreserveTopLeftContent() {
        if (!currentSettings.mergeWarningEnabled) return true;
        if (isMergeWarningSuppressedForToday()) return true;

        const popup = ensureMergeWarningPopup();
        const skip = popup.querySelector('#mergeWarningSkipDay') as HTMLInputElement | null;
        if (skip) skip.checked = false;
        popup.classList.remove('hidden');

        return await new Promise<boolean>((resolve) => {
            mergeWarningResolver = resolve;
        });
    }

    function ensureHeaderVisible() {
        const thead = document.querySelector('#xlsxTable thead') as HTMLElement | null;
        if (thead) {
            thead.style.display = 'table-header-group';
        }
    }

    function applyCurrentBorderMode() {
        applyBorderPreset(getSelectedBorderMode());
    }

    function getFindManager(): XlsxFindManager {
        if (!findManager) {
            findManager = new XlsxFindManager({
                normalizeCellText,
                requestAllRows,
                getFallbackRows: getMutableRowsSnapshot,
                focusCellByPosition,
                isCellEditing: () => isCellEditing,
                tableSelector: '#xlsxTable'
            });
        }
        return findManager;
    }

    function applyFindHighlightsInVisibleCells() {
        getFindManager().reapplyHighlights();
    }

    async function focusCellByPosition(row: number, col: number) {
        const boundedRow = Math.max(0, Math.min(totalRows - 1, row));
        const boundedCol = Math.max(0, Math.min(columnCount - 1, col));

        let cell = document.querySelector(`td[data-row="${boundedRow}"][data-col="${boundedCol}"]`) as HTMLElement | null;

        if (!cell) {
            const container = getTableContainer();
            if (container) {
                let top = 0;
                for (let i = 0; i < boundedRow; i++) {
                    top += getEffectiveRowHeightByIndex(i);
                }
                container.scrollTop = Math.max(0, top - Math.floor(container.clientHeight / 2));
                await updateVisibleRows();
                cell = document.querySelector(`td[data-row="${boundedRow}"][data-col="${boundedCol}"]`) as HTMLElement | null;
            }
        }

        if (!cell) {
            showToast('Match is outside current view');
            return;
        }

        selectionStart = { row: boundedRow, col: boundedCol };
        selectionEnd = { row: boundedRow, col: boundedCol };
        selectCell(cell);

        const container = getTableContainer();
        if (container) {
            const rect = cell.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (rect.bottom > containerRect.bottom) container.scrollTop += rect.bottom - containerRect.bottom + 16;
            if (rect.top < containerRect.top) container.scrollTop -= containerRect.top - rect.top + 16;
            if (rect.right > containerRect.right) container.scrollLeft += rect.right - containerRect.right + 16;
            if (rect.left < containerRect.left) container.scrollLeft -= containerRect.left - rect.left + 16;
        }
    }

    async function runFind(query: string) {
        await getFindManager().run(query);
    }

    async function navigateFind(direction: 'next' | 'prev') {
        await getFindManager().navigate(direction);
    }

    function openFindOverlay() {
        getFindManager().open();
    }

    function toggleFindOverlay() {
        getFindManager().toggle();
    }

    function closeFindOverlay() {
        getFindManager().close();
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

        const beforeSnapshot = captureWorksheetStateSnapshot();
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
        normalizeRowsAfterStructureChange(rows, rowCache);
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

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);
        hideHeaderContextMenu();
        rerenderCurrentSheetFromLocalState();
    }

    async function applyCellDeleteOperation(type: 'deleteCellShiftLeft' | 'deleteCellShiftUp', rowNumber: number, colNumber: number) {
        if (!isEditMode) return;
        if (rowNumber <= 0 || colNumber <= 0) return;

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) return;

        const beforeSnapshot = captureWorksheetStateSnapshot();
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
        normalizeRowsAfterStructureChange(rows, rowCache);

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

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
            if (command === 'bold' || command === 'italic') {
                applyFormatToLogicalSelection({}, 'toggle', command as any);
                return;
            }

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
        const targets = Array.from(selectedCells)
            .filter(cell => document.contains(cell) && cell.tagName === 'TD')
            .map(cell => {
                const row = cell.getAttribute('data-row');
                const col = cell.getAttribute('data-col');
                return document.querySelector('td[data-row="' + row + '"][data-col="' + col + '"]') as HTMLElement | null;
            })
            .filter(Boolean) as HTMLElement[];

        if (targets.length > 0) return targets;

        if (activeCell && document.contains(activeCell) && activeCell.tagName === 'TD') {
            return [activeCell];
        }

        const focused = document.activeElement as HTMLElement | null;
        if (focused && document.contains(focused) && focused.tagName === 'TD') {
            return [focused];
        }
        return [];
    }

    function applyFormatToLogicalSelection(styleChanges: Partial<CellStyleEdit>, mode: 'set' | 'toggle' = 'set', toggleKey?: keyof CellStyleEdit) {
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to format');
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];

        // Protection against freezing UI on entire sheet selection (e.g. 100K x 100 cols)
        // If it's more than 200k cells, we might need a warning, but let's allow it
        const maxCells = 200000;
        const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
        
        if (cellCount > maxCells) {
            showToast(`Selection too large (${cellCount} cells) for individual formatting. Please select a smaller range.`);
            return;
        }

        // Logical Pass
        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;
                
                let targetStyle = { ...styleChanges };

                if (mode === 'toggle' && toggleKey) {
                    const currentPending = pendingCellStyleEdits.get(key);
                    const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                    let currentlyEnabled = false;
                    
                    if (currentPending && currentPending[toggleKey] !== undefined) {
                        currentlyEnabled = !!currentPending[toggleKey];
                    } else if (domCell) {
                        // Extract from DOM
                        if (toggleKey === 'bold') currentlyEnabled = domCell.style.fontWeight === 'bold';
                        else if (toggleKey === 'italic') currentlyEnabled = domCell.style.fontStyle === 'italic';
                        else if (toggleKey === 'strike') currentlyEnabled = domCell.style.textDecorationLine === 'line-through';
                    } else {
                        // Unmounted cell fallback
                        // We would ideally look up from rowCache, but for toggle we assume false if unknown unmounted
                        currentlyEnabled = false;
                    }
                    targetStyle[toggleKey] = !currentlyEnabled as any;
                }

                // Gather before state
                const pendingStyle = pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(pendingCellStyleEdits.get(key)) : null;
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                beforeStates.push({
                    row: r, col: c, key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                recordLogicalStyleEdit(r, c, targetStyle);
                
                if (domCell) {
                    applyStyleToCellFromPainter(domCell, targetStyle);
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: domCell.getAttribute('style') || '',
                        innerHtml: domCell.innerHTML,
                        pendingStyle: cloneCellStyleEdit(pendingCellStyleEdits.get(key))
                    });
                } else {
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: '',
                        innerHtml: '',
                        pendingStyle: cloneCellStyleEdit(pendingCellStyleEdits.get(key))
                    });
                }
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }
    }

    function getLogicalSelectionBounds(): { minRow: number, maxRow: number, minCol: number, maxCol: number } | null {
        const hasFullColumnSelection = selectedColumnIndices.size > 0;
        const hasFullRowSelection = selectedRowIndices.size > 0;

        if (hasFullRowSelection && hasFullColumnSelection) {
            return { minRow: 0, maxRow: totalRows - 1, minCol: 0, maxCol: columnCount - 1 };
        }

        if (hasFullRowSelection) {
            const minRow = Math.min(...Array.from(selectedRowIndices));
            const maxRow = Math.max(...Array.from(selectedRowIndices));
            return { minRow, maxRow, minCol: 0, maxCol: columnCount - 1 };
        }

        if (hasFullColumnSelection) {
            const minCol = Math.min(...Array.from(selectedColumnIndices));
            const maxCol = Math.max(...Array.from(selectedColumnIndices));
            return { minRow: 0, maxRow: totalRows - 1, minCol, maxCol };
        }

        if (selectionStart && selectionEnd) {
            return expandSelectionBoundsForMergedCells(
                Math.min(selectionStart.row, selectionEnd.row),
                Math.max(selectionStart.row, selectionEnd.row),
                Math.min(selectionStart.col, selectionEnd.col),
                Math.max(selectionStart.col, selectionEnd.col)
            );
        }

        if (selectedCells.size > 0) {
            const rows: number[] = [];
            const cols: number[] = [];
            selectedCells.forEach((cell) => {
                const row = parseInt(cell.dataset.row || '-1', 10);
                const col = parseInt(cell.dataset.col || '-1', 10);
                if (row >= 0 && col >= 0) {
                    rows.push(row);
                    cols.push(col);
                }
            });

            if (rows.length > 0 && cols.length > 0) {
                return {
                    minRow: Math.min(...rows),
                    maxRow: Math.max(...rows),
                    minCol: Math.min(...cols),
                    maxCol: Math.max(...cols)
                };
            }
        }

        if (activeCell) {
            const row = parseInt(activeCell.dataset.row || '0', 10);
            const col = parseInt(activeCell.dataset.col || '0', 10);
            return { minRow: row, maxRow: row, minCol: col, maxCol: col };
        }
        
        return null;
    }

    function recordLogicalStyleEdit(row: number, col: number, style: Partial<CellStyleEdit>) {
        const rowNum = row + 1;
        const colNum = col + 1;
        const key = rowNum + ':' + colNum;
        const existing = pendingCellStyleEdits.get(key) || { row: rowNum, col: colNum };
        const merged: CellStyleEdit = { ...existing, ...style, row: rowNum, col: colNum };
        pendingCellStyleEdits.set(key, merged);
    }

    function recordCellStyleEdit(cell: HTMLElement, style: Partial<CellStyleEdit>) {
        const rowNum = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const colNum = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (!rowNum || !colNum) return;

        const key = rowNum + ':' + colNum;
        const existing = pendingCellStyleEdits.get(key) || { row: rowNum, col: colNum };
        const merged: CellStyleEdit = { ...existing, ...style, row: rowNum, col: colNum };
        pendingCellStyleEdits.set(key, merged);
    }

    function cloneCellStyleEdit(style: CellStyleEdit | null | undefined): CellStyleEdit | null {
        return style ? JSON.parse(JSON.stringify(style)) : null;
    }

    function captureCellUndoState(cell: HTMLElement): CellUndoState | null {
        const row = parseInt(cell.getAttribute('data-row') || '-1', 10);
        const col = parseInt(cell.getAttribute('data-col') || '-1', 10);
        const rowNum = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const colNum = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (row < 0 || col < 0 || !rowNum || !colNum) return null;

        const key = `${rowNum}:${colNum}`;
        const pendingStyle = pendingCellStyleEdits.has(key)
            ? cloneCellStyleEdit(pendingCellStyleEdits.get(key) || null)
            : null;

        return {
            row,
            col,
            key,
            styleAttr: cell.getAttribute('style') || '',
            innerHtml: cell.innerHTML,
            pendingStyle
        };
    }

    function applyCellUndoState(state: CellUndoState) {
        const cell = document.querySelector(`td[data-row="${state.row}"][data-col="${state.col}"]`) as HTMLElement | null;
        if (cell) {
            if (state.styleAttr) {
                cell.setAttribute('style', state.styleAttr);
            } else {
                cell.removeAttribute('style');
            }
            cell.innerHTML = state.innerHtml;
        }

        if (state.pendingStyle) {
            pendingCellStyleEdits.set(state.key, cloneCellStyleEdit(state.pendingStyle)!);
        } else {
            pendingCellStyleEdits.delete(state.key);
        }
    }

    function captureWorksheetStateSnapshot(): WorksheetStateSnapshot {
        return {
            rows: cloneCellData(getMutableRowsSnapshot()),
            totalRows,
            columnCount,
            columnWidths: cloneCellData(columnWidths),
            allRowHeights: cloneCellData(allRowHeights),
            mergedCells: cloneCellData(mergedCells || []),
            pendingWorksheetOps: cloneWorksheetOps(pendingWorksheetOps)
        };
    }

    function restoreWorksheetStateSnapshot(snapshot: WorksheetStateSnapshot) {
        totalRows = snapshot.totalRows;
        columnCount = snapshot.columnCount;
        columnWidths = cloneCellData(snapshot.columnWidths || []);
        allRowHeights = cloneCellData(snapshot.allRowHeights || []);
        mergedCells = cloneCellData(snapshot.mergedCells || []);
        pendingWorksheetOps = cloneWorksheetOps(snapshot.pendingWorksheetOps || []);

        normalizeRowsAfterStructureChange(cloneCellData(snapshot.rows || []), rowCache);
        clearSelection();
        hideHeaderContextMenu();
        rerenderCurrentSheetFromLocalState();
    }

    function pushEditUndoEntry(entry: { before: CellUndoState[]; after: CellUndoState[] }) {
        if (!entry.before.length || !entry.after.length) return;
        editUndoStack.push({ kind: 'style', before: entry.before, after: entry.after });
        if (editUndoStack.length > 100) {
            editUndoStack.shift();
        }
        editRedoStack.length = 0;
    }

    function pushSheetUndoEntry(before: WorksheetStateSnapshot, after: WorksheetStateSnapshot) {
        editUndoStack.push({ kind: 'sheet', before, after });
        if (editUndoStack.length > 100) {
            editUndoStack.shift();
        }
        editRedoStack.length = 0;
    }

    function undoEditAction() {
        const entry = editUndoStack.pop();
        if (!entry) return false;

        if (entry.kind === 'style') {
            entry.before.forEach(state => applyCellUndoState(state));
        } else {
            restoreWorksheetStateSnapshot(entry.before);
        }

        editRedoStack.push(entry);
        applyFindHighlightsInVisibleCells();
        return true;
    }

    function redoEditAction() {
        const entry = editRedoStack.pop();
        if (!entry) return false;

        if (entry.kind === 'style') {
            entry.after.forEach(state => applyCellUndoState(state));
        } else {
            restoreWorksheetStateSnapshot(entry.after);
        }

        editUndoStack.push(entry);
        applyFindHighlightsInVisibleCells();
        return true;
    }

    function getEditableCellsOrToast(message: string): HTMLElement[] {
        const cells = getEditTargetCells();
        if (!cells.length) {
            showToast(message);
            return [];
        }
        return cells;
    }

    function applyHorizontalAlign(value: HorizontalAlign) {
        const cells = getEditableCellsOrToast('Select cells to align');
        if (!cells.length) return;

        cells.forEach(cell => {
            cell.style.textAlign = value;
            recordCellStyleEdit(cell, { horizontalAlign: value });
        });
    }

    function applyVerticalAlign(value: VerticalAlign) {
        const cells = getEditableCellsOrToast('Select cells to align');
        if (!cells.length) return;

        cells.forEach(cell => {
            cell.style.verticalAlign = value;
            recordCellStyleEdit(cell, { verticalAlign: value });
        });
    }

    function applyFontSize(value: number) {
        const cells = getEditableCellsOrToast('Select cells to set font size');
        if (!cells.length) return;

        const next = Math.max(6, Math.min(72, value));
        cells.forEach(cell => {
            cell.style.fontSize = `${next}pt`;
            recordCellStyleEdit(cell, { fontSize: next });
        });
    }

    function shiftFontSize(delta: number) {
        const sourceCell = activeCell || getEditTargetCells()[0] || null;
        if (!sourceCell) {
            showToast('Select cells to set font size');
            return;
        }

        const computed = window.getComputedStyle(sourceCell).fontSize;
        const numeric = parseFloat(computed || '11');
        const pts = Math.round((numeric * 72) / 96);
        applyFontSize(pts + delta);
    }

    function applyFontFamily(value: string) {
        const cells = getEditableCellsOrToast('Select cells to set font family');
        if (!cells.length) return;

        cells.forEach(cell => {
            cell.style.fontFamily = value;
            recordCellStyleEdit(cell, { fontFamily: value });
        });
    }

    function applyWrapMode(mode: WrapMode) {
        const cells = getEditableCellsOrToast('Select cells to set wrapping');
        if (!cells.length) return;

        cells.forEach(cell => {
            const content = cell.querySelector('.cell-content') as HTMLElement | null;
            if (mode === 'wrap') {
                cell.style.whiteSpace = 'pre-wrap';
                cell.style.wordWrap = 'break-word';
                cell.style.overflow = 'visible';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'pre-wrap';
                    content.style.wordWrap = 'break-word';
                    content.style.overflow = 'visible';
                    content.style.textOverflow = 'clip';
                }
            } else if (mode === 'overflow') {
                cell.style.wordWrap = 'normal';
                cell.style.whiteSpace = 'nowrap';
                cell.style.overflow = 'visible';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'nowrap';
                    content.style.wordWrap = 'normal';
                    content.style.overflow = 'visible';
                    content.style.textOverflow = 'clip';
                }
            } else {
                cell.style.wordWrap = 'normal';
                cell.style.whiteSpace = 'nowrap';
                cell.style.overflow = 'hidden';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'nowrap';
                    content.style.wordWrap = 'normal';
                    content.style.overflow = 'hidden';
                    content.style.textOverflow = 'clip';
                }
            }
            recordCellStyleEdit(cell, { wrapMode: mode });
        });
    }

    function applyIndent(delta: number) {
        const cells = getEditableCellsOrToast('Select cells to indent');
        if (!cells.length) return;

        cells.forEach(cell => {
            const current = parseInt(cell.style.paddingLeft || '0', 10) || 0;
            const next = Math.max(0, current + delta);
            cell.style.paddingLeft = `${next}px`;
            recordCellStyleEdit(cell, { indent: Math.round(next / 8) });
        });
    }

    function applyStrikeThrough() {
        const selection = window.getSelection();
        const hasTextSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;

        if (hasTextSelection || restoreEditSelectionRange()) {
            const current = window.getSelection();
            if (current && current.rangeCount > 0 && !current.isCollapsed) {
                applyEditFormatting('strikeThrough');
                return;
            }
        }

        const cells = getEditableCellsOrToast('Select cells to strike through');
        if (!cells.length) return;

        cells.forEach(cell => {
            const hasStrike = (cell.style.textDecoration || '').includes('line-through');
            if (hasStrike) {
                cell.style.textDecoration = '';
                cell.style.textDecorationLine = '';
                cell.style.textDecorationThickness = '';
                cell.style.textDecorationSkipInk = '';
                cell.style.textDecorationColor = '';
            } else {
                cell.style.textDecorationLine = 'line-through';
                cell.style.textDecorationThickness = '2px';
                cell.style.textDecorationSkipInk = 'none';
                cell.style.textDecorationColor = 'currentColor';
            }
            recordCellStyleEdit(cell, { strike: !hasStrike });
        });
    }

    function applyBorderPreset(mode: BorderMode) {
        selectedBorderMode = mode;
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to set borders');
            return;
        }

        const maxCells = 200000;
        const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
        if (cellCount > maxCells) {
            showToast(`Selection too large (${cellCount} cells) for borders. Please select a smaller range.`);
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;

                // Gather before state
                const pendingStyle = pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(pendingCellStyleEdits.get(key)) : null;
                beforeStates.push({
                    row: r, col: c, key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                // Prepare border style
                const existingBorder = pendingStyle?.border || (domCell ? copyFormattingFromCell(domCell).border : null) || { top: false, right: false, bottom: false, left: false, style: selectedBorderLineStyle, color: selectedBorderColor };
                
                const border: BorderStyleEdit = {
                    ...existingBorder,
                    clear: false,
                    color: selectedBorderColor,
                    style: selectedBorderLineStyle
                };

                if (mode === 'none') {
                    border.clear = true;
                    border.top = false;
                    border.right = false;
                    border.bottom = false;
                    border.left = false;
                } else if (mode === 'all') {
                    border.top = true;
                    border.right = true;
                    border.bottom = true;
                    border.left = true;
                } else if (mode === 'inner') {
                    if (r > bounds.minRow) border.top = true;
                    if (r < bounds.maxRow) border.bottom = true;
                    if (c > bounds.minCol) border.left = true;
                    if (c < bounds.maxCol) border.right = true;
                } else if (mode === 'outside') {
                    if (r === bounds.minRow) border.top = true;
                    if (r === bounds.maxRow) border.bottom = true;
                    if (c === bounds.minCol) border.left = true;
                    if (c === bounds.maxCol) border.right = true;
                } else {
                    if (mode === 'top') border.top = true;
                    if (mode === 'bottom') border.bottom = true;
                    if (mode === 'left') border.left = true;
                    if (mode === 'right') border.right = true;
                }

                recordLogicalStyleEdit(r, c, { border });

                if (domCell) {
                    if (border.clear) {
                        domCell.style.borderTop = '';
                        domCell.style.borderRight = '';
                        domCell.style.borderBottom = '';
                        domCell.style.borderLeft = '';
                        domCell.setAttribute('data-default-border', 'true');
                        domCell.removeAttribute('data-black-border');
                        domCell.removeAttribute('data-white-border');
                    } else {
                        domCell.style.borderTop = buildBorderCss(!!border.top, border.style, border.color);
                        domCell.style.borderRight = buildBorderCss(!!border.right, border.style, border.color);
                        domCell.style.borderBottom = buildBorderCss(!!border.bottom, border.style, border.color);
                        domCell.style.borderLeft = buildBorderCss(!!border.left, border.style, border.color);
                        domCell.removeAttribute('data-default-border');
                        domCell.removeAttribute('data-black-border');
                        domCell.removeAttribute('data-white-border');
                    }

                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: domCell.getAttribute('style') || '',
                        innerHtml: domCell.innerHTML,
                        pendingStyle: cloneCellStyleEdit(pendingCellStyleEdits.get(key))
                    });
                } else {
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: '',
                        innerHtml: '',
                        pendingStyle: cloneCellStyleEdit(pendingCellStyleEdits.get(key))
                    });
                }
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }
    }

    function applyBorderColorToSelection(color: string) {
        selectedBorderColor = color;

        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to set border color');
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];
        let recoloredExistingBorder = false;

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;
                const pendingStyle = pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(pendingCellStyleEdits.get(key)) : null;
                const existingBorder = (pendingStyle?.border || (domCell ? copyFormattingFromCell(domCell).border : null)) as BorderStyleEdit | null;

                const hasSides = !!existingBorder && !existingBorder.clear && (!!existingBorder.top || !!existingBorder.right || !!existingBorder.bottom || !!existingBorder.left);
                if (!hasSides) {
                    continue;
                }

                recoloredExistingBorder = true;

                beforeStates.push({
                    row: r,
                    col: c,
                    key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                const border: BorderStyleEdit = {
                    ...existingBorder,
                    clear: false,
                    color,
                    style: existingBorder?.style || selectedBorderLineStyle
                };

                recordLogicalStyleEdit(r, c, { border });

                if (domCell) {
                    domCell.style.borderTop = buildBorderCss(!!border.top, border.style, border.color);
                    domCell.style.borderRight = buildBorderCss(!!border.right, border.style, border.color);
                    domCell.style.borderBottom = buildBorderCss(!!border.bottom, border.style, border.color);
                    domCell.style.borderLeft = buildBorderCss(!!border.left, border.style, border.color);
                    domCell.removeAttribute('data-default-border');
                    domCell.removeAttribute('data-black-border');
                    domCell.removeAttribute('data-white-border');
                }

                afterStates.push({
                    row: r,
                    col: c,
                    key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle: cloneCellStyleEdit(pendingCellStyleEdits.get(key))
                });
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }

        if (!recoloredExistingBorder) {
            const mode = getSelectedBorderMode() === 'none' ? 'all' : getSelectedBorderMode();
            applyBorderPreset(mode);
        }
    }

    function clearFormattingOnSelection() {
        applyFormatToLogicalSelection({
            clearFormatting: true,
            border: { clear: true }
        }, 'set');

        const bounds = getLogicalSelectionBounds();
        if (!bounds) return;

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const cell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                if (!cell) continue;

                cell.style.backgroundColor = '';
                cell.style.color = '';
                cell.style.fontSize = '';
                cell.style.fontFamily = '';
                cell.style.fontWeight = '';
                cell.style.fontStyle = '';
                cell.style.textDecoration = '';
                cell.style.textDecorationLine = '';
                cell.style.textDecorationThickness = '';
                cell.style.textDecorationSkipInk = '';
                cell.style.textDecorationColor = '';
                cell.style.textAlign = '';
                cell.style.verticalAlign = '';
                cell.style.whiteSpace = '';
                cell.style.wordWrap = '';
                cell.style.overflow = '';
                cell.style.textOverflow = '';
                cell.style.paddingLeft = '';
                cell.style.borderTop = '';
                cell.style.borderRight = '';
                cell.style.borderBottom = '';
                cell.style.borderLeft = '';

                const plainText = normalizeCellText(cell.textContent || '');
                const safeText = plainText
                    ? plainText
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;')
                    : '&nbsp;';
                cell.innerHTML = `<span class="cell-content">${safeText}</span>`;
            }
        }
    }

    async function queueMergeOperation(type: 'mergeRange' | 'unmergeRange') {
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select a range to merge');
            return;
        }

        if (type === 'mergeRange' && bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol) {
            showToast('Select at least two cells to merge');
            return;
        }

        if (type === 'mergeRange') {
            const confirmed = await confirmMergePreserveTopLeftContent();
            if (!confirmed) return;
        }

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) return;

        const scrollContainer = getTableContainer();
        const preservedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const preservedScrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;

        const beforeSnapshot = captureWorksheetStateSnapshot();
        const rows = getMutableRowsSnapshot();
        const startRow = bounds.minRow + 1;
        const startCol = bounds.minCol + 1;
        const endRow = bounds.maxRow + 1;
        const endCol = bounds.maxCol + 1;

        if (type === 'mergeRange') {
            const anchorRow = rows[startRow - 1];
            if (!anchorRow) return;

            const anchorSource = getCellFromRow(anchorRow, startCol) || {
                rowNumber: startRow,
                colNumber: startCol,
                value: '',
                style: {}
            };
            const anchor = cloneCellData(anchorSource);
            anchor.rowNumber = startRow;
            anchor.colNumber = startCol;
            anchor.rowspan = Math.max(1, endRow - startRow + 1);
            anchor.colspan = Math.max(1, endCol - startCol + 1);
            anchor.isMerged = true;
            anchor.isMaster = true;
            anchor.isMergeCovered = false;
            anchor.masterRow = startRow;
            anchor.masterCol = startCol;
            setCellOnRow(anchorRow, startCol, anchor);

            for (let r = startRow; r <= endRow; r++) {
                const rowData = rows[r - 1];
                if (!rowData) continue;
                for (let c = startCol; c <= endCol; c++) {
                    if (r === startRow && c === startCol) continue;

                    const coveredExisting = getCellFromRow(rowData, c);
                    const covered = cloneCellData(coveredExisting || {
                        rowNumber: r,
                        colNumber: c,
                        value: '',
                        style: {}
                    });
                    covered.rowNumber = r;
                    covered.colNumber = c;
                    covered.value = '';
                    covered.rowspan = 1;
                    covered.colspan = 1;
                    covered.isMerged = true;
                    covered.isMaster = false;
                    covered.isMergeCovered = true;
                    covered.masterRow = startRow;
                    covered.masterCol = startCol;
                    setCellOnRow(rowData, c, covered);
                }
            }
        } else {
            let baseStyle: any = {};
            const anchorExisting = getCellFromRow(rows[startRow - 1], startCol);
            if (anchorExisting && anchorExisting.style) {
                baseStyle = cloneCellData(anchorExisting.style);
            }

            for (let r = startRow; r <= endRow; r++) {
                const rowData = rows[r - 1];
                if (!rowData) continue;
                for (let c = startCol; c <= endCol; c++) {
                    const existing = getCellFromRow(rowData, c);
                    const next = cloneCellData(existing || {
                        rowNumber: r,
                        colNumber: c,
                        value: '',
                        style: baseStyle
                    });
                    next.rowNumber = r;
                    next.colNumber = c;
                    delete next.rowspan;
                    delete next.colspan;
                    next.isMerged = false;
                    next.isMaster = false;
                    next.isMergeCovered = false;
                    next.masterRow = r;
                    next.masterCol = c;
                    if (existing?.isMergeCovered) {
                        next.value = '';
                        next.style = cloneCellData(baseStyle);
                    }
                    setCellOnRow(rowData, c, next);
                }
            }
        }

        normalizeRowsAfterStructureChange(rows, rowCache);
        rerenderCurrentSheetFromLocalState();
        requestAnimationFrame(() => {
            const containerAfter = getTableContainer();
            if (!containerAfter) return;
            containerAfter.scrollTop = preservedScrollTop;
            containerAfter.scrollLeft = preservedScrollLeft;
            void updateVisibleRows();
        });

        pendingWorksheetOps.push({
            type,
            startRow,
            startCol,
            endRow,
            endCol
        });

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

        showToast(type === 'mergeRange' ? 'Merged' : 'Unmerged');
    }

    function copyFormattingFromCell(cell: HTMLElement): Partial<CellStyleEdit> {
        const computed = window.getComputedStyle(cell);

        const isExplicitBorderValue = (value?: string) => {
            const s = (value || '').trim().toLowerCase();
            if (!s || s === 'none') return false;
            if (s === '0' || s === '0px' || s.startsWith('0px ')) return false;
            return true;
        };

        const inlineBorderAll = cell.style.border || '';
        const inlineTop = cell.style.borderTop || '';
        const inlineRight = cell.style.borderRight || '';
        const inlineBottom = cell.style.borderBottom || '';
        const inlineLeft = cell.style.borderLeft || '';

        const parseInlineBorder = (value?: string): { width: string; style: string; color: string } | null => {
            const raw = (value || '').trim();
            if (!isExplicitBorderValue(raw)) return null;

            const match = raw.match(/^([\d.]+px)\s+([a-zA-Z]+)\s+(.+)$/);
            if (!match) return null;

            return {
                width: match[1],
                style: match[2].toLowerCase(),
                color: normalizeColorToHex(match[3]) || selectedBorderColor
            };
        };

        // To avoid picking up default table gridlines from CSS, check inline styles explicitly for borders
        // (Since all custom borders are applied via inline styles)
        const borderAllEnabled = isExplicitBorderValue(inlineBorderAll);
        const hasInlineBorders = borderAllEnabled || isExplicitBorderValue(inlineTop) || isExplicitBorderValue(inlineRight) || isExplicitBorderValue(inlineBottom) || isExplicitBorderValue(inlineLeft);

        const topEnabled = borderAllEnabled || isExplicitBorderValue(inlineTop);
        const rightEnabled = borderAllEnabled || isExplicitBorderValue(inlineRight);
        const bottomEnabled = borderAllEnabled || isExplicitBorderValue(inlineBottom);
        const leftEnabled = borderAllEnabled || isExplicitBorderValue(inlineLeft);

        const topBorderLine = topEnabled ? parseInlineBorder(inlineTop || inlineBorderAll) : null;
        const rightBorderLine = rightEnabled ? parseInlineBorder(inlineRight || inlineBorderAll) : null;
        const bottomBorderLine = bottomEnabled ? parseInlineBorder(inlineBottom || inlineBorderAll) : null;
        const leftBorderLine = leftEnabled ? parseInlineBorder(inlineLeft || inlineBorderAll) : null;
        const activeBorderLine = topBorderLine || rightBorderLine || bottomBorderLine || leftBorderLine;

        const pickBorderStyle = () => {
            if (!hasInlineBorders) return 'thin';
            if (activeBorderLine) {
                return inferBorderLineStyleFromCss(activeBorderLine.style, activeBorderLine.width);
            }

            const fallbackStyle = topEnabled
                ? computed.borderTopStyle
                : rightEnabled
                    ? computed.borderRightStyle
                    : bottomEnabled
                        ? computed.borderBottomStyle
                        : computed.borderLeftStyle;
            const fallbackWidth = topEnabled
                ? computed.borderTopWidth
                : rightEnabled
                    ? computed.borderRightWidth
                    : bottomEnabled
                        ? computed.borderBottomWidth
                        : computed.borderLeftWidth;

            return inferBorderLineStyleFromCss((fallbackStyle || '').toLowerCase(), fallbackWidth || '1px');
        };

        const pickBorderColor = () => {
            if (!hasInlineBorders) return selectedBorderColor;
            if (topBorderLine?.color) return topBorderLine.color;
            if (rightBorderLine?.color) return rightBorderLine.color;
            if (bottomBorderLine?.color) return bottomBorderLine.color;
            if (leftBorderLine?.color) return leftBorderLine.color;
            if (topEnabled) return normalizeColorToHex(computed.borderTopColor);
            if (rightEnabled) return normalizeColorToHex(computed.borderRightColor);
            if (bottomEnabled) return normalizeColorToHex(computed.borderBottomColor);
            if (leftEnabled) return normalizeColorToHex(computed.borderLeftColor);
            return normalizeColorToHex(computed.borderColor) || selectedBorderColor;
        };

        // If no inline borders exist, the entire border object means "clear"
        const border: BorderStyleEdit = hasInlineBorders ? {
            top: topEnabled,
            right: rightEnabled,
            bottom: bottomEnabled,
            left: leftEnabled,
            color: pickBorderColor(),
            style: pickBorderStyle()
        } : { clear: true };

        return {
            bgColor: normalizeColorToHex(computed.backgroundColor),
            textColor: normalizeColorToHex(computed.color),
            bold: computed.fontWeight === 'bold' || parseInt(computed.fontWeight || '400', 10) >= 600,
            italic: computed.fontStyle === 'italic',
            fontFamily: computed.fontFamily,
            fontSize: Math.round((parseFloat(computed.fontSize || '11') * 72) / 96),
            strike: computed.textDecorationLine.includes('line-through'),
            horizontalAlign: (computed.textAlign as HorizontalAlign) || 'left',
            verticalAlign: (computed.verticalAlign as VerticalAlign) || 'top',
            wrapMode: computed.whiteSpace.includes('wrap') ? 'wrap' : 'overflow',
            indent: Math.round((parseInt(computed.paddingLeft || '0', 10) || 0) / 8),
            border
        };
    }

    function applyStyleToCellFromPainter(cell: HTMLElement, style: Partial<CellStyleEdit>) {
        if ('bgColor' in style) {
            cell.style.backgroundColor = style.bgColor || '';
            if (style.bgColor) {
                cell.removeAttribute('data-default-bg');
                cell.removeAttribute('data-white-bg');
                cell.removeAttribute('data-black-bg');
            }
        }
        if ('textColor' in style) {
            cell.style.color = style.textColor || '';
            if (style.textColor) {
                cell.removeAttribute('data-default-color');
            }
        }
        if (typeof style.bold === 'boolean') {
            cell.style.fontWeight = style.bold ? 'bold' : 'normal';
        }
        if (typeof style.italic === 'boolean') {
            cell.style.fontStyle = style.italic ? 'italic' : 'normal';
        }
        if (typeof style.fontSize === 'number') {
            cell.style.fontSize = `${style.fontSize}pt`;
        }
        if ('fontFamily' in style) {
            cell.style.fontFamily = style.fontFamily || '';
        }
        if (typeof style.strike === 'boolean') {
            if (style.strike) {
                cell.style.textDecorationLine = 'line-through';
                cell.style.textDecorationThickness = '2px';
                cell.style.textDecorationSkipInk = 'none';
                cell.style.textDecorationColor = 'currentColor';
            } else {
                cell.style.textDecoration = '';
                cell.style.textDecorationLine = '';
                cell.style.textDecorationThickness = '';
                cell.style.textDecorationSkipInk = '';
                cell.style.textDecorationColor = '';
            }
        }
        if (style.horizontalAlign) {
            cell.style.textAlign = style.horizontalAlign;
        }
        if (style.verticalAlign) {
            cell.style.verticalAlign = style.verticalAlign;
        }
        if (style.wrapMode) {
            const content = cell.querySelector('.cell-content') as HTMLElement | null;
            if (style.wrapMode === 'wrap') {
                cell.style.whiteSpace = 'pre-wrap';
                cell.style.wordWrap = 'break-word';
                cell.style.overflow = 'visible';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'pre-wrap';
                    content.style.wordWrap = 'break-word';
                    content.style.overflow = 'visible';
                    content.style.textOverflow = 'clip';
                }
            } else if (style.wrapMode === 'overflow') {
                cell.style.whiteSpace = 'nowrap';
                cell.style.wordWrap = 'normal';
                cell.style.overflow = 'visible';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'nowrap';
                    content.style.wordWrap = 'normal';
                    content.style.overflow = 'visible';
                    content.style.textOverflow = 'clip';
                }
            } else {
                cell.style.whiteSpace = 'nowrap';
                cell.style.wordWrap = 'normal';
                cell.style.overflow = 'hidden';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'nowrap';
                    content.style.wordWrap = 'normal';
                    content.style.overflow = 'hidden';
                    content.style.textOverflow = 'clip';
                }
            }
        }
        if (typeof style.indent === 'number') {
            cell.style.paddingLeft = `${Math.max(0, style.indent) * 8}px`;
        }
        if (style.border) {
            if (style.border.clear) {
                cell.style.borderTop = '';
                cell.style.borderRight = '';
                cell.style.borderBottom = '';
                cell.style.borderLeft = '';
                cell.setAttribute('data-default-border', 'true');
                cell.removeAttribute('data-black-border');
                cell.removeAttribute('data-white-border');
            } else {
                cell.style.borderTop = buildBorderCss(!!style.border.top, style.border.style, style.border.color);
                cell.style.borderRight = buildBorderCss(!!style.border.right, style.border.style, style.border.color);
                cell.style.borderBottom = buildBorderCss(!!style.border.bottom, style.border.style, style.border.color);
                cell.style.borderLeft = buildBorderCss(!!style.border.left, style.border.style, style.border.color);
                cell.removeAttribute('data-default-border');
                cell.removeAttribute('data-black-border');
                cell.removeAttribute('data-white-border');
            }
        }

        recordCellStyleEdit(cell, style);
    }

    function toggleFormatPainter() {
        if (formatPainterArmed) {
            formatPainterArmed = false;
            formatPainterStyle = null;
            document.body.classList.remove('format-painter-armed');
            showToast('Format painter off');
            return;
        }

        const source = activeCell || getEditTargetCells()[0] || null;
        if (!source) {
            showToast('Select a source cell first');
            return;
        }

        formatPainterStyle = copyFormattingFromCell(source);
        if (formatPainterStyle.border?.style) {
            syncBorderControlsFromStyle(formatPainterStyle.border.style);
            syncBorderStyleFromControls();
        }
        formatPainterArmed = true;
        document.body.classList.add('format-painter-armed');
        showToast('Format painter on: click a target cell');
    }

    function applyCellBackgroundColor(color: string) {
        applyFormatToLogicalSelection({ bgColor: color }, 'set');
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

        applyFormatToLogicalSelection({ textColor: color }, 'set');
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
                    updateColorPreview('text', color);
                } else if (activeColorTarget === 'background') {
                    selectedBgColor = color;
                    applyCellBackgroundColor(color);
                    updateColorPreview('background', color);
                } else {
                    selectedBorderColor = color;
                    updateColorPreview('border', color);
                    applyBorderColorToSelection(color);
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
                updateColorPreview('text', color);
            } else if (activeColorTarget === 'background') {
                selectedBgColor = color;
                applyCellBackgroundColor(color);
                updateColorPreview('background', color);
            } else {
                selectedBorderColor = color;
                updateColorPreview('border', color);
                applyBorderColorToSelection(color);
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

    function showColorPalette(anchor: HTMLElement, target: 'text' | 'background' | 'border') {
        const palette = ensureColorPalette();
        activeColorTarget = target;

        const input = palette.querySelector('#sheetsCustomColorInput') as HTMLInputElement | null;
        if (input) {
            input.value = target === 'text'
                ? selectedTextColor
                : target === 'background'
                    ? selectedBgColor
                    : selectedBorderColor;
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
            updateColorPreview('text', selectedTextColor);
            textColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(textColorButton, 'text');
            });
        }

        const bgColorButton = document.getElementById('formatBackgroundColorButton') as HTMLButtonElement | null;
        if (bgColorButton) {
            bgColorButton.classList.add('color-format-button');
            updateColorPreview('background', selectedBgColor);
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
            if (!target.closest('#sheetsColorPalette') && !target.closest('#formatTextColorButton') && !target.closest('#formatBackgroundColorButton') && !target.closest('#stripTextColorButton') && !target.closest('#stripBgColorButton') && !target.closest('#stripBorderColorButton')) {
                hideColorPalette();
            }
            if (!target.closest('#xlsxBorderPopup') && !target.closest('#stripBordersButton')) {
                hideBorderPopup();
            }
        });

        ensureEditFormattingStrip();
    }

    function ensureEditFormattingStrip() {
        if (editFormattingStripEl) return;

        const toolbar = document.getElementById('toolbar');
        if (!toolbar) return;

        const strip = document.createElement('div');
        strip.id = 'xlsxEditFormattingStrip';
        strip.className = 'xlsx-edit-strip hidden';
        strip.innerHTML = `
            <div class="edit-strip-group">
                <select id="editFontFamily" class="edit-strip-select" title="Font family">
                    <option value="Arial">Arial</option>
                    <option value="Roboto">Roboto</option>
                    <option value="Inter">Inter</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Consolas">Consolas</option>
                </select>
                <select id="editFontSize" class="edit-strip-select narrow" title="Font size">
                    <option value="10">10</option>
                    <option value="11">11</option>
                    <option value="12" selected>12</option>
                    <option value="14">14</option>
                    <option value="16">16</option>
                    <option value="18">18</option>
                    <option value="20">20</option>
                </select>
                <button id="fontMinusButton" type="button" class="toggle-button icon-only" title="Decrease font">A-</button>
                <button id="fontPlusButton" type="button" class="toggle-button icon-only" title="Increase font">A+</button>
            </div>
            <div class="edit-strip-group">
                <button id="stripBoldButton" type="button" class="toggle-button icon-only" title="Bold">B</button>
                <button id="stripItalicButton" type="button" class="toggle-button icon-only" title="Italic">I</button>
                <button id="stripStrikeButton" type="button" class="toggle-button icon-only" title="Strikethrough">S</button>
                <button id="stripTextColorButton" type="button" class="toggle-button icon-only" title="Text color">A</button>
                <button id="stripBgColorButton" type="button" class="toggle-button icon-only" title="Background color">■</button>
            </div>
            <div class="edit-strip-group">
                <select id="editHorizontalAlign" class="edit-strip-select narrow" title="Horizontal align">
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                </select>
                <select id="editVerticalAlign" class="edit-strip-select narrow" title="Vertical align">
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                </select>
            </div>
            <div class="edit-strip-group">
                <button id="stripBordersButton" type="button" class="toggle-button" title="Borders">Borders</button>
                <select id="editBorderThickness" class="edit-strip-select narrow" title="Border thickness">
                    <option value="thin" selected>1px</option>
                    <option value="medium">2px</option>
                    <option value="thick">3px</option>
                </select>
                <select id="editBorderPattern" class="edit-strip-select narrow" title="Border pattern">
                    <option value="solid" selected>Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="double">Double</option>
                </select>
                <button id="stripBorderColorButton" type="button" class="toggle-button icon-only" title="Border color">▣</button>
                <button id="indentDecreaseButton" type="button" class="toggle-button icon-only" title="Decrease indent">←</button>
                <button id="indentIncreaseButton" type="button" class="toggle-button icon-only" title="Increase indent">→</button>
            </div>
            <div class="edit-strip-group">
                <button id="mergeCellsButton" type="button" class="toggle-button" title="Merge selected cells">Merge</button>
                <button id="unmergeCellsButton" type="button" class="toggle-button" title="Unmerge selected range">Unmerge</button>
                <button id="formatPainterButton" type="button" class="toggle-button" title="Copy style from active cell, then click a target cell">Painter</button>
                <button id="clearFormatButton" type="button" class="toggle-button" title="Clear formatting">Clear</button>
            </div>
        `;

        const findButton = document.getElementById('findButton');
        const findWrapper = findButton ? findButton.closest('.tooltip') : null;
        if (findWrapper && findWrapper.parentElement === toolbar) {
            findWrapper.insertAdjacentElement('afterend', strip);
        } else {
            toolbar.appendChild(strip);
        }
        editFormattingStripEl = strip;

        const onKeepTextSelection = (event: Event) => {
            event.preventDefault();
            captureEditSelectionRange();
        };

        strip.querySelectorAll('button').forEach(el => {
            el.addEventListener('mousedown', onKeepTextSelection);
        });

        strip.querySelectorAll('select').forEach(el => {
            el.addEventListener('mousedown', () => {
                captureEditSelectionRange();
            });
        });

        strip.querySelectorAll('button,select').forEach(el => {
            (el as HTMLElement).classList.add('tooltip');
        });

        const byId = <T extends HTMLElement>(id: string) => strip.querySelector(`#${id}`) as T | null;

        byId<HTMLSelectElement>('editFontFamily')?.addEventListener('change', (e) => {
            const value = (e.target as HTMLSelectElement).value;
            applyFontFamily(value);
        });
        byId<HTMLSelectElement>('editFontSize')?.addEventListener('change', (e) => {
            const value = parseInt((e.target as HTMLSelectElement).value, 10);
            if (!isNaN(value)) applyFontSize(value);
        });
        byId<HTMLButtonElement>('fontMinusButton')?.addEventListener('click', () => shiftFontSize(-1));
        byId<HTMLButtonElement>('fontPlusButton')?.addEventListener('click', () => shiftFontSize(1));

        byId<HTMLButtonElement>('stripBoldButton')?.addEventListener('click', () => applyEditFormatting('bold'));
        byId<HTMLButtonElement>('stripItalicButton')?.addEventListener('click', () => applyEditFormatting('italic'));
        byId<HTMLButtonElement>('stripStrikeButton')?.addEventListener('click', () => applyStrikeThrough());

        const stripTextColorButton = byId<HTMLButtonElement>('stripTextColorButton');
        if (stripTextColorButton) {
            stripTextColorButton.classList.add('color-format-button');
            stripTextColorButton.style.setProperty('--format-color-preview', selectedTextColor);
            stripTextColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(stripTextColorButton, 'text');
            });
        }

        const stripBgColorButton = byId<HTMLButtonElement>('stripBgColorButton');
        if (stripBgColorButton) {
            stripBgColorButton.classList.add('color-format-button');
            stripBgColorButton.style.setProperty('--format-color-preview', selectedBgColor);
            stripBgColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(stripBgColorButton, 'background');
            });
        }

        const stripBorderColorButton = byId<HTMLButtonElement>('stripBorderColorButton');
        if (stripBorderColorButton) {
            stripBorderColorButton.classList.add('color-format-button');
            stripBorderColorButton.style.setProperty('--format-color-preview', selectedBorderColor);
            stripBorderColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                applyCurrentBorderMode();
                showColorPalette(stripBorderColorButton, 'border');
            });
        }

        byId<HTMLSelectElement>('editHorizontalAlign')?.addEventListener('change', (e) => {
            applyHorizontalAlign((e.target as HTMLSelectElement).value as HorizontalAlign);
        });
        byId<HTMLSelectElement>('editVerticalAlign')?.addEventListener('change', (e) => {
            applyVerticalAlign((e.target as HTMLSelectElement).value as VerticalAlign);
        });
        byId<HTMLButtonElement>('stripBordersButton')?.addEventListener('click', (e) => {
            if (activeCell) {
                syncBorderSelectionFromCell(activeCell);
            } else {
                updateBorderPopupActiveButtons({ clear: true });
            }
            showBorderPopup(e.currentTarget as HTMLElement);
        });
        byId<HTMLSelectElement>('editBorderThickness')?.addEventListener('change', (e) => {
            selectedBorderThickness = (e.target as HTMLSelectElement).value as BorderThickness;
            syncBorderStyleFromControls();
            if (selectedBorderPattern === 'solid') {
                applyCurrentBorderMode();
            }
        });
        byId<HTMLSelectElement>('editBorderPattern')?.addEventListener('change', (e) => {
            selectedBorderPattern = (e.target as HTMLSelectElement).value as BorderPattern;
            syncBorderStyleFromControls();
            applyCurrentBorderMode();
        });

        byId<HTMLButtonElement>('indentDecreaseButton')?.addEventListener('click', () => applyIndent(-8));
        byId<HTMLButtonElement>('indentIncreaseButton')?.addEventListener('click', () => applyIndent(8));
        byId<HTMLButtonElement>('mergeCellsButton')?.addEventListener('click', () => queueMergeOperation('mergeRange'));
        byId<HTMLButtonElement>('unmergeCellsButton')?.addEventListener('click', () => queueMergeOperation('unmergeRange'));
        byId<HTMLButtonElement>('formatPainterButton')?.addEventListener('click', () => toggleFormatPainter());
        byId<HTMLButtonElement>('clearFormatButton')?.addEventListener('click', () => clearFormattingOnSelection());
    }

    function reorderToolbarAroundFind(isEditModeEnabled: boolean) {
        const toolbar = document.getElementById('toolbar');
        if (!toolbar) return;

        const findButton = document.getElementById('findButton');
        const settingsButton = document.getElementById('openSettingsButton');
        const plainButton = document.getElementById('togglePlainViewButton');
        const strip = document.getElementById('xlsxEditFormattingStrip');

        const findWrapper = findButton ? findButton.closest('.tooltip') as HTMLElement | null : null;
        const settingsWrapper = settingsButton ? settingsButton.closest('.tooltip') as HTMLElement | null : null;
        const plainWrapper = plainButton ? plainButton.closest('.tooltip') as HTMLElement | null : null;

        if (!findWrapper || !settingsWrapper || findWrapper.parentElement !== toolbar || settingsWrapper.parentElement !== toolbar) {
            return;
        }

        if (isEditModeEnabled) {
            if (findWrapper.nextElementSibling !== settingsWrapper) {
                findWrapper.insertAdjacentElement('afterend', settingsWrapper);
            }

            if (strip && strip.parentElement === toolbar && settingsWrapper.nextElementSibling !== strip) {
                settingsWrapper.insertAdjacentElement('afterend', strip);
            }
            return;
        }

        if (plainWrapper && plainWrapper.parentElement === toolbar && plainWrapper.nextElementSibling !== settingsWrapper) {
            plainWrapper.insertAdjacentElement('afterend', settingsWrapper);
        }
    }

    function normalizeCellText(text: string | null | undefined): string {
        if (!text) return '';
        return String(text).replace(/\u00a0/g, '').replace(/\r?\n/g, ' ').trimEnd();
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
        ensureHeaderVisible();
        reapplySelection();
        applyFindHighlightsInVisibleCells();
        syncColumnWidthsToCurrentMode();
        if (isEditMode) {
            captureOriginalCellValues();
        }
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

        if (!selectionStart || !selectionEnd) return;
        if (selectedRowIndices.size > 0 || selectedColumnIndices.size > 0) return;

        const minRow = Math.min(selectionStart.row, selectionEnd.row);
        const maxRow = Math.max(selectionStart.row, selectionEnd.row);
        const minCol = Math.min(selectionStart.col, selectionEnd.col);
        const maxCol = Math.max(selectionStart.col, selectionEnd.col);

        const visibleCells = document.querySelectorAll('#xlsxTable td[data-row][data-col]') as NodeListOf<HTMLElement>;
        visibleCells.forEach((cell) => {
            const row = parseInt(cell.dataset.row || '-1', 10);
            const col = parseInt(cell.dataset.col || '-1', 10);
            if (row < 0 || col < 0) return;

            if (row >= minRow && row <= maxRow && col >= minCol && col <= maxCol) {
                cell.classList.add('selected');
                selectedCells.add(cell);
            }
        });
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
            try {
                const container = document.getElementById('tableContainer');
                if (!container) return;

                // Rescue the toolbar if it's currently inside tableContainer
                const toolbarEl = document.getElementById('toolbar') as HTMLElement | null;
                const toolbarParent = toolbarEl ? toolbarEl.parentElement : null;
                const wasInTableContainer = toolbarParent && container.contains(toolbarParent);
                if (wasInTableContainer && toolbarEl) {
                    document.body.appendChild(toolbarEl); // Keep it safe in the body for a moment
                }

                container.innerHTML = createTableShell();
                ensureHeaderVisible();
                initializeSelection();
                initializeResize();
                initializeHyperlinkHover();
                initializeVirtualScrolling();

                // Put the toolbar back
                if (wasInTableContainer && toolbarManager) {
                    toolbarManager.applyStickyLayout(!!currentSettings.stickyToolbar, 'content', '.table-scroll');
                }
            } finally {
                hideLoading();
            }
        }, 100);
    }

    function initializeResize() {
        const table = document.querySelector('table');
        if (!table) return;

        // Column/row resize handles
        table.addEventListener('mousedown', (e) => {
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
                if (isEditMode) return;
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

        // Double-click to auto-fit or edit
        table.addEventListener('dblclick', (e) => {
            const target = e.target as HTMLElement;
            if (target && target.classList && target.classList.contains('col-resize-handle')) {
                e.preventDefault();
                autoFitColumn(parseInt(target.dataset.col!, 10));
            } else if (target && target.classList && target.classList.contains('row-resize-handle')) {
                if (isEditMode) return;
                e.preventDefault();
                autoFitRow(parseInt(target.dataset.row!, 10));
            } else if (isEditMode) {
                const td = target.closest('td');
                if (td) {
                    enterCellEditMode(td as HTMLElement);
                }
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
        selectionStart = null;
        selectionEnd = null;
        selectionManager.clearSelection();
    }

    function selectCell(cell: HTMLElement, isMulti = false) {
        selectionManager.selectCell(cell, isMulti);
        const row = parseInt(cell.dataset.row || '-1', 10);
        const col = parseInt(cell.dataset.col || '-1', 10);
        if (row >= 0 && col >= 0) {
            if (!isMulti || !selectionStart) {
                selectionStart = { row, col };
            }
            selectionEnd = { row, col };
        }
        syncBorderSelectionFromCell(cell);
    }

    function expandSelectionBoundsForMergedCells(minRow: number, maxRow: number, minCol: number, maxCol: number) {
        let expandedMinRow = minRow;
        let expandedMaxRow = maxRow;
        let expandedMinCol = minCol;
        let expandedMaxCol = maxCol;

        let changed = true;
        while (changed) {
            changed = false;
            (mergedCells || []).forEach((range: any) => {
                const r0 = Math.max(0, (range?.startRow || 1) - 1);
                const r1 = Math.max(r0, (range?.endRow || r0 + 1) - 1);
                const c0 = Math.max(0, (range?.startCol || 1) - 1);
                const c1 = Math.max(c0, (range?.endCol || c0 + 1) - 1);

                const intersects = !(r1 < expandedMinRow || r0 > expandedMaxRow || c1 < expandedMinCol || c0 > expandedMaxCol);
                if (!intersects) return;

                const nextMinRow = Math.min(expandedMinRow, r0);
                const nextMaxRow = Math.max(expandedMaxRow, r1);
                const nextMinCol = Math.min(expandedMinCol, c0);
                const nextMaxCol = Math.max(expandedMaxCol, c1);

                if (nextMinRow !== expandedMinRow || nextMaxRow !== expandedMaxRow || nextMinCol !== expandedMinCol || nextMaxCol !== expandedMaxCol) {
                    expandedMinRow = nextMinRow;
                    expandedMaxRow = nextMaxRow;
                    expandedMinCol = nextMinCol;
                    expandedMaxCol = nextMaxCol;
                    changed = true;
                }
            });
        }

        return {
            minRow: expandedMinRow,
            maxRow: expandedMaxRow,
            minCol: expandedMinCol,
            maxCol: expandedMaxCol
        };
    }

    function selectRange(startRow: number, startCol: number, endRow: number, endCol: number) {
        const bounds = expandSelectionBoundsForMergedCells(
            Math.min(startRow, endRow),
            Math.max(startRow, endRow),
            Math.min(startCol, endCol),
            Math.max(startCol, endCol)
        );

        selectionStart = { row: startRow, col: startCol };
        selectionEnd = { row: endRow, col: endCol };
        selectionManager.selectRange(bounds.minRow, bounds.minCol, bounds.maxRow, bounds.maxCol);
    }

    function selectRow(rowIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        selectionStart = null;
        selectionEnd = null;
        selectionManager.selectRow(rowIndex, ctrlKey, shiftKey);
    }

    function selectColumn(colIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        selectionStart = null;
        selectionEnd = null;
        selectionManager.selectColumn(colIndex, ctrlKey, shiftKey);
    }

    function updateSelectionInfo() {
        selectionManager.updateSelectionInfo();
        if (activeCell) {
            syncBorderSelectionFromCell(activeCell);
        }
    }

    function copySelection() {
        copySelectionToClipboard();
    }

    async function copySelectionToClipboard() {
        await copySelectionToClipboardHelper({
            selectedCells,
            selectedColumnIndices,
            selectedRowIndices,
            columnCount,
            totalRows,
            rowCache,
            isCopying,
            setIsCopying: (next) => {
                isCopying = next;
            },
            showToast,
            requestAllRows,
            normalizeCellText
        });
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
                    if (isCellEditing && cellTarget.getAttribute('contenteditable') === 'true') {
                        return;
                    }

                    const row = parseInt(cellTarget.dataset.row!, 10);
                    const col = parseInt(cellTarget.dataset.col!, 10);
                    const wasSingleActiveCell = activeCell === cellTarget && selectedCells.size === 1;

                    if (formatPainterArmed && formatPainterStyle) {
                        formatPainterExecuting = true;
                        pendingEditCell = null;
                        pendingEditDrag = false;
                    }

                    if (e.ctrlKey || e.metaKey) {
                        pendingEditCell = null;
                        pendingEditDrag = false;
                        selectionStart = null;
                        selectionEnd = null;
                        if (cellTarget.classList.contains('selected')) {
                            cellTarget.classList.remove('selected');
                            selectedCells.delete(cellTarget);
                            if (cellTarget === activeCell) {
                                activeCell = null;
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
                    } else if (e.shiftKey && activeCell) {
                        pendingEditCell = null;
                        pendingEditDrag = false;
                        const startRow = parseInt(activeCell.dataset.row!, 10);
                        const startCol = parseInt(activeCell.dataset.col!, 10);
                        selectRange(startRow, startCol, row, col);
                    } else {
                        clearSelection();
                        selectCell(cellTarget);
                        isSelecting = true;
                        selectionStart = { row, col };
                        selectionEnd = { row, col };
                        pendingEditCell = (wasSingleActiveCell && !formatPainterExecuting) ? cellTarget : null;
                        pendingEditDrag = false;
                    }

                    if (!isCellEditing) {
                        e.preventDefault();
                    }
                    updateSelectionInfo();
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
            if (isCellEditing) return;
            if (!isSelecting || !selectionStart) return;

            // Track last mouse position for auto-scroll
            lastMousePos = { x: e.clientX, y: e.clientY };

            const target = (e.target as HTMLElement).closest('td') as HTMLElement;
            if (!target) return;

            const row = parseInt(target.dataset.row!, 10);
            const col = parseInt(target.dataset.col!, 10);

            if (!selectionEnd || selectionEnd.row !== row || selectionEnd.col !== col) {
                selectionEnd = { row, col };
                pendingEditDrag = true;
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

            if (target.closest('#xlsxEditFormattingStrip select') || target.closest('#sheetFindOverlay input')) {
                return;
            }

            const container = document.getElementById('tableContainer') as HTMLElement | null;
            if (!container) return;
            if (!container.hasAttribute('tabindex')) {
                container.setAttribute('tabindex', '-1');
            }
            container.focus({ preventScroll: true });
        }, true);

        document.addEventListener('mouseup', () => {
            if (formatPainterExecuting && formatPainterStyle) {
                applyFormatToLogicalSelection(formatPainterStyle, 'set');
                formatPainterExecuting = false;
                formatPainterArmed = false;
                formatPainterStyle = null;
                document.body.classList.remove('format-painter-armed');
                showToast('Formatting applied');
            }

            const shouldStartEdit = !!pendingEditCell && !pendingEditDrag;
            const targetToEdit = pendingEditCell;
            pendingEditCell = null;
            pendingEditDrag = false;
            isSelecting = false;
            lastMousePos = null;
            stopAutoScroll();

            if (shouldStartEdit && targetToEdit && isEditMode && !isCellEditing) {
                enterCellEditMode(targetToEdit);
            }
        });

        document.addEventListener('keydown', (e) => {
            const isCmdOrCtrl = e.ctrlKey || e.metaKey;
            const target = e.target as HTMLElement | null;

            if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                toggleFindOverlay();
                return;
            }

            if (e.key === 'F3') {
                e.preventDefault();
                void navigateFind(e.shiftKey ? 'prev' : 'next');
                return;
            }

            if (target && (target.closest('#sheetFindOverlay') || target.closest('#sheetFindInput') || target.closest('#sheetFindNext') || target.closest('#sheetFindPrev') || target.closest('#sheetFindClose'))) {
                return;
            }

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

            if (!isCellEditing) {
                const key = e.key;
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(key)) {
                    e.preventDefault();
                    
                    if (key === 'Enter') {
                        if (isEditMode && activeCell) {
                            enterCellEditMode(activeCell);
                        } else if (activeCell) {
                            moveSelection(1, 0, e.shiftKey);
                        }
                        return;
                    }

                    let rowDelta = 0;
                    let colDelta = 0;
                    if (key === 'ArrowUp') rowDelta = -1;
                    if (key === 'ArrowDown') rowDelta = 1;
                    if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) colDelta = -1;
                    if (key === 'ArrowRight' || (key === 'Tab' && !e.shiftKey)) colDelta = 1;

                    moveSelection(rowDelta, colDelta, e.shiftKey);
                    return;
                }

                if (isEditMode && activeCell && e.key.length === 1 && !isCmdOrCtrl && !e.altKey) {
                    enterCellEditMode(activeCell);
                    return;
                }
                
                if (e.key === 'F2' && isEditMode && activeCell) {
                    e.preventDefault();
                    enterCellEditMode(activeCell);
                    return;
                }
            } else {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    exitCellEditMode();
                    moveSelection(1, 0, false);
                    return;
                }
                if (e.key === 'Tab') {
                    e.preventDefault();
                    exitCellEditMode();
                    moveSelection(0, e.shiftKey ? -1 : 1, false);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    const active = document.activeElement as HTMLElement;
                    if (active && active.tagName === 'TD') {
                        active.innerHTML = active.dataset.originalHtml || '';
                    }
                    exitCellEditMode();
                    if (activeCell) activeCell.focus();
                    return;
                }
            }

            if (isEditMode) {
                if (isCmdOrCtrl && (e.key.toLowerCase() === 'z')) {
                    e.preventDefault();
                    const active = document.activeElement as HTMLElement | null;
                    const isEditingCell = !!active && active.tagName === 'TD' && active.getAttribute('contenteditable') === 'true';
                    if (isEditingCell) {
                        if (e.shiftKey) document.execCommand('redo');
                        else document.execCommand('undo');
                    } else {
                        if (e.shiftKey) {
                            if (!redoEditAction()) {
                                document.execCommand('redo');
                            }
                        } else if (!undoEditAction()) {
                            document.execCommand('undo');
                        }
                    }
                    return;
                }

                if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    const active = document.activeElement as HTMLElement | null;
                    const isEditingCell = !!active && active.tagName === 'TD' && active.getAttribute('contenteditable') === 'true';
                    if (isEditingCell) {
                        document.execCommand('redo');
                    } else if (!redoEditAction()) {
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

                if (isCmdOrCtrl && e.key.toLowerCase() === 'u') {
                    e.preventDefault();
                    applyStrikeThrough();
                    return;
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

            if (isCellEditing && !target.closest('td[contenteditable="true"]')) {
                exitCellEditMode();
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
            toolbarManager.applyStickyLayout(isEditMode ? true : !!currentSettings.stickyToolbar, 'content', '.table-scroll');
            setTimeout(() => toolbarManager?.updateHeaderHeight(), 0);
        } else {
            document.body.classList.toggle('sticky-toolbar-enabled', isEditMode ? true : !!currentSettings.stickyToolbar);
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

    function enterCellEditMode(cell: HTMLElement, clearContent = false) {
        if (!isEditMode) return;
        if (isCellEditing) {
            exitCellEditMode();
        }
        isCellEditing = true;
        cell.setAttribute('contenteditable', 'true');
        cell.setAttribute('spellcheck', 'false');
        cell.focus();
        
        if (clearContent) {
            cell.textContent = '';
        } else {
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(cell);
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }

    function exitCellEditMode() {
        if (!isCellEditing) return;
        isCellEditing = false;
        const active = document.activeElement as HTMLElement;
        if (active && active.tagName === 'TD') {
            active.removeAttribute('contenteditable');
            active.blur();
        }
        document.querySelectorAll('td[contenteditable="true"]').forEach(td => {
            td.removeAttribute('contenteditable');
        });
    }

    async function moveSelection(rowDelta: number, colDelta: number, shiftKey: boolean) {
        if (!activeCell) return;
        
        let currentR = parseInt(activeCell.getAttribute('data-row') || '0', 10);
        let currentC = parseInt(activeCell.getAttribute('data-col') || '0', 10);
        
        if (shiftKey && selectionEnd) {
            currentR = selectionEnd.row;
            currentC = selectionEnd.col;
        }
        
        let nextR = currentR + rowDelta;
        let nextC = currentC + colDelta;
        
        nextR = Math.max(0, Math.min(totalRows - 1, nextR));
        nextC = Math.max(0, Math.min(columnCount - 1, nextC));
        
        let nextCell = document.querySelector(`td[data-row="${nextR}"][data-col="${nextC}"]`) as HTMLElement;
        
        if (!nextCell) {
            const container = getTableContainer();
            if (container) {
                let top = 0;
                for (let i = 0; i < nextR; i++) {
                    top += getEffectiveRowHeightByIndex(i);
                }
                container.scrollTop = Math.max(0, top - 100);
                await updateVisibleRows();
                nextCell = document.querySelector(`td[data-row="${nextR}"][data-col="${nextC}"]`) as HTMLElement;
            }
        }

        if (nextCell) {
            if (shiftKey) {
                if (!selectionStart) {
                    selectionStart = { 
                        row: parseInt(activeCell.getAttribute('data-row') || '0', 10), 
                        col: parseInt(activeCell.getAttribute('data-col') || '0', 10) 
                    };
                }
                selectionEnd = { row: nextR, col: nextC };
                selectionManager.selectRange(selectionStart.row, selectionStart.col, selectionEnd.row, selectionEnd.col);
            } else {
                selectionStart = { row: nextR, col: nextC };
                selectionEnd = { row: nextR, col: nextC };
                selectionManager.selectCell(nextCell);
            }
            
            const container = getTableContainer();
            if (container) {
                const cellRect = nextCell.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const headerOffset = 30;
                const rowHeaderOffset = 50;
                
                if (cellRect.bottom > containerRect.bottom) {
                    container.scrollTop += cellRect.bottom - containerRect.bottom + 10;
                } else if (cellRect.top < containerRect.top + headerOffset) {
                    container.scrollTop -= (containerRect.top + headerOffset) - cellRect.top + 10;
                }
                
                if (cellRect.right > containerRect.right) {
                    container.scrollLeft += cellRect.right - containerRect.right + 10;
                } else if (cellRect.left < containerRect.left + rowHeaderOffset) {
                    container.scrollLeft -= (containerRect.left + rowHeaderOffset) - cellRect.left + 10;
                }
            }
        }
    }

    function setEditMode(enabled: boolean) {
        if (enabled && isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

        isEditMode = !!enabled;
        document.body.classList.toggle('edit-mode', isEditMode);

        const toolbarEl = document.getElementById('toolbar') as HTMLElement | null;
        if (toolbarEl) {
            toolbarEl.classList.remove('hidden');
            toolbarEl.style.removeProperty('display');
        }

        ensureHeaderVisible();

        if (isEditMode) {
            const globalTip = document.querySelector('.global-tooltip') as HTMLElement | null;
            if (globalTip) {
                globalTip.style.opacity = '0';
                globalTip.style.visibility = 'hidden';
            }
        }

        if (toolbarManager) {
            toolbarManager.applyStickyLayout(isEditMode ? true : !!currentSettings.stickyToolbar, 'content', '.table-scroll');
        }

        const sheetSelector = document.getElementById('sheetSelector');
        const toggleExpandButton = document.getElementById('toggleExpandButton');
        const togglePlainViewButton = document.getElementById('togglePlainViewButton');
        const versionHistoryButton = document.getElementById('versionHistoryButton');
        const openSettingsButton = document.getElementById('openSettingsButton');
        const toggleBackgroundButton = document.getElementById('toggleBackgroundButton');
        const helpButton = document.getElementById('helpButton');
        const convertFileButton = document.getElementById('convertFileButton');

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
            toolbarManager.setButtonVisibility('formatBoldButton', false);
            toolbarManager.setButtonVisibility('formatItalicButton', false);
            toolbarManager.setButtonVisibility('formatTextColorButton', false);
            toolbarManager.setButtonVisibility('formatBackgroundColorButton', false);
        } else {
            if (toggleTableEditButton) toggleTableEditButton.classList.toggle('hidden', isEditMode);
            if (saveTableEditsButton) saveTableEditsButton.classList.toggle('hidden', !isEditMode);
            if (cancelTableEditsButton) cancelTableEditsButton.classList.toggle('hidden', !isEditMode);
            if (formatBoldButton) formatBoldButton.classList.add('hidden');
            if (formatItalicButton) formatItalicButton.classList.add('hidden');
            if (formatTextColorButton) formatTextColorButton.classList.add('hidden');
            if (formatBackgroundColorButton) formatBackgroundColorButton.classList.add('hidden');
        }

        if (editFormattingStripEl) {
            editFormattingStripEl.classList.toggle('hidden', !isEditMode);
        }

        if (sheetSelector) sheetSelector.classList.toggle('hidden', isEditMode);
        if (toggleExpandButton) toggleExpandButton.classList.remove('hidden');
        if (togglePlainViewButton) togglePlainViewButton.classList.toggle('hidden', isEditMode);
        if (versionHistoryButton) versionHistoryButton.classList.toggle('hidden', isEditMode);
        if (openSettingsButton) openSettingsButton.classList.remove('hidden');
        if (toggleBackgroundButton) toggleBackgroundButton.classList.toggle('hidden', isEditMode);
        if (helpButton) helpButton.classList.toggle('hidden', isEditMode);
        if (convertFileButton) convertFileButton.classList.toggle('hidden', isEditMode);

        reorderToolbarAroundFind(isEditMode);

        if (!isEditMode) {
            exitCellEditMode();
            hideLinkTooltip();
            hideHeaderContextMenu();
            hideColorPalette();
            hideBorderPopup();
            clearSelection();
            lastEditRange = null;
            pendingWorksheetOps = [];
            pendingCellStyleEdits.clear();
            editUndoStack.length = 0;
            editRedoStack.length = 0;
            formatPainterArmed = false;
            formatPainterStyle = null;
            document.body.classList.remove('format-painter-armed');
            return;
        }

        clearSelection();
        editUndoStack.length = 0;
        editRedoStack.length = 0;

        // Enable contenteditable for table cells
        const table = document.querySelector('#tableContainer table');
        if (!table) return;
        table.querySelectorAll('td').forEach(td => {
            td.classList.add('editable-cell');
            const htmlTd = td as HTMLElement;
            const currentText = normalizeCellText(htmlTd.textContent || '');
            htmlTd.dataset.originalText = currentText;
            htmlTd.dataset.originalHtml = htmlTd.innerHTML;
        });

        captureOriginalCellValues();
    }

    function captureOriginalCellValues() {
        const table = document.querySelector('#tableContainer table');
        if (!table) return;
        table.querySelectorAll('td.editable-cell').forEach(td => {
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
        table.querySelectorAll('td.editable-cell').forEach(td => {
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
            onFind: () => openFindOverlay(),
            textColorIcon,
            bgColorIcon,
            onToggleTableEdit: () => setEditMode(true),
            onSaveTableEdits: () => saveEdits(true),
            onCancelTableEdits: () => {
                setEditMode(false);
                renderWorksheet(currentWorksheet);
                setTimeout(() => {
                    hideLoading();
                    ensureHeaderVisible();
                    const toolbarEl = document.getElementById('toolbar') as HTMLElement | null;
                    if (toolbarEl) {
                        toolbarEl.classList.remove('hidden');
                        toolbarEl.style.display = 'flex';
                    }
                    toolbarManager?.updateHeaderHeight();
                }, 180);
            },
            onFormatBold: () => applyEditFormatting('bold'),
            onFormatItalic: () => applyEditFormatting('italic'),
            onFormatTextColor: () => {},
            onFormatBackgroundColor: () => {},
            onToggleExpand: () => {
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
            onConvertFile: () => {
                if (isEditMode) return;
                vscode.postMessage({ command: 'convertFile' });
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
                const thead = document.querySelector('#xlsxTable thead') as HTMLElement | null;
                if (thead) thead.style.display = 'table-header-group';
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
