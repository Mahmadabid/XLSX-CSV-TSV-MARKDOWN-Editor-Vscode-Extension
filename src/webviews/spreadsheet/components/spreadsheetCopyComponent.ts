/* eslint-disable @typescript-eslint/no-explicit-any */

export interface XlsxCopyContext {
    selectedCells: Set<HTMLElement>;
    selectedColumnIndices: Set<number>;
    selectedRowIndices: Set<number>;
    columnCount: number;
    totalRows: number;
    rowCache: Map<number, any>;
    isCopying: boolean;
    setIsCopying: (next: boolean) => void;
    showToast: (message: string) => void;
    requestAllRows: () => Promise<any[]>;
    normalizeCellText: (text: string | null | undefined) => string;
}

function yieldToMain() {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}

export async function writeToClipboardAsync(text: string) {
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

export async function copySelectionToClipboard(ctx: XlsxCopyContext): Promise<void> {
    const hasFullColumnSelection = ctx.selectedColumnIndices.size > 0;
    const hasFullRowSelection = ctx.selectedRowIndices.size > 0;

    if (!hasFullColumnSelection && !hasFullRowSelection && ctx.selectedCells.size === 0) return;
    if (ctx.isCopying) return;

    ctx.setIsCopying(true);

    try {
        ctx.showToast('Copying...');
        await yieldToMain();

        const outputLines: string[] = [];

        if (hasFullColumnSelection || hasFullRowSelection) {
            const allRows = await ctx.requestAllRows();

            if (!allRows || allRows.length === 0) {
                ctx.showToast('Failed to fetch data');
                ctx.setIsCopying(false);
                return;
            }

            if (allRows.length >= ctx.totalRows * 0.9) {
                allRows.forEach((row, i) => {
                    ctx.rowCache.set(i, row);
                });
            }

            const rowCount = allRows.length;

            if (hasFullColumnSelection && !hasFullRowSelection) {
                const sortedCols = Array.from(ctx.selectedColumnIndices).sort((a, b) => a - b);

                for (let r = 0; r < rowCount; r++) {
                    const rowData = allRows[r] || { cells: [] };
                    const lineParts = sortedCols.map(c => {
                        const cellData = rowData.cells ? rowData.cells.find((cell: any) => cell.colNumber === c + 1) : null;
                        return cellData ? ctx.normalizeCellText(cellData.value || '') : '';
                    });
                    outputLines.push(lineParts.join('\t'));
                }
            } else if (hasFullRowSelection && !hasFullColumnSelection) {
                const sortedRows = Array.from(ctx.selectedRowIndices).sort((a, b) => a - b);

                for (const r of sortedRows) {
                    if (r < rowCount) {
                        const rowData = allRows[r] || { cells: [] };
                        const lineParts: string[] = [];
                        for (let c = 0; c < ctx.columnCount; c++) {
                            const cellData = rowData.cells ? rowData.cells.find((cell: any) => cell.colNumber === c + 1) : null;
                            lineParts.push(cellData ? ctx.normalizeCellText(cellData.value || '') : '');
                        }
                        outputLines.push(lineParts.join('\t'));
                    }
                }
            } else {
                const sortedRows = Array.from(ctx.selectedRowIndices).sort((a, b) => a - b);
                const sortedCols = Array.from(ctx.selectedColumnIndices).sort((a, b) => a - b);

                for (const r of sortedRows) {
                    if (r < rowCount) {
                        const rowData = allRows[r] || { cells: [] };
                        const lineParts = sortedCols.map(c => {
                            const cellData = rowData.cells ? rowData.cells.find((cell: any) => cell.colNumber === c + 1) : null;
                            return cellData ? ctx.normalizeCellText(cellData.value || '') : '';
                        });
                        outputLines.push(lineParts.join('\t'));
                    }
                }
            }

            const cellCount = hasFullColumnSelection
                ? rowCount * ctx.selectedColumnIndices.size
                : (hasFullRowSelection ? ctx.selectedRowIndices.size * ctx.columnCount : 0);

            await writeToClipboardAsync(outputLines.join('\n'));

            ctx.selectedCells.forEach(cell => cell.classList.add('copying'));
            setTimeout(() => ctx.selectedCells.forEach(cell => cell.classList.remove('copying')), 300);

            ctx.showToast('Copied ' + cellCount + ' cells');
            return;
        }

        const cellsArray = Array.from(ctx.selectedCells);
        const rowSet = new Set<number>();
        const colSet = new Set<number>();

        cellsArray.forEach(td => {
            const r = parseInt(td.dataset.row || '-1', 10);
            const c = parseInt(td.dataset.col || '-1', 10);
            if (!isNaN(r) && !isNaN(c)) {
                rowSet.add(r);
                colSet.add(c);
            }
        });

        const sortedRows = Array.from(rowSet).sort((a, b) => a - b);
        const sortedCols = Array.from(colSet).sort((a, b) => a - b);

        // Pre-compile a nested Map of 0-based rowIndex -> 0-based colIndex -> cell value
        const cacheMap = new Map<number, Map<number, string>>();
        ctx.rowCache.forEach((rowData, rowIndex) => {
            const colMap = new Map<number, string>();
            if (rowData && Array.isArray(rowData.cells)) {
                rowData.cells.forEach((cell: any) => {
                    const colIndex = (cell.colNumber || 1) - 1;
                    colMap.set(colIndex, cell.value || '');
                });
            }
            cacheMap.set(rowIndex, colMap);
        });

        for (const r of sortedRows) {
            const lineParts = sortedCols.map(c => {
                const rowMap = cacheMap.get(r);
                if (rowMap && rowMap.has(c)) {
                    return ctx.normalizeCellText(rowMap.get(c));
                }
                const cell = document.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]');
                return ctx.normalizeCellText(cell ? (cell.textContent || '') : '');
            });
            outputLines.push(lineParts.join('\t'));
        }

        await writeToClipboardAsync(outputLines.join('\n'));

        ctx.selectedCells.forEach(cell => cell.classList.add('copying'));
        setTimeout(() => ctx.selectedCells.forEach(cell => cell.classList.remove('copying')), 300);

        ctx.showToast('Copied ' + cellsArray.length + ' cells');
    } catch (err) {
        console.error('Copy operation failed:', err);
        ctx.showToast('Copy failed');
    } finally {
        ctx.setIsCopying(false);
    }
}
