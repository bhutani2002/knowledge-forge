import re
import json
import logging
from typing import List, Tuple
from app import db
from app.agents.base_agent import BaseAgent, QueryState

logger = logging.getLogger("query-rewriter-agent")

class QueryRewriterAgent(BaseAgent):
    def __init__(self):
        super().__init__()

    async def run(self, state: QueryState, session_id: str = None) -> Tuple[QueryState, str]:
        history = self._get_session_history(session_id)
        history_str = json.dumps(history) if history else "None"
        query = state.original_query

        # Step 1: Resolve Coreferences
        resolved_prompt = (
            f"You are a Co-reference Resolution Tool.\n"
            f"CONVERSATION HISTORY:\n{history_str}\n\n"
            f"USER QUERY: {query}\n\n"
            f"Task: Rewrite the user query by replacing all pronouns (like 'it', 'they', 'he', 'she') "
            f"with the explicit nouns from the conversation context. Return ONLY the rewritten query text."
        )
        resolved_query = await self._call_llm(resolved_prompt)
        if not resolved_query:
            resolved_query = query
        logger.info(f"Coreference resolution output: '{resolved_query}'")

        # Step 2: Decompose query
        decomp_prompt = (
            f"You are a Query Decomposition Tool.\n"
            f"QUERY: {resolved_query}\n\n"
            f"Task: Check if this is a complex or multi-part question. If yes, decompose it into individual sub-questions "
            f"separated by commas. If it is already a simple query, return the query as is. Return ONLY the final output."
        )
        decomposed_queries = await self._call_llm(decomp_prompt)
        logger.info(f"Query decomposition output: '{decomposed_queries}'")

        # Step 3: Generate HyDE
        hyde_prompt = (
            f"You are a HyDE (Hypothetical Document Embeddings) Generator.\n"
            f"QUERY: {resolved_query}\n\n"
            f"Task: Write a short, highly-detailed paragraph that hypothetically answers this question. "
            f"Do not write introductory phrases. Just write the hypothetical answer text."
        )
        hyde_doc = await self._call_llm(hyde_prompt)
        logger.info("HyDE document generated.")

        # Step 4: Paraphrase variants
        paraphrase_prompt = (
            f"You are a Query Paraphraser Tool.\n"
            f"QUERY: {resolved_query}\n\n"
            f"Task: Paraphrase the query into exactly 3 different search variants optimized for keyword/semantic search. "
            f"Return ONLY a JSON list of strings, for example: [\"variant 1\", \"variant 2\", \"variant 3\"]."
        )
        variants_json = await self._call_llm(paraphrase_prompt)
        
        variants = []
        try:
            clean_json = re.sub(r"```json|```", "", variants_json).strip()
            variants = json.loads(clean_json)
        except Exception:
            logger.warning("Failed to parse paraphrased JSON. Using fallback variants.")
            variants = [resolved_query, f"documents on {resolved_query}", f"about {resolved_query}"]

        if not isinstance(variants, list) or not variants:
            variants = [resolved_query]

        state.rewritten_queries = variants
        return state, hyde_doc

    async def _call_llm(self, prompt: str) -> str:
        try:
            response = await self.llm_router.complete([{"role": "user", "content": prompt}], role="intermediate", stream=False)
            return response.content.strip()
        except Exception as e:
            logger.error(f"Rewriter agent LLM call failed: {str(e)}")
            return ""

    def _get_session_history(self, session_id: str) -> List[dict]:
        if not session_id:
            return []
        try:
            mongo_db = db.get_mongo_db()
            collection = mongo_db["chat_messages"]
            cursor = collection.find({"sessionId": session_id}).sort("createdAt", 1).limit(10)
            history = []
            for doc in cursor:
                history.append({
                    "role": doc.get("role", "user"),
                    "content": doc.get("content", "")
                })
            return history
        except Exception as e:
            logger.error(f"Failed to fetch session history from MongoDB: {str(e)}")
            return []
