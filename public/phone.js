(() => {
  "use strict";

  const WISHES_FALLBACK = ["健康", "發財", "平安", "幸福", "事業"];
  const SWIPE_THRESHOLD = 90;
  const VELOCITY_THRESHOLD = 0.45;

  const params = new URLSearchParams(window.location.search);
  let roomCode = String(params.get("room") || "").trim().toUpperCase();

  const wishPicker = document.getElementById("wishPicker");
  const wishTag = document.getElementById("wishTag");
  const orange = document.getElementById("orange");
  const instruction = document.getElementById("instruction");
  const conn = document.getElementById("conn");
  const feedback = document.getElementById("feedback");
  const gate = document.getElementById("gate");
  const roomInput = document.getElementById("roomInput");
  const joinBtn = document.getElementById("joinBtn");
  const gateError = document.getElementById("gateError");
  const throwZone = document.getElementById("throwZone");

  let selectedWish = WISHES_FALLBACK[0];
  let joined = false;
  let throwing = false;
  let drag = null;

  const socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
  });

  renderWishes(WISHES_FALLBACK);

  if (!roomCode) {
    showGate();
  }

  socket.on("connect", () => {
    conn.textContent = roomCode ? "已連線 · 加入房間中…" : "已連線 · 請輸入房間碼";
    if (roomCode) joinRoom(roomCode);
  });

  socket.on("disconnect", () => {
    joined = false;
    conn.textContent = "連線中斷 · 重連中…";
  });

  socket.on("connect_error", () => {
    conn.textContent = "連線失敗 · 重試中…";
  });

  socket.on("room:update", (snap) => {
    if (!snap) return;
    if (joined) {
      conn.textContent = `房間 ${snap.room} · 大屏在線`;
    }
  });

  joinBtn.addEventListener("click", () => {
    const code = String(roomInput.value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      gateError.textContent = "房間碼格式不正確";
      return;
    }
    gateError.textContent = "";
    roomCode = code;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomCode);
    window.history.replaceState({}, "", url);
    joinRoom(roomCode);
  });

  roomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinBtn.click();
  });

  function joinRoom(code) {
    socket.emit("phone:join", { room: code }, (res) => {
      if (!res?.ok) {
        joined = false;
        const messages = {
          invalid_room: "房間碼無效",
          screen_offline: "大屏尚未開啟，請先打開 Screen",
          join_failed: "加入失敗，請重試",
        };
        const msg = messages[res?.error] || "無法加入房間";
        conn.textContent = msg;
        gateError.textContent = msg;
        showGate();
        return;
      }

      joined = true;
      hideGate();
      if (Array.isArray(res.wishes) && res.wishes.length) {
        renderWishes(res.wishes);
      }
      conn.textContent = `房間 ${res.room} · 可以許願了`;
      feedback.textContent = "";
      instruction.textContent = "按住橘子 · 向上滑動";
    });
  }

  function renderWishes(list) {
    wishPicker.innerHTML = "";
    list.forEach((wish, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wish-btn" + (index === 0 ? " active" : "");
      btn.textContent = wish;
      btn.addEventListener("click", () => selectWish(wish, btn));
      wishPicker.appendChild(btn);
    });
    selectedWish = list[0];
    wishTag.textContent = selectedWish;
  }

  function selectWish(wish, btn) {
    selectedWish = wish;
    wishTag.textContent = wish;
    wishPicker.querySelectorAll(".wish-btn").forEach((el) => el.classList.remove("active"));
    btn.classList.add("active");
  }

  function onPointerDown(e) {
    if (!joined || throwing) return;
    e.preventDefault();
    const point = getPoint(e);
    drag = {
      id: e.pointerId,
      startY: point.y,
      startX: point.x,
      lastY: point.y,
      lastT: performance.now(),
      velocity: 0,
    };
    orange.setPointerCapture?.(e.pointerId);
    orange.style.transition = "none";
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const point = getPoint(e);
    const dy = point.y - drag.startY;
    const clamped = Math.max(-220, Math.min(40, dy));
    orange.style.transform = `translateY(${clamped}px) scale(${1 + Math.min(0, clamped) * -0.0008})`;

    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.velocity = (point.y - drag.lastY) / dt;
    drag.lastY = point.y;
    drag.lastT = now;
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const point = getPoint(e);
    const dy = point.y - drag.startY;
    const shouldThrow = dy < -SWIPE_THRESHOLD || drag.velocity < -VELOCITY_THRESHOLD;
    drag = null;
    orange.style.transition = "";

    if (shouldThrow) {
      throwWish();
    } else {
      orange.style.transform = "";
    }
  }

  function throwWish() {
    if (!joined || throwing) return;
    throwing = true;
    orange.classList.add("thrown");
    instruction.textContent = "願望飛向大屏…";
    feedback.textContent = "";

    socket.emit("phone:throw", { wish: selectedWish }, (res) => {
      window.setTimeout(() => {
        orange.classList.remove("thrown");
        orange.style.transform = "";
        throwing = false;

        if (!res?.ok) {
          if (res?.error === "cooldown") {
            feedback.textContent = "稍等一下再投";
            instruction.textContent = "按住橘子 · 向上滑動";
            return;
          }
          if (res?.error === "screen_offline") {
            feedback.textContent = "大屏離線了";
            joined = false;
            showGate();
            return;
          }
          feedback.textContent = "投擲失敗，請再試";
          instruction.textContent = "按住橘子 · 向上滑動";
          return;
        }

        feedback.textContent = `「${selectedWish}」已掛上許願樹`;
        instruction.textContent = "再選一個願望繼續";
      }, 520);
    });
  }

  orange.addEventListener("pointerdown", onPointerDown);
  orange.addEventListener("pointermove", onPointerMove);
  orange.addEventListener("pointerup", onPointerUp);
  orange.addEventListener("pointercancel", onPointerUp);

  // Keyboard fallback for desktop testing
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === " ") {
      e.preventDefault();
      throwWish();
    }
  });

  // Prevent page scroll while interacting
  throwZone.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  function getPoint(e) {
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function showGate() {
    gate.hidden = false;
    if (roomCode) roomInput.value = roomCode;
  }

  function hideGate() {
    gate.hidden = true;
    gateError.textContent = "";
  }
})();
