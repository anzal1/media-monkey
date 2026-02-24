"""Video Builder — cinematic video assembly with Ken Burns, crossfade transitions, and proper audio.

Produces captivating vertical short-form videos using only:
  - ffmpeg (bundled via imageio-ffmpeg) for video encoding and audio muxing
  - Pillow for Ken Burns animation, crossfade blending, and caption rendering
  - pydub for audio duration detection
"""

import random
import subprocess
import shutil
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pydub import AudioSegment

from config import VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_FPS, MAX_DURATION

# ── Ken Burns Configuration ───────────────────
KB_SCALE = 1.25  # Images scaled 25% larger than viewport for headroom
CROSSFADE_DURATION = 0.6  # Seconds of crossfade between scenes

KB_EFFECTS = [
    "zoom_in",              # Camera pushes in slowly
    "zoom_out",             # Camera pulls out slowly
    "pan_left",             # Camera pans left
    "pan_right",            # Camera pans right
    "pan_up",               # Camera tilts up
    "pan_down",             # Camera tilts down
    "zoom_in_pan_right",    # Push in + pan right (cinematic)
    "zoom_out_pan_left",    # Pull out + pan left (reveal)
]


def _smoothstep(t: float) -> float:
    """Hermite smoothstep — zero velocity at both endpoints for buttery motion."""
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


# ═══════════════════════════════════════════════
# System helpers
# ═══════════════════════════════════════════════

def _get_ffmpeg() -> str:
    """Return path to ffmpeg binary — uses system install or imageio-ffmpeg bundle."""
    system = shutil.which("ffmpeg")
    if system:
        return system
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise RuntimeError(
            "ffmpeg not found. Install via: brew install ffmpeg (macOS) / "
            "apt install ffmpeg (Linux) / pip install imageio-ffmpeg"
        )


def _get_font(size: int = 48, language: str = "en") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Find a usable bold font cross-platform, with Devanagari support for Hindi."""
    if language == "hi":
        candidates = [
            # macOS Devanagari
            "/System/Library/Fonts/Kohinoor.ttc",
            "/System/Library/Fonts/Supplemental/Devanagari MT Bold.ttf",
            "/System/Library/Fonts/Supplemental/Devanagari MT.ttf",
            "/Library/Fonts/NotoSansDevanagari-Bold.ttf",
            # Linux Devanagari
            "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
            "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf",
            # Unicode fallbacks
            "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
            "/usr/share/fonts/truetype/unifont/unifont.ttf",
        ]
    else:
        candidates = [
            # macOS
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial Bold.ttf",
            "/Library/Fonts/Arial.ttf",
            # Linux
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
            # Windows
            "C:/Windows/Fonts/arialbd.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ]

    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _audio_duration(audio_path: Path) -> float:
    """Get audio duration in seconds."""
    audio = AudioSegment.from_file(str(audio_path))
    return len(audio) / 1000.0


# ═══════════════════════════════════════════════
# Ken Burns engine
# ═══════════════════════════════════════════════

def _resize_for_ken_burns(img: Image.Image) -> Image.Image:
    """Resize image to KB_SCALE × viewport for Ken Burns headroom, center-crop."""
    target_w = int(VIDEO_WIDTH * KB_SCALE)
    target_h = int(VIDEO_HEIGHT * KB_SCALE)
    target_ratio = target_w / target_h
    img_ratio = img.width / img.height

    if img_ratio > target_ratio:
        new_h = target_h
        new_w = int(img.width * (target_h / img.height))
    else:
        new_w = target_w
        new_h = int(img.height * (target_w / img.width))

    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    return img.crop((left, top, left + target_w, top + target_h))


def _apply_ken_burns(img: Image.Image, effect: str, progress: float) -> Image.Image:
    """
    Apply Ken Burns (zoom/pan) animation to an oversized image.

    Args:
        img: Image at KB_SCALE × viewport size
        effect: One of KB_EFFECTS
        progress: 0.0 (scene start) → 1.0 (scene end)

    Returns:
        Cropped frame at exactly VIDEO_WIDTH × VIDEO_HEIGHT
    """
    t = _smoothstep(progress)
    iw, ih = img.size
    vw, vh = VIDEO_WIDTH, VIDEO_HEIGHT
    max_dx = iw - vw
    max_dy = ih - vh

    # Default: center crop at viewport size
    cx, cy, cw, ch = max_dx // 2, max_dy // 2, vw, vh

    if effect == "zoom_in":
        # Full image → tight center crop (camera pushes in)
        scale = 1.0 - t * (1.0 - vw / iw)
        cw = int(iw * scale)
        ch = int(ih * scale)
        cx = (iw - cw) // 2
        cy = (ih - ch) // 2

    elif effect == "zoom_out":
        # Tight center → full image (camera pulls out)
        scale = (vw / iw) + t * (1.0 - vw / iw)
        cw = int(iw * scale)
        ch = int(ih * scale)
        cx = (iw - cw) // 2
        cy = (ih - ch) // 2

    elif effect == "pan_left":
        cx = int(max_dx * (1.0 - t))
        cy = max_dy // 2

    elif effect == "pan_right":
        cx = int(max_dx * t)
        cy = max_dy // 2

    elif effect == "pan_up":
        cx = max_dx // 2
        cy = int(max_dy * (1.0 - t))

    elif effect == "pan_down":
        cx = max_dx // 2
        cy = int(max_dy * t)

    elif effect == "zoom_in_pan_right":
        scale = 1.0 - t * (1.0 - vw / iw) * 0.6
        cw = int(iw * scale)
        ch = int(ih * scale)
        cx = int((iw - cw) * t)
        cy = (ih - ch) // 2

    elif effect == "zoom_out_pan_left":
        scale = (vw / iw) + t * (1.0 - vw / iw) * 0.6
        cw = int(iw * scale)
        ch = int(ih * scale)
        cx = int((iw - cw) * (1.0 - t))
        cy = (ih - ch) // 2

    # Clamp to image bounds
    cw = max(1, min(cw, iw))
    ch = max(1, min(ch, ih))
    cx = max(0, min(cx, iw - cw))
    cy = max(0, min(cy, ih - ch))

    cropped = img.crop((cx, cy, cx + cw, cy + ch))
    if cropped.size != (vw, vh):
        return cropped.resize((vw, vh), Image.LANCZOS)
    return cropped


# ═══════════════════════════════════════════════
# Caption rendering
# ═══════════════════════════════════════════════

def _parse_srt(srt_path: Path) -> list[dict]:
    """Parse SRT into list of {start, end, text}."""
    import pysrt
    subs = pysrt.open(str(srt_path))
    return [
        {
            "start": s.start.ordinal / 1000.0,
            "end": s.end.ordinal / 1000.0,
            "text": s.text.replace("\n", " "),
        }
        for s in subs
    ]


def _render_caption(text: str, font: ImageFont.FreeTypeFont) -> Image.Image:
    """Render caption text as a transparent RGBA overlay — viral yellow-on-black style."""
    max_w = VIDEO_WIDTH - 100

    # Word-wrap
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        test = f"{cur} {word}".strip()
        bbox = font.getbbox(test)
        if bbox[2] - bbox[0] > max_w and cur:
            lines.append(cur)
            cur = word
        else:
            cur = test
    if cur:
        lines.append(cur)

    line_h = int(font.size * 1.5)
    pad = 20
    img_h = line_h * len(lines) + pad * 2
    img = Image.new("RGBA", (VIDEO_WIDTH, img_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    for i, line in enumerate(lines):
        bbox = font.getbbox(line)
        tw = bbox[2] - bbox[0]
        x = (VIDEO_WIDTH - tw) // 2
        y = pad + i * line_h

        # Bold black outline (thicker for better readability)
        r = 4
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    draw.text((x + dx, y + dy), line,
                              font=font, fill=(0, 0, 0, 255))
        # Viral yellow text
        draw.text((x, y), line, font=font, fill=(255, 255, 50, 255))

    return img


def _composite_caption(base: Image.Image, captions: list[dict],
                       font: ImageFont.FreeTypeFont, t: float) -> Image.Image:
    """Burn active captions onto a frame at time t."""
    active = [c for c in captions if c["start"] <= t < c["end"]]
    if not active:
        return base

    frame = base.copy()
    for cap in active:
        overlay = _render_caption(cap["text"], font)
        y = int(VIDEO_HEIGHT * 0.72) - overlay.height // 2
        y = max(0, min(y, VIDEO_HEIGHT - overlay.height))
        frame.paste(overlay, (0, y), overlay)
    return frame


# ═══════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════

def build_video(
    scene_images: list[Path],
    voiceover_path: Path,
    captions_srt_path: Path | None,
    output_path: Path,
    background_music_path: Path | None = None,
    background_clips: list[Path] | None = None,
    language: str = "en",
) -> Path:
    """
    Assemble a cinematic vertical short-form video with:
      • Ken Burns zoom/pan animation on every scene
      • Smooth crossfade transitions between scenes
      • Properly muxed audio (voiceover + optional bg music)
      • Burned-in viral-style captions

    Zero dependency on MoviePy or ImageMagick.
    """
    ffmpeg = _get_ffmpeg()
    target_dur = min(_audio_duration(voiceover_path), float(MAX_DURATION))

    # ── Load & prepare visuals (oversized for Ken Burns) ──
    if scene_images:
        kb_frames = _load_images_for_kb(scene_images)
    elif background_clips:
        kb_frames = _extract_clip_frames_for_kb(background_clips, ffmpeg)
    else:
        raise ValueError("No scene images or background clips provided")
    if not kb_frames:
        raise ValueError("Failed to prepare any visual frames")

    # Assign a random Ken Burns effect per scene
    effects = [random.choice(KB_EFFECTS) for _ in kb_frames]
    print(f"  🎬 Ken Burns effects: {effects}")

    # ── Captions ──────────────────────────────
    captions: list[dict] = []
    font = _get_font(58, language=language)
    if captions_srt_path and captions_srt_path.exists():
        captions = _parse_srt(captions_srt_path)

    # ── Audio (voiceover ± bg music) ──────────
    audio_path = _mix_audio(
        voiceover_path, background_music_path, target_dur, ffmpeg)

    # ── Render frames with Ken Burns + crossfade → pipe to ffmpeg ──
    total_frames = int(target_dur * VIDEO_FPS)
    n_scenes = len(kb_frames)
    dur_per_scene = target_dur / n_scenes
    crossfade_frames = int(CROSSFADE_DURATION * VIDEO_FPS)

    cmd = [
        ffmpeg, "-y",
        # raw RGB video from stdin
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{VIDEO_WIDTH}x{VIDEO_HEIGHT}",
        "-pix_fmt", "rgb24", "-r", str(VIDEO_FPS),
        "-i", "pipe:0",
        # audio file input
        "-i", str(audio_path),
        # explicit stream mapping (fixes audio muxing bug)
        "-map", "0:v:0", "-map", "1:a:0",
        # video encoding
        "-c:v", "libx264", "-preset", "medium", "-crf", "22",
        "-pix_fmt", "yuv420p",
        # audio encoding
        "-c:a", "aac", "-b:a", "192k",
        "-shortest",
        "-movflags", "+faststart",
        str(output_path),
    ]

    print(f"  🔧 Rendering {total_frames} frames ({target_dur:.1f}s @ {VIDEO_FPS}fps, "
          f"{n_scenes} scenes, crossfade={CROSSFADE_DURATION}s)...")

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    try:
        last_pct = -1
        for frame_idx in range(total_frames):
            t = frame_idx / VIDEO_FPS

            # Progress indicator
            pct = int(frame_idx / total_frames * 100)
            if pct % 10 == 0 and pct != last_pct:
                print(f"     {pct}% rendered...", end="\r")
                last_pct = pct

            # ── Determine current scene ──
            scene_idx = min(int(t / dur_per_scene), n_scenes - 1)
            scene_start = scene_idx * dur_per_scene
            scene_progress = (t - scene_start) / dur_per_scene
            scene_progress = max(0.0, min(1.0, scene_progress))

            # ── Ken Burns on current scene ──
            frame = _apply_ken_burns(
                kb_frames[scene_idx], effects[scene_idx], scene_progress)

            # ── Crossfade transition to next scene ──
            scene_end = scene_start + dur_per_scene
            time_to_end = scene_end - t
            next_idx = scene_idx + 1

            if next_idx < n_scenes and time_to_end < CROSSFADE_DURATION:
                alpha = 1.0 - (time_to_end / CROSSFADE_DURATION)
                alpha = _smoothstep(alpha)

                # Next scene's KB also progresses during crossfade
                time_into_next = CROSSFADE_DURATION - time_to_end
                next_progress = time_into_next / dur_per_scene
                next_progress = max(0.0, min(1.0, next_progress))

                frame_b = _apply_ken_burns(
                    kb_frames[next_idx], effects[next_idx], next_progress)
                frame = Image.blend(frame, frame_b, alpha)

            # ── Burn captions ──
            if captions:
                frame = _composite_caption(frame, captions, font, t)

            # ── Write raw RGB ──
            proc.stdin.write(frame.convert("RGB").tobytes())

    except BrokenPipeError:
        pass  # ffmpeg closed early (e.g., -shortest reached)
    finally:
        try:
            if proc.stdin and not proc.stdin.closed:
                proc.stdin.close()
        except Exception:
            pass

    # Wait for ffmpeg to finish — use wait() + stderr.read() since stdin may
    # already be closed/flushed, which makes communicate() raise ValueError.
    try:
        _, stderr = proc.communicate()
    except ValueError:
        stderr = proc.stderr.read() if proc.stderr else b""
        proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg error:\n{stderr.decode()}")

    print(f"     100% rendered ✓")

    # Cleanup temp audio
    if audio_path != voiceover_path:
        audio_path.unlink(missing_ok=True)

    return output_path


# ═══════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════

def _load_images_for_kb(paths: list[Path]) -> list[Image.Image]:
    """Load images scaled for Ken Burns (larger than viewport for pan/zoom headroom)."""
    imgs = []
    for p in paths:
        try:
            img = Image.open(p).convert("RGB")
            imgs.append(_resize_for_ken_burns(img))
        except Exception as e:
            print(f"  ⚠️  Skipping {p.name}: {e}")
    return imgs


def _extract_clip_frames_for_kb(clip_paths: list[Path], ffmpeg: str) -> list[Image.Image]:
    """Extract one frame per clip, scaled for Ken Burns."""
    frames = []
    for cp in clip_paths:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            subprocess.run(
                [ffmpeg, "-y", "-i", str(cp), "-vframes", "1", tmp_path],
                capture_output=True, check=True,
            )
            img = Image.open(tmp_path).convert("RGB")
            frames.append(_resize_for_ken_burns(img))
        except Exception as e:
            print(f"  ⚠️  Frame extraction failed for {cp.name}: {e}")
        finally:
            Path(tmp_path).unlink(missing_ok=True)
    return frames


def _mix_audio(voiceover: Path, music: Path | None, dur: float, ffmpeg: str) -> Path:
    """Mix voiceover + optional background music. Returns final audio path."""
    if not music or not music.exists():
        return voiceover

    mixed = voiceover.parent / "mixed_audio.aac"
    result = subprocess.run(
        [ffmpeg, "-y",
         "-i", str(voiceover), "-i", str(music),
         "-filter_complex",
         f"[1:a]volume=0.12,atrim=0:{dur},apad[m];[0:a][m]amix=inputs=2:duration=first",
         "-c:a", "aac", "-b:a", "192k", "-t", str(dur),
         str(mixed)],
        capture_output=True,
    )
    if result.returncode != 0:
        print(f"  ⚠️  Music mixing failed, using voiceover only")
        return voiceover
    return mixed
