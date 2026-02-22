"""Structured JSON logging for pipeline scrapers."""

import json
import logging
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Emit log records as single-line JSON (matches @askarthur/utils/logger format)."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            entry["error"] = self.formatException(record.exc_info)
        # Merge any extra fields passed via `extra={"metadata": {...}}`
        if hasattr(record, "metadata") and isinstance(record.metadata, dict):
            entry.update(record.metadata)
        return json.dumps(entry)


def get_logger(name: str) -> logging.Logger:
    """Return a logger with JSON output to stdout."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger
