@echo off
REM One-time setup for Windows. Double-click, or run from the VS Code terminal:  setup.bat
cd /d "%~dp0backend"
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
if not exist .venv (
  echo Creating virtual environment...
  %PY% -m venv .venv || (echo Python 3.10+ is required. Install it from python.org and tick "Add to PATH". & exit /b 1)
)
call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt || exit /b 1
if not exist .env copy .env.example .env >nul
echo.
echo Setup finished. Start the app with run.bat
