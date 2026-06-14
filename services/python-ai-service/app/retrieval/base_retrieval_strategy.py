from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
import numpy as np

class RetrievedChunk:
    def __init__(self, id: str, doc_id: str, chunk_text: str, page_num: int, vector_score: float, source: str, chunk_index: int = 0, char_start: int = 0, char_end: int = 0):
        self.id = id
        self.doc_id = doc_id
        self.text = chunk_text
        self.page_num = page_num
        self.vector_score = vector_score
        self.source = source
        self.chunk_index = chunk_index
        self.char_start = char_start
        self.char_end = char_end

    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_id": self.id,
            "doc_id": self.doc_id,
            "text": self.text,
            "page_num": self.page_num,
            "vector_score": self.vector_score,
            "source": self.source,
            "chunk_index": self.chunk_index,
            "char_start": self.char_start,
            "char_end": self.char_end
        }

class BaseRetrievalStrategy(ABC):
    @abstractmethod
    async def retrieve(self, query_text: str, query_embedding: np.ndarray, workspace_id: str, doc_ids: Optional[List[str]] = None, top_k: int = 15) -> List[RetrievedChunk]:
        pass
