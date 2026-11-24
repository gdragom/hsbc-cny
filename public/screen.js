(() => {
  "use strict";

  const statusEl = document.getElementById("status");
  const roomCodeEl = document.getElementById("roomCode");
  const phoneCountEl = document.getElementById("phoneCount");
  const wishCountEl = document.getElementById("wishCount");
  const qrImageEl = document.getElementById("qrImage");
  const ornamentsEl = document.getElementById("ornaments");
  const flyLayerEl = document.getElementById("flyLayer");
  const stageEl = document.getElementById("stage");

  const MAX_VISIBLE = 36;
  const SLOT_POSITIONS = buildSlots();
  const treeEl = document.getElementById("tree");

  let roomCode = new URLSearchParams(window.location.search).get("room") || "";
  roomCode = String(roomCode).trim().toUpperCase();
  let slotCursor = 0;

  const socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
  });

  setStatus("連接中…");

  socket.on("connect", () => {
    setStatus("已連線 · 等待手機");
    joinAsScreen();
  });

  socket.on("disconnect", () => {
    setStatus("連線中斷 · 重連中…");
  });

  socket.on("connect_error", () => {
    setStatus("連線失敗 · 重試中…");
  });

  socket.on("room:update", (snap) => {
    if (!snap) return;
    if (snap.room) {
      roomCode = snap.room;
      roomCodeEl.textContent = roomCode;
    }
    phoneCountEl.textContent = String(snap.phones ?? 0);
    wishCountEl.textContent = String(snap.wishCount ?? 0);
    if ((snap.phones ?? 0) > 0) {
      setStatus("許願進行中");
    } else if (socket.connected) {
      setStatus("已連線 · 等待手機");
    }
  });

  socket.on("screen:wish", (event) => {
    if (!event || !event.wish) return;
    animateWish(event);
  });

  function joinAsScreen() {
    socket.emit("screen:join", { room: roomCode || undefined }, async (res) => {
      if (!res?.ok) {
        setStatus("無法建立房間");
        return;
      }
      roomCode = res.room;
      roomCodeEl.textContent = roomCode;
      phoneCountEl.textContent = String(res.phones ?? 0);
      wishCountEl.textContent = String(res.wishCount ?? 0);
      // Keep room in URL so refresh reuses same code
      const url = new URL(window.location.href);
      url.searchParams.set("room", roomCode);
      window.history.replaceState({}, "", url);
      await loadQr(roomCode);
    });
  }

  async function loadQr(room) {
    try {
      const res = await fetch(`/api/qr?room=${encodeURIComponent(room)}`);
      if (!res.ok) throw new Error("qr_http");
      const data = await res.json();
      if (!data.dataUrl) throw new Error("qr_missing");
      qrImageEl.src = data.dataUrl;
      qrImageEl.alt = `Scan to join room ${room}`;
    } catch (err) {
      console.error(err);
      setStatus("QR 產生失敗");
    }
  }

  function animateWish(event) {
    const lane = Number.isFinite(event.lane) ? event.lane : 2;
    const sx = (lane - 2) * 90;
    const slot = nextSlot();
    const target = slotToViewport(slot);

    // Flyer starts centered at bottom of stage; translate to tree slot
    const startX = window.innerWidth / 2;
    const startY = window.innerHeight + 40;
    const tx = target.x - startX;
    const ty = target.y - startY;

    const flyer = document.createElement("div");
    flyer.className = "flying-wish";
    flyer.style.setProperty("--sx", `${sx}px`);
    flyer.style.setProperty("--tx", `${tx}px`);
    flyer.style.setProperty("--ty", `${ty}px`);
    flyer.innerHTML = `<span class="leaf"></span><span class="label">${escapeHtml(event.wish)}</span>`;
    flyLayerEl.appendChild(flyer);

    stageEl.classList.remove("flash");
    void stageEl.offsetWidth;
    stageEl.classList.add("flash");

    flyer.addEventListener(
      "animationend",
      () => {
        flyer.remove();
        placeOrnament(event.wish, slot);
      },
      { once: true }
    );
  }

  function placeOrnament(wish, slot) {
    while (ornamentsEl.children.length >= MAX_VISIBLE) {
      ornamentsEl.firstElementChild?.remove();
    }
    const tag = document.createElement("div");
    tag.className = "wish-tag";
    tag.style.left = `${slot.pctX}%`;
    tag.style.top = `${slot.pctY}%`;
    tag.innerHTML = `<span class="dot"></span><span>${escapeHtml(wish)}</span>`;
    ornamentsEl.appendChild(tag);
  }

  function nextSlot() {
    const slot = SLOT_POSITIONS[slotCursor % SLOT_POSITIONS.length];
    slotCursor += 1;
    return slot;
  }

  function slotToViewport(slot) {
    const rect = treeEl.getBoundingClientRect();
    return {
      x: rect.left + (slot.pctX / 100) * rect.width,
      y: rect.top + (slot.pctY / 100) * rect.height,
    };
  }

  function buildSlots() {
    const spots = [];
    const rows = [
      { y: 22, xs: [38, 50, 62] },
      { y: 34, xs: [28, 42, 58, 72] },
      { y: 46, xs: [24, 36, 50, 64, 76] },
      { y: 58, xs: [30, 44, 56, 70] },
      { y: 68, xs: [40, 52, 62] },
    ];
    for (const row of rows) {
      for (const x of row.xs) {
        spots.push({ pctX: x, pctY: row.y });
      }
    }
    return spots;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
})();
