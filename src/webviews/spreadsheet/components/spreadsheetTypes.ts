import type { BorderLineStyle } from './spreadsheetBorderComponent';

export type StructuralOpType =
    | 'insertRowAbove'
    | 'insertRowBelow'
    | 'deleteRow'
    | 'insertColumnLeft'
    | 'insertColumnRight'
    | 'deleteColumn';

export type WorksheetOpType =
    | StructuralOpType
    | 'insertCellShiftRight'
    | 'insertCellShiftDown'
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
    // Logical/Editor properties
    bgColor?: string;
    textColor?: string;
    bold?: boolean;
    italic?: boolean;
    fontSize?: number | string;
    fontFamily?: string;
    strike?: boolean;
    horizontalAlign?: HorizontalAlign;
    verticalAlign?: VerticalAlign | string;
    wrapMode?: WrapMode;
    indent?: number;

    // CSS Properties
    backgroundColor?: string;
    color?: string;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    textDecorationLine?: string;
    textDecorationThickness?: string;
    textDecorationSkipInk?: string;
    textAlign?: string;
    whiteSpace?: string;
    wordWrap?: string;
    overflow?: string;
    textOverflow?: string;
    paddingLeft?: string;

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
