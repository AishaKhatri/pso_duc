#!/bin/bash
# create-service.sh - Script to create a systemd service for Node.js app

# Configuration
SERVICE_NAME="DUCServer"
USER=$(whoami)
NODE_PATH=$(which node)
APP_DIR="/home/orangepi/DUCServer/pso_duc/backend"
APP_SCRIPT="server.js"

# Create service file
sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << EOF
[Unit]
Description=Node.js ${SERVICE_NAME} Application
Documentation=https://nodejs.org
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_PATH} ${APP_DIR}/${APP_SCRIPT}
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=${SERVICE_NAME}
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

# Security hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd, enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}
sudo systemctl start ${SERVICE_NAME}

echo "Service ${SERVICE_NAME} created and started"
echo "To check status: sudo systemctl status ${SERVICE_NAME}"
echo "To view logs: sudo journalctl -u ${SERVICE_NAME} -f"