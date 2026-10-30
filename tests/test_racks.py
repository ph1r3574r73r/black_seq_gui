import tempfile
import unittest
from pathlib import Path

from blackseq.library import LibraryError
from blackseq.racks import (
    delete_project_racks,
    delete_song_rack,
    duplicate_project_racks,
    duplicate_song_rack,
    move_song_rack,
    read_song_rack,
    rename_project_racks,
    delete_preset,
    list_presets,
    write_preset,
    write_song_rack,
)


def patch():
    return {
        "version": 4,
        "nextModule": 2,
        "nextCable": 1,
        "modules": [{"id": 0, "type": "black_seq", "x": 0, "y": 0, "params": {}}],
        "cables": [],
    }


class RackStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_a_song_patch_stays_beside_the_studio(self):
        write_song_rack("MOUNTAIN KING", "00", "00.SNG", patch(), self.folder)
        saved = read_song_rack("MOUNTAIN KING", "00", "00.SNG", self.folder)
        self.assertEqual(saved["modules"][0]["type"], "black_seq")
        self.assertTrue((self.folder / "RACKS.json").is_file())
        self.assertFalse((self.folder / "PROJECTS").exists())

    def test_missing_song_has_no_patch(self):
        self.assertIsNone(read_song_rack("MOUNTAIN KING", "00", "01.SNG", self.folder))

    def test_project_and_song_changes_follow_the_name(self):
        write_song_rack("LIVE", "00", "00.SNG", patch(), self.folder)
        duplicate_song_rack("LIVE", "00", "00.SNG", "01.SNG", self.folder)
        move_song_rack("LIVE", "00", "01.SNG", "02.SNG", self.folder)
        rename_project_racks("LIVE", "LIVE SET", self.folder)
        duplicate_project_racks("LIVE SET", "LIVE COPY", self.folder)
        self.assertIsNone(read_song_rack("LIVE", "00", "00.SNG", self.folder))
        self.assertIsNotNone(read_song_rack("LIVE SET", "00", "00.SNG", self.folder))
        self.assertIsNone(read_song_rack("LIVE SET", "00", "01.SNG", self.folder))
        self.assertIsNotNone(read_song_rack("LIVE SET", "00", "02.SNG", self.folder))
        self.assertIsNotNone(read_song_rack("LIVE COPY", "00", "02.SNG", self.folder))
        delete_song_rack("LIVE SET", "00", "02.SNG", self.folder)
        self.assertIsNone(read_song_rack("LIVE SET", "00", "02.SNG", self.folder))
        delete_project_racks("LIVE COPY", self.folder)
        self.assertIsNone(read_song_rack("LIVE COPY", "00", "00.SNG", self.folder))

    def test_presets_are_shared_and_keep_the_panel(self):
        rack = patch()
        rack["modules"].append({
            "id": 1,
            "type": "plaits",
            "x": 16,
            "y": 0,
            "params": {"harmonics": 0.2, "model": 0.25, "polyphony": 4, "exp_a": 1},
        })
        rack["cables"] = [{"id": 1, "from": {"module": 0, "port": "cv1"}, "to": {"module": 1, "port": "v_oct"}}]
        rack["nextModule"] = 2
        rack["nextCable"] = 2
        write_preset("PLUCK", rack, self.folder)
        write_song_rack("LIVE", "00", "00.SNG", patch(), self.folder)
        saved = list_presets(self.folder)["PLUCK"]
        plaits = next(module for module in saved["modules"] if module["type"] == "plaits")
        self.assertEqual(plaits["params"]["harmonics"], 0.2)
        self.assertEqual(plaits["params"]["model"], 0.25)
        self.assertEqual(plaits["params"]["polyphony"], 4)
        self.assertEqual(plaits["params"]["exp_a"], 1)
        self.assertEqual(saved["cables"][0]["to"]["port"], "v_oct")
        self.assertIn("PLUCK", list_presets(self.folder))
        delete_preset("PLUCK", self.folder)
        self.assertNotIn("PLUCK", list_presets(self.folder))
        self.assertIsNotNone(read_song_rack("LIVE", "00", "00.SNG", self.folder))

    def test_a_broken_patch_is_refused(self):
        broken = patch()
        broken["modules"] = []
        with self.assertRaises(LibraryError):
            write_song_rack("LIVE", "00", "00.SNG", broken, self.folder)


if __name__ == "__main__":
    unittest.main()
