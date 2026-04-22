#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv_path="${repo_root}/.venv-docling"
python_exe="${venv_path}/bin/python"

if [[ ! -d "${venv_path}" ]]; then
  python3 -m venv "${venv_path}"
fi

"${python_exe}" -m pip install --upgrade pip
"${python_exe}" -m pip install -r "${repo_root}/requirements-docling.txt" --extra-index-url https://download.pytorch.org/whl/cpu

echo
echo "Docling CPU environment is ready."
echo "Interpreter: ${python_exe}"
echo "Set DOCLING_PYTHON to this path if you want to pin it explicitly."
