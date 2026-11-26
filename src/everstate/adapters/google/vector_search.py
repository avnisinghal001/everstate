"""Vertex AI Vector Search (formerly Matching Engine) as the vector index.

Best for very large corpora (10^8+ vectors) with streaming updates. Tenant and scope
isolation use namespace restricts on every datapoint and every query:
    restricts: tenant=<id>, scope=<scope_key>, kind=<kind>
Datapoint IDs are "<tenant_tag>:<memory_id>" so identical memory IDs never collide.

Prerequisites (Terraform/console): a STREAM_UPDATE index with
distanceMeasureType=DOT_PRODUCT_DISTANCE and featureNormType=UNIT_L2_NORM (cosine
equivalent; the recommended setup) and matching dimensions, deployed to an index
endpoint. With that setup `neighbor.distance` is the cosine similarity. Configure:
    EVERSTATE_GOOGLE_VECTOR_SEARCH_INDEX, EVERSTATE_GOOGLE_VECTOR_SEARCH_ENDPOINT,
    EVERSTATE_GOOGLE_VECTOR_SEARCH_DEPLOYED_INDEX_ID
"""

from __future__ import annotations

import hashlib
from typing import Any, Sequence

from everstate.domain import AdapterUnavailable, ConfigurationError, Hit
from everstate.ports import IndexEntry

from ._sync import require_project, run_sync

try:
    from google.cloud import aiplatform
    from google.cloud.aiplatform.matching_engine.matching_engine_index_endpoint import Namespace
    from google.cloud.aiplatform_v1.types import IndexDatapoint
except ImportError as exc:  # pragma: no cover
    raise AdapterUnavailable("Vector Search adapter needs `pip install google-cloud-aiplatform`") from exc


def _tag(tenant_id: str) -> str:
    return hashlib.sha1(tenant_id.encode()).hexdigest()[:16]


class VertexVectorSearchIndex:
    colocated = False

    def __init__(self, index: Any, endpoint: Any, deployed_index_id: str, dimensions: int) -> None:
        self.dimensions = dimensions
        self._index, self._endpoint, self._deployed = index, endpoint, deployed_index_id

    async def ensure(self) -> None:
        return None

    async def upsert(self, tenant_id: str, entries: Sequence[IndexEntry]) -> None:
        tag = _tag(tenant_id)
        points = [
            IndexDatapoint(
                datapoint_id=f"{tag}:{e.memory_id}",
                feature_vector=list(e.vector),
                restricts=[
                    IndexDatapoint.Restriction(namespace="tenant", allow_list=[tag]),
                    IndexDatapoint.Restriction(namespace="scope", allow_list=[e.scope_key]),
                    IndexDatapoint.Restriction(namespace="kind", allow_list=[e.kind]),
                ],
            )
            for e in entries
        ]
        if points:
            await run_sync(self._index.upsert_datapoints, datapoints=points)

    async def delete(self, tenant_id: str, ids: Sequence[str]) -> int:
        if ids:
            tag = _tag(tenant_id)
            await run_sync(self._index.remove_datapoints, datapoint_ids=[f"{tag}:{i}" for i in ids])
        return len(ids)

    async def search(self, tenant_id: str, vector: Sequence[float], *, k: int,
                     scope_keys: Sequence[str] | None = None, kinds: Sequence[str] | None = None) -> list[Hit]:
        filters = [Namespace("tenant", [_tag(tenant_id)], [])]
        if scope_keys:
            filters.append(Namespace("scope", list(scope_keys), []))
        if kinds:
            filters.append(Namespace("kind", list(kinds), []))
        results = await run_sync(self._endpoint.find_neighbors, deployed_index_id=self._deployed,
                                 queries=[list(vector)], num_neighbors=k, filter=filters)
        # DOT_PRODUCT_DISTANCE over unit-normalised vectors: `distance` is cosine similarity.
        return [Hit(n.id.split(":", 1)[-1], float(n.distance)) for n in (results[0] if results else [])]


def build_index(settings: Any, ctx: Any) -> VertexVectorSearchIndex:
    g = settings.google
    if not (g.vector_search_index and g.vector_search_endpoint and g.vector_search_deployed_index_id):
        raise ConfigurationError("set EVERSTATE_GOOGLE_VECTOR_SEARCH_INDEX / _ENDPOINT / _DEPLOYED_INDEX_ID")
    aiplatform.init(project=require_project(settings), location=g.region)
    return VertexVectorSearchIndex(
        aiplatform.MatchingEngineIndex(g.vector_search_index),
        aiplatform.MatchingEngineIndexEndpoint(g.vector_search_endpoint),
        g.vector_search_deployed_index_id,
        settings.embedding.dimensions,
    )
