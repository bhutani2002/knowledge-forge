import asyncio
import logging
import numpy as np
from typing import List
from app import models
from app.agents.base_agent import BaseAgent, QueryState
from app.retrieval import RetrievalStrategyFactory

logger = logging.getLogger("multi-query-retrieval-agent")

class MultiQueryRetrievalAgent(BaseAgent):
    def __init__(self):
        super().__init__()

    async def run(self, state: QueryState, workspace_id: str, doc_ids: List[str], hyde_vector: np.ndarray) -> QueryState:
        strategy = RetrievalStrategyFactory.get_strategy()
        embedding_model = models.get_embedding_model()
        loop = asyncio.get_event_loop()

        # Compute query embeddings for all variants in parallel
        async def get_embedding(q: str):
            return await loop.run_in_executor(None, lambda: embedding_model.encode([q])[0])

        emb_tasks = [get_embedding(q) for q in state.rewritten_queries]
        embeddings = await asyncio.gather(*emb_tasks)

        # Build retrieval tasks for each query variant
        retrieval_tasks = []
        for q, emb in zip(state.rewritten_queries, embeddings):
            retrieval_tasks.append(strategy.retrieve(
                query_text=q,
                query_embedding=emb,
                workspace_id=workspace_id,
                doc_ids=doc_ids,
                top_k=15
            ))

        # Add HyDE vector search task
        retrieval_tasks.append(strategy.retrieve(
            query_text=state.original_query,
            query_embedding=hyde_vector,
            workspace_id=workspace_id,
            doc_ids=doc_ids,
            top_k=15
        ))

        # Fan-out: execute retrieval calls concurrently
        logger.info(f"Fanning out {len(retrieval_tasks)} retrieval tasks concurrently...")
        results = await asyncio.gather(*retrieval_tasks, return_exceptions=True)

        # Merge and deduplicate by chunk_id, preserving the best score
        seen_chunks = {}
        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"Parallel retrieval task failed with error: {str(result)}")
                continue
            for chunk in result:
                chunk_dict = chunk.to_dict()
                cid = chunk_dict["chunk_id"]
                if cid not in seen_chunks:
                    seen_chunks[cid] = chunk_dict
                else:
                    if chunk_dict["vector_score"] > seen_chunks[cid]["vector_score"]:
                        seen_chunks[cid] = chunk_dict

        # Sort and return top 30 candidates
        all_candidates = list(seen_chunks.values())
        state.retrieved_chunks = sorted(
            all_candidates,
            key=lambda c: c["vector_score"],
            reverse=True
        )[:30]

        logger.info(f"Concurrently retrieved and merged {len(state.retrieved_chunks)} chunks.")
        return state
