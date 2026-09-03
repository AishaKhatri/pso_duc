// Activity Logs page (super_admin only). The date range is required before
// fetching so the table never asks the backend for the full history.

const ACTIVITY_LOG_COLUMNS = ['Time', 'User', 'Role', 'IP', 'Action', 'Entity', 'Details'];
const PRICE_UPDATE_ACTION = 'price_update_publish';

function todayLocalISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

async function renderActivityLogs() {
    const content = document.getElementById('content');
    content.innerHTML = '';

    const today = todayLocalISO();
    const fromInput = createDateInput(today);
    const toInput   = createDateInput(today);

    const fetchButton = createActionButton('#004D64', '#00324C');
    fetchButton.textContent = 'Fetch';

    const exportButton = createActionButton();
    exportButton.textContent = 'Export to CSV';
    exportButton.disabled = true;
    // Push Export to the far right of the filter bar.
    exportButton.style.marginLeft = 'auto';

    const priceExportButton = createActionButton();
    priceExportButton.textContent = 'Export Price Updates';
    priceExportButton.disabled = true;

    const statusLine = document.createElement('div');
    statusLine.style.fontSize = '13px';
    statusLine.style.color = 'var(--text-secondary)';
    statusLine.style.width = '120px';

    // User / Action filters
    let currentRows = [];      // everything fetched for the date range
    let filteredRows = [];     // subset shown after the user/action/entity filters
    let userFilter = 'all';
    let actionFilter = 'all';
    let entityFilter = 'all';  // customer code; only active when Action = price update

    const userDd = createSearchableDropdown({
        placeholder: 'All Users', width: '150px', bgWhite: true,
        items: [{ value: 'all', label: 'All Users' }],
        emptyText: 'No matching user',
        onSelect: (v) => { userFilter = v; if (v === 'all') userDd.setQuery(''); applyFilters(); }
    });
    const actionDd = createSearchableDropdown({
        placeholder: 'All Actions', width: '180px', bgWhite: true,
        items: [{ value: 'all', label: 'All Actions' }],
        emptyText: 'No matching action',
        onSelect: (v) => {
            actionFilter = v;
            if (v === 'all') actionDd.setQuery('');
            syncEntityDropdown();
            applyFilters();
        }
    });
    // Entity = customer code. Only meaningful (and enabled) for price-update actions.
    const entityDd = createSearchableDropdown({
        placeholder: 'All Customers', width: '170px', bgWhite: true,
        items: [{ value: 'all', label: 'All Customers' }],
        emptyText: 'No matching customer',
        onSelect: (v) => { entityFilter = v; if (v === 'all') entityDd.setQuery(''); applyFilters(); }
    });

    const filterBar = createFlexRow({ gap: '8px', align: 'flex-end', wrap: 'wrap' });
    filterBar.style.marginBottom = '10px';
    filterBar.appendChild(createLabeledField({ label: 'From', control: fromInput, gap: '4px' }));
    filterBar.appendChild(createLabeledField({ label: 'To',   control: toInput,   gap: '4px' }));
    filterBar.appendChild(fetchButton);
    filterBar.appendChild(statusLine);
    filterBar.appendChild(createLabeledField({ label: 'User',   control: userDd.wrap,   gap: '4px' }));
    filterBar.appendChild(createLabeledField({ label: 'Action', control: actionDd.wrap, gap: '4px' }));
    filterBar.appendChild(createLabeledField({ label: 'Customer', control: entityDd.wrap, gap: '4px' }));
    filterBar.appendChild(exportButton);
    filterBar.appendChild(priceExportButton);
    content.appendChild(filterBar);

    const { tableContainer } = createTable(ACTIVITY_LOG_COLUMNS);
    content.appendChild(tableContainer);

    const usersById = await loadUsersById();

    // Rebuild the User/Action dropdown option lists from the distinct values
    // present in the freshly-fetched rows.
    function refreshFilterOptions() {
        const users = [...new Set(currentRows.map(r => r.username).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        userDd.setItems([{ value: 'all', label: 'All Users' },
            ...users.map(u => ({ value: u, label: u }))]);
        const actions = [...new Set(currentRows.map(r => r.action).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        actionDd.setItems([{ value: 'all', label: 'All Actions' },
            ...actions.map(a => ({ value: a, label: a }))]);
    }

    // Enable the Customer (entity) dropdown only when Action = price update,
    // populating it with the customer codes present among price-update rows.
    function syncEntityDropdown() {
        const enabled = actionFilter === PRICE_UPDATE_ACTION;
        entityDd.input.disabled = !enabled;
        entityDd.wrap.style.opacity = enabled ? '1' : '0.5';
        if (enabled) {
            const byCode = new Map();   // code -> city (for the grey sub-label)
            for (const r of currentRows) {
                if (r.action !== PRICE_UPDATE_ACTION) continue;
                const code = r.entity_id || '';
                if (!code || byCode.has(code)) continue;
                let d = r.details;
                if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
                byCode.set(code, (d && d.city) || '');
            }
            const opts = [{ value: 'all', label: 'All Customers' }];
            for (const [code, city] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
                opts.push({ value: code, label: code, secondary: city });
            }
            entityDd.setItems(opts);
        } else {
            entityFilter = 'all';
            entityDd.setQuery('');
        }
    }

    // Apply the current user/action/entity selection to currentRows and repaint.
    function applyFilters() {
        filteredRows = currentRows.filter(r =>
            (userFilter === 'all' || r.username === userFilter) &&
            (actionFilter === 'all' || r.action === actionFilter) &&
            (entityFilter === 'all' || r.entity_id === entityFilter)
        );
        renderActivityRows(filteredRows, usersById);
        const total = currentRows.length;
        const shown = filteredRows.length;
        const noun = n => `entr${n === 1 ? 'y' : 'ies'}`;
        statusLine.textContent = (userFilter === 'all' && actionFilter === 'all' && entityFilter === 'all')
            ? `${total} ${noun(total)}`
            : `${shown} of ${total} ${noun(total)}`;
        exportButton.disabled = shown === 0;
    }

    syncEntityDropdown();   // start disabled (Action defaults to "all")

    async function doFetch() {
        const from = fromInput.value;
        const to = toInput.value;
        if (!from || !to) {
            alert('Please pick both From and To dates.');
            return;
        }
        if (from > to) {
            alert('From date must be on or before To date.');
            return;
        }

        statusLine.textContent = 'Loading…';
        fetchButton.disabled = true;
        try {
            const res = await fetch(
                `${API_BASE_URL}/activity-log?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to fetch activity log');
            }
            currentRows = await res.json();
            // Reset filters to "all" for the new range and rebuild their options.
            userFilter = 'all';
            actionFilter = 'all';
            entityFilter = 'all';
            userDd.setQuery('');
            actionDd.setQuery('');
            entityDd.setQuery('');
            refreshFilterOptions();
            syncEntityDropdown();   // re-disable (Action reset to "all")
            applyFilters();
            // Price-update export depends only on the date range, not the filters.
            priceExportButton.disabled = !currentRows.some(r => r.action === PRICE_UPDATE_ACTION);
        } catch (e) {
            console.error(e);
            statusLine.textContent = 'Error: ' + e.message;
        } finally {
            fetchButton.disabled = false;
        }
    }

    fetchButton.addEventListener('click', doFetch);
    exportButton.addEventListener('click', () => {
        if (!filteredRows.length) return;
        const detailsStr = d => {
            if (d == null) return '';
            if (typeof d === 'string') return d;
            try { return JSON.stringify(d); } catch { return String(d); }
        };
        const cols = [
            { header: 'Time',    get: r => new Date(r.created_at).toLocaleString() },
            { header: 'User',    key: 'username' },
            { header: 'Role',   get: r => usersById[r.user_id]?.role || '' },
            { header: 'IP',      key: 'ip_address' },
            { header: 'Action',  key: 'action' },
            { header: 'Entity',  get: r => [r.entity_type, r.entity_id].filter(Boolean).join(':') },
            { header: 'Details', get: r => detailsStr(r.details) }
        ];
        const from = fromInput.value;
        const to = toInput.value;
        const range = from === to ? from : `${from}_to_${to}`;
        downloadCsv(`activity-log-${range}.csv`, filteredRows, cols);
    });

    priceExportButton.addEventListener('click', () => {
        // Price updates in the range, scoped to the selected customer (entity)
        // filter when one is active.
        let jobRows = currentRows.filter(r => r.action === PRICE_UPDATE_ACTION);
        if (entityFilter !== 'all') jobRows = jobRows.filter(r => r.entity_id === entityFilter);
        if (!jobRows.length) return;
        const from = fromInput.value;
        const to = toInput.value;
        const range = from === to ? from : `${from}_to_${to}`;
        exportPriceUpdatesXls(jobRows, range, entityFilter !== 'all' ? entityFilter : null);
    });

    doFetch();
}

async function loadUsersById() {
    try {
        const users = await loadUsersFromDB();
        const map = {};
        for (const u of users) map[u.id] = u;
        return map;
    } catch {
        return {};
    }
}

function renderActivityRows(rows, usersById) {
    const tbody = document.getElementById('dispenser-table-body');
    tbody.innerHTML = '';

    if (!rows || rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = ACTIVITY_LOG_COLUMNS.length;
        td.appendChild(createNoDataMessage('No activity in this date range'));
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    const cellOpts = { padding: '7px 10px', verticalAlign: 'top' };
    rows.forEach(row => {
        const tr = createTableRow();
        appendCell(tr, new Date(row.created_at).toLocaleString(), cellOpts);
        appendCell(tr, row.username, cellOpts);
        appendCell(tr, usersById[row.user_id]?.role, cellOpts);
        appendCell(tr, row.ip_address, cellOpts);
        appendCell(tr, row.action, cellOpts);
        appendCell(tr, [row.entity_type, row.entity_id].filter(Boolean).join(':'), cellOpts);
        appendDetailsCell(tr, row.details);
        tbody.appendChild(tr);
    });
}

function appendDetailsCell(tr, details) {
    const td = document.createElement('td');
    td.style.padding = '7px 10px';
    td.style.verticalAlign = 'top';
    td.style.maxWidth = '480px';

    if (details == null) {
        td.textContent = '-';
        tr.appendChild(td);
        return;
    }

    let parsed = details;
    if (typeof details === 'string') {
        try { parsed = JSON.parse(details); } catch { parsed = details; }
    }
    const pretty = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);

    const summary = document.createElement('div');
    summary.style.fontFamily = 'monospace';
    summary.style.fontSize = '12px';
    summary.style.whiteSpace = 'nowrap';
    summary.style.overflow = 'hidden';
    summary.style.textOverflow = 'ellipsis';
    summary.textContent = pretty.split('\n')[0].slice(0, 200);

    const fullPre = document.createElement('pre');
    fullPre.style.fontFamily = 'monospace';
    fullPre.style.fontSize = '12px';
    fullPre.style.whiteSpace = 'pre-wrap';
    fullPre.style.wordBreak = 'break-word';
    fullPre.style.margin = '6px 0 0 0';
    fullPre.style.padding = '8px';
    fullPre.style.backgroundColor = 'var(--bg-surface-2, var(--bg-surface))';
    fullPre.style.borderRadius = '4px';
    fullPre.style.maxHeight = '220px';
    fullPre.style.overflow = 'auto';
    fullPre.textContent = pretty;
    fullPre.hidden = true;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.textContent = 'Show';
    toggle.style.marginLeft = '8px';
    toggle.style.fontSize = '11px';
    toggle.style.padding = '2px 8px';
    toggle.style.border = '1px solid var(--border)';
    toggle.style.background = 'transparent';
    toggle.style.color = 'var(--text-primary)';
    toggle.style.cursor = 'pointer';
    toggle.style.borderRadius = '4px';
    toggle.addEventListener('click', () => {
        fullPre.hidden = !fullPre.hidden;
        toggle.textContent = fullPre.hidden ? 'Show' : 'Hide';
    });

    const summaryRow = document.createElement('div');
    summaryRow.style.display = 'flex';
    summaryRow.style.alignItems = 'center';
    summaryRow.appendChild(summary);
    summaryRow.appendChild(toggle);

    td.appendChild(summaryRow);
    td.appendChild(fullPre);
    tr.appendChild(td);
}

// Build and download a colour-coded .xlsx of price-update entries
function exportPriceUpdatesXls(jobRows, range, customerCode) {
    const headers = ['Time', 'User', 'City', 'Customer Code', 'Status', 'Effective',
        'Ended At', 'Product', 'Price', 'Retained', 'DUC Address', 'Connection',
        'Nozzle', 'Nozzle Status', 'ACKed', 'ACKed At'];

    const fmtTime = t => {
        if (!t) return '';
        const d = new Date(t);
        return isNaN(d.getTime()) ? '' : d.toLocaleString();
    };
    const isDisconnected = c => /disconnect/i.test(String(c || ''));
    // Nozzle status: coloured TEXT red for No Ping, amber for Manual.
    const nozStyle = (s, striped) => {
        if (/no\s*ping/i.test(s)) return striped ? XLSX_STYLE.RED_TEXT_STRIPE : XLSX_STYLE.RED_TEXT;
        if (/manual/i.test(s)) return striped ? XLSX_STYLE.AMBER_TEXT_STRIPE : XLSX_STYLE.AMBER_TEXT;
        return null;
    };

    // Column groups merged vertically over their span (indices into `headers`):
    const STATION_COLS = [0, 1, 2, 3, 4, 5, 6, 9];   // job-level (Effective, Ended At, Retained, …)
    const PRODUCT_COLS = [7, 8];                       // Product, Price
    const DUC_COLS     = [10, 11, 14, 15];             // DUC Address, Connection, ACKed, ACKed At
    const CONN_COL = 11, NOZ_STATUS_COL = 13, ACK_COL = 14;

    const matrix = [headers.map(h => ({ v: h, s: XLSX_STYLE.HEADER }))];
    const merges = [];   // { col, start, end } in matrix-index terms
    const addMerge = (cols, start, end) => {
        if (end > start) for (const col of cols) merges.push({ col, start, end });
    };

    jobRows.forEach((r, entryIndex) => {
        let d = r.details;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
        d = d || {};

        // Zebra: alternate the base cell style per price-update entry. Warning
        // (red/amber) cells override this; other cells take the entry's base.
        const baseStyle = (entryIndex % 2 === 1) ? XLSX_STYLE.STRIPE : XLSX_STYLE.DEFAULT;
        const drow = (vals, overrides = {}) =>
            vals.map((v, i) => ({ v, s: overrides[i] != null ? overrides[i] : baseStyle }));

        const endedAt = d.completedAt || d.dismissedAt || '';
        const effective = d.effectiveAt ? fmtTime(d.effectiveAt * 1000) : '';
        const base = [fmtTime(r.created_at), r.username || '', d.city || '',
            d.customer_code || '', d.status || '', effective, fmtTime(endedAt)];
        // Retained also notes whether the message was cleared or kept at finalize.
        const retained = d.retained
            ? (d.retainedCleared === false ? 'Yes (kept)' : 'Yes (cleared)')
            : 'No';
        const prices = d.prices || {};
        const ducs = Array.isArray(d.ducs) ? d.ducs : [];

        if (ducs.length === 0) {
            matrix.push(drow([...base, '', '', retained, '', '', '', '', '', '']));
            return;
        }

        // Group station -> product -> dispenser -> nozzle so repeated values can
        // be merged. Products are ordered by their published-price order.
        const present = new Set();
        for (const duc of ducs) for (const p of Object.keys(duc.products || {})) present.add(p);
        const priceOrder = Object.keys(prices);
        const products = [...priceOrder.filter(p => present.has(p)),
            ...[...present].filter(p => !priceOrder.includes(p))];

        const jobStart = matrix.length;
        for (const product of products) {
            const prodStart = matrix.length;
            const price = prices[product] != null ? prices[product] : '';
            const ducsWith = ducs.filter(duc => duc.products && duc.products[product]);
            for (const duc of ducsWith) {
                const ducStart = matrix.length;
                const conn = duc.conn || '';
                const p = duc.products[product] || {};
                const ack = p.ack ? 'Yes' : 'No';
                const ackedAt = p.ackedAt ? fmtTime(p.ackedAt) : '';
                const noz = p.noz || {};
                const nozKeys = Object.keys(noz);
                // Per-dispenser overrides: red Connection (with fill) if
                // disconnected, and ACKed green/red text + fill. Merged across nozzles.
                const ducOv = { [ACK_COL]: ack === 'Yes' ? XLSX_STYLE.GREEN : XLSX_STYLE.RED };
                if (isDisconnected(conn)) ducOv[CONN_COL] = XLSX_STYLE.RED;

                if (nozKeys.length === 0) {
                    matrix.push(drow([...base, product, price, retained, duc.addr || '', conn,
                        '', '', ack, ackedAt], ducOv));
                } else {
                    for (const nz of nozKeys) {
                        const nstatus = noz[nz] || '';
                        const ov = { ...ducOv };
                        const ns = nozStyle(nstatus, baseStyle === XLSX_STYLE.STRIPE);
                        if (ns != null) ov[NOZ_STATUS_COL] = ns;
                        matrix.push(drow([...base, product, price, retained, duc.addr || '', conn,
                            nz, nstatus, ack, ackedAt], ov));
                    }
                }
                addMerge(DUC_COLS, ducStart, matrix.length - 1);
            }
            addMerge(PRODUCT_COLS, prodStart, matrix.length - 1);
        }
        addMerge(STATION_COLS, jobStart, matrix.length - 1);
    });

    // Blank the cells each vertical merge covers (keep the top value + style) and
    // collect A1-style refs. Merge groups never share a column, so no overlaps.
    const mergeRefs = [];
    for (const m of merges) {
        mergeRefs.push(`${_xlsxColRef(m.col)}${m.start + 1}:${_xlsxColRef(m.col)}${m.end + 1}`);
        for (let i = m.start + 1; i <= m.end; i++) matrix[i][m.col] = { v: '', s: matrix[i][m.col].s };
    }

    const namePart = customerCode ? `price-updates-${customerCode}-${range}` : `price-updates-${range}`;
    downloadXlsx(`${namePart}.xlsx`, 'Price Updates', matrix, mergeRefs);
}

window.renderActivityLogs = renderActivityLogs;
