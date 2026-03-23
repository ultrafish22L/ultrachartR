@echo off
setlocal enabledelayedexpansion
REM Post-Close Report — runs after market close
REM Full daily report, updates both portfolios

set "REPO_DIR=%~dp0..\.."
set "LOG_FILE=%~dp0postclose.log"

cd /d "%REPO_DIR%" || (
    echo [%date% %time%] ERROR: Could not cd to %REPO_DIR% >> "%LOG_FILE%"
    exit /b 1
)

if not exist "invest\MEMORY.md" (
    echo [%date% %time%] ERROR: invest\MEMORY.md not found >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] Starting post-close report... >> "%LOG_FILE%"

where claude >nul 2>&1 || (
    echo [%date% %time%] ERROR: claude CLI not found in PATH >> "%LOG_FILE%"
    exit /b 1
)

claude -p "You are my investment analyzer. Read invest/MEMORY.md for full context. It is POST-CLOSE (DAYEND). Do the following: 1) Fetch closing prices for all 15 long-term positions (NVDA, MSFT, AMD, AVGO, MRVL, META, GLD, VXUS, CCJ, GDX, COPX, XLP, IBIT, GILD, ARKX) from stockanalysis.com. 2) Update the Day 1+ tracking log in invest/PORTFOLIO_LONGTERM.md with current prices, P&L per position, and total portfolio value. 3) Execute any queued day trades in invest/PORTFOLIO_DAYTRADE.md at today's open prices, check closing prices, and update the trade journal with results. 4) Search for any major market news, Fed announcements, or earnings that affect our positions. 5) Write tomorrow's day trade plan. 6) Update invest/MEMORY.md analysis history with today's date and summary. 7) Write the full daily report to invest/scripts/postclose_report.md. Include: market summary, long-term portfolio P&L table, day trading P&L, notable events, and tomorrow's plan." --output-file "%~dp0postclose_report.md" 2>> "%LOG_FILE%"

if errorlevel 1 (
    echo [%date% %time%] ERROR: claude command failed with exit code %errorlevel% >> "%LOG_FILE%"
    exit /b 1
)

echo [%date% %time%] Post-close report completed successfully. >> "%LOG_FILE%"
