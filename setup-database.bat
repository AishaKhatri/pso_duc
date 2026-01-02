@echo off
title DUC Server Database Setup
echo ========================================
echo    DUC Server Database Setup
echo ========================================
echo.

:: Check if MySQL is available
mysql --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: MySQL is not installed or not in PATH
    echo Please install MySQL and add it to system PATH
    echo Download from: https://dev.mysql.com/downloads/mysql/
    pause
    exit /b 1
)

:: Get MySQL credentials
set /p mysql_user="Enter MySQL username (default: root): "
if "%mysql_user%"=="" set mysql_user=root

set /p mysql_password="Enter MySQL password: "

:: Check if password is provided
if "%mysql_password%"=="" (
    echo No password provided, trying without password...
    set password_param=
) else (
    set password_param=-p%mysql_password%
)

echo.
echo Creating database and tables...
echo.

:: Run the SQL script
mysql -u %mysql_user% %password_param% -e "SOURCE central_server_schema.sql"

if errorlevel 1 (
    echo.
    echo Database setup failed!
    echo Possible reasons:
    echo - Wrong username/password
    echo - MySQL service not running
    echo - User doesn't have required privileges
    echo.
    pause
    exit /b 1
) else (
    echo.
    echo Database setup completed successfully!
    echo.
)

pause