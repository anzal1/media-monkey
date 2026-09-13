"""Thumbnail Generator — creates engaging AI-powered thumbnails for Reels.

Primary: Gemini Imagen generates a custom thumbnail image from the title/hook.
Fallback: Pillow composites the first scene image with a viral-style text overlay.

Output: 1080×1920 high-quality JPEG suitable for Instagram Reel cover photos.
"""

import textwrap
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

from config import GEMINI_API_KEY, IMAGE_MODEL, VIDEO_WIDTH, VIDEO_HEIGHT, FONTS_DIR


# ── Viral thumbnail style constants ───────────
_THUMB_W = VIDEO_WIDTH   # 1080
_THUMB_H = VIDEO_HEIGHT  # 1920
_TEXT_MARGIN = 60
_MAX_TITLE_CHARS = 50  # Truncate long titles for visual punch


def _load_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    """Load the best available bold font for thumbnail text."""
    candidates = [
        FONTS_DIR / "impact.ttf",
        FONTS_DIR / "Anton-Regular.ttf",
        FONTS_DIR / "BebasNeue-Regular.ttf",
        FONTS_DIR / "Montserrat-ExtraBold.ttf",
    ]
    for fp in candidates:
        if fp.exists():
            return ImageFont.truetype(str(fp), size)

    # System fallbacks (macOS → Linux → Windows)
    system_fonts = [
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/impact.ttf",
    ]
    for fp in system_fonts:
        if Path(fp).exists():
            return ImageFont.truetype(fp, size)

    return ImageFont.load_default()


def _shorten_title(title: str) -> str:
    """Shorten title to punchy thumbnail text."""
    # Remove emojis and special chars for cleaner rendering
    clean = title.strip()
    if len(clean) > _MAX_TITLE_CHARS:
        clean = clean[:_MAX_TITLE_CHARS - 3].rsplit(" ", 1)[0] + "..."
    return clean.upper()


def _draw_text_with_outline(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: str = "#FFFF00",
    outline: str = "#000000",
    outline_width: int = 4,
):
    """Draw text with thick outline for readability on any background."""
    x, y = position
    for dx in range(-outline_width, outline_width + 1):
        for dy in range(-outline_width, outline_width + 1):
            if dx * dx + dy * dy <= outline_width * outline_width:
                draw.text((x + dx, y + dy), text, font=font, fill=outline)
    draw.text((x, y), text, font=font, fill=fill)


def _pillow_thumbnail(
    title: str,
    scene_image_path: Path | None = None,
) -> Image.Image:
    """
    Create a viral-style thumbnail using Pillow.

    - Dark gradient background (or scene image if provided)
    - Large yellow uppercase title text with black outline
    - Subtle vignette overlay for depth
    """
    # Start with background
    if scene_image_path and scene_image_path.exists():
        bg = Image.open(scene_image_path).convert("RGB")
        bg = bg.resize((_THUMB_W, _THUMB_H), Image.LANCZOS)
    else:
        # Dark gradient fallback
        bg = Image.new("RGB", (_THUMB_W, _THUMB_H), "#1a1a2e")
        draw = ImageDraw.Draw(bg)
        for y in range(_THUMB_H):
            t = y / _THUMB_H
            r = int(26 + t * 30)
            g = int(26 + t * 10)
            b = int(46 + t * 20)
            draw.line([(0, y), (_THUMB_W, y)], fill=(r, g, b))

    # Apply dark overlay for text readability
    overlay = Image.new("RGBA", (_THUMB_W, _THUMB_H), (0, 0, 0, 140))
    bg = bg.convert("RGBA")
    bg = Image.alpha_composite(bg, overlay).convert("RGB")

    draw = ImageDraw.Draw(bg)

    # Prepare text
    short_title = _shorten_title(title)
    font_size = 96
    font = _load_font(font_size)

    # Wrap text to fit
    max_chars_per_line = 14
    lines = textwrap.wrap(short_title, width=max_chars_per_line)

    # Calculate total text block height
    line_spacing = 20
    bboxes = [draw.textbbox((0, 0), line, font=font) for line in lines]
    line_heights = [bb[3] - bb[1] for bb in bboxes]
    total_height = sum(line_heights) + line_spacing * (len(lines) - 1)

    # Center the text block vertically (slightly above center for visual balance)
    y_start = (_THUMB_H - total_height) // 2 - 50

    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font)
        text_w = bbox[2] - bbox[0]
        x = (_THUMB_W - text_w) // 2
        y = y_start + sum(line_heights[:i]) + line_spacing * i

        _draw_text_with_outline(
            draw, (x, y), line, font,
            fill="#FFFF00",    # Viral yellow
            outline="#000000",
            outline_width=5,
        )

    # Add subtle "swipe up" indicator at bottom
    small_font = _load_font(32, bold=False)
    indicator = "▶  WATCH NOW"
    ind_bbox = draw.textbbox((0, 0), indicator, font=small_font)
    ind_w = ind_bbox[2] - ind_bbox[0]
    _draw_text_with_outline(
        draw, ((_THUMB_W - ind_w) // 2, _THUMB_H - 180), indicator, small_font,
        fill="#FFFFFF",
        outline="#000000",
        outline_width=3,
    )

    return bg


def generate_thumbnail_ai(title: str, output_path: Path) -> bool:
    """
    Generate a thumbnail via Gemini Imagen.

    Returns True if successful, False on failure (caller should use Pillow fallback).
    Uses the same Gemini Imagen API as scene images — typically finishes in 5-15s.
    """
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=GEMINI_API_KEY)

        prompt = (
            f"Create an eye-catching YouTube/Instagram thumbnail image for a video titled: "
            f'"{title}". '
            f"Style: bold, cinematic, vibrant neon colors, dramatic lighting, "
            f"high contrast, dark background with glowing elements. "
            f"Composition: vertical 9:16 aspect ratio, centered visual focus, "
            f"visually striking and attention-grabbing. "
            f"Do NOT include any text, words, letters, or watermarks in the image. "
            f"Make it mysterious, intriguing, and click-worthy."
        )

        response = client.models.generate_content(
            model=IMAGE_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )

        if response.candidates and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    output_path.write_bytes(part.inline_data.data)

                    # Resize to exact dimensions and convert to JPEG
                    img = Image.open(output_path).convert("RGB")
                    img = img.resize((_THUMB_W, _THUMB_H), Image.LANCZOS)
                    img.save(output_path, "JPEG", quality=95)
                    return True

        print("  ⚠️  Gemini Imagen returned no image for thumbnail")
        return False

    except Exception as e:
        print(f"  ⚠️  AI thumbnail generation failed: {e}")
        return False


def generate_thumbnail(
    title: str,
    output_path: Path,
    scene_image_path: Path | None = None,
) -> Path:
    """
    Generate an engaging thumbnail for the video.

    Strategy:
    1. Try Gemini Imagen for a custom AI-generated thumbnail background
    2. If AI succeeds, overlay the title text on it for maximum impact
    3. If AI fails, use the first scene image (or gradient) with text overlay

    Args:
        title: Video title for text overlay
        output_path: Where to save the thumbnail JPEG
        scene_image_path: Optional first scene image for fallback background

    Returns:
        Path to the generated thumbnail
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    ai_bg_path = output_path.parent / "thumbnail_ai_bg.png"
    ai_success = generate_thumbnail_ai(title, ai_bg_path)

    if ai_success:
        # AI generated a background — now overlay title text on it
        print("  🎨 AI thumbnail background generated, adding text overlay...")
        thumb = _pillow_thumbnail(title, scene_image_path=ai_bg_path)
        # Clean up temp AI background
        try:
            ai_bg_path.unlink(missing_ok=True)
        except Exception:
            pass
    else:
        # Fallback: Pillow thumbnail from scene image or gradient
        print("  🎨 Using Pillow fallback for thumbnail...")
        thumb = _pillow_thumbnail(title, scene_image_path=scene_image_path)

    thumb.save(output_path, "JPEG", quality=95)
    print(f"  ✅ Thumbnail saved: {output_path}")
    return output_path
