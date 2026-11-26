"""BigQuery event log: append-only activity history for consolidation and analytics.

Table (created by `ensure()` if missing), partitioned by day and clustered by tenant:
    event_id STRING, tenant_id STRING, kind STRING, actor STRING, scope STRING,
    session_id STRING, payload JSON, ts TIMESTAMP
"""

from __future__ import annotations

import datetime as dt
import json
from typing import Any, Sequence

from everstate.domain import AdapterUnavailable, Event

from ._sync import require_project, run_sync

try:
    from google.cloud import bigquery
except ImportError as exc:  # pragma: no cover
    raise AdapterUnavailable("BigQuery adapter needs `pip install google-cloud-bigquery`") from exc

SCHEMA = [
    bigquery.SchemaField("event_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("tenant_id", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("kind", "STRING", mode="REQUIRED"),
    bigquery.SchemaField("actor", "STRING"),
    bigquery.SchemaField("scope", "STRING"),
    bigquery.SchemaField("session_id", "STRING"),
    bigquery.SchemaField("payload", "JSON"),
    bigquery.SchemaField("ts", "TIMESTAMP", mode="REQUIRED"),
]


class BigQueryEventLog:
    def __init__(self, client: Any, table_id: str) -> None:
        self._bq, self._table = client, table_id
        self._ensured = False

    async def ensure(self) -> None:
        if self._ensured:
            return

        def create() -> None:
            table = bigquery.Table(self._table, schema=SCHEMA)
            table.time_partitioning = bigquery.TimePartitioning(field="ts")
            table.clustering_fields = ["tenant_id", "kind"]
            self._bq.create_table(table, exists_ok=True)

        await run_sync(create)
        self._ensured = True

    async def append(self, event: Event) -> None:
        await self.ensure()
        row = {**event.to_dict(), "event_id": event.id, "payload": json.dumps(dict(event.payload)),
               "ts": dt.datetime.fromtimestamp(event.ts, tz=dt.timezone.utc).isoformat()}
        row.pop("id", None)
        errors = await run_sync(self._bq.insert_rows_json, self._table, [row], row_ids=[event.id])
        if errors:
            raise RuntimeError(f"BigQuery insert failed: {errors}")

    async def read(self, tenant_id: str, *, kinds: Sequence[str] | None = None,
                   since_ts: float | None = None, limit: int = 1000) -> list[Event]:
        await self.ensure()
        where, params = ["tenant_id = @tenant"], [bigquery.ScalarQueryParameter("tenant", "STRING", tenant_id)]
        if kinds:
            where.append("kind IN UNNEST(@kinds)")
            params.append(bigquery.ArrayQueryParameter("kinds", "STRING", list(kinds)))
        if since_ts:
            where.append("ts > TIMESTAMP_MICROS(@since)")
            params.append(bigquery.ScalarQueryParameter("since", "INT64", int(since_ts * 1_000_000)))
        sql = (f"SELECT event_id, tenant_id, kind, actor, scope, session_id, TO_JSON_STRING(payload) AS payload, "
               f"UNIX_MICROS(ts) AS ts FROM `{self._table}` WHERE {' AND '.join(where)} ORDER BY ts DESC LIMIT {int(limit)}")

        def run() -> list[Event]:
            job = self._bq.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=params))
            out = []
            for r in job.result():
                payload = json.loads(r["payload"]) if r["payload"] else {}
                if isinstance(payload, str):
                    payload = json.loads(payload)
                out.append(Event.from_dict({"id": r["event_id"], "tenant_id": r["tenant_id"], "kind": r["kind"],
                                            "actor": r["actor"], "scope": r["scope"], "session_id": r["session_id"],
                                            "payload": payload, "ts": r["ts"] / 1_000_000}))
            return list(reversed(out))

        return await run_sync(run)


def build_events(settings: Any, ctx: Any) -> BigQueryEventLog:
    project = require_project(settings)
    client = ctx.resource("bigquery", lambda: bigquery.Client(project=project))
    g = settings.google
    return BigQueryEventLog(client, f"{project}.{g.bigquery_dataset}.{g.bigquery_events_table}")
