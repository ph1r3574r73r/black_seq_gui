# PyInstaller spec — build on macOS for Black Sequencer.app
# Usage: from repo root, ./packaging/build_macos.sh
# (or: pip install -r requirements.txt pyinstaller && pyinstaller packaging/blackseq.spec)

import sys
from pathlib import Path

# SPECPATH is the folder containing this .spec (packaging/), so parent is the repo root.
ROOT = Path(SPECPATH).resolve().parent
sys.path.insert(0, str(ROOT))

from PyInstaller.utils.hooks import collect_all

block_cipher = None

datas = [
    (str(ROOT / "web"), "web"),
    (str(ROOT / "studio" / "PROJECTS" / "DEMO BANK"), "studio/PROJECTS/DEMO BANK"),
    (str(ROOT / "studio" / "SYSTEM"), "studio/SYSTEM"),
    # Destination is the folder; PyInstaller keeps the filename.
    (str(ROOT / "studio" / "RACKS.default.json"), "studio"),
    (str(ROOT / "blackseq" / "data"), "blackseq/data"),
]

hiddenimports = ["rtmidi", "webview"]
binaries = []
tmp_ret = collect_all("webview")
datas += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]

a = Analysis(
    [str(ROOT / "packaging" / "desktop_main.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="BlackSequencer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=True,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="BlackSequencer",
)

app = BUNDLE(
    coll,
    name="Black Sequencer.app",
    icon=None,
    bundle_identifier="lv.ericasynths.blackseq.editor",
    info_plist={
        "CFBundleName": "Black Sequencer",
        "CFBundleDisplayName": "Black Sequencer",
        "CFBundleShortVersionString": "0.2.0",
        "CFBundleVersion": "0.2.0",
        "NSHighResolutionCapable": True,
        "NSMicrophoneUsageDescription": "Optional audio input is unused; playback uses system audio.",
    },
)
