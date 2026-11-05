"""Exception hierarchy for the lilambd client."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


class LilambdError(Exception):
    """Base error for every failure raised by the SDK."""

    def __init__(
        self,
        message: str,
        status: Optional[int] = None,
        body: Any = None,
        url: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.body = body
        self.url = url


class BadRequest(LilambdError):
    """HTTP 400 / 422: invalid parameters."""


class NotFound(LilambdError):
    """HTTP 404: unknown route or record."""


class PaymentRequired(LilambdError):
    """HTTP 402: the call needs an x402 payment.

    ``requirements`` is the decoded ``PAYMENT-REQUIRED`` challenge (or the JSON
    body when the header is absent).  ``accepts`` is the list of acceptable
    payment options; the convenience properties read from the first one.
    """

    def __init__(
        self,
        message: str,
        requirements: Optional[Dict[str, Any]] = None,
        status: int = 402,
        body: Any = None,
        url: Optional[str] = None,
    ) -> None:
        super().__init__(message, status=status, body=body, url=url)
        self.requirements: Dict[str, Any] = requirements or {}

    @property
    def accepts(self) -> List[Dict[str, Any]]:
        acc = self.requirements.get("accepts")
        if isinstance(acc, list):
            return [a for a in acc if isinstance(a, dict)]
        if self.requirements and "amount" in self.requirements:
            return [self.requirements]
        return []

    @property
    def option(self) -> Dict[str, Any]:
        acc = self.accepts
        return acc[0] if acc else {}

    @property
    def amount(self) -> Optional[str]:
        opt = self.option
        val = opt.get("amount", opt.get("maxAmountRequired"))
        return None if val is None else str(val)

    @property
    def pay_to(self) -> Optional[str]:
        return self.option.get("payTo")

    payTo = pay_to

    @property
    def asset(self) -> Optional[str]:
        return self.option.get("asset")

    @property
    def network(self) -> Optional[str]:
        return self.option.get("network")

    @property
    def resource(self) -> Any:
        res = self.requirements.get("resource")
        if res is None:
            res = self.option.get("resource")
        if isinstance(res, dict):
            return res.get("url", res)
        return res

    @property
    def x402_version(self) -> Optional[int]:
        return self.requirements.get("x402Version")

    @property
    def price_usd(self) -> Optional[float]:
        """Price in US dollars (USDC has 6 decimals)."""
        amt = self.amount
        if amt is None:
            return None
        try:
            return int(amt) / 1_000_000
        except ValueError:
            return None

    def __str__(self) -> str:
        price = self.price_usd
        extra = f" (${price:.6f} USDC on {self.network})" if price is not None else ""
        return f"{self.message}{extra}"
