// Web version of price_update_app/python/manual_entry.py.
// City + Customer dropdowns → list of registered DUCs → numeric price inputs
// per product. Publish posts to /api/admin/price-update/publish, which fires
// MQTT on PSO/<city>/<customer>/duc/price/<product> for every non-empty
// product. The backend tracks ACKs from duc/acked_msgs against the returned
// job_id; we poll /price-update/acks/:job_id every 2 s and paint each DUC row
// green as its ACK lands.

const PRICE_UPDATE_PRODUCTS = ['PMG', 'HSD', 'HOBC'];
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
    const byAddr = new Map(); // addr -> Set(products)
    for (const r of _pu.ducRows) {
        if ((r.customer_code || '').toString() !== customerCode) continue;
        const addr = (r.duc_address || '').toString().trim();
        if (!addr) continue;
        const product = (r.product || '').toString().toUpperCase().trim();
        if (!byAddr.has(addr)) byAddr.set(addr, new Set());
        if (product) byAddr.get(addr).add(product);
    }
    return Array.from(byAddr.entries()).map(([address, productSet]) => ({
        address,
        products: Array.from(productSet).sort()
    })).sort((a, b) => a.address.localeCompare(b.address));
}

function _puRenderForm(container) {
    container.innerHTML = '';

    // --- Top: City + Customer dropdowns side by side ---
    const row1 = document.createElement('div');
    row1.style.display = 'flex';
    row1.style.gap = '16px';
    row1.style.flexWrap = 'wrap';
    row1.style.marginBottom = '14px';

    // City picker
    const cityWrap = document.createElement('div');
    cityWrap.style.minWidth = '240px';
    cityWrap.style.flex = '1';
    const cityLabel = document.createElement('label');
    cityLabel.textContent = 'City';
    cityLabel.style.display = 'block';
    cityLabel.style.fontSize = '12px';
    cityLabel.style.color = 'var(--text-secondary)';
    cityLabel.style.marginBottom = '4px';
    cityWrap.appendChild(cityLabel);

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
    cityWrap.appendChild(cityDd.wrap);
    row1.appendChild(cityWrap);

    // Customer picker — scoped to selected city (or all when none selected)
    const custWrap = document.createElement('div');
    custWrap.style.minWidth = '240px';
    custWrap.style.flex = '1';
    const custLabel = document.createElement('label');
    custLabel.textContent = 'Customer Code';
    custLabel.style.display = 'block';
    custLabel.style.fontSize = '12px';
    custLabel.style.color = 'var(--text-secondary)';
    custLabel.style.marginBottom = '4px';
    custWrap.appendChild(custLabel);

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
    custWrap.appendChild(custDd.wrap);
    row1.appendChild(custWrap);

    container.appendChild(row1);

    // --- Price inputs row ---
    const priceCard = document.createElement('div');
    Object.assign(priceCard.style, {
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '14px',
        marginBottom: '14px'
    });

    const priceHeader = document.createElement('div');
    priceHeader.textContent = 'New Prices';
    priceHeader.style.fontSize = '14px';
    priceHeader.style.fontWeight = '600';
    priceHeader.style.marginBottom = '10px';
    priceCard.appendChild(priceHeader);

    const priceRow = document.createElement('div');
    priceRow.style.display = 'flex';
    priceRow.style.gap = '16px';
    priceRow.style.flexWrap = 'wrap';

    _pu.el.priceInputs = {};
    _pu.el.priceChecks = {};
    PRICE_UPDATE_PRODUCTS.forEach(product => {
        const cell = document.createElement('div');
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.gap = '8px';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = !!_pu.enabled[product];
        check.id = `pu-check-${product}`;
        cell.appendChild(check);

        const lbl = document.createElement('label');
        lbl.htmlFor = check.id;
        lbl.textContent = product;
        lbl.style.fontWeight = '600';
        lbl.style.minWidth = '46px';
        cell.appendChild(lbl);

        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.min = '0';
        input.placeholder = '0.00';
        input.disabled = !check.checked;
        Object.assign(input.style, {
            width: '110px',
            padding: '6px 8px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)'
        });
        cell.appendChild(input);

        check.addEventListener('change', () => {
            _pu.enabled[product] = check.checked;
            input.disabled = !check.checked;
            if (!check.checked) input.value = '';
        });

        _pu.el.priceInputs[product] = input;
        _pu.el.priceChecks[product] = check;
        priceRow.appendChild(cell);
    });
    priceCard.appendChild(priceRow);

    // Publish button + status line
    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.alignItems = 'center';
    actionRow.style.gap = '12px';
    actionRow.style.marginTop = '14px';

    const publishBtn = createActionButton('#004D64', '#00324C');
    publishBtn.textContent = 'Publish';
    publishBtn.style.padding = '8px 18px';
    publishBtn.addEventListener('click', () => _puPublish(publishBtn, statusLine));
    actionRow.appendChild(publishBtn);

    const statusLine = document.createElement('div');
    statusLine.style.fontSize = '12px';
    statusLine.style.color = 'var(--text-secondary)';
    actionRow.appendChild(statusLine);

    priceCard.appendChild(actionRow);
    container.appendChild(priceCard);

    _pu.el.statusLine = statusLine;
    _pu.el.publishBtn = publishBtn;

    // --- DUCs table container ---
    const ducCard = document.createElement('div');
    Object.assign(ducCard.style, {
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '14px'
    });
    const ducHeader = document.createElement('div');
    ducHeader.textContent = 'Registered DUCs';
    ducHeader.style.fontSize = '14px';
    ducHeader.style.fontWeight = '600';
    ducHeader.style.marginBottom = '10px';
    ducCard.appendChild(ducHeader);

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
    ['DUC Address', 'Product', 'ACK Status', 'ACKed At'].forEach(h => {
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
            rows.push({ address: duc.address, product });
        }
    }
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 4;
        td.textContent = 'No DUC/product combinations found.';
        td.style.padding = '10px';
        td.style.color = 'var(--text-secondary)';
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        for (const r of rows) {
            const tr = document.createElement('tr');
            tr.dataset.address = r.address;
            tr.dataset.product = r.product;
            tr.style.borderBottom = '1px solid var(--border-soft)';

            const cells = [r.address, r.product, '—', ''];
            cells.forEach((val, i) => {
                const td = document.createElement('td');
                td.textContent = val;
                td.style.padding = '6px 8px';
                if (i === 2) td.classList.add('pu-status-cell');
                if (i === 3) td.classList.add('pu-ackat-cell');
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
    }
    table.appendChild(tbody);
    host.appendChild(table);

    // If a job is currently running, repaint any cells whose ACK already
    // arrived (the row table may have just been rebuilt).
    if (_pu.activeJob) _puPaintAckStatus();
}

async function _puPublish(button, statusLine) {
    if (!_pu.selectedCity) return alert('Pick a city first');
    if (!_pu.selectedCustomer) return alert('Pick a customer code first');

    // Build prices payload — only enabled+filled rows.
    const prices = {};
    for (const product of PRICE_UPDATE_PRODUCTS) {
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

    try {
        const resp = await fetch(`${API_BASE_URL}/admin/price-update/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city: _pu.selectedCity,
                customer_code: _pu.selectedCustomer,
                prices
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

        const totalDucs = (data.items || []).reduce((s, it) => s + it.totalDucs, 0);
        const skippedMsg = (data.skipped && data.skipped.length)
            ? `  ·  Skipped: ${data.skipped.join(', ')} (no DUCs)`
            : '';
        statusLine.textContent = `Job ${data.jobId.slice(0, 8)}…  ·  awaiting ${totalDucs} ACKs${skippedMsg}`;

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
            _pu.el.statusLine.textContent = `Job ${job.jobId.slice(0, 8)}…  ·  ${totalAcked}/${totalExpected} ACKed`;
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
    wrap.style.maxWidth = '900px';

    const title = document.createElement('h2');
    title.textContent = 'Price Update';
    title.style.margin = '0 0 4px';
    wrap.appendChild(title);

    const sub = document.createElement('div');
    sub.style.fontSize = '13px';
    sub.style.color = 'var(--text-secondary)';
    sub.style.marginBottom = '14px';
    sub.textContent = 'Push price changes to DUCs over MQTT. ACKs appear here as each DUC applies the new price.';
    wrap.appendChild(sub);

    const formHost = document.createElement('div');
    wrap.appendChild(formHost);

    loader.remove();
    content.appendChild(wrap);

    _puRenderForm(formHost);
}

window.renderPriceUpdate = renderPriceUpdate;
