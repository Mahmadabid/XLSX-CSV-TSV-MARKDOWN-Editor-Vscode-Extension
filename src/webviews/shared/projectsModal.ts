import { vscode } from './common';
import { Icons } from './icons';

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

        this.container = document.createElement('div');
        this.container.className = 'feedback-modal hidden';
        this.container.innerHTML = `
            <div class="feedback-header">
                <h2>Other Open Source Projects</h2>
                <button class="feedback-close" title="Close">${Icons.Cancel}</button>
            </div>
            <div class="feedback-body" style="gap: 16px; padding: 24px 32px 32px 32px;">
                <p style="margin: 0; font-size: 13.5px; color: var(--text-muted); line-height: 1.5;">
                    Check out some of my other open-source projects on GitHub:
                </p>
                
                <div class="project-card" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 8px; transition: all 0.2s; cursor: pointer; background: var(--bg-color);">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-weight: 600; font-size: 15px; color: var(--text-color);">openpart</span>
                        <span style="font-size: 12px; color: var(--text-muted); padding: 2px 8px; border-radius: 12px; border: 1px solid var(--border-color); background: var(--code-bg);">GitHub</span>
                    </div>
                    <p style="margin: 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.4;">
                        Visit the openpart repository.
                    </p>
                </div>

                <div class="project-card" style="border: 1px solid var(--border-color); border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 8px; transition: all 0.2s; cursor: pointer; background: var(--bg-color);">
                    <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-weight: 600; font-size: 15px; color: var(--text-color);">vibed-puppet</span>
                        <span style="font-size: 12px; color: var(--text-muted); padding: 2px 8px; border-radius: 12px; border: 1px solid var(--border-color); background: var(--code-bg);">GitHub</span>
                    </div>
                    <p style="margin: 0; font-size: 12.5px; color: var(--text-muted); line-height: 1.4;">
                        Visit the vibed-puppet repository.
                    </p>
                </div>
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
            cards.forEach((card, index) => {
                card.addEventListener('mouseenter', () => {
                    (card as HTMLElement).style.borderColor = 'var(--accent-color)';
                    (card as HTMLElement).style.background = 'var(--hover-bg)';
                });
                card.addEventListener('mouseleave', () => {
                    (card as HTMLElement).style.borderColor = 'var(--border-color)';
                    (card as HTMLElement).style.background = 'var(--bg-color)';
                });
                card.addEventListener('click', () => {
                    this.hide();
                    const url = index === 0 
                        ? 'https://github.com/Mahmadabid/openpart'
                        : 'https://github.com/Mahmadabid/vibed-puppet';
                    vscode.postMessage({
                        command: 'openExternal',
                        url
                    });
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
