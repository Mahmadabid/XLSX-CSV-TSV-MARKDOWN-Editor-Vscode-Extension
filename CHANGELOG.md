# Changelog

## v1.9.91 - Sticky Header Layout and Border Fixes
- Fixed sticky header disappearing when scrolling past the first few rows (virtual scrolling logic now keeps row 0 rendered).
- Fixed the row header "1" cell not staying sticky when the header is sticky.

## v1.9.9 - Text Wrap Settings & Projects Modal
- Added a default "Text Wrap" setting (defaulting to off) for XLSX, CSV, and TSV files.
- Added a right-click context menu "Text Wrap" toggle for cells, rows, and columns to wrap specific selections.
- Optimized text wrap settings application to be smooth and CSS-only, avoiding a visible blank screen/flicker.
- Added a toolbar button before Help & Feedback that lists other open source projects (`openpart` and `vibed-puppet`) in a beautiful modal, across all 4 editor formats (XLSX, CSV, TSV, Markdown).

## v1.9.8 - Styled Mode Simple Editing
- Allowed simple direct editing in spreadsheet styled mode without entering full table edit mode, matching the plain mode behavior.
- Added a refresh button to the toolbar to manually refresh the file from disk.

## v1.9.7 - Live Reload Support
- Added live-reload support to automatically refresh the spreadsheet and markdown editors when files are modified externally (e.g., via Notepad or another external tool).
- Added filesystem watchers to track disk updates for spreadsheet (.xlsx, .csv, .tsv) and markdown (.md) documents.
- Integrated a prevention mechanism for internal saves to avoid infinite loop refreshes.

## v1.9.6 - Column Header Sort Menu Checkbox
- Added a "First row as header" checkbox directly in the column context menu above the sort options.
- Prevented the header row from being sorted or filtered when "First row as header" is checked.
- Changed default setting of "First row as header" to checked (true) for CSV, TSV, and XLSX files.

## v1.9.5 - Support Paste, Context Menus, Markdown Flowcharts, and Copy Optimization
- Added support for pasting spreadsheet grid data (using tab and newline delimiters).
- Added Copy and Paste actions directly in the cell right-click context menu.
- Optimized copying of large ranges of cells (making it instant for 10000+ cells).
- Added Mermaid flowchart and diagram rendering support in Markdown editor and preview.

## v1.9.4 - Name Fix
- Reverted the accidental name change.

## v1.9.3 - Bug Fixes
- Fixed an issue where the Backspace and Delete keys would not work in the spreadsheet editor.

## v1.9.2 - Fixed Cell and Header Actions
- Fixed an issue where delete column/row actions were not working.
- Fixed an issue where the header row toggle would not open the settings panel.

## v1.9.1 - Markdown mathemical formula rendering fix
- Added support for rendering mathematical formulas in Markdown files using KaTex.

## v1.9.0 - Checkbox bug fix
-- FIx a bug where 1 and 0 values in xlsx files would be rendered as checkboxes, now only cells with the "checkbox" format will be rendered as checkboxes.

## v1.8.9 - Unified XLSX/CSV/TSV Webviews & fixed some bugs
- Unified the XLSX, CSV, and TSV editors into a single webview implementation with same features and toolbar for all formats like google sheets.
- Now just like google sheets, styles can be added to csv and tsv files as well and they will be preserved in a temporary cache for 48 hours, surviving file close and reopen.
- Added a setting to control the visibility of the "Edit Table" button in CSV/TSV files, allowing users to choose between direct editing and table edit mode.
- Added sort adn filter for spreadsheet files.
- Improved version history reliability.

## v1.8.8 - System Info Editor Name & Feedback Modal Spacing
- Added editor name detection (VS Code, Cursor, etc.) to system information in feedback modal

## v1.8.7 - Feedback Modal UI & Markdown Relative Links
- Added support for relative links in Markdown files.
- Modified help and feedback UI, now opens the form directly in the vscode and user can submit feedback without leaving vscode.

## v1.8.6 - Bug Fixes
- Fixed an issue where the hover changed the text color of cells in csv and tsv.

## v1.8.5 - UI Polish & New Features
- Changed the theme toggle button to a pill-shaped toggle.
- Added support for checkbox, dropdown, rating and date in xlsx.
- Repolished the table UI.
- Added autosave in settings for csv, tsv and xlsx.
- Fixed the bug where the toolbar wouldn't occupy full width of the editor when the window is scrolled.
- Added support for images in xlsx.

## v1.8.4 - Google Sheets-Style Editing Features
- Added Find in the toolbar for CSV, TSV, and XLSX.
- Added text alignment (horizontal and vertical), borders, font size, font family, wrap text strikethrough, painter, clear formatting, and merge cell controls in XLSX edit mode.

## v1.8.3 - Cross-Format File Conversion
- Added centralized file conversion system to convert between CSV, TSV, and XLSX.
- Added a "Convert" action directly in CSV/TSV/XLSX toolbars for supported formats.
- Implemented conversion logic for multi-sheet XLSX to single-sheet formats (notifies when extra sheets are dropped).
- Centralized tabular data handling to allow easy addition of future formats.

## v1.8.2 - Version History, Undo/Redo, and Focus Fixes
- Fixed Version History preview/restore flow so preview remains read-only until Restore is confirmed.
- Improved Undo/Redo handling to preserve non-structural scroll position and avoid data loss during table edits.
- Replaced the version history button label with an SVG-only icon in table/XLSX toolbars.
- Added focus capture to table and XLSX webviews so clicking the grid clears file selection and Delete targets the table cell.
- Mirrored version-history preview behavior into the XLSX and MD editor for a consistent experience across CSV, TSV, MD and XLSX.
- Fixed sticky toolbar and header layout issues in xlsx and md.
- Added Spacious Cells support to XLSX tables, matching the CSV/TSV behavior.
- Fixed ctrl + z and ctrl + y not working properly in xlsx edit mode.
- Modified UI for xlsx to match the google sheets style more closely.

## v1.8.1 - Copy Fix & Version History
- Fixed an issue where Ctrl+C, Ctrl+V, and Ctrl+A were incorrectly intercepted while editing a cell, restoring native browser text selection.
- Redesigned and centered the Autosave confirmation alert for better visibility.
- Updated Ctrl+Z and Ctrl+Y to properly handle custom Undo/Redo tracking behaviors inside the editor.
- Added a new Version History timeline and button, archiving the last 2 days of historical states to allow precise structural restoration.

## v1.8.0 - Spacious Cells & UI Fixes
- Added support for spacious cells in the table view.
- Fixed the unsticky toolbar leaving empty space below the table and lacking background color.
- Fixed the sticky header offset gap when spacious cells and sticky headers are both enabled.
- Changed UI for csv and tsv to match the google sheets style more closely.
- Removed Edit Table button and allowed editing directly in the table view for csv and tsv.
- Added autosave for csv and tsv when editing directly in the table view.
- Added row and column addition and deletion for csv and tsv in the table view.
- Added cell deletion and shift up/left for csv and tsv in the table view.

## v1.7.9 - XLSX Edit Mode & Formatting Fixes
- Fixed XLSX table edit mode so background color targets the active cell instead of leaking to multiple previously-selected cells.
- Fixed XLSX table edit mode cell selection behavior for reliable single-cell targeting.
- Fixed rich-text visibility in XLSX edit mode so bold/italic formatting remains visible while editing.
- Improved rich-text save/load consistency for XLSX table edits.
- Fixed table edit mode for csv and tsv.

## v1.7.8 - Markdown Preview Edit Undo/Redo Fixes
- Fixed Preview Edit undo/redo so `Ctrl+Z` and `Ctrl+Y` now work reliably for table row/column add/remove actions.
- Prevented undo/redo shortcuts in Preview Edit from falling through to VS Code and undoing unrelated file editor actions.
- Added dedicated Preview Edit history tracking for contenteditable changes and table structure mutations.
- Fixed an issue where the Add Row, Column action could modify the wrong table when multiple tables are present.

## v1.7.7 - Markdown Outline & Heading Cleanup
- Fixed a regression where old heading copy-link artifacts could pollute the Outline and rendered heading text.
- Markdown save now strips stale internal `[ # ](#... "Copy link")` heading fragments left behind by earlier saves.
- Improved split-view sync scroll mapping so editor and preview stay aligned more reliably after resize and wrapped content changes.
- Fixed the outline panel showing unnecessary information for headings that have copy links.

## v1.7.6 - Markdown Preview Edit & Code Block Fixes
- Fixed a Preview Edit save bug where headings could gain extra `#` characters because heading anchor UI leaked into markdown conversion.
- Tightened the code block line-number gutter to remove the leftover blank space before line numbers.
- Improved code block readability and table insertion behavior in Markdown preview edit mode.

## v1.7.5 - Local image support in Markdown preview
- Fixed an issue where local image paths (relative/absolute/file URIs) in Markdown did not load in the webview preview.

## v1.7.4 - Markdown Edit & Layout Bug Fixes
- Added **Preview Edit** mode.
- Split‑view edit no longer opens with the editor pane scrolled all the way to the right.
- "Preview on Left" setting respects split‑view layout and no longer collapses the panels vertically.
- Heading anchor links are hidden while in preview‑edit mode to prevent visual clutter.

## v1.7.3 - Advanced Markdown Editing & UI Fixes
- **Outline Toggle Button Fix**: The outline toggle button now shows a visible accent-colored background when active, making it clearly distinguishable from inactive state.
- **Formatting Toolbar**: A full formatting toolbar appears in edit mode with grouped buttons for text formatting, headings, lists, inserts, undo/redo, line operations, and text transforms.
- **New Editing Features**:
  - **Duplicate Line** (Ctrl+Shift+D): Duplicate the current line below.
  - **Delete Line** (Ctrl+Shift+K): Delete the current line.
  - **Move Line Up/Down** (Alt+Up/Down): Move the current line or selection up or down.
  - **Select Word** (Ctrl+D): Select the word at cursor.
  - **Go to Line** (Ctrl+G): Jump to a specific line number.
  - **Transform Case**: Uppercase (Ctrl+Shift+U), lowercase (Ctrl+U), and Title Case transforms for selected text.
  - **Sort Lines**: Sort selected lines alphabetically.
  - **Trim Trailing Whitespace**: Remove trailing spaces from all lines.
- **Scroll Performance**: All scroll handlers now use requestAnimationFrame throttling and passive event listeners. Data-line element queries are cached for smoother sync scrolling.
- **Outline Auto-Scroll**: The TOC panel now auto-scrolls to keep the active heading visible as you scroll through the document.

## v1.7.2 - Remove heading anchors & fix external link popup
- Removed heading anchor copy links from Markdown preview.
- Fixed external link handling so VS Code's confirmation popup opens correctly (added e.stopPropagation on link clicks).
- Minor CSS cleanup to remove heading anchor styles.

## v1.7.1 - Markdown Outline & UI Tweaks
- **Markdown Outline**: Added an Outline panel with heading navigation and a setting to control its visibility via the Settings panel.
- **Copy Enhancements**: Added **Copy** buttons for code blocks, heading anchors that copy deep links to the clipboard, and improved inline/code block labeling.
- **External Link Handling**: External links now open via VS Code's external API for consistent behavior.
- **UI Tweaks & Fixes**: Refined button colors, fixed split-edit visibility for Save/Cancel, and improved heading anchor UX.

## v1.7.0 - XLSX Toolbar Fix
- Restored the XLSX sheet selector at the start of the toolbar.

## v1.6.9 - Editor Association Fixes
- Fixed bug where disabling the Markdown custom editor could leave workspace or workspace-folder settings such that new `.md` files still opened in the extension. The disable flow now removes `xlsxViewer.md` associations across all configuration scopes (Global, Workspace, Workspace Folder) so your chosen default editor is preserved.
- Set the Markdown custom editor priority to `option` so it won't open automatically unless explicitly selected.

## v1.6.8 - Theme & UI Fixes
- **Settings Panel**: Fixed settings panel colors so they now follow the active VS Code theme when `vscode` theme mode is selected; checkboxes are themed and accessible.
- **Tooltips**: Root/global tooltip background was changed from black to the root theme background so it matches the overall theme and improves contrast.
- **Visual Tweaks**: Refined glass backdrop and shadow values for better integration with VS Code widgets and improved focus/contrast for checkboxes.

## v1.6.7 - Editor Association Management
- **Markdown Editor Controls**: Added a toolbar **Disable MD** button in the Markdown viewer that lets users disable the extension for `.md` files. The button prompts for confirmation, removes the association, and triggers VS Code's **"Reopen With..."** picker to select a new default editor.
- **Enable Button for Markdown**: When viewing a Markdown file via "Open With..." while it is not the default editor, an **Enable MD** button appears in the toolbar to quickly set XLSX Viewer as the default for `.md` files.
- **Set as Default for All File Types**: Added a **"Set as Default"** button (lightning bolt icon) to CSV, TSV, and XLSX viewers. This button only appears when this extension is NOT currently the default editor for that file type, allowing you to quickly make XLSX Viewer the default.
- **XLSX Viewer Shortcut**: Added an "Open in XLSX Viewer" button in the editor title bar for `.xlsx` files, allowing you to quickly switch to this extension's viewer when the file is opened in another editor.
- **UI**: Added new `Zap` and `ZapOff` icons for managing editor associations.

## v1.6.6 - Help & Feedback
- **Help Button**: Added a help button to the toolbar in all webviews (XLSX, CSV, TSV, Markdown) to easily access documentation and provide feedback.

## v1.6.5 - Markdown Viewer & Editor
- **Markdown Viewer & Editor (.md)**: Added a new Github Flavored Markdown viewer & editor for `.md` files with preview and edit modes, a toolbar (Edit Preview, Save, Cancel, Word Wrap, Settings), and a lightweight renderer for common Markdown (.md) features (headers, lists, code blocks, tables, task lists, images, links).
- **Split Edit Mode**: Live preview with synchronized scrolling between editor and preview panes.
- **Repository Update**:
  - Updated GitHub repository URL to `https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension`.

## v1.6.4 - Plain View Styling & Repository Update
- **Plain View Styling**:
  - Fixed header row styling in plain view mode to match CSV behavior (bold text with header background).
  - Sticky header now properly displays with theme colors in plain view mode.
- **Repository Update**:
  - Updated GitHub repository URL to `https://github.com/Mahmadabid/XLSX-CSV-TSV-Editor-Vscode-Extension`.

## v1.6.3 - XLSX Plain View & Virtualization
- **Plain View Mode**:
  - Added **Plain View** button to XLSX toolbar that removes all Excel styling (colors, fonts, borders) and displays data like CSV/TSV.
  - Toggle between styled and plain view for cleaner data inspection.
- **XLSX Virtualization**:
  - Added virtualization (windowed rendering) for XLSX files to drastically improve performance and reduce memory usage when opening large spreadsheets.
  - Implemented virtual scrolling and adaptive row rendering so only visible rows are rendered at any time.

## v1.6.2 - Minor Fixes
- **Minor Fixes**:
  - Fixed xlsx color issues in vscode/dark mode.

## v1.6.1 - Minor Fixes
- **Minor Fixes**:
  - Fixed xlsx color issues in vscode mode.

## v1.6.0 - TSV Support
- **New Name & Description**:
  - Extension renamed from `XLSX Viewer & CSV Editor` to `XLSX, CSV & TSV Editor` to better reflect its expanded functionality.
- **TSV Support**:
  - Added a new **TSV Viewer & Editor** with the same features as the CSV editor (table view, in-table Edit/Save/Cancel, virtualization for large files, copy/paste compatible with Excel/Google Sheets using tab delimiters).
  - The editor toolbar, settings panel, and the **Open in Table View** command now support `.tsv` files.

## v1.5.9 - Minor Fixes
- **Minor Fixes**:
  - Fixed table stretching issue when opening CSV files in certain window sizes.

## v1.5.8 - Bug Fixes
- **Bug Fixes**:
  - Resolved copy and scrollbar related bugs in CSV editor.

## v1.5.7 - CSV Virtualization
- **CSV Virtualization**:
  - Added virtualization (windowed rendering) for CSV files to drastically improve performance and reduce memory usage when opening large CSVs.
  - Implemented virtual scrolling and adaptive row rendering so only visible rows are rendered at any time.

## v1.5.6 - VS Code Theme Support
- **VS Code Theme Support**:
  - Added **VS Code** theme option that mirrors the editor's native theme (Light / Dark / High Contrast).
  - New `ThemeManager` component centralizes theme logic and persistence.
  - **Persistent Theme**: The extension now automatically remembers your last used theme and applies it to new files.
  - Interactive tooltip on the theme button with quick-switch action and accessibility labels.

## v1.5.5 - Dark Mode Fixes
- **Dark Mode Fixes**:
  - Corrected text color in dark mode for XLSX views to ensure readability.
  - Updated CSS rules to maintain consistent appearance across different themes.
  - Ensured that default cell colors adapt properly in dark mode without losing visibility.

## v1.5.4 - XLSX Editing & UI Improvements
- **New Name & Description**:
  - Extension renamed from `XLSX Viewer & CSV Editor` to `XLSX, CSV & TSV Editor` to better reflect its expanded functionality.
  - Updated extension description to highlight both XLSX viewing/editing and CSV editing capabilities.
- **XLSX Editing & Toolbar (New approach)**:
  - Introduced **in-webview table editing** for XLSX files: toggle **Edit** to make changes, then **Save** to persist changes back to the `.xlsx` file or **Cancel** to discard.
  - **Implementation detail**: edits are applied in the webview and written to disk using ExcelJS; the extension attempts to preserve formatting and merged cells where possible.
  - Added **Undo/Redo** support and keyboard shortcuts for edit mode (Ctrl+S / Ctrl+Z / Ctrl+Y / Enter).
  - **Toolbar & Settings parity**: toolbar controls and the Settings panel (header toggle, sticky header, sticky toolbar, hyperlink preview) were added to XLSX views to match CSV editor UX.
  - **UX improvements**: refined toolbar responsiveness, consistent sticky headers, and polished visual styles across XLSX and CSV editors.

## v1.5.3 - UI Polish & Settings UX
- **UI Polish & Settings UX**:
  - Redesigned **Settings panel** with backdrop blur, smoother rounded corners, grouped checkboxes, and responsive Cancel button that wraps on small screens.
  - Settings panel features:
    - **Header Row**: toggle the first row to be treated as header (bold first row).
    - **Sticky Header**: keep the first row sticky when header is enabled.
    - **Sticky Toolbar**: keep the toolbar fixed at the top of the editor.

## v1.5.2 - Premium UX Refinements & Bug Fixes
- **Premium CSV Editor UX**:
  - Added **Undo (Ctrl+Z)** and **Redo (Ctrl+Y)** functionality in table edit mode.
  - Improved Keyboard Navigation: **Enter** key now moves to the cell below instead of adding a newline.
  - Refined **Save Behavior**: Ctrl+S now saves changes, clears selection, and blurs active cell without exiting edit mode.
  - Added visual **Save Confirmation** (premium horizontal toast with green tick).
  - Added **Edit Mode Indicator**: Sharp outer border and active cell highlighting.
  - Fixed horizontal scrolling and text truncation issues in edit mode.
  - Added subtle hover highlights for table cells.

## v1.5.1 - CSV Table Editing
- Added in-table **Edit Table** mode for CSV files with **Save** and **Cancel** actions.
- While editing, the **Edit File** and **Edit Table** buttons are hidden to reduce accidental mode switching.
- Improved webview reliability by waiting for the webview to be ready before streaming table rows.

## v1.5.0 - Merged Cells & Resizing Support

### **Merged Cell Support:**
- Full support for both horizontal and vertical merged cells from Excel files
- Proper content alignment and positioning within merged cells
- Maintains original Excel formatting and alignment

### **Interactive Resizing:**
- Drag column borders to resize column widths
- Drag row borders to resize row heights
- Visual resize handles on headers with hover effects
- Real-time size indicators during resizing

### **Auto-Fit Functionality:**
- Auto-fit button to automatically resize all columns based on content
- Double-click column borders to auto-fit individual columns
- Double-click row borders to auto-fit individual rows
- Smart content-based sizing with maximum width limits

## v1.4.0 - Excel-like Multi-Selection & Copy
- **Multi-Selection for Rows/Columns:**
  - Hold <kbd>Ctrl</kbd> and click multiple row or column headers to select/deselect multiple rows or columns.
  - Hold <kbd>Shift</kbd> and click to select a range of rows or columns.
- **Excel/Google Sheets Compatible Copy:**
  - Pasting into Excel or Google Sheets will place data in the correct cells, not a single cell.
- **Improved Selection Management:**
  - Visual feedback for multi-row and multi-column selection.
  - Selection info box shows the size of the current selection, Displayed at bottom right corner.

## v1.3.0 - Enhanced Selection Features
- **Text Selection**: Added text selection for copying with ease.
- **Cell Selection**: Improved cell, row, and column selection functionality
- **Dark Mode Support**: Enhanced text selection visibility in both light and dark modes
- **UI Improvements**: Better visual feedback for selections and copying

## v1.2.0 - Enhanced Toggle Background
- **Improved Toggle Background**: Updated toggle button functionality for light and dark modes with alternating icons.
- **UI Enhancements**: Adjusted icon sizes and improved visual consistency.

## v1.1.0 - XLSX Viewer & CSV Editor (New Name)
- **New Name**: Previously known as `XLSX Viewer`.
- **Features**: Added CSV file editing capabilities in a structured table view.
- **Bug Fixes**: Improved performance and UI enhancements.

## v1.0.0 - XLSX Viewer
- Initial release with basic functionality for viewing Excel files.
