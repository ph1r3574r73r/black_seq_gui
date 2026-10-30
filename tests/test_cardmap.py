import struct
import unittest

from blackseq.cardmap import apply_performance, decode_performance
from blackseq.codec import blank_pattern, build_pattern, parse_pattern


def _i16(step, offset):
    return struct.unpack_from("<h", bytes(step[offset:offset + 2]))[0]


def _f32(footer, offset):
    return struct.unpack_from("<f", bytes(footer[offset:offset + 4]))[0]


class CardMapTests(unittest.TestCase):
    def test_confirmed_values_round_trip_and_leave_other_bytes(self):
        pattern = blank_pattern()
        track = pattern["tracks"][0]
        track["steps"][10][0] = 80
        track["steps"][10][5] = 8
        footer = bytearray(track["footer"])
        struct.pack_into("<f", footer, 44, 1.0)
        track["footer"] = list(footer)
        before = [list(step) for step in track["steps"]]
        lanes = [decode_performance(item) for item in pattern["tracks"]]
        self.assertEqual(lanes[0]["probability"][10], "Always")

        lanes[0]["probability"][0] = "1/2"
        lanes[0]["probability"][1] = "50%"
        lanes[0]["probability"][2] = "1/4"
        lanes[0]["ratchet"][0] = 4
        lanes[0]["repeat"][1] = 3
        lanes[0]["repeatMerge"][1] = False
        lanes[0]["repeat"][2] = 2
        lanes[0]["repeatMerge"][2] = True
        lanes[0]["glide"][0] = 100
        lanes[0]["glideMaster"] = 50
        lanes[0]["shuffle"] = 25
        lanes[0]["shuffleStep"] = ["−", "+", "off", "+"]
        lanes[0]["timing"][4] = 50
        lanes[0]["modMode"] = "stepped"
        lanes[0]["modVolt"][0] = 50
        lanes[0]["modVolt"][1] = -100
        lanes[2]["modMode"] = "decay"
        lanes[2]["decay"][0] = 100
        lanes[0]["wave"][3] = "Square"
        lanes[0]["triggers"][4] = True
        lanes[0]["arp"][5] = "−MAJ"
        lanes[1]["modMode"] = "slide"
        lanes[1]["modVolt"][0] = 100

        apply_performance(pattern, lanes)
        step = track["steps"]
        self.assertEqual(step[0][5], 6)
        self.assertEqual(step[1][5], 13)
        self.assertEqual(step[2][5], 4)
        self.assertEqual(step[10][5], 8)
        self.assertEqual(step[10][0], 80)
        self.assertEqual(step[0][1], 3)
        self.assertEqual(step[1][3], 2)
        self.assertEqual(step[2][3], 129)
        self.assertEqual(step[0][4], 10)
        self.assertEqual(track["footer"][76], 5)
        self.assertEqual(track["footer"][32], 25)
        self.assertEqual([_i16(step[index], 8) for index in range(4)], [-25, 25, 0, 25])
        self.assertEqual(_i16(step[4], 8), 50)
        self.assertEqual(_i16(step[5], 8), 25)
        self.assertEqual(_i16(step[8], 8), -25)
        self.assertEqual(_i16(step[0], 24), 6000)
        self.assertEqual(_i16(step[1], 24), -12000)
        self.assertEqual(pattern["tracks"][2]["steps"][0][26], 100)
        self.assertEqual(pattern["tracks"][2]["footer"][40], 3)
        self.assertEqual(track["footer"][40], 0)
        self.assertEqual(step[3][27], 4)
        self.assertEqual(step[4][28], 1)
        self.assertEqual(step[5][2], 4)
        self.assertEqual(step[5][18], 1)
        self.assertEqual(tuple(step[5][11:18]), (4, 7, 12, 16, 19, 24, 28))
        self.assertEqual(_i16(pattern["tracks"][1]["steps"][0], 24), 12000)
        self.assertEqual(pattern["tracks"][1]["footer"][40], 1)
        self.assertEqual(_f32(track["footer"], 44), 1.0)
        self.assertEqual(step[6], before[6])

        again = [decode_performance(item) for item in pattern["tracks"]]
        self.assertEqual(again[0]["probability"][0], "1/2")
        self.assertEqual(again[0]["modVolt"][0], 50)
        self.assertEqual(again[2]["decay"][0], 100)
        self.assertEqual(again[2]["release"][0], 100)
        self.assertEqual(again[0]["wave"][3], "Square")
        self.assertTrue(again[0]["triggers"][4])
        self.assertEqual(again[0]["arp"][5], "−MAJ")
        self.assertEqual(again[1]["modVolt"][0], 100)
        apply_performance(pattern, again)
        rebuilt = parse_pattern(build_pattern(pattern))
        self.assertEqual(rebuilt["tracks"][2]["steps"][0][26], 100)
        self.assertEqual(_f32(rebuilt["tracks"][0]["footer"], 44), 1.0)

    def test_cv_note_and_slide_mode_keep_their_own_bytes(self):
        pattern = blank_pattern()
        lanes = [decode_performance(item) for item in pattern["tracks"]]
        lanes[0]["modMode"] = "notes"
        lanes[0]["modNote"][0] = 4800
        apply_performance(pattern, lanes)
        self.assertEqual(_i16(pattern["tracks"][0]["steps"][0], 24), 4800)
        self.assertEqual(pattern["tracks"][0]["footer"][40], 2)
        lanes = [decode_performance(item) for item in pattern["tracks"]]
        lanes[0]["modMode"] = "slide"
        apply_performance(pattern, lanes)
        self.assertEqual(_i16(pattern["tracks"][0]["steps"][0], 24), 4800)
        self.assertEqual(pattern["tracks"][0]["footer"][40], 1)

    def test_last_step_lives_on_step_64(self):
        pattern = blank_pattern()
        lanes = [decode_performance(item) for item in pattern["tracks"]]
        self.assertEqual(lanes[0]["last"], 16)
        self.assertEqual(pattern["tracks"][0]["steps"][63][31], 15)
        lanes[0]["last"] = 64
        apply_performance(pattern, lanes)
        self.assertEqual(pattern["tracks"][0]["steps"][63][31], 63)
        self.assertEqual(pattern["tracks"][0]["steps"][63][30], 0)
        again = [decode_performance(item) for item in pattern["tracks"]]
        self.assertEqual(again[0]["last"], 64)
        apply_performance(pattern, again)
        self.assertEqual(pattern["tracks"][0]["steps"][63][31], 63)

    def test_trigger_on_step_one_is_stored_inverted(self):
        pattern = blank_pattern()
        lanes = [decode_performance(item) for item in pattern["tracks"]]
        self.assertTrue(lanes[0]["triggers"][0])
        self.assertFalse(any(lanes[0]["triggers"][1:]))

        lanes[0]["modMode"] = "triggers"
        lanes[0]["triggers"][0] = False
        lanes[0]["triggers"][1] = True
        apply_performance(pattern, lanes)
        steps = pattern["tracks"][0]["steps"]
        self.assertEqual(pattern["tracks"][0]["footer"][40], 8)
        self.assertEqual(steps[0][28], 1)
        self.assertEqual(steps[1][28], 1)
        self.assertEqual(steps[2][28], 0)
        again = decode_performance(pattern["tracks"][0])
        self.assertFalse(again["triggers"][0])
        self.assertTrue(again["triggers"][1])
        self.assertFalse(again["triggers"][2])

        fresh = blank_pattern()
        downbeat = [decode_performance(item) for item in fresh["tracks"]]
        downbeat[0]["modMode"] = "triggers"
        downbeat[0]["triggers"][2] = True
        downbeat[0]["triggers"][4] = True
        apply_performance(fresh, downbeat)
        saved = fresh["tracks"][0]["steps"]
        self.assertEqual(saved[0][28], 0)
        self.assertEqual(saved[2][28], 1)
        self.assertEqual(saved[4][28], 1)
        heard = decode_performance(fresh["tracks"][0])
        self.assertTrue(heard["triggers"][0])
        self.assertTrue(heard["triggers"][2])
        self.assertTrue(heard["triggers"][4])
