import type { BorderLineStyle } from './xlsxBorderComponent';

export type StructuralOpType =
    | 'insertRowAbove'
    | 'insertRowBelow'
    | 'deleteRow'
    | 'insertColumnLeft'
    | 'insertColumnRight'
    | 'deleteColumn';

export type WorksheetOpType =
    | StructuralOpType
    | 'deleteCellShiftLeft'
    | 'deleteCellShiftUp'
    | 'mergeRange'
    | 'unmergeRange'
    | 'insertControl';

export type InsertControlType = 'checkbox' | 'dropdown' | 'rating' | 'date';

export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type WrapMode = 'wrap' | 'overflow' | 'clip';

export interface StructuralOp {
    type: StructuralOpType;
    index: number;
}

export interface BorderStyleEdit {
    clear?: boolean;
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
    color?: string;
    style?: BorderLineStyle;
}

export interface WorksheetOp {
    type: WorksheetOpType;
    index?: number;
    row?: number;
    col?: number;
    startRow?: number;
    startCol?: number;
    endRow?: number;
    endCol?: number;
    controlType?: InsertControlType;
    dropdownOptions?: string[];
    defaultValue?: string;
}

export interface CellStyleEdit {
    row: number;
    col: number;
    bgColor?: string;
    textColor?: string;
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    fontFamily?: string;
    strike?: boolean;
    horizontalAlign?: HorizontalAlign;
    verticalAlign?: VerticalAlign;
    wrapMode?: WrapMode;
    indent?: number;
    border?: BorderStyleEdit;
    clearFormatting?: boolean;
}

export interface CellUndoState {
    row: number;
    col: number;
    key: string;
    styleAttr: string;
    innerHtml: string;
    dataCellType?: string;
    dataCheckboxChecked?: string;
    dataDropdownValue?: string;
    dataRatingValue?: string;
    dataDateValue?: string;
    pendingStyle: CellStyleEdit | null;
}

export interface StyleEditUndoEntry {
    kind: 'style';
    before: CellUndoState[];
    after: CellUndoState[];
}

export interface WorksheetStateSnapshot {
    rows: any[];
    totalRows: number;
    columnCount: number;
    columnWidths: number[];
    allRowHeights: number[];
    mergedCells: any[];
    pendingWorksheetOps: WorksheetOp[];
}

export interface SheetEditUndoEntry {
    kind: 'sheet';
    before: WorksheetStateSnapshot;
    after: WorksheetStateSnapshot;
}

export type EditUndoEntry = StyleEditUndoEntry | SheetEditUndoEntry;
