#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VENV_DIR=".venv"

if [ -f "$VENV_DIR/Scripts/python.exe" ]; then
  PYTHON="$VENV_DIR/Scripts/python.exe"
elif [ -f "$VENV_DIR/bin/python" ]; then
  PYTHON="$VENV_DIR/bin/python"
else
  echo "[run] venv not found at $VENV_DIR"
  echo "      python -m venv .venv"
  echo "      .venv/Scripts/pip install -r requirements.txt   (Windows)"
  echo "      .venv/bin/pip install -r requirements.txt        (Linux/Mac)"
  exit 1
fi

MODE="${1:-all}"

case "$MODE" in
  train)
    "$PYTHON" train_sentiment.py
    ;;
  export)
    "$PYTHON" export_onnx.py
    ;;
  all)
    "$PYTHON" train_sentiment.py
    "$PYTHON" export_onnx.py
    ;;
  *)
    echo "Usage: $0 {train|export|all}"
    exit 1
    ;;
esac
