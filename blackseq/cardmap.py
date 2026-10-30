"""Translate confirmed Black Sequencer bytes into editor lanes.

Unmapped bytes stay untouched. A lane is written only when its value
differs from what the file already decodes to, so a load followed by a
save keeps the pattern identical.
"""

from __future__ import annotations

import struct

MODES = ("stepped", "slide", "notes", "decay", "asr", "adsr", "lfo", "step-lfo", "triggers")
WAVES = ("Sine", "Triangle", "Saw up", "Saw down", "Square")
MAJOR = (4, 7, 12, 16, 19, 24, 28)
PROBABILITY_BY_CODE = {
    0: "1/8",
    1: "1/7",
    2: "1/6",
    3: "1/5",
    4: "1/4",
    5: "1/3",
    6: "1/2",
    7: "2/3",
    8: "3/4",
    9: "7/8",
    10: "Always",
    11: "10%",
    12: "25%",
    13: "50%",
    14: "75%",
    15: "90%",
}
CODE_BY_PROBABILITY = {name: code for code, name in PROBABILITY_BY_CODE.items()}


def decode_performance(track: dict) -> dict:
    steps = track["steps"]
    footer = track["footer"]
    timing = [_i16(step, 8) for step in steps]
    amount = int(footer[32]) if len(footer) > 32 else 0
    return {
        "direction": "forward",
        "first": 1,
        "last": _last_step(steps),
        "root": None,
        "probability": [_probability(step) for step in steps],
        "ratchet": [_count(step[1]) for step in steps],
        "repeat": [_count(step[3] & 127) for step in steps],
        "repeatMerge": [bool(step[3] & 128) for step in steps],
        "glideMaster": min(100, int(footer[76]) * 10) if len(footer) > 76 else 0,
        "glide": [min(100, int(step[4]) * 10) for step in steps],
        "shuffle": amount,
        "shuffleStep": [_sign(timing[step]) for step in range(4)],
        "timing": timing,
        "arp": [_arp(step) for step in steps],
        "modMode": MODES[footer[40]] if len(footer) > 40 and footer[40] < len(MODES) else "stepped",
        "modVolt": [_clamp(round(_i16(step, 24) / 120), -100, 100) for step in steps],
        "modNote": [_i16(step, 24) for step in steps],
        "decay": [int(step[26]) for step in steps],
        "release": [int(step[26]) for step in steps],
        "wave": [WAVES[step[27]] if step[27] < len(WAVES) else "Sine" for step in steps],
        "triggers": [_trigger_on(step, index) for index, step in enumerate(steps)],
        "lfoLevel": [0] * 64,
    }


def apply_performance(pattern: dict, performances: list) -> None:
    for track, perf in zip(pattern.get("tracks", []), performances):
        if not isinstance(perf, dict):
            continue
        _apply_track(track, perf)


def _apply_track(track: dict, perf: dict) -> None:
    current = decode_performance(track)
    steps = track["steps"]
    footer = track["footer"]
    mode = perf.get("modMode", current["modMode"])
    if mode != current["modMode"] and mode in MODES and len(footer) > 40:
        footer[40] = MODES.index(mode)
    _apply_steps(steps, current, perf, mode)
    _apply_last(steps, current, perf)
    _apply_glide_master(footer, current, perf)
    _apply_shuffle(steps, footer, current, perf)


def _apply_steps(steps, current, perf, mode: str) -> None:
    for index, step in enumerate(steps):
        _apply_probability(step, current["probability"][index], perf["probability"][index])
        _apply_count(step, 1, current["ratchet"][index], perf["ratchet"][index])
        _apply_repeat(step, current, perf, index)
        _apply_glide(step, current["glide"][index], perf["glide"][index])
        _apply_voltage(step, current, perf, index, mode)
        _apply_time(step, current, perf, index, mode)
        _apply_wave(step, current["wave"][index], perf["wave"][index])
        _apply_trigger(step, index, current["triggers"][index], perf["triggers"][index])
        _apply_arp(step, current["arp"][index], perf["arp"][index])
        if int(perf["timing"][index]) != int(current["timing"][index]):
            _put_i16(step, 8, int(perf["timing"][index]))


def _apply_probability(step, current: str, wanted: str) -> None:
    if wanted == current or wanted not in CODE_BY_PROBABILITY:
        return
    step[5] = CODE_BY_PROBABILITY[wanted]


def _apply_count(step, offset: int, current: int, wanted: int) -> None:
    if int(wanted) == int(current):
        return
    step[offset] = 0 if int(wanted) <= 0 else min(127, int(wanted) - 1)


def _apply_repeat(step, current, perf, index: int) -> None:
    count = int(perf["repeat"][index])
    merge = bool(perf["repeatMerge"][index])
    if count == int(current["repeat"][index]) and merge == bool(current["repeatMerge"][index]):
        return
    step[3] = 0 if count <= 0 else min(127, count - 1) | (128 if merge else 0)


def _apply_glide(step, current: int, wanted: int) -> None:
    if int(wanted) == int(current):
        return
    step[4] = _clamp(round(int(wanted) / 10), 0, 10)


def _apply_voltage(step, current, perf, index: int, mode: str) -> None:
    if mode == "notes" and int(perf["modNote"][index]) != int(current["modNote"][index]):
        _put_i16(step, 24, int(perf["modNote"][index]))
    elif mode in {"stepped", "slide"} and int(perf["modVolt"][index]) != int(current["modVolt"][index]):
        _put_i16(step, 24, int(perf["modVolt"][index]) * 120)


def _apply_time(step, current, perf, index: int, mode: str) -> None:
    key = "decay" if mode == "decay" else "release" if mode == "asr" else ""
    if not key or int(perf[key][index]) == int(current[key][index]):
        return
    step[26] = _clamp(int(perf[key][index]), 0, 100)


def _apply_wave(step, current: str, wanted: str) -> None:
    if wanted == current or wanted not in WAVES:
        return
    step[27] = WAVES.index(wanted)


def _trigger_on(step, index: int) -> bool:
    """Byte 28 is the trigger bit. Step 1 starts on, so 0 means on there and off on later steps."""
    flipped = int(step[28]) == 1
    return (not flipped) if index == 0 else flipped


def _apply_trigger(step, index: int, current: bool, wanted: bool) -> None:
    if bool(wanted) == bool(current):
        return
    step[28] = 0 if (index == 0) == bool(wanted) else 1


def _apply_arp(step, current: str, wanted: str) -> None:
    if wanted == current:
        return
    if wanted == "Off":
        step[2] = 0
        step[18] = 0
        for offset, _value in enumerate(MAJOR):
            step[11 + offset] = 0
        return
    if wanted not in {"+MAJ", "−MAJ", "-MAJ"}:
        return
    step[2] = 4
    step[18] = 1 if wanted[0] in "−-" else 0
    for offset, value in enumerate(MAJOR):
        step[11 + offset] = value


def _last_step(steps) -> int:
    """Step 64 keeps the last step in the second byte of its note field.

    15 is step 16, which is what an untouched factory track plays. 63 is step 64.
    """
    if len(steps) < 64:
        return 64
    stored = int(steps[63][31])
    return stored + 1 if 0 <= stored <= 63 else 64


def _apply_last(steps, current, perf) -> None:
    if len(steps) < 64:
        return
    last = int(perf.get("last", current["last"]))
    if last == int(current["last"]) or not 1 <= last <= 64:
        return
    steps[63][31] = last - 1


def _apply_glide_master(footer, current, perf) -> None:
    if int(perf.get("glideMaster", 0)) == int(current["glideMaster"]) or len(footer) <= 76:
        return
    footer[76] = _clamp(round(int(perf["glideMaster"]) / 10), 0, 10)


def _apply_shuffle(steps, footer, current, perf) -> None:
    amount = int(perf.get("shuffle", current["shuffle"]))
    signs = [_minus(item) for item in perf.get("shuffleStep", current["shuffleStep"])]
    changed = amount != int(current["shuffle"]) or signs != list(current["shuffleStep"])
    if changed and len(footer) > 32:
        footer[32] = _clamp(amount, 0, 255)
    for index, step in enumerate(steps):
        if int(perf["timing"][index]) != int(current["timing"][index]):
            continue
        if not changed:
            continue
        sign = signs[index % 4]
        value = 0 if sign == "off" else -amount if sign == "−" else amount
        if value != int(current["timing"][index]):
            _put_i16(step, 8, value)


def _probability(step) -> str:
    code = int(step[5])
    if code == 10 or (0 <= code <= 10 and int(step[0]) == code * 10):
        return "Always"
    return PROBABILITY_BY_CODE.get(code, "Always")


def _count(stored: int) -> int:
    return 0 if stored <= 0 else int(stored) + 1


def _arp(step) -> str:
    payload = tuple(step[11:18])
    if payload == MAJOR and int(step[2]) == 4:
        return "−MAJ" if int(step[18]) == 1 else "+MAJ"
    if int(step[2]) == 0 and payload == (0, 0, 0, 0, 0, 0, 0) and int(step[18]) == 0:
        return "Off"
    return "−UNK" if int(step[18]) == 1 else "+UNK"


def _sign(value: int) -> str:
    if value < 0:
        return "−"
    if value > 0:
        return "+"
    return "off"


def _minus(value: object) -> str:
    text = str(value)
    if text == "-":
        return "−"
    return text if text in {"off", "+", "−"} else "off"


def _i16(step, offset: int) -> int:
    return struct.unpack_from("<h", bytes(step[offset:offset + 2]))[0]


def _put_i16(step, offset: int, value: int) -> None:
    raw = struct.pack("<h", _clamp(int(value), -32768, 32767))
    step[offset] = raw[0]
    step[offset + 1] = raw[1]


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))
