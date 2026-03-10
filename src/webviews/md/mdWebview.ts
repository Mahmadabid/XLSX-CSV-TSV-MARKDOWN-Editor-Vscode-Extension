import MarkdownIt from 'markdown-it';
// @ts-ignore
import taskLists from 'markdown-it-task-lists';
// @ts-ignore
import container from 'markdown-it-container';
// @ts-ignore
import deflist from 'markdown-it-deflist';
// @ts-ignore
import footnote from 'markdown-it-footnote';
// @ts-ignore
import sub from 'markdown-it-sub';
// @ts-ignore
import sup from 'markdown-it-sup';
// @ts-ignore
import ins from 'markdown-it-ins';
// @ts-ignore
import mark from 'markdown-it-mark';
// @ts-ignore
import abbr from 'markdown-it-abbr';
// @ts-ignore
import { full as emoji } from 'markdown-it-emoji';

import hljs from 'highlight.js';
import { ThemeManager } from '../shared/themeManager';
import { SettingsManager } from '../shared/settingsManager';
import { ToolbarManager } from '../shared/toolbarManager';
import { Utils } from '../shared/utils';
import { Icons } from '../shared/icons';
import { vscode, debounce } from '../shared/common';
import { InfoTooltip } from '../shared/infoTooltip';

// ===== Throttle Utility =====
function throttleRAF(fn: () => void): () => void {
    let ticking = false;
    return () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => {
                fn();
                ticking = false;
            });
        }
    };
}

// ===== State =====
let isPreviewView = true;
let isEditMode = false;
let isSaving = false;
let shouldExitEditMode = false;
let originalContent = '';
let currentContent = '';
let toolbarManager: ToolbarManager | null = null;

// Settings
let currentSettings = {
    stickyToolbar: true,
    wordWrap: true,
    syncScroll: true,
    previewPosition: 'right',
    showOutline: true,
    showLineNumbers: true,
    isMdEnabled: true
};

let isFocusMode = false;
let searchMatches: Element[] = [];
let searchCurrentIndex = -1;

// ===== Utilities =====
const $ = Utils.$;

function slugify(text: string) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[`~!@#$%^&*()+=\[\]{}|\\;:'",.<>/?]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function escapeHtmlAttr(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function wrapCodeLines(html: string): string {
    const lines = html.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    if (lines.length === 0) return '<span class="code-line"> </span>';

    let openStack: string[] = [];

    return lines.map(line => {
        const reopenTags = openStack.join('');
        const tagRegex = /<(\/?)([a-z][a-z0-9]*)[^>]*?>/gi;
        let m;
        while ((m = tagRegex.exec(line)) !== null) {
            if (m[1] === '/') {
                openStack.pop();
            } else {
                openStack.push(m[0]);
            }
        }
        const closeTags = openStack.slice().reverse().map(tag => {
            const nameMatch = tag.match(/<([a-z][a-z0-9]*)/i);
            return nameMatch ? `</${nameMatch[1]}>` : '';
        }).join('');
        return `<span class="code-line">${reopenTags}${line}${closeTags}</span>`;
    }).join('\n');
}

function setButtonsEnabled(enabled: boolean) {
    const ids = ['toggleViewButton', 'toggleEditModeButton', 'saveEditsButton',
        'cancelEditsButton', 'toggleBackgroundButton', 'openSettingsButton', 'disableMdEditorButton'];
    ids.forEach((id) => {
        const el = $(id) as HTMLButtonElement;
        if (el) el.disabled = !enabled;
    });
}

// ===== Markdown-it Setup =====
const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true, // GFM style line breaks
    highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
            try {
                return hljs.highlight(str, { language: lang }).value;
            } catch (__) {}
        }
        return ''; // use external default escaping
    }
});
md.use(taskLists, { enabled: false, label: true, labelAfter: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.use(container as any, 'warning');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.use(container as any, 'info');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.use(container as any, 'error');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.use(container as any, 'success');

md.use(deflist);
md.use(footnote);
md.use(sub);
md.use(sup);
md.use(ins);
md.use(mark);
md.use(abbr);
md.use(emoji);

// Inline code styling
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const defaultInlineCode = md.renderer.rules.code_inline || function(tokens: any, idx: number, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.renderer.rules.code_inline = function(tokens: any, idx: number, options: any, env: any, self: any) {
    tokens[idx].attrJoin('class', 'inline-code');
    return defaultInlineCode(tokens, idx, options, env, self);
};

// Inject line numbers for sync scroll
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function injectLineNumbers(tokens: any, idx: number, options: any, env: any, self: any) {
    const token = tokens[idx];
    if (token.map && token.level === 0) {
        token.attrSet('data-line', String(token.map[0]));
    }
    return self.renderToken(tokens, idx, options, env, self);
}

// Apply to block-level elements
md.renderer.rules.paragraph_open = injectLineNumbers;
md.renderer.rules.heading_open = injectLineNumbers;
md.renderer.rules.bullet_list_open = injectLineNumbers;
md.renderer.rules.ordered_list_open = injectLineNumbers;
md.renderer.rules.blockquote_open = injectLineNumbers;
md.renderer.rules.hr = injectLineNumbers;

md.renderer.rules.table_open = function(tokens: any, idx: number, options: any, env: any, self: any) {
    tokens[idx].attrJoin('class', 'md-table');
    return injectLineNumbers(tokens, idx, options, env, self);
};

// Heading close: inject anchor links for copyable heading URLs
md.renderer.rules.heading_close = function(tokens: any, idx: number, options: any, env: any, self: any) {
    const openToken = tokens[idx - 2];
    const id = openToken && openToken.type === 'heading_open' ? openToken.attrGet('id') : null;
    let anchor = '';
    if (id) {
        anchor = `<a class="heading-anchor" href="#${md.utils.escapeHtml(id)}" data-heading-id="${escapeHtmlAttr(encodeURIComponent(id))}" title="Copy link">#</a>`;
    }
    return anchor + self.renderToken(tokens, idx, options);
};

// Image renderer: add zoomable class for lightbox
const defaultImageRender = md.renderer.rules.image || function(tokens: any, idx: number, options: any, env: any, self: any) {
    return self.renderToken(tokens, idx, options);
};
md.renderer.rules.image = function(tokens: any, idx: number, options: any, env: any, self: any) {
    tokens[idx].attrJoin('class', 'md-image zoomable');
    tokens[idx].attrSet('loading', 'lazy');
    return defaultImageRender(tokens, idx, options, env, self);
};

// Fence (code blocks) needs special handling as it's a self-closing block token in terms of rendering
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
md.renderer.rules.fence = function (tokens: any, idx: number, options: any, env: any, self: any) {
    const token = tokens[idx];
    const info = token.info ? md.utils.unescapeAll(token.info).trim() : '';
    const langName = info ? info.split(/\s+/g)[0] : '';
    const code = token.content || '';

    let highlighted = '';
    if (langName && hljs.getLanguage(langName)) {
        try {
            highlighted = hljs.highlight(code, { language: langName }).value;
        } catch {
            highlighted = md.utils.escapeHtml(code);
        }
    } else {
        highlighted = md.utils.escapeHtml(code);
    }

    const dataLine = token.map && token.level === 0 ? ` data-line="${token.map[0]}"` : '';
    const langLabel = langName ? `<div class="code-lang">${md.utils.escapeHtml(langName)}</div>` : `<div class="code-lang muted">text</div>`;
    const encoded = encodeURIComponent(code);
    const copyButton = `<button class="code-copy" data-code="${escapeHtmlAttr(encoded)}" title="Copy code">${Icons.Copy}<span>Copy</span></button>`;
    const langClass = langName ? ` class="language-${langName}"` : '';

    // Wrap each line for line numbers
    const numberedCode = wrapCodeLines(highlighted);

    return `<div class="code-block"${dataLine}><div class="code-block-header">${langLabel}${copyButton}</div><pre><code${langClass}>${numberedCode}</code></pre></div>`;
};

function addHeadingIds(tokens: any[]) {
    const slugCounts: Record<string, number> = {};
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'heading_open') {
            const inline = tokens[i + 1];
            const text = inline && inline.type === 'inline' ? inline.content : '';
            const baseSlug = slugify(text);
            if (!baseSlug) continue;

            const count = (slugCounts[baseSlug] || 0) + 1;
            slugCounts[baseSlug] = count;
            const id = count > 1 ? `${baseSlug}-${count}` : baseSlug;
            token.attrSet('id', id);
            token.attrJoin('class', 'md-heading');
        }
    }
}

function buildToc(tokens: any[]) {
    const items: Array<{ id: string; level: number; text: string }> = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'heading_open') {
            const inline = tokens[i + 1];
            const text = inline && inline.type === 'inline' ? inline.content : '';
            const id = token.attrGet('id');
            const level = parseInt((token.tag || 'h2').replace('h', ''), 10);
            if (id && text) {
                items.push({ id, level, text });
            }
        }
    }

    if (!items.length) {
        return '<div class="toc-empty">No headings found</div>';
    }

    return items.map(item => {
        const safeText = md.utils.escapeHtml(item.text);
        return `<div class="toc-item toc-level-${item.level}"><a href="#${item.id}" data-target="${item.id}">${safeText}</a></div>`;
    }).join('');
}

// ===== Rendering =====
function renderMarkdown(content: string) {
    const preview = $('markdownPreview');
    if (preview) {
        const env: any = {};
        const tokens = md.parse(content || '', env);
        addHeadingIds(tokens);
        preview.innerHTML = md.renderer.render(tokens, md.options, env);
        updateToc(tokens);
        refreshDataLineCache();
        requestAnimationFrame(() => {
            updateScrollSpy();
            updateProgressBar();
            reapplySearch();
        });
    }
}

function updateToc(tokens: any[]) {
    const tocBody = $('tocBody');
    if (!tocBody) return;
    tocBody.innerHTML = buildToc(tokens);
}

// ===== Edit Mode (Split View) =====
function setEditMode(enabled: boolean) {
    isEditMode = enabled;
    document.body.classList.toggle('edit-mode', enabled);

    const editBtn = $('toggleEditModeButton');
    const saveBtn = $('saveEditsButton');
    const cancelBtn = $('cancelEditsButton');
    const container = $('markdownContainer');
    const editor = $('markdownEditor') as HTMLTextAreaElement;
    const preview = $('markdownPreview');

    const saveTarget = (saveBtn?.closest('.tooltip') as HTMLElement | null) || saveBtn;
    const cancelTarget = (cancelBtn?.closest('.tooltip') as HTMLElement | null) || cancelBtn;
    const editTarget = (editBtn?.closest('.tooltip') as HTMLElement | null) || editBtn;

    if (saveTarget) saveTarget.classList.toggle('hidden', !enabled);
    if (cancelTarget) cancelTarget.classList.toggle('hidden', !enabled);
    if (editTarget) editTarget.classList.toggle('hidden', enabled);

    // Toggle formatting toolbar
    const fmtToolbar = $('formattingToolbar');
    if (fmtToolbar) fmtToolbar.classList.toggle('hidden', !enabled);

    if (enabled) {
        // Enter split-view edit mode
        originalContent = currentContent;
        container?.classList.add('split-view');
        
        // Apply preview position (left or right)
        if (currentSettings.previewPosition === 'left') {
            container?.classList.add('preview-left');
        } else {
            container?.classList.remove('preview-left');
        }
        
        if (editor) editor.value = currentContent;
        
        // IMPORTANT: Scroll both editor and preview to TOP
        requestAnimationFrame(() => {
            if (editor) {
                editor.scrollTop = 0;
                editor.focus();
                editor.setSelectionRange(0, 0);
            }
            if (preview) preview.scrollTop = 0;
            
            setTimeout(() => {
                if (editor) editor.scrollTop = 0;
                if (preview) preview.scrollTop = 0;
            }, 50);
        });
    } else {
        // Exit edit mode
        container?.classList.remove('split-view');
        container?.classList.remove('preview-left');
        renderMarkdown(currentContent);
    }

    updateStatusInfo();
}

function performSave(exitAfterSave = false) {
    if (isSaving || !isEditMode) return;
    isSaving = true;
    shouldExitEditMode = exitAfterSave;
    setButtonsEnabled(false);

    const editor = $('markdownEditor') as HTMLTextAreaElement;
    if (editor) {
        currentContent = editor.value;
    }

    vscode.postMessage({ command: 'saveMarkdown', text: currentContent });
}

function cancelEdit() {
    currentContent = originalContent;
    const editor = $('markdownEditor') as HTMLTextAreaElement;
    if (editor) {
        editor.value = originalContent;
    }
    renderMarkdown(originalContent);
    setEditMode(false);
}

// ===== Live Preview =====
const debouncedRender = debounce((content: string) => {
    renderMarkdown(content);
}, 150);

function onEditorInput() {
    const editor = $('markdownEditor') as HTMLTextAreaElement;
    if (!editor) return;

    currentContent = editor.value;

    // Debounced live preview
    debouncedRender(currentContent);

    updateStatusInfo();
}

// ===== Sync Scroll (improved accuracy using line-based mapping) =====
let activeScrollSource: string | null = null; // 'editor' or 'preview' or null
let scrollTimeout: any = null;
let cachedDataLineElements: HTMLElement[] = [];

function refreshDataLineCache() {
    const preview = $('markdownPreview');
    if (!preview) { cachedDataLineElements = []; return; }
    cachedDataLineElements = Array.from(preview.querySelectorAll('[data-line]')) as HTMLElement[];
}

function getEditorLineHeight(): number {
    const editor = $('markdownEditor') as HTMLTextAreaElement | null;
    if (!editor) return 21;
    const computed = parseFloat(getComputedStyle(editor).lineHeight);
    return isNaN(computed) ? 21 : computed;
}

function syncEditorToPreview() {
    if (!currentSettings.syncScroll) return;
    if (activeScrollSource === 'preview') return;

    activeScrollSource = 'editor';
    if (scrollTimeout) clearTimeout(scrollTimeout);

    const editor = $('markdownEditor') as HTMLTextAreaElement;
    const preview = $('markdownPreview');
    if (!editor || !preview) return;

    const lineHeight = getEditorLineHeight();
    const scrollTop = editor.scrollTop;
    const lineNo = Math.floor(scrollTop / lineHeight);
    const elements = cachedDataLineElements;
    let target: HTMLElement | null = null;

    for (const el of elements) {
        const l = parseInt(el.getAttribute('data-line') || '0');
        if (l >= lineNo) { target = el; break; }
    }

    if (target) {
        preview.scrollTop = target.offsetTop;
    } else if (elements.length > 0 && lineNo > parseInt(elements[elements.length - 1].getAttribute('data-line') || '0')) {
        preview.scrollTop = preview.scrollHeight;
    }

    scrollTimeout = setTimeout(() => { activeScrollSource = null; }, 100);
}

function syncPreviewToEditor() {
    if (!currentSettings.syncScroll) return;
    if (activeScrollSource === 'editor') return;

    activeScrollSource = 'preview';
    if (scrollTimeout) clearTimeout(scrollTimeout);

    const editor = $('markdownEditor') as HTMLTextAreaElement;
    const preview = $('markdownPreview');
    if (!editor || !preview) return;

    const scrollTop = preview.scrollTop;
    const elements = cachedDataLineElements;
    let target: HTMLElement | null = null;

    for (const el of elements) {
        if (el.offsetTop >= scrollTop) { target = el; break; }
    }

    if (target) {
        const lineNo = parseInt(target.getAttribute('data-line') || '0');
        const lineHeight = getEditorLineHeight();
        editor.scrollTop = lineNo * lineHeight;
    }

    scrollTimeout = setTimeout(() => { activeScrollSource = null; }, 100);
}

const throttledSyncEditorToPreview = throttleRAF(syncEditorToPreview);
const throttledSyncPreviewToEditor = throttleRAF(syncPreviewToEditor);

// ===== UI Helpers =====
function showToast(message: string) {
    let toast = $('toastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.className = 'toast-notification';
        toast.innerHTML = `
            <div class="toast-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
            <span class="toast-text"></span>
        `;
        document.body.appendChild(toast);
    }
    if (toast) {
        const toastText = toast.querySelector('.toast-text') || $('toastText');
        if (toastText) toastText.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast!.classList.remove('show'), 2000);
    }
}

function updateStatusInfo() {
    const statusInfo = $('statusInfo');
    if (!statusInfo) return;

    const lines = currentContent.split('\n').length;
    const chars = currentContent.length;
    const words = currentContent.trim().split(/\s+/).filter(w => w).length;
    const readingTime = Math.max(1, Math.ceil(words / 200));
    statusInfo.textContent = `${lines} lines \u00B7 ${words} words \u00B7 ${chars} chars \u00B7 ~${readingTime} min read`;
    statusInfo.style.display = 'block';
}

// ===== Reading Progress Bar =====
function updateProgressBar() {
    const preview = $('markdownPreview');
    const bar = $('readingProgressBar');
    if (!preview || !bar) return;
    const scrollTop = preview.scrollTop;
    const scrollHeight = preview.scrollHeight - preview.clientHeight;
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    bar.style.width = progress + '%';
}

// ===== Scroll Spy (Active TOC Tracking) =====
function updateScrollSpy() {
    const preview = $('markdownPreview');
    const tocBody = $('tocBody');
    if (!preview || !tocBody) return;

    const headings = Array.from(preview.querySelectorAll('.md-heading'));
    let current = '';
    const scrollTop = preview.scrollTop;

    for (const heading of headings) {
        const el = heading as HTMLElement;
        if (el.offsetTop - 16 <= scrollTop + 100) {
            current = heading.id;
        }
    }

    const links = tocBody.querySelectorAll('.toc-item a');
    let activeLink: HTMLElement | null = null;
    links.forEach(a => {
        const isActive = a.getAttribute('data-target') === current;
        a.classList.toggle('active', isActive);
        if (isActive) activeLink = a as HTMLElement;
    });

    // Auto-scroll TOC body to keep active item visible
    if (activeLink && tocBody) {
        const tocRect = tocBody.getBoundingClientRect();
        const linkRect = (activeLink as HTMLElement).getBoundingClientRect();
        const linkTop = linkRect.top - tocRect.top;
        const linkBot = linkRect.bottom - tocRect.top;
        const tocHeight = tocBody.clientHeight;

        if (linkTop < 0) {
            tocBody.scrollTop += linkTop - 16;
        } else if (linkBot > tocHeight) {
            tocBody.scrollTop += linkBot - tocHeight + 16;
        }
    }
}

const throttledScrollSpy = throttleRAF(() => {
    updateScrollSpy();
    updateProgressBar();
});

function initScrollSpy() {
    const preview = $('markdownPreview');
    if (!preview) return;

    preview.addEventListener('scroll', throttledScrollSpy, { passive: true });
}

// ===== Lightbox =====
function initLightbox() {
    const overlay = $('lightboxOverlay');
    const closeBtn = $('lightboxClose');
    if (!overlay) return;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeLightbox();
    });
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeLightbox());
    }
}

function showLightbox(src: string, alt: string) {
    const overlay = $('lightboxOverlay');
    const img = $('lightboxImage') as HTMLImageElement;
    if (!overlay || !img) return;
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('active');
    document.body.classList.add('lightbox-open');
}

function closeLightbox() {
    const overlay = $('lightboxOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.classList.remove('lightbox-open');
}

// ===== Search in Preview =====
const debouncedSearch = debounce((query: string) => {
    doSearch(query);
}, 200);

function toggleSearchOverlay() {
    const overlay = $('searchOverlay');
    if (!overlay) return;
    if (overlay.classList.contains('active')) {
        closeSearch();
    } else {
        openSearch();
    }
}

function openSearch() {
    const overlay = $('searchOverlay');
    const input = $('searchInput') as HTMLInputElement;
    if (!overlay) return;
    overlay.classList.add('active');
    if (input) {
        input.focus();
        input.select();
    }
}

function closeSearch() {
    const overlay = $('searchOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    clearSearchHighlights();
    searchMatches = [];
    searchCurrentIndex = -1;
    updateSearchCount();
}

function doSearch(query: string) {
    clearSearchHighlights();
    searchMatches = [];
    searchCurrentIndex = -1;

    if (!query || query.length < 2) {
        updateSearchCount();
        return;
    }

    const preview = $('markdownPreview');
    if (!preview) return;

    const lowerQuery = query.toLowerCase();
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null);
    const nodesToProcess: { node: Text; indices: number[] }[] = [];

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent || '';
        const lowerText = text.toLowerCase();
        const indices: number[] = [];
        let idx = 0;
        while ((idx = lowerText.indexOf(lowerQuery, idx)) !== -1) {
            indices.push(idx);
            idx += lowerQuery.length;
        }
        if (indices.length > 0) {
            nodesToProcess.push({ node: textNode, indices });
        }
    }

    for (let i = nodesToProcess.length - 1; i >= 0; i--) {
        const { node, indices } = nodesToProcess[i];
        for (let j = indices.length - 1; j >= 0; j--) {
            const startIdx = indices[j];
            const range = document.createRange();
            range.setStart(node, startIdx);
            range.setEnd(node, startIdx + query.length);
            const highlightMark = document.createElement('mark');
            highlightMark.className = 'search-highlight';
            range.surroundContents(highlightMark);
            searchMatches.unshift(highlightMark);
        }
    }

    if (searchMatches.length > 0) {
        searchCurrentIndex = 0;
        highlightCurrentMatch();
    }
    updateSearchCount();
}

function clearSearchHighlights() {
    const preview = $('markdownPreview');
    if (!preview) return;
    preview.querySelectorAll('.search-highlight').forEach(mark => {
        const parent = mark.parentNode;
        if (parent) {
            parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
            parent.normalize();
        }
    });
}

function highlightCurrentMatch() {
    searchMatches.forEach((m, i) => {
        m.classList.toggle('current', i === searchCurrentIndex);
    });
    if (searchMatches[searchCurrentIndex]) {
        searchMatches[searchCurrentIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

function navigateSearch(direction: 'next' | 'prev') {
    if (searchMatches.length === 0) return;
    if (direction === 'next') {
        searchCurrentIndex = (searchCurrentIndex + 1) % searchMatches.length;
    } else {
        searchCurrentIndex = (searchCurrentIndex - 1 + searchMatches.length) % searchMatches.length;
    }
    highlightCurrentMatch();
    updateSearchCount();
}

function updateSearchCount() {
    const countEl = $('searchCount');
    if (!countEl) return;
    if (searchMatches.length === 0) {
        countEl.textContent = 'No results';
    } else {
        countEl.textContent = `${searchCurrentIndex + 1} / ${searchMatches.length}`;
    }
}

function reapplySearch() {
    const overlay = $('searchOverlay');
    const input = $('searchInput') as HTMLInputElement;
    if (overlay && overlay.classList.contains('active') && input && input.value.length >= 2) {
        doSearch(input.value);
    }
}

function initSearchOverlay() {
    const input = $('searchInput') as HTMLInputElement;
    const prevBtn = $('searchPrev');
    const nextBtn = $('searchNext');
    const closeBtn = $('searchClose');

    if (input) {
        input.addEventListener('input', () => {
            debouncedSearch(input.value);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                navigateSearch(e.shiftKey ? 'prev' : 'next');
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
            }
        });
    }
    if (prevBtn) prevBtn.addEventListener('click', () => navigateSearch('prev'));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateSearch('next'));
    if (closeBtn) closeBtn.addEventListener('click', () => closeSearch());
}

// ===== Focus Mode =====
function toggleFocusMode() {
    isFocusMode = !isFocusMode;
    document.body.classList.toggle('focus-mode', isFocusMode);
    if (toolbarManager) {
        const btn = toolbarManager.getButton('focusModeButton');
        if (btn) btn.classList.toggle('active', isFocusMode);
    }
}

// ===== Settings =====
function applySettings(settings: any, persist = false) {
    if (!settings) return;
    currentSettings = { ...currentSettings, ...settings };

    const container = $('markdownContainer');
    const editor = $('markdownEditor');

    // Word wrap
    if (container) {
        container.classList.toggle('word-wrap', currentSettings.wordWrap);
    }
    if (editor) {
        editor.style.whiteSpace = currentSettings.wordWrap ? 'pre-wrap' : 'pre';
    }

    // Sticky toolbar
    document.body.classList.toggle('sticky-toolbar-enabled', currentSettings.stickyToolbar);

    // Preview position (left or right)
    if (container && isEditMode) {
        if (currentSettings.previewPosition === 'left') {
            container.classList.add('preview-left');
        } else {
            container.classList.remove('preview-left');
        }
    }

    // Update checkbox UI
    const chkWordWrap = $('chkWordWrap') as HTMLInputElement;
    const chkStickyToolbar = $('chkStickyToolbar') as HTMLInputElement;
    const chkSyncScroll = $('chkSyncScroll') as HTMLInputElement;
    const chkPreviewLeft = $('chkPreviewLeft') as HTMLInputElement;
    const chkShowOutline = $('chkShowOutline') as HTMLInputElement;
    const chkShowLineNumbers = $('chkShowLineNumbers') as HTMLInputElement;

    if (chkWordWrap) chkWordWrap.checked = currentSettings.wordWrap;
    if (chkStickyToolbar) chkStickyToolbar.checked = currentSettings.stickyToolbar;
    if (chkSyncScroll) chkSyncScroll.checked = currentSettings.syncScroll;
    if (chkPreviewLeft) chkPreviewLeft.checked = currentSettings.previewPosition === 'left';
    if (chkShowOutline) chkShowOutline.checked = currentSettings.showOutline;
    if (chkShowLineNumbers) chkShowLineNumbers.checked = currentSettings.showLineNumbers;

    // Line numbers
    document.body.classList.toggle('show-line-numbers', !!currentSettings.showLineNumbers);

        const tocPanel = $('tocPanel');
        if (container) container.classList.toggle('toc-open', !!currentSettings.showOutline);
    if (tocPanel) tocPanel.classList.toggle('hidden', !currentSettings.showOutline);

    if (toolbarManager) {
        const btn = toolbarManager.getButton('toggleTocButton');
        if (btn) btn.classList.toggle('active', !!currentSettings.showOutline);
    }

    if (toolbarManager) {
        toolbarManager.setButtonVisibility('disableMdEditorButton', !!currentSettings.isMdEnabled);
        toolbarManager.setButtonVisibility('enableMdEditorButton', !currentSettings.isMdEnabled);
    }

    if (persist) {
        vscode.postMessage({ command: 'updateSettings', settings: currentSettings });
    }
}

function initializeSettings() {
    const settingsDefs = [
        {
            id: 'chkWordWrap',
            label: 'Word Wrap',
            defaultValue: currentSettings.wordWrap,
            onChange: (val: boolean) => {
                currentSettings.wordWrap = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkStickyToolbar',
            label: 'Sticky Toolbar',
            defaultValue: currentSettings.stickyToolbar,
            onChange: (val: boolean) => {
                currentSettings.stickyToolbar = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkSyncScroll',
            label: 'Sync Scrolling',
            defaultValue: currentSettings.syncScroll,
            onChange: (val: boolean) => {
                currentSettings.syncScroll = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkPreviewLeft',
            label: 'Preview on Left',
            defaultValue: currentSettings.previewPosition === 'left',
            onChange: (val: boolean) => {
                currentSettings.previewPosition = val ? 'left' : 'right';
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowOutline',
            label: 'Show Outline',
            defaultValue: currentSettings.showOutline,
            onChange: (val: boolean) => {
                currentSettings.showOutline = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowLineNumbers',
            label: 'Line Numbers',
            defaultValue: currentSettings.showLineNumbers,
            onChange: (val: boolean) => {
                currentSettings.showLineNumbers = val;
                applySettings(currentSettings, true);
            }
        }
    ];

    // Render panel
    SettingsManager.renderPanel(document.body, 'settingsPanel', 'settingsCancelButton', settingsDefs);

    // Initialize manager
    new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settingsDefs);
}

// ===== Header Height =====
function updateHeaderHeight() {
    const toolbar = document.querySelector('.toolbar') as HTMLElement;
    if (toolbar) {
        const height = toolbar.offsetHeight;
        document.documentElement.style.setProperty('--header-height', height + 'px');
    }
}

// ===== Message Handler =====
window.addEventListener('message', (event) => {
    const m = event.data;

    switch (m.command) {
        case 'initMarkdown':
            const loading = $('loadingIndicator');
            if (loading) loading.style.display = 'none';

            currentContent = m.content || '';
            originalContent = currentContent;
            renderMarkdown(currentContent);
            updateStatusInfo();
            break;

        case 'initSettings':
        case 'settingsUpdated':
            applySettings(m.settings, false);
            break;

        case 'saveResult':
            isSaving = false;
            setButtonsEnabled(true);
            if (m.ok) {
                showToast('Saved');
                originalContent = currentContent;
                if (shouldExitEditMode) {
                    setEditMode(false);
                }
                shouldExitEditMode = false;
            } else {
                showToast('Error saving');
                shouldExitEditMode = false;
            }
            break;
    }
});

// ===== Button Handlers =====
function wireButtons() {
    toolbarManager = new ToolbarManager('toolbar');

    toolbarManager.setButtons([
        {
            id: 'toggleViewButton',
            icon: Icons.EditFile,
            label: 'Edit File',
            tooltip: 'Edit File in Vscode Default Editor',
            onClick: () => {
                isPreviewView = !isPreviewView;
                vscode.postMessage({ command: 'toggleView', isPreviewView });
            }
        },
        {
            id: 'toggleEditModeButton',
            icon: Icons.SplitEdit,
            label: 'Split Edit',
            tooltip: 'Edit Markdown side-by-side',
            onClick: () => setEditMode(true)
        },
        {
            id: 'saveEditsButton',
            icon: '',
            label: 'Save',
            tooltip: 'Save Changes (Ctrl+S)',
            hidden: true,
            onClick: () => performSave(true)
        },
        {
            id: 'cancelEditsButton',
            icon: '',
            label: 'Cancel',
            tooltip: 'Cancel Changes (Esc)',
            hidden: true,
            onClick: () => cancelEdit()
        },
        {
            id: 'toggleTocButton',
            icon: Icons.Outline,
            tooltip: 'Toggle Outline',
            cls: 'icon-only',
            onClick: () => {
                currentSettings.showOutline = !currentSettings.showOutline;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'searchButton',
            icon: Icons.Search,
            tooltip: 'Search in Preview (Ctrl+Shift+F)',
            cls: 'icon-only',
            onClick: () => toggleSearchOverlay()
        },
        {
            id: 'focusModeButton',
            icon: Icons.Focus,
            tooltip: 'Focus Mode',
            cls: 'icon-only',
            onClick: () => toggleFocusMode()
        },
        {
            id: 'copyHtmlButton',
            icon: Icons.CopyHtml,
            tooltip: 'Copy as HTML',
            cls: 'icon-only edit-mode-hide',
            onClick: () => {
                const preview = $('markdownPreview');
                if (preview && navigator.clipboard) {
                    navigator.clipboard.writeText(preview.innerHTML)
                        .then(() => showToast('HTML copied'))
                        .catch(() => showToast('Copy failed'));
                }
            }
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: 'Settings',
            cls: 'icon-only',
            onClick: () => { /* Handled by wireSettingsUI */ }
        },
        {
            id: 'toggleBackgroundButton',
            icon: Icons.ThemeLight + Icons.ThemeDark + Icons.ThemeVSCode,
            tooltip: 'Toggle Theme',
            cls: 'edit-mode-hide',
            onClick: () => { /* Handled by ThemeManager */ }
        },
        {
            id: 'helpButton',
            icon: Icons.Help,
            tooltip: 'Help & Feedback',
            cls: 'icon-only',
            onClick: () => {
                vscode.postMessage({
                    command: 'openExternal',
                    url: 'https://docs.google.com/forms/d/e/1FAIpQLSe5AqE_f1-WqUlQmvuPn1as3Mkn4oLjA0EDhNssetzt63ONzA/viewform'
                });
            }
        },
        {
            id: 'disableMdEditorButton',
            icon: Icons.ZapOff,
            label: 'Disable MD',
            tooltip: 'Disable XLSX Viewer for all Markdown files',
            cls: 'edit-mode-hide',
            onClick: () => {
                vscode.postMessage({ command: 'disableMdEditor' });
            }
        },
        {
            id: 'enableMdEditorButton',
            icon: Icons.Zap,
            label: 'Enable MD',
            tooltip: 'Enable XLSX Viewer for all Markdown files (Make Default)',
            cls: 'edit-mode-hide',
            hidden: true,
            onClick: () => {
                vscode.postMessage({ command: 'enableMdEditor' });
            }
        }
    ]);

    // Inject tooltip if variables are present
    InfoTooltip.inject('toolbar', (window as any).viewImgUri, (window as any).logoSvgUri, 'GitHub Flavored Markdown');

    // Theme manager
    new ThemeManager('toggleBackgroundButton', {
        onBeforeCycle: () => true
    }, vscode);
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    const isCmdOrCtrl = e.ctrlKey || e.metaKey;

    if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isEditMode) {
            performSave(false);
        }
        return;
    }

    if (isCmdOrCtrl && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleSearchOverlay();
        return;
    }

    if (e.key === 'Escape') {
        // Close lightbox first, then search, then edit mode
        const lightbox = $('lightboxOverlay');
        if (lightbox && lightbox.classList.contains('active')) {
            e.preventDefault();
            closeLightbox();
            return;
        }
        const searchOverlay = $('searchOverlay');
        if (searchOverlay && searchOverlay.classList.contains('active')) {
            e.preventDefault();
            closeSearch();
            return;
        }
        if (isEditMode) {
            e.preventDefault();
            cancelEdit();
            return;
        }
    }
});

// ===== Formatting Utilities =====
function wrapSelection(editor: HTMLTextAreaElement, before: string, after: string) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;
    const selected = value.substring(start, end);

    // If already wrapped, unwrap
    const bLen = before.length;
    const aLen = after.length;
    if (start >= bLen && value.substring(start - bLen, start) === before && value.substring(end, end + aLen) === after) {
        editor.value = value.substring(0, start - bLen) + selected + value.substring(end + aLen);
        editor.selectionStart = start - bLen;
        editor.selectionEnd = end - bLen;
    } else {
        editor.value = value.substring(0, start) + before + selected + after + value.substring(end);
        editor.selectionStart = start + bLen;
        editor.selectionEnd = end + bLen;
    }
    editor.focus();
    onEditorInput();
}

function toggleLinePrefix(editor: HTMLTextAreaElement, prefix: string) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end);
    const lineEndFix = lineEnd === -1 ? value.length : lineEnd;
    const lineContent = value.substring(lineStart, lineEndFix);

    if (lineContent.startsWith(prefix)) {
        editor.value = value.substring(0, lineStart) + lineContent.substring(prefix.length) + value.substring(lineEndFix);
        editor.selectionStart = Math.max(lineStart, start - prefix.length);
        editor.selectionEnd = Math.max(lineStart, end - prefix.length);
    } else {
        // Remove other heading prefixes if applying a heading
        let cleaned = lineContent;
        if (prefix.startsWith('#')) {
            cleaned = lineContent.replace(/^#{1,6}\s/, '');
        }
        editor.value = value.substring(0, lineStart) + prefix + cleaned + value.substring(lineEndFix);
        const diff = prefix.length + cleaned.length - lineContent.length;
        editor.selectionStart = start + diff;
        editor.selectionEnd = end + diff;
    }
    editor.focus();
    onEditorInput();
}

function insertAtCursor(editor: HTMLTextAreaElement, text: string, cursorOffset?: number) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;
    editor.value = value.substring(0, start) + text + value.substring(end);
    const pos = cursorOffset !== undefined ? start + cursorOffset : start + text.length;
    editor.selectionStart = editor.selectionEnd = pos;
    editor.focus();
    onEditorInput();
}

function insertLink(editor: HTMLTextAreaElement) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.substring(start, end);
    if (selected) {
        wrapSelection(editor, '[', '](url)');
        // Place cursor at "url"
        editor.selectionStart = end + 3;
        editor.selectionEnd = end + 6;
    } else {
        insertAtCursor(editor, '[text](url)', 1);
        editor.selectionStart = start + 1;
        editor.selectionEnd = start + 5;
    }
    editor.focus();
}

function insertImage(editor: HTMLTextAreaElement) {
    const start = editor.selectionStart;
    const selected = editor.value.substring(start, editor.selectionEnd);
    const alt = selected || 'alt text';
    const snippet = `![${alt}](image-url)`;
    const value = editor.value;
    editor.value = value.substring(0, start) + snippet + value.substring(editor.selectionEnd);
    // Select "image-url"
    editor.selectionStart = start + alt.length + 4;
    editor.selectionEnd = start + alt.length + 13;
    editor.focus();
    onEditorInput();
}

function insertTable(editor: HTMLTextAreaElement) {
    const table = '\n| Header 1 | Header 2 | Header 3 |\n| -------- | -------- | -------- |\n| Cell 1   | Cell 2   | Cell 3   |\n';
    insertAtCursor(editor, table);
}

function toggleCheckboxList(editor: HTMLTextAreaElement) {
    toggleLinePrefix(editor, '- [ ] ');
}

function toggleBlockquote(editor: HTMLTextAreaElement) {
    toggleLinePrefix(editor, '> ');
}

function insertHorizontalRule(editor: HTMLTextAreaElement) {
    const start = editor.selectionStart;
    const value = editor.value;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const before = lineStart === 0 && start === 0 ? '' : '\n';
    insertAtCursor(editor, before + '---\n');
}

function toggleCodeBlock(editor: HTMLTextAreaElement) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.substring(start, end);
    const value = editor.value;

    if (selected.startsWith('```') && selected.endsWith('```')) {
        // Unwrap
        const inner = selected.slice(3, -3).replace(/^\n/, '').replace(/\n$/, '');
        editor.value = value.substring(0, start) + inner + value.substring(end);
        editor.selectionStart = start;
        editor.selectionEnd = start + inner.length;
    } else {
        const wrapped = '```\n' + (selected || 'code') + '\n```';
        editor.value = value.substring(0, start) + wrapped + value.substring(end);
        editor.selectionStart = start + 4;
        editor.selectionEnd = start + 4 + (selected || 'code').length;
    }
    editor.focus();
    onEditorInput();
}

// Multi-line indent/outdent
function multiLineIndent(editor: HTMLTextAreaElement, outdent: boolean) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;

    const firstLineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lastLineEnd = value.indexOf('\n', end - 1);
    const blockEnd = lastLineEnd === -1 ? value.length : lastLineEnd;
    const block = value.substring(firstLineStart, blockEnd);
    const lines = block.split('\n');

    let totalShift = 0;
    let firstLineShift = 0;
    const newLines = lines.map((line, i) => {
        if (outdent) {
            if (line.startsWith('    ')) {
                if (i === 0) firstLineShift = -4;
                totalShift -= 4;
                return line.substring(4);
            } else if (line.startsWith('\t')) {
                if (i === 0) firstLineShift = -1;
                totalShift -= 1;
                return line.substring(1);
            }
            return line;
        } else {
            if (i === 0) firstLineShift = 4;
            totalShift += 4;
            return '    ' + line;
        }
    });

    const newBlock = newLines.join('\n');
    editor.value = value.substring(0, firstLineStart) + newBlock + value.substring(blockEnd);
    editor.selectionStart = Math.max(firstLineStart, start + firstLineShift);
    editor.selectionEnd = end + totalShift;
    editor.focus();
    onEditorInput();
}

// Undo/Redo history
interface HistoryEntry { text: string; selStart: number; selEnd: number; }
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];
let lastSavedHistoryText = '';

function pushUndoState(editor: HTMLTextAreaElement) {
    const text = editor.value;
    if (text === lastSavedHistoryText) return;
    undoStack.push({ text, selStart: editor.selectionStart, selEnd: editor.selectionEnd });
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    lastSavedHistoryText = text;
}

function performUndo(editor: HTMLTextAreaElement) {
    if (undoStack.length === 0) return;
    redoStack.push({ text: editor.value, selStart: editor.selectionStart, selEnd: editor.selectionEnd });
    const state = undoStack.pop()!;
    editor.value = state.text;
    editor.selectionStart = state.selStart;
    editor.selectionEnd = state.selEnd;
    lastSavedHistoryText = state.text;
    editor.focus();
    onEditorInput();
}

function performRedo(editor: HTMLTextAreaElement) {
    if (redoStack.length === 0) return;
    undoStack.push({ text: editor.value, selStart: editor.selectionStart, selEnd: editor.selectionEnd });
    const state = redoStack.pop()!;
    editor.value = state.text;
    editor.selectionStart = state.selStart;
    editor.selectionEnd = state.selEnd;
    lastSavedHistoryText = state.text;
    editor.focus();
    onEditorInput();
}

// ===== Line Operations =====
function duplicateLine(editor: HTMLTextAreaElement) {
    const value = editor.value;
    const start = editor.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', start);
    const lineEndFix = lineEnd === -1 ? value.length : lineEnd;
    const line = value.substring(lineStart, lineEndFix);
    editor.value = value.substring(0, lineEndFix) + '\n' + line + value.substring(lineEndFix);
    // Place cursor on duplicated line at same offset
    const offset = start - lineStart;
    editor.selectionStart = editor.selectionEnd = lineEndFix + 1 + offset;
    editor.focus();
    onEditorInput();
}

function deleteLine(editor: HTMLTextAreaElement) {
    const value = editor.value;
    const start = editor.selectionStart;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', start);
    if (lineEnd === -1) {
        // Last line — remove from prev newline
        editor.value = value.substring(0, Math.max(0, lineStart - 1));
        editor.selectionStart = editor.selectionEnd = editor.value.length;
    } else {
        editor.value = value.substring(0, lineStart) + value.substring(lineEnd + 1);
        editor.selectionStart = editor.selectionEnd = lineStart;
    }
    editor.focus();
    onEditorInput();
}

function moveLineUp(editor: HTMLTextAreaElement) {
    const value = editor.value;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end - (end > start && value[end - 1] === '\n' ? 1 : 0));
    const lineEndFix = lineEnd === -1 ? value.length : lineEnd;

    if (lineStart === 0) return; // Already at top

    const prevLineStart = value.lastIndexOf('\n', lineStart - 2) + 1;
    const currentBlock = value.substring(lineStart, lineEndFix);
    const prevLine = value.substring(prevLineStart, lineStart - 1);

    editor.value = value.substring(0, prevLineStart) + currentBlock + '\n' + prevLine + value.substring(lineEndFix);
    const shift = lineStart - prevLineStart;
    editor.selectionStart = start - shift;
    editor.selectionEnd = end - shift;
    editor.focus();
    onEditorInput();
}

function moveLineDown(editor: HTMLTextAreaElement) {
    const value = editor.value;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = value.indexOf('\n', end - (end > start && value[end - 1] === '\n' ? 1 : 0));
    const lineEndFix = lineEnd === -1 ? value.length : lineEnd;

    if (lineEndFix >= value.length) return; // Already at bottom

    const nextLineEnd = value.indexOf('\n', lineEndFix + 1);
    const nextLineEndFix = nextLineEnd === -1 ? value.length : nextLineEnd;
    const currentBlock = value.substring(lineStart, lineEndFix);
    const nextLine = value.substring(lineEndFix + 1, nextLineEndFix);

    editor.value = value.substring(0, lineStart) + nextLine + '\n' + currentBlock + value.substring(nextLineEndFix);
    const shift = nextLine.length + 1;
    editor.selectionStart = start + shift;
    editor.selectionEnd = end + shift;
    editor.focus();
    onEditorInput();
}

function selectWord(editor: HTMLTextAreaElement) {
    const value = editor.value;
    const pos = editor.selectionStart;
    const wordChars = /[\w\-]/;
    let wStart = pos;
    let wEnd = pos;
    while (wStart > 0 && wordChars.test(value[wStart - 1])) wStart--;
    while (wEnd < value.length && wordChars.test(value[wEnd])) wEnd++;
    editor.selectionStart = wStart;
    editor.selectionEnd = wEnd;
    editor.focus();
}

function jumpToLine(editor: HTMLTextAreaElement) {
    const lineCount = editor.value.split('\n').length;
    const input = prompt(`Go to line (1-${lineCount}):`);
    if (!input) return;
    const lineNum = parseInt(input, 10);
    if (isNaN(lineNum) || lineNum < 1 || lineNum > lineCount) return;

    const lines = editor.value.split('\n');
    let offset = 0;
    for (let i = 0; i < lineNum - 1; i++) {
        offset += lines[i].length + 1;
    }
    editor.selectionStart = editor.selectionEnd = offset;
    editor.focus();

    // Scroll to line
    const lineHeight = getEditorLineHeight();
    editor.scrollTop = (lineNum - 1) * lineHeight - editor.clientHeight / 3;
}

function transformCase(editor: HTMLTextAreaElement, mode: 'upper' | 'lower' | 'title') {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) return;
    const selected = editor.value.substring(start, end);
    let transformed: string;
    switch (mode) {
        case 'upper': transformed = selected.toUpperCase(); break;
        case 'lower': transformed = selected.toLowerCase(); break;
        case 'title': transformed = selected.replace(/\b\w/g, c => c.toUpperCase()); break;
    }
    editor.value = editor.value.substring(0, start) + transformed + editor.value.substring(end);
    editor.selectionStart = start;
    editor.selectionEnd = start + transformed.length;
    editor.focus();
    onEditorInput();
}

function sortSelectedLines(editor: HTMLTextAreaElement, descending = false) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    if (start === end) return;
    const value = editor.value;
    const firstLineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lastLineEnd = value.indexOf('\n', end - 1);
    const blockEnd = lastLineEnd === -1 ? value.length : lastLineEnd;
    const block = value.substring(firstLineStart, blockEnd);
    const lines = block.split('\n');
    lines.sort((a, b) => descending ? b.localeCompare(a) : a.localeCompare(b));
    const sorted = lines.join('\n');
    editor.value = value.substring(0, firstLineStart) + sorted + value.substring(blockEnd);
    editor.selectionStart = firstLineStart;
    editor.selectionEnd = firstLineStart + sorted.length;
    editor.focus();
    onEditorInput();
}

function trimTrailingWhitespace(editor: HTMLTextAreaElement) {
    const pos = editor.selectionStart;
    editor.value = editor.value.replace(/[ \t]+$/gm, '');
    editor.selectionStart = editor.selectionEnd = Math.min(pos, editor.value.length);
    editor.focus();
    onEditorInput();
}

// Apply formatting from external call (toolbar buttons)
function applyFormat(action: string) {
    const editor = $('markdownEditor') as HTMLTextAreaElement;
    if (!editor) return;
    pushUndoState(editor);
    switch (action) {
        case 'bold': wrapSelection(editor, '**', '**'); break;
        case 'italic': wrapSelection(editor, '*', '*'); break;
        case 'strikethrough': wrapSelection(editor, '~~', '~~'); break;
        case 'inlineCode': wrapSelection(editor, '`', '`'); break;
        case 'codeBlock': toggleCodeBlock(editor); break;
        case 'link': insertLink(editor); break;
        case 'image': insertImage(editor); break;
        case 'table': insertTable(editor); break;
        case 'heading1': toggleLinePrefix(editor, '# '); break;
        case 'heading2': toggleLinePrefix(editor, '## '); break;
        case 'heading3': toggleLinePrefix(editor, '### '); break;
        case 'bulletList': toggleLinePrefix(editor, '- '); break;
        case 'orderedList': toggleLinePrefix(editor, '1. '); break;
        case 'checkbox': toggleCheckboxList(editor); break;
        case 'blockquote': toggleBlockquote(editor); break;
        case 'hr': insertHorizontalRule(editor); break;
        case 'undo': performUndo(editor); break;
        case 'redo': performRedo(editor); break;
        case 'duplicateLine': duplicateLine(editor); break;
        case 'deleteLine': deleteLine(editor); break;
        case 'moveUp': moveLineUp(editor); break;
        case 'moveDown': moveLineDown(editor); break;
        case 'selectWord': selectWord(editor); break;
        case 'jumpToLine': jumpToLine(editor); break;
        case 'uppercase': transformCase(editor, 'upper'); break;
        case 'lowercase': transformCase(editor, 'lower'); break;
        case 'titlecase': transformCase(editor, 'title'); break;
        case 'sortLines': sortSelectedLines(editor); break;
        case 'sortLinesDesc': sortSelectedLines(editor, true); break;
        case 'trimWhitespace': trimTrailingWhitespace(editor); break;
    }
}

// ===== Editor Events =====
function wireEditor() {
    const editor = $('markdownEditor') as HTMLTextAreaElement;
    const preview = $('markdownPreview');
    if (!editor) return;

    editor.addEventListener('input', onEditorInput);

    editor.addEventListener('scroll', throttledSyncEditorToPreview, { passive: true });

    if (preview) {
        preview.addEventListener('scroll', throttledSyncPreviewToEditor, { passive: true });
    }

    // Save initial undo state
    pushUndoState(editor);

    editor.addEventListener('keydown', (e) => {
        const isMod = e.ctrlKey || e.metaKey;

        // Tab indent / multi-line indent
        if (e.key === 'Tab') {
            e.preventDefault();
            pushUndoState(editor);
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const value = editor.value;

            // Multi-line selection: indent/outdent all lines
            if (start !== end && value.substring(start, end).includes('\n')) {
                multiLineIndent(editor, e.shiftKey);
            } else if (e.shiftKey) {
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const lineContent = value.substring(lineStart, start);
                if (lineContent.startsWith('    ')) {
                    editor.value = value.substring(0, lineStart) + value.substring(lineStart + 4);
                    editor.selectionStart = editor.selectionEnd = start - 4;
                } else if (lineContent.startsWith('\t')) {
                    editor.value = value.substring(0, lineStart) + value.substring(lineStart + 1);
                    editor.selectionStart = editor.selectionEnd = start - 1;
                }
                onEditorInput();
            } else {
                editor.value = value.substring(0, start) + '    ' + value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
                onEditorInput();
            }
            return;
        }

        // Enter: auto-indent + list continuation
        if (e.key === 'Enter' && !e.shiftKey && !isMod) {
            const start = editor.selectionStart;
            const value = editor.value;
            const lineStart = value.lastIndexOf('\n', start - 1) + 1;
            const currentLine = value.substring(lineStart, start);

            // Detect leading whitespace
            const indentMatch = currentLine.match(/^(\s*)/);
            const indent = indentMatch ? indentMatch[1] : '';

            // Detect list patterns
            const bulletMatch = currentLine.match(/^(\s*)([-*+])\s(.*)$/);
            const orderedMatch = currentLine.match(/^(\s*)(\d+)\.\s(.*)$/);
            const checkboxMatch = currentLine.match(/^(\s*)- \[([ xX])\]\s(.*)$/);

            let insertion = '\n' + indent;
            let shouldHandle = false;

            if (checkboxMatch) {
                if (checkboxMatch[3].trim() === '') {
                    // Empty checkbox line: remove it and just add newline
                    e.preventDefault();
                    pushUndoState(editor);
                    const lineEnd = start;
                    editor.value = value.substring(0, lineStart) + '\n' + value.substring(lineEnd);
                    editor.selectionStart = editor.selectionEnd = lineStart + 1;
                    onEditorInput();
                    return;
                }
                insertion = '\n' + checkboxMatch[1] + '- [ ] ';
                shouldHandle = true;
            } else if (bulletMatch) {
                if (bulletMatch[3].trim() === '') {
                    e.preventDefault();
                    pushUndoState(editor);
                    const lineEnd = start;
                    editor.value = value.substring(0, lineStart) + '\n' + value.substring(lineEnd);
                    editor.selectionStart = editor.selectionEnd = lineStart + 1;
                    onEditorInput();
                    return;
                }
                insertion = '\n' + bulletMatch[1] + bulletMatch[2] + ' ';
                shouldHandle = true;
            } else if (orderedMatch) {
                if (orderedMatch[3].trim() === '') {
                    e.preventDefault();
                    pushUndoState(editor);
                    const lineEnd = start;
                    editor.value = value.substring(0, lineStart) + '\n' + value.substring(lineEnd);
                    editor.selectionStart = editor.selectionEnd = lineStart + 1;
                    onEditorInput();
                    return;
                }
                const nextNum = parseInt(orderedMatch[2]) + 1;
                insertion = '\n' + orderedMatch[1] + nextNum + '. ';
                shouldHandle = true;
            } else if (indent) {
                shouldHandle = true;
            }

            if (shouldHandle) {
                e.preventDefault();
                pushUndoState(editor);
                editor.value = value.substring(0, start) + insertion + value.substring(editor.selectionEnd);
                editor.selectionStart = editor.selectionEnd = start + insertion.length;
                onEditorInput();
            }
            return;
        }

        // Formatting shortcuts
        if (isMod) {
            let handled = true;
            pushUndoState(editor);

            if (e.key === 'b') { applyFormat('bold'); }
            else if (e.key === 'i') { applyFormat('italic'); }
            else if (e.key === 'k') { applyFormat('link'); }
            else if (e.key === 'e' && !e.shiftKey) { applyFormat('inlineCode'); }
            else if (e.key === 'e' && e.shiftKey) { applyFormat('codeBlock'); }
            else if (e.key === 'x' && e.shiftKey) { applyFormat('strikethrough'); }
            else if (e.key === 'l' && !e.shiftKey) { applyFormat('bulletList'); }
            else if (e.key === 'l' && e.shiftKey) { applyFormat('orderedList'); }
            else if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); performUndo(editor); }
            else if (e.key === 'z' && e.shiftKey) { e.preventDefault(); performRedo(editor); }
            else if (e.key === 'y') { e.preventDefault(); performRedo(editor); }
            else if (e.key === '1') { applyFormat('heading1'); }
            else if (e.key === '2') { applyFormat('heading2'); }
            else if (e.key === '3') { applyFormat('heading3'); }
            else if (e.key === 'd' && e.shiftKey) { applyFormat('duplicateLine'); }
            else if (e.key === 'k' && e.shiftKey) { applyFormat('deleteLine'); }
            else if (e.key === 'd' && !e.shiftKey) { applyFormat('selectWord'); }
            else if (e.key === 'g') { applyFormat('jumpToLine'); }
            else if (e.key === 'u' && e.shiftKey) { applyFormat('uppercase'); }
            else if (e.key === 'u' && !e.shiftKey) { applyFormat('lowercase'); }
            else { handled = false; }

            if (handled) {
                e.preventDefault();
                return;
            }
        }

        // Alt+Arrow: move line up/down
        if (e.altKey && !isMod) {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                pushUndoState(editor);
                moveLineUp(editor);
                return;
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                pushUndoState(editor);
                moveLineDown(editor);
                return;
            }
        }

        // Auto-close pairs when wrapping selected text
        const pairs: {[key: string]: string} = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
        if (pairs[e.key]) {
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const selected = editor.value.substring(start, end);

            if (selected) {
                e.preventDefault();
                pushUndoState(editor);
                editor.value = editor.value.substring(0, start) + e.key + selected + pairs[e.key] + editor.value.substring(end);
                editor.selectionStart = start + 1;
                editor.selectionEnd = end + 1;
                onEditorInput();
            }
        }
    });

    // Track undo states on input
    const debouncedUndoSave = debounce(() => pushUndoState(editor), 500);
    editor.addEventListener('input', debouncedUndoSave);
}

// ===== Preview Interactions =====
function wirePreviewInteractions() {
    const preview = $('markdownPreview');
    if (!preview) return;
    const wired = (preview as any)._wired;
    if (wired) return;
    (preview as any)._wired = true;

    preview.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const copyBtn = target.closest('.code-copy') as HTMLElement | null;
        if (copyBtn) {
            e.preventDefault();
            const encoded = copyBtn.getAttribute('data-code') || '';
            const code = decodeURIComponent(encoded);
            if (navigator.clipboard) {
                navigator.clipboard.writeText(code).then(() => showToast('Copied')).catch(() => showToast('Copy failed'));
            }
            return;
        }

        // Heading anchor link: copy URL
        const anchorLink = target.closest('.heading-anchor') as HTMLElement | null;
        if (anchorLink) {
            e.preventDefault();
            e.stopPropagation();
            const headingId = anchorLink.getAttribute('data-heading-id');
            if (headingId && navigator.clipboard) {
                const decoded = decodeURIComponent(headingId);
                navigator.clipboard.writeText(`#${decoded}`)
                    .then(() => showToast('Link copied'))
                    .catch(() => showToast('Copy failed'));
            }
            return;
        }

        // Image lightbox: click to zoom
        const img = target.closest('.zoomable') as HTMLImageElement | null;
        if (img) {
            e.preventDefault();
            showLightbox(img.src, img.alt);
            return;
        }

        const link = target.closest('a') as HTMLAnchorElement | null;
        if (link && link.href) {
            const href = link.getAttribute('href') || '';
            if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
                e.preventDefault();
                e.stopPropagation();
                vscode.postMessage({ command: 'openExternal', url: href });
            }
        }
    });
}

function wireTocPanel() {
    const tocBody = $('tocBody');
    const closeBtn = $('tocCloseButton');

    if (tocBody) {
        tocBody.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const link = target.closest('a[data-target]') as HTMLAnchorElement | null;
            if (!link) return;
            e.preventDefault();
            const id = link.getAttribute('data-target') || '';
            if (!id) return;
            const preview = $('markdownPreview');
            const el = preview?.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
            if (el) {
                el.scrollIntoView({ block: 'start', behavior: 'smooth' });
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            currentSettings.showOutline = false;
            applySettings(currentSettings, true);
        });
    }
}

// ===== Hover Tooltip =====
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let hoverHideTimer: any = null;

function wireHoverTooltip() {
    const trigger = $('hoverPicTrigger');
    const tooltip = $('hoverTooltip');
    if (!trigger || !tooltip) return;

    function showTooltip() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
        const rect = trigger!.getBoundingClientRect();
        const tooltipWidth = tooltip!.offsetWidth || 300;
        const left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, rect.left - 100));
        const top = rect.bottom + 8;
        tooltip!.style.top = top + 'px';
        tooltip!.style.left = left + 'px';
        tooltip!.classList.remove('hidden');
        tooltip!.classList.add('visible');
    }

    function hideTooltip() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
        }
        tooltip!.classList.remove('visible');
        tooltip!.classList.add('hidden');
    }

    function hideTooltipDelayed() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
        }
        hoverHideTimer = setTimeout(() => hideTooltip(), 250);
    }

    trigger.addEventListener('mouseenter', showTooltip);
    trigger.addEventListener('mouseleave', hideTooltipDelayed);
    trigger.addEventListener('focus', showTooltip);
    trigger.addEventListener('blur', hideTooltip);

    tooltip!.addEventListener('mouseenter', () => {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
    });
    tooltip!.addEventListener('mouseleave', hideTooltipDelayed);
}

// ===== Formatting Toolbar =====
const formatIconMap: Record<string, string> = {
    bold: Icons.Bold,
    italic: Icons.Italic,
    strikethrough: Icons.Strikethrough,
    inlineCode: Icons.InlineCode,
    heading1: '<span class="fmt-text-icon">H1</span>',
    heading2: '<span class="fmt-text-icon">H2</span>',
    heading3: '<span class="fmt-text-icon">H3</span>',
    bulletList: Icons.ListBullet,
    orderedList: Icons.ListOrdered,
    checkbox: Icons.Checkbox,
    blockquote: Icons.Quote,
    link: Icons.Link,
    image: Icons.Image,
    table: Icons.TableInsert,
    codeBlock: Icons.CodeBlock,
    hr: Icons.HorizontalRule,
    undo: Icons.Undo,
    redo: Icons.Redo,
    duplicateLine: Icons.DuplicateLine,
    deleteLine: Icons.DeleteLine,
    moveUp: Icons.MoveUp,
    moveDown: Icons.MoveDown,
    uppercase: '<span class="fmt-text-icon">AB</span>',
    lowercase: '<span class="fmt-text-icon">ab</span>',
    titlecase: '<span class="fmt-text-icon">Ab</span>',
    sortLines: Icons.SortLines,
    trimWhitespace: Icons.Trim,
    jumpToLine: Icons.GoToLine,
};

function wireFormattingToolbar() {
    const fmtToolbar = $('formattingToolbar');
    if (!fmtToolbar) return;

    const buttons = fmtToolbar.querySelectorAll('.fmt-btn');
    buttons.forEach(btn => {
        const format = btn.getAttribute('data-format');
        if (!format) return;

        // Set icon
        const icon = formatIconMap[format];
        if (icon) btn.innerHTML = icon;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applyFormat(format);
        });
    });
}

// ===== Initialize =====
wireButtons();
initializeSettings();
wireEditor();
wireFormattingToolbar();
wireHoverTooltip();
wirePreviewInteractions();
wireTocPanel();
initLightbox();
initSearchOverlay();
initScrollSpy();
updateHeaderHeight();

// Ensure settings are applied once toolbar is ready
if (currentSettings) {
    applySettings(currentSettings);
}

vscode.postMessage({ command: 'webviewReady' });
