// Web version of price_update_app/python/manual_entry.py.
// City + Customer dropdowns → list of registered DUCs → numeric price inputs
// per product. Publish posts to /api/admin/price-update/publish, which fires
// MQTT on PSO/<city>/<customer>/duc/price/<product> for every non-empty
// product. The backend tracks ACKs from duc/acked_msgs against the returned
// job_id; we poll /price-update/acks/:job_id every 2 s and paint each DUC row
// green as its ACK lands.

const ACK_POLL_INTERVAL_MS = 2000;
const ACK_POLL_TIMEOUT_MS = 5 * 60 * 1000; // stop polling after 5 min of no progress

const _pu = {
    // Flat DUC rows from /api/ducs — same payload the Python app consumes
    // via the integration port. Shape per row:
    //   { sno, customer_code, station_id, division, city, duc_address,
    //     dispenser_id, nozzle_id, product }
    ducRows: [],
    cityToCustomers: new Map(),   // 'Karachi' -> ['102563', ...]
    customerToCity: new Map(),    // '102563' -> 'Karachi'
    customerToStationId: new Map(),
    selectedCity: '',
    selectedCustomer: '',
    ducsForCustomer: [],          // [{address, products: [PMG, ...]}]
    enabled: { PMG: false, HSD: false, HOBC: false },
    retain: false,                // MQTT retain flag for the published price
    activeJob: null,
    pollTimer: null,
    lastProgressAt: 0,
    el: {}
};

function _puFormatStationLabel(customerCode) {
    const sid = _pu.customerToStationId.get(customerCode) || '';
    return sid ? `${customerCode} - ${sid}` : customerCode;
}

// Customer dropdown items, scoped by the currently-selected city. Returns
// the dropdown-friendly { value, label, secondary } shape. Called by both the
// initial dropdown setup and `commitCity` so swapping cities just calls
// setItems(this) without rebuilding the dropdown.
function _puCustomerItems() {
    const pool = _pu.selectedCity
        ? (_pu.cityToCustomers.get(_pu.selectedCity) || [])
        : Array.from(_pu.customerToCity.keys());
    return [...pool].sort().map(c => ({
        value: c,
        label: _puFormatStationLabel(c),
        secondary: _pu.customerToCity.get(c) || ''
    }));
}

function _puCodeFromLabel(label) {
    if (!label) return '';
    const idx = label.indexOf(' - ');
    return idx >= 0 ? label.slice(0, idx).trim() : label.trim();
}

// One-shot load of the full DUC inventory from /api/ducs (the same endpoint
// the Python price-update tool calls). Builds all the lookup maps the page
// needs so customer/city filtering is local — no per-selection round-trip.
async function _puLoadDucInventory() {
    const resp = await fetch(`${API_BASE_URL}/ducs`);
    if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
    }
    const rows = await resp.json();
    _pu.ducRows = rows;

    _pu.cityToCustomers = new Map();
    _pu.customerToCity = new Map();
    _pu.customerToStationId = new Map();
    for (const r of rows) {
        const code = (r.customer_code || '').toString().trim();
        // Title-case city for grouping (matches Python build_customer_city_map).
        const cityRaw = (r.city || '').toString().trim();
        const city = cityRaw ? cityRaw.replace(/\w\S*/g, t =>
            t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()) : '';
        if (!code) continue;
        if (!_pu.customerToCity.has(code) && city) _pu.customerToCity.set(code, city);
        if (!_pu.customerToStationId.has(code) && r.station_id) {
            _pu.customerToStationId.set(code, r.station_id);
        }
        if (city) {
            if (!_pu.cityToCustomers.has(city)) _pu.cityToCustomers.set(city, new Set());
            _pu.cityToCustomers.get(city).add(code);
        }
    }
    // Sets → sorted arrays for stable iteration.
    for (const [city, set] of _pu.cityToCustomers) {
        _pu.cityToCustomers.set(city, Array.from(set).sort());
    }
}

// Filter the cached inventory down to one customer, aggregated to one entry
// per DUC address with the union of its products. Equivalent to
// Python's find_ducs_for + dedup, but kept whole so the table can show
// (DUC × product) rows.
function _puDucsForCustomer(customerCode) {
    const byAddr = new Map(); // addr -> { products:Set, connStatus }
    for (const r of _pu.ducRows) {
        if ((r.customer_code || '').toString() !== customerCode) continue;
        const addr = (r.duc_address || '').toString().trim();
        if (!addr) continue;
        if (!byAddr.has(addr)) byAddr.set(addr, { products: new Set(), connStatus: r.conn_status });
        const product = (r.product || '').toString().toUpperCase().trim();
        if (product) byAddr.get(addr).products.add(product);
    }
    return Array.from(byAddr.entries()).map(([address, { products, connStatus }]) => ({
        address,
        products: Array.from(products).sort(),
        connStatus
    })).sort((a, b) => a.address.localeCompare(b.address));
}

function _puRenderForm(container) {
    container.innerHTML = '';

    // Shared card / title / label styling so the page matches the rest of the app.
    const makeCard = () => {
        const card = document.createElement('div');
        Object.assign(card.style, {
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px'
        });
        return card;
    };
    const cardTitle = (text) => {
        const h = document.createElement('div');
        h.textContent = text;
        h.style.fontSize = '15px';
        h.style.fontWeight = '600';
        h.style.color = 'var(--text-heading)';
        h.style.marginBottom = '12px';
        return h;
    };
    const fieldLabel = (text) => {
        const label = document.createElement('label');
        label.textContent = text;
        label.style.display = 'block';
        label.style.fontSize = '13px';
        label.style.fontWeight = '600';
        label.style.color = 'var(--text-primary)';
        label.style.marginBottom = '6px';
        return label;
    };

    // --- Card 1: Station selection (City + Customer side by side) ---
    const selectorCard = makeCard();
    selectorCard.appendChild(cardTitle('Station'));

    const row1 = document.createElement('div');
    row1.style.display = 'grid';
    row1.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
    row1.style.gap = '16px';

    // City picker
    const cityWrap = document.createElement('div');
    cityWrap.appendChild(fieldLabel('City'));

    // Forward references resolved after both dropdowns are built. Allows
    // city-select to refresh customer's item list and vice versa without a
    // full form rebuild (which would tear down the very dropdown the user
    // just clicked, dropping selection state in the process).
    let cityDd, custDd;

    const commitCustomer = (code) => {
        if (!code || code === _pu.selectedCustomer) return;
        if (!_pu.customerToCity.has(code)) return;  // unknown — ignore
        _pu.selectedCustomer = code;
        // Auto-fill city when the picked customer pins one — keeps the two
        // dropdowns in sync without rebuilding either.
        const city = _pu.customerToCity.get(code);
        if (city && _pu.selectedCity !== city) {
            _pu.selectedCity = city;
            if (cityDd) cityDd.input.value = city;
        }
        _pu.ducsForCustomer = _puDucsForCustomer(code);
        _puRenderDucTable();
    };

    const commitCity = (city) => {
        if (!city || city === _pu.selectedCity) return;
        if (!_pu.cityToCustomers.has(city)) return;
        _pu.selectedCity = city;
        // Customer scope shifted — clear current pick and refresh items.
        _pu.selectedCustomer = '';
        _pu.ducsForCustomer = [];
        if (custDd) {
            custDd.input.value = '';
            custDd.setItems(_puCustomerItems());
        }
        _puRenderDucTable();
    };

    const cities = Array.from(_pu.cityToCustomers.keys()).sort();
    cityDd = createSearchableDropdown({
        placeholder: 'Select city…',
        items: () => cities.map(c => ({ value: c, label: c })),
        emptyText: 'No matching city',
        onSelect: (value) => commitCity(value),
        // Typed-then-Enter / blur path: when the field contains an exact
        // city name, treat it as a pick. createSearchableDropdown doesn't
        // fire onSelect for keyboard-only flows, so we do it here.
        onInput: (val) => {
            const trimmed = (val || '').trim();
            if (_pu.cityToCustomers.has(trimmed)) commitCity(trimmed);
        }
    });
    if (_pu.selectedCity) cityDd.input.value = _pu.selectedCity;
    cityDd.wrap.style.width = '100%';
    cityWrap.appendChild(cityDd.wrap);
    row1.appendChild(cityWrap);

    // Customer picker — scoped to selected city (or all when none selected)
    const custWrap = document.createElement('div');
    custWrap.appendChild(fieldLabel('Customer Code'));

    custDd = createSearchableDropdown({
        placeholder: 'Select customer code…',
        items: _puCustomerItems,
        emptyText: 'No matching customer',
        onSelect: (value) => commitCustomer(_puCodeFromLabel(value)),
        // Typed-then-Enter / blur: when the user types a bare customer code
        // that matches one we know about, treat it as picked. Also handles
        // pasting "<code> - <station>" by stripping the suffix first.
        onInput: (val) => {
            const code = _puCodeFromLabel((val || '').trim());
            if (_pu.customerToCity.has(code)) commitCustomer(code);
        }
    });
    if (_pu.selectedCustomer) custDd.input.value = _puFormatStationLabel(_pu.selectedCustomer);
    custDd.wrap.style.width = '100%';
    custWrap.appendChild(custDd.wrap);
    row1.appendChild(custWrap);

    selectorCard.appendChild(row1);
    container.appendChild(selectorCard);

    // --- Card 2: New Prices ---
    const priceCard = makeCard();
    priceCard.appendChild(cardTitle('New Prices'));

    // Responsive grid: each product gets an enable-checkbox + full-width price
    // input that fills an equal column, so the row spans the whole card instead
    // of trailing off three-quarters of the way across.
    const priceGrid = document.createElement('div');
    priceGrid.style.display = 'grid';
    priceGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    priceGrid.style.gap = '14px';

    _pu.el.priceInputs = {};
    _pu.el.priceChecks = {};
    PRODUCT_OPTIONS.forEach(product => {
        const cell = document.createElement('div');

        const head = document.createElement('div');
        head.style.display = 'flex';
        head.style.alignItems = 'center';
        head.style.gap = '8px';
        head.style.marginBottom = '6px';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = !!_pu.enabled[product];
        check.id = `pu-check-${product}`;

        const lbl = document.createElement('label');
        lbl.htmlFor = check.id;
        lbl.textContent = product;
        lbl.style.fontWeight = '600';
        lbl.style.fontSize = '13px';
        lbl.style.color = 'var(--text-primary)';

        head.appendChild(check);
        head.appendChild(lbl);
        cell.appendChild(head);

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.min = '0';
        input.placeholder = '0.00';
        input.disabled = !check.checked;
        Object.assign(input.style, {
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            fontSize: '14px'
        });
        cell.appendChild(input);

        check.addEventListener('change', () => {
            _pu.enabled[product] = check.checked;
            input.disabled = !check.checked;
            if (!check.checked) input.value = '';
        });

        _pu.el.priceInputs[product] = input;
        _pu.el.priceChecks[product] = check;
        priceGrid.appendChild(cell);
    });
    priceCard.appendChild(priceGrid);

    // Retain option — broker keeps the last price so DUCs that join later get it.
    const retainRow = document.createElement('div');
    retainRow.style.display = 'flex';
    retainRow.style.alignItems = 'center';
    retainRow.style.gap = '8px';
    retainRow.style.marginTop = '14px';

    const retainCheck = document.createElement('input');
    retainCheck.type = 'checkbox';
    retainCheck.id = 'pu-retain';
    retainCheck.checked = !!_pu.retain;
    retainCheck.addEventListener('change', () => { _pu.retain = retainCheck.checked; });

    const retainLbl = document.createElement('label');
    retainLbl.htmlFor = 'pu-retain';
    retainLbl.textContent = 'Retain message';
    retainLbl.title = 'Broker keeps the last published price so DUCs that connect later receive it immediately.';
    retainLbl.style.fontSize = '13px';
    retainLbl.style.color = 'var(--text-primary)';

    retainRow.appendChild(retainCheck);
    retainRow.appendChild(retainLbl);
    priceCard.appendChild(retainRow);

    // Publish button + status line
    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.alignItems = 'center';
    actionRow.style.gap = '12px';
    actionRow.style.marginTop = '16px';

    const publishBtn = createActionButton('#004D64', '#00324C');
    publishBtn.textContent = 'Publish';
    publishBtn.style.padding = '8px 22px';
    publishBtn.addEventListener('click', () => _puPublish(publishBtn, statusLine));
    actionRow.appendChild(publishBtn);

    const statusLine = document.createElement('div');
    statusLine.style.fontSize = '13px';
    statusLine.style.color = 'var(--text-secondary)';
    actionRow.appendChild(statusLine);

    priceCard.appendChild(actionRow);

    // List of messages from the last publish (topic + price + DUC count) so the
    // operator can see/debug exactly what went out.
    const publishedList = document.createElement('div');
    publishedList.style.marginTop = '12px';
    priceCard.appendChild(publishedList);
    _pu.el.publishedList = publishedList;

    container.appendChild(priceCard);

    _pu.el.statusLine = statusLine;
    _pu.el.publishBtn = publishBtn;

    // --- Card 3: Registered DUCs ---
    const ducCard = makeCard();
    ducCard.style.marginBottom = '0';
    ducCard.appendChild(cardTitle('Registered DUCs'));

    _pu.el.ducTableHost = document.createElement('div');
    ducCard.appendChild(_pu.el.ducTableHost);
    container.appendChild(ducCard);

    _puRenderDucTable();
}

function _puRenderDucTable() {
    const host = _pu.el.ducTableHost;
    if (!host) return;
    host.innerHTML = '';

    if (!_pu.selectedCustomer) {
        const msg = document.createElement('div');
        msg.textContent = 'Select a customer code to list its DUCs.';
        msg.style.color = 'var(--text-secondary)';
        msg.style.fontSize = '13px';
        host.appendChild(msg);
        return;
    }
    if (_pu.ducsForCustomer.length === 0) {
        const msg = document.createElement('div');
        msg.textContent = 'No DUCs registered for this customer.';
        msg.style.color = 'var(--text-secondary)';
        msg.style.fontSize = '13px';
        host.appendChild(msg);
        return;
    }

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontSize = '13px';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    ['DUC Address', 'Product', 'Connection', 'ACK Status', 'ACKed At'].forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        th.style.textAlign = 'left';
        th.style.padding = '6px 8px';
        th.style.borderBottom = '1px solid var(--border)';
        th.style.background = 'var(--bg-table-head)';
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    // Flatten DUCs × products. One row per (address, product) that the DUC
    // actually has. Lets the operator see exactly which (DUC, product) pairs
    // are expected to ACK.
    const rows = [];
    for (const duc of _pu.ducsForCustomer) {
        const products = duc.products && duc.products.length ? duc.products : ['—'];
        for (const product of products) {
            rows.push({ address: duc.address, product, connStatus: duc.connStatus });
        }
    }
    // Small helper: a padded <td>. Pass styles to override (e.g. colored conn).
    const cell = (text, styles = {}) => {
        const td = document.createElement('td');
        td.textContent = text;
        td.style.padding = '6px 8px';
        Object.assign(td.style, styles);
        return td;
    };

    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = cell('No DUC/product combinations found.', { padding: '10px', color: 'var(--text-secondary)' });
        td.colSpan = 5;
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        for (const r of rows) {
            const tr = document.createElement('tr');
            tr.dataset.address = r.address;
            tr.dataset.product = r.product;
            tr.style.borderBottom = '1px solid var(--border-soft)';

            tr.appendChild(cell(r.address));
            tr.appendChild(cell(r.product));

            const connected = Number(r.connStatus) === 1;
            tr.appendChild(cell(connected ? 'Connected' : 'Disconnected', {
                color: connected ? 'var(--badge-online-text)' : 'var(--badge-offline-text)',
                fontWeight: '600'
            }));

            const statusTd = cell('—');
            statusTd.classList.add('pu-status-cell');
            tr.appendChild(statusTd);

            const ackatTd = cell('');
            ackatTd.classList.add('pu-ackat-cell');
            tr.appendChild(ackatTd);

            tbody.appendChild(tr);
        }
    }
    table.appendChild(tbody);
    host.appendChild(table);

    // If a job is currently running, repaint any cells whose ACK already
    // arrived (the row table may have just been rebuilt).
    if (_pu.activeJob) _puPaintAckStatus();
}

// Render the list of just-published messages: one row per product showing the
// MQTT topic, the price, and how many DUCs it targeted — plus the effective
// time and retain flag. Gives the operator a clear, debuggable record.
function _puRenderPublished(data) {
    const host = _pu.el.publishedList;
    if (!host) return;
    host.innerHTML = '';

    const items = data.items || [];
    if (items.length === 0) return;

    const effDate = data.effectiveAt ? new Date(data.effectiveAt * 1000) : null;
    const head = document.createElement('div');
    head.style.fontSize = '13px';
    head.style.fontWeight = '600';
    head.style.color = 'var(--text-primary)';
    head.style.marginBottom = '8px';
    const bits = [`Published ${items.length} message${items.length === 1 ? '' : 's'}`];
    if (effDate) bits.push(`effective ${effDate.toLocaleString()}`);
    if (data.retained) bits.push('retained');
    head.textContent = bits.join('  ·  ');
    host.appendChild(head);

    items.forEach(it => {
        const row = document.createElement('div');
        Object.assign(row.style, {
            border: '1px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--bg-surface-2)',
            padding: '8px 10px',
            marginBottom: '6px'
        });

        const topicLine = document.createElement('div');
        topicLine.style.fontFamily = 'monospace';
        topicLine.style.fontSize = '12px';
        topicLine.style.color = 'var(--text-primary)';
        topicLine.style.wordBreak = 'break-all';
        topicLine.textContent = it.topic;
        row.appendChild(topicLine);

        const metaLine = document.createElement('div');
        metaLine.style.fontSize = '12px';
        metaLine.style.color = 'var(--text-secondary)';
        metaLine.style.marginTop = '2px';
        metaLine.textContent = `${it.product}  ·  Rs ${it.price}  ·  ${it.totalDucs} DUC${it.totalDucs === 1 ? '' : 's'}`;
        row.appendChild(metaLine);

        host.appendChild(row);
    });

    if (data.skipped && data.skipped.length) {
        const sk = document.createElement('div');
        sk.style.fontSize = '12px';
        sk.style.color = 'var(--text-secondary)';
        sk.style.marginTop = '4px';
        sk.textContent = `Skipped (no DUCs): ${data.skipped.join(', ')}`;
        host.appendChild(sk);
    }
}

async function _puPublish(button, statusLine) {
    if (!_pu.selectedCity) return alert('Pick a city first');
    if (!_pu.selectedCustomer) return alert('Pick a customer code first');

    // Build prices payload — only enabled+filled rows.
    const prices = {};
    for (const product of PRODUCT_OPTIONS) {
        if (!_pu.enabled[product]) continue;
        const raw = _pu.el.priceInputs[product].value.trim();
        if (!raw) continue;
        const num = Number(raw);
        if (!Number.isFinite(num) || num <= 0) {
            return alert(`Invalid ${product} price: ${raw}`);
        }
        prices[product] = num;
    }
    if (Object.keys(prices).length === 0) {
        return alert('Enable at least one product and enter a price.');
    }

    // Stop any prior poll loop — fresh job starts now.
    if (_pu.pollTimer) {
        clearInterval(_pu.pollTimer);
        _pu.pollTimer = null;
    }
    _pu.activeJob = null;

    button.disabled = true;
    button.textContent = 'Publishing…';
    statusLine.textContent = '';
    statusLine.style.color = 'var(--text-secondary)';
    if (_pu.el.publishedList) _pu.el.publishedList.innerHTML = '';

    try {
        const resp = await fetch(`${API_BASE_URL}/admin/price-update/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city: _pu.selectedCity,
                customer_code: _pu.selectedCustomer,
                prices,
                retain: !!_pu.retain
            })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

        _pu.activeJob = {
            jobId: data.jobId,
            items: data.items || [],
            startedAt: Date.now(),
            ackedByDuc: new Map()  // "address|product" -> ackedAt (ISO)
        };
        _pu.lastProgressAt = Date.now();

        // Reset all status cells to "Pending" for rows that match a published item.
        _pu.el.ducTableHost.querySelectorAll('tr[data-address]').forEach(tr => {
            const addr = tr.dataset.address;
            const product = tr.dataset.product;
            const item = _pu.activeJob.items.find(it => it.product === product);
            const statusCell = tr.querySelector('.pu-status-cell');
            const ackCell = tr.querySelector('.pu-ackat-cell');
            if (item && item.ducs && item.ducs.includes(addr)) {
                statusCell.textContent = 'Pending';
                statusCell.style.color = 'var(--badge-reset-text)';
                ackCell.textContent = '';
            } else {
                statusCell.textContent = 'Not in batch';
                statusCell.style.color = 'var(--text-secondary)';
                ackCell.textContent = '';
            }
        });

        // Show the list of published messages (topics + price + DUC counts +
        // effective time) so the operator can see exactly what went out.
        _puRenderPublished(data);

        const totalDucs = (data.items || []).reduce((s, it) => s + it.totalDucs, 0);
        statusLine.textContent = `Awaiting ${totalDucs} ACK${totalDucs === 1 ? '' : 's'}…`;

        // Begin polling.
        _pu.pollTimer = setInterval(_puPollAcks, ACK_POLL_INTERVAL_MS);
    } catch (e) {
        statusLine.textContent = `Publish failed: ${e.message}`;
        statusLine.style.color = 'var(--badge-reset-text)';
    } finally {
        button.disabled = false;
        button.textContent = 'Publish';
    }
}

async function _puPollAcks() {
    const job = _pu.activeJob;
    if (!job) {
        if (_pu.pollTimer) { clearInterval(_pu.pollTimer); _pu.pollTimer = null; }
        return;
    }
    try {
        const resp = await fetch(`${API_BASE_URL}/admin/price-update/acks/${encodeURIComponent(job.jobId)}`);
        if (!resp.ok) return;
        const data = await resp.json();

        // Walk every item; mark newly-acked (address, product) pairs.
        let totalExpected = 0, totalAcked = 0, anyNew = false;
        for (const item of data.items || []) {
            totalExpected += item.totalDucs || 0;
            totalAcked += item.ackedCount || 0;
            for (const a of (item.acked || [])) {
                const key = `${a.device}|${item.product}`;
                if (!job.ackedByDuc.has(key)) {
                    job.ackedByDuc.set(key, a.at);
                    anyNew = true;
                }
            }
        }
        if (anyNew) {
            _pu.lastProgressAt = Date.now();
            _puPaintAckStatus();
        }

        // Update status line.
        if (_pu.el.statusLine) {
            _pu.el.statusLine.textContent = `${totalAcked}/${totalExpected} ACKed`;
            _pu.el.statusLine.style.color = (totalAcked === totalExpected)
                ? 'var(--badge-online-text)' : 'var(--text-secondary)';
        }

        // Stop conditions: all ACKed, or no progress in ACK_POLL_TIMEOUT_MS.
        if (totalAcked >= totalExpected) {
            if (_pu.pollTimer) { clearInterval(_pu.pollTimer); _pu.pollTimer = null; }
            return;
        }
        if (Date.now() - _pu.lastProgressAt > ACK_POLL_TIMEOUT_MS) {
            if (_pu.pollTimer) { clearInterval(_pu.pollTimer); _pu.pollTimer = null; }
            if (_pu.el.statusLine) {
                _pu.el.statusLine.textContent += '  ·  polling stopped (no progress in 5 min)';
            }
        }
    } catch (e) {
        // network blip — just try again next tick
        console.warn('ack poll failed:', e.message);
    }
}

function _puPaintAckStatus() {
    if (!_pu.activeJob) return;
    _pu.el.ducTableHost.querySelectorAll('tr[data-address]').forEach(tr => {
        const key = `${tr.dataset.address}|${tr.dataset.product}`;
        const ackedAt = _pu.activeJob.ackedByDuc.get(key);
        const statusCell = tr.querySelector('.pu-status-cell');
        const ackCell = tr.querySelector('.pu-ackat-cell');
        if (!statusCell || !ackCell) return;
        if (ackedAt) {
            statusCell.textContent = '✓ Acknowledged';
            statusCell.style.color = 'var(--badge-online-text)';
            try {
                ackCell.textContent = new Date(ackedAt).toLocaleTimeString();
            } catch (e) {
                ackCell.textContent = ackedAt;
            }
        }
    });
}

async function renderPriceUpdate() {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = '';

    // Page is restricted to admin / super_admin (the sidebar hides it for other
    // roles, but guard direct-URL access too).
    const role = (typeof StationAuth !== 'undefined' && StationAuth.getUserInfo()?.role) || null;
    if (role !== 'admin' && role !== 'super_admin') {
        const denied = document.createElement('div');
        denied.textContent = 'Access denied — Price Update is restricted to administrators.';
        denied.style.padding = '24px';
        denied.style.color = 'var(--danger)';
        content.appendChild(denied);
        return;
    }

    const loader = createPageLoader('Loading Price Update…');
    content.appendChild(loader);

    try {
        await _puLoadDucInventory();
    } catch (e) {
        loader.remove();
        const err = document.createElement('div');
        err.textContent = `Failed to load DUC inventory: ${e.message}`;
        err.style.color = 'var(--danger)';
        err.style.padding = '20px';
        content.appendChild(err);
        return;
    }

    const wrap = document.createElement('div');
    wrap.style.maxWidth = '760px';

    const title = document.createElement('h2');
    title.textContent = 'Price Update';
    title.style.margin = '0 0 4px';
    title.style.color = 'var(--text-heading)';
    wrap.appendChild(title);

    const sub = document.createElement('div');
    sub.style.fontSize = '13px';
    sub.style.color = 'var(--text-secondary)';
    sub.style.marginBottom = '16px';
    sub.textContent = 'Push price changes to DUCs over MQTT. ACKs appear here as each DUC applies the new price.';
    wrap.appendChild(sub);

    const formHost = document.createElement('div');
    wrap.appendChild(formHost);

    loader.remove();
    content.appendChild(wrap);

    _puRenderForm(formHost);
}

window.renderPriceUpdate = renderPriceUpdate;
