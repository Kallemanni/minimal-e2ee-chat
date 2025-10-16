// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Static files aus /public
app.use(express.static(path.join(__dirname, "public")));

// Map username -> { ws, publicKey }
const users = new Map();

wss.on("connection", (ws) => {
  console.log("🟢 Neuer WS-Client verbunden");

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log("📩 Eingehende Nachricht:", msg.type, msg);

      if (msg.type === "register") {
        if (!msg.username || !msg.publicKey) return;
        ws.username = msg.username;
        ws.publicKey = msg.publicKey;
        users.set(msg.username, { ws, publicKey: msg.publicKey });
        console.log("✅ registriert:", msg.username);
        broadcastUserList();
        return;
      }

      if (msg.type === "list") {
        sendUserList(ws);
        return;
      }

      if (msg.type === "send") {
        // msg: { type: "send", from, to: [user,...], payload }
        const from = msg.from || "unknown";
        const to = Array.isArray(msg.to) ? msg.to : [];
        const payload = msg.payload;
        console.log(`➡️ Nachricht von ${from} → to:[${to.join(",")}]`);

        // Wenn to leer -> interpretieren wir das nicht als broadcast, client soll explicit senden.
        for (const target of to) {
          const entry = users.get(target);
          if (entry && entry.ws && entry.ws.readyState === WebSocket.OPEN) {
            entry.ws.send(JSON.stringify({ type: "message", from, payload }));
            console.log(`📨 weitergeleitet an ${target}`);
          } else {
            console.log(`⚠️ Empfänger nicht erreichbar: ${target}`);
          }
        }
        return;
      }
    } catch (e) {
      console.error("❌ Fehler beim Verarbeiten:", e);
    }
  });

  ws.on("close", () => {
    if (ws.username) {
      users.delete(ws.username);
      console.log("🔴 Verbindung entfernt:", ws.username);
      broadcastUserList();
    }
  });
});

function sendUserList(ws) {
  const list = Array.from(users.entries()).map(([username, { publicKey }]) => ({ username, publicKey }));
  ws.send(JSON.stringify({ type: "userlist", list }));
}

function broadcastUserList() {
  const list = Array.from(users.entries()).map(([username, { publicKey }]) => ({ username, publicKey }));
  const msg = JSON.stringify({ type: "userlist", list });
  for (const [, { ws }] of users) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
  console.log("📤 Nutzerliste an alle gesendet");
}

server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
