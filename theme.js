(function () {
    const STORAGE_KEY = 'theme';

    function applyTheme(theme) {
        const t = theme === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
    }

    function getSavedTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'light';
        } catch (e) {
            return 'light';
        }
    }

    function setTheme(theme) {
        const t = theme === 'dark' ? 'dark' : 'light';
        try { localStorage.setItem(STORAGE_KEY, t); } catch (e) {}
        applyTheme(t);
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
    }

    function toggleTheme() {
        setTheme(getSavedTheme() === 'dark' ? 'light' : 'dark');
    }

    applyTheme(getSavedTheme());

    window.AppTheme = {
        get: getSavedTheme,
        set: setTheme,
        toggle: toggleTheme
    };
})();
