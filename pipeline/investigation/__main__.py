"""Entry point for deep investigation pipeline.

Usage:
  python -m investigation                              # Full run (entities from DB)
  python -m investigation --type ip --value 1.2.3.4    # Single entity
  python -m investigation --dry-run                    # Dry run (no DB writes)
"""

import argparse
from .investigate import run_investigation, investigate_single


def main():
    parser = argparse.ArgumentParser(description="Deep investigation pipeline")
    parser.add_argument(
        "--type",
        choices=["ip", "domain", "url", "all"],
        default="all",
        help="Entity type to investigate",
    )
    parser.add_argument(
        "--value",
        help="Single entity value to investigate (skips DB query)",
    )
    parser.add_argument(
        "--risk-threshold",
        choices=["CRITICAL", "HIGH"],
        default="HIGH",
        help="Minimum risk level to investigate",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print results without writing to DB",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Max entities to investigate per run",
    )
    args = parser.parse_args()

    if args.value and args.type != "all":
        investigate_single(args.type, args.value, dry_run=args.dry_run)
    else:
        run_investigation(
            entity_type=args.type,
            risk_threshold=args.risk_threshold,
            dry_run=args.dry_run,
            limit=args.limit,
        )


if __name__ == "__main__":
    main()
