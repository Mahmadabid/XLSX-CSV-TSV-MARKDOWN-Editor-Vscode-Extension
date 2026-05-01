/* eslint-disable @typescript-eslint/no-explicit-any */

export interface XlsxFindMatch {
    row: number;
    col: number;
}

export interface XlsxFindManagerOptions {
    normalizeCellText: (value: string | null | undefined) => string;
    requestAllRows: () => Promise<any[]>;
    getFallbackRows: () => any[];
    focusCellByPosition: (row: number, col: number) => Promise<void>;
    isCellEditing: () => boolean;
    tableSelector?: string;
}

export class XlsxFindManager {
    private readonly tableSelector: string;
    private overlayEl: HTMLElement | null = null;
    private inputEl: HTMLInputElement | null = null;
    private countEl: HTMLElement | null = null;
    private matches: XlsxFindMatch[] = [];
    private matchIndex = -1;
    private queryNormalized = '';

    constructor(private readonly options: XlsxFindManagerOptions) {
        this.tableSelector = options.tableSelector || '#xlsxTable';
    }

    open() {
        this.ensureOverlay();
        if (!this.overlayEl || !this.inputEl) return;

        const toolbarEl = document.getElementById('toolbar');
        if (toolbarEl) {
            const toolbarRect = toolbarEl.getBoundingClientRect();
            this.overlayEl.style.top = `${Math.max(8, Math.round(toolbarRect.bottom + 8))}px`;
        }

        this.overlayEl.classList.remove('hidden');
        this.inputEl.focus();
        this.inputEl.select();
    }

    toggle() {
        if (!this.overlayEl || this.overlayEl.classList.contains('hidden')) {
            this.open();
            return;
        }
        this.close();
    }

    close() {
        if (!this.overlayEl || !this.inputEl) return;
        this.overlayEl.classList.add('hidden');
        this.inputEl.blur();
    }

    async run(query: string) {
        const normalized = query.trim().toLowerCase();
        this.queryNormalized = normalized;
        this.matches = [];
        this.matchIndex = -1;

        if (!normalized) {
            this.reapplyHighlights();
            this.updateCount();
            return;
        }

        const rows = await this.options.requestAllRows();
        const sourceRows = (rows && rows.length > 0) ? rows : this.options.getFallbackRows();

        for (let r = 0; r < sourceRows.length; r++) {
            const rowData = sourceRows[r];
            if (!rowData || !Array.isArray(rowData.cells)) continue;

            rowData.cells.forEach((cellData: any) => {
                const text = this.options.normalizeCellText(cellData.value || '').toLowerCase();
                if (!text.includes(normalized)) return;
                const col = Math.max(0, (cellData.colNumber || 1) - 1);
                this.matches.push({ row: r, col });
            });
        }

        if (this.matches.length > 0) {
            this.matchIndex = 0;
            await this.options.focusCellByPosition(this.matches[0].row, this.matches[0].col);
        }

        this.reapplyHighlights();
        this.updateCount();
    }

    async navigate(direction: 'next' | 'prev') {
        if (!this.matches.length) {
            this.updateCount();
            return;
        }

        if (direction === 'next') {
            this.matchIndex = (this.matchIndex + 1) % this.matches.length;
        } else {
            this.matchIndex = (this.matchIndex - 1 + this.matches.length) % this.matches.length;
        }

        const match = this.matches[this.matchIndex];
        await this.options.focusCellByPosition(match.row, match.col);
        this.reapplyHighlights();
        this.updateCount();
    }

    reapplyHighlights() {
        this.clearHighlights();

        if (!this.queryNormalized || this.options.isCellEditing()) {
            return;
        }

        const cells = document.querySelectorAll(`${this.tableSelector} td[data-row][data-col]`) as NodeListOf<HTMLElement>;
        cells.forEach((cell) => {
            const value = this.options.normalizeCellText(cell.textContent || '').toLowerCase();
            if (!value || !value.includes(this.queryNormalized)) return;
            if (this.highlightFirstTextMatch(cell, this.queryNormalized)) {
                cell.classList.add('find-hit-cell');
            }
        });

        if (this.matchIndex >= 0 && this.matchIndex < this.matches.length) {
            const activeMatch = this.matches[this.matchIndex];
            const activeCellEl = document.querySelector(`${this.tableSelector} td[data-row="${activeMatch.row}"][data-col="${activeMatch.col}"]`) as HTMLElement | null;
            if (activeCellEl) {
                activeCellEl.classList.add('find-active-cell');
                const mark = activeCellEl.querySelector('span.find-text-highlight') as HTMLElement | null;
                if (mark) {
                    mark.classList.add('find-text-highlight-active');
                }
            }
        }
    }

    private ensureOverlay() {
        if (this.overlayEl) {
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'sheetFindOverlay';
        overlay.className = 'search-overlay sheet-find-overlay hidden';
        overlay.innerHTML = `
            <div class="search-bar sheet-find-shell">
                <input id="sheetFindInput" type="text" class="search-input sheet-find-input" placeholder="Find" aria-label="Find in worksheet" />
                <span id="sheetFindCount" class="search-count sheet-find-count">0 / 0</span>
                <button id="sheetFindPrev" type="button" class="search-nav-btn" title="Previous match (Shift+Enter)">↑</button>
                <button id="sheetFindNext" type="button" class="search-nav-btn" title="Next match (Enter)">↓</button>
                <button id="sheetFindClose" type="button" class="search-close-btn" title="Close">×</button>
            </div>
        `;

        document.body.appendChild(overlay);
        this.overlayEl = overlay;
        this.inputEl = overlay.querySelector('#sheetFindInput') as HTMLInputElement | null;
        this.countEl = overlay.querySelector('#sheetFindCount') as HTMLElement | null;

        const prevBtn = overlay.querySelector('#sheetFindPrev') as HTMLButtonElement | null;
        const nextBtn = overlay.querySelector('#sheetFindNext') as HTMLButtonElement | null;
        const closeBtn = overlay.querySelector('#sheetFindClose') as HTMLButtonElement | null;

        this.inputEl?.addEventListener('input', () => {
            void this.run(this.inputEl?.value || '');
        });

        this.inputEl?.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                this.toggle();
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                    void this.navigate('prev');
                } else {
                    void this.navigate('next');
                }
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            }
        });

        prevBtn?.addEventListener('click', () => {
            void this.navigate('prev');
        });
        nextBtn?.addEventListener('click', () => {
            void this.navigate('next');
        });
        closeBtn?.addEventListener('click', () => {
            this.close();
        });
    }

    private updateCount() {
        if (!this.countEl) return;
        if (this.matches.length === 0 || this.matchIndex < 0) {
            this.countEl.textContent = '0 / 0';
            return;
        }
        this.countEl.textContent = `${this.matchIndex + 1} / ${this.matches.length}`;
    }

    private clearHighlights() {
        document.querySelectorAll(`${this.tableSelector} td.find-hit-cell, ${this.tableSelector} td.find-active-cell`).forEach((cell) => {
            cell.classList.remove('find-hit-cell', 'find-active-cell');
        });

        document.querySelectorAll(`${this.tableSelector} td span.find-text-highlight, ${this.tableSelector} td span.find-text-highlight-active`).forEach((node) => {
            const el = node as HTMLElement;
            const parent = el.parentNode;
            if (!parent) return;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            parent.normalize();
        });
    }

    private highlightFirstTextMatchInCell(cell: HTMLElement, queryLower: string) {
        if (!queryLower) return false;

        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let current = walker.nextNode();
        while (current) {
            const textNode = current as Text;
            const text = textNode.data || '';
            const idx = text.toLowerCase().indexOf(queryLower);
            if (idx >= 0 && text.length > 0) {
                const mark = document.createElement('span');
                mark.className = 'find-text-highlight';
                const matchNode = textNode.splitText(idx);
                matchNode.splitText(queryLower.length);
                mark.textContent = matchNode.data;
                matchNode.parentNode?.replaceChild(mark, matchNode);

                return true;
            }
            current = walker.nextNode();
        }

        return false;
    }

    private highlightFirstTextMatch(cell: HTMLElement, queryLower: string) {
        return this.highlightFirstTextMatchInCell(cell, queryLower);
    }
}
