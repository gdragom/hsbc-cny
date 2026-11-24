const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const QRCode = require("qrcode");

const PORT = Number(process.env.PORT) || 3000;
const THROW_COOLDOWN_MS = 1800;
const MAX_WISHES_ON_TREE = 40;
const ROOM_IDLE_MS = 1000 * 60 * 60 * 6; // 6h

const WISHES = ["健康", "發財", "平安", "幸福", "事業"];

/** @type {Map<string, { screenIds: Set<string>, phoneIds: Set<string>, wishCount: number, lastActivity: number }>} */
const rooms = new Map();

/** @type {Map<string, number>} */
const lastThrowAt = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingInterval: 10000,
  pingTimeout: 20000,
});

app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/", (_req, res) => {
  res.redirect("/screen.html");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

app.get("/api/wishes", (_req, res) => {
  res.json({ wishes: WISHES });
});

app.get("/api/qr", async (req, res) => {
  const room = String(req.query.room || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(room)) {
    res.status(400).json({ error: "Invalid room code" });
    return;
  }

  const base = publicBaseUrl(req);
  const joinUrl = `${base}/phone.html?room=${encodeURIComponent(room)}`;

  try {
    const dataUrl = await QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
      color: { dark: "#1a0505", light: "#ffffff" },
    });
    res.json({ room, joinUrl, dataUrl });
  } catch (err) {
    console.error("QR generation failed:", err);
    res.status(500).json({ error: "QR generation failed" });
  }
});

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`).split(",")[0].trim();
  return `${proto}://${host}`;
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  if (rooms.has(code)) return createRoomCode();
  return code;
}

function ensureRoom(code) {
  let room = rooms.get(code);
  if (!room) {
    room = {
      screenIds: new Set(),
      phoneIds: new Set(),
      wishCount: 0,
      lastActivity: Date.now(),
    };
    rooms.set(code, room);
  }
  room.lastActivity = Date.now();
  return room;
}

function roomSnapshot(code) {
  const room = rooms.get(code);
  if (!room) return null;
  return {
    room: code,
    phones: room.phoneIds.size,
    screens: room.screenIds.size,
    wishCount: room.wishCount,
  };
}

function leaveAllRooms(socket) {
  for (const code of socket.rooms) {
    if (code === socket.id) continue;
    const room = rooms.get(code);
    if (!room) continue;
    room.screenIds.delete(socket.id);
    room.phoneIds.delete(socket.id);
    socket.leave(code);
    io.to(code).emit("room:update", roomSnapshot(code));
    if (room.screenIds.size === 0 && room.phoneIds.size === 0) {
      rooms.delete(code);
    }
  }
  lastThrowAt.delete(socket.id);
}

io.on("connection", (socket) => {
  socket.data.role = null;
  socket.data.room = null;

  socket.on("screen:join", (payload, ack) => {
    try {
      leaveAllRooms(socket);
      const requested = String(payload?.room || "").trim().toUpperCase();
      const code = /^[A-Z0-9]{4,8}$/.test(requested) ? requested : createRoomCode();
      const room = ensureRoom(code);
      room.screenIds.add(socket.id);
      socket.data.role = "screen";
      socket.data.room = code;
      socket.join(code);
      const snap = roomSnapshot(code);
      socket.emit("room:update", snap);
      if (typeof ack === "function") ack({ ok: true, ...snap });
    } catch (err) {
      console.error("screen:join error", err);
      if (typeof ack === "function") ack({ ok: false, error: "join_failed" });
    }
  });

  socket.on("phone:join", (payload, ack) => {
    try {
      leaveAllRooms(socket);
      const code = String(payload?.room || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(code)) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_room" });
        return;
      }
      const room = rooms.get(code);
      if (!room || room.screenIds.size === 0) {
        if (typeof ack === "function") ack({ ok: false, error: "screen_offline" });
        return;
      }
      room.phoneIds.add(socket.id);
      room.lastActivity = Date.now();
      socket.data.role = "phone";
      socket.data.room = code;
      socket.join(code);
      const snap = roomSnapshot(code);
      io.to(code).emit("room:update", snap);
      if (typeof ack === "function") ack({ ok: true, wishes: WISHES, ...snap });
    } catch (err) {
      console.error("phone:join error", err);
      if (typeof ack === "function") ack({ ok: false, error: "join_failed" });
    }
  });

  socket.on("phone:throw", (payload, ack) => {
    try {
      const code = socket.data.room;
      if (socket.data.role !== "phone" || !code) {
        if (typeof ack === "function") ack({ ok: false, error: "not_joined" });
        return;
      }
      const room = rooms.get(code);
      if (!room || room.screenIds.size === 0) {
        if (typeof ack === "function") ack({ ok: false, error: "screen_offline" });
        return;
      }

      const wish = String(payload?.wish || "").trim();
      if (!WISHES.includes(wish)) {
        if (typeof ack === "function") ack({ ok: false, error: "invalid_wish" });
        return;
      }

      const now = Date.now();
      const prev = lastThrowAt.get(socket.id) || 0;
      if (now - prev < THROW_COOLDOWN_MS) {
        if (typeof ack === "function") {
          ack({ ok: false, error: "cooldown", retryInMs: THROW_COOLDOWN_MS - (now - prev) });
        }
        return;
      }

      lastThrowAt.set(socket.id, now);
      room.wishCount += 1;
      room.lastActivity = now;

      const event = {
        id: `${socket.id}-${now}`,
        wish,
        lane: Math.floor(Math.random() * 5),
        fromPhone: socket.id.slice(0, 6),
        index: room.wishCount,
        prune: room.wishCount > MAX_WISHES_ON_TREE,
        at: now,
      };

      io.to(code).emit("screen:wish", event);
      io.to(code).emit("room:update", roomSnapshot(code));
      if (typeof ack === "function") ack({ ok: true, id: event.id });
    } catch (err) {
      console.error("phone:throw error", err);
      if (typeof ack === "function") ack({ ok: false, error: "throw_failed" });
    }
  });

  socket.on("disconnect", () => {
    leaveAllRooms(socket);
  });
});

setInterval(() => {
  const cutoff = Date.now() - ROOM_IDLE_MS;
  for (const [code, room] of rooms) {
    if (room.lastActivity < cutoff && room.screenIds.size === 0 && room.phoneIds.size === 0) {
      rooms.delete(code);
    }
  }
}, 60_000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HSBC CNY Wishing Tree listening on http://0.0.0.0:${PORT}`);
  console.log(`  Screen:  http://localhost:${PORT}/screen.html`);
  console.log(`  Phone:   http://localhost:${PORT}/phone.html?room=XXXXX`);
});
