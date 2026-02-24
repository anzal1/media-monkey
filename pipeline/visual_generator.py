"""Visual Generator — fetches stock footage from Pexels based on search terms."""

import requests
from pathlib import Path
from config import PEXELS_API_KEY, VIDEO_WIDTH, VIDEO_HEIGHT


def search_pexels_videos(query: str, per_page: int = 5, orientation: str = "portrait") -> list[dict]:
    """Search Pexels for stock videos matching the query."""
    response = requests.get(
        "https://api.pexels.com/videos/search",
        headers={"Authorization": PEXELS_API_KEY},
        params={
            "query": query,
            "per_page": per_page,
            "orientation": orientation,
            "size": "medium",
        },
    )
    response.raise_for_status()
    data = response.json()

    videos = []
    for video in data.get("videos", []):
        # Prefer HD portrait video files
        best_file = None
        for vf in video.get("video_files", []):
            if vf.get("width", 0) >= 720 and vf.get("height", 0) >= 1280:
                best_file = vf
                break
        if not best_file and video.get("video_files"):
            best_file = video["video_files"][0]

        if best_file:
            videos.append({
                "id": video["id"],
                "url": best_file["link"],
                "width": best_file.get("width", 1080),
                "height": best_file.get("height", 1920),
                "duration": video.get("duration", 0),
            })

    return videos


def download_video(url: str, output_path: Path) -> Path:
    """Download a video file from a URL."""
    response = requests.get(url, stream=True)
    response.raise_for_status()
    with open(output_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    return output_path


async def fetch_background_clips(search_terms: list[str], output_dir: Path, count: int = 3) -> list[Path]:
    """Fetch multiple background video clips for the final composition."""
    output_dir.mkdir(parents=True, exist_ok=True)
    downloaded = []

    for i, term in enumerate(search_terms[:count]):
        videos = search_pexels_videos(term, per_page=2)
        if videos:
            clip_path = output_dir / f"clip_{i}.mp4"
            download_video(videos[0]["url"], clip_path)
            downloaded.append(clip_path)

    return downloaded
