import logging
import asyncio
from datetime import date, datetime
from app import db
from app.agents.base_agent import BaseAgent

logger = logging.getLogger("report-generation-agent")

class ReportGenerationAgent(BaseAgent):
    def __init__(self):
        super().__init__()

    async def run(self, workspace_id: str, week_start: date):
        logger.info(f"Generating weekly report brief for workspace {workspace_id}...")
        
        # 1. Gather data (run database calls in executor)
        loop = asyncio.get_event_loop()
        new_docs, low_grounding_queries = await asyncio.gather(
            self._query_new_docs(workspace_id, week_start, loop),
            self._query_low_grounding_queries(workspace_id, week_start, loop)
        )
        
        # 2. Build synthesis prompt
        prompt = self._build_report_prompt(new_docs, low_grounding_queries)
        
        # 3. Request LLM completion
        try:
            response = await self.llm_router.complete([{"role": "user", "content": prompt}], role="final", stream=False)
            report_content = response.content
        except Exception as e:
            logger.error(f"Failed to generate intelligence brief: {str(e)}")
            report_content = "<p>Report generation failed due to service error.</p>"

        # 4. Publish Kafka event
        try:
            from app.worker import publish_kafka_event
            publish_kafka_event("report.ready", workspace_id, {
                "workspace_id": workspace_id,
                "report_html": report_content,
                "week": str(week_start)
            })
            logger.info("Published report.ready Kafka event.")
        except Exception as e:
            logger.error(f"Failed to publish report.ready event: {str(e)}")

        return report_content

    async def _query_new_docs(self, workspace_id: str, week_start: date, loop) -> list:
        def _sql():
            conn = db.get_postgres_connection()
            rows = []
            try:
                cur = conn.cursor()
                cur.execute(
                    "SELECT original_filename, created_at FROM documents WHERE workspace_id = %s AND created_at >= %s",
                    (workspace_id, week_start)
                )
                rows = [{"filename": r[0], "created_at": str(r[1])} for r in cur.fetchall()]
                cur.close()
            except Exception as e:
                logger.error(f"SQL new docs query failed: {str(e)}")
            finally:
                conn.close()
            return rows
        return await loop.run_in_executor(None, _sql)

    async def _query_low_grounding_queries(self, workspace_id: str, week_start: date, loop) -> list:
        def _mongo():
            mongo_db = db.get_mongo_db()
            cursor = mongo_db["chat_messages"].find({
                "workspaceId": workspace_id,
                "grounding_score": {"$lt": 60.0},
                "createdAt": {"$gte": datetime.combine(week_start, datetime.min.time())}
            }).limit(20)
            return [{"query": d.get("content", ""), "score": d.get("grounding_score", 0)} for d in cursor]
        try:
            return await loop.run_in_executor(None, _mongo)
        except Exception as e:
            logger.error(f"Mongo low grounding query failed: {str(e)}")
            return []

    def _build_report_prompt(self, new_docs: list, low_grounding_queries: list) -> str:
        doc_details = "\n".join([f"- {d['filename']} (Added: {d['created_at']})" for d in new_docs]) if new_docs else "None"
        query_details = "\n".join([f"- '{q['query']}' (Grounding score: {q['score']}%)" for q in low_grounding_queries]) if low_grounding_queries else "None"
        
        prompt = (
            "You are a Weekly Corporate Intelligence Synthesizer.\n"
            "Produce a professional HTML intelligence brief for the workspace corpus.\n"
            "Structure it cleanly with modern styles.\n\n"
            f"NEW DOCUMENTS ADDED THIS WEEK:\n{doc_details}\n\n"
            f"UNANSWERED OR LOW-GROUNDING QUESTIONS DETECTED (NEEDS REVIEW):\n{query_details}\n\n"
            "Include sections:\n"
            "1. Executive Brief (synthesize themes from new files)\n"
            "2. Unanswered Knowledge Gaps (analyze why the queries failed and recommend answers/documents)\n"
            "3. Suggested Reading List\n"
            "Return ONLY standard valid HTML elements within <div> tags."
        )
        return prompt
