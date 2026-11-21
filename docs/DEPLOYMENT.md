# Deployment

This document covers the deployment process for the Valve Mobile system.

## Deployment Targets

| Environment | Service | URL |
|-------------|---------|-----|
| **Preview** | Cloud Run + Cloudflare Tunnel | `valve-mobile-preview.freebuff.app` |
| **Production** | Cloud Run + Cloudflare Tunnel | `valve-mobile.com` (custom domain) |

## Prerequisites

### Cloud Accounts

| Service | Account Required | Cost |
|---------|-----------------|------|
| **Google Cloud** | Cloud Run, Artifact Registry | Pay-as-you-go |
| **Cloudflare** | Tunnel, DNS, Workers | Free tier |
| **Firebase** | Auth, Firestore | Free tier (generous) |
| **ThingsBoard Cloud** | Device registry | Free tier |

### Local Tools

| Tool | Version | Purpose |
|------|---------|---------|
| `node` | 24.x | Node.js runtime |
| `npm` | 10.x | Package manager |
| `gcloud CLI` | 455+ | Google Cloud commands |
| `cloudflared` | latest | Cloudflare Tunnel |
| `docker` | 25.x | (optional) Container builds |

## Backend Deployment (Google Cloud Run)

### 1. Build Docker Image

```bash
# From the backend directory
cd apps/backend

# Build the image
docker build -t valve-backend:latest .

# Tag for Artifact Registry
docker tag valve-backend:latest us-central1-docker.pkg.com/valve-mobile/valve-backend:latest
```

### 2. Push to Artifact Registry

```bash
# Authenticate Docker to Artifact Registry
gcloud auth configure-docker us-central1-docker.pkg.com

# Push the image
docker push us-central1-docker.pkg.com/valve-mobile/valve-backend:latest
```

### 3. Deploy to Cloud Run

```bash
# Deploy to Asia-South1 (Mumbai)
gcloud run deploy valve-backend \
  --image us-central1-docker.pkg.com/valve-mobile/valve-backend:latest \
  --region asia-south1 \
  --allow-unauthenticated \
  --port 3000 \
  --set-env-vars=" \
    FIREBASE_PROJECT_ID=your-project-id \
    FIREBASE_API_KEY=your-api-key \
    FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com \
    FIREBASE_PROJECT_NUMBER=123456789012 \
    FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com \
    FIREBASE_MESSAGING_SENDER_ID=123456789012 \
    FIREBASE_APP_ID=1:123456789:ios:abcdef1234567890123456 \
    THINGSBOARD_TENANT=your-tenant \
    THINGSBOARD_API_KEY=your-api-key \
    RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXX \
    RAZORPAY_KEY_SECRET=your_test_key_secret \
    ADMIN_SECRET=generated-random-value \
    NODE_LOG_LEVEL=warn"
```

### 4. Verify Deployment

```bash
# Get the service URL
gcloud run services describe valve-backend \
  --region asia-south1 \
  --format "value(status.url)"

# Expected output:
# https://valve-backend-abc123-url.a.run.app
```

### 5. Cloudflare Tunnel Integration

```bash
# From any terminal
cloudflared tunnel --url https://valve-backend-abc123-url.a.run.app

# This provides a stable URL like:
# https://valve-mobile-xyz.trycloudflare.com

# Share this URL with:
# - ThingsBoard webhook
# - Razorpay webhook callbacks (if needed)
# - Admin panel external access
```

## Frontend/Mobile Deployment

### Expo Go (Development)

```bash
# From mobile app directory
cd apps/mobile

# Start Expo dev server
npx expo start

# Scan QR code with Expo Go app on phone
# Or use Android emulator: npx expo run:android
# Or iOS: npx expo run:ios
```

### Build for Production (Expo)

```bash
# Create production build
npx expo build:android
npx expo build:ios
```

### Submit to App Stores

```bash
# Expo Application Manager handles the submission
# Or use EAS (Expo Application Services)
eas build -p android --profile production
eas build -p ios --profile production
```

## Full Deployment Workflow

### Development → Preview → Production

```
┌─────────────────────────────────────────────────────────────┐
│                    DEVELOPMENT PHASE                        │
│  1. Set .env variables                                      │
│  2. Run: npm run dev (backend)                              │
│  3. Run: npx expo start (mobile)                           │
│  4. Test locally: npx vitest run                           │
└───────────────────────▲─────────────────────────────────────┘
                        │
                        │ Deploy to Cloud Run
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    PREVIEW DEPLOYMENT                       │
│  1. gcloud run deploy --allow-unauthenticated               │
│  2. cloudflared tunnel --url <run-url>                     │
│  3. Test: Preview URL + Tunnel                              │
│  4. Verify: Auth, Firestore, WebSocket, TB RPC            │
└───────────────────────▲─────────────────────────────────────┘
                        │
                        │ Promote to production
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                   PRODUCTION DEPLOYMENT                     │
│  1. gcloud run deploy (same command, --no-allow-unauth      │
│     may be used with auth)                                  │
│  2. cloudflared tunnel --url <run-url>                     │
│  3. Update DNS: valve-mobile.com → Cloudflare Tunnel       │
│  4. Final test: Production URL + all features              │
└─────────────────────────────────────────────────────────────┘
```

## Cloudflare Tunnel (for Webhooks)

### Why Use Cloudflare Tunnel?

- Exposes local development server to internet
- No need for public IP or domain (initially)
- Secure (no ports opened on your network)
- Stable URL for ThingsBoard webhooks

### Setup Steps

```bash
# 1. Install cloudflared
# macOS: brew install cloudflared
# Windows: winget install cloudflare.cloudflared
# Linux: snap install cloudflared --classic

# 2. Start tunnel to local backend
cloudflared tunnel --url http://localhost:3000

# 3. Output will show something like:
# ├── URL -> https://valve-mobile-abc123.trycloudflare.com

# 4. Use this URL for:
#    - ThingsBoard webhook: POST /api/thingsboard/webhook
#    - Razorpay webhook (if configured)
#    - Admin panel external access
```

### Production Tunnel

```bash
# After Cloud Run deployment
cloudflared tunnel --url https://valve-backend-abc123-url.a.run.app

# Or use Cloudflare Dashboard:
# 1. Go to Cloudflare → Tunnels → Create Tunnel
# 2. Name: valve-mobile-prod
# 3. Select Cloudflare account
# 4. Add public hostname: valve-mobile.com
# 5. Save - DNS record auto-created
```

## Firebase Emulator (Local Development Only)

```bash
# Start emulators for local development
firebase emulators:start --only firestore,auth,storage

# Access points:
# - Firestore: http://localhost:8080
# - Auth: http://localhost:9099
# - UI: http://localhost:4000

# This is for local dev only - do not use in production
```

## Rollback Procedure

### If Deployment Fails

```bash
# 1. List recent revisions
gcloud run services list revisions valve-backend \
  --region asia-south1

# 2. Rollback to previous revision
gcloud run services update valve-backend \
  --region asia-south1 \
  --image us-central1-docker.pkg.com/valve-mobile/valve-backend:previous-tag

# 3. Or revert to specific revision
gcloud run services update valve-backend \
  --region asia-south1 \
  --rollback
```

### If Tunnel Breaks

```bash
# 1. List tunnels
cloudflared tunnel list

# 2. Delete broken tunnel
cloudflared tunnel delete valve-mobile

# 3. Create new tunnel
cloudflared tunnel --url https://valve-backend-abc123-url.a.run.app
```

## Post-Deployment Checklist

### After Preview Deployment

- [ ] Backend health check: `GET /api/admin/time` returns 200
- [ ] Firebase Auth works: login/register test
- [ ] Firestore rules allow client reads
- [ ] WebSocket connections work with valid token
- [ ] ThingsBoard device connects and publishes telemetry
- [ ] Realtime updates push to mobile app
- [ ] Cloudflare Tunnel providing stable URL

### After Production Deployment

- [ ] Custom domain (valve-mobile.com) resolves
- [ ] HTTPS working (Cloudflare automatic)
- [ ] Firebase Auth production client configured
- [ ] ThingsBoard API key still works
- [ ] Razorpay test mode verified
- [ ] Admin panel accessible
- [ ] Rate limiting active (not blocking legitimate traffic)
- [ ] Audit logs writing to Firestore
- [ ] Fail-closed behavior verified (theory only - no hardware)

### Monitoring

| Metric | Tool | Alert Threshold |
|--------|------|-----------------|
| Error rate | Cloud Run logs | > 5% per minute |
| Latency | Cloud Run metrics | > 2s average |
| Auth failures | Firebase console | > 10/hour |
| WebSocket disconnects | Cloudflare Tunnel logs | > 5/min |
| Payment failures | Razorpay dashboard | > 3/hour/user |

## Development Workflow

### Local Development Cycle

```bash
# 1. Start backend
cd apps/backend
npm run dev
# Server starts on http://localhost:3000

# 2. Start mobile
cd apps/mobile
npx expo start
# Opens Expo dev server, scan QR with Expo Go

# 3. Run tests
cd apps/backend
npx vitest run
# 85 tests should pass

# 4. Type check
cd apps/mobile
npx tsc --noEmit
# Should pass (after fixes)

# 5. Make code changes
# 6. Save - hot reload in both dev servers
# 7. Iterate
```

### Git Workflow (if initialized)

```bash
# The project currently has no git repo
# If initialized, typical workflow:

# Create feature branch
git checkout -b feature/some-feature

# Make changes
# ...

# Commit
git add .
git commit -m "Description of changes"

# Push (if remote exists)
git push origin feature/some-feature

# Pull request / code review
# ...

# Merge to main
git checkout main
git merge feature/some-feature
```

## Known Deployment Limitations

### Cloud Run Limitations

- **Max concurrent requests**: 80 (autoscaling)
- **Request timeout**: 60 seconds (max)
- **Cold start**: 2-5 seconds on first request after idle
- **Memory limit**: 1GB default (our app uses ~200MB)

### Cloudflare Tunnel Limitations

- **Free tier**: 1 tunnel per account (we use 1)
- **Bandwidth**: Unlimited on free tier
- **Custom domain**: Additional cost for TLS certs
- **WebSocket**: Supported on free tier

### Firebase Limitations

- **Free tier**: 50GB storage, 1GB download/day
- **Auth**: Unlimited users on free plan
- **Firestore**: 1GB free storage, 10GB/day download
- **Rate limiting**: Not built-in (app-level only)

### ThingsBoard Cloud Limitations

- **Free tier**: 100 devices, basic telemetry
- **RPC**: Unlimited calls
- **MQTT**: Included
- **Webhooks**: Included on free tier

## Untested Deployment Components

The following have not been fully tested with actual deployment:

- [ ] Cloud Run deployment with full env vars
- [ ] Cloudflare Tunnel with production traffic
- [ ] Firebase production auth (only tested with dev clients)
- [ ] ThingsBoard Cloud with real devices (only simulated)
- [ ] Razorpay live mode (only test mode verified)
- [ ] Custom domain mapping (valve-mobile.com)
- [ ] HTTPS end-to-end with all bindings
- [ ] Auto-scaling under load
- [ ] Backup and restore procedures

These limitations must be verified by the user after deploying with actual credentials and hardware.

## Firebase Custom Claims Admin Promotion

After deploying the backend, promote a user to admin:

```bash
# Using the promote-admin script
node scripts/promote-admin.mjs <uid>

# Or with Firebase CLI
firebase auth:set-custom-claims <uid> --claims admin=true
```

The user must have `admin: true` in their custom claims AND the Firestore role check must pass (see `firebase/firestore.rules`).