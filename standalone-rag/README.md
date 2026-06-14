# 🚀 Standalone RAG Demo (FastAPI + Local Vector Search)

This directory contains a self-contained, lightweight **Retrieval-Augmented Generation (RAG) sandbox** application. It serves as an isolated developer playground to ingest PDF or TXT files, chunk and embed them locally using `sentence-transformers`, perform vector search via cosine similarity, and answer user queries with precise sources using the Google Gemini 2.5 Flash API.

It requires **no external databases or message brokers** (no Postgres, MongoDB, Redis, RabbitMQ, or Kafka), making it perfect for rapid testing, prototyping, and offline development.

---

## ⚙️ How It Works

1. **Document Ingestion (`/upload`)**:
   - Accepts `.pdf` or `.txt` file uploads.
   - Extracts raw text from PDF files using `PyMuPDF` (`fitz`).
   - Splits text into semantic-like chunks using a sliding window chunking algorithm (500 words per chunk with 50 words overlap).
   - Generates dense vector embeddings locally using the `all-MiniLM-L6-v2` model from `sentence-transformers` and caches them in memory.

2. **Semantic Search & LLM Generation (`/query`)**:
   - Accepts a natural language query.
   - Embeds the user query using the same local sentence transformer model.
   - Performs an in-memory cosine similarity search against all cached document chunks to retrieve the top `k` most relevant context pieces.
   - Formulates a system prompt forcing the LLM to answer only from the retrieved context and attribute facts using citations (e.g. `[Source 1]`, `[Source 2]`).
   - Streams/queries the answer using Google Gemini 2.5 Flash (`langchain-google-genai`) and returns the answer alongside a structured list of citation metadata.

---

## Prerequisites

- **Python 3.9+** (Python 3.10 recommended)
- A **Google Gemini API Key** (obtain one for free from [Google AI Studio](https://aistudio.google.com/))

---

## 📦 Setup

1. **Navigate to the Standalone RAG folder**:

   ```bash
   cd standalone-rag
   ```

2. **Install Python Dependencies**:
   It is recommended to use a virtual environment:

   ```bash
   # Create a virtual environment
   python -m venv venv

   # Activate the virtual environment
   # On Windows:
   .\venv\Scripts\activate
   # On macOS/Linux:
   source venv/bin/activate

   # Install dependencies
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**:
   Copy the template environment file:

   ```bash
   cp .env.example .env
   # Or on Windows PowerShell:
   Copy-Item .env.example .env
   ```

   Open the newly created `.env` file and insert your Gemini API Key:

   ```env
   GEMINI_API_KEY=your_actual_gemini_api_key_here
   ```

4. **Run the Application**:
   ```bash
   python main.py
   ```
   The Uvicorn web server will start running on `http://127.0.0.1:8000`.

---

## 📡 API Endpoints

### 1. Health & Status Check

- **Method**: `GET`
- **Path**: `/`
- **Description**: Returns the server status and the count of currently indexed documents and chunks.
- **Example Request**:
  ```bash
  curl http://127.0.0.1:8000/
  ```

### 2. Upload Document

- **Method**: `POST`
- **Path**: `/upload`
- **Content-Type**: `multipart/form-data`
- **Description**: Accepts a single PDF or TXT file, parses it, creates vector chunks, and appends them to the in-memory store.
- **Example Request**:
  ```bash
  curl -X POST -F "file=@/path/to/my_document.pdf" http://127.0.0.1:8000/upload
  ```

### 3. Query Knowledge Base

- **Method**: `POST`
- **Path**: `/query`
- **Content-Type**: `application/json`
- **Description**: Executes local vector semantic search and queries the Gemini model with retrieved citations.
- **Example Request**:
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -d '{"query": "What is the core implementation architecture?", "top_k": 3}' \
    http://127.0.0.1:8000/query
  ```
- **Sample Response**:
  ```json
  {
    "query": "What is the core implementation architecture?",
    "answer": "According to the system overview, the core architecture leverages a microservice-based model using Spring Boot [Source 1]. Message brokers like RabbitMQ process background tasks asynchronously [Source 2].",
    "citations": [
      {
        "citation_id": 1,
        "filename": "my_document.pdf",
        "text": "The core implementation leverages a microservice-based design...",
        "score": 0.8241
      },
      {
        "citation_id": 2,
        "filename": "my_document.pdf",
        "text": "RabbitMQ coordinates background ingestion tasks...",
        "score": 0.7915
      }
    ]
  }
  ```
