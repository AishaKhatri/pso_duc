function renderTopbar() {
    const topbar = document.getElementById('topbar');
    topbar.className = 'topbar';
    
    // Main title
    const titleDiv = document.createElement('div');
    titleDiv.style.display = 'flex';
    titleDiv.style.alignItems = 'center';
    titleDiv.style.gap = '10px';
    
    const title = document.createElement('h1');
    title.textContent = 'PSO DUC Dashboard';
    title.style.fontSize = '24px';
    title.style.color = 'white';
    title.style.margin = '0';
    
    titleDiv.appendChild(title);
    topbar.appendChild(titleDiv);
    
    // User section
    const currentUser = StationAuth.getCurrentUser() || 'User';
    const userInfo = StationAuth.getUserInfo();
    const userInitial = currentUser.charAt(0).toUpperCase();
    
    const userContainer = document.createElement('div');
    userContainer.style.display = 'flex';
    userContainer.style.alignItems = 'center';
    userContainer.style.gap = '10px';
    userContainer.style.position = 'relative';
    
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
        background: white;
        border: 1px solid #ddd;
        border-radius: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        display: none;
        flex-direction: column;
        min-width: 120px;
        z-index: 1000;
    `;
    
    // User info in dropdown
    const userInfoItem = document.createElement('div');
    userInfoItem.style.cssText = `
        padding: 10px 16px;
        border-bottom: 1px solid #eee;
        font-size: 12px;
        color: #666;
    `;
    userInfoItem.innerHTML = `
        <div style="font-weight: bold; color: #333;">${currentUser}</div>
        <div>Role: ${userInfo?.role || 'User'}</div>
    `;
    dropdown.appendChild(userInfoItem);
    
    // Sign out button
    const signOutBtn = document.createElement('button');
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.style.cssText = `
        padding: 10px 16px;
        background: none;
        border: none;
        text-align: left;
        cursor: pointer;
        color: #d32f2f;
        font-size: 14px;
        width: 100%;
    `;
    
    signOutBtn.onmouseover = () => {
        signOutBtn.style.backgroundColor = '#f5f5f5';
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