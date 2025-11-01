// bot.js (ESM)
// Jalankan: node bot.js
// ENV yang diperlukan: BOT_TOKEN

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import TelegramBot from "node-telegram-bot-api";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== CONFIG ======
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN; // WAJIB
if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing (set di Render → Environment).");
  process.exit(1);
}

// Lokasi file data
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "keywords.json");

// Pastikan folder/file ada
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [] }, null, 2));
}

// ====== UTIL ======
function readDB() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return raw ? JSON.parse(raw) : { items: [] };
  } catch (e) {
    console.error("❌ readDB error:", e);
    return { items: [] };
  }
}

function writeDB(db) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    return true;
  } catch (e) {
    console.error("❌ writeDB error:", e);
    return false;
  }
}

function parseAddText(text) {
  // Terima format:
  // /add
  // title: ....
  // price: Rp...
  // image: https://...
  // aff: https://...
  // gender: pria|wanita (opsional)
  const get = (key) => {
    const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "i").exec(text?.replace(/\r/g, "") ?? "");
    return m ? m[1].trim() : "";
  };

  const item = {
    title: get("title"),
    price: get("price"),
    image: get("image"),
    aff: get("aff"),
    gender: get("gender"),
    created_at: new Date().toISOString(),
  };

  // Bersihin price jika ada spasi aneh
  if (item.price) item.price = item.price.replace(/\s+/g, " ");

  return item;
}

function validateItem(it) {
  const errs = [];
  if (!it.title) errs.push("title");
  if (!it.image) errs.push("image");
  if (!it.aff) errs.push("aff");
  // price boleh kosong (nanti tampil 'Cek harga')
  return errs;
}

// ====== EXPRESS API ======
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve JSON untuk homepage
app.get("/keywords.json", (req, res) => {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.type("application/json").send(raw);
  } catch (e) {
    console.error("❌ GET /keywords.json:", e);
    res.status(500).json({ error: "Failed to read data" });
  }
});

// Health check
app.get("/", (_, res) => res.send("OK • ovrlay-telegram-bot running"));

// Start server
app.listen(PORT, () => {
  console.log(`✅ API listening on :${PORT}`);
});

// ====== TELEGRAM BOT (polling) ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log("✅ Telegram bot polling started.");

bot.onText(/^\/start\b/i, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `Hai! Kirim produk dengan format:
    
/add
title: Nama Produk
price: Rp19.000
image: https://domain/foto.jpg
aff: https://link-affiliate
gender: pria|wanita (opsional)`,
    { disable_web_page_preview: true }
  );
});

// /add parser
bot.onText(/^\/add\b/i, async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || "";

  // Ambil semua baris setelah "/add"
  const payload = text.split(/\n/).slice(1).join("\n");
  const item = parseAddText(payload);
  const missing = validateItem(item);

  if (missing.length) {
    bot.sendMessage(
      chatId,
      `❌ Gagal: field wajib belum lengkap → ${missing.join(", ")}.

Contoh:
\`/add
title: Kaos Polos Pria & Wanita | Baju Polos Termurah
price: Rp19.000
image: https://s12.gifyu.com/images/xxx.jpg
aff: https://s.shopee.co.id/xxxxx
gender: pria\``,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );
    return;
  }

  // Simpan ke database
  const db = readDB();
  db.items ??= [];
  db.items.unshift(item); // terbaru di atas
  const ok = writeDB(db);

  if (!ok) {
    bot.sendMessage(chatId, "❌ Gagal menyimpan produk (server error).");
    return;
  }

  bot.sendMessage(
    chatId,
    `✅ Produk ditambahkan!\n*Title:* ${item.title}\n*Price:* ${item.price || "-"}\n*Gender:* ${item.gender || "-"}\n*Link:* ${item.aff}`,
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );

  if (item.image) {
    try {
      await bot.sendPhoto(chatId, item.image, { caption: item.title });
    } catch (e) {
      // Biarkan jika link gambar tidak bisa dipreview
    }
  }
});

// Fallback untuk pesan lain
bot.on("message", (msg) => {
  // biarin aja; fokus di /add
  if (!/^\/(add|start)\b/i.test(msg.text || "")) return;
});
