import os
import io
import fitz  # PyMuPDF
import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Verify API key
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    # We won't crash on startup, but will fail gracefully when query API is used
    print("WARNING: GEMINI_API_KEY environment variable is not set. Chat will fail until configured.")

app = FastAPI(
    title="KnowledgeForge Standalone RAG Demo",
    description="A self-contained FastAPI RAG application with in-memory vector search and Gemini API."
)

# Enable CORS for easy testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory document & chunk storage
# In production, we use PostgreSQL + pgvector and MongoDB.
class DocumentStore:
    def __init__(self):
        self.documents: Dict[str, Dict[str, Any]] = {}
        self.chunks: List[Dict[str, Any]] = []
        self.embeddings: Optional[np.ndarray] = None
        self._encoder = None

    @property
    def encoder(self):
        if self._encoder is None:
            print("Loading SentenceTransformer model (all-MiniLM-L6-v2) locally...")
            from sentence_transformers import SentenceTransformer
            self._encoder = SentenceTransformer("all-MiniLM-L6-v2")
            print("Model loaded successfully.")
        return self._encoder

    def add_document(self, doc_id: str, filename: str, text: str):
        # Extract metadata and perform chunking
        self.documents[doc_id] = {
            "filename": filename,
            "text": text
        }
        
        # Semantic-like chunking: Recursive split by paragraphs, then sentences
        new_chunks = self.chunk_text(text, doc_id, filename)
        if not new_chunks:
            return
        
        # Generate embeddings
        texts = [c["text"] for c in new_chunks]
        embeddings = self.encoder.encode(texts)
        
        # Add to local store
        start_idx = len(self.chunks)
        for i, chunk in enumerate(new_chunks):
            chunk["index"] = start_idx + i
            self.chunks.append(chunk)
            
        if self.embeddings is None:
            self.embeddings = np.array(embeddings)
        else:
            self.embeddings = np.vstack([self.embeddings, embeddings])

    def chunk_text(self, text: str, doc_id: str, filename: str, chunk_size: int = 500, overlap: int = 50) -> List[Dict[str, Any]]:
        # Quick sliding window splitter
        words = text.split()
        chunks = []
        
        i = 0
        chunk_idx = 0
        while i < len(words):
            chunk_words = words[i:i + chunk_size]
            chunk_text = " ".join(chunk_words)
            chunks.append({
                "doc_id": doc_id,
                "filename": filename,
                "chunk_index": chunk_idx,
                "text": chunk_text
            })
            chunk_idx += 1
            i += (chunk_size - overlap)
            
        return chunks

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        if not self.chunks or self.embeddings is None:
            return []
            
        query_vector = self.encoder.encode([query])[0]
        
        # Cosine similarity
        norm_query = np.linalg.norm(query_vector)
        if norm_query == 0:
            return []
            
        norms = np.linalg.norm(self.embeddings, axis=1)
        # Avoid division by zero
        norms[norms == 0] = 1.0
        
        scores = np.dot(self.embeddings, query_vector) / (norms * norm_query)
        
        # Get top-k indices
        top_indices = np.argsort(scores)[::-1][:top_k]
        
        results = []
        for idx in top_indices:
            results.append({
                "chunk": self.chunks[idx],
                "score": float(scores[idx])
            })
        return results

store = DocumentStore()

class QueryRequest(BaseModel):
    query: str
    top_k: int = 5

class QueryResponse(BaseModel):
    query: str
    answer: str
    citations: List[Dict[str, Any]]

@app.get("/")
def read_root():
    return {"status": "running", "docs_indexed": len(store.documents), "chunks_indexed": len(store.chunks)}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    filename = file.filename
    content = await file.read()
    
    text = ""
    if filename.endswith(".pdf"):
        try:
            pdf_file = fitz.open(stream=content, filetype="pdf")
            for page in pdf_file:
                text += page.get_text()
            pdf_file.close()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")
    elif filename.endswith(".txt"):
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = content.decode("latin-1")
            except Exception:
                raise HTTPException(status_code=400, detail="Failed to decode text file. Ensure UTF-8 or Latin-1 encoding.")
    else:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported in this demo.")
        
    if not text.strip():
        raise HTTPException(status_code=400, detail="Uploaded file contains no readable text.")
        
    doc_id = str(hash(filename + text[:100]))
    store.add_document(doc_id, filename, text)
    
    return {
        "status": "success",
        "doc_id": doc_id,
        "filename": filename,
        "chunks_created": len(store.chunks)
    }

@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    if not store.chunks:
        raise HTTPException(status_code=400, detail="No documents have been indexed yet. Please upload files first.")
        
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
         raise HTTPException(
             status_code=500, 
             detail="GEMINI_API_KEY environment variable is missing. Set it in the .env file."
         )
         
    # 1. Retrieve top chunks
    search_results = store.search(request.query, top_k=request.top_k)
    
    # 2. Build context and format sources
    context_parts = []
    citations = []
    
    for i, res in enumerate(search_results):
        chunk = res["chunk"]
        source_label = f"Source {i + 1}"
        context_parts.append(f"[{source_label}] (File: {chunk['filename']}): {chunk['text']}")
        citations.append({
            "citation_id": i + 1,
            "filename": chunk["filename"],
            "text": chunk["text"],
            "score": res["score"]
        })
        
    context = "\n\n".join(context_parts)
    
    # 3. Call Google Gemini API via langchain-google-genai
    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        from langchain_core.messages import HumanMessage, SystemMessage
        
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.5-flash",
            google_api_key=api_key,
            temperature=0.2
        )
        
        system_prompt = (
            "You are a precise, helpful assistant. Answer ONLY from the provided context. "
            "Never hallucinate. For every factual claim, cite the source as [Source N] where N is "
            "the chunk number (e.g. [Source 1], [Source 2]). If the context is insufficient, respond "
            "exactly: \"I don't have enough information in the provided documents to answer this question.\""
        )
        
        user_prompt = f"CONTEXT:\n{context}\n\nQUESTION:\n{request.query}"
        
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ]
        
        response = llm.invoke(messages)
        answer = response.content
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to query Gemini API: {str(e)}")
        
    return QueryResponse(
        query=request.query,
        answer=str(answer),
        citations=citations
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
