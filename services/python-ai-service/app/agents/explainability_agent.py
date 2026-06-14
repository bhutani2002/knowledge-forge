import re
import logging
from app.agents.base_agent import BaseAgent, QueryState

logger = logging.getLogger("explainability-agent")

class ExplainabilityAgent(BaseAgent):
    def __init__(self):
        super().__init__()

    async def run(self, state: QueryState, latency: dict) -> QueryState:
        answer = state.answer
        top_chunks = state.reranked_chunks
        
        # Calculate grounding score (% of sentences with citations)
        sentences = re.split(r'(?<=[.!?])\s+', answer)
        sentences = [s.strip() for s in sentences if s.strip()]
        cited_sentences = 0
        for s in sentences:
            if re.search(r"\[Source \d+\]", s):
                cited_sentences += 1
        grounding_score = (cited_sentences / len(sentences)) * 100 if sentences else 0.0
        
        # Normalize rerank scores between 0 and 1 for contribution tracking
        rerank_scores = [c["rerank_score"] for c in top_chunks if "rerank_score" in c]
        min_score = min(rerank_scores) if rerank_scores else 0
        max_score = max(rerank_scores) if rerank_scores else 1
        score_range = max_score - min_score if max_score > min_score else 1
        
        chunk_contrib = {}
        retrieved_chunk_previews = []
        
        for idx, c in enumerate(top_chunks):
            norm_contrib = (c.get("rerank_score", 0.0) - min_score) / score_range if "rerank_score" in c else 0.5
            chunk_contrib[c["chunk_id"]] = round(norm_contrib, 2)
            
            used_in_ans = f"[Source {idx + 1}]" in answer
            
            retrieved_chunk_previews.append({
                "chunk_id": c["chunk_id"],
                "text_preview": c["text"][:150] + "...",
                "vector_score": c.get("vector_score", 0.0),
                "rerank_score": c.get("rerank_score", 0.0),
                "compression_applied": c.get("compression_applied", False),
                "used_in_answer": used_in_ans
            })
            
        from app import config
        if config.USE_FOUNDRY_IQ and config.AZURE_AI_SEARCH_ENDPOINT:
            retrieval_source = "Foundry IQ (Azure AI Search)"
        else:
            retrieval_source = "Local Vector Search (pgvector)"

        state.explainability = {
            "query_variants": state.rewritten_queries,
            "retrieved_chunks": retrieved_chunk_previews,
            "chunk_contribution_scores": chunk_contrib,
            "answer_grounding_score": round(grounding_score, 1),
            "cache_hit": False,
            "guardrail_triggered": False,
            "latency_breakdown": latency,
            "retrieval_source": retrieval_source
        }
        
        logger.info("Explainability report built successfully.")
        return state
