// notification-handler.js
class NotificationHandler {
    constructor() {
        this.ws = null;
        this.reconnectInterval = 3000;
        this.isConnected = false;
        this.init();
    }

    init() {
        this.connect();
        
        // Handle page visibility change to reconnect when tab becomes active
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) {
                console.log('Page became visible, reconnecting...');
                setTimeout(() => this.connect(), 1000);
            }
        });
    }

    connect() {
        // Close existing connection if any
        if (this.ws) {
            this.ws.close();
        }

        try {
            // Connect directly to backend server on port 3001
            const wsUrl = `ws://${host_PC_IP}:3001/ws/notifications`;
            
            console.log('Attempting to connect to:', wsUrl);
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => {
                console.log('Connected to notification service');
                this.isConnected = true;
                
                // Subscribe to system notifications
                this.ws.send(JSON.stringify({
                    type: 'subscribe',
                    channel: 'system_notifications'
                }));
                
                console.log('Subscribed to system notifications');
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    // console.log('📨 Received message:', data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('❌ Error parsing WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('Disconnected from notification service:', event.code, event.reason);
                this.isConnected = false;
                
                // Attempt reconnect after delay
                console.log(`Reconnecting in ${this.reconnectInterval/1000} seconds...`);
                setTimeout(() => this.connect(), this.reconnectInterval);
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('❌ Error connecting to WebSocket:', error);
            setTimeout(() => this.connect(), this.reconnectInterval);
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'system_notification':
                this.handleSystemNotification(data);
                break;
            case 'user_notification':
                this.handleUserNotification(data);
                break;
            case 'connection_established':
                console.log('✅ Notification service connection established');
                break;
            case 'pong':
            //     console.log('🏓 Received pong');
                break;
            default:
                console.log('Received unknown message type:', data.type);
        }
    }

    handleSystemNotification(notification) {
        console.log('System notification received:', notification);
        
        // Show notification in UI
        if (window.generateNotification && typeof window.generateNotification === 'function') {
            window.generateNotification(
                notification.title,
                notification.message,
                notification.notificationType || 'info'
            );
        } else {
            // Fallback - show browser notification
            console.warn('generateNotification function not available, using fallback');
            if (Notification.permission === 'granted') {
                new Notification(notification.title, { body: notification.message });
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    if (permission === 'granted') {
                        new Notification(notification.title, { body: notification.message });
                    }
                });
            }
        }
    }

    handleUserNotification(notification) {
        console.log('User notification received:', notification);
    }

    // Send ping to keep connection alive
    startHeartbeat() {
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 25000); // Every 25 seconds
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.notificationHandler = new NotificationHandler();
    
    // Start heartbeat after a delay
    setTimeout(() => {
        if (window.notificationHandler) {
            window.notificationHandler.startHeartbeat();
            console.log('Heartbeat started');
        }
    }, 10000);
});