/* eslint-disable @typescript-eslint/no-explicit-any */

declare function acquireVsCodeApi(): any;

export const vscode = (function () {
    if (typeof acquireVsCodeApi === 'function') {
        return acquireVsCodeApi();
    }
    return { postMessage: () => { } };
})();

export const VirtualScrollConfig = {
    ROW_HEIGHT: 28,
    BUFFER_ROWS: 40,
    CHUNK_SIZE: 100,
    PREFETCH_ROWS: 40
};

export function debounce(func: Function, wait: number) {
    let timeout: any;
    return function (this: any, ...args: any[]) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

export function throttleRAF(fn: () => void): () => void {
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
