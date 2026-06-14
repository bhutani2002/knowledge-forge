import google.generativeai as genai
from app import config
from app.tools.base_tool import BaseTool, ToolResult

class WebSearchTool(BaseTool):
    @property
    def name(self) -> str:
        return "web_search"

    @property
    def description(self) -> str:
        return "Search the web for real-time or public information using Google Search when local documents do not have the answer."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to look up on the web."
                }
            },
            "required": ["query"]
        }

    async def execute(self, **kwargs) -> ToolResult:
        query = kwargs.get("query")
        if not query:
            return ToolResult("Error: query parameter is required.", is_error=True)

        if not config.GEMINI_API_KEY:
            return ToolResult("Error: GEMINI_API_KEY is not configured for web search grounding.", is_error=True)

        try:
            genai.configure(api_key=config.GEMINI_API_KEY)
            model = genai.GenerativeModel(
                model_name="gemini-2.5-flash",
                tools=[{"google_search": {}}]
            )
            
            # Run in executor to prevent blocking
            import asyncio
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None, 
                lambda: model.generate_content(
                    f"Summarize web search results for the query: '{query}'. "
                    f"Answer accurately and list key citations if available."
                )
            )
            
            text = response.text
            
            # Format search grounding metadata if present
            sources = []
            try:
                metadata = response.candidates[0].grounding_metadata
                if metadata and metadata.grounding_chunks:
                    for idx, chunk in enumerate(metadata.grounding_chunks):
                        if chunk.web:
                            title = chunk.web.title
                            uri = chunk.web.uri
                            sources.append(f"[{idx+1}] {title} ({uri})")
            except Exception:
                pass

            if sources:
                text += "\n\nWeb Sources:\n" + "\n".join(sources)
                
            return ToolResult(text)
        except Exception as e:
            return ToolResult(f"Web search tool failed: {str(e)}", is_error=True)
