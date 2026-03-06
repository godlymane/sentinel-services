"""
Sentinel Agent Services — LangChain Tool Definitions

Drop-in tools for LangChain/CrewAI agents to use persistent memory,
send emails, and generate PDFs via x402 micropayments.

Usage:
    from sentinel_tools import SentinelMemoryWrite, SentinelMemoryRead, SentinelSendEmail, SentinelGeneratePDF

    tools = [SentinelMemoryWrite(), SentinelMemoryRead(), SentinelSendEmail(), SentinelGeneratePDF()]
    agent = Agent(tools=tools, ...)

Environment:
    SENTINEL_URL=https://your-sentinel.conway.tech
    SENTINEL_WALLET=0xYourAgentWallet
"""

import os
import json
import requests
from typing import Optional
from langchain.tools import BaseTool
from pydantic import Field

SENTINEL_URL = os.getenv("SENTINEL_URL", "http://localhost:3000")
SENTINEL_WALLET = os.getenv("SENTINEL_WALLET", "")

HEADERS = {
    "Content-Type": "application/json",
    "X-Wallet": SENTINEL_WALLET,
}


def _call_sentinel(method: str, path: str, body: dict = None) -> dict:
    url = f"{SENTINEL_URL}{path}"
    resp = requests.request(method, url, json=body, headers=HEADERS, timeout=30)
    return resp.json()


# ============ MEMORY TOOLS ============


class SentinelMemoryWrite(BaseTool):
    name: str = "sentinel_memory_write"
    description: str = (
        "Store a key-value pair in persistent agent memory. "
        "First 100 writes per wallet are FREE, then 1 credit per write. "
        "Use namespace to organize keys (e.g. your agent name). "
        "Input: JSON with namespace, key, value, optional ttl_seconds."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            # Simple format: "namespace/key=value"
            if "=" in input_str and "/" in input_str:
                parts = input_str.split("=", 1)
                ns_key = parts[0].split("/")
                args = {"namespace": ns_key[0], "key": ns_key[1], "value": parts[1]}
            else:
                return "Error: provide JSON with namespace, key, value"

        ns = args.get("namespace", "default")
        key = args.get("key")
        value = args.get("value", "")
        if not key:
            return "Error: missing key"

        body = {"value": value}
        if args.get("ttl_seconds"):
            body["options"] = {"ttlSeconds": args["ttl_seconds"]}

        result = _call_sentinel("PUT", f"/memory/{ns}/{key}", body)
        return json.dumps(result)


class SentinelMemoryRead(BaseTool):
    name: str = "sentinel_memory_read"
    description: str = (
        "Read a value from persistent agent memory. Costs 1 credit. "
        "Input: JSON with namespace and key."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            if "/" in input_str:
                parts = input_str.split("/", 1)
                args = {"namespace": parts[0], "key": parts[1]}
            else:
                return "Error: provide JSON with namespace, key"

        ns = args.get("namespace", "default")
        key = args.get("key")
        if not key:
            return "Error: missing key"

        result = _call_sentinel("GET", f"/memory/{ns}/{key}")
        return json.dumps(result)


class SentinelMemorySearch(BaseTool):
    name: str = "sentinel_memory_search"
    description: str = (
        "Search keys and values in agent memory by text query. Costs 5 credits. "
        "Input: JSON with namespace and query."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            return "Error: provide JSON with namespace, query"

        ns = args.get("namespace", "default")
        q = args.get("query", input_str)
        result = _call_sentinel("GET", f"/memory/search?namespace={ns}&q={q}")
        return json.dumps(result)


class SentinelMemoryList(BaseTool):
    name: str = "sentinel_memory_list"
    description: str = (
        "List all keys in a memory namespace. Costs 1 credit. "
        "Input: namespace name as string, or JSON with namespace and optional limit."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
            ns = args.get("namespace", "default")
            limit = args.get("limit", 100)
        except (json.JSONDecodeError, AttributeError):
            ns = input_str.strip()
            limit = 100

        result = _call_sentinel("GET", f"/memory/{ns}?limit={limit}")
        return json.dumps(result)


# ============ EMAIL TOOLS ============


class SentinelSendEmail(BaseTool):
    name: str = "sentinel_send_email"
    description: str = (
        "Send an email via Sentinel relay. Costs 10 credits ($0.01). "
        "Input: JSON with to, subject, body. Optional: html, reply_to. Max 5 recipients."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            return "Error: provide JSON with to, subject, body"

        result = _call_sentinel("POST", "/email/send", {
            "to": args.get("to"),
            "subject": args.get("subject"),
            "body": args.get("body"),
            "html": args.get("html"),
            "replyTo": args.get("reply_to"),
        })
        return json.dumps(result)


class SentinelSendWebhook(BaseTool):
    name: str = "sentinel_send_webhook"
    description: str = (
        "Send a webhook notification to any URL. Costs 5 credits ($0.005). "
        "Input: JSON with url and optional payload."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            return "Error: provide JSON with url"

        result = _call_sentinel("POST", "/email/webhook", {
            "url": args.get("url"),
            "payload": args.get("payload"),
            "method": args.get("method", "POST"),
        })
        return json.dumps(result)


# ============ PDF TOOLS ============


class SentinelGeneratePDF(BaseTool):
    name: str = "sentinel_generate_pdf"
    description: str = (
        "Generate a PDF document. Costs 20 credits ($0.02). "
        "Formats: text (markdown), structured (JSON sections), invoice, report. "
        "Input: JSON with content, optional format and title. "
        "Returns base64-encoded PDF."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            args = {"content": input_str, "format": "text"}

        result = _call_sentinel("POST", "/pdf/generate/json", {
            "content": args.get("content", input_str),
            "format": args.get("format", "text"),
            "title": args.get("title"),
        })
        return json.dumps(result)


# ============ VECTOR TOOLS ============


class SentinelVectorUpsert(BaseTool):
    name: str = "sentinel_vector_upsert"
    description: str = (
        "Store a vector embedding in persistent storage. Costs 10 credits. "
        "Use for semantic memory, RAG, and similarity search. "
        "Input: JSON with namespace, id, vector (array of floats), optional metadata."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            return "Error: provide JSON with namespace, id, vector"

        ns = args.get("namespace", "default")
        result = _call_sentinel("POST", f"/vectors/{ns}/upsert", {
            "id": args.get("id"),
            "vector": args.get("vector"),
            "metadata": args.get("metadata", {}),
        })
        return json.dumps(result)


class SentinelVectorQuery(BaseTool):
    name: str = "sentinel_vector_query"
    description: str = (
        "Search for similar vectors by cosine similarity. Costs 5 credits. "
        "Returns top-K most similar vectors with scores. "
        "Input: JSON with namespace, vector (query embedding), optional topK and filter."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            return "Error: provide JSON with namespace, vector"

        ns = args.get("namespace", "default")
        result = _call_sentinel("POST", f"/vectors/{ns}/query", {
            "vector": args.get("vector"),
            "topK": args.get("topK", 5),
            "filter": args.get("filter"),
        })
        return json.dumps(result)


class SentinelVectorBatch(BaseTool):
    name: str = "sentinel_vector_batch"
    description: str = (
        "Batch upsert up to 100 vectors at once. Costs 8 credits per vector (20% off). "
        "Input: JSON with namespace and vectors array [{id, vector, metadata}]."
    )

    def _run(self, input_str: str) -> str:
        try:
            args = json.loads(input_str) if isinstance(input_str, str) else input_str
        except json.JSONDecodeError:
            return "Error: provide JSON with namespace, vectors"

        ns = args.get("namespace", "default")
        result = _call_sentinel("POST", f"/vectors/{ns}/batch", {
            "vectors": args.get("vectors", []),
        })
        return json.dumps(result)


# ============ CREDITS ============


class SentinelBuyCredits(BaseTool):
    name: str = "sentinel_buy_credits"
    description: str = (
        "Buy credits for Sentinel services. Requires x402 USDC payment. "
        "Packs: pack_100 ($0.10), pack_500 ($0.45), pack_2000 ($1.60), pack_10000 ($7.00). "
        "Input: pack name as string."
    )

    def _run(self, input_str: str) -> str:
        pack = input_str.strip().strip('"')
        if not pack.startswith("pack_"):
            pack = f"pack_{pack}"
        result = _call_sentinel("POST", "/credits/buy", {"pack": pack})
        return json.dumps(result)


class SentinelCreditBalance(BaseTool):
    name: str = "sentinel_credit_balance"
    description: str = "Check your current Sentinel credit balance. No input needed."

    def _run(self, input_str: str = "") -> str:
        result = _call_sentinel("GET", "/credits/balance")
        return json.dumps(result)


# ============ CONVENIENCE: GET ALL TOOLS ============


def get_sentinel_tools():
    """Return all Sentinel tools for use with LangChain/CrewAI agents."""
    return [
        SentinelMemoryWrite(),
        SentinelMemoryRead(),
        SentinelMemorySearch(),
        SentinelMemoryList(),
        SentinelVectorUpsert(),
        SentinelVectorQuery(),
        SentinelVectorBatch(),
        SentinelSendEmail(),
        SentinelSendWebhook(),
        SentinelGeneratePDF(),
        SentinelBuyCredits(),
        SentinelCreditBalance(),
    ]
