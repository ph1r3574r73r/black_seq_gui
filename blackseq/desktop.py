"""Native window shell around the local editor server (macOS / Linux / Windows)."""

from __future__ import annotations

import threading


def run_desktop() -> None:
    try:
        import webview
    except ImportError as exc:
        raise SystemExit(
            "Desktop mode needs pywebview. Install with:\n"
            "  python3 -m pip install -r requirements.txt"
        ) from exc

    from .paths import APP_NAME
    from .server import create_server

    server, url = create_server()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"{APP_NAME} desktop at {url}")
    try:
        webview.create_window(APP_NAME, url, width=1440, height=900, min_size=(960, 640))
        webview.start()
    finally:
        server.shutdown()
        server.server_close()
