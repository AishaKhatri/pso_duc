// DUC Server Config page (super-admin only). Lets an operator pick a specific
// DUC (city -> customer code -> address) and rewrite one of its server-location
// slots via an msg_type 18 broadcast. clientid/ip and the ServerName/ServerIp
// CSV fields are filled in server-side; this page only collects the operator's
// inputs and POSTs them to /api/dispensers/server-location.

// ---- small styled-control builders (kept local to this page) ----
function _labelEl(text) {
    const label = document.createElement('label');
    label.textContent = text;
    label.style.display = 'block';
    label.style.marginBottom = '6px';
    label.style.fontSize = '14px';
    label.style.fontWeight = '600';
    label.style.color = 'var(--text-secondary)';
    return label;
}

function _styleControl(el) {
    el.style.width = '100%';
    el.style.boxSizing = 'border-box';
    el.style.padding = '8px 10px';
    el.style.border = '1px solid var(--border)';
    el.style.borderRadius = '6px';
    el.style.background = 'var(--bg-surface)';
    el.style.color = 'var(--text-primary)';
    el.style.fontSize = '14px';
    return el;
}

function _fieldBlock(labelText, control, hint) {
    const block = document.createElement('div');
    block.style.marginBottom = '16px';
    block.appendChild(_labelEl(labelText));
    block.appendChild(control);
    if (hint) {
        const h = document.createElement('div');
        h.textContent = hint;
        h.style.fontSize = '12px';
        h.style.color = 'var(--text-secondary)';
        h.style.marginTop = '4px';
        block.appendChild(h);
    }
    return block;
}

function _makeSelect() {
    return _styleControl(document.createElement('select'));
}

function _option(value, text, disabled = false) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    if (disabled) opt.disabled = true;
    return opt;
}

function _makeInput(type = 'text') {
    const input = document.createElement('input');
    input.type = type;
    return _styleControl(input);
}

function _sectionHeader(text) {
    const h = document.createElement('h3');
    h.textContent = text;
    h.style.margin = '24px 0 12px';
    h.style.fontSize = '16px';
    h.style.color = 'var(--text-heading)';
    h.style.borderBottom = '1px solid var(--border)';
    h.style.paddingBottom = '6px';
    return h;
}

// ---- page ----
async function renderDucConfig() {
    const content = document.getElementById('content');
    if (!content) return;
    content.innerHTML = '';

    const card = document.createElement('div');
    card.style.maxWidth = '640px';
    card.style.margin = '20px auto';
    card.style.padding = '24px';
    card.style.background = 'var(--bg-surface)';
    card.style.border = '1px solid var(--border)';
    card.style.borderRadius = '10px';
    card.style.boxShadow = 'var(--shadow-card)';

    const title = document.createElement('h2');
    title.textContent = 'Update DUC Server Location';
    title.style.margin = '0 0 6px';
    title.style.color = 'var(--text-heading)';
    card.appendChild(title);

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Rewrite one server-location slot on a DUC. Server name/IP are filled in automatically.';
    subtitle.style.margin = '0 0 8px';
    subtitle.style.fontSize = '14px';
    subtitle.style.color = 'var(--text-secondary)';
    card.appendChild(subtitle);

    // ----- Select DUC -----
    card.appendChild(_sectionHeader('Select DUC'));

    const citySelect = _makeSelect();
    const customerSelect = _makeSelect();
    const addressSelect = _makeSelect();

    card.appendChild(_fieldBlock('City', citySelect));
    card.appendChild(_fieldBlock('Customer Code', customerSelect));
    card.appendChild(_fieldBlock('Dispenser Address', addressSelect));

    // ----- Send mode -----
    card.appendChild(_sectionHeader('Send Mode'));
    const sendModeSelect = _makeSelect();
    sendModeSelect.appendChild(_option('targeted', 'Targeted — only the selected DUC'));
    sendModeSelect.appendChild(_option('broadcast', 'Broadcast — every DUC on the network'));
    const sendModeWarning = document.createElement('div');
    sendModeWarning.style.fontSize = '12px';
    sendModeWarning.style.marginTop = '4px';
    sendModeWarning.style.color = 'var(--badge-offline-text)';
    sendModeWarning.style.display = 'none';
    sendModeWarning.textContent = '⚠ Broadcast reconfigures the server slot on ALL DUCs, not just the selected one.';
    const sendModeBlock = _fieldBlock('Delivery', sendModeSelect);
    sendModeBlock.appendChild(sendModeWarning);
    card.appendChild(sendModeBlock);

    // ----- Parameters -----
    card.appendChild(_sectionHeader('Server Location Parameters'));

    const slotSelect = _makeSelect();
    for (let i = 0; i <= 5; i++) slotSelect.appendChild(_option(String(i), `Slot ${i}`));
    card.appendChild(_fieldBlock('Server Location', slotSelect, 'Which of the DUC’s 6 server slots (0–5) to overwrite.'));

    const connTypeSelect = _makeSelect();
    [1, 2, 3].forEach(v => connTypeSelect.appendChild(_option(String(v), `Type ${v}`)));
    card.appendChild(_fieldBlock('Connection Type', connTypeSelect));

    const protocolSelect = _makeSelect();
    protocolSelect.appendChild(_option('tcp', 'TCP'));
    protocolSelect.appendChild(_option('tls', 'TLS/SSL (unavailable)', true));
    protocolSelect.value = 'tcp';
    card.appendChild(_fieldBlock('Protocol', protocolSelect, 'The scheme is prepended to the broker IP automatically (tcp://).'));

    const brokerIpInput = _makeInput('text');
    brokerIpInput.placeholder = 'e.g. 10.14.192.1';
    brokerIpInput.setAttribute('inputmode', 'decimal');
    // Numeric IPv4 only — strip anything that isn't a digit or dot as it's typed.
    brokerIpInput.addEventListener('input', () => {
        const cleaned = brokerIpInput.value.replace(/[^\d.]/g, '');
        if (cleaned !== brokerIpInput.value) brokerIpInput.value = cleaned;
        if (ntpSameCheckbox.checked) ntpInput.value = brokerIpInput.value;
    });
    card.appendChild(_fieldBlock('Broker IP', brokerIpInput, 'Numeric IPv4 only; tcp:// is added for you.'));

    const portInput = _makeInput('text');
    portInput.placeholder = 'e.g. 1883';
    portInput.setAttribute('inputmode', 'numeric');
    portInput.value = '1883';
    portInput.addEventListener('input', () => {
        const cleaned = portInput.value.replace(/[^\d]/g, '');
        if (cleaned !== portInput.value) portInput.value = cleaned;
    });
    card.appendChild(_fieldBlock('Port', portInput));

    // NTP server: checkbox "same as broker IP" -> mirror the broker IP and lock
    // the field; unchecked -> free string input (IP or hostname).
    const ntpInput = _makeInput('text');
    ntpInput.placeholder = 'e.g. time.google.com or 10.14.192.1';

    const ntpSameWrap = document.createElement('label');
    ntpSameWrap.style.display = 'flex';
    ntpSameWrap.style.alignItems = 'center';
    ntpSameWrap.style.gap = '8px';
    ntpSameWrap.style.marginBottom = '8px';
    ntpSameWrap.style.fontSize = '14px';
    ntpSameWrap.style.color = 'var(--text-primary)';
    ntpSameWrap.style.cursor = 'pointer';
    const ntpSameCheckbox = document.createElement('input');
    ntpSameCheckbox.type = 'checkbox';
    ntpSameCheckbox.checked = true;
    ntpSameWrap.appendChild(ntpSameCheckbox);
    ntpSameWrap.appendChild(document.createTextNode('Same as broker IP'));

    const syncNtpState = () => {
        if (ntpSameCheckbox.checked) {
            ntpInput.value = brokerIpInput.value;
            ntpInput.disabled = true;
            ntpInput.style.opacity = '0.6';
        } else {
            ntpInput.disabled = false;
            ntpInput.style.opacity = '1';
        }
    };
    ntpSameCheckbox.addEventListener('change', syncNtpState);

    const ntpBlock = document.createElement('div');
    ntpBlock.style.marginBottom = '16px';
    ntpBlock.appendChild(_labelEl('NTP Server'));
    ntpBlock.appendChild(ntpSameWrap);
    ntpBlock.appendChild(ntpInput);
    card.appendChild(ntpBlock);

    const usernameInput = _makeInput('text');
    usernameInput.value = 'duc';
    card.appendChild(_fieldBlock('Username', usernameInput));

    const passwordInput = _makeInput('text');
    passwordInput.value = 'SRT123';
    card.appendChild(_fieldBlock('Password', passwordInput));

    // ----- Submit -----
    const statusMsg = document.createElement('div');
    statusMsg.style.margin = '12px 0';
    statusMsg.style.fontSize = '14px';
    statusMsg.style.minHeight = '18px';

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Send Update';
    submitBtn.className = 'action-button';
    submitBtn.style.backgroundColor = '#004D64';
    submitBtn.style.borderRadius = '8px';
    submitBtn.style.padding = '12px 20px';
    submitBtn.style.fontSize = '15px';
    submitBtn.style.cursor = 'pointer';

    card.appendChild(statusMsg);
    card.appendChild(submitBtn);
    content.appendChild(card);

    // ----- data + cascading dropdowns -----
    const setStatus = (text, ok) => {
        statusMsg.textContent = text;
        statusMsg.style.color = ok ? 'var(--badge-online-text)' : 'var(--badge-offline-text)';
    };

    const stations = await loadStationsFromDB();
    // city -> [{ customer_code, addresses: [] }]
    const byCity = new Map();
    for (const s of stations) {
        const city = (s.city || '').trim() || 'Unknown';
        const addresses = String(s.duc_addresses || '')
            .split(',')
            .map(a => a.trim())
            .filter(Boolean);
        if (!byCity.has(city)) byCity.set(city, []);
        byCity.get(city).push({ customer_code: s.customer_code, addresses });
    }

    const fillSelect = (select, entries, placeholder) => {
        select.innerHTML = '';
        select.appendChild(_option('', placeholder));
        for (const e of entries) select.appendChild(_option(e.value, e.text));
    };

    const cities = Array.from(byCity.keys()).sort();
    fillSelect(citySelect, cities.map(c => ({ value: c, text: titleCaseCity(c) })), '— Select city —');
    fillSelect(customerSelect, [], '— Select city first —');
    fillSelect(addressSelect, [], '— Select customer first —');

    citySelect.addEventListener('change', () => {
        const customers = byCity.get(citySelect.value) || [];
        fillSelect(customerSelect,
            customers.map(c => ({ value: c.customer_code, text: c.customer_code })),
            customers.length ? '— Select customer —' : '— No customers —');
        fillSelect(addressSelect, [], '— Select customer first —');
    });

    customerSelect.addEventListener('change', () => {
        const customers = byCity.get(citySelect.value) || [];
        const cust = customers.find(c => c.customer_code === customerSelect.value);
        const addrs = cust ? cust.addresses : [];
        fillSelect(addressSelect,
            addrs.map(a => ({ value: a, text: a })),
            addrs.length ? '— Select address —' : '— No dispensers —');
    });

    sendModeSelect.addEventListener('change', () => {
        sendModeWarning.style.display = sendModeSelect.value === 'broadcast' ? 'block' : 'none';
    });

    syncNtpState();

    submitBtn.addEventListener('click', async () => {
        const broadcast = sendModeSelect.value === 'broadcast';

        if (!broadcast && !addressSelect.value) {
            return setStatus('Select a dispenser address (or switch to Broadcast).', false);
        }
        if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(brokerIpInput.value.trim())) {
            return setStatus('Enter a valid numeric IPv4 broker IP.', false);
        }
        const portNum = Number(portInput.value);
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
            return setStatus('Enter a valid port (1–65535).', false);
        }
        if (!ntpSameCheckbox.checked && !ntpInput.value.trim()) {
            return setStatus('Enter an NTP server (or tick “Same as broker IP”).', false);
        }

        const body = {
            address: addressSelect.value || null,
            sendMode: broadcast ? 'broadcast' : 'targeted',
            index: Number(slotSelect.value),
            connectionType: Number(connTypeSelect.value),
            protocol: protocolSelect.value,
            brokerIp: brokerIpInput.value.trim(),
            port: portNum,
            ntpSameAsBroker: ntpSameCheckbox.checked,
            ntpServer: ntpInput.value.trim(),
            username: usernameInput.value,
            password: passwordInput.value
        };

        const target = broadcast ? 'all DUCs' : (addressSelect.value || 'the selected DUC');
        const confirmed = window.confirm(`Send server-location update (slot ${slotSelect.value}) to ${target}?`);
        if (!confirmed) return;

        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.6';
        setStatus('Sending…', true);
        try {
            const resp = await fetch(`${API_BASE_URL}/dispensers/server-location`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
            setStatus(`Update published to ${target}.`, true);
            window.showNotification?.(`Server-location update sent to ${target}.`, 'success');
        } catch (e) {
            console.error('server-location update failed:', e);
            setStatus(`Failed: ${e.message}`, false);
            window.showNotification?.(`Update failed: ${e.message}`, 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.style.opacity = '1';
        }
    });
}

// City names are stored lowercase; present them title-cased if the shared
// helper is available, otherwise fall back to the raw value.
function titleCaseCity(city) {
    if (typeof titleCase === 'function') return titleCase(city);
    return String(city || '');
}

window.renderDucConfig = renderDucConfig;
