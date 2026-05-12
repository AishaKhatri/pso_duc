// Subscribes to the backend notification websocket and re-emits each incoming
// notification as an `app-notification` CustomEvent on `window`. UI components
// (e.g. the dashboard alerts panel) listen for these events; there is no longer
// any sliding popup behavior.
class NotificationHandler {
    constructor() {
        this.ws = null;
        this.reconnectInterval = 3000;
        this.isConnected = false;
        this.init();
    }

    init() {
        this.connect();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.isConnected) {
                console.log('Page became visible, reconnecting...');
                setTimeout(() => this.connect(), 1000);
            }
        });
    }

    connect() {
        if (this.ws) {
            this.ws.close();
        }

        try {
            const wsUrl = `ws://${host_PC_IP}:3001/ws/notifications`;
            console.log('Attempting to connect to:', wsUrl);
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('Connected to notification service');
                this.isConnected = true;
                this.ws.send(JSON.stringify({
                    type: 'subscribe',
                    channel: 'system_notifications'
                }));
            };

            this.ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('Disconnected from notification service:', event.code, event.reason);
                this.isConnected = false;
                setTimeout(() => this.connect(), this.reconnectInterval);
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.isConnected = false;
            };

        } catch (error) {
            console.error('Error connecting to WebSocket:', error);
            setTimeout(() => this.connect(), this.reconnectInterval);
        }
    }

    handleMessage(data) {
        switch (data.type) {
            case 'system_notification':
            case 'user_notification':
                window.dispatchEvent(new CustomEvent('app-notification', { detail: data }));
                break;
            case 'connection_established':
                console.log('Notification service connection established');
                break;
            case 'pong':
                break;
            default:
                console.log('Received unknown message type:', data.type);
        }
    }

    startHeartbeat() {
        setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 25000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.notificationHandler = new NotificationHandler();
    setTimeout(() => {
        if (window.notificationHandler) {
            window.notificationHandler.startHeartbeat();
        }
    }, 10000);
});
