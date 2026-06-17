/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { ThemeManager } from '../shared/themeManager';
import { SettingsManager } from '../shared/settingsManager';
import { ToolbarManager } from '../shared/toolbarManager';
import { applyToolbarLayout } from '../shared/toolbarLayout';
import { Utils } from '../shared/utils';
import { Icons } from '../shared/icons';
import { vscode, VirtualScrollConfig, debounce } from '../shared/common';
import { VirtualLoader } from '../shared/virtualLoader';
import { InfoTooltip } from '../shared/infoTooltip';
import { createXlsxRowHtml, getExcelColumnLabel, renderDropdownCellContent } from './components/spreadsheetRenderComponent';
import { XlsxSelectionManager } from './components/spreadsheetSelectionComponent';
import { createXlsxToolbarButtons } from './components/spreadsheetToolbarComponent';
import { FeedbackModal } from '../shared/feedbackModal';
import { ProjectsModal } from '../shared/projectsModal';
import {
    XlsxViewSettings,
    defaultXlsxViewSettings,
    normalizeXlsxSettings,
    syncSettingsCheckboxes,
    createXlsxSettingsDefinitions
} from './components/spreadsheetSettingsComponent';
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
} from './components/spreadsheetBorderComponent';
import type {
    StructuralOpType,
    WorksheetOpType,
    InsertControlType,
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
} from './components/spreadsheetTypes';
import {
    cloneCellData,
    getCellFromRow,
    setCellOnRow,
    normalizeRowsAfterStructureChange,
    cloneWorksheetOps
} from './components/spreadsheetSheetDataComponent';
import {
    normalizeColorToHex,
    getCellRichRuns,
    hasRunFormatting
} from './components/spreadsheetRichTextComponent';
import { XlsxFindManager } from './components/spreadsheetFindComponent';
import { copySelectionToClipboard as copySelectionToClipboardHelper, writeToClipboardAsync } from './components/spreadsheetCopyComponent';

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
    let rowOffsetPrefix: number[] = [0]; // Prefix sum: offset at row i
    let rowMetricsVersion = 0;
    let rowOffsetPrefixVersion = -1;
    let rowCache = new Map<number, any>();
    const virtualLoader = new VirtualLoader<any[]>('getRows');
    const MIN_ROW_HEADER_WIDTH = 40;
    let currentRowHeaderWidth = MIN_ROW_HEADER_WIDTH;
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

    type SettingsScope = 'plain' | 'styled';

    const defaultPlainViewSettings: XlsxViewSettings = {
        ...defaultXlsxViewSettings,
        autoSave: true,
        autoSaveMode: 'all',
        showManualSavePopup: false
    };

    // Settings (persisted by extension)
    let currentSettings: XlsxViewSettings = { ...defaultXlsxViewSettings };
    let plainModeSettings: XlsxViewSettings = { ...defaultPlainViewSettings };
    let styledModeSettings: XlsxViewSettings = { ...defaultXlsxViewSettings };
    let hasVirtualTableInit = false;

    // Table edit mode (text-only)
    let isEditMode = false;
    let isCellEditing = false;
    let activeTextEditBeforeState: CellUndoState | null = null;
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
    let insertControlPopupEl: HTMLElement | null = null;
    let dropdownOptionsPopupEl: HTMLElement | null = null;
    let dropdownOptionsResolver: ((options: string[] | null) => void) | null = null;
    let mergeWarningPopupEl: HTMLElement | null = null;
    let mergeWarningResolver: ((confirmed: boolean) => void) | null = null;
    let styleModeNoticePopupEl: HTMLElement | null = null;
    let formatPainterStyle: Partial<CellStyleEdit> | null = null;
    let formatPainterArmed = false;
    let formatPainterExecuting = false;
    const MERGE_WARNING_SUPPRESS_UNTIL_KEY = 'xlsx.mergeWarningSuppressUntil';

    const editUndoStack: EditUndoEntry[] = [];
    const editRedoStack: EditUndoEntry[] = [];
    const pendingControlUndoState = new WeakMap<HTMLElement, CellUndoState>();
    const DEFAULT_DROPDOWN_OPTIONS_TEMPLATE = 'Option 1\nOption 2\nOption 3';

    let findManager: XlsxFindManager | null = null;

    // Save state (CSV-parity)
    let isSaving = false;
    let exitAfterSave = false;
    let autoSaveTimer: any = null;
    let manualSaveReminderUntil = 0;
    let pendingOutsideControlEdits: Array<{ row: number; col: number; value: string }> = [];
    let isVersionPreviewMode = false;
    let previewVersionId: string | null = null;
    let imagePreviewOverlayEl: HTMLElement | null = null;

    // Plain view mode (removes all XLSX styling)
    let isPlainView = false;
    let isTemporaryStyleFile = false;
    let styleModeRequestPending = false;
    let pendingStyleModeAction: (() => void) | null = null;

    type FilterMode = 'contains' | 'equals' | 'startsWith' | 'nonEmpty';
    type SortDirection = 'asc' | 'desc';

    interface ColumnFilterState {
        columnIndex: number;
        mode: FilterMode;
        query: string;
        caseSensitive: boolean;
    }

    const MAX_ROWS_FOR_CLIENT_DATA_OPS = 120000;
    let baseTotalRows = 0;
    let baseRowHeights: number[] = [];
    let sourceRowsSnapshot: any[] | null = null;
    let transformedRowsSnapshot: any[] | null = null;
    const activeColumnFilters = new Map<number, ColumnFilterState>();
    let activeSortState: { columnIndex: number; direction: SortDirection } | null = null;

    // Hyperlink hover tooltip
    let linkTooltip: HTMLElement | null = null;
    let linkTooltipHideTimer: any = null;

    // Toast
    let toastEl: HTMLElement | null = null;

    // Copy state (CSV-parity: avoid concurrent copies)
    let isCopying = false;
    let pasteListenerAttached = false;

    type XlsxAutoSaveChangeKind = 'text' | 'control' | 'format' | 'structure';

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

    function ensureInsertControlPopup() {
        if (insertControlPopupEl) {
            return insertControlPopupEl;
        }

        const popup = document.createElement('div');
        popup.id = 'xlsxInsertControlPopup';
        popup.className = 'xlsx-insert-control-popup hidden';
        popup.innerHTML = `
            <div class="insert-control-title">Insert into selected cells</div>
            <button type="button" class="insert-control-item" data-control-type="checkbox">Checkbox</button>
            <button type="button" class="insert-control-item" data-control-type="dropdown">Dropdown</button>
            <button type="button" class="insert-control-item" data-control-type="rating">Stars (Rating)</button>
            <button type="button" class="insert-control-item" data-control-type="date">Date</button>
        `;

        popup.querySelectorAll('.insert-control-item').forEach((item) => {
            item.addEventListener('click', async (event) => {
                event.stopPropagation();
                const btn = item as HTMLButtonElement;
                const type = (btn.getAttribute('data-control-type') || '') as InsertControlType;
                if (!type) return;
                await insertControlIntoSelection(type);
            });
        });

        document.body.appendChild(popup);
        insertControlPopupEl = popup;
        return popup;
    }

    function hideInsertControlPopup() {
        if (!insertControlPopupEl) return;
        insertControlPopupEl.classList.add('hidden');
    }

    function showInsertControlPopup(anchor: HTMLElement) {
        if (!isEditMode) {
            showToast('Enter edit mode to insert controls');
            return;
        }

        const popup = ensureInsertControlPopup();
        popup.classList.remove('hidden');

        const rect = anchor.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - popupRect.width - 8);
        const top = Math.min(rect.bottom + 6, window.innerHeight - popupRect.height - 8);
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
    }

    function parseDropdownOptionsInput(raw: string): string[] {
        return raw
            .split(/[\n,;|]+/)
            .map((item) => item.trim())
            .filter((item, idx, arr) => item.length > 0 && arr.indexOf(item) === idx)
            .slice(0, 80);
    }

    function hideDropdownOptionsPopup(options: string[] | null = null) {
        if (!dropdownOptionsPopupEl) return;
        dropdownOptionsPopupEl.classList.add('hidden');

        const resolver = dropdownOptionsResolver;
        dropdownOptionsResolver = null;
        if (resolver) {
            resolver(options);
        }
    }

    function ensureDropdownOptionsPopup() {
        if (dropdownOptionsPopupEl) {
            return dropdownOptionsPopupEl;
        }

        const popup = document.createElement('div');
        popup.id = 'xlsxDropdownOptionsPopup';
        popup.className = 'xlsx-dropdown-options-popup hidden';
        popup.innerHTML = `
            <div class="xlsx-dropdown-options-dialog" role="dialog" aria-modal="true" aria-labelledby="dropdownOptionsTitle">
                <div id="dropdownOptionsTitle" class="dropdown-options-title">Dropdown options</div>
                <div class="dropdown-options-message">Enter one option per line. Comma, semicolon, and | are also supported.</div>
                <textarea id="dropdownOptionsInput" class="dropdown-options-input" spellcheck="false"></textarea>
                <div class="dropdown-options-actions">
                    <button id="dropdownOptionsCancel" type="button" class="toggle-button">Cancel</button>
                    <button id="dropdownOptionsInsert" type="button" class="toggle-button">Insert</button>
                </div>
            </div>
        `;

        popup.addEventListener('click', (event) => {
            if (event.target === popup) {
                hideDropdownOptionsPopup(null);
            }
        });

        const cancelBtn = popup.querySelector('#dropdownOptionsCancel') as HTMLButtonElement | null;
        const insertBtn = popup.querySelector('#dropdownOptionsInsert') as HTMLButtonElement | null;
        const input = popup.querySelector('#dropdownOptionsInput') as HTMLTextAreaElement | null;

        cancelBtn?.addEventListener('click', () => {
            hideDropdownOptionsPopup(null);
        });

        insertBtn?.addEventListener('click', () => {
            const options = parseDropdownOptionsInput(input?.value || '');
            if (!options.length) {
                showToast('Add at least one dropdown option');
                input?.focus();
                return;
            }
            hideDropdownOptionsPopup(options);
        });

        input?.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                insertBtn?.click();
            }
        });

        document.body.appendChild(popup);
        dropdownOptionsPopupEl = popup;
        return popup;
    }

    async function promptDropdownOptions(initialOptions: string[] = [], confirmLabel: string = 'Insert'): Promise<string[] | null> {
        if (dropdownOptionsResolver) {
            dropdownOptionsResolver(null);
            dropdownOptionsResolver = null;
        }

        const popup = ensureDropdownOptionsPopup();
        const input = popup.querySelector('#dropdownOptionsInput') as HTMLTextAreaElement | null;
        const confirmButton = popup.querySelector('#dropdownOptionsInsert') as HTMLButtonElement | null;
        if (input) {
            const seed = initialOptions
                .map((item) => String(item || '').trim())
                .filter((item, idx, arr) => item.length > 0 && arr.indexOf(item) === idx)
                .slice(0, 80);
            input.value = seed.length ? seed.join('\n') : DEFAULT_DROPDOWN_OPTIONS_TEMPLATE;
        }

        if (confirmButton) {
            confirmButton.textContent = confirmLabel;
        }

        popup.classList.remove('hidden');

        requestAnimationFrame(() => {
            input?.focus();
            input?.select();
        });

        return await new Promise<string[] | null>((resolve) => {
            dropdownOptionsResolver = resolve;
        });
    }

    function getDropdownOptionsFromCell(cell: HTMLElement): string[] {
        const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
        if (!select) {
            return [];
        }

        const unique = new Set<string>();
        Array.from(select.options).forEach((opt) => {
            const text = String(opt.value || '').trim();
            if (text) {
                unique.add(text);
            }
        });
        return Array.from(unique.values()).slice(0, 80);
    }

    async function editDropdownOptionsForCell(cell: HTMLElement) {
        if (!isEditMode) {
            showToast('Enter edit mode to edit dropdown options');
            return;
        }

        if (getCellType(cell) !== 'dropdown') {
            return;
        }

        const row = parseInt(cell.getAttribute('data-row') || '-1', 10);
        const col = parseInt(cell.getAttribute('data-col') || '-1', 10);
        if (row < 0 || col < 0) {
            return;
        }

        const cellData = getOrCreateRowCellData(row, col);
        const existingOptions = Array.isArray(cellData.dropdownOptions) && cellData.dropdownOptions.length
            ? cellData.dropdownOptions.map((item: any) => String(item || '').trim()).filter((item: string) => !!item)
            : getDropdownOptionsFromCell(cell);

        const configuredOptions = await promptDropdownOptions(existingOptions, 'Apply');
        if (!configuredOptions || !configuredOptions.length) {
            return;
        }

        const beforeSnapshot = captureWorksheetStateSnapshot();
        const currentValue = getCellNormalizedValue(cell);
        const nextValue = configuredOptions.includes(currentValue) ? currentValue : configuredOptions[0];

        cellData.cellType = 'dropdown';
        cellData.dropdownOptions = [...configuredOptions];
        cellData.value = nextValue;

        const rowNumber = row + 1;
        const colNumber = col + 1;

        pendingWorksheetOps.push({
            type: 'insertControl',
            row: rowNumber,
            col: colNumber,
            controlType: 'dropdown',
            dropdownOptions: [...configuredOptions],
            defaultValue: nextValue
        });

        cell.innerHTML = renderDropdownCellContent({
            options: configuredOptions,
            selectedValue: nextValue,
            allowInteractiveControls: areInteractiveControlsEnabled(),
            showEditButton: isEditMode
        });
        updateDropdownCellPresentation(cell, nextValue);
        applyInteractiveControlState(cell);

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);
        scheduleAutoSave('control');
        showToast('Dropdown options updated');
    }

    function getOrCreateRowCellData(rowIndex: number, colIndex: number): any {
        const rowNumber = rowIndex + 1;
        const colNumber = colIndex + 1;

        const rowData = rowCache.get(rowIndex) || {
            rowNumber,
            cells: [],
            height: allRowHeights[rowIndex] || ROW_HEIGHT
        };

        if (!Array.isArray(rowData.cells)) {
            rowData.cells = [];
        }

        let cellData = rowData.cells.find((cell: any) => cell.colNumber === colNumber);
        if (!cellData) {
            cellData = {
                value: '',
                hyperlink: '',
                style: {},
                colNumber,
                rowNumber,
                isDefaultColor: true,
                hasDefaultBg: true,
                hasWhiteBackground: false,
                hasBlackBorder: false,
                hasWhiteBorder: false,
                hasBlackBackground: false,
                hasDefaultBorder: true,
                originalColor: 'rgb(0, 0, 0)',
                isEmpty: false,
                rowspan: 1,
                colspan: 1,
                isMerged: false,
                isMaster: false,
                isMergeCovered: false,
                masterRow: rowNumber,
                masterCol: colNumber
            };
            rowData.cells.push(cellData);
            rowData.cells.sort((a: any, b: any) => (a.colNumber || 0) - (b.colNumber || 0));
        }

        rowCache.set(rowIndex, rowData);
        return cellData;
    }

    function getTodayIsoDate(): string {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function createInsertedControlInnerHtml(controlType: InsertControlType, defaultValue: string, dropdownOptions: string[]): string {
        if (controlType === 'checkbox') {
            const checked = parseBooleanCellValue(defaultValue);
            return `<span class="cell-content cell-checkbox-content"><input type="checkbox" class="xlsx-cell-checkbox" aria-label="Cell checkbox"${checked ? ' checked' : ''} /><span class="checkbox-value">${checked ? 'TRUE' : 'FALSE'}</span></span>`;
        }

        if (controlType === 'dropdown') {
            const safeDefault = defaultValue || (dropdownOptions[0] || '');
            return renderDropdownCellContent({
                options: dropdownOptions,
                selectedValue: safeDefault,
                allowInteractiveControls: true,
                showEditButton: isEditMode
            });
        }

        if (controlType === 'rating') {
            const rating = normalizeRatingValue(defaultValue);
            let stars = '';
            for (let i = 1; i <= 5; i++) {
                stars += `<button type="button" class="xlsx-rating-star${i <= rating ? ' active' : ''}" data-rating-value="${i}" aria-label="Rate ${i} of 5">★</button>`;
            }
            return `<span class="cell-content cell-rating-content" data-rating-value="${rating}">${stars}<span class="rating-value">${rating || ''}</span></span>`;
        }

        const normalized = normalizeDateInputValue(defaultValue);
        const valueAttr = normalized ? ` value="${Utils.escapeHtml(normalized)}"` : '';
        return `<span class="cell-content cell-date-content"><input type="date" class="xlsx-cell-date" aria-label="Cell date"${valueAttr} /></span>`;
    }

    function applyInsertedControlToDomCell(cell: HTMLElement, controlType: InsertControlType, defaultValue: string, dropdownOptions: string[]) {
        cell.setAttribute('data-cell-type', controlType);
        cell.removeAttribute('data-checkbox-checked');
        cell.removeAttribute('data-dropdown-value');
        cell.removeAttribute('data-rating-value');
        cell.removeAttribute('data-date-value');

        cell.innerHTML = createInsertedControlInnerHtml(controlType, defaultValue, dropdownOptions);

        if (controlType === 'checkbox') {
            cell.setAttribute('data-checkbox-checked', parseBooleanCellValue(defaultValue) ? 'true' : 'false');
        }

        if (controlType === 'dropdown') {
            const nextValue = defaultValue || (dropdownOptions[0] || '');
            cell.setAttribute('data-dropdown-value', nextValue);
            const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
            if (select) {
                select.value = nextValue;
            }
        }

        if (controlType === 'rating') {
            cell.setAttribute('data-rating-value', String(normalizeRatingValue(defaultValue)));
        }

        if (controlType === 'date') {
            cell.setAttribute('data-date-value', normalizeDateInputValue(defaultValue));
        }
    }

    async function insertControlIntoSelection(controlType: InsertControlType) {
        hideInsertControlPopup();

        if (!isEditMode) {
            showToast('Enter edit mode to insert controls');
            return;
        }

        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select one or more cells first');
            return;
        }

        const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
        if (cellCount > 50000) {
            showToast('Selection is too large for control insertion');
            return;
        }

        let dropdownOptions: string[] = [];
        let defaultValue = '';

        if (controlType === 'dropdown') {
            const configuredOptions = await promptDropdownOptions();
            if (!configuredOptions) {
                return;
            }

            dropdownOptions = configuredOptions;
            defaultValue = dropdownOptions[0];
        } else if (controlType === 'checkbox') {
            defaultValue = 'FALSE';
        } else if (controlType === 'rating') {
            defaultValue = '3';
        } else if (controlType === 'date') {
            defaultValue = getTodayIsoDate();
        }

        const loaded = await ensureAllRowsLoadedForStructureEdits(false);
        if (!loaded) {
            return;
        }

        const beforeSnapshot = captureWorksheetStateSnapshot();

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const rowNumber = r + 1;
                const colNumber = c + 1;

                const cellData = getOrCreateRowCellData(r, c);
                cellData.hyperlink = '';
                cellData.cellType = controlType;

                if (controlType === 'checkbox') {
                    cellData.dropdownOptions = ['TRUE', 'FALSE'];
                    cellData.checkboxChecked = false;
                    cellData.value = 'FALSE';
                } else if (controlType === 'dropdown') {
                    cellData.dropdownOptions = [...dropdownOptions];
                    cellData.value = defaultValue;
                } else if (controlType === 'rating') {
                    cellData.dropdownOptions = ['1', '2', '3', '4', '5'];
                    cellData.value = defaultValue;
                } else if (controlType === 'date') {
                    cellData.dropdownOptions = [];
                    cellData.value = defaultValue;
                }

                pendingWorksheetOps.push({
                    type: 'insertControl',
                    row: rowNumber,
                    col: colNumber,
                    controlType,
                    dropdownOptions: dropdownOptions.length ? [...dropdownOptions] : undefined,
                    defaultValue
                });
            }
        }

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                if (!domCell) continue;
                applyInsertedControlToDomCell(domCell, controlType, defaultValue, dropdownOptions);
            }
        }

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

        applyInteractiveControlState();
        showToast('Inserted control');
        scheduleAutoSave('control');
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

    function hideStyleModeNoticePopup() {
        if (!styleModeNoticePopupEl) return;
        styleModeNoticePopupEl.classList.add('hidden');
    }

    function submitStyleModeDecision(decision: 'continue' | 'convert' | 'cancel') {
        hideStyleModeNoticePopup();
        if (!styleModeRequestPending) {
            return;
        }
        vscode.postMessage({ command: 'styleModeDecision', decision });
    }

    function ensureStyleModeNoticePopup() {
        if (styleModeNoticePopupEl) return styleModeNoticePopupEl;

        const popup = document.createElement('div');
        popup.id = 'xlsxStyleModeNoticePopup';
        popup.className = 'xlsx-style-mode-notice-popup hidden';
        popup.innerHTML = `
            <div class="xlsx-style-mode-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="styleModeNoticeTitle">
                <div id="styleModeNoticeTitle" class="style-mode-notice-title">Style Mode for CSV/TSV</div>
                <div class="style-mode-notice-message">CSV/TSV files do not store formatting in the file itself.</div>
                <div class="style-mode-notice-message">
                    Styled edits are saved only as local extension data and expire after 48 hours from the last styled edit.
                    To preserve formatting permanently, convert this file to XLSX.
                </div>
                <div class="style-mode-notice-actions">
                    <button id="styleModeNoticeCancel" type="button" class="toggle-button">Keep Plain Mode</button>
                    <button id="styleModeNoticeContinue" type="button" class="toggle-button">Continue Styled Mode</button>
                    <button id="styleModeNoticeConvert" type="button" class="toggle-button">Convert to XLSX</button>
                </div>
            </div>
        `;

        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                submitStyleModeDecision('cancel');
            }
        });

        const cancelBtn = popup.querySelector('#styleModeNoticeCancel') as HTMLButtonElement | null;
        const continueBtn = popup.querySelector('#styleModeNoticeContinue') as HTMLButtonElement | null;
        const convertBtn = popup.querySelector('#styleModeNoticeConvert') as HTMLButtonElement | null;

        cancelBtn?.addEventListener('click', () => submitStyleModeDecision('cancel'));
        continueBtn?.addEventListener('click', () => submitStyleModeDecision('continue'));
        convertBtn?.addEventListener('click', () => submitStyleModeDecision('convert'));

        popup.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                submitStyleModeDecision('cancel');
            }
        });

        document.body.appendChild(popup);
        styleModeNoticePopupEl = popup;
        return popup;
    }

    function showStyleModeNoticePopup() {
        const popup = ensureStyleModeNoticePopup();
        popup.classList.remove('hidden');
        const continueBtn = popup.querySelector('#styleModeNoticeContinue') as HTMLButtonElement | null;
        continueBtn?.focus();
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
                const top = getRowTopOffset(boundedRow);
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

    async function ensureAllRowsLoadedForStructureEdits(withOverlay = true) {
        if (rowCache.size >= totalRows && totalRows > 0) return true;

        if (withOverlay) {
            setLoadingText('Preparing full sheet for structure changes...');
            showLoading();
        }

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
            if (withOverlay) {
                hideLoading();
                setLoadingText('Rendering worksheet...');
            }
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
        const normalized = Number.isFinite(height) && height > 0 ? height : ROW_HEIGHT;

        // Plain view follows CSV/TSV row metrics exactly.
        if (isPlainView) {
            return 24;
        }

        if (!currentSettings.spaciousCells) {
            return Math.max(normalized, 24);
        }

        return Math.max(normalized + 8, 28);
    }

    function getEffectiveRowHeightByIndex(rowIndex: number): number {
        const base = allRowHeights[rowIndex] || ROW_HEIGHT;
        return getEffectiveRowHeightFromValue(base);
    }

    function invalidateRowMetrics() {
        rowMetricsVersion += 1;
        rowOffsetPrefixVersion = -1;
        rowOffsetPrefix = [0];
        totalContentHeight = 0;
    }

    function ensureRowOffsetPrefix() {
        if (rowOffsetPrefixVersion === rowMetricsVersion && rowOffsetPrefix.length === totalRows + 1) {
            return;
        }

        rowOffsetPrefix = new Array(totalRows + 1);
        rowOffsetPrefix[0] = 0;

        for (let i = 0; i < totalRows; i++) {
            rowOffsetPrefix[i + 1] = rowOffsetPrefix[i] + getEffectiveRowHeightByIndex(i);
        }

        totalContentHeight = rowOffsetPrefix[totalRows] || 0;
        rowOffsetPrefixVersion = rowMetricsVersion;
    }

    function getRowTopOffset(rowIndex: number): number {
        if (totalRows <= 0) return 0;
        ensureRowOffsetPrefix();
        const clamped = Math.max(0, Math.min(rowIndex, totalRows));
        return rowOffsetPrefix[clamped] || 0;
    }

    function getRowHeightRange(startIndex: number, endIndex: number): number {
        if (totalRows <= 0) return 0;
        ensureRowOffsetPrefix();
        const safeStart = Math.max(0, Math.min(startIndex, totalRows));
        const safeEnd = Math.max(safeStart, Math.min(endIndex, totalRows));
        return Math.max(0, (rowOffsetPrefix[safeEnd] || 0) - (rowOffsetPrefix[safeStart] || 0));
    }

    function findRowIndexByOffset(offset: number): number {
        if (totalRows <= 0) return 0;
        ensureRowOffsetPrefix();

        const target = Math.max(0, Math.min(offset, totalContentHeight));
        let low = 0;
        let high = totalRows;

        while (low < high) {
            const mid = Math.floor((low + high + 1) / 2);
            if ((rowOffsetPrefix[mid] || 0) <= target) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return Math.min(Math.max(low, 0), Math.max(totalRows - 1, 0));
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

        if (toolbarManager) {
            applyToolbarLayout(toolbarManager, {
                stickyToolbar: !!currentSettings.stickyToolbar,
                scrollTarget: '#content',
                onLayoutApplied: initializeVirtualScrolling
            });
        }
    }

    function canApplyStructureEdits(): boolean {
        if (isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return false;
        }
        return true;
    }

    function persistStructureChange() {
        if (isEditMode) {
            scheduleAutoSave('structure');
            return;
        }

        if (currentSettings.autoSave) {
            saveEdits(false, true);
            return;
        }

        showManualSaveReminderIfNeeded();
    }

    async function applyStructureOperation(op: StructuralOp) {
        if (!canApplyStructureEdits()) return;

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

            invalidateRowMetrics();
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
        persistStructureChange();
    }

    async function applyCellInsertOperation(type: 'insertCellShiftRight' | 'insertCellShiftDown', rowNumber: number, colNumber: number) {
        if (!canApplyStructureEdits()) return;
        if (rowNumber <= 0 || colNumber <= 0) return;

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) return;

        const beforeSnapshot = captureWorksheetStateSnapshot();
        const rows = getMutableRowsSnapshot();

        if (type === 'insertCellShiftRight') {
            const rowIndex = rowNumber - 1;
            const row = rows[rowIndex];
            if (!row) return;

            const previousColumnCount = columnCount;
            columnCount += 1;
            columnWidths.splice(Math.max(0, previousColumnCount), 0, 80);

            for (let col = previousColumnCount + 1; col > colNumber; col--) {
                const prevCell = getCellFromRow(row, col - 1);
                setCellOnRow(row, col, prevCell ? cloneCellData(prevCell) : null);
            }
            setCellOnRow(row, colNumber, null);
        } else {
            const previousTotalRows = totalRows;
            totalRows += 1;
            allRowHeights.push(ROW_HEIGHT);
            rows.push({ cells: [], rowNumber: totalRows, height: ROW_HEIGHT });
            invalidateRowMetrics();

            for (let row = previousTotalRows; row >= rowNumber; row--) {
                const srcRow = rows[row - 1];
                let dstRow = rows[row];
                if (!dstRow) {
                    dstRow = { cells: [], rowNumber: row + 1, height: allRowHeights[row] || ROW_HEIGHT };
                    rows[row] = dstRow;
                }
                const sourceCell = srcRow ? getCellFromRow(srcRow, colNumber) : null;
                setCellOnRow(dstRow, colNumber, sourceCell ? cloneCellData(sourceCell) : null);
            }

            const targetRow = rows[rowNumber - 1];
            if (targetRow) {
                setCellOnRow(targetRow, colNumber, null);
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
        persistStructureChange();
    }

    async function applyCellDeleteOperation(type: 'deleteCellShiftLeft' | 'deleteCellShiftUp', rowNumber: number, colNumber: number) {
        if (!canApplyStructureEdits()) return;
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
        persistStructureChange();
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
        if (targetType === 'row' && isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

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

        // Add Text wrap menu option for row/column selection
        const menuSeparator = document.createElement('div');
        menuSeparator.className = 'header-context-separator';
        menu.appendChild(menuSeparator);

        const sampleCell = targetType === 'row'
            ? document.querySelector(`td[data-row="${targetIndexZeroBased}"][data-col="0"]`) as HTMLElement | null
            : document.querySelector(`td[data-row="0"][data-col="${targetIndexZeroBased}"]`) as HTMLElement | null;
        const isWrapped = sampleCell ? sampleCell.style.whiteSpace === 'pre-wrap' : false;

        const wrapBtn = document.createElement('button');
        wrapBtn.type = 'button';
        wrapBtn.className = 'header-context-item';
        wrapBtn.textContent = isWrapped ? '✓ Text wrap' : 'Text wrap';
        wrapBtn.addEventListener('click', () => {
            hideHeaderContextMenu();
            const nextMode: WrapMode = isWrapped ? 'overflow' : 'wrap';
            if (targetType === 'row') {
                applyWrapModeToRange(targetIndexZeroBased, targetIndexZeroBased, 0, columnCount - 1, nextMode);
            } else {
                applyWrapModeToRange(0, totalRows - 1, targetIndexZeroBased, targetIndexZeroBased, nextMode);
            }
        });
        menu.appendChild(wrapBtn);

        if (targetType === 'column') {
            const appendSeparator = () => {
                const separator = document.createElement('div');
                separator.className = 'header-context-separator';
                menu.appendChild(separator);
            };

            const appendAction = (label: string, onClick: () => Promise<void> | void, hideBeforeRun = true) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'header-context-item';
                btn.textContent = label;
                btn.addEventListener('click', async () => {
                    if (hideBeforeRun) {
                        hideHeaderContextMenu();
                    }
                    try {
                        await onClick();
                    } catch {
                        showToast('Unable to apply column operation');
                    }
                });
                menu.appendChild(btn);
            };

            const applyColumnFilter = async (mode: FilterMode, query: string, caseSensitive: boolean) => {
                const ready = await ensureSourceRowsSnapshot();
                if (!ready) return;

                const trimmedQuery = query.trim();
                if (mode === 'nonEmpty') {
                    activeColumnFilters.set(colIndex, {
                        columnIndex: colIndex,
                        mode,
                        query: '',
                        caseSensitive: false
                    });
                } else if (!trimmedQuery) {
                    activeColumnFilters.delete(colIndex);
                } else {
                    activeColumnFilters.set(colIndex, {
                        columnIndex: colIndex,
                        mode,
                        query: trimmedQuery,
                        caseSensitive
                    });
                }

                rebuildFilteredRows();
                const hasTransforms = activeSortState || activeColumnFilters.size > 0;
                applyDataOpsRowsToViewport(hasTransforms ? transformedRowsSnapshot : null);

                const filteredCount = hasTransforms && transformedRowsSnapshot ? transformedRowsSnapshot.length : baseTotalRows;
                showToast(hasTransforms ? `Showing ${filteredCount.toLocaleString()} filtered rows` : 'Filter cleared');
            };

            const clearColumnFilter = async () => {
                if (!activeColumnFilters.has(colIndex)) {
                    return;
                }

                activeColumnFilters.delete(colIndex);

                if (!sourceRowsSnapshot) {
                    applyDataOpsRowsToViewport(null);
                    return;
                }

                rebuildFilteredRows();
                if (!activeSortState && activeColumnFilters.size === 0) {
                    applyDataOpsRowsToViewport(null);
                    showToast('Filter cleared');
                    return;
                }

                applyDataOpsRowsToViewport(transformedRowsSnapshot);
                const filteredCount = transformedRowsSnapshot ? transformedRowsSnapshot.length : baseTotalRows;
                showToast(`Showing ${filteredCount.toLocaleString()} filtered rows`);
            };

            const appendFilterPanel = () => {
                const existingFilter = activeColumnFilters.get(colIndex);
                const panel = document.createElement('div');
                panel.className = 'header-filter-panel';
                panel.addEventListener('click', (event) => event.stopPropagation());
                panel.addEventListener('mousedown', (event) => event.stopPropagation());

                const title = document.createElement('div');
                title.className = 'header-filter-title';
                title.textContent = `Filter ${getExcelColumnLabel(colIndex + 1)}`;
                panel.appendChild(title);

                const modeSelect = document.createElement('select');
                modeSelect.className = 'header-filter-select';
                const filterModes: Array<{ value: FilterMode; label: string }> = [
                    { value: 'contains', label: 'Contains' },
                    { value: 'equals', label: 'Equals' },
                    { value: 'startsWith', label: 'Starts with' },
                    { value: 'nonEmpty', label: 'Non-empty' }
                ];
                filterModes.forEach((mode) => {
                    const option = document.createElement('option');
                    option.value = mode.value;
                    option.textContent = mode.label;
                    modeSelect.appendChild(option);
                });
                modeSelect.value = existingFilter?.mode || 'contains';
                panel.appendChild(modeSelect);

                const queryInput = document.createElement('input');
                queryInput.className = 'header-filter-input';
                queryInput.type = 'text';
                queryInput.placeholder = 'Filter value';
                queryInput.value = existingFilter && existingFilter.mode !== 'nonEmpty' ? existingFilter.query : '';
                panel.appendChild(queryInput);

                const caseLabel = document.createElement('label');
                caseLabel.className = 'header-filter-checkbox';
                const caseInput = document.createElement('input');
                caseInput.type = 'checkbox';
                caseInput.checked = !!existingFilter?.caseSensitive;
                caseLabel.appendChild(caseInput);
                caseLabel.appendChild(document.createTextNode('Case sensitive'));
                panel.appendChild(caseLabel);

                const actions = document.createElement('div');
                actions.className = 'header-filter-actions';

                const applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.className = 'header-filter-button primary';
                applyBtn.textContent = 'Apply';

                const clearBtn = document.createElement('button');
                clearBtn.type = 'button';
                clearBtn.className = 'header-filter-button';
                clearBtn.textContent = 'Clear';

                actions.appendChild(applyBtn);
                actions.appendChild(clearBtn);
                panel.appendChild(actions);

                const syncControls = () => {
                    const nonEmpty = modeSelect.value === 'nonEmpty';
                    queryInput.disabled = nonEmpty;
                    caseInput.disabled = nonEmpty;
                    queryInput.placeholder = nonEmpty ? 'No value needed' : 'Filter value';
                };

                const runApply = async () => {
                    hideHeaderContextMenu();
                    await applyColumnFilter(modeSelect.value as FilterMode, queryInput.value, caseInput.checked);
                };

                modeSelect.addEventListener('change', () => {
                    syncControls();
                    if (modeSelect.value !== 'nonEmpty') {
                        queryInput.focus();
                        queryInput.select();
                    }
                });
                queryInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void runApply();
                    } else if (event.key === 'Escape') {
                        hideHeaderContextMenu();
                    }
                });
                applyBtn.addEventListener('click', () => {
                    void runApply();
                });
                clearBtn.addEventListener('click', () => {
                    hideHeaderContextMenu();
                    void clearColumnFilter();
                });

                syncControls();
                menu.appendChild(panel);
            };

            const colIndex = targetIndexZeroBased;
            appendSeparator();

            // First row as header checkbox
            const headerCheckboxLabel = document.createElement('label');
            headerCheckboxLabel.className = 'header-context-checkbox-item';
            headerCheckboxLabel.addEventListener('click', (event) => event.stopPropagation());
            headerCheckboxLabel.addEventListener('mousedown', (event) => event.stopPropagation());

            const headerCheckbox = document.createElement('input');
            headerCheckbox.type = 'checkbox';
            headerCheckbox.className = 'header-context-checkbox';
            headerCheckbox.checked = !!currentSettings.firstRowIsHeader;

            const labelText = document.createTextNode('First row as header');

            headerCheckboxLabel.appendChild(headerCheckbox);
            headerCheckboxLabel.appendChild(labelText);

            headerCheckbox.addEventListener('change', async () => {
                applySettings({ ...currentSettings, firstRowIsHeader: headerCheckbox.checked });
                postSettings();
                if (sourceRowsSnapshot) {
                    rebuildFilteredRows();
                    applyDataOpsRowsToViewport(activeSortState || activeColumnFilters.size > 0 ? transformedRowsSnapshot : null);
                }
            });

            menu.appendChild(headerCheckboxLabel);

            // Show visual indicators for active sorts
            const isAscSorted = activeSortState?.columnIndex === colIndex && activeSortState?.direction === 'asc';
            const isDescSorted = activeSortState?.columnIndex === colIndex && activeSortState?.direction === 'desc';

            appendAction('Sort A to Z' + (isAscSorted ? ' ✓' : ''), async () => {
                const ready = await ensureSourceRowsSnapshot();
                if (!ready) return;

                if (isAscSorted) {
                    // Already sorted A-Z, toggle off
                    activeSortState = null;
                } else {
                    activeSortState = { columnIndex: colIndex, direction: 'asc' };
                }

                rebuildFilteredRows();
                applyDataOpsRowsToViewport(activeSortState || activeColumnFilters.size > 0 ? transformedRowsSnapshot : null);
            });

            appendAction('Sort Z to A' + (isDescSorted ? ' ✓' : ''), async () => {
                const ready = await ensureSourceRowsSnapshot();
                if (!ready) return;

                if (isDescSorted) {
                    // Already sorted Z-A, toggle off
                    activeSortState = null;
                } else {
                    activeSortState = { columnIndex: colIndex, direction: 'desc' };
                }

                rebuildFilteredRows();
                applyDataOpsRowsToViewport(activeSortState || activeColumnFilters.size > 0 ? transformedRowsSnapshot : null);
            });

            appendSeparator();
            appendFilterPanel();
            appendAction('Filter Non-Empty', async () => {
                await applyColumnFilter('nonEmpty', '', false);
            });
            appendAction('Clear Column Filter', async () => {
                await clearColumnFilter();
            });
            appendAction('Clear All Filters/Sort', async () => {
                if (!sourceRowsSnapshot && activeColumnFilters.size === 0 && !activeSortState) {
                    return;
                }
                activeColumnFilters.clear();
                activeSortState = null;
                applyDataOpsRowsToViewport(null);
            });
        }

        menu.classList.remove('hidden');

        const rect = menu.getBoundingClientRect();
        const left = Math.min(Math.max(8, e.clientX), window.innerWidth - rect.width - 8);
        const top = Math.min(Math.max(8, e.clientY), window.innerHeight - rect.height - 8);
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    function showCellContextMenu(e: MouseEvent, cell: HTMLElement) {
        if (isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

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

        appendAction('Copy', () => {
            hideHeaderContextMenu();
            copySelectionToClipboard();
        });
        appendAction('Paste', async () => {
            hideHeaderContextMenu();
            if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                try {
                    const text = await navigator.clipboard.readText();
                    pasteTextAtSelection(text);
                } catch (err) {
                    const text = prompt('Paste content:');
                    if (text !== null) {
                        pasteTextAtSelection(text);
                    }
                }
            } else {
                const text = prompt('Paste content:');
                if (text !== null) {
                    pasteTextAtSelection(text);
                }
            }
        });

        const isWrapped = cell.style.whiteSpace === 'pre-wrap';
        appendAction(isWrapped ? '✓ Text wrap' : 'Text wrap', () => {
            hideHeaderContextMenu();
            const nextMode: WrapMode = isWrapped ? 'overflow' : 'wrap';
            const targets = getEditTargetCells();
            const inSelection = targets.some(c => c === cell);
            if (inSelection) {
                const bounds = getLogicalSelectionBounds();
                if (bounds) {
                    applyWrapModeToRange(bounds.minRow, bounds.maxRow, bounds.minCol, bounds.maxCol, nextMode);
                }
            } else {
                const r = parseInt(cell.getAttribute('data-row') || '0', 10);
                const c = parseInt(cell.getAttribute('data-col') || '0', 10);
                applyWrapModeToRange(r, r, c, c, nextMode);
            }
        });

        const topSeparator = document.createElement('div');
        topSeparator.className = 'header-context-separator';
        menu.appendChild(topSeparator);

        appendAction('Insert row above', () => applyStructureOperation({ type: 'insertRowAbove', index: rowNumber }));
        appendAction('Insert row below', () => applyStructureOperation({ type: 'insertRowBelow', index: rowNumber }));
        appendAction('Insert column left', () => applyStructureOperation({ type: 'insertColumnLeft', index: colNumber }));
        appendAction('Insert column right', () => applyStructureOperation({ type: 'insertColumnRight', index: colNumber }));

        const separator = document.createElement('div');
        separator.className = 'header-context-separator';
        menu.appendChild(separator);

        appendAction('Insert cell and shift right', () => applyCellInsertOperation('insertCellShiftRight', rowNumber, colNumber));
        appendAction('Insert cell and shift down', () => applyCellInsertOperation('insertCellShiftDown', rowNumber, colNumber));
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

    function updatePlainViewButtonLabel() {
        const btn = document.getElementById('togglePlainViewButton');
        if (!btn) return;

        const labelSpan = btn.querySelector('.btn-label');
        if (labelSpan) {
            labelSpan.textContent = isPlainView ? 'Styled' : 'Plain';
        }
    }

    function syncPlainViewUiState() {
        document.body.classList.toggle('plain-view', isPlainView);
        updatePlainViewButtonLabel();
    }

    function isPlainDirectEditMode() {
        return isPlainView && !isVersionPreviewMode;
    }

    function shouldShowSheetSelector() {
        // Show sheet selector if there are multiple sheets, regardless of file type
        return worksheetsMeta && worksheetsMeta.length > 1;
    }

    function syncSheetSelectorVisibility() {
        const selector = document.getElementById('sheetSelector');
        if (!selector) return;
        selector.classList.toggle('hidden', isEditMode || !shouldShowSheetSelector());
    }

    function syncTemporaryFileToolbarActions() {
        const editFileButton = document.getElementById('editFileButton');
        const togglePlainViewButton = document.getElementById('togglePlainViewButton');
        const toggleTableEditButton = document.getElementById('toggleTableEditButton');
        const hideEditTableButton = isPlainDirectEditMode();

        if (toolbarManager) {
            toolbarManager.setButtonVisibility('editFileButton', !!isTemporaryStyleFile && !isEditMode);
            toolbarManager.setButtonVisibility('togglePlainViewButton', !isEditMode || isPlainView);
            toolbarManager.setButtonVisibility('toggleTableEditButton', !isEditMode && !hideEditTableButton);
            return;
        }

        if (editFileButton) {
            editFileButton.classList.toggle('hidden', !isTemporaryStyleFile || isEditMode);
        }
        if (togglePlainViewButton) {
            togglePlainViewButton.classList.toggle('hidden', isEditMode && !isPlainView);
        }
        if (toggleTableEditButton) {
            toggleTableEditButton.classList.toggle('hidden', isEditMode || hideEditTableButton);
        }
    }

    function resolveSettingsScope(scope: any): SettingsScope {
        return scope === 'plain' ? 'plain' : 'styled';
    }

    function getCurrentSettingsScope(): SettingsScope {
        return isPlainView ? 'plain' : 'styled';
    }

    function getStoredSettingsForScope(scope: SettingsScope): XlsxViewSettings {
        return scope === 'plain' ? plainModeSettings : styledModeSettings;
    }

    function setStoredSettingsForScope(scope: SettingsScope, settings: XlsxViewSettings) {
        if (scope === 'plain') {
            plainModeSettings = { ...settings };
            return;
        }
        styledModeSettings = { ...settings };
    }

    function normalizeSettingsForScope(scope: SettingsScope, incoming: any, previous: XlsxViewSettings): XlsxViewSettings {
        const normalized = normalizeXlsxSettings(incoming, previous);
        if (scope === 'plain') {
            normalized.autoSaveMode = 'all';
            normalized.showManualSavePopup = false;
        }
        return normalized;
    }

    function ingestSettingsForScope(scope: SettingsScope, incoming: any) {
        const previous = getStoredSettingsForScope(scope);
        const normalized = normalizeSettingsForScope(scope, incoming, previous);
        setStoredSettingsForScope(scope, normalized);
    }

    function applySettingsForScope(scope: SettingsScope) {
        applySettings(getStoredSettingsForScope(scope), scope);
    }

    function consumeIncomingSettingsPayload(message: any) {
        const incomingScope = resolveSettingsScope(message?.settingsScope);

        if (message?.plainSettings) {
            ingestSettingsForScope('plain', message.plainSettings);
        }
        if (message?.styledSettings) {
            ingestSettingsForScope('styled', message.styledSettings);
        }

        if (message?.settings) {
            const shouldIngestPlain = incomingScope === 'plain' && !message?.plainSettings;
            const shouldIngestStyled = incomingScope === 'styled' && !message?.styledSettings;
            if (shouldIngestPlain) {
                ingestSettingsForScope('plain', message.settings);
            }
            if (shouldIngestStyled) {
                ingestSettingsForScope('styled', message.settings);
            }
        }

        const scopeToApply = hasVirtualTableInit ? getCurrentSettingsScope() : incomingScope;
        applySettingsForScope(scopeToApply);
    }

    function requestStyledMode(nextAction?: () => void) {
        if (!isTemporaryStyleFile || !isPlainView) {
            return false;
        }

        pendingStyleModeAction = nextAction ?? null;
        if (!styleModeRequestPending) {
            styleModeRequestPending = true;
            vscode.postMessage({ command: 'requestStyleMode' });
        }
        return true;
    }

    function activateStyledMode() {
        styleModeRequestPending = false;
        hideStyleModeNoticePopup();
        isPlainView = false;
        syncPlainViewUiState();
        syncTemporaryFileToolbarActions();
        if (isTemporaryStyleFile) {
            vscode.postMessage({ command: 'setPreferredViewMode', mode: 'styled' });
        }
        applySettingsForScope('styled');

        // Flush any pending plain-mode edits before switching so data is not lost.
        // Then request a full re-init from the provider to get fresh data (the
        // provider re-reads the file which contains the auto-saved plain edits).
        if (pendingOutsideControlEdits.length > 0) {
            saveEdits(false, true);
        }
        rowCache.clear();
        currentVisibleStart = 0;
        currentVisibleEnd = 0;
        renderWorksheet(currentWorksheet);

        const nextAction = pendingStyleModeAction;
        pendingStyleModeAction = null;
        if (nextAction) {
            setTimeout(() => {
                try {
                    nextAction();
                } catch {
                    // ignore
                }
            }, 100);
        }
    }

    function cancelStyledModeRequest() {
        styleModeRequestPending = false;
        hideStyleModeNoticePopup();
        pendingStyleModeAction = null;
    }

    function applyEditFormatting(command: string, value?: string) {
        if (requestStyledMode(() => applyEditFormatting(command, value))) {
            return;
        }

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
        if (requestStyledMode(() => applyFormatToLogicalSelection(styleChanges, mode, toggleKey))) {
            return;
        }

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

                    if (currentPending) {
                        if (toggleKey === 'bold') {
                            currentlyEnabled = currentPending.fontWeight === 'bold';
                        } else if (toggleKey === 'italic') {
                            currentlyEnabled = currentPending.fontStyle === 'italic';
                        } else if (toggleKey === 'strike') {
                            currentlyEnabled = !!(currentPending.textDecorationLine?.includes('line-through') || currentPending.textDecoration?.includes('line-through'));
                        } else if (currentPending[toggleKey] !== undefined) {
                            currentlyEnabled = !!currentPending[toggleKey];
                        }
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

    function styleToRendererCss(style: Record<string, any>): Record<string, any> {
        const css: Record<string, any> = {};

        const backgroundColor = typeof style.backgroundColor === 'string' ? style.backgroundColor : (typeof style.bgColor === 'string' ? style.bgColor : '');
        if (backgroundColor) {
            css.backgroundColor = backgroundColor;
        }

        const textColor = typeof style.color === 'string' ? style.color : (typeof style.textColor === 'string' ? style.textColor : '');
        if (textColor) {
            css.color = textColor;
        }

        if (typeof style.fontWeight === 'string') {
            css.fontWeight = style.fontWeight;
        } else if (typeof style.bold === 'boolean') {
            css.fontWeight = style.bold ? 'bold' : 'normal';
        }

        if (typeof style.fontStyle === 'string') {
            css.fontStyle = style.fontStyle;
        } else if (typeof style.italic === 'boolean') {
            css.fontStyle = style.italic ? 'italic' : 'normal';
        }

        const fontSizeValue = style.fontSize;
        if (typeof fontSizeValue === 'string' && fontSizeValue.trim()) {
            css.fontSize = fontSizeValue;
        } else if (typeof fontSizeValue === 'number') {
            css.fontSize = `${fontSizeValue}pt`;
        }

        if (typeof style.fontFamily === 'string') {
            css.fontFamily = style.fontFamily;
        }

        if (typeof style.textDecoration === 'string') {
            css.textDecoration = style.textDecoration;
        }
        if (typeof style.textDecorationLine === 'string') {
            css.textDecorationLine = style.textDecorationLine;
        } else if (typeof style.strike === 'boolean') {
            css.textDecorationLine = style.strike ? 'line-through' : '';
        }
        if (typeof style.textDecorationThickness === 'string') {
            css.textDecorationThickness = style.textDecorationThickness;
        }
        if (typeof style.textDecorationSkipInk === 'string') {
            css.textDecorationSkipInk = style.textDecorationSkipInk;
        }

        if (typeof style.textAlign === 'string') {
            css.textAlign = style.textAlign;
        } else if (typeof style.horizontalAlign === 'string') {
            css.textAlign = style.horizontalAlign;
        }

        if (typeof style.verticalAlign === 'string') {
            css.verticalAlign = style.verticalAlign;
        }

        if (typeof style.whiteSpace === 'string') {
            css.whiteSpace = style.whiteSpace;
        }
        if (typeof style.wordWrap === 'string') {
            css.wordWrap = style.wordWrap;
        }
        if (typeof style.overflow === 'string') {
            css.overflow = style.overflow;
        }

        if (typeof style.paddingLeft === 'string') {
            css.paddingLeft = style.paddingLeft;
        } else if (typeof style.indent === 'number') {
            css.paddingLeft = `${Math.max(0, style.indent) * 8}px`;
        }

        if (style.border && typeof style.border === 'object' && !style.border.clear) {
            css.border = {
                top: style.border.top,
                right: style.border.right,
                bottom: style.border.bottom,
                left: style.border.left,
                color: style.border.color,
                style: style.border.style
            };
        }

        return css;
    }

    function normalizeStyleForStorage(style: Record<string, any>): Record<string, any> {
        if (!style || typeof style !== 'object') {
            return {};
        }

        if (style.clearFormatting) {
            return {
                row: style.row,
                col: style.col,
                clearFormatting: true,
                border: { clear: true, top: false, right: false, bottom: false, left: false }
            };
        }

        const stored: Record<string, any> = {
            row: style.row,
            col: style.col
        };
        const css = styleToRendererCss(style);

        for (const [key, value] of Object.entries(css)) {
            stored[key] = value;
        }

        return stored;
    }

    function updateRowCacheStyle(row: number, col: number, style: Partial<CellStyleEdit>) {
        const cellData = getOrCreateRowCellData(row, col);
        if (cellData) {
            const normalized = styleToRendererCss(style);
            cellData.style = { ...cellData.style, ...normalized };
            if ('backgroundColor' in normalized) {
                cellData.hasDefaultBg = !normalized.backgroundColor;
            }
            if ('color' in normalized) {
                cellData.isDefaultColor = !normalized.color;
            }
            if (style.clearFormatting) {
                cellData.style = {};
                cellData.hasDefaultBg = true;
                cellData.isDefaultColor = true;
            }
        }
    }

    function recordLogicalStyleEdit(row: number, col: number, style: Partial<CellStyleEdit>) {
        const rowNum = row + 1;
        const colNum = col + 1;
        const key = rowNum + ':' + colNum;
        const existing = pendingCellStyleEdits.get(key) || { row: rowNum, col: colNum };
        const merged = normalizeStyleForStorage({ ...existing, ...style, row: rowNum, col: colNum });
        pendingCellStyleEdits.set(key, merged as CellStyleEdit);
        updateRowCacheStyle(row, col, style);
        scheduleAutoSave('format');
    }

    function recordCellStyleEdit(cell: HTMLElement, style: Partial<CellStyleEdit>) {
        const rowNum = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const colNum = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (!rowNum || !colNum) return;

        const key = rowNum + ':' + colNum;
        const existing = pendingCellStyleEdits.get(key) || { row: rowNum, col: colNum };
        const merged = normalizeStyleForStorage({ ...existing, ...style, row: rowNum, col: colNum });
        pendingCellStyleEdits.set(key, merged as CellStyleEdit);
        updateRowCacheStyle(rowNum - 1, colNum - 1, style);
        scheduleAutoSave('format');
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
        const dropdown = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
        const dropdownValue = dropdown
            ? normalizeCellText(dropdown.value || '')
            : (cell.getAttribute('data-dropdown-value') || '');

        return {
            row,
            col,
            key,
            styleAttr: cell.getAttribute('style') || '',
            innerHtml: cell.innerHTML,
            dataCellType: cell.getAttribute('data-cell-type') || 'text',
            dataCheckboxChecked: cell.getAttribute('data-checkbox-checked') || '',
            dataDropdownValue: dropdownValue,
            dataRatingValue: cell.getAttribute('data-rating-value') || '',
            dataDateValue: cell.getAttribute('data-date-value') || '',
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

            cell.setAttribute('data-cell-type', state.dataCellType || 'text');
            if (state.dataCheckboxChecked) {
                cell.setAttribute('data-checkbox-checked', state.dataCheckboxChecked);
            } else {
                cell.removeAttribute('data-checkbox-checked');
            }
            if (state.dataDropdownValue) {
                cell.setAttribute('data-dropdown-value', state.dataDropdownValue);
            } else {
                cell.removeAttribute('data-dropdown-value');
            }
            if (state.dataRatingValue) {
                cell.setAttribute('data-rating-value', state.dataRatingValue);
            } else {
                cell.removeAttribute('data-rating-value');
            }
            if (state.dataDateValue) {
                cell.setAttribute('data-date-value', state.dataDateValue);
            } else {
                cell.removeAttribute('data-date-value');
            }

            const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
            if (select) {
                select.value = state.dataDropdownValue || '';
            }

            applyInteractiveControlState(cell);
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
        invalidateRowMetrics();
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
            entry.before.forEach((state: CellUndoState) => applyCellUndoState(state));
        } else {
            restoreWorksheetStateSnapshot(entry.before);
        }

        editRedoStack.push(entry);
        applyFindHighlightsInVisibleCells();

        if (!isEditMode && entry.kind === 'style') {
            syncControlEditsAfterUndoRedo(entry.before);
        }

        return true;
    }

    function redoEditAction() {
        const entry = editRedoStack.pop();
        if (!entry) return false;

        if (entry.kind === 'style') {
            entry.after.forEach((state: CellUndoState) => applyCellUndoState(state));
        } else {
            restoreWorksheetStateSnapshot(entry.after);
        }

        editUndoStack.push(entry);
        applyFindHighlightsInVisibleCells();

        if (!isEditMode && entry.kind === 'style') {
            syncControlEditsAfterUndoRedo(entry.after);
        }

        return true;
    }

    function syncControlEditsAfterUndoRedo(states: CellUndoState[]) {
        if (isEditMode || isVersionPreviewMode || !Array.isArray(states) || !states.length) {
            return;
        }

        states.forEach((state) => {
            const cell = document.querySelector(`td[data-row="${state.row}"][data-col="${state.col}"]`) as HTMLElement | null;
            if (!cell) {
                return;
            }

            const cellType = getCellType(cell);
            if (cellType === 'checkbox' || cellType === 'dropdown' || cellType === 'rating' || cellType === 'date') {
                persistInteractiveControlEdit(cell);
            }
        });
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
        if (requestStyledMode(() => applyHorizontalAlign(value))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to align');
        if (!cells.length) return;

        cells.forEach(cell => {
            cell.style.textAlign = value;
            recordCellStyleEdit(cell, { horizontalAlign: value });
        });
    }

    function applyVerticalAlign(value: VerticalAlign) {
        if (requestStyledMode(() => applyVerticalAlign(value))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to align');
        if (!cells.length) return;

        cells.forEach(cell => {
            cell.style.verticalAlign = value;
            recordCellStyleEdit(cell, { verticalAlign: value });
        });
    }

    function applyFontSize(value: number) {
        if (requestStyledMode(() => applyFontSize(value))) {
            return;
        }

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
        if (requestStyledMode(() => applyFontFamily(value))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to set font family');
        if (!cells.length) return;

        cells.forEach(cell => {
            cell.style.fontFamily = value;
            recordCellStyleEdit(cell, { fontFamily: value });
        });
    }

    function applyWrapMode(mode: WrapMode) {
        if (requestStyledMode(() => applyWrapMode(mode))) {
            return;
        }

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

    function applyWrapModeToRange(minRow: number, maxRow: number, minCol: number, maxCol: number, wrapMode: WrapMode) {
        if (requestStyledMode(() => applyWrapModeToRange(minRow, maxRow, minCol, maxCol, wrapMode))) {
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;

                const pendingStyle = pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(pendingCellStyleEdits.get(key)) : null;
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;

                beforeStates.push({
                    row: r, col: c, key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                recordLogicalStyleEdit(r, c, { wrapMode });

                if (domCell) {
                    applyStyleToCellFromPainter(domCell, { wrapMode });
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

    function applyIndent(delta: number) {
        if (requestStyledMode(() => applyIndent(delta))) {
            return;
        }

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
        if (requestStyledMode(() => applyStrikeThrough())) {
            return;
        }

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
        if (requestStyledMode(() => applyBorderPreset(mode))) {
            return;
        }

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
        if (requestStyledMode(() => applyBorderColorToSelection(color))) {
            return;
        }

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
        if (requestStyledMode(() => clearFormattingOnSelection())) {
            return;
        }

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

    function resolveCellTypeForClear(cell: HTMLElement | null, rowIndex: number, colIndex: number): string {
        if (cell) return getCellType(cell);

        const rowData = rowCache.get(rowIndex);
        if (!rowData) return 'text';

        const cellData = getCellFromRow(rowData, colIndex + 1);
        const rawType = typeof cellData?.cellType === 'string' ? cellData.cellType.trim().toLowerCase() : '';
        if (rawType === 'checkbox' || rawType === 'dropdown' || rawType === 'rating' || rawType === 'date' || rawType === 'image') {
            return rawType;
        }
        return 'text';
    }

    function getClearedValueForCellType(cellType: string): string {
        if (cellType === 'checkbox') return 'FALSE';
        if (cellType === 'rating') return '0';
        return '';
    }

    function setPlainCellContent(cell: HTMLElement, value: string) {
        const plainText = normalizeCellText(value || '');
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

    function applyClearedValueToCellData(cellData: any, cellType: string, value: string) {
        cellData.value = value;
        if (cellType === 'checkbox') {
            cellData.checkboxChecked = false;
            cellData.value = 'FALSE';
        } else if (cellType === 'rating') {
            cellData.value = value;
        } else if (cellType === 'image') {
            cellData.imageSrc = '';
        }

        cellData.isEmpty = cellData.value === '';
        if (cellData.isEmpty && cellData.hyperlink) {
            cellData.hyperlink = '';
        }
    }

    function applyClearedValueToDomCell(cell: HTMLElement, cellType: string, value: string) {
        if (isPlainView) {
            setPlainCellContent(cell, value);
        } else if (cellType === 'checkbox') {
            updateCheckboxCellPresentation(cell, false);
        } else if (cellType === 'dropdown') {
            updateDropdownCellPresentation(cell, value);
        } else if (cellType === 'rating') {
            updateRatingCellPresentation(cell, 0);
        } else if (cellType === 'date') {
            updateDateCellPresentation(cell, value);
        } else {
            setPlainCellContent(cell, value);
        }

        if (value === '') {
            cell.setAttribute('data-empty', 'true');
            cell.removeAttribute('data-hyperlink');
        } else {
            cell.removeAttribute('data-empty');
        }
    }

    function clearSelectionContents() {
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to clear');
            return;
        }

        const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
        if (cellCount > 200000) {
            showToast(`Selection too large (${cellCount} cells) to clear. Please select a smaller range.`);
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];
        let hasChanges = false;

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const rowNumber = r + 1;
                const colNumber = c + 1;
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                const cellType = resolveCellTypeForClear(domCell, r, c);
                const clearedValue = getClearedValueForCellType(cellType);

                if (domCell) {
                    const before = captureCellUndoState(domCell);
                    if (before) beforeStates.push(before);
                }

                const rowData = rowCache.get(r);
                if (rowData) {
                    let cellData = getCellFromRow(rowData, colNumber);
                    if (!cellData) {
                        cellData = getOrCreateRowCellData(r, c);
                    }
                    applyClearedValueToCellData(cellData, cellType, clearedValue);
                }

                syncLocalSnapshotValue(rowNumber, colNumber, clearedValue);
                upsertPendingOutsideControlEdit(rowNumber, colNumber, clearedValue);
                hasChanges = true;

                if (domCell) {
                    applyClearedValueToDomCell(domCell, cellType, clearedValue);
                    const after = captureCellUndoState(domCell);
                    if (after) afterStates.push(after);
                }
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }

        if (!hasChanges) return;

        if (isEditMode) {
            scheduleAutoSave('text');
            return;
        }

        if (currentSettings.autoSave) {
            saveEdits(false, true);
            return;
        }

        showManualSaveReminderIfNeeded();
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
        scheduleAutoSave('structure');

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

    function applyStyleToCellFromPainter(cell: HTMLElement, style: any) {
        const backgroundColor = typeof style.backgroundColor === 'string' ? style.backgroundColor : (typeof style.bgColor === 'string' ? style.bgColor : '');
        if ('backgroundColor' in style || 'bgColor' in style) {
            cell.style.backgroundColor = backgroundColor || '';
            if (backgroundColor) {
                cell.removeAttribute('data-default-bg');
                cell.removeAttribute('data-white-bg');
                cell.removeAttribute('data-black-bg');
            }
        }
        const textColor = typeof style.color === 'string' ? style.color : (typeof style.textColor === 'string' ? style.textColor : '');
        if ('color' in style || 'textColor' in style) {
            if (textColor) {
                cell.style.setProperty('color', textColor, 'important');
            } else {
                cell.style.removeProperty('color');
            }
            if (textColor) {
                cell.removeAttribute('data-default-color');
            }
        }
        if (typeof style.fontWeight === 'string') {
            cell.style.fontWeight = style.fontWeight;
        } else if (typeof style.bold === 'boolean') {
            cell.style.fontWeight = style.bold ? 'bold' : 'normal';
        }
        if (typeof style.fontStyle === 'string') {
            cell.style.fontStyle = style.fontStyle;
        } else if (typeof style.italic === 'boolean') {
            cell.style.fontStyle = style.italic ? 'italic' : 'normal';
        }
        if (typeof style.fontSize === 'string') {
            cell.style.fontSize = style.fontSize;
        } else if (typeof style.fontSize === 'number') {
            cell.style.fontSize = `${style.fontSize}pt`;
        }
        if ('fontFamily' in style) {
            cell.style.fontFamily = style.fontFamily || '';
        }
        const strike = typeof style.textDecorationLine === 'string'
            ? style.textDecorationLine.includes('line-through')
            : typeof style.strike === 'boolean'
                ? style.strike
                : undefined;
        if (typeof strike === 'boolean') {
            if (strike) {
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
        if (style.textAlign) {
            cell.style.textAlign = style.textAlign;
        } else if (style.horizontalAlign) {
            cell.style.textAlign = style.horizontalAlign;
        }
        if (style.verticalAlign) {
            cell.style.verticalAlign = style.verticalAlign;
        }
        if (style.whiteSpace || style.wordWrap || style.overflow || style.wrapMode) {
            const content = cell.querySelector('.cell-content') as HTMLElement | null;
            const wrapMode = style.wrapMode;
            if (style.whiteSpace === 'pre-wrap' || wrapMode === 'wrap') {
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
            } else if (style.whiteSpace === 'nowrap' && style.overflow !== 'hidden' || wrapMode === 'overflow') {
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
        if (typeof style.paddingLeft === 'string') {
            cell.style.paddingLeft = style.paddingLeft;
        } else if (typeof style.indent === 'number') {
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
        const insertButton = document.getElementById('insertControlButton');
        const plainButton = document.getElementById('togglePlainViewButton');
        const strip = document.getElementById('xlsxEditFormattingStrip');

        const findWrapper = findButton ? findButton.closest('.tooltip') as HTMLElement | null : null;
        const settingsWrapper = settingsButton ? settingsButton.closest('.tooltip') as HTMLElement | null : null;
        const insertWrapper = insertButton ? insertButton.closest('.tooltip') as HTMLElement | null : null;
        const plainWrapper = plainButton ? plainButton.closest('.tooltip') as HTMLElement | null : null;

        if (!findWrapper || !settingsWrapper || findWrapper.parentElement !== toolbar || settingsWrapper.parentElement !== toolbar) {
            return;
        }

        if (isEditModeEnabled) {
            if (findWrapper.nextElementSibling !== settingsWrapper) {
                findWrapper.insertAdjacentElement('afterend', settingsWrapper);
            }

            if (insertWrapper && insertWrapper.parentElement === toolbar && settingsWrapper.nextElementSibling !== insertWrapper) {
                settingsWrapper.insertAdjacentElement('afterend', insertWrapper);
            }

            if (strip && strip.parentElement === toolbar) {
                const anchor = insertWrapper && insertWrapper.parentElement === toolbar ? insertWrapper : settingsWrapper;
                if (anchor.nextElementSibling !== strip) {
                    anchor.insertAdjacentElement('afterend', strip);
                }
            }
            return;
        }

        if (plainWrapper && plainWrapper.parentElement === toolbar && plainWrapper.nextElementSibling !== settingsWrapper) {
            plainWrapper.insertAdjacentElement('afterend', settingsWrapper);
        }

        if (insertWrapper && insertWrapper.parentElement === toolbar && settingsWrapper.nextElementSibling !== insertWrapper) {
            settingsWrapper.insertAdjacentElement('afterend', insertWrapper);
        }
    }

    function normalizeCellText(text: string | null | undefined): string {
        if (!text) return '';
        return String(text).replace(/\u00a0/g, '').replace(/\r?\n/g, ' ').trimEnd();
    }

    function getCellType(cell: HTMLElement | null): string {
        if (!cell) return 'text';
        const raw = (cell.getAttribute('data-cell-type') || 'text').trim().toLowerCase();
        if (raw === 'checkbox' || raw === 'dropdown' || raw === 'image' || raw === 'rating' || raw === 'date') {
            return raw;
        }
        return 'text';
    }

    function normalizeDateInputValue(value: string | null | undefined): string {
        const raw = (value || '').trim();
        if (!raw) return '';

        const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) return raw;

        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
            return '';
        }

        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, '0');
        const dd = String(parsed.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function normalizeRatingValue(value: string | number | null | undefined): number {
        const parsed = typeof value === 'number' ? value : parseInt(String(value || ''), 10);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.min(5, parsed));
    }

    function parseBooleanCellValue(value: string | null | undefined): boolean {
        const normalized = String(value || '').trim().toLowerCase();
        return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y';
    }

    function updateCheckboxCellPresentation(cell: HTMLElement, checked: boolean) {
        cell.setAttribute('data-checkbox-checked', checked ? 'true' : 'false');
        const checkbox = cell.querySelector('.xlsx-cell-checkbox') as HTMLInputElement | null;
        if (checkbox) {
            checkbox.checked = checked;
        }
        const valueLabel = cell.querySelector('.checkbox-value') as HTMLElement | null;
        if (valueLabel) {
            valueLabel.textContent = checked ? 'TRUE' : 'FALSE';
        }
    }

    function updateDropdownCellPresentation(cell: HTMLElement, value: string) {
        const normalized = normalizeCellText(value || '');
        const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
        if (select) {
            select.value = normalized;
        }
        cell.setAttribute('data-dropdown-value', normalized);
    }

    function updateRatingCellPresentation(cell: HTMLElement, rating: number) {
        const normalized = normalizeRatingValue(rating);
        cell.setAttribute('data-rating-value', String(normalized));

        const content = cell.querySelector('.cell-rating-content') as HTMLElement | null;
        if (content) {
            content.setAttribute('data-rating-value', String(normalized));
        }

        cell.querySelectorAll('.xlsx-rating-star').forEach((el) => {
            const star = el as HTMLButtonElement;
            const val = normalizeRatingValue(star.getAttribute('data-rating-value'));
            star.classList.toggle('active', val <= normalized && normalized > 0);
        });

        const label = cell.querySelector('.rating-value') as HTMLElement | null;
        if (label) {
            label.textContent = normalized > 0 ? String(normalized) : '';
        }
    }

    function updateDateCellPresentation(cell: HTMLElement, value: string) {
        const normalized = normalizeDateInputValue(value);
        const dateInput = cell.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
        if (dateInput) {
            dateInput.value = normalized;
        }
        cell.setAttribute('data-date-value', normalized);
    }

    function pushSingleCellUndo(before: CellUndoState | null, after: CellUndoState | null) {
        if (!before || !after) return;
        pushEditUndoEntry({ before: [before], after: [after] });
    }

    function getCellNormalizedValue(cell: HTMLElement): string {
        const type = getCellType(cell);

        if (type === 'checkbox') {
            const checkbox = cell.querySelector('.xlsx-cell-checkbox') as HTMLInputElement | null;
            if (checkbox) {
                return checkbox.checked ? 'TRUE' : 'FALSE';
            }
            return parseBooleanCellValue(cell.getAttribute('data-checkbox-checked')) ? 'TRUE' : 'FALSE';
        }

        if (type === 'dropdown') {
            const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
            if (select) {
                return normalizeCellText(select.value || '');
            }
            return normalizeCellText(cell.getAttribute('data-dropdown-value') || '');
        }

        if (type === 'rating') {
            const content = cell.querySelector('.cell-rating-content') as HTMLElement | null;
            if (content) {
                const current = normalizeRatingValue(content.getAttribute('data-rating-value'));
                return String(current);
            }
            return String(normalizeRatingValue(cell.getAttribute('data-rating-value')));
        }

        if (type === 'date') {
            const dateInput = cell.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
            if (dateInput) {
                return normalizeDateInputValue(dateInput.value);
            }
            return normalizeDateInputValue(cell.getAttribute('data-date-value'));
        }

        return normalizeCellText(cell.textContent || '');
    }

    function canUseInteractiveControlsOutsideEditMode(): boolean {
        return !!currentSettings.allowInteractiveControlsOutsideEditMode && !isVersionPreviewMode;
    }

    function areInteractiveControlsEnabled(): boolean {
        return isEditMode || canUseInteractiveControlsOutsideEditMode();
    }

    function applyInteractiveControlState(root?: ParentNode | null) {
        const scope = root || document;
        const controlsEnabled = areInteractiveControlsEnabled();
        const outsideEditEnabled = !isEditMode && controlsEnabled;

        document.body.classList.toggle('controls-editable-outside-edit-mode', outsideEditEnabled);

        scope.querySelectorAll('.xlsx-cell-checkbox').forEach((el) => {
            const input = el as HTMLInputElement;
            input.disabled = !controlsEnabled;
        });

        scope.querySelectorAll('.xlsx-cell-dropdown').forEach((el) => {
            const select = el as HTMLSelectElement;
            select.disabled = !controlsEnabled;
        });

        scope.querySelectorAll('.xlsx-rating-star').forEach((el) => {
            const button = el as HTMLButtonElement;
            button.disabled = !controlsEnabled;
        });

        scope.querySelectorAll('.xlsx-cell-date').forEach((el) => {
            const input = el as HTMLInputElement;
            input.disabled = !controlsEnabled;
        });

        scope.querySelectorAll('.xlsx-dropdown-edit-button').forEach((el) => {
            const button = el as HTMLButtonElement;
            button.disabled = !isEditMode;
        });
    }

    function showManualSaveReminderIfNeeded() {
        const isAutosaveOff = !currentSettings.autoSave;
        const shouldShowForPlain = isPlainView && !isVersionPreviewMode && isAutosaveOff;
        const shouldShowForStyled = !isPlainView && !isEditMode && !isVersionPreviewMode && isAutosaveOff && currentSettings.showManualSavePopup;

        if (!shouldShowForPlain && !shouldShowForStyled) {
            return;
        }

        const now = Date.now();
        if (now < manualSaveReminderUntil) {
            return;
        }

        manualSaveReminderUntil = now + 2500;
        showToast('Autosave is off. Press Ctrl/Cmd+S to save or enable it in settings', false, 1800);
    }

    function upsertPendingOutsideControlEdit(row: number, col: number, value: string) {
        const existingIndex = pendingOutsideControlEdits.findIndex((edit) => edit.row === row && edit.col === col);
        const next = { row, col, value };

        if (existingIndex >= 0) {
            pendingOutsideControlEdits[existingIndex] = next;
            return;
        }

        pendingOutsideControlEdits.push(next);
    }

    function removePendingOutsideControlEdit(row: number, col: number) {
        pendingOutsideControlEdits = pendingOutsideControlEdits.filter((edit) => edit.row !== row || edit.col !== col);
    }

    function clearPendingOutsideControlEdits() {
        pendingOutsideControlEdits = [];
    }

    function shouldScheduleAutosaveForChange(kind: XlsxAutoSaveChangeKind): boolean {
        if (isTemporaryStyleFile && (kind === 'format' || kind === 'structure')) {
            return true;
        }

        if (!currentSettings.autoSave) {
            return false;
        }

        const mode = currentSettings.autoSaveMode === 'controlsOnly' ? 'controlsOnly' : 'all';
        if (mode === 'all') {
            return true;
        }

        return kind === 'control';
    }

    function persistInteractiveControlEdit(cell: HTMLElement) {
        if (isVersionPreviewMode || isEditMode) return;

        const row = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const col = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (!row || !col) return;

        const value = getCellNormalizedValue(cell).replace(/\u00a0/g, '');
        syncLocalSnapshotValue(row, col, value);

        if (!currentSettings.autoSave) {
            upsertPendingOutsideControlEdit(row, col, value);
            showManualSaveReminderIfNeeded();
            return;
        }

        removePendingOutsideControlEdit(row, col);
        vscode.postMessage({
            command: 'saveXlsxEdits',
            sheetIndex: currentWorksheet,
            edits: [{ row, col, value }],
            richEdits: [],
            styleEdits: [],
            operations: [],
            isAutosave: true
        });
    }

    function persistPlainTextEdit(cell: HTMLElement) {
        if (isVersionPreviewMode || isEditMode) return;

        const row = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const col = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (!row || !col) return;

        const value = getCellNormalizedValue(cell).replace(/\u00a0/g, '');
        syncLocalSnapshotValue(row, col, value);
        cell.dataset.originalText = value;
        cell.dataset.originalHtml = cell.innerHTML;

        if (!currentSettings.autoSave) {
            upsertPendingOutsideControlEdit(row, col, value);
            showManualSaveReminderIfNeeded();
            return;
        }

        removePendingOutsideControlEdit(row, col);
        vscode.postMessage({
            command: 'saveXlsxEdits',
            sheetIndex: currentWorksheet,
            edits: [{ row, col, value }],
            richEdits: [],
            styleEdits: [],
            operations: [],
            isAutosave: true
        });
    }

    function syncLocalSnapshotValue(rowNumber: number, colNumber: number, value: string) {
        const applyValue = (rows: any[] | null) => {
            if (!rows || rowNumber <= 0 || colNumber <= 0) return;
            const row = rows.find((entry) => Number(entry?.rowNumber) === rowNumber);
            if (!row) return;

            const existing = getCellFromRow(row, colNumber);
            if (existing) {
                existing.value = value;
                return;
            }

            if (!Array.isArray(row.cells)) {
                row.cells = [];
            }
            row.cells.push({ rowNumber, colNumber, value });
            row.cells.sort((a: any, b: any) => (a.colNumber || 0) - (b.colNumber || 0));
        };

        applyValue(sourceRowsSnapshot);
        applyValue(transformedRowsSnapshot);
    }

    function hasPendingXlsxEdits(): boolean {
        if (pendingOutsideControlEdits.length > 0) {
            return true;
        }

        if (pendingWorksheetOps.length > 0 || pendingCellStyleEdits.size > 0) {
            return true;
        }

        const table = document.querySelector('#tableContainer table');
        if (!table) return false;

        const editedCell = Array.from(table.querySelectorAll('td.editable-cell')).find((td) => {
            const htmlTd = td as HTMLElement;
            const original = (htmlTd.dataset.originalText || '').replace(/\u00a0/g, '');
            const current = getCellNormalizedValue(htmlTd).replace(/\u00a0/g, '');
            return current !== original;
        });

        return !!editedCell;
    }

    function clearAutoSaveTimer() {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
    }

    function scheduleAutoSave(kind: XlsxAutoSaveChangeKind = 'text') {
        if (!isEditMode || isVersionPreviewMode || isSaving) {
            if (isPlainView && !isVersionPreviewMode && !currentSettings.autoSave) {
                showManualSaveReminderIfNeeded();
            }
            return;
        }
        if (!shouldScheduleAutosaveForChange(kind)) {
            if (!currentSettings.autoSave) {
                showManualSaveReminderIfNeeded();
            }
            return;
        }

        clearAutoSaveTimer();
        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = null;
            if ((!currentSettings.autoSave && !(isTemporaryStyleFile && (kind === 'format' || kind === 'structure'))) || !isEditMode || isVersionPreviewMode || isSaving) {
                return;
            }
            if (!hasPendingXlsxEdits()) {
                return;
            }
            saveEdits(false, true);
        }, 1100);
    }

    // ===== Virtual Scrolling Core =====

    let activeScrollContainer: HTMLElement | null = null;

    function getTableContainer(): HTMLElement | null {
        if (!document.body.classList.contains('sticky-toolbar-enabled')) {
            return document.getElementById('content');
        }
        return document.querySelector('#tableContainer .table-scroll') || document.getElementById('tableContainer');
    }

    function requestRows(start: number, end: number, timeout = 10000): Promise<any[]> {
        return virtualLoader.requestRows(start, end, timeout, { sheetIndex: currentWorksheet });
    }

    function requestAllRows(): Promise<any[]> {
        const rowCount = Math.max(0, baseTotalRows || totalRows);
        return requestRows(0, rowCount, 30000);
    }

    function clearDataTransforms() {
        sourceRowsSnapshot = null;
        transformedRowsSnapshot = null;
        activeColumnFilters.clear();
        activeSortState = null;
    }

    function getActiveRowsSnapshot(): any[] | null {
        if (transformedRowsSnapshot) return transformedRowsSnapshot;
        if (sourceRowsSnapshot) return sourceRowsSnapshot;
        return null;
    }

    function stripHtmlForDataOps(value: string): string {
        if (!/[<&]/.test(value)) {
            return value;
        }

        const tmp = document.createElement('div');
        tmp.innerHTML = value;
        return (tmp.textContent || tmp.innerText || '').replace(/\u00a0/g, ' ');
    }

    function readCellTextForDataOps(rowData: any, colZeroBased: number): string {
        const cell = getCellFromRow(rowData, colZeroBased + 1);
        if (!cell) return '';

        const value = cell.value;
        if (value === null || value === undefined) {
            return '';
        }

        if (typeof value === 'string') {
            return stripHtmlForDataOps(value);
        }

        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (typeof value === 'object') {
            const richRuns = Array.isArray((value as any).richText) ? (value as any).richText : [];
            if (richRuns.length > 0) {
                return richRuns.map((run: any) => String(run?.text ?? '')).join('');
            }

            const hyperlinkText = typeof (value as any).text === 'string' ? (value as any).text : '';
            if (hyperlinkText) {
                return hyperlinkText;
            }
        }

        return stripHtmlForDataOps(String(value));
    }

    function parseSortableNumber(value: string): number | null {
        const trimmed = value.trim();
        if (!trimmed) return null;

        const negativeByParens = /^\(.*\)$/.test(trimmed);
        const normalized = trimmed
            .replace(/^\((.*)\)$/, '$1')
            .replace(/[%,$\s]/g, '')
            .replace(/,/g, '');
        if (!normalized || normalized === '-' || normalized === '.') return null;

        const parsed = Number(normalized);
        if (!Number.isFinite(parsed)) return null;
        return negativeByParens ? -parsed : parsed;
    }

    function parseSortableBoolean(value: string): number | null {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y') return 1;
        if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'n') return 0;
        return null;
    }

    function parseSortableDate(value: string): number | null {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (!/^\d{4}-\d{1,2}-\d{1,2}/.test(trimmed) && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(trimmed)) {
            return null;
        }

        const timestamp = Date.parse(trimmed);
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    function compareDataOpValues(aText: string, bText: string, direction: SortDirection): number {
        const factor = direction === 'asc' ? 1 : -1;
        const a = aText.trim();
        const b = bText.trim();

        const aEmpty = a === '';
        const bEmpty = b === '';
        if (aEmpty && !bEmpty) return 1;
        if (!aEmpty && bEmpty) return -1;
        if (aEmpty && bEmpty) return 0;

        const aBool = parseSortableBoolean(a);
        const bBool = parseSortableBoolean(b);
        if (aBool !== null && bBool !== null) {
            return (aBool - bBool) * factor;
        }

        const aNum = parseSortableNumber(a);
        const bNum = parseSortableNumber(b);
        if (aNum !== null && bNum !== null) {
            return (aNum - bNum) * factor;
        }

        const aDate = parseSortableDate(a);
        const bDate = parseSortableDate(b);
        if (aDate !== null && bDate !== null) {
            return (aDate - bDate) * factor;
        }

        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * factor;
    }

    function applyDataOpsRowsToViewport(rows: any[] | null) {
        if (rows) {
            transformedRowsSnapshot = rows;
            totalRows = rows.length;
            allRowHeights = rows.map((row) => {
                const h = Number((row as any)?.height);
                return Number.isFinite(h) && h > 0 ? h : ROW_HEIGHT;
            });
        } else {
            transformedRowsSnapshot = null;
            totalRows = baseTotalRows;
            allRowHeights = [...baseRowHeights];
        }

        invalidateRowMetrics();
        rowCache.clear();
        currentVisibleStart = 0;
        currentVisibleEnd = 0;
        hideHeaderContextMenu();
        renderWorksheet(currentWorksheet);
    }

    async function ensureSourceRowsSnapshot(): Promise<boolean> {
        if (sourceRowsSnapshot) {
            return true;
        }

        if ((baseTotalRows || totalRows) > MAX_ROWS_FOR_CLIENT_DATA_OPS) {
            showToast(`Filtering is limited to ${MAX_ROWS_FOR_CLIENT_DATA_OPS.toLocaleString()} rows for performance.`);
            return false;
        }

        try {
            setLoadingText('Loading rows for filtering...');
            showLoading();
            const rows = await requestAllRows();
            sourceRowsSnapshot = Array.isArray(rows) ? rows.map((row) => cloneCellData(row)) : [];
            return true;
        } catch {
            showToast('Unable to load rows for filtering');
            return false;
        } finally {
            hideLoading();
        }
    }

    function rebuildFilteredRows() {
        if (!sourceRowsSnapshot) {
            return;
        }

        let headerRow: any = null;
        let rowsToProcess = [...sourceRowsSnapshot];

        if (currentSettings.firstRowIsHeader && sourceRowsSnapshot.length > 0) {
            headerRow = sourceRowsSnapshot[0];
            rowsToProcess = sourceRowsSnapshot.slice(1);
        }

        let nextRows = rowsToProcess;
        if (activeColumnFilters.size > 0) {
            nextRows = nextRows.filter((rowData) => {
                for (const filter of activeColumnFilters.values()) {
                    const raw = readCellTextForDataOps(rowData, filter.columnIndex);
                    const cellText = filter.caseSensitive ? raw : raw.toLowerCase();
                    const query = filter.caseSensitive ? filter.query : filter.query.toLowerCase();

                    if (filter.mode === 'nonEmpty') {
                        if (!raw.trim()) {
                            return false;
                        }
                        continue;
                    }

                    if (!query) {
                        continue;
                    }

                    if (filter.mode === 'contains' && !cellText.includes(query)) {
                        return false;
                    }
                    if (filter.mode === 'equals' && cellText !== query) {
                        return false;
                    }
                    if (filter.mode === 'startsWith' && !cellText.startsWith(query)) {
                        return false;
                    }
                }
                return true;
            });
        }

        if (activeSortState) {
            const { columnIndex, direction } = activeSortState;
            nextRows = [...nextRows].sort((a, b) => {
                const aText = readCellTextForDataOps(a, columnIndex);
                const bText = readCellTextForDataOps(b, columnIndex);
                return compareDataOpValues(aText, bText, direction);
            });
        }

        if (headerRow) {
            transformedRowsSnapshot = [headerRow, ...nextRows];
        } else {
            transformedRowsSnapshot = nextRows;
        }
    }

    function getHeaderIndicator(colIndex: number): string {
        const parts: string[] = [];
        if (activeSortState?.columnIndex === colIndex) {
            parts.push(activeSortState.direction === 'asc' ? 'A-Z' : 'Z-A');
        }
        if (activeColumnFilters.has(colIndex)) {
            parts.push('Filtered');
        }
        return parts.join(' • ');
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
            isEditMode,
            allowInteractiveControls: areInteractiveControlsEnabled()
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

    function setRowHeaderWidth(widthPx: number, allowShrink = false) {
        const nextWidth = Math.max(MIN_ROW_HEADER_WIDTH, Math.ceil(widthPx));
        if (!allowShrink && nextWidth <= currentRowHeaderWidth) return;
        if (allowShrink && nextWidth === currentRowHeaderWidth) return;

        currentRowHeaderWidth = nextWidth;
        document.documentElement.style.setProperty('--row-header-width', `${nextWidth}px`);
    }

    function estimateRowHeaderWidthForRowIndex(rowIndex: number): number {
        const oneBasedRow = Math.max(1, rowIndex + 1);
        const digits = String(oneBasedRow).length;
        return Math.max(MIN_ROW_HEADER_WIDTH, digits * 8 + 16);
    }

    function ensureRowHeaderWidthForVisibleRange(startRow: number, endRowExclusive: number) {
        if (totalRows <= 0) return;

        const maxVisibleRow = Math.max(startRow, endRowExclusive - 1);
        const clampedMaxVisibleRow = Math.max(0, Math.min(totalRows - 1, maxVisibleRow));
        const needed = estimateRowHeaderWidthForRowIndex(clampedMaxVisibleRow);
        setRowHeaderWidth(needed);
    }

    const syncColumnWidthsToCurrentMode = debounce(() => {
        if (isEditMode) return;
        adjustColumnWidths(document.body.classList.contains('expanded-mode') ? 'expand' : 'default');
    }, 100);

    function renderVirtualRows(startIndex: number, endIndex: number, rowsData: any[], cacheRows = true) {
        if (isRendering) return;
        isRendering = true;

        const tbody = document.querySelector('#xlsxTable tbody');
        if (!tbody) {
            isRendering = false;
            return;
        }

        if (cacheRows) {
            rowsData.forEach((row, i) => {
                rowCache.set(startIndex + i, row);
            });
        }

        const isHeaderStickyAndActive = !!currentSettings.firstRowIsHeader;
        let topSpacerHeight = 0;
        if (isHeaderStickyAndActive && startIndex > 0) {
            topSpacerHeight = getRowHeightRange(1, startIndex);
        } else {
            topSpacerHeight = getRowTopOffset(startIndex);
        }
        const bottomSpacerHeight = getRowHeightRange(endIndex, totalRows);

        let html = '';

        if (isHeaderStickyAndActive && startIndex > 0) {
            const headerRowData = rowCache.get(0) || { cells: [], rowNumber: 1 };
            html += createRowHtml(headerRowData, 0);
        }

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
        applyInteractiveControlState(tbody);
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

        const firstVisibleRow = findRowIndexByOffset(scrollTop);
        const lastVisibleRow = Math.min(totalRows, findRowIndexByOffset(scrollTop + clientHeight) + 1);

        // Match CSV behavior: keep row headers compact and only grow when larger row numbers become visible.
        ensureRowHeaderWidthForVisibleRange(firstVisibleRow, lastVisibleRow);

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
        // BUT only if we don't need to fetch row 0
        const needsRowZeroFetch = !!currentSettings.firstRowIsHeader && !rowCache.has(0);
        if (chunkStart === currentVisibleStart && chunkEnd === currentVisibleEnd && !needsRowZeroFetch) {
            return;
        }

        // Check if current range still covers what we need
        if (currentVisibleStart <= bufferedStart && currentVisibleEnd >= bufferedEnd && !needsRowZeroFetch) {
            return; // Current render still covers visible area
        }

        const activeRows = getActiveRowsSnapshot();
        const usingLocalRows = Array.isArray(activeRows);

        let needsMainFetch = false;
        for (let i = chunkStart; i < chunkEnd; i++) {
            if (!rowCache.has(i)) {
                needsMainFetch = true;
                break;
            }
        }

        const needsFetch = needsMainFetch || needsRowZeroFetch;

        if (needsFetch && usingLocalRows) {
            currentVisibleStart = chunkStart;
            currentVisibleEnd = chunkEnd;

            // Ensure row 0 is cached if needed
            if (currentSettings.firstRowIsHeader && !rowCache.has(0)) {
                const headerRow = activeRows[0];
                if (headerRow) {
                    rowCache.set(0, cloneCellData(headerRow));
                }
            }

            const rows = activeRows.slice(chunkStart, chunkEnd).map((row) => cloneCellData(row));
            if (rows.length > 0) {
                renderVirtualRows(chunkStart, chunkStart + rows.length, rows);
            } else {
                renderVirtualRows(chunkStart, chunkEnd, []);
            }
            return;
        }

        if (needsFetch && !isRequestingRows) {
            currentVisibleStart = chunkStart;
            currentVisibleEnd = chunkEnd;

            isRequestingRows = true;

            try {
                // Fetch row 0 first if needed
                if (needsRowZeroFetch) {
                    const zeroRowResult = await requestRows(0, 1);
                    if (zeroRowResult && zeroRowResult[0]) {
                        rowCache.set(0, zeroRowResult[0]);
                    }
                }

                let rows: any[] = [];
                if (needsMainFetch) {
                    rows = await requestRows(chunkStart, chunkEnd);
                } else {
                    // If we only needed row 0, we can construct the chunk rows from cache
                    for (let i = chunkStart; i < chunkEnd; i++) {
                        rows.push(rowCache.get(i) || { cells: [], rowNumber: i + 1 });
                    }
                }

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
    }, 16);

    function initializeVirtualScrolling() {
        const container = getTableContainer();
        if (!container) return;

        if (activeScrollContainer && activeScrollContainer !== container) {
            activeScrollContainer.removeEventListener('scroll', onScroll);
        }

        container.removeEventListener('scroll', onScroll);
        container.addEventListener('scroll', onScroll, { passive: true });
        activeScrollContainer = container;
        currentVisibleStart = -1;
        currentVisibleEnd = -1;
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
                if (row === minRow) cell.classList.add('selection-top');
                if (row === maxRow) cell.classList.add('selection-bottom');
                if (col === minCol) cell.classList.add('selection-left');
                if (col === maxCol) cell.classList.add('selection-right');
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
            const indicator = getHeaderIndicator(c - 1);
            html += '<span class="col-header-label">' + getExcelColumnLabel(c) + '</span>';
            if (indicator) {
                html += '<span class="col-header-indicator">' + indicator + '</span>';
            }
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
        applyInteractiveControlState();
        if (isPreview) {
            hideImagePreview();
        }

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
        baseTotalRows = wsMeta.totalRows || 0;
        baseRowHeights = wsMeta.rowHeights || [];

        totalRows = baseTotalRows;
        columnCount = wsMeta.columnCount || 0;
        columnWidths = wsMeta.columnWidths || [];
        mergedCells = wsMeta.mergedCells || [];
        allRowHeights = [...baseRowHeights];

        if (sourceRowsSnapshot) {
            rebuildFilteredRows();
            if (activeColumnFilters.size > 0 || activeSortState) {
                totalRows = transformedRowsSnapshot ? transformedRowsSnapshot.length : 0;
                allRowHeights = (transformedRowsSnapshot || []).map((row) => {
                    const h = Number((row as any)?.height);
                    return Number.isFinite(h) && h > 0 ? h : ROW_HEIGHT;
                });
            }
        }

        invalidateRowMetrics();
        ensureRowOffsetPrefix();

        // Allow the overlay to render
        setTimeout(() => {
            try {
                const container = document.getElementById('tableContainer');
                if (!container) return;

                container.innerHTML = createTableShell();
                ensureHeaderVisible();
                initializeSelection();
                initializeResize();
                initializeHyperlinkHover();
                initializeVirtualScrolling();

                const toolbarEl = document.getElementById('toolbar') as HTMLElement | null;
                if (toolbarEl) {
                    toolbarEl.classList.remove('hidden');
                    toolbarEl.style.removeProperty('display');
                }

                if (toolbarManager) {
                    applyToolbarLayout(toolbarManager, {
                        stickyToolbar: !!currentSettings.stickyToolbar,
                        scrollTarget: '#content',
                        onLayoutApplied: initializeVirtualScrolling
                    });
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
            } else if (!isVersionPreviewMode) {
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
            setIsCopying: (next: boolean) => {
                isCopying = next;
            },
            showToast,
            requestAllRows,
            normalizeCellText
        });
    }

    function pasteTextAtSelection(text: string) {
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select a cell to paste');
            return;
        }

        const startRow = bounds.minRow;
        const startCol = bounds.minCol;

        // Parse plain text content using tabs (\t) as column separators and newlines (\n) as row separators.
        const lines = text.split(/\r?\n/);
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        const grid = lines.map(line => line.split('\t'));

        if (grid.length === 0 || grid[0].length === 0) {
            return;
        }

        const beforeSnapshot = captureWorksheetStateSnapshot();
        let anyChanged = false;
        const editsList: Array<{ row: number; col: number; value: string }> = [];

        for (let r = 0; r < grid.length; r++) {
            const rowIndex = startRow + r;
            if (rowIndex >= totalRows) continue;
            const rowNumber = rowIndex + 1;

            for (let c = 0; c < grid[r].length; c++) {
                const colIndex = startCol + c;
                if (colIndex >= columnCount) continue;
                const colNumber = colIndex + 1;

                const rawValue = grid[r][c];
                const cellData = getOrCreateRowCellData(rowIndex, colIndex);
                const cellType = cellData.cellType || 'text';

                let parsedValue = rawValue;
                if (cellType === 'checkbox') {
                    parsedValue = parseBooleanCellValue(rawValue) ? 'TRUE' : 'FALSE';
                } else if (cellType === 'rating') {
                    parsedValue = String(normalizeRatingValue(rawValue));
                } else if (cellType === 'date') {
                    parsedValue = normalizeDateInputValue(rawValue);
                } else if (cellType === 'dropdown') {
                    parsedValue = rawValue.trim();
                }

                if (cellData.value !== parsedValue) {
                    cellData.value = parsedValue;
                    syncLocalSnapshotValue(rowNumber, colNumber, parsedValue);
                    upsertPendingOutsideControlEdit(rowNumber, colNumber, parsedValue);
                    editsList.push({ row: rowNumber, col: colNumber, value: parsedValue });
                    anyChanged = true;
                }
            }
        }

        if (anyChanged) {
            const afterSnapshot = captureWorksheetStateSnapshot();
            pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

            // Trigger a complete table redraw
            rerenderCurrentSheetFromLocalState();

            // Re-select the pasted range
            const endRow = Math.min(totalRows - 1, startRow + grid.length - 1);
            const endCol = Math.min(columnCount - 1, startCol + grid[0].length - 1);
            selectRange(startRow, startCol, endRow, endCol);

            // Save or schedule auto-save according to settings
            if (isEditMode) {
                scheduleAutoSave('text');
            } else {
                if (currentSettings.autoSave) {
                    editsList.forEach(e => removePendingOutsideControlEdit(e.row, e.col));
                    vscode.postMessage({
                        command: 'saveXlsxEdits',
                        sheetIndex: currentWorksheet,
                        edits: editsList,
                        richEdits: [],
                        styleEdits: [],
                        operations: [],
                        isAutosave: true
                    });
                } else {
                    showManualSaveReminderIfNeeded();
                }
            }
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

        if (!pasteListenerAttached) {
            pasteListenerAttached = true;
            document.addEventListener('paste', (e) => {
                if (isCellEditing) return;
                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
                    if (!activeEl.closest('#xlsxTable')) {
                        return;
                    }
                }
                const clipboardData = e.clipboardData;
                if (!clipboardData) return;
                const text = clipboardData.getData('text/plain');
                if (text) {
                    pasteTextAtSelection(text);
                }
            });
        }

        table.addEventListener('contextmenu', (e) => {
            const target = e.target as HTMLElement;
            const rowHeader = target.closest('th.row-header') as HTMLElement | null;
            const colHeader = target.closest('th.col-header') as HTMLElement | null;
            const cell = target.closest('td') as HTMLElement | null;
            if (!rowHeader && !colHeader && !cell) return;

            if (isVersionPreviewMode && (rowHeader || cell)) {
                showToast('Version preview is read-only');
                return;
            }

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

        table.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.col-resize-handle') || target.closest('.row-resize-handle')) return;

            const rowHeader = target.closest('th.row-header') as HTMLElement | null;
            const colHeader = target.closest('th.col-header') as HTMLElement | null;
            if (!rowHeader && !colHeader) return;
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;

            if (isVersionPreviewMode && rowHeader) {
                showToast('Version preview is read-only');
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

            if (cellTarget.tagName === 'TD' && target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date')) {
                const state = captureCellUndoState(cellTarget);
                if (state) {
                    pendingControlUndoState.set(cellTarget, state);
                }
            }

            const isHeaderInteraction =
                cellTarget.classList.contains('col-header') ||
                cellTarget.classList.contains('row-header') ||
                cellTarget.classList.contains('corner-cell');

            if (!isEditMode && cellTarget.tagName === 'TD' && !isHeaderInteraction) {
                const cellType = getCellType(cellTarget);
                const controlTarget = target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date') as HTMLElement | null;
                const canEditControls = areInteractiveControlsEnabled();

                if (cellType === 'checkbox' && controlTarget && canEditControls) {
                    const row = parseInt(cellTarget.dataset.row!, 10);
                    const col = parseInt(cellTarget.dataset.col!, 10);

                    if (e.ctrlKey || e.metaKey) {
                        selectionStart = null;
                        selectionEnd = null;
                        if (cellTarget.classList.contains('selected')) {
                            cellTarget.classList.remove('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                            selectedCells.delete(cellTarget);
                            if (cellTarget === activeCell) {
                                activeCell = null;
                            }
                        } else {
                            cellTarget.classList.add('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                            selectedCells.add(cellTarget);
                            if (activeCell) {
                                activeCell.classList.remove('active-cell');
                            }
                            cellTarget.classList.add('active-cell');
                            activeCell = cellTarget;
                        }
                    } else if (e.shiftKey && activeCell) {
                        const startRow = parseInt(activeCell.dataset.row!, 10);
                        const startCol = parseInt(activeCell.dataset.col!, 10);
                        selectRange(startRow, startCol, row, col);
                    } else {
                        clearSelection();
                        selectCell(cellTarget);
                        isSelecting = true;
                        selectionStart = { row, col };
                        selectionEnd = { row, col };
                    }

                    updateSelectionInfo();
                    return;
                }

                if ((cellType === 'dropdown' || cellType === 'rating' || cellType === 'date') && canEditControls) {
                    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
                        clearSelection();
                        selectCell(cellTarget);
                    }

                    if (cellType === 'date' && controlTarget) {
                        const dateInput = cellTarget.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
                        if (dateInput && !dateInput.disabled) {
                            dateInput.focus();
                        }
                    }

                    updateSelectionInfo();
                    return;
                }
            }

            if (!isVersionPreviewMode && !isHeaderInteraction) {
                if (cellTarget.tagName === 'TD') {
                    if (isCellEditing && cellTarget.getAttribute('contenteditable') === 'true') {
                        return;
                    }

                    const row = parseInt(cellTarget.dataset.row!, 10);
                    const col = parseInt(cellTarget.dataset.col!, 10);
                    const cellType = getCellType(cellTarget);
                    const controlTarget = target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date') as HTMLElement | null;
                    const wasSingleActiveCell = activeCell === cellTarget && selectedCells.size === 1;

                    // Match CSV/TSV behavior: single-cell mode should clear row/column mode selections.
                    selectedColumnIndices.clear();
                    selectedRowIndices.clear();
                    selectedColumns.clear();
                    selectedRows.clear();

                    if ((cellType === 'dropdown' || cellType === 'rating' || cellType === 'date') && controlTarget) {
                        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
                            clearSelection();
                            selectCell(cellTarget);
                        }
                        pendingEditCell = null;
                        pendingEditDrag = false;
                        updateSelectionInfo();
                        return;
                    }

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
                            cellTarget.classList.remove('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                            selectedCells.delete(cellTarget);
                            if (cellTarget === activeCell) {
                                activeCell = null;
                            }
                        } else {
                            cellTarget.classList.add('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
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
                        pendingEditCell = (wasSingleActiveCell && !formatPainterExecuting && cellType === 'text') ? cellTarget : null;
                        pendingEditDrag = false;
                    }

                    if (!isCellEditing && cellType === 'text') {
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

                for (let c = 0; c < columnCount; c++) {
                    selectedColumns.add(c);
                    selectedColumnIndices.add(c);
                }

                selectionStart = { row: 0, col: 0 };
                selectionEnd = { row: Math.max(0, totalRows - 1), col: Math.max(0, columnCount - 1) };

                const allCells = table.querySelectorAll('td') as NodeListOf<HTMLElement>;
                allCells.forEach(cell => {
                    cell.classList.add('selected');
                    const row = parseInt(cell.dataset.row || '-1', 10);
                    const col = parseInt(cell.dataset.col || '-1', 10);
                    if (row === 0) cell.classList.add('selection-top');
                    if (row === totalRows - 1) cell.classList.add('selection-bottom');
                    if (col === 0) cell.classList.add('selection-left');
                    if (col === columnCount - 1) cell.classList.add('selection-right');
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

                // Match CSV/TSV behavior: single-cell mode should clear row/column mode selections.
                selectedColumnIndices.clear();
                selectedRowIndices.clear();
                selectedColumns.clear();
                selectedRows.clear();

                if (e.ctrlKey || e.metaKey) {
                    if (cellTarget.classList.contains('selected')) {
                        cellTarget.classList.remove('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
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
                        cellTarget.classList.add('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
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

        table.addEventListener('input', (e) => {
            if (!isEditMode) return;

            const target = e.target as HTMLElement | null;
            if (!target) return;

            const editableCell = target.closest('td[contenteditable="true"]') as HTMLElement | null;
            if (!editableCell) return;

            scheduleAutoSave('text');
        });

        table.addEventListener('focusin', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            const controlTarget = target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date') as HTMLElement | null;
            if (!controlTarget) return;

            const cell = controlTarget.closest('td') as HTMLElement | null;
            if (!cell) return;

            const state = captureCellUndoState(cell);
            if (state) {
                pendingControlUndoState.set(cell, state);
            }
        });

        table.addEventListener('change', (e) => {
            const controlsEditable = areInteractiveControlsEnabled();
            if (!controlsEditable) return;

            const target = e.target as HTMLElement | null;
            if (!target) return;

            const checkbox = target.closest('.xlsx-cell-checkbox') as HTMLInputElement | null;
            if (checkbox) {
                const cell = checkbox.closest('td') as HTMLElement | null;
                if (!cell) return;
                const before = pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                pendingControlUndoState.delete(cell);
                updateCheckboxCellPresentation(cell, !!checkbox.checked);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
                return;
            }

            const dropdown = target.closest('.xlsx-cell-dropdown') as HTMLSelectElement | null;
            if (dropdown) {
                const cell = dropdown.closest('td') as HTMLElement | null;
                if (!cell) return;
                const before = pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                pendingControlUndoState.delete(cell);
                updateDropdownCellPresentation(cell, dropdown.value);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
                return;
            }

            const dateInput = target.closest('.xlsx-cell-date') as HTMLInputElement | null;
            if (dateInput) {
                const cell = dateInput.closest('td') as HTMLElement | null;
                if (!cell) return;
                const before = pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                pendingControlUndoState.delete(cell);
                updateDateCellPresentation(cell, dateInput.value);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
            }
        });

        table.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            const editButton = target.closest('.xlsx-dropdown-edit-button') as HTMLButtonElement | null;
            if (editButton) {
                const cell = editButton.closest('td') as HTMLElement | null;
                if (!cell || editButton.disabled) return;

                void editDropdownOptionsForCell(cell);
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const ratingStar = target.closest('.xlsx-rating-star') as HTMLButtonElement | null;
            if (ratingStar) {
                const cell = ratingStar.closest('td') as HTMLElement | null;
                if (!cell || ratingStar.disabled) return;

                const before = pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                pendingControlUndoState.delete(cell);
                const clickedValue = normalizeRatingValue(ratingStar.getAttribute('data-rating-value'));
                const currentValue = normalizeRatingValue(cell.getAttribute('data-rating-value'));
                const nextValue = clickedValue === currentValue ? 0 : clickedValue;
                updateRatingCellPresentation(cell, nextValue);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);

                if (isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }

                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const imageTarget = target.closest('.xlsx-cell-image, .cell-image-content') as HTMLElement | null;
            if (!imageTarget) return;

            const cell = imageTarget.closest('td') as HTMLElement | null;
            if (!cell || getCellType(cell) !== 'image') return;

            const imageEl = cell.querySelector('.xlsx-cell-image') as HTMLImageElement | null;
            const src = imageEl?.getAttribute('src') || '';
            if (!src) return;

            e.preventDefault();
            e.stopPropagation();
            showImagePreview(src);
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

            // Ignore interactions with dropdown edit button and most native inputs/selects
            // but allow pointerdown on checkbox inputs so selection can start from them.
            if (target.closest('.xlsx-dropdown-edit-button')) {
                return;
            }

            const selEl = target.closest('select');
            if (selEl) return;

            const inputEl = target.closest('input');
            if (inputEl) {
                // Allow checkbox inputs used as cell controls to participate in selection start.
                const isCheckboxControl = inputEl.classList && inputEl.classList.contains('xlsx-cell-checkbox');
                if (!isCheckboxControl) return;
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

            if (shouldStartEdit && targetToEdit && !isVersionPreviewMode && !isCellEditing) {
                enterCellEditMode(targetToEdit);
            }
        });

        document.addEventListener('keydown', (e) => {
            const isCmdOrCtrl = e.ctrlKey || e.metaKey;
            const target = e.target as HTMLElement | null;

            if (e.key === 'Escape' && imagePreviewOverlayEl && !imagePreviewOverlayEl.classList.contains('hidden')) {
                e.preventDefault();
                hideImagePreview();
                return;
            }

            if (e.key === 'Escape' && insertControlPopupEl && !insertControlPopupEl.classList.contains('hidden')) {
                e.preventDefault();
                hideInsertControlPopup();
                return;
            }

            if (e.key === 'Escape' && dropdownOptionsPopupEl && !dropdownOptionsPopupEl.classList.contains('hidden')) {
                e.preventDefault();
                hideDropdownOptionsPopup(null);
                return;
            }

            const isFormEntryTarget = !!target && (
                target.closest('#xlsxDropdownOptionsPopup') !== null ||
                target.closest('.xlsx-cell-dropdown') !== null ||
                target.closest('.xlsx-dropdown-edit-button') !== null ||
                target.closest('.xlsx-cell-date') !== null ||
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT'
            );

            if (isFormEntryTarget) {
                if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    saveEdits(false);
                }
                return;
            }

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

            const isUndoShortcut = isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z';
            const isRedoShortcut = isCmdOrCtrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'));
            if (isUndoShortcut || isRedoShortcut) {
                const active = document.activeElement as HTMLElement | null;
                const isEditingCell = !!active && active.tagName === 'TD' && active.getAttribute('contenteditable') === 'true';

                if (isEditingCell && isEditMode) {
                    e.preventDefault();
                    exitCellEditMode();
                }

                const handled = isRedoShortcut ? redoEditAction() : undoEditAction();
                if (handled) {
                    e.preventDefault();
                    if (isEditMode) {
                        scheduleAutoSave('text');
                    }
                    return;
                }

                if (isEditMode) {
                    e.preventDefault();
                    return;
                }
            }

            if (!isCellEditing) {
                const canDirectTextEdit = !isVersionPreviewMode;
                const key = e.key;
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(key)) {
                    e.preventDefault();

                    if (key === 'Enter') {
                        if (canDirectTextEdit && activeCell) {
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

                if (canDirectTextEdit && activeCell && e.key.length === 1 && !isCmdOrCtrl && !e.altKey) {
                    enterCellEditMode(activeCell);
                    return;
                }

                if (e.key === 'F2' && canDirectTextEdit && activeCell) {
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

            const canClearValues = isEditMode || isPlainDirectEditMode();
            if ((e.key === 'Delete' || e.key === 'Backspace') && canClearValues && !isCellEditing) {
                e.preventDefault();
                clearSelectionContents();
                return;
            }

            if (isEditMode) {
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

                for (let c = 0; c < columnCount; c++) {
                    selectedColumns.add(c);
                    selectedColumnIndices.add(c);
                }

                selectionStart = { row: 0, col: 0 };
                selectionEnd = { row: Math.max(0, totalRows - 1), col: Math.max(0, columnCount - 1) };

                allCells.forEach(cell => {
                    cell.classList.add('selected');
                    const row = parseInt(cell.dataset.row || '-1', 10);
                    const col = parseInt(cell.dataset.col || '-1', 10);
                    if (row === 0) cell.classList.add('selection-top');
                    if (row === totalRows - 1) cell.classList.add('selection-bottom');
                    if (col === 0) cell.classList.add('selection-left');
                    if (col === columnCount - 1) cell.classList.add('selection-right');
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

    function ensureImagePreviewOverlay(): HTMLElement {
        if (imagePreviewOverlayEl) return imagePreviewOverlayEl;

        const overlay = document.createElement('div');
        overlay.id = 'xlsxImagePreviewOverlay';
        overlay.className = 'xlsx-image-preview-overlay hidden';
        overlay.innerHTML = `
            <div class="xlsx-image-preview-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
                <button type="button" id="xlsxImagePreviewClose" class="xlsx-image-preview-close" aria-label="Close image preview">Close</button>
                <img id="xlsxImagePreviewImg" class="xlsx-image-preview-image" alt="XLSX cell image preview" />
            </div>
        `;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                hideImagePreview();
            }
        });

        const closeBtn = overlay.querySelector('#xlsxImagePreviewClose') as HTMLButtonElement | null;
        closeBtn?.addEventListener('click', () => hideImagePreview());

        document.body.appendChild(overlay);
        imagePreviewOverlayEl = overlay;
        return overlay;
    }

    function showImagePreview(src: string) {
        if (!src) return;
        const overlay = ensureImagePreviewOverlay();
        const img = overlay.querySelector('#xlsxImagePreviewImg') as HTMLImageElement | null;
        if (!img) return;

        img.src = src;
        overlay.classList.remove('hidden');
        document.body.classList.add('image-preview-open');
    }

    function hideImagePreview() {
        if (!imagePreviewOverlayEl) return;
        const img = imagePreviewOverlayEl.querySelector('#xlsxImagePreviewImg') as HTMLImageElement | null;
        if (img) {
            img.removeAttribute('src');
        }
        imagePreviewOverlayEl.classList.add('hidden');
        document.body.classList.remove('image-preview-open');
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

    function setSettingItemHidden(id: string, hidden: boolean) {
        const input = document.getElementById(id);
        const settingItem = input?.closest('.setting-item') as HTMLElement | null;
        if (!settingItem) return;
        settingItem.style.display = hidden ? 'none' : '';
    }

    function resetStyledOnlySettingsVisibility() {
        const styledOnlySettingIds = [
            'chkAllowInteractiveControlsOutsideEditMode',
            'chkHyperlinkPreview',
            'chkMergeWarningEnabled',
            'radioAutoSaveAll',
            'radioAutoSaveControlsOnly',
            'chkShowManualSavePopup'
        ];

        styledOnlySettingIds.forEach((id) => setSettingItemHidden(id, false));
    }

    function hideStyledOnlySettingsForPlainMode() {
        const styledOnlySettingIds = [
            'chkAllowInteractiveControlsOutsideEditMode',
            'chkHyperlinkPreview',
            'chkMergeWarningEnabled',
            'radioAutoSaveAll',
            'radioAutoSaveControlsOnly',
            'chkShowManualSavePopup'
        ];

        styledOnlySettingIds.forEach((id) => setSettingItemHidden(id, true));
    }

    function applySettings(settings: any, scopeOverride?: SettingsScope) {
        const scope = scopeOverride || getCurrentSettingsScope();
        const previousSpacious = !!currentSettings.spaciousCells;
        const previousTextWrap = !!currentSettings.textWrap;
        const previousSettings = getStoredSettingsForScope(scope);
        currentSettings = normalizeSettingsForScope(scope, settings, previousSettings);
        setStoredSettingsForScope(scope, currentSettings);

        if (!currentSettings.autoSave) {
            clearAutoSaveTimer();
            if (!isEditMode && pendingOutsideControlEdits.length > 0) {
                showManualSaveReminderIfNeeded();
            }
        } else {
            if (isEditMode && hasPendingXlsxEdits()) {
                scheduleAutoSave('text');
            } else if (!isEditMode && pendingOutsideControlEdits.length > 0) {
                saveEdits(false, true);
            }
        }

        if (currentSettings.autoSave) {
            manualSaveReminderUntil = 0;
        }

        // Show/hide enable button based on whether this is the default editor
        if (toolbarManager) {
            toolbarManager.setButtonVisibility('enableAsDefaultButton', currentSettings.isDefaultEditor === false);
        }

        resetStyledOnlySettingsVisibility();
        syncSettingsCheckboxes(currentSettings);
        if (scope === 'plain') {
            hideStyledOnlySettingsForPlainMode();
        }

        document.body.classList.toggle('sticky-header-enabled', !!currentSettings.stickyHeader);
        document.body.classList.toggle('first-row-as-header', !!currentSettings.firstRowIsHeader);
        document.body.classList.toggle('spacious-cells', !!currentSettings.spaciousCells);
        document.body.classList.toggle('text-wrap-enabled', !!currentSettings.textWrap);

        applyToolbarLayout(toolbarManager, {
            stickyToolbar: !!currentSettings.stickyToolbar,
            forceSticky: isEditMode,
            scrollTarget: '#content',
            onLayoutApplied: initializeVirtualScrolling
        });

        if (!currentSettings.hyperlinkPreview) hideLinkTooltip();
        applyInteractiveControlState();

        const spaciousChanged = previousSpacious !== !!currentSettings.spaciousCells;
        if (spaciousChanged && worksheetsMeta.length > 0) {
            invalidateRowMetrics();
            currentVisibleStart = 0;
            currentVisibleEnd = 0;
            rerenderCurrentSheetFromLocalState();
        }
    }

    function postSettings() {
        vscode.postMessage({
            command: 'updateSettings',
            settingsScope: getCurrentSettingsScope(),
            settings: currentSettings
        });
    }

    function enterCellEditMode(cell: HTMLElement, clearContent = false) {
        if (isVersionPreviewMode) return;

        const cellType = getCellType(cell);
        if (cellType === 'checkbox') {
            const checkbox = cell.querySelector('.xlsx-cell-checkbox') as HTMLInputElement | null;
            if (checkbox && !checkbox.disabled) {
                const before = captureCellUndoState(cell);
                const next = !checkbox.checked;
                updateCheckboxCellPresentation(cell, next);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
            }
            return;
        }

        if (cellType === 'dropdown') {
            const dropdown = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
            if (dropdown && !dropdown.disabled) {
                dropdown.focus();
            }
            return;
        }

        if (cellType === 'rating') {
            const current = normalizeRatingValue(cell.getAttribute('data-rating-value'));
            const next = current >= 5 ? 0 : current + 1;
            const before = captureCellUndoState(cell);
            updateRatingCellPresentation(cell, next);
            const after = captureCellUndoState(cell);
            pushSingleCellUndo(before, after);
            if (isEditMode) {
                scheduleAutoSave('control');
            } else {
                persistInteractiveControlEdit(cell);
            }
            return;
        }

        if (cellType === 'date') {
            const dateInput = cell.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
            if (dateInput && !dateInput.disabled) {
                dateInput.focus();
                dateInput.showPicker?.();
            }
            return;
        }

        if (cellType === 'image') {
            const imageEl = cell.querySelector('.xlsx-cell-image') as HTMLImageElement | null;
            const src = imageEl?.getAttribute('src') || '';
            if (src) {
                showImagePreview(src);
            }
            return;
        }

        if (isCellEditing) {
            exitCellEditMode();
        }
        cell.dataset.originalText = getCellNormalizedValue(cell);
        cell.dataset.originalHtml = cell.innerHTML;
        activeTextEditBeforeState = captureCellUndoState(cell);
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

        const editableCell = (document.querySelector('td[contenteditable="true"]') as HTMLElement | null)
            || ((document.activeElement as HTMLElement | null)?.tagName === 'TD' ? document.activeElement as HTMLElement : null);
        const active = document.activeElement as HTMLElement;
        let changed = false;
        let afterState: CellUndoState | null = null;

        if (editableCell) {
            const original = (editableCell.dataset.originalText || '').replace(/\u00a0/g, '');
            const current = getCellNormalizedValue(editableCell).replace(/\u00a0/g, '');
            changed = current !== original;
            afterState = captureCellUndoState(editableCell);
            editableCell.removeAttribute('contenteditable');
        }

        if (active && active.tagName === 'TD') {
            active.blur();
        }

        document.querySelectorAll('td[contenteditable="true"]').forEach(td => {
            td.removeAttribute('contenteditable');
        });

        if (changed) {
            pushSingleCellUndo(activeTextEditBeforeState, afterState);
            if (isEditMode) {
                if (editableCell) {
                    const rowNum = parseInt(editableCell.getAttribute('data-rownum') || '0', 10);
                    const colNum = parseInt(editableCell.getAttribute('data-colnum') || '0', 10);
                    if (rowNum && colNum) {
                        const cellData = getOrCreateRowCellData(rowNum - 1, colNum - 1);
                        if (cellData) {
                            const current = getCellNormalizedValue(editableCell).replace(/\u00a0/g, '');
                            cellData.value = current;
                        }
                    }
                }
                scheduleAutoSave('text');
            } else if (editableCell && !isVersionPreviewMode) {
                persistPlainTextEdit(editableCell);
            }
        }

        activeTextEditBeforeState = null;
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
                const top = getRowTopOffset(nextR);
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

    function setEditMode(enabled: boolean, preserveSelection: boolean = false) {
        if (enabled && isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

        isEditMode = !!enabled;
        document.body.classList.toggle('edit-mode', isEditMode);
        hideImagePreview();

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

        applyToolbarLayout(toolbarManager, {
            stickyToolbar: !!currentSettings.stickyToolbar,
            forceSticky: isEditMode,
            scrollTarget: '#content',
            onLayoutApplied: initializeVirtualScrolling
        });

        const sheetSelector = document.getElementById('sheetSelector');
        const editFileButton = document.getElementById('editFileButton');
        const toggleExpandButton = document.getElementById('toggleExpandButton');
        const togglePlainViewButton = document.getElementById('togglePlainViewButton');
        const versionHistoryButton = document.getElementById('versionHistoryButton');
        const openSettingsButton = document.getElementById('openSettingsButton');
        const toggleBackgroundButton = document.getElementById('toggleBackgroundButton');
        const helpButton = document.getElementById('helpButton');
        const convertFileButton = document.getElementById('convertFileButton');
        const refreshButton = document.getElementById('refreshButton');

        const toggleTableEditButton = document.getElementById('toggleTableEditButton');
        const saveTableEditsButton = document.getElementById('saveTableEditsButton');
        const cancelTableEditsButton = document.getElementById('cancelTableEditsButton');
        const insertControlButton = document.getElementById('insertControlButton');
        const formatBoldButton = document.getElementById('formatBoldButton');
        const formatItalicButton = document.getElementById('formatItalicButton');
        const formatTextColorButton = document.getElementById('formatTextColorButton');
        const formatBackgroundColorButton = document.getElementById('formatBackgroundColorButton');

        if (toolbarManager) {
            toolbarManager.setButtonVisibility('editFileButton', !!isTemporaryStyleFile && !isEditMode);
            toolbarManager.setButtonVisibility('toggleTableEditButton', !isEditMode && !isPlainDirectEditMode());
            toolbarManager.setButtonVisibility('saveTableEditsButton', isEditMode);
            toolbarManager.setButtonVisibility('cancelTableEditsButton', isEditMode);
            toolbarManager.setButtonVisibility('insertControlButton', isEditMode);
            toolbarManager.setButtonVisibility('formatBoldButton', false);
            toolbarManager.setButtonVisibility('formatItalicButton', false);
            toolbarManager.setButtonVisibility('formatTextColorButton', false);
            toolbarManager.setButtonVisibility('formatBackgroundColorButton', false);
            toolbarManager.setButtonVisibility('refreshButton', !isEditMode);
        } else {
            if (toggleTableEditButton) toggleTableEditButton.classList.toggle('hidden', isEditMode || isPlainDirectEditMode());
            if (saveTableEditsButton) saveTableEditsButton.classList.toggle('hidden', !isEditMode);
            if (cancelTableEditsButton) cancelTableEditsButton.classList.toggle('hidden', !isEditMode);
            if (insertControlButton) insertControlButton.classList.toggle('hidden', !isEditMode);
            if (formatBoldButton) formatBoldButton.classList.add('hidden');
            if (formatItalicButton) formatItalicButton.classList.add('hidden');
            if (formatTextColorButton) formatTextColorButton.classList.add('hidden');
            if (formatBackgroundColorButton) formatBackgroundColorButton.classList.add('hidden');
            if (editFileButton) editFileButton.classList.toggle('hidden', !isTemporaryStyleFile || isEditMode);
        }

        if (editFormattingStripEl) {
            editFormattingStripEl.classList.toggle('hidden', !isEditMode);
        }

        syncSheetSelectorVisibility();
        if (toggleExpandButton) toggleExpandButton.classList.remove('hidden');
        if (togglePlainViewButton) togglePlainViewButton.classList.toggle('hidden', isEditMode && !isPlainView);
        if (editFileButton) editFileButton.classList.toggle('hidden', !isTemporaryStyleFile || isEditMode);
        if (versionHistoryButton) versionHistoryButton.classList.toggle('hidden', isEditMode);
        if (openSettingsButton) openSettingsButton.classList.remove('hidden');
        if (toggleBackgroundButton) toggleBackgroundButton.classList.toggle('hidden', isEditMode);
        if (helpButton) helpButton.classList.toggle('hidden', isEditMode);
        if (convertFileButton) convertFileButton.classList.toggle('hidden', isEditMode);
        if (refreshButton) refreshButton.classList.toggle('hidden', isEditMode);

        reorderToolbarAroundFind(isEditMode);

        if (!isEditMode) {
            exitCellEditMode();
            hideLinkTooltip();
            hideHeaderContextMenu();
            hideColorPalette();
            hideBorderPopup();
            hideInsertControlPopup();
            clearAutoSaveTimer();
            applyInteractiveControlState();

            if (!preserveSelection) clearSelection();
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

        if (!preserveSelection) clearSelection();
        editUndoStack.length = 0;
        editRedoStack.length = 0;
        hideInsertControlPopup();

        // Enable contenteditable for table cells
        const table = document.querySelector('#tableContainer table');
        if (!table) return;

        // Rebuild visible dropdown controls when entering edit mode so the inline Edit button appears immediately.
        table.querySelectorAll('td[data-cell-type="dropdown"]').forEach((td) => {
            const cell = td as HTMLElement;
            const options = getDropdownOptionsFromCell(cell);
            const selectedValue = getCellNormalizedValue(cell);

            cell.innerHTML = renderDropdownCellContent({
                options,
                selectedValue,
                allowInteractiveControls: areInteractiveControlsEnabled(),
                showEditButton: true
            });
            updateDropdownCellPresentation(cell, selectedValue);
        });

        applyInteractiveControlState(table);

        table.querySelectorAll('td').forEach(td => {
            td.classList.add('editable-cell');
            const htmlTd = td as HTMLElement;
            const currentText = getCellNormalizedValue(htmlTd);
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
            const currentText = getCellNormalizedValue(htmlTd);
            htmlTd.dataset.originalText = currentText;
            htmlTd.dataset.originalHtml = htmlTd.innerHTML;
        });
    }

    function saveEdits(shouldExit = false, isAutosave = false) {
        if (isSaving) return;
        if (isAutosave && !currentSettings.autoSave) return;

        const table = document.querySelector('#tableContainer table');
        const hasPendingStyleOrStructureChanges = pendingCellStyleEdits.size > 0 || pendingWorksheetOps.length > 0;
        const canSaveFromEditMode = isEditMode && !!table;
        const canSaveOutsideEditMode = !isEditMode && (pendingOutsideControlEdits.length > 0 || hasPendingStyleOrStructureChanges);

        if (!canSaveFromEditMode && !canSaveOutsideEditMode) {
            return;
        }

        clearAutoSaveTimer();
        isSaving = true;
        exitAfterSave = canSaveFromEditMode && !isAutosave ? !!shouldExit : false;
        if (canSaveFromEditMode) {
            if (!isAutosave) {
                setButtonsEnabled(false);

                if (document.activeElement && document.activeElement.tagName === 'TD') {
                    (document.activeElement as HTMLElement).blur();
                }
                // Don't clear the logical cell selection on save; keep selected cells highlighted.
                if (window.getSelection) {
                    window.getSelection()!.removeAllRanges();
                }
            }
        }

        const edits: any[] = [];
        const richEdits: any[] = [];
        let styleEdits: CellStyleEdit[] = [];
        let operations: WorksheetOp[] = [];

        if (canSaveFromEditMode && table) {
            table.querySelectorAll('td.editable-cell').forEach(td => {
                const htmlTd = td as HTMLElement;
                const row = parseInt(htmlTd.getAttribute('data-rownum') || '0', 10);
                const col = parseInt(htmlTd.getAttribute('data-colnum') || '0', 10);
                if (!row || !col) return;

                const cellType = getCellType(htmlTd);
                const original = (htmlTd.dataset.originalText || '').replace(/\u00a0/g, '');
                const current = getCellNormalizedValue(htmlTd).replace(/\u00a0/g, '');
                const originalHtml = (htmlTd.dataset.originalHtml || '').trim();
                const currentHtml = (htmlTd.innerHTML || '').trim();

                const runs = cellType === 'text' ? getCellRichRuns(htmlTd) : [];
                const shouldSaveRuns = cellType === 'text' && (hasRunFormatting(runs) || currentHtml !== originalHtml);

                if (shouldSaveRuns) {
                    richEdits.push({ row, col, runs });
                }

                if (current !== original) {
                    edits.push({ row, col, value: current });
                    const cellData = getOrCreateRowCellData(row - 1, col - 1);
                    if (cellData) {
                        cellData.value = current;
                        if (cellType === 'checkbox') {
                            cellData.checkboxChecked = parseBooleanCellValue(current) === true;
                        }
                    }
                }
            });

            styleEdits = Array.from(pendingCellStyleEdits.values());
            operations = pendingWorksheetOps;
        } else {
            pendingOutsideControlEdits.forEach((edit) => {
                const cellData = getOrCreateRowCellData(edit.row - 1, edit.col - 1);
                if (cellData) {
                    cellData.value = edit.value;
                }
                edits.push({ row: edit.row, col: edit.col, value: edit.value });
            });

            styleEdits = Array.from(pendingCellStyleEdits.values());
            operations = pendingWorksheetOps;
        }

        if (canSaveFromEditMode && pendingOutsideControlEdits.length > 0) {
            pendingOutsideControlEdits.forEach((edit) => {
                const cellData = getOrCreateRowCellData(edit.row - 1, edit.col - 1);
                if (cellData) {
                    cellData.value = edit.value;
                }
                const existingIndex = edits.findIndex((candidate) => candidate.row === edit.row && candidate.col === edit.col);
                if (existingIndex >= 0) {
                    edits[existingIndex].value = edit.value;
                    return;
                }
                edits.push({ row: edit.row, col: edit.col, value: edit.value });
            });
        }

        if (!edits.length && !richEdits.length && !styleEdits.length && !operations.length) {
            isSaving = false;
            if (canSaveFromEditMode) {
                setButtonsEnabled(true);
            }
            return;
        }

        if (!isAutosave) {
            setLoadingText('Saving worksheet...');
            showLoading();
        }
        vscode.postMessage({ command: 'saveXlsxEdits', sheetIndex: currentWorksheet, edits, richEdits, styleEdits, operations, isAutosave });
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
            (next: XlsxViewSettings) => {
                applySettings(next);
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
            clearDataTransforms();
            clearSelection();
            renderWorksheet(currentWorksheet);
        });

        toolbar.setButtons(createXlsxToolbarButtons({
            onFind: () => openFindOverlay(),
            textColorIcon,
            bgColorIcon,
            onEditFile: () => {
                if (!isTemporaryStyleFile) return;
                vscode.postMessage({ command: 'toggleView', isTableView: false });
            },
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
            onInsertControl: () => {
                const btn = document.getElementById('insertControlButton') as HTMLElement | null;
                if (btn) {
                    showInsertControlPopup(btn);
                }
            },
            onFormatBold: () => applyEditFormatting('bold'),
            onFormatItalic: () => applyEditFormatting('italic'),
            onFormatTextColor: () => { },
            onFormatBackgroundColor: () => { },
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
                if (isPlainView && isTemporaryStyleFile) {
                    requestStyledMode();
                    return;
                }
                isPlainView = !isPlainView;
                syncPlainViewUiState();
                syncTemporaryFileToolbarActions();
                // Always notify the provider so it stays in sync for all file types
                vscode.postMessage({ command: 'setPreferredViewMode', mode: isPlainView ? 'plain' : 'styled' });
                applySettingsForScope(getCurrentSettingsScope());

                rowCache.clear();
                currentVisibleStart = 0;
                currentVisibleEnd = 0;
                renderWorksheet(currentWorksheet);
            },
            onVersionHistory: () => {
                if (isEditMode) return;
                vscode.postMessage({ command: 'showVersionHistory' });
            },
            onOpenSettings: () => { },
            onToggleBackground: () => { },
            onHelp: () => {
                FeedbackModal.show();
            },
            onProjects: () => {
                ProjectsModal.show();
            },
            onConvertFile: () => {
                if (isEditMode) return;
                vscode.postMessage({ command: 'convertFile' });
            },
            onEnableAsDefault: () => {
                vscode.postMessage({ command: 'enableAsDefault' });
            },
            onRefresh: () => {
                if (isEditMode) return;
                vscode.postMessage({ command: 'requestFreshData' });
            }
        }));

        toolbar.prependElement(sheetSelector);

        // Inject tooltip if variables are present
        InfoTooltip.inject('toolbar', (window as any).viewImgUri, (window as any).logoSvgUri, 'table view');

        // Ensure the "Plain/Styled" toggle shows the correct label on initial render
        const togglePlainViewBtn = document.getElementById('togglePlainViewButton');
        if (togglePlainViewBtn) {
            updatePlainViewButtonLabel();
        }

        wireEditFormattingControls();

        if (typeof ThemeManager !== 'undefined') {
            new ThemeManager('toggleBackgroundButton', {
                onBeforeCycle: () => !isEditMode
            }, vscode);
        }

        wireSettingsUI();

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;

            if (!target.closest('#insertControlButton') && !target.closest('#xlsxInsertControlPopup') && !target.closest('#xlsxDropdownOptionsPopup')) {
                hideInsertControlPopup();
            }

            if (!target.closest('#xlsxDropdownOptionsPopup') && !target.closest('#xlsxInsertControlPopup') && !target.closest('#insertControlButton') && dropdownOptionsPopupEl && !dropdownOptionsPopupEl.classList.contains('hidden')) {
                hideDropdownOptionsPopup(null);
            }
        });

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
        syncSheetSelectorVisibility();
    }

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message !== 'object') return;

        if (message.command === 'initSettings') {
            consumeIncomingSettingsPayload(message);
            return;
        }

        if (message.command === 'settingsUpdated') {
            consumeIncomingSettingsPayload(message);
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
                const isAutosaveResult = !!message.isAutosave;
                showToast(isAutosaveResult ? 'Autosaved' : 'Saved', isAutosaveResult, 1000);
                pendingWorksheetOps = [];
                pendingCellStyleEdits.clear();
                clearPendingOutsideControlEdits();
                manualSaveReminderUntil = 0;

                const shouldExitAfterManualSave = !isAutosaveResult || exitAfterSave;
                if (shouldExitAfterManualSave) {
                    exitAfterSave = false;
                    // Preserve selection when save requests exit so user doesn't lose context
                    setEditMode(false, true);
                } else if (isEditMode) {
                    captureOriginalCellValues();
                }
            } else {
                const isAutosaveResult = !!message.isAutosave;
                showToast(isAutosaveResult ? 'Autosave failed' : 'Error saving', isAutosaveResult, 1000);
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

        if (message.command === 'styleModeActivated') {
            activateStyledMode();
            return;
        }

        if (message.command === 'showStyleModeNotice') {
            showStyleModeNoticePopup();
            return;
        }

        if (message.command === 'styleModeCancelled') {
            cancelStyledModeRequest();
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
            clearDataTransforms();

            hasVirtualTableInit = true;
            isTemporaryStyleFile = message.fileType === 'csv' || message.fileType === 'tsv';
            isPlainView = message.isPlainView !== undefined ? !!message.isPlainView : isTemporaryStyleFile;
            syncPlainViewUiState();

            const rowHeaderWidth = typeof message.rowHeaderWidth === 'number' ? message.rowHeaderWidth : MIN_ROW_HEADER_WIDTH;
            setRowHeaderWidth(rowHeaderWidth, true);

            attachHandlersOnce();
            syncTemporaryFileToolbarActions();
            populateSheetSelector();
            const selector = document.getElementById('sheetSelector') as HTMLSelectElement | null;
            if (selector) selector.value = String(currentWorksheet);

            applySettingsForScope(getCurrentSettingsScope());
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
            clearDataTransforms();

            const rowHeaderWidth = typeof message.rowHeaderWidth === 'number' ? message.rowHeaderWidth : MIN_ROW_HEADER_WIDTH;
            setRowHeaderWidth(rowHeaderWidth, true);

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
