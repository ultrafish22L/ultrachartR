@echo off
REM Pre-Market Check — runs at 4:00 AM HST (9:00 AM ET)
REM Checks futures, overnight news, confirms day trade plan

cd /d C:\ultrafish\ultrachart

claude -p "You are my investment analyzer. Read invest/MEMORY.md for full context. It is PRE-MARKET. Do the following: 1) Search the web for S&P 500 futures, VIX, gold, and any overnight news that affects our portfolios. 2) Read invest/PORTFOLIO_DAYTRADE.md for queued trades and confirm or adjust the day trade plan based on pre-market conditions. 3) Check for any earnings reports today. 4) Write a brief pre-market note to invest/scripts/premarket_report.md with today's date, key levels, and trade plan. Keep it concise." --output-file "C:\ultrafish\ultrachart\invest\scripts\premarket_report.md" 2>&1
