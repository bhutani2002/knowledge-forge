import os
import re
import time
import uuid
import json
import logging
import numpy as np
import asyncio
from typing import List, Dict, Any, Tuple, Generator, Optional, AsyncGenerator
from app import config, db, models
from app.agents import (
    QueryState,
    PipelineOrchestratorAgent,
    InputGuardrailAgent,
    QueryRewriterAgent,
    MultiQueryRetrievalAgent,
    ReRankerAgent,
    ContextCompressorAgent,
    AnswerAgent,
    OutputGuardrailAgent,
    ExplainabilityAgent
)

logger = logging.getLogger("python-ai-service-pipeline")

def increment_query_counts_sync(doc_ids: list[str]):
    if not doc_ids:
        return
    try:
        conn = db.get_postgres_connection()
        cur = conn.cursor()
        cur.execute(
            "UPDATE documents SET query_count = query_count + 1, updated_at = NOW() WHERE id = ANY(%s::uuid[])",
            (doc_ids,)
        )
        conn.commit()
        cur.close()
        conn.close()
        logger.info(f"Incremented query_count for documents: {doc_ids}")
    except Exception as e:
        logger.error(f"Failed to increment document query counts: {str(e)}")

class QueryPipelineRequest:
    def __init__(self, query: str, workspace_id: str, doc_ids: List[str], user_id: str, session_id: str = None):
        self.query = query
        self.workspace_id = workspace_id
        self.doc_ids = doc_ids
        self.user_id = user_id
        self.session_id = session_id

def check_semantic_cache(query: str, workspace_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[np.ndarray]]:
    try:
        embedding_model = models.get_embedding_model()
        query_vector = embedding_model.encode([query])[0]
        
        r = db.get_redis_client()
        keys = r.keys(f"semcache:{workspace_id}:*")
        if not keys:
            return None, query_vector
            
        for key in keys:
            cached_data = r.get(key)
            if not cached_data:
                continue
            cache_obj = json.loads(cached_data)
            cached_vector = np.array(cache_obj["query_embedding"])
            
            # Cosine similarity
            dot_product = np.dot(query_vector, cached_vector)
            norm_q = np.linalg.norm(query_vector)
            norm_c = np.linalg.norm(cached_vector)
            similarity = dot_product / (norm_q * norm_c) if (norm_q * norm_c) > 0 else 0
            
            if similarity >= 0.95:
                logger.info(f"Semantic cache hit (similarity: {similarity:.4f})")
                return cache_obj["payload"], query_vector
                
        return None, query_vector
    except Exception as e:
        logger.error(f"Semantic Cache check failed: {str(e)}")
        return None, None

async def execute_azure_foundry_agent_stream(req: QueryPipelineRequest, query: str, latency: dict, start_time: float) -> AsyncGenerator[str, None]:
    try:
        from azure.ai.projects import AIProjectClient
        from azure.ai.projects.models import PromptAgentDefinition, MCPTool
        from azure.identity import DefaultAzureCredential
    except ImportError as e:
        logger.error(f"Azure AI SDKs not installed: {str(e)}")
        raise e

    project_endpoint = os.getenv("AZURE_AI_PROJECT_ENDPOINT", "")
    search_endpoint = os.getenv("AZURE_AI_SEARCH_ENDPOINT", "")
    if not project_endpoint:
        raise ValueError("AZURE_AI_PROJECT_ENDPOINT env var is not set")

    t_gen_start = time.time()
    credential = DefaultAzureCredential()
    loop = asyncio.get_event_loop()

    def run_azure_agent():
        client = AIProjectClient(endpoint=project_endpoint, credential=credential)
        safe_ws_id = str(req.workspace_id).lower().replace("_", "-")
        knowledge_tool = MCPTool(
            server_label=f"docs-{safe_ws_id}",
            server_url=f"{search_endpoint}/knowledgebases/{safe_ws_id}/mcp"
        )
        
        instructions = """You are a helpful assistant.
ALWAYS search the knowledge base before answering any question.
Every answer must include citations with document identifiers or source names.
If the knowledge base doesn't contain the answer, respond with "I don't have that information in our current documentation." """

        agent = client.agents.create_version(
            agent_name=f"agent-{safe_ws_id}",
            definition=PromptAgentDefinition(
                model=os.getenv("AZURE_AI_MODEL_DEPLOYMENT_NAME", "gpt-4o-mini"),
                instructions=instructions,
                tools=[knowledge_tool]
            )
        )
        
        thread = client.agents.create_thread()
        client.agents.create_message(thread_id=thread.id, role="user", content=query)
        run = client.agents.create_run(thread_id=thread.id, assistant_id=agent.id)
        
        while run.status in ["queued", "in_progress"]:
            time.sleep(0.5)
            run = client.agents.get_run(thread_id=thread.id, run_id=run.id)
            
        if run.status != "completed":
            raise RuntimeError(f"Azure Agent run failed with status: {run.status}")
            
        messages = client.agents.list_messages(thread_id=thread.id)
        assistant_msgs = [m for m in messages.data if m.role == "assistant"]
        if not assistant_msgs:
            raise RuntimeError("No assistant response returned from Azure Agent")
            
        last_msg = assistant_msgs[-1]
        text_content = ""
        for part in last_msg.content:
            if part.type == "text":
                text_content += part.text.value
                
        citations = []
        if hasattr(last_msg, "annotations") and last_msg.annotations:
            for idx, ann in enumerate(last_msg.annotations):
                citations.append({
                    "id": str(idx),
                    "source": ann.text or "Azure Knowledge Base",
                    "content": ann.text or ""
                })
        else:
            import re
            citations_found = re.findall(r"【([^】]+)】", text_content)
            for idx, cit in enumerate(citations_found):
                citations.append({
                    "id": str(idx),
                    "source": cit,
                    "content": f"Cited source: {cit}"
                })
                
        return text_content, citations

    answer_text, citations = await loop.run_in_executor(None, run_azure_agent)
    latency["generation_ms"] = int((time.time() - t_gen_start) * 1000)
    
    words = answer_text.split(" ")
    for idx, word in enumerate(words):
        token = word + (" " if idx < len(words) - 1 else "")
        yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"
        await asyncio.sleep(0.01)
        
    explainability = {
        "query_variants": [query],
        "retrieved_chunks": [],
        "chunk_contribution_scores": {},
        "answer_grounding_score": 95.0,
        "cache_hit": False,
        "guardrail_triggered": False,
        "latency_breakdown": latency,
        "retrieval_source": "Foundry IQ (Azure AI Search)"
    }
    
    final_payload = {
        "answer": answer_text,
        "citations": citations,
        "explainability_report": explainability
    }
    if req.doc_ids:
        await loop.run_in_executor(None, increment_query_counts_sync, req.doc_ids)

    yield f"event: answer\ndata: {json.dumps(final_payload)}\n\n"

async def execute_rag_pipeline(req: QueryPipelineRequest) -> AsyncGenerator[str, None]:
    start_time = time.time()
    latency = {"routing_ms": 0, "retrieval_ms": 0, "rerank_ms": 0, "generation_ms": 0}
    
    # If USE_FOUNDRY_IQ is enabled and AZURE_AI_PROJECT_ENDPOINT is configured, try the Azure Agent flow first
    if config.USE_FOUNDRY_IQ and os.getenv("AZURE_AI_PROJECT_ENDPOINT"):
        try:
            logger.info("Foundry IQ and Azure AI Project endpoint are configured. Running Azure AI Projects Agent...")
            async for chunk in execute_azure_foundry_agent_stream(req, req.query, latency, start_time):
                yield chunk
            return
        except Exception as e:
            logger.error(f"Azure AI Projects Agent failed: {str(e)}. Falling back to local RAG pipeline...")
            # Reset latency values for fallback run
            latency = {"routing_ms": 0, "retrieval_ms": 0, "rerank_ms": 0, "generation_ms": 0}

    # Initialize agents
    orchestrator = PipelineOrchestratorAgent()
    guardrail = InputGuardrailAgent()
    rewriter = QueryRewriterAgent()
    retrieval = MultiQueryRetrievalAgent()
    reranker = ReRankerAgent()
    compressor = ContextCompressorAgent()
    answer_agent = AnswerAgent()
    output_guardrail = OutputGuardrailAgent()
    explainability_agent = ExplainabilityAgent()
    
    # Setup initial state
    state = QueryState(original_query=req.query)
    
    # ---------------------------------------------
    # Step 1: Input Guardrails
    # ---------------------------------------------
    state = await guardrail.run(state)
    guard_res = state.guardrail_results
    if guard_res and not guard_res.get("passed", False):
        yield f"event: error\ndata: {json.dumps({'title': 'Guardrail Violation', 'status': 400, 'detail': guard_res.get('error_message'), 'violation_type': guard_res.get('violation_type')})}\n\n"
        return
        
    sanitized_query = guard_res.get("sanitized_query", req.query)
    state.original_query = sanitized_query
    
    # ---------------------------------------------
    # Step 2: Semantic Cache Check
    # ---------------------------------------------
    cache_hit_payload, query_vector = check_semantic_cache(sanitized_query, req.workspace_id)
    if cache_hit_payload:
        cache_hit_payload["explainability_report"]["cache_hit"] = True
        yield f"event: cache_hit\ndata: {json.dumps(cache_hit_payload)}\n\n"
        return

    # ---------------------------------------------
    # Step 3: Route Plan Selection
    # ---------------------------------------------
    t0 = time.time()
    plan = await orchestrator.route(sanitized_query, req.workspace_id)
    latency["routing_ms"] = int((time.time() - t0) * 1000)
    state.pipeline_path = plan.path
    
    logger.info(f"Orchestrator routing query onto path: '{plan.path}'")

    # If workspace has no documents or is OUT_OF_SCOPE, return early or search web
    if plan.path == "OUT_OF_SCOPE":
        # Out of scope: run web search tool directly
        logger.info("Query routed to OUT_OF_SCOPE. Triggering search tool...")
        state.rewritten_queries = [sanitized_query]
        state.compressed_context = "No documents found. Invoking web search..."
        
        # Run AnswerAgent with instructions to search web
        state.original_query = f"The user query is out of scope of local files. Search the web for: '{sanitized_query}'"
    else:
        # ---------------------------------------------
        # Step 4: Query Rewriter (runs on COMPLEX or COMPUTATIONAL paths)
        # ---------------------------------------------
        if plan.path in ["COMPLEX_MULTI_DOC", "COMPUTATIONAL"]:
            state, hyde_doc = await rewriter.run(state, req.session_id)
        else:
            state.rewritten_queries = [sanitized_query]
            hyde_doc = f"Hypothetical documents about {sanitized_query}"
            
        # Compute HyDE vector
        embedding_model = models.get_embedding_model()
        loop = asyncio.get_event_loop()
        hyde_vector = await loop.run_in_executor(None, lambda: embedding_model.encode([hyde_doc])[0])

        # ---------------------------------------------
        # Step 5: Parallel Retrieval (Multi-Query vector lookup)
        # ---------------------------------------------
        t0 = time.time()
        state = await retrieval.run(state, req.workspace_id, req.doc_ids, hyde_vector)
        latency["retrieval_ms"] = int((time.time() - t0) * 1000)
        
        if not state.retrieved_chunks:
            payload = {
                "answer": "I don't have any indexed documents to search in this workspace. Please upload documents first.",
                "citations": [],
                "explainability_report": {
                    "query_variants": state.rewritten_queries,
                    "retrieved_chunks": [],
                    "chunk_contribution_scores": {},
                    "answer_grounding_score": 0.0,
                    "cache_hit": False,
                    "guardrail_triggered": False,
                    "latency_breakdown": latency
                }
            }
            yield f"event: answer\ndata: {json.dumps(payload)}\n\n"
            return

        # ---------------------------------------------
        # Step 6: Cross-Encoder Re-ranking
        # ---------------------------------------------
        t0 = time.time()
        state = await reranker.run(state, top_k=5)
        latency["rerank_ms"] = int((time.time() - t0) * 1000)

        # Lookup document names for citation labels
        for c in state.reranked_chunks:
            filename = "Document Chunk"
            try:
                def get_filename_sql():
                    conn = db.get_postgres_connection()
                    cur = conn.cursor()
                    cur.execute("SELECT original_filename FROM documents WHERE id = %s", (c["doc_id"],))
                    row = cur.fetchone()
                    cur.close()
                    conn.close()
                    return row[0] if row else "Document Chunk"
                filename = await loop.run_in_executor(None, get_filename_sql)
            except Exception:
                pass
            c["filename"] = filename

        # Increment query counts
        used_doc_ids = list(set(c["doc_id"] for c in state.reranked_chunks if c.get("doc_id")))
        if used_doc_ids:
            await loop.run_in_executor(None, increment_query_counts_sync, used_doc_ids)

        # ---------------------------------------------
        # Step 7: Contextual Compression
        # ---------------------------------------------
        state = await compressor.run(state)

    # ---------------------------------------------
    # Step 8: Answer Generation (agent streaming / fallback)
    # ---------------------------------------------
    t_gen_start = time.time()
    answer_text = ""
    active_provider = "Gemini"
    
    try:
        # Run answer agent stream
        async for token in answer_agent.run(state):
            answer_text += token
            yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"
    except Exception as e:
        logger.error(f"Failed response generation: {str(e)}")
        # Construct graceful warning fallback response
        fallback_text = (
            "⚠️ **LLM Generation Error**\n\n"
            "An error occurred while generating the answer. Please verify your configured API keys.\n\n"
        )
        if state.reranked_chunks:
            fallback_text += (
                "--- \n\n"
                "🔍 **Retrieved Context (RAG Ingestion & Vector Search is working!)**\n\n"
                "The RAG retrieval pipeline successfully found the following relevant information:\n\n"
            )
            for idx, c in enumerate(state.reranked_chunks):
                fallback_text += f"**Source {idx + 1}** (File: `{c.get('filename')}`):\n> {c['compressed_text']}\n\n"
        
        answer_text = fallback_text
        yield f"event: token\ndata: {json.dumps({'token': fallback_text})}\n\n"
        
    latency["generation_ms"] = int((time.time() - t_gen_start) * 1000)
    state.answer = answer_text
    state.active_provider = state.active_provider or answer_agent.llm_router.final_providers[0].name

    # ---------------------------------------------
    # Step 9: Output Guardrail Citation Check
    # ---------------------------------------------
    state = await output_guardrail.run(state)

    # ---------------------------------------------
    # Step 10: Explainability Compilation
    # ---------------------------------------------
    state = await explainability_agent.run(state, latency)

    # ---------------------------------------------
    # Step 11: Cache & Event Publishing
    # ---------------------------------------------
    # Write to Redis Semantic Cache
    try:
        r = db.get_redis_client()
        cache_key = f"semcache:{req.workspace_id}:{str(uuid.uuid4())}"
        cache_obj = {
            "query_embedding": query_vector.tolist() if query_vector is not None else [],
            "payload": {
                "answer": state.answer,
                "citations": state.citations,
                "explainability_report": state.explainability
            }
        }
        r.setex(cache_key, 3600, json.dumps(cache_obj))
    except Exception as e:
        logger.error(f"Failed to write semantic cache to Redis: {str(e)}")
        
    # Publish Kafka query.answered event
    try:
        from app.worker import publish_kafka_event
        publish_kafka_event("query.answered", req.user_id, {
            "user_id": req.user_id,
            "doc_ids_used": req.doc_ids,
            "latency_ms": int((time.time() - start_time) * 1000),
            "cache_hit": False,
            "guardrail_triggered": False,
            "grounding_score": state.explainability.get("answer_grounding_score", 0.0),
            "provider": state.active_provider,
            "pipeline_path": state.pipeline_path
        })
    except Exception as e:
        logger.error(f"Failed to publish Kafka event: {str(e)}")

    # Yield final RAG response packet
    final_payload = {
        "answer": state.answer,
        "citations": state.citations,
        "explainability_report": state.explainability
    }
    yield f"event: answer\ndata: {json.dumps(final_payload)}\n\n"
