import asyncio
import logging
from app import models
from app.agents.base_agent import BaseAgent, QueryState

logger = logging.getLogger("reranker-agent")

class ReRankerAgent(BaseAgent):
    def __init__(self):
        super().__init__()

    async def run(self, state: QueryState, top_k: int = 5) -> QueryState:
        candidates = state.retrieved_chunks
        if not candidates:
            state.reranked_chunks = []
            return state

        loop = asyncio.get_event_loop()
        
        def _predict():
            reranker = models.get_reranker_model()
            pairs = [(state.original_query, c["text"]) for c in candidates]
            scores = reranker.predict(pairs)
            for c, score in zip(candidates, scores):
                c["rerank_score"] = float(score)
            return sorted(candidates, key=lambda x: x["rerank_score"], reverse=True)[:top_k]

        reranked = await loop.run_in_executor(None, _predict)
        state.reranked_chunks = reranked
        logger.info(f"Reranked and selected top {len(reranked)} chunks.")
        return state
