"""Typed errors so callers (and the HTTP layer) can map failures precisely."""


class EverstateError(Exception):
    """Base class for all Everstate errors."""


class ConfigurationError(EverstateError):
    """Invalid or incomplete configuration (unknown adapter, missing setting...)."""


class AdapterUnavailable(EverstateError):
    """An adapter's optional dependency or backing service is not available."""


class NotFound(EverstateError):
    pass


class TenantViolation(EverstateError):
    """An operation tried to read or write across a tenant boundary."""


class DimensionMismatch(EverstateError):
    """Vector length differs from what the index was created with."""


class LLMError(EverstateError):
    pass
