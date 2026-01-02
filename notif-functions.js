let notificationStack = [];

async function generateNotification(title, message, type = 'info') {
    
    try {
        // Create notification element
        const notification = document.createElement('div');
        const notificationId = Date.now();
        notification.dataset.id = notificationId;
        
        notification.className = `notification notification-${type}`;
        notification.style.cssText = `
            position: fixed;
            top: -100px;
            right: 20px;
            background: white;
            padding: 15px 15px;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            width: 300px;
            cursor: pointer;
            border: 1px solid #ccc;
            border-left: 6px solid #BFA181;
            transition: all 0.5s ease;
            opacity: 0;
        `;

        notification.innerHTML = `
            <div style="display: flex; flex-direction: row; gap: 20px;">
                <img src="assets/graphics/nozzle-icon.png" alt="Nozzle" style="height: 100%; width: 35px">
                <div style="display: flex; flex-direction: column; align-items: left;">
                    <div style="font-weight: bold; margin-bottom: 5px; font-size: 16px; color: #333;">${title}</div>
                    <div style="font-size: 16px; color: #333;">${message}</div>
                </div>
            </div>
        `;

        // Add to document
        document.body.appendChild(notification);

        // Add to stack
        notificationStack.unshift({
            id: notificationId,
            element: notification,
            height: notification.offsetHeight
        });

        // Animate new notification in from top
        setTimeout(() => {
            notification.style.transform = 'translateY(0)';
            notification.style.opacity = '1';
            notification.style.top = '20px';
        }, 5);

        // Slide down all existing notifications
        notificationStack.slice(1).forEach((notif, index) => {
            const newTop = 20 + (index + 1) * (notif.height + 10);
            notif.element.style.top = `${newTop}px`;
        });

        // Remove notification function
        const removeNotification = () => {
            // Find and remove from stack
            const index = notificationStack.findIndex(n => n.id === notificationId);
            if (index !== -1) {
                notificationStack.splice(index, 1);
            }

            // Animate out
            notification.style.transform = 'translateX(100%)';
            notification.style.opacity = '0';
            
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                    // Update positions of remaining notifications
                    updateAllNotificationPositions();
                }
            }, 300);
        };

        // Auto remove after 10 seconds
        const removeTimeout = setTimeout(removeNotification, 5000);

        // Click to dismiss
        notification.addEventListener('click', () => {
            clearTimeout(removeTimeout);
            removeNotification();
        });

        // Add CSS styles if not already added
        addEnhancedNotificationStyles();

        return notification;

    } catch (error) {
        console.error('❌ Error generating notification:', error);
        // Fallback: use browser notification if available
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification(title, { body: message });
                    }
                });
            } else if (Notification.permission === 'granted') {
                new Notification(title, { body: message });
            }
        }
    }
}

function updateAllNotificationPositions() {
    notificationStack.forEach((notif, index) => {
        notif.element.style.top = `${20 + index * (notif.height + 10)}px`;
    });
}

function addEnhancedNotificationStyles() {
    if (document.getElementById('notification-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'notification-styles';
    styles.textContent = `
        .notification {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
    `;
    document.head.appendChild(styles);
}

// Helper functions remain the same
function getNotificationColor(type) {
    const colors = {
        info: '#2196F3',
        success: '#4CAF50',
        // warning: '#FF9800',
        warning: '#D32F2F',
        error: '#F44336'
    };
    return colors[type] || colors.info;
}

function clearAllNotifications() {
    notificationStack.forEach(notif => {
        notif.element.style.transform = 'translateY(-100%)';
        notif.element.style.opacity = '0';
        setTimeout(() => {
            if (notif.element.parentNode) {
                document.body.removeChild(notif.element);
            }
        }, 300);
    });
    notificationStack = [];
}