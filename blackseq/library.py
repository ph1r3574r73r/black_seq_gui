"""SD card project tree for the Black Sequencer."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

from .cardmap import apply_performance, decode_performance
from .codec import (
    FormatError,
    blank_pattern,
    build_pattern,
    build_project_info,
    build_song,
    parse_pattern,
    parse_project_info,
    parse_scales,
    parse_song,
)
from .paths import bundled_studio, resource_root, studio_root

BANK_RE = re.compile(r"^(?:0\d|1[0-5])$")
SLOT_RE = re.compile(r"^(?:0\d|1[0-5])\.(?:SEQ|SNG)$")
_NEW_NAME = re.compile(r"^[A-Z]+(?: [A-Z]+)*$")

DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_CARD = Path("/Volumes/NO NAME")


class LibraryError(ValueError):
    pass


def ensure_studio() -> Path:
    """A card-shaped folder on this computer. It does not need the SD card."""
    root = studio_root()
    seed = bundled_studio()
    (root / "PROJECTS").mkdir(parents=True, exist_ok=True)
    # Desktop builds seed DEMO BANK + factory racks from the app bundle once.
    demo = root / "PROJECTS" / "DEMO BANK"
    seed_demo = seed / "PROJECTS" / "DEMO BANK"
    if not demo.is_dir() and seed_demo.is_dir() and seed.resolve() != root.resolve():
        shutil.copytree(seed_demo, demo)
    seed_default = seed / "RACKS.default.json"
    local_default = root / "RACKS.default.json"
    if not local_default.is_file() and seed_default.is_file():
        shutil.copy(seed_default, local_default)
    system = root / "SYSTEM"
    system.mkdir(exist_ok=True)
    scales = system / "SCALES.DAT"
    if not scales.is_file():
        seed_scales = seed / "SYSTEM" / "SCALES.DAT"
        card_scales = DEFAULT_CARD / "SYSTEM" / "SCALES.DAT"
        fixture = resource_root() / "tests" / "fixtures" / "SCALES.DAT"
        source = (
            seed_scales if seed_scales.is_file()
            else card_scales if card_scales.is_file()
            else fixture if fixture.is_file()
            else None
        )
        if source is not None:
            shutil.copy(source, scales)
    racks = root / "RACKS.json"
    if not racks.is_file() and local_default.is_file():
        shutil.copy(local_default, racks)
    return root.resolve()


# Back-compat for anything that still imports STUDIO_ROOT.
STUDIO_ROOT = studio_root()


_SYSTEM_VOLUMES = {"Recovery", "Preboot", "VM", "Update"}


def list_drives() -> list[dict]:
    """Volumes the card menu can offer. The startup disk stays out of the list."""
    volumes = Path("/Volumes")
    if not volumes.is_dir():
        return []
    drives = []
    for entry in sorted(volumes.iterdir(), key=lambda item: item.name.lower()):
        if entry.name.startswith(".") or entry.name.startswith("com.apple."):
            continue
        try:
            if not entry.is_dir() or entry.samefile(Path("/")):
                continue
        except OSError:
            continue
        projects = (entry / "PROJECTS").is_dir()
        if entry.name in _SYSTEM_VOLUMES and not projects:
            continue
        drives.append({"name": entry.name, "path": str(entry), "projects": projects})
    return drives


def choose_card(drives: list[dict], preferred: str = "") -> str:
    """Use the drive the user picked. With one sequencer card and no pick, use that."""
    if preferred:
        try:
            wanted = Path(preferred).resolve()
        except OSError:
            wanted = None
        for drive in drives:
            try:
                if drive["path"] == preferred or (wanted and Path(drive["path"]).resolve() == wanted):
                    return drive["path"]
            except OSError:
                continue
        return ""
    ready = [drive["path"] for drive in drives if drive.get("projects")]
    if len(ready) == 1:
        return ready[0]
    return ""


def describe_places(preferred: str | None = None) -> dict:
    """None lets one connected card be chosen. An empty string means the user cleared it."""
    drives = list_drives()
    if preferred is None:
        card = choose_card(drives)
    elif preferred:
        card = choose_card(drives, preferred)
    else:
        card = ""
    return {
        "studio": str(ensure_studio()),
        "card": card,
        "drives": drives,
    }


def _ignore_editor_junk(_directory: str, names: list[str]) -> list[str]:
    return [name for name in names if name.endswith(".bak") or name.endswith(".tmp")]


def clean_project_name(name: object) -> str:
    """A name the sequencer can type: capital letters and single spaces, 1–16 characters."""
    if not isinstance(name, str):
        raise LibraryError("Use capital letters and spaces, up to 16 characters")
    cleaned = " ".join(name.strip().upper().split())
    if not cleaned or len(cleaned) > 16 or not _NEW_NAME.fullmatch(cleaned):
        raise LibraryError("Use capital letters and spaces, up to 16 characters")
    return cleaned


def name_is_legal(name: str) -> bool:
    return bool(_NEW_NAME.fullmatch(name) and len(name) <= 16)


def _project_ref(name: object) -> str:
    """Folder name of a project that may already be on disk, including older names."""
    if not isinstance(name, str) or name != Path(name).name or name in {"", ".", ".."}:
        raise LibraryError("Invalid project name")
    return name


def _places_for(root: Path) -> list[Path]:
    """Studio and every connected sequencer card share one set of names."""
    root = root.resolve()
    studio = ensure_studio()
    places = [studio]
    for drive in list_drives():
        if not drive["projects"]:
            continue
        path = Path(drive["path"]).resolve()
        if not any(_same_dir(path, place) for place in places):
            places.append(path)
    if any(_same_dir(root, place) for place in places):
        return places
    return [root]


def _same_dir(left: Path, right: Path) -> bool:
    try:
        return left.samefile(right)
    except OSError:
        return False


def name_taken(name: str, roots: list[Path], keep: Path | None = None) -> bool:
    wanted = name.upper()
    for place in roots:
        folder = place / "PROJECTS"
        if not folder.is_dir():
            continue
        for entry in folder.iterdir():
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            if keep is not None and _same_dir(entry, keep):
                continue
            if entry.name.upper() == wanted:
                return True
    return False


def _name_taken(root: Path, name: str, keep: Path | None = None) -> bool:
    return name_taken(name, _places_for(root), keep)


def transfer_project(source: Path, destination: Path, name: str, mode: object) -> dict:
    """Move one project between the studio and the card. A name exists in one place."""
    if mode != "move":
        raise LibraryError("Move the project, or duplicate it under a new name")
    source = source.expanduser().resolve()
    destination = destination.expanduser().resolve()
    if source == destination:
        raise LibraryError("Choose the other library")
    project = _project_dir(source, name)
    _kept(project.name)
    if name_taken(project.name, [destination]):
        raise LibraryError("That name is already used")
    target = inside(destination, "PROJECTS", project.name)
    try:
        shutil.copytree(project, target, ignore=_ignore_editor_junk)
    except Exception:
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
        raise
    shutil.rmtree(project)
    return {"name": project.name, "mode": mode, "root": str(destination.resolve())}


def resolve_root(root: str) -> Path:
    path = Path(root).expanduser()
    if not path.is_dir():
        raise LibraryError(f"SD card folder was not found: {root}")
    resolved = path.resolve()
    if not (resolved / "PROJECTS").is_dir():
        raise LibraryError("That folder has no PROJECTS directory")
    return resolved


def _component(name: str, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(name, str) or not pattern.fullmatch(name):
        raise LibraryError(f"Invalid {label}")
    return name


def inside(root: Path, *parts: str) -> Path:
    current = root
    for part in parts:
        if part != Path(part).name or part in {"", ".", ".."}:
            raise LibraryError("Invalid path")
        current = current / part
    resolved = current.resolve()
    if resolved != root and root not in resolved.parents:
        raise LibraryError("Path leaves the SD card")
    return resolved


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_name(path.name + ".bak")
        backup.write_bytes(path.read_bytes())
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def _read(path: Path) -> bytes:
    if not path.is_file():
        raise LibraryError(f"Missing file: {path.name}")
    return path.read_bytes()


def list_library(root: Path) -> dict:
    projects = []
    project_dir = inside(root, "PROJECTS")
    for entry in sorted(project_dir.iterdir(), key=lambda item: item.name):
        if not entry.is_dir() or entry.name.startswith("."):
            continue
        info_path = entry / "INFO.DAT"
        info = (
            parse_project_info(info_path.read_bytes())
            if info_path.is_file()
            else {"bpm": 120.0, "flag2": 1, "flag3": 2}
        )
        labels = _song_labels(entry)
        banks = []
        for bank in sorted(entry.iterdir(), key=lambda item: item.name):
            if not bank.is_dir() or not BANK_RE.fullmatch(bank.name):
                continue
            patterns = sorted(
                item.name for item in bank.iterdir() if item.is_file() and item.suffix == ".SEQ"
            )
            songs = sorted(
                item.name for item in bank.iterdir() if item.is_file() and item.suffix == ".SNG"
            )
            names = {
                key.split("/", 1)[1]: name
                for key, name in labels.items()
                if key.startswith(f"{bank.name}/")
            }
            banks.append({"id": bank.name, "patterns": patterns, "songs": songs, "songNames": names})
        projects.append({
            "name": entry.name,
            "legal": name_is_legal(entry.name),
            "info": info,
            "banks": banks,
        })
    scales_path = root / "SYSTEM" / "SCALES.DAT"
    scales = parse_scales(scales_path.read_bytes()) if scales_path.is_file() else []
    return {"root": str(root), "projects": projects, "scales": scales}


def read_pattern(root: Path, project: str, bank: str, slot: str) -> dict:
    path = _pattern_path(root, project, bank, slot)
    try:
        pattern = parse_pattern(_read(path))
    except FormatError as exc:
        raise LibraryError(str(exc)) from exc
    pattern["file"] = path.name
    for track in pattern["tracks"]:
        track["performance"] = decode_performance(track)
    stored = read_editor_performance(root, project, bank, slot)
    if stored:
        for track, saved in zip(pattern["tracks"], stored):
            for key in ("direction", "first", "root"):
                if isinstance(saved, dict) and key in saved:
                    track["performance"][key] = saved[key]
    return pattern


def write_pattern(root: Path, project: str, bank: str, slot: str, pattern: dict, performance=None) -> dict:
    path = _pattern_path(root, project, bank, slot, create_bank=True)
    if performance is not None:
        apply_performance(pattern, performance)
    try:
        data = build_pattern(pattern)
        parse_pattern(data)
    except FormatError as exc:
        raise LibraryError(str(exc)) from exc
    _atomic_write(path, data)
    return {"path": str(path), "bytes": len(data)}


def create_pattern(root: Path, project: str, bank: str, slot: str) -> dict:
    path = _pattern_path(root, project, bank, slot, create_bank=True)
    if path.exists():
        raise LibraryError("That pattern already exists")
    pattern = blank_pattern()
    _atomic_write(path, build_pattern(pattern))
    pattern["file"] = path.name
    for track in pattern["tracks"]:
        track["performance"] = decode_performance(track)
    return pattern


def read_song(root: Path, project: str, bank: str, slot: str) -> dict:
    path = _song_path(root, project, bank, slot)
    if not path.is_file():
        return {"entries": [], "file": path.name}
    try:
        song = parse_song(path.read_bytes())
    except FormatError as exc:
        raise LibraryError(str(exc)) from exc
    song["file"] = path.name
    return song


def write_song(root: Path, project: str, bank: str, slot: str, song: dict) -> dict:
    path = _song_path(root, project, bank, slot, create_bank=True)
    try:
        data = build_song(song)
        parse_song(data)
    except FormatError as exc:
        raise LibraryError(str(exc)) from exc
    _atomic_write(path, data)
    return {"path": str(path), "bytes": len(data)}


_SONG_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _.'-]{0,23}\Z")


def clean_song_name(name: object) -> str:
    """A display name. The module itself only knows the song's slot number."""
    if not isinstance(name, str):
        raise LibraryError("Song name is invalid")
    text = " ".join(name.split())
    if text and _SONG_NAME.fullmatch(text) is None:
        raise LibraryError("Use letters, numbers, spaces, and . ' - _ , up to 24 characters")
    return text


def name_song(root: Path, project: str, bank: str, slot: str, name: object) -> dict:
    bank = _component(bank, BANK_RE, "bank")
    slot = _component(slot, SLOT_RE, "song")
    if not slot.endswith(".SNG"):
        raise LibraryError("Invalid song")
    text = clean_song_name(name)
    document = _read_editor_document(root, project)
    key = f"{bank}/{slot}"
    if text:
        document["songs"][key] = text
    else:
        document["songs"].pop(key, None)
    _write_editor_document(root, project, document)
    return {"slot": slot, "name": text}


def delete_song(root: Path, project: str, bank: str, slot: str) -> dict:
    path = _song_path(root, project, bank, slot)
    if not path.is_file():
        raise LibraryError("That song has no file")
    path.unlink()
    backup = path.with_name(path.name + ".bak")
    if backup.is_file():
        backup.unlink()
    document = _read_editor_document(root, project)
    if document["songs"].pop(f"{bank}/{slot}", None):
        _write_editor_document(root, project, document)
    return {"slot": slot}


def move_song(root: Path, project: str, bank: str, slot: str, target: str) -> dict:
    source = _song_path(root, project, bank, slot)
    destination = _song_path(root, project, bank, target)
    if not source.is_file():
        raise LibraryError("That song has no file")
    if source == destination:
        raise LibraryError("Choose a different song slot")
    if destination.exists():
        raise LibraryError("That song slot already has a file")
    source.rename(destination)
    _retarget_song_name(root, project, bank, slot, destination.name)
    return {"slot": destination.name}


def duplicate_song(root: Path, project: str, bank: str, slot: str, target: str | None = None) -> dict:
    source = _song_path(root, project, bank, slot)
    if not source.is_file():
        raise LibraryError("That song has no file")
    bank_dir = source.parent
    if target:
        destination = _song_path(root, project, bank, target)
        if destination.exists():
            raise LibraryError("That song slot already has a file")
    else:
        free = _free_song_slot(bank_dir, source.name)
        if free is None:
            raise LibraryError("Every song slot in this bank already has a file")
        destination = bank_dir / free
    destination.write_bytes(source.read_bytes())
    document = _read_editor_document(root, project)
    current = document["songs"].get(f"{bank}/{slot}", "")
    copy_name = _copy_song_name(current)
    if copy_name:
        document["songs"][f"{bank}/{destination.name}"] = copy_name
        _write_editor_document(root, project, document)
    return {"slot": destination.name, "name": copy_name}


def create_project(root: Path, name: str) -> dict:
    """Create a project folder, tempo file, bank 00, and an empty pattern."""
    name = clean_project_name(name)
    if _name_taken(root, name):
        raise LibraryError("That name is already used")
    project_dir = inside(root, "PROJECTS", name)
    if project_dir.exists():
        raise LibraryError("That name is already used")
    project_dir.mkdir()
    try:
        info = {"bpm": 120.0, "flag2": 1, "flag3": 2}
        (project_dir / "INFO.DAT").write_bytes(build_project_info(info))
        bank_dir = project_dir / "00"
        bank_dir.mkdir()
        bank_template = DATA_DIR / "bank.dat"
        if bank_template.is_file():
            (bank_dir / "BANK.DAT").write_bytes(bank_template.read_bytes())
        (bank_dir / "00.SEQ").write_bytes(build_pattern(blank_pattern()))
    except Exception:
        shutil.rmtree(project_dir, ignore_errors=True)
        raise
    return {"name": name, "info": info}


_KEPT_PROJECTS = {"FACTORY"}


def _project_dir(root: Path, name: str) -> Path:
    name = _project_ref(name)
    path = inside(root, "PROJECTS", name)
    if not path.is_dir():
        raise LibraryError("Project was not found")
    return path


def _kept(name: str) -> None:
    if name in _KEPT_PROJECTS:
        raise LibraryError("FACTORY stays on the card")


def rename_project(root: Path, name: str, new_name: object) -> dict:
    source = _project_dir(root, name)
    _kept(source.name)
    target_name = clean_project_name(new_name)
    if target_name == source.name:
        return {"name": source.name}
    if _name_taken(root, target_name, keep=source):
        raise LibraryError("That name is already used")
    destination = inside(root, "PROJECTS", target_name)
    if destination.exists() and _same_dir(destination, source):
        bridge = source.with_name(f".{source.name}.rename")
        if bridge.exists():
            raise LibraryError("Could not rename that project")
        source.rename(bridge)
        try:
            bridge.rename(destination)
        except Exception:
            if bridge.exists() and not source.exists():
                bridge.rename(source)
            raise
        return {"name": target_name}
    if destination.exists():
        raise LibraryError("That name is already used")
    source.rename(destination)
    return {"name": target_name}


def delete_project(root: Path, name: str) -> dict:
    path = _project_dir(root, name)
    _kept(path.name)
    shutil.rmtree(path)
    return {"name": path.name}


def duplicate_project(root: Path, name: str, new_name: object) -> dict:
    source = _project_dir(root, name)
    target_name = clean_project_name(new_name)
    if target_name.upper() == source.name.upper():
        raise LibraryError("Type a different name")
    if _name_taken(root, target_name):
        raise LibraryError("That name is already used")
    destination = inside(root, "PROJECTS", target_name)
    if destination.exists():
        raise LibraryError("That name is already used")
    try:
        shutil.copytree(source, destination)
    except Exception:
        if destination.exists():
            shutil.rmtree(destination, ignore_errors=True)
        raise
    return {"name": target_name}


def write_project_info(root: Path, project: str, info: dict) -> dict:
    project = _project_ref(project)
    path = inside(root, "PROJECTS", project, "INFO.DAT")
    if not path.parent.is_dir():
        raise LibraryError("Project was not found")
    try:
        data = build_project_info(info)
        saved = parse_project_info(data)
    except FormatError as exc:
        raise LibraryError(str(exc)) from exc
    _atomic_write(path, data)
    return saved


def _ensure_bank(root: Path, project: str, bank: str) -> Path:
    project = _project_ref(project)
    bank = _component(bank, BANK_RE, "bank")
    project_dir = inside(root, "PROJECTS", project)
    if not project_dir.is_dir():
        raise LibraryError("Project was not found")
    bank_dir = inside(root, "PROJECTS", project, bank)
    if not bank_dir.is_dir():
        bank_dir.mkdir(parents=True)
        template = DATA_DIR / "bank.dat"
        if template.is_file():
            (bank_dir / "BANK.DAT").write_bytes(template.read_bytes())
    return bank_dir


def _pattern_path(
    root: Path, project: str, bank: str, slot: str, create_bank: bool = False
) -> Path:
    slot = _component(slot, SLOT_RE, "pattern")
    if not slot.endswith(".SEQ"):
        raise LibraryError("Invalid pattern")
    if create_bank:
        bank_dir = _ensure_bank(root, project, bank)
        return bank_dir / slot
    project = _project_ref(project)
    bank = _component(bank, BANK_RE, "bank")
    return inside(root, "PROJECTS", project, bank, slot)


def _song_path(
    root: Path, project: str, bank: str, slot: str, create_bank: bool = False
) -> Path:
    slot = _component(slot, SLOT_RE, "song")
    if not slot.endswith(".SNG"):
        raise LibraryError("Invalid song")
    if create_bank:
        return _ensure_bank(root, project, bank) / slot
    project = _project_ref(project)
    bank = _component(bank, BANK_RE, "bank")
    return inside(root, "PROJECTS", project, bank, slot)


EDITOR_FILE = "EDITOR.json"
_EDITOR_LIMIT = 512_000
_DIRECTIONS = {"forward", "backward", "pingpong", "pingpong-ends", "random"}
_PROBABILITY = {
    "Always", "1/8", "1/7", "1/6", "1/5", "1/4", "1/3", "1/2", "2/3", "3/4", "7/8",
    "10%", "25%", "50%", "75%", "90%",
}
_MODES = {"stepped", "slide", "notes", "decay", "asr", "adsr", "lfo", "step-lfo", "triggers"}
_WAVES = {
    "Sine", "Triangle", "Saw up", "Saw down", "Square",
    "Ramp up", "Ramp down", "Triple decay saw", "Random", "Noise",
}
_SHUFFLE = {"off", "+", "−", "-"}


def _editor_path(root: Path, project: str) -> Path:
    project = _project_ref(project)
    folder = inside(root, "PROJECTS", project)
    if not folder.is_dir():
        raise LibraryError("Project was not found")
    return folder / EDITOR_FILE


def _bounded(value: object, low: float, high: float, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise LibraryError(f"{label} is not a number")
    number = float(value)
    if number < low or number > high:
        raise LibraryError(f"{label} is out of range")
    return number


def _series(values: object, low: float, high: float, label: str, size: int = 64) -> list[float]:
    if not isinstance(values, list) or len(values) != size:
        raise LibraryError(f"{label} needs {size} steps")
    return [_bounded(item, low, high, label) for item in values]


def _choice(value: object, allowed: set[str], label: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise LibraryError(f"{label} is not a known value")
    return value


def _arp_step(value: object) -> str:
    if not isinstance(value, str) or len(value) < 2 or len(value) > 24:
        raise LibraryError("Arp is not a known value")
    sign = "−" if value[0] == "-" else value[0]
    if sign not in {"+", "−"}:
        raise LibraryError("Arp is not a known value")
    name = value[1:]
    if not name.isascii() or not name.replace(" ", "").replace("_", "").replace("-", "").isalnum():
        raise LibraryError("Arp is not a known value")
    return f"{sign}{name}"


def clean_editor_track(track: object) -> dict:
    """Check editor lanes before they are written back into a pattern."""
    if not isinstance(track, dict):
        raise LibraryError("Performance track is invalid")
    probability = track.get("probability", ["Always"] * 64)
    if not isinstance(probability, list) or len(probability) != 64:
        raise LibraryError("Probability needs 64 steps")
    merges = track.get("repeatMerge", [False] * 64)
    if not isinstance(merges, list) or len(merges) != 64 or any(not isinstance(item, bool) for item in merges):
        raise LibraryError("Repeat hold needs 64 steps")
    shuffle = track.get("shuffleStep", ["+", "+", "+", "+"])
    if not isinstance(shuffle, list) or len(shuffle) != 4:
        raise LibraryError("Shuffle needs four steps")
    arp = track.get("arp", ["Off"] * 64)
    waves = track.get("wave", ["Sine"] * 64)
    triggers = track.get("triggers", [True, *([False] * 63)])
    if not isinstance(arp, list) or len(arp) != 64:
        raise LibraryError("Arp needs 64 steps")
    if not isinstance(waves, list) or len(waves) != 64:
        raise LibraryError("Wave needs 64 steps")
    if not isinstance(triggers, list) or len(triggers) != 64 or any(not isinstance(item, bool) for item in triggers):
        raise LibraryError("Triggers need 64 steps")
    root = track.get("root")
    if root is not None:
        root = int(_bounded(root, 0, 11, "Root"))
    return {
        "direction": _choice(track.get("direction", "forward"), _DIRECTIONS, "Direction"),
        "first": int(_bounded(track.get("first", 1), 1, 64, "First step")),
        "last": int(_bounded(track.get("last", 64), 1, 64, "Last step")),
        "root": root,
        "probability": [_choice(item, _PROBABILITY, "Probability") for item in probability],
        "ratchet": [int(item) for item in _series(track.get("ratchet", [0] * 64), 0, 8, "Ratchet")],
        "repeat": [int(item) for item in _series(track.get("repeat", [0] * 64), 0, 8, "Repeat")],
        "repeatMerge": list(merges),
        "glideMaster": _bounded(track.get("glideMaster", 0), 0, 100, "Glide"),
        "glide": _series(track.get("glide", [0] * 64), 0, 100, "Glide"),
        "shuffle": _bounded(track.get("shuffle", 0), 0, 100, "Shuffle"),
        "shuffleStep": [_choice(item if item != "-" else "−", _SHUFFLE, "Shuffle step") for item in shuffle],
        "timing": [int(item) for item in _series(track.get("timing", [0] * 64), -50, 50, "Timing")],
        "arp": ["Off" if item == "Off" else _arp_step(item) for item in arp],
        "modMode": _choice(track.get("modMode", "stepped"), _MODES, "Modulation"),
        "modVolt": _series(track.get("modVolt", [0] * 64), -100, 100, "Modulation voltage"),
        "modNote": [int(item) for item in _series(track.get("modNote", [0] * 64), -20000, 20000, "Modulation note")],
        "decay": _series(track.get("decay", [0] * 64), 0, 100, "Decay"),
        "release": _series(track.get("release", [0] * 64), 0, 100, "Release"),
        "wave": [_choice(item, _WAVES, "Wave") for item in waves],
        "triggers": list(triggers),
        "lfoLevel": _series(track.get("lfoLevel", [0] * 64), 0, 5, "LFO level"),
    }


def clean_editor_performance(tracks: object) -> list[dict]:
    if not isinstance(tracks, list) or len(tracks) != 4:
        raise LibraryError("Performance needs four tracks")
    return [clean_editor_track(track) for track in tracks]


def read_editor_performance(root: Path, project: str, bank: str, slot: str) -> list[dict] | None:
    bank = _component(bank, BANK_RE, "bank")
    slot = _component(slot, SLOT_RE, "pattern")
    if not slot.endswith(".SEQ"):
        return None
    try:
        path = _editor_path(root, project)
    except LibraryError:
        return None
    if not path.is_file() or path.stat().st_size > _EDITOR_LIMIT:
        return None
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        stored = document.get("patterns", {}).get(f"{bank}/{slot}")
        if stored is None:
            return None
        return clean_editor_performance(stored)
    except (OSError, json.JSONDecodeError, LibraryError, AttributeError, TypeError):
        return None


def _read_editor_document(root: Path, project: str) -> dict:
    document: dict = {"version": 1, "patterns": {}, "songs": {}}
    try:
        path = _editor_path(root, project)
    except LibraryError:
        return document
    if not path.is_file() or path.stat().st_size > _EDITOR_LIMIT:
        return document
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return document
    if not isinstance(current, dict):
        return document
    patterns = current.get("patterns")
    if isinstance(patterns, dict):
        document["patterns"] = {
            key: value
            for key, value in patterns.items()
            if isinstance(key, str) and len(key) <= 16
        }
    document["songs"] = _clean_stored_songs(current.get("songs"))
    return document


def _write_editor_document(root: Path, project: str, document: dict) -> None:
    payload = json.dumps(
        {"version": 1, "patterns": document.get("patterns", {}), "songs": document.get("songs", {})},
        separators=(",", ":"),
    ).encode("utf-8")
    if len(payload) > _EDITOR_LIMIT:
        raise LibraryError("Editor data is too large")
    _write_editor_document_bytes(root, project, payload)


def _write_editor_document_bytes(root: Path, project: str, payload: bytes) -> None:
    path = _editor_path(root, project)
    _atomic_write(path, payload)


def _clean_stored_songs(songs: object) -> dict[str, str]:
    if not isinstance(songs, dict):
        return {}
    cleaned = {}
    for key, value in songs.items():
        if not isinstance(key, str) or key.count("/") != 1:
            continue
        bank, slot = key.split("/", 1)
        if BANK_RE.fullmatch(bank) is None or SLOT_RE.fullmatch(slot) is None or not slot.endswith(".SNG"):
            continue
        try:
            name = clean_song_name(value)
        except LibraryError:
            continue
        if name:
            cleaned[key] = name
    return cleaned


def _song_labels(project_dir: Path) -> dict[str, str]:
    path = project_dir / EDITOR_FILE
    if not path.is_file() or path.stat().st_size > _EDITOR_LIMIT:
        return {}
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(current, dict):
        return {}
    return _clean_stored_songs(current.get("songs"))


def _free_song_slot(bank_dir: Path, current: str) -> str | None:
    for index in range(16):
        name = f"{index:02d}.SNG"
        if name != current and not (bank_dir / name).exists():
            return name
    return None


def _copy_song_name(name: str) -> str:
    if not name:
        return ""
    candidate = f"{name} copy"
    if len(candidate) <= 24 and _SONG_NAME.fullmatch(candidate):
        return candidate
    return name


def _retarget_song_name(root: Path, project: str, bank: str, slot: str, target: str) -> None:
    document = _read_editor_document(root, project)
    name = document["songs"].pop(f"{bank}/{slot}", "")
    if not name:
        return
    document["songs"][f"{bank}/{target}"] = name
    _write_editor_document(root, project, document)


def write_editor_performance(root: Path, project: str, bank: str, slot: str, tracks: object) -> None:
    bank = _component(bank, BANK_RE, "bank")
    slot = _component(slot, SLOT_RE, "pattern")
    if not slot.endswith(".SEQ"):
        raise LibraryError("Invalid pattern")
    cleaned = clean_editor_performance(tracks)
    document = _read_editor_document(root, project)
    document["patterns"][f"{bank}/{slot}"] = cleaned
    _write_editor_document(root, project, document)
