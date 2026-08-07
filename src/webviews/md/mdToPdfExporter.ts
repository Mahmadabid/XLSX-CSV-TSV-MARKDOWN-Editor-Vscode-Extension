import jsPDF from 'jspdf';

export interface PdfExporterOptions {
    margin?: number;        // Margin in points (default: 40pt ~ 14mm)
    pageSize?: 'a4' | 'letter';
    backgroundColor?: string;
}

export interface Run {
    text: string;
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    link?: string;
    size?: number;
    color?: [number, number, number];
    strike?: boolean;
}

export class MdToPdfExporter {
    /**
     * Clean non-Latin1 / emoji characters and normalize unicode typography
     * so standard jsPDF fonts (Helvetica, Courier) render crisp text without garbled output.
     */
    static cleanPdfText(text: string): string {
        if (!text) return '';
        return text
            // Normalize KaTeX & math symbols to readable ASCII/Latin-1 text
            .replace(/∑/g, 'sum')
            .replace(/∫/g, 'int')
            .replace(/√/g, 'sqrt')
            .replace(/π/g, 'pi')
            .replace(/∞/g, 'inf')
            .replace(/∂/g, 'd')
            .replace(/≤/g, '<=')
            .replace(/≥/g, '>=')
            .replace(/≠/g, '!=')
            .replace(/±/g, '+/-')
            .replace(/×/g, '*')
            .replace(/÷/g, '/')
            .replace(/⌊/g, 'floor(')
            .replace(/⌋/g, ')')
            .replace(/⌈/g, 'ceil(')
            .replace(/⌉/g, ')')
            // Normalize unicode punctuation to standard ASCII equivalents
            .replace(/[\u2014\u2015]/g, ' - ') // em-dash
            .replace(/[\u2012\u2013]/g, '-')   // en-dash
            .replace(/[\u201C\u201D]/g, '"')   // smart double quotes
            .replace(/[\u2018\u2019]/g, "'")   // smart single quotes / apostrophes
            .replace(/\u2026/g, '...')         // horizontal ellipsis
            .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width spaces
            // Remove emoji surrogate pairs (e.g. 📊, 🎨, 📝) that cause garbled Latin-1 text
            .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
            // Remove miscellaneous symbols & pictographs
            .replace(/[\u2600-\u27BF\u2300-\u23FF\u2B00-\u2BFF]/g, '')
            // Strip any remaining non-Latin1 characters
            .replace(/[^\x00-\xFF]/g, '');
    }

    /**
     * Extracts text runs from a DOM node while excluding:
     *  - Header anchor permalinks (#)
     *  - KaTeX MathML hidden subtrees (.katex-mathml)
     *  - Copy buttons
     */
    static extractRuns(node: Node, inh: Partial<Run> = {}): Run[] {
        if (node.nodeType === Node.TEXT_NODE) {
            const raw = node.textContent || '';
            // Skip standalone '#' text nodes in headings or links
            if (raw.trim() === '#') {
                const parentTag = (node.parentElement?.tagName || '').toLowerCase();
                if (/^h[1-6]$/.test(parentTag) || parentTag === 'a') {
                    return [];
                }
            }
            const cleaned = MdToPdfExporter.cleanPdfText(raw);
            return cleaned ? [{ ...inh, text: cleaned }] : [];
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return [];

        const el = node as Element;
        const tag = el.tagName ? el.tagName.toLowerCase() : '';

        // Exclude script, style, code-copy buttons, and header anchors (#)
        if (tag === 'script' || tag === 'style') return [];
        if (el.classList?.contains('code-copy')) return [];
        if (el.classList?.contains('header-anchor') ||
            el.classList?.contains('anchor') ||
            el.classList?.contains('markdown-it-anchor') ||
            el.getAttribute('aria-hidden') === 'true') {
            return [];
        }
        // Exclude hidden KaTeX MathML subtree to avoid leaking raw LaTeX source string
        if (el.classList?.contains('katex-mathml')) return [];

        // Render checkboxes for task lists
        if (tag === 'input') {
            const type = el.getAttribute('type');
            if (type === 'checkbox') {
                const checked = (el as HTMLInputElement).checked || el.hasAttribute('checked');
                return [{ ...inh, text: checked ? '[x] ' : '[ ] ' }];
            }
            return [];
        }

        const o: Partial<Run> = { ...inh };
        if (tag === 'strong' || tag === 'b') o.bold = true;
        if (tag === 'em' || tag === 'i') o.italic = true;
        if (tag === 'code') o.code = true;
        if (tag === 'del' || tag === 's') o.strike = true;
        if (tag === 'a') {
            const href = el.getAttribute('href') || '';
            // Skip internal fragment links / heading permalinks (#heading-id)
            if (!href || href.startsWith('#') || el.textContent?.trim() === '#') {
                return [];
            }
            o.link = /^[a-z][a-z0-9+\-.]*:/i.test(href) ? href : 'https://' + href;
            o.color = [0, 60, 180];
        }
        if (tag === 'mark') o.color = [160, 100, 0];

        const runs: Run[] = [];
        for (const child of Array.from(el.childNodes)) {
            runs.push(...MdToPdfExporter.extractRuns(child, o));
        }
        return runs;
    }

    /**
     * Natively converts Mermaid SVG elements to a crisp PNG DataURL in ~2ms
     * including all document stylesheets so themes & diagram colors render perfectly.
     */
    static svgToDataUrl(svgEl: SVGElement): Promise<string> {
        return new Promise((resolve) => {
            try {
                const clone = svgEl.cloneNode(true) as SVGElement;

                // Embed all document styles so Mermaid diagram CSS colors are included
                let cssStyles = '';
                document.querySelectorAll('style').forEach((styleTag) => {
                    cssStyles += styleTag.innerHTML + '\n';
                });

                const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
                styleEl.textContent = cssStyles;
                clone.insertBefore(styleEl, clone.firstChild);

                const bbox = svgEl.getBoundingClientRect();
                const w = Math.max(100, Math.ceil(bbox.width || 600));
                const h = Math.max(50, Math.ceil(bbox.height || 300));
                clone.setAttribute('width', w.toString());
                clone.setAttribute('height', h.toString());

                const xml = new XMLSerializer().serializeToString(clone);
                const svgBase64 = btoa(unescape(encodeURIComponent(xml)));
                const src = `data:image/svg+xml;base64,${svgBase64}`;

                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        const scale = 2;
                        canvas.width = w * scale;
                        canvas.height = h * scale;
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                            resolve(canvas.toDataURL('image/png'));
                        } else {
                            resolve(src);
                        }
                    } catch {
                        resolve(src);
                    }
                };
                img.onerror = () => resolve('');
                img.src = src;
            } catch {
                resolve('');
            }
        });
    }

    /**
     * High-speed, native DOM-to-PDF conversion engine.
     * Generates a fully-selectable, crisp PDF with zero heavy canvas dependencies.
     */
    static async exportToPdf(preview: HTMLElement, options: PdfExporterOptions = {}): Promise<Blob> {
        // Hide UI chrome (copy buttons, edit overlays)
        const copyBtns = preview.querySelectorAll('.code-copy');
        copyBtns.forEach((btn: any) => (btn.style.display = 'none'));

        try {
            // PDF dimensions (A4 portrait in points: 595.28 x 841.89 pt)
            const PW = options.pageSize === 'letter' ? 612 : 595.28;
            const PH = options.pageSize === 'letter' ? 792 : 841.89;
            const M = options.margin !== undefined ? options.margin : 40;
            const CW = PW - M * 2;

            const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: options.pageSize || 'a4' });
            let y = M;

            function addPage() {
                pdf.addPage();
                y = M;
            }

            function ensureSpace(needed: number) {
                if (y + needed > PH - M) {
                    addPage();
                }
            }

            function gap(pt: number) {
                y += pt;
            }

            function applyFont(bold: boolean, italic: boolean, code: boolean, size: number) {
                pdf.setFontSize(size);
                if (code) {
                    pdf.setFont('Courier', 'normal');
                    return;
                }
                if (bold && italic) pdf.setFont('Helvetica', 'bolditalic');
                else if (bold) pdf.setFont('Helvetica', 'bold');
                else if (italic) pdf.setFont('Helvetica', 'italic');
                else pdf.setFont('Helvetica', 'normal');
            }

            // Fast inline text layout & rendering
            function renderRuns(
                runs: Run[],
                indentL = 0,
                indentR = 0,
                defSize = 11,
                spacingAfter = 8
            ) {
                if (!runs || runs.length === 0) return;
                const validRuns = runs.filter((r) => r.text && r.text.length > 0);
                if (validRuns.length === 0) return;

                const maxW = CW - indentL - indentR;
                const startX = M + indentL;

                // Tokenize runs into words
                interface Token {
                    text: string;
                    run: Run;
                    w: number;
                    sp: number;
                }
                const tokens: Token[] = [];

                for (const run of validRuns) {
                    const sz = run.size || defSize;
                    applyFont(!!run.bold, !!run.italic, !!run.code, sz);
                    const parts = run.text.split(/(\n| +)/);
                    for (let i = 0; i < parts.length; i++) {
                        const p = parts[i];
                        if (!p) continue;
                        if (p === '\n') {
                            tokens.push({ text: '\n', run, w: 0, sp: 0 });
                            continue;
                        }
                        if (/^ +$/.test(p)) {
                            if (tokens.length > 0 && tokens[tokens.length - 1].text !== '\n') {
                                tokens[tokens.length - 1].sp = pdf.getTextWidth(' ');
                            }
                            continue;
                        }
                        tokens.push({ text: p, run, w: pdf.getTextWidth(p), sp: 0 });
                    }
                }

                if (tokens.length === 0) return;

                interface LineItem {
                    text: string;
                    run: Run;
                    x: number;
                }
                let line: LineItem[] = [];
                let lineW = 0;
                let lineSz = defSize;
                let cx = startX;

                function flush() {
                    if (line.length === 0) return;
                    const lineH = lineSz * 1.4;
                    ensureSpace(lineH);
                    const baseline = y + lineSz;

                    for (const item of line) {
                        const r = item.run;
                        const sz = r.size || defSize;
                        applyFont(!!r.bold, !!r.italic, !!r.code, sz);

                        if (r.code) {
                            const tw = pdf.getTextWidth(item.text);
                            pdf.setFillColor(240, 240, 243);
                            pdf.roundedRect(item.x - 1, baseline - sz + 1, tw + 2, sz, 1, 1, 'F');
                            pdf.setTextColor(190, 40, 40);
                        } else if (r.color) {
                            pdf.setTextColor(r.color[0], r.color[1], r.color[2]);
                        } else {
                            pdf.setTextColor(33, 37, 41);
                        }

                        pdf.text(item.text, item.x, baseline);

                        if (r.link) {
                            const tw = pdf.getTextWidth(item.text);
                            pdf.setDrawColor(0, 60, 180);
                            pdf.setLineWidth(0.4);
                            pdf.line(item.x, baseline + 1, item.x + tw, baseline + 1);
                            pdf.link(item.x, baseline - sz, tw, sz + 2, { url: r.link });
                        }

                        if (r.strike) {
                            const tw = pdf.getTextWidth(item.text);
                            pdf.setDrawColor(120, 120, 120);
                            pdf.setLineWidth(0.4);
                            pdf.line(item.x, baseline - sz * 0.3, item.x + tw, baseline - sz * 0.3);
                        }
                    }

                    y += lineH;
                    line = [];
                    lineW = 0;
                    lineSz = defSize;
                    cx = startX;
                }

                for (const tok of tokens) {
                    if (tok.text === '\n') {
                        flush();
                        continue;
                    }
                    const sz = tok.run.size || defSize;
                    if (lineW > 0 && lineW + tok.w > maxW) {
                        flush();
                    }
                    line.push({ text: tok.text, run: tok.run, x: cx });
                    cx += tok.w + tok.sp;
                    lineW += tok.w + tok.sp;
                    lineSz = Math.max(lineSz, sz);
                }
                flush();
                y += spacingAfter;
            }

            // Code block renderer with syntax background & line pagination
            function renderCodeBlock(pre: HTMLElement, spacingAfter = 10) {
                const code = (pre.querySelector('code') || pre).textContent || '';
                const cleanCode = MdToPdfExporter.cleanPdfText(code);
                const rawLines = cleanCode.replace(/\n$/, '').split('\n');
                const fs = 8.5;
                const lh = fs * 1.45;
                const pad = 8;

                let li = 0;
                while (li < rawLines.length) {
                    const avail = PH - M - y;
                    const perPage = Math.max(1, Math.floor((avail - pad * 2) / lh));
                    const batch = Math.min(perPage, rawLines.length - li);
                    const bh = batch * lh + pad * 2;

                    pdf.setFillColor(32, 36, 44);
                    pdf.roundedRect(M, y, CW, bh, 3, 3, 'F');
                    pdf.setFont('Courier', 'normal');
                    pdf.setFontSize(fs);
                    pdf.setTextColor(212, 212, 212);

                    for (let i = 0; i < batch; i++) {
                        let ln = rawLines[li + i];
                        while (pdf.getTextWidth(ln) > CW - pad * 2 - 4 && ln.length > 1) {
                            ln = ln.slice(0, -1);
                        }
                        pdf.text(ln, M + pad, y + pad + (i + 1) * lh - lh * 0.1);
                    }

                    y += bh;
                    li += batch;
                    if (li < rawLines.length) addPage();
                }
                y += spacingAfter;
                pdf.setFont('Helvetica', 'normal');
                pdf.setTextColor(33, 37, 41);
            }

            // Table renderer with headers & borders
            function renderTable(table: HTMLElement, spacingAfter = 10) {
                const allRows = Array.from(table.querySelectorAll('tr'));
                if (allRows.length === 0) return;
                const numCols = Math.max(...allRows.map((r) => r.children.length));
                if (numCols === 0) return;

                const colW = CW / numCols;
                const fs = 9;
                const padX = 5;
                const padY = 5;
                const rowH = fs + padY * 2;

                allRows.forEach((row, ri) => {
                    ensureSpace(rowH + 1);
                    const isHeader = !!row.closest('thead');
                    pdf.setFillColor(
                        isHeader ? 45 : ri % 2 === 0 ? 255 : 248,
                        isHeader ? 50 : ri % 2 === 0 ? 255 : 249,
                        isHeader ? 65 : ri % 2 === 0 ? 255 : 252
                    );
                    pdf.rect(M, y, CW, rowH, 'F');
                    pdf.setDrawColor(210, 213, 220);
                    pdf.setLineWidth(0.4);
                    pdf.rect(M, y, CW, rowH, 'S');

                    applyFont(isHeader, false, false, fs);
                    pdf.setTextColor(isHeader ? 245 : 33, isHeader ? 245 : 37, isHeader ? 255 : 41);

                    Array.from(row.children).forEach((cell, ci) => {
                        if (ci > 0) {
                            pdf.setDrawColor(210, 213, 220);
                            pdf.line(M + ci * colW, y, M + ci * colW, y + rowH);
                        }
                        let t = MdToPdfExporter.cleanPdfText(cell.textContent || '').trim();
                        while (pdf.getTextWidth(t) > colW - padX * 2 && t.length > 1) {
                            t = t.slice(0, -1);
                        }
                        if (t.length < (cell.textContent || '').trim().length) t += '...';
                        pdf.text(t, M + ci * colW + padX, y + padY + fs);
                    });
                    y += rowH;
                });
                y += spacingAfter;
                pdf.setFont('Helvetica', 'normal');
                pdf.setTextColor(33, 37, 41);
            }

            // Recursive Element Renderer
            async function renderEl(el: Element, indentL = 0): Promise<void> {
                const tag = el.tagName ? el.tagName.toLowerCase() : '';
                if (!tag) return;
                if ((el as HTMLElement).style?.display === 'none') return;
                if (el.classList?.contains('code-copy')) return;

                // Render Mermaid diagram blocks ONLY (do NOT match arbitrary child SVGs like copy icons)
                if (el.classList?.contains('mermaid') || el.classList?.contains('mermaid-container')) {
                    const svg = el.querySelector('svg') as SVGElement;
                    if (svg) {
                        const dataUrl = await MdToPdfExporter.svgToDataUrl(svg);
                        if (dataUrl) {
                            const bbox = svg.getBoundingClientRect();
                            const naturalW = bbox.width || 500;
                            const naturalH = bbox.height || 250;
                            const iw = Math.min(CW - indentL, naturalW);
                            const ih = (naturalH / (naturalW || 1)) * iw;
                            const safeH = Math.min(ih, PH - M * 2);
                            ensureSpace(safeH + 10);
                            pdf.addImage(dataUrl, 'PNG', M + indentL, y, iw, safeH);
                            y += safeH + 10;
                            return;
                        }
                    }
                }

                switch (tag) {
                    case 'h1':
                    case 'h2':
                    case 'h3':
                    case 'h4':
                    case 'h5':
                    case 'h6': {
                        const lv = parseInt(tag[1]);
                        const szs = [20, 16, 14, 12, 11, 10];
                        const befores = [14, 12, 10, 8, 6, 5];
                        const afters = [6, 5, 4, 4, 3, 3];
                        const fs = szs[lv - 1];

                        gap(befores[lv - 1]);
                        const runs = MdToPdfExporter.extractRuns(el, { bold: true, size: fs });
                        renderRuns(runs, indentL, 0, fs, afters[lv - 1]);

                        if (lv <= 2) {
                            pdf.setDrawColor(215, 218, 225);
                            pdf.setLineWidth(0.5);
                            pdf.line(M, y - 1, M + CW, y - 1);
                            y += 4;
                        }
                        break;
                    }

                    case 'p': {
                        if (el.children.length === 1 && el.children[0].tagName?.toLowerCase() === 'img') {
                            await renderEl(el.children[0], indentL);
                            break;
                        }
                        const runs = MdToPdfExporter.extractRuns(el);
                        if (runs.some((r) => r.text.trim())) {
                            renderRuns(runs, indentL, 0, 11, 8);
                        }
                        break;
                    }

                    case 'ul':
                    case 'ol': {
                        const ordered = tag === 'ol';
                        let counter = 1;

                        for (const li of Array.from(el.children)) {
                            if (li.tagName?.toLowerCase() !== 'li') continue;
                            const bulletText = ordered ? `${counter}.` : '•';
                            const fs = 11;
                            ensureSpace(fs * 1.5);
                            applyFont(!ordered, false, false, fs);
                            pdf.setTextColor(33, 37, 41);
                            pdf.text(bulletText, M + indentL + 2, y + fs);

                            const textRuns: Run[] = [];
                            for (const c of Array.from(li.childNodes)) {
                                const ct = (c as Element).tagName?.toLowerCase() || '';
                                if (ct !== 'ul' && ct !== 'ol') {
                                    textRuns.push(...MdToPdfExporter.extractRuns(c));
                                }
                            }

                            const savedY = y;
                            if (textRuns.some((r) => r.text.trim())) {
                                renderRuns(textRuns, indentL + 16, 0, fs, 3);
                            } else {
                                y = savedY + fs * 1.5 + 3;
                            }

                            for (const c of Array.from(li.children)) {
                                const ct = c.tagName?.toLowerCase();
                                if (ct === 'ul' || ct === 'ol') {
                                    await renderEl(c, indentL + 16);
                                } else if (ct === 'p') {
                                    const r = MdToPdfExporter.extractRuns(c);
                                    if (r.some((x) => x.text.trim())) {
                                        renderRuns(r, indentL + 16, 0, 11, 3);
                                    }
                                }
                            }
                            counter++;
                        }
                        y += 4;
                        break;
                    }

                    case 'pre': {
                        renderCodeBlock(el as HTMLElement);
                        break;
                    }

                    case 'table': {
                        renderTable(el as HTMLElement);
                        break;
                    }

                    case 'blockquote': {
                        const startY = y;
                        gap(4);
                        for (const c of Array.from(el.children)) {
                            await renderEl(c, indentL + 12);
                        }
                        gap(2);
                        pdf.setDrawColor(80, 100, 200);
                        pdf.setLineWidth(2.5);
                        pdf.line(M + indentL + 2, startY, M + indentL + 2, y);
                        pdf.setLineWidth(0.5);
                        y += 4;
                        break;
                    }

                    case 'hr': {
                        gap(6);
                        pdf.setDrawColor(200, 203, 210);
                        pdf.setLineWidth(0.5);
                        pdf.line(M + indentL, y, M + CW, y);
                        y += 10;
                        break;
                    }

                    case 'img': {
                        const img = el as HTMLImageElement;
                        if (!img.src) break;
                        try {
                            const c2 = document.createElement('canvas');
                            c2.width = img.naturalWidth || 300;
                            c2.height = img.naturalHeight || 200;
                            const cx = c2.getContext('2d');
                            if (cx) {
                                cx.drawImage(img, 0, 0);
                                const iw = Math.min(CW - indentL, img.naturalWidth || CW);
                                const ih = (c2.height / (c2.width || 1)) * iw;
                                ensureSpace(ih + 8);
                                pdf.addImage(c2.toDataURL('image/png'), 'PNG', M + indentL, y, iw, ih);
                                y += ih + 8;
                            }
                        } catch {
                            // ignore image draw errors
                        }
                        break;
                    }

                    default: {
                        for (const c of Array.from(el.children)) {
                            await renderEl(c, indentL);
                        }
                        break;
                    }
                }
            }

            for (const child of Array.from(preview.children)) {
                await renderEl(child as Element);
            }

            return pdf.output('blob');
        } finally {
            // Restore hidden elements
            copyBtns.forEach((btn: any) => (btn.style.display = ''));
        }
    }
}
