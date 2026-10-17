@echo off
REM Starts the app at http://localhost:8000
cd /d "%~dp0backend"
if not exist .venv (echo Run setup.bat first. & exit /b 1)
call .venv\Scripts\activate
start "" http://localhost:8000
uvicorn app.main:app --reload
