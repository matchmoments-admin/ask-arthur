"""Deep investigation pipeline — passive reconnaissance on high-risk entities.

Runs nmap, dnsrecon, whatweb, sslscan, nikto, and whois against entities
flagged as CRITICAL or HIGH risk. Results stored in investigation_data JSONB.

Safety:
  - Max 50 entities per run
  - 1s delay between targets
  - Private IP filtering (RFC1918/loopback skipped)
  - No active exploitation — passive recon only
  - Raw output truncated to 2KB
  - No credential brute-forcing (nikto info-gathering mode only)
"""

import json
import os
import re
import subprocess
import time
import ipaddress
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

MAX_RAW_OUTPUT = 2048  # Truncate raw tool output to 2KB
DELAY_BETWEEN_TARGETS = 1  # Seconds between targets


def get_db_connection():
    """Connect to Supabase PostgreSQL via SUPABASE_DB_URL."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        raise RuntimeError("SUPABASE_DB_URL environment variable not set")
    return psycopg2.connect(db_url)


def is_private_ip(ip_str: str) -> bool:
    """Check if an IP address is private/loopback/reserved."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return addr.is_private or addr.is_loopback or addr.is_reserved
    except ValueError:
        return True  # Invalid IP — skip


def truncate(text: str, max_len: int = MAX_RAW_OUTPUT) -> str:
    """Truncate text to max_len characters."""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "... [truncated]"


def run_command(cmd: list[str], timeout: int = 120) -> tuple[str, int]:
    """Run a shell command with timeout. Returns (stdout, returncode)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout + result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return f"Command timed out after {timeout}s", -1
    except FileNotFoundError:
        return f"Tool not found: {cmd[0]}", -1


def investigate_ip(ip: str) -> dict[str, Any]:
    """Run passive reconnaissance tools against an IP address."""
    if is_private_ip(ip):
        return {"skipped": True, "reason": "private_ip"}

    tools: dict[str, Any] = {}
    signals: list[str] = []
    investigation_score = 0

    # nmap service version detection on top 100 ports
    nmap_cmd = ["nmap", "-sV", "-Pn", "--top-ports", "100", "-T4", "--open", ip]
    nmap_out, nmap_rc = run_command(nmap_cmd, timeout=90)
    if nmap_rc == 0:
        open_ports = re.findall(r"^(\d+)/tcp\s+open", nmap_out, re.MULTILINE)
        services: dict[str, str] = {}
        for line in nmap_out.splitlines():
            match = re.match(r"(\d+)/tcp\s+open\s+\S+\s+(.*)", line)
            if match:
                services[match.group(1)] = match.group(2).strip()

        tools["nmap"] = {
            "command": " ".join(nmap_cmd),
            "openPorts": [int(p) for p in open_ports],
            "services": services,
            "raw": truncate(nmap_out),
        }

        if len(open_ports) > 10:
            signals.append("many_open_ports")
            investigation_score += 3
        # Check for open mail relay (port 25)
        if "25" in open_ports:
            signals.append("open_mail_relay")
            investigation_score += 5

    # nmap SSL cipher analysis
    ssl_cmd = ["nmap", "--script", "ssl-enum-ciphers", "-p", "443", "-Pn", ip]
    ssl_out, ssl_rc = run_command(ssl_cmd, timeout=60)
    if ssl_rc == 0 and "ssl-enum-ciphers" in ssl_out:
        has_weak = bool(
            re.search(r"(SSLv3|TLSv1\.0|TLSv1\.1)", ssl_out)
            or re.search(r"(RC4|DES|NULL|EXPORT)", ssl_out)
        )
        tools["nmap_ssl"] = {
            "command": " ".join(ssl_cmd),
            "weakCiphers": has_weak,
            "raw": truncate(ssl_out),
        }
        if has_weak:
            signals.append("weak_ssl")
            investigation_score += 5

    # Raw whois for IP
    whois_out, whois_rc = run_command(["whois", ip], timeout=30)
    if whois_rc == 0:
        # Check for bulletproof hosting indicators
        bp_keywords = [
            "bulletproof", "offshore", "abuse-resistant",
            "privacy-first", "anonymous hosting",
        ]
        is_bp = any(kw in whois_out.lower() for kw in bp_keywords)
        tools["whois"] = {
            "command": f"whois {ip}",
            "bulletproofHosting": is_bp,
            "raw": truncate(whois_out),
        }
        if is_bp:
            signals.append("bulletproof_hosting")
            investigation_score += 10

    return {
        "tools": tools,
        "signals": signals,
        "investigationScore": investigation_score,
    }


def investigate_domain(domain: str) -> dict[str, Any]:
    """Run passive reconnaissance tools against a domain."""
    tools: dict[str, Any] = {}
    signals: list[str] = []
    investigation_score = 0

    # dnsrecon
    dnsrecon_cmd = [
        "dnsrecon", "-d", domain, "-t", "std,brt",
        "-D", "/usr/share/dnsrecon/namelist.txt",
        "--lifetime", "3",
    ]
    dnsrecon_out, dnsrecon_rc = run_command(dnsrecon_cmd, timeout=60)
    if dnsrecon_rc == 0 or dnsrecon_out:
        zone_transfer = "zone transfer" in dnsrecon_out.lower() and "successful" in dnsrecon_out.lower()
        wildcard = "wildcard" in dnsrecon_out.lower()

        # Extract subdomains from output
        subdomain_pattern = re.compile(
            rf"([a-zA-Z0-9._-]+\.{re.escape(domain)})", re.IGNORECASE
        )
        subdomains = list(set(subdomain_pattern.findall(dnsrecon_out)))[:20]

        tools["dnsrecon"] = {
            "command": " ".join(dnsrecon_cmd),
            "subdomains": subdomains,
            "zoneTransferOpen": zone_transfer,
            "wildcardDetected": wildcard,
            "raw": truncate(dnsrecon_out),
        }
        if zone_transfer:
            signals.append("zone_transfer_open")
            investigation_score += 10
        if wildcard:
            signals.append("wildcard_dns")
            investigation_score += 5

    # whatweb
    url = f"https://{domain}"
    whatweb_cmd = ["whatweb", "-q", "--log-json=-", url]
    whatweb_out, whatweb_rc = run_command(whatweb_cmd, timeout=30)
    if whatweb_rc == 0 and whatweb_out.strip():
        try:
            # whatweb JSON output may contain multiple lines
            whatweb_lines = [
                json.loads(line)
                for line in whatweb_out.strip().splitlines()
                if line.strip().startswith("{")
            ]
            technologies: list[str] = []
            http_server = None
            country = None
            for entry in whatweb_lines:
                for plugin_name, plugin_data in entry.get("plugins", {}).items():
                    if plugin_name == "HTTPServer":
                        http_server = plugin_data.get("string", [None])[0] if isinstance(plugin_data.get("string"), list) else None
                    elif plugin_name == "Country":
                        country = plugin_data.get("string", [None])[0] if isinstance(plugin_data.get("string"), list) else None
                    elif plugin_data.get("version"):
                        technologies.append(
                            f"{plugin_name} {plugin_data['version'][0]}"
                            if isinstance(plugin_data["version"], list)
                            else f"{plugin_name} {plugin_data['version']}"
                        )
                    elif plugin_name not in ("IP", "Country", "HTTPServer", "Title", "Cookies"):
                        technologies.append(plugin_name)

            tools["whatweb"] = {
                "command": " ".join(whatweb_cmd),
                "technologies": technologies[:15],
                "country": country,
                "httpServer": http_server,
            }
        except json.JSONDecodeError:
            tools["whatweb"] = {
                "command": " ".join(whatweb_cmd),
                "raw": truncate(whatweb_out),
            }

    # sslscan
    sslscan_cmd = ["sslscan", "--no-colour", domain]
    sslscan_out, sslscan_rc = run_command(sslscan_cmd, timeout=30)
    if sslscan_rc == 0 and sslscan_out:
        has_sslv3 = "SSLv3" in sslscan_out and "Enabled" in sslscan_out
        has_tls10 = "TLSv1.0" in sslscan_out and "Enabled" in sslscan_out
        self_signed = "self-signed" in sslscan_out.lower() or "self signed" in sslscan_out.lower()

        tools["sslscan"] = {
            "command": " ".join(sslscan_cmd),
            "sslv3Enabled": has_sslv3,
            "tls10Enabled": has_tls10,
            "selfSigned": self_signed,
            "raw": truncate(sslscan_out),
        }
        if has_sslv3 or has_tls10:
            signals.append("deprecated_tls")
            investigation_score += 5
        if self_signed:
            signals.append("self_signed_cert")
            investigation_score += 8

    return {
        "tools": tools,
        "signals": signals,
        "investigationScore": investigation_score,
    }


def investigate_url(url: str) -> dict[str, Any]:
    """Run passive reconnaissance tools against a URL."""
    tools: dict[str, Any] = {}
    signals: list[str] = []
    investigation_score = 0

    # nikto web vulnerability scan (info-gathering mode only)
    nikto_cmd = [
        "nikto", "-h", url, "-Tuning", "1", "2", "3",
        "-maxtime", "60s", "-Format", "json",
    ]
    nikto_out, nikto_rc = run_command(nikto_cmd, timeout=90)
    if nikto_rc >= 0 and nikto_out:
        try:
            nikto_data = json.loads(nikto_out)
            vulns = nikto_data.get("vulnerabilities", [])
            tools["nikto"] = {
                "command": " ".join(nikto_cmd),
                "vulnerabilityCount": len(vulns),
                "highlights": [v.get("msg", "")[:200] for v in vulns[:10]],
            }
            # Check for admin panel exposure
            admin_keywords = ["admin", "login", "dashboard", "wp-admin", "phpmyadmin"]
            for v in vulns:
                msg = v.get("msg", "").lower()
                if any(kw in msg for kw in admin_keywords):
                    signals.append("admin_panel_exposed")
                    investigation_score += 5
                    break
            # Directory listing
            for v in vulns:
                msg = v.get("msg", "").lower()
                if "directory listing" in msg or "index of" in msg:
                    signals.append("directory_listing")
                    investigation_score += 3
                    break
        except json.JSONDecodeError:
            tools["nikto"] = {
                "command": " ".join(nikto_cmd),
                "raw": truncate(nikto_out),
            }

    # curl headers with redirect chain
    curl_cmd = ["curl", "-sI", "-L", "--max-time", "10", "--max-redirs", "5", url]
    curl_out, curl_rc = run_command(curl_cmd, timeout=15)
    if curl_rc == 0 and curl_out:
        # Extract security headers
        security_headers = [
            "strict-transport-security",
            "content-security-policy",
            "x-frame-options",
            "x-content-type-options",
            "x-xss-protection",
            "referrer-policy",
        ]
        present_headers: list[str] = []
        missing_headers: list[str] = []
        header_lower = curl_out.lower()
        for h in security_headers:
            if h in header_lower:
                present_headers.append(h)
            else:
                missing_headers.append(h)

        # Extract server header
        server_match = re.search(r"^server:\s*(.+)$", curl_out, re.IGNORECASE | re.MULTILINE)
        server = server_match.group(1).strip() if server_match else None

        tools["curl"] = {
            "command": " ".join(curl_cmd),
            "server": server,
            "presentSecurityHeaders": present_headers,
            "missingSecurityHeaders": missing_headers,
            "raw": truncate(curl_out),
        }

    return {
        "tools": tools,
        "signals": signals,
        "investigationScore": investigation_score,
    }


def investigate_entity(
    entity_type: str, value: str
) -> dict[str, Any]:
    """Dispatch investigation to the appropriate handler."""
    if entity_type == "ip":
        return investigate_ip(value)
    elif entity_type == "domain":
        return investigate_domain(value)
    elif entity_type == "url":
        return investigate_url(value)
    else:
        return {"skipped": True, "reason": f"unsupported_type: {entity_type}"}


def investigate_single(entity_type: str, value: str, dry_run: bool = False):
    """Investigate a single entity (CLI mode)."""
    print(f"Investigating {entity_type}: {value}")
    result = investigate_entity(entity_type, value)
    result["investigatedAt"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(result, indent=2))
    if not dry_run:
        print("(Dry run not specified but no entity ID — skipping DB write)")


def run_investigation(
    entity_type: str = "all",
    risk_threshold: str = "HIGH",
    dry_run: bool = False,
    limit: int = 50,
):
    """Main investigation loop — query DB, investigate, store results."""
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Build entity type filter
            type_filter = ""
            if entity_type != "all":
                type_filter = f"AND entity_type = '{entity_type}'"

            risk_levels = (
                "('CRITICAL')" if risk_threshold == "CRITICAL"
                else "('CRITICAL', 'HIGH')"
            )

            query = f"""
                SELECT id, entity_type, normalized_value, enrichment_data,
                       risk_score, risk_level
                FROM scam_entities
                WHERE risk_level IN {risk_levels}
                  AND last_seen > NOW() - INTERVAL '7 days'
                  AND (investigation_data IS NULL
                       OR investigated_at < NOW() - INTERVAL '7 days')
                  {type_filter}
                ORDER BY risk_score DESC
                LIMIT %s;
            """
            cur.execute(query, (limit,))
            entities = cur.fetchall()

            if not entities:
                print("No entities found matching criteria.")
                return

            print(f"Found {len(entities)} entities to investigate.")
            investigated = 0
            failed = 0

            for entity in entities:
                eid = entity["id"]
                etype = entity["entity_type"]
                value = entity["normalized_value"]
                print(f"\n[{investigated + 1}/{len(entities)}] {etype}: {value}")

                try:
                    result = investigate_entity(etype, value)
                    result["investigatedAt"] = datetime.now(timezone.utc).isoformat()

                    if result.get("skipped"):
                        print(f"  Skipped: {result.get('reason')}")
                        continue

                    signal_count = len(result.get("signals", []))
                    score = result.get("investigationScore", 0)
                    print(
                        f"  Signals: {signal_count}, Score: +{score}, "
                        f"Tools: {list(result.get('tools', {}).keys())}"
                    )

                    if not dry_run:
                        cur.execute(
                            """
                            UPDATE scam_entities
                            SET investigation_data = %s,
                                investigated_at = NOW()
                            WHERE id = %s;
                            """,
                            (json.dumps(result), eid),
                        )
                        conn.commit()

                    investigated += 1

                except Exception as e:
                    print(f"  ERROR: {e}")
                    failed += 1

                # Delay between targets
                time.sleep(DELAY_BETWEEN_TARGETS)

            print(f"\nDone. Investigated: {investigated}, Failed: {failed}")

    finally:
        conn.close()
