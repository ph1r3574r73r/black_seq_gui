# Black Sequencer editor

Local companion editor for [Erica Synths Black Sequencer](https://www.ericasynths.lv/) SD card projects. Edit patterns and songs on disk, preview audio with Mutable Instruments modules in a lean rack, import MIDI files, and record from a MIDI controller.

The rack is a **preview voice** so sequences are listenable while you work. The card and hardware remain the destination.

## Run

```bash
python3 -m pip install -r requirements.txt
python3 -m blackseq            # then open http://127.0.0.1:8765
python3 -m blackseq --open     # also launch the default browser
python3 -m blackseq --desktop  # native window (macOS / Linux / Windows)
```

- **Studio** — projects under `studio/` in this repo  
- **Card** — pick a mounted volume that contains `PROJECTS/`  
- **Save pattern** — writes `.SEQ` plus performance data kept with the project  

Shipped demo: **DEMO BANK** (100 BPM). Bank 00 opens with boom-bap **NIGHT RIDE** and techno **GRIDLOCK**; bank 01 has more techno (PULSE / DROP); bank 02 is ambient (FOG LINE / DRIFT). Factory rack is Plaits lead, Rings, Plaits bass, and Peaks kick/snare.

Your own studio projects stay local — `studio/PROJECTS/*` is gitignored except the demo. Live `studio/RACKS.json` is also ignored; a fresh checkout restores racks from `studio/RACKS.default.json` on first run.

## MIDI

| Path | What it does |
|------|----------------|
| **Import MIDI** | Map up to four SMF tracks / MIDI channels → CH1–4 |
| **MIDI in** dropdown | Pick a controller (`python-rtmidi` on the server) |
| **Rec** | Arm recording: notes write into the selected track while playing (or step-record when stopped) |
| **Learn CC** / Alt-click rack knobs | Map controller knobs to gate brush or module params |

Controllers talk to **Python**, not browser WebMIDI, so a future packaged app can keep the same path.

## Rack

Factory default: **Plaits** lead, **Rings** pads, **Plaits** FM bass, **Peaks** drums (kick on gate4, snare on mod4) → mixer (with per-channel mute) → output. Save your own presets from the Rack tab. Legacy racks before v7 are replaced by this default.

MI DSP uses open-source Mutable Instruments code compiled to WASM under `web/dsp/`. Preview audio is not a hardware clone.

## Smoke checklist

1. Create or open a studio project → Play hears four different timbres  
2. Click piano keys → selected channel auditions  
3. Import MIDI → map sources → notes appear on CH1–4  
4. Plug in a controller → select device → Rec + Play records notes  
5. Save pattern → reload project → notes still there  
6. Optional: copy project to a card volume and load on the module  

## Tests

```bash
python3 -m unittest discover -s tests -q
```

## Packaging

Desktop UI works on **macOS, Linux, and Windows** via `python3 -m blackseq --desktop` (pywebview).

A double-clickable **macOS `.app`** is built on a Mac (PyInstaller cannot cross-compile). The packaged binary stays out of git — ship it via **GitHub Releases**:

```bash
./packaging/build_macos.sh
open "dist/Black Sequencer.app"
# also writes dist/BlackSequencer-macOS.zip for the release asset
```

**When you want a downloadable build:** tag a version. Pushing `main` does not touch Releases — tags are just “cut a zip for the landing page.”

```bash
git tag v0.2.0
git push origin v0.2.0
```

That runs GitHub Actions on `macos-latest` and attaches `BlackSequencer-macOS.zip` to the Release. Skip tagging until you’re ready; run `./packaging/build_macos.sh` locally anytime. The Mac app is **unsigned** (fine for a free community tool — users may need right-click → Open once).

Linux/Windows can use `python3 -m blackseq --desktop` today; native installers would reuse `packaging/desktop_main.py` and must be built on each OS (PyInstaller does not cross-compile).

The macOS app seeds **DEMO BANK** and the factory rack into `~/Library/Application Support/BlackSequencer/` on first launch.

## Landing page (GitHub Pages)

Live site: **https://ph1r3574r73r.github.io/black_seq_gui/**  
(from the [`docs/`](docs/) folder — landing, [docs](docs/docs.html), download → latest Release)

1. **Settings → Pages → Build and deployment → GitHub Actions** (workflow: `.github/workflows/pages.yml`)  
2. Tag a release so Download has a zip (`git tag v0.2.0 && git push origin v0.2.0`)  

Local preview: `python3 -m http.server --directory docs`

## License

This project is dedicated to the **public domain** ([Unlicense](https://unlicense.org) — see [`LICENSE`](LICENSE)). Use it however you want.

Mutable Instruments preview DSP is separately MIT-licensed (Émilie Gillet); see [`THIRD_PARTY.md`](THIRD_PARTY.md). Not an Erica Synths product.
