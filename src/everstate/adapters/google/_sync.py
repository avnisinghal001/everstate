"""Run blocking Google SDK calls without blocking the event loop."""

from __future__ import annotations

import asyncio
import functools
from typing import Any, Callable, TypeVar

T = TypeVar("T")


async def run_sync(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    return await asyncio.to_thread(functools.partial(fn, *args, **kwargs))


def require_project(settings: Any) -> str:
    from everstate.domain import ConfigurationError

    project = settings.google.project
    if not project:
        raise ConfigurationError("set GOOGLE_CLOUD_PROJECT (or EVERSTATE_GOOGLE_PROJECT) for Google adapters")
    return project
