"""Topic Picker — live trending topics first, hardcoded fallback.

When auto-pilot runs, it FIRST tries to fetch real-time trending topics
from the web (via Gemini + Google Search grounding). If that fails (API
error, rate limit, network), it falls back to the curated hardcoded bank.

Covers: fun / entertainment, tech, science, psychology, history, motivation,
trending internet culture, money, health, and more.
"""

import random

from pipeline.trend_scraper import fetch_single_trending_topic

# ───────────────────────────────────────────────
# Topic banks — grouped by category
# ───────────────────────────────────────────────

TOPICS: dict[str, list[str]] = {
    # ── Fun / Entertainment ──────────────────
    "fun": [
        "5 dumbest world records that actually exist",
        "What happens if you never cut your nails your whole life",
        "The weirdest food combinations people actually love",
        "Things that are illegal but feel totally legal",
        "The funniest mistranslations that caused international incidents",
        "Animals that could absolutely destroy you but look adorable",
        "Dumb inventions that accidentally became multi-million dollar products",
        "The most useless superpowers people wish they had",
        "Things teachers secretly think but can never say",
        "The strangest jobs that pay insanely well",
        "Everyday things that are dirtier than a toilet seat",
        "Foods that are banned in other countries but you eat daily",
        "The dumbest reasons countries almost went to war",
        "Things your body does that science still can't explain",
        "If cartoon physics were real, what would actually happen",
    ],

    # ── Tech / AI / Gadgets ──────────────────
    "tech": [
        "AI features your phone already has that you don't know about",
        "The most dangerous apps you should delete right now",
        "Hidden iPhone tricks Apple doesn't advertise",
        "How hackers actually steal your passwords in 2026",
        "Tech that was supposed to change the world but flopped hard",
        "5 free AI tools that replaced $500/month software",
        "The scariest thing AI can do right now",
        "Why your phone is listening to you (and proof it works)",
        "How one line of code crashed the entire internet",
        "Robots that are replacing human jobs right now",
        "The dark side of smart home devices nobody talks about",
        "Tech billionaire habits that seem insane but actually work",
        "The most overhyped tech products of the last decade",
        "How deepfakes are changing the world faster than you think",
        "The real reason your battery dies so fast",
    ],

    # ── Science / Space ──────────────────────
    "science": [
        "What would happen if the moon disappeared tonight",
        "The most terrifying places in the universe",
        "5 scientific discoveries that accidentally changed history",
        "What lives at the bottom of the ocean that shouldn't exist",
        "The real reason dinosaurs went extinct (it's not what you think)",
        "What happens to your body in space without a suit",
        "Parallel universes: the science behind infinite versions of you",
        "The scariest experiments scientists actually conducted",
        "How a single bacteria could end human civilization",
        "The sound of a black hole is absolutely terrifying",
        "What would happen if the Earth stopped spinning for 1 second",
        "The coldest place in the universe is not where you think",
        "5 mind-blowing facts about the human brain",
        "Animals with abilities that seem like science fiction",
        "The Fermi Paradox: why we haven't found aliens yet",
    ],

    # ── Psychology / Human Behavior ──────────
    "psychology": [
        "Dark psychology tricks people use on you every day",
        "Why you always feel tired even after sleeping 8 hours",
        "The 2-minute trick that rewires your brain for confidence",
        "Signs someone is secretly manipulating you",
        "Why your brain sabotages you right before success",
        "The psychology behind why you can't stop scrolling",
        "Things narcissists say that sound completely normal",
        "How to read anyone's body language in 5 seconds",
        "The scary truth about what loneliness does to your brain",
        "Why you always think of the perfect comeback too late",
        "Psychological tricks restaurants use to make you spend more",
        "The one habit that separates the top 1% from everyone else",
    ],

    # ── Money / Business ─────────────────────
    "money": [
        "5 money habits keeping you broke without realizing it",
        "The credit card trap nobody warns you about",
        "How millionaires think differently about money",
        "Side hustles that actually make $10K/month in 2026",
        "The richest person who ever lived (not who you think)",
        "Things rich people never waste money on",
        "How companies trick you into spending more than you planned",
        "The simplest investment strategy that beats 90% of experts",
        "Jobs that will disappear by 2030 and what to do about it",
        "How a broke college student built a billion-dollar company",
    ],

    # ── History / Mysteries ──────────────────
    "history": [
        "The most perfectly executed heist in history",
        "A message in a bottle that took 100 years to find its owner",
        "The lost city that was found completely intact underwater",
        "History's biggest unsolved mysteries that still haunt scientists",
        "The man who survived both Hiroshima and Nagasaki bombings",
        "Ancient inventions that were way ahead of their time",
        "The real story behind the most haunted building on Earth",
        "A single photo that changed the course of history",
        "The spy who fooled two countries for 30 years",
        "Civilizations that vanished overnight without a trace",
    ],

    # ── Health / Body ────────────────────────
    "health": [
        "What happens to your body when you stop eating sugar for 30 days",
        "The real reason you can't fall asleep at night",
        "5 signs your body gives you before a serious illness",
        "What cold showers actually do to your body (science-backed)",
        "The 5 second morning routine that changes your entire day",
        "Foods you eat daily that are slowly damaging your gut",
        "Why you should never ignore these body warning signs",
        "What happens when you drink only water for 30 days",
        "The sleeping position that's slowly ruining your back",
        "How your phone is literally changing the shape of your skull",
    ],

    # ── Motivation / Self-Improvement ────────
    "motivation": [
        "The speech that got 100 million views and changed lives",
        "Why being uncomfortable is the fastest way to grow",
        "5 painful truths nobody wants to hear but everyone needs",
        "The 5 AM routine of the world's most successful people",
        "How one decision at 25 defines your entire life",
        "The Japanese technique to eliminate laziness forever",
        "What separates people who succeed from those who just dream",
        "The 30-day challenge that completely transformed my life",
        "Why the smartest people in the room are often the quietest",
        "The 10-second rule that destroys procrastination instantly",
    ],

    # ── Trending / Internet Culture ──────────
    "trending": [
        "The most viral moments of 2026 so far",
        "Internet rabbit holes that will consume your entire night",
        "The craziest conspiracy theories that turned out to be true",
        "Things that were normal 10 years ago but are wild today",
        "The most expensive things ever sold on the internet",
        "Online scams that are fooling even smart people in 2026",
        "The most watched YouTube video in every country",
        "TikTok trends that actually ruined people's lives",
        "AI-generated content that fooled millions of people",
        "The weirdest things people have found in their walls",
    ],
}

# ── Style mapping — which styles suit which categories ──
CATEGORY_STYLES: dict[str, list[str]] = {
    "fun":         ["fun_facts", "top5_listicle", "did_you_know"],
    "tech":        ["fun_facts", "top5_listicle", "news_recap", "did_you_know"],
    "science":     ["fun_facts", "did_you_know", "top5_listicle", "scary_stories"],
    "psychology":  ["fun_facts", "did_you_know", "top5_listicle"],
    "money":       ["fun_facts", "top5_listicle", "motivational"],
    "history":     ["scary_stories", "did_you_know", "fun_facts"],
    "health":      ["fun_facts", "top5_listicle", "did_you_know"],
    "motivation":  ["motivational", "did_you_know"],
    "trending":    ["news_recap", "fun_facts", "top5_listicle", "did_you_know"],
}


def pick_random_topic() -> tuple[str, str, str]:
    """
    Pick a random topic — tries live web trends first, falls back to hardcoded.

    Returns:
        (topic, style, category) — e.g.
        ("Samsung's new phone has a feature that makes the iPhone look ancient", "tech_explainer", "tech")
    """
    # Try live trending topics first
    result = fetch_single_trending_topic(category=None)
    if result:
        topic, style, category = result
        print(f"  🌐 Live trending topic found: [{category}] {topic}")
        return topic, style, category

    # Fallback to hardcoded
    print("  📦 Using curated topic bank (web trends unavailable)")
    category = random.choice(list(TOPICS.keys()))
    topic = random.choice(TOPICS[category])
    style = random.choice(CATEGORY_STYLES[category])
    return topic, style, category


def pick_random_from_category(category: str) -> tuple[str, str, str]:
    """Pick a random topic from a specific category — tries live trends first."""
    if category not in TOPICS:
        raise ValueError(
            f"Unknown category '{category}'. Choose from: {list(TOPICS.keys())}")

    # Try live trending for this category
    result = fetch_single_trending_topic(category=category)
    if result:
        topic, style, cat = result
        print(f"  🌐 Live trending topic found: [{cat}] {topic}")
        return topic, style, cat

    # Fallback to hardcoded
    print(f"  📦 Using curated {category} topics (web trends unavailable)")
    topic = random.choice(TOPICS[category])
    style = random.choice(CATEGORY_STYLES[category])
    return topic, style, category
