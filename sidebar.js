function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.className = 'sidebar';

    // Get current user from localStorage
    const currentUser = StationAuth.getUserInfo();
    const role = currentUser?.role;
    const isSuperAdmin = role === 'super_admin';
    const isAdmin = role === 'admin';
    const isOperator = role === 'operator';

    // Operators get a chrome-free dashboard view: hide the sidebar entirely and
    // remove the left margin reserved for it.
    if (isOperator) {
        sidebar.style.display = 'none';
        document.body.classList.add('sidebar-hidden');
        const contentWrapper = document.querySelector('.content-wrapper');
        if (contentWrapper) {
            contentWrapper.style.marginLeft = '0';
        }
        return;
    }

    // Check localStorage for sidebar state
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
    } else {
        document.body.classList.remove('sidebar-collapsed');
    }

    // Create toggle button
    const toggleBtn = document.createElement('div');
    toggleBtn.className = 'sidebar-toggle';
    toggleBtn.innerHTML = `
        <img src="assets/graphics/sidebar-icon.png" alt="Toggle Sidebar" class="toggle-icon">
    `;

    // Sidebar items based on user role
    const items = [];

    items.push({ page: 'dispensers', label: 'Dispensers', icon: 'nozzle-icon.png', url: 'dispensers.html' });

    if (isAdmin || isSuperAdmin) {
        items.push({ page: 'overview', label: 'Overview', icon: 'overview-icon.png', url: 'overview.html' });
    }

    items.push({ page: 'analytics', label: 'Analytics', icon: 'analytics-icon.png', url: 'analytics.html' });

    if (!isOperator) {
        items.push({ page: 'users', label: 'User Management', icon: 'users-icon.png', url: 'user-management.html' });
        items.push({ page: 'sites', label: 'Site Management', icon: 'sites-icon.png', url: 'site-management.html' });
    }

    if (isAdmin || isSuperAdmin) {
        items.push({ page: 'price-update', label: 'Price Update', icon: 'prices-icon.png', url: 'price-update.html' });
    }

    // Super-admin-only tools group: a collapsible section holding page links
    // (e.g. the price-file upload page, activity logs) and action buttons
    // (e.g. Scan Dispensers) that only a super admin may use.
    let adminGroup = null;
    if (isSuperAdmin) {
        adminGroup = {
            label: 'Admin Tools',
            icon: 'config-icon.png',
            children: [
                { type: 'link', page: 'prices', label: 'Upload Price File', icon: 'prices-icon.png', url: 'prices.html' },
                { type: 'link', page: 'activity-logs', label: 'Activity Logs', icon: 'activity-icon.svg', url: 'activity-logs.html' },
                { type: 'link', page: 'duc-config', label: 'DUC Server Config', icon: 'config-icon.png', url: 'duc-config.html' },
                { type: 'action', action: 'scan-dispensers', label: 'Scan Dispensers', icon: 'search-icon.svg' },
            ]
        };
    }

    // Determine current page based on window location
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
    const pageMap = {
        'overview': 'overview',
        'analytics': 'analytics',
        'dispensers': 'dispensers',
        'config-dispensers': 'dispensers',
        'user-management': 'users',
        'site-management': 'sites',
        'prices': 'prices',
        'price-update': 'price-update',
        'activity-logs': 'activity-logs',
        'duc-config': 'duc-config',
    };
    const activePage = pageMap[currentPage] || 'dispensers';

    // Create sidebar items
    const sidebarItems = items.map(item => {
        const itemEl = document.createElement('a');
        itemEl.href = item.url;
        itemEl.className = `sidebar-item ${activePage === item.page ? 'active' : ''}`;
        itemEl.setAttribute('data-page', item.page);
        
        const iconEl = document.createElement('img');
        iconEl.src = `assets/graphics/${item.icon}`;
        iconEl.alt = item.label;
        iconEl.className = 'sidebar-icon';
        
        const labelEl = document.createElement('span');
        labelEl.className = 'sidebar-label';
        labelEl.textContent = item.label;
        
        itemEl.appendChild(iconEl);
        itemEl.appendChild(labelEl);
        
        return itemEl;
    });

    // Clear sidebar and append elements
    sidebar.innerHTML = '';
    sidebar.appendChild(toggleBtn);
    sidebarItems.forEach(item => sidebar.appendChild(item));

    // Render the super-admin tools group (links + action buttons) below the
    // regular flat items.
    if (adminGroup) {
        sidebar.appendChild(renderSidebarGroup(adminGroup, activePage));
    }

    // Adjust content wrapper based on initial state
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
        contentWrapper.style.marginLeft = isCollapsed ? '55px' : '220px';
    }

    // Toggle functionality
    toggleBtn.addEventListener('click', function() {
        const isNowCollapsed = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed', isNowCollapsed);
        toggleBtn.title = isNowCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';

        // Save state to localStorage
        localStorage.setItem('sidebarCollapsed', isNowCollapsed.toString());

        // Adjust content wrapper
        if (contentWrapper) {
            contentWrapper.style.marginLeft = isNowCollapsed ? '55px' : '220px';
        }
    });
}

// Build a collapsible sidebar group: a header row that toggles a submenu of
// page links and/or action buttons. Expand/collapse state is persisted, and
// the group auto-expands when one of its child pages is the active page.
function renderSidebarGroup(group, activePage) {
    const wrapper = document.createElement('div');
    wrapper.className = 'sidebar-group';

    const childPages = group.children
        .filter(c => c.type === 'link')
        .map(c => c.page);
    const containsActive = childPages.includes(activePage);

    const stored = localStorage.getItem('sidebarAdminToolsExpanded');
    // Default to expanded on first visit (stored === null); always expand when
    // a child page is the one currently open.
    const expanded = containsActive || stored === null || stored === 'true';
    if (expanded) wrapper.classList.add('expanded');

    // Header row.
    const header = document.createElement('div');
    header.className = 'sidebar-item sidebar-group-header';

    const headerIcon = document.createElement('img');
    headerIcon.src = `assets/graphics/${group.icon}`;
    headerIcon.alt = group.label;
    headerIcon.className = 'sidebar-icon';

    const headerLabel = document.createElement('span');
    headerLabel.className = 'sidebar-label';
    headerLabel.textContent = group.label;

    const chevron = document.createElement('span');
    chevron.className = 'sidebar-group-chevron sidebar-label';
    chevron.textContent = '▾';

    header.appendChild(headerIcon);
    header.appendChild(headerLabel);
    header.appendChild(chevron);

    // Submenu.
    const submenu = document.createElement('div');
    submenu.className = 'sidebar-submenu';

    group.children.forEach(child => {
        let el;
        if (child.type === 'link') {
            el = document.createElement('a');
            el.href = child.url;
            el.className = `sidebar-item sidebar-subitem ${activePage === child.page ? 'active' : ''}`;
            el.setAttribute('data-page', child.page);
        } else {
            el = document.createElement('button');
            el.type = 'button';
            el.className = 'sidebar-item sidebar-subitem';
            el.setAttribute('data-action', child.action);
            if (child.action === 'scan-dispensers') {
                el.addEventListener('click', handleScanDispensers);
            }
        }

        // Sub-items are text-only — no icon.
        const label = document.createElement('span');
        label.className = 'sidebar-label';
        label.textContent = child.label;

        el.appendChild(label);
        submenu.appendChild(el);
    });

    const isRailCollapsed = () => {
        const el = document.getElementById('sidebar');
        return !!el && el.classList.contains('collapsed');
    };

    const positionFlyout = () => {
        const sidebarEl = document.getElementById('sidebar');
        if (!sidebarEl) return;
        const headerRect = header.getBoundingClientRect();
        const railRect = sidebarEl.getBoundingClientRect();
        submenu.style.top = `${headerRect.top}px`;
        submenu.style.left = `${railRect.right}px`;
    };

    const showFlyout = () => {
        if (submenu.parentNode !== document.body) document.body.appendChild(submenu);
        submenu.classList.add('flyout', 'flyout-visible');
        positionFlyout();
    };
    const hideFlyout = () => {
        submenu.classList.remove('flyout', 'flyout-visible', 'flyout-locked');
        submenu.style.top = '';
        submenu.style.left = '';
        // Return it to the group so the expanded (inline accordion) state works.
        if (submenu.parentNode !== wrapper) wrapper.appendChild(submenu);
    };
    // Hide on mouse-out, unless the cursor is just crossing the rail↔flyout seam
    // (the flyout is a sibling in <body>, so that crossing fires mouseleave) or
    // the flyout is click-locked open.
    const hideUnlessInto = (other) => (e) => {
        if (submenu.classList.contains('flyout-locked')) return;
        if (other.contains(e.relatedTarget)) return;
        hideFlyout();
    };

    // Collapsed: reveal the flyout on hover; expanded: no-op (inline accordion).
    wrapper.addEventListener('mouseenter', function () {
        if (isRailCollapsed()) showFlyout();
    });
    wrapper.addEventListener('mouseleave', hideUnlessInto(submenu));
    submenu.addEventListener('mouseleave', hideUnlessInto(wrapper));

    header.addEventListener('click', function () {
        // Collapsed: click locks the flyout open (so it survives mouse-out); a
        // second click unlocks it (hover still governs), and a click anywhere
        // outside closes it.
        if (isRailCollapsed()) {
            if (submenu.classList.contains('flyout-locked')) {
                submenu.classList.remove('flyout-locked');
            } else {
                showFlyout();
                submenu.classList.add('flyout-locked');
            }
            return;
        }
        // Expanded: toggle the inline accordion and remember the choice.
        const nowExpanded = !wrapper.classList.contains('expanded');
        wrapper.classList.toggle('expanded', nowExpanded);
        localStorage.setItem('sidebarAdminToolsExpanded', String(nowExpanded));
    });

    // Dismiss the flyout when clicking outside both the group and the flyout.
    document.addEventListener('click', function (e) {
        if (!wrapper.contains(e.target) && !submenu.contains(e.target)) {
            hideFlyout();
        }
    });

    wrapper.appendChild(header);
    wrapper.appendChild(submenu);
    return wrapper;
}

// "Scan Dispensers" action: asks the backend to publish the broadcast scan
// command on duc/broadcast. The clientid/ip in the payload are filled in
// server-side from variables — the frontend just triggers the action.
async function handleScanDispensers(e) {
    const btn = e.currentTarget;
    if (btn.disabled) return;

    const labelEl = btn.querySelector('.sidebar-label');
    const originalLabel = labelEl ? labelEl.textContent : '';

    btn.disabled = true;
    if (labelEl) labelEl.textContent = 'Scanning…';

    try {
        const userInfo = (typeof StationAuth !== 'undefined' && StationAuth.getUserInfo && StationAuth.getUserInfo()) || null;
        const response = await fetch(`${API_BASE_URL}/dispensers/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: userInfo?.id ?? null,
                username: userInfo?.username ?? null
            })
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to start scan');
        }
        showSidebarToast('Dispenser scan broadcast sent', 'success');
    } catch (err) {
        console.error('Scan dispensers failed:', err);
        showSidebarToast(`Scan failed: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        if (labelEl) labelEl.textContent = originalLabel;
    }
}

// Lightweight transient toast — sidebar.js loads on every page, so it can't
// rely on a page-specific status helper being present.
function showSidebarToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `sidebar-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    // Force reflow so the entry transition runs, then show.
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

window.renderSidebar = renderSidebar;