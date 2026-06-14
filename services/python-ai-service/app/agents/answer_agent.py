import json
import logging
import re
from typing import AsyncGenerator, List, Dict, Any
from app.agents.base_agent import BaseAgent, QueryState
from app.tools import (
    DocumentLookupTool,
    CalculatorTool,
    WebSearchTool,
    CitationVerifierTool,
    DateResolverTool
)

logger = logging.getLogger("answer-agent")

class AnswerAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.tools = [
            DocumentLookupTool(),
            CalculatorTool(),
            WebSearchTool(),
            CitationVerifierTool(),
            DateResolverTool()
        ]
        self.max_iterations = 3

    async def run(self, state: QueryState) -> AsyncGenerator[str, None]:
        # If the path is SIMPLE_FACTUAL or COMPLEX_MULTI_DOC, skip ReAct and stream response directly
        if state.pipeline_path in ["SIMPLE_FACTUAL", "COMPLEX_MULTI_DOC"]:
            logger.info(f"Path is {state.pipeline_path}. Skipping ReAct loop and streaming final response directly...")
            messages = self._build_direct_messages(state)
            async for token, provider_name in self.llm_router.complete(messages, role="final", stream=True):
                state.active_provider = provider_name
                yield token
            return

        # Otherwise, run the ReAct reasoning loop (for COMPUTATIONAL or OUT_OF_SCOPE)
        messages = self._build_initial_messages(state)
        
        active_provider = "Gemini"
        
        for iteration in range(self.max_iterations):
            logger.info(f"AnswerAgent ReAct iteration {iteration + 1}...")
            
            # Check if we should execute tools by querying the LLMRouter (non-stream for reasoning checks)
            try:
                response = await self.llm_router.complete(messages, role="intermediate", stream=False)
                active_provider = response.active_provider
            except Exception as e:
                logger.error(f"Reasoning query failed: {str(e)}")
                break

            # Check for tool invocations (either standard tool_calls or JSON block in text content)
            tool_calls = self._parse_tool_calls(response)
            
            if tool_calls:
                logger.info(f"Act: Executing {len(tool_calls)} tool calls...")
                tool_results = await self._execute_tools(tool_calls, state)
                
                # Append assistant thoughts and tool observations
                messages.append({
                    "role": "assistant",
                    "content": response.content or f"Executing tools: {json.dumps(tool_calls)}"
                })
                messages.append({
                    "role": "user",
                    "content": f"Observation: {json.dumps(tool_results)}"
                })
                continue
            
            break

        # Final answer - stream it
        logger.info("Final answer reached. Streaming response...")
        # We append the system instructions for final answer formatting
        messages.append({
            "role": "system",
            "content": "Prepare the final response. State the answers clearly. Provide inline citations [Source N] for factual assertions. DO NOT output any JSON tool blocks or call any tools now."
        })
        
        async for token, provider_name in self.llm_router.complete(messages, role="final", stream=True):
            state.active_provider = provider_name
            yield token

    def _build_direct_messages(self, state: QueryState) -> List[Dict[str, str]]:
        is_empty_context = not state.compressed_context or "No documents found" in state.compressed_context or state.compressed_context.strip() == ""
        
        system_instruction = (
            "You are a precise, helpful AI assistant. Answer the user query using the provided context.\n"
        )
        if is_empty_context:
            system_instruction += (
                "IMPORTANT: There are no uploaded documents in this workspace. "
                "Just politely tell the user that no documents are uploaded in the workspace, and that they need to upload files "
                "in the Documents section to start asking questions.\n"
            )
        else:
            system_instruction += (
                "CONTEXT:\n" + state.compressed_context + "\n\n"
                "RULES:\n"
                "- Cite sources using [Source N] (e.g. [Source 1], [Source 2]).\n"
                "- If you cannot answer from context, say 'I don't have any documents in this workspace to refer to. Please upload documents first so I can assist you.'\n"
            )
        
        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": state.original_query}
        ]

    def _build_initial_messages(self, state: QueryState) -> List[Dict[str, str]]:
        # Filter tools based on path to prevent hallucinated tool calls
        if state.pipeline_path == "COMPUTATIONAL":
            active_tools = [t for t in self.tools if t.name in ["calculator", "date_resolver"]]
        elif state.pipeline_path == "OUT_OF_SCOPE":
            active_tools = [t for t in self.tools if t.name in ["web_search"]]
        else:
            active_tools = self.tools

        tool_desc = []
        for t in active_tools:
            tool_desc.append(f"- {t.name}: {t.description}. Input Schema: {json.dumps(t.input_schema)}")
            
        is_empty_context = not state.compressed_context or "No documents found" in state.compressed_context or state.compressed_context.strip() == ""
        
        system_instruction = (
            "You are a precise, helpful agentic AI assistant. Answer using the context or tools.\n"
        )
        if is_empty_context and state.pipeline_path != "OUT_OF_SCOPE":
            system_instruction += (
                "IMPORTANT: There are no uploaded documents in this workspace. DO NOT CALL ANY TOOLS. "
                "Just politely tell the user that no documents are uploaded in the workspace, and that they need to upload files "
                "in the Documents section to start asking questions.\n"
            )
        else:
            system_instruction += (
                "You can call tools to resolve calculations, resolve relative dates, or perform web searches if needed.\n"
                "If you need to use a tool, return a single JSON code block in your response:\n"
                "```json\n"
                "{\n"
                "  \"tool\": \"tool_name\",\n"
                "  \"args\": {\"arg_name\": \"value\"}\n"
                "}\n"
                "```\n"
                "\n"
                "Available tools:\n" + "\n".join(tool_desc) + "\n\n"
            )
            
        system_instruction += (
            "CONTEXT:\n" + state.compressed_context + "\n\n"
            "RULES:\n"
            "- Cite sources using [Source N] (e.g. [Source 1], [Source 2]).\n"
            "- If you cannot answer from context or tools, say 'I don't have any documents in this workspace to refer to. Please upload documents first so I can assist you.'\n"
        )
        
        return [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": state.original_query}
        ]

    def _parse_tool_calls(self, response) -> List[Dict[str, Any]]:
        # 1. API tool calls check
        if hasattr(response, "tool_calls") and response.tool_calls:
            calls = []
            for tc in response.tool_calls:
                fn = tc.get("function", {})
                calls.append({
                    "name": fn.get("name"),
                    "args": json.loads(fn.get("arguments", "{}"))
                })
            return calls
            
        content = response.content or ""
        
        # 2. Regex search for JSON block
        match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1).strip())
                if "tool" in data:
                    return [{
                        "name": data["tool"],
                        "args": data.get("args", {})
                    }]
            except Exception:
                pass
                
        # 3. Fallback: Try parsing the whole content as JSON (if backticks are missing)
        try:
            data = json.loads(content.strip())
            if "tool" in data:
                return [{
                    "name": data["tool"],
                    "args": data.get("args", {})
                }]
        except Exception:
            pass
            
        return []

    async def _execute_tools(self, tool_calls: List[Dict[str, Any]], state: QueryState) -> Dict[str, Any]:
        results = {}
        for tc in tool_calls:
            name = tc.get("name")
            args = tc.get("args", {})
            
            # Locate tool
            tool = next((t for t in self.tools if t.name == name), None)
            if not tool:
                results[name] = f"Error: Tool '{name}' is not registered."
                continue
                
            logger.info(f"Executing tool '{name}' with args {args}...")
            
            # Inject state details if needed by retrieval verifiers
            if name == "citation_verifier" and "chunks" not in args:
                args["chunks"] = [c["text"] for c in state.reranked_chunks]
            if (name == "foundry_iq_retrieval" or name == "pgvector_retrieval") and "workspace_id" not in args:
                args["workspace_id"] = getattr(state, "workspace_id", "")

            try:
                res = await tool.execute(**args)
                results[name] = res.content
            except Exception as e:
                results[name] = f"Error executing tool '{name}': {str(e)}"
                
        return results
