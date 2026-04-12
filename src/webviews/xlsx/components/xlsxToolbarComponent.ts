import { Icons } from '../../shared/icons';
import { ToolbarButton } from '../../shared/toolbarManager';

export interface CreateXlsxToolbarButtonsOptions {
    textColorIcon: string;
    bgColorIcon: string;
    onToggleTableEdit: () => void;
    onSaveTableEdits: () => void;
    onCancelTableEdits: () => void;
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
    onEnableAsDefault: () => void;
}

export function createXlsxToolbarButtons(options: CreateXlsxToolbarButtonsOptions): ToolbarButton[] {
    return [
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
            label: 'Save',
            tooltip: 'Save table edits',
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
            id: 'togglePlainViewButton',
            icon: Icons.Table,
            label: 'Plain',
            tooltip: 'Toggle Plain View (removes all styling)',
            onClick: options.onTogglePlainView
        },
        {
            id: 'versionHistoryButton',
            icon: Icons.VersionHistory,
            tooltip: 'Version history',
            cls: 'icon-only',
            onClick: options.onVersionHistory
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: 'XLSX Settings',
            cls: 'icon-only',
            onClick: options.onOpenSettings
        },
        {
            id: 'toggleBackgroundButton',
            icon: Icons.ThemeLight + Icons.ThemeDark + Icons.ThemeVSCode,
            tooltip: 'Toggle Theme',
            onClick: options.onToggleBackground
        },
        {
            id: 'helpButton',
            icon: Icons.Help,
            tooltip: 'Help & Feedback',
            cls: 'icon-only',
            onClick: options.onHelp
        },
        {
            id: 'enableAsDefaultButton',
            icon: Icons.Zap,
            label: 'Set as Default',
            tooltip: 'Make XLSX Viewer the default editor for XLSX files',
            hidden: true,
            onClick: options.onEnableAsDefault
        }
    ];
}
