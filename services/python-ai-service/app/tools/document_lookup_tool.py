import asyncio
from app import db
from app.tools.base_tool import BaseTool, ToolResult

class DocumentLookupTool(BaseTool):
    @property
    def name(self) -> str:
        return "document_lookup"

    @property
    def description(self) -> str:
        return "Look up document metadata (such as original filename, status, created date) by its doc_id."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "doc_id": {
                    "type": "string",
                    "description": "The unique UUID of the document to look up."
                }
            },
            "required": ["doc_id"]
        }

    async def execute(self, **kwargs) -> ToolResult:
        doc_id = kwargs.get("doc_id")
        if not doc_id:
            return ToolResult("Error: doc_id parameter is required.", is_error=True)
            
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._lookup, doc_id)

    def _lookup(self, doc_id: str) -> ToolResult:
        import uuid
        conn = None
        try:
            conn = db.get_postgres_connection()
            cur = conn.cursor()
            
            is_uuid = False
            try:
                uuid.UUID(doc_id)
                is_uuid = True
            except ValueError:
                pass
                
            if is_uuid:
                cur.execute(
                    "SELECT original_filename, status, created_at, id FROM documents WHERE id = %s",
                    (doc_id,)
                )
            else:
                cur.execute(
                    "SELECT original_filename, status, created_at, id FROM documents WHERE original_filename = %s OR original_filename ILIKE %s",
                    (doc_id, f"%{doc_id}%")
                )
                
            row = cur.fetchone()
            cur.close()
            if row:
                return ToolResult(f"Filename: {row[0]}, Status: {row[1]}, Created At: {row[2]}, UUID/ID: {row[3]}")
            return ToolResult(f"Document with ID or filename '{doc_id}' not found.")
        except Exception as e:
            return ToolResult(f"Database error during document lookup: {str(e)}", is_error=True)
        finally:
            if conn:
                conn.close()
