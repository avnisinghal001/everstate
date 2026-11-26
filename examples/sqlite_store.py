"""Worked example: a custom MemoryStore adapter backed by stdlib SQLite.

Shows the full recipe for adding a backend to Everstate:
  1. implement the port (here `everstate.ports.MemoryStore`): async methods, tenant-bound
  2. prove it with the contract kit: `await everstate.testing.check_store(store)`
  3. register a factory under a name
  4. select it by configuration: EVERSTATE_STORE=sqlite (+ EVERSTATE_SQLITE_PATH)

    import examples.sqlite_store            # registers "sqlite"
    es = Everstate.from_settings(Settings(profile="local", store="sqlite"))
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import time
from typing import Any, Sequence

from everstate.domain import Memory, MemoryKind, MemoryStatus, Scope
from everstate.registry import registry

SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
  tenant_id TEXT NOT NULL, id TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
  status TEXT NOT NULL, updated_at REAL NOT NULL, expires_at REAL, doc TEXT NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS memories_by_key ON memories (tenant_id, key);
CREATE INDEX IF NOT EXISTS memories_by_time ON memories (tenant_id, updated_at DESC);
"""


class SQLiteMemoryStore:
    def __init__(self, path: str = ":memory:") -> None:
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.executescript(SCHEMA)
        self._lock = asyncio.Lock()   # sqlite3 connections are not safe for concurrent use

    async def _run(self, fn: Any) -> Any:
        async with self._lock:
            return await asyncio.to_thread(fn)

    async def put(self, memory: Memory) -> None:
        await self.put_many([memory])

    async def put_many(self, memories: Sequence[Memory]) -> None:
        rows = [(m.tenant_id, m.id, m.scope.key, m.kind.value, m.key, m.status.value, m.updated_at, m.expires_at,
                 json.dumps(m.to_dict(include_embedding=True))) for m in memories]

        def write() -> None:
            with self._db:
                self._db.executemany("INSERT OR REPLACE INTO memories VALUES (?,?,?,?,?,?,?,?,?)", rows)

        await self._run(write)

    async def get_many(self, tenant_id: str, ids: Sequence[str]) -> list[Memory]:
        if not ids:
            return []
        marks = ",".join("?" * len(ids))

        def read() -> list[str]:
            cur = self._db.execute(
                f"SELECT id, doc FROM memories WHERE tenant_id = ? AND id IN ({marks}) "
                "AND (expires_at IS NULL OR expires_at > ?)", (tenant_id, *ids, time.time()))
            return dict(cur.fetchall())

        docs = await self._run(read)
        return [Memory.from_dict(json.loads(docs[i])) for i in ids if i in docs]

    async def find(self, tenant_id: str, *, scopes: Sequence[Scope] | None = None,
                   statuses: Sequence[MemoryStatus] | None = None, kinds: Sequence[MemoryKind] | None = None,
                   key: str | None = None, limit: int = 100) -> list[Memory]:
        where, args = ["tenant_id = ?", "(expires_at IS NULL OR expires_at > ?)"], [tenant_id, time.time()]
        for column, values in (("scope", [s.key for s in scopes or []]), ("status", [s.value for s in statuses or []]),
                               ("kind", [k.value for k in kinds or []])):
            if values:
                where.append(f"{column} IN ({','.join('?' * len(values))})")
                args += values
        if key is not None:
            where.append("key = ?")
            args.append(key)
        sql = f"SELECT doc FROM memories WHERE {' AND '.join(where)} ORDER BY updated_at DESC LIMIT ?"
        rows = await self._run(lambda: self._db.execute(sql, (*args, limit)).fetchall())
        return [Memory.from_dict(json.loads(doc)) for (doc,) in rows]

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        if not ids:
            return 0
        marks = ",".join("?" * len(ids))

        def remove() -> int:
            with self._db:
                return self._db.execute(f"DELETE FROM memories WHERE tenant_id = ? AND id IN ({marks})",
                                        (tenant_id, *ids)).rowcount

        return await self._run(remove)


@registry.register("store", "sqlite")
def build_sqlite_store(settings: Any, ctx: Any) -> SQLiteMemoryStore:
    store = SQLiteMemoryStore(os.environ.get("EVERSTATE_SQLITE_PATH", "everstate.db"))
    ctx.on_close(lambda: asyncio.to_thread(store._db.close))
    return store
