"""Local editor server. Binds to localhost and serves the SD card API."""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .codec import SCHEMA
from .racks import (
    delete_project_racks,
    delete_song_rack,
    duplicate_project_racks,
    duplicate_song_rack,
    move_song_rack,
    delete_preset,
    list_presets,
    read_song_rack,
    rename_project_racks,
    write_preset,
    write_song_rack,
)
from .library import (
    LibraryError,
    clean_editor_performance,
    create_pattern,
    create_project,
    delete_project,
    duplicate_project,
    describe_places,
    ensure_studio,
    list_library,
    read_pattern,
    read_song,
    rename_project,
    resolve_root,
    delete_song,
    duplicate_song,
    move_song,
    name_song,
    write_editor_performance,
    transfer_project,
    write_pattern,
    write_project_info,
    write_song,
)
from .midi_import import MidiError, import_map, inspect_midi
from .paths import web_dir
import base64

WEB_DIR = web_dir()
HOST = "127.0.0.1"
PORT = 8765


def _query(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    parsed = urlparse(handler.path)
    values = parse_qs(parsed.query)
    return {key: items[0] for key, items in values.items() if items}


def _require(data: dict, *keys: str) -> None:
    missing = [key for key in keys if key not in data]
    if missing:
        raise LibraryError("Missing " + ", ".join(missing))


def _body(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > 8_000_000:
        raise LibraryError("Missing request body")
    raw = handler.rfile.read(length)
    try:
        data = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise LibraryError("Request is not JSON") from exc
    if not isinstance(data, dict):
        raise LibraryError("Request must be a JSON object")
    return data


def _midi_bytes(data: dict) -> bytes:
    encoded = data.get("midi")
    if not isinstance(encoded, str) or not encoded:
        raise LibraryError("Missing midi")
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise LibraryError("midi must be base64") from exc


class EditorHandler(BaseHTTPRequestHandler):
    server_version = "BlackSeqEditor/0.2"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._api_get(parsed.path)
            return
        self._static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        routes = {
            "/api/pattern": self._save_pattern,
            "/api/pattern/new": self._new_pattern,
            "/api/song": self._save_song,
            "/api/song/name": self._name_song,
            "/api/song/delete": self._delete_song,
            "/api/song/move": self._move_song,
            "/api/song/duplicate": self._duplicate_song,
            "/api/project": self._save_project,
            "/api/project/new": self._new_project,
            "/api/project/rename": self._rename_project,
            "/api/project/delete": self._delete_project,
            "/api/project/duplicate": self._duplicate_project,
            "/api/project/transfer": self._transfer_project,
            "/api/rack": self._save_rack,
            "/api/preset": self._save_preset,
            "/api/preset/delete": self._delete_preset,
            "/api/midi/inspect": self._midi_inspect,
            "/api/midi/import": self._midi_import,
            "/api/midi/devices": self._midi_devices,
            "/api/midi/select": self._midi_select,
        }
        handler = routes.get(parsed.path)
        if handler is None:
            self._send_json(404, {"error": "Unknown API"})
            return
        try:
            handler()
        except LibraryError as exc:
            self._send_json(400, {"error": str(exc)})
        except MidiError as exc:
            self._send_json(400, {"error": str(exc)})
        except Exception as exc:
            from .midi_live import MidiLiveError
            if isinstance(exc, MidiLiveError):
                self._send_json(400, {"error": str(exc)})
            else:
                raise

    def _api_get(self, path: str) -> None:
        try:
            if path == "/api/schema":
                self._send_json(200, SCHEMA)
                return
            if path == "/api/places":
                values = parse_qs(urlparse(self.path).query, keep_blank_values=True)
                preferred = values["card"][0] if "card" in values else None
                self._send_json(200, describe_places(preferred))
                return
            query = _query(self)
            if path == "/api/rack":
                self._send_json(200, {"rack": read_song_rack(query.get("project", ""), query.get("bank", ""), query.get("slot", ""))})
                return
            if path == "/api/presets":
                self._send_json(200, {"presets": list_presets()})
                return
            if path == "/api/midi/devices":
                from . import midi_live
                self._send_json(200, midi_live.list_devices())
                return
            if path == "/api/midi/events":
                self._midi_events()
                return
            root = resolve_root(query.get("root", ""))
            if path == "/api/library":
                self._send_json(200, list_library(root))
                return
            project, bank = query.get("project", ""), query.get("bank", "")
            slot = query.get("slot", "")
            if path == "/api/pattern":
                self._send_json(200, read_pattern(root, project, bank, slot))
                return
            if path == "/api/song":
                self._send_json(200, read_song(root, project, bank, slot))
                return
            self._send_json(404, {"error": "Unknown API"})
        except LibraryError as exc:
            self._send_json(400, {"error": str(exc)})

    def _save_pattern(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "bank", "slot", "pattern")
        root = resolve_root(data["root"])
        performance = data.get("performance")
        if performance is not None:
            performance = clean_editor_performance(performance)
        result = write_pattern(
            root, data["project"], data["bank"], data["slot"], data["pattern"], performance
        )
        if performance is not None:
            write_editor_performance(root, data["project"], data["bank"], data["slot"], performance)
        self._send_json(200, result)

    def _new_pattern(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "bank", "slot")
        root = resolve_root(data["root"])
        pattern = create_pattern(root, data["project"], data["bank"], data["slot"])
        self._send_json(200, pattern)

    def _save_song(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "bank", "slot", "song")
        root = resolve_root(data["root"])
        result = write_song(root, data["project"], data["bank"], data["slot"], data["song"])
        self._send_json(200, result)

    def _name_song(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "bank", "slot", "name")
        root = resolve_root(data["root"])
        self._send_json(200, name_song(root, data["project"], data["bank"], data["slot"], data["name"]))

    def _delete_song(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "bank", "slot")
        root = resolve_root(data["root"])
        result = delete_song(root, data["project"], data["bank"], data["slot"])
        delete_song_rack(data["project"], data["bank"], data["slot"])
        self._send_json(200, result)

    def _move_song(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "bank", "slot", "target")
        root = resolve_root(data["root"])
        result = move_song(root, data["project"], data["bank"], data["slot"], data["target"])
        move_song_rack(data["project"], data["bank"], data["slot"], result["slot"])
        self._send_json(200, result)

    def _duplicate_song(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "bank", "slot")
        root = resolve_root(data["root"])
        target = data.get("target")
        result = duplicate_song(root, data["project"], data["bank"], data["slot"], target)
        duplicate_song_rack(data["project"], data["bank"], data["slot"], result["slot"])
        self._send_json(200, result)

    def _new_project(self) -> None:
        data = _body(self)
        _require(data, "root", "name")
        root = resolve_root(data["root"])
        self._send_json(200, create_project(root, data["name"]))

    def _rename_project(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "name")
        root = resolve_root(data["root"])
        result = rename_project(root, data["project"], data["name"])
        if result["name"] != data["project"]:
            rename_project_racks(data["project"], result["name"])
        self._send_json(200, result)

    def _delete_project(self) -> None:
        data = _body(self)
        _require(data, "root", "project")
        root = resolve_root(data["root"])
        result = delete_project(root, data["project"])
        delete_project_racks(result["name"])
        self._send_json(200, result)

    def _duplicate_project(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "name")
        root = resolve_root(data["root"])
        result = duplicate_project(root, data["project"], data["name"])
        duplicate_project_racks(data["project"], result["name"])
        self._send_json(200, result)

    def _transfer_project(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "destination", "mode")
        source = resolve_root(data["root"])
        destination = resolve_root(data["destination"])
        self._send_json(200, transfer_project(source, destination, data["project"], data["mode"]))

    def _save_rack(self) -> None:
        data = _body(self)
        _require(data, "project", "bank", "slot", "rack")
        self._send_json(200, write_song_rack(data["project"], data["bank"], data["slot"], data["rack"]))

    def _save_preset(self) -> None:
        data = _body(self)
        _require(data, "name", "rack")
        self._send_json(200, write_preset(data["name"], data["rack"]))

    def _delete_preset(self) -> None:
        data = _body(self)
        _require(data, "name")
        delete_preset(data["name"])
        self._send_json(200, {"name": data["name"]})

    def _midi_inspect(self) -> None:
        data = _body(self)
        self._send_json(200, inspect_midi(_midi_bytes(data)))

    def _midi_import(self) -> None:
        data = _body(self)
        _require(data, "pattern", "mapping")
        pattern = data["pattern"]
        if not isinstance(pattern, dict):
            raise LibraryError("pattern must be an object")
        mapping = data["mapping"]
        if not isinstance(mapping, dict):
            raise LibraryError("mapping must be an object")
        replace = bool(data.get("replace", True))
        mono = str(data.get("mono", "high"))
        updated = import_map(pattern, mapping, data=_midi_bytes(data), replace=replace, mono=mono)
        self._send_json(200, {"pattern": updated})

    def _midi_devices(self) -> None:
        from . import midi_live
        self._send_json(200, midi_live.list_devices())

    def _midi_select(self) -> None:
        from . import midi_live
        data = _body(self)
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            raise LibraryError("name must be a string or null")
        self._send_json(200, midi_live.select_device(name))

    def _midi_events(self) -> None:
        from . import midi_live
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            for chunk in midi_live.event_stream():
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return

    def _save_project(self) -> None:
        data = _body(self)
        _require(data, "root", "project", "info")
        root = resolve_root(data["root"])
        result = write_project_info(root, data["project"], data["info"])
        self._send_json(200, result)

    def _static(self, path: str) -> None:
        relative = "index.html" if path in {"", "/"} else path.lstrip("/")
        if relative.startswith("api/") or ".." in relative.split("/"):
            self._send_json(404, {"error": "Not found"})
            return
        file_path = (WEB_DIR / relative).resolve()
        if WEB_DIR.resolve() not in file_path.parents and file_path != WEB_DIR.resolve():
            self._send_json(404, {"error": "Not found"})
            return
        if not file_path.is_file():
            self._send_json(404, {"error": "Not found"})
            return
        mime, _ = mimetypes.guess_type(file_path.name)
        if file_path.suffix == ".wasm":
            mime = "application/wasm"
        payload = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def create_server() -> tuple[ThreadingHTTPServer, str]:
    ensure_studio()
    # Refresh static root in case paths were set after import (frozen builds).
    global WEB_DIR
    WEB_DIR = web_dir()
    server = ThreadingHTTPServer((HOST, PORT), EditorHandler)
    return server, f"http://{HOST}:{PORT}"


def main() -> None:
    import argparse
    import threading
    import webbrowser

    parser = argparse.ArgumentParser(description="Black Sequencer local editor")
    parser.add_argument("--open", action="store_true", help="Open the UI in the default browser")
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="Open a native window (pywebview) instead of only serving HTTP",
    )
    args = parser.parse_args()

    if args.desktop:
        from .desktop import run_desktop

        run_desktop()
        return

    server, url = create_server()
    print(f"Black Sequencer editor at {url}")
    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped")
    finally:
        server.server_close()
