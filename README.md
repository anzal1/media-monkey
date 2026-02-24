# Media Monkey 🐵

> Zero-input, AI-powered faceless video factory for Instagram Reels

Run `python main.py` with **zero arguments** — it scrapes live trending topics from the web, writes a script, generates a voice, creates AI images, and renders a cinematic video. Add `-p` to auto-post to Instagram.

**Pipeline:** Gemini + Google Search (live trends) → Gemini 2.5 Pro (script) → ElevenLabs v3 (expressive voice with audio tags) → Gemini Imagen (Nano Banana scene images) → ffmpeg + Pillow (Ken Burns zoom/pan, crossfade transitions, burned captions) → Instagram Reels.

## Architecture

```
🌐 Live Trend Scraping (Gemini + Google Search)
    │
    ▼
┌──────────────────┐
│ Topic Picker     │  ← Real-time trends (tech/fun/memes/science/...)
└──────┬───────────┘    with hardcoded fallback bank
       ▼
┌──────────────────┐
│ Script Generator │  ← Gemini 2.5 Pro · Hindi & English · audio tags
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Voice Generator  │  ← ElevenLabs v3 · random voice · [whispering] [dramatic]
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Image Generator  │  ← Gemini Imagen · Nano Banana prompt style · 5-8 scenes
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Caption Generator│  ← Whisper · word-level timestamps · 3-word viral chunks
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Video Builder    │  ← Pure ffmpeg + Pillow (no MoviePy/ImageMagick)
│                  │     Ken Burns zoom/pan · crossfade transitions
│                  │     yellow viral captions · audio muxing
└──────┬───────────┘
       ▼
┌──────────────────┐
│ Publisher        │  ← Instagram Reels (instagrapi) + hashtags
└──────────────────┘
```

## Quick Start

```bash
cd media-monkey

# Create virtual env (Python 3.13 recommended)
python3 -m venv .venv && source .venv/bin/activate

# Install deps
pip install -r requirements.txt

# Set your API keys
cp .env.example .env   # then edit with your keys
# Required: GEMINI_API_KEY, ELEVENLABS_API_KEY

# 🚀 Full auto-pilot — picks a live trending topic and makes a video
python main.py

# Auto-pilot + auto-post to Instagram
python main.py -p

# Or specify a topic manually
python main.py -t "5 mind-blowing psychology facts"

# Pick a random topic from a specific category
python main.py -c tech
python main.py -c fun
python main.py -c science

# Generate in Hindi
python main.py -l hi

# Combine options
python main.py -c trending -l hi -s news_recap
```

## CLI Options

| Flag                  | Description                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `-t, --topic TEXT`    | Custom topic. If omitted, a live trending topic is auto-picked.                                                                  |
| `-s, --style STYLE`   | Content style (see below). Auto-matched in auto-pilot mode.                                                                      |
| `-c, --category CAT`  | Narrow random pick to a category: `fun`, `tech`, `science`, `psychology`, `money`, `history`, `health`, `motivation`, `trending` |
| `-l, --lang [en\|hi]` | Language — English or Hindi. Defaults to `.env` `LANGUAGE` setting.                                                              |
| `-p, --publish`       | Auto-publish to enabled platforms after generation.                                                                              |
| `--no-captions`       | Skip Whisper caption generation.                                                                                                 |
| `--use-stock`         | Use Pexels stock footage instead of AI images.                                                                                   |

## Topic Categories

Media Monkey covers **9 categories**, each with 10-15 curated topics as fallback and **live web trend scraping** as primary:

| Category          | Examples                                                         |
| ----------------- | ---------------------------------------------------------------- |
| 🎮 **tech**       | AI breakthroughs, gadget launches, cybersecurity, app updates    |
| 😂 **fun**        | Bizarre news, weird records, funny fails, "did you know"         |
| 🔬 **science**    | Space discoveries, medical breakthroughs, mind-blowing research  |
| 🧠 **psychology** | Dark psychology, body language, productivity, manipulation signs |
| 💰 **money**      | Side hustles, crypto, investing, money habits                    |
| 📜 **history**    | Unsolved mysteries, declassified secrets, archaeological finds   |
| 🏥 **health**     | Diet trends, sleep science, body warning signs                   |
| 🔥 **motivation** | Success stories, productivity methods, mindset shifts            |
| 📱 **trending**   | Viral memes, internet drama, challenges, celebrity moments       |

## Content Styles

| Style               | Best For                                      |
| ------------------- | --------------------------------------------- |
| `fun_facts`         | Quick entertaining facts with punchy delivery |
| `top5_listicle`     | Countdown-style "top 5" content               |
| `did_you_know`      | Curiosity-driven educational shorts           |
| `news_recap`        | Trending news summaries                       |
| `motivational`      | Inspirational storytelling                    |
| `scary_stories`     | Dark/mysterious narration                     |
| `reddit_stories`    | Story-time narration over visuals             |
| `fun_entertainment` | Light, funny, casual content                  |
| `tech_explainer`    | Tech news and explainers                      |
| `trending_now`      | Hot-off-the-press viral content               |

## Video Features

- **Ken Burns effect** — every scene has smooth zoom/pan animation (8 effect types: zoom in, zoom out, pan left/right/up/down, combo movements)
- **Crossfade transitions** — 0.6s smooth blending between scenes (no hard cuts)
- **Viral-style captions** — yellow text, black outline, 3-word punchy chunks burned onto every frame
- **Expressive voiceover** — ElevenLabs v3 with audio tags (`[whispering]`, `[dramatic]`, `[excited]`, `[laughing]`, etc.)
- **Random voice rotation** — different voice every run for variety
- **Hindi support** — Devanagari script generation, Hindi TTS, Hindi captions
- **Proper audio muxing** — voiceover + optional background music properly mixed into the final video

## Configuration

Copy `.env.example` → `.env` and fill in:

| Key                        | Description                                            | Required                 |
| -------------------------- | ------------------------------------------------------ | ------------------------ |
| `GEMINI_API_KEY`           | Gemini 2.5 Pro for scripts, images, and trend scraping | **Yes**                  |
| `ELEVENLABS_API_KEY`       | ElevenLabs v3 voice generation                         | **Yes**                  |
| `INSTAGRAM_USERNAME`       | Instagram login                                        | **Yes** (for posting)    |
| `INSTAGRAM_PASSWORD`       | Instagram password                                     | **Yes** (for posting)    |
| `INSTAGRAM_TOTP_SECRET`    | 2FA secret key (see setup below)                       | **Yes** (for posting)    |
| `INSTAGRAM_UPLOAD_ENABLED` | `true` to enable Instagram publishing                  | Default: `true`          |
| `LANGUAGE`                 | Default language: `en` or `hi`                         | Optional (default: `en`) |
| `PEXELS_API_KEY`           | Stock video fallback                                   | Optional                 |

### Instagram 2FA Setup (Required)

Instagram blocks automated logins from new IPs/devices. The proven fix is **enabling 2FA** so the bot can prove its identity with a TOTP code.

1. Open Instagram → **Settings → Accounts Center → Password and security → Two-factor authentication**
2. Select your account → Choose **Authentication app**
3. Tap **"Can't scan QR code?"** or **"Set up manually"** to reveal the **secret key** (a text string like `ABCD EFGH IJKL MNOP`)
4. **Copy that secret key** — this is your `INSTAGRAM_TOTP_SECRET`
5. Also add the key to an authenticator app (Google Authenticator, Authy, etc.) so you can still log in manually
6. Complete the Instagram 2FA setup by entering a code from the authenticator app
7. Add the secret to your `.env`:
   ```
   INSTAGRAM_TOTP_SECRET=ABCDEFGHIJKLMNOP
   ```
8. For GitHub Actions, also add it as a repository secret (see below)

## Tech Stack

| Component            | Technology                                                   |
| -------------------- | ------------------------------------------------------------ |
| Script generation    | **Gemini 2.5 Pro** (google-genai SDK)                        |
| Live trend discovery | **Gemini + Google Search** grounding                         |
| Voice synthesis      | **ElevenLabs v3** with audio tags                            |
| Image generation     | **Gemini Imagen** (Nano Banana prompt style)                 |
| Video rendering      | **ffmpeg** (raw RGB pipe) + **Pillow** (Ken Burns, captions) |
| Captions             | **OpenAI Whisper** (word-level timestamps)                   |
| Stock footage        | **Pexels API** (fallback)                                    |
| Publishing           | **instagrapi** + **pyotp** 2FA (Instagram Reels)             |
| Automation           | **GitHub Actions** (daily cron → Instagram)                  |
| Runtime              | **Python 3.13**                                              |

## Project Structure

```
media-monkey/
├── main.py                    # CLI entry point (auto-pilot or manual)
├── config.py                  # Settings & env loading
├── requirements.txt
├── .env                       # API keys (not committed)
├── .github/
│   └── workflows/
│       └── generate-video.yml # Daily GitHub Actions cron
├── pipeline/
│   ├── __init__.py
│   ├── trend_scraper.py       # 🌐 Live trend discovery (Gemini + Google Search)
│   ├── topic_picker.py        # 🎯 Smart topic selection (live → fallback)
│   ├── script_generator.py    # 📝 Gemini script writing (EN/HI, audio tags)
│   ├── voice_generator.py     # 🎙️ ElevenLabs v3 TTS (random voice)
│   ├── image_generator.py     # 🎨 Gemini Imagen (Nano Banana style)
│   ├── visual_generator.py    # 🎬 Pexels stock footage (fallback)
│   ├── video_builder.py       # 🎥 ffmpeg + Pillow (Ken Burns, crossfade, captions)
│   ├── caption_generator.py   # 💬 Whisper word-level subtitles
│   └── publisher.py           # 📤 Instagram Reels upload + hashtags
├── assets/
│   ├── fonts/
│   ├── music/                 # Drop .mp3 files here for background music
│   └── overlays/
├── output/                    # Generated videos (timestamped folders)
└── templates/
    └── prompts/
```

## GitHub Actions — Auto-Post 3x Daily

The repo includes a workflow that generates and posts a Reel to Instagram **3 times a day** (8 AM, 2 PM, 8 PM UTC) for maximum engagement.

**Setup (one time):**

1. Go to your repo → **Settings → Secrets and variables → Actions**
2. Add these **Repository secrets**:

| Secret                  | Value                           |
| ----------------------- | ------------------------------- |
| `GEMINI_API_KEY`        | Your Gemini API key             |
| `ELEVENLABS_API_KEY`    | Your ElevenLabs API key         |
| `INSTAGRAM_USERNAME`    | Your Instagram username         |
| `INSTAGRAM_PASSWORD`    | Your Instagram password         |
| `INSTAGRAM_TOTP_SECRET` | Your 2FA secret key (see above) |

3. The workflow runs on schedule automatically. You can also trigger it manually:
   - Go to **Actions → 🐵 Media Monkey — Instagram Reels → Run workflow**
   - Optionally pick a topic, category, style, or language

The Instagram session is cached between runs to avoid repeated login challenges.

## License

MIT
