## ProofAI Full Stack Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Browser)                       │
│  index.html | analyze.html | fakenews.html | url.html | lab.html│
└────────────────────────┬────────────────────────────────────────┘
                         │
                    config.js (Config URLs)
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ↓ (Local Dev)                     ↓ (Production)
   localhost:8000                  https://gateway-g5cc.onrender.com
   localhost:8001-8004            + 4 dedicated microservices
        │                                 │
        │                                 │
        ↓                                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                    GATEWAY (Router/Orchestrator)                 │
│  • Port 8000 (local) / Render URL (prod)                         │
│  • Routes all /analyze/* and /detect-* endpoints                 │
│  • Health checks & load balancing                                │
│  • CORS enabled for frontend                                     │
└────────────────┬────────────────────────┬───────┬────────────────┘
                 │                        │       │
        ┌────────┴────────┐      ┌────────┴──┐  ┌─┴─────────────┐
        │                 │      │           │  │               │
        ↓                 ↓      ↓           ↓  ↓               ↓
    ┌────────────┐  ┌──────────────────┐  ┌──────────┐  ┌─────────────┐
    │TEXT SERVICE│  │FAKE NEWS SERVICE │  │  IMAGE   │  │  UTILITY    │
    │            │  │                  │  │ SERVICE  │  │  SERVICE    │
    │ Port 8001  │  │   Port 8002      │  │ Port 8003│  │ Port 8004   │
    │            │  │                  │  │          │  │             │
    │ RoBERTa    │  │ BART-large-MNLI  │  │ CLIP VIT │  │ Blockchain  │
    │ Detector   │  │ Classification   │  │ ViT-B/32 │  │ Hashing     │
    │            │  │ + URL fetching   │  │ + EXIF   │  │ Versioning  │
    └────────────┘  └──────────────────┘  └──────────┘  └─────────────┘
         │                   │                  │               │
         └─────────────────────────┬────────────┴───────────────┘
                                   │
                         ┌─────────┴─────────┐
                         │                   │
                      Models             Results &
                    Cache (ONNX)         Blockchain
```

## Request Flow Example

### Analyzing Text with Full Pipeline
```
1. User enters text in analyze.html
                      ↓
2. Calls: startAnalysis()
                      ↓
3. ai.js → AI.analyzeText(text)
                      ↓
4. ai-server.js → AIServer.analyzeText(text)
                      ↓
5. Fetch POST /analyze/text to CONFIG.API_BASE_URL
                      ↓
6. [PROD] → https://gateway-g5cc.onrender.com/analyze/text
   [LOCAL] → http://localhost:8000/analyze/text
                      ↓
7. Gateway routes → Text Service (/analyze/text)
                      ↓
8. Text Service processes:
   - Tokenization
   - Runs RoBERTa model
   - Calculates confidence
   - Returns: {ai_percent, human_percent, confidence, ...}
                      ↓
9. Response back through Gateway → Frontend
                      ↓
10. Display results in analyze-page.js
```

### Detecting Fake News
```
User enters article → fakenews-page.js
                      ↓
AIServer.detectFakeNews(text)
                      ↓
POST /detect-fake-news
                      ↓
Gateway routes → Fake News Service
                      ↓
Fake News Service:
  • Extracts claims
  • Runs BART zero-shot classification
  • Checks source credibility
  • Returns: {fake_percent, real_percent, ...}
                      ↓
Display risk level & recommendations
```

### Checking URL Safety
```
User enters URL → url-page.js
                      ↓
AIServer.analyzeURL(url)
                      ↓
POST /analyze/url
                      ↓
Gateway routes → Fake News Service
                      ↓
Fake News Service:
  • Fetches URL content
  • Analyzes page content
  • Checks domain reputation
  • Returns: threat analysis & recommendations
                      ↓
Display danger meter & security checklist
```

## Environment Detection

The frontend **automatically detects** the environment:

```javascript
// config.js
const IS_LOCAL = hostname matches ['localhost', '127.0.0.1', '']

// Auto-select URLs:
if (IS_LOCAL) {
  uses: localhost:8000-8004
} else {
  uses: https://gateway-g5cc.onrender.com
       https://text-service-glgj.onrender.com
       https://fakenews-service.onrender.com
       https://image-lchq.onrender.com
       https://utility-service-m2n3.onrender.com
}
```

## Testing Checklist

- [ ] Start backend services locally (or verify Render deployments)
- [ ] Open browser DevTools → Network tab
- [ ] Test each endpoint:
  - [ ] GET /health → Should see 200 OK
  - [ ] POST /analyze/text → Submit text, check response
  - [ ] POST /detect-fake-news → Submit article
  - [ ] POST /analyze/url → Submit website URL
  - [ ] POST /analyze/image → Upload image
- [ ] Check API response times in Network tab
- [ ] Verify no CORS errors in Console

## Debugging Commands

```bash
# Test gateway health
curl http://localhost:8000/health

# Test text service
curl -X POST http://localhost:8001/detect-text \
  -H "Content-Type: application/json" \
  -d '{"content": "Sample text"}'

# Test fake news service
curl -X POST http://localhost:8002/detect-fake-news \
  -H "Content-Type: application/json" \
  -d '{"content": "Breaking news story..."}'

# Check all services status
for port in 8000 8001 8002 8003 8004; do
  echo "Port $port:"
  curl http://localhost:$port/health 2>/dev/null || echo "Not running"
done
```

---
**Updated**: 2026-03-18
**Architecture**: Microservices (5 services)
**Status**: Production Ready
