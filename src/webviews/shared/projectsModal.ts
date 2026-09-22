import { vscode } from './common';
import { Icons } from './icons';

const OPENPART_LOGO_B64 = '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';

interface OpenSourceProject {
    name: string;
    url: string;
    tag: string;
    color: string;
    bg: string;
    description: string;
    iconHtml: string;
}

const PROJECTS: OpenSourceProject[] = [
    {
        name: 'OpenPart',
        url: 'https://github.com/Mahmadabid/OpenPart',
        tag: 'Rust • Windows',
        color: '#00ffa6',
        bg: 'rgba(0, 255, 166, 0.1)',
        description: 'Fast, open-source Windows partition manager built in Rust with plan-before-write safety and modern GUI/CLI.',
        iconHtml: `<img src="data:image/png;base64,${OPENPART_LOGO_B64}" width="40" height="40" style="border-radius: 8px; flex-shrink: 0; display: block; object-fit: cover; background: #0f172a;" alt="OpenPart Logo" />`
    },
    {
        name: 'vibed-puppet',
        url: 'https://github.com/Mahmadabid/vibed-puppet',
        tag: 'TypeScript • Automation',
        color: '#00ffa6',
        bg: 'rgba(0, 255, 166, 0.1)',
        description: 'Free browser automation toolkit for selective X/Twitter history cleanup and Google Form field extraction.',
        iconHtml: `<svg viewBox="0 0 256 256" width="40" height="40" xmlns="http://www.w3.org/2000/svg" style="border-radius: 8px; flex-shrink: 0; display: block;">
            <rect width="256" height="256" rx="40" fill="#0f172a"/>
            <g stroke="#00ffa6" stroke-width="5" stroke-linecap="round">
                <line x1="40" y1="80" x2="216" y2="80"/>
                <line x1="40" y1="128" x2="216" y2="128"/>
                <line x1="40" y1="176" x2="216" y2="176"/>
            </g>
            <g fill="#00ffa6">
                <circle cx="80" cy="80" r="7"/>
                <circle cx="140" cy="128" r="7"/>
                <circle cx="200" cy="176" r="7"/>
            </g>
        </svg>`
    }
];

export class ProjectsModal {
    private static isInitialized = false;
    private static container: HTMLElement | null = null;
    private static overlay: HTMLElement | null = null;

    public static initialize() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.overlay = document.createElement('div');
        this.overlay.className = 'feedback-overlay hidden';
        document.body.appendChild(this.overlay);

        const projectCardsHtml = PROJECTS.map(p => `
            <div class="project-card" data-url="${p.url}" data-color="${p.color}" style="border: 1px solid var(--border-color); border-radius: 10px; padding: 14px 16px; display: flex; align-items: center; gap: 14px; transition: all 0.2s ease; cursor: pointer; background: var(--bg-color); text-decoration: none;">
                <div class="project-card-icon" style="width: 42px; height: 42px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);">
                    ${p.iconHtml}
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <span style="font-weight: 600; font-size: 14.5px; color: var(--text-color);">${p.name}</span>
                        <span style="font-size: 11.5px; font-weight: 500; color: ${p.color}; padding: 2px 8px; border-radius: 10px; border: 1px solid color-mix(in srgb, ${p.color} 30%, transparent); background: ${p.bg}; white-space: nowrap;">${p.tag}</span>
                    </div>
                    <p style="margin: 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.45;">
                        ${p.description}
                    </p>
                </div>
                <div class="project-card-arrow" style="color: var(--text-muted); transition: all 0.2s ease; display: flex; align-items: center; flex-shrink: 0;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                    </svg>
                </div>
            </div>
        `).join('');

        this.container = document.createElement('div');
        this.container.className = 'feedback-modal hidden';
        this.container.innerHTML = `
            <div class="feedback-header">
                <h2>Other Open Source Projects</h2>
                <button class="feedback-close" title="Close">${Icons.Cancel}</button>
            </div>
            <div class="feedback-body" style="display: flex; flex-direction: column; gap: 12px; padding: 20px 24px 28px 24px; max-height: 72vh; overflow-y: auto;">
                <p style="margin: 0 0 4px 0; font-size: 13px; color: var(--text-muted); line-height: 1.5;">
                    Check out some of my other open-source projects on GitHub:
                </p>
                ${projectCardsHtml}
            </div>
        `;
        document.body.appendChild(this.container);

        this.bindEvents();
    }

    private static bindEvents() {
        const closeBtn = this.container?.querySelector('.feedback-close');
        const overlay = this.overlay;

        const close = () => this.hide();
        closeBtn?.addEventListener('click', close);
        overlay?.addEventListener('click', close);

        const cards = this.container?.querySelectorAll('.project-card');
        if (cards) {
            cards.forEach(card => {
                const el = card as HTMLElement;
                const color = el.getAttribute('data-color') || 'var(--accent-color)';
                const url = el.getAttribute('data-url');
                const arrow = el.querySelector('.project-card-arrow') as HTMLElement | null;

                el.addEventListener('mouseenter', () => {
                    el.style.borderColor = color;
                    el.style.transform = 'translateY(-2px)';
                    el.style.boxShadow = `0 6px 16px color-mix(in srgb, ${color} 20%, transparent)`;
                    if (arrow) {
                        arrow.style.color = color;
                        arrow.style.transform = 'translate(2px, -2px)';
                    }
                });
                el.addEventListener('mouseleave', () => {
                    el.style.borderColor = 'var(--border-color)';
                    el.style.transform = 'none';
                    el.style.boxShadow = 'none';
                    if (arrow) {
                        arrow.style.color = 'var(--text-muted)';
                        arrow.style.transform = 'none';
                    }
                });
                el.addEventListener('click', () => {
                    this.hide();
                    if (url) {
                        vscode.postMessage({
                            command: 'openExternal',
                            url
                        });
                    }
                });
            });
        }
    }

    public static show() {
        if (!this.isInitialized) {
            this.initialize();
        }

        this.overlay?.classList.remove('hidden');
        this.container?.classList.remove('hidden');

        setTimeout(() => {
            this.overlay?.classList.add('active');
            this.container?.classList.add('active');
        }, 10);
    }

    public static hide() {
        this.overlay?.classList.remove('active');
        this.container?.classList.remove('active');

        setTimeout(() => {
            this.overlay?.classList.add('hidden');
            this.container?.classList.add('hidden');
        }, 300);
    }
}
