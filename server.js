import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const users = new Map();

app.use(express.static(path.join(__dirname, "public")));

wss.on("connection", (ws) => {
  console.log("🟢 Neuer Client verbunden");

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log("📩 Eingehende Nachricht:", msg);

      // Benutzer registrieren
      if (msg.type === "register") {
        users.set(msg.username, { ws, publicKey: msg.publicKey });
        console.log("✅ Benutzer registriert:", msg.username);
        broadcastUserList();
        return;
      }

      // Nachricht weiterleiten
      if (msg.type === "send") {
        console.log(`➡️ Nachricht von ${msg.from} → ${msg.to}`);
        for (const to of msg.to) {
          const user = users.get(to);
          if (user && user.ws.readyState === 1) {
            user.ws.send(
              JSON.stringify({
                type: "message",
                from: msg.from,
                payload: msg.payload,
              })
            );
          }
        }
        return;
      }
    } catch (err) {
      console.error("❌ Fehler bei Nachrichtenverarbeitung:", err);
    }
  });

  ws.on("close", () => {
    for (const [u, entry] of users) {
      if (entry.ws === ws) users.delete(u);
    }
    broadcastUserList();
  });
});

function broadcastUserList() {
  const list = [...users.entries()].map(([username, { publicKey }]) => ({
    username,
    publicKey,
  }));
  const msg = JSON.stringify({ type: "userlist", list });
  for (const { ws } of users.values()) {
    if (ws.readyState === 1) ws.send(msg);
  }
  console.log("📤 Nutzerliste an alle gesendet");
}

server.listen(3000, () =>
  console.log("🚀 Server läuft auf http://localhost:3000")
);
