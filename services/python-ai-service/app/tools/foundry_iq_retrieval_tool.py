from app import models
from app.tools.base_tool import BaseTool, ToolResult
from app.retrieval.foundry_iq_strategy import FoundryIQRetrievalStrategy

class FoundryIQRetrievalTool(BaseTool):
    @property
    def name(self) -> str:
        return "foundry_iq_retrieval"

    @property
    def description(self) -> str:
        return "Retrieve matching document chunks from the Microsoft Foundry IQ (Azure AI Search) index."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to match against documents."
                },
                "workspace_id": {
                    "type": "string",
                    "description": "The workspace UUID."
                },
                "top_k": {
                    "type": "integer",
                    "description": "Optional number of results to return (default 15)."
                }
            },
            "required": ["query", "workspace_id"]
        }

    async def execute(self, **kwargs) -> ToolResult:
        query = kwargs.get("query")
        workspace_id = kwargs.get("workspace_id")
        top_k = kwargs.get("top_k", 15)
        
        if not query or not workspace_id:
            return ToolResult("Error: query and workspace_id parameters are required.", is_error=True)
            
        try:
            model = models.get_embedding_model()
            embedding = model.encode([query])[0]
            
            strategy = FoundryIQRetrievalStrategy()
            chunks = await strategy.retrieve(
                query_text=query,
                query_embedding=embedding,
                workspace_id=workspace_id,
                top_k=top_k
            )
            
            res_texts = []
            for idx, c in enumerate(chunks):
                res_texts.append(f"[{idx+1}] Doc ID: {c.doc_id}, Page: {c.page_num}, Text: {c.text}")
                
            if not res_texts:
                return ToolResult("No matching document chunks found in search index.")
                
            return ToolResult("\n\n".join(res_texts))
        except Exception as e:
            return ToolResult(f"Retrieval error: {str(e)}", is_error=True)
