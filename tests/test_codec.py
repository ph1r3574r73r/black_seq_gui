import unittest
from pathlib import Path

from blackseq.codec import (
    INPUT_SCALE_OFFSET,
    OUTPUT_SCALE_OFFSET,
    SCALE_NAME_LENGTH,
    blank_pattern,
    build_pattern,
    build_project_info,
    build_song,
    note_name,
    parse_pattern,
    parse_project_info,
    parse_scales,
    parse_song,
    set_input_scale,
    set_step_note,
)
from blackseq.library import LibraryError, inside, resolve_root

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class CodecTests(unittest.TestCase):
    def test_factory_patterns_round_trip(self):
        for name in ("01.SEQ", "02.SEQ"):
            original = (FIXTURES / name).read_bytes()
            parsed = parse_pattern(original)
            self.assertEqual(build_pattern(parsed), original)
            self.assertEqual(parsed["tracks"][0]["inputScale"], "CHROMATIC")
            self.assertEqual(parsed["tracks"][0]["outputScale"], "NONE")
            self.assertEqual(parsed["tracks"][0]["scaleMask"], 0xFFF)

    def test_scale_names_sit_in_fixed_fields(self):
        pattern = parse_pattern((FIXTURES / "01.SEQ").read_bytes())
        footer = bytes(pattern["tracks"][0]["footer"])
        self.assertTrue(footer[INPUT_SCALE_OFFSET:].startswith(b"CHROMATIC\x00"))
        self.assertEqual(
            footer[OUTPUT_SCALE_OFFSET : OUTPUT_SCALE_OFFSET + SCALE_NAME_LENGTH].split(b"\x00", 1)[0],
            b"NONE",
        )

    def test_note_edit_changes_only_that_pitch(self):
        original = (FIXTURES / "01.SEQ").read_bytes()
        parsed = parse_pattern(original)
        set_step_note(parsed["tracks"][0]["steps"][0], 6000)
        rebuilt = build_pattern(parsed)
        diffs = [index for index, (a, b) in enumerate(zip(original, rebuilt)) if a != b]
        self.assertEqual(len(diffs), 2)
        self.assertEqual(parse_pattern(rebuilt)["tracks"][0]["stepInfo"][0]["noteName"], "C4")

    def test_note_names(self):
        self.assertEqual(note_name(0), "—")
        self.assertEqual(note_name(3900), "D#2")
        self.assertEqual(note_name(6000), "C4")
        self.assertEqual(note_name(3840), "D2 +40c")

    def test_song_info_and_scales_round_trip(self):
        song = (FIXTURES / "00.SNG").read_bytes()
        parsed_song = parse_song(song)
        self.assertEqual(build_song(parsed_song), song)
        self.assertEqual(parsed_song["entries"][0], {"pattern": 1, "repeats": 2})
        self.assertEqual(parsed_song["entries"][1], {"pattern": 0, "repeats": 1})

        info = (FIXTURES / "INFO.DAT").read_bytes()
        parsed_info = parse_project_info(info)
        self.assertEqual(parsed_info["bpm"], 120)
        self.assertEqual(build_project_info(parsed_info), info)
        module_info = bytes.fromhex("070d0000c8421001")
        parsed_module = parse_project_info(module_info)
        self.assertEqual(parsed_module, {"bpm": 100, "flag2": 1, "flag3": None})
        self.assertEqual(build_project_info(parsed_module), module_info)
        module_flag3 = bytes.fromhex("070d0000f042180f")
        parsed_flag3 = parse_project_info(module_flag3)
        self.assertEqual(parsed_flag3, {"bpm": 120, "flag2": None, "flag3": 15})
        self.assertEqual(build_project_info(parsed_flag3), module_flag3)

        scales = parse_scales((FIXTURES / "SCALES.DAT").read_bytes())
        by_name = {scale["name"]: scale["mask"] for scale in scales}
        self.assertEqual(by_name["CHROMATIC"], 0xFFF)
        self.assertEqual(by_name["MAJOR"], 0xAB5)
        self.assertEqual(by_name["MINOR"], 0x5AD)
        self.assertEqual(by_name["WHOLETONE"], 0x555)

    def test_blank_pattern_keeps_factory_envelope(self):
        blank = blank_pattern((FIXTURES / "01.SEQ").read_bytes())
        for track in blank["tracks"]:
            notes = [step["noteCents"] for step in track["stepInfo"]]
            self.assertEqual(notes[:63], [0] * 63)
            self.assertEqual(track["cvCents"], 0)
        rebuilt = build_pattern(blank)
        self.assertEqual(parse_pattern(rebuilt)["tracks"][0]["inputScale"], "CHROMATIC")

    def test_input_scale_updates_name_and_mask(self):
        pattern = parse_pattern((FIXTURES / "01.SEQ").read_bytes())
        pattern["tracks"][0]["footer"] = set_input_scale(
            pattern["tracks"][0]["footer"], "MAJOR", 0xAB5
        )
        rebuilt = parse_pattern(build_pattern(pattern))
        self.assertEqual(rebuilt["tracks"][0]["inputScale"], "MAJOR")
        self.assertEqual(rebuilt["tracks"][0]["scaleMask"], 0xAB5)
        self.assertEqual(rebuilt["tracks"][0]["outputScale"], "NONE")


class LibraryTests(unittest.TestCase):
    def test_path_cannot_escape_root(self):
        root = FIXTURES.resolve()
        with self.assertRaises(LibraryError):
            inside(root, "..", "secret")

    def test_missing_card_is_reported(self):
        with self.assertRaises(LibraryError):
            resolve_root("/this/card/does/not/exist")


if __name__ == "__main__":
    unittest.main()
