"""Voice Generator — ElevenLabs TTS with Eleven v3 (audio tag support) and random voice selection.

Supports multilingual narration — ElevenLabs v3 handles Hindi, English, and 29+ languages.
"""

import random
from pathlib import Path
from elevenlabs import ElevenLabs

from config import ELEVENLABS_API_KEY, ELEVENLABS_MODEL

# Eleven v3 has a 5,000 character limit per request
MAX_CHARS = 5000

# Cache voices so we don't re-fetch every run in the same session
_voices_cache: dict[str, list[dict]] = {}


def _get_available_voices(client: ElevenLabs, language: str = "en") -> list[dict]:
    """Fetch available premade voices, optionally filtered by language."""
    cache_key = language
    if cache_key in _voices_cache:
        return _voices_cache[cache_key]

    # Try language-specific search first (for Hindi, etc.)
    search_kwargs = {"page_size": 100, "category": "premade"}
    if language != "en":
        search_kwargs["language"] = language

    try:
        response = client.voices.search(**search_kwargs)
        voices = [
            {
                "voice_id": v.voice_id,
                "name": v.name,
                "labels": v.labels or {},
            }
            for v in response.voices
        ]
    except Exception:
        voices = []

    # Fallback: if no language-specific voices found, use all premade
    if not voices:
        try:
            response = client.voices.search(page_size=100, category="premade")
            voices = [
                {
                    "voice_id": v.voice_id,
                    "name": v.name,
                    "labels": v.labels or {},
                }
                for v in response.voices
            ]
        except Exception:
            voices = []

    _voices_cache[cache_key] = voices
    return voices


def _pick_random_voice(client: ElevenLabs, language: str = "en") -> dict:
    """Pick a random voice from available ElevenLabs premade voices."""
    voices = _get_available_voices(client, language)
    if not voices:
        # Fallback to a known good voice
        return {"voice_id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "labels": {}}

    chosen = random.choice(voices)
    return chosen


async def generate_voice(
    text: str,
    output_path: Path,
    language: str = "en",
) -> tuple[Path, dict]:
    """
    Generate voice using ElevenLabs Eleven v3 with a randomly selected voice.

    Eleven v3 supports audio tags like [laughing], [whispering], [sigh], [excited]
    embedded directly in the text for expressive delivery.

    ElevenLabs v3 is multilingual — it automatically detects Hindi, English, etc.
    from the text and produces native-sounding speech.

    Returns:
        tuple of (audio_file_path, voice_info_dict)
    """
    client = ElevenLabs(api_key=ELEVENLABS_API_KEY)

    # Pick a random voice (language-aware selection)
    voice = _pick_random_voice(client, language)
    print(f"  🎤 Selected voice: {voice['name']} ({voice.get('labels', {}).get('gender', '?')}, "
          f"{voice.get('labels', {}).get('accent', '?')}) for lang={language}")

    # Enforce character limit for Eleven v3
    if len(text) > MAX_CHARS:
        print(
            f"  ⚠️  Script is {len(text)} chars, truncating to {MAX_CHARS} for Eleven v3 limit")
        text = text[:MAX_CHARS]

    # Generate audio — Eleven v3 natively interprets [audio tags] in the text
    # and auto-detects the script language (Hindi, English, etc.)
    audio_iterator = client.text_to_speech.convert(
        voice_id=voice["voice_id"],
        text=text,
        model_id=ELEVENLABS_MODEL,
        output_format="mp3_44100_128",
    )

    # Write audio bytes to file
    with open(output_path, "wb") as f:
        for chunk in audio_iterator:
            f.write(chunk)

    return output_path, voice
