"""R2 upload utility — evidence image capture for Reddit scraper.

Uses boto3 (S3-compatible) to upload images to Cloudflare R2.
Mirrors the TypeScript pattern in apps/web/lib/r2.ts.
Gracefully returns None when R2 credentials are not configured.
"""

import os
from datetime import datetime, timezone

from .logging_config import get_logger

logger = get_logger(__name__)

# Lazy singleton boto3 client
_r2_client = None
_r2_checked = False

MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 MB


def _get_r2_client():
    """Get or create a boto3 S3 client for Cloudflare R2. Returns None if unconfigured."""
    global _r2_client, _r2_checked

    if _r2_checked:
        return _r2_client

    _r2_checked = True

    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")

    if not account_id or not access_key or not secret_key:
        logger.info("R2 credentials not configured — evidence image capture disabled")
        return None

    try:
        import boto3
        _r2_client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )
        logger.info("R2 client initialized for evidence image capture")
        return _r2_client
    except ImportError:
        logger.warning("boto3 not installed — evidence image capture disabled")
        return None
    except Exception as e:
        logger.error(f"Failed to initialize R2 client: {e}")
        return None


def _get_bucket() -> str:
    return os.environ.get("R2_BUCKET_NAME", "askarthur-screenshots")


def upload_reddit_evidence(image_url: str, submission_id: str) -> str | None:
    """Download an image from Reddit and upload to R2.

    Returns the R2 object key (e.g. 'reddit-evidence/2025-01-15/abc123.jpg')
    or None if upload fails or R2 is not configured.
    """
    client = _get_r2_client()
    if client is None:
        return None

    try:
        import requests

        resp = requests.get(image_url, timeout=10, stream=True)
        resp.raise_for_status()

        # Check Content-Length before downloading full body
        content_length = resp.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_IMAGE_SIZE:
            logger.info(
                f"Skipping oversized image ({content_length} bytes) for {submission_id}"
            )
            return None

        # Read body with size limit
        content = resp.content
        if len(content) > MAX_IMAGE_SIZE:
            logger.info(
                f"Skipping oversized image ({len(content)} bytes) for {submission_id}"
            )
            return None

        # Determine extension from Content-Type
        content_type = resp.headers.get("Content-Type", "image/jpeg")
        if "png" in content_type:
            ext = "png"
        elif "gif" in content_type:
            ext = "gif"
        elif "webp" in content_type:
            ext = "webp"
        else:
            ext = "jpg"

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        key = f"reddit-evidence/{date_str}/{submission_id}.{ext}"

        client.put_object(
            Bucket=_get_bucket(),
            Key=key,
            Body=content,
            ContentType=content_type,
        )

        logger.info(f"Uploaded evidence image: {key}")
        return key

    except Exception as e:
        logger.warning(f"Failed to upload evidence for {submission_id}: {e}")
        return None


def reset_client():
    """Reset the cached R2 client. Used in tests."""
    global _r2_client, _r2_checked
    _r2_client = None
    _r2_checked = False
