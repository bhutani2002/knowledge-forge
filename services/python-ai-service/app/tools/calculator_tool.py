import ast
import operator
from app.tools.base_tool import BaseTool, ToolResult

class CalculatorTool(BaseTool):
    @property
    def name(self) -> str:
        return "calculator"

    @property
    def description(self) -> str:
        return "Safely evaluate simple mathematical and arithmetic expressions (e.g., '142 * 1.15' or '45000 / 12')."

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "The arithmetic expression to evaluate (e.g. '120 * 15'). Only +, -, *, /, %, ** and numbers are allowed."
                }
            },
            "required": ["expression"]
        }

    async def execute(self, **kwargs) -> ToolResult:
        expression = kwargs.get("expression")
        if not expression:
            return ToolResult("Error: expression parameter is required.", is_error=True)
            
        try:
            val = self._evaluate(expression)
            return ToolResult(str(val))
        except Exception as e:
            return ToolResult(f"Error evaluating math: {str(e)}", is_error=True)

    def _evaluate(self, expression: str):
        operators = {
            ast.Add: operator.add,
            ast.Sub: operator.sub,
            ast.Mult: operator.mul,
            ast.Div: operator.truediv,
            ast.Mod: operator.mod,
            ast.Pow: operator.pow,
            ast.USub: operator.neg,
            ast.UAdd: operator.pos
        }
        
        node = ast.parse(expression.strip(), mode='eval')
        
        def _eval(n):
            if isinstance(n, ast.Num):
                return n.n
            elif isinstance(n, ast.Constant):
                if isinstance(n.value, (int, float)):
                    return n.value
                raise TypeError("Only numeric constants allowed")
            elif isinstance(n, ast.BinOp):
                left = _eval(n.left)
                right = _eval(n.right)
                op_type = type(n.op)
                if op_type in operators:
                    # Guard division by zero
                    if op_type == ast.Div and right == 0:
                        raise ZeroDivisionError("Division by zero")
                    return operators[op_type](left, right)
                raise TypeError(f"Operator {op_type.__name__} not supported")
            elif isinstance(n, ast.UnaryOp):
                operand = _eval(n.operand)
                op_type = type(n.op)
                if op_type in operators:
                    return operators[op_type](operand)
                raise TypeError(f"Unary operator {op_type.__name__} not supported")
            else:
                raise TypeError(f"Node type {type(n).__name__} is not allowed")

        return _eval(node.body)
