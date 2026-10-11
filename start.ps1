param (
    [switch]$Seed
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Tactical Pulse - Windows Startup      " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"

# 1. Check Python
$pythonCmd = "python"
try {
    $pyVer = & $pythonCmd --version
    Write-Host "✓ Using Python: $pyVer" -ForegroundColor Green
} catch {
    Write-Host "❌ Error: Python is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

# 2. Setup .env if missing
$envFile = Join-Path $BackendDir ".env"
$envExample = Join-Path $BackendDir ".env.example"
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
    Write-Host "⚙️ Creating backend/.env from .env.example..." -ForegroundColor Yellow
    Copy-Item $envExample $envFile
}

# 3. Setup virtual environment if missing
$venvDir = Join-Path $BackendDir ".venv"
if (-not (Test-Path $venvDir)) {
    Write-Host "📦 Creating Python virtual environment (.venv)..." -ForegroundColor Yellow
    & $pythonCmd -m venv $venvDir
}

# 4. Pip install requirements
$pythonVenv = Join-Path $venvDir "Scripts\python.exe"
$pipVenv = Join-Path $venvDir "Scripts\pip.exe"
Write-Host "📥 Installing/verifying dependencies..." -ForegroundColor Yellow
& $pipVenv install -q -r (Join-Path $BackendDir "requirements.txt")

# 5. Optional database seeding
if ($Seed) {
    Write-Host "🌱 Seeding database..." -ForegroundColor Yellow
    Push-Location $BackendDir
    try {
        & $pythonVenv "app/db/seed.py"
    } finally {
        Pop-Location
    }
}

# 6. Start Uvicorn Server
Write-Host "🚀 Starting Tactical Pulse Backend on http://localhost:8000..." -ForegroundColor Green
Write-Host "   API Docs:   http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "   Socket.IO:  http://localhost:8000/socket.io" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Push-Location $BackendDir
try {
    & $pythonVenv -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
} finally {
    Pop-Location
}
