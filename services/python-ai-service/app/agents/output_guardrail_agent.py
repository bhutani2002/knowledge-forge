import re
import logging
from app.agents.base_agent import BaseAgent, QueryState

logger = logging.getLogger("output-guardrail-agent")

class OutputGuardrailAgent(BaseAgent):
    def __init__(self):
        super().__init__()

    async def run(self, state: QueryState) -> QueryState:
        answer = state.answer
        max_sources = len(state.reranked_chunks)
        
        # Find citations like [Source N]
        citations = re.findall(r"\[Source (\d+)\]", answer)
        
        for cit in citations:
            source_idx = int(cit)
            if source_idx < 1 or source_idx > max_sources:
                logger.warning(f"Output Guardrail: Citation [Source {source_idx}] is out of bounds (1-{max_sources}). Stripping invalid citation tag.")
                answer = answer.replace(f"[Source {cit}]", "")
                
        state.citations = []
        # Generate citations list matching sources
        for idx, c in enumerate(state.reranked_chunks):
            source_lbl = f"[Source {idx + 1}]"
            if source_lbl in answer:
                state.citations.append({
                    "citation_id": idx + 1,
                    "filename": c.get("filename", "Document Chunk"),
                    "text": c["compressed_text"],
                    "chunk_id": c["chunk_id"]
                })
                
        state.answer = answer
        return state
