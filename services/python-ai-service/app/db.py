import psycopg2
from psycopg2.extras import execute_values
import pymongo
import redis
import logging
from app import config

logger = logging.getLogger("python-ai-service")

# Postgres Connection Helper
def get_postgres_connection():
    return psycopg2.connect(
        dbname=config.POSTGRES_DB,
        user=config.POSTGRES_USER,
        password=config.POSTGRES_PASSWORD,
        host=config.POSTGRES_HOST,
        port=config.POSTGRES_PORT
    )

# Mongo DB client helper
_mongo_client = None
def get_mongo_db():
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = pymongo.MongoClient(config.MONGO_URI)
    return _mongo_client[config.MONGO_DB]

# Redis connection helper
_redis_client = None
def get_redis_client():
    global _redis_client
    if _redis_client is None:
        if config.REDIS_PASSWORD:
            _redis_client = redis.Redis(
                host=config.REDIS_HOST,
                port=config.REDIS_PORT,
                password=config.REDIS_PASSWORD,
                decode_responses=True
            )
        else:
            _redis_client = redis.Redis(
                host=config.REDIS_HOST,
                port=config.REDIS_PORT,
                decode_responses=True
            )
    return _redis_client

# Bloom filter helper via Redis
def bloom_filter_exists(filter_name: str, item: str) -> bool:
    try:
        r = get_redis_client()
        # BF.EXISTS returns 1 if item exists, 0 otherwise
        result = r.execute_command("BF.EXISTS", filter_name, item)
        return bool(result)
    except Exception as e:
        logger.error(f"Redis Bloom Filter BF.EXISTS failed: {str(e)}. Falling back to false.")
        return False

def bloom_filter_add(filter_name: str, item: str):
    try:
        r = get_redis_client()
        # BF.ADD adds an item to the bloom filter
        r.execute_command("BF.ADD", filter_name, item)
    except Exception as e:
        logger.error(f"Redis Bloom Filter BF.ADD failed: {str(e)}")

# Initialize DB tables for pgvector if not created (Flyway handles core tables, but we can double check)
def initialize_vector_extension():
    conn = None
    try:
        conn = get_postgres_connection()
        cur = conn.cursor()
        # Enable pgvector if not enabled
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        conn.commit()
        cur.close()
    except Exception as e:
        logger.error(f"Failed to enable pgvector extension: {str(e)}")
    finally:
        if conn:
            conn.close()
