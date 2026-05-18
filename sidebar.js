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

    items.push({ page: 'dashboard', label: 'Dashboard', icon: 'dashboard-icon.png', url: 'index.html' });
    items.push({ page: 'dispensers', label: 'Dispensers', icon: 'nozzle-icon.png', url: 'dispensers.html' });

    if (isAdmin || isSuperAdmin) {
        items.push({ page: 'overview', label: 'Overview', icon: 'overview-icon.png', url: 'overview.html' });
    }

    if (!isOperator) {
        items.push({ page: 'users', label: 'User Management', icon: 'users-icon.png', url: 'user-management.html' });
        items.push({ page: 'sites', label: 'Site Management', icon: 'sites-icon.png', url: 'site-management.html' });
    }

    if (isSuperAdmin) {
        items.push({ page: 'activity-logs', label: 'Activity Logs', icon: 'notification-icon.png', url: 'activity-logs.html' });
    }

    // Determine current page based on window location
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
    const pageMap = {
        'index': 'dashboard',
        'overview': 'overview',
        'dispensers': 'dispensers',
        'config-dispensers': 'dispensers',
        'user-management': 'users',
        'site-management': 'sites',
        'activity-logs': 'activity-logs',
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

    // Create logo
    // const logoEl = document.createElement('img');
    // logoEl.src = 'assets/graphics/stingray-logo-new.jpeg';
    // logoEl.alt = 'Stingray Logo';
    // logoEl.className = 'sidebar-logo';

    // Clear sidebar and append elements
    sidebar.innerHTML = '';
    sidebar.appendChild(toggleBtn);
    sidebarItems.forEach(item => sidebar.appendChild(item));
    // sidebar.appendChild(logoEl);

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

window.renderSidebar = renderSidebar;