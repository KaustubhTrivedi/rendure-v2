"""Job discovery scheduler.

Runs the Job Discovery agent on a configurable daily schedule using APScheduler.
Run once as a long-lived process:

    uv run python scheduler.py
    uv run python scheduler.py --hour 8 --minute 0   # run at 08:00 local time
    uv run python scheduler.py --run-now              # fire immediately, then schedule

Logs go to stdout. Keep this process alive (e.g. via systemd, screen, or a
Docker container) — it does not daemonise itself.
"""

import argparse
import logging
import sys

from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scheduler")


def _discover() -> None:
    from agents.job_discovery import run
    logger.info("Starting job discovery run…")
    summary = run()
    logger.info(
        "Discovery complete: %d found, %d unique, %d relevant, %d new",
        summary["total_found"],
        summary["unique"],
        summary["relevant"],
        summary["inserted"],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Rendure job discovery scheduler")
    parser.add_argument("--hour", type=int, default=7, help="Hour to run (local time, default 7)")
    parser.add_argument("--minute", type=int, default=0, help="Minute to run (default 0)")
    parser.add_argument("--run-now", action="store_true", help="Fire immediately, then schedule")
    args = parser.parse_args()

    if args.run_now:
        _discover()

    scheduler = BlockingScheduler()
    scheduler.add_job(
        _discover,
        trigger=CronTrigger(hour=args.hour, minute=args.minute),
        id="job_discovery",
        name="Daily job discovery",
        misfire_grace_time=3600,
    )

    logger.info(
        "Scheduler started — discovery runs daily at %02d:%02d local time. Ctrl+C to stop.",
        args.hour,
        args.minute,
    )
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped.")


if __name__ == "__main__":
    main()
