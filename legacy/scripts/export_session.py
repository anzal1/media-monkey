#!/usr/bin/env python3
"""
Export Instagram session for use in GitHub Actions.

Run this LOCALLY (from your home IP — Instagram won't challenge residential IPs)
to create a pre-authenticated session. Then paste the base64 output as a
GitHub Actions secret named INSTAGRAM_SESSION_B64.

Usage:
    python scripts/export_session.py

After running:
    1. Copy the base64 string printed to the console
    2. Go to: https://github.com/<you>/media-monkey/settings/secrets/actions
    3. Create/update secret: INSTAGRAM_SESSION_B64 = <paste base64>
    4. GitHub Actions will now use this session — no login, no checkpoint!

Session typically stays valid for weeks/months. If uploads start failing,
just re-run this script and update the secret.
"""

import sys
import os
import json
import base64
import time

# Add project root to path BEFORE importing project modules
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, PROJECT_ROOT)
os.chdir(PROJECT_ROOT)

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(PROJECT_ROOT, ".env"))
except ImportError:
    pass

from config import INSTAGRAM_USERNAME, INSTAGRAM_PASSWORD, INSTAGRAM_TOTP_SECRET


def main():
    if not INSTAGRAM_USERNAME or not INSTAGRAM_PASSWORD:
        print("❌ INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in .env")
        sys.exit(1)

    print(f"🔐 Logging into Instagram as {INSTAGRAM_USERNAME}...")
    print(f"   (from your local IP — should NOT trigger checkpoint)\n")

    # Import publisher login function
    from pipeline.publisher import _ig_web_login, _ig_web_session, _IG_SESSION_FILE

    # Try existing session first
    session = _ig_web_session()
    if session:
        session_id = session.cookies.get("sessionid", domain=".instagram.com")
        csrf_token = session.cookies.get(
            "csrftoken", domain=".instagram.com") or ""
    else:
        session_id, csrf_token = _ig_web_login()

    if not session_id:
        print("\n❌ Login failed. Check your credentials and try again.")
        print("   If checkpoint was triggered, open the URL above in your browser,")
        print("   verify, then re-run this script.")
        sys.exit(1)

    # Build session data
    session_data = {
        "sessionid": session_id,
        "csrftoken": csrf_token,
        "username": INSTAGRAM_USERNAME,
        "saved_at": int(time.time()),
    }

    # Save locally too
    _IG_SESSION_FILE.write_text(json.dumps(session_data, indent=2))
    print(f"\n✅ Session saved to {_IG_SESSION_FILE}")

    # Encode as base64
    b64 = base64.b64encode(json.dumps(session_data).encode()).decode()

    print("\n" + "=" * 60)
    print("📋 COPY THE BASE64 STRING BELOW AND ADD AS GITHUB SECRET:")
    print("   Secret name: INSTAGRAM_SESSION_B64")
    print("=" * 60)
    print(f"\n{b64}\n")
    print("=" * 60)
    print(f"\n🔗 Add it here: https://github.com/anzal1/media-monkey/settings/secrets/actions")
    print("   → New repository secret → Name: INSTAGRAM_SESSION_B64 → Paste value above")
    print("\n💡 Re-run this script whenever the session expires (typically weeks/months)")


if __name__ == "__main__":
    main()
