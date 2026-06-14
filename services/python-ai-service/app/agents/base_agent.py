import json
import logging
import httpx
import asyncio
from typing import AsyncGenerator, List, Dict, Any, Optional
from app import config, db

logger = logging.getLogger("llm-router")

class CompletionResponse:
    def __init__(self, content: str, finish_reason: str = "stop", tool_calls: List[Dict[str, Any]] = None, provider: str = ""):
        self.content = content
        self.finish_reason = finish_reason
        self.tool_calls = tool_calls or []
        self.active_provider = provider

class LLMProvider:
    def __init__(self, name: str, api_key: str, model: str, base_url: str):
        self.name = name
        self.api_key = api_key
        self.model = model
        self.base_url = base_url

    def is_available(self) -> bool:
        if not self.api_key:
            return False
        try:
            r = db.get_redis_client()
            if r.exists(f"provider_backoff:{self.name}"):
                return False
        except Exception:
            pass
        return True

    def record_rate_limit(self):
        logger.warning(f"Rate limit triggered for provider '{self.name}'. Backing off for 60s.")
        try:
            r = db.get_redis_client()
            r.setex(f"provider_backoff:{self.name}", 60, "locked")
        except Exception:
            pass

    def record_success(self):
        pass

    async def complete_stream(self, messages: list) -> AsyncGenerator[str, None]:
        url = f"{self.base_url.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        # Handle custom endpoints or auth headers (Azure or OpenRouter)
        if "openrouter.ai" in self.base_url:
            headers["HTTP-Referer"] = "https://knowledgeforge.com"
            headers["X-Title"] = "KnowledgeForge"
        elif "openai.azure" in self.base_url or "azure" in self.name.lower():
            url = f"{self.base_url.rstrip('/')}/openai/deployments/{self.model}/chat/completions?api-version=2023-05-15"
            headers = {
                "Content-Type": "application/json",
                "api-key": self.api_key
            }

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True
        }

        async with httpx.AsyncClient() as client:
            try:
                async with client.stream("POST", url, headers=headers, json=payload, timeout=30.0) as response:
                    if response.status_code == 429:
                        self.record_rate_limit()
                        raise httpx.HTTPStatusError("Rate limited", request=response.request, response=response)
                    response.raise_for_status()
                    
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line:
                            continue
                        if line.startswith("data: "):
                            content = line[6:]
                            if content == "[DONE]":
                                break
                            try:
                                data = json.loads(content)
                                delta = data["choices"][0]["delta"]
                                if "content" in delta and delta["content"]:
                                    yield delta["content"]
                            except Exception:
                                pass
            except Exception as e:
                logger.error(f"Streaming error on provider '{self.name}': {str(e)}")
                raise e

    async def complete_non_stream(self, messages: list) -> CompletionResponse:
        url = f"{self.base_url.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        if "openrouter.ai" in self.base_url:
            headers["HTTP-Referer"] = "https://knowledgeforge.com"
            headers["X-Title"] = "KnowledgeForge"
        elif "openai.azure" in self.base_url or "azure" in self.name.lower():
            url = f"{self.base_url.rstrip('/')}/openai/deployments/{self.model}/chat/completions?api-version=2023-05-15"
            headers = {
                "Content-Type": "application/json",
                "api-key": self.api_key
            }

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, headers=headers, json=payload, timeout=30.0)
            if response.status_code == 429:
                self.record_rate_limit()
                raise httpx.HTTPStatusError("Rate limited", request=response.request, response=response)
            response.raise_for_status()
            
            data = response.json()
            choice = data["choices"][0]
            content = choice["message"].get("content", "")
            finish_reason = choice.get("finish_reason", "stop")
            tool_calls = choice["message"].get("tool_calls", [])
            
            return CompletionResponse(
                content=content,
                finish_reason=finish_reason,
                tool_calls=tool_calls,
                provider=self.name
            )


class GeminiProvider(LLMProvider):
    def __init__(self):
        super().__init__("Gemini", config.GEMINI_API_KEY, "gemini-2.5-flash", "https://generativelanguage.googleapis.com")

    async def complete_stream(self, messages: list) -> AsyncGenerator[str, None]:
        import google.generativeai as genai
        genai.configure(api_key=self.api_key)
        
        system_instruction = None
        contents = []
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "system":
                system_instruction = content
            else:
                contents.append({
                    "role": "user" if role == "user" else "model",
                    "parts": [{"text": content}]
                })
        
        model = genai.GenerativeModel(self.model, system_instruction=system_instruction)
        loop = asyncio.get_event_loop()
        
        def run_gen():
            return model.generate_content(contents, stream=True)
            
        try:
            response_stream = await loop.run_in_executor(None, run_gen)
            for chunk in response_stream:
                if chunk.text:
                    yield chunk.text
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                self.record_rate_limit()
            logger.error(f"Gemini streaming error: {str(e)}")
            raise e

    async def complete_non_stream(self, messages: list) -> CompletionResponse:
        import google.generativeai as genai
        genai.configure(api_key=self.api_key)
        
        system_instruction = None
        contents = []
        for msg in messages:
            role = msg["role"]
            content = msg["content"]
            if role == "system":
                system_instruction = content
            else:
                contents.append({
                    "role": "user" if role == "user" else "model",
                    "parts": [{"text": content}]
                })
        
        model = genai.GenerativeModel(self.model, system_instruction=system_instruction)
        loop = asyncio.get_event_loop()
        
        try:
            response = await loop.run_in_executor(None, lambda: model.generate_content(contents))
            return CompletionResponse(
                content=response.text,
                finish_reason="stop",
                tool_calls=[],
                provider=self.name
            )
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                self.record_rate_limit()
            logger.error(f"Gemini non-streaming error: {str(e)}")
            raise e


class LLMRouter:
    def __init__(self):
        # Strictly free/free-tier models
        # Role: "intermediate" - lightweight, structured, fast tasks
        self.intermediate_providers = [
            GeminiProvider(),
            LLMProvider("Groq Llama 3.1 8B", config.GROQ_API_KEY, "llama-3.1-8b-instant", "https://api.groq.com/openai/v1"),
            LLMProvider("OpenRouter Nvidia Nemotron Nano", config.OPENROUTER_API_KEY, "nvidia/nemotron-nano-9b-v2:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Llama 3.2 3B", config.OPENROUTER_API_KEY, "meta-llama/llama-3.2-3b-instruct:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Mistral 24B", config.OPENROUTER_API_KEY, "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Gemma 4 26B", config.OPENROUTER_API_KEY, "google/gemma-4-26b-a4b-it:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Content Safety", config.OPENROUTER_API_KEY, "nvidia/nemotron-3.5-content-safety:free", "https://openrouter.ai/api/v1")
        ]
        
        # Role: "final" - answer generation, summarization, reporting
        self.final_providers = [
            GeminiProvider(),
            LLMProvider("Groq Llama 3.3 70B", config.GROQ_API_KEY, "llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"),
            LLMProvider("OpenRouter Llama 3.3 70B", config.OPENROUTER_API_KEY, "meta-llama/llama-3.3-70b-instruct:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Nvidia Nemotron 3 Ultra", config.OPENROUTER_API_KEY, "nvidia/nemotron-3-ultra-550b-a55b:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Mistral 24B", config.OPENROUTER_API_KEY, "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter GPT-OSS 120B", config.OPENROUTER_API_KEY, "openai/gpt-oss-120b:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Nvidia Nemotron 3 Super", config.OPENROUTER_API_KEY, "nvidia/nemotron-3-super-120b-a12b:free", "https://openrouter.ai/api/v1"),
            LLMProvider("OpenRouter Gemini Flash", config.OPENROUTER_API_KEY, "google/gemini-2.5-flash", "https://openrouter.ai/api/v1")
        ]
        # Phi-4 on Foundry endpoint is free/included if endpoint is configured
        if config.AZURE_AI_SEARCH_ENDPOINT and config.AZURE_AI_SEARCH_KEY:
            self.final_providers.append(
                LLMProvider("Foundry Models", config.AZURE_AI_SEARCH_KEY, "phi-4", config.AZURE_AI_SEARCH_ENDPOINT)
            )

    def complete(self, messages: list, role: str = "final", stream=False) -> Any:
        if stream:
            return self._complete_stream_generator(messages, role)
        else:
            return self._complete_non_stream(messages, role)

    async def _complete_stream_generator(self, messages: list, role: str) -> AsyncGenerator[tuple, None]:
        providers = self.intermediate_providers if role == "intermediate" else self.final_providers
        errors = []
        for provider in providers:
            if provider.is_available():
                logger.info(f"LLMRouter selecting streaming provider for role '{role}': '{provider.name}'")
                try:
                    async for token in provider.complete_stream(messages):
                        yield token, provider.name
                    provider.record_success()
                    return
                except Exception as e:
                    logger.warning(f"Provider '{provider.name}' failed streaming invocation: {str(e)}")
                    errors.append(f"{provider.name}: {str(e)}")
                    continue
        raise RuntimeError(f"All LLM providers for role '{role}' rate limited or failed streaming. Errors: {'; '.join(errors)}")

    async def _complete_non_stream(self, messages: list, role: str) -> Any:
        providers = self.intermediate_providers if role == "intermediate" else self.final_providers
        errors = []
        for provider in providers:
            if provider.is_available():
                logger.info(f"LLMRouter selecting provider for role '{role}': '{provider.name}'")
                try:
                    response = await provider.complete_non_stream(messages)
                    provider.record_success()
                    response.active_provider = provider.name
                    return response
                except Exception as e:
                    logger.warning(f"Provider '{provider.name}' failed invocation: {str(e)}")
                    errors.append(f"{provider.name}: {str(e)}")
                    continue
        raise RuntimeError(f"All LLM providers for role '{role}' rate limited or failed. Errors: {'; '.join(errors)}")


class BaseAgent:
    def __init__(self):
        self.llm_router = LLMRouter()

from dataclasses import dataclass, field

@dataclass
class QueryState:
    original_query: str
    rewritten_queries: List[str] = field(default_factory=list)
    retrieved_chunks: List[Dict[str, Any]] = field(default_factory=list)
    reranked_chunks: List[Dict[str, Any]] = field(default_factory=list)
    compressed_context: str = ""
    answer: str = ""
    citations: List[Dict[str, Any]] = field(default_factory=list)
    guardrail_results: Optional[Any] = None
    explainability: Optional[Dict[str, Any]] = None
    active_provider: str = ""
    pipeline_path: str = ""

