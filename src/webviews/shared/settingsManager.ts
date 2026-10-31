import { I18n } from './i18n';

export interface SettingDefinition {
    id: string;
    label: string;
    onChange: (value: any) => void;
    defaultValue?: boolean | number;
    tooltip?: string;
    inputType?: 'checkbox' | 'radio' | 'number';
    groupName?: string;
    value?: string;
    className?: string;
    section?: string;
    min?: number;
    max?: number;
    step?: number;
}

export class SettingsManager {
    private openBtn: HTMLElement | null;
    private panel: HTMLElement | null;
    private cancelBtn: HTMLElement | null;
    private settings: SettingDefinition[];
    private repositionHandlers: any = null;
    private panelOriginalParent: Node | null = null;
    private panelOriginalNext: Node | null = null;
    private onReposition?: () => void;

    constructor(buttonId: string, panelId: string, cancelId: string, settings: SettingDefinition[], onReposition?: () => void) {
        this.openBtn = document.getElementById(buttonId);
        this.panel = document.getElementById(panelId);
        this.cancelBtn = document.getElementById(cancelId);
        this.settings = settings;
        this.onReposition = onReposition;

        this.init();
    }

    private static escapeHtml(input: string): string {
        return input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    static renderPanel(container: HTMLElement, panelId: string, cancelId: string, settings: SettingDefinition[]) {
        const panel = document.createElement('div');
        panel.id = panelId;
        panel.className = 'settings-panel hidden';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-hidden', 'true');
        
        const sections = new Map<string, SettingDefinition[]>();
        settings.forEach(setting => {
            const section = setting.section || I18n.t('settings.general', 'General');
            const entries = sections.get(section) || [];
            entries.push(setting);
            sections.set(section, entries);
        });

        let html = `<div class="settings-header"><div class="settings-heading"><h2>${this.escapeHtml(I18n.t('settings.title', 'Settings'))}</h2><p>${this.escapeHtml(I18n.t('settings.subtitle', 'Choose how this file is displayed and saved.'))}</p></div>`;
        const closeText = this.escapeHtml(I18n.t('settings.close', 'Close'));
        html += `<button id="${cancelId}" class="settings-close-button" title="${closeText}" aria-label="${closeText}">&times;</button></div>`;
        html += '<div class="settings-layout"><nav class="settings-nav" role="tablist" aria-orientation="vertical">';
        Array.from(sections.keys()).forEach((section, index) => {
            const selected = index === 0;
            html += `<button class="settings-nav-item${selected ? ' active' : ''}" type="button" role="tab" aria-selected="${selected}" data-section-index="${index}">${this.escapeHtml(section)}</button>`;
        });
        html += '</nav><div class="settings-content">';
        Array.from(sections.entries()).forEach(([section, entries], index) => {
            const selected = index === 0;
            html += `<section class="settings-section${selected ? ' active' : ''}" role="tabpanel" data-section-index="${index}"><h3 class="settings-section-title" data-section-index="${index}">${this.escapeHtml(section)}</h3><div class="settings-section-items">`;
            entries.forEach(s => {
                const safeId = this.escapeHtml(s.id);
                const safeLabel = this.escapeHtml(s.label);
                const tooltip = s.tooltip && s.tooltip.trim().length > 0 ? s.tooltip : s.label;
                const safeDescription = this.escapeHtml(tooltip);
                const inputType = s.inputType === 'radio' ? 'radio' : s.inputType === 'number' ? 'number' : 'checkbox';
                const safeGroupName = this.escapeHtml(s.groupName || '');
                const safeValue = this.escapeHtml(s.value || '');
                const safeClassName = this.escapeHtml((s.className || '').trim());
                const groupAttr = inputType === 'radio' && safeGroupName ? ` name="${safeGroupName}"` : '';
                const valueAttr = inputType === 'radio' ? ` value="${safeValue}"` : '';
                const extraClass = safeClassName ? ` ${safeClassName}` : '';
                if (inputType === 'number') {
                    const numberAttrs = ` min="${s.min ?? 0}"${s.max !== undefined ? ` max="${s.max}"` : ''} step="${s.step ?? 1}" value="${typeof s.defaultValue === 'number' ? s.defaultValue : 0}"`;
                    html += `<label class="setting-item setting-number-item${extraClass}" for="${safeId}"><span class="setting-copy"><span class="setting-label">${safeLabel}</span><span class="setting-description">${safeDescription}</span></span><input type="number" id="${safeId}"${numberAttrs}/></label>`;
                } else {
                    const switchControl = inputType === 'checkbox' ? '<span class="setting-switch" aria-hidden="true"></span>' : '';
                    html += `<label class="setting-item setting-choice${extraClass}"><input type="${inputType}" id="${safeId}"${groupAttr}${valueAttr}/><span class="setting-copy"><span class="setting-label">${safeLabel}</span><span class="setting-description">${safeDescription}</span></span>${switchControl}</label>`;
                }
            });
            html += '</div></section>';
        });
        html += '</div></div>';
        
        panel.innerHTML = html;
        container.appendChild(panel);
    }

    updateTranslations(settings: SettingDefinition[]) {
        if (!this.panel) return;
        const sections = new Map<string, boolean>();
        settings.forEach(s => {
            sections.set(s.section || I18n.t('settings.general', 'General'), true);
            const input = this.panel!.querySelector(`#${s.id}`) as HTMLInputElement | null;
            if (input && input.parentElement) {
                const labelSpan = input.parentElement.querySelector('.setting-label') as HTMLSpanElement | null;
                if (labelSpan) labelSpan.textContent = s.label;
                const tip = input.parentElement.querySelector('.setting-description') as HTMLSpanElement | null;
                if (tip) tip.textContent = s.tooltip || s.label;
            }
        });
        const sectionNames = Array.from(sections.keys());
        this.panel.querySelectorAll('.settings-nav-item, .settings-section-title').forEach(element => {
            const index = Number((element as HTMLElement).dataset.sectionIndex);
            if (sectionNames[index]) element.textContent = sectionNames[index];
        });
        if (this.cancelBtn) {
            const closeText = I18n.t('settings.close', 'Close');
            this.cancelBtn.setAttribute('aria-label', closeText);
            this.cancelBtn.title = closeText;
        }
    }

    private init() {
        if (!this.openBtn || !this.panel) return;

        this.openBtn.addEventListener('click', () => {
            if (this.panel!.classList.contains('hidden')) {
                this.openPanel();
            } else {
                this.closePanel();
            }
        });

        if (this.cancelBtn) {
            this.cancelBtn.addEventListener('click', () => this.closePanel());
        }

        // Wire up settings
        this.settings.forEach(setting => {
            const el = document.getElementById(setting.id) as HTMLInputElement;
            if (el) {
                if (setting.defaultValue !== undefined) {
                    if (setting.inputType === 'number') {
                        el.value = String(setting.defaultValue);
                    } else {
                        el.checked = !!setting.defaultValue;
                    }
                }
                el.addEventListener('change', () => {
                    if (setting.inputType === 'number') {
                        setting.onChange(Number(el.value));
                    } else if (setting.inputType === 'radio') {
                        if (el.checked) {
                            setting.onChange(el.value);
                        }
                    } else {
                        setting.onChange(el.checked);
                    }
                });
            }
        });

        this.panel.querySelectorAll('.settings-nav-item').forEach(button => {
            button.addEventListener('click', () => {
                this.activateSection(Number((button as HTMLElement).dataset.sectionIndex));
            });
        });

        // Close on click outside
        document.addEventListener('click', (e) => {
            if (!this.panel!.classList.contains('hidden')) {
                if (!(e.target as HTMLElement).closest('.settings-panel') && 
                    !(e.target as HTMLElement).closest('#' + this.openBtn!.id)) {
                    this.closePanel();
                }
            }
        });
    }

    private repositionPanel() {
        const container = document.querySelector('.toolbar');
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const horizontalGutter = Math.min(24, Math.max(8, Math.floor((window.innerWidth - 280) / 2)));
        const verticalGutter = Math.min(24, Math.max(8, Math.floor((window.innerHeight - 120) / 2)));
        const availableWidth = Math.max(0, window.innerWidth - horizontalGutter * 2);
        const panelWidth = Math.min(720, Math.max(Math.min(280, availableWidth), rect.width), availableWidth);
        const panelMaxHeight = Math.min(680, Math.max(0, window.innerHeight - verticalGutter * 2));

        this.panel!.style.position = 'fixed';
        this.panel!.style.width = panelWidth + 'px';
        this.panel!.style.maxHeight = panelMaxHeight + 'px';
        this.panel!.style.height = 'auto';
        this.panel!.classList.toggle('settings-compact', panelWidth <= 620);
        const panelHeight = Math.min(this.panel!.getBoundingClientRect().height, panelMaxHeight);
        const left = Math.max(horizontalGutter, Math.min(rect.left, window.innerWidth - panelWidth - horizontalGutter));
        const belowTop = rect.bottom + verticalGutter;
        const aboveTop = rect.top - panelHeight - verticalGutter;
        const top = belowTop + panelHeight <= window.innerHeight - verticalGutter
            ? belowTop
            : aboveTop >= verticalGutter
                ? aboveTop
                : Math.max(verticalGutter, window.innerHeight - panelHeight - verticalGutter);

        this.panel!.style.height = panelHeight + 'px';
        this.panel!.style.left = left + 'px';
        this.panel!.style.top = top + 'px';
        this.panel!.style.right = 'auto';
        this.panel!.style.zIndex = '10001';
        
        if (this.onReposition) this.onReposition();
    }

    private activateSection(index: number) {
        if (!this.panel) return;
        this.panel.querySelectorAll('.settings-nav-item').forEach(button => {
            const selected = Number((button as HTMLElement).dataset.sectionIndex) === index;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', String(selected));
        });
        this.panel.querySelectorAll('.settings-section').forEach(section => {
            section.classList.toggle('active', Number((section as HTMLElement).dataset.sectionIndex) === index);
        });
        const content = this.panel.querySelector('.settings-content') as HTMLElement | null;
        if (content) content.scrollTop = 0;
        this.repositionPanel();
    }

    private openPanel() {
        // Save original parent so we can restore later
        if (!this.panelOriginalParent) {
            this.panelOriginalParent = this.panel!.parentNode;
            this.panelOriginalNext = this.panel!.nextSibling;
        }
        if (this.panel!.parentNode !== document.body) {
            document.body.appendChild(this.panel!);
        }

        this.panel!.classList.remove('hidden');
        this.panel!.classList.add('floating');
        this.panel!.setAttribute('aria-hidden', 'false');
        document.body.classList.add('settings-open');

        const container = document.querySelector('.toolbar');
        if (container) {
            container.classList.add('settings-open');
            // only expand the toolbar vertically when the toolbar is configured to be sticky
            // We check the body class for this state as it's usually managed by the consumer
            if (document.body.classList.contains('sticky-toolbar-enabled')) {
                container.classList.add('expanded-toolbar');
            }
        }

        this.repositionPanel();
        this.repositionHandlers = () => {
            this.repositionPanel();
        };
        window.addEventListener('resize', this.repositionHandlers);
        window.addEventListener('scroll', this.repositionHandlers, true);
    }

    private closePanel() {
        this.panel!.classList.add('hidden');
        this.panel!.classList.remove('floating');
        this.panel!.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('settings-open');

        const container = document.querySelector('.toolbar');
        if (container) {
            container.classList.remove('settings-open');
            // We can't easily know if sticky toolbar is disabled here without querying the checkbox
            // But usually the consumer handles the class removal on the container if needed
            // For safety, we remove expanded-toolbar if the body doesn't say it's enabled
            if (!document.body.classList.contains('sticky-toolbar-enabled')) {
                container.classList.remove('expanded-toolbar');
            }
        }

        this.panel!.style.position = '';
        this.panel!.style.left = '';
        this.panel!.style.top = '';
        this.panel!.style.width = '';
        this.panel!.style.height = '';
        this.panel!.style.maxHeight = '';
        this.panel!.style.right = '';
        this.panel!.style.zIndex = '';

        // Restore original parent/position
        if (this.panelOriginalParent && this.panelOriginalParent !== this.panel!.parentNode) {
            try {
                this.panelOriginalParent.insertBefore(this.panel!, this.panelOriginalNext);
            } catch (e) {
                this.panelOriginalParent.appendChild(this.panel!);
            }
        }

        if (this.repositionHandlers) {
            window.removeEventListener('resize', this.repositionHandlers);
            window.removeEventListener('scroll', this.repositionHandlers, true);
            this.repositionHandlers = null;
        }
    }
}
