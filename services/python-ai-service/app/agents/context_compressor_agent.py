import re
import asyncio
import logging
import numpy as np
from app import models
from app.agents.base_agent import BaseAgent, QueryState

logger = logging.getLogger("context-compressor-agent")

class ContextCompressorAgent(BaseAgent):
    def __init__(self):
        super().__init__()

    async def run(self, state: QueryState) -> QueryState:
        chunks = state.reranked_chunks
        if not chunks:
            state.compressed_context = ""
            return state

        loop = asyncio.get_event_loop()
        
        def _compress():
            embedding_model = models.get_embedding_model()
            query_vec = embedding_model.encode([state.original_query])[0]
            
            for c in chunks:
                text = c["text"]
                sentences = re.split(r'(?<=[.!?])\s+', text)
                if len(sentences) <= 1:
                    c["compressed_text"] = text
                    c["compression_applied"] = False
                    continue
                    
                sentence_vecs = embedding_model.encode(sentences)
                norms_q = np.linalg.norm(query_vec)
                norms_s = np.linalg.norm(sentence_vecs, axis=1)
                norms_s[norms_s == 0] = 1.0
                
                similarities = np.dot(sentence_vecs, query_vec) / (norms_s * norms_q) if norms_q > 0 else np.zeros(len(sentences))
                
                # Filter sentences with similarity >= 0.25
                relevant_sentences = [sentences[i] for i, score in enumerate(similarities) if score >= 0.25]
                
                if relevant_sentences and len(relevant_sentences) < len(sentences):
                    c["compressed_text"] = " ".join(relevant_sentences)
                    c["compression_applied"] = True
                else:
                    c["compressed_text"] = text
                    c["compression_applied"] = False
                    
            # Assemble compressed context
            context_parts = []
            for idx, c in enumerate(chunks):
                source_lbl = f"Source {idx + 1}"
                filename = c.get("filename", "Document Chunk")
                context_parts.append(f"[{source_lbl}] (File: {filename}): {c['compressed_text']}")
                
            return "\n\n".join(context_parts)

        state.compressed_context = await loop.run_in_executor(None, _compress)
        logger.info("Semantic context compression completed.")
        return state
