export interface RichRun {
    text: string;
    bold?: boolean;
    italic?: boolean;
    color?: string;
}

export function normalizeColorToHex(color: string): string | undefined {
    const value = (color || '').trim();
    const hexMatch = value.match(/^#([0-9a-fA-F]{6})$/);
    if (hexMatch) return ('#' + hexMatch[1]).toLowerCase();

    const rgbMatch = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!rgbMatch) return undefined;
    const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)));
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function collectRichRunsFromNode(node: Node, inherited: Omit<RichRun, 'text'>, output: RichRun[]) {
    if (node.nodeType === Node.TEXT_NODE) {
        const txt = node.textContent || '';
        if (!txt) return;
        output.push({ text: txt, ...inherited });
        return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    const next = { ...inherited };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;

    const style = window.getComputedStyle(el);
    const fw = style.fontWeight || '';
    if (fw === 'bold' || parseInt(fw, 10) >= 600) next.bold = true;
    if (style.fontStyle === 'italic') next.italic = true;

    const explicitColor = el.style && el.style.color ? el.style.color : '';
    if (explicitColor) {
        const hexColor = normalizeColorToHex(explicitColor);
        if (hexColor) next.color = hexColor;
    }

    for (const child of Array.from(el.childNodes)) {
        collectRichRunsFromNode(child, next, output);
    }
}

function collapseRuns(runs: RichRun[]): RichRun[] {
    const merged: RichRun[] = [];
    runs.forEach(run => {
        if (!run.text) return;
        const prev = merged[merged.length - 1];
        if (prev && prev.bold === run.bold && prev.italic === run.italic && prev.color === run.color) {
            prev.text += run.text;
        } else {
            merged.push({ ...run });
        }
    });
    return merged;
}

export function getCellRichRuns(cell: HTMLElement): RichRun[] {
    const rawRuns: RichRun[] = [];
    for (const child of Array.from(cell.childNodes)) {
        collectRichRunsFromNode(child, {}, rawRuns);
    }

    return collapseRuns(rawRuns)
        .map(r => ({
            text: r.text.replace(/\u00a0/g, ' '),
            bold: !!r.bold,
            italic: !!r.italic,
            color: r.color
        }))
        .filter(r => r.text.length > 0);
}

export function hasRunFormatting(runs: RichRun[]): boolean {
    return runs.some(r => !!r.bold || !!r.italic || !!r.color);
}
