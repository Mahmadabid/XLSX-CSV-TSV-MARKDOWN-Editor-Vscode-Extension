/* eslint-disable @typescript-eslint/no-explicit-any */

export function cloneCellData<T = any>(cell: T): T {
    return JSON.parse(JSON.stringify(cell));
}

export function getCellFromRow(row: any, colNumber: number): any | null {
    if (!row || !Array.isArray(row.cells)) return null;
    return row.cells.find((cell: any) => cell.colNumber === colNumber) || null;
}

export function setCellOnRow(row: any, colNumber: number, sourceCell: any | null): void {
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

export function normalizeRowsAfterStructureChange(rows: any[], rowCache: Map<number, any>): void {
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

export function cloneWorksheetOps<T = any>(ops: T[]): T[] {
    return JSON.parse(JSON.stringify(ops || []));
}
