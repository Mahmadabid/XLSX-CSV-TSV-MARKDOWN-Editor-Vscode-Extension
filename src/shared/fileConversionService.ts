import * as fs from 'fs';
import * as path from 'path';
import * as Excel from 'exceljs';

export type TabularFileType = string;

export interface TabularSheetData {
    name: string;
    rows: string[][];
}

export interface TabularWorkbookData {
    sheets: TabularSheetData[];
}

export interface TabularFileConverter {
    type: TabularFileType;
    label: string;
    extension: string;
    read(filePath: string): Promise<TabularWorkbookData>;
    write(filePath: string, workbook: TabularWorkbookData): Promise<void>;
}

const convertersByType = new Map<TabularFileType, TabularFileConverter>();
const convertersByExtension = new Map<string, TabularFileType>();
let builtInConvertersRegistered = false;

const BUILT_IN_TYPES = ['csv', 'tsv', 'xlsx'];

function normalizeExtension(extension: string): string {
    const trimmed = extension.trim().toLowerCase();
    return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function normalizeRows(rows: unknown): string[][] {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.map(row => {
        if (!Array.isArray(row)) {
            return [];
        }

        return row.map(cell => {
            if (cell === null || cell === undefined) {
                return '';
            }
            return String(cell);
        });
    });
}

function normalizeWorkbook(workbook: TabularWorkbookData): TabularWorkbookData {
    const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];

    if (!sheets.length) {
        return {
            sheets: [{ name: 'Sheet1', rows: [] }]
        };
    }

    return {
        sheets: sheets.map((sheet, index) => ({
            name: sheet?.name?.trim() || `Sheet${index + 1}`,
            rows: normalizeRows(sheet?.rows)
        }))
    };
}

function parseDelimitedText(content: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const ch = content[i];

        if (ch === '"') {
            if (inQuotes && i + 1 < content.length && content[i + 1] === '"') {
                field += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (!inQuotes && ch === delimiter) {
            row.push(field);
            field = '';
            continue;
        }

        if (!inQuotes && ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            continue;
        }

        if (!inQuotes && ch === '\r') {
            if (i + 1 < content.length && content[i + 1] === '\n') {
                i++;
            }
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
            continue;
        }

        field += ch;
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

function serializeDelimitedRows(rows: string[][], delimiter: string): string {
    if (!rows.length) {
        return '';
    }

    const escapedRows = rows.map(row => {
        const safeRow = Array.isArray(row) ? row : [];
        return safeRow.map(cell => {
            const value = cell === null || cell === undefined ? '' : String(cell);
            const shouldQuote = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r');
            if (!shouldQuote) {
                return value;
            }
            return `"${value.replace(/"/g, '""')}"`;
        }).join(delimiter);
    });

    return escapedRows.join('\n') + '\n';
}

function getExcelCellValueAsString(cell: Excel.Cell): string {
    const value = cell.value;

    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'object') {
        const objectValue = value as {
            text?: unknown;
            result?: unknown;
            richText?: Array<{ text?: unknown }>;
        };

        if (typeof objectValue.text === 'string') {
            return objectValue.text;
        }

        if (objectValue.result !== null && objectValue.result !== undefined) {
            return String(objectValue.result);
        }

        if (Array.isArray(objectValue.richText)) {
            return objectValue.richText
                .map(part => typeof part?.text === 'string' ? part.text : '')
                .join('');
        }
    }

    return String(value);
}

function sanitizeWorksheetName(name: string, index: number, usedNames: Set<string>): string {
    let base = (name || `Sheet${index + 1}`).replace(/[\\/*?:\[\]]/g, ' ').trim();
    if (!base) {
        base = `Sheet${index + 1}`;
    }
    if (base.length > 31) {
        base = base.slice(0, 31);
    }

    let candidate = base;
    let suffix = 1;

    while (usedNames.has(candidate.toLowerCase())) {
        const suffixText = ` (${suffix})`;
        const maxBaseLength = Math.max(1, 31 - suffixText.length);
        candidate = `${base.slice(0, maxBaseLength)}${suffixText}`;
        suffix++;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
}

function createDelimitedConverter(type: string, label: string, delimiter: string): TabularFileConverter {
    return {
        type,
        label,
        extension: type,
        async read(filePath: string): Promise<TabularWorkbookData> {
            const content = await fs.promises.readFile(filePath, 'utf8');
            return {
                sheets: [{
                    name: 'Sheet1',
                    rows: parseDelimitedText(content, delimiter)
                }]
            };
        },
        async write(filePath: string, workbook: TabularWorkbookData): Promise<void> {
            const normalized = normalizeWorkbook(workbook);
            const rows = normalized.sheets[0]?.rows ?? [];
            const content = serializeDelimitedRows(rows, delimiter);
            await fs.promises.writeFile(filePath, content, 'utf8');
        }
    };
}

function createXlsxConverter(): TabularFileConverter {
    return {
        type: 'xlsx',
        label: 'XLSX',
        extension: 'xlsx',
        async read(filePath: string): Promise<TabularWorkbookData> {
            const workbook = new Excel.Workbook();
            await workbook.xlsx.readFile(filePath);

            const sheets = workbook.worksheets.map((worksheet, index) => {
                let maxRow = 0;
                let maxCol = 0;

                worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                    maxRow = Math.max(maxRow, rowNumber);
                    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
                        maxCol = Math.max(maxCol, colNumber);
                    });
                });

                const rows: string[][] = [];
                for (let rowNumber = 1; rowNumber <= maxRow; rowNumber++) {
                    const row: string[] = [];
                    for (let colNumber = 1; colNumber <= maxCol; colNumber++) {
                        const cell = worksheet.getRow(rowNumber).getCell(colNumber);
                        row.push(getExcelCellValueAsString(cell));
                    }
                    rows.push(row);
                }

                return {
                    name: worksheet.name || `Sheet${index + 1}`,
                    rows
                };
            });

            return {
                sheets: sheets.length ? sheets : [{ name: 'Sheet1', rows: [] }]
            };
        },
        async write(filePath: string, workbookData: TabularWorkbookData): Promise<void> {
            const normalized = normalizeWorkbook(workbookData);
            const workbook = new Excel.Workbook();
            const usedNames = new Set<string>();

            for (let index = 0; index < normalized.sheets.length; index++) {
                const sheet = normalized.sheets[index];
                const sheetName = sanitizeWorksheetName(sheet.name, index, usedNames);
                const worksheet = workbook.addWorksheet(sheetName);
                const rows = normalizeRows(sheet.rows);
                if (rows.length > 0) {
                    worksheet.addRows(rows);
                }
            }

            await workbook.xlsx.writeFile(filePath);
        }
    };
}

function ensureBuiltInConvertersRegistered(): void {
    if (builtInConvertersRegistered) {
        return;
    }

    registerTabularFileConverter(createDelimitedConverter('csv', 'CSV', ','));
    registerTabularFileConverter(createDelimitedConverter('tsv', 'TSV', '\t'));
    registerTabularFileConverter(createXlsxConverter());
    builtInConvertersRegistered = true;
}

function getConverterForType(type: TabularFileType): TabularFileConverter {
    ensureBuiltInConvertersRegistered();
    const converter = convertersByType.get(type);
    if (!converter) {
        throw new Error(`No converter registered for "${type}"`);
    }
    return converter;
}

export function registerTabularFileConverter(converter: TabularFileConverter): void {
    const normalizedConverter: TabularFileConverter = {
        ...converter,
        extension: normalizeExtension(converter.extension).slice(1)
    };

    convertersByType.set(normalizedConverter.type, normalizedConverter);
    convertersByExtension.set(normalizeExtension(normalizedConverter.extension), normalizedConverter.type);
}

export function detectTabularFileType(filePath: string): TabularFileType | undefined {
    ensureBuiltInConvertersRegistered();
    return convertersByExtension.get(path.extname(filePath).toLowerCase());
}

export function getTabularFileTypeInfo(type: TabularFileType): { type: TabularFileType; label: string; extension: string } {
    const converter = getConverterForType(type);
    return {
        type: converter.type,
        label: converter.label,
        extension: converter.extension
    };
}

export function getSupportedTabularFileTypes(): TabularFileType[] {
    ensureBuiltInConvertersRegistered();

    const prioritized = BUILT_IN_TYPES.filter(type => convertersByType.has(type));
    const additional = Array.from(convertersByType.keys()).filter(type => !BUILT_IN_TYPES.includes(type));

    return [...prioritized, ...additional];
}

export function getTargetTabularFileTypes(sourceType: TabularFileType): TabularFileType[] {
    return getSupportedTabularFileTypes().filter(type => type !== sourceType);
}

export async function readTabularFile(filePath: string, sourceType?: TabularFileType): Promise<{ type: TabularFileType; workbook: TabularWorkbookData }> {
    const type = sourceType ?? detectTabularFileType(filePath);
    if (!type) {
        throw new Error(`Unsupported file extension for "${filePath}"`);
    }

    const converter = getConverterForType(type);
    return {
        type,
        workbook: await converter.read(filePath)
    };
}

export async function writeTabularFile(filePath: string, workbook: TabularWorkbookData, targetType?: TabularFileType): Promise<TabularFileType> {
    const type = targetType ?? detectTabularFileType(filePath);
    if (!type) {
        throw new Error(`Unsupported file extension for "${filePath}"`);
    }

    const converter = getConverterForType(type);
    await converter.write(filePath, workbook);
    return type;
}

export async function convertTabularFile(options: {
    sourcePath: string;
    targetPath: string;
    sourceType?: TabularFileType;
    targetType?: TabularFileType;
}): Promise<{
    sourceType: TabularFileType;
    targetType: TabularFileType;
    sourceSheetCount: number;
    droppedSheets: boolean;
}> {
    const { sourcePath, targetPath, sourceType, targetType } = options;

    const source = await readTabularFile(sourcePath, sourceType);
    const resolvedTargetType = targetType ?? detectTabularFileType(targetPath);

    if (!resolvedTargetType) {
        throw new Error(`Unsupported target file extension for "${targetPath}"`);
    }

    const normalizedWorkbook = normalizeWorkbook(source.workbook);
    const sourceSheetCount = normalizedWorkbook.sheets.length;
    const supportsMultipleSheets = resolvedTargetType === 'xlsx';
    const droppedSheets = !supportsMultipleSheets && sourceSheetCount > 1;

    const workbookForTarget = droppedSheets
        ? { sheets: [normalizedWorkbook.sheets[0]] }
        : normalizedWorkbook;

    await writeTabularFile(targetPath, workbookForTarget, resolvedTargetType);

    return {
        sourceType: source.type,
        targetType: resolvedTargetType,
        sourceSheetCount,
        droppedSheets
    };
}
