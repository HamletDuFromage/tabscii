/* ================================================================
   Tabscii — app.js
   WYSIWYG table editor → ASCII / Markdown output
   ================================================================ */

(function () {
    'use strict';

    /* ---------- Constants ---------- */
    const STORAGE_KEY = 'tabscii_defaults';
    const DEFAULT_ROWS = 3;
    const DEFAULT_COLS = 3;

    /* Box drawing characters */
    const BOX = {
        tl: '┌', tr: '┐', bl: '└', br: '┘',
        h: '─', v: '│',
        lt: '├', rt: '┤', tt: '┬', bt: '┴', cr: '┼',
    };

    /* ---------- DOM refs ---------- */
    const $title = document.getElementById('table-title');
    const $thead = document.getElementById('edit-thead');
    const $tbody = document.getElementById('edit-tbody');
    const $output = document.getElementById('output-preview');
    const $copyBtn = document.getElementById('btn-copy');
    const $copyFeedback = document.getElementById('copy-feedback');
    const $headerToggle = document.getElementById('btn-header-row');
    const formatRadios = document.querySelectorAll('input[name="format"]');

    /* ---------- State ---------- */
    let hasHeaderRow = true;

    /* ---------- Helpers ---------- */

    /** Extract plain text from a contenteditable cell */
    function cellText(cell) {
        return (cell.textContent || '').trim();
    }

    /**
     * Parse inline formatting from a cell's innerHTML.
     * Returns { text, bold, italic } where bold/italic mean the *entire* cell
     * content is wrapped.  For partial formatting we embed markers in text.
     */
    function parseCellFormatting(cell) {
        const text = cellText(cell);
        if (!text) return { text: '', segments: [] };

        // Walk text nodes and their parent formatting
        const segments = [];
        const walk = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent;
                if (!t) return;
                let bold = false, italic = false;
                let parent = node.parentNode;
                while (parent && parent !== cell) {
                    const tag = parent.tagName;
                    if (tag === 'B' || tag === 'STRONG') bold = true;
                    if (tag === 'I' || tag === 'EM') italic = true;
                    parent = parent.parentNode;
                }
                segments.push({ text: t, bold, italic });
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                for (const child of node.childNodes) walk(child);
            }
        };
        walk(cell);
        return { text, segments };
    }

    /** Build display string with markdown-style markers for bold/italic */
    function formattedText(cell) {
        const { segments } = parseCellFormatting(cell);
        if (!segments.length) return '';
        return segments.map(s => {
            let t = s.text;
            if (s.bold && s.italic) t = '***' + t + '***';
            else if (s.bold) t = '**' + t + '**';
            else if (s.italic) t = '*' + t + '*';
            return t;
        }).join('');
    }

    /** Measure display width accounting for markers */
    function displayWidth(str) {
        // Remove matched markdown markers for width calculation
        // Order matters: strip bold+italic first, then bold, then italic
        return str
            .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .length;
    }

    /** Pad string to width (accounting for markers) */
    function padStr(str, width) {
        const actual = displayWidth(str);
        const diff = width - actual;
        if (diff <= 0) return str;
        return str + ' '.repeat(diff);
    }

    /* ---------- Table Management ---------- */

    function getRows() {
        const allRows = [];
        if (hasHeaderRow && $thead.rows.length) {
            allRows.push($thead.rows[0]);
        }
        for (const row of $tbody.rows) {
            allRows.push(row);
        }
        return allRows;
    }

    function getColCount() {
        const rows = getRows();
        if (!rows.length) return 0;
        return rows[0].cells.length;
    }

    function createCell(isHeader) {
        const cell = document.createElement(isHeader ? 'th' : 'td');
        cell.contentEditable = 'true';
        cell.addEventListener('input', scheduleUpdate);
        cell.addEventListener('focus', onCellFocus);
        return cell;
    }

    function addRow() {
        const cols = getColCount() || DEFAULT_COLS;
        const row = document.createElement('tr');
        for (let i = 0; i < cols; i++) {
            row.appendChild(createCell(false));
        }
        $tbody.appendChild(row);
        scheduleUpdate();
    }

    function removeRow() {
        if ($tbody.rows.length > 1) {
            $tbody.deleteRow($tbody.rows.length - 1);
            scheduleUpdate();
        }
    }

    function addCol() {
        for (const row of getRows()) {
            const isHeader = row.parentNode === $thead;
            row.appendChild(createCell(isHeader));
        }
        scheduleUpdate();
    }

    function removeCol() {
        const cols = getColCount();
        if (cols <= 1) return;
        for (const row of getRows()) {
            row.deleteCell(row.cells.length - 1);
        }
        scheduleUpdate();
    }

    /** Rebuild <thead>/<tbody> when toggling header row */
    function toggleHeaderRow() {
        hasHeaderRow = !hasHeaderRow;
        $headerToggle.classList.toggle('active', hasHeaderRow);

        if (hasHeaderRow) {
            // Promote first body row to header
            if ($tbody.rows.length > 0) {
                const firstRow = $tbody.rows[0];
                const newRow = document.createElement('tr');
                while (firstRow.cells.length) {
                    const td = firstRow.cells[0];
                    const th = createCell(true);
                    th.innerHTML = td.innerHTML;
                    newRow.appendChild(th);
                    td.remove();
                }
                firstRow.remove();
                $thead.innerHTML = '';
                $thead.appendChild(newRow);
            }
        } else {
            // Demote header row to first body row
            if ($thead.rows.length > 0) {
                const headerRow = $thead.rows[0];
                const newRow = document.createElement('tr');
                while (headerRow.cells.length) {
                    const th = headerRow.cells[0];
                    const td = createCell(false);
                    td.innerHTML = th.innerHTML;
                    newRow.appendChild(td);
                    th.remove();
                }
                headerRow.remove();
                $tbody.insertBefore(newRow, $tbody.firstChild);
            }
            $thead.innerHTML = '';
        }
        scheduleUpdate();
    }

    /** Initialize table from data or defaults */
    function initTable(data) {
        $thead.innerHTML = '';
        $tbody.innerHTML = '';

        const rows = data ? data.rows : null;
        const numRows = rows ? rows.length : DEFAULT_ROWS;
        const numCols = rows ? Math.max(...rows.map(r => r.length)) : DEFAULT_COLS;
        hasHeaderRow = data ? !!data.hasHeaderRow : true;
        $headerToggle.classList.toggle('active', hasHeaderRow);

        for (let r = 0; r < numRows; r++) {
            const isHeaderRow = hasHeaderRow && r === 0;
            const tr = document.createElement('tr');

            for (let c = 0; c < numCols; c++) {
                const cell = createCell(isHeaderRow);
                if (rows && rows[r] && rows[r][c]) {
                    cell.innerHTML = rebuildHTML(rows[r][c]);
                }
                tr.appendChild(cell);
            }

            if (isHeaderRow) {
                $thead.appendChild(tr);
            } else {
                $tbody.appendChild(tr);
            }
        }

        if (data && data.title) {
            $title.value = data.title;
        }

        scheduleUpdate();
    }

    /** Rebuild cell HTML from saved data */
    function rebuildHTML(cellData) {
        if (typeof cellData === 'string') return escapeHTML(cellData);
        if (!cellData.segments) {
            let html = escapeHTML(cellData.text || '');
            if (cellData.bold) html = '<b>' + html + '</b>';
            if (cellData.italic) html = '<i>' + html + '</i>';
            return html;
        }
        return cellData.segments.map(s => {
            let html = escapeHTML(s.text);
            if (s.bold) html = '<b>' + html + '</b>';
            if (s.italic) html = '<i>' + html + '</i>';
            return html;
        }).join('');
    }

    function escapeHTML(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    /* ---------- Auto-Trim ---------- */

    /**
     * Returns { rows, colIndices } after removing empty trailing/leading rows
     * and columns.  A row is empty if all cells are empty.  A column is empty
     * if all cells in that column are empty.
     */
    function trimmedData() {
        const allRows = getRows();
        if (!allRows.length) return { grid: [], headerIndex: -1 };

        const numCols = getColCount();

        // Build grid: array of { cells: [...DOM cells], isHeader }
        const grid = allRows.map(row => ({
            cells: Array.from(row.cells),
            isHeader: row.parentNode === $thead,
        }));

        // Determine non-empty rows
        const nonEmptyRowIndices = [];
        for (let r = 0; r < grid.length; r++) {
            if (grid[r].cells.some(c => cellText(c) !== '')) {
                nonEmptyRowIndices.push(r);
            }
        }

        // Determine non-empty columns
        const nonEmptyColIndices = [];
        for (let c = 0; c < numCols; c++) {
            if (grid.some(row => cellText(row.cells[c]) !== '')) {
                nonEmptyColIndices.push(c);
            }
        }

        // If everything is empty, return at least 1 row × 1 col
        if (!nonEmptyRowIndices.length || !nonEmptyColIndices.length) {
            return { grid: [{ cells: [grid[0].cells[0]], isHeader: false }], colIndices: [0] };
        }

        const trimmedGrid = nonEmptyRowIndices.map(r => ({
            cells: nonEmptyColIndices.map(c => grid[r].cells[c]),
            isHeader: grid[r].isHeader,
        }));

        return { grid: trimmedGrid, colIndices: nonEmptyColIndices };
    }

    /* ---------- ASCII Table Generation ---------- */

    function generateASCII() {
        const { grid } = trimmedData();
        const title = $title.value.trim();
        const numCols = grid[0].cells.length;

        // Build text grid with formatting markers
        const textGrid = grid.map(row =>
            row.cells.map(c => formattedText(c))
        );

        // Calculate column widths
        const colWidths = [];
        for (let c = 0; c < numCols; c++) {
            let maxW = 1;
            for (const row of textGrid) {
                maxW = Math.max(maxW, displayWidth(row[c]));
            }
            colWidths.push(maxW);
        }

        // Build horizontal lines
        const hLine = (left, mid, right) => {
            return left + colWidths.map(w => BOX.h.repeat(w + 2)).join(mid) + right;
        };

        const tableLines = [];

        tableLines.push(hLine(BOX.tl, BOX.tt, BOX.tr));

        // Data rows
        for (let r = 0; r < textGrid.length; r++) {
            const row = textGrid[r];
            const line = BOX.v + ' ' +
                row.map((cell, c) => padStr(cell, colWidths[c])).join(' ' + BOX.v + ' ') +
                ' ' + BOX.v;
            tableLines.push(line);

            // Separator after header
            if (grid[r].isHeader && r < textGrid.length - 1) {
                tableLines.push(hLine(BOX.lt, BOX.cr, BOX.rt));
            }
        }

        tableLines.push(hLine(BOX.bl, BOX.bt, BOX.br));

        return { title: title || '', table: tableLines.join('\n') };
    }

    /* ---------- Markdown Table Generation ---------- */

    function generateMarkdown() {
        const { grid } = trimmedData();
        const title = $title.value.trim();
        const numCols = grid[0].cells.length;

        const textGrid = grid.map(row =>
            row.cells.map(c => formattedText(c))
        );

        // Column widths
        const colWidths = [];
        for (let c = 0; c < numCols; c++) {
            let maxW = 3; // minimum "---"
            for (const row of textGrid) {
                maxW = Math.max(maxW, displayWidth(row[c]));
            }
            colWidths.push(maxW);
        }

        const tableLines = [];

        // Find header row
        const headerIdx = grid.findIndex(r => r.isHeader);

        if (headerIdx >= 0) {
            // Header
            const hRow = textGrid[headerIdx];
            tableLines.push('| ' + hRow.map((cell, c) => padStr(cell, colWidths[c])).join(' | ') + ' |');
            tableLines.push('| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |');
            // Body
            for (let r = 0; r < textGrid.length; r++) {
                if (r === headerIdx) continue;
                tableLines.push('| ' + textGrid[r].map((cell, c) => padStr(cell, colWidths[c])).join(' | ') + ' |');
            }
        } else {
            // No header: use empty header
            tableLines.push('| ' + colWidths.map(w => ' '.repeat(w)).join(' | ') + ' |');
            tableLines.push('| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |');
            for (const row of textGrid) {
                tableLines.push('| ' + row.map((cell, c) => padStr(cell, colWidths[c])).join(' | ') + ' |');
            }
        }

        return { title: title || '', table: tableLines.join('\n') };
    }

    /* ---------- Output Rendering ---------- */

    function getFormat() {
        for (const r of formatRadios) {
            if (r.checked) return r.value;
        }
        return 'ascii';
    }

    let updateTimer = null;
    function scheduleUpdate() {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(updateOutput, 60);
    }

    function updateOutput() {
        const fmt = getFormat();
        const result = fmt === 'ascii' ? generateASCII() : generateMarkdown();
        const display = result.title ? result.title + '\n\n' + result.table : result.table;
        $output.textContent = display;
    }

    /* ---------- Clipboard ---------- */

    async function copyToClipboard() {
        const fmt = getFormat();
        const result = fmt === 'ascii' ? generateASCII() : generateMarkdown();
        const plainText = result.title ? result.title + '\n\n' + result.table : result.table;
        if (!plainText) return;

        // Build HTML: title as regular text, table in monospace <pre>
        let htmlContent = '';
        if (result.title) {
            htmlContent += '<p style="font-family:sans-serif;font-size:14px;margin:0 0 8px 0;">' +
                escapeHTML(result.title).replace(/\n/g, '<br>') + '</p>';
        }
        htmlContent +=
            '<pre style="font-family:\'Courier New\',Courier,monospace;font-size:13px;line-height:1.4;white-space:pre;background:#f5f5f5;padding:12px;border-radius:6px;margin:0;">' +
            escapeHTML(result.table) +
            '</pre>';

        try {
            const blob = new Blob([htmlContent], { type: 'text/html' });
            const textBlob = new Blob([plainText], { type: 'text/plain' });
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': blob,
                    'text/plain': textBlob,
                }),
            ]);
            showFeedback('Copied ✓');
        } catch {
            // Fallback: plain text copy
            try {
                await navigator.clipboard.writeText(plainText);
                showFeedback('Copied as plain text ✓');
            } catch {
                showFeedback('Copy failed — try selecting manually');
            }
        }
    }

    function showFeedback(msg) {
        $copyFeedback.textContent = msg;
        $copyFeedback.classList.add('show');
        setTimeout(() => $copyFeedback.classList.remove('show'), 2500);
    }

    /* ---------- Save / Load Defaults ---------- */

    function serializeTable() {
        const allRows = getRows();
        const rows = allRows.map(row => {
            return Array.from(row.cells).map(cell => {
                const { segments } = parseCellFormatting(cell);
                return { text: cellText(cell), segments };
            });
        });
        return {
            title: $title.value,
            rows,
            hasHeaderRow,
            format: getFormat(),
        };
    }

    function saveDefaults() {
        const data = serializeTable();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        showFeedback('Defaults saved ✓');
    }

    function clearDefaults() {
        localStorage.removeItem(STORAGE_KEY);
        showFeedback('Defaults cleared');
    }

    function loadDefaults() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    /* ---------- Cell Focus Tracking ---------- */

    let lastFocusedCell = null;

    function onCellFocus(e) {
        lastFocusedCell = e.target;
    }

    /* ---------- Bold / Italic ---------- */

    function applyBold() {
        document.execCommand('bold', false, null);
        scheduleUpdate();
    }

    function applyItalic() {
        document.execCommand('italic', false, null);
        scheduleUpdate();
    }

    /* ---------- Keyboard Shortcuts ---------- */

    document.addEventListener('keydown', (e) => {
        // Tab navigation between cells
        if (e.key === 'Tab' && lastFocusedCell) {
            e.preventDefault();
            const allCells = Array.from(document.querySelectorAll('#edit-table th, #edit-table td'));
            const idx = allCells.indexOf(lastFocusedCell);
            if (idx < 0) return;
            const next = e.shiftKey ? idx - 1 : idx + 1;
            if (next >= 0 && next < allCells.length) {
                allCells[next].focus();
            }
        }
    });

    /* ---------- Event Bindings ---------- */

    document.getElementById('btn-add-row').addEventListener('click', addRow);
    document.getElementById('btn-remove-row').addEventListener('click', removeRow);
    document.getElementById('btn-add-col').addEventListener('click', addCol);
    document.getElementById('btn-remove-col').addEventListener('click', removeCol);
    document.getElementById('btn-bold').addEventListener('click', applyBold);
    document.getElementById('btn-italic').addEventListener('click', applyItalic);
    $headerToggle.addEventListener('click', toggleHeaderRow);
    $copyBtn.addEventListener('click', copyToClipboard);
    document.getElementById('btn-save-default').addEventListener('click', saveDefaults);
    document.getElementById('btn-clear-default').addEventListener('click', clearDefaults);
    $title.addEventListener('input', scheduleUpdate);
    formatRadios.forEach(r => r.addEventListener('change', scheduleUpdate));

    /* ---------- Init ---------- */

    const saved = loadDefaults();
    if (saved) {
        // Restore saved format
        if (saved.format) {
            formatRadios.forEach(r => {
                r.checked = r.value === saved.format;
            });
        }
        initTable(saved);
    } else {
        initTable(null);
    }
})();
