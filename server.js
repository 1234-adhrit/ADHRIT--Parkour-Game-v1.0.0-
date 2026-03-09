const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 10_000;
const ROOM_IDLE_TTL_MS = 30 * 60 * 1000;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const rooms = new Map();
let nextPlayerId = 1;

function sanitizeText(value, fallback, maxLength = 24) {
  if (typeof value !== "string") {
    return fallback;
  }

  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return cleaned || fallback;
}

function sanitizeColor(value, fallback = "#59f3c1") {
  if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    return value.trim().toLowerCase();
  }

  return fallback;
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

function sanitizeVector(vector, fallback, bounds = 1000) {
  return {
    x: clampNumber(vector && vector.x, fallback.x, -bounds, bounds),
    y: clampNumber(vector && vector.y, fallback.y, -bounds, bounds),
    z: clampNumber(vector && vector.z, fallback.z, -bounds, bounds)
  };
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));

  return code;
}

function createRoom(name) {
  const room = {
    code: generateRoomCode(),
    createdAt: Date.now(),
    lastActive: Date.now(),
    name: sanitizeText(name, "Skyline Lobby"),
    clients: new Map(),
    players: new Map()
  };

  rooms.set(room.code, room);
  return room;
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    checkpoint: player.checkpoint,
    pitch: player.pitch,
    position: player.position,
    updatedAt: player.updatedAt,
    velocity: player.velocity,
    yaw: player.yaw
  };
}

function listRooms() {
  return [...rooms.values()]
    .sort((left, right) => right.players.size - left.players.size || right.lastActive - left.lastActive)
    .map((room) => ({
      code: room.code,
      createdAt: room.createdAt,
      lastActive: room.lastActive,
      name: room.name,
      playerCount: room.players.size
    }));
}

function sendJson(response, statusCode, payload) {
  const json = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(json),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(json);
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = chunks.length ? Buffer.concat(chunks).toString("utf8") : "{}";
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function resolveStaticFile(urlPath) {
  const safePath = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
  const relativePath = safePath.replace(/^\/+/, "");
  const resolvedPath = path.normalize(path.join(PUBLIC_DIR, relativePath));

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return resolvedPath;
}

function createPlayerRecord(client, payload) {
  return {
    checkpoint: 0,
    color: sanitizeColor(payload.color),
    id: client.id,
    name: sanitizeText(payload.playerName, "Runner", 18),
    pitch: 0,
    position: { x: 0, y: 2.35, z: 0 },
    updatedAt: Date.now(),
    velocity: { x: 0, y: 0, z: 0 },
    yaw: 0
  };
}

function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const length = data.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, data]);
}

function sendFrame(socket, payload, opcode = 0x1) {
  if (socket.destroyed || !socket.writable) {
    return;
  }

  socket.write(encodeFrame(payload, opcode));
}

function sendMessage(client, payload) {
  sendFrame(client.socket, JSON.stringify(payload));
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let cursor = offset + 2;

    if (!fin) {
      throw new Error("Fragmented WebSocket frames are not supported.");
    }

    if (payloadLength === 126) {
      if (cursor + 2 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLength === 127) {
      if (cursor + 8 > buffer.length) {
        break;
      }
      const value = buffer.readBigUInt64BE(cursor);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame is too large.");
      }
      payloadLength = Number(value);
      cursor += 8;
    }

    let mask;
    if (masked) {
      if (cursor + 4 > buffer.length) {
        break;
      }
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }

    if (cursor + payloadLength > buffer.length) {
      break;
    }

    let payload = buffer.subarray(cursor, cursor + payloadLength);
    cursor += payloadLength;

    if (masked) {
      const unmasked = Buffer.alloc(payloadLength);
      for (let index = 0; index < payloadLength; index += 1) {
        unmasked[index] = payload[index] ^ mask[index % 4];
      }
      payload = unmasked;
    }

    frames.push({ opcode, payload });
    offset = cursor;
  }

  return { frames, remaining: buffer.subarray(offset) };
}

function broadcastRoom(room, payload, exceptPlayerId = null) {
  const frame = JSON.stringify(payload);
  for (const [playerId, client] of room.clients.entries()) {
    if (playerId === exceptPlayerId) {
      continue;
    }
    sendFrame(client.socket, frame);
  }
}

function detachClient(client) {
  if (client.closed) {
    return;
  }

  client.closed = true;

  if (client.room) {
    const room = client.room;
    room.players.delete(client.id);
    room.clients.delete(client.id);
    room.lastActive = Date.now();
    broadcastRoom(room, { type: "player_left", playerId: client.id });
  }

  if (!client.socket.destroyed) {
    client.socket.destroy();
  }
}

function handleJoin(client, payload) {
  if (client.room) {
    return;
  }

  const roomCode = sanitizeText(payload.roomCode, "", 12).toUpperCase();
  const room = rooms.get(roomCode);

  if (!room) {
    sendMessage(client, { message: "Room not found. Create a server first.", type: "error" });
    sendFrame(client.socket, Buffer.alloc(0), 0x8);
    client.socket.end();
    return;
  }

  const player = createPlayerRecord(client, payload);
  client.room = room;
  client.player = player;
  room.players.set(client.id, player);
  room.clients.set(client.id, client);
  room.lastActive = Date.now();

  sendMessage(client, {
    playerId: client.id,
    players: [...room.players.values()].map(serializePlayer),
    roomCode: room.code,
    roomName: room.name,
    serverTime: Date.now(),
    type: "welcome"
  });

  broadcastRoom(room, { player: serializePlayer(player), type: "player_joined" }, client.id);
}

function handleState(client, payload) {
  if (!client.player || !client.room) {
    return;
  }

  client.player.position = sanitizeVector(payload.position, client.player.position, 500);
  client.player.velocity = sanitizeVector(payload.velocity, client.player.velocity, 120);
  client.player.yaw = clampNumber(payload.yaw, client.player.yaw, -Math.PI * 4, Math.PI * 4);
  client.player.pitch = clampNumber(payload.pitch, client.player.pitch, -Math.PI, Math.PI);
  client.player.checkpoint = Math.floor(clampNumber(payload.checkpoint, client.player.checkpoint, 0, 32));
  client.player.updatedAt = Date.now();
  client.room.lastActive = client.player.updatedAt;
}

function handleSocketMessage(client, text) {
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    sendMessage(client, { message: "Malformed JSON payload.", type: "error" });
    return;
  }

  if (!payload || typeof payload.type !== "string") {
    return;
  }

  switch (payload.type) {
    case "join":
      handleJoin(client, payload);
      break;
    case "ping":
      sendMessage(client, { serverTime: Date.now(), type: "pong" });
      break;
    case "state":
      handleState(client, payload);
      break;
    default:
      break;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const baseUrl = `http://${request.headers.host || "localhost"}`;
    const requestUrl = new URL(request.url || "/", baseUrl);

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true, roomCount: rooms.size });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/rooms") {
      sendJson(response, 200, { rooms: listRooms() });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/rooms") {
      const body = await collectBody(request);
      const room = createRoom(body.name);
      sendJson(response, 201, {
        code: room.code,
        createdAt: room.createdAt,
        name: room.name
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    const filePath = resolveStaticFile(requestUrl.pathname);
    if (!filePath) {
      sendJson(response, 400, { error: "Invalid path." });
      return;
    }

    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(filePath);
    } catch {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
      "Content-Length": fileBuffer.length,
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(fileBuffer);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error." });
  }
});

server.on("upgrade", (request, socket) => {
  try {
    const baseUrl = `http://${request.headers.host || "localhost"}`;
    const requestUrl = new URL(request.url || "/", baseUrl);

    if (requestUrl.pathname !== "/socket") {
      socket.destroy();
      return;
    }

    const upgradeHeader = String(request.headers.upgrade || "").toLowerCase();
    const key = request.headers["sec-websocket-key"];

    if (upgradeHeader !== "websocket" || typeof key !== "string") {
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "\r\n"
      ].join("\r\n")
    );

    const client = {
      buffer: Buffer.alloc(0),
      closed: false,
      id: `p${nextPlayerId++}`,
      player: null,
      room: null,
      socket
    };

    socket.on("data", (chunk) => {
      try {
        client.buffer = Buffer.concat([client.buffer, chunk]);
        const { frames, remaining } = decodeFrames(client.buffer);
        client.buffer = remaining;

        for (const frame of frames) {
          if (frame.opcode === 0x8) {
            sendFrame(socket, Buffer.alloc(0), 0x8);
            socket.end();
            detachClient(client);
            return;
          }

          if (frame.opcode === 0x9) {
            sendFrame(socket, frame.payload, 0xA);
            continue;
          }

          if (frame.opcode === 0x1) {
            handleSocketMessage(client, frame.payload.toString("utf8"));
          }
        }
      } catch {
        detachClient(client);
      }
    });

    socket.on("close", () => detachClient(client));
    socket.on("end", () => detachClient(client));
    socket.on("error", () => detachClient(client));
  } catch {
    socket.destroy();
  }
});

setInterval(() => {
  const now = Date.now();

  for (const [code, room] of rooms.entries()) {
    if (room.players.size === 0 && now - room.lastActive > ROOM_IDLE_TTL_MS) {
      rooms.delete(code);
      continue;
    }

    if (room.players.size === 0) {
      continue;
    }

    const players = [...room.players.values()].map(serializePlayer);
    broadcastRoom(room, { players, serverTime: now, type: "snapshot" });
  }
}, 50);

server.listen(PORT, HOST, () => {
  console.log(`Skyline Parkour server running at http://${HOST}:${PORT}`);
});

