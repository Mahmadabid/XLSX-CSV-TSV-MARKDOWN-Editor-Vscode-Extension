# XLSX, CSV, TSV & Markdown Editor - VS Code Extension

This is an open-source project that allows you to view and edit XLSX files with styles, fonts, and colors from Excel files, supporting multiple sheets. Additionally, it provides a table view and editing capabilities for CSV, TSV, and Github Flavored Markdown (.md) files directly in VS Code.

## 📌 Overview

This extension goes beyond basic file viewing—it transforms VS Code into a fully functional data and text manipulation hub. Whether you need to analyze large datasets, format an Excel report, convert between tabular formats, or author Markdown documentation with a live sync-scroll preview, everything is available right in your editor.

> **🚨 Notice:** This extension has evolved significantly! Originally named **`XLSX Viewer & CSV Editor`**, it is now a unified editor supporting rich Google Sheets-like features for XLSX, advanced large-file handling for CSV/TSV, and a complete GitHub-Flavored Markdown (GFM) editing experience.

---

## 🚀 Key Features

### 📊 Full-Featured Spreadsheet Editor (XLSX, CSV, TSV)
Experience a robust, premium grid interface designed to mirror industry-standard spreadsheet applications.
- **Google Sheets-Style Editing:** Rich text formatting (Bold, Italic, Strikethrough), text alignment, borders, font size, font family, text wrapping, clear formatting, and format painter for XLSX files. (Not available for CSV and TSV files)
- **Advanced Cell Controls:** Support for checkboxes, dropdowns, ratings, dates, and images directly within your XLSX files. (Not available for CSV and TSV files)
- **Find & Navigation:** Built-in Find toolbar across CSV, TSV, and XLSX.
- **Cross-Format Conversion:** Seamlessly convert files between CSV, TSV, and XLSX directly from the editor toolbar.
- **Version History & Rollback:** Automatically archives recent states allowing precise structural restoration and undo/redo operations.
- **Autosave & Persistence:** Configurable autosave functionality ensures you never lose data.
- **Large File Virtualization:** Windowed rendering for CSV, TSV, and XLSX ensures rapid load times and low memory usage even with massive datasets.
- **Excel-like Selection & Navigation:** Multi-row/column selection (using <kbd>Ctrl</kbd> / <kbd>Shift</kbd>), cell resizing, auto-fit (double-click borders), and full keyboard navigation.
- **Plain View Mode:** Strip all Excel styling to view data like CSV/TSV for cleaner inspection.

### 📝 Advanced Markdown Viewer & Editor
Authoring Markdown has never been smoother with our integrated preview and edit modes.
- **Split-View with Sync Scroll:** Edit your `.md` file on one side and see real-time updates on the other, with perfectly synchronized scrolling.
- **Preview Edit Mode:** Edit markdown directly within the rendered preview using a rich formatting toolbar.
- **GitHub-Flavored Markdown (GFM):** Full support for tables, task lists, code blocks, and footnotes.
- **Interactive Outline Panel:** Navigate long documents easily with an auto-scrolling Table of Contents.
- **Local Asset Support:** Seamlessly render relative links and local images.
- **Code Block Enhancements:** Copy buttons and line numbers built straight into fenced code blocks.

### 🎨 Premium UI & Theming
- **Native VS Code Integration:** Fully respects your active VS Code theme (Light / Dark / High Contrast), ensuring the editor feels like a built-in feature.
- **Customizable Experience:** Toggle headers, sticky toolbars, spacious cell padding, and hyperlink hover previews.
- **Glassmorphism & Polish:** Enjoy smooth animations, modern toggles, and premium feedback components natively inside VS Code.

---

## 📖 Usage Guide

### Working with Spreadsheets (XLSX, CSV, TSV)
1. **Open a File:** Simply click on any `.xlsx`, `.csv`, or `.tsv` file in your VS Code explorer.
2. **Editing Data:** Click any cell to start editing. For CSV/TSV, edits are made directly in the table. 
3. **Formatting (XLSX):** Select cells and use the toolbar to apply colors, borders, alignments, or merge cells.
4. **Converting Formats:** Click the **Convert** button in the toolbar to change a file to another supported tabular format.
5. **Version History:** Click the history icon to view and restore previous states of your file.

### Working with Markdown (.md)
1. **Open Preview:** Open a `.md` file, and click the **Open in Preview** button in the editor title bar (or use the command palette).
2. **Split Editing:** The preview synchronizes its scroll position with the active text editor.
3. **In-Preview Editing:** Click **Edit Preview** to unlock a rich-text toolbar and modify the document directly from the rendered view.

---

## ⚙️ Settings & Configuration
The extension is highly configurable to suit your workflow. Key settings include:
- **Autosave (`xlsxViewer.*.autoSave`):** Enable/disable automatic saving for different file types.
- **Sticky Elements (`xlsxViewer.*.stickyToolbar`, `xlsxViewer.*.stickyHeader`):** Keep toolbars and headers visible while scrolling.
- **Spacious Cells (`xlsxViewer.*.spaciousCells`):** Increase padding for a more relaxed, readable grid.
- **Markdown Layout (`xlsxViewer.md.previewPosition`, `xlsxViewer.md.syncScroll`):** Control where the preview opens and whether scrolling is synchronized.

*(Access all settings via VS Code Settings: <kbd>Ctrl+,</kbd> > search for `xlsxViewer`)*

---

## 🛠️ Installation

1. Open **VS Code**.
2. Go to the **Extensions Marketplace** (<kbd>Ctrl+Shift+X</kbd>).
3. Search for **`XLSX, CSV, TSV & Markdown Editor`**.
4. Click **Install**.

Alternatively, install it manually via the command line:
```bash
code --install-extension muhammad-ahmad.xlsx-viewer
```

---

## 💬 Feedback & Support

We are constantly improving the extension based on user input!
- **In-App Feedback:** Use the Help & Feedback button directly in the extension's toolbar to submit suggestions without leaving VS Code.
- **Rate & Review:** If this extension boosts your productivity, please consider [rating it on the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=muhammad-ahmad.xlsx-viewer).

## 📜 License & Contributing

This is an open-source project licensed under the **MIT License**. We welcome contributions!
- Feel free to submit issues, feature requests, or pull requests on our [GitHub Repository](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension).

---

📢 **Links:**
- 🔗 GitHub: [Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension)
- 🔗 VS Code Marketplace: [Download Extension](https://marketplace.visualstudio.com/items?itemName=muhammad-ahmad.xlsx-viewer)
- 🔗 Open VSX: [Open VSX Link](https://open-vsx.org/extension/muhammad-ahmad/xlsx-viewer)
