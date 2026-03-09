# Skyline Parkour

Browser-based 3D parkour game with room-based multiplayer, pointer lock mouse look, procedural textures, and a simple Node server you can publish online.

## Run locally

```bash
node server.js
```

Open http://localhost:3000.

## What is included

- HTML/CSS/JavaScript client in `public/`
- Zero-dependency Node server in `server.js`
- Room creation and join flow with public server list
- Real-time multiplayer sync over raw WebSockets
- Pointer lock mouse look, sprinting, jump, double jump, wall-slide, checkpoints, respawn, timer, and best-time tracking

## Publish notes

- Deploy it on a Node host that supports WebSocket upgrades.
- Use HTTPS in production so pointer lock and browser APIs work reliably.
- The client imports Three.js from a CDN, so the published site needs internet access.

