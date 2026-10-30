"""Read and write Black Sequencer SD card files.

Patterns are a length-prefixed protobuf envelope around four raw track
blobs. Each track is a 4-byte CV, 64 steps of 34 bytes, and a 112-byte
footer. Saving rebuilds that envelope and keeps every byte the editor
does not explicitly change, so a load followed by a save is identical.
"""

from __future__ import annotations

import struct
from copy import deepcopy
from pathlib import Path

STEP_COUNT = 64
STEP_BYTES = 34
FOOTER_BYTES = 112
TRACK_COUNT = 4
NOTE_OFFSET = 30
GATE_OFFSET = 0
LEVEL_OFFSET = 29
GATE_INDEX_OFFSET = 5
FLAG_OFFSET = 6
ADSR_OFFSETS = (44, 48, 52, 56, 64)
LFO_RATE_OFFSET = 60
LFO_SHAPE_OFFSET = 68
LFO_LEVEL_OFFSET = 64
LFO_SYNC_OFFSET = 72
SCALE_MASK_OFFSET = 2
INPUT_SCALE_OFFSET = 77
OUTPUT_SCALE_OFFSET = 93
SCALE_NAME_LENGTH = 16
FLOAT_OFFSETS = (48, 52, 56, 60, 64)

SCHEMA = {
    "stepCount": STEP_COUNT,
    "stepBytes": STEP_BYTES,
    "footerBytes": FOOTER_BYTES,
    "trackCount": TRACK_COUNT,
    "noteOffset": NOTE_OFFSET,
    "gateOffset": GATE_OFFSET,
    "levelOffset": LEVEL_OFFSET,
    "gateIndexOffset": GATE_INDEX_OFFSET,
    "flagOffset": FLAG_OFFSET,
    "scaleMaskOffset": SCALE_MASK_OFFSET,
    "inputScaleOffset": INPUT_SCALE_OFFSET,
    "outputScaleOffset": OUTPUT_SCALE_OFFSET,
    "scaleNameLength": SCALE_NAME_LENGTH,
    "floatOffsets": list(FLOAT_OFFSETS),
    "adsrOffsets": list(ADSR_OFFSETS),
    "lfoRateOffset": LFO_RATE_OFFSET,
    "lfoShapeOffset": LFO_SHAPE_OFFSET,
    "lfoLevelOffset": LFO_LEVEL_OFFSET,
    "lfoSyncOffset": LFO_SYNC_OFFSET,
}

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
DATA_DIR = Path(__file__).resolve().parent / "data"


class FormatError(ValueError):
    """The file is not a Black Sequencer document this editor understands."""


def read_varint(data: bytes, index: int) -> tuple[int, int]:
    shift = 0
    value = 0
    while True:
        if index >= len(data):
            raise FormatError("Truncated varint")
        byte = data[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, index
        shift += 7
        if shift > 35:
            raise FormatError("Varint is too long")


def encode_varint(value: int) -> bytes:
    if value < 0:
        raise FormatError("Negative varint")
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def encode_key(field: int, wire: int) -> bytes:
    return encode_varint((field << 3) | wire)


def encode_bytes_field(field: int, blob: bytes) -> bytes:
    return encode_key(field, 2) + encode_varint(len(blob)) + blob


def encode_varint_field(field: int, value: int) -> bytes:
    return encode_key(field, 0) + encode_varint(value)


def frame(payload: bytes) -> bytes:
    return encode_varint(len(payload)) + payload


def unframe(data: bytes) -> bytes:
    length, index = read_varint(data, 0)
    payload = data[index : index + length]
    if len(payload) != length or index + length != len(data):
        raise FormatError(
            f"Length prefix {length} does not match file size {len(data)}"
        )
    return payload


def parse_fields(data: bytes) -> list[tuple[int, object]]:
    fields: list[tuple[int, object]] = []
    index = 0
    while index < len(data):
        key, index = read_varint(data, index)
        field, wire = key >> 3, key & 7
        if field == 0:
            raise FormatError("Protobuf field 0")
        if wire == 0:
            value, index = read_varint(data, index)
            fields.append((field, value))
        elif wire == 5:
            if index + 4 > len(data):
                raise FormatError("Truncated fixed32")
            fields.append((field, data[index : index + 4]))
            index += 4
        elif wire == 2:
            length, index = read_varint(data, index)
            if index + length > len(data):
                raise FormatError("Truncated length-delimited field")
            fields.append((field, data[index : index + length]))
            index += length
        else:
            raise FormatError(f"Unsupported protobuf wire type {wire}")
    return fields


def _i32(raw: bytes, offset: int) -> int:
    return struct.unpack_from("<i", raw, offset)[0]


def _u32(raw: bytes, offset: int) -> int:
    return struct.unpack_from("<I", raw, offset)[0]


def _u16(raw: bytes, offset: int) -> int:
    return struct.unpack_from("<H", raw, offset)[0]


def _f32(raw: bytes, offset: int) -> float:
    return struct.unpack_from("<f", raw, offset)[0]


def _cstring(raw: bytes, offset: int, length: int) -> str:
    chunk = bytes(raw[offset : offset + length])
    return chunk.split(b"\x00", 1)[0].decode("ascii", errors="replace")


def note_name(cents: int) -> str:
    """Name a pitch stored as MIDI-note cents. Zero is an empty step."""
    if cents == 0:
        return "—"
    semitone = cents // 100
    micro = cents - semitone * 100
    name = NOTE_NAMES[semitone % 12]
    octave = semitone // 12 - 1
    if micro == 0:
        return f"{name}{octave}"
    return f"{name}{octave} {micro:+d}c"


def step_view(raw: bytes) -> dict:
    return {
        "noteCents": _i32(raw, NOTE_OFFSET),
        "noteName": note_name(_i32(raw, NOTE_OFFSET)),
        "gate": raw[GATE_OFFSET],
        "level": raw[LEVEL_OFFSET],
        "gateIndex": raw[GATE_INDEX_OFFSET],
        "flag": raw[FLAG_OFFSET],
    }


def footer_view(raw: bytes) -> dict:
    return {
        "scaleMask": _u16(raw, SCALE_MASK_OFFSET),
        "inputScale": _cstring(raw, INPUT_SCALE_OFFSET, SCALE_NAME_LENGTH),
        "outputScale": _cstring(raw, OUTPUT_SCALE_OFFSET, SCALE_NAME_LENGTH),
        "floats": [_f32(raw, offset) for offset in FLOAT_OFFSETS],
    }


def parse_pattern(data: bytes) -> dict:
    payload = unframe(data)
    fields = parse_fields(payload)
    version = None
    field2 = None
    tracks = []
    for field, value in fields:
        if field == 1 and isinstance(value, int) and version is None:
            version = value
        elif field == 2 and isinstance(value, int) and field2 is None:
            field2 = value
        elif field == 3 and isinstance(value, bytes):
            tracks.append(_parse_track(value))
        else:
            raise FormatError(f"Unexpected pattern field {field}")
    if version is None or field2 is None or len(tracks) != TRACK_COUNT:
        raise FormatError("Pattern is missing its version, master length, or four tracks")
    return {"version": version, "field2": field2, "tracks": tracks}


def _parse_track(message: bytes) -> dict:
    fields = parse_fields(message)
    if len(fields) != 1 or fields[0][0] != 1 or not isinstance(fields[0][1], bytes):
        raise FormatError("Track message is not a single data blob")
    blob = fields[0][1]
    expected = 4 + STEP_COUNT * STEP_BYTES + FOOTER_BYTES
    if len(blob) != expected:
        raise FormatError(f"Track blob is {len(blob)} bytes, expected {expected}")
    cv = _i32(blob, 0)
    steps = [
        list(blob[4 + index * STEP_BYTES : 4 + (index + 1) * STEP_BYTES])
        for index in range(STEP_COUNT)
    ]
    footer = list(blob[4 + STEP_COUNT * STEP_BYTES :])
    return {
        "cvCents": cv,
        "steps": steps,
        "footer": footer,
        **footer_view(bytes(footer)),
        "stepInfo": [step_view(bytes(step)) for step in steps],
    }


def _bytes_of(values: list[int], size: int, label: str) -> bytes:
    if len(values) != size:
        raise FormatError(f"{label} must be {size} bytes, got {len(values)}")
    out = bytearray(size)
    for index, value in enumerate(values):
        if not isinstance(value, int) or not 0 <= value <= 255:
            raise FormatError(f"{label} byte {index} is out of range")
        out[index] = value
    return bytes(out)


def build_pattern(pattern: dict) -> bytes:
    version = pattern.get("version")
    field2 = pattern.get("field2")
    tracks = pattern.get("tracks")
    if not isinstance(version, int) or not isinstance(field2, int):
        raise FormatError("Pattern version is missing")
    if not isinstance(tracks, list) or len(tracks) != TRACK_COUNT:
        raise FormatError("A pattern needs four tracks")
    payload = encode_varint_field(1, version) + encode_varint_field(2, field2)
    for track in tracks:
        cv = track.get("cvCents")
        if not isinstance(cv, int) or not -2_147_483_648 <= cv <= 2_147_483_647:
            raise FormatError("Track CV is not a 32-bit value")
        steps = track.get("steps")
        if not isinstance(steps, list) or len(steps) != STEP_COUNT:
            raise FormatError("Each track needs 64 steps")
        footer = _bytes_of(track.get("footer", []), FOOTER_BYTES, "Footer")
        blob = struct.pack("<i", cv)
        for step in steps:
            blob += _bytes_of(step, STEP_BYTES, "Step")
        blob += footer
        payload += encode_bytes_field(3, encode_bytes_field(1, blob))
    return frame(payload)


def apply_track_labels(pattern: dict) -> dict:
    """Refresh derived names after the raw footer or steps change."""
    for track in pattern["tracks"]:
        footer = bytes(_bytes_of(track["footer"], FOOTER_BYTES, "Footer"))
        track.update(footer_view(footer))
        track["stepInfo"] = [step_view(bytes(step)) for step in track["steps"]]
    return pattern


def blank_pattern(template: bytes | None = None) -> dict:
    """Four empty tracks, using an unused factory track as the byte template.

    Step 64 is the channel length, not a pitch. Factory leaves byte 31 at 15,
    so the channel plays 16 steps. New patterns keep that until a longer
    pattern sets it.
    """
    if template is None:
        template = (DATA_DIR / "factory_pattern.seq").read_bytes()
    pattern = parse_pattern(template)
    empty = deepcopy(pattern["tracks"][2])
    for step in empty["steps"]:
        if _i32(bytes(step), NOTE_OFFSET) not in (0, 3840):
            set_step_note(step, 0)
    empty["cvCents"] = 0
    pattern["tracks"] = [deepcopy(empty) for _ in range(TRACK_COUNT)]
    return apply_track_labels(pattern)


def parse_project_info(data: bytes) -> dict:
    fields = parse_fields(unframe(data))
    bpm = None
    flag2 = None
    flag3 = None
    for field, value in fields:
        if field == 1 and isinstance(value, bytes) and len(value) == 4:
            bpm = struct.unpack("<f", value)[0]
        elif field == 2 and isinstance(value, int):
            flag2 = value
        elif field == 3 and isinstance(value, int):
            flag3 = value
        else:
            raise FormatError(f"Unexpected project field {field}")
    if bpm is None:
        raise FormatError("Project info is incomplete")
    return {"bpm": bpm, "flag2": flag2, "flag3": flag3}


def build_project_info(info: dict) -> bytes:
    bpm = float(info["bpm"])
    if not 20 <= bpm <= 400:
        raise FormatError("BPM must stay between 20 and 400")
    payload = encode_key(1, 5) + struct.pack("<f", bpm)
    if info.get("flag2") is not None:
        payload += encode_varint_field(2, int(info["flag2"]))
    if info.get("flag3") is not None:
        payload += encode_varint_field(3, int(info["flag3"]))
    return frame(payload)


def parse_song(data: bytes) -> dict:
    entries = []
    for field, value in parse_fields(unframe(data)):
        if field != 1 or not isinstance(value, bytes):
            raise FormatError("Unexpected song field")
        pattern = 0
        repeats = 1
        for inner, inner_value in parse_fields(value):
            if inner == 1 and isinstance(inner_value, int):
                pattern = inner_value
            elif inner == 2 and isinstance(inner_value, int):
                repeats = inner_value
            else:
                raise FormatError("Unexpected song entry field")
        entries.append({"pattern": pattern, "repeats": repeats})
    return {"entries": entries}


def build_song(song: dict) -> bytes:
    payload = b""
    entries = song.get("entries", [])
    if not isinstance(entries, list) or len(entries) > 64:
        raise FormatError("A song can hold up to 64 entries")
    for entry in entries:
        pattern = int(entry["pattern"])
        repeats = int(entry["repeats"])
        if not 0 <= pattern <= 15 or not 1 <= repeats <= 64:
            raise FormatError("Song entries use patterns 0–15 and 1–64 repeats")
        body = b""
        if pattern:
            body += encode_varint_field(1, pattern)
        body += encode_varint_field(2, repeats)
        payload += encode_bytes_field(1, body)
    return frame(payload)


def parse_scales(data: bytes) -> list[dict]:
    scales = []
    for field, value in parse_fields(unframe(data)):
        if field != 1 or not isinstance(value, bytes):
            raise FormatError("Unexpected scale field")
        name = ""
        mask = None
        for inner, inner_value in parse_fields(value):
            if inner == 1 and isinstance(inner_value, bytes):
                name = inner_value.decode("ascii", errors="replace")
            elif inner == 2 and isinstance(inner_value, int):
                mask = inner_value
            elif inner == 3 and isinstance(inner_value, bytes):
                continue
            else:
                raise FormatError("Unexpected scale entry field")
        scales.append({"name": name, "mask": mask if mask is not None else 0xFFF})
    return scales


def write_scale_name(footer: bytearray, offset: int, name: str) -> None:
    encoded = name.encode("ascii", errors="strict")
    if len(encoded) > SCALE_NAME_LENGTH:
        raise FormatError(f"Scale name is longer than {SCALE_NAME_LENGTH} characters")
    footer[offset : offset + SCALE_NAME_LENGTH] = b"\x00" * SCALE_NAME_LENGTH
    footer[offset : offset + len(encoded)] = encoded


def set_input_scale(footer: list[int], name: str, mask: int) -> list[int]:
    raw = bytearray(_bytes_of(footer, FOOTER_BYTES, "Footer"))
    write_scale_name(raw, INPUT_SCALE_OFFSET, name)
    struct.pack_into("<H", raw, SCALE_MASK_OFFSET, mask & 0xFFFF)
    return list(raw)


def set_output_scale(footer: list[int], name: str) -> list[int]:
    raw = bytearray(_bytes_of(footer, FOOTER_BYTES, "Footer"))
    write_scale_name(raw, OUTPUT_SCALE_OFFSET, name)
    return list(raw)


def set_step_note(step: list[int], cents: int) -> None:
    raw = bytearray(_bytes_of(step, STEP_BYTES, "Step"))
    struct.pack_into("<i", raw, NOTE_OFFSET, int(cents))
    step[:] = list(raw)


def set_step_u32(step: list[int], offset: int, value: int) -> None:
    raw = bytearray(_bytes_of(step, STEP_BYTES, "Step"))
    struct.pack_into("<I", raw, offset, int(value) & 0xFFFFFFFF)
    step[:] = list(raw)
