# Logic Conflicts Resolution Report

## Issues Found & Fixed

### 1. ✅ **ai-gemini.js v5.0 - Wrong Response Field**

**Problem:**
```javascript
// OLD - WRONG:
const result = await AIServer.detectFakeNews(prompt);
return result?.overallAssessment || result?.summary || null;  // ❌ These fields don't exist
```

**What AIServer.detectFakeNews() actually returns:**
```javascript
{
  trustScore,
  aiPct, humanPct, fakePct, realPct,
  confidence,
  verdict,
  models: [{...}],
  signals: [...],
  explanation: "...",  // ✅ THIS IS THE CORRECT FIELD
  processingMs,
  source: 'server',
  endpoint: '...'
}
```

**Fixed:**
```javascript
// NEW - CORRECT:
return result?.explanation || result?.reasoning || null;  // ✅ Uses correct fields
```

---

### 2. ✅ **ai-gemini.js - Missing Fallback Chain**

**Problem:**
- `callAI()` only tried `AIServer.detectFakeNews()` 
- If microservices fail, it returned null immediately
- Lost fallback to `AIBackendConfig.callAI()` (Gemini/Groq/OpenRouter)

**Fixed:**
```javascript
async function callAI(prompt, maxTokens = 1000) {
  // Fallback chain:
  // 1. Try AIBackendConfig (best for arbitrary prompts)
  // 2. Try AIServer (microservices - limited to fake news)
  // 3. Return null

  if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.callAI === 'function') {
    const result = await window.AIBackendConfig.callAI(prompt, maxTokens).catch(() => null);
    if (result) return result;  // ✅ SUCCESS
  }

  if (typeof window.AIServer !== 'undefined' && typeof window.AIServer.detectFakeNews === 'function') {
    const result = await window.AIServer.detectFakeNews(prompt).catch(() => null);
    return result?.explanation || result?.reasoning || null;
  }

  console.warn('[AIBackend] No AI providers available');
  return null;
}
```

---

### 3. ✅ **ai-gemini.js - callAIJSON() Not Using AIBackendConfig**

**Problem:**
- `callAIJSON()` called `callAI()` then tried to parse result manually
- Didn't use `AIBackendConfig.callAIJSON()` which has better JSON parsing

**Fixed:**
```javascript
async function callAIJSON(prompt, maxTokens = 1000) {
  // Try AIBackendConfig first (better JSON parsing)
  if (typeof window.AIBackendConfig !== 'undefined' && typeof window.AIBackendConfig.callAIJSON === 'function') {
    const result = await window.AIBackendConfig.callAIJSON(prompt, maxTokens).catch(() => null);
    if (result) return result;  // ✅ SUCCESS
  }

  // Fallback: manual parsing
  const raw = await callAI(prompt, maxTokens);
  if (!raw) return null;
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }
}
```

---

## Global Export Conflicts

### Files & Export Priority

| File | Exports | Version | Purpose | Status |
|------|---------|---------|---------|--------|
| ai-free-config.js | `window.callAI`, `window.callAIJSON` | v1.0 | OLD: Gemini/Groq via direct API | ⚠️ May conflict |
| **ai-backend-config.js** | `window.callAI`, `window.callAIJSON` | v2.0 | NEW: Microservices mode | ✅ ACTIVE |
| **ai-gemini.js** | `window.callAI`, `window.callAIJSON` | v5.0 | Bridge layer | ✅ ACTIVE |

### How Load Order Matters

Whichever file loads **LAST** will override globals:

**Current (Correct) Order:**
```
1. ai-free-config.js (old) → exports window.callAI (Gemini/Groq)
2. ai-server.js ✓
3. ai-backend-config.js (new) → exports window.callAI (microservices) → **OVERRIDES #1**
4. ai-gemini.js → exports window.callAI (bridge layer) → **OVERRIDES #3**
```

**Result:** `window.callAI` points to **ai-gemini.js** version (bridge layer) ✅

---

## Call Chain Verification

### Normal Flow: nft-page.js calling AI

```
nft-page.js
  ↓ calls AIBackend.callAI(prompt)
  ↓ (AIBackend = window.AIBackend = ai-gemini.js AIBackend object)
ai-gemini.js v5.0
  ↓ calls window.AIBackendConfig.callAI()
  ↓ (ai-backend-config.js exports)
ai-backend-config.js - callAI()
  ├─ Tries Gemini (if key exists)
  ├─ Tries Groq (if key exists)
  ├─ Tries OpenRouter (if key exists)
  └─ Returns text result ✅
```

### URL Check Flow: url-page.js calling VirusTotal

```
url-page.js
  ↓ calls AIBackend.vtScanURL(url)
  ↓ (AIBackend = window.AIBackend = ai-gemini.js AIBackend)
ai-gemini.js v5.0
  ↓ calls AIBackendConfig.vtScanURL()
  ↓ (via window.AIBackendConfig)
ai-backend-config.js - vtScanURL()
  ├─ POSTs to VirusTotal API
  ├─ Polls analysis result
  └─ Returns { malicious, suspicious, ... } ✅
```

### Fake News Detection: fakenews-page.js

```
fakenews-page.js
  ↓ calls AIBackend.callAIJSON(prompt)
  ↓ (AIBackend = window.AIBackend = ai-gemini.js)
ai-gemini.js v5.0 - callAIJSON()
  ├─ Tries window.AIBackendConfig.callAIJSON() ✅
  │  (ai-backend-config.js has JSON parsing)
  └─ Fallback: manual JSON parsing from callAI()
    ↓
  ai-gemini.js v5.0 - callAI()
    ├─ Tries window.AIBackendConfig.callAI()
    └─ Fallback: AIServer.detectFakeNews()
```

---

## Data Flow Verification

### ✅ Text Analysis (Text Service)
```
analyzeText(text)
  → AIServer.analyzeText(text)
  → POST to text-service-glgj.onrender.com/detect
  → Response: { ai_percent, human_percent, confidence, verdict, ... }
  → _normText() normalizes to: { trustScore, aiPct, humanPct, ... explanation }
  Result: ✅ CORRECT
```

### ✅ Fake News Detection (FAKENEWS Service)
```
detectFakeNews(text)
  → AIServer.detectFakeNews(text)
  → POST to fakenews-service.onrender.com/detect
  → Response: { fake_percent, real_percent, confidence, verdict, ... }
  → _normFakeNews() normalizes to: { trustScore, fakePct, realPct, ... explanation }
  Result: ✅ CORRECT
```

### ✅ Image Analysis (Image Service)
```
analyzeImage(base64)
  → AIServer.analyzeImage(base64)
  → POST to image-lchq.onrender.com/detect
  → Response: { ai_percent, real_percent, confidence, ... }
  → _normImage() normalizes to: { trustScore, aiPct, realPct, ... }
  Result: ✅ CORRECT
```

### ✅ URL Scanning (VirusTotal)
```
vtScanURL(url)
  → AIBackendConfig.vtScanURL(url)
  → POST to virustotal.com/api/v3/urls
  → Extract analysis ID
  → GET virustotal.com/api/v3/analyses/{id}
  → Response: { stats: { malicious, suspicious, harmless, ... } }
  Result: ✅ CORRECT
```

---

## Potential Issues That Could Still Occur

### ⚠️ Issue 1: ai-free-config.js Not Declared
**If ai-free-config.js loads AFTER ai-backend-config.js:**
- `window.callAI` gets overwritten back to old Gemini version
- **Fix:** Ensure script load order puts ai-backend-config.js LAST before ai-gemini.js

### ⚠️ Issue 2: AIBackendConfig Key Collision
**If both ai-backend-config.js and ai-free-config.js define same keys:**
- `KEYS.VIRUSTOTAL` might be wrong version
- **Fix:** ai-gemini.js now uses window.AIBackendConfig explicitly (resolved)

### ⚠️ Issue 3: Unexpected Response Format
**If microservices return different field names than expected:**
- callAI() could return null incorrectly
- **Fix:** Used optional chaining (?.) and fallbacks

---

## Summary

| Aspect | Status | Details |
|--------|--------|---------|
| **ai-gemini.js** | ✅ FIXED | Returns correct fields from AIServer, has fallback chain |
| **ai-backend-config.js** | ✅ READY | Exports AIBackend for domain APIs + callAI fallback |
| **ai-server.js** | ✅ GOOD | Microservices bridge, returns proper normalized responses |
| **url-page.js** | ✅ COMPATIBLE | Uses AIBackend.vtScanURL() correctly |
| **fakenews-page.js** | ✅ COMPATIBLE | Uses AIBackend.callAIJSON() correctly |
| **nft-page.js** | ✅ COMPATIBLE | Uses AIBackend.callAI() correctly |
| **Global Exports** | ✅ OK | Last-loaded wins (should be ai-gemini.js) |
| **Response Fields** | ✅ FIXED | explanation ✅ overallAssessment ❌ |

---

## Load Order Requirement

**CRITICAL:** Ensure HTML/app.js loads scripts in this order:

```html
<!-- ... other scripts ... -->
<script src="ai-server.js"></script>         <!-- 1st: Microservices bridge -->
<script src="ai-backend-config.js"></script> <!-- 2nd: Domain APIs + AI fallback -->
<script src="ai-free-config.js"></script>    <!-- 3rd: Optional old config (will be overridden) -->
<script src="ai-gemini.js"></script>         <!-- 4th: Final bridge layer (MUST BE LAST) -->
<!-- ... page-specific scripts ... -->
```

If ai-free-config.js is NOT used, remove it to avoid confusion.

