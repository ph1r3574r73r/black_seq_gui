import shutil
import tempfile
import unittest
from pathlib import Path

from blackseq.library import (
    LibraryError,
    choose_card,
    clean_project_name,
    describe_places,
    name_taken,
    transfer_project,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.source = Path(self.temp.name) / "card"
        self.destination = Path(self.temp.name) / "studio"
        for root in (self.source, self.destination):
            (root / "PROJECTS").mkdir(parents=True)
        project = self.source / "PROJECTS" / "LIVE"
        (project / "00").mkdir(parents=True)
        shutil.copy(FIXTURES / "01.SEQ", project / "00" / "01.SEQ")
        shutil.copy(FIXTURES / "INFO.DAT", project / "INFO.DAT")
        (project / "00" / "01.SEQ.bak").write_bytes(b"junk")

    def tearDown(self):
        self.temp.cleanup()

    def test_move_removes_the_source_and_skips_backups(self):
        saved = transfer_project(self.source, self.destination, "LIVE", "move")
        self.assertEqual(saved["name"], "LIVE")
        self.assertFalse((self.source / "PROJECTS" / "LIVE").exists())
        copied = self.destination / "PROJECTS" / "LIVE"
        self.assertTrue((copied / "INFO.DAT").is_file())
        self.assertTrue((copied / "00" / "01.SEQ").is_file())
        self.assertFalse((copied / "00" / "01.SEQ.bak").exists())

    def test_copy_is_refused(self):
        with self.assertRaises(LibraryError):
            transfer_project(self.source, self.destination, "LIVE", "copy")
        self.assertTrue((self.source / "PROJECTS" / "LIVE").is_dir())
        self.assertFalse((self.destination / "PROJECTS" / "LIVE").exists())

    def test_refuses_a_name_that_is_already_there(self):
        transfer_project(self.source, self.destination, "LIVE", "move")
        again = self.source / "PROJECTS" / "LIVE"
        again.mkdir()
        (again / "INFO.DAT").write_bytes((self.destination / "PROJECTS" / "LIVE" / "INFO.DAT").read_bytes())
        with self.assertRaises(LibraryError):
            transfer_project(self.source, self.destination, "LIVE", "move")

    def test_factory_stays_where_it_is(self):
        factory = self.source / "PROJECTS" / "FACTORY"
        factory.mkdir()
        (factory / "INFO.DAT").write_bytes((self.source / "PROJECTS" / "LIVE" / "INFO.DAT").read_bytes())
        with self.assertRaises(LibraryError):
            transfer_project(self.source, self.destination, "FACTORY", "move")
        self.assertTrue(factory.is_dir())
        self.assertFalse((self.destination / "PROJECTS" / "FACTORY").exists())

    def test_names_are_capitals_and_spaces(self):
        self.assertEqual(clean_project_name("  live   set "), "LIVE SET")
        for bad in ("LIVE-2", "SONG 2", "live_set", "A" * 17, ""):
            with self.assertRaises(LibraryError):
                clean_project_name(bad)

    def test_a_name_is_taken_in_either_library(self):
        self.assertTrue(name_taken("live", [self.source, self.destination]))
        self.assertFalse(name_taken("OTHER NAME", [self.source, self.destination]))
        keep = self.source / "PROJECTS" / "LIVE"
        self.assertFalse(name_taken("LIVE", [self.source], keep=keep))

    def test_studio_place_exists_without_a_card(self):
        places = describe_places()
        self.assertTrue((Path(places["studio"]) / "PROJECTS").is_dir())
        self.assertIsInstance(places["drives"], list)

    def test_card_choice_follows_the_user(self):
        drives = [
            {"name": "NO NAME", "path": "/Volumes/NO NAME", "projects": True},
            {"name": "BACKUP", "path": "/Volumes/BACKUP", "projects": True},
        ]
        self.assertEqual(choose_card(drives), "")
        self.assertEqual(choose_card(drives, "/Volumes/BACKUP"), "/Volumes/BACKUP")
        self.assertEqual(choose_card(drives, "/Volumes/MISSING"), "")
        self.assertEqual(choose_card(drives[:1]), "/Volumes/NO NAME")
        self.assertEqual(describe_places("")["card"], "")


if __name__ == "__main__":
    unittest.main()
