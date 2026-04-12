export interface XlsxSelectionBindings {
    selectedCells: Set<HTMLElement>;
    selectedRows: Set<number>;
    selectedColumns: Set<number>;
    selectedRowIndices: Set<number>;
    selectedColumnIndices: Set<number>;
    getActiveCell: () => HTMLElement | null;
    setActiveCell: (cell: HTMLElement | null) => void;
    getLastSelectedRow: () => number | null;
    setLastSelectedRow: (value: number | null) => void;
    getLastSelectedColumn: () => number | null;
    setLastSelectedColumn: (value: number | null) => void;
    getTotalRows: () => number;
    getColumnCount: () => number;
}

export class XlsxSelectionManager {
    constructor(private readonly bindings: XlsxSelectionBindings) {}

    clearSelection(): void {
        document.querySelectorAll('.selected, .active-cell, .row-selected, .column-selected').forEach(el => {
            el.classList.remove('selected', 'active-cell', 'row-selected', 'column-selected');
        });

        this.bindings.selectedCells.clear();
        this.bindings.selectedRows.clear();
        this.bindings.selectedColumns.clear();
        this.bindings.selectedRowIndices.clear();
        this.bindings.selectedColumnIndices.clear();
        this.bindings.setActiveCell(null);
        this.bindings.setLastSelectedRow(null);
        this.bindings.setLastSelectedColumn(null);

        const info = document.getElementById('selectionInfo');
        if (info) info.style.display = 'none';

        this.applyHeaderHighlightsFromCurrentSelection();
    }

    selectCell(cell: HTMLElement, isMulti = false): void {
        if (!isMulti) {
            this.clearSelection();
        }

        cell.classList.add('selected');
        cell.classList.add('active-cell');
        this.bindings.selectedCells.add(cell);
        this.bindings.setActiveCell(cell);

        this.applyHeaderHighlightsFromCurrentSelection();
        this.updateSelectionInfo();
    }

    selectRange(startRow: number, startCol: number, endRow: number, endCol: number): void {
        this.clearSelection();

        const minRow = Math.min(startRow, endRow);
        const maxRow = Math.max(startRow, endRow);
        const minCol = Math.min(startCol, endCol);
        const maxCol = Math.max(startCol, endCol);

        const cells = document.querySelectorAll('td') as NodeListOf<HTMLElement>;
        cells.forEach(cell => {
            const row = parseInt(cell.dataset.row || '-1', 10);
            const col = parseInt(cell.dataset.col || '-1', 10);

            if (row >= minRow && row <= maxRow && col >= minCol && col <= maxCol) {
                cell.classList.add('selected');
                this.bindings.selectedCells.add(cell);
            }
        });

        const startCell = document.querySelector('td[data-row="' + startRow + '"][data-col="' + startCol + '"]') as HTMLElement | null;
        if (startCell) {
            startCell.classList.add('active-cell');
            this.bindings.setActiveCell(startCell);
        }

        this.applyHeaderHighlightsFromCurrentSelection();
        this.updateSelectionInfo();
    }

    selectRow(rowIndex: number, ctrlKey: boolean, shiftKey: boolean): void {
        if (!ctrlKey && !shiftKey) {
            this.clearSelection();
            this.bindings.setLastSelectedRow(rowIndex);
        }

        const lastSelectedRow = this.bindings.getLastSelectedRow();
        if (shiftKey && lastSelectedRow !== null && lastSelectedRow !== rowIndex) {
            if (!ctrlKey) {
                this.clearSelection();
            }

            const minRow = Math.min(lastSelectedRow, rowIndex);
            const maxRow = Math.max(lastSelectedRow, rowIndex);

            for (let row = minRow; row <= maxRow; row++) {
                if (!this.bindings.selectedRows.has(row)) {
                    this.bindings.selectedRows.add(row);
                    this.bindings.selectedRowIndices.add(row);
                    const cells = document.querySelectorAll('td[data-row="' + row + '"], th[data-row="' + row + '"]');
                    cells.forEach(cell => {
                        cell.classList.add('row-selected');
                        if (cell.tagName === 'TD') {
                            this.bindings.selectedCells.add(cell as HTMLElement);
                        }
                    });
                }
            }
        } else if (ctrlKey) {
            if (this.bindings.selectedRows.has(rowIndex)) {
                this.bindings.selectedRows.delete(rowIndex);
                this.bindings.selectedRowIndices.delete(rowIndex);
                const cells = document.querySelectorAll('td[data-row="' + rowIndex + '"], th[data-row="' + rowIndex + '"]');
                cells.forEach(cell => {
                    cell.classList.remove('row-selected');
                    if (cell.tagName === 'TD') this.bindings.selectedCells.delete(cell as HTMLElement);
                });
            } else {
                this.bindings.selectedRows.add(rowIndex);
                this.bindings.selectedRowIndices.add(rowIndex);
                const cells = document.querySelectorAll('td[data-row="' + rowIndex + '"], th[data-row="' + rowIndex + '"]');
                cells.forEach(cell => {
                    cell.classList.add('row-selected');
                    if (cell.tagName === 'TD') {
                        this.bindings.selectedCells.add(cell as HTMLElement);
                    }
                });
            }
        } else {
            this.bindings.selectedRows.add(rowIndex);
            this.bindings.selectedRowIndices.add(rowIndex);
            const cells = document.querySelectorAll('td[data-row="' + rowIndex + '"], th[data-row="' + rowIndex + '"]');
            cells.forEach(cell => {
                cell.classList.add('row-selected');
                if (cell.tagName === 'TD') {
                    this.bindings.selectedCells.add(cell as HTMLElement);
                }
            });
        }

        this.applyHeaderHighlightsFromCurrentSelection();
        this.updateSelectionInfo();
    }

    selectColumn(colIndex: number, ctrlKey: boolean, shiftKey: boolean): void {
        if (!ctrlKey && !shiftKey) {
            this.clearSelection();
            this.bindings.setLastSelectedColumn(colIndex);
        }

        const lastSelectedColumn = this.bindings.getLastSelectedColumn();
        if (shiftKey && lastSelectedColumn !== null && lastSelectedColumn !== colIndex) {
            if (!ctrlKey) {
                this.clearSelection();
            }

            const minCol = Math.min(lastSelectedColumn, colIndex);
            const maxCol = Math.max(lastSelectedColumn, colIndex);

            for (let col = minCol; col <= maxCol; col++) {
                if (!this.bindings.selectedColumns.has(col)) {
                    this.bindings.selectedColumns.add(col);
                    this.bindings.selectedColumnIndices.add(col);
                    const cells = document.querySelectorAll('td[data-col="' + col + '"], th[data-col="' + col + '"]');
                    cells.forEach(cell => {
                        cell.classList.add('column-selected');
                        if (cell.tagName === 'TD') {
                            this.bindings.selectedCells.add(cell as HTMLElement);
                        }
                    });
                }
            }
        } else if (ctrlKey) {
            if (this.bindings.selectedColumns.has(colIndex)) {
                this.bindings.selectedColumns.delete(colIndex);
                this.bindings.selectedColumnIndices.delete(colIndex);
                const cells = document.querySelectorAll('td[data-col="' + colIndex + '"], th[data-col="' + colIndex + '"]');
                cells.forEach(cell => {
                    cell.classList.remove('column-selected');
                    if (cell.tagName === 'TD') this.bindings.selectedCells.delete(cell as HTMLElement);
                });
            } else {
                this.bindings.selectedColumns.add(colIndex);
                this.bindings.selectedColumnIndices.add(colIndex);
                const cells = document.querySelectorAll('td[data-col="' + colIndex + '"], th[data-col="' + colIndex + '"]');
                cells.forEach(cell => {
                    cell.classList.add('column-selected');
                    if (cell.tagName === 'TD') {
                        this.bindings.selectedCells.add(cell as HTMLElement);
                    }
                });
            }
        } else {
            this.bindings.selectedColumns.add(colIndex);
            this.bindings.selectedColumnIndices.add(colIndex);
            const cells = document.querySelectorAll('td[data-col="' + colIndex + '"], th[data-col="' + colIndex + '"]');
            cells.forEach(cell => {
                cell.classList.add('column-selected');
                if (cell.tagName === 'TD') {
                    this.bindings.selectedCells.add(cell as HTMLElement);
                }
            });
        }

        this.applyHeaderHighlightsFromCurrentSelection();
        this.updateSelectionInfo();
    }

    reapplySelection(): void {
        this.bindings.selectedColumnIndices.forEach(colIdx => {
            document.querySelectorAll('td[data-col="' + colIdx + '"], th[data-col="' + colIdx + '"]').forEach((cell) => {
                cell.classList.add('column-selected');
                if (cell.tagName === 'TD') this.bindings.selectedCells.add(cell as HTMLElement);
            });
        });

        this.bindings.selectedRowIndices.forEach(rowIdx => {
            document.querySelectorAll('td[data-row="' + rowIdx + '"], th[data-row="' + rowIdx + '"]').forEach((cell) => {
                cell.classList.add('row-selected');
                if (cell.tagName === 'TD') this.bindings.selectedCells.add(cell as HTMLElement);
            });
        });

        const activeCell = this.bindings.getActiveCell();
        if (activeCell) {
            const row = activeCell.dataset?.row;
            const col = activeCell.dataset?.col;
            if (row !== undefined && col !== undefined) {
                const newCell = document.querySelector('td[data-row="' + row + '"][data-col="' + col + '"]') as HTMLElement | null;
                if (newCell) {
                    newCell.classList.add('active-cell');
                    this.bindings.setActiveCell(newCell);
                    this.bindings.selectedCells.add(newCell);
                }
            }
        }

        this.applyHeaderHighlightsFromCurrentSelection();
    }

    updateSelectionInfo(): void {
        this.applyHeaderHighlightsFromCurrentSelection();

        const info = document.getElementById('selectionInfo');
        if (!info) return;

        if (this.bindings.selectedColumnIndices.size > 0 || this.bindings.selectedRowIndices.size > 0) {
            let rowCount = this.bindings.selectedRowIndices.size > 0 ? this.bindings.selectedRowIndices.size : this.bindings.getTotalRows();
            let colCount = this.bindings.selectedColumnIndices.size > 0 ? this.bindings.selectedColumnIndices.size : this.bindings.getColumnCount();

            if (this.bindings.selectedRowIndices.size > 0 && this.bindings.selectedColumnIndices.size === 0) {
                colCount = this.bindings.getColumnCount();
            }
            if (this.bindings.selectedColumnIndices.size > 0 && this.bindings.selectedRowIndices.size === 0) {
                rowCount = this.bindings.getTotalRows();
            }

            info.textContent = rowCount + 'R × ' + colCount + 'C';
            info.style.display = 'block';
            return;
        }

        if (this.bindings.selectedCells.size > 1) {
            const rows = new Set();
            const cols = new Set();
            this.bindings.selectedCells.forEach(cell => {
                rows.add(cell.dataset.row);
                cols.add(cell.dataset.col);
            });
            info.textContent = rows.size + 'R × ' + cols.size + 'C';
            info.style.display = 'block';
            return;
        }

        info.style.display = 'none';
    }

    private applyHeaderHighlightsFromCurrentSelection(): void {
        document.querySelectorAll('th.row-header').forEach((cell) => cell.classList.remove('row-selected'));
        document.querySelectorAll('th.col-header').forEach((cell) => cell.classList.remove('column-selected'));

        const corner = document.querySelector('th.corner-cell');
        if (corner) {
            corner.classList.remove('selected', 'row-selected', 'column-selected');
        }

        const rowIndexes = new Set<number>();
        const colIndexes = new Set<number>();

        this.bindings.selectedRowIndices.forEach((rowIdx) => rowIndexes.add(rowIdx));
        this.bindings.selectedColumnIndices.forEach((colIdx) => colIndexes.add(colIdx));

        this.bindings.selectedCells.forEach((cell) => {
            const row = parseInt(cell.dataset.row || '-1', 10);
            const col = parseInt(cell.dataset.col || '-1', 10);
            if (row >= 0) rowIndexes.add(row);
            if (col >= 0) colIndexes.add(col);
        });

        const activeCell = this.bindings.getActiveCell();
        if (activeCell) {
            const row = parseInt(activeCell.dataset.row || '-1', 10);
            const col = parseInt(activeCell.dataset.col || '-1', 10);
            if (row >= 0) rowIndexes.add(row);
            if (col >= 0) colIndexes.add(col);
        }

        rowIndexes.forEach((rowIdx) => {
            document.querySelectorAll('th.row-header[data-row="' + rowIdx + '"]').forEach((cell) => {
                cell.classList.add('row-selected');
            });
        });

        colIndexes.forEach((colIdx) => {
            document.querySelectorAll('th.col-header[data-col="' + colIdx + '"]').forEach((cell) => {
                cell.classList.add('column-selected');
            });
        });

        const hasExplicitRowHeaderSelection = this.bindings.selectedRowIndices.size > 0;
        const hasExplicitColumnHeaderSelection = this.bindings.selectedColumnIndices.size > 0;
        if (corner && hasExplicitRowHeaderSelection && hasExplicitColumnHeaderSelection) {
            corner.classList.add('selected', 'row-selected', 'column-selected');
        }
    }
}
