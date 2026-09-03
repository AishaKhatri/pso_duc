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
    customerToPrices: new Map(),  // '102563' -> { PMG, HSD, HOBC, updatedAt } (filed prices from stations table)
    selectedCity: '',
    selectedCustomer: '',
    ducsForCustomer: [],          // [{address, products: [PMG, ...]}]
    enabled: { PMG: false, HSD: false, HOBC: false },
    retain: false,                // MQTT retain flag for the published price
    effectiveMode: 'now',         // 'now' | 'minutes' — when DUCs apply the price
    effectiveMinutes: 5,          // used when effectiveMode === 'minutes'
    activeJob: null,
    pollTimer: null,
    disableTimer: null,           // re-enables the Publish button when the job's window ends
    countdownTimer: null,         // 1 s ticker for the active-job countdown / status line
    lastProgressAt: 0,
    el: {}
};

// Enable/disable the Publish button with a matching cursor so it visibly reads
// as unavailable while a job is in flight.
function _puSetPublishLocked(locked) {
    const btn = _pu.el.publishBtn;
    if (!btn) return;
    btn.disabled = locked;
    btn.style.cursor = locked ? 'not-allowed' : 'pointer';
    btn.style.opacity = locked ? '0.6' : '1';
}

// Lock the Publish button for `ms` (the server-reported remaining window of the
// active job), then auto-unlock. Clears any prior timer so a fresh/restored job
// resets the countdown. Server sends the duration so client clock skew is moot.
// Used for the 409 case (another job active) where we don't show that job here.
function _puLockPublishFor(ms) {
    _puSetPublishLocked(true);
    if (_pu.disableTimer) { clearTimeout(_pu.disableTimer); _pu.disableTimer = null; }
    _pu.disableTimer = setTimeout(() => {
        _pu.disableTimer = null;
        _puSetPublishLocked(false);
    }, Math.max(0, Number(ms) || 0));
}

// Paint the job status line. state: 'active' (with remainingMs) | 'completed' |
// 'dismissed' | null (clear).
function _puRenderJobStatus(state, remainingMs) {
    const line = _pu.el.jobStatusLine;
    if (!line) return;
    if (state === 'active') {
        const s = Math.max(0, Math.ceil(remainingMs / 1000));
        const mm = String(Math.floor(s / 60)).padStart(2, '0');
        const ss = String(s % 60).padStart(2, '0');
        line.textContent = `Status: Active · completes in ${mm}:${ss}`;
        line.style.color = 'var(--badge-reset-text)';
    } else if (state === 'completed') {
        line.textContent = 'Status: Completed';
        line.style.color = 'var(--badge-online-text)';
    } else if (state === 'dismissed') {
        line.textContent = 'Status: Dismissed';
        line.style.color = 'var(--text-secondary)';
    } else {
        line.textContent = '';
    }
}

// Mark the shown job as active: lock Publish, reveal Dismiss, and run a 1 s
// countdown to its window end (server-reported `finalizeInMs`). When the
// countdown hits zero the job is Completed (details stay until refresh).
function _puBeginActiveJob(finalizeInMs) {
    _puSetPublishLocked(true);
    if (_pu.el.dismissBtn) _pu.el.dismissBtn.style.display = '';

    // A countdown timer owns the lock lifecycle here; cancel the plain one.
    if (_pu.disableTimer) { clearTimeout(_pu.disableTimer); _pu.disableTimer = null; }
    if (_pu.countdownTimer) { clearInterval(_pu.countdownTimer); _pu.countdownTimer = null; }

    const endAt = Date.now() + Math.max(0, Number(finalizeInMs) || 0);
    const tick = () => {
        const remaining = endAt - Date.now();
        if (remaining <= 0) {
            clearInterval(_pu.countdownTimer);
            _pu.countdownTimer = null;
            _puMarkJobCompleted();
            return;
        }
        _puRenderJobStatus('active', remaining);
    };
    tick();
    _pu.countdownTimer = setInterval(tick, 1000);
}

// Window elapsed: job is Completed. Re-enable Publish, hide Dismiss, and KEEP
// the published list + ACK table on screen (cleared only on page refresh).
function _puMarkJobCompleted() {
    _puSetPublishLocked(false);
    if (_pu.el.dismissBtn) _pu.el.dismissBtn.style.display = 'none';
    _puRenderJobStatus('completed');
}

// Operator dismissed the job: tell the server (finalizes early as 'dismissed'),
// then end the live job locally. The view (selectors, DUC table, published
// list, ACK progress) is left exactly as-is — it's overwritten on the next
// publish or cleared on page refresh, same as a Completed job.
async function _puDismiss() {
    const isRetained = !!(_pu.activeJob && _pu.activeJob.retained);
    const choice = await _puConfirmDismiss(isRetained);
    if (!choice || !choice.confirmed) return;   // cancelled

    if (_pu.el.dismissBtn) _pu.el.dismissBtn.disabled = true;
    try {
        await fetch(`${API_BASE_URL}/admin/price-update/dismiss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clearRetained: choice.clearRetained })
        });
    } catch (e) {
        console.warn('dismiss failed:', e.message);
    }

    // Stop the live timers, unlock Publish, hide Dismiss — but keep all details.
    if (_pu.pollTimer) { clearInterval(_pu.pollTimer); _pu.pollTimer = null; }
    if (_pu.countdownTimer) { clearInterval(_pu.countdownTimer); _pu.countdownTimer = null; }
    if (_pu.disableTimer) { clearTimeout(_pu.disableTimer); _pu.disableTimer = null; }
    _puSetPublishLocked(false);
    if (_pu.el.dismissBtn) {
        _pu.el.dismissBtn.disabled = false;
        _pu.el.dismissBtn.style.display = 'none';
    }
    _puRenderJobStatus('dismissed');
}

// Confirmation modal for dismiss. Resolves to { confirmed, clearRetained }.
// When the job was published retained, offers a checkbox to clear or keep the
// retained message on the broker (defaults to clear).
function _puConfirmDismiss(isRetained) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
            zIndex: '1000', display: 'flex', alignItems: 'center', justifyContent: 'center'
        });

        const popup = document.createElement('div');
        Object.assign(popup.style, {
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: '8px', padding: '14px 16px', width: '360px', maxWidth: 'calc(var(--vw100) * 0.9)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.35)'
        });

        const title = document.createElement('h3');
        title.textContent = 'Dismiss Price Update';
        title.style.margin = '0 0 10px';
        title.style.color = 'var(--text-heading)';
        popup.appendChild(title);

        const msg = document.createElement('div');
        msg.textContent = 'End this price update now? Its ACK window will close and you can publish a new one.';
        msg.style.fontSize = '13px';
        msg.style.color = 'var(--text-primary)';
        msg.style.marginBottom = '14px';
        popup.appendChild(msg);

        let clearCheck = null;
        if (isRetained) {
            const row = document.createElement('label');
            Object.assign(row.style, {
                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
                color: 'var(--text-primary)', cursor: 'pointer', marginBottom: '6px'
            });
            clearCheck = document.createElement('input');
            clearCheck.type = 'checkbox';
            clearCheck.checked = true;
            const span = document.createElement('span');
            span.textContent = 'Clear the retained message from the broker';
            row.appendChild(clearCheck);
            row.appendChild(span);
            popup.appendChild(row);

            const hint = document.createElement('div');
            hint.textContent = 'If unchecked, the last price stays retained for DUCs that connect later.';
            hint.style.fontSize = '12px';
            hint.style.color = 'var(--text-secondary)';
            hint.style.marginBottom = '10px';
            popup.appendChild(hint);
        }

        const btnRow = document.createElement('div');
        btnRow.style.display = 'flex';
        btnRow.style.justifyContent = 'flex-end';
        btnRow.style.gap = '10px';

        const cancelBtn = createActionButton('#626262', '#424242');
        cancelBtn.textContent = 'Cancel';
        const dismissBtn = createActionButton('#7a3b3b', '#5a2a2a');
        dismissBtn.textContent = 'Dismiss';
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(dismissBtn);
        popup.appendChild(btnRow);

        let done = false;
        const close = (result) => {
            if (done) return;
            done = true;
            if (overlay.parentNode) document.body.removeChild(overlay);
            resolve(result);
        };
        overlay.addEventListener('click', e => { if (e.target === overlay) close({ confirmed: false }); });
        cancelBtn.addEventListener('click', () => close({ confirmed: false }));
        dismissBtn.addEventListener('click', () => close({
            confirmed: true,
            clearRetained: isRetained ? clearCheck.checked : false
        }));

        overlay.appendChild(popup);
        document.body.appendChild(overlay);
    });
}

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
    _pu.customerToPrices = new Map();
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
        // Filed prices are per-station, so the first row for a code carries them
        // all (later rows are the same station's other DUCs/products).
        if (!_pu.customerToPrices.has(code)) {
            _pu.customerToPrices.set(code, {
                PMG: r.price_pmg,
                HSD: r.price_hsd,
                HOBC: r.price_hobc,
                updatedAt: r.prices_updated_at
            });
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

// Pre-fill the price inputs with the station's currently-filed prices (from the
// stations table, surfaced via /api/ducs) so the operator edits the real
// numbers instead of a blank 0.00. Each product with a filed price is checked
// and filled; products with no filed price stay unchecked/blank. Values remain
// fully editable. Also paints the "filed prices last updated" line. Pass a
// falsy code to clear everything (e.g. when the city changes and deselects the
// customer).
function _puApplyDefaultPrices(customerCode) {
    const prices = (customerCode && _pu.customerToPrices.get(customerCode)) || {};
    PRODUCT_OPTIONS.forEach(product => {
        const input = _pu.el.priceInputs && _pu.el.priceInputs[product];
        const check = _pu.el.priceChecks && _pu.el.priceChecks[product];
        if (!input || !check) return;
        const num = Number(prices[product]);
        const hasPrice = prices[product] != null && prices[product] !== '' && Number.isFinite(num);
        check.checked = hasPrice;
        input.disabled = !hasPrice;
        input.value = hasPrice ? num.toFixed(2) : '';
        _pu.enabled[product] = hasPrice;
    });

    const line = _pu.el.pricesUpdatedLine;
    if (line) {
        if (!customerCode) {
            line.textContent = '';
        } else if (prices.updatedAt) {
            line.textContent = `Filed prices last updated: ${new Date(prices.updatedAt).toLocaleString()}`;
        } else {
            line.textContent = 'No filed prices on record for this station yet.';
        }
    }
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
            padding: '10px 14px',
            marginBottom: '10px'
        });
        return card;
    };
    const cardTitle = (text) => {
        const h = document.createElement('div');
        h.textContent = text;
        h.style.fontSize = '14px';
        h.style.fontWeight = '600';
        h.style.color = 'var(--text-heading)';
        h.style.marginBottom = '8px';
        return h;
    };
    const fieldLabel = (text) => {
        const label = document.createElement('label');
        label.textContent = text;
        label.style.display = 'block';
        label.style.fontSize = '13px';
        label.style.fontWeight = '600';
        label.style.color = 'var(--text-primary)';
        label.style.marginBottom = '4px';
        return label;
    };

    // --- Card 1: Station selection (City + Customer side by side) ---
    const selectorCard = makeCard();
    selectorCard.appendChild(cardTitle('Station'));

    const row1 = document.createElement('div');
    row1.style.display = 'grid';
    row1.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
    row1.style.gap = '12px';

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
        _puApplyDefaultPrices(code);
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
        _puApplyDefaultPrices('');
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

    // When a station is selected, its filed prices pre-fill the inputs below and
    // this line shows when those prices were last filed. Populated by
    // _puApplyDefaultPrices.
    const pricesUpdatedLine = document.createElement('div');
    pricesUpdatedLine.style.fontSize = '12px';
    pricesUpdatedLine.style.color = 'var(--text-secondary)';
    pricesUpdatedLine.style.marginBottom = '8px';
    priceCard.appendChild(pricesUpdatedLine);
    _pu.el.pricesUpdatedLine = pricesUpdatedLine;

    // Responsive grid: each product gets an enable-checkbox + full-width price
    // input that fills an equal column, so the row spans the whole card instead
    // of trailing off three-quarters of the way across.
    const priceGrid = document.createElement('div');
    priceGrid.style.display = 'grid';
    priceGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
    priceGrid.style.gap = '10px';

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

    // Effective time 
    const effRow = document.createElement('div');
    effRow.style.display = 'flex';
    effRow.style.alignItems = 'center';
    effRow.style.gap = '10px';
    effRow.style.marginTop = '12px';
    effRow.style.flexWrap = 'wrap';

    const effLabel = document.createElement('span');
    effLabel.textContent = 'Effective:';
    effLabel.style.fontSize = '13px';
    effLabel.style.fontWeight = '600';
    effLabel.style.color = 'var(--text-primary)';

    const minInput = document.createElement('input');
    minInput.type = 'number';
    minInput.min = '1';
    minInput.step = '1';
    minInput.value = String(_pu.effectiveMinutes);
    minInput.style.width = '64px';
    minInput.style.padding = '4px 6px';
    minInput.disabled = _pu.effectiveMode !== 'minutes';
    minInput.addEventListener('input', () => {
        const n = parseInt(minInput.value, 10);
        if (Number.isFinite(n) && n > 0) _pu.effectiveMinutes = n;
    });

    const mkEffOption = (val, prefixText) => {
        const wrap = document.createElement('label');
        wrap.style.display = 'flex';
        wrap.style.alignItems = 'center';
        wrap.style.gap = '6px';
        wrap.style.fontSize = '13px';
        wrap.style.color = 'var(--text-primary)';
        wrap.style.cursor = 'pointer';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'pu-eff';
        radio.value = val;
        radio.checked = _pu.effectiveMode === val;
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            _pu.effectiveMode = val;
            minInput.disabled = val !== 'minutes';
            if (val === 'minutes') minInput.focus();
        });
        const span = document.createElement('span');
        span.textContent = prefixText;
        wrap.appendChild(radio);
        wrap.appendChild(span);
        return wrap;
    };

    const nowWrap = mkEffOption('now', 'Now');
    const minWrap = mkEffOption('minutes', 'In');
    const minSuffix = document.createElement('span');
    minSuffix.textContent = 'minutes from now';
    minSuffix.style.fontSize = '13px';
    minSuffix.style.color = 'var(--text-secondary)';
    minWrap.appendChild(minInput);
    minWrap.appendChild(minSuffix);

    effRow.appendChild(effLabel);
    effRow.appendChild(nowWrap);
    effRow.appendChild(minWrap);
    priceCard.appendChild(effRow);

    // Publish button + status line
    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.alignItems = 'center';
    actionRow.style.gap = '12px';
    actionRow.style.marginTop = '16px';

    const publishBtn = createActionButton('#004D64', '#00324C');
    publishBtn.textContent = 'Publish';
    publishBtn.style.padding = '7px 18px';
    publishBtn.addEventListener('click', () => _puPublish(publishBtn, statusLine));
    actionRow.appendChild(publishBtn);

    // Dismiss — manually ends the in-flight job early. Hidden unless a job is active.
    const dismissBtn = createActionButton('#a72929', '#7a2b2b');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.style.padding = '7px 16px';
    dismissBtn.style.display = 'none';
    dismissBtn.addEventListener('click', () => _puDismiss());
    actionRow.appendChild(dismissBtn);
    _pu.el.dismissBtn = dismissBtn;

    const statusLine = document.createElement('div');
    statusLine.style.fontSize = '13px';
    statusLine.style.color = 'var(--text-secondary)';
    actionRow.appendChild(statusLine);

    priceCard.appendChild(actionRow);

    // Job status line (Active · countdown / Completed / Dismissed).
    const jobStatusLine = document.createElement('div');
    jobStatusLine.style.fontSize = '13px';
    jobStatusLine.style.fontWeight = '600';
    jobStatusLine.style.marginTop = '10px';
    priceCard.appendChild(jobStatusLine);
    _pu.el.jobStatusLine = jobStatusLine;

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

    // If a station is already selected (e.g. restoring an in-flight job after a
    // refresh), seed the price inputs with its filed prices.
    if (_pu.selectedCustomer) _puApplyDefaultPrices(_pu.selectedCustomer);
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

            const connCode = Number(r.connStatus);
            const connLabel = connCode === 1 ? 'Connected' : connCode === 2 ? 'N/A' : 'Disconnected';
            const connColor = connCode === 1 ? 'var(--badge-online-text)'
                : connCode === 2 ? 'var(--badge-unknown-text)' : 'var(--badge-offline-text)';
            tr.appendChild(cell(connLabel, {
                color: connColor,
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
    // Click-to-sort headers. Sorting only reorders the existing <tr> nodes; the
    // live ACK repaint finds cells by row dataset/class, so it keeps working.
    makeTableSortable(table);
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
    if (effDate) bits.push(`Effective Date: ${effDate.toLocaleString()}`);
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

    // Effective delay: 0 for "now", else the entered whole minutes.
    let effectiveInMinutes = 0;
    if (_pu.effectiveMode === 'minutes') {
        effectiveInMinutes = parseInt(_pu.effectiveMinutes, 10);
        if (!Number.isInteger(effectiveInMinutes) || effectiveInMinutes < 1) {
            return alert('Enter a whole number of minutes (1 or more) for the effective time.');
        }
    }

    // Don't tear down any in-progress job view yet — if the server rejects the
    // publish (e.g. 409 while another job is active), we want the current job's
    // published list + ACK table to stay on screen. Teardown happens only on a
    // confirmed-successful publish below.
    button.disabled = true;
    button.style.cursor = 'wait';
    button.textContent = 'Publishing…';

    let data = {}, ok = false, status = 0;
    try {
        const resp = await fetch(`${API_BASE_URL}/admin/price-update/publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                city: _pu.selectedCity,
                customer_code: _pu.selectedCustomer,
                prices,
                retain: !!_pu.retain,
                effectiveInMinutes
            })
        });
        status = resp.status;
        data = await resp.json().catch(() => ({}));
        ok = resp.ok;
    } catch (e) {
        data = { error: e.message };
    }
    button.textContent = 'Publish';

    if (!ok) {
        statusLine.textContent = `Publish failed: ${data.error || `HTTP ${status}`}`;
        statusLine.style.color = 'var(--badge-reset-text)';
        // A 409 means another job is still active — keep the button locked for
        // its remaining window. Any other failure just frees the button.
        if (status === 409 && data.finalizeInMs != null) {
            _puLockPublishFor(data.finalizeInMs);
        } else {
            _puSetPublishLocked(false);
        }
        return;
    }

    // Success — replace any prior job view with this one.
    if (_pu.pollTimer) { clearInterval(_pu.pollTimer); _pu.pollTimer = null; }
    if (_pu.el.publishedList) _pu.el.publishedList.innerHTML = '';

    _pu.activeJob = {
        jobId: data.jobId,
        items: data.items || [],
        retained: !!data.retained,
        startedAt: Date.now(),
        ackedByDuc: new Map()  // "address|product" -> ackedAt (ISO)
    };
    _pu.lastProgressAt = Date.now();

    // Reset all status cells to "Pending" for rows that match a published item.
    _puMarkPendingCells();

    // Show the list of published messages (topics + price + DUC counts +
    // effective time) so the operator can see exactly what went out.
    _puRenderPublished(data);

    const totalDucs = (data.items || []).reduce((s, it) => s + it.totalDucs, 0);
    statusLine.textContent = `Awaiting ${totalDucs} ACK${totalDucs === 1 ? '' : 's'}…`;
    statusLine.style.color = 'var(--text-secondary)';

    // Mark active (locks Publish, shows Dismiss + countdown), then begin polling.
    _puBeginActiveJob(data.finalizeInMs);
    _pu.pollTimer = setInterval(_puPollAcks, ACK_POLL_INTERVAL_MS);
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

// Paint each DUC row's status cell for the current _pu.activeJob: "Pending" for
// rows in the published batch, "Not in batch" otherwise. Used right after a
// publish and when restoring an in-flight job on page load.
function _puMarkPendingCells() {
    if (!_pu.activeJob || !_pu.el.ducTableHost) return;
    _pu.el.ducTableHost.querySelectorAll('tr[data-address]').forEach(tr => {
        const item = _pu.activeJob.items.find(it => it.product === tr.dataset.product);
        const statusCell = tr.querySelector('.pu-status-cell');
        const ackCell = tr.querySelector('.pu-ackat-cell');
        if (!statusCell || !ackCell) return;
        if (item && item.ducs && item.ducs.includes(tr.dataset.address)) {
            statusCell.textContent = 'Pending';
            statusCell.style.color = 'var(--badge-reset-text)';
        } else {
            statusCell.textContent = 'Not in batch';
            statusCell.style.color = 'var(--text-secondary)';
        }
        ackCell.textContent = '';
    });
}

// Rebuild the page state for a job that's still in flight on the server (e.g.
// after a refresh), so the operator sees the same published list + ACK table as
// right after publishing instead of a blank form. `data` is the
// /price-update/active payload. Selection/DUC table are restored by the caller
// before the form renders; here we wire up the job, repaint, and resume polling.
function _puRestoreActiveJob(data) {
    _pu.activeJob = {
        jobId: data.jobId,
        items: data.items || [],
        retained: !!data.retained,
        startedAt: Date.now(),
        ackedByDuc: new Map()
    };
    _pu.lastProgressAt = Date.now();

    _puMarkPendingCells();
    _puRenderPublished(data);

    // Resume the active-job state (lock Publish, show Dismiss, countdown) for
    // whatever's left of this job's window.
    _puBeginActiveJob(data.finalizeInMs);

    if (_pu.el.statusLine) {
        _pu.el.statusLine.textContent = 'Restoring in-progress update…';
        _pu.el.statusLine.style.color = 'var(--text-secondary)';
    }

    // Immediate paint of any ACKs already in, then resume the poll loop.
    if (_pu.pollTimer) { clearInterval(_pu.pollTimer); _pu.pollTimer = null; }
    _puPollAcks();
    _pu.pollTimer = setInterval(_puPollAcks, ACK_POLL_INTERVAL_MS);
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
        denied.style.padding = '16px';
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
        err.style.padding = '14px';
        content.appendChild(err);
        return;
    }

    // If a price update is still in flight on the server (page was refreshed
    // mid-job), fetch it so we can restore the same view. Pre-select its station
    // *before* rendering the form, so the dropdowns and DUC table populate for it.
    let activeJob = null;
    try {
        const resp = await fetch(`${API_BASE_URL}/admin/price-update/active`);
        if (resp.ok) {
            const d = await resp.json();
            if (d && d.active && _pu.customerToCity.has(d.customer_code)) activeJob = d;
        }
    } catch (e) {
        console.warn('active price-update check failed:', e.message);
    }
    if (activeJob) {
        _pu.selectedCustomer = activeJob.customer_code;
        _pu.selectedCity = _pu.customerToCity.get(activeJob.customer_code) || '';
        _pu.ducsForCustomer = _puDucsForCustomer(activeJob.customer_code);
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

    // Restore the in-flight job's published list + ACK table and resume polling.
    if (activeJob) _puRestoreActiveJob(activeJob);
}

window.renderPriceUpdate = renderPriceUpdate;
