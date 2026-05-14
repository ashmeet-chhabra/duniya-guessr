# Duniya Guessr

A GeoGuessr-like game using Google Street View + Leaflet. Play locally on one device or online with a friend.

## Features

- **Local mode** — two players, one device, pass-and-play
- **Online mode** — two players, separate devices, real-time via WebSockets
- Country guessing with distance-based scoring
- Player history and matchup stats

## Setup

```bash
# Install dependencies
npm install
npm install --prefix client
npm install --prefix server

# Environment
cp client/.env.example client/.env
# Edit client/.env and add your Google Maps API key
```

### Get a Google Maps API key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Maps Embed API** (free tier)
3. Create an API key and add it to `client/.env`

### Run locally

```bash
npm run dev
```

Opens at `http://localhost:5173`. The server runs on port 3001.

## Game modes

### Local
Both players use the same device. Enter names, then take turns guessing.

### Online
- **Create** a room → share the 4-digit code with your friend
- **Join** with the code → both play simultaneously from your own devices

## Deploy on Render

1. Create a **Web Service** and connect your GitHub repo
2. Set build command: `npm run build`
3. Set start command: `npm start`
4. Add environment variable:
   - `VITE_GOOGLE_MAPS_API_KEY` — your Google Maps API key

The free tier sleeps after 15 min of inactivity (wakes on request). No persistent storage — history resets on redeploy.

### Multi-room

The server supports **multiple concurrent rooms** on both LAN and Render.
Each room gets a unique 4-digit code and Socket.IO routes messages per-room.
No built-in player or room limit — the ceiling is the host machine's RAM
(≈10-20 simultaneous games on a free Render instance, many more on LAN).
Designed for private games with friends, not large-scale public hosting.

## Tech stack

- **Frontend**: React 18, Vite 5, Leaflet, Socket.IO client
- **Backend**: Express, Socket.IO, SQL.js (SQLite)
- **Real-time**: WebSockets via Socket.IO
