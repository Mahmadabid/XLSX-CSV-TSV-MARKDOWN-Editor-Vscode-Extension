import { Icons } from '../../shared/icons';
import { ToolbarButton } from '../../shared/toolbarManager';

export interface CreateTableToolbarButtonsOptions {
    fileFormat: string;
    onToggleView: () => void;
    onToggleExpand: () => void;
    onFind: () => void;
    onOpenSettings: () => void;
    onToggleBackground: () => void;
    onVersionHistory: () => void;
    onHelp: () => void;
    onConvertFile: () => void;
    onEnableAsDefault: () => void;
}

export function createTableToolbarButtons(options: CreateTableToolbarButtonsOptions): ToolbarButton[] {
    return [
        {
            id: 'toggleViewButton',
            icon: Icons.EditFile,
            label: 'Edit File',
            tooltip: 'Edit File in Vscode Default Editor',
            onClick: options.onToggleView
        },
        {
            id: 'toggleExpandButton',
            icon: Icons.Expand,
            label: 'Expand',
            tooltip: 'Toggle Column Widths (Default / Expand All)',
            cls: 'edit-mode-hide',
            onClick: options.onToggleExpand
        },
        {
            id: 'findButton',
            icon: Icons.Search,
            tooltip: 'Find in table (Ctrl/Cmd+F)',
            cls: 'icon-only edit-mode-hide',
            onClick: options.onFind
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: 'CSV Settings',
            cls: 'icon-only',
            onClick: options.onOpenSettings
        },
        {
            id: 'toggleBackgroundButton',
            icon: Icons.ThemeLight + Icons.ThemeDark + Icons.ThemeVSCode,
            tooltip: 'Toggle Theme',
            cls: 'edit-mode-hide',
            onClick: options.onToggleBackground
        },
        {
            id: 'versionHistoryButton',
            icon: Icons.VersionHistory,
            tooltip: 'Version history',
            cls: 'edit-mode-hide icon-only',
            onClick: options.onVersionHistory
        },
        {
            id: 'convertFileButton',
            icon: Icons.Convert,
            label: 'Convert',
            tooltip: `Convert this ${options.fileFormat.toUpperCase()} file`,
            cls: 'edit-mode-hide',
            onClick: options.onConvertFile
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
            tooltip: `Make XLSX Viewer the default editor for ${options.fileFormat.toUpperCase()} files`,
            cls: 'edit-mode-hide',
            hidden: true,
            onClick: options.onEnableAsDefault
        }
    ];
}
