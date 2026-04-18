/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ThemeManagerOptions {
    persistKey?: string;
    onBeforeCycle?: () => boolean | void;
}

export class ThemeManager {
    private button: HTMLElement | null;
    private vscodeApi: any;
    private options: ThemeManagerOptions;
    private themes: Array<'light' | 'dark' | 'vscode'>;
    private selectedIconOnLeft: boolean = true;

    constructor(buttonId: string, options: ThemeManagerOptions = {}, vscodeApi: any = null) {
        this.button = document.getElementById(buttonId);
        this.vscodeApi = vscodeApi;
        this.options = {
            persistKey: 'last_used_theme',
            ...options
        };
        this.themes = ['vscode', 'light', 'dark'];

        this.init();
    }

    private init() {
        if (!this.button) {
            return;
        }

        this.button.classList.add('theme-toggle-pill');
        this.button.classList.remove('theme-pill-animating');

        // Listen for theme messages from VS Code so vscode-theme mode follows host changes.
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg && msg.type === 'setTheme') {
                this.handleVsCodeThemeChange(msg.kind);
            }
        });

        this.button.addEventListener('click', () => {
            if (typeof this.options.onBeforeCycle === 'function' && this.options.onBeforeCycle() === false) {
                return;
            }
            this.cycleTheme();
        });

        this.applyTheme(this.getStoredTheme(), false);
    }

    private normalizeTheme(value: string): 'light' | 'dark' | 'vscode' {
        if (value === 'dark' || value === 'light' || value === 'vscode') {
            return value;
        }
        return 'vscode';
    }

    private getStoredTheme(): 'light' | 'dark' | 'vscode' {
        if (this.vscodeApi && typeof this.vscodeApi.getState === 'function') {
            const state = this.vscodeApi.getState();
            if (state && typeof state.theme === 'string') {
                return this.normalizeTheme(state.theme);
            }
        }

        try {
            const lastUsed = localStorage.getItem(this.options.persistKey!);
            if (lastUsed) {
                return this.normalizeTheme(lastUsed);
            }
        } catch {
            // ignore
        }

        return 'vscode';
    }

    private setStoredTheme(theme: 'light' | 'dark' | 'vscode') {
        if (this.vscodeApi && typeof this.vscodeApi.getState === 'function') {
            const state = this.vscodeApi.getState() || {};
            state.theme = theme;
            this.vscodeApi.setState(state);
        }

        try {
            localStorage.setItem(this.options.persistKey!, theme);
        } catch {
            // ignore
        }
    }

    private applyTheme(theme: 'light' | 'dark' | 'vscode', save = true) {
        document.body.classList.remove('dark-mode', 'vscode-theme');

        if (theme === 'dark') {
            document.body.classList.add('dark-mode');
        } else if (theme === 'vscode') {
            document.body.classList.add('vscode-theme');
        }

        if (save) {
            this.setStoredTheme(theme);
        }

        this.updateIcons(theme);
    }

    private cycleTheme() {
        if (!this.button) {
            return;
        }

        const current = this.getStoredTheme();
        const currentIndex = this.themes.indexOf(current);
        const next = this.themes[(currentIndex + 1) % this.themes.length];
        this.selectedIconOnLeft = !this.selectedIconOnLeft;

        this.applyTheme(next);
    }

    private updateIcons(currentTheme: 'light' | 'dark' | 'vscode') {
        if (!this.button) {
            return;
        }

        const currentIndex = this.themes.indexOf(currentTheme);
        const nextIndex = (currentIndex + 1) % this.themes.length;
        const nextTheme = this.themes[nextIndex];
        const secondaryTheme = nextTheme;

        const icons = {
            light: document.getElementById('lightIcon'),
            dark: document.getElementById('darkIcon'),
            vscode: document.getElementById('vscodeIcon')
        };

        Object.values(icons).forEach(icon => {
            if (icon) {
                (icon as HTMLElement).style.display = 'none';
                (icon as HTMLElement).classList.remove(
                    'theme-icon-current',
                    'theme-icon-next',
                    'theme-icon-selected',
                    'theme-icon-secondary',
                    'theme-slot-left',
                    'theme-slot-right'
                );
            }
        });

        const currentIcon = icons[currentTheme];
        if (currentIcon) {
            (currentIcon as HTMLElement).style.display = 'block';
            (currentIcon as HTMLElement).classList.add(
                'theme-icon-current',
                'theme-icon-selected',
                this.selectedIconOnLeft ? 'theme-slot-left' : 'theme-slot-right'
            );
        }

        const secondaryIcon = icons[secondaryTheme];
        if (secondaryIcon) {
            (secondaryIcon as HTMLElement).style.display = 'block';
            (secondaryIcon as HTMLElement).classList.add(
                'theme-icon-next',
                'theme-icon-secondary',
                this.selectedIconOnLeft ? 'theme-slot-right' : 'theme-slot-left'
            );
        }

        this.button.setAttribute('data-current-theme', currentTheme);
        this.button.setAttribute('data-next-theme', nextTheme);
        this.button.setAttribute('data-selected-side', this.selectedIconOnLeft ? 'left' : 'right');

        const label = nextTheme === 'vscode' ? 'VS Code' : (nextTheme === 'dark' ? 'Dark' : 'Light');
        const tooltipText = `Switch to <b>${label} theme</b>`;
        const wrapper = this.button.closest('.tooltip');
        if (wrapper) {
            const tip = wrapper.querySelector('.tooltiptext');
            if (tip) {
                tip.innerHTML = tooltipText;
            }
        } else {
            this.button.title = `Switch to ${label} theme`;
        }
    }

    private handleVsCodeThemeChange(_kind: number) {
        if (this.getStoredTheme() === 'vscode') {
            this.applyTheme('vscode', false);
        }
    }
}
