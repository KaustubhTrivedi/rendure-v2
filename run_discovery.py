"""One-shot discovery run entrypoint.

Called by the API's POST /discovery/run endpoint via uv run python run_discovery.py.
Runs once, writes results to discovered_jobs, exits.
"""

import logging
import sys

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)

if __name__ == "__main__":
    from agents.job_discovery import run
    summary = run()
    print(
        f"Discovery done: {summary['total_found']} found, "
        f"{summary['unique']} unique, {summary['relevant']} relevant, "
        f"{summary['inserted']} new."
    )
    sys.exit(0)
