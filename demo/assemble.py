#!/usr/bin/env python3
"""Assemble a truthful, captioned 180-second PARALLAX demonstration.

Requires Python 3 and FFmpeg with libass. Voice and raw screen recording stay
outside Git; this script and the final caption transcript are reproducible.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def seconds(value: str) -> float:
    hours, minutes, remainder = value.replace(",", ".").split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(remainder)


def timestamp(value: float, ass: bool = False) -> str:
    scale = 100 if ass else 1000
    ticks = round(value * scale)
    hours, ticks = divmod(ticks, 3600 * scale)
    minutes, ticks = divmod(ticks, 60 * scale)
    whole, fraction = divmod(ticks, scale)
    if ass:
        return f"{hours}:{minutes:02}:{whole:02}.{fraction:02}"
    return f"{hours:02}:{minutes:02}:{whole:02},{fraction:03}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--captions", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("output/video/PARALLAX-Demo.mp4"))
    args = parser.parse_args()
    for source in (args.video, args.audio, args.captions):
        if not source.is_file():
            raise SystemExit(f"Missing input: {source}")

    cues = []
    for block in re.split(r"\n\s*\n", args.captions.read_text().strip()):
        lines = block.splitlines()
        if len(lines) < 3 or " --> " not in lines[1]:
            raise SystemExit("The source captions must be a valid SRT transcript.")
        start, end = lines[1].split(" --> ")
        body = " ".join(lines[2:])
        body = re.sub(r"PAIR-uh-lax", "PARALLAX", body)
        body = re.sub(r"FAL-kor\s+dee bee", "FalkorDB", body)
        body = re.sub(r"em see\s+pee", "MCP", body)
        if any(character in body for character in "{}\\"):
            raise SystemExit("Caption text must not contain ASS control sequences.")
        wrapped = [body]
        if len(body) > 76:
            words = body.split()
            splits = [(" ".join(words[:index]), " ".join(words[index:])) for index in range(1, len(words))]
            splits = [pair for pair in splits if max(map(len, pair)) <= 76]
            if not splits:
                raise SystemExit("Shorten this cue to fit the two-line caption band: " + body)
            wrapped = list(min(splits, key=lambda pair: abs(len(pair[0]) - len(pair[1]))))
        cues.append((seconds(start), seconds(end), wrapped))
    if not cues:
        raise SystemExit("No captions were found.")

    # Keep the original pauses and pitch, add a two-second lead, and place the
    # last word at 178 seconds. The final two seconds hold the closing card.
    tempo = cues[-1][1] / 176
    if not 0.5 <= tempo <= 2:
        raise SystemExit("Narration is too short or long for this presentation.")
    cues = [(2 + start / tempo, 2 + end / tempo, body) for start, end, body in cues]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    caption_path = args.output.with_suffix(".srt")
    ass_path = args.output.parent / "PARALLAX-Captions.ass"
    caption_path.write_text("\n\n".join(
        f"{index}\n{timestamp(start)} --> {timestamp(end)}\n" + "\n".join(body)
        for index, (start, end, body) in enumerate(cues, 1)
    ) + "\n", encoding="utf-8")
    ass_header = """[Script Info]
Title: PARALLAX — Find the gap in agreement
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,34,&H00F7F8FA,&H00F7F8FA,&H000C111B,&H000C111B,0,0,0,0,100,100,0,0,1,0,0,2,90,90,8,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for start, end, body in cues:
        events.append(f"Dialogue: 0,{timestamp(start, True)},{timestamp(end, True)},Default,,0,0,0,," + r"\N".join(body))
    ass_path.write_text(ass_header + "\n".join(events) + "\n", encoding="utf-8")

    # Pass the ASS file by a predictable relative filename, avoiding FFmpeg's
    # separate filter-path escaping rules for user-supplied directories.
    video = args.video.resolve()
    audio = args.audio.resolve()
    destination = args.output.resolve()
    filters = (
        "[0:v]scale=1760:990:flags=lanczos,setsar=1,"
        "pad=1920:1080:80:0:color=0x0c111b,"
        "tpad=stop_mode=clone:stop_duration=180,trim=duration=180,"
        "setpts=PTS-STARTPTS,ass=" + ass_path.name + "[v];"
        f"[1:a]atempo={tempo:.10f},adelay=2000:all=1,apad,atrim=0:180,"
        "loudnorm=I=-16:TP=-1.5:LRA=11[a]"
    )
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
        "-i", str(video), "-i", str(audio), "-filter_complex", filters,
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium",
        "-crf", "18", "-pix_fmt", "yuv420p", "-r", "25", "-c:a", "aac",
        "-b:a", "160k", "-ar", "48000", "-t", "180", "-movflags", "+faststart",
        "-metadata", "title=PARALLAX — Find the gap in agreement",
        "-metadata", "comment=Synthetic demo; real FalkorDB; guided MCP; local browser recording; AI-generated Dolores narration.",
        str(destination),
    ]
    subprocess.run(command, cwd=destination.parent, check=True)
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_name,codec_type,width,height,duration",
        "-of", "json", str(destination)
    ], capture_output=True, text=True, check=True)
    report = json.loads(probe.stdout)
    duration = float(report["format"]["duration"])
    streams = report["streams"]
    assert abs(duration - 180) < 0.05, f"Unexpected duration: {duration}"
    assert any(stream.get("width") == 1920 and stream.get("height") == 1080 for stream in streams)
    assert any(stream["codec_type"] == "audio" for stream in streams)
    report.update({
        "title": "PARALLAX narrated walkthrough",
        "tempo": tempo,
        "captionCues": len(cues),
        "lastCaptionEnd": cues[-1][1],
        "captionBandPixels": 90,
        "disclosure": "Synthetic demo; real FalkorDB; guided MCP; local browser recording; AI-generated Dolores narration.",
    })
    destination.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"video": str(destination), "captions": str(caption_path.resolve()), "verification": report}, indent=2))


if __name__ == "__main__":
    main()
