#!/usr/bin/env python3
"""
Process the nine-line "Sector Seven" splash voiceover from your own recordings.

    ffmpeg + ffprobe on PATH (no API key, no network, no dependencies)

    python3 scripts/generate-vo.py ~/Desktop/vo-takes

Reads:
    <dir>/line-1 .. line-9   in any format ffmpeg understands
                             (.wav .m4a .mp3 .aiff .flac .ogg — a phone voice
                             memo is fine)
Writes:
    frontend/public/sounds/vo/line-1.mp3 ... line-9.mp3
    frontend/src/lib/vo-manifest.ts        (measured durations)

WHY A HOME RECORDING IS THE RIGHT SOURCE

The radio treatment below does more work than it looks. Band-passing to
180 Hz–3.4 kHz discards exactly where cheap-microphone problems live: room
boom, sibilance, hiss, the thinness of a phone capsule. The degradation is
the costume — a voice memo through this chain lands closer to "field radio"
than an untreated studio take would.

What it cannot supply is the performance, which is the whole point of this
particular set. The speaker is composed. He is filing a report, and the horror
is in what he says rather than how hard it is sold — right up to the last
fragment of the last line, where a man who has been in command the entire time
lets slip that he is not going to be for much longer. That is a human thing to
do with a voice.

WHY THE MANIFEST EXISTS

The splash types its captions at a fixed rate. Speech is far slower: 44 ms/char
works out to ~227 wpm, while a composed, grim read lands around 130. Every line
therefore finished typing well before the voice finished saying it, and ran on
over the next caption.

So each clip is MEASURED and its real duration emitted. The splash paces each
line's typing from that number, and caption and voice land together by
construction — whatever read you give it.

The manifest is also the on/off switch. No clips, no entries, no voiceover.
There is no flag to forget to flip.

RECORDING NOTES

  - One take, one file, nine files. Do not mix sources: eight of one voice and
    one of another is more jarring than nine of either, because a listener
    tracks the voice, not the performance.
  - Levels are normalised across the set, so takes at different distances from
    the microphone still sit level. Do not try to match them by ear.
  - Line 3 opens under a scream sting fired 500 ms in — leave a beat of air at
    the front rather than starting on the word.
  - Line 5 ("We lied.") is the flattest line in the set. No weight, no fear:
    it is an admission, not a warning.
  - Line 9 is two people. Give the order in full command voice, take a real
    pause, then say the last fragment quieter and further off the microphone,
    as though you had forgotten the transmitter was still open. Do not act it.
"""

import argparse
import subprocess
import sys
from pathlib import Path

# Repo-root-relative, resolved from THIS file rather than the shell's cwd, so it
# does the same thing whatever directory you run it from.
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "sounds" / "vo"
MANIFEST_TS = ROOT / "frontend" / "src" / "lib" / "vo-manifest.ts"

SOURCE_EXTS = (".wav", ".m4a", ".mp3", ".aiff", ".flac", ".ogg")

# ── Audio format ──────────────────────────────────────────────────────────────
# 22.05 kHz mono at 56 kbps. The band-pass throws away everything above 3.4 kHz
# anyway, so a higher rate would only store silence. The whole set lands around
# 170 KB, inside the ~300 KB budget the splash was designed for.
SAMPLE_RATE = 22050
BITRATE = "56k"
# Telephone/field-radio band — see the note above on why this flatters a home
# recording rather than exposing it.
RADIO_FILTER = "highpass=f=180,lowpass=f=3400"
# loudnorm, not a bare compressor: nine separately recorded takes will not sit
# at one level on their own, and they have to sit under the ambient bed.
LOUDNESS = "loudnorm=I=-18:TP=-2:LRA=11"


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def duration_ms(path: Path) -> int:
    """Measured, not estimated — this number is what the captions are paced to."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True,
    )
    return int(round(float(out.stdout.strip()) * 1000))


def postprocess(src: Path, dst: Path) -> None:
    """Downmix, band-limit to radio, normalise level, encode."""
    chain = f"{RADIO_FILTER},{LOUDNESS}"
    run(["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", str(SAMPLE_RATE),
         "-b:a", BITRATE, "-af", chain, str(dst)])


def find_take(src_dir: Path, line: int) -> Path | None:
    for ext in SOURCE_EXTS:
        candidate = src_dir / f"line-{line}{ext}"
        if candidate.exists():
            return candidate
    return None


def write_manifest(durations: list[int]) -> None:
    body = ",\n  ".join(str(d) for d in durations)
    MANIFEST_TS.write_text(
        "/**\n"
        " * vo-manifest.ts — GENERATED by scripts/generate-vo.py. Do not edit by hand.\n"
        " *\n"
        " * Measured duration, in ms, of each splash voiceover clip.\n"
        " *\n"
        " * The splash paces each caption's typing from these numbers so the text\n"
        " * finishes exactly when the voice does. Without them the captions run at a\n"
        " * fixed 44 ms/char — about 227 wpm — while a grim read lands nearer 130, so\n"
        " * every line finished typing early and the voice talked over the next one.\n"
        " *\n"
        " * An EMPTY array is the off switch: no clips, no voiceover, and the splash\n"
        " * falls back to its own typing rate. There is no separate flag.\n"
        " */\n"
        f"export const VO_DURATIONS_MS: readonly number[] = [\n  {body}\n]\n",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Process your own splash voiceover takes into the game's set.")
    ap.add_argument("src", metavar="DIR",
                    help="directory holding line-1..line-9 in any format ffmpeg reads")
    ap.add_argument("--only", type=int, metavar="N",
                    help="process just line N, to audition a take before recording "
                         "the rest. Does not touch the manifest.")
    args = ap.parse_args()

    src_dir = Path(args.src).expanduser().resolve()
    if not src_dir.is_dir():
        print(f"Not a directory: {src_dir}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if args.only:
        n = max(1, min(9, args.only))
        take = find_take(src_dir, n)
        if not take:
            print(f"No line-{n}.* in {src_dir}", file=sys.stderr)
            return 1
        dst = OUT_DIR / f"line-{n}.mp3"
        postprocess(take, dst)
        print(f"{dst}  ({duration_ms(dst)} ms)  <- {take.name}")
        # Deliberately no manifest write: a partial set would switch the
        # voiceover on with eight lines missing.
        print("\nAudition only — manifest untouched, voiceover still off.")
        return 0

    missing = [i for i in range(1, 10) if not find_take(src_dir, i)]
    if missing:
        print(f"Missing take(s) for line(s): {', '.join(map(str, missing))}", file=sys.stderr)
        print(f"Expected line-N.<{'|'.join(e[1:] for e in SOURCE_EXTS)}> in {src_dir}",
              file=sys.stderr)
        # All or nothing: a partial set would leave the splash voicing some
        # captions and silently skipping others.
        return 1

    durations: list[int] = []
    for i in range(1, 10):
        take = find_take(src_dir, i)
        assert take is not None  # guarded above
        dst = OUT_DIR / f"line-{i}.mp3"
        postprocess(take, dst)
        ms = duration_ms(dst)
        durations.append(ms)
        print(f"  line-{i}.mp3  {ms:>5} ms   <- {take.name}")

    write_manifest(durations)

    total = sum((OUT_DIR / f"line-{i}.mp3").stat().st_size for i in range(1, 10))
    print(f"\nSet: {total / 1024:.1f} KB (budget ~300 KB), {sum(durations) / 1000:.1f}s of audio")
    print(f"Manifest: {MANIFEST_TS.relative_to(ROOT)}")
    print("Captions now pace themselves to these durations. Nothing else to switch on.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
