#!/bin/bash

echo "========================================"
echo "   DUC Server Database Setup"
echo "========================================"
echo ""

# Prompt for MySQL password
echo "Creating database and tables..."
echo ""

# Run the SQL script with password
sudo mysql -u root -p12345< db_schema.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Database setup completed successfully!"
    echo "   Database 'caltex_duc' created with all tables."
else
    echo ""
    echo "❌ Database setup failed!"
    echo "   Please check your MySQL password and try again."
    exit 1
fi

echo ""
read -p "Press Enter to continue..."