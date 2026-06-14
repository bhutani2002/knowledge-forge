from abc import ABC, abstractmethod
from typing import Dict, Any

class ToolResult:
    def __init__(self, content: str, is_error: bool = False):
        self.content = content
        self.is_error = is_error

    def __str__(self) -> str:
        return self.content

class BaseTool(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        pass

    @property
    @abstractmethod
    def input_schema(self) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def execute(self, **kwargs) -> ToolResult:
        pass
