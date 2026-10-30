import json
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote

from blackseq.codec import parse_pattern
from blackseq.server import EditorHandler

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        project = self.root / "PROJECTS" / "FACTORY"
        (project / "00").mkdir(parents=True)
        (project / "01").mkdir()
        shutil.copy(FIXTURES / "01.SEQ", project / "00" / "01.SEQ")
        shutil.copy(FIXTURES / "INFO.DAT", project / "INFO.DAT")
        shutil.copy(FIXTURES / "00.SNG", project / "01" / "00.SNG")
        system = self.root / "SYSTEM"
        system.mkdir()
        shutil.copy(FIXTURES / "SCALES.DAT", system / "SCALES.DAT")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), EditorHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.temp.cleanup()

    def request(self, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            self.base + path,
            data=data,
            headers={"Content-Type": "application/json"} if data else {},
        )
        with urllib.request.urlopen(request) as response:
            return json.load(response)

    def _save_pattern(self, pattern, performance):
        return self.request(
            "/api/pattern",
            {
                "root": str(self.root),
                "project": "FACTORY",
                "bank": "00",
                "slot": "01.SEQ",
                "pattern": {
                    "version": pattern["version"],
                    "field2": pattern["field2"],
                    "tracks": [
                        {"cvCents": track["cvCents"], "steps": track["steps"], "footer": track["footer"]}
                        for track in pattern["tracks"]
                    ],
                },
                "performance": performance,
            },
        )

    def test_edit_round_trip_on_disk(self):
        root = quote(str(self.root))
        library = self.request(f"/api/library?root={root}")
        self.assertEqual(library["projects"][0]["name"], "FACTORY")
        self.assertEqual(library["projects"][0]["info"]["bpm"], 120)
        pattern = self.request(f"/api/pattern?root={root}&project=FACTORY&bank=00&slot=01.SEQ")
        pattern["tracks"][0]["steps"][0][30:34] = [0x70, 0x17, 0, 0]
        saved = self.request(
            "/api/pattern",
            {
                "root": str(self.root),
                "project": "FACTORY",
                "bank": "00",
                "slot": "01.SEQ",
                "pattern": {
                    "version": pattern["version"],
                    "field2": pattern["field2"],
                    "tracks": [
                        {
                            "cvCents": track["cvCents"],
                            "steps": track["steps"],
                            "footer": track["footer"],
                        }
                        for track in pattern["tracks"]
                    ],
                },
            },
        )
        self.assertTrue(saved["path"].endswith("01.SEQ"))
        stored = parse_pattern((self.root / "PROJECTS" / "FACTORY" / "00" / "01.SEQ").read_bytes())
        self.assertEqual(stored["tracks"][0]["stepInfo"][0]["noteCents"], 6000)
        self.assertTrue((self.root / "PROJECTS" / "FACTORY" / "00" / "01.SEQ.bak").is_file())

    def test_create_project(self):
        created = self.request("/api/project/new", {"root": str(self.root), "name": "  live  "})
        self.assertEqual(created["name"], "LIVE")
        self.assertEqual(created["info"]["bpm"], 120)
        pattern_path = self.root / "PROJECTS" / "LIVE" / "00" / "00.SEQ"
        self.assertTrue(pattern_path.is_file())
        self.assertTrue((self.root / "PROJECTS" / "LIVE" / "00" / "BANK.DAT").is_file())
        pattern = parse_pattern(pattern_path.read_bytes())
        self.assertEqual(pattern["tracks"][0]["stepInfo"][0]["noteCents"], 0)
        library = self.request(f"/api/library?root={quote(str(self.root))}")
        names = [item["name"] for item in library["projects"]]
        self.assertIn("LIVE", names)
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/project/new", {"root": str(self.root), "name": "LIVE"})
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/project/new", {"root": str(self.root), "name": "SONG 2"})
        odd = self.root / "PROJECTS" / "Test"
        odd.mkdir()
        listed = self.request(f"/api/library?root={quote(str(self.root))}")
        legacy = next(item for item in listed["projects"] if item["name"] == "Test")
        self.assertFalse(legacy["legal"])
        live = next(item for item in listed["projects"] if item["name"] == "LIVE")
        self.assertTrue(live["legal"])

    def test_performance_round_trips_through_the_pattern_file(self):
        root = quote(str(self.root))
        seq = self.root / "PROJECTS" / "FACTORY" / "00" / "01.SEQ"
        before = seq.read_bytes()
        pattern = self.request(f"/api/pattern?root={root}&project=FACTORY&bank=00&slot=01.SEQ")
        lanes = [track["performance"] for track in pattern["tracks"]]
        lanes[0]["direction"] = "backward"
        self._save_pattern(pattern, lanes)
        self.assertEqual(seq.read_bytes(), before)
        loaded = self.request(f"/api/pattern?root={root}&project=FACTORY&bank=00&slot=01.SEQ")
        self.assertEqual(loaded["tracks"][0]["performance"]["direction"], "backward")
        lanes = [track["performance"] for track in loaded["tracks"]]
        lanes[0]["ratchet"][0] = 4
        lanes[0]["repeat"][0] = 3
        lanes[0]["repeatMerge"][0] = True
        self._save_pattern(loaded, lanes)
        stored = parse_pattern(seq.read_bytes())["tracks"][0]["steps"][0]
        self.assertEqual(stored[1], 3)
        self.assertEqual(stored[3], 130)
        loaded = self.request(f"/api/pattern?root={root}&project=FACTORY&bank=00&slot=01.SEQ")
        self.assertEqual(loaded["tracks"][0]["performance"]["ratchet"][0], 4)
        self.assertEqual(loaded["tracks"][0]["performance"]["repeat"][0], 3)
        self.assertTrue(loaded["tracks"][0]["performance"]["repeatMerge"][0])
        self.assertEqual(loaded["tracks"][0]["performance"]["direction"], "backward")
        changed = seq.read_bytes()
        with self.assertRaises(urllib.error.HTTPError):
            self._save_pattern(loaded, [{"ratchet": [99] + [0] * 63}])
        self.assertEqual(seq.read_bytes(), changed)

    def test_song_name_survives_pattern_save_and_file_moves(self):
        root = str(self.root)
        quoted = quote(root)
        named = self.request(
            "/api/song/name",
            {"root": root, "project": "FACTORY", "bank": "01", "slot": "00.SNG", "name": "Theme"},
        )
        self.assertEqual(named["name"], "Theme")
        pattern = self.request(f"/api/pattern?root={quoted}&project=FACTORY&bank=00&slot=01.SEQ")
        self._save_pattern(pattern, [track["performance"] for track in pattern["tracks"]])
        library = self.request(f"/api/library?root={quoted}")
        bank = next(item for item in library["projects"][0]["banks"] if item["id"] == "01")
        self.assertEqual(bank["songNames"]["00.SNG"], "Theme")
        copied = self.request(
            "/api/song/duplicate",
            {"root": root, "project": "FACTORY", "bank": "01", "slot": "00.SNG"},
        )
        self.assertEqual(copied, {"slot": "01.SNG", "name": "Theme copy"})
        moved = self.request(
            "/api/song/move",
            {"root": root, "project": "FACTORY", "bank": "01", "slot": "01.SNG", "target": "02.SNG"},
        )
        self.assertEqual(moved["slot"], "02.SNG")
        self.assertFalse((self.root / "PROJECTS" / "FACTORY" / "01" / "01.SNG").exists())
        self.assertTrue((self.root / "PROJECTS" / "FACTORY" / "01" / "02.SNG").is_file())
        self.request(
            "/api/song/delete",
            {"root": root, "project": "FACTORY", "bank": "01", "slot": "02.SNG"},
        )
        self.assertFalse((self.root / "PROJECTS" / "FACTORY" / "01" / "02.SNG").exists())
        library = self.request(f"/api/library?root={quoted}")
        bank = next(item for item in library["projects"][0]["banks"] if item["id"] == "01")
        self.assertEqual(bank["songNames"], {"00.SNG": "Theme"})
        self.assertNotIn("02.SNG", bank["songs"])
        with self.assertRaises(urllib.error.HTTPError):
            self.request(
                "/api/song/name",
                {"root": root, "project": "FACTORY", "bank": "01", "slot": "00.SNG", "name": "Theme/one"},
            )
        with self.assertRaises(urllib.error.HTTPError):
            self.request(
                "/api/song/delete",
                {"root": root, "project": "FACTORY", "bank": "01", "slot": "02.SNG"},
            )

    def test_project_rename_duplicate_and_delete(self):
        root = str(self.root)
        self.request("/api/project/new", {"root": root, "name": "LIVE"})
        renamed = self.request("/api/project/rename", {"root": root, "project": "LIVE", "name": "STAGE"})
        self.assertEqual(renamed["name"], "STAGE")
        self.assertTrue((self.root / "PROJECTS" / "STAGE" / "00" / "00.SEQ").is_file())
        self.assertFalse((self.root / "PROJECTS" / "LIVE").exists())
        copied = self.request("/api/project/duplicate", {"root": root, "project": "STAGE", "name": "stage b"})
        self.assertEqual(copied["name"], "STAGE B")
        self.assertTrue((self.root / "PROJECTS" / "STAGE B" / "INFO.DAT").is_file())
        self.request("/api/project/delete", {"root": root, "project": "STAGE B"})
        self.assertFalse((self.root / "PROJECTS" / "STAGE B").exists())
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/project/duplicate", {"root": root, "project": "STAGE", "name": "stage"})
        (self.root / "PROJECTS" / "Test").mkdir()
        renamed_case = self.request("/api/project/rename", {"root": root, "project": "Test", "name": "test"})
        self.assertEqual(renamed_case["name"], "TEST")
        stored = [path.name for path in (self.root / "PROJECTS").iterdir() if path.is_dir()]
        self.assertIn("TEST", stored)
        self.assertNotIn("Test", stored)
        self.request("/api/project/delete", {"root": root, "project": "TEST"})
        self.request("/api/project/new", {"root": root, "name": "NEW"})
        self.request("/api/project/delete", {"root": root, "project": "NEW"})
        self.assertFalse((self.root / "PROJECTS" / "NEW").exists())
        self.assertTrue((self.root / "PROJECTS" / "FACTORY").is_dir())
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/project/delete", {"root": root, "project": "FACTORY"})
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/project/rename", {"root": root, "project": "FACTORY", "name": "OTHER"})
        self.assertTrue((self.root / "PROJECTS" / "FACTORY").is_dir())
        with self.assertRaises(urllib.error.HTTPError):
            self.request("/api/project/duplicate", {"root": root, "project": "STAGE", "name": "STAGE"})


if __name__ == "__main__":
    unittest.main()
