"""Media Monkey — Configuration loader."""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Paths ────────────────────────────────────
ROOT_DIR = Path(__file__).parent
ASSETS_DIR = ROOT_DIR / "assets"
OUTPUT_DIR = ROOT_DIR / os.getenv("OUTPUT_DIR", "output")
FONTS_DIR = ASSETS_DIR / "fonts"
MUSIC_DIR = ASSETS_DIR / "music"
PROMPTS_DIR = ROOT_DIR / "templates" / "prompts"

# Ensure directories exist
for d in [ASSETS_DIR, OUTPUT_DIR, FONTS_DIR, MUSIC_DIR, PROMPTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ── Language (en / hi) ───────────────────────
LANGUAGE = os.getenv("LANGUAGE", "en")

# ── LLM (Gemini — most advanced model) ──────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")

# ── TTS (ElevenLabs — random voice each run) ─
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_MODEL = os.getenv("ELEVENLABS_MODEL", "eleven_v3")

# ── Image Gen (Gemini Imagen — Nano Banana style) ─
IMAGE_MODEL = os.getenv("IMAGE_MODEL", "gemini-3-pro-image-preview")

# ── Stock Footage (Pexels — fallback backgrounds) ─
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY", "")

# ── Video Settings ───────────────────────────
VIDEO_WIDTH = int(os.getenv("VIDEO_WIDTH", "1080"))
VIDEO_HEIGHT = int(os.getenv("VIDEO_HEIGHT", "1920"))
VIDEO_FPS = int(os.getenv("VIDEO_FPS", "30"))
MAX_DURATION = int(os.getenv("MAX_DURATION_SECONDS", "59"))

# ── Publishing ───────────────────────────────
YOUTUBE_UPLOAD_ENABLED = os.getenv(
    "YOUTUBE_UPLOAD_ENABLED", "false").lower() == "true"
INSTAGRAM_UPLOAD_ENABLED = os.getenv(
    "INSTAGRAM_UPLOAD_ENABLED", "false").lower() == "true"
INSTAGRAM_USERNAME = os.getenv("INSTAGRAM_USERNAME", "")
INSTAGRAM_PASSWORD = os.getenv("INSTAGRAM_PASSWORD", "")
INSTAGRAM_TOTP_SECRET = os.getenv("INSTAGRAM_TOTP_SECRET", "")
