// Generate QR Code Payload & Printable HTML Label for Valve Device
// Usage: node scripts/generate-qr.mjs [deviceId] [claimCode] [apPassword] [pairingToken] [apSsid]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const deviceId = process.argv[2] || 'valve-esp8266-001';
const claimCode = process.argv[3] || '123456';
const apPassword = process.argv[4] || 'ValveSetupChangeMe1';
const pairingToken = process.argv[5] || 'REPLACE_WITH_DEVICE_PAIRING_TOKEN';
const rawSuffix = deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
const apSsid = process.argv[6] || `Valve-ESP8266-${rawSuffix.padStart(4, '0')}`;

const qrPayload = `valve://pair?deviceId=${encodeURIComponent(deviceId)}&claimCode=${encodeURIComponent(claimCode)}&apSsid=${encodeURIComponent(apSsid)}&apPassword=${encodeURIComponent(apPassword)}&pairingToken=${encodeURIComponent(pairingToken)}`;

const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(qrPayload)}`;

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Valve Device Pairing Label - ${deviceId}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f4f6f8;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .label-card {
      background: #ffffff;
      border: 2px dashed #0070f3;
      border-radius: 16px;
      padding: 32px;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    }
    h2 { margin: 0 0 8px 0; color: #111; }
    p.subtitle { color: #666; font-size: 14px; margin-top: 0; margin-bottom: 20px; }
    .qr-container {
      background: #ffffff;
      padding: 12px;
      display: inline-block;
      border-radius: 12px;
      border: 1px solid #e1e4e8;
    }
    .qr-container img { display: block; width: 250px; height: 250px; }
    .details {
      margin-top: 24px;
      text-align: left;
      background: #f8fafc;
      border-radius: 8px;
      padding: 16px;
      font-size: 13px;
    }
    .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .row:last-child { margin-bottom: 0; }
    .label { color: #64748b; font-weight: 500; }
    .value { font-family: monospace; font-weight: 600; color: #0f172a; word-break: break-all; }
    .raw-payload {
      margin-top: 16px;
      font-size: 11px;
      color: #94a3b8;
      word-break: break-all;
    }
    .btn-print {
      margin-top: 20px;
      padding: 10px 20px;
      font-size: 14px;
      background: #0070f3;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    @media print {
      body { background: white; padding: 0; }
      .label-card { box-shadow: none; border: 1px solid #000; }
      .btn-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="label-card">
    <h2>Valve IoT Node Label</h2>
    <p class="subtitle">Scan this label in the Valve Mobile app</p>
    
    <div class="qr-container">
      <img src="${qrApiUrl}" alt="Device Pairing QR Code" />
    </div>

    <div class="details">
      <div class="row">
        <span class="label">Device ID:</span>
        <span class="value">${deviceId}</span>
      </div>
      <div class="row">
        <span class="label">Claim Code:</span>
        <span class="value">${claimCode}</span>
      </div>
      <div class="row">
        <span class="label">Setup SSID:</span>
        <span class="value">${apSsid}</span>
      </div>
      <div class="row">
        <span class="label">Setup Password:</span>
        <span class="value">${apPassword}</span>
      </div>
    </div>

    <p class="raw-payload"><strong>URI:</strong> ${qrPayload}</p>

    <button class="btn-print" onclick="window.print()">Print Label Sticker</button>
  </div>
</body>
</html>
`;

const outputPath = path.resolve(__dirname, 'device-qr.html');
fs.writeFileSync(outputPath, htmlContent, 'utf8');

console.log('====================================================');
console.log('✓ QR Code Generated Successfully!');
console.log('====================================================');
console.log(`Device ID:    ${deviceId}`);
console.log(`Claim Code:   ${claimCode}`);
console.log(`Setup SSID:   ${apSsid}`);
console.log(`Setup Pass:   ${apPassword}`);
console.log('----------------------------------------------------');
console.log('Payload URL:');
console.log(qrPayload);
console.log('----------------------------------------------------');
console.log(`HTML Label file saved at:\n  ${outputPath}`);
console.log('\nOpen device-qr.html in your browser to view or print the QR code!');
console.log('====================================================\n');
