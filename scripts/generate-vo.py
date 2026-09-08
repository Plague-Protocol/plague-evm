#!/usr/bin/env python3
"""
Generate the nine-line "Sector Seven" splash voiceover with ElevenLabs.

    pip install elevenlabs
    export ELEVENLABS_API_KEY=...
    ffmpeg + ffprobe on PATH

    python3 scripts/generate-vo.py --check     # one line, to audition the voice
    python3 scripts/generate-vo.py             # the full set

Writes:
    frontend/public/sounds/vo/line-1.mp3 ... line-9.mp3
    frontend/src/lib/vo-manifest.ts        (measured durations)

WHY THE MANIFEST EXISTS — read before changing anything here.

The splash types its captions at a fixed rate. Speech is far slower than that
rate: the typewriter's 44 ms/char works out to ~227 wpm, while a grim, composed
read lands around 130 wpm. Every single line therefore finishes typing well
before the voice finishes saying it, and the voice runs on over the next caption.

Rather than guess a slower typing rate and hope, this measures each rendered clip
and emits its real duration. The splash paces each line's typing from that
number, so caption and voice land together BY CONSTRUCTION — whatever read the
model gives you, and whatever you change the script to later.

That also means the manifest is the on/off switch. No clips, no manifest entries,
no voiceover — there is no flag to forget to flip.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Repo-root-relative, resolved from THIS file rather than the shell's cwd, so it
# does the same thing whatever directory you run it from.
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "sounds" / "vo"
MANIFEST_TS = ROOT / "frontend" / "src" / "lib" / "vo-manifest.ts"

# ── Voice ─────────────────────────────────────────────────────────────────────
# A mid-register male voice with no strong accent. "A man filing a report", not a
# performance — the horror is in what he says, not how hard he sells it.
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")

# ⚠ Audio tags in [brackets] are a v3 feature. On a model that does not support
# them the tags are READ ALOUD — you get "tense controlled Sector Seven Command".
# That is what --check is for: render one line and listen before spending the
# other eight.
MODEL_ID = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_v3")

# Low stability buys natural waver, which reads as barely-held-together without
# tipping into cartoon panic. It also makes every run different — once a take
# sounds right, KEEP IT. Re-running will not reproduce it.
VOICE_SETTINGS = {
    "stability": 0.35,
    "similarity_boost": 0.75,
    "style": 0.4,
    "use_speaker_boost": True,
}

# ── The script ────────────────────────────────────────────────────────────────
# Tags stay sparse — one or two a line. A run of vocal effects stops sounding
# like a person and starts sounding like a soundboard.
#
# ⚠ The plain text here must match STORY in frontend/src/components/ui/
# splash-screen.tsx. The captions are what most players actually get (mobile
# sessions run muted, and MiniPay's browser is muted by default), so the text is
# the floor and the voice is the enhancement — they must not drift apart.
LINES = [
    ("line-1", "[tense, controlled] Sector Seven Command. If you hear this, [shaky breath] you are inside."),
    ("line-2", "[flat, reporting] Day 3 — we sealed the district. Two patients. High fever."),
    # The splash fires its scream sting 500 ms into this line, so it opens with
    # air rather than a word landing under the sting.
    ("line-3", "[pause] [strained] Day 7 — the hospitals stopped counting."),
    ("line-4", "[steady, formal] We declared full containment. I signed that order myself."),
    # Shortest line in the set, and the admission the whole cold open turns on.
    # Flattest possible delivery: no emphasis, just dropped in.
    ("line-5", "[flat, no emphasis] We lied."),
    ("line-6", "[low, urgent] It was already past the walls. [quiet dread] It came wearing our faces."),
    ("line-7", "[controlled, grim] Someone in your room carried it in. They look fine."),
    ("line-8", "[cold, final] One of you is Patient Zero."),
]

# Line 9 is the tell, and it is two different people in one breath: the commander
# giving his last order, then — after a real pause — the thing he has not told
# anyone, said off-mic as if he forgot the transmitter was open. Rendered as two
# takes so the registers are genuinely different rather than one read with a
# comma in it.
LINE_9_COMMAND = "[full command voice, clipped] Trust no one. Find them first."
LINE_9_WHISPER = "[much quieter, further off-mic, distracted, as if the mic was forgotten] ...it is so cold in here."
LINE_9_PAUSE_S = 0.9

# ── Audio format ──────────────────────────────────────────────────────────────
# 22.05 kHz mono at 56 kbps. The band-pass below throws away everything above
# 3.4 kHz anyway, so a higher rate would only be storing silence. The whole set
# lands around 170 KB, inside the ~300 KB budget the splash was designed for.
SAMPLE_RATE = 22050
BITRATE = "56k"
# Telephone/field-radio band. The degradation is the costume: it makes a
# synthetic voice MORE convincing, not less, because a clean synthetic read is
# where the uncanny valley lives.
RADIO_FILTER = "highpass=f=180,lowpass=f=3400"
# loudnorm, not a bare compressor: the set has to sit at one consistent level
# under the ambient bed, and nine separately-generated clips will not.
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


def synth(client, text: str, out_path: Path) -> None:
    audio = client.text_to_speech.convert(
        voice_id=VOICE_ID,
        model_id=MODEL_ID,
        text=text,
        voice_settings=VOICE_SETTINGS,
        output_format="mp3_44100_128",  # render high, degrade deliberately below
    )
    with open(out_path, "wb") as f:
        for chunk in audio:
            f.write(chunk)


def postprocess(src: Path, dst: Path, extra: str = "") -> None:
    chain = ",".join(filter(None, [RADIO_FILTER, extra, LOUDNESS]))
    run(["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", str(SAMPLE_RATE),
         "-b:a", BITRATE, "-af", chain, str(dst)])


def build_line_9(client, tmp: Path, dst: Path) -> None:
    cmd_raw, whisper_raw = tmp / "l9c_raw.mp3", tmp / "l9w_raw.mp3"
    synth(client, LINE_9_COMMAND, cmd_raw)
    synth(client, LINE_9_WHISPER, whisper_raw)

    cmd_p, whisper_p = tmp / "l9c.mp3", tmp / "l9w.mp3"
    postprocess(cmd_raw, cmd_p)
    # Pushed further back than the shared chain allows, and rolled off harder —
    # off-mic means duller, not just quieter.
    postprocess(whisper_raw, whisper_p, extra="lowpass=f=3000,volume=0.55")

    silence = tmp / "pause.mp3"
    run(["ffmpeg", "-y", "-f", "lavfi", "-i",
         f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", str(LINE_9_PAUSE_S),
         "-b:a", BITRATE, str(silence)])

    # Concat via the filter graph with a re-encode, NOT `-c copy`. A copy-concat
    # of separately-encoded MP3s splices streams whose encoder delay and frame
    # boundaries do not line up, which shows up as a click or a swallowed
    # syllable exactly at the pause — i.e. on the most important beat in the set.
    run(["ffmpeg", "-y", "-i", str(cmd_p), "-i", str(silence), "-i", str(whisper_p),
         "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
         "-map", "[out]", "-ac", "1", "-ar", str(SAMPLE_RATE), "-b:a", BITRATE,
         str(dst)])


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


def from_recordings(src_dir: Path) -> int:
    """
    Run your own takes through the same pipeline as the generated set.

    WHY THIS PATH EXISTS
    The radio treatment is doing a great deal of work, and it works in a
    home-recorder's favour: the band-pass throws away everything below 180 Hz and
    above 3.4 kHz, which is exactly where cheap-microphone problems live — room
    boom, sibilance, hiss, the thinness of a phone capsule. A voice memo through
    this chain lands much closer to "field radio" than an untreated studio take
    would, because the degradation IS the costume.

    So the honest comparison is not "my phone vs ElevenLabs". It is "my phone,
    band-limited and compressed, vs ElevenLabs, band-limited and compressed" —
    and on the one line that matters (the tell in line 9, where a composed man
    has to slip register without announcing it), a real person under-performing
    beats a model over-performing almost every time.

    ⚠ Do not mix sources. Eight synthetic lines and one human line is more
    jarring than nine of either, because the listener tracks a voice, not a
    performance. Pick one and record the whole set.

    Accepts line-1..line-9 in anything ffmpeg reads. Loudness is normalised
    across the set, so takes recorded at different distances still sit level.
    """
    missing = [i for i in range(1, 10)
               if not any((src_dir / f"line-{i}{e}").exists()
                          for e in (".wav", ".m4a", ".mp3", ".aiff", ".flac", ".ogg"))]
    if missing:
        print(f"Missing takes for line(s): {', '.join(map(str, missing))}", file=sys.stderr)
        print(f"Expected line-N.<wav|m4a|mp3|aiff|flac|ogg> in {src_dir}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    durations: list[int] = []
    for i in range(1, 10):
        src = next(src_dir / f"line-{i}{e}" for e in (".wav", ".m4a", ".mp3", ".aiff", ".flac", ".ogg")
                   if (src_dir / f"line-{i}{e}").exists())
        dst = OUT_DIR / f"line-{i}.mp3"
        postprocess(src, dst)
        ms = duration_ms(dst)
        durations.append(ms)
        print(f"  line-{i}.mp3  {ms:>5} ms   <- {src.name}")

    write_manifest(durations)
    total = sum((OUT_DIR / f"line-{i}.mp3").stat().st_size for i in range(1, 10))
    print(f"\nSet: {total / 1024:.1f} KB (budget ~300 KB), {sum(durations) / 1000:.1f}s of audio")
    print(f"Manifest: {MANIFEST_TS.relative_to(ROOT)}")
    print("Captions now pace themselves to these durations. Nothing else to switch on.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", nargs="?", type=int, const=1, metavar="N",
                    help="render only line N (default 1) to audition the voice. "
                         "Note line 5 is DIRECTED FLAT and is a poor test of "
                         "atmosphere — use 1, 6 or 9 to judge the read.")
    ap.add_argument("--from-recordings", metavar="DIR",
                    help="skip TTS entirely: run your own takes through the same "
                         "radio treatment, loudness pass and duration manifest. "
                         "DIR must hold line-1..line-9 in any format ffmpeg reads "
                         "(.wav/.m4a/.mp3 — a phone voice memo is fine).")
    args = ap.parse_args()

    # Your own takes need no API key and no network — check before the key gate.
    if args.from_recordings:
        return from_recordings(Path(args.from_recordings).expanduser().resolve())

    if not os.environ.get("ELEVENLABS_API_KEY"):
        print("Set ELEVENLABS_API_KEY first.", file=sys.stderr)
        return 1
    try:
        from elevenlabs.client import ElevenLabs
    except ImportError:
        print("pip install elevenlabs", file=sys.stderr)
        return 1

    client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        if args.check is not None:
            n = max(1, min(9, args.check))
            if n == 9:
                dst = OUT_DIR / "line-9.mp3"
                build_line_9(client, tmp, dst)
            else:
                name, text = LINES[n - 1]
                raw = tmp / "check_raw.mp3"
                synth(client, text, raw)
                dst = OUT_DIR / f"{name}.mp3"
                postprocess(raw, dst)
            print(f"wrote {dst}  ({duration_ms(dst)} ms)")
            if n == 5:
                print("\n⚠ Line 5 is DIRECTED FLAT — deliberately no weight, no fear.")
                print("  It is the admission, not the warning. Judge the voice on 1, 6 or 9.")
            print("\nIf you hear the bracket words themselves ('tense', 'controlled'),")
            print("this model is reading tags aloud — change ELEVENLABS_MODEL_ID.")
            return 0

        durations: list[int] = []
        for name, text in LINES:
            raw = tmp / f"{name}_raw.mp3"
            synth(client, text, raw)
            dst = OUT_DIR / f"{name}.mp3"
            postprocess(raw, dst)
            ms = duration_ms(dst)
            durations.append(ms)
            print(f"  {name}.mp3  {ms:>5} ms")

        dst9 = OUT_DIR / "line-9.mp3"
        build_line_9(client, tmp, dst9)
        ms9 = duration_ms(dst9)
        durations.append(ms9)
        print(f"  line-9.mp3  {ms9:>5} ms  (command + {LINE_9_PAUSE_S}s + off-mic)")

    write_manifest(durations)

    total = sum((OUT_DIR / f"line-{i}.mp3").stat().st_size for i in range(1, 10))
    print(f"\nSet: {total / 1024:.1f} KB (budget ~300 KB), {sum(durations) / 1000:.1f}s of audio")
    print(f"Manifest: {MANIFEST_TS.relative_to(ROOT)}")
    print("Captions now pace themselves to these durations. Nothing else to switch on.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
