"""Tests for R2 upload utility — evidence image capture.

Uses mocks for boto3 and requests; no real network or R2 calls.
"""

import os
import sys
from unittest.mock import patch, MagicMock

import pytest

from common.r2 import reset_client, MAX_IMAGE_SIZE


@pytest.fixture(autouse=True)
def _reset_r2():
    """Reset the R2 client singleton before each test."""
    reset_client()
    yield
    reset_client()


class TestR2NoCredentials:
    """Graceful no-op when R2 credentials are not configured."""

    def test_returns_none_without_creds(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("R2_")}
        with patch.dict(os.environ, env, clear=True):
            from common.r2 import upload_reddit_evidence
            result = upload_reddit_evidence("https://i.redd.it/test.jpg", "abc123")
        assert result is None

    def test_returns_none_with_partial_creds(self):
        env = {k: v for k, v in os.environ.items() if not k.startswith("R2_")}
        env["R2_ACCOUNT_ID"] = "test-account"
        with patch.dict(os.environ, env, clear=True):
            from common.r2 import upload_reddit_evidence
            result = upload_reddit_evidence("https://i.redd.it/test.jpg", "abc123")
        assert result is None


class TestR2Upload:
    """Successful uploads with mocked boto3 and requests."""

    R2_ENV = {
        "R2_ACCOUNT_ID": "test-account",
        "R2_ACCESS_KEY_ID": "test-key",
        "R2_SECRET_ACCESS_KEY": "test-secret",
        "R2_BUCKET_NAME": "test-bucket",
    }

    @staticmethod
    def _make_response(content=b"fake-image-data", content_type="image/jpeg", content_length=None):
        resp = MagicMock()
        resp.content = content
        resp.headers = {"Content-Type": content_type}
        if content_length is not None:
            resp.headers["Content-Length"] = str(content_length)
        resp.raise_for_status = MagicMock()
        return resp

    def test_successful_upload_jpg(self):
        mock_boto3 = MagicMock()
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        mock_requests = MagicMock()
        mock_requests.get.return_value = self._make_response()

        with patch.dict(os.environ, self.R2_ENV):
            with patch.dict(sys.modules, {"boto3": mock_boto3, "requests": mock_requests}):
                from common.r2 import upload_reddit_evidence
                result = upload_reddit_evidence("https://i.redd.it/test.jpg", "sub123")

        assert result is not None
        assert result.startswith("reddit-evidence/")
        assert result.endswith("/sub123.jpg")
        mock_client.put_object.assert_called_once()

    def test_successful_upload_png(self):
        mock_boto3 = MagicMock()
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        mock_requests = MagicMock()
        mock_requests.get.return_value = self._make_response(content_type="image/png")

        with patch.dict(os.environ, self.R2_ENV):
            with patch.dict(sys.modules, {"boto3": mock_boto3, "requests": mock_requests}):
                from common.r2 import upload_reddit_evidence
                result = upload_reddit_evidence("https://i.redd.it/test.png", "sub456")

        assert result is not None
        assert result.endswith("/sub456.png")

    def test_skips_oversized_image_by_content_length(self):
        mock_boto3 = MagicMock()
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        mock_requests = MagicMock()
        mock_requests.get.return_value = self._make_response(
            content_length=MAX_IMAGE_SIZE + 1,
        )

        with patch.dict(os.environ, self.R2_ENV):
            with patch.dict(sys.modules, {"boto3": mock_boto3, "requests": mock_requests}):
                from common.r2 import upload_reddit_evidence
                result = upload_reddit_evidence("https://i.redd.it/huge.jpg", "big123")

        assert result is None
        mock_client.put_object.assert_not_called()

    def test_skips_oversized_image_by_body(self):
        mock_boto3 = MagicMock()
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        oversized_content = b"x" * (MAX_IMAGE_SIZE + 1)
        mock_requests = MagicMock()
        mock_requests.get.return_value = self._make_response(content=oversized_content)

        with patch.dict(os.environ, self.R2_ENV):
            with patch.dict(sys.modules, {"boto3": mock_boto3, "requests": mock_requests}):
                from common.r2 import upload_reddit_evidence
                result = upload_reddit_evidence("https://i.redd.it/huge.jpg", "big456")

        assert result is None
        mock_client.put_object.assert_not_called()

    def test_handles_download_failure(self):
        mock_boto3 = MagicMock()
        mock_client = MagicMock()
        mock_boto3.client.return_value = mock_client

        mock_requests = MagicMock()
        mock_requests.get.side_effect = Exception("Connection timeout")

        with patch.dict(os.environ, self.R2_ENV):
            with patch.dict(sys.modules, {"boto3": mock_boto3, "requests": mock_requests}):
                from common.r2 import upload_reddit_evidence
                result = upload_reddit_evidence("https://i.redd.it/fail.jpg", "fail123")

        assert result is None

    def test_handles_upload_failure(self):
        mock_boto3 = MagicMock()
        mock_client = MagicMock()
        mock_client.put_object.side_effect = Exception("R2 upload failed")
        mock_boto3.client.return_value = mock_client

        mock_requests = MagicMock()
        mock_requests.get.return_value = self._make_response()

        with patch.dict(os.environ, self.R2_ENV):
            with patch.dict(sys.modules, {"boto3": mock_boto3, "requests": mock_requests}):
                from common.r2 import upload_reddit_evidence
                result = upload_reddit_evidence("https://i.redd.it/test.jpg", "fail456")

        assert result is None
