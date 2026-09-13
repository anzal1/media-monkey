"""Publisher — uploads videos to YouTube Shorts and Instagram Reels with hashtags.

YouTube: Uses YouTube Data API v3 with OAuth 2.0 (one-time browser auth).
Instagram: Uses Instagram's web API directly (same endpoints your browser uses).

Both platforms get auto-generated hashtags, SEO descriptions, and optimized metadata.
"""

import time as _time
import json as _json
import re
from pathlib import Path
from config import (
    YOUTUBE_UPLOAD_ENABLED,
    INSTAGRAM_UPLOAD_ENABLED,
    INSTAGRAM_USERNAME,
    INSTAGRAM_PASSWORD,
    INSTAGRAM_TOTP_SECRET,
)


# ═══════════════════════════════════════════════
# Hashtag builder
# ═══════════════════════════════════════════════

def _build_hashtags(tags: list[str], platform: str = "youtube") -> str:
    """
    Build platform-optimized hashtag string from tags.

    YouTube: max 15 hashtags, placed in description (first 3 show above title).
    Instagram: max 30 hashtags, placed at end of caption.
    """
    # Clean tags: lowercase, remove special chars, collapse spaces
    cleaned = []
    for tag in tags:
        t = re.sub(r"[^a-zA-Z0-9\s]", "", str(tag)).strip()
        t = t.replace(" ", "")
        if t and len(t) > 1:
            cleaned.append(t.lower())

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for t in cleaned:
        if t not in seen:
            seen.add(t)
            unique.append(t)

    # Platform-specific limits
    limit = 15 if platform == "youtube" else 30
    hashtags = [f"#{t}" for t in unique[:limit]]

    # Always add platform-specific tags
    if platform == "youtube":
        must_have = ["#Shorts", "#viral", "#trending"]
    else:
        must_have = ["#reels", "#viral", "#trending", "#explore", "#fyp"]

    for h in must_have:
        if h.lower() not in [x.lower() for x in hashtags]:
            hashtags.append(h)

    return " ".join(hashtags[:limit])


def _build_youtube_description(description: str, tags: list[str]) -> str:
    """Build YouTube Shorts description with hashtags above-the-fold."""
    hashtags = _build_hashtags(tags, "youtube")

    # YouTube shows first 3 hashtags above the video title, so put them first
    top3 = " ".join(hashtags.split()[:3])
    rest = " ".join(hashtags.split()[3:])

    parts = [top3]  # These 3 appear above the title
    if description:
        parts.append("")
        parts.append(description)
    if rest:
        parts.append("")
        parts.append(rest)

    return "\n".join(parts)[:5000]


def _build_instagram_caption(title: str, description: str, tags: list[str]) -> str:
    """Build Instagram Reel caption with hashtags at the end."""
    hashtags = _build_hashtags(tags, "instagram")

    parts = [title]
    if description:
        parts.append("")
        parts.append(description)
    parts.append("")
    parts.append("─" * 20)
    parts.append(hashtags)

    return "\n".join(parts)[:2200]


# ═══════════════════════════════════════════════
# YouTube Upload (via YouTube Data API v3)
# ═══════════════════════════════════════════════

def upload_to_youtube(
    video_path: Path,
    title: str,
    description: str,
    tags: list[str],
    category_id: str = "22",  # "People & Blogs"
) -> str | None:
    """
    Upload a video to YouTube as a Short.

    FIRST-TIME SETUP:
    1. Go to https://console.cloud.google.com
    2. Create a project → Enable "YouTube Data API v3"
    3. Create OAuth 2.0 credentials (Desktop app)
    4. Download the JSON → save as client_secrets.json in project root
    5. Run with --publish → browser opens for one-time auth
    6. Token is cached in youtube_token.pickle for future runs
    """
    if not YOUTUBE_UPLOAD_ENABLED:
        return None

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
        from google.auth.transport.requests import Request
        import pickle

        SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
        creds = None
        token_path = Path("youtube_token.pickle")
        secrets_path = Path("client_secrets.json")

        # Check for client secrets file
        if not secrets_path.exists():
            print("  ❌ YouTube: client_secrets.json not found!")
            print("     → Download from Google Cloud Console (OAuth 2.0 credentials)")
            print("     → Save as client_secrets.json in project root")
            return None

        # Load cached credentials
        if token_path.exists():
            with open(token_path, "rb") as f:
                creds = pickle.load(f)

        # Refresh or re-auth if needed
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except Exception:
                creds = None

        if not creds or not creds.valid:
            print("  🔐 YouTube: Opening browser for one-time OAuth...")
            flow = InstalledAppFlow.from_client_secrets_file(
                str(secrets_path), SCOPES)
            creds = flow.run_local_server(port=0)
            with open(token_path, "wb") as f:
                pickle.dump(creds, f)
            print("  ✅ YouTube: Auth token saved (won't ask again)")

        youtube = build("youtube", "v3", credentials=creds)

        # Ensure #Shorts in title for YouTube to categorize correctly
        yt_title = title
        if "#Shorts" not in yt_title:
            yt_title = f"{yt_title} #Shorts"

        yt_description = _build_youtube_description(description, tags)

        body = {
            "snippet": {
                "title": yt_title[:100],
                "description": yt_description,
                "tags": tags[:30],
                "categoryId": category_id,
            },
            "status": {
                "privacyStatus": "public",
                "selfDeclaredMadeForKids": False,
            },
        }

        media = MediaFileUpload(
            str(video_path), mimetype="video/mp4", resumable=True)
        request = youtube.videos().insert(
            part="snippet,status", body=body, media_body=media)

        print("  📤 YouTube: Uploading...")
        response = None
        while response is None:
            status, response = request.next_chunk()
            if status:
                pct = int(status.progress() * 100)
                print(f"     {pct}% uploaded...", end="\r")

        video_id = response["id"]
        url = f"https://youtube.com/shorts/{video_id}"
        print(f"  ✅ YouTube: {url}")
        return url

    except Exception as e:
        print(f"  ❌ YouTube upload failed: {e}")
        return None


# ═══════════════════════════════════════════════
# Instagram Upload — Pure Web API (no instagrapi)
# ═══════════════════════════════════════════════
# Instagram blocks the private Android API (instagrapi) by IP, and
# even a valid web sessionid triggers ChallengeRequired on the private API.
#
# Solution: upload entirely via Instagram's WEB endpoints — the same
# requests your browser makes when you upload a Reel on instagram.com.
# Works on any IP, including GitHub Actions.

_IG_SESSION_FILE = Path("instagram_session.json")
_IG_WEB_APP_ID = "936619743392459"  # Instagram web app ID

_WEB_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


def _get_totp_code() -> str | None:
    """Generate a TOTP 2FA code using pyotp."""
    if not INSTAGRAM_TOTP_SECRET:
        return None
    try:
        import pyotp
        secret = INSTAGRAM_TOTP_SECRET.replace(" ", "")
        return pyotp.TOTP(secret, interval=30).now()
    except ImportError:
        print("  ⚠️  pyotp not installed. Run: pip install pyotp")
        return None


def _ig_web_session() -> "requests.Session | None":
    """
    Get an authenticated requests.Session for Instagram's web API.
    Tries cached session first, falls back to fresh login.
    Returns a Session with cookies set, or None on failure.
    """
    import requests

    def _make_session(session_id: str, csrf: str = "") -> requests.Session:
        s = requests.Session()
        s.cookies.set("sessionid", session_id, domain=".instagram.com")
        if csrf:
            s.cookies.set("csrftoken", csrf, domain=".instagram.com")
        s.headers.update({
            "User-Agent": _WEB_USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "Origin": "https://www.instagram.com",
            "Referer": "https://www.instagram.com/",
            "X-Requested-With": "XMLHttpRequest",
            "X-IG-App-ID": _IG_WEB_APP_ID,
        })
        if csrf:
            s.headers["X-CSRFToken"] = csrf
        return s

    def _verify(s: requests.Session) -> bool:
        """Check if session is still valid with a lightweight API call."""
        try:
            r = s.get(
                "https://www.instagram.com/api/v1/accounts/edit/web_form_data/",
                timeout=10,
            )
            return r.status_code == 200 and r.json().get("form_data") is not None
        except Exception:
            return False

    # Try cached session
    if _IG_SESSION_FILE.exists():
        try:
            cached = _json.loads(_IG_SESSION_FILE.read_text())
            sid = cached.get("sessionid", "")
            csrf = cached.get("csrftoken", "")
            if sid:
                print("  🔑 Instagram: Trying cached session...")
                s = _make_session(sid, csrf)
                if _verify(s):
                    # Refresh CSRF from response cookies
                    new_csrf = s.cookies.get("csrftoken", csrf)
                    if new_csrf:
                        s.headers["X-CSRFToken"] = new_csrf
                    print("  ✅ Cached session is valid")
                    return s
                print("  🔄 Cached session expired, logging in again...")
        except Exception:
            pass

    # Fresh login
    session_id, csrf_token = _ig_web_login()
    if not session_id:
        return None

    # Save for next time
    _IG_SESSION_FILE.write_text(_json.dumps({
        "sessionid": session_id,
        "csrftoken": csrf_token,
        "username": INSTAGRAM_USERNAME,
        "saved_at": int(_time.time()),
    }, indent=2))

    return _make_session(session_id, csrf_token)


def _ig_web_login() -> tuple[str | None, str]:
    """
    Log into Instagram via the WEB login endpoint.
    Returns (sessionid, csrftoken) on success, (None, "") on failure.
    """
    import requests

    session = requests.Session()
    session.headers.update({
        "User-Agent": _WEB_USER_AGENT,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": "https://www.instagram.com",
        "Referer": "https://www.instagram.com/accounts/login/",
        "X-Requested-With": "XMLHttpRequest",
    })

    # Step 1: Get CSRF token
    print("  🌐 Fetching CSRF token...")
    try:
        resp = session.get(
            "https://www.instagram.com/accounts/login/", timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"  ❌ Could not reach Instagram: {e}")
        return None, ""

    csrf = session.cookies.get("csrftoken", "")
    if not csrf:
        import re as _re
        m = _re.search(r'"csrf_token":"([^"]+)"', resp.text)
        if m:
            csrf = m.group(1)
    if not csrf:
        print("  ❌ Could not get CSRF token")
        return None, ""

    session.headers["X-CSRFToken"] = csrf

    # Step 2: Web login
    timestamp = int(_time.time())
    login_data = {
        "username": INSTAGRAM_USERNAME,
        "enc_password": f"#PWD_BROWSER:0:{timestamp}:{INSTAGRAM_PASSWORD}",
        "queryParams": "{}",
        "optIntoOneTap": "false",
    }

    print(f"  🔐 Logging in as {INSTAGRAM_USERNAME} via web API...")
    try:
        resp = session.post(
            "https://www.instagram.com/api/v1/web/accounts/login/ajax/",
            data=login_data,
            timeout=15,
        )
    except Exception as e:
        print(f"  ❌ Login request failed: {e}")
        return None, ""

    try:
        data = resp.json()
    except Exception:
        print(
            f"  ❌ Non-JSON response (status {resp.status_code}): {resp.text[:200]}")
        return None, ""

    # Step 3: Handle 2FA
    if data.get("two_factor_required"):
        print("  🔑 2FA required, generating TOTP code...")
        code = _get_totp_code()
        if not code:
            print("  ❌ 2FA required but INSTAGRAM_TOTP_SECRET not set")
            return None, ""

        two_factor_info = data.get("two_factor_info", {})
        identifier = two_factor_info.get("two_factor_identifier", "")

        csrf = session.cookies.get("csrftoken", csrf)
        session.headers["X-CSRFToken"] = csrf

        try:
            resp = session.post(
                "https://www.instagram.com/api/v1/web/accounts/login/ajax/two_factor/",
                data={
                    "username": INSTAGRAM_USERNAME,
                    "verificationCode": code,
                    "identifier": identifier,
                    "queryParams": "{}",
                },
                timeout=15,
            )
            data = resp.json()
        except Exception as e:
            print(f"  ❌ 2FA verification failed: {e}")
            return None, ""

    # Step 4: Check result
    if data.get("authenticated"):
        session_id = session.cookies.get("sessionid", "")
        csrf = session.cookies.get("csrftoken", csrf)
        if session_id:
            print("  ✅ Web login successful!")
            return session_id, csrf
        else:
            print("  ❌ Authenticated but no sessionid cookie")
            return None, ""
    else:
        msg = data.get("message", "Unknown error")
        err_type = data.get("error_type", "")
        print(f"  ❌ Login failed: {msg}")
        if err_type:
            print(f"     Error type: {err_type}")
        if data.get("checkpoint_url"):
            cp_url = data["checkpoint_url"]
            if cp_url.startswith("http"):
                full_url = cp_url
            else:
                full_url = f"https://www.instagram.com{cp_url}"
            print(f"     ⚠️  Checkpoint required: {full_url}")
            print(f"        Instagram flagged this login (datacenter / new IP).")
            print(f"        ")
            print(f"        To fix for GitHub Actions:")
            print(f"          1. Run locally: python scripts/export_session.py")
            print(
                f"          2. Copy the base64 output as GitHub secret INSTAGRAM_SESSION_B64")
            print(
                f"          3. Re-run the workflow — it will use the pre-seeded session")
        return None, ""


def _get_video_info(video_path: Path) -> dict:
    """Get video duration (ms), width, and height via ffprobe."""
    import subprocess
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    probe = _json.loads(result.stdout)
    vs = next(s for s in probe["streams"] if s["codec_type"] == "video")
    return {
        "duration_ms": int(float(probe["format"]["duration"]) * 1000),
        "width": int(vs["width"]),
        "height": int(vs["height"]),
    }


def _ig_web_upload_reel(
    session: "requests.Session",
    video_path: Path,
    caption: str,
    thumbnail_path: Path | None = None,
) -> str | None:
    """
    Upload a Reel via Instagram's web API (same requests the browser makes).

    Flow:
    1. Upload video bytes to /rupload_igvideo/
    2. Upload cover photo to /rupload_igphoto/ (AI thumbnail or extracted frame)
    3. Wait for server-side processing
    4. Configure the clip via /media/configure_to_clips/
    5. Return the Reel URL
    """
    import uuid
    import subprocess

    # Get actual video metadata
    info = _get_video_info(video_path)
    print(f"  📐 Video: {info['width']}x{info['height']}, "
          f"{info['duration_ms']}ms")

    video_data = video_path.read_bytes()
    video_len = len(video_data)
    upload_id = str(int(_time.time() * 1000))
    upload_name = f"{upload_id}_0_{uuid.uuid4().hex}"

    print(f"  🔖 upload_id: {upload_id}")
    print(f"  🔖 upload_name: {upload_name}")

    # ── Step 1: Upload video ──
    print(f"  📤 Uploading video ({video_len / 1024 / 1024:.1f} MB)...")

    rupload_params = _json.dumps({
        "media_type": "2",
        "upload_id": upload_id,
        "upload_media_height": str(info["height"]),
        "upload_media_width": str(info["width"]),
        "upload_media_duration_ms": str(info["duration_ms"]),
        "is_clips_video": "1",
    })

    try:
        resp = session.post(
            f"https://i.instagram.com/rupload_igvideo/{upload_name}",
            headers={
                "X-Instagram-Rupload-Params": rupload_params,
                "X-Entity-Name": upload_name,
                "X-Entity-Length": str(video_len),
                "X-Entity-Type": "video/mp4",
                "Content-Type": "application/octet-stream",
                "Offset": "0",
            },
            data=video_data,
            timeout=300,
        )
    except Exception as e:
        print(f"  ❌ Upload error: {e}")
        return None

    if resp.status_code != 200:
        print(f"  ❌ Upload HTTP {resp.status_code}: {resp.text[:300]}")
        return None

    try:
        upload_result = resp.json()
    except Exception:
        print(f"  ❌ Upload non-JSON response: {resp.text[:300]}")
        return None

    print(f"  📋 Upload response: {_json.dumps(upload_result, indent=2)[:600]}")

    if upload_result.get("status") != "ok":
        print(f"  ❌ Upload failed: {upload_result}")
        return None

    media_id = upload_result.get("media_id", "N/A")
    print(f"  ✅ Video uploaded — media_id: {media_id}")

    # ── Step 2: Upload cover photo ──
    # Instagram web flow REQUIRES a cover photo uploaded via rupload_igphoto
    # with the same upload_id. Without it, configure returns cover_photo_upload_error.
    print("  🖼️  Uploading cover photo...")
    _tmp_cover = None
    try:
        if thumbnail_path and Path(thumbnail_path).exists():
            cover_data = Path(thumbnail_path).read_bytes()
            print(f"     Using AI thumbnail ({len(cover_data) / 1024:.0f} KB)")
        else:
            # Fallback: extract frame at 0.5s as JPEG
            import tempfile as _tmpmod
            with _tmpmod.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                _tmp_cover = tmp.name
            subprocess.run([
                "ffmpeg", "-y", "-i", str(video_path),
                "-ss", "0.5", "-vframes", "1",
                "-vf", f"scale={info['width']}:{info['height']}",
                "-q:v", "2", _tmp_cover,
            ], capture_output=True, timeout=30)
            cover_data = Path(_tmp_cover).read_bytes()
            print(
                f"     Using extracted frame ({len(cover_data) / 1024:.0f} KB)")

        cover_len = len(cover_data)
        cover_upload_name = f"{upload_id}_0_{uuid.uuid4().hex}"

        cover_rupload_params = _json.dumps({
            "retry_context": '{"num_step_auto_retry":0,"num_reupload":0,"num_step_manual_retry":0}',
            "media_type": "2",
            "upload_id": upload_id,
            "upload_media_height": str(info["height"]),
            "upload_media_width": str(info["width"]),
            "image_compression": '{"lib_name":"moz","lib_version":"3.1.m","quality":"80"}',
        })

        print(f"  📋 Cover rupload params: {cover_rupload_params}")

        resp = session.post(
            f"https://i.instagram.com/rupload_igphoto/{cover_upload_name}",
            headers={
                "X-Instagram-Rupload-Params": cover_rupload_params,
                "X-Entity-Name": cover_upload_name,
                "X-Entity-Length": str(cover_len),
                "X-Entity-Type": "image/jpeg",
                "Content-Type": "application/octet-stream",
                "Offset": "0",
            },
            data=cover_data,
            timeout=60,
        )

        print(f"  📋 Cover upload HTTP status: {resp.status_code}")
        print(f"  📋 Cover upload response: {resp.text[:500]}")

        if resp.status_code == 200:
            print("  ✅ Cover photo uploaded")
        else:
            print(f"  ⚠️  Cover upload HTTP {resp.status_code}")

    except Exception as e:
        print(f"  ⚠️  Cover photo upload failed: {e}")
    finally:
        if _tmp_cover:
            try:
                Path(_tmp_cover).unlink(missing_ok=True)
            except Exception:
                pass

    # ── Step 3: Configure as Reel (with transcode polling) ──
    # Instagram transcodes the video server-side. If we configure too early
    # we get HTTP 202 "Transcode not finished yet." — so we poll with retries.
    csrf = session.cookies.get("csrftoken", "")
    if csrf:
        session.headers["X-CSRFToken"] = csrf

    configure_payload = {
        "source_type": "library",
        "caption": caption,
        "upload_id": upload_id,
        "disable_comments": "0",
        "like_and_view_counts_disabled": "0",
        "igtv_share_preview_to_feed": "1",
        "clips_share_preview_to_feed": "1",
        "video_subtitles_enabled": "0",
        "poster_frame_index": "0",
        "upload_media_height": str(info["height"]),
        "upload_media_width": str(info["width"]),
        "upload_media_duration_ms": str(info["duration_ms"]),
    }

    print(
        f"  📋 Configure payload: {_json.dumps(configure_payload, indent=2)[:800]}")

    # Poll: wait for transcode, then configure
    MAX_RETRIES = 10
    INITIAL_WAIT = 5   # seconds before first attempt
    RETRY_WAIT = 8     # seconds between retries

    print(f"  ⏳ Waiting {INITIAL_WAIT}s for initial server processing...")
    _time.sleep(INITIAL_WAIT)

    resp = None
    result = None
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"  ⚙️  Configure attempt {attempt}/{MAX_RETRIES}...")
        try:
            resp = session.post(
                "https://www.instagram.com/api/v1/media/configure_to_clips/",
                data=configure_payload,
                timeout=60,
            )
        except Exception as e:
            print(f"  ❌ Configure request error: {e}")
            return None

        print(f"  📋 Configure HTTP status: {resp.status_code}")

        # HTTP 200 = done (success or error), anything else = check
        if resp.status_code == 200:
            break

        # HTTP 202 = "Transcode not finished yet" — retry after delay
        if resp.status_code == 202:
            try:
                body = resp.json()
                msg = body.get("message", "")
            except Exception:
                msg = resp.text[:200]
            print(f"  ⏳ Transcode still processing: {msg}")
            if attempt < MAX_RETRIES:
                print(f"     Retrying in {RETRY_WAIT}s...")
                _time.sleep(RETRY_WAIT)
                continue
            else:
                print(
                    f"  ❌ Transcode not finished after {MAX_RETRIES} attempts")
                return None

        # Other HTTP errors
        print(f"  ❌ Configure HTTP {resp.status_code}: {resp.text[:500]}")
        return None

    try:
        result = resp.json()
    except Exception:
        print(f"  ❌ Configure non-JSON: {resp.text[:500]}")
        return None

    print(f"  📋 Configure response: {_json.dumps(result, indent=2)[:1000]}")

    if result.get("status") == "ok":
        media = result.get("media", {})
        code = media.get("code", "")
        pk = media.get("pk", "")
        media_id = media.get("id", "")
        print(f"  🔖 code={code}, pk={pk}, id={media_id}")
        if code:
            url = f"https://instagram.com/reel/{code}"
            print(f"  ✅ Instagram: {url}")
            return url
        if pk:
            print(f"  ✅ Instagram: Reel published (ID: {pk})")
            return f"https://instagram.com/reel/{pk}"
        print(f"  ⚠️  Status OK but no code/pk in response")
        return None
    else:
        msg = result.get("message", "Unknown error")
        err_type = result.get("error_type", "")
        err_title = result.get("error_title", "")
        spam = result.get("spam", "")
        feedback_title = result.get("feedback_title", "")
        print(f"  ❌ Configure failed: {msg}")
        print(f"     error_type: {err_type}")
        print(f"     error_title: {err_title}")
        print(f"     spam: {spam}")
        print(f"     feedback_title: {feedback_title}")
        print(f"     Full response: {_json.dumps(result)[:1000]}")
        return None


def upload_to_instagram(
    video_path: Path,
    title: str,
    description: str,
    tags: list[str],
    thumbnail_path: Path | None = None,
) -> str | None:
    """
    Upload a video to Instagram as a Reel using Instagram's web API.

    Login flow:
    1. Try cached session (fast, no network login)
    2. If expired → web API login (same as browser) → cache it
    3. Upload video via web rupload endpoint
    4. Configure as Reel with caption + hashtags

    No private/Android API used — works on any IP including GitHub Actions.

    SETUP:
    1. Set INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env
    2. Enable 2FA (Authentication App) on your Instagram account
    3. Set INSTAGRAM_TOTP_SECRET in .env
    4. Set INSTAGRAM_UPLOAD_ENABLED=true
    """
    if not INSTAGRAM_UPLOAD_ENABLED:
        return None

    if not INSTAGRAM_USERNAME or not INSTAGRAM_PASSWORD:
        print("  ❌ Instagram: Username/password not set in .env")
        return None

    try:
        session = _ig_web_session()
        if not session:
            return None

        caption = _build_instagram_caption(title, description, tags)

        url = _ig_web_upload_reel(session, video_path, caption, thumbnail_path)

        if url:
            # Update cached session (cookies may have been refreshed)
            sid = session.cookies.get("sessionid", "")
            csrf = session.cookies.get("csrftoken", "")
            if sid:
                _IG_SESSION_FILE.write_text(_json.dumps({
                    "sessionid": sid,
                    "csrftoken": csrf,
                    "username": INSTAGRAM_USERNAME,
                    "saved_at": int(_time.time()),
                }, indent=2))

        return url

    except Exception as e:
        print(f"  ❌ Instagram upload failed: {e}")
        import traceback
        traceback.print_exc()
        return None


# ═══════════════════════════════════════════════
# Publish to all enabled platforms
# ═══════════════════════════════════════════════

def publish_all(
    video_path: Path,
    title: str,
    description: str,
    tags: list[str],
    thumbnail_path: Path | None = None,
) -> dict:
    """Publish video to all enabled platforms with proper hashtags."""
    results = {}

    if YOUTUBE_UPLOAD_ENABLED:
        results["youtube"] = upload_to_youtube(
            video_path, title, description, tags)

    if INSTAGRAM_UPLOAD_ENABLED:
        results["instagram"] = upload_to_instagram(
            video_path, title, description, tags, thumbnail_path)

    if not YOUTUBE_UPLOAD_ENABLED and not INSTAGRAM_UPLOAD_ENABLED:
        print("  ⏭️  No platforms enabled. Set YOUTUBE_UPLOAD_ENABLED=true "
              "and/or INSTAGRAM_UPLOAD_ENABLED=true in .env")

    return results
