import { Icons } from '../../shared/icons';
import { ToolbarButton } from '../../shared/toolbarManager';

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
    onProjects: () => void;
}

export function createXlsxToolbarButtons(options: CreateXlsxToolbarButtonsOptions): ToolbarButton[] {
    return [
        {
            id: 'enableAsDefaultButton',
            icon: Icons.Zap,
            label: 'Set as Default',
            tooltip: 'Make Spreadsheet Viewer the default editor for XLSX files',
            hidden: true,
            onClick: options.onEnableAsDefault
        },
        {
            id: 'refreshButton',
            icon: Icons.Refresh,
            tooltip: 'Reload file from disk',
            cls: 'icon-only',
            onClick: options.onRefresh
        },
        {
            id: 'editFileButton',
            icon: Icons.EditFile,
            label: 'Edit File',
            tooltip: 'Open this file in the default text editor',
            hidden: true,
            onClick: options.onEditFile
        },
        {
            id: 'toggleTableEditButton',
            icon: '',
            label: 'Edit Table',
            tooltip: 'Edit XLSX directly in the table (text only)',
            onClick: options.onToggleTableEdit
        },
        {
            id: 'saveTableEditsButton',
            icon: Icons.Save,
            tooltip: 'Save table edits',
            cls: 'icon-only',
            hidden: true,
            onClick: options.onSaveTableEdits
        },
        {
            id: 'cancelTableEditsButton',
            icon: Icons.Cancel,
            label: 'Cancel',
            tooltip: 'Cancel table edits',
            hidden: true,
            onClick: options.onCancelTableEdits
        },
        {
            id: 'formatBoldButton',
            icon: Icons.Bold,
            cls: 'icon-only',
            tooltip: 'Bold selected text (Ctrl/Cmd+B)',
            hidden: true,
            onClick: options.onFormatBold
        },
        {
            id: 'formatItalicButton',
            icon: Icons.Italic,
            cls: 'icon-only',
            tooltip: 'Italic selected text (Ctrl/Cmd+I)',
            hidden: true,
            onClick: options.onFormatItalic
        },
        {
            id: 'formatTextColorButton',
            icon: options.textColorIcon,
            cls: 'icon-only',
            tooltip: 'Set selected text color',
            hidden: true,
            onClick: options.onFormatTextColor
        },
        {
            id: 'formatBackgroundColorButton',
            icon: options.bgColorIcon,
            cls: 'icon-only',
            tooltip: 'Set selected text background color',
            hidden: true,
            onClick: options.onFormatBackgroundColor
        },
        {
            id: 'toggleExpandButton',
            icon: Icons.Expand,
            label: 'Expand',
            tooltip: 'Toggle Column Widths (Default / Expand All)',
            onClick: options.onToggleExpand
        },
        {
            id: 'findButton',
            icon: Icons.Search,
            cls: 'icon-only',
            tooltip: 'Find in sheet (Ctrl/Cmd+F)',
            onClick: options.onFind
        },
        {
            id: 'togglePlainViewButton',
            icon: Icons.Table,
            label: 'Plain',
            tooltip: 'Toggle Plain View (removes all styling)',
            onClick: options.onTogglePlainView
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: 'Sheet Settings',
            cls: 'icon-only',
            onClick: options.onOpenSettings
        },
        {
            id: 'insertControlButton',
            icon: Icons.TableInsert,
            label: 'Insert',
            tooltip: 'Insert checkbox, dropdown, rating, or date into selected cells',
            hidden: true,
            onClick: options.onInsertControl
        },
        {
            id: 'toggleBackgroundButton',
            icon: Icons.ThemeLight + Icons.ThemeDark + Icons.ThemeVSCode,
            tooltip: 'Toggle Theme',
            onClick: options.onToggleBackground
        },
        {
            id: 'versionHistoryButton',
            icon: Icons.VersionHistory,
            tooltip: 'Version history',
            cls: 'icon-only',
            onClick: options.onVersionHistory
        },
        {
            id: 'convertFileButton',
            icon: Icons.Convert,
            label: 'Convert',
            tooltip: 'Convert this file to CSV, TSV, or XLSX',
            onClick: options.onConvertFile
        },
        {
            id: 'projectsButton',
            icon: Icons.Link,
            tooltip: 'Other Projects',
            cls: 'icon-only',
            onClick: options.onProjects
        },
        {
            id: 'helpButton',
            icon: Icons.Help,
            tooltip: 'Help & Feedback',
            cls: 'icon-only',
            onClick: options.onHelp
        }
    ];
}
