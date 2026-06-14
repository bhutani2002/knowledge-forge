import uuid
import logging
from app import db, models
from psycopg2.extras import execute_values

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed-guest-data")

def main():
    logger.info("Initializing vector extension and database connections...")
    db.initialize_vector_extension()
    
    # 1. Establish database connection
    conn = db.get_postgres_connection()
    cur = conn.cursor()
    
    try:
        # 2. Insert public system user
        logger.info("Inserting public system user...")
        cur.execute("""
            INSERT INTO users (id, email, password_hash, role, tier, display_name)
            VALUES ('00000000-0000-0000-0000-000000000000', 'public@knowledgeforge.com', '*', 'SYSTEM', 'FREE', 'System Public')
            ON CONFLICT (id) DO NOTHING;
        """)
        
        # 3. Insert public workspace
        logger.info("Inserting public workspace...")
        cur.execute("""
            INSERT INTO workspaces (id, name, owner_id)
            VALUES ('00000000-0000-0000-0000-000000000000', 'Public Corpus Workspace', '00000000-0000-0000-0000-000000000000')
            ON CONFLICT (id) DO NOTHING;
        """)
        
        # 4. Insert public workspace membership
        logger.info("Inserting public workspace membership...")
        cur.execute("""
            INSERT INTO workspace_members (id, workspace_id, user_id, role)
            VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'WORKSPACE_ADMIN')
            ON CONFLICT (id) DO NOTHING;
        """)
        
        # 5. Clean up old documents in guest workspace to avoid duplication/conflicts
        logger.info("Cleaning up old public workspace documents and chunks...")
        cur.execute("DELETE FROM document_chunks WHERE workspace_id = '00000000-0000-0000-0000-000000000000';")
        cur.execute("DELETE FROM documents WHERE workspace_id = '00000000-0000-0000-0000-000000000000';")
        
        # 6. Insert new public documents
        logger.info("Inserting new public documents...")
        doc_records = [
            ('d1111111-1111-1111-1111-111111111111', None, '00000000-0000-0000-0000-000000000000', 'workspaces/00000000-0000-0000-0000-000000000000/q3_report.pdf', 'Q3 Financial Report.pdf', 'hash_q3_financial_report', 'INDEXED'),
            ('d2222222-2222-2222-2222-222222222222', None, '00000000-0000-0000-0000-000000000000', 'workspaces/00000000-0000-0000-0000-000000000000/roadmap.docx', 'Product Roadmap 2025.docx', 'hash_product_roadmap_2025', 'INDEXED'),
            ('d3333333-3333-3333-3333-333333333333', None, '00000000-0000-0000-0000-000000000000', 'workspaces/00000000-0000-0000-0000-000000000000/legal_contract.pdf', 'Legal Contract v2.pdf', 'hash_legal_contract_v2', 'PROCESSING'),
            ('d4444444-4444-4444-4444-444444444444', None, '00000000-0000-0000-0000-000000000000', 'workspaces/00000000-0000-0000-0000-000000000000/eng_spec.txt', 'Engineering Spec v3.txt', 'hash_engineering_spec', 'FAILED')
        ]
        execute_values(cur, """
            INSERT INTO documents (id, user_id, workspace_id, s3_key, original_filename, file_hash, status)
            VALUES %s
        """, doc_records)
        
        # 7. Set up the text chunks for the two INDEXED documents
        logger.info("Defining text chunks...")
        doc1_id = 'd1111111-1111-1111-1111-111111111111'
        doc1_chunks = [
            "The main conclusion of this Q3 financial report is that company operations are highly profitable and sustainable, showing a 24% year-over-year revenue growth due to strong enterprise adoption. Operating income reached a record high of $12.4M.",
            "Key risks mentioned in the report are supply chain disruption, rising commodity prices, and new European regulatory compliance requirements. Management is actively implementing hedging strategies to mitigate these supply chain and commodity price risks.",
            "Comparing Q3 vs Q4 performance: Q3 performance was strong with $42M in revenue and a 68% gross margin, while Q4 is projected to grow to $48M in revenue, though with slightly lower operating margins due to increased year-end marketing expenses."
        ]
        
        doc2_id = 'd2222222-2222-2222-2222-222222222222'
        doc2_chunks = [
            "Product Roadmap 2025 Details: In Q1 2025, we will release semantic RAG search and WebSockets STOMP presence indicators. In Q2 2025, we will deploy multi-tenant isolation and explainability panels."
        ]
        
        # 8. Load model and compute embeddings
        logger.info("Loading SentenceTransformer model (all-MiniLM-L6-v2) to compute embeddings...")
        model = models.get_embedding_model()
        
        # Combine all chunks to embed in one batch
        all_chunks = []
        for text in doc1_chunks:
            all_chunks.append((doc1_id, text))
        for text in doc2_chunks:
            all_chunks.append((doc2_id, text))
            
        texts_to_embed = [item[1] for item in all_chunks]
        embeddings = model.encode(texts_to_embed)
        
        # 9. Insert chunks into PostgreSQL pgvector
        logger.info("Inserting chunks and embeddings into PostgreSQL pgvector...")
        chunk_records = []
        for idx, (doc_id, text) in enumerate(all_chunks):
            chunk_id = str(uuid.uuid4())
            embedding_list = embeddings[idx].tolist()
            chunk_records.append((
                chunk_id, doc_id, '00000000-0000-0000-0000-000000000000', idx, 1,
                text, embedding_list, 0, len(text)
            ))
            
        execute_values(cur, """
            INSERT INTO document_chunks (id, doc_id, workspace_id, chunk_index, page_num, chunk_text, embedding, char_start, char_end)
            VALUES %s
        """, chunk_records)
        
        conn.commit()
        logger.info("PostgreSQL seeding completed successfully.")
        
        # 10. Sync parsed document content to MongoDB
        logger.info("Syncing parsed document content to MongoDB...")
        mongo_db = db.get_mongo_db()
        collection = mongo_db["parsed_document_content"]
        
        # Clean old MongoDB parsed contents for guest workspace
        collection.delete_many({"workspace_id": "00000000-0000-0000-0000-000000000000"})
        
        # Insert Q3 Report parsed contents
        collection.insert_one({
            "doc_id": doc1_id,
            "filename": "Q3 Financial Report.pdf",
            "workspace_id": "00000000-0000-0000-0000-000000000000",
            "chunks": [{"index": i, "text": t} for i, t in enumerate(doc1_chunks)]
        })
        
        # Insert Roadmap parsed contents
        collection.insert_one({
            "doc_id": doc2_id,
            "filename": "Product Roadmap 2025.docx",
            "workspace_id": "00000000-0000-0000-0000-000000000000",
            "chunks": [{"index": i, "text": t} for i, t in enumerate(doc2_chunks)]
        })
        
        logger.info("MongoDB seeding completed successfully.")
        
    except Exception as e:
        conn.rollback()
        logger.error(f"Seeding failed: {str(e)}")
        raise e
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    main()
