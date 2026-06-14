import json
import logging
from app import db
from app.agents.base_agent import BaseAgent

logger = logging.getLogger("orchestrator-agent")

class DocumentScopeTool:
    def check_scope(self, workspace_id: str) -> list:
        # Check document titles in database
        conn = None
        doc_summaries = []
        try:
            conn = db.get_postgres_connection()
            cur = conn.cursor()
            cur.execute("SELECT id, original_filename FROM documents WHERE workspace_id = %s", (workspace_id,))
            rows = cur.fetchall()
            cur.close()
            for r in rows:
                doc_summaries.append({"doc_id": r[0], "filename": r[1]})
        except Exception as e:
            logger.error(f"Failed to check document scope: {str(e)}")
        finally:
            if conn:
                conn.close()
        return doc_summaries

class ComplexityAssessorTool:
    def assess(self, query: str) -> str:
        # Check rule-based indicators
        query_lower = query.lower()
        if any(char.isdigit() for char in query) or any(op in query for op in ["+", "-", "*", "/", "%"]):
            return "COMPUTATIONAL"
        if len(query_lower.split()) > 12 or any(w in query_lower for w in ["compare", "difference", "versus", "vs", "similarities", "both", "all"]):
            return "COMPLEX_MULTI_DOC"
        return "SIMPLE_FACTUAL"

class PipelinePlan:
    def __init__(self, path: str, reasoning: str):
        self.path = path
        self.reasoning = reasoning

class PipelineOrchestratorAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.scope_tool = DocumentScopeTool()
        self.complexity_tool = ComplexityAssessorTool()

    async def route(self, query: str, workspace_id: str) -> PipelinePlan:
        doc_list = self.scope_tool.check_scope(workspace_id)
        
        # If no documents are uploaded, it's out of scope of documents (will prompt to upload)
        if not doc_list:
            return PipelinePlan(
                path="OUT_OF_SCOPE",
                reasoning="No documents indexed in this workspace. Query cannot be answered using local document retrieval."
            )
            
        complexity = self.complexity_tool.assess(query)
        doc_summaries = ", ".join([d["filename"] for d in doc_list])
        
        system_instruction = (
            "You are a routing supervisor agent for an AI RAG pipeline.\n"
            "Analyze the query and the list of indexed documents. Determine the routing path:\n"
            "- SIMPLE_FACTUAL: Short query, single document referenced, or simple lookup.\n"
            "- COMPLEX_MULTI_DOC: Long query, comparing documents, or synthesis of multiple chunks.\n"
            "- COMPUTATIONAL: Involves math, dates, or quantitative comparisons.\n"
            "- OUT_OF_SCOPE: Query is completely unrelated to the available documents.\n"
            "\n"
            "Respond in JSON format with keys:\n"
            "{\n"
            "  \"decision\": \"SIMPLE_FACTUAL\" | \"COMPLEX_MULTI_DOC\" | \"COMPUTATIONAL\" | \"OUT_OF_SCOPE\",\n"
            "  \"rationale\": \"Brief explanation of your routing decision\"\n"
            "}"
        )
        
        user_prompt = f"Query: {query}\nIndexed documents: {doc_summaries}\nRule-based assessment: {complexity}"
        
        messages = [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": user_prompt}
        ]
        
        try:
            response = await self.llm_router.complete(messages, role="intermediate", stream=False)
            content = response.content.strip()
            
            # Clean markdown JSON block
            if content.startswith("```"):
                content = content.replace("```json", "").replace("```", "").strip()
                
            data = json.loads(content)
            decision = data.get("decision", complexity)
            rationale = data.get("rationale", "LLM router routing.")
            
            logger.info(f"Orchestrator routed query to {decision} (Rationale: {rationale})")
            return PipelinePlan(path=decision, reasoning=rationale)
        except Exception as e:
            logger.warning(f"Orchestrator LLM routing failed: {str(e)}. Falling back to rule-based: {complexity}")
            return PipelinePlan(path=complexity, reasoning=f"Rule-based fallback due to exception: {str(e)}")
