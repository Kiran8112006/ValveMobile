# Credential Setup

This document provides the complete credential guide for the Valve Mobile system, including exact PowerShell commands, credential tables, and which terminals run what.

## Credential Table

| Credential | Category | Source | Terminal | PowerShell Command |
|------------|----------|--------|----------|-------------------|
| `FIREBASE_PROJECT_ID` | Firebase | Firebase Console | Any | `$env:FIREBASE_PROJECT_ID = "your-project-id"` |
| `FIREBASE_API_KEY` | Firebase | Firebase Console | Any | `$env:FIREBASE_API_KEY = "your-api-key"` |
| `FIREBASE_AUTH_DOMAIN` | Firebase | Firebase Console | Any | `$env:FIREBASE_AUTH_DOMAIN = "your-project-id.firebaseapp.com"` |
| `FIREBASE_PROJECT_NUMBER` | Firebase | Firebase Console | Any | `$env:FIREBASE_PROJECT_NUMBER = "123456789012"` |
| `FIREBASE_STORAGE_BUCKET` | Firebase | Firebase Console | Any | `$env:FIREBASE_STORAGE_BUCKET = "your-project-id.appspot.com"` |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase | Firebase Console | Any | `$env:FIREBASE_MESSAGING_SENDER_ID = "your-sender-id"` |
| `FIREBASE_APP_ID` | Firebase | Firebase Console | Any | `$env:FIREBASE_APP_ID = "1:123456789:ios:abcdef123456"` |
| `API_BASE_URL` | Backend | Local dev config | Any | `$env:API_BASE_URL = "http://localhost:3000"` |
| `THINGSBOARD_TENANT` | IoT | ThingsBoard Cloud | Any | `$env:THINGSBOARD_TENANT = "your-tenant"` |
| `THINGSBOARD_API_KEY` | IoT | ThingsBoard Cloud | Any | `$env:THINGSBOARD_API_KEY = "your-read-write-api-key"` |
| `RAZORPAY_KEY_ID` | Payments | Razorpay Dashboard | Backend | `$env:RAZORPAY_KEY_ID = "rzp_test_XXXXXXXXXXXXXXX"` |
| `RAZORPAY_KEY_SECRET` | Payments | Razorpay Dashboard | Backend | `$env:RAZORPAY_KEY_SECRET = "your_test_key_secret"` |
| `ADMIN_SECRET` | Admin | Generated value | Any | `$env:ADMIN_SECRET = "generated-random-value"` |
| `APP_NAME` | App | Valve Mobile | Any | `$env:APP_NAME = "Valve Mobile"` |
| `APP_ENV` | App | development| Any | `$env:APP_ENV = "development"` |
| `APP_URL` | App | Local dev URL | Any | `$env:APP_URL = "http://localhost:19006"` |
| `WS_URL` | WebSocket | Local dev WS | Any | `$env:WS_URL = "ws://localhost:3000/ws"` |
| `NODE_LOG_LEVEL` | Logging | log level | Any | `$env:NODE_LOG_LEVEL = "debug"` |

## Firebase Credentials Detail

### Getting Firebase Credentials

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing
3. Click the **Web** icon (`</>`) to add a web app
4. Register app name (e.g., `valve-mobile`)
5. Copy the following config values:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "valve-project.firebaseapp.com",
  projectId: "valve-project",
  storageBucket: "valve-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789:ios:abcdef1234567890123456"
};
```

### PowerShell Setup (one-time)

```powershell
# Navigate to project
cd C:\Projects\ValveMobile

# Set Firebase credentials
$env:FIREBASE_PROJECT_ID = "valve-project"
$env:FIREBASE_API_KEY = "AIzaSy..."
$env:FIREBASE_AUTH_DOMAIN = "valve-project.firebaseapp.com"
$env:FIREBASE_PROJECT_NUMBER = "123456789012"
$env:FIREBASE_STORAGE_BUCKET = "valve-project.appspot.com"
$env:FIREBASE_MESSAGING_SENDER_ID = "123456789012"
$env:FIREBASE_APP_ID = "1:123456789:ios:abcdef1234567890123456"

# Verify
Write-Host "FIREBASE_PROJECT_ID: $env:FIREBASE_PROJECT_ID"
Write-Host "FIREBASE_API_KEY: $env:FIREBASE_API_KEY"
```

### .env File Creation

```powershell
# Copy example and edit
Copy-Item .env.example .env

# Edit with notepad or IDE
notepad .env

# Or set each variable individually
Set-Content .env -Value @"
FIREBASE_PROJECT_ID=valve-project
FIREBASE_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=valve-project.firebaseapp.com
FIREBASE_PROJECT_NUMBER=123456789012
FIREBASE_STORAGE_BUCKET=valve-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789012
FIREBASE_APP_ID=1:123456789:ios:abcdef1234567890123456
API_BASE_URL=http://localhost:3000
THINGSBOARD_TENANT=your-tenant
THINGSBOARD_API_KEY=your-api-key
RAZORPAY_KEY_ID=rzp_test_XXXXXXXXXXXXXXX
RAZORPAY_KEY_SECRET=your_test_key_secret
ADMIN_SECRET=change-this-to-a-secure-random-value
APP_NAME=Valve Mobile
APP_ENV=development
APP_URL=http://localhost:19006
WS_URL=ws://localhost:3000/ws
NODE_LOG_LEVEL=debug
"@
```

## ThingsBoard Credentials Detail

### Getting ThingsBoard API Key

1. Log in to [ThingsBoard Cloud](https://thingsboard.cloud)
2. Go to **Authentication** → **API Keys**
3. Click **Create API Key**
4. Name: `Valve-Mobile-App`
5. Type: Select `ApiKey`
6. Credential: Select `READ_WRITE`
7. Click **Create**
8. **Copy the generated key** - this is your `THINGSBOARD_API_KEY`

### PowerShell Setup

```powershell
cd C:\Projects\ValveMobile

# Set ThingsBoard credentials
$env:THINGSBOARD_TENANT = "your-tenant"
$env:THINGSBOARD_API_KEY = "your-read-write-api-key"

# Verify
Write-Host "THINGSBOARD_API_KEY: $env:THINGSBOARD_API_KEY"
```

## Razorpay Credentials Detail

### Getting Razorpay Keys

1. Log in to [Razorpay Dashboard](https://dashboard.razorpay.com/)
2. Go to **Settings** → **API Keys**
3. Click **Create New Key**
4. The system generates:
   - `Key ID`: `rzp_test_XXXXXXXXXXXXXXXX`
   - `Key Secret`: `your_test_key_secret`
5. **Copy both values** - both are required
6. For production: Click "Go Live" and replace with live keys

### PowerShell Setup

```powershell
cd C:\Projects\ValveMobile

# Set Razorpay test credentials
$env:RAZORPAY_KEY_ID = "rzp_test_XXXXXXXXXXXXXXX"
$env:RAZORPAY_KEY_SECRET = "your_test_key_secret"

# Verify
Write-Host "RAZORPAY_KEY_ID: $env:RAZORPAY_KEY_ID"
Write-Host "RAZORPAY_KEY_SECRET length: $env:RAZORPAY_KEY_SECRET.Length"
```

### Test vs Live

| Setting | Test Mode | Live Mode |
|---------|-----------|-----------|
| `RAZORPAY_KEY_ID` | `rzp_test_...` | `rzp_live_...` |
| `RAZORPAY_KEY_SECRET` | Test secret | Live secret |
| Payment amount | No real money | Real money |
| Cards | Test cards only | Real cards |

**Important**: Never commit real keys to version control. The `.env` file should be gitignored (it is, see `.gitignore`).

## Admin Secret

### Generated Random Value

The admin secret is used for server-side admin operations (CSRF protection, operation signing).

```powershell
# Generate a secure random value
$securePassword = -join ((65,97..122|% { [char](get-random -Minimum 65 -Maximum 123) } | Get-Random -Count 32) -join '')
$env:ADMIN_SECRET = $securePassword

# Or use PowerShell's built-in
$env:ADMIN_SECRET = [Convert]::ToBase64String([Security.Cryptography.RNGCryptoService]::Create().GetBytes(32))

Write-Host "ADMIN_SECRET set to: $env:ADMIN_SECRET"
```

### Usage

The backend validates this secret on admin operations:

```http
POST /api/admin/credit
X-Admin-Secret: <from-env>
Content-Type: application/json

{
  "customerId": "uid123",
  "amountMl": 500
}
```

If the secret doesn't match, the request is rejected with 403.

## App Configuration

### APP_NAME and APP_URL

These are read from `.env` by the mobile app and backend:

```powershell
# Example PowerShell setup
$env:APP_NAME = "Valve Mobile"
$env:APP_URL = "http://localhost:19006"  # Expo dev server URL
$env:WS_URL = "ws://localhost:3000/ws"  # Backend WebSocket URL
```

### Verification

```powershell
cd C:\Projects\ValveMobile

# Verify all required env vars are set
$required = @(
  "FIREBASE_PROJECT_ID",
  "FIREBASE_API_KEY", 
  "API_BASE_URL",
  "THINGSBOARD_API_KEY",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "ADMIN_SECRET"
)

$missing = $required | Where-Object { -not $env:$_ }

if ($missing.Count -eq 0) {
  Write-Host "✓ All required environment variables are set" -ForegroundColor Green
} else {
  Write-Host "✗ Missing variables: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}
```

## Wi-Fi Provisioning Credentials

### Per-Device Setup Password

Each ESP8266 device has a unique pairing token generated during manufacturing. This is **not** the Wi-Fi password.

### PowerShell (for firmware developers)

```powershell
# The pairing token is embedded in firmware flash
# It's not something you set via PowerShell env vars
# It's defined in secrets.example.h and overridden in secrets.h

# secrets.example.h (provided with firmware):
#define PAIRING_TOKEN "default-token-override"

# secrets.h (gitignored, local overrides):
#define PAIRING_TOKEN "my-unique-pairing-token-12345"
```

### Wi-Fi Credentials (phone → ESP8266)

During provisioning, the phone sends:
- SSID (Wi-Fi network name)
- Password (Wi-Fi password)

These are **not** set in the `.env` file - they are sent dynamically via the app's SoftAP interface.

## Full PowerShell Environment Setup

### One-Time Setup Script

Run this PowerShell script once to set up all credentials:

```powershell
# ==============================
# Valve Mobile Credential Setup
# ==============================

Write-Host "Valve Mobile Credential Setup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan

# Change to project directory
$projectDir = "C:\Projects\ValveMobile"
if (-not (Test-Path $projectDir)) {
  Write-Host "Error: Project directory not found at $projectDir" -ForegroundColor Red
  exit 1
}
Set-Location $projectDir

# Check if .env already exists
if (Test-Path ".env") {
  Write-Host "Warning: .env already exists. Overwriting?" -ForegroundColor Yellow
  $confirm = Read-Host "Do you want to continue? (y/n)"
  if ($confirm -notmatch "^y") {
    Write-Host "Setup cancelled." -ForegroundColor DarkYellow
    exit 0
  }
}

# Generate secure admin secret
$adminSecret = [Convert]::ToBase64String([Security.Cryptography.RNGCryptoService]::Create().GetBytes(32))
Write-Host "Generated ADMIN_SECRET" -ForegroundColor Gray

# Prompt for Firebase credentials
Write-Host "`nEnter Firebase Project ID:" -ForegroundColor White
$projectId = Read-Host
Write-Host "Enter Firebase API Key:" -ForegroundColor White
$apiKey = Read-Host
Write-Host "Enter Firebase Auth Domain:" -ForegroundColor White
$authDomain = Read-Host
Write-Host "Enter Firebase Project Number:" -ForegroundColor White
$projectNumber = Read-Host
Write-Host "Enter Firebase Storage Bucket:" -ForegroundColor White
$storageBucket = Read-Host
Write-Host "Enter Firebase Messaging Sender ID:" -ForegroundColor White
$messagingSenderId = Read-Host
Write-Host "Enter Firebase App ID:" -ForegroundColor White
$appId = Read-Host

# Prompt for ThingsBoard
Write-Host "Enter ThingsBoard API Key:" -ForegroundColor White
$tbApiKey = Read-Host

# Prompt for Razorpay
Write-Host "Enter Razorpay Key ID:" -ForegroundColor White
$razorKeyId = Read-Host
Write-Host "Enter Razorpay Key Secret:" -ForegroundColor White
$razorKeySecret = Read-Host

# Write .env file
$envContent = @"
# Firebase
FIREBASE_PROJECT_ID=$projectId
FIREBASE_API_KEY=$apiKey
FIREBASE_AUTH_DOMAIN=$authDomain
FIREBASE_PROJECT_NUMBER=$projectNumber
FIREBASE_STORAGE_BUCKET=$storageBucket
FIREBASE_MESSAGING_SENDER_ID=$messagingSenderId
FIREBASE_APP_ID=$appId

# Server
API_BASE_URL=http://localhost:3000

# ThingsBoard
THINGSBOARD_TENANT=your-tenant
THINGSBOARD_API_KEY=$tbApiKey

# Razorpay
RAZORPAY_KEY_ID=$razorKeyId
RAZORPAY_KEY_SECRET=$razorKeySecret

# Admin
ADMIN_SECRET=$adminSecret

# App
APP_NAME=Valve Mobile
APP_ENV=development
APP_URL=http://localhost:19006
WS_URL=ws://localhost:3000/ws

# Logging
NODE_LOG_LEVEL=debug
"@

Set-Content -Path .env -Value $envContent -Encoding UTF8

Write-Host "`n✓ .env file created successfully!" -ForegroundColor Green
Write-Host "`nImportant: Keep .env out of version control." -ForegroundColor DarkYellow
Write-Host "It is already listed in .gitignore." -ForegroundColor Gray

# Verify
Write-Host "`nVerifying setup..." -ForegroundColor Cyan
$required = @(
  "FIREBASE_PROJECT_ID",
  "FIREBASE_API_KEY", 
  "API_BASE_URL",
  "THINGSBOARD_API_KEY",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "ADMIN_SECRET"
)

$missing = $required | Where-Object { -not $env:$_ }

if ($missing.Count -eq 0) {
  Write-Host "✓ All required environment variables are set" -ForegroundColor Green
} else {
  Write-Host "✗ Missing variables: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}
```

### Running the Setup

```powershell
# Save as setup-credentials.ps1
# Right-click .ps1 file → "Run with PowerShell"
# Or: powershell.exe -File "C:\path\to\setup-credentials.ps1"

# Follow the prompts to enter each credential value
```

### Per-Terminal Configuration

| Terminal | Purpose | Key Variables |
|-----------|---------|---------------|
| **PowerShell** | Backend development, env setup | All variables |
| **Command Prompt** | Quick checks | Minimal subset |
| **Git Bash** | Git operations | All variables |
| **Android Studio terminal** | Android build | `ANDROID_HOME`, app config |
| **Expo CLI terminal** | Mobile dev | `APP_URL`, `WS_URL` |

## Credential Verification

### Quick Verification Command

```powershell
cd C:\Projects\ValveMobile

# Check all critical env vars
$checks = @{
  "FIREBASE_PROJECT_ID" = $env:FIREBASE_PROJECT_ID
  "FIREBASE_API_KEY" = $env:FIREBASE_API_KEY
  "API_BASE_URL" = $env:API_BASE_URL
  "THINGSBOARD_API_KEY" = $env:THINGSBOARD_API_KEY
  "RAZORPAY_KEY_ID" = $env:RAZORPAY_KEY_ID
  "RAZORPAY_KEY_SECRET" = $env:RAZORPAY_KEY_SECRET
  "ADMIN_SECRET" = $env:ADMIN_SECRET
}

$allOk = $checks.Values | ForEach-Object { $_ -notmatch "^$" } | Measure-Object | Select-Object -ExpandProperty Count
$total = $checks.Keys.Count

if ($allOk -eq $total) {
  Write-Host "✓ All $total credential checks passed" -ForegroundColor Green
  exit 0
} else {
  Write-Host "✗ $($total - $allOk) of $total credentials missing" -ForegroundColor Red
  exit 1
}
```

### Expected Output (all set)

```
PS C:\Projects\ValveMobile> .\verify-credentials.ps1
✓ All 7 credential checks passed

PS C:\Projects\ValveMobile>
```

### Missing Credential Output

```
PS C:\Projects\ValveMobile> .\verify-credentials.ps1
✗ Missing variables: FIREBASE_API_KEY, RAZORPAY_KEY_SECRET

PS C:\Projects\ValveMobile
```

## Security Best Practices

### Never Commit Credentials

- `.env` is in `.gitignore`
- Never add real credentials to commit messages
- Use `git commit --amend --no-edit` never with secrets

### Environment File Security

```
# .env file permissions (Unix/macOS)
chmod 600 .env

# Windows
# File Properties → Uncheck "Allow indexing this file for quick search"
```

### Rotation Policy

- Rotate `ADMIN_SECRET` every 90 days
- Rotate `RAZORPAY_KEY_SECRET` after any suspected compromise
- Firebase keys: Rotate if leaked (regenerate in Firebase console)
- `THINGSBOARD_API_KEY`: Recreate if compromised

### Local Development

- Use separate `.env.local` for local overrides (also gitignored)
- Never share `.env` files in chat or collaboration
- Use dummy/test values for demonstrations

## Credential Troubleshooting

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Auth fails | `FIREBASE_API_KEY` mismatch | Re-check Firebase console |
| Backend won't start | `API_BASE_URL` wrong | Set to `http://localhost:3000` |
| WebSocket disconnects | `WS_URL` wrong | Match backend port |
| Recharge disabled | `pricing.configured` false | Set `pricePerLitre` in Firestore |
| Device not connecting | `THINGSBOARD_API_KEY` wrong | Verify in ThingsBoard Cloud |
| Permission denied | `ADMIN_SECRET` mismatch | Regenerate and update .env |

### Debug Mode

Enable credential logging (development only):

```powershell
# In .env, set:
NODE_LOG_LEVEL=debug

# Or in backend code temporarily:
process.env.NODE_LOG_LEVEL = 'debug'
```

This will print environment variable loading status at startup.

## Credential Summary Checklist

### Before Running Backend

- [ ] `.env` file exists at project root
- [ ] Firebase project ID, API key, auth domain set
- [ ] ThingsBoard API key (READ_WRITE) set
- [ ] Razorpay test keys set
- [ ] Admin secret generated
- [ ] `NODE_LOG_LEVEL` set (optional)

### Before Running Mobile

- [ ] Backend `.env` variables configured
- [ ] `API_BASE_URL` points to running backend
- [ ] `WS_URL` matches backend WebSocket endpoint
- [ ] Expo Go app installed on phone (or emulator)

### Before Production

- [ ] All test credentials replaced with live
- [ ] Firebase project upgraded to paid plan if needed
- [ ] ThingsBoard tenant configured for production
- [ ] Razorpay KYC completed for live payments
- [ ] Admin secret rotated
- [ ] Price per litre configured in Firestore
- [ ] Audit logging verified
- [ ] Rate limiting tested