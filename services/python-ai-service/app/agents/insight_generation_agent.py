import asyncio
import logging
import json
from datetime import datetime
from app import db, models
from app.agents.base_agent import BaseAgent

logger = logging.getLogger("insight-generation-agent")

class SummaryAgent(BaseAgent):
    async def run(self, doc_content: str) -> str:
        prompt = (
            "You are an Executive Summarization Agent.\n"
            "Generate a concise, 3-sentence executive summary of the following document content:\n\n"
            f"{doc_content[:6000]}"
        )
        try:
            response = await self.llm_router.complete([{"role": "user", "content": prompt}], role="final", stream=False)
            return response.content.strip()
        except Exception as e:
            logger.error(f"SummaryAgent failed: {str(e)}")
            return "Summary unavailable."

class EntityExtractionAgent(BaseAgent):
    async def run(self, doc_content: str) -> list:
        prompt = (
            "You are an Entity Extraction Agent.\n"
            "Extract key named entities (People, Organizations, Dates, and Concepts) from the text.\n"
            "Return ONLY a JSON list of strings, like [\"Entity 1\", \"Entity 2\"]. Do not include other commentary:\n\n"
            f"{doc_content[:6000]}"
        )
        try:
            response = await self.llm_router.complete([{"role": "user", "content": prompt}], role="intermediate", stream=False)
            content = response.content.strip()
            if content.startswith("```"):
                content = content.replace("```json", "").replace("```", "").strip()
            return json.loads(content)
        except Exception as e:
            logger.error(f"EntityExtractionAgent failed: {str(e)}")
            return []

class TopicClusterAgent(BaseAgent):
    async def run(self, doc_content: str, workspace_id: str) -> list:
        # Assigns to a cluster based on topic keywords/similarity
        prompt = (
            "You are a Topic Clustering Agent.\n"
            "Extract 2 or 3 primary themes or topic tags for this document.\n"
            "Return ONLY a JSON list of tags, like [\"Finance\", \"AI Roadmap\"]:\n\n"
            f"{doc_content[:4000]}"
        )
        try:
            response = await self.llm_router.complete([{"role": "user", "content": prompt}], role="intermediate", stream=False)
            content = response.content.strip()
            if content.startswith("```"):
                content = content.replace("```json", "").replace("```", "").strip()
            return json.loads(content)
        except Exception as e:
            logger.error(f"TopicClusterAgent failed: {str(e)}")
            return ["General"]

class InsightGenerationAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.summary_agent = SummaryAgent()
        self.entity_agent = EntityExtractionAgent()
        self.topic_agent = TopicClusterAgent()

    async def run(self, doc_id: str, workspace_id: str):
        logger.info(f"Running post-ingest InsightGenerationAgent for doc {doc_id}...")
        
        # 1. Fetch document content from MongoDB
        doc_content = await self.fetch_parsed_content(doc_id)
        if not doc_content:
            logger.warning(f"No parsed content found in MongoDB for document {doc_id}. Skipping insights.")
            return

        # 2. Fan-out execution concurrently
        summary, entities, topics = await asyncio.gather(
            self.summary_agent.run(doc_content),
            self.entity_agent.run(doc_content),
            self.topic_agent.run(doc_content, workspace_id)
        )

        # 3. Store in MongoDB
        try:
            mongo_db = db.get_mongo_db()
            await asyncio.get_event_loop().run_in_executor(None, lambda: mongo_db["insight_reports"].update_one(
                {"doc_id": doc_id},
                {"$set": {
                    "doc_id": doc_id,
                    "workspace_id": workspace_id,
                    "summary": summary,
                    "entities": entities,
                    "topic_clusters": topics,
                    "generated_at": datetime.utcnow()
                }},
                upsert=True
            ))
            logger.info("Saved insight report in MongoDB.")
        except Exception as e:
            logger.error(f"Failed to save insight report in MongoDB: {str(e)}")

        # 4. Publish Kafka event
        try:
            from app.worker import publish_kafka_event
            publish_kafka_event("insights.generated", doc_id, {
                "doc_id": doc_id,
                "workspace_id": workspace_id
            })
        except Exception as e:
            logger.error(f"Failed to publish insights.generated event to Kafka: {str(e)}")

    async def fetch_parsed_content(self, doc_id: str) -> str:
        try:
            mongo_db = db.get_mongo_db()
            loop = asyncio.get_event_loop()
            doc = await loop.run_in_executor(None, lambda: mongo_db["parsed_document_content"].find_one({"doc_id": doc_id}))
            if doc and "chunks" in doc:
                return " ".join([c["text"] for c in doc["chunks"]])
            return ""
        except Exception as e:
            logger.error(f"Failed to fetch parsed content: {str(e)}")
            return ""
