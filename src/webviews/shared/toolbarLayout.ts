import { ToolbarManager } from './toolbarManager';

export interface ToolbarLayoutOptions {
    stickyToolbar: boolean;
    forceSticky?: boolean;
    contentId?: string;
    scrollTarget?: string;
    onLayoutApplied?: () => void;
}

export function applyToolbarLayout(toolbarManager: ToolbarManager | null, options: ToolbarLayoutOptions): boolean {
    const effectiveSticky = options.forceSticky ? true : !!options.stickyToolbar;
    const contentId = options.contentId || 'content';
    const scrollTarget = options.scrollTarget || '#content';

    if (toolbarManager) {
        toolbarManager.applyStickyLayout(effectiveSticky, contentId, scrollTarget);
        setTimeout(() => toolbarManager.updateHeaderHeight(), 0);
    } else {
        document.body.classList.toggle('sticky-toolbar-enabled', effectiveSticky);
    }

    if (options.onLayoutApplied) {
        options.onLayoutApplied();
    }

    return effectiveSticky;
}
