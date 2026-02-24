"""Trend Scraper — discovers what's actually trending RIGHT NOW using Gemini + Google Search.

Instead of hardcoded topic banks, this module asks Gemini (with Google Search
grounding enabled) to find real-time viral/trending topics across categories
like tech, memes, science, entertainment, etc.

Falls back gracefully to None if the web search fails (caller should use
hardcoded topics as backup).
"""

import json
import random
from google import genai
from google.genai import types

from config import GEMINI_API_KEY, GEMINI_MODEL

# ── Category → search prompt mapping ─────────
TREND_PROMPTS: dict[str, str] = {
    "tech": (
        "What are the top 10 trending technology, AI, and gadget topics on social media "
        "right now in 2026? Think viral YouTube Shorts and TikTok topics. "
        "Include new product launches, AI breakthroughs, app updates, cybersecurity stories, "
        "and controversial tech news that people are buzzing about TODAY."
    ),
    "fun": (
        "What are the top 10 funniest, most entertaining, and weirdest viral topics "
        "trending on social media right now? Include bizarre news stories, funny fails, "
        "weird world records, unexpected animal stories, and 'did you know' style fun facts "
        "that are going viral TODAY."
    ),
    "trending": (
        "What are the top 10 most viral and trending topics across all of social media "
        "right now? Include memes, internet drama, viral challenges, celebrity moments, "
        "shocking news, and cultural events that everyone is talking about TODAY."
    ),
    "science": (
        "What are the top 10 trending science and space discoveries or stories "
        "in the news right now? Include new NASA findings, medical breakthroughs, "
        "climate stories, and mind-blowing research that's going viral TODAY."
    ),
    "money": (
        "What are the top 10 trending money, finance, and business topics "
        "on social media right now? Include crypto news, stock market stories, "
        "side hustle trends, economic shifts, and personal finance topics going viral TODAY."
    ),
    "health": (
        "What are the top 10 trending health, fitness, and wellness topics "
        "on social media right now? Include new diet trends, workout crazes, "
        "mental health awareness topics, and health myths being debunked TODAY."
    ),
    "psychology": (
        "What are the top 10 trending psychology, self-improvement, and human behavior "
        "topics on social media right now? Include viral relationship advice, productivity "
        "trends, mental health topics, and mind-blowing psychological facts trending TODAY."
    ),
    "history": (
        "What are the top 10 trending history-related topics on social media right now? "
        "Include newly declassified information, archaeological discoveries, historical "
        "anniversaries, and 'today I learned' history facts going viral TODAY."
    ),
    "motivation": (
        "What are the top 10 trending motivational and self-improvement topics "
        "on social media right now? Include viral success stories, new productivity "
        "methods, mindset shifts, and inspirational moments trending TODAY."
    ),
}


def fetch_trending_topics(
    category: str | None = None,
    count: int = 10,
) -> list[dict] | None:
    """
    Use Gemini + Google Search grounding to discover real-time trending topics.

    Args:
        category: One of the TREND_PROMPTS keys, or None for mixed/all categories.
        count: Number of topics to fetch.

    Returns:
        List of dicts: [{"topic": "...", "category": "...", "style": "..."}, ...]
        or None if the search fails.
    """
    if category and category not in TREND_PROMPTS:
        category = None  # Fall back to mixed

    if category:
        search_prompt = TREND_PROMPTS[category]
    else:
        # Mixed: combine multiple categories
        cats = random.sample(list(TREND_PROMPTS.keys()),
                             min(4, len(TREND_PROMPTS)))
        search_prompt = (
            "What are the top 15 most viral and trending topics across social media right now? "
            "Cover a MIX of these categories: " + ", ".join(cats) + ". "
            "Include the latest memes, shocking news, tech launches, fun facts, and anything "
            "that's blowing up on YouTube, TikTok, and Instagram TODAY."
        )

    style_map = {
        "tech": "tech_explainer",
        "fun": "fun_facts",
        "trending": "trending_now",
        "science": "did_you_know",
        "money": "top5_listicle",
        "health": "fun_facts",
        "psychology": "did_you_know",
        "history": "scary_stories",
        "motivation": "motivational",
    }

    full_prompt = f"""{search_prompt}

For each trending topic, rewrite it as a compelling YouTube Shorts / Instagram Reels video title
that would make someone stop scrolling and watch.

Return ONLY valid JSON — an array of objects:
[
    {{
        "topic": "A compelling, specific video topic phrased to grab attention (not generic)",
        "category": "one of: tech, fun, trending, science, money, health, psychology, history, motivation",
        "why_viral": "One sentence on why this is trending right now"
    }}
]

Return exactly {count} topics. Make each one specific and attention-grabbing, not generic.
Bad: "AI is changing the world" — Good: "Google's new AI just passed the bar exam on its first try"
Bad: "New phone release" — Good: "Samsung's new phone has a feature that makes the iPhone look ancient"
"""

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                temperature=0.7,
                # Note: response_mime_type="application/json" is NOT compatible
                # with tool use (Google Search grounding), so we parse JSON manually.
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )

        # Extract JSON from the response text (may be wrapped in ```json ... ```)
        raw = response.text.strip()
        if raw.startswith("```"):
            # Strip markdown code fence
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3].strip()

        topics = json.loads(raw)

        if not isinstance(topics, list) or not topics:
            return None

        # Normalize and add style suggestion
        results = []
        for t in topics[:count]:
            cat = t.get("category", category or "trending")
            results.append({
                "topic": t["topic"],
                "category": cat,
                "style": style_map.get(cat, "fun_facts"),
                "why_viral": t.get("why_viral", ""),
            })

        return results

    except Exception as e:
        print(f"  ⚠️  Trend scraping failed: {e}")
        return None


def fetch_single_trending_topic(category: str | None = None) -> tuple[str, str, str] | None:
    """
    Convenience wrapper — fetch one random trending topic.

    Returns:
        (topic, style, category) or None if web search fails.
    """
    topics = fetch_trending_topics(category=category, count=8)
    if not topics:
        return None

    pick = random.choice(topics)
    return pick["topic"], pick["style"], pick["category"]
