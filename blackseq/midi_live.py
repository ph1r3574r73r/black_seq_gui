"""Server-side MIDI input via python-rtmidi (packaging-friendly)."""

from __future__ import annotations

import json
import queue
import threading
import time
from typing import Iterator

_lock = threading.Lock()
_events: queue.Queue[dict] = queue.Queue(maxsize=512)
_selected: str | None = None
_midi_in = None
_available = False

try:
    import rtmidi  # type: ignore

    _available = True
except Exception:
    rtmidi = None  # type: ignore


class MidiLiveError(ValueError):
    pass


def _push(event: dict) -> None:
    try:
        _events.put_nowait(event)
    except queue.Full:
        try:
            _events.get_nowait()
        except queue.Empty:
            pass
        try:
            _events.put_nowait(event)
        except queue.Full:
            pass


def _callback(message, _data) -> None:
    payload, _delta = message
    if not payload:
        return
    status = payload[0] & 0xF0
    channel = (payload[0] & 0x0F) + 1
    if status == 0x90 and len(payload) >= 3:
        note, velocity = payload[1], payload[2]
        if velocity:
            _push({"type": "noteon", "channel": channel, "note": note, "velocity": velocity})
        else:
            _push({"type": "noteoff", "channel": channel, "note": note, "velocity": 0})
    elif status == 0x80 and len(payload) >= 3:
        _push({"type": "noteoff", "channel": channel, "note": payload[1], "velocity": payload[2]})
    elif status == 0xB0 and len(payload) >= 3:
        _push({"type": "cc", "channel": channel, "controller": payload[1], "value": payload[2]})


def _port_names() -> list[str]:
    if not _available or rtmidi is None:
        return []
    probe = rtmidi.MidiIn()
    try:
        return [probe.get_port_name(index) for index in range(probe.get_port_count())]
    finally:
        del probe


def list_devices() -> dict:
    global _selected
    names = _port_names()
    with _lock:
        selected = _selected
        if selected and selected not in names:
            selected = _selected = None
            _close_unlocked()
        auto = False
        if selected is None and len(names) == 1:
            auto = True
            chosen = names[0]
        else:
            chosen = selected
    if auto:
        return select_device(chosen)
    return {
        "available": _available,
        "devices": names,
        "selected": chosen,
    }


def _close_unlocked() -> None:
    global _midi_in, _selected
    if _midi_in is not None:
        try:
            _midi_in.close_port()
        except Exception:
            pass
        _midi_in = None
    _selected = None


def select_device(name: str | None) -> dict:
    global _selected, _midi_in
    with _lock:
        _close_unlocked()
        if not name:
            return {
                "available": _available,
                "devices": _port_names(),
                "selected": None,
            }
        if not _available or rtmidi is None:
            raise MidiLiveError("python-rtmidi is not installed")
        midi_in = rtmidi.MidiIn()
        names = [midi_in.get_port_name(index) for index in range(midi_in.get_port_count())]
        if name not in names:
            del midi_in
            raise MidiLiveError(f"MIDI device not found: {name}")
        midi_in.open_port(names.index(name))
        midi_in.set_callback(_callback)
        midi_in.ignore_types(sysex=True, timing=True, active_sense=True)
        _midi_in = midi_in
        _selected = name
        return {
            "available": _available,
            "devices": names,
            "selected": name,
        }


def event_stream() -> Iterator[bytes]:
    """Yield SSE chunks forever (or until the client disconnects)."""
    yield b": midi stream\n\n"
    while True:
        try:
            event = _events.get(timeout=15.0)
            payload = json.dumps(event, separators=(",", ":")).encode("utf-8")
            yield b"data: " + payload + b"\n\n"
        except queue.Empty:
            yield b": ping\n\n"
        time.sleep(0)
