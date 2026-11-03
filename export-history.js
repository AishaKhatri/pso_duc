// Export History page (super_admin only). Pick a date range and either every
// dispenser or a checkbox selection, then download that range's nozzle_history
// snapshots — one .xlsx per station, one sheet per dispenser.

const EXPORT_DISPENSER_COLUMNS = ['', 'Customer Code', 'Station', 'City', 'Dispenser', 'DUC Address', 'Nozzle Status'];
const NOZZLE_STATUS_LABELS = { 0: 'Manual', 1: 'Auto', 2: 'No Ping' };

async function renderExportHistory() {
    const content = document.getElementById('content');
    content.innerHTML = '';

    const today = todayLocalISO();
    const fromInput = createDateInput(today);
    const toInput   = createDateInput(today);

    const searchInput = createTextInput({ placeholder: 'Search dispensers…' });
    searchInput.style.width = '200px';

    // Status filter: show only dispensers with at least one nozzle in that
    // status, so the select-all box can then pick e.g. every No Ping device.
    const statusSelect = applyInputStyles(document.createElement('select'));
    [['all', 'All Statuses'], ['1', 'Auto'], ['0', 'Manual'], ['2', 'No Ping']].forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        statusSelect.appendChild(opt);
    });

    const exportButton = createActionButton();
    exportButton.textContent = 'Export to Excel';
    exportButton.disabled = true;
    exportButton.style.marginLeft = 'auto';

    const statusLine = document.createElement('div');
    statusLine.style.fontSize = '13px';
    statusLine.style.color = 'var(--text-secondary)';

    const filterBar = createFlexRow({ gap: '8px', align: 'flex-end', wrap: 'wrap' });
    filterBar.style.marginBottom = '10px';
    filterBar.appendChild(createLabeledField({ label: 'From', control: fromInput, gap: '4px' }));
    filterBar.appendChild(createLabeledField({ label: 'To',   control: toInput,   gap: '4px' }));
    filterBar.appendChild(createLabeledField({ label: 'Filter', control: searchInput, gap: '4px' }));
    filterBar.appendChild(createLabeledField({ label: 'Nozzle Status', control: statusSelect, gap: '4px' }));
    filterBar.appendChild(statusLine);
    filterBar.appendChild(exportButton);
    content.appendChild(filterBar);

    const { tableContainer, tbody } = createTable(EXPORT_DISPENSER_COLUMNS);
    content.appendChild(tableContainer);

    // Select-all checkbox in the blank first header cell. It toggles only the
    // rows currently visible under the search / status filters.
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.style.margin = '0';
    selectAll.title = 'Select all';
    const firstTh = tableContainer.querySelector('thead th');
    firstTh.style.width = '30px';
    firstTh.appendChild(selectAll);

    let dispensers = [];
    const selected = new Set();   // dispensers.id
    const rowsById = new Map();   // id -> { tr, checkbox, haystack, statuses }

    try {
        const res = await fetch(`${API_BASE_URL}/dispensers-full`);
        if (!res.ok) throw new Error('Failed to fetch dispensers');
        dispensers = await res.json();
    } catch (e) {
        console.error(e);
        statusLine.textContent = 'Error: ' + e.message;
        return;
    }

    if (dispensers.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = EXPORT_DISPENSER_COLUMNS.length;
        td.appendChild(createNoDataMessage('No dispensers found'));
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    const cellOpts = { padding: '7px 10px' };
    dispensers.forEach(d => {
        const station = d.station || {};
        const nozzles = [...(d.nozzles || [])]
            .sort((a, b) => String(a.nozzle_id).localeCompare(String(b.nozzle_id), undefined, { numeric: true }));

        const tr = createTableRow();
        // Every dispenser starts selected ("all"); untick to narrow it down.
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.style.margin = '0';
        checkbox.checked = true;
        selected.add(d.id);
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) selected.add(d.id); else selected.delete(d.id);
            syncState();
        });
        appendCell(tr, checkbox, cellOpts);
        appendCell(tr, d.customer_code, cellOpts);
        appendCell(tr, station.station_id, cellOpts);
        appendCell(tr, station.city, cellOpts);
        appendCell(tr, d.dispenser_id, cellOpts);
        appendCell(tr, d.address, cellOpts);
        const statusTd = appendCell(tr, nozzles.length ? nozzleStatusList(nozzles) : '-', cellOpts);
        statusTd.dataset.sort = nozzles.map(n => NOZZLE_STATUS_LABELS[n.status] || 'Unknown').join(' ');
        tbody.appendChild(tr);

        const haystack = [d.customer_code, station.station_id, station.city, d.dispenser_id, d.address]
            .join(' ').toLowerCase();
        rowsById.set(d.id, { tr, checkbox, haystack, statuses: new Set(nozzles.map(n => String(n.status))) });
    });

    const visibleIds = () => [...rowsById].filter(([, r]) => r.tr.style.display !== 'none').map(([id]) => id);

    // Repaint the select-all box, status text and Export button from `selected`.
    function syncState() {
        const visible = visibleIds();
        const visSel = visible.filter(id => selected.has(id)).length;
        selectAll.checked = visible.length > 0 && visSel === visible.length;
        selectAll.indeterminate = visSel > 0 && visSel < visible.length;
        const n = selected.size;
        statusLine.textContent = n === dispensers.length
            ? `All ${n} dispensers selected`
            : `${n} of ${dispensers.length} dispensers selected`;
        exportButton.disabled = n === 0;
    }

    function applyFilters() {
        const q = searchInput.value.trim().toLowerCase();
        const status = statusSelect.value;
        for (const r of rowsById.values()) {
            const match = (!q || r.haystack.includes(q)) && (status === 'all' || r.statuses.has(status));
            r.tr.style.display = match ? '' : 'none';
        }
        syncState();
    }

    selectAll.addEventListener('change', () => {
        for (const id of visibleIds()) {
            rowsById.get(id).checkbox.checked = selectAll.checked;
            if (selectAll.checked) selected.add(id); else selected.delete(id);
        }
        syncState();
    });

    searchInput.addEventListener('input', applyFilters);
    statusSelect.addEventListener('change', applyFilters);

    exportButton.addEventListener('click', async () => {
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
        if (selected.size === 0) return;

        // Every dispenser selected → omit the filter so the server exports all.
        const params = new URLSearchParams({ from, to });
        if (selected.size < dispensers.length) params.set('dispenser_ids', [...selected].join(','));

        const label = exportButton.textContent;
        exportButton.disabled = true;
        exportButton.textContent = 'Exporting…';
        try {
            const res = await fetch(`${API_BASE_URL}/nozzle-history/export?${params}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to fetch nozzle history');
            }
            const rows = await res.json();
            if (!rows.length) {
                alert('No nozzle history in this date range for the selected dispensers.');
                return;
            }
            const range = from === to ? from : `${from}_to_${to}`;
            await exportNozzleHistoryXlsx(rows, range);
        } catch (e) {
            console.error(e);
            alert('Export failed: ' + e.message);
        } finally {
            exportButton.textContent = label;
            syncState();
        }
    });

    syncState();
}

// "N1 Auto · N2 Manual · …" for the table, with No Ping in the danger colour
// and Manual in bold so they stand out.
function nozzleStatusList(nozzles) {
    const wrap = document.createElement('span');
    nozzles.forEach((n, i) => {
        if (i > 0) wrap.appendChild(document.createTextNode(' · '));
        const item = document.createElement('span');
        item.textContent = `N${n.nozzle_id} ${NOZZLE_STATUS_LABELS[n.status] || 'Unknown'}`;
        if (n.status === 2) item.style.color = 'var(--danger)';
        else if (n.status === 0) item.style.fontWeight = '600';
        else item.style.color = 'var(--text-secondary)';
        wrap.appendChild(item);
    });
    return wrap;
}

// Download one .xlsx per station, with one sheet per dispenser. Rows arrive
// sorted by station, dispenser, then created_at (server-side ORDER BY).
async function exportNozzleHistoryXlsx(rows, range) {
    const byStation = new Map();   // customer_code -> Map(dispenser key -> rows)
    for (const r of rows) {
        if (!byStation.has(r.customer_code)) byStation.set(r.customer_code, new Map());
        const dispensers = byStation.get(r.customer_code);
        const key = `${r.dispenser_id}|${r.address}`;
        if (!dispensers.has(key)) dispensers.set(key, []);
        dispensers.get(key).push(r);
    }

    const safe = s => String(s ?? '').replace(/[\\/:*?"<>|]+/g, '_').trim();
    let first = true;
    for (const [code, dispensers] of byStation) {
        // Browsers can drop back-to-back programmatic downloads; space them out.
        if (!first) await new Promise(r => setTimeout(r, 500));
        first = false;
        const sample = dispensers.values().next().value[0];
        const sheets = [...dispensers.values()].map(dRows => {
            const { matrix, mergeRefs } = nozzleHistorySheet(dRows);
            return { name: `${dRows[0].dispenser_id} (${dRows[0].address})`, matrix, mergeRefs };
        });
        const namePart = [code, sample.station_id].map(safe).filter(Boolean).join('-');
        downloadXlsxSheets(`nozzle-history-${namePart}-${range}.xlsx`, sheets);
    }
}

// The snapshot job inserts every nozzle's row one after another, so one
// snapshot's rows can straddle a second boundary. Rows within this window of
// a line's first row (and for a nozzle not already on that line) share a line.
const SNAPSHOT_GROUP_MS = 60 * 1000;

// One dispenser's sheet: a "Created At" column, then two columns (Status,
// Total Quantity) per nozzle side by side, under a merged "Nozzle N (product)"
// header. Each line is one nozzle_history snapshot.
function nozzleHistorySheet(rows) {
    const nozzleIds = [...new Set(rows.map(r => String(r.nozzle_id)))]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    // Header product = the nozzle's latest product within the range.
    const productOf = {};
    for (const r of rows) productOf[r.nozzle_id] = r.product;

    const fmtTime = t => {
        if (!t) return '';
        const d = new Date(t);
        return isNaN(d.getTime()) ? '' : d.toLocaleString();
    };
    const num = v => (v == null || v === '' || isNaN(Number(v))) ? '' : Number(v);
    const H = XLSX_STYLE.HEADER;

    // Two header rows: nozzle group titles (merged over their 2 columns), then
    // Status / Total Quantity. "Created At" is merged down across both.
    const top = [{ v: 'Created At', s: H }];
    const sub = [{ v: '', s: H }];
    const mergeRefs = ['A1:A2'];
    nozzleIds.forEach((id, i) => {
        const col = 1 + i * 2;
        const product = productOf[id] ? ` (${productOf[id]})` : '';
        top.push({ v: `Nozzle ${id}${product}`, s: H }, { v: '', s: H });
        sub.push({ v: 'Status', s: H }, { v: 'Total Quantity', s: H });
        mergeRefs.push(`${_xlsxColRef(col)}1:${_xlsxColRef(col + 1)}1`);
    });

    // Group rows into snapshot lines.
    const lines = [];
    let line = null;
    for (const r of rows) {
        const t = new Date(r.created_at).getTime();
        const id = String(r.nozzle_id);
        if (!line || line.byNozzle.has(id) || !(t - line.t < SNAPSHOT_GROUP_MS)) {
            line = { t, createdAt: r.created_at, byNozzle: new Map() };
            lines.push(line);
        }
        line.byNozzle.set(id, r);
    }

    const matrix = [top, sub];
    lines.forEach((l, li) => {
        const stripe = li % 2 === 1;
        const base = stripe ? XLSX_STYLE.STRIPE : XLSX_STYLE.DEFAULT;
        const out = [{ v: fmtTime(l.createdAt), s: base }];
        for (const id of nozzleIds) {
            const r = l.byNozzle.get(id);
            if (!r) {
                out.push({ v: '', s: base }, { v: '', s: base });
                continue;
            }
            const statusStyle = r.status === 2
                ? (stripe ? XLSX_STYLE.RED_TEXT_STRIPE : XLSX_STYLE.RED_TEXT)
                : r.status === 0
                    ? (stripe ? XLSX_STYLE.AMBER_TEXT_STRIPE : XLSX_STYLE.AMBER_TEXT)
                    : base;
            out.push({ v: NOZZLE_STATUS_LABELS[r.status] || 'Unknown', s: statusStyle },
                { v: num(r.total_quantity), s: base });
        }
        matrix.push(out);
    });

    return { matrix, mergeRefs };
}

window.renderExportHistory = renderExportHistory;
