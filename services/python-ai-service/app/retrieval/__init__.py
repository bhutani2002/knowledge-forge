from app import config
from app.retrieval.base_retrieval_strategy import BaseRetrievalStrategy, RetrievedChunk
from app.retrieval.pgvector_strategy import PgVectorRetrievalStrategy
from app.retrieval.foundry_iq_strategy import FoundryIQRetrievalStrategy

class RetrievalStrategyFactory:
    @staticmethod
    def get_strategy() -> BaseRetrievalStrategy:
        if config.USE_FOUNDRY_IQ and config.AZURE_AI_SEARCH_ENDPOINT:
            return FoundryIQRetrievalStrategy()
        return PgVectorRetrievalStrategy()
