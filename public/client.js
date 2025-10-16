// public/client.js
const $ = (id) => document.getElementById(id);

let ws;
let username = null;
let keyPair = null;
let privateKey = null;
let users = {}; // username -> publicKeyBase64
let selectedUser = null;

// WebSocket initialisieren dynamisch
function createWS() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${window.location.host}`;
  console.log("Verbinde WebSocket:", url);
  return new WebSocket(url);
}

// ====== Login / Start ======
$("joinBtn").onclick = async () => {
  username = $("username").value.trim();
  if (!username) return alert("Bitte einen Nutzernamen eingeben");

  // Schlüssel erzeugen
  keyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  const pub = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  privateKey = keyPair.privateKey;
  const pubB64 = arrayBufferToBase64(pub);

  // WS
  ws = createWS();

  ws.onopen = () => {
    console.log("WS open - sende Register");
    ws.send(JSON.stringify({ type: "register", username, publicKey: pubB64 }));
  };

  ws.onmessage = async (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      console.log("WS Nachricht:", msg);

      if (msg.type === "userlist") {
        await handleUserList(msg.list);
      } else if (msg.type === "message") {
        const from = msg.from;
        const payload = msg.payload;
        // derive key and decrypt
        const sharedKey = await deriveSharedKey(from);
        if (!sharedKey) {
          console.warn("Kein SharedKey für", from);
          return;
        }
        const text = await decryptMessage(sharedKey, payload);
        const isPrivate = payload && payload.includes('"private":true') ? true : false;
        addMessage(from, text, from === username ? "self" : "remote", isPrivate);
      } else {
        console.log("Unbekannter Nachrichtentyp:", msg.type);
      }
    } catch (e) {
      console.error("Fehler onmessage:", e);
    }
  };

  ws.onclose = () => {
    console.log("WS geschlossen");
  };

  // UI wechseln
  $("login").style.display = "none";
  $("chat").style.display = "grid";
};

// ====== Userlist und Imports ======
async function handleUserList(list) {
  // list: [{username, publicKey}]
  $("userlist").innerHTML = "";
  users = {};
  for (const u of list) {
    users[u.username] = u.publicKey;
    if (u.username === username) continue;
    const li = document.createElement("li");
    li.textContent = u.username;
    li.onclick = () => selectUser(li, u.username);
    $("userlist").appendChild(li);
  }
  console.log("Aktuelle Nutzer:", Object.keys(users));
  updateChatMode();
}

// ====== Auswahl für private Nachricht ======
function selectUser(li, name) {
  const already = li.classList.contains("selected");
  [...$("userlist").children].forEach((el) => el.classList.remove("selected"));
  if (!already) {
    li.classList.add("selected");
    selectedUser = name;
  } else {
    selectedUser = null;
  }
  updateChatMode();
}
function updateChatMode() {
  const mode = $("chatMode");
  if (selectedUser) {
    mode.textContent = `✉️ Privat an ${selectedUser}`;
    mode.classList.add("private");
  } else {
    mode.textContent = "💬 Gruppenchat (alle)";
    mode.classList.remove("private");
  }
}

// ====== Senden ======
$("sendBtn").onclick = async () => {
  const text = $("message").value.trim();
  if (!text) return;

  // Empfänger-Liste
  let recipients = Object.keys(users).filter((u) => u !== username);
  let isPrivate = false;
  if (selectedUser) {
    recipients = [selectedUser];
    isPrivate = true;
  }
  if (recipients.length === 0) {
    alert("Keine anderen Nutzer online");
    return;
  }

  // Für jeden Empfänger: shared key, verschlüsseln, senden (einzeln)
  for (const to of recipients) {
    const sharedKey = await deriveSharedKey(to);
    if (!sharedKey) {
      console.warn("Kein Key für", to);
      continue;
    }
    const payload = await encryptMessage(sharedKey, text, isPrivate);
    ws.send(JSON.stringify({ type: "send", from: username, to: [to], payload }));
    console.log("Gesendet an", to);
  }

  addMessage(username, text, "self", isPrivate);
  $("message").value = "";
};

// ====== Anzeige ======
function addMessage(sender, text, kind = "remote", isPrivate = false) {
  const li = document.createElement("li");
  li.textContent = `${sender}: ${text}`;
  li.className = kind;
  if (isPrivate) li.classList.add("private-msg");
  $("messages").appendChild(li);
  $("messages").scrollTop = $("messages").scrollHeight;
}

// ====== Kryptofunktionen ======
async function deriveSharedKey(peerName) {
  const pubB64 = users[peerName];
  if (!pubB64) return null;
  const pubBuf = base64ToArrayBuffer(pubB64);
  const imported = await crypto.subtle.importKey("spki", pubBuf, { name: "ECDH", namedCurve: "P-256" }, true, []);
  // derive a symmetric AES-GCM key
  return crypto.subtle.deriveKey({ name: "ECDH", public: imported }, privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function encryptMessage(sharedKey, text, isPrivate = false) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(text);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, enc);
  // payload contains iv and data; include "|private":true" marker inside JSON so receiver can detect
  return JSON.stringify({ iv: arrayBufferToBase64(iv), data: arrayBufferToBase64(cipher), private: !!isPrivate });
}

async function decryptMessage(sharedKey, payloadStr) {
  try {
    const payload = JSON.parse(payloadStr);
    const iv = base64ToArrayBuffer(payload.iv);
    const data = base64ToArrayBuffer(payload.data);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, sharedKey, data);
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    console.error("Decrypt failed:", e);
    return "[Entschlüsselungsfehler]";
  }
}

// ====== Helpers ======
function arrayBufferToBase64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function base64ToArrayBuffer(b64) { const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i); return arr.buffer; }
