"""Diagnostic probe for cyber.gov.au — works out WHY the ACSC RSS scraper
fails from GitHub Actions runners.

Symptom: requests.exceptions.ReadTimeout after 90s × 3 retries (incl. a
Mozilla UA fallback). TCP connect succeeds (TLS handshake completes), no
body bytes ever arrive. Same endpoints serve <1s from local at HTTP/1.1.

This script tries multiple permutations and prints a tabular report we
can read from the GH Actions log:
    * methods:   HEAD vs GET
    * endpoints: /rss/alerts, /rss/advisories, /, /robots.txt
    * UAs:       AskArthur, Mozilla Safari, curl-style, no-UA, googlebot
    * libraries: requests vs urllib (rules out a python-requests quirk)
    * timing:    separate connect-timeout from read-timeout so we can
                 tell where exactly the failure lives

Run via the workflow_dispatch dropdown: feed=probe_acsc
"""
from __future__ import annotations

import socket
import ssl
import sys
import time
import urllib.request
from contextlib import closing

import requests

ENDPOINTS = [
    ("https://www.cyber.gov.au/rss/alerts", "rss-alerts"),
    ("https://www.cyber.gov.au/rss/advisories", "rss-advisories"),
    ("https://www.cyber.gov.au/", "homepage"),
    ("https://www.cyber.gov.au/robots.txt", "robots"),
]

USER_AGENTS = {
    "askarthur": "AskArthur-ThreatFeed/1.0 (+https://askarthur.au)",
    "mozilla": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    ),
    "curl": "curl/8.4.0",
    "googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "noua": None,
}


def _print_row(*cells, widths=(28, 12, 14, 10, 14, 10, 38)):
    parts = [str(c)[:w].ljust(w) for c, w in zip(cells, widths)]
    print(" | ".join(parts))


def _print_header():
    _print_row("endpoint", "method", "ua", "lib", "outcome", "ms", "detail")
    print("-" * 130)


def probe_dns() -> None:
    print("=== DNS resolution ===")
    try:
        info = socket.getaddrinfo(
            "www.cyber.gov.au", 443, type=socket.SOCK_STREAM
        )
        for fam, _, _, _, sockaddr in info[:6]:
            family = "IPv4" if fam == socket.AF_INET else "IPv6"
            print(f"  {family}: {sockaddr[0]}")
    except Exception as e:
        print(f"  resolution failed: {e}")
    print()


def probe_tcp_tls() -> None:
    """Pure socket+TLS probe — no HTTP at all. Tells us if Cloudflare even
    completes the TLS handshake from this network."""
    print("=== Raw TCP+TLS probe ===")
    ctx = ssl.create_default_context()
    t0 = time.time()
    try:
        with closing(socket.create_connection(("www.cyber.gov.au", 443), timeout=10)) as s:
            with closing(ctx.wrap_socket(s, server_hostname="www.cyber.gov.au")) as ss:
                ms = int((time.time() - t0) * 1000)
                print(f"  TLS handshake OK in {ms}ms")
                print(f"  cipher: {ss.cipher()}")
                print(f"  server cert: {ss.getpeercert().get('subject')}")
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        print(f"  FAILED in {ms}ms: {type(e).__name__}: {e}")
    print()


def probe_requests(method: str, url: str, ua: str | None) -> tuple[str, int, str]:
    headers = {}
    if ua is not None:
        headers["User-Agent"] = ua
    t0 = time.time()
    try:
        # Separate connect timeout (5s) from read timeout (15s) so we can
        # tell if the connection itself fails vs the body never arrives.
        resp = requests.request(
            method, url, headers=headers, timeout=(5, 15), allow_redirects=False
        )
        ms = int((time.time() - t0) * 1000)
        size = len(resp.content) if method == "GET" else int(resp.headers.get("Content-Length", 0))
        return f"HTTP {resp.status_code}", ms, f"{size}B server={resp.headers.get('Server', '?')}"
    except requests.ConnectionError as e:
        ms = int((time.time() - t0) * 1000)
        return "ConnError", ms, str(e)[:80]
    except requests.Timeout as e:
        ms = int((time.time() - t0) * 1000)
        kind = "ReadTimeout" if "read timeout" in str(e).lower() else "ConnTimeout"
        return kind, ms, str(e)[:80]
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return type(e).__name__, ms, str(e)[:80]


def probe_urllib(url: str, ua: str | None) -> tuple[str, int, str]:
    """Same probe via stdlib urllib — rules out a requests-specific issue."""
    req = urllib.request.Request(url)
    if ua is not None:
        req.add_header("User-Agent", ua)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            ms = int((time.time() - t0) * 1000)
            body = resp.read(2048)
            return f"HTTP {resp.status}", ms, f"{len(body)}B server={resp.getheader('Server', '?')}"
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return type(e).__name__, ms, str(e)[:80]


def main() -> int:
    print(f"Probe started at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    print("Runner-perspective public IP:")
    try:
        ip = requests.get("https://api.ipify.org", timeout=5).text.strip()
        print(f"  {ip}")
    except Exception as e:
        print(f"  could not determine: {e}")
    print()

    probe_dns()
    probe_tcp_tls()

    print("=== HTTP probes (requests + urllib) ===")
    _print_header()
    for url, label in ENDPOINTS:
        for method in ("HEAD", "GET"):
            for ua_name, ua_value in USER_AGENTS.items():
                outcome, ms, detail = probe_requests(method, url, ua_value)
                _print_row(label, method, ua_name, "requests", outcome, ms, detail)

        # urllib: GET only, mozilla UA only — control test for stdlib parity
        outcome, ms, detail = probe_urllib(url, USER_AGENTS["mozilla"])
        _print_row(label, "GET", "mozilla", "urllib", outcome, ms, detail)
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
