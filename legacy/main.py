"""Media Monkey — CLI entry point for faceless video generation.

Supports full auto-pilot: run without --topic and it picks a random
viral topic from curated banks (fun, tech, science, psychology, money,
history, health, motivation, trending).
"""

import asyncio
import json
from pathlib import Path
from datetime import datetime

import click
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

from config import OUTPUT_DIR, MAX_DURATION, MUSIC_DIR, LANGUAGE
from pipeline.script_generator import generate_script
from pipeline.voice_generator import generate_voice
from pipeline.image_generator import generate_scene_images
from pipeline.visual_generator import fetch_background_clips
from pipeline.caption_generator import generate_captions
from pipeline.video_builder import build_video
from pipeline.thumbnail_generator import generate_thumbnail
from pipeline.publisher import publish_all
from pipeline.topic_picker import pick_random_topic, pick_random_from_category, TOPICS

console = Console()

STYLES = [
    "fun_facts",
    "motivational",
    "scary_stories",
    "reddit_stories",
    "top5_listicle",
    "news_recap",
    "did_you_know",
    "fun_entertainment",
    "tech_explainer",
    "trending_now",
]

CATEGORIES = list(TOPICS.keys())
LANGUAGES = ["en", "hi"]


@click.command()
@click.option("--topic", "-t", default=None, help="Video topic. If omitted, a random viral topic is picked automatically.")
@click.option("--style", "-s", default=None, type=click.Choice(STYLES), help="Content style. Auto-matched when using random topic.")
@click.option("--category", "-c", default=None, type=click.Choice(CATEGORIES), help="Topic category (fun/tech/science/etc.). Picks random topic from that category.")
@click.option("--lang", "-l", default=None, type=click.Choice(LANGUAGES), help="Language: en (English) or hi (Hindi). Defaults to .env LANGUAGE")
@click.option("--publish", "-p", is_flag=True, help="Auto-publish to enabled platforms")
@click.option("--no-captions", is_flag=True, help="Skip caption/subtitle generation")
@click.option("--use-stock", is_flag=True, help="Use Pexels stock footage instead of AI images")
def main(
    topic: str | None,
    style: str | None,
    category: str | None,
    lang: str | None,
    publish: bool,
    no_captions: bool,
    use_stock: bool,
):
    """Generate a faceless short-form video.

    Run without --topic for full auto-pilot (random viral topic).
    Use --category to narrow the random pick (e.g., --category tech).
    """
    language = lang or LANGUAGE

    # ── Auto-pick topic if not provided ───────
    source_label = ""
    if topic:
        picked_style = style or "fun_facts"
        cat_label = "custom"
        source_label = "manual"
    elif category:
        topic, picked_style, cat_label = pick_random_from_category(category)
        if style:
            picked_style = style  # manual override
    else:
        topic, picked_style, cat_label = pick_random_topic()
        if style:
            picked_style = style

    # Detect if the topic came from live trends (printed by topic_picker)
    if not source_label:
        source_label = "🌐 live" if "🌐" in (cat_label or "") else "auto"

    lang_label = {"en": "English", "hi": "Hindi"}.get(language, language)

    console.print(Panel.fit(
        "🐵 [bold cyan]Media Monkey[/] — Faceless Video Generator", border_style="cyan"))
    console.print(
        f"  [dim]Gemini script → ElevenLabs voice → AI images → ffmpeg render[/]")
    console.print(
        f"  [dim]Language: {lang_label} | Style: {picked_style} | Category: {cat_label}[/]")
    console.print(f"  [bold yellow]Topic:[/] {topic}\n")

    asyncio.run(_run_pipeline(topic, picked_style, language, publish,
                not no_captions, use_stock))


async def _run_pipeline(
    topic: str,
    style: str,
    language: str,
    publish: bool,
    captions: bool,
    use_stock: bool,
):
    """Execute the full video generation pipeline."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = OUTPUT_DIR / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:

        # ── Step 1: Generate Script (Gemini) ─────
        task = progress.add_task(
            "📝 Generating script with Gemini...", total=None)
        script_data = await generate_script(topic, style, MAX_DURATION, language=language)
        progress.update(task, description="📝 Script generated ✓")
        progress.remove_task(task)

        console.print(f"  [green]Title:[/] {script_data.get('title', 'N/A')}")
        console.print(f"  [green]Hook:[/] {script_data.get('hook', 'N/A')}")

        # Save script
        (run_dir / "script.json").write_text(json.dumps(script_data,
                                                        indent=2, ensure_ascii=False))

        # ── Step 2: Generate Voiceover (ElevenLabs) ─
        task = progress.add_task(
            "🎙️ Generating voiceover (ElevenLabs, random voice)...", total=None)
        voiceover_path = run_dir / "voiceover.mp3"
        _, voice_info = await generate_voice(
            script_data["script"], voiceover_path, language=language)
        progress.update(task, description=f"🎙️ Voice: {voice_info['name']} ✓")
        progress.remove_task(task)

        # Save voice info
        (run_dir / "voice_info.json").write_text(json.dumps(voice_info, indent=2, default=str))

        # ── Step 3: Generate Visuals ─────────────
        scene_images = []
        stock_clips = []

        if not use_stock and script_data.get("image_prompts"):
            # Primary: AI-generated images via Gemini Imagen (Nano Banana)
            task = progress.add_task(
                "🎨 Generating AI scene images...", total=None)
            scene_images = await generate_scene_images(
                script_data["image_prompts"],
                run_dir / "scenes",
            )
            progress.update(
                task, description=f"🎨 Generated {len(scene_images)} scene images ✓")
            progress.remove_task(task)

        if not scene_images:
            # Fallback: stock footage from Pexels
            task = progress.add_task(
                "🎬 Fetching stock footage (Pexels)...", total=None)
            search_terms = script_data.get("search_terms", [topic])
            stock_clips = await fetch_background_clips(search_terms, run_dir / "clips")
            progress.update(
                task, description=f"🎬 Downloaded {len(stock_clips)} clips ✓")
            progress.remove_task(task)

        # ── Step 4: Generate Captions (Whisper) ──
        srt_path = None
        if captions:
            task = progress.add_task(
                "💬 Generating captions (Whisper)...", total=None)
            srt_path = run_dir / "captions.srt"
            generate_captions(voiceover_path, srt_path, language=language)
            progress.update(task, description="💬 Captions generated ✓")
            progress.remove_task(task)

        # ── Step 5: Build Final Video ────────────
        task = progress.add_task(
            "🎥 Building video (Ken Burns + crossfade + audio)...", total=None)
        output_path = run_dir / "final_video.mp4"

        # Check for background music
        music_files = list(MUSIC_DIR.glob("*.mp3"))
        bg_music = music_files[0] if music_files else None

        build_video(
            scene_images=scene_images,
            voiceover_path=voiceover_path,
            captions_srt_path=srt_path,
            output_path=output_path,
            background_music_path=bg_music,
            background_clips=stock_clips if not scene_images else None,
            language=language,
        )
        progress.update(task, description="🎥 Video built ✓")
        progress.remove_task(task)

        # ── Step 6: Generate Thumbnail ───────────
        task = progress.add_task(
            "🖼️  Generating thumbnail...", total=None)
        thumbnail_path = run_dir / "thumbnail.jpg"
        first_scene = scene_images[0] if scene_images else None
        generate_thumbnail(
            title=script_data.get("title", topic),
            output_path=thumbnail_path,
            scene_image_path=first_scene,
        )
        progress.update(task, description="🖼️  Thumbnail generated ✓")
        progress.remove_task(task)

    console.print()
    console.print(Panel.fit(
        f"✅ [bold green]Video saved to:[/] {output_path}\n"
        f"   [dim]Voice: {voice_info['name']} | Scenes: {len(scene_images) or len(stock_clips)} | "
        f"Lang: {language}[/]",
        border_style="green",
    ))

    # ── Step 7: Publish ──────────────────────
    if publish:
        console.print("\n📤 [bold]Publishing to enabled platforms...[/]")
        tags = script_data.get("tags", [])
        console.print(
            f"  [dim]Tags: {', '.join(tags[:8])}{'...' if len(tags) > 8 else ''}[/]")

        results = publish_all(
            video_path=output_path,
            title=script_data.get("title", topic),
            description=script_data.get("description", ""),
            tags=tags,
            thumbnail_path=thumbnail_path,
        )
        console.print()
        for platform, url in results.items():
            if url:
                console.print(f"  ✅ [bold green]{platform}:[/] {url}")
            else:
                console.print(f"  ⚠️  {platform}: failed")
    else:
        console.print(
            "\n  [dim]Tip: Add -p to auto-publish to Instagram. "
            "Set INSTAGRAM_UPLOAD_ENABLED=true in .env[/]"
        )


if __name__ == "__main__":
    main()
