// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// 🧩 Static-Files ausliefern (index.html + client.js)
app.use(express.static(path.join(__dirname)));

// =========================
// Nutzerverwaltung
// =========================
let clients = new Map();

wss.on("connection", (ws) => {
  console.log("🟢 Neuer Client verbunden");

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    console.log("📩 Eingehende Nachricht:", data);

    if (data.type === "register") {
      ws.username = data.username;
      ws.publicKey = data.publicKey;
      clients.set(ws.username, ws);
      console.log(`✅ Benutzer registriert: ${data.username}`);
      broadcastUserList();
    }

    if (data.type === "send") {
      const { from, to, payload } = data;
      to.forEach((targetName) => {
        const target = clients.get(targetName);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(
            JSON.stringify({
              type: "message",
              from,
              payload,
            })
          );
        }
      });
    }

    if (data.type === "list") {
      sendUserList(ws);
    }
  });

  ws.on("close", () => {
    if (ws.username) {
      clients.delete(ws.username);
      console.log(`🔴 Benutzer getrennt: ${ws.username}`);
      broadcastUserList();
    }
  });
});

function broadcastUserList() {
  const list = [...clients.entries()].map(([username, ws]) => ({
    username,
    publicKey: ws.publicKey,
  }));
  const msg = JSON.stringify({ type: "userlist", list });
  for (const [, ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function sendUserList(ws) {
  const list = [...clients.entries()].map(([username, ws]) => ({
    username,
    publicKey: ws.publicKey,
  }));
  ws.send(JSON.stringify({ type: "userlist", list }));
}

// =========================
// Serverstart
// =========================
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
