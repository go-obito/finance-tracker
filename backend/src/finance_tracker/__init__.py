"""Finance Tracker Application."""

from finance_tracker.main import create_app

# Create the FastAPI application
app = create_app()


def main() -> None:
    """Main entry point for the application."""
    import uvicorn

    uvicorn.run(
        "finance_tracker:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )


if __name__ == "__main__":
    main()
