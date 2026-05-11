document.addEventListener('DOMContentLoaded', () => {
  // Style the body — uses theme variables so dark mode applies
  document.body.style.fontFamily = 'Arial, sans-serif';
  document.body.style.margin = '0';
  document.body.style.backgroundColor = 'var(--bg-page)';
  document.body.style.color = 'var(--text-primary)';
  document.body.style.display = 'flex';
  document.body.style.justifyContent = 'center';
  document.body.style.alignItems = 'center';
  document.body.style.height = '100vh';

  // Create main container
  const container = document.createElement('div');
  container.className = 'card';
  container.style.padding = '30px';
  container.style.borderRadius = '8px';
  container.style.maxWidth = '400px';
  container.style.width = '100%';
  container.style.boxSizing = 'border-box';

  // Header with logo and title
  const headerContainer = document.createElement('div');
  headerContainer.style.display = 'flex';
  headerContainer.style.alignItems = 'center';
  headerContainer.style.gap = '10px';
  headerContainer.style.marginBottom = '20px';

  const logo = document.createElement('img');
  logo.src = 'assets/graphics/stingray-logo-new.jpeg';
  logo.alt = 'Logo';
  logo.style.width = '60px';
  logo.style.height = '60px';
  logo.style.background = '#ffffff';
  logo.style.padding = '4px';
  logo.style.borderRadius = '50%';
  logo.style.boxSizing = 'border-box';
  logo.style.objectFit = 'cover';
  logo.style.boxShadow = '0 2px 6px rgba(0,0,0,0.18)';
  headerContainer.appendChild(logo);

  const heading = document.createElement('h1');
  heading.textContent = 'Sign In';
  heading.style.color = 'var(--text-heading)';
  heading.style.margin = '0';
  heading.style.fontSize = '24px';
  headerContainer.appendChild(heading);

  // Theme toggle button
  const themeBtn = document.createElement('button');
  themeBtn.type = 'button';
  themeBtn.style.marginLeft = 'auto';
  themeBtn.style.background = 'transparent';
  themeBtn.style.border = '1px solid var(--border)';
  themeBtn.style.color = 'var(--text-primary)';
  themeBtn.style.borderRadius = '50%';
  themeBtn.style.width = '32px';
  themeBtn.style.height = '32px';
  themeBtn.style.cursor = 'pointer';
  themeBtn.style.display = 'flex';
  themeBtn.style.alignItems = 'center';
  themeBtn.style.justifyContent = 'center';
  themeBtn.style.fontSize = '16px';
  const setThemeIcon = () => {
    const isDark = window.AppTheme && window.AppTheme.get() === 'dark';
    themeBtn.textContent = isDark ? '☀' : '☽';
    themeBtn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
  };
  setThemeIcon();
  themeBtn.addEventListener('click', () => {
    if (window.AppTheme) window.AppTheme.toggle();
    setThemeIcon();
  });
  window.addEventListener('themechange', setThemeIcon);
  headerContainer.appendChild(themeBtn);

  container.appendChild(headerContainer);

  // Form container
  const form = document.createElement('div');
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  form.style.gap = '15px';

  // Username input
  const usernameLabel = document.createElement('label');
  usernameLabel.textContent = 'Username';
  usernameLabel.style.fontSize = '16px';
  usernameLabel.style.color = 'var(--text-primary)';
  form.appendChild(usernameLabel);

  const usernameInput = document.createElement('input');
  usernameInput.type = 'text';
  usernameInput.placeholder = 'Enter username';
  usernameInput.style.padding = '10px';
  usernameInput.style.border = '1px solid var(--border)';
  usernameInput.style.backgroundColor = 'var(--bg-surface)';
  usernameInput.style.color = 'var(--text-primary)';
  usernameInput.style.borderRadius = '4px';
  usernameInput.style.fontSize = '16px';
  form.appendChild(usernameInput);

  // Password input with visibility toggle
  const passwordLabel = document.createElement('label');
  passwordLabel.textContent = 'Password';
  passwordLabel.style.fontSize = '16px';
  passwordLabel.style.color = 'var(--text-primary)';
  form.appendChild(passwordLabel);

  const passwordContainer = document.createElement('div');
  passwordContainer.style.position = 'relative';

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.placeholder = 'Enter password';
  passwordInput.style.padding = '10px';
  passwordInput.style.border = '1px solid var(--border)';
  passwordInput.style.backgroundColor = 'var(--bg-surface)';
  passwordInput.style.color = 'var(--text-primary)';
  passwordInput.style.borderRadius = '4px';
  passwordInput.style.fontSize = '16px';
  passwordInput.style.width = '100%';
  passwordInput.style.boxSizing = 'border-box';
  passwordContainer.appendChild(passwordInput);

  const toggleButton = document.createElement('button');
  toggleButton.style.position = 'absolute';
  toggleButton.style.right = '10px';
  toggleButton.style.top = '50%';
  toggleButton.style.transform = 'translateY(-50%)';
  toggleButton.style.background = 'none';
  toggleButton.style.border = 'none';
  toggleButton.style.cursor = 'pointer';

  const toggleIcon = document.createElement('img');
  toggleIcon.src = 'assets/graphics/eye.png';
  toggleIcon.alt = 'Toggle Password Visibility';
  toggleIcon.style.width = '16px';
  toggleIcon.style.height = '16px';
  toggleIcon.className = 'signin-eye-icon';
  toggleButton.appendChild(toggleIcon);

  passwordContainer.appendChild(toggleButton);
  form.appendChild(passwordContainer);

  // Error message
  const errorMessage = document.createElement('div');
  errorMessage.style.fontSize = '14px';
  errorMessage.style.display = 'none';
  form.appendChild(errorMessage);

  // Submit button
  const submitButton = document.createElement('button');
  submitButton.textContent = 'Sign In';
  submitButton.style.padding = '12px';
  submitButton.style.backgroundColor = 'var(--accent)';
  submitButton.style.color = 'var(--text-on-accent)';
  submitButton.style.border = 'none';
  submitButton.style.borderRadius = '4px';
  submitButton.style.fontSize = '16px';
  submitButton.style.cursor = 'pointer';
  submitButton.style.transition = 'background-color 0.3s';

  submitButton.onmouseover = () => {
    submitButton.style.backgroundColor = 'var(--accent-hover)';
  };
  submitButton.onmouseout = () => {
    submitButton.style.backgroundColor = 'var(--accent)';
  };
  form.appendChild(submitButton);

  container.appendChild(form);
  document.body.appendChild(container);

  // Handle password visibility toggle
  let isPasswordVisible = false;
  toggleButton.addEventListener('click', () => {
    isPasswordVisible = !isPasswordVisible;
    passwordInput.type = isPasswordVisible ? 'text' : 'password';
    toggleIcon.src = isPasswordVisible ? 'assets/graphics/eye-strike.png' : 'assets/graphics/eye.png';
    toggleIcon.alt = isPasswordVisible ? 'Hide Password' : 'Show Password';
  });

  // Function to handle sign in
  async function handleSignIn() {
    const enteredUsername = usernameInput.value.trim();
    const enteredPassword = passwordInput.value.trim();

    // Clear previous error
    errorMessage.style.display = 'none';
    errorMessage.textContent = '';
    
    if (!enteredUsername || !enteredPassword) {
      errorMessage.textContent = 'Please enter username and password';
      errorMessage.style.display = 'block';
      return;
    }
    
    // Disable button to prevent multiple submissions
    submitButton.disabled = true;
    submitButton.textContent = 'Signing In...';
    
    const result = await StationAuth.signIn(enteredUsername, enteredPassword);
    
    // Re-enable button
    submitButton.disabled = false;
    submitButton.textContent = 'Sign In';
    
    if (result.success) {
      // Redirect to dashboard
      window.location.href = 'index.html';
    } else {
      errorMessage.textContent = result.message;
      errorMessage.style.display = 'block';
      errorMessage.style.color = '#c62828';
    }
  }

  // Handle form submission on button click
  submitButton.addEventListener('click', handleSignIn);

  // Handle Enter key press on username and password inputs
  usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSignIn();
    }
  });

  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSignIn();
    }
  });
});