# ProofAI Microservices Architecture

## 🏗️ Deployment URLs (Production)

```
Gateway (Main Router):
  https://gateway-g5cc.onrender.com

Microservices:
  Text Analysis:      https://text-service-glgj.onrender.com
  Fake News Detection: https://fakenews-service.onrender.com
  Image Analysis:      https://image-lchq.onrender.com
  Utility Service:     https://utility-service-m2n3.onrender.com
```

## 🔄 Service Architecture

### Gateway (`gateway-g5cc.onrender.com`)
- **Role**: Main entry point, routes requests to microservices
- **Endpoints**:
  - `GET /health` → Health check
  - `POST /analyze/text` → Routes to Text Service
  - `POST /detect-text` → Routes to Text Service
  - `POST /detect-fake-news` → Routes to Fake News Service
  - `POST /analyze/url` → Routes to Fake News Service
  - `POST /analyze/image` → Routes to Image Service
  - `POST /detect-ai-image` → Routes to Image Service

### Text Service (`text-service-glgj.onrender.com`)
- **Purpose**: AI text detection, analysis
- **Handles**:
  - Analyzes content for AI-generated text
  - Model: RoBERTa-base OpenAI Detector
  - Fast inference for single text classification
- **Endpoints**: 
  - `POST /detect-text` → Quick detection
  - `POST /analyze/text` → Full analysis pipeline

### Fake News Service (`fakenews-service.onrender.com`)
- **Purpose**: Misinformation and fake news detection
- **Handles**:
  - Analyzes articles for misinformation
  - Model: BART-large-MNLI (zero-shot classification)
  - Claims extraction and verification
  - Source credibility assessment
- **Endpoints**: 
  - `POST /detect-fake-news` → Fake news detection
  - `POST /analyze/url` → Fetch and analyze URL content

### Image Service (`image-lchq.onrender.com`)
- **Purpose**: AI-generated image detection
- **Handles**:
  - Detects AI/GAN-generated images
  - Model: CLIP ViT-B/32 + pixel forensics
  - EXIF metadata analysis
- **Endpoints**: 
  - `POST /analyze/image` → Full image analysis
  - `POST /detect-ai-image` → Quick detection

### Utility Service (`utility-service-m2n3.onrender.com`)
- **Purpose**: Blockchain, crypto, versioning utilities
- **Handles**:
  - Hash computation (SHA256, SHA512, Merkle)
  - Blockchain verification
  - Version comparison / semantic diff
- **Endpoints**: 
  - `POST /blockchain/verify` → Verify hash on-chain
  - `POST /version/compare` → Semantic diff

## 💻 Local Development URLs

When running locally (`http://localhost:*`):

```
Gateway:       http://localhost:8000
Text Service:  http://localhost:8001
Fake News:     http://localhost:8002
Image Service: http://localhost:8003
Utility:       http://localhost:8004
```

## 🔌 Configuration

Update is handled automatically in `config.js`:

```javascript
const SERVICES = IS_LOCAL ? {
  GATEWAY:  'http://localhost:8000',
  TEXT:     'http://localhost:8001',
  FAKENEWS: 'http://localhost:8002',
  IMAGE:    'http://localhost:8003',
  UTILITY:  'http://localhost:8004',
} : {
  GATEWAY:  'https://gateway-g5cc.onrender.com',
  TEXT:     'https://text-service-glgj.onrender.com',
  FAKENEWS: 'https://fakenews-service.onrender.com',
  IMAGE:    'https://image-lchq.onrender.com',
  UTILITY:  'https://utility-service-m2n3.onrender.com',
};
```

## 📊 API Call Flow

```
User Frontend
    ↓
AIServer Module (ai-server.js)
    ├─→ health() → Gateway /health
    ├─→ analyzeText() → Gateway /analyze/text → Text Service
    ├─→ detectFakeNews() → Gateway /detect-fake-news → Fake News Service
    ├─→ analyzeURL() → Gateway /analyze/url → Fake News Service
    ├─→ analyzeImage() → Gateway /analyze/image → Image Service
    └─→ detectAIImage() → Gateway /detect-ai-image → Image Service
    ↓
Backend Microservices
    ↓
Response to Frontend
```

## 🚀 Deployment Steps

### Deploy to Render

1. **Create services on Render Dashboard**:
   - Create 5 new Web Services
   - Connect to GitHub repositories
   - Set environment variables

2. **Configure environment for each service**:
   ```
   PYTHON_VERSION=3.11
   PIP_INSTALL_REQUIREMENT=requirements.txt
   ```

3. **Set custom domains** (optional):
   ```
   Gateway: gateway-g5cc.onrender.com
   Text: text-service-glgj.onrender.com
   Fake News: fakenews-service.onrender.com
   Image: image-lchq.onrender.com
   Utility: utility-service-m2n3.onrender.com
   ```

4. **Start services in order**:
   - Utility Service (dependencies)
   - Text Service
   - Fake News Service
   - Image Service
   - Gateway (after all services ready)

## 🔍 Testing

### Test Gateway
```bash
curl https://gateway-g5cc.onrender.com/health
# or locally
curl http://localhost:8000/health
```

### Test Text Service
```bash
curl -X POST https://text-service-glgj.onrender.com/detect-text \
  -H "Content-Type: application/json" \
  -d '{"content": "This is test text"}'
```

### Test Fake News Service
```bash
curl -X POST https://fakenews-service.onrender.com/detect-fake-news \
  -H "Content-Type: application/json" \
  -d '{"content": "Breaking news article..."}'
```

## 🛠️ Debugging

1. **Check service status**: Visit Render dashboard
2. **View logs**: Render dashboard → Service → Logs
3. **Test locally first**: Run services on localhost:8000-8004
4. **Check CORS**: Ensure gateway has CORS enabled for frontend
5. **Network tab**: Open browser DevTools → Network to inspect API calls

## 📝 Environment Variables

### Each Microservice May Need:
```
DATABASE_URL=<if applicable>
REDIS_URL=<if using caching>
API_KEY=<authentication>
LOG_LEVEL=DEBUG|INFO|WARNING
```

### Gateway Specific:
```
UPSERVICE_TEXT_URL=https://text-service-glgj.onrender.com
UPSERVICE_FAKENEWS_URL=https://fakenews-service.onrender.com
UPSERVICE_IMAGE_URL=https://image-lchq.onrender.com
UPSERVICE_UTILITY_URL=https://utility-service-m2n3.onrender.com
```

## 🔐 Security

- All HTTPS connections
- CORS configured on gateway
- API rate limiting recommended
- Consider API keys between services
- Use environment variables for secrets

---
**Last Updated**: 2026-03-18
**Status**: Production Ready
