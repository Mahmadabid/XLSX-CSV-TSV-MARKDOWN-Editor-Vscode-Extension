import { SettingDefinition } from '../../shared/settingsManager';
import { I18n } from '../../shared/i18n';

export interface XlsxViewSettings {
    firstRowIsHeader: boolean;
    stickyToolbar: boolean;
    stickyHeader: boolean;
    autoSave: boolean;
    autoSaveMode: 'all' | 'controlsOnly';
    showManualSavePopup: boolean;
    showPopups: boolean;
    allowInteractiveControlsOutsideEditMode: boolean;
    hyperlinkPreview: boolean;
    spaciousCells: boolean;
    mergeWarningEnabled: boolean;
    isDefaultEditor?: boolean;
    textWrap: boolean;
    csvSeparator?: ',' | ';';
    textDirection?: 'auto' | 'ltr' | 'rtl';
}

export const defaultXlsxViewSettings: XlsxViewSettings = {
    firstRowIsHeader: true,
    stickyToolbar: true,
    stickyHeader: false,
    autoSave: false,
    autoSaveMode: 'all',
    showManualSavePopup: true,
    showPopups: true,
    allowInteractiveControlsOutsideEditMode: true,
    hyperlinkPreview: true,
    spaciousCells: false,
    mergeWarningEnabled: true,
    isDefaultEditor: true,
    textWrap: false,
    csvSeparator: ',',
    textDirection: 'auto'
};

export function normalizeXlsxSettings(next: any, previous: XlsxViewSettings): XlsxViewSettings {
    const normalized: XlsxViewSettings = {
        firstRowIsHeader: next && typeof next.firstRowIsHeader === 'boolean' ? next.firstRowIsHeader : previous.firstRowIsHeader,
        stickyToolbar: next && typeof next.stickyToolbar === 'boolean' ? next.stickyToolbar : previous.stickyToolbar,
        stickyHeader: next && typeof next.stickyHeader === 'boolean' ? next.stickyHeader : previous.stickyHeader,
        autoSave: next && typeof next.autoSave === 'boolean' ? next.autoSave : previous.autoSave,
        autoSaveMode: next && (next.autoSaveMode === 'all' || next.autoSaveMode === 'controlsOnly') ? next.autoSaveMode : previous.autoSaveMode,
        showManualSavePopup: next && typeof next.showManualSavePopup === 'boolean' ? next.showManualSavePopup : previous.showManualSavePopup,
        showPopups: next && typeof next.showPopups === 'boolean' ? next.showPopups : (previous.showPopups !== undefined ? previous.showPopups : true),
        allowInteractiveControlsOutsideEditMode: next && typeof next.allowInteractiveControlsOutsideEditMode === 'boolean' ? next.allowInteractiveControlsOutsideEditMode : previous.allowInteractiveControlsOutsideEditMode,
        hyperlinkPreview: next && typeof next.hyperlinkPreview === 'boolean' ? next.hyperlinkPreview : previous.hyperlinkPreview,
        spaciousCells: next && typeof next.spaciousCells === 'boolean' ? next.spaciousCells : previous.spaciousCells,
        mergeWarningEnabled: next && typeof next.mergeWarningEnabled === 'boolean' ? next.mergeWarningEnabled : previous.mergeWarningEnabled,
        isDefaultEditor: next && typeof next.isDefaultEditor === 'boolean' ? next.isDefaultEditor : previous.isDefaultEditor,
        textWrap: next && typeof next.textWrap === 'boolean' ? next.textWrap : previous.textWrap,
        csvSeparator: next && (next.csvSeparator === ',' || next.csvSeparator === ';') ? next.csvSeparator : (previous.csvSeparator || ','),
        textDirection: next && (next.textDirection === 'rtl' || next.textDirection === 'ltr' || next.textDirection === 'auto') ? next.textDirection : (previous.textDirection || 'auto')
    };

    if (!normalized.firstRowIsHeader) {
        normalized.stickyHeader = false;
    }

    return normalized;
}

export function syncSettingsCheckboxes(settings: XlsxViewSettings, fileType?: string): void {
    const chkHeader = document.getElementById('chkHeaderRow') as HTMLInputElement | null;
    const chkSticky = document.getElementById('chkStickyHeader') as HTMLInputElement | null;
    const chkToolbar = document.getElementById('chkStickyToolbar') as HTMLInputElement | null;
    const chkAutoSave = document.getElementById('chkAutoSave') as HTMLInputElement | null;
    const radioAutoSaveAll = document.getElementById('radioAutoSaveAll') as HTMLInputElement | null;
    const radioAutoSaveControlsOnly = document.getElementById('radioAutoSaveControlsOnly') as HTMLInputElement | null;
    const chkManualSavePopup = document.getElementById('chkShowManualSavePopup') as HTMLInputElement | null;
    const chkShowPopups = document.getElementById('chkShowPopups') as HTMLInputElement | null;
    const chkOutsideControls = document.getElementById('chkAllowInteractiveControlsOutsideEditMode') as HTMLInputElement | null;
    const chkHyperlink = document.getElementById('chkHyperlinkPreview') as HTMLInputElement | null;
    const chkSpacious = document.getElementById('chkSpaciousCells') as HTMLInputElement | null;
    const chkTextWrap = document.getElementById('chkTextWrap') as HTMLInputElement | null;
    const chkMergeWarning = document.getElementById('chkMergeWarningEnabled') as HTMLInputElement | null;

    const radioCsvSeparatorComma = document.getElementById('radioCsvSeparatorComma') as HTMLInputElement | null;
    const radioCsvSeparatorSemicolon = document.getElementById('radioCsvSeparatorSemicolon') as HTMLInputElement | null;

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
    if (chkShowPopups) chkShowPopups.checked = settings.showPopups !== false;
    if (chkOutsideControls) chkOutsideControls.checked = !!settings.allowInteractiveControlsOutsideEditMode;
    if (chkHyperlink) chkHyperlink.checked = !!settings.hyperlinkPreview;
    if (chkSpacious) chkSpacious.checked = !!settings.spaciousCells;
    if (chkTextWrap) chkTextWrap.checked = !!settings.textWrap;
    if (chkMergeWarning) chkMergeWarning.checked = !!settings.mergeWarningEnabled;

    if (radioCsvSeparatorComma) radioCsvSeparatorComma.checked = settings.csvSeparator !== ';';
    if (radioCsvSeparatorSemicolon) radioCsvSeparatorSemicolon.checked = settings.csvSeparator === ';';

    const radioLangAuto = document.getElementById('radioLangAuto') as HTMLInputElement | null;
    const radioLangEn = document.getElementById('radioLangEn') as HTMLInputElement | null;
    const radioLangZh = document.getElementById('radioLangZh') as HTMLInputElement | null;
    const currentLangSetting = I18n.getLanguageSetting();
    if (radioLangAuto) radioLangAuto.checked = currentLangSetting === 'auto';
    if (radioLangEn) radioLangEn.checked = currentLangSetting === 'en';
    if (radioLangZh) radioLangZh.checked = currentLangSetting === 'zh';

    const autoSaveEnabled = !!settings.autoSave;
    const manualSaveItem = chkManualSavePopup?.closest('.setting-item') as HTMLElement | null;
    const autoSaveAllItem = radioAutoSaveAll?.closest('.setting-item') as HTMLElement | null;
    const autoSaveControlsItem = radioAutoSaveControlsOnly?.closest('.setting-item') as HTMLElement | null;

    const commaItem = radioCsvSeparatorComma?.closest('.setting-item') as HTMLElement | null;
    const semicolonItem = radioCsvSeparatorSemicolon?.closest('.setting-item') as HTMLElement | null;

    if (manualSaveItem) {
        manualSaveItem.style.display = autoSaveEnabled ? 'none' : 'inline-flex';
    }
    if (autoSaveAllItem) {
        autoSaveAllItem.style.display = autoSaveEnabled ? 'inline-flex' : 'none';
    }
    if (autoSaveControlsItem) {
        autoSaveControlsItem.style.display = autoSaveEnabled ? 'inline-flex' : 'none';
    }

    if (commaItem) {
        commaItem.style.display = fileType === 'csv' ? 'inline-flex' : 'none';
    }
    if (semicolonItem) {
        semicolonItem.style.display = fileType === 'csv' ? 'inline-flex' : 'none';
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
            label: I18n.t('settings.headerRow', 'Header Row'),
            tooltip: I18n.t('settings.headerRowTip', 'Treat the first worksheet row as a header row.'),
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
            label: I18n.t('settings.stickyHeader', 'Sticky Header'),
            tooltip: I18n.t('settings.stickyHeaderTip', 'Keep the header row visible while scrolling vertically.'),
            onChange: (val: boolean) => {
                const settings = getSettings();
                applyAndPersist({ stickyHeader: settings.firstRowIsHeader ? val : false });
            },
            defaultValue: getSettings().stickyHeader
        },
        {
            id: 'chkStickyToolbar',
            label: I18n.t('settings.stickyToolbar', 'Sticky Toolbar'),
            tooltip: I18n.t('settings.stickyToolbarTip', 'Keep the top toolbar pinned while scrolling the worksheet.'),
            onChange: (val: boolean) => {
                applyAndPersist({ stickyToolbar: val });
            },
            defaultValue: getSettings().stickyToolbar
        },
        {
            id: 'chkAllowInteractiveControlsOutsideEditMode',
            label: I18n.t('settings.allowControlsOutside', 'Edit Checkbox/Dropdown Without Edit Mode'),
            tooltip: I18n.t('settings.allowControlsOutsideTip', 'Allow checkbox toggles and dropdown selection without entering table edit mode.'),
            onChange: (val: boolean) => {
                applyAndPersist({ allowInteractiveControlsOutsideEditMode: val });
            },
            defaultValue: getSettings().allowInteractiveControlsOutsideEditMode
        },
        {
            id: 'chkHyperlinkPreview',
            label: I18n.t('settings.hyperlinkPreview', 'Hyperlink Preview'),
            tooltip: I18n.t('settings.hyperlinkPreviewTip', 'Show hover actions for hyperlinks, including Open in browser and Copy link.'),
            onChange: (val: boolean) => {
                applyAndPersist({ hyperlinkPreview: val });
            },
            defaultValue: getSettings().hyperlinkPreview
        },
        {
            id: 'chkSpaciousCells',
            label: I18n.t('settings.spaciousCells', 'Spacious Cells'),
            tooltip: I18n.t('settings.spaciousCellsTip', 'Increase row height and padding for better readability.'),
            onChange: (val: boolean) => {
                applyAndPersist({ spaciousCells: val });
            },
            defaultValue: getSettings().spaciousCells
        },
        {
            id: 'chkTextWrap',
            label: I18n.t('settings.textWrap', 'Text Wrap'),
            tooltip: I18n.t('settings.textWrapTip', 'Enable text wrapping in cells by default.'),
            onChange: (val: boolean) => {
                applyAndPersist({ textWrap: val });
            },
            defaultValue: getSettings().textWrap
        },
        {
            id: 'chkMergeWarningEnabled',
            label: I18n.t('settings.mergeWarning', 'Merge Warning Popup'),
            tooltip: I18n.t('settings.mergeWarningTip', 'Ask for confirmation before merging cells because only the top-left value is preserved.'),
            onChange: (val: boolean) => {
                applyAndPersist({ mergeWarningEnabled: val });
            },
            defaultValue: getSettings().mergeWarningEnabled
        },
        {
            id: 'chkAutoSave',
            label: I18n.t('settings.autoSave', 'Autosave'),
            tooltip: I18n.t('settings.autoSaveTip', 'Automatically save edits shortly after text, checkbox, dropdown, or formatting changes.'),
            onChange: (val: boolean) => {
                applyAndPersist({ autoSave: val });
            },
            defaultValue: getSettings().autoSave
        },
        {
            id: 'radioAutoSaveAll',
            label: I18n.t('settings.autoSaveAll', 'Autosave all changes'),
            tooltip: I18n.t('settings.autoSaveAllTip', 'Autosave any pending worksheet edits, including text, formatting, and structure operations.'),
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
            label: I18n.t('settings.autoSaveControlsOnly', 'Autosave only checkbox/dropdown'),
            tooltip: I18n.t('settings.autoSaveControlsOnlyTip', 'Autosave triggers only from checkbox or dropdown changes.'),
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
            label: I18n.t('settings.manualSavePopup', 'Manual Save Popup (Autosave Off)'),
            tooltip: I18n.t('settings.manualSavePopupTip', 'When Autosave is off, show a short reminder popup to save manually after edits.'),
            className: 'setting-dependent setting-autosave-dependent',
            onChange: (val: boolean) => {
                applyAndPersist({ showManualSavePopup: val });
            },
            defaultValue: getSettings().showManualSavePopup
        },
        {
            id: 'chkShowPopups',
            label: I18n.t('settings.showPopups', 'Show Notification Popups'),
            tooltip: I18n.t('settings.showPopupsTip', 'Show popup notifications (such as saved/autosaved toasts) during editor usage. Uncheck to disable.'),
            onChange: (val: boolean) => {
                applyAndPersist({ showPopups: val });
            },
            defaultValue: getSettings().showPopups !== false
        },
        {
            id: 'radioCsvSeparatorComma',
            label: I18n.t('settings.csvComma', 'CSV Delimiter: Comma (,)'),
            tooltip: I18n.t('settings.csvCommaTip', 'Use comma as separator when saving CSV files.'),
            inputType: 'radio',
            groupName: 'csvSeparatorMode',
            value: ',',
            onChange: () => {
                applyAndPersist({ csvSeparator: ',' });
            },
            defaultValue: getSettings().csvSeparator !== ';'
        },
        {
            id: 'radioCsvSeparatorSemicolon',
            label: I18n.t('settings.csvSemicolon', 'CSV Delimiter: Semicolon (;)'),
            tooltip: I18n.t('settings.csvSemicolonTip', 'Use semicolon as separator when saving CSV files.'),
            inputType: 'radio',
            groupName: 'csvSeparatorMode',
            value: ';',
            onChange: () => {
                applyAndPersist({ csvSeparator: ';' });
            },
            defaultValue: getSettings().csvSeparator === ';'
        },
        {
            id: 'radioLangAuto',
            label: I18n.t('settings.langAuto', 'Auto (Detect)'),
            tooltip: I18n.t('settings.languageTip', 'Auto-detect language'),
            inputType: 'radio',
            groupName: 'uiLanguageMode',
            value: 'auto',
            onChange: () => {
                I18n.setLanguage('auto', true);
            },
            defaultValue: I18n.getLanguageSetting() === 'auto'
        },
        {
            id: 'radioLangEn',
            label: I18n.t('settings.langEn', 'English'),
            tooltip: 'English',
            inputType: 'radio',
            groupName: 'uiLanguageMode',
            value: 'en',
            onChange: () => {
                I18n.setLanguage('en', true);
            },
            defaultValue: I18n.getLanguageSetting() === 'en'
        },
        {
            id: 'radioLangZh',
            label: I18n.t('settings.langZh', '中文 (Simplified Chinese)'),
            tooltip: '简体中文',
            inputType: 'radio',
            groupName: 'uiLanguageMode',
            value: 'zh',
            onChange: () => {
                I18n.setLanguage('zh', true);
            },
            defaultValue: I18n.getLanguageSetting() === 'zh'
        }
    ];
}
