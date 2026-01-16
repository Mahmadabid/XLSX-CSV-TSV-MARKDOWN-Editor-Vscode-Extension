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

import hljs from 'highlight.js';
import { ThemeManager } from '../shared/themeManager';
import { SettingsManager } from '../shared/settingsManager';
import { ToolbarManager } from '../shared/toolbarManager';
import { Utils } from '../shared/utils';
import { Icons } from '../shared/icons';
import { vscode, debounce } from '../shared/common';
import { InfoTooltip } from '../shared/infoTooltip';

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
    isMdEnabled: true
};

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

    return `<div class="code-block"${dataLine}><div class="code-block-header">${langLabel}${copyButton}</div><pre><code${langClass}>${highlighted}</code></pre></div>`;
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

function syncEditorToPreview() {
    if (!currentSettings.syncScroll) return;
    if (activeScrollSource === 'preview') return;

    activeScrollSource = 'editor';
    if (scrollTimeout) clearTimeout(scrollTimeout);

    const editor = $('markdownEditor') as HTMLTextAreaElement;
    const preview = $('markdownPreview');
    if (!editor || !preview) return;

    requestAnimationFrame(() => {
        // Calculate approximate line number
        const lineHeight = 21; 
        const scrollTop = editor.scrollTop;
        const lineNo = Math.floor(scrollTop / lineHeight);
        
        // Find element with data-line closest to lineNo
        const elements = Array.from(preview.querySelectorAll('[data-line]'));
        let target: Element | null = null;
        
        for (const el of elements) {
            const l = parseInt(el.getAttribute('data-line') || '0');
            if (l >= lineNo) {
                target = el;
                break;
            }
        }
        
        if (target) {
            preview.scrollTop = (target as HTMLElement).offsetTop;
        } else if (elements.length > 0 && lineNo > parseInt(elements[elements.length-1].getAttribute('data-line') || '0')) {
            // Scroll to bottom if past last element
            preview.scrollTop = preview.scrollHeight;
        }
    });

    scrollTimeout = setTimeout(() => {
        activeScrollSource = null;
    }, 100);
}

function syncPreviewToEditor() {
    if (!currentSettings.syncScroll) return;
    if (activeScrollSource === 'editor') return;

    activeScrollSource = 'preview';
    if (scrollTimeout) clearTimeout(scrollTimeout);

    const editor = $('markdownEditor') as HTMLTextAreaElement;
    const preview = $('markdownPreview');
    if (!editor || !preview) return;

    requestAnimationFrame(() => {
        // Find the first visible element in preview
        const elements = Array.from(preview.querySelectorAll('[data-line]'));
        const scrollTop = preview.scrollTop;
        
        let target: Element | null = null;
        for (const el of elements) {
            if ((el as HTMLElement).offsetTop >= scrollTop) {
                target = el;
                break;
            }
        }
        
        if (target) {
            const lineNo = parseInt(target.getAttribute('data-line') || '0');
            const lineHeight = 21; // Match the editor line height
            editor.scrollTop = lineNo * lineHeight;
        }
    });

    scrollTimeout = setTimeout(() => {
        activeScrollSource = null;
    }, 100);
}

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
    statusInfo.textContent = `${lines} lines, ${words} words, ${chars} chars`;
    statusInfo.style.display = 'block';
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

    if (chkWordWrap) chkWordWrap.checked = currentSettings.wordWrap;
    if (chkStickyToolbar) chkStickyToolbar.checked = currentSettings.stickyToolbar;
    if (chkSyncScroll) chkSyncScroll.checked = currentSettings.syncScroll;
    if (chkPreviewLeft) chkPreviewLeft.checked = currentSettings.previewPosition === 'left';
    if (chkShowOutline) chkShowOutline.checked = currentSettings.showOutline;

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

    if (e.key === 'Escape' && isEditMode) {
        e.preventDefault();
        cancelEdit();
        return;
    }
});

// ===== Editor Events =====
function wireEditor() {
    const editor = $('markdownEditor') as HTMLTextAreaElement;
    const preview = $('markdownPreview');
    if (!editor) return;

    editor.addEventListener('input', onEditorInput);

    editor.addEventListener('scroll', () => {
        syncEditorToPreview();
    });

    if (preview) {
        preview.addEventListener('scroll', () => {
            syncPreviewToEditor();
        });
    }

    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const value = editor.value;

            if (e.shiftKey) {
                const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                const lineContent = value.substring(lineStart, start);
                if (lineContent.startsWith('    ')) {
                    editor.value = value.substring(0, lineStart) + value.substring(lineStart + 4);
                    editor.selectionStart = editor.selectionEnd = start - 4;
                } else if (lineContent.startsWith('\t')) {
                    editor.value = value.substring(0, lineStart) + value.substring(lineStart + 1);
                    editor.selectionStart = editor.selectionEnd = start - 1;
                }
            } else {
                editor.value = value.substring(0, start) + '    ' + value.substring(end);
                editor.selectionStart = editor.selectionEnd = start + 4;
            }
            onEditorInput();
        }

        const pairs: {[key: string]: string} = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
        if (pairs[e.key]) {
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            const selected = editor.value.substring(start, end);

            if (selected) {
                e.preventDefault();
                editor.value = editor.value.substring(0, start) + e.key + selected + pairs[e.key] + editor.value.substring(end);
                editor.selectionStart = start + 1;
                editor.selectionEnd = end + 1;
                onEditorInput();
            }
        }
    });
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

// ===== Initialize =====
wireButtons();
initializeSettings();
wireEditor();
wireHoverTooltip();
wirePreviewInteractions();
wireTocPanel();
updateHeaderHeight();

// Ensure settings are applied once toolbar is ready
if (currentSettings) {
    applySettings(currentSettings);
}

vscode.postMessage({ command: 'webviewReady' });
