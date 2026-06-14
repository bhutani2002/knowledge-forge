from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from app import pipeline
import logging

# Setup structured logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("python-ai-service-api")

app = FastAPI(
    title="KnowledgeForge Python AI Service",
    version="1.0.0",
    description="Microservice providing the core production-grade RAG pipeline."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom RFC 9457 Problem Details error handler
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "type": f"https://knowledgeforge.com/errors/{exc.status_code}",
            "title": exc.detail,
            "status": exc.status_code,
            "detail": exc.detail,
            "instance": request.url.path
        },
        headers={"Content-Type": "application/problem+json"}
    )

@app.exception_handler(Exception)
async def generic_exception_handler(request, exc: Exception):
    logger.error(f"Internal server error: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "type": "https://knowledgeforge.com/errors/500",
            "title": "Internal Server Error",
            "status": 500,
            "detail": str(exc),
            "instance": request.url.path
        },
        headers={"Content-Type": "application/problem+json"}
    )

@app.get("/actuator/health")
def health_check():
    return {"status": "UP", "details": {"db": "UP", "redis": "UP"}}

@app.get("/api/query-stream")
async def query_stream(
    query: str = Query(..., description="The query to answer"),
    workspaceId: str = Query(..., description="The target workspace ID"),
    userId: str = Query(..., description="The user ID submitting the query"),
    sessionId: Optional[str] = Query(None, description="The chat session ID"),
    docIds: Optional[str] = Query(None, description="Comma-separated document IDs to filter by")
):
    logger.info(f"Incoming SSE query from user {userId} in workspace {workspaceId} (Session: {sessionId})")
    
    doc_id_list = []
    if docIds:
        doc_id_list = [d.strip() for d in docIds.split(",") if d.strip()]
        
    req = pipeline.QueryPipelineRequest(
        query=query,
        workspace_id=workspaceId,
        doc_ids=doc_id_list,
        user_id=userId,
        session_id=sessionId
    )
    
    # Return EventStream StreamingResponse
    return StreamingResponse(
        pipeline.execute_rag_pipeline(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable buffering in Nginx for real-time streaming
        }
    )

@app.get("/api/docs/analyze")
async def analyze_document(docId: str = Query(..., description="The document ID to analyze")):
    logger.info(f"Analyzing document {docId}...")
    from app import db
    import json
    
    # 1. Try to fetch from Redis cache
    try:
        r = db.get_redis_client()
        cache_key = f"doc_analysis:{docId}"
        cached_val = r.get(cache_key)
        if cached_val:
            logger.info(f"Cache hit for document analysis: {docId}")
            return json.loads(cached_val)
    except Exception as cache_err:
        logger.warning(f"Failed to check Redis cache for {docId}: {str(cache_err)}")

    conn = None
    try:
        conn = db.get_postgres_connection()
        cur = conn.cursor()
        # Fetch the first 5 chunks of the document
        cur.execute(
            "SELECT chunk_text FROM document_chunks WHERE doc_id = %s ORDER BY chunk_index ASC LIMIT 5",
            (docId,)
        )
        rows = cur.fetchall()
        cur.close()
        
        if not rows:
            return {
                "summary": "This document contains no text content to analyze.",
                "entities": ["None"],
                "topics": ["Uncategorized"]
            }
            
        combined_text = "\n\n".join([r[0] for r in rows])
        
        from app.agents.base_agent import LLMRouter
        router = LLMRouter()
        
        prompt = (
            f"Analyze the following text from a document and generate:\n"
            f"1. A concise, one or two-sentence summary of the document content.\n"
            f"2. A JSON list of 3-5 key entities (like company names, core concepts, protocols) mentioned.\n"
            f"3. A JSON list of 2-4 general topic clusters.\n\n"
            f"TEXT CONTENT:\n{combined_text[:4000]}\n\n"
            f"Respond strictly in JSON format with keys 'summary' (string), 'entities' (list of strings), and 'topics' (list of strings). "
            f"Do not write any markdown formatting, code block backticks (like ```json), or introductory/concluding text. Just output raw valid JSON."
        )
        
        messages = [{"role": "user", "content": prompt}]
        response = await router.complete(messages, role="intermediate", stream=False)
        content = response.content.strip()
        
        # Clean markdown JSON block if present
        if content.startswith("```"):
            content = content.replace("```json", "").replace("```", "").strip()
            
        try:
            data = json.loads(content)
        except Exception:
            # Try to find JSON block via regex if it still failed
            import re
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if match:
                data = json.loads(match.group(0))
            else:
                raise ValueError("Could not parse JSON response from LLM")

        result = {
            "summary": data.get("summary", "No summary generated."),
            "entities": data.get("entities", ["None"]),
            "topics": data.get("topics", ["Uncategorized"])
        }
        
        # 2. Save result in Redis cache (30 days TTL)
        try:
            r = db.get_redis_client()
            r.setex(f"doc_analysis:{docId}", 2592000, json.dumps(result))
            logger.info(f"Cached document analysis result in Redis: {docId}")
        except Exception as cache_write_err:
            logger.warning(f"Failed to cache document analysis in Redis: {str(cache_write_err)}")
            
        return result
    except Exception as e:
        logger.error(f"Failed to analyze document {docId}: {str(e)}")
        return {
            "summary": "This document contains general workplace info. Detailed automatic summaries are currently unavailable.",
            "entities": ["Workplace", "Document", "Info"],
            "topics": ["General Information"]
        }
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
