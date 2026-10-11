#!/usr/bin/env bash
set -e

# Colors for terminal output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Tactical Pulse - One-Command Startup  ${NC}"
echo -e "${BLUE}========================================${NC}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

# 1. Check for Python 3
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
else
    echo -e "${RED}❌ Error: Python 3 is not installed or not in PATH.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Using Python: $($PYTHON_CMD --version)${NC}"

# 2. Setup .env if missing
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo -e "${YELLOW}⚙️  Creating backend/.env from .env.example...${NC}"
    cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi

# 3. Setup virtual environment if missing
cd "$BACKEND_DIR"
if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}📦 Creating Python virtual environment (.venv)...${NC}"
    $PYTHON_CMD -m venv .venv
fi

# 4. Activate virtual environment & install requirements
source .venv/bin/activate
echo -e "${YELLOW}📥 Installing/verifying dependencies...${NC}"
pip install -q -r requirements.txt

# 5. Optional database seeding
if [ "$1" == "--seed" ]; then
    echo -e "${YELLOW}🌱 Seeding Supabase database...${NC}"
    python app/db/seed.py
fi

# 6. Start Uvicorn Server
echo -e "${GREEN}🚀 Starting Tactical Pulse Backend on http://localhost:8000...${NC}"
echo -e "${BLUE}   API Docs:   http://localhost:8000/docs${NC}"
echo -e "${BLUE}   Socket.IO:  http://localhost:8000/socket.io${NC}"
echo -e "${BLUE}========================================${NC}"
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
