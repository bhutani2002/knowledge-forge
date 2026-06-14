from datetime import datetime, timedelta
from app.tools.base_tool import BaseTool, ToolResult

class DateResolverTool(BaseTool):
    @property
    def name(self) -> str:
        return "date_resolver"

    @property
    def description(self) -> str:
        return "Resolve relative dates (e.g. 'last quarter', 'this year', 'yesterday') to precise calendar dates."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "relative_date": {
                    "type": "string",
                    "description": "The relative date phrase to resolve (e.g. 'last quarter', 'today')."
                }
            },
            "required": ["relative_date"]
        }

    async def execute(self, **kwargs) -> ToolResult:
        relative = kwargs.get("relative_date", "").lower().strip()
        if not relative:
            return ToolResult("Error: relative_date parameter is required.", is_error=True)
            
        now = datetime.utcnow()
        year = now.year
        
        if "today" in relative:
            return ToolResult(f"Resolved date: {now.strftime('%Y-%m-%d')}")
        elif "yesterday" in relative:
            yesterday = now - timedelta(days=1)
            return ToolResult(f"Resolved date: {yesterday.strftime('%Y-%m-%d')}")
        elif "this year" in relative:
            return ToolResult(f"Date range: {year}-01-01 to {year}-12-31")
        elif "last year" in relative:
            return ToolResult(f"Date range: {year-1}-01-01 to {year-1}-12-31")
        elif "this quarter" in relative:
            quarter = (now.month - 1) // 3 + 1
            start_month = (quarter - 1) * 3 + 1
            return ToolResult(f"Date range: {year}-{start_month:02d}-01 to {now.strftime('%Y-%m-%d')} (Q{quarter})")
        elif "last quarter" in relative:
            quarter = (now.month - 1) // 3 + 1
            l_quarter = quarter - 1 if quarter > 1 else 4
            l_year = year if quarter > 1 else year - 1
            start_month = (l_quarter - 1) * 3 + 1
            end_month = start_month + 2
            end_days = {3: 31, 6: 30, 9: 30, 12: 31}
            return ToolResult(f"Date range: {l_year}-{start_month:02d}-01 to {l_year}-{end_month:02d}-{end_days[end_month]} (Q{l_quarter})")
            
        return ToolResult(f"Default resolved date: {now.strftime('%Y-%m-%d')} (no parser for '{relative}')")
