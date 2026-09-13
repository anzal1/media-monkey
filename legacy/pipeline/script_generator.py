"""Script Generator — uses Gemini to write viral short-form video scripts.

Supports English and Hindi with optimised prompts for each language.
"""

import json
from google import genai
from google.genai import types

from config import GEMINI_API_KEY, GEMINI_MODEL


def _build_prompt(topic: str, style: str, max_duration: int, language: str = "en") -> str:
    """Build the prompt for script generation — language-aware."""
    word_count = max_duration * 2  # ~2 words per second for natural speech

    if language == "hi":
        lang_instruction = (
            "LANGUAGE: Write the script narration in Hindi (Devanagari script, e.g., "
            "\"क्या आप जानते हैं...\"). The script MUST be entirely in Hindi — "
            "natural spoken Hindi that sounds like a confident Indian YouTuber. "
            "Mix in common Hinglish words where they feel natural (e.g., 'actually', "
            "'basically', 'percent'). Keep the title, description, and tags in BOTH "
            "Hindi and English for discoverability. Image prompts MUST stay in English "
            "(the image AI only understands English)."
        )
    else:
        lang_instruction = (
            "LANGUAGE: Write everything in English. The script should sound like a "
            "confident, native English-speaking YouTuber."
        )

    return f"""You are a viral short-form video scriptwriter who has made millions of views on YouTube Shorts and Instagram Reels.

Write a script for a {max_duration}-second vertical video.

TOPIC: {topic}
STYLE: {style}
{lang_instruction}

SCRIPT RULES:
- Hook the viewer in the FIRST 2 seconds with a shocking/intriguing line. This is CRITICAL.
- Keep sentences short and punchy — one idea per sentence.
- Total spoken word count: ~{word_count} words (approx 2 words/sec for natural pacing).
- Use conversational tone — like talking to a friend, not reading a textbook.
- Build tension: setup → escalation → climax → surprising conclusion.
- End with a strong CTA: "Follow for more" / "Subscribe" or pose a question to boost comments.
- Do NOT include speaker labels, timestamps, or emojis in the script.
- The script should flow naturally when read aloud — test it by reading it in your head.

AUDIO TAGS (important — use these for expressive delivery):
The TTS engine supports audio tags in square brackets to control emotion and delivery.
Sprinkle these throughout the script where appropriate to make the narration feel alive:
- Emotions: [excited], [whispering], [serious], [shocked], [curious], [dramatic]
- Reactions: [laughing], [gasping], [sigh], [giggling]
- Delivery: [slowly], [urgently], [matter-of-fact]
Examples: "[whispering] Want to know a secret?" or "[shocked] Wait, what?!" or "And that... [dramatic] changed everything."
Use 3-6 audio tags total — don't overdo it. Place them where they amplify the emotional impact.
Keep the total script under 4500 characters (TTS model limit).

IMAGE PROMPTS (5-8 prompts — MUST be in English regardless of script language):
Generate 5-8 image prompts for AI-generated visuals that will accompany the narration.
Each image should match that part of the script's narrative.

VISUAL COHERENCE IS CRITICAL:
- All image prompts MUST share a CONSISTENT color palette, art style, and visual mood.
- They should look like frames from the same cinematic movie — not random images.
- Pick ONE dominant color scheme and carry it through all prompts (e.g., "deep blues and amber", "neon purple and teal", "warm golden tones").
- Keep the same art style across all scenes (e.g., all photorealistic, or all digital art).
- Use the Nano Banana prompt format: Subject + Action + Setting + Style + Composition + Lighting + Key details + Constraints.

Return ONLY valid JSON:
{{
    "title": "Short catchy title for the video (max 100 chars)",
    "description": "SEO-optimized description (2-3 sentences) for YouTube/Instagram, DO NOT include hashtags here",
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11", "tag12", "tag13", "tag14", "tag15"],
    "hook": "The first attention-grabbing line",
    "script": "The full narration script to be spoken aloud",
    "image_prompts": [
        "Detailed image prompt for scene 1...",
        "Detailed image prompt for scene 2...",
        "Detailed image prompt for scene 3..."
    ],
    "search_terms": ["pexels search term 1", "pexels search term 2"]
}}

IMPORTANT for tags: Generate exactly 15 tags. Mix broad reach tags (e.g., "facts", "viral", "mindblown")
with niche topic-specific tags (e.g., "ocean facts", "deep sea", "marine biology").
Tags should work as hashtags on both YouTube and Instagram. Single words or short phrases only."""


async def generate_script(
    topic: str,
    style: str = "fun_facts",
    max_duration: int = 59,
    language: str = "en",
) -> dict:
    """Generate a video script using Gemini — supports English and Hindi."""
    client = genai.Client(api_key=GEMINI_API_KEY)

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=_build_prompt(topic, style, max_duration, language),
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.9,
        ),
    )

    return json.loads(response.text)
