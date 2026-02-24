"""Caption Generator — generates word-level subtitles using Whisper.

Supports English and Hindi with language-aware transcription and
shorter word chunks for viral-style captions.
"""

import json
from pathlib import Path


def generate_captions(
    audio_path: Path,
    output_srt_path: Path,
    language: str = "en",
) -> Path:
    """Generate SRT captions from audio using OpenAI Whisper."""
    import whisper

    model = whisper.load_model("base")
    result = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        language=language,  # "en" or "hi"
    )

    # Build SRT from word-level timestamps
    # Use smaller chunks (3 words) for punchier, viral-style captions
    srt_entries = []
    idx = 1
    chunk_size = 3

    for segment in result.get("segments", []):
        words = segment.get("words", [])
        for i in range(0, len(words), chunk_size):
            chunk = words[i: i + chunk_size]
            if not chunk:
                continue

            start_time = chunk[0]["start"]
            end_time = chunk[-1]["end"]
            text = " ".join(w["word"].strip() for w in chunk)

            srt_entries.append(
                f"{idx}\n"
                f"{_format_timestamp(start_time)} --> {_format_timestamp(end_time)}\n"
                f"{text}\n"
            )
            idx += 1

    output_srt_path.write_text("\n".join(srt_entries), encoding="utf-8")
    return output_srt_path


def _format_timestamp(seconds: float) -> str:
    """Convert seconds to SRT timestamp format (HH:MM:SS,mmm)."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
