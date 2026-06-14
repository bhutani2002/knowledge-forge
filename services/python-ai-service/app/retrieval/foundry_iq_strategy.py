import httpx
import logging
import numpy as np
from typing import List, Optional
from app import config
from app.retrieval.base_retrieval_strategy import BaseRetrievalStrategy, RetrievedChunk

logger = logging.getLogger("foundry-iq-strategy")

class FoundryIQRetrievalStrategy(BaseRetrievalStrategy):
    def __init__(self):
        self.endpoint = config.AZURE_AI_SEARCH_ENDPOINT
        self.key = config.AZURE_AI_SEARCH_KEY
        self.index_prefix = config.AZURE_AI_SEARCH_PREFIX

    async def retrieve(self, query_text: str, query_embedding: np.ndarray, workspace_id: str, doc_ids: Optional[List[str]] = None, top_k: int = 15) -> List[RetrievedChunk]:
        index_name = f"{self.index_prefix}-index"
        
        payload = {
            "search": query_text,
            "queryType": "semantic",
            "semanticConfiguration": "default",
            "top": top_k,
            "select": "id,doc_id,chunk_text,page_num,chunk_index",
            "answers": "extractive|count-3",
            "captions": "extractive|highlight-true"
        }

        filter_expr = f"workspace_id eq '{workspace_id}'"
        if doc_ids:
            # Add filter for specific documents
            doc_filter = " or ".join([f"doc_id eq '{d}'" for d in doc_ids])
            filter_expr = f"({filter_expr}) and ({doc_filter})"
            
        payload["filter"] = filter_expr

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.endpoint.rstrip('/')}/indexes/{index_name}/docs/search?api-version=2024-07-01",
                    headers={
                        "Content-Type": "application/json",
                        "api-key": self.key
                    },
                    json=payload,
                    timeout=10.0
                )
                if response.status_code == 404:
                    logger.warning(f"Foundry IQ Index '{index_name}' not found. Falling back to local pgvector search.")
                    from app.retrieval.pgvector_strategy import PgVectorRetrievalStrategy
                    return await PgVectorRetrievalStrategy().retrieve(query_text, query_embedding, workspace_id, doc_ids, top_k)
                response.raise_for_status()
                results = self._parse_response(response.json())
                
                if not results:
                    logger.info("Foundry IQ returned 0 chunks. Checking pgvector local search fallback...")
                    from app.retrieval.pgvector_strategy import PgVectorRetrievalStrategy
                    local_results = await PgVectorRetrievalStrategy().retrieve(query_text, query_embedding, workspace_id, doc_ids, top_k)
                    if local_results:
                        logger.info(f"PgVector fallback returned {len(local_results)} chunks.")
                        return local_results
                return results
        except Exception as e:
            logger.error(f"Foundry IQ retrieval failed: {str(e)}. Falling back to local pgvector search.")
            try:
                from app.retrieval.pgvector_strategy import PgVectorRetrievalStrategy
                return await PgVectorRetrievalStrategy().retrieve(query_text, query_embedding, workspace_id, doc_ids, top_k)
            except Exception as pg_err:
                logger.error(f"PgVector fallback also failed: {str(pg_err)}")
                return []

    def _parse_response(self, data: dict) -> List[RetrievedChunk]:
        chunks = []
        for result in data.get("value", []):
            chunk = RetrievedChunk(
                id=result.get("id"),
                doc_id=result.get("doc_id"),
                chunk_text=result.get("chunk_text", ""),
                page_num=result.get("page_num", 0),
                vector_score=result.get("@search.score", 0.0),
                source="foundry_iq",
                chunk_index=result.get("chunk_index", 0)
            )
            chunks.append(chunk)
        return chunks
