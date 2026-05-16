import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

MAX_BYTES = 10 * 1024 * 1024
BACKUP_COUNT = 5
FORMAT = "%(asctime)s [%(levelname)s] %(name)s - %(message)s"
DATEFMT = "%Y-%m-%d %H:%M:%S"


def setup_logging(name: str) -> logging.Logger:
    formatter = logging.Formatter(FORMAT, datefmt=DATEFMT)

    file_handler = RotatingFileHandler(
        LOG_DIR / f"{name}.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in list(root.handlers):
        root.removeHandler(h)
    root.addHandler(file_handler)
    root.addHandler(stream_handler)

    return logging.getLogger(name)
