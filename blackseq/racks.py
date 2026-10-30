"""Rack patches live on this computer, next to the studio, never on the card.

A song is remembered by its project name and its bank and slot. Moving the
project to the sequencer does not take the patch with it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .library import LibraryError, _atomic_write, ensure_studio

_SONG = re.compile(r"^(?:0\d|1[0-5])\.SNG$")
_BANK = re.compile(r"^(?:0\d|1[0-5])$")
_TOKEN = re.compile(r"^[A-Za-z0-9_]{1,40}$")
_PRESET = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,23}$")
_FILE = "RACKS.json"
_LIMIT = 2_000_000


def _folder(folder: Path | None) -> Path:
    return folder if folder is not None else ensure_studio()


def _path(folder: Path | None) -> Path:
    return _folder(folder) / _FILE


def _project_name(name: object) -> str:
    if not isinstance(name, str) or name != Path(name).name or name in {"", ".", ".."} or name.startswith("."):
        raise LibraryError("Invalid project name")
    if len(name) > 64:
        raise LibraryError("Invalid project name")
    return name


def _song_key(bank: object, slot: object) -> str:
    if not isinstance(bank, str) or _BANK.fullmatch(bank) is None:
        raise LibraryError("Invalid bank")
    if not isinstance(slot, str) or _SONG.fullmatch(slot) is None:
        raise LibraryError("Invalid song")
    return f"{bank}/{slot}"


def _number(value: object, low: float, high: float, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise LibraryError(f"{label} is not a number")
    number = float(value)
    if number < low or number > high:
        raise LibraryError(f"{label} is out of range")
    return number


def clean_rack(rack: object) -> dict:
    if not isinstance(rack, dict):
        raise LibraryError("Rack patch is invalid")
    modules = rack.get("modules")
    cables = rack.get("cables")
    if not isinstance(modules, list) or not modules or len(modules) > 40:
        raise LibraryError("Rack patch is invalid")
    if not isinstance(cables, list) or len(cables) > 160:
        raise LibraryError("Rack patch is invalid")
    cleaned_modules = []
    ids: set[int] = set()
    for module in modules:
        if not isinstance(module, dict):
            raise LibraryError("Rack patch is invalid")
        module_id = int(_number(module.get("id"), 0, 10000, "Module"))
        if module_id in ids:
            raise LibraryError("Rack patch is invalid")
        ids.add(module_id)
        module_type = module.get("type")
        if not isinstance(module_type, str) or _TOKEN.fullmatch(module_type) is None:
            raise LibraryError("Rack patch is invalid")
        params = module.get("params") or {}
        if not isinstance(params, dict) or len(params) > 48:
            raise LibraryError("Rack patch is invalid")
        cleaned_params = {}
        for key, value in params.items():
            if not isinstance(key, str) or _TOKEN.fullmatch(key) is None:
                raise LibraryError("Rack patch is invalid")
            cleaned_params[key] = _number(value, -100, 10000, "Parameter")
        cleaned_modules.append({
            "id": module_id,
            "type": module_type,
            "x": int(_number(module.get("x", 0), 0, 200, "Module position")),
            "y": int(_number(module.get("y", 0), 0, 8, "Module position")),
            "params": cleaned_params,
        })
    if not any(module["type"] == "black_seq" for module in cleaned_modules):
        raise LibraryError("Rack patch is invalid")
    cleaned_cables = []
    for cable in cables:
        if not isinstance(cable, dict):
            raise LibraryError("Rack patch is invalid")
        source = cable.get("from")
        dest = cable.get("to")
        if not isinstance(source, dict) or not isinstance(dest, dict):
            raise LibraryError("Rack patch is invalid")
        from_id = int(_number(source.get("module"), 0, 10000, "Cable"))
        to_id = int(_number(dest.get("module"), 0, 10000, "Cable"))
        from_port = source.get("port")
        to_port = dest.get("port")
        if from_id not in ids or to_id not in ids:
            raise LibraryError("Rack patch is invalid")
        if not isinstance(from_port, str) or not isinstance(to_port, str):
            raise LibraryError("Rack patch is invalid")
        if _TOKEN.fullmatch(from_port) is None or _TOKEN.fullmatch(to_port) is None:
            raise LibraryError("Rack patch is invalid")
        cleaned_cables.append({
            "id": int(_number(cable.get("id"), 0, 10000, "Cable")),
            "from": {"module": from_id, "port": from_port},
            "to": {"module": to_id, "port": to_port},
        })
    return {
        "version": 4,
        "modules": cleaned_modules,
        "cables": cleaned_cables,
        "nextModule": int(_number(rack.get("nextModule", 1), 1, 10001, "Rack")),
        "nextCable": int(_number(rack.get("nextCable", 1), 1, 10001, "Rack")),
    }


def _read(folder: Path | None) -> dict:
    path = _path(folder)
    if not path.is_file() or path.stat().st_size > _LIMIT:
        return {"version": 1, "projects": {}, "presets": {}}
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "projects": {}, "presets": {}}
    projects = document.get("projects") if isinstance(document, dict) else None
    presets = document.get("presets") if isinstance(document, dict) else None
    if not isinstance(projects, dict):
        projects = {}
    if not isinstance(presets, dict):
        presets = {}
    return {"version": 1, "projects": projects, "presets": presets}


def _write(document: dict, folder: Path | None) -> None:
    document = {
        "version": 1,
        "projects": document.get("projects") or {},
        "presets": document.get("presets") or {},
    }
    payload = json.dumps(document, separators=(",", ":")).encode("utf-8")
    if len(payload) > _LIMIT:
        raise LibraryError("Rack patches are too large")
    _atomic_write(_path(folder), payload)


def read_song_rack(project: str, bank: str, slot: str, folder: Path | None = None) -> dict | None:
    key = _song_key(bank, slot)
    stored = _read(folder)["projects"].get(_project_name(project), {})
    if not isinstance(stored, dict):
        return None
    rack = stored.get(key)
    if rack is None:
        return None
    try:
        return clean_rack(rack)
    except LibraryError:
        return None


def write_song_rack(project: str, bank: str, slot: str, rack: object, folder: Path | None = None) -> dict:
    name = _project_name(project)
    key = _song_key(bank, slot)
    cleaned = clean_rack(rack)
    document = _read(folder)
    songs = document["projects"].get(name)
    if not isinstance(songs, dict):
        songs = {}
    songs[key] = cleaned
    document["projects"][name] = songs
    _write(document, folder)
    return {"project": name, "song": key}


def rename_project_racks(old: str, new: str, folder: Path | None = None) -> None:
    source = _project_name(old)
    target = _project_name(new)
    if source == target:
        return
    document = _read(folder)
    songs = document["projects"].pop(source, None)
    if songs is None:
        return
    document["projects"][target] = songs
    _write(document, folder)


def duplicate_project_racks(old: str, new: str, folder: Path | None = None) -> None:
    source = _project_name(old)
    target = _project_name(new)
    document = _read(folder)
    songs = document["projects"].get(source)
    if not isinstance(songs, dict):
        return
    document["projects"][target] = json.loads(json.dumps(songs))
    _write(document, folder)


def delete_project_racks(project: str, folder: Path | None = None) -> None:
    document = _read(folder)
    if document["projects"].pop(_project_name(project), None) is None:
        return
    _write(document, folder)


def duplicate_song_rack(project: str, bank: str, slot: str, target: str, folder: Path | None = None) -> None:
    name = _project_name(project)
    source_key = _song_key(bank, slot)
    target_key = _song_key(bank, target)
    document = _read(folder)
    songs = document["projects"].get(name)
    if not isinstance(songs, dict) or source_key not in songs:
        return
    songs[target_key] = json.loads(json.dumps(songs[source_key]))
    _write(document, folder)


def move_song_rack(project: str, bank: str, slot: str, target: str, folder: Path | None = None) -> None:
    name = _project_name(project)
    source_key = _song_key(bank, slot)
    target_key = _song_key(bank, target)
    if source_key == target_key:
        return
    document = _read(folder)
    songs = document["projects"].get(name)
    if not isinstance(songs, dict) or source_key not in songs:
        return
    songs[target_key] = songs.pop(source_key)
    _write(document, folder)


def _preset_name(name: object) -> str:
    if not isinstance(name, str) or _PRESET.fullmatch(name) is None:
        raise LibraryError("Preset name is invalid")
    return name


def list_presets(folder: Path | None = None) -> dict:
    """Named patches shared by every project. Each one keeps knobs, buttons, and cables."""
    stored = _read(folder)["presets"]
    presets = {}
    for name, rack in stored.items():
        try:
            presets[_preset_name(name)] = clean_rack(rack)
        except LibraryError:
            continue
    return presets


def write_preset(name: object, rack: object, folder: Path | None = None) -> dict:
    label = _preset_name(name)
    cleaned = clean_rack(rack)
    document = _read(folder)
    document["presets"][label] = cleaned
    _write(document, folder)
    return {"name": label}


def delete_preset(name: object, folder: Path | None = None) -> None:
    label = _preset_name(name)
    document = _read(folder)
    if document["presets"].pop(label, None) is None:
        return
    _write(document, folder)


def delete_song_rack(project: str, bank: str, slot: str, folder: Path | None = None) -> None:
    name = _project_name(project)
    key = _song_key(bank, slot)
    document = _read(folder)
    songs = document["projects"].get(name)
    if not isinstance(songs, dict) or songs.pop(key, None) is None:
        return
    if not songs:
        document["projects"].pop(name, None)
    _write(document, folder)
