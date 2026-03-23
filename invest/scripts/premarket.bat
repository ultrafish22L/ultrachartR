@echo off
setlocal enabledelayedexpansion
REM Pre-Market Check — runs before market open
REM Checks futures, overnight news, confirms day trade plan

set "REPO_DIR=%~dp0..\.."
set "LOG_FILE=%~dp0premarket.log"

cd /d "%REPO_DIR%" || (
    echo [%date% %time%] ERROR: Could not cd to %REPO_DIR% >> "%LOG_FILE%"
    exit /b 1
)

if not exist "invest\MEMORY.md" (
    echo [%date% %time%] ERROR: invest\MEMORY.md not found >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] Starting pre-market check... >> "%LOG_FILE%"

where claude >nul 2>&1 || (
    echo [%date% %time%] ERROR: claude CLI not found in PATH >> "%LOG_FILE%"
    exit /b 1
)

claude -p "You are my investment analyzer. Read invest/MEMORY.md for full context. It is PRE-MARKET. Do the following: 1) Search the web for S&P 500 futures, VIX, gold, and any overnight news that affects our portfolios. 2) Read invest/PORTFOLIO_DAYTRADE.md for queued trades and confirm or adjust the day trade plan based on pre-market conditions. 3) Check for any earnings reports today. 4) Write a brief pre-market note to invest/scripts/premarket_report.md with today's date, key levels, and trade plan. Keep it concise." --output-file "%~dp0premarket_report.md" 2>> "%LOG_FILE%"

if errorlevel 1 (
    echo [%date% %time%] ERROR: claude command failed with exit code %errorlevel% >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] Pre-market check completed successfully. >> "%LOG_FILE%"
