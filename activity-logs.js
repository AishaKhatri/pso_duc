// Activity Logs page (super_admin only). The date range is required before
// fetching so the table never asks the backend for the full history.

const ACTIVITY_LOG_COLUMNS = ['Time', 'User', 'Role', 'IP', 'Action', 'Entity', 'Details'];

function todayLocalISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function buildDateInput(value) {
    const input = document.createElement('input');
    input.type = 'date';
    input.value = value;
    input.style.padding = '8px';
    input.style.border = '1px solid var(--border)';
    input.style.borderRadius = '6px';
    input.style.backgroundColor = 'var(--bg-surface)';
    input.style.color = 'var(--text-primary)';
    return input;
}

async function renderActivityLogs() {
    const content = document.getElementById('content');
    content.innerHTML = '';

    // Filter bar
    const filterBar = document.createElement('div');
    filterBar.style.display = 'flex';
    filterBar.style.flexWrap = 'wrap';
    filterBar.style.alignItems = 'flex-end';
    filterBar.style.gap = '12px';
    filterBar.style.marginBottom = '16px';

    const today = todayLocalISO();
    const fromInput = buildDateInput(today);
    const toInput = buildDateInput(today);

    const fromWrap = document.createElement('div');
    fromWrap.style.display = 'flex';
    fromWrap.style.flexDirection = 'column';
    fromWrap.style.gap = '4px';
    const fromLabel = document.createElement('label');
    fromLabel.textContent = 'From';
    fromLabel.style.fontSize = '13px';
    fromLabel.style.color = 'var(--text-secondary)';
    fromWrap.appendChild(fromLabel);
    fromWrap.appendChild(fromInput);

    const toWrap = document.createElement('div');
    toWrap.style.display = 'flex';
    toWrap.style.flexDirection = 'column';
    toWrap.style.gap = '4px';
    const toLabel = document.createElement('label');
    toLabel.textContent = 'To';
    toLabel.style.fontSize = '13px';
    toLabel.style.color = 'var(--text-secondary)';
    toWrap.appendChild(toLabel);
    toWrap.appendChild(toInput);

    const fetchButton = createActionButton('#004D64', '#00324C');
    fetchButton.textContent = 'Fetch';

    const statusLine = document.createElement('div');
    statusLine.style.marginLeft = 'auto';
    statusLine.style.fontSize = '13px';
    statusLine.style.color = 'var(--text-secondary)';

    filterBar.appendChild(fromWrap);
    filterBar.appendChild(toWrap);
    filterBar.appendChild(fetchButton);
    filterBar.appendChild(statusLine);
    content.appendChild(filterBar);

    const { tableContainer } = createTable(ACTIVITY_LOG_COLUMNS);
    content.appendChild(tableContainer);

    const usersById = await loadUsersById();

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
            const rows = await res.json();
            renderActivityRows(rows, usersById);
            statusLine.textContent = `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`;
        } catch (e) {
            console.error(e);
            statusLine.textContent = 'Error: ' + e.message;
        } finally {
            fetchButton.disabled = false;
        }
    }

    fetchButton.addEventListener('click', doFetch);
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

    rows.forEach(row => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border)';

        appendCell(tr, new Date(row.created_at).toLocaleString());
        appendCell(tr, row.username || '-');
        appendCell(tr, usersById[row.user_id]?.role || '-');
        appendCell(tr, row.ip_address || '-');
        appendCell(tr, row.action || '-');
        appendCell(tr, [row.entity_type, row.entity_id].filter(Boolean).join(':') || '-');
        appendDetailsCell(tr, row.details);

        tbody.appendChild(tr);
    });
}

function appendCell(tr, text) {
    const td = document.createElement('td');
    td.style.padding = '10px 12px';
    td.style.verticalAlign = 'top';
    td.textContent = text;
    tr.appendChild(td);
}

function appendDetailsCell(tr, details) {
    const td = document.createElement('td');
    td.style.padding = '10px 12px';
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
    fullPre.style.maxHeight = '320px';
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

window.renderActivityLogs = renderActivityLogs;
