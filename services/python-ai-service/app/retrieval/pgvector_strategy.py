import asyncio
import numpy as np
from typing import List, Optional
from app import db
from app.retrieval.base_retrieval_strategy import BaseRetrievalStrategy, RetrievedChunk

class PgVectorRetrievalStrategy(BaseRetrievalStrategy):

    async def retrieve(self, query_text: str, query_embedding: np.ndarray, workspace_id: str, doc_ids: Optional[List[str]] = None, top_k: int = 15) -> List[RetrievedChunk]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._retrieve_sync, query_embedding, workspace_id, doc_ids, top_k)

    def _retrieve_sync(self, query_embedding: np.ndarray, workspace_id: str, doc_ids: Optional[List[str]], top_k: int) -> List[RetrievedChunk]:
        conn = db.get_postgres_connection()
        candidates = []
        vec_list = query_embedding.tolist()
        try:
            cur = conn.cursor()
            if doc_ids:
                query_sql = """
                    SELECT id, doc_id, chunk_index, chunk_text, page_num, char_start, char_end, (embedding <=> %s::vector) as distance
                    FROM document_chunks
                    WHERE workspace_id = %s AND doc_id = ANY(%s)
                    ORDER BY embedding <=> %s::vector LIMIT %s
                """
                cur.execute(query_sql, (vec_list, workspace_id, doc_ids, vec_list, top_k))
            else:
                query_sql = """
                    SELECT id, doc_id, chunk_index, chunk_text, page_num, char_start, char_end, (embedding <=> %s::vector) as distance
                    FROM document_chunks
                    WHERE workspace_id = %s
                    ORDER BY embedding <=> %s::vector LIMIT %s
                """
                cur.execute(query_sql, (vec_list, workspace_id, vec_list, top_k))
                
            rows = cur.fetchall()
            for r in rows:
                chunk_id = r[0]
                doc_id = r[1]
                chunk_index = r[2]
                chunk_text = r[3]
                page_num = r[4]
                char_start = r[5]
                char_end = r[6]
                distance = r[7]
                vector_score = 1.0 - distance
                
                candidates.append(RetrievedChunk(
                    id=chunk_id,
                    doc_id=doc_id,
                    chunk_text=chunk_text,
                    page_num=page_num,
                    vector_score=float(vector_score),
                    source="pgvector",
                    chunk_index=chunk_index,
                    char_start=char_start,
                    char_end=char_end
                ))
            cur.close()
        except Exception as e:
            import logging
            logging.getLogger("pgvector-strategy").error(f"Local pgvector retrieval failed: {str(e)}")
        finally:
            conn.close()
        return candidates
