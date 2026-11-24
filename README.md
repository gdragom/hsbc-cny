# HSBC CNY · 山頂許願樹

Network-connected digital screen + mobile phone realtime activation.

## How it works

1. Open **Screen** on the big display (`/screen.html`)
2. Guests scan the on-screen QR to open the **Phone** page
3. Guest picks a wish and **swipes up** on the orange
4. Socket.io delivers the signal → wish animates onto the tree

## Run locally

```bash
npm install
npm start
```

- Screen: http://localhost:3000/screen.html  
- Phone (same Wi‑Fi): use the QR, or open the join URL shown by `/api/qr?room=CODE`

For phones on the same LAN, open the screen via your Mac’s LAN IP (not `localhost`), e.g. `http://192.168.x.x:3000/screen.html`, so the QR encodes a reachable address.

## Deploy (Render)

Bind is already `0.0.0.0:$PORT`. Set start command to `npm start`.

## Routes

| Path | Role |
|------|------|
| `/screen.html` | Big display |
| `/phone.html?room=XXXXX` | Mobile control |
| `/api/qr?room=XXXXX` | QR data URL for join link |
| `/health` | Health check |
