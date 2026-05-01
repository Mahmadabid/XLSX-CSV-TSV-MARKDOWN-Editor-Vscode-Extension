export type BorderLineStyle =
    | 'thin'
    | 'medium'
    | 'thick'
    | 'dashed'
    | 'dotted'
    | 'double'
    | 'mediumDashed'
    | 'mediumDotted'
    | 'thickDashed'
    | 'thickDotted';

export type BorderThickness = 'thin' | 'medium' | 'thick';
export type BorderPattern = 'solid' | 'dashed' | 'dotted' | 'double';
export type BorderMode = 'all' | 'outside' | 'inner' | 'top' | 'bottom' | 'left' | 'right' | 'none';

export interface BorderLike {
    clear?: boolean;
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
}

export function borderStyleToCss(style: BorderLineStyle): { width: string; line: string } {
    const s = String(style || 'thin').toLowerCase();
    const rules = { width: '1px', line: 'solid' };

    if (s.includes('thick')) rules.width = '3px';
    else if (s.includes('medium')) rules.width = '2px';
    else rules.width = '1px';

    if (s === 'double') {
        rules.line = 'double';
        rules.width = '3px';
    } else if (s.includes('dash')) {
        rules.line = 'dashed';
    } else if (s.includes('dot')) {
        rules.line = 'dotted';
    }

    return rules;
}

export function buildBorderCss(enabled: boolean, style: BorderLineStyle, color: string): string {
    if (!enabled) return '';
    const css = borderStyleToCss(style);
    return `${css.width} ${css.line} ${color}`;
}

export function composeBorderLineStyle(thickness: BorderThickness, pattern: BorderPattern): BorderLineStyle {
    if (pattern === 'solid') {
        return thickness;
    }

    if (pattern === 'double') {
        return 'double';
    }

    if (pattern === 'dashed') {
        if (thickness === 'thick') return 'thickDashed';
        if (thickness === 'medium') return 'mediumDashed';
        return 'dashed';
    }

    if (thickness === 'thick') return 'thickDotted';
    if (thickness === 'medium') return 'mediumDotted';
    return 'dotted';
}

export function decomposeBorderLineStyle(style: BorderLineStyle): { thickness: BorderThickness; pattern: BorderPattern } {
    const s = style.toLowerCase();

    const thickness: BorderThickness = s.includes('thick')
        ? 'thick'
        : s.includes('medium')
            ? 'medium'
            : 'thin';

    const pattern: BorderPattern = s === 'double'
        ? 'double'
        : s.includes('dash')
            ? 'dashed'
            : s.includes('dot')
                ? 'dotted'
                : 'solid';

    return { thickness, pattern };
}

export function inferBorderLineStyleFromCss(cssStyle: string, cssWidth: string): BorderLineStyle {
    const line = String(cssStyle || '').toLowerCase();
    const width = parseFloat(cssWidth || '1') || 1;

    if (line === 'double') return 'double';

    if (line === 'dashed') {
        if (width >= 3) return 'thickDashed';
        if (width >= 2) return 'mediumDashed';
        return 'dashed';
    }

    if (line === 'dotted') {
        if (width >= 3) return 'thickDotted';
        if (width >= 2) return 'mediumDotted';
        return 'dotted';
    }

    if (width >= 3) return 'thick';
    if (width >= 2) return 'medium';
    return 'thin';
}

export function inferBorderModeFromStyle(border: BorderLike | undefined, fallbackMode: BorderMode = 'all'): BorderMode {
    if (!border || border.clear) return 'none';

    const t = !!border.top;
    const r = !!border.right;
    const b = !!border.bottom;
    const l = !!border.left;

    if (t && r && b && l) return 'all';

    const enabledCount = [t, r, b, l].filter(Boolean).length;
    if (enabledCount === 1) {
        if (t) return 'top';
        if (r) return 'right';
        if (b) return 'bottom';
        return 'left';
    }

    if (enabledCount === 0) return 'none';
    return fallbackMode === 'none' ? 'all' : fallbackMode;
}

export function getActiveBorderModes(border?: BorderLike): Set<BorderMode> {
    const modes = new Set<BorderMode>();
    if (!border || border.clear) {
        modes.add('none');
        return modes;
    }

    const t = !!border.top;
    const r = !!border.right;
    const b = !!border.bottom;
    const l = !!border.left;

    if (t) modes.add('top');
    if (r) modes.add('right');
    if (b) modes.add('bottom');
    if (l) modes.add('left');

    if (t && r && b && l) {
        modes.add('all');
        modes.add('outside');
        modes.add('inner');
    }

    if (!modes.size) {
        modes.add('none');
    }

    return modes;
}
