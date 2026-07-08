function renderTopbar(pageTitle) {
    const topbar = document.getElementById('topbar');
    topbar.className = 'topbar';

    // Left section: logo (shown only when sidebar is hidden/collapsed) + title
    const leftSection = document.createElement('div');
    leftSection.style.display = 'flex';
    leftSection.style.alignItems = 'center';
    leftSection.style.gap = '12px';

    const topbarLogo = document.createElement('img');
    topbarLogo.src = 'assets/graphics/stingray-logo-new.jpeg';
    topbarLogo.alt = 'Stingray Logo';
    topbarLogo.className = 'topbar-logo';
    topbarLogo.title = 'Open menu';
    topbarLogo.style.cursor = 'pointer';
    // On phone widths the sidebar slides off-canvas; clicking the topbar logo
    // (the only sidebar handle visible in that mode) toggles it back in.
    topbarLogo.addEventListener('click', () => {
        const sb = document.querySelector('.sidebar');
        if (sb) sb.classList.toggle('mobile-open');
    });
    leftSection.appendChild(topbarLogo);

    // Main title
    const titleDiv = document.createElement('div');
    titleDiv.style.display = 'flex';
    titleDiv.style.alignItems = 'baseline';
    titleDiv.style.gap = '10px';

    const title = document.createElement('h1');
    title.textContent = 'DUC Dashboard';
    title.style.fontSize = '24px';
    title.style.color = 'white';
    title.style.margin = '0';

    titleDiv.appendChild(title);

    if (pageTitle) {
        const sep = document.createElement('span');
        sep.textContent = '›';
        sep.style.color = 'rgba(255,255,255,0.5)';
        sep.style.fontSize = '24px';
        titleDiv.appendChild(sep);

        const pageLabel = document.createElement('span');
        pageLabel.textContent = pageTitle;
        pageLabel.style.color = 'rgba(255,255,255,0.85)';
        pageLabel.style.fontSize = '20px';
        pageLabel.style.fontWeight = '500';
        titleDiv.appendChild(pageLabel);
    }

    leftSection.appendChild(titleDiv);
    topbar.appendChild(leftSection);

    // User section
    const currentUser = StationAuth.getCurrentUser() || 'User';
    const userInfo = StationAuth.getUserInfo();
    const userInitial = currentUser.charAt(0).toUpperCase();
    
    const userContainer = document.createElement('div');
    userContainer.style.display = 'flex';
    userContainer.style.alignItems = 'center';
    userContainer.style.gap = '10px';
    userContainer.style.position = 'relative';

    // Theme toggle (sun / moon)
    const themeBtn = document.createElement('button');
    themeBtn.className = 'theme-toggle-btn';
    themeBtn.type = 'button';
    wireThemeToggle(themeBtn, { aria: true });
    userContainer.appendChild(themeBtn);
    
    // User initial circle
    const userCircle = document.createElement('div');
    userCircle.textContent = userInitial;
    userCircle.title = 'Sign out';
    userCircle.style.cssText = `
        width: 32px;
        height: 32px;
        border: 2px solid #00324C;
        border-radius: 50%;
        background-color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #00324C;
        font-size: 20px;
    `;
    
    // Username and role
    const userTextContainer = document.createElement('div');
    userTextContainer.style.display = 'flex';
    userTextContainer.style.flexDirection = 'column';
    userTextContainer.style.alignItems = 'flex-start';
    
    const username = document.createElement('span');
    username.textContent = currentUser;
    username.style.color = '#fff';
    username.style.fontSize = '14px';
    username.style.fontWeight = '500';
    
    const userRole = document.createElement('span');
    userRole.textContent = userInfo?.role || 'User';
    userRole.style.color = '#ccc';
    userRole.style.fontSize = '12px';
    
    userTextContainer.appendChild(username);
    userTextContainer.appendChild(userRole);
    
    // Dropdown (initially hidden)
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
        position: absolute;
        top: 45px;
        right: 0;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: var(--shadow-card);
        display: none;
        flex-direction: column;
        min-width: 120px;
        z-index: 1000;
    `;

    // User info in dropdown
    const userInfoItem = document.createElement('div');
    userInfoItem.style.cssText = `
        padding: 10px 16px;
        border-bottom: 1px solid var(--border-soft);
        font-size: 12px;
        color: var(--text-secondary);
    `;
    userInfoItem.innerHTML = `
        <div style="font-weight: bold; color: var(--text-primary);">${currentUser}</div>
        <div>Role: ${userInfo?.role || 'User'}</div>
    `;
    dropdown.appendChild(userInfoItem);

    if (userInfo?.role !== 'operator') {
        // Users link
        const usersLink = document.createElement('a');
        usersLink.textContent = 'Users';
        usersLink.href = 'user-management.html';
        usersLink.style.cssText = `
            padding: 10px 16px;
            background: none;
            border: none;
            border-bottom: 1px solid var(--border-soft);
            text-align: left;
            cursor: pointer;
            color: var(--text-primary);
            font-size: 14px;
            width: 100%;
            text-decoration: none;
            display: block;
            box-sizing: border-box;
        `;
        usersLink.onmouseover = () => { usersLink.style.backgroundColor = 'var(--bg-sidebar-hover)'; };
        usersLink.onmouseout = () => { usersLink.style.backgroundColor = 'transparent'; };
        dropdown.appendChild(usersLink);
    }

    // Upload Price File link — shown only to users a super_admin has granted
    // price-file access (allow_price_update). Access is enforced on prices.html.
    if (userInfo?.allow_price_update) {
        const priceLink = document.createElement('a');
        priceLink.textContent = 'Upload Price File';
        priceLink.href = 'prices.html';
        priceLink.style.cssText = `
            padding: 10px 16px;
            background: none;
            border: none;
            border-bottom: 1px solid var(--border-soft);
            text-align: left;
            cursor: pointer;
            color: var(--text-primary);
            font-size: 14px;
            width: 100%;
            text-decoration: none;
            display: block;
            box-sizing: border-box;
        `;
        priceLink.onmouseover = () => { priceLink.style.backgroundColor = 'var(--bg-sidebar-hover)'; };
        priceLink.onmouseout = () => { priceLink.style.backgroundColor = 'transparent'; };
        dropdown.appendChild(priceLink);
    }

    // Sign out button
    const signOutBtn = document.createElement('button');
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.style.cssText = `
        padding: 10px 16px;
        background: none;
        border: none;
        text-align: left;
        cursor: pointer;
        color: var(--danger);
        font-size: 14px;
        width: 100%;
    `;

    signOutBtn.onmouseover = () => {
        signOutBtn.style.backgroundColor = 'var(--bg-sidebar-hover)';
    };

    signOutBtn.onmouseout = () => {
        signOutBtn.style.backgroundColor = 'transparent';
    };

    signOutBtn.onclick = async () => {
        await StationAuth.signOut();
    };

    dropdown.appendChild(signOutBtn);
       
    userContainer.appendChild(userCircle);
    userContainer.appendChild(userTextContainer);
    userContainer.appendChild(dropdown);
    topbar.appendChild(userContainer);
    
    // Toggle dropdown
    userCircle.onclick = (e) => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
    };
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!userContainer.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
}

window.renderTopbar = renderTopbar;