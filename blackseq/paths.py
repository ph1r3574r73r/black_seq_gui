"""Resolve web + studio paths for dev and frozen desktop builds."""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "Black Sequencer"
APP_DIR_NAME = "BlackSequencer"


def frozen() -> bool:
    return bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))


def resource_root() -> Path:
    """Read-only assets: repo root in dev, PyInstaller bundle when frozen."""
    if frozen():
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def web_dir() -> Path:
    return resource_root() / "web"


def bundled_studio() -> Path:
    return resource_root() / "studio"


def user_data_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / APP_DIR_NAME
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", home / "AppData" / "Roaming"))
        return base / APP_DIR_NAME
    return home / ".local" / "share" / APP_DIR_NAME


def studio_root() -> Path:
    """Writable studio tree. Dev uses repo/studio; desktop uses Application Support."""
    if frozen():
        return user_data_dir() / "studio"
    return resource_root() / "studio"
