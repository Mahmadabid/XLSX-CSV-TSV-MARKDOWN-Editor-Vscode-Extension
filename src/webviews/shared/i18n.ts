/* eslint-disable @typescript-eslint/no-explicit-any */

export type SupportedLanguage = 'en' | 'zh';
export type LanguageSetting = 'auto' | 'en' | 'zh';

const STORAGE_KEY = 'xlsx_viewer_language';

const translations: Record<SupportedLanguage, Record<string, string>> = {
    en: {
        // Toolbar
        'toolbar.setAsDefault': 'Set as Default',
        'toolbar.setAsDefaultTooltip': 'Make Spreadsheet Viewer the default editor for XLSX files',
        'toolbar.enableMd': 'Enable MD',
        'toolbar.enableMdTooltip': 'Enable Markdown Viewer for all Markdown files (Make Default)',
        'toolbar.disableMd': 'Disable MD',
        'toolbar.disableMdTooltip': 'Disable Markdown Viewer for all Markdown files',
        'toolbar.refresh': 'Reload file from disk',
        'toolbar.rtl': 'RTL',
        'toolbar.rtlTooltip': 'Toggle Right-to-Left (RTL) / LTR text direction',
        'toolbar.editFile': 'Edit File',
        'toolbar.editFileTooltip': 'Open this file in the default text editor',
        'toolbar.editFileMdTooltip': 'Edit File in Vscode Default Editor',
        'toolbar.editTable': 'Edit Table',
        'toolbar.exitEdit': 'Exit Edit',
        'toolbar.editTableTooltip': 'Edit XLSX directly in the table (text only)',
        'toolbar.splitEdit': 'Split Edit',
        'toolbar.splitEditTooltip': 'Edit Markdown side-by-side',
        'toolbar.previewEdit': 'Preview Edit',
        'toolbar.previewEditTooltip': 'Edit directly in preview (WYSIWYG)',
        'toolbar.save': 'Save',
        'toolbar.saveTooltip': 'Save table edits',
        'toolbar.saveMdTooltip': 'Save Changes (Ctrl+S)',
        'toolbar.cancel': 'Cancel',
        'toolbar.cancelTooltip': 'Cancel table edits',
        'toolbar.cancelMdTooltip': 'Cancel Changes (Esc)',
        'toolbar.bold': 'Bold selected text (Ctrl/Cmd+B)',
        'toolbar.italic': 'Italic selected text (Ctrl/Cmd+I)',
        'toolbar.textColor': 'Set selected text color',
        'toolbar.bgColor': 'Set selected text background color',
        'toolbar.expand': 'Expand',
        'toolbar.collapse': 'Collapse',
        'toolbar.expandTooltip': 'Toggle Column Widths (Default / Expand All)',
        'toolbar.find': 'Find in sheet (Ctrl/Cmd+F)',
        'toolbar.searchMd': 'Search in Preview (Ctrl/Cmd+F)',
        'toolbar.plain': 'Plain',
        'toolbar.styled': 'Styled',
        'toolbar.plainTooltip': 'Toggle Plain View (removes all styling)',
        'toolbar.styledTooltip': 'Toggle Styled View',
        'toolbar.outline': 'Toggle Outline',
        'toolbar.settings': 'Sheet Settings',
        'toolbar.settingsMd': 'Settings',
        'toolbar.insert': 'Insert',
        'toolbar.insertTooltip': 'Insert checkbox, dropdown, rating, or date into selected cells',
        'toolbar.theme': 'Toggle Theme',
        'toolbar.focus': 'Focus Mode',
        'toolbar.copyHtml': 'Copy as HTML',
        'toolbar.exportPdf': 'Export to PDF',
        'toolbar.versionHistory': 'Version history',
        'toolbar.convert': 'Convert',
        'toolbar.convertTooltip': 'Convert this file to CSV, TSV, or XLSX',
        'toolbar.projects': 'Other Projects',
        'toolbar.help': 'Help & Feedback',
        'toolbar.languageButton': '中文',
        'toolbar.languageTooltip': 'Switch Language (English / 中文)',

        // Markdown Formatting Toolbar
        'fmt.bold': 'Bold (Ctrl+B)',
        'fmt.italic': 'Italic (Ctrl+I)',
        'fmt.strikethrough': 'Strikethrough (Ctrl+Shift+X)',
        'fmt.inlineCode': 'Inline Code (Ctrl+E)',
        'fmt.heading1': 'Heading 1 (Ctrl+1)',
        'fmt.heading2': 'Heading 2 (Ctrl+2)',
        'fmt.heading3': 'Heading 3 (Ctrl+3)',
        'fmt.bulletList': 'Bullet List (Ctrl+L)',
        'fmt.orderedList': 'Ordered List (Ctrl+Shift+L)',
        'fmt.checkbox': 'Checkbox List',
        'fmt.blockquote': 'Blockquote',
        'fmt.link': 'Insert Link (Ctrl+K)',
        'fmt.image': 'Insert Image',
        'fmt.table': 'Insert Table',
        'fmt.tableAddRowBelow': 'Add Row Below (WYSIWYG table)',
        'fmt.tableRemoveRow': 'Remove Current Row (WYSIWYG table)',
        'fmt.tableAddColumnRight': 'Add Column Right (WYSIWYG table)',
        'fmt.tableRemoveColumn': 'Remove Current Column (WYSIWYG table)',
        'fmt.codeBlock': 'Code Block (Ctrl+Shift+E)',
        'fmt.hr': 'Horizontal Rule',
        'fmt.undo': 'Undo (Ctrl+Z)',
        'fmt.redo': 'Redo (Ctrl+Shift+Z)',
        'fmt.duplicateLine': 'Duplicate Line (Ctrl+Shift+D)',
        'fmt.deleteLine': 'Delete Line (Ctrl+Shift+K)',
        'fmt.moveUp': 'Move Line Up (Alt+↑)',
        'fmt.moveDown': 'Move Line Down (Alt+↓)',
        'fmt.uppercase': 'UPPERCASE (Ctrl+Shift+U)',
        'fmt.lowercase': 'lowercase (Ctrl+U)',
        'fmt.titlecase': 'Title Case',
        'fmt.sortLines': 'Sort Lines A-Z',
        'fmt.trimWhitespace': 'Trim Trailing Whitespace',
        'fmt.jumpToLine': 'Go to Line (Ctrl+G)',

        // Search & Find
        'find.placeholder': 'Find',
        'find.ariaLabel': 'Find in worksheet',
        'find.prevMatch': 'Previous match (Shift+Enter)',
        'find.nextMatch': 'Next match (Enter)',
        'find.close': 'Close',
        'find.mdPlaceholder': 'Search in preview...',
        'find.mdClose': 'Close (Esc)',

        // Settings Panel
        'settings.close': 'Close',
        'settings.headerRow': 'Header Row',
        'settings.headerRowTip': 'Treat the first worksheet row as a header row.',
        'settings.stickyHeader': 'Sticky Header',
        'settings.stickyHeaderTip': 'Keep the header row visible while scrolling vertically.',
        'settings.stickyToolbar': 'Sticky Toolbar',
        'settings.stickyToolbarTip': 'Keep the top toolbar pinned while scrolling the worksheet.',
        'settings.allowControlsOutside': 'Edit Checkbox/Dropdown Without Edit Mode',
        'settings.allowControlsOutsideTip': 'Allow checkbox toggles and dropdown selection without entering table edit mode.',
        'settings.hyperlinkPreview': 'Hyperlink Preview',
        'settings.hyperlinkPreviewTip': 'Show hover actions for hyperlinks, including Open in browser and Copy link.',
        'settings.spaciousCells': 'Spacious Cells',
        'settings.spaciousCellsTip': 'Increase row height and padding for better readability.',
        'settings.textWrap': 'Text Wrap',
        'settings.textWrapTip': 'Enable text wrapping in cells by default.',
        'settings.mergeWarning': 'Merge Warning Popup',
        'settings.mergeWarningTip': 'Ask for confirmation before merging cells because only the top-left value is preserved.',
        'settings.autoSave': 'Autosave',
        'settings.autoSaveTip': 'Automatically save edits shortly after text, checkbox, dropdown, or formatting changes.',
        'settings.autoSaveControlsOnly': 'Autosave: Controls Only',
        'settings.autoSaveControlsOnlyTip': 'Automatically save changes only for interactive controls like checkboxes and dropdowns.',
        'settings.autoSaveAll': 'Autosave: All Changes',
        'settings.autoSaveAllTip': 'Automatically save all spreadsheet changes shortly after editing.',
        'settings.csvComma': 'CSV Delimiter: Comma (,)',
        'settings.csvCommaTip': 'Use comma as the separator character for CSV files.',
        'settings.csvSemicolon': 'CSV Delimiter: Semicolon (;)',
        'settings.csvSemicolonTip': 'Use semicolon as the separator character for CSV files.',
        'settings.manualSavePopup': 'Show Manual Save Reminder',
        'settings.manualSavePopupTip': 'Display a small reminder to save manually when autosave is disabled.',
        'settings.showPopups': 'Show Notification Popups',
        'settings.showPopupsTip': 'Show popup notifications (such as save toasts) during editor usage. Uncheck to disable.',
        'settings.wordWrap': 'Word Wrap',
        'settings.wordWrapTip': 'Wrap long lines in the Markdown preview to fit within the viewport.',
        'settings.syncScroll': 'Synchronize Scrolling',
        'settings.syncScrollTip': 'Keep scroll positions synchronized between editor and preview.',
        'settings.previewLeft': 'Preview on Left',
        'settings.previewLeftTip': 'Show preview on the left side instead of the right in split mode.',
        'settings.showOutline': 'Show Outline',
        'settings.showOutlineTip': 'Display the document outline panel for heading navigation.',
        'settings.lineNumbers': 'Line Numbers',
        'settings.lineNumbersTip': 'Show line numbers in fenced code block previews.',
        'settings.moveMdButtonsToEnd': 'Move Enable/Disable MD Buttons Near Help',
        'settings.moveMdButtonsToEndTip': 'Place the Enable/Disable MD buttons just before Help & Feedback instead of at the start of the toolbar.',
        'settings.rtlTextDirection': 'RTL Text Direction',
        'settings.rtlTextDirectionTip': 'Force Right-to-Left (RTL) text direction for Markdown preview and editor.',
        'settings.language': 'Language',
        'settings.languageTip': 'Select the interface language for the editor (Auto, English, or 中文).',
        'settings.langAuto': 'Auto (Detect)',
        'settings.langEn': 'English',
        'settings.langZh': '中文 (Simplified Chinese)',

        // Context Menus
        'context.insertRowAbove': 'Insert row above',
        'context.insertRowBelow': 'Insert row below',
        'context.deleteRow': 'Delete row',
        'context.insertColLeft': 'Insert column left',
        'context.insertColRight': 'Insert column right',
        'context.deleteCol': 'Delete column',
        'context.textWrap': 'Text wrap',
        'context.firstRowAsHeader': 'First row as header',
        'context.sortAsc': 'Sort A to Z',
        'context.sortDesc': 'Sort Z to A',
        'context.filterNonEmpty': 'Filter Non-Empty',
        'context.clearColFilter': 'Clear Column Filter',
        'context.clearAllFilters': 'Clear All Filters/Sort',
        'context.filterTitle': 'Filter {0}',
        'context.contains': 'Contains',
        'context.equals': 'Equals',
        'context.startsWith': 'Starts with',
        'context.nonEmpty': 'Non-empty',
        'context.filterValue': 'Filter value',
        'context.noValueNeeded': 'No value needed',
        'context.caseSensitive': 'Case sensitive',
        'context.apply': 'Apply',
        'context.clear': 'Clear',
        'context.copy': 'Copy',
        'context.paste': 'Paste',
        'context.pastePrompt': 'Paste content:',
        'context.insertCellShiftRight': 'Insert cell and shift right',
        'context.insertCellShiftDown': 'Insert cell and shift down',
        'context.deleteCellShiftLeft': 'Delete cell and shift left',
        'context.deleteCellShiftUp': 'Delete cell and shift up',

        // Feedback Modal
        'feedback.title': 'Help & Feedback',
        'feedback.close': 'Close',
        'feedback.githubText': 'For issues requiring follow-up or detailed discussion, we recommend creating a GitHub issue. This allows for better tracking and collaboration.',
        'feedback.createIssue': 'Create Issue on GitHub',
        'feedback.systemInfo': 'System Information',
        'feedback.reasonTitle': 'What is the primary reason for filling out this form? *',
        'feedback.reasonBug': 'Bug/Support',
        'feedback.reasonGeneral': 'General Feedback',
        'feedback.reasonFeature': 'Feature Suggestion',
        'feedback.satisfactionTitle': 'How satisfied are you overall? *',
        'feedback.veryDissatisfied': 'Very Dissatisfied',
        'feedback.verySatisfied': 'Very Satisfied',
        'feedback.descTitle': 'Please describe your issue or suggestion *',
        'feedback.descPlaceholder': 'Describe your issue, bug, feedback, or feature suggestion...',
        'feedback.followUpTitle': 'Would you be open to a follow-up discussion? *',
        'feedback.followUpYes': "Yes, I'd like to be contacted",
        'feedback.followUpNo': 'No, I prefer not to be contacted',
        'feedback.email': 'Email Address *',
        'feedback.cancel': 'Cancel',
        'feedback.submit': 'Submit',
        'feedback.submitting': 'Submitting...',
        'feedback.warningText': 'You have selected not to follow up, so you will not receive any information about fixes made or suggestions implemented.',
        'feedback.submitAnyway': 'Submit Anyway',
        'feedback.success': 'Feedback submitted successfully!',
        'feedback.fail': 'Failed to submit feedback.',

        // Projects Modal
        'projects.title': 'Other Open Source Projects',
        'projects.desc': 'Check out some of my other open-source projects on GitHub:',

        // Outline
        'outline.title': 'Outline',
        'outline.hide': 'Hide outline',

        // Toasts & General
        'toast.renderingWorksheet': 'Rendering worksheet...',
        'toast.loadingMarkdown': 'Loading Markdown...',
        'toast.htmlCopied': 'HTML copied',
        'toast.copyFailed': 'Copy failed',
        'toast.filterCleared': 'Filter cleared',
        'toast.showingFilteredRows': 'Showing {0} filtered rows',
        'toast.selectTextToFormat': 'Select text to format',
        'toast.selectCellsToFormat': 'Select cells to format',
        'toast.selectionTooLarge': 'Selection too large for formatting. Please select a smaller range.',
        'toast.enterEditMode': 'Enter edit mode to insert controls',
        'toast.versionPreviewReadOnly': 'Version preview is read-only',
        'toast.langSwitchedZh': '已切换至中文',
        'toast.langSwitchedEn': 'Language switched to English',
        'toast.saved': 'Saved',
        'toast.autosaved': 'Autosaved',
        'toast.autosaveFailed': 'Autosave failed',
        'toast.errorSaving': 'Error saving',
        'toast.versionRestored': 'Version restored',
        'toast.previewCanceled': 'Preview canceled',
        'toast.previewingVersion': 'Previewing version',
        'toast.pdfGenerating': 'Generating PDF... Please wait.',
        'toast.pdfFailed': 'Failed to generate PDF: {0}',
        'toast.previewUnavailable': 'Preview not available.',
        'toast.versionHistoryFailed': 'Version history failed',
        'toast.tableStructureWysiwyg': 'Table structure actions are available in WYSIWYG mode',
        'toast.noTableFoundRow': 'No table found to add a row',
        'toast.placeCaretTableCell': 'Place the caret inside a table cell first',
        'toast.cannotRemoveLastRow': 'Cannot remove the last row in this section',
        'toast.noTableFoundCol': 'No table found to add a column',
        'toast.cannotRemoveLastCol': 'Cannot remove the last column',
        'toast.copied': 'Copied',
        'toast.linkCopied': 'Link copied',
        'toc.empty': 'No headings found'
    },
    zh: {
        // Toolbar
        'toolbar.setAsDefault': '设为默认',
        'toolbar.setAsDefaultTooltip': '将电子表格查看器设为 XLSX 文件的默认编辑器',
        'toolbar.enableMd': '启用 MD',
        'toolbar.enableMdTooltip': '为所有 Markdown 文件启用 Markdown 查看器 (设为默认)',
        'toolbar.disableMd': '禁用 MD',
        'toolbar.disableMdTooltip': '为所有 Markdown 文件禁用 Markdown 查看器',
        'toolbar.refresh': '从磁盘重新加载文件',
        'toolbar.rtl': 'RTL',
        'toolbar.rtlTooltip': '切换从右向左 (RTL) / 从左向右 (LTR) 文本方向',
        'toolbar.editFile': '编辑文件',
        'toolbar.editFileTooltip': '在默认文本编辑器中打开此文件',
        'toolbar.editFileMdTooltip': '在 VS Code 默认编辑器中编辑文件',
        'toolbar.editTable': '编辑表格',
        'toolbar.exitEdit': '退出编辑',
        'toolbar.editTableTooltip': '直接在表格中编辑 (仅限文本)',
        'toolbar.splitEdit': '分屏编辑',
        'toolbar.splitEditTooltip': '左右分屏编辑 Markdown',
        'toolbar.previewEdit': '所见即所得',
        'toolbar.previewEditTooltip': '直接在预览中编辑 (所见即所得)',
        'toolbar.save': '保存',
        'toolbar.saveTooltip': '保存表格修改',
        'toolbar.saveMdTooltip': '保存修改 (Ctrl+S)',
        'toolbar.cancel': '取消',
        'toolbar.cancelTooltip': '取消表格修改',
        'toolbar.cancelMdTooltip': '取消修改 (Esc)',
        'toolbar.bold': '加粗选中文本 (Ctrl/Cmd+B)',
        'toolbar.italic': '斜体选中文本 (Ctrl/Cmd+I)',
        'toolbar.textColor': '设置选中文本颜色',
        'toolbar.bgColor': '设置选中文本背景颜色',
        'toolbar.expand': '展开',
        'toolbar.collapse': '折叠',
        'toolbar.expandTooltip': '切换列宽 (默认 / 全部展开)',
        'toolbar.find': '在工作表中查找 (Ctrl/Cmd+F)',
        'toolbar.searchMd': '在预览中搜索 (Ctrl/Cmd+F)',
        'toolbar.plain': '纯文本',
        'toolbar.styled': '样式表',
        'toolbar.plainTooltip': '切换纯文本视图 (去除所有样式)',
        'toolbar.styledTooltip': '切换样式表视图',
        'toolbar.outline': '切换大纲',
        'toolbar.settings': '表格设置',
        'toolbar.settingsMd': '设置',
        'toolbar.insert': '插入',
        'toolbar.insertTooltip': '在所选单元格中插入复选框、下拉框、评分或日期',
        'toolbar.theme': '切换主题',
        'toolbar.focus': '专注模式',
        'toolbar.copyHtml': '复制为 HTML',
        'toolbar.exportPdf': '导出为 PDF',
        'toolbar.versionHistory': '版本历史',
        'toolbar.convert': '转换',
        'toolbar.convertTooltip': '转换此文件为 CSV、TSV 或 XLSX',
        'toolbar.projects': '其他开源项目',
        'toolbar.help': '帮助与反馈',
        'toolbar.languageButton': 'English',
        'toolbar.languageTooltip': '切换语言 (English / 中文)',

        // Markdown Formatting Toolbar
        'fmt.bold': '加粗 (Ctrl+B)',
        'fmt.italic': '斜体 (Ctrl+I)',
        'fmt.strikethrough': '删除线 (Ctrl+Shift+X)',
        'fmt.inlineCode': '行内代码 (Ctrl+E)',
        'fmt.heading1': '一级标题 (Ctrl+1)',
        'fmt.heading2': '二级标题 (Ctrl+2)',
        'fmt.heading3': '三级标题 (Ctrl+3)',
        'fmt.bulletList': '无序列表 (Ctrl+L)',
        'fmt.orderedList': '有序列表 (Ctrl+Shift+L)',
        'fmt.checkbox': '任务列表',
        'fmt.blockquote': '引用',
        'fmt.link': '插入链接 (Ctrl+K)',
        'fmt.image': '插入图片',
        'fmt.table': '插入表格',
        'fmt.tableAddRowBelow': '在下方添加行 (表格)',
        'fmt.tableRemoveRow': '删除当前行 (表格)',
        'fmt.tableAddColumnRight': '在右侧添加列 (表格)',
        'fmt.tableRemoveColumn': '删除当前列 (表格)',
        'fmt.codeBlock': '代码块 (Ctrl+Shift+E)',
        'fmt.hr': '水平分割线',
        'fmt.undo': '撤销 (Ctrl+Z)',
        'fmt.redo': '重做 (Ctrl+Shift+Z)',
        'fmt.duplicateLine': '复制当前行 (Ctrl+Shift+D)',
        'fmt.deleteLine': '删除当前行 (Ctrl+Shift+K)',
        'fmt.moveUp': '向上移动行 (Alt+↑)',
        'fmt.moveDown': '向下移动行 (Alt+↓)',
        'fmt.uppercase': '大写 (Ctrl+Shift+U)',
        'fmt.lowercase': '小写 (Ctrl+U)',
        'fmt.titlecase': '词首字母大写',
        'fmt.sortLines': '按字母排序行',
        'fmt.trimWhitespace': '去除行尾空格',
        'fmt.jumpToLine': '跳转到行 (Ctrl+G)',

        // Search & Find
        'find.placeholder': '查找',
        'find.ariaLabel': '在工作表中查找',
        'find.prevMatch': '上一个匹配项 (Shift+Enter)',
        'find.nextMatch': '下一个匹配项 (Enter)',
        'find.close': '关闭',
        'find.mdPlaceholder': '在预览中搜索...',
        'find.mdClose': '关闭 (Esc)',

        // Settings Panel
        'settings.close': '关闭',
        'settings.headerRow': '首行作为标题',
        'settings.headerRowTip': '将工作表的第一行作为标题行。',
        'settings.stickyHeader': '固定标题行',
        'settings.stickyHeaderTip': '在垂直滚动时保持标题行固定可见。',
        'settings.stickyToolbar': '固定工具栏',
        'settings.stickyToolbarTip': '在滚动时保持顶部工具栏固定。',
        'settings.allowControlsOutside': '无需编辑模式修改复选框/下拉框',
        'settings.allowControlsOutsideTip': '允许在不进入表格编辑模式的情况下切换复选框和选择下拉菜单。',
        'settings.hyperlinkPreview': '超链接悬浮预览',
        'settings.hyperlinkPreviewTip': '显示超链接悬浮操作，包括在浏览器中打开和复制链接。',
        'settings.spaciousCells': '宽松单元格',
        'settings.spaciousCellsTip': '增加行高和内边距，提升可读性。',
        'settings.textWrap': '自动换行',
        'settings.textWrapTip': '默认在单元格中启用自动换行。',
        'settings.mergeWarning': '合并单元格警告提示',
        'settings.mergeWarningTip': '合并单元格前提示确认，因为仅保留左上角单元格的值。',
        'settings.autoSave': '自动保存',
        'settings.autoSaveTip': '在修改文本、复选框、下拉框或格式后自动保存。',
        'settings.autoSaveControlsOnly': '自动保存：仅控件',
        'settings.autoSaveControlsOnlyTip': '仅自动保存复选框和下拉菜单等交互式控件的更改。',
        'settings.autoSaveAll': '自动保存：全部修改',
        'settings.autoSaveAllTip': '编辑后不久自动保存所有电子表格更改。',
        'settings.csvComma': 'CSV 分隔符：逗号 (,)',
        'settings.csvCommaTip': '使用逗号作为 CSV 文件的分隔符。',
        'settings.csvSemicolon': 'CSV 分隔符：分号 (;)',
        'settings.csvSemicolonTip': '使用分号作为 CSV 文件的分隔符。',
        'settings.manualSavePopup': '显示手动保存提醒',
        'settings.manualSavePopupTip': '未启用自动保存时，编辑后显示手动保存提醒。',
        'settings.showPopups': '显示通知弹窗',
        'settings.showPopupsTip': '在编辑器使用期间显示浮窗通知（如保存提示）。取消勾选可禁用。',
        'settings.wordWrap': '自动折行',
        'settings.wordWrapTip': '在 Markdown 预览中自动折行，使其适应视口宽度。',
        'settings.syncScroll': '同步滚动',
        'settings.syncScrollTip': '保持编辑器与预览窗格之间的滚动位置同步。',
        'settings.previewLeft': '左侧预览',
        'settings.previewLeftTip': '在分屏模式下将预览显示在左侧而不是右侧。',
        'settings.showOutline': '显示大纲',
        'settings.showOutlineTip': '显示文档大纲面板以便按标题导航。',
        'settings.lineNumbers': '代码行号',
        'settings.lineNumbersTip': '在代码块预览中显示行号。',
        'settings.moveMdButtonsToEnd': '移动启用/禁用按钮至帮助旁',
        'settings.moveMdButtonsToEndTip': '将启用/禁用 MD 按钮放置在帮助与反馈之前，而不是工具栏开头。',
        'settings.rtlTextDirection': 'RTL 文本方向',
        'settings.rtlTextDirectionTip': '强制 Markdown 预览和编辑器使用从右到左 (RTL) 文本方向。',
        'settings.language': '界面语言',
        'settings.languageTip': '选择编辑器的界面语言（自动、英文或中文）。',
        'settings.langAuto': '自动检测',
        'settings.langEn': '英文 (English)',
        'settings.langZh': '简体中文',

        // Context Menus
        'context.insertRowAbove': '在上方插入行',
        'context.insertRowBelow': '在下方插入行',
        'context.deleteRow': '删除行',
        'context.insertColLeft': '在左侧插入列',
        'context.insertColRight': '在右侧插入列',
        'context.deleteCol': '删除列',
        'context.textWrap': '文本换行',
        'context.firstRowAsHeader': '首行作为标题行',
        'context.sortAsc': '升序排序 (A 到 Z)',
        'context.sortDesc': '降序排序 (Z 到 A)',
        'context.filterNonEmpty': '筛选非空',
        'context.clearColFilter': '清除列筛选',
        'context.clearAllFilters': '清除所有筛选与排序',
        'context.filterTitle': '筛选 {0}',
        'context.contains': '包含',
        'context.equals': '等于',
        'context.startsWith': '开头是',
        'context.nonEmpty': '非空',
        'context.filterValue': '筛选值',
        'context.noValueNeeded': '无需输入值',
        'context.caseSensitive': '区分大小写',
        'context.apply': '应用',
        'context.clear': '清除',
        'context.copy': '复制',
        'context.paste': '粘贴',
        'context.pastePrompt': '粘贴内容：',
        'context.insertCellShiftRight': '插入单元格并右移',
        'context.insertCellShiftDown': '插入单元格并下移',
        'context.deleteCellShiftLeft': '删除单元格并左移',
        'context.deleteCellShiftUp': '删除单元格并上移',

        // Feedback Modal
        'feedback.title': '帮助与反馈',
        'feedback.close': '关闭',
        'feedback.githubText': '对于需要后续跟进或详细讨论的问题，建议在 GitHub 上提交 Issue，以便更好地跟踪与协作。',
        'feedback.createIssue': '在 GitHub 上提交 Issue',
        'feedback.systemInfo': '系统信息',
        'feedback.reasonTitle': '填写此表单的主要原因是什么？ *',
        'feedback.reasonBug': '问题报告 / 支持',
        'feedback.reasonGeneral': '常规反馈',
        'feedback.reasonFeature': '功能建议',
        'feedback.satisfactionTitle': '您对本扩展的整体满意度如何？ *',
        'feedback.veryDissatisfied': '非常不满意',
        'feedback.verySatisfied': '非常满意',
        'feedback.descTitle': '请描述您遇到的问题或建议 *',
        'feedback.descPlaceholder': '请在此详细描述您的问题、缺陷、反馈或功能建议...',
        'feedback.followUpTitle': '您是否愿意接受后续沟通？ *',
        'feedback.followUpYes': '是的，我愿意接收联系',
        'feedback.followUpNo': '不，我不想接收联系',
        'feedback.email': '电子邮箱 *',
        'feedback.cancel': '取消',
        'feedback.submit': '提交反馈',
        'feedback.submitting': '正在提交...',
        'feedback.warningText': '您选择了不跟进，因此您将不会收到关于修复或建议实施情况的信息。',
        'feedback.submitAnyway': '仍要提交',
        'feedback.success': '反馈提交成功！',
        'feedback.fail': '提交反馈失败。',

        // Projects Modal
        'projects.title': '其他开源项目',
        'projects.desc': '查看作者在 GitHub 上的其他开源项目：',

        // Outline
        'outline.title': '大纲',
        'outline.hide': '隐藏大纲',

        // Toasts & General
        'toast.renderingWorksheet': '正在渲染工作表...',
        'toast.loadingMarkdown': '正在加载 Markdown...',
        'toast.htmlCopied': 'HTML 代码已复制',
        'toast.copyFailed': '复制失败',
        'toast.filterCleared': '筛选已清除',
        'toast.showingFilteredRows': '显示 {0} 条筛选结果',
        'toast.selectTextToFormat': '请选择要设置格式的文本',
        'toast.selectCellsToFormat': '请选择要设置格式的单元格',
        'toast.selectionTooLarge': '所选范围过大，请选择较小的范围进行格式设置。',
        'toast.enterEditMode': '请进入编辑模式以插入控件',
        'toast.versionPreviewReadOnly': '版本预览为只读模式',
        'toast.langSwitchedZh': '已切换至中文',
        'toast.langSwitchedEn': 'Language switched to English',
        'toast.saved': '已保存',
        'toast.autosaved': '已自动保存',
        'toast.autosaveFailed': '自动保存失败',
        'toast.errorSaving': '保存出错',
        'toast.versionRestored': '版本已恢复',
        'toast.previewCanceled': '预览已取消',
        'toast.previewingVersion': '正在预览历史版本',
        'toast.pdfGenerating': '正在生成 PDF，请稍候...',
        'toast.pdfFailed': '生成 PDF 失败：{0}',
        'toast.previewUnavailable': '预览不可用。',
        'toast.versionHistoryFailed': '获取版本历史失败',
        'toast.tableStructureWysiwyg': '表格结构操作仅在所见即所得 (WYSIWYG) 模式下可用',
        'toast.noTableFoundRow': '未找到可添加行的表格',
        'toast.placeCaretTableCell': '请先将光标放置在表格单元格中',
        'toast.cannotRemoveLastRow': '无法删除该区域的最后一行',
        'toast.noTableFoundCol': '未找到可添加列的表格',
        'toast.cannotRemoveLastCol': '无法删除最后一列',
        'toast.copied': '已复制',
        'toast.linkCopied': '链接已复制',
        'toc.empty': '未找到标题'
    }
};

export class I18n {
    private static currentSetting: LanguageSetting = 'auto';
    private static resolvedLanguage: SupportedLanguage = 'en';
    private static listeners: Array<(lang: SupportedLanguage) => void> = [];
    private static vscodeApi: any = null;
    private static hasExplicitUserChoice = false;

    /**
     * Regex matching Chinese characters (CJK Unified Ideographs)
     */
    private static CHINESE_REGEX = /[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff0f]/;

    public static setVsCodeApi(api: any) {
        this.vscodeApi = api;
    }

    /**
     * Initializes the I18n system.
     * Checks local storage, VS Code settings, VS Code UI language, and browser language.
     */
    public static init(configuredSetting?: string, vscodeLang?: string, sampleContent?: string) {
        // Read stored preference
        let saved: string | null = null;
        try {
            saved = localStorage.getItem(STORAGE_KEY);
        } catch {
            // Ignore localStorage errors in restricted environments
        }

        if (saved === 'zh' || saved === 'en') {
            this.currentSetting = saved;
            this.resolvedLanguage = saved;
            this.hasExplicitUserChoice = true;
        } else if (saved === 'auto') {
            this.currentSetting = 'auto';
            this.hasExplicitUserChoice = false;
            this.resolvedLanguage = this.detectLanguage(sampleContent, vscodeLang);
        } else if (configuredSetting === 'zh' || configuredSetting === 'en') {
            this.currentSetting = configuredSetting;
            this.resolvedLanguage = configuredSetting;
            this.hasExplicitUserChoice = true;
        } else {
            this.currentSetting = 'auto';
            this.hasExplicitUserChoice = false;
            this.resolvedLanguage = this.detectLanguage(sampleContent, vscodeLang);
        }

        this.applyToHtml();
    }

    /**
     * Autodetects whether Chinese or English is more appropriate.
     */
    public static detectLanguage(sampleContent?: string, vscodeLang?: string): SupportedLanguage {
        // 1. Check VS Code environment language
        if (vscodeLang && typeof vscodeLang === 'string') {
            const lower = vscodeLang.toLowerCase();
            if (lower.startsWith('zh')) {
                return 'zh';
            }
        }

        // 2. Check browser / system navigator language
        if (typeof navigator !== 'undefined') {
            const navLang = (navigator.language || (navigator as any).userLanguage || '').toLowerCase();
            if (navLang.startsWith('zh')) {
                return 'zh';
            }
            if (Array.isArray(navigator.languages)) {
                for (const l of navigator.languages) {
                    if (l.toLowerCase().startsWith('zh')) {
                        return 'zh';
                    }
                }
            }
        }

        // 3. Check sample content for Chinese text
        if (sampleContent && typeof sampleContent === 'string' && this.CHINESE_REGEX.test(sampleContent)) {
            return 'zh';
        }

        return 'en';
    }

    /**
     * Inspects content dynamically. If user hasn't made an explicit manual choice,
     * switches to Chinese if Chinese content is detected.
     */
    public static detectAndApplyFromContent(content: string) {
        if (this.hasExplicitUserChoice || this.currentSetting !== 'auto') {
            return;
        }
        if (content && this.CHINESE_REGEX.test(content)) {
            if (this.resolvedLanguage !== 'zh') {
                this.resolvedLanguage = 'zh';
                this.applyToHtml();
                this.notifyListeners();
            }
        }
    }

    public static getLanguage(): SupportedLanguage {
        return this.resolvedLanguage;
    }

    public static getLanguageSetting(): LanguageSetting {
        return this.currentSetting;
    }

    public static isChinese(): boolean {
        return this.resolvedLanguage === 'zh';
    }

    public static getLanguageButtonLabel(): string {
        return this.resolvedLanguage === 'zh' ? 'English' : '中文';
    }

    public static setLanguage(setting: LanguageSetting, persist: boolean = true) {
        this.currentSetting = setting;
        if (setting === 'auto') {
            this.hasExplicitUserChoice = false;
            this.resolvedLanguage = this.detectLanguage();
        } else {
            this.hasExplicitUserChoice = true;
            this.resolvedLanguage = setting;
        }

        if (persist) {
            try {
                localStorage.setItem(STORAGE_KEY, setting);
            } catch {
                // Ignore storage error
            }

            if (this.vscodeApi) {
                try {
                    this.vscodeApi.postMessage({
                        command: 'setLanguage',
                        language: setting
                    });
                } catch {
                    // Ignore message error
                }
            }
        }

        this.applyToHtml();
        this.notifyListeners();
    }

    /**
     * Toggles between English and Chinese.
     */
    public static toggleLanguage(): SupportedLanguage {
        const nextLang: SupportedLanguage = this.resolvedLanguage === 'zh' ? 'en' : 'zh';
        this.setLanguage(nextLang, true);
        return nextLang;
    }

    /**
     * Translate string by key with optional argument replacement.
     */
    public static t(key: string, defaultText?: string, ...args: Array<string | number>): string {
        const langDict = translations[this.resolvedLanguage] || translations.en;
        let text = langDict[key] || translations.en[key] || defaultText || key;

        if (args && args.length > 0) {
            args.forEach((arg, index) => {
                text = text.replace(new RegExp(`\\{${index}\\}`, 'g'), String(arg));
            });
        }

        return text;
    }

    public static onLanguageChange(listener: (lang: SupportedLanguage) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private static notifyListeners() {
        this.listeners.forEach(fn => {
            try {
                fn(this.resolvedLanguage);
            } catch (err) {
                console.error('Error in i18n listener:', err);
            }
        });
    }

    private static applyToHtml() {
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.lang = this.resolvedLanguage === 'zh' ? 'zh-CN' : 'en';
        }
    }
}
