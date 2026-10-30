"""Per-track MIDI file import for the editor API.

SMF parsing is adapted from the black-seq-songs skill (`midi_render.py`).
Notes are quantized to 16ths and applied into pattern track steps.
"""

from __future__ import annotations

import struct
from copy import deepcopy
from pathlib import Path

from blackseq.codec import (
    GATE_INDEX_OFFSET,
    GATE_OFFSET,
    NOTE_OFFSET,
    STEP_COUNT,
    TRACK_COUNT,
    apply_track_labels,
    set_step_note,
)


class MidiError(ValueError):
    pass


def sixteenths_per_bar(signature: tuple[int, int] | None) -> int | None:
    if signature is None:
        return None
    numerator, denominator_power = signature
    quarters = numerator * 4 / (2 ** denominator_power)
    steps = quarters * 4
    if steps != int(steps):
        return None
    return int(steps)


def parse_midi(data: bytes | Path) -> dict:
    """Parse a Standard MIDI File from bytes or a path.

    Each note is `(onset, span, note, channel)` with onset/span in 16th-note
    steps and channel in 1–16 from the status byte.
    """
    if isinstance(data, Path):
        label = str(data)
        data = data.read_bytes()
    else:
        label = "MIDI"
    if data[:4] != b"MThd":
        raise MidiError(f"{label} is not a MIDI file")
    header_len = int.from_bytes(data[4:8], "big")
    track_count = int.from_bytes(data[10:12], "big")
    division = int.from_bytes(data[12:14], "big")
    if division & 0x8000 or division < 4 or division % 4:
        raise MidiError(f"{label} has a division this converter cannot use ({division})")
    grid = division // 4
    position = 8 + header_len
    tracks = []
    tempos: list[int] = []
    signature = None
    for _ in range(track_count):
        if position + 8 > len(data) or data[position : position + 4] != b"MTrk":
            raise MidiError(f"{label} has a truncated or invalid track")
        length = int.from_bytes(data[position + 4 : position + 8], "big")
        body = data[position + 8 : position + 8 + length]
        if len(body) != length:
            raise MidiError(f"{label} has a truncated track")
        position += 8 + length
        tick = index = 0
        running = None
        name = ""
        active: dict[tuple[int, int], list[int]] = {}
        notes: list[tuple[int, int, int, int]] = []
        while index < len(body):
            delta = 0
            while True:
                byte = body[index]
                index += 1
                delta = (delta << 7) | (byte & 0x7F)
                if not byte & 0x80:
                    break
            tick += delta
            if index >= len(body):
                break
            status = body[index]
            if status < 0x80:
                status = running
            else:
                index += 1
                if status < 0xF0:
                    running = status
            if status is None:
                raise MidiError(f"{label} has a missing running status")
            if status == 0xFF:
                kind = body[index]
                index += 1
                size = 0
                while True:
                    byte = body[index]
                    index += 1
                    size = (size << 7) | (byte & 0x7F)
                    if not byte & 0x80:
                        break
                payload = body[index : index + size]
                index += size
                if kind == 0x03:
                    name = payload.decode("latin1", "replace")
                elif kind == 0x51 and len(payload) == 3:
                    tempos.append(int.from_bytes(payload, "big"))
                elif kind == 0x58 and len(payload) >= 2 and signature is None:
                    signature = (payload[0], payload[1])
                continue
            if status in (0xF0, 0xF7):
                size = 0
                while True:
                    byte = body[index]
                    index += 1
                    size = (size << 7) | (byte & 0x7F)
                    if not byte & 0x80:
                        break
                index += size
                continue
            kind = status & 0xF0
            channel = (status & 0x0F) + 1
            if kind in (0xC0, 0xD0):
                index += 1
                continue
            data1, data2 = body[index], body[index + 1]
            index += 2
            key = (channel, data1)
            if kind == 0x90 and data2:
                active.setdefault(key, []).append(tick)
            elif kind == 0x80 or (kind == 0x90 and not data2):
                stack = active.get(key)
                if stack:
                    start = stack.pop()
                    onset = int((start + grid // 2) // grid)
                    span = max(1, round((tick - start) / grid))
                    notes.append((onset, span, data1, channel))
        tracks.append({"name": name, "notes": notes})
    bpm = None
    if tempos:
        bpm = max(20, min(400, round(60_000_000 / tempos[0])))
    return {
        "division": division,
        "tempos": tempos,
        "bpm": bpm,
        "signature": signature,
        "bar_steps": sixteenths_per_bar(signature),
        "tracks": tracks,
    }


def inspect_midi(data: bytes) -> dict:
    """Summarize a MIDI file for the import UI."""
    parsed = parse_midi(data)
    tracks = []
    midi_channels: set[int] = set()
    for index, track in enumerate(parsed["tracks"]):
        channels = sorted({note[3] for note in track["notes"]})
        midi_channels.update(channels)
        tracks.append(
            {
                "index": index,
                "name": track["name"],
                "noteCount": len(track["notes"]),
                "channels": channels,
            }
        )
    return {
        "bpm": parsed["bpm"],
        "tracks": tracks,
        "midiChannels": sorted(midi_channels),
    }


def paint(channel: dict, start: int, length: int, note: int) -> None:
    """Write a held note as gate 10 on each step and gate 8 on the last."""
    end = start + max(0, length)
    for step in range(start, end):
        if step in channel:
            end = step
            break
    if end <= start:
        return
    for step in range(start, end):
        channel[step] = (note, 8 if step == end - 1 else 10)


def _note_cents(step: list[int]) -> int:
    return struct.unpack_from("<i", bytes(step), NOTE_OFFSET)[0]


def _clear_track_notes(steps: list[list[int]]) -> None:
    for step in steps:
        set_step_note(step, 0)
        step[GATE_OFFSET] = 0


def _mono_collapse(
    notes: list[tuple[int, int, int, int]], mono: str
) -> list[tuple[int, int, int]]:
    grouped: dict[int, list[tuple[int, int]]] = {}
    for onset, span, note, _channel in notes:
        if onset < 0 or onset >= STEP_COUNT:
            continue
        grouped.setdefault(onset, []).append((span, note))
    collapsed: list[tuple[int, int, int]] = []
    pick_high = mono != "low"
    for onset in sorted(grouped):
        chord = grouped[onset]
        chosen = max(note for _span, note in chord) if pick_high else min(note for _span, note in chord)
        span = max(span for span, pitched in chord if pitched == chosen)
        collapsed.append((onset, span, chosen))
    return collapsed


def _notes_for_source(parsed: dict, source: dict) -> list[tuple[int, int, int, int]]:
    if "track" in source and source["track"] is not None:
        index = int(source["track"])
        tracks = parsed["tracks"]
        if index < 0 or index >= len(tracks):
            raise MidiError(f"MIDI track {index} is out of range")
        return list(tracks[index]["notes"])
    if "channel" in source and source["channel"] is not None:
        channel = int(source["channel"])
        if not 1 <= channel <= 16:
            raise MidiError(f"MIDI channel must be 1–16, got {channel}")
        notes: list[tuple[int, int, int, int]] = []
        for track in parsed["tracks"]:
            notes.extend(note for note in track["notes"] if note[3] == channel)
        return notes
    raise MidiError("Each mapping entry needs a track or channel source")


def _source_for_channel(mapping: dict, channel: int) -> dict | None:
    if channel in mapping:
        source = mapping[channel]
    elif str(channel) in mapping:
        source = mapping[str(channel)]
    else:
        return None
    if source is None:
        return None
    if not isinstance(source, dict):
        raise MidiError(f"Mapping for CH{channel + 1} must be an object or null")
    return source


def _apply_painted(steps: list[list[int]], painted: dict, *, replace: bool) -> None:
    if replace:
        _clear_track_notes(steps)
    for step, item in painted.items():
        if not isinstance(item, tuple):
            continue
        if not 0 <= step < STEP_COUNT:
            continue
        note, gate_code = item
        if not replace and _note_cents(steps[step]):
            continue
        set_step_note(steps[step], int(note) * 100)
        steps[step][GATE_OFFSET] = min(100, int(gate_code) * 10)
        steps[step][GATE_INDEX_OFFSET] = 10


def import_map(
    pattern: dict,
    mapping: dict,
    *,
    data: bytes,
    replace: bool = True,
    mono: str = "high",
) -> dict:
    """Map MIDI tracks/channels onto pattern CH0–3 and return an updated copy.

    `mapping` keys are target channel indexes 0–3. Values are `{"track": i}`,
    `{"channel": 1-16}`, or null/omitted to skip. Notes beyond step 63 are dropped.
    """
    if mono not in ("high", "low"):
        raise MidiError('mono must be "high" or "low"')
    if not isinstance(mapping, dict):
        raise MidiError("mapping must be an object")
    tracks = pattern.get("tracks")
    if not isinstance(tracks, list) or len(tracks) != TRACK_COUNT:
        raise MidiError("pattern needs four tracks")

    parsed = parse_midi(data)
    updated = deepcopy(pattern)
    blocker = object()

    for channel in range(TRACK_COUNT):
        source = _source_for_channel(mapping, channel)
        if source is None:
            continue
        notes = _notes_for_source(parsed, source)
        collapsed = _mono_collapse(notes, mono)
        painted: dict = {}
        if not replace:
            for step, cell in enumerate(updated["tracks"][channel]["steps"]):
                if _note_cents(cell):
                    painted[step] = blocker
        for onset, span, note in collapsed:
            paint(painted, onset, span, note)
        _apply_painted(updated["tracks"][channel]["steps"], painted, replace=replace)

    return apply_track_labels(updated)
