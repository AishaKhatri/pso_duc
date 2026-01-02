// Import user credentials
const user = {
  username: "admin",
  password: "12345"
};

document.addEventListener('DOMContentLoaded', () => {
  // Style the body
  document.body.style.fontFamily = 'Arial, sans-serif';
  document.body.style.margin = '0';
  document.body.style.backgroundColor = '#f0f4f3';
  document.body.style.color = '#333';
  document.body.style.display = 'flex';
  document.body.style.justifyContent = 'center';
  document.body.style.alignItems = 'center';
  document.body.style.height = '100vh';

  // Create main container
  const container = document.createElement('div');
  container.style.backgroundColor = '#fff';
  container.style.padding = '30px';
  container.style.borderRadius = '8px';
  container.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)';
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
  headerContainer.appendChild(logo);

  const heading = document.createElement('h1');
  heading.textContent = 'Sign In';
  heading.style.color = '#004D64';
  heading.style.margin = '0';
  heading.style.fontSize = '24px';
  headerContainer.appendChild(heading);

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
  usernameLabel.style.color = '#333';
  form.appendChild(usernameLabel);

  const usernameInput = document.createElement('input');
  usernameInput.type = 'text';
  usernameInput.placeholder = 'Enter username';
  usernameInput.style.padding = '10px';
  usernameInput.style.border = '1px solid #e0e0e0';
  usernameInput.style.borderRadius = '4px';
  usernameInput.style.fontSize = '16px';
  form.appendChild(usernameInput);

  // Password input with visibility toggle
  const passwordLabel = document.createElement('label');
  passwordLabel.textContent = 'Password';
  passwordLabel.style.fontSize = '16px';
  passwordLabel.style.color = '#333';
  form.appendChild(passwordLabel);

  const passwordContainer = document.createElement('div');
  passwordContainer.style.position = 'relative';

  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.placeholder = 'Enter password';
  passwordInput.style.padding = '10px';
  passwordInput.style.border = '1px solid #e0e0e0';
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
  submitButton.style.backgroundColor = '#004D64';
  submitButton.style.color = '#fff';
  submitButton.style.border = 'none';
  submitButton.style.borderRadius = '4px';
  submitButton.style.fontSize = '16px';
  submitButton.style.cursor = 'pointer';
  submitButton.style.transition = 'background-color 0.3s';

  submitButton.onmouseover = () => {
    submitButton.style.backgroundColor = '#00324C';
  };
  submitButton.onmouseout = () => {
    submitButton.style.backgroundColor = '#004D64';
  };
  form.appendChild(submitButton);

  // Handle password visibility toggle
  let isPasswordVisible = false;
  toggleButton.addEventListener('click', () => {
    isPasswordVisible = !isPasswordVisible;
    passwordInput.type = isPasswordVisible ? 'text' : 'password';
    toggleIcon.src = isPasswordVisible ? 'assets/graphics/eye-strike.png' : 'assets/graphics/eye.png';
    toggleIcon.alt = isPasswordVisible ? 'Hide Password' : 'Show Password';
  });

  // Handle form submission - Validate against hardcoded user
  submitButton.addEventListener('click', () => {
    const enteredUsername = usernameInput.value.trim();
    const enteredPassword = passwordInput.value.trim();

    // Clear previous error
    errorMessage.style.display = 'none';
    errorMessage.textContent = '';

    // Basic validation
    if (!enteredUsername || !enteredPassword) {
      errorMessage.textContent = 'Please fill in all fields.';
      errorMessage.style.display = 'block';
      return;
    }

    // Show loading state
    submitButton.disabled = true;
    submitButton.textContent = 'Signing In...';

    // Simulate network delay (optional)
    setTimeout(() => {
      // Validate against hardcoded user
      if (enteredUsername === user.username && enteredPassword === user.password) {
        // Successful sign-in
        localStorage.setItem('signedIn', 'true');
        localStorage.setItem('currentUser', enteredUsername);
        
        // Show success message (optional)
        errorMessage.textContent = 'Login successful! Redirecting...';
        errorMessage.style.display = 'block';
        
        // Redirect after short delay
        setTimeout(() => {
          window.location.href = 'index.html';
        }, 1000);
      } else {
        // Failed sign-in
        errorMessage.textContent = 'Invalid username or password.';
        errorMessage.style.display = 'block';
        
        submitButton.disabled = false;
        submitButton.textContent = 'Sign In';
      }
    }, 500);
  });

  container.appendChild(form);
  document.body.appendChild(container);
});