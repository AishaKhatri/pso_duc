function renderSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.className = 'sidebar';
    
    // Check localStorage for sidebar state
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
    }
    
    // Create toggle button
    const toggleBtn = document.createElement('div');
    toggleBtn.className = 'sidebar-toggle';
    toggleBtn.innerHTML = `
        <img src="assets/graphics/sidebar-icon.png" alt="Toggle Sidebar" class="toggle-icon">
    `;
    
    // Sidebar items array (keeping comments for reference)
    const items = [
        { page: 'dispensers', label: 'Dispensers', icon: 'nozzle-icon.png', url: 'index.html' },
        { page: 'atg', label: 'ATG', icon: 'tank-icon.png', url: 'atg.html' },
        { page: 'user-management', label: 'User Management', icon: 'users-icon.png', url: 'user-management.html' },
    ];

    // Determine current page based on window location
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'index';
    const pageMap = {
        'dispensers': 'dispensers',
        'config-dispensers': 'dispensers',
        'atg': 'atg',
        'config-tanks': 'atg',
        'user-management': 'user-management'
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
    const logoEl = document.createElement('img');
    logoEl.src = 'assets/graphics/stingray-logo-new.jpeg';
    logoEl.alt = 'Stingray Logo';
    logoEl.className = 'sidebar-logo';

    // Clear sidebar and append elements
    sidebar.innerHTML = '';
    sidebar.appendChild(toggleBtn);
    sidebarItems.forEach(item => sidebar.appendChild(item));
    sidebar.appendChild(logoEl);

    // Adjust content wrapper based on initial state
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
        contentWrapper.style.marginLeft = isCollapsed ? '55px' : '220px';
    }

    // Toggle functionality
    toggleBtn.addEventListener('click', function() {
        const isNowCollapsed = !sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed');
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