import { Icons } from '../../shared/icons';
import { ToolbarButton } from '../../shared/toolbarManager';
import { I18n } from '../../shared/i18n';

export interface CreateXlsxToolbarButtonsOptions {
    onFind: () => void;
    textColorIcon: string;
    bgColorIcon: string;
    onEditFile: () => void;
    onToggleTableEdit: () => void;
    onSaveTableEdits: () => void;
    onCancelTableEdits: () => void;
    onInsertControl: () => void;
    onFormatBold: () => void;
    onFormatItalic: () => void;
    onFormatTextColor: () => void;
    onFormatBackgroundColor: () => void;
    onToggleExpand: () => void;
    onTogglePlainView: () => void;
    onVersionHistory: () => void;
    onOpenSettings: () => void;
    onToggleBackground: () => void;
    onHelp: () => void;
    onConvertFile: () => void;
    onEnableAsDefault: () => void;
    onRefresh: () => void;
    onToggleRtl: () => void;
    onProjects: () => void;
    onToggleLanguage: () => void;
}

export function createXlsxToolbarButtons(options: CreateXlsxToolbarButtonsOptions): ToolbarButton[] {
    return [
        {
            id: 'enableAsDefaultButton',
            icon: Icons.Zap,
            label: I18n.t('toolbar.setAsDefault', 'Set as Default'),
            tooltip: I18n.t('toolbar.setAsDefaultTooltip', 'Make Spreadsheet Viewer the default editor for XLSX files'),
            hidden: true,
            onClick: options.onEnableAsDefault
        },
        {
            id: 'refreshButton',
            icon: Icons.Refresh,
            tooltip: I18n.t('toolbar.refresh', 'Reload file from disk'),
            cls: 'icon-only',
            onClick: options.onRefresh
        },
        {
            id: 'toggleRtlButton',
            icon: Icons.TextDirection,
            label: I18n.t('toolbar.rtl', 'RTL'),
            tooltip: I18n.t('toolbar.rtlTooltip', 'Toggle Right-to-Left (RTL) / LTR text direction'),
            onClick: options.onToggleRtl
        },
        {
            id: 'editFileButton',
            icon: Icons.EditFile,
            label: I18n.t('toolbar.editFile', 'Edit File'),
            tooltip: I18n.t('toolbar.editFileTooltip', 'Open this file in the default text editor'),
            hidden: true,
            onClick: options.onEditFile
        },
        {
            id: 'toggleTableEditButton',
            icon: '',
            label: I18n.t('toolbar.editTable', 'Edit Table'),
            tooltip: I18n.t('toolbar.editTableTooltip', 'Edit XLSX directly in the table (text only)'),
            onClick: options.onToggleTableEdit
        },
        {
            id: 'saveTableEditsButton',
            icon: Icons.Save,
            tooltip: I18n.t('toolbar.saveTooltip', 'Save table edits'),
            cls: 'icon-only',
            hidden: true,
            onClick: options.onSaveTableEdits
        },
        {
            id: 'cancelTableEditsButton',
            icon: Icons.Cancel,
            label: I18n.t('toolbar.cancel', 'Cancel'),
            tooltip: I18n.t('toolbar.cancelTooltip', 'Cancel table edits'),
            hidden: true,
            onClick: options.onCancelTableEdits
        },
        {
            id: 'formatBoldButton',
            icon: Icons.Bold,
            cls: 'icon-only',
            tooltip: I18n.t('toolbar.bold', 'Bold selected text (Ctrl/Cmd+B)'),
            hidden: true,
            onClick: options.onFormatBold
        },
        {
            id: 'formatItalicButton',
            icon: Icons.Italic,
            cls: 'icon-only',
            tooltip: I18n.t('toolbar.italic', 'Italic selected text (Ctrl/Cmd+I)'),
            hidden: true,
            onClick: options.onFormatItalic
        },
        {
            id: 'formatTextColorButton',
            icon: options.textColorIcon,
            cls: 'icon-only',
            tooltip: I18n.t('toolbar.textColor', 'Set selected text color'),
            hidden: true,
            onClick: options.onFormatTextColor
        },
        {
            id: 'formatBackgroundColorButton',
            icon: options.bgColorIcon,
            cls: 'icon-only',
            tooltip: I18n.t('toolbar.bgColor', 'Set selected text background color'),
            hidden: true,
            onClick: options.onFormatBackgroundColor
        },
        {
            id: 'toggleExpandButton',
            icon: Icons.Expand,
            label: I18n.t('toolbar.expand', 'Expand'),
            tooltip: I18n.t('toolbar.expandTooltip', 'Toggle Column Widths (Default / Expand All)'),
            onClick: options.onToggleExpand
        },
        {
            id: 'findButton',
            icon: Icons.Search,
            cls: 'icon-only',
            tooltip: I18n.t('toolbar.find', 'Find in sheet (Ctrl/Cmd+F)'),
            onClick: options.onFind
        },
        {
            id: 'togglePlainViewButton',
            icon: Icons.Table,
            label: I18n.t('toolbar.plain', 'Plain'),
            tooltip: I18n.t('toolbar.plainTooltip', 'Toggle Plain View (removes all styling)'),
            onClick: options.onTogglePlainView
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: I18n.t('toolbar.settings', 'Sheet Settings'),
            cls: 'icon-only',
            onClick: options.onOpenSettings
        },
        {
            id: 'insertControlButton',
            icon: Icons.TableInsert,
            label: I18n.t('toolbar.insert', 'Insert'),
            tooltip: I18n.t('toolbar.insertTooltip', 'Insert checkbox, dropdown, rating, or date into selected cells'),
            hidden: true,
            onClick: options.onInsertControl
        },
        {
            id: 'toggleBackgroundButton',
            icon: Icons.ThemeLight + Icons.ThemeDark + Icons.ThemeVSCode,
            tooltip: I18n.t('toolbar.theme', 'Toggle Theme'),
            onClick: options.onToggleBackground
        },
        {
            id: 'toggleLanguageButton',
            icon: Icons.Globe,
            label: I18n.getLanguage() === 'zh' ? 'English' : '中文',
            tooltip: I18n.t('toolbar.languageTooltip', 'Switch Language (English / 中文)'),
            cls: 'language-switcher-btn',
            onClick: options.onToggleLanguage
        },
        {
            id: 'versionHistoryButton',
            icon: Icons.VersionHistory,
            tooltip: I18n.t('toolbar.versionHistory', 'Version history'),
            cls: 'icon-only',
            onClick: options.onVersionHistory
        },
        {
            id: 'convertFileButton',
            icon: Icons.Convert,
            label: I18n.t('toolbar.convert', 'Convert'),
            tooltip: I18n.t('toolbar.convertTooltip', 'Convert this file to CSV, TSV, or XLSX'),
            onClick: options.onConvertFile
        },
        {
            id: 'projectsButton',
            icon: Icons.Link,
            tooltip: I18n.t('toolbar.projects', 'Other Projects'),
            cls: 'icon-only',
            onClick: options.onProjects
        },
        {
            id: 'helpButton',
            icon: Icons.Help,
            tooltip: I18n.t('toolbar.help', 'Help & Feedback'),
            cls: 'icon-only',
            onClick: options.onHelp
        }
    ];
}
