"""Image Generator — AI image generation using Gemini Imagen (Nano Banana style).

Uses the same prompt structure from the kai/blogs project:
  Subject + Action + Setting + Style + Composition + Lighting + Key details + Constraints
"""

from pathlib import Path
from google import genai
from google.genai import types

from config import GEMINI_API_KEY, IMAGE_MODEL, VIDEO_WIDTH, VIDEO_HEIGHT


def _build_image_prompt(subject: str) -> str:
    """
    Wrap a raw image description in the Nano Banana prompt style for better results.
    Adds style/composition/constraints appropriate for vertical short-form video frames.
    """
    return (
        f"{subject}. "
        f"Style: cinematic, vibrant colors, high contrast, dramatic lighting, photorealistic. "
        f"Composition: vertical 9:16 aspect ratio, centered subject, shallow depth of field. "
        f"Lighting: moody, volumetric, golden hour tones. "
        f"No text, no watermarks, no logos, no human faces."
    )


def generate_image(prompt: str, output_path: Path) -> dict:
    """
    Generate a single image using Gemini Imagen API.

    Returns dict with 'success', 'path', and optionally error info.
    """
    client = genai.Client(api_key=GEMINI_API_KEY)
    full_prompt = _build_image_prompt(prompt)

    try:
        response = client.models.generate_content(
            model=IMAGE_MODEL,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
            ),
        )

        if response.candidates and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "inline_data") and part.inline_data:
                    image_data = part.inline_data.data

                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(output_path, "wb") as f:
                        f.write(image_data)

                    return {"success": True, "path": str(output_path)}

        return {"success": False, "error": "No image data in response"}

    except Exception as e:
        return {"success": False, "error": str(e)}


async def generate_scene_images(
    image_prompts: list[str],
    output_dir: Path,
) -> list[Path]:
    """
    Generate AI images for each scene in the video script.

    Args:
        image_prompts: List of scene descriptions from script_generator
        output_dir: Directory to save generated images

    Returns:
        List of paths to generated images
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    generated = []

    for i, prompt in enumerate(image_prompts):
        img_path = output_dir / f"scene_{i:02d}.png"
        prompt_str = str(prompt)
        print(
            f"  🎨 Generating scene {i + 1}/{len(image_prompts)}: {prompt_str[:60]}...")

        result = generate_image(prompt_str, img_path)
        if result["success"]:
            generated.append(img_path)
            print(f"     ✅ Saved: {img_path.name}")
        else:
            print(f"     ⚠️  Failed: {result.get('error', 'unknown')}")

    return generated
