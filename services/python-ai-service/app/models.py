import logging
from sentence_transformers import SentenceTransformer, CrossEncoder
from transformers import pipeline

logger = logging.getLogger("python-ai-service")

_embedding_model = None
_reranker_model = None
_toxicity_model = None

def get_embedding_model() -> SentenceTransformer:
    global _embedding_model
    if _embedding_model is None:
        logger.info("Loading sentence-transformers/all-MiniLM-L6-v2 embedding model...")
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Embedding model loaded.")
    return _embedding_model

def get_reranker_model() -> CrossEncoder:
    global _reranker_model
    if _reranker_model is None:
        logger.info("Loading cross-encoder/ms-marco-MiniLM-L-6-v2 model...")
        _reranker_model = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        logger.info("Reranker model loaded.")
    return _reranker_model

def get_toxicity_model():
    global _toxicity_model
    if _toxicity_model is None:
        logger.info("Loading martin-ha/toxic-comment-model text-classification pipeline...")
        # Load classification pipeline using CPU/GPU automatically
        _toxicity_model = pipeline("text-classification", model="martin-ha/toxic-comment-model")
        logger.info("Toxicity model loaded.")
    return _toxicity_model
