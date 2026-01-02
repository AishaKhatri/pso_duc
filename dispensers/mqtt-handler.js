// Global MQTT client instance
let mqttClient = null;

// Track subscribed topics and their callbacks
const subscribedTopics = new Set();
const messageCallbacks = new Map();

// Initialize MQTT client
function initializeMQTTClient(onConnectCallback, onErrorCallback) {
    if (mqttClient && mqttClient.connected) {
        console.log('MQTT client already connected');
        if (onConnectCallback) onConnectCallback();
        return mqttClient;
    }

    // const host = 'broker.hivemq.com';
    const host = 'localhost';
    const port = 8083;
    const clientId = `server_frontend`;

    mqttClient = mqtt.connect(`ws://${host_PC_IP}:8083/mqtt`, {
    // mqttClient = mqtt.connect(`tcp://${host}:${port}`, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 30 * 1000,
        username: 'duc',
        password: 'SRT123'
    });

    // Single message handler
    mqttClient.on('message', (receivedTopic, message) => {
        if (messageCallbacks.has(receivedTopic)) {
            // console.log(`Received on ${receivedTopic}: ${message.toString()}`);
            const callback = messageCallbacks.get(receivedTopic);
            callback(receivedTopic, message);
        }
    });

    mqttClient.on('connect', () => {
        console.log('MQTT client connected to HiveMQ Cloud broker');
        subscribedTopics.clear(); // Clear subscriptions on new connection
        messageCallbacks.clear(); // Clear callbacks to prevent leaks
        if (onConnectCallback) onConnectCallback();
    });

    mqttClient.on('error', (err) => {
        console.error('MQTT client error:', err);
        if (onErrorCallback) onErrorCallback(err);
    });

    mqttClient.on('close', () => {
        console.log('MQTT connection closed');
        subscribedTopics.clear();
        messageCallbacks.clear();
    });

    mqttClient.on('reconnect', () => {
        console.log('Attempting to reconnect to MQTT broker');
    });

    mqttClient.on('offline', () => {
        console.log('MQTT client is offline');
    });

    return mqttClient;
}

function subscribeToTopic(topic, callback) {
    if (!mqttClient) {
        console.error('MQTT client not initialized');
        return;
    }

    if (subscribedTopics.has(topic)) {
        console.log(`Already subscribed to ${topic}`);
        messageCallbacks.set(topic, callback); // Update callback if topic exists
        return;
    }

    mqttClient.subscribe(topic, { qos: 1 }, (err) => {
        if (!err) {
            console.log(`Subscribed to ${topic}`);
            subscribedTopics.add(topic);
            messageCallbacks.set(topic, callback);
        } else {
            console.error(`Subscription error for ${topic}:`, err);
        }
    });
}

function publishMessage(topic, message, callback) {
    if (mqttClient) {
        mqttClient.publish(topic, message, { qos: 1 }, (err) => {
            if (callback) callback(err);
        });
    } else {
        console.error('MQTT client not initialized');
        if (callback) callback(new Error('MQTT client not connected'));
    }
}

function publishPriceUpdate(topic, message, callback) {
    if (mqttClient) {
        mqttClient.publish(topic, message, {retain : true, qos: 1 }, (err) => {
            if (callback) callback(err);
        });
    } else {
        console.error('MQTT client not initialized');
        if (callback) callback(new Error('MQTT client not connected'));
    }
}

function endMQTTClient() {
    if (mqttClient) {
        mqttClient.end();
        mqttClient = null;
        subscribedTopics.clear();
        messageCallbacks.clear();
        console.log('MQTT client disconnected');
    }
}

// Expose functions globally
window.initializeMQTTClient = initializeMQTTClient;
window.subscribeToTopic = subscribeToTopic;
window.publishMessage = publishMessage;
window.endMQTTClient = endMQTTClient;