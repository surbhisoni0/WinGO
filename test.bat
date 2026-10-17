@echo off
cd /d "%~dp0"
call backend\.venv\Scripts\activate
set PYTHONPATH=backend
python -m unittest discover -s tests -v
