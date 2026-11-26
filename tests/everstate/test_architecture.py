"""Structural laws: dependency direction, determinism, factory behaviour."""

from __future__ import annotations

import ast
import os
import pathlib
import subprocess
import sys

import pytest

from everstate import Settings
from everstate.domain import AdapterUnavailable, ConfigurationError
from everstate.registry import BuildContext, Registry, registry

PKG = pathlib.Path(__file__).resolve().parents[2] / "src" / "everstate"
FORBIDDEN = ("google", "redis", "httpx", "fastapi", "firebase", "openai")


def _imports(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    return names


def test_core_depends_only_on_ports():
    """Dependency inversion: nothing outside adapters/ imports an SDK or network client."""
    offenders = {}
    for path in PKG.rglob("*.py"):
        if "adapters" in path.relative_to(PKG).parts:
            continue
        bad = _imports(path) & set(FORBIDDEN)
        if bad:
            offenders[str(path.relative_to(PKG))] = sorted(bad)
    assert offenders == {}


def test_hashing_embedder_is_stable_across_processes():
    """Determinism: vectors must not depend on PYTHONHASHSEED (the old hash() bug)."""
    code = "from everstate.adapters.local import HashingEmbedder;print(sum(HashingEmbedder(64).embed_one('Ada prefers Rust')[:8]))"
    outs = set()
    for seed in ("0", "1", "12345"):
        env = {**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": str(PKG.parent)}
        outs.add(subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True).stdout)
    assert len(outs) == 1


def test_profiles_resolve_every_port():
    for profile in ("local", "redis", "gcp"):
        s = Settings(profile=profile)
        assert all(s.describe()[p] for p in ("store", "index", "cache", "events", "embedder", "llm"))
    assert Settings(profile="gcp").serving == "redis"
    assert Settings(profile="redis", serving="redis").serving == "direct"   # Redis is already the store


def test_env_overrides_and_aliases():
    s = Settings.from_env({"EVERSTATE_PROFILE": "gcp", "EVERSTATE_EMBEDDER": "ollama",
                           "GOOGLE_CLOUD_PROJECT": "p1", "EVERSTATE_EMBED_DIMENSIONS": "512",
                           "EVERSTATE_REDIS_URL": "redis://10.0.0.3:6379/0"})
    assert (s.store, s.embedder, s.google.project, s.embedding.dimensions, s.redis.url) == (
        "spanner", "ollama", "p1", 512, "redis://10.0.0.3:6379/0")


def test_registry_is_open_for_extension():
    reg = Registry()

    @reg.register("cache", "custom")
    def build(settings, ctx):
        return "custom-cache"

    assert reg.build("cache", "custom", Settings(), BuildContext()) == "custom-cache"
    with pytest.raises(ConfigurationError):
        reg.build("cache", "nope", Settings(), BuildContext())
    with pytest.raises(ConfigurationError):
        reg.register("not-a-port", "x")


def test_every_registered_adapter_resolves_or_reports_missing_dependency():
    for port in ("embedder", "llm", "store", "index", "cache", "events"):
        for name in registry.names(port):
            target = registry._entries[(port, name)]
            if isinstance(target, str):
                try:
                    Registry._resolve(target)
                except AdapterUnavailable:
                    pass   # optional extra not installed: acceptable, must be explicit
