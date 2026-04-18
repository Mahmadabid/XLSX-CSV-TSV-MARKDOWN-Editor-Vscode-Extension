
export interface ToolbarButton {
    id: string;
    icon: string; // SVG string
    label?: string;
    tooltip: string;
    onClick: () => void;
    enabled?: boolean;
    hidden?: boolean;
    cls?: string; // Extra classes
}

export class ToolbarManager {
    private container: HTMLElement;
    private buttons: Map<string, HTMLButtonElement> = new Map();
    private resizeObserver: ResizeObserver | null = null;
    private isSticky: boolean = false;

    constructor(containerId: string) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error(`Toolbar container ${containerId} not found`); 
        this.container = el;
    }

    applyStickyLayout(stickyToolbar: boolean, contentId: string = 'content', scrollQuery: string = '.table-scroll') {
        this.isSticky = stickyToolbar;
        const container = this.container;
        const wrapper = container.parentElement && container.parentElement.classList.contains('toolbar-wrapper')
            ? container.parentElement as HTMLElement
            : null;
        const layoutHost = wrapper || container;
        const content = document.getElementById(contentId);
        const scrollArea = document.querySelector(scrollQuery);
        const headerBg = document.querySelector('.header-background') as HTMLElement | null;

        container.classList.remove('hidden');
        container.style.removeProperty('display');
        if (!container.style.display) {
            container.style.display = 'flex';
        }

        if (stickyToolbar) {
            document.body.classList.add('sticky-toolbar-enabled');
            if (layoutHost.parentNode !== document.body) {
                if (content && content.parentNode === document.body) {
                    document.body.insertBefore(layoutHost, content);
                } else if (document.body.firstChild) {
                    document.body.insertBefore(layoutHost, document.body.firstChild);
                } else {
                    document.body.appendChild(layoutHost);
                }
            }
            container.classList.remove('not-sticky');
            container.classList.add('expanded-toolbar');
            if (headerBg) headerBg.style.display = '';

            if (!this.resizeObserver) {
                this.resizeObserver = new ResizeObserver(() => this.updateHeaderHeight());
                this.resizeObserver.observe(container);
            }
        } else {
            document.body.classList.remove('sticky-toolbar-enabled');
            const targetParent = content || document.body;
            const scrollElement = scrollArea instanceof HTMLElement ? scrollArea : null;
            if (targetParent) {
                if (scrollElement && scrollElement.parentElement === targetParent) {
                    if (layoutHost.parentNode !== targetParent || layoutHost.nextSibling !== scrollElement) {
                        targetParent.insertBefore(layoutHost, scrollElement);
                    }
                } else if (layoutHost.parentNode !== targetParent) {
                    targetParent.insertBefore(layoutHost, targetParent.firstChild);
                }
            }
            container.classList.add('not-sticky');
            container.classList.remove('expanded-toolbar');
            if (headerBg) headerBg.style.display = 'none';

            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
                this.resizeObserver = null;
            }
        }
        this.updateHeaderHeight();
    }

    updateHeaderHeight() {
        const headerBg = document.querySelector('.header-background') as HTMLElement | null;

        if (!this.isSticky) {
            document.documentElement.style.setProperty('--header-height', '0px');
            if (headerBg) headerBg.style.height = '';
            return;
        }

        let height = Math.max(6, Math.ceil(this.container.getBoundingClientRect().height));
        const maxHeightStr = getComputedStyle(document.documentElement).getPropertyValue('--header-height-max');
        const maxHeight = parseInt(maxHeightStr, 10) || 96;
        height = Math.min(height, maxHeight);

        document.documentElement.style.setProperty('--header-height', height + 'px');

        if (headerBg) {
            headerBg.style.height = height + 'px';
        }
    }

    setButtons(buttons: ToolbarButton[]) {
        this.container.innerHTML = '';
        this.buttons.clear();
        buttons.forEach(btn => this.addButton(btn));
    }

    addButton(btn: ToolbarButton) {
        const wrapper = document.createElement('div');
        wrapper.className = `tooltip ${btn.cls || ''}`;
        if (btn.hidden) wrapper.classList.add('hidden');

        const buttonEl = document.createElement('button');
        buttonEl.id = btn.id;
        buttonEl.className = `toggle-button`;
        if (btn.enabled === false) buttonEl.disabled = true;
        
        const tooltipText = document.createElement('span');
        tooltipText.className = 'tooltiptext';
        tooltipText.innerHTML = btn.tooltip;

        if (btn.icon.trim().startsWith('<svg')) {
            buttonEl.innerHTML = btn.icon;
        } else {
            buttonEl.innerHTML = btn.icon;
        }

        if (btn.label) {
            const labelSpan = document.createElement('span');
            labelSpan.className = 'btn-label';
            labelSpan.textContent = btn.label;
            buttonEl.appendChild(document.createTextNode(' '));
            buttonEl.appendChild(labelSpan);
        }

        buttonEl.addEventListener('click', () => {
            btn.onClick();
        });

        wrapper.appendChild(buttonEl);
        wrapper.appendChild(tooltipText);
        this.container.appendChild(wrapper);
        this.buttons.set(btn.id, buttonEl);
    }

    setButtonEnabled(id: string, enabled: boolean) {
        const btn = this.buttons.get(id);
        if (btn) btn.disabled = !enabled;
    }

    setButtonVisibility(id: string, visible: boolean) {
        const btn = this.buttons.get(id);
        if (btn) {
            const wrapper = btn.closest('.tooltip');
            const target = wrapper || btn;
            if (visible) target.classList.remove('hidden');
            else target.classList.add('hidden');
        }
    }

    setButtonTooltip(id: string, tooltip: string) {
        const btn = this.buttons.get(id);
        if (btn) {
            const wrapper = btn.closest('.tooltip');
            if (wrapper) {
                const tip = wrapper.querySelector('.tooltiptext');
                if (tip) tip.innerHTML = tooltip;
            } else {
                btn.title = tooltip;
            }
        }
    }

    setButtonsEnabled(enabled: boolean) {
        this.buttons.forEach(btn => {
            btn.disabled = !enabled;
        });
    }
    
    getButton(id: string): HTMLButtonElement | undefined {
        return this.buttons.get(id);
    }

    prependElement(element: HTMLElement) {
        if (this.container.firstChild) {
            this.container.insertBefore(element, this.container.firstChild);
        } else {
            this.container.appendChild(element);
        }
    }
}
