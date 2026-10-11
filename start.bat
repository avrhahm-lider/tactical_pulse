@echo off
setlocal

echo ========================================
echo   Tactical Pulse - Windows Startup (CMD)
echo ========================================

cd /d "%~dp0backend"

if not exist ".env" (
    if exist ".env.example" (
        echo Copying .env.example to .env...
        copy .env.example .env
    )
)

if not exist ".venv" (
    echo Creating virtual environment...
    python -m venv .venv
)

echo Installing dependencies...
call .venv\Scripts\pip.exe install -q -r requirements.txt

if "%1"=="--seed" (
    echo Seeding database...
    call .venv\Scripts\python.exe app\db\seed.py
)

echo Starting Tactical Pulse Backend on http://localhost:8000...
call .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
