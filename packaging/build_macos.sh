#!/usr/bin/env bash
# Build Black Sequencer.app on macOS (must run on a Mac).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 -m pip install -r requirements.txt 'pyinstaller>=6.0'
rm -rf build dist/BlackSequencer dist/"Black Sequencer.app" dist/BlackSequencer-macOS.zip
python3 -m PyInstaller --noconfirm packaging/blackseq.spec

# Zip for GitHub Releases (ditto preserves macOS metadata better than zip).
ditto -c -k --sequesterRsrc --keepParent \
  "$ROOT/dist/Black Sequencer.app" \
  "$ROOT/dist/BlackSequencer-macOS.zip"

echo
echo "Built: $ROOT/dist/Black Sequencer.app"
echo "Zip:   $ROOT/dist/BlackSequencer-macOS.zip"
echo "Open with: open \"$ROOT/dist/Black Sequencer.app\""
echo "Attach the zip to a GitHub Release so the Pages download button can find it."
