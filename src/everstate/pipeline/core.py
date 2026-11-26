"""A tiny, typed pipeline primitive.

    pipeline = Pipeline("recall", EmbedQuery(), Search(), Hydrate(), Score(), Arbitrate(), TopK())
    state = await pipeline.run(state)

Every stage is an async callable `(state) -> state`. The pipeline records per-stage
wall time into `state.trace`, so each recall/remember explains where its latency went.
Stages compose with `|`:  Pipeline("x", a) | b | c
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Generic, Protocol, TypeVar

S = TypeVar("S", bound="StageState")


@dataclass
class StageState:
    trace: dict[str, float] = field(default_factory=dict)   # stage name -> milliseconds


class Stage(Protocol[S]):
    name: str

    async def __call__(self, state: S) -> S: ...


class Pipeline(Generic[S]):
    def __init__(self, name: str, *stages: Stage[S]) -> None:
        self.name = name
        self.stages: tuple[Stage[S], ...] = stages

    def __or__(self, stage: Stage[S]) -> "Pipeline[S]":
        return Pipeline(self.name, *self.stages, stage)

    async def run(self, state: S) -> S:
        for stage in self.stages:
            started = time.perf_counter()
            state = await stage(state)
            state.trace[stage.name] = round((time.perf_counter() - started) * 1000, 3)
        return state

    def describe(self) -> str:
        return f"{self.name}: " + " → ".join(s.name for s in self.stages)

    # ---------------------------------------------------------------- adaptation
    # Pipelines are immutable values: every edit returns a new Pipeline, so a tenant or
    # experiment can run a variant without touching the default.
    def _index(self, name: str) -> int:
        for i, s in enumerate(self.stages):
            if s.name == name:
                return i
        raise KeyError(f"{self.name} has no stage {name!r}; stages: {[s.name for s in self.stages]}")

    def insert_after(self, name: str, stage: Stage[S]) -> "Pipeline[S]":
        i = self._index(name) + 1
        return Pipeline(self.name, *self.stages[:i], stage, *self.stages[i:])

    def insert_before(self, name: str, stage: Stage[S]) -> "Pipeline[S]":
        i = self._index(name)
        return Pipeline(self.name, *self.stages[:i], stage, *self.stages[i:])

    def replace(self, name: str, stage: Stage[S]) -> "Pipeline[S]":
        i = self._index(name)
        return Pipeline(self.name, *self.stages[:i], stage, *self.stages[i + 1:])

    def without(self, name: str) -> "Pipeline[S]":
        i = self._index(name)
        return Pipeline(self.name, *self.stages[:i], *self.stages[i + 1:])


def stage(name: str) -> Any:
    """Decorator turning `async def fn(state)` into a named Stage."""

    def wrap(fn: Any) -> Any:
        class _Fn:
            def __init__(self) -> None:
                self.name = name

            async def __call__(self, state: Any) -> Any:
                return await fn(state)

        _Fn.__name__ = fn.__name__
        return _Fn()

    return wrap
