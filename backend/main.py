"""
AI-PROOF — FastAPI Backend
══════════════════════════════════════════════════════
Multi-model AI content verification with blockchain proof-of-work.

Routes
──────
GET  /health               → liveness check
POST /analyze/text         → full NLP + fake-news pipeline
POST /analyze/url          → fetch article then analyze
POST /analyze/image        → GAN fingerprint + EXIF analysis
POST /blockchain/verify    → verify content hash on-chain
POST /version/compare      → semantic diff of two texts

Run
───
python main.py                 # development (reload)
uvicorn main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("aiproof")

# ── Service imports (graceful fallback if heavy ML deps absent) ───────────────

try:
    from services.ai_text import analyze_text
    from services.fake_news import detect_fake_news
    from services.ai_image import analyze_image
    from services.explainable_ai import explain_prediction
    from services.consensus import aggregate_consensus
    from services.blockchain_verify import verify_on_chain
    from services.version_compare import compare_versions
    _SERVICES_OK = True
    log.info("All service modules loaded ✓")
except ImportError as _e:
    _SERVICES_OK = False
    log.warning("Service import failed (%s) — running in stub mode", _e)

    # ── Stubs so the server still boots and /health returns OK ────────────────
    async def analyze_text(text):  # type: ignore[misc]
        return {"models": [{"modelId": "stub", "modelName": "Stub", "score": 50, "confidence": 0.5}]}

    async def detect_fake_news(text):  # type: ignore[misc]
        return {"models": []}

    async def analyze_image(b64):  # type: ignore[misc]
        return {"trustScore": 50, "verdict": _verdict(50), "models": []}

    async def explain_prediction(text, score, models):  # type: ignore[misc]
        return {"signals": [], "summary": "Service unavailable."}

    def aggregate_consensus(models):  # type: ignore[misc]
        return {"trust_score": 50, "agreement": 0, "weighted_scores": []}

    async def verify_on_chain(h, bid):  # type: ignore[misc]
        return {"verified": False, "error": "Service unavailable"}

    def compare_versions(a, b):  # type: ignore[misc]
        return {"similarity": 0, "diff": []}


# ── Startup / shutdown ────────────────────────────────────────────────────────

_startup_time: float = 0.0

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_time
    _startup_time = time.time()
    log.info("AI-PROOF backend starting — services_ok=%s", _SERVICES_OK)
    yield
    log.info("AI-PROOF backend shutting down")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AI-PROOF API",
    description="Multi-model AI content verification with blockchain proof",
    version="2.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# Allow all origins in development; restrict via CORS_ORIGINS env var in prod.

_raw_origins = os.getenv("CORS_ORIGINS", "*")
_origins: list[str] | str = (
    [o.strip() for o in _raw_origins.split(",")]
    if "," in _raw_origins else _raw_origins
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins if isinstance(_origins, list) else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    max_age=600,
)

# ── Global error handler ──────────────────────────────────────────────────────

@app.exception_handler(Exception)
async def _global_exc(request: Request, exc: Exception):
    log.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "type": type(exc).__name__},
    )


# ── Request / response schemas ────────────────────────────────────────────────

class AnalyzeTextRequest(BaseModel):
    content: str
    options: Optional[dict[str, Any]] = {}

    @field_validator("content")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or len(v.strip()) < 10:
            raise ValueError("content must be at least 10 characters")
        return v.strip()


class AnalyzeURLRequest(BaseModel):
    url: str
    options: Optional[dict[str, Any]] = {}

    @field_validator("url")
    @classmethod
    def _valid_url(cls, v: str) -> str:
        if not v.startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        return v.strip()


class AnalyzeImageRequest(BaseModel):
    image: str          # base64-encoded, with or without data-URI prefix
    options: Optional[dict[str, Any]] = {}


class BlockchainVerifyRequest(BaseModel):
    content_hash: str
    block_id: Optional[int] = None


class VersionCompareRequest(BaseModel):
    version_a: str
    version_b: str


class DetectTextRequest(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or len(v.strip()) < 10:
            raise ValueError("content must be at least 10 characters")
        return v.strip()


class DetectFakeNewsRequest(BaseModel):
    """
    Accepts either `content` (plain text) or `url` (article URL), not both.
    If both are provided, `url` takes priority.
    """
    content: Optional[str] = None
    url:     Optional[str] = None

    @field_validator("url")
    @classmethod
    def _valid_url(cls, v: str | None) -> str | None:
        if v and not v.startswith(("http://", "https://")):
            raise ValueError("url must start with http:// or https://")
        return v

    def resolved_content(self) -> str | None:
        """Return whichever field has data (url wins)."""
        return self.url or self.content


class DetectImageRequest(BaseModel):
    """Base64-encoded image (JPEG / PNG / WEBP). data-URI prefix is stripped automatically."""
    image: str

    @field_validator("image")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v or len(v.strip()) < 20:
            raise ValueError("image must be a non-empty base64 string")
        return v.strip()


# ── Routes ────────────────────────────────────────────────────────────────────

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["meta"])
async def health():
    """
    Liveness probe.  Returns 200 + JSON when the server is up.
    Done-when: {"status": "ok"} in response body.
    """
    return {
        "status":       "ok",
        "version":      app.version,
        "services":     _SERVICES_OK,
        "uptime_s":     round(time.time() - _startup_time, 1) if _startup_time else 0,
        "timestamp":    time.time(),
    }


# ── Text analysis ─────────────────────────────────────────────────────────────

@app.post("/analyze/text", tags=["analyze"])
async def analyze_text_route(req: AnalyzeTextRequest):
    """
    Full text pipeline: AI detection + fake-news scoring → consensus → explainability.
    """
    t0 = time.time()

    # Run AI-text and fake-news models concurrently
    text_result, fake_result = await asyncio.gather(
        analyze_text(req.content),
        detect_fake_news(req.content),
    )

    models   = [*text_result.get("models", []), *fake_result.get("models", [])]
    consensus = aggregate_consensus(models)

    explanation = await explain_prediction(
        req.content,
        consensus["trust_score"],
        models,
    )

    return {
        "trustScore":   consensus["trust_score"],
        "verdict":      _verdict(consensus["trust_score"]),
        "models":       consensus.get("weighted_scores", models),
        "signals":      explanation.get("signals", []),
        "explanation":  explanation.get("summary", ""),
        "agreement":    consensus.get("agreement", 0),
        "processingMs": _ms(t0),
        "source":       "server",
    }


# ── Dedicated single-model text detection ────────────────────────────────────

@app.post("/detect-text", tags=["analyze"])
async def detect_text_route(req: DetectTextRequest):
    """
    Single-model AI text detection via roberta-base-openai-detector.

    Lighter than /analyze/text — no fake-news models, no consensus
    aggregation, no explainability pass.  Use this when you only need
    the raw RoBERTa verdict quickly.

    Response
    ────────
    {
      "ai_percent":    float,   // 0–100  probability of AI authorship
      "human_percent": float,   // 0–100  probability of human authorship
      "confidence":    float,   // 0–1    model confidence
      "verdict":       object,  // label + color
      "processingMs":  int,
      "source":        str      // "model" | "heuristic" | "heuristic-fallback"
    }
    """
    t0 = time.time()
    result = await analyze_text(req.content)
    model  = result["models"][0] if result.get("models") else {}

    ai_pct    = model.get("ai_percent",    50.0)
    human_pct = model.get("human_percent", 50.0)
    confidence = model.get("confidence",   0.5)
    trust_score = round(human_pct)

    return {
        "ai_percent":    ai_pct,
        "human_percent": human_pct,
        "confidence":    confidence,
        "verdict":       _verdict(trust_score),
        "model":         model.get("modelId", "roberta-base-openai-detector"),
        "processingMs":  _ms(t0),
        "source":        model.get("source", "unknown"),
    }


# ── Fake-news detection ───────────────────────────────────────────────────────

@app.post("/detect-fake-news", tags=["analyze"])
async def detect_fake_news_route(req: DetectFakeNewsRequest):
    """
    Fake-news / misinformation classification via facebook/bart-large-mnli
    zero-shot NLI.

    Accepts **text** or a **URL** — URL takes priority.
    When a URL is supplied the article is fetched and HTML-stripped
    server-side (no CORS issues for the frontend).

    Response
    ────────
    {
      "fake_percent":  float,     // 0–100  misinformation probability
      "real_percent":  float,     // 0–100  credibility probability
      "confidence":    float,     // 0–1    decisiveness of verdict
      "verdict":       object,    // label + color  (trust-score scale)
      "signals":       list,      // keyword-level evidence
      "url":           str|null,  // echoed back if URL was supplied
      "processingMs":  int,
      "source":        str        // "model" | "heuristic" | "heuristic-fallback"
    }
    """
    t0 = time.time()

    # ── Resolve input ─────────────────────────────────────────────────────────
    if req.url:
        try:
            from services.fake_news import fetch_url
            text = await fetch_url(req.url)
        except Exception as exc:
            raise HTTPException(422, detail=str(exc))
        if not text or len(text.strip()) < 10:
            raise HTTPException(422, detail="Could not extract readable text from URL")
    elif req.content and len(req.content.strip()) >= 10:
        text = req.content.strip()
    else:
        raise HTTPException(
            400,
            detail="Provide either 'content' (min 10 chars) or a valid 'url'.",
        )

    # ── Run detection ─────────────────────────────────────────────────────────
    result = await detect_fake_news(text)
    model  = result["models"][0] if result.get("models") else {}

    fake_pct    = model.get("fake_percent", 50.0)
    real_pct    = model.get("real_percent", 50.0)
    confidence  = model.get("confidence",  0.5)
    signals     = model.get("signals",     [])
    trust_score = round(real_pct)

    return {
        "fake_percent": fake_pct,
        "real_percent": real_pct,
        "confidence":   confidence,
        "verdict":      _verdict(trust_score),
        "signals":      signals,
        "model":        model.get("modelId", "facebook/bart-large-mnli"),
        "url":          req.url,
        "processingMs": _ms(t0),
        "source":       model.get("source", "unknown"),
    }


# ── URL analysis ──────────────────────────────────────────────────────────────

@app.post("/analyze/url", tags=["analyze"])
async def analyze_url_route(req: AnalyzeURLRequest):
    """
    Fetch an article URL, strip HTML, then run the full text pipeline.
    """
    try:
        import httpx
        async with httpx.AsyncClient(
            timeout=20,
            follow_redirects=True,
            headers={"User-Agent": "AI-PROOF/2.1 content-verifier"},
        ) as client:
            resp = await client.get(req.url)
            resp.raise_for_status()
    except ImportError:
        raise HTTPException(503, detail="httpx not installed — URL analysis unavailable")
    except Exception as exc:
        raise HTTPException(422, detail=f"Could not fetch URL: {exc}")

    # Strip HTML → plain text
    text = re.sub(r"<[^>]+>", " ", resp.text)
    text = re.sub(r"\s+", " ", text).strip()

    # Trim to 8 000 chars to stay within model token limits
    if len(text) > 8_000:
        text = text[:8_000]

    if len(text.strip()) < 10:
        raise HTTPException(422, detail="Article text could not be extracted from URL")

    sub_req = AnalyzeTextRequest(content=text, options=req.options)
    return await analyze_text_route(sub_req)


# ── Image analysis ────────────────────────────────────────────────────────────

@app.post("/analyze/image", tags=["analyze"])
async def analyze_image_route(req: AnalyzeImageRequest):
    """
    GAN fingerprinting + EXIF analysis on a base64 image.
    Strips the data-URI prefix before forwarding to the service.
    """
    t0 = time.time()

    # Strip optional data-URI prefix
    image_b64 = req.image
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    result = await analyze_image(image_b64)

    return {
        **result,
        "processingMs": _ms(t0),
        "source":       "server",
    }


# ── Dedicated AI image detection ──────────────────────────────────────────────

@app.post("/detect-ai-image", tags=["analyze"])
async def detect_ai_image_route(req: DetectImageRequest):
    """
    Single-endpoint AI image detection via CLIP ViT-B/32 zero-shot +
    pixel forensics (DCT, noise uniformity, colour correlation) + EXIF.

    Lighter than /analyze/image — no consensus aggregation.

    Response
    ────────
    {
      "ai_percent":    float,    // 0–100  probability AI-generated
      "real_percent":  float,    // 0–100  probability authentic
      "confidence":    float,    // 0–1
      "verdict":       object,   // label + color
      "signals":       list,     // evidence signals
      "metadata":      object,   // EXIF fields
      "processingMs":  int,
      "source":        str       // "model" | "heuristic" | "heuristic-fallback"
    }
    """
    t0 = time.time()

    image_b64 = req.image
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    result = await analyze_image(image_b64)

    return {
        "ai_percent":   result.get("ai_percent",   50.0),
        "real_percent": result.get("real_percent",  50.0),
        "confidence":   result.get("confidence",    0.5),
        "verdict":      result.get("verdict",       {}),
        "signals":      result.get("signals",       []),
        "metadata":     result.get("metadata",      {}),
        "model":        "openai/clip-vit-base-patch32",
        "processingMs": _ms(t0),
        "source":       result.get("source", "unknown"),
    }


# ── Blockchain verify ─────────────────────────────────────────────────────────

@app.post("/blockchain/verify", tags=["blockchain"])
async def blockchain_verify_route(req: BlockchainVerifyRequest):
    """
    Verify a content hash exists in the blockchain.
    """
    if not req.content_hash or len(req.content_hash) < 16:
        raise HTTPException(400, detail="content_hash must be at least 16 characters")
    return await verify_on_chain(req.content_hash, req.block_id)


# ── Version compare ───────────────────────────────────────────────────────────

@app.post("/version/compare", tags=["utils"])
async def version_compare_route(req: VersionCompareRequest):
    """
    Semantic diff of two text versions.
    """
    if not req.version_a or not req.version_b:
        raise HTTPException(400, detail="Both version_a and version_b are required")
    return compare_versions(req.version_a, req.version_b)


# ── Helpers ───────────────────────────────────────────────────────────────────

VERDICT_THRESHOLDS = [
    (85, "AUTHENTIC",    "badge-green",  "#00ff9d"),
    (70, "LIKELY REAL",  "badge-green",  "#7aff6e"),
    (50, "UNCERTAIN",    "badge-yellow", "#ffb300"),
    (30, "SUSPICIOUS",   "badge-yellow", "#ff7a00"),
    ( 0, "AI-GENERATED", "badge-red",    "#ff3d5a"),
]


def _verdict(score: int) -> dict:
    for threshold, label, badge_class, color in VERDICT_THRESHOLDS:
        if score >= threshold:
            return {"label": label, "class": badge_class, "color": color}
    return {"label": "UNKNOWN", "class": "badge-cyan", "color": "#00e5ff"}


def _ms(t0: float) -> int:
    return round((time.time() - t0) * 1000)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    reload = os.getenv("ENV", "development") == "development"

    log.info("Starting AI-PROOF on %s:%d  reload=%s", host, port, reload)

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
        access_log=True,
    )