function renderTopbar() {
    const topbar = document.getElementById('topbar');
    topbar.className = 'topbar';
    
    // Main title
    const titleDiv = document.createElement('div');
    titleDiv.style.display = 'flex';
    titleDiv.style.alignItems = 'center';
    titleDiv.style.gap = '10px';
    
    const title = document.createElement('h1');
    title.textContent = 'Retail ATG / Dispenser Dashboard';
    title.style.fontSize = '24px';
    title.style.color = 'white';
    title.style.margin = '0';
    
    titleDiv.appendChild(title);
    topbar.appendChild(titleDiv);
    
    // User section
    const currentUser = localStorage.getItem('currentUser') || 'User';
    const userInitial = currentUser.charAt(0).toUpperCase();
    
    const userContainer = document.createElement('div');
    userContainer.style.display = 'flex';
    userContainer.style.alignItems = 'center';
    userContainer.style.gap = '10px';
    userContainer.style.position = 'relative';
    
    // User initial circle
    const userCircle = document.createElement('div');
    userCircle.textContent = userInitial;
    userCircle.style.cssText = `
        width: 32px;
        height: 32px;
        border: 2px solid rgb(7, 82, 6);
        border-radius: 50%;
        background-color: #2e7d32;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: white;
    `;
    
    // Username
    const username = document.createElement('span');
    username.textContent = currentUser;
    username.style.color = '#fff';
    
    // Dropdown (initially hidden)
    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
        position: absolute;
        top: 40px;
        right: 0;
        background: white;
        border: 1px solid #ddd;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        display: none;
        flex-direction: column;
        min-width: 80px;
        z-index: 1000;
    `;
    
    // Sign out button
    const signOutBtn = document.createElement('button');
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.style.cssText = `
        padding: 8px 16px;
        background: none;
        border: none;
        text-align: left;
        cursor: pointer;
        color: #111;
        font-size: 14px;
    `;
    
    signOutBtn.onmouseover = () => {
        signOutBtn.style.backgroundColor = '#f5f5f5';
    };
    
    signOutBtn.onmouseout = () => {
        signOutBtn.style.backgroundColor = 'transparent';
    };
    
    signOutBtn.onclick = () => {
        localStorage.setItem('signedIn', 'false');
        localStorage.removeItem('currentUser');
        window.location.href = 'signin.html';
    };
    
    dropdown.appendChild(signOutBtn);
    userContainer.appendChild(userCircle);
    userContainer.appendChild(username);
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