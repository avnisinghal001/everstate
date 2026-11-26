"""Small, dependency-free vector math and binary packing shared by adapters."""

from __future__ import annotations

import math
import struct
from array import array
from typing import Sequence

from everstate.domain import DimensionMismatch, Vector


def normalize(vec: Sequence[float]) -> Vector:
    norm = math.sqrt(sum(x * x for x in vec))
    if norm == 0.0:
        return [0.0] * len(vec)
    return [x / norm for x in vec]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        raise DimensionMismatch(f"vector lengths differ: {len(a)} vs {len(b)}")
    dot = na = nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / math.sqrt(na * nb)


def truncate(vec: Sequence[float], dimensions: int) -> Vector:
    """Matryoshka-style truncation + renormalisation (valid only for MRL-trained models)."""
    if dimensions >= len(vec):
        return list(vec)
    return normalize(vec[:dimensions])


def to_float32_bytes(vec: Sequence[float]) -> bytes:
    """Little-endian float32 blob, the format Redis/Valkey vector fields expect."""
    return array("f", vec).tobytes() if struct.pack("=f", 1.0) == struct.pack("<f", 1.0) else struct.pack(
        f"<{len(vec)}f", *vec
    )


def from_float32_bytes(blob: bytes) -> Vector:
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))


def check_dimensions(vec: Sequence[float], expected: int) -> None:
    if len(vec) != expected:
        raise DimensionMismatch(f"expected {expected}-d vector, got {len(vec)}-d")
