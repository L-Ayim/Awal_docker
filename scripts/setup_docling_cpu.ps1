$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$VenvPath = Join-Path $RepoRoot ".venv-docling"
$PythonExe = Join-Path $VenvPath "Scripts\\python.exe"
$RequirementsPath = Join-Path $RepoRoot "requirements-docling.txt"

if (-not (Test-Path $VenvPath)) {
  python -m venv $VenvPath
}

& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r $RequirementsPath --extra-index-url https://download.pytorch.org/whl/cpu

Write-Host ""
Write-Host "Docling CPU environment is ready."
Write-Host "Interpreter: $PythonExe"
Write-Host "Set DOCLING_PYTHON to this path if you want to pin it explicitly."
