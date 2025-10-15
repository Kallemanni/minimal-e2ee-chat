// =========================
// client.js — Minimal E2EE Chat (Dark Mode + Private Message Highlighting)
// =========================

const $ = (id) => document.getElementById(id);

let ws;
let username = null;
let keyPair;
let publicKey;
let privateKey;
let users = {};
let selectedUser = null;

// =========================
// Initialisierung
// =========================
$("joinBtn").onclick = async () => {
  username = $("username").value.trim();
  if (!username) return alert("Bitte einen Nutzernamen eingeben!");

  // Schlüsselpaar erzeugen
  keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );

  publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  privateKey = keyPair.privateKey;

  const exported = arrayBufferToBase64(publicKey);
  
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  
  const ws = new WebSocket(`${wsProtocol}//${window.location.host}`);


  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "register",
        username,
        publicKey: exported,
      })
    );
  };

  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "userlist") updateUserList(msg.list);

    if (msg.type === "message") {
      const from = msg.from;
      const payload = msg.payload;
      const shared = await deriveSharedKey(from);
      const decrypted = await decryptMessage(shared, payload);

      // Private Nachrichten hervorheben, wenn sie nur zwischen zwei Nutzern waren
      const isPrivate = Object.keys(users).length > 2 && from !== username
        ? !selectedUser
        : true;

      addMessage(from, decrypted, from === username ? "self" : "remote", isPrivate);
    }
  };

  $("login").style.display = "none";
  $("chat").style.display = "grid";
};

// =========================
// Nutzerliste
// =========================
function updateUserList(list) {
  $("userlist").innerHTML = "";
  users = {};

  list.forEach((u) => {
    users[u.username] = u.publicKey;
    if (u.username === username) return;
    const li = document.createElement("li");
    li.textContent = u.username;
    li.onclick = () => selectUser(li, u.username);
    $("userlist").appendChild(li);
  });
}

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
  const modeBar = $("chatMode");
  if (selectedUser) {
    modeBar.textContent = `✉️ Privat an ${selectedUser}`;
    modeBar.classList.add("private");
  } else {
    modeBar.textContent = "💬 Gruppenchat (alle)";
    modeBar.classList.remove("private");
  }
}

// =========================
// Nachricht senden
// =========================
$("sendBtn").onclick = async () => {
  const text = $("message").value.trim();
  if (!text) return;

  let recipients = Object.keys(users).filter((u) => u !== username);
  let isPrivate = false;

  if (selectedUser) {
    recipients = [selectedUser];
    isPrivate = true;
  }

  if (recipients.length === 0) return alert("Keine anderen Nutzer online.");

  for (const to of recipients) {
    const shared = await deriveSharedKey(to);
    const encrypted = await encryptMessage(shared, text);
    ws.send(
      JSON.stringify({
        type: "send",
        from: username,
        to: [to],
        payload: encrypted,
      })
    );
  }

  addMessage(username, text, "self", isPrivate);
  $("message").value = "";
};

// =========================
// Nachricht anzeigen
// =========================
function addMessage(sender, text, type, isPrivate = false) {
  const li = document.createElement("li");
  li.textContent = `${sender}: ${text}`;
  li.className = type;
  if (isPrivate) li.classList.add("private-msg");

  $("messages").appendChild(li);
  $("messages").scrollTop = $("messages").scrollHeight;
}

// =========================
// Kryptofunktionen
// =========================
async function deriveSharedKey(peerName) {
  const peerKey = users[peerName];
  if (!peerKey) return null;
  const imported = await crypto.subtle.importKey(
    "spki",
    base64ToArrayBuffer(peerKey),
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: imported },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptMessage(sharedKey, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    encoded
  );
  return JSON.stringify({
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(cipher),
  });
}

async function decryptMessage(sharedKey, payload) {
  const obj = JSON.parse(payload);
  const iv = base64ToArrayBuffer(obj.iv);
  const data = base64ToArrayBuffer(obj.data);
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      data
    );
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Fehler bei Entschlüsselung:", e);
    return "[Fehlerhafte Nachricht]";
  }
}

// =========================
// Hilfsfunktionen
// =========================
function arrayBufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
