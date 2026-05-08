"""
CLI entry point for the Jobs Agency pipeline.

Usage:
    uv run python run_agents.py "https://jobs.example.com/posting/12345"
    uv run python run_agents.py <url> [--max-iterations N] [--threshold F] [--verbose]
"""

import argparse
import sys


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Jobs Agency — automated resume tailoring pipeline"
    )
    parser.add_argument("url", help="Job posting URL")
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=None,
        metavar="N",
        help="Max QA → Resume Tailor loops (default: 4, or MAX_TAILORING_ITERATIONS env var)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=None,
        metavar="F",
        help="QA pass score threshold 0.0–1.0 (default: 0.92, or QA_PASS_THRESHOLD env var)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print extended pipeline event details",
    )

    args = parser.parse_args()

    if args.threshold is not None and not (0.0 <= args.threshold <= 1.0):
        print(f"Error: --threshold must be between 0.0 and 1.0, got {args.threshold}")
        sys.exit(1)

    from agents.orchestrator import run
    run(
        job_url=args.url,
        max_iterations=args.max_iterations,
        threshold=args.threshold,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
