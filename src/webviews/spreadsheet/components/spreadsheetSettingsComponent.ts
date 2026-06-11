import { SettingDefinition } from '../../shared/settingsManager';

export interface XlsxViewSettings {
    firstRowIsHeader: boolean;
    stickyToolbar: boolean;
    stickyHeader: boolean;
    autoSave: boolean;
    autoSaveMode: 'all' | 'controlsOnly';
    showManualSavePopup: boolean;
    allowInteractiveControlsOutsideEditMode: boolean;
    hyperlinkPreview: boolean;
    spaciousCells: boolean;
    mergeWarningEnabled: boolean;
    isDefaultEditor?: boolean;
    textWrap: boolean;
}

export const defaultXlsxViewSettings: XlsxViewSettings = {
    firstRowIsHeader: true,
    stickyToolbar: true,
    stickyHeader: false,
    autoSave: false,
    autoSaveMode: 'all',
    showManualSavePopup: true,
    allowInteractiveControlsOutsideEditMode: true,
    hyperlinkPreview: true,
    spaciousCells: false,
    mergeWarningEnabled: true,
    isDefaultEditor: true,
    textWrap: false
};

export function normalizeXlsxSettings(next: any, previous: XlsxViewSettings): XlsxViewSettings {
    const normalized: XlsxViewSettings = {
        firstRowIsHeader: next && typeof next.firstRowIsHeader === 'boolean' ? next.firstRowIsHeader : previous.firstRowIsHeader,
        stickyToolbar: next && typeof next.stickyToolbar === 'boolean' ? next.stickyToolbar : previous.stickyToolbar,
        stickyHeader: next && typeof next.stickyHeader === 'boolean' ? next.stickyHeader : previous.stickyHeader,
        autoSave: next && typeof next.autoSave === 'boolean' ? next.autoSave : previous.autoSave,
        autoSaveMode: next && (next.autoSaveMode === 'all' || next.autoSaveMode === 'controlsOnly') ? next.autoSaveMode : previous.autoSaveMode,
        showManualSavePopup: next && typeof next.showManualSavePopup === 'boolean' ? next.showManualSavePopup : previous.showManualSavePopup,
        allowInteractiveControlsOutsideEditMode: next && typeof next.allowInteractiveControlsOutsideEditMode === 'boolean' ? next.allowInteractiveControlsOutsideEditMode : previous.allowInteractiveControlsOutsideEditMode,
        hyperlinkPreview: next && typeof next.hyperlinkPreview === 'boolean' ? next.hyperlinkPreview : previous.hyperlinkPreview,
        spaciousCells: next && typeof next.spaciousCells === 'boolean' ? next.spaciousCells : previous.spaciousCells,
        mergeWarningEnabled: next && typeof next.mergeWarningEnabled === 'boolean' ? next.mergeWarningEnabled : previous.mergeWarningEnabled,
        isDefaultEditor: next && typeof next.isDefaultEditor === 'boolean' ? next.isDefaultEditor : previous.isDefaultEditor,
        textWrap: next && typeof next.textWrap === 'boolean' ? next.textWrap : previous.textWrap
    };

    if (!normalized.firstRowIsHeader) {
        normalized.stickyHeader = false;
    }

    return normalized;
}

export function syncSettingsCheckboxes(settings: XlsxViewSettings): void {
    const chkHeader = document.getElementById('chkHeaderRow') as HTMLInputElement | null;
    const chkSticky = document.getElementById('chkStickyHeader') as HTMLInputElement | null;
    const chkToolbar = document.getElementById('chkStickyToolbar') as HTMLInputElement | null;
    const chkAutoSave = document.getElementById('chkAutoSave') as HTMLInputElement | null;
    const radioAutoSaveAll = document.getElementById('radioAutoSaveAll') as HTMLInputElement | null;
    const radioAutoSaveControlsOnly = document.getElementById('radioAutoSaveControlsOnly') as HTMLInputElement | null;
    const chkManualSavePopup = document.getElementById('chkShowManualSavePopup') as HTMLInputElement | null;
    const chkOutsideControls = document.getElementById('chkAllowInteractiveControlsOutsideEditMode') as HTMLInputElement | null;
    const chkHyperlink = document.getElementById('chkHyperlinkPreview') as HTMLInputElement | null;
    const chkSpacious = document.getElementById('chkSpaciousCells') as HTMLInputElement | null;
    const chkTextWrap = document.getElementById('chkTextWrap') as HTMLInputElement | null;
    const chkMergeWarning = document.getElementById('chkMergeWarningEnabled') as HTMLInputElement | null;

    if (chkHeader) chkHeader.checked = !!settings.firstRowIsHeader;
    if (chkSticky) {
        chkSticky.checked = !!settings.stickyHeader;
        chkSticky.disabled = !settings.firstRowIsHeader;
        if (chkSticky.parentElement) {
            chkSticky.parentElement.style.opacity = !settings.firstRowIsHeader ? '0.5' : '1';
            chkSticky.parentElement.style.pointerEvents = !settings.firstRowIsHeader ? 'none' : 'auto';
        }
    }
    if (chkToolbar) chkToolbar.checked = !!settings.stickyToolbar;
    if (chkAutoSave) chkAutoSave.checked = !!settings.autoSave;
    if (radioAutoSaveAll) radioAutoSaveAll.checked = settings.autoSaveMode !== 'controlsOnly';
    if (radioAutoSaveControlsOnly) radioAutoSaveControlsOnly.checked = settings.autoSaveMode === 'controlsOnly';
    if (chkManualSavePopup) chkManualSavePopup.checked = !!settings.showManualSavePopup;
    if (chkOutsideControls) chkOutsideControls.checked = !!settings.allowInteractiveControlsOutsideEditMode;
    if (chkHyperlink) chkHyperlink.checked = !!settings.hyperlinkPreview;
    if (chkSpacious) chkSpacious.checked = !!settings.spaciousCells;
    if (chkTextWrap) chkTextWrap.checked = !!settings.textWrap;
    if (chkMergeWarning) chkMergeWarning.checked = !!settings.mergeWarningEnabled;

    const autoSaveEnabled = !!settings.autoSave;
    const manualSaveItem = chkManualSavePopup?.closest('.setting-item') as HTMLElement | null;
    const autoSaveAllItem = radioAutoSaveAll?.closest('.setting-item') as HTMLElement | null;
    const autoSaveControlsItem = radioAutoSaveControlsOnly?.closest('.setting-item') as HTMLElement | null;

    if (manualSaveItem) {
        manualSaveItem.style.display = autoSaveEnabled ? 'none' : 'inline-flex';
    }
    if (autoSaveAllItem) {
        autoSaveAllItem.style.display = autoSaveEnabled ? 'inline-flex' : 'none';
    }
    if (autoSaveControlsItem) {
        autoSaveControlsItem.style.display = autoSaveEnabled ? 'inline-flex' : 'none';
    }
}

export function createXlsxSettingsDefinitions(
    getSettings: () => XlsxViewSettings,
    onApply: (next: XlsxViewSettings) => void,
    onPersist: () => void
): SettingDefinition[] {
    const applyAndPersist = (patch: Partial<XlsxViewSettings>) => {
        const settings = getSettings();
        const next: XlsxViewSettings = {
            ...settings,
            ...patch
        };

        if (!next.firstRowIsHeader) {
            next.stickyHeader = false;
        }

        onApply(next);
        onPersist();
    };

    return [
        {
            id: 'chkHeaderRow',
            label: 'Header Row',
            tooltip: 'Treat the first worksheet row as a header row.',
            onChange: (val: boolean) => {
                const settings = getSettings();
                applyAndPersist({
                    firstRowIsHeader: val,
                    stickyHeader: val ? settings.stickyHeader : false
                });
            },
            defaultValue: getSettings().firstRowIsHeader
        },
        {
            id: 'chkStickyHeader',
            label: 'Sticky Header',
            tooltip: 'Keep the header row visible while scrolling vertically.',
            onChange: (val: boolean) => {
                const settings = getSettings();
                applyAndPersist({ stickyHeader: settings.firstRowIsHeader ? val : false });
            },
            defaultValue: getSettings().stickyHeader
        },
        {
            id: 'chkStickyToolbar',
            label: 'Sticky Toolbar',
            tooltip: 'Keep the top toolbar pinned while scrolling the worksheet.',
            onChange: (val: boolean) => {
                applyAndPersist({ stickyToolbar: val });
            },
            defaultValue: getSettings().stickyToolbar
        },
        {
            id: 'chkAllowInteractiveControlsOutsideEditMode',
            label: 'Edit Checkbox/Dropdown Without Edit Mode',
            tooltip: 'Allow checkbox toggles and dropdown selection without entering table edit mode.',
            onChange: (val: boolean) => {
                applyAndPersist({ allowInteractiveControlsOutsideEditMode: val });
            },
            defaultValue: getSettings().allowInteractiveControlsOutsideEditMode
        },
        {
            id: 'chkHyperlinkPreview',
            label: 'Hyperlink Preview',
            tooltip: 'Show hover actions for hyperlinks, including Open in browser and Copy link.',
            onChange: (val: boolean) => {
                applyAndPersist({ hyperlinkPreview: val });
            },
            defaultValue: getSettings().hyperlinkPreview
        },
        {
            id: 'chkSpaciousCells',
            label: 'Spacious Cells',
            tooltip: 'Increase row height and padding for better readability.',
            onChange: (val: boolean) => {
                applyAndPersist({ spaciousCells: val });
            },
            defaultValue: getSettings().spaciousCells
        },
        {
            id: 'chkTextWrap',
            label: 'Text Wrap',
            tooltip: 'Enable text wrapping in cells by default.',
            onChange: (val: boolean) => {
                applyAndPersist({ textWrap: val });
            },
            defaultValue: getSettings().textWrap
        },
        {
            id: 'chkMergeWarningEnabled',
            label: 'Merge Warning Popup',
            tooltip: 'Ask for confirmation before merging cells because only the top-left value is preserved.',
            onChange: (val: boolean) => {
                applyAndPersist({ mergeWarningEnabled: val });
            },
            defaultValue: getSettings().mergeWarningEnabled
        },
        {
            id: 'chkAutoSave',
            label: 'Autosave',
            tooltip: 'Automatically save edits shortly after text, checkbox, dropdown, or formatting changes.',
            onChange: (val: boolean) => {
                applyAndPersist({ autoSave: val });
            },
            defaultValue: getSettings().autoSave
        },
        {
            id: 'radioAutoSaveAll',
            label: 'Autosave all changes',
            tooltip: 'Autosave any pending worksheet edits, including text, formatting, and structure operations.',
            className: 'setting-dependent setting-autosave-dependent',
            inputType: 'radio',
            groupName: 'xlsxAutoSaveMode',
            value: 'all',
            onChange: (val: string) => {
                applyAndPersist({ autoSaveMode: val === 'controlsOnly' ? 'controlsOnly' : 'all' });
            },
            defaultValue: getSettings().autoSaveMode === 'all'
        },
        {
            id: 'radioAutoSaveControlsOnly',
            label: 'Autosave only checkbox/dropdown',
            tooltip: 'Autosave triggers only from checkbox or dropdown changes.',
            className: 'setting-dependent setting-autosave-dependent',
            inputType: 'radio',
            groupName: 'xlsxAutoSaveMode',
            value: 'controlsOnly',
            onChange: (val: string) => {
                applyAndPersist({ autoSaveMode: val === 'controlsOnly' ? 'controlsOnly' : 'all' });
            },
            defaultValue: getSettings().autoSaveMode === 'controlsOnly'
        },
        {
            id: 'chkShowManualSavePopup',
            label: 'Manual Save Popup (Autosave Off)',
            tooltip: 'When Autosave is off, show a short reminder popup to save manually after edits.',
            className: 'setting-dependent setting-autosave-dependent',
            onChange: (val: boolean) => {
                applyAndPersist({ showManualSavePopup: val });
            },
            defaultValue: getSettings().showManualSavePopup
        }
    ];
}
