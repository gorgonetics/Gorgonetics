#!/usr/bin/env python3
"""
Run the PGBreeder web application.

This script starts the web server for the gene editing interface.
Make sure to run 'python populate_database.py' first to set up the database.
"""

import logging
import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent / "src"))

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main():
    """Run the web application."""
    logger.info("🧬 Starting PGBreeder Web Application")

    # Start web server
    logger.info("🚀 Starting web server...")
    logger.info("🌐 Open your browser to: http://127.0.0.1:8000")
    logger.info("� If you see 'Database is empty', run: python populate_database.py")

    try:
        import uvicorn

        # Use a simpler configuration without reload for better compatibility
        uvicorn.run("pgbreeder.web_app:app", host="127.0.0.1", port=8000, reload=False, log_level="info")
    except KeyboardInterrupt:
        logger.info("\n👋 Shutting down PGBreeder Web Application")
    except Exception as e:
        logger.error(f"❌ Error running web server: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
