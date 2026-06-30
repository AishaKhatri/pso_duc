// Super-admin Prices page: shows current per-station product prices and
// uploads a new PSO price-change Excel file to refresh them.
//
// Backend endpoints:
//   GET  /api/admin/prices         → station rows with price columns
//   POST /api/admin/upload-prices  → multipart "file" form-field

let pricesList = [];
let pricesSearchQuery = '';

function getFilteredPrices() {
    const q = pricesSearchQuery.trim().toLowerCase();
    if (!q) return pricesList;
    return pricesList.filter(s =>
        (s.customer_code || '').toLowerCase().includes(q) ||
        (s.station_id || '').toLowerCase().includes(q) ||
        (s.city || '').toLowerCase().includes(q) ||
        (s.division || '').toLowerCase().includes(q)
    );
}

function buildPricesSearchControl(onChange) {
    const dd = createSearchableDropdown({
        placeholder: 'Search by customer code, station, city, or division',
        width: '380px',
        bgWhite: true,
        items: () => pricesList.map(s => ({
            value: s.customer_code || '',
            label: s.customer_code || '',
            secondary: [s.station_id, s.city].filter(Boolean).join(' · '),
            search: [s.station_id, s.city, s.division]
        })),
        initialQuery: pricesSearchQuery,
        emptyText: 'No stations match',
        onInput: (q) => { pricesSearchQuery = q; if (onChange) onChange(); },
        onSelect: (v) => { pricesSearchQuery = v; if (onChange) onChange(); }
    });
    return dd.wrap;
}

function formatPrice(v) {
    if (v == null || v === '') return '-';
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toFixed(2);
}

async function loadPricesFromDB() {
    const resp = await fetch(`${API_BASE_URL}/admin/prices`);
    if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${resp.status}`);
    }
    return resp.json();
}

// Scrollable list of "<station name> · <customer code>" rows. Falls back to a
// muted "None" line when there's nothing to show.
function buildStationListBox(entries, emptyText) {
    const box = document.createElement('div');
    box.style.maxHeight = '180px';
    box.style.overflow = 'auto';
    box.style.padding = '6px 8px';
    box.style.background = 'var(--bg-surface-2)';
    box.style.border = '1px solid var(--border)';
    box.style.borderRadius = '4px';
    box.style.fontSize = '12px';

    if (!entries.length) {
        box.style.color = 'var(--text-secondary)';
        box.textContent = emptyText;
        return box;
    }

    entries.forEach(e => {
        const row = document.createElement('div');
        row.style.padding = '3px 0';
        row.style.borderBottom = '1px solid var(--border-soft)';
        const name = e.station_id ? e.station_id : '(no station id)';
        row.innerHTML =
            `<span style="font-weight:600;">${escapeHtml(name)}</span>` +
            ` <span style="color:var(--text-secondary);">· ${escapeHtml(e.customer_code)}</span>`;
        box.appendChild(row);
    });
    return box;
}

// Result popup for the price-file upload. Stations with no DUC for a product are
// already filtered out server-side, so every entry here is actionable. Product
// tabs keep the three fuels separate; within a tab the two problems —
// "Missing Price" (listed but no price) and "Not Listed" (absent from file) —
// are shown apart. This popup is intentionally NOT dismissible by clicking the
// backdrop: it stays until the user acknowledges it with OK or the close (×).
function showUploadResultPopup({ updated, sheetsPresent, missingPrice, notListed }) {
    updated      = updated      || { PMG: 0, HSD: 0, HOBC: 0 };
    sheetsPresent = sheetsPresent || { PMG: false, HSD: false, HOBC: false };
    missingPrice = missingPrice || {};
    notListed    = notListed    || {};

    // Plain overlay without createModalOverlay's backdrop-click-to-close.
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '560px';
    popup.style.maxWidth = '92vw';

    const header = createHeader();
    const title = createTitle();
    title.textContent = 'Upload Complete';
    header.appendChild(title);
    header.appendChild(createCloseButton(overlay));
    popup.appendChild(header);

    const summary = document.createElement('p');
    summary.style.margin = '0 0 12px';
    summary.innerHTML =
        `<b>Updated:</b> ${updated.PMG} PMG, ${updated.HSD} HSD, ${updated.HOBC} HOBC.`;
    popup.appendChild(summary);

    const products = PRODUCT_OPTIONS.filter(p => sheetsPresent[p]);

    // Tab bar + content host.
    const tabBar = document.createElement('div');
    tabBar.style.display = 'flex';
    tabBar.style.gap = '6px';
    tabBar.style.borderBottom = '1px solid var(--border)';
    tabBar.style.marginBottom = '12px';
    popup.appendChild(tabBar);

    const tabContent = document.createElement('div');
    popup.appendChild(tabContent);

    const issueCount = (p) => (missingPrice[p] || []).length + (notListed[p] || []).length;

    const renderTab = (product) => {
        tabContent.innerHTML = '';

        const missEntries = missingPrice[product] || [];
        const missSection = document.createElement('div');
        missSection.style.marginBottom = '14px';
        const missHead = document.createElement('div');
        missHead.style.fontWeight = '600';
        missHead.style.marginBottom = '4px';
        missHead.textContent = `Missing Price — listed but no price (${missEntries.length})`;
        missSection.appendChild(missHead);
        missSection.appendChild(buildStationListBox(
            missEntries, `No ${product} stations are missing a price.`));
        tabContent.appendChild(missSection);

        const notEntries = notListed[product] || [];
        const notSection = document.createElement('div');
        const notHead = document.createElement('div');
        notHead.style.fontWeight = '600';
        notHead.style.marginBottom = '4px';
        notHead.textContent = `Not Listed — absent from file (${notEntries.length})`;
        notSection.appendChild(notHead);
        notSection.appendChild(buildStationListBox(
            notEntries, `Every ${product} station was listed in the file.`));
        tabContent.appendChild(notSection);
    };

    const tabButtons = new Map();
    const selectTab = (product) => {
        tabButtons.forEach((btn, p) => {
            const active = p === product;
            btn.style.borderBottom = active ? '2px solid var(--accent)' : '2px solid transparent';
            btn.style.color = active ? 'var(--text-heading)' : 'var(--text-secondary)';
            btn.style.fontWeight = active ? '600' : '500';
        });
        renderTab(product);
    };

    products.forEach(product => {
        const n = issueCount(product);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.background = 'none';
        btn.style.border = 'none';
        btn.style.padding = '8px 10px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '13px';
        btn.textContent = n ? `${product} (${n})` : product;
        btn.addEventListener('click', () => selectTab(product));
        tabBar.appendChild(btn);
        tabButtons.set(product, btn);
    });

    if (products.length) {
        // Open on the first product that actually has something to act on,
        // else just the first product present in the file.
        const firstWithIssues = products.find(p => issueCount(p) > 0);
        selectTab(firstWithIssues || products[0]);
    } else {
        const none = document.createElement('div');
        none.style.color = 'var(--text-secondary)';
        none.textContent = 'No PMG/HSD/HOBC price sheets were found in this file.';
        tabContent.appendChild(none);
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.marginTop = '16px';
    const okBtn = createActionButton('#004D64', '#00324C');
    okBtn.textContent = 'OK';
    okBtn.onclick = () => document.body.removeChild(overlay);
    buttonContainer.appendChild(okBtn);
    popup.appendChild(buttonContainer);

    dragPopup(overlay, popup);
}

async function uploadPriceFile(file, uploadBtn, originalLabel, onDone) {
    uploadBtn.disabled = true;
    uploadBtn.style.opacity = '0.6';
    uploadBtn.textContent = 'Uploading…';
    try {
        const fd = new FormData();
        fd.append('file', file);
        const resp = await fetch(`${API_BASE_URL}/admin/upload-prices`, {
            method: 'POST',
            body: fd
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        showUploadResultPopup(data);
        if (typeof onDone === 'function') await onDone();
    } catch (e) {
        console.error('upload-prices failed:', e);
        alert(`Upload failed: ${e.message}`);
    } finally {
        uploadBtn.disabled = false;
        uploadBtn.style.opacity = '';
        uploadBtn.textContent = originalLabel;
    }
}

// Modal for entering one station's prices by hand. City dropdown is a
// helper that scopes the customer-code dropdown; any of the three price
// inputs may be left blank but at least one must be filled. `pricesList`
// (module scope) is the data source for dropdown options.
function showManualEntryPopup(onSaved) {
    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '380px';
    popup.style.maxWidth = '90vw';

    const header = createHeader();
    const title = createTitle();
    title.textContent = 'Manual Price Entry';
    header.appendChild(title);
    header.appendChild(createCloseButton(overlay));
    popup.appendChild(header);

    const form = document.createElement('form');
    form.style.display = 'grid';
    form.style.gap = '14px';
    form.style.padding = '6px 0';

    // --- City dropdown ---
    const cityLabel = document.createElement('label');
    cityLabel.textContent = 'City (filter)';
    cityLabel.style.fontWeight = 'bold';
    cityLabel.style.fontSize = '13px';
    const citySelect = createDropdown('All Cities');
    citySelect.style.marginBottom = '0';
    [...new Set(pricesList.map(s => s.city).filter(Boolean))]
        .sort()
        .forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = titleCase(c);
            citySelect.appendChild(opt);
        });

    // --- Customer code dropdown (scoped by city) ---
    const codeLabel = document.createElement('label');
    codeLabel.textContent = 'Customer Code *';
    codeLabel.style.fontWeight = 'bold';
    codeLabel.style.fontSize = '13px';
    const codeSelect = createDropdown('Select Customer Code');
    codeSelect.style.marginBottom = '0';
    codeSelect.required = true;

    const populateCodes = (cityFilter) => {
        // Wipe everything except the placeholder.
        while (codeSelect.children.length > 1) codeSelect.removeChild(codeSelect.lastChild);
        const filtered = cityFilter
            ? pricesList.filter(s => s.city === cityFilter)
            : pricesList;
        filtered.slice().sort((a, b) => String(a.customer_code).localeCompare(String(b.customer_code)))
            .forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.customer_code;
                opt.textContent = `${s.customer_code} – ${s.station_id || '(no station id)'}`;
                codeSelect.appendChild(opt);
            });
    };
    populateCodes('');

    citySelect.addEventListener('change', () => populateCodes(citySelect.value));

    // --- Price inputs ---
    const mkPriceInput = (placeholder) => {
        const input = createTextInput({ type: 'number', placeholder });
        input.step = '0.01';
        input.min = '0';
        input.style.width = '100%';
        return input;
    };

    const pmgInput = mkPriceInput('PMG price (leave blank to skip)');
    const hsdInput = mkPriceInput('HSD price (leave blank to skip)');
    const hobcInput = mkPriceInput('HOBC price (leave blank to skip)');

    const mkLabeled = (labelText, control) => {
        const wrap = document.createElement('div');
        wrap.style.display = 'grid';
        wrap.style.gap = '4px';
        const lab = document.createElement('label');
        lab.textContent = labelText;
        lab.style.fontWeight = 'bold';
        lab.style.fontSize = '13px';
        wrap.appendChild(lab);
        wrap.appendChild(control);
        return wrap;
    };

    // --- Save / Cancel row ---
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '8px';
    btnRow.style.marginTop = '4px';

    const cancelBtn = createActionButton('#626262', '#424242');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));

    const saveBtn = createActionButton('#004D64', '#00324C');
    saveBtn.type = 'submit';
    saveBtn.textContent = 'Save';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);

    // Assemble form
    form.appendChild(mkLabeled('City (filter)', citySelect));
    form.appendChild(mkLabeled('Customer Code *', codeSelect));
    form.appendChild(mkLabeled('PMG Price', pmgInput));
    form.appendChild(mkLabeled('HSD Price', hsdInput));
    form.appendChild(mkLabeled('HOBC Price', hobcInput));
    form.appendChild(btnRow);
    popup.appendChild(form);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const customer_code = codeSelect.value;
        if (!customer_code) {
            alert('Pick a customer code');
            return;
        }
        const pmgRaw = pmgInput.value.trim();
        const hsdRaw = hsdInput.value.trim();
        const hobcRaw = hobcInput.value.trim();
        if (!pmgRaw && !hsdRaw && !hobcRaw) {
            alert('Enter at least one of PMG / HSD / HOBC');
            return;
        }
        const body = {
            customer_code,
            price_pmg: pmgRaw === '' ? null : Number(pmgRaw),
            price_hsd: hsdRaw === '' ? null : Number(hsdRaw),
            price_hobc: hobcRaw === '' ? null : Number(hobcRaw)
        };
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.6';
        saveBtn.textContent = 'Saving…';
        try {
            const resp = await fetch(`${API_BASE_URL}/admin/prices/manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
            document.body.removeChild(overlay);
            if (typeof onSaved === 'function') await onSaved();
        } catch (e2) {
            console.error('manual-prices failed:', e2);
            alert(`Save failed: ${e2.message}`);
            saveBtn.disabled = false;
            saveBtn.style.opacity = '';
            saveBtn.textContent = 'Save';
        }
    });

    dragPopup(overlay, popup);
}

async function renderPrices() {
    const { content, addButton } = configPage('Prices', '← Back', 'index.html', 'Upload Price File');

    // Hidden file input — the addButton triggers it.
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    addButton.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';  // reset so re-uploading the same name re-triggers
        if (!file) return;
        const original = addButton.textContent;
        // Confirm before applying.
        const { overlay, confirmButton } = createDeletePopup(
            `Apply prices from "${file.name}"? Every recognized customer code in the file will overwrite that station's current PMG/HSD/HOBC price and propagate to its nozzles.`,
            {
                title: 'Apply Price Update',
                confirmText: 'Apply',
                confirmColor: '#004D64',
                confirmHoverColor: '#00324C'
            }
        );
        confirmButton.onclick = async () => {
            document.body.removeChild(overlay);
            await uploadPriceFile(file, addButton, original, async () => {
                try {
                    pricesList = await loadPricesFromDB();
                    refreshTable();
                } catch (e) {
                    console.error('Failed to refresh prices after upload:', e);
                }
            });
        };
    });

    // Inject search control + Manual Entry button into the button row.
    const buttonRow = addButton.parentElement;
    if (buttonRow) {
        buttonRow.style.justifyContent = 'space-between';
        buttonRow.style.flexWrap = 'wrap';
        const searchesGroup = document.createElement('div');
        searchesGroup.style.display = 'flex';
        searchesGroup.style.flexWrap = 'wrap';
        searchesGroup.style.gap = '10px';
        searchesGroup.style.alignItems = 'center';
        searchesGroup.style.flex = '1 1 auto';
        searchesGroup.appendChild(buildPricesSearchControl(() => refreshTable()));
        buttonRow.insertBefore(searchesGroup, addButton);

        const manualBtn = createActionButton();
        manualBtn.textContent = 'Manual Entry';
        manualBtn.style.marginRight = '8px';
        manualBtn.addEventListener('click', () => {
            showManualEntryPopup(async () => {
                try {
                    pricesList = await loadPricesFromDB();
                    refreshTable();
                } catch (e) {
                    console.error('Failed to refresh prices after manual entry:', e);
                }
            });
        });
        buttonRow.insertBefore(manualBtn, addButton);
    }

    const columns = ['Customer Code', 'Station ID', 'City', 'Division',
                     'PMG', 'HSD', 'HOBC', 'Last Updated'];
    const { tableContainer, tbody } = createTable(columns);
    content.appendChild(tableContainer);

    try {
        pricesList = await loadPricesFromDB();
    } catch (e) {
        console.error('Load prices error:', e);
        content.innerHTML = `<div class="error">Failed to load prices: ${e.message}</div>`;
        return;
    }

    refreshTable();

    function refreshTable() {
        if (!tbody) return;
        tbody.innerHTML = '';
        const rows = getFilteredPrices();

        if (rows.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = columns.length;
            td.style.textAlign = 'center';
            td.style.padding = '14px';
            td.style.color = 'var(--text-secondary)';
            td.textContent = pricesSearchQuery
                ? 'No stations match'
                : 'No stations configured';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        rows.forEach(s => {
            const tr = createTableRow([
                s.customer_code,
                s.station_id,
                titleCase(s.city),
                s.division,
                formatPrice(s.price_pmg),
                formatPrice(s.price_hsd),
                formatPrice(s.price_hobc),
                s.prices_updated_at ? new Date(s.prices_updated_at).toLocaleString() : '-'
            ]);
            tbody.appendChild(tr);
        });
    }

}

window.renderPrices = renderPrices;
