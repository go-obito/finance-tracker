"""Custom exceptions for the application."""


class FinanceTrackerException(Exception):
    """Base exception for the application."""

    pass


class ResourceNotFoundError(FinanceTrackerException):
    """Raised when a resource is not found."""

    pass


class ValidationError(FinanceTrackerException):
    """Raised when validation fails."""

    pass


class DatabaseError(FinanceTrackerException):
    """Raised when database operations fail."""

    pass


class UnauthorizedError(FinanceTrackerException):
    """Raised when user is not authorized."""

    pass
