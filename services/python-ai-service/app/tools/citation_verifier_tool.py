import re
from app.tools.base_tool import BaseTool, ToolResult

class CitationVerifierTool(BaseTool):
    @property
    def name(self) -> str:
        return "citation_verifier"

    @property
    def description(self) -> str:
        return "Verify whether a specific claim is grounded and supported by the retrieved document chunks."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "claim": {
                    "type": "string",
                    "description": "The claim text to verify."
                },
                "chunks": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "The list of raw text chunks to verify the claim against."
                }
            },
            "required": ["claim", "chunks"]
        }

    async def execute(self, **kwargs) -> ToolResult:
        claim = kwargs.get("claim", "")
        chunks = kwargs.get("chunks", [])
        
        if not claim or not chunks:
            return ToolResult("Error: claim and chunks parameters are required.", is_error=True)

        claim_words = set(re.findall(r'\w+', claim.lower()))
        stop_words = {"is", "the", "a", "an", "and", "or", "in", "on", "at", "to", "for", "with", "that", "this", "by", "of", "are", "was", "were", "it", "they"}
        important_words = claim_words - stop_words
        
        if not important_words:
            return ToolResult("Verification: Undetermined (claim contains no substantial search terms).")
            
        best_match_idx = -1
        best_match_overlap = 0
        
        for idx, chunk in enumerate(chunks):
            chunk_words = set(re.findall(r'\w+', chunk.lower()))
            overlap = len(important_words.intersection(chunk_words))
            if overlap > best_match_overlap:
                best_match_overlap = overlap
                best_match_idx = idx
                
        ratio = best_match_overlap / len(important_words) if important_words else 0
        if ratio >= 0.35:
            return ToolResult(f"Verification: Grounded. Supported by Chunk {best_match_idx + 1} (Overlap ratio: {ratio:.2f})")
            
        return ToolResult(f"Verification: Unverified. No chunk matches the claim sufficiently (Best overlap: {ratio:.2f})")
