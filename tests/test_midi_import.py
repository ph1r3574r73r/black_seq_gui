import struct
import unittest
from pathlib import Path

from blackseq.codec import GATE_OFFSET, NOTE_OFFSET, blank_pattern, set_step_note
from blackseq.midi_import import MidiError, import_map, inspect_midi, parse_midi

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _vlq(value: int) -> bytes:
    if value < 0:
        raise ValueError("negative VLQ")
    chunks = [value & 0x7F]
    value >>= 7
    while value:
        chunks.append(0x80 | (value & 0x7F))
        value >>= 7
    return bytes(reversed(chunks))


def _track(events: bytes) -> bytes:
    return b"MTrk" + len(events).to_bytes(4, "big") + events


def synthetic_type1_midi() -> bytes:
    """Minimal type-1 SMF: tempo track + two note tracks on channels 1 and 2.

    Division 96 → 24 ticks per 16th. Notes:
      track 1 / ch1: C4 (60) at step 0 for 2 sixteenths, E4 (64) at step 4 for 1
      track 2 / ch2: G3 (55) at step 0 for 4 sixteenths
      same track also has ch1 overlap C5 (72) at step 0 (for mono tests)
    """
    header = b"MThd" + (6).to_bytes(4, "big") + (1).to_bytes(2, "big") + (3).to_bytes(2, "big") + (96).to_bytes(2, "big")

    # Tempo 120 BPM = 500_000 µs/quarter, track name meta.
    tempo = b"\x00\xff\x51\x03" + (500_000).to_bytes(3, "big")
    name0 = b"\x00\xff\x03\x05Tempo"
    end = b"\x00\xff\x2f\x00"
    track0 = _track(tempo + name0 + end)

    name1 = b"\x00\xff\x03\x06Melody"
    # C4 on ch1 at 0, off after 48 ticks (2 sixteenths); E4 at 96 ticks (step 4), off after 24.
    notes1 = (
        b"\x00\x90\x3c\x40"  # note on C4 ch1
        + _vlq(48)
        + b"\x80\x3c\x40"  # note off
        + _vlq(48)
        + b"\x90\x40\x40"  # E4 on
        + _vlq(24)
        + b"\x80\x40\x40"
        + end
    )
    track1 = _track(name1 + notes1)

    name2 = b"\x00\xff\x03\x04Bass"
    # G3 on ch2 + C5 on ch1 at onset 0 (chord for mono); G3 held 4 sixteenths.
    notes2 = (
        b"\x00\x91\x37\x40"  # G3 ch2
        + b"\x00\x90\x48\x40"  # C5 ch1
        + _vlq(24)
        + b"\x80\x48\x40"  # C5 off after 1 sixteenth
        + _vlq(72)
        + b"\x81\x37\x40"  # G3 off after 4 sixteenths total
        + end
    )
    track2 = _track(name2 + notes2)
    return header + track0 + track1 + track2


class MidiImportTests(unittest.TestCase):
    def test_inspect_reports_tracks_channels_and_bpm(self):
        data = synthetic_type1_midi()
        info = inspect_midi(data)
        self.assertEqual(info["bpm"], 120)
        self.assertEqual(len(info["tracks"]), 3)
        self.assertEqual(info["tracks"][0]["noteCount"], 0)
        self.assertEqual(info["tracks"][1]["name"], "Melody")
        self.assertEqual(info["tracks"][1]["noteCount"], 2)
        self.assertEqual(info["tracks"][1]["channels"], [1])
        self.assertEqual(info["tracks"][2]["name"], "Bass")
        self.assertEqual(info["tracks"][2]["noteCount"], 2)
        self.assertEqual(info["tracks"][2]["channels"], [1, 2])
        self.assertEqual(info["midiChannels"], [1, 2])

    def test_parse_records_midi_channel_per_note(self):
        parsed = parse_midi(synthetic_type1_midi())
        melody = parsed["tracks"][1]["notes"]
        self.assertEqual(melody[0], (0, 2, 60, 1))
        self.assertEqual(melody[1], (4, 1, 64, 1))
        bass = parsed["tracks"][2]["notes"]
        by_pitch = {note: (onset, span, channel) for onset, span, note, channel in bass}
        self.assertEqual(by_pitch[55], (0, 4, 2))
        self.assertEqual(by_pitch[72], (0, 1, 1))

    def test_import_map_track_replace_and_gates(self):
        pattern = blank_pattern((FIXTURES / "01.SEQ").read_bytes())
        set_step_note(pattern["tracks"][0]["steps"][10], 6000)
        pattern["tracks"][0]["steps"][10][GATE_OFFSET] = 80

        updated = import_map(
            pattern,
            {0: {"track": 1}},
            data=synthetic_type1_midi(),
            replace=True,
            mono="high",
        )
        steps = updated["tracks"][0]["steps"]
        info = updated["tracks"][0]["stepInfo"]
        self.assertEqual(info[0]["noteCents"], 6000)
        self.assertEqual(steps[0][GATE_OFFSET], 100)
        self.assertEqual(info[1]["noteCents"], 6000)
        self.assertEqual(steps[1][GATE_OFFSET], 80)
        self.assertEqual(info[4]["noteCents"], 6400)
        self.assertEqual(steps[4][GATE_OFFSET], 80)
        self.assertEqual(info[10]["noteCents"], 0)
        self.assertIsNot(updated, pattern)
        original_cents = struct.unpack_from("<i", bytes(pattern["tracks"][0]["steps"][10]), NOTE_OFFSET)[0]
        self.assertEqual(original_cents, 6000)

    def test_import_map_channel_and_mono(self):
        pattern = blank_pattern((FIXTURES / "01.SEQ").read_bytes())
        high = import_map(
            pattern,
            {"0": {"channel": 1}},
            data=synthetic_type1_midi(),
            mono="high",
        )
        # Channel 1 notes include Melody C4/E4 and Bass C5 at step 0; high keeps C5.
        self.assertEqual(high["tracks"][0]["stepInfo"][0]["noteCents"], 7200)
        self.assertEqual(high["tracks"][0]["steps"][0][GATE_OFFSET], 80)

        low = import_map(
            pattern,
            {0: {"channel": 1}},
            data=synthetic_type1_midi(),
            mono="low",
        )
        self.assertEqual(low["tracks"][0]["stepInfo"][0]["noteCents"], 6000)
        self.assertEqual(low["tracks"][0]["steps"][0][GATE_OFFSET], 100)
        self.assertEqual(low["tracks"][0]["steps"][1][GATE_OFFSET], 80)

        bass = import_map(
            pattern,
            {1: {"channel": 2}, 2: None},
            data=synthetic_type1_midi(),
        )
        self.assertEqual(bass["tracks"][1]["stepInfo"][0]["noteCents"], 5500)
        self.assertEqual(bass["tracks"][1]["steps"][3][GATE_OFFSET], 80)
        self.assertTrue(all(step["noteCents"] == 0 for step in bass["tracks"][2]["stepInfo"][:16]))

    def test_import_map_merge_keeps_existing(self):
        pattern = blank_pattern((FIXTURES / "01.SEQ").read_bytes())
        set_step_note(pattern["tracks"][0]["steps"][0], 4800)
        pattern["tracks"][0]["steps"][0][GATE_OFFSET] = 80
        updated = import_map(
            pattern,
            {0: {"track": 1}},
            data=synthetic_type1_midi(),
            replace=False,
        )
        self.assertEqual(updated["tracks"][0]["stepInfo"][0]["noteCents"], 4800)
        self.assertEqual(updated["tracks"][0]["stepInfo"][4]["noteCents"], 6400)

    def test_rejects_bad_midi(self):
        with self.assertRaises(MidiError):
            inspect_midi(b"not midi")
        with self.assertRaises(MidiError):
            import_map(blank_pattern((FIXTURES / "01.SEQ").read_bytes()), {0: {"track": 99}}, data=synthetic_type1_midi())


if __name__ == "__main__":
    unittest.main()
