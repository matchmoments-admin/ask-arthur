"""Shared pytest fixtures for pipeline scraper tests."""

import sys
from pathlib import Path

# Ensure the scrapers package is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
