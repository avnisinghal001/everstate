"""Worked example: a custom recall stage (Maximal Marginal Relevance diversity).

    from everstate.pipeline import build_recall_pipeline
    recall = build_recall_pipeline().replace("top_k", MMRRerank(lambda_=0.7))
    es = Everstate(build_runtime(settings), recall=recall)

MMR picks, at each step, the candidate maximising
    λ · score(m) − (1 − λ) · max_{s ∈ selected} cos(m, s)
so near-duplicate memories do not crowd out different useful ones. MMR *is* a top-k
selection policy, so it replaces `top_k` (placing it before `top_k` would be undone by
top_k's score sort). Any object with a `name` and `async __call__(state) -> state` is a stage.
"""

from __future__ import annotations

from everstate.pipeline.recall import RecallState
from everstate.vectors import cosine


class MMRRerank:
    name = "mmr_rerank"

    def __init__(self, lambda_: float = 0.7) -> None:
        self.lambda_ = lambda_

    async def __call__(self, state: RecallState) -> RecallState:
        pool = [sm for sm in state.scored if sm.memory.embedding is not None]
        rest = [sm for sm in state.scored if sm.memory.embedding is None]
        selected = []
        while pool:
            def gain(sm):  # noqa: ANN001
                redundancy = max((cosine(sm.memory.embedding, s.memory.embedding) for s in selected), default=0.0)
                return self.lambda_ * sm.score - (1 - self.lambda_) * redundancy

            best = max(pool, key=gain)
            selected.append(best)
            pool.remove(best)
        state.scored = (selected + rest)[: state.query.k]
        return state
