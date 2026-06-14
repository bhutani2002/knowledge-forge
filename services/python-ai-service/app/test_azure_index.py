import httpx
import os
from dotenv import load_dotenv

# Load from environment
ENDPOINT = os.getenv("AZURE_AI_SEARCH_ENDPOINT")
KEY = os.getenv("AZURE_AI_SEARCH_KEY")
PREFIX = os.getenv("AZURE_AI_SEARCH_PREFIX", "knowledgeforge")

def test():
    print(f"Endpoint: {ENDPOINT}")
    print(f"Key: {KEY[:5]}...")
    
    index_name = f"{PREFIX}-test-index-123"
    create_url = f"{ENDPOINT.rstrip('/')}/indexes?api-version=2024-07-01"
    
    headers = {
        "api-key": KEY,
        "Content-Type": "application/json"
    }
    
    payload = {
        "name": index_name,
        "fields": [
            {"name": "id", "type": "Edm.String", "key": True},
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
    
    try:
        with httpx.Client() as client:
            res = client.post(create_url, headers=headers, json=payload)
            print(f"Status Code: {res.status_code}")
            print(f"Response: {res.text}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == '__main__':
    test()
