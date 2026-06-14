import os
import io
import json
import gzip
import uuid
import pika
import boto3
import logging
from botocore.client import Config
from psycopg2.extras import execute_values
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app import config, db, models

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("python-ai-service-worker")

# Initialize S3 client (MinIO or real AWS S3)
s3_client = boto3.client(
    's3',
    aws_access_key_id=config.AWS_ACCESS_KEY_ID,
    aws_secret_access_key=config.AWS_SECRET_ACCESS_KEY,
    region_name=config.AWS_REGION,
    endpoint_url=config.AWS_ENDPOINT_URL if "minio" in config.AWS_ENDPOINT_URL or "localhost" in config.AWS_ENDPOINT_URL else None,
    config=Config(signature_version='s3v4')
)

# Kafka Producer initialization
kafka_producer = None
try:
    from confluent_kafka import Producer
    kafka_producer = Producer({'bootstrap.servers': config.KAFKA_BOOTSTRAP_SERVERS})
except Exception as e:
    logger.error(f"Failed to initialize Kafka Producer: {str(e)}. Will mock event streaming.")

def publish_kafka_event(topic: str, key: str, value: dict):
    if kafka_producer:
        try:
            kafka_producer.produce(
                topic=topic,
                key=key.encode('utf-8'),
                value=json.dumps(value).encode('utf-8')
            )
            kafka_producer.flush()
            logger.info(f"Published Kafka event to {topic}")
        except Exception as e:
            logger.error(f"Failed to publish Kafka event to {topic}: {str(e)}")
    else:
        logger.info(f"Mock Kafka Event [{topic}] - Key: {key}, Value: {value}")

def get_s3_file(s3_key: str) -> bytes:
    logger.info(f"Downloading from S3 bucket '{config.AWS_S3_BUCKET}' with key '{s3_key}'...")
    response = s3_client.get_object(Bucket=config.AWS_S3_BUCKET, Key=s3_key)
    file_bytes = response['Body'].read()
    
    # Decompress gzip
    try:
        logger.info("Decompressing gzip raw file...")
        return gzip.decompress(file_bytes)
    except Exception as e:
        logger.warning(f"File was not GZIP compressed or decompression failed: {str(e)}. Proceeding as raw bytes.")
        return file_bytes

def extract_text(file_bytes: bytes, filename: str) -> str:
    _, ext = os.path.splitext(filename.lower())
    logger.info(f"Extracting text for file type '{ext}'...")
    
    if ext == '.pdf':
        import fitz  # PyMuPDF
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()
        return text
    elif ext == '.docx':
        import docx
        doc = docx.Document(io.BytesIO(file_bytes))
        return "\n".join([p.text for p in doc.paragraphs])
    else:
        # Plain text
        return file_bytes.decode('utf-8', errors='ignore')

def ensure_foundry_iq_index():
    if not config.USE_FOUNDRY_IQ:
        return
    
    index_name = f"{config.AZURE_AI_SEARCH_PREFIX}-index"
    
    headers = {
        "api-key": config.AZURE_AI_SEARCH_KEY,
        "Content-Type": "application/json"
    }
    
    import httpx
    try:
        with httpx.Client() as client:
            url = f"{config.AZURE_AI_SEARCH_ENDPOINT.rstrip('/')}/indexes/{index_name}?api-version=2024-07-01"
            check = client.get(url, headers=headers)
            if check.status_code == 200:
                logger.info(f"Foundry IQ Index '{index_name}' already exists.")
                return
            
            logger.info(f"Creating Foundry IQ Index '{index_name}'...")
            create_url = f"{config.AZURE_AI_SEARCH_ENDPOINT.rstrip('/')}/indexes?api-version=2024-07-01"
            payload = {
                "name": index_name,
                "fields": [
                    {"name": "id", "type": "Edm.String", "key": True},
                    {"name": "workspace_id", "type": "Edm.String", "filterable": True, "searchable": False},
                    {"name": "doc_id", "type": "Edm.String", "filterable": True, "searchable": False},
                    {"name": "chunk_text", "type": "Edm.String", "searchable": True, "filterable": False},
                    {"name": "page_num", "type": "Edm.Int32", "filterable": False, "searchable": False},
                    {"name": "chunk_index", "type": "Edm.Int32", "filterable": False, "searchable": False}
                ],
                "semantic": {
                    "configurations": [{
                        "name": "default",
                        "prioritizedFields": {
                            "prioritizedContentFields": [{"fieldName": "chunk_text"}]
                        }
                    }]
                }
            }
            res = client.post(create_url, headers=headers, json=payload)
            res.raise_for_status()
            logger.info(f"Created Foundry IQ Index '{index_name}' successfully.")
    except Exception as e:
        logger.error(f"Failed to ensure/create Foundry IQ Index '{index_name}': {str(e)}")

def index_to_foundry_iq(chunks: list[str], doc_id: str, workspace_id: str):
    ensure_foundry_iq_index()
    
    index_name = f"{config.AZURE_AI_SEARCH_PREFIX}-index"
    
    documents = []
    for idx, text in enumerate(chunks):
        import uuid
        chunk_id = str(uuid.uuid4())
        safe_key = chunk_id.replace("-", "_")
        documents.append({
            "@search.action": "upload",
            "id": safe_key,
            "workspace_id": str(workspace_id),
            "doc_id": str(doc_id),
            "chunk_text": text,
            "page_num": 1,
            "chunk_index": idx
        })
        
    headers = {
        "api-key": config.AZURE_AI_SEARCH_KEY,
        "Content-Type": "application/json"
    }
    
    import httpx
    url = f"{config.AZURE_AI_SEARCH_ENDPOINT.rstrip('/')}/indexes/{index_name}/docs/index?api-version=2024-07-01"
    with httpx.Client() as client:
        res = client.post(url, headers=headers, json={"value": documents})
        res.raise_for_status()
        logger.info(f"Successfully uploaded {len(documents)} chunks to Foundry IQ index '{index_name}'.")

def index_document_chunks(doc_id: str, workspace_id: str, filename: str, text: str):
    logger.info(f"Splitting text into chunks for document '{doc_id}'...")
    
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=512,
        chunk_overlap=64,
        separators=["\n\n", "\n", ".", " "]
    )
    
    chunks = splitter.split_text(text)
    if not chunks:
        logger.warning("Empty content extracted. No chunks generated.")
        return
        
    if config.USE_FOUNDRY_IQ and config.AZURE_AI_SEARCH_ENDPOINT:
        try:
            logger.info("Foundry IQ integration enabled. Syncing to Azure AI Search...")
            index_to_foundry_iq(chunks, doc_id, workspace_id)
        except Exception as e:
            logger.error(f"Foundry IQ indexing failed: {str(e)}. Proceeding with local indexing only.")
            
    # Always compute local embeddings and index to pgvector for local fallback search and document analysis
    logger.info(f"Generated {len(chunks)} chunks. Computing local embeddings for pgvector...")
    embedding_model = models.get_embedding_model()
    embeddings = embedding_model.encode(chunks)
    
    conn = db.get_postgres_connection()
    try:
        cur = conn.cursor()
        records = []
        for idx, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
            import uuid
            chunk_id = str(uuid.uuid4())
            embedding_list = embedding.tolist()
            records.append((
                chunk_id, doc_id, workspace_id, idx, 1,
                chunk_text, embedding_list, 0, len(chunk_text)
            ))
            
        insert_query = """
            INSERT INTO document_chunks (id, doc_id, workspace_id, chunk_index, page_num, chunk_text, embedding, char_start, char_end)
            VALUES %s
        """
        execute_values(cur, insert_query, records)
        conn.commit()
        cur.close()
        logger.info(f"Successfully inserted {len(records)} chunks into pgvector.")
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to insert chunks in Postgres: {str(e)}")
        raise e
    finally:
        conn.close()

    # Store parsed content in MongoDB
    try:
        mongo_db = db.get_mongo_db()
        collection = mongo_db["parsed_document_content"]
        collection.update_one(
            {"doc_id": doc_id},
            {"$set": {
                "doc_id": doc_id,
                "filename": filename,
                "workspace_id": workspace_id,
                "chunks": [{"index": i, "text": t} for i, t in enumerate(chunks)]
            }},
            upsert=True
        )
        logger.info("Successfully saved parsed contents in MongoDB.")
    except Exception as e:
        logger.error(f"Failed to insert parsed contents in MongoDB: {str(e)}")

def update_document_status(doc_id: str, status: str):
    conn = db.get_postgres_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE documents SET status = %s, updated_at = NOW() WHERE id = %s",
            (status, doc_id)
        )
        conn.commit()
        cur.close()
        logger.info(f"Updated PostgreSQL doc '{doc_id}' status to '{status}'.")
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to update document status in Postgres: {str(e)}")
    finally:
        conn.close()

def process_message(ch, method, properties, body):
    msg = json.loads(body.decode('utf-8'))
    doc_id = msg.get("doc_id")
    s3_key = msg.get("s3_key")
    user_id = msg.get("user_id")
    workspace_id = msg.get("workspace_id")
    idempotency_key = msg.get("idempotency_key")
    filename = msg.get("filename", "unknown.pdf")
    
    logger.info(f"Received ingestion request for doc_id: {doc_id}")
    
    # 1. Check idempotency key in Redis
    r = db.get_redis_client()
    if idempotency_key:
        if r.exists(f"idempotency:ingest:{idempotency_key}"):
            logger.warning(f"Duplicate job detected with key {idempotency_key}. Skipping ingestion.")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return
            
    try:
        # Update status to PROCESSING
        update_document_status(doc_id, "PROCESSING")
        
        # 2. Download from S3/MinIO
        file_bytes = get_s3_file(s3_key)
        
        # 3. Extract text
        text = extract_text(file_bytes, filename)
        
        if not text.strip():
            raise ValueError("No text extracted from document")
            
        # 4. Chunk & Embed & Save
        index_document_chunks(doc_id, workspace_id, filename, text)
        
        # 5. Set idempotency in Redis (TTL 86400s)
        if idempotency_key:
            r.setex(f"idempotency:ingest:{idempotency_key}", 86400, "success")
            
        # 6. Update PG status to INDEXED
        update_document_status(doc_id, "INDEXED")
        
        # 7. Publish Kafka doc.indexed event
        publish_kafka_event(
            topic="doc.indexed",
            key=doc_id,
            value={"doc_id": doc_id, "user_id": user_id, "workspace_id": workspace_id, "filename": filename, "status": "SUCCESS"}
        )
        
        # Ack message
        ch.basic_ack(delivery_tag=method.delivery_tag)
        logger.info(f"Ingestion completed for doc_id: {doc_id}")
        
    except Exception as e:
        logger.error(f"Failed to process ingestion for doc_id {doc_id}: {str(e)}")
        # Nack message
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False) # In production we requeue up to 3x, then DLQ. Here we push straight to failed logic.
        update_document_status(doc_id, "FAILED")
        publish_kafka_event(
            topic="doc.indexed",
            key=doc_id,
            value={"doc_id": doc_id, "user_id": user_id, "workspace_id": workspace_id, "filename": filename, "status": "FAILED", "error": str(e)}
        )

import time

def connect_with_retry(max_attempts=10):
    for attempt in range(max_attempts):
        try:
            credentials = pika.PlainCredentials(config.RABBITMQ_USER, config.RABBITMQ_PASSWORD)
            connection = pika.BlockingConnection(
                pika.ConnectionParameters(
                    host=config.RABBITMQ_HOST,
                    credentials=credentials,
                    heartbeat=600,
                    blocked_connection_timeout=300
                )
            )
            logger.info("Connected to RabbitMQ")
            return connection
        except pika.exceptions.AMQPConnectionError as e:
            wait = min(2 ** attempt, 60)
            logger.warning(f"RabbitMQ not ready (attempt {attempt+1}), retrying in {wait}s: {e}")
            time.sleep(wait)
    raise RuntimeError("Could not connect to RabbitMQ after maximum retries")

def main():
    db.initialize_vector_extension()
    
    def start_worker():
        try:
            connection = connect_with_retry()
            
            channel = connection.channel()
            channel.queue_declare(queue='document.ingest', durable=True)
            channel.queue_declare(queue='document.ingest.dlq', durable=True)
            
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue='document.ingest', on_message_callback=process_message)
            
            logger.info("Ingestion Worker started. Waiting for messages on 'document.ingest' queue...")
            channel.start_consuming()
        except Exception as e:
            logger.critical(f"Worker crashed with error: {str(e)}. Reconnecting in 5 seconds...")
            time.sleep(5)
            start_worker()

    start_worker()

if __name__ == "__main__":
    main()
