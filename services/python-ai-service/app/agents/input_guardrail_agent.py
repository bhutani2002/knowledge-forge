import re
import logging
from typing import Tuple
from app import models
from app.agents.base_agent import BaseAgent, QueryState

logger = logging.getLogger("input-guardrail-agent")

class GuardrailResult:
    def __init__(self, passed: bool, error_message: str = "", violation_type: str = ""):
        self.passed = passed
        self.error_message = error_message
        self.violation_type = violation_type

class LengthGuard:
    def check(self, query: str) -> GuardrailResult:
        if len(query) > 2000:
            return GuardrailResult(False, "Query exceeds maximum length of 2000 characters.", "LENGTH_VIOLATION")
        return GuardrailResult(True)

class InjectionGuard:
    def __init__(self):
        self.jailbreak_patterns = [
            r"(?i)\bignore\s+previous\s+instructions\b",
            r"(?i)\bsystem\s+prompt\b",
            r"(?i)\byou\s+are\s+now\s+a\b",
            r"(?i)\bdo\s+anything\s+now\b",
            r"(?i)\bDAN\b",
            r"(?i)\bdeveloper\s+mode\b",
            r"(?i)SELECT\s+.*\s+FROM",
            r"(?i)DROP\s+TABLE",
            r"(?i)UNION\s+SELECT"
        ]
        
    def check(self, query: str) -> GuardrailResult:
        for pattern in self.jailbreak_patterns:
            if re.search(pattern, query):
                return GuardrailResult(False, "Jailbreak or injection pattern detected in input.", "INJECTION_VIOLATION")
        return GuardrailResult(True)

class PiiGuard:
    def __init__(self):
        self.patterns = {
            "SSN": r"\b\d{3}-\d{2}-\d{4}\b",
            "CREDIT_CARD": r"\b(?:\d[ -]*?){13,16}\b",
            "PHONE": r"\b(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b"
        }
        
    def check(self, query: str) -> GuardrailResult:
        sanitized_query = query
        for pii_type, pattern in self.patterns.items():
            sanitized_query = re.sub(pattern, f"[REDACTED_{pii_type}]", sanitized_query)
        return GuardrailResult(True, sanitized_query)

class ToxicityGuard:
    def check(self, query: str) -> GuardrailResult:
        try:
            classifier = models.get_toxicity_model()
            res = classifier(query)
            if res and isinstance(res, list):
                label_info = res[0]
                label = label_info.get("label", "").lower()
                score = label_info.get("score", 0.0)
                if label == "toxic" and score >= 0.5:
                    return GuardrailResult(False, f"Toxic language detected (confidence: {score:.2f}).", "TOXICITY_VIOLATION")
            return GuardrailResult(True)
        except Exception as e:
            logger.error(f"Toxicity classifier failed: {str(e)}. Falling back to check list.")
            profanities = [r"(?i)\bswearword1\b", r"(?i)\bswearword2\b", r"(?i)\bhate\s+speech\b"]
            for word in profanities:
                if re.search(word, query):
                    return GuardrailResult(False, "Toxic language detected.", "TOXICITY_VIOLATION")
            return GuardrailResult(True)

class InputGuardrailAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.guards = [LengthGuard(), InjectionGuard(), PiiGuard(), ToxicityGuard()]

    async def run(self, state: QueryState) -> QueryState:
        current_query = state.original_query
        for guard in self.guards:
            res = guard.check(current_query)
            if not res.passed:
                state.guardrail_results = {
                    "passed": False,
                    "error_message": res.error_message,
                    "violation_type": res.violation_type
                }
                return state
            if res.error_message: # PiiGuard returns redacted query here
                current_query = res.error_message
                
        state.guardrail_results = {
            "passed": True,
            "sanitized_query": current_query
        }
        return state
