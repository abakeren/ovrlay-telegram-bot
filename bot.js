// bot.js — Telegram bot + HTTP server for keywords.json (Render-ready, robust storage)
// Start command on Render: node bot.js
// ENV required on Render:
//   BOT_TOKEN = <token dari BotFather>
//   CHAT_ID   = <chat id yang diizinkan, bisa koma-separate untuk multi admin>
//   (opsional) PORT = 10000  → Render akan set PORT sendiri, gunakan process.env.PORT

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import TelegramBot from 'node-telegram-bot-api';

// ====== ENV ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ALLOW = (process.env.CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = process.env.PORT || 10000;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN missing');
  process.exit(1);
}
if (!CHAT_ALLOW.length) {
  console.warn('⚠️ CHAT_ID is empty. All chats will be allowed (NOT RECOMMENDED). Set CHAT_ID for safety.');
}

// ====== STORAGE (robust: auto-fix kalau "data" adalah file, bukan folder) ======
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'keywords.json');

try {
  if (fs.existsSync(DATA_DIR)) {
    const stat = fs.lstatSync(DATA_DIR);
    if (!stat.isDirectory()) {
      // kalau "data" ternyata file, hapus lalu buat folder
      fs.unlinkSync(DATA_DIR);
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.error('Storage init error (mkdir/unlink):', e);
}

try {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ items: [] }, null, 2));
  }
} catch (e) {
  console.error('Storage init error (create DATA_FILE):', e);
}

async function readJSON() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { items: [] };
  }
}
async function writeJSON(obj) {
  await fsp.writeFile(DATA_FILE, JSON.stringify(obj, null, 2));
}

// ====== UTILS ======
const slugify = (s = '') =>
  s.toLowerCase()
   .normalize('NFKD')
   .replace(/[^\w\s-]/g, '')
   .trim()
   .replace(/\s+/g, '-')
   .replace(/-+/g, '-');

const parseForm = (text) => {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const start = lines[0]?.toLowerCase().startsWith('/add') ? 1 : 0;
  const out = {};
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(\w+)\s*:\s*(.+)$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
};
const priceToText = (s = '') => s.trim(); // biarkan string (contoh: "Rp149.000")
const validGender = (g) => ['pria', 'wanita'].includes(String(g || '').toLowerCase());
const isAllowed = (chatId) => CHAT_ALLOW.length ? CHAT_ALLOW.includes(String(chatId)) : true;

// ====== TELEGRAM BOT (long polling) ======
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/^\/start/i, (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id,
`Halo! Kirim produk dengan format:
/add
title: Hoodie Zipper Minimal Abu
price: Rp149.000
image: https://example.com/hoodie.webp
aff: https://tokopedia.link/xxxx
gender: pria

Perintah lain:
/list           → 5 item terakhir
/delete <slug>  → hapus item
/help           → bantuan`);
});

bot.onText(/^\/help/i, (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id,
`Format:
/add
title: Kaos Oversize Putih
price: Rp89.000
image: https://example.com/kaos.webp
aff: https://tokopedia.link/xxxx
gender: pria|wanita

Catatan:
- 'gender' wajib (pria/wanita). Semua item tetap tampil di Promo Spesial.
- 'slug' dibuat otomatis dari title.`);
});

bot.onText(/^\/list/i, async (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  const data = await readJSON();
  const last = data.items.slice(-5).reverse();
  if (!last.length) return bot.sendMessage(msg.chat.id, 'Belum ada produk.');
  const lines = last.map(it => `• ${it.title} (${it.gender || '-'})\n  slug: ${it.slug}`);
  bot.sendMessage(msg.chat.id, lines.join('\n\n'));
});

bot.onText(/^\/delete\s+(.+)/i, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) return;
  const target = (match[1] || '').trim().toLowerCase();
  if (!target) return bot.sendMessage(msg.chat.id, 'Format: /delete <slug>');
  const data = await readJSON();
  const before = data.items.length;
  data.items = data.items.filter(it => (it.slug || '').toLowerCase() !== target);
  const removed = before - data.items.length;
  await writeJSON(data);
  bot.sendMessage(msg.chat.id, removed ? `✅ Hapus ${removed} item (slug: ${target})` : `❌ Item tidak ditemukan (slug: ${target})`);
});

bot.onText(/^\/add([\s\S]*)$/i, async (msg, match) => {
  if (!isAllowed(msg.chat.id)) return;
  const body = (match[1] || '').trim();
  const f = parseForm(body);

  const title = f.title;
  const price = priceToText(f.price || '');
  const image = f.image;
  const aff = f.aff;
  const gender = (f.gender || '').toLowerCase();

  const errs = [];
  if (!title) errs.push('title');
  if (!image) errs.push('image');
  if (!aff) errs.push('aff');
  if (!validGender(gender)) errs.push('gender (pria/wanita)');

  if (errs.length) {
    return bot.sendMessage(msg.chat.id, `❌ Field kurang/invalid: ${errs.join(', ')}\n\nContoh:\n/add\ntitle: Hoodie Zipper Minimal Abu\nprice: Rp149.000\nimage: https://...\naff: https://...\ngender: pria`);
  }

  const slug = slugify(title);
  const item = { slug, title, image, price, aff, gender, created_at: new Date().toISOString() };

  const data = await readJSON();
  data.items.push(item);
  await writeJSON(data);

  bot.sendMessage(msg.chat.id, `✅ Produk ditambahkan!\nTitle: ${title}\nSlug: ${slug}\nGender: ${gender}`);
});

// ====== HTTP SERVER (serve keywords.json) ======
const app = express();
app.use(cors());
app.use(bodyParser.json());

app.get('/', (_req, res) => {
  res.type('text/plain').send('OK — use /keywords.json');
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/keywords.json', async (_req, res) => {
  const data = await readJSON();
  res.set('Cache-Control', 'public, max-age=30');
  res.json(data);
});

app.get('/latest', async (req, res) => {
  const n = Math.max(1, Math.min(50, parseInt(req.query.n || '5', 10)));
  const data = await readJSON();
  const last = data.items.slice(-n).reverse();
  res.json(last);
});

app.listen(PORT, () => {
  console.log(`✅ HTTP on :${PORT} — /keywords.json ready`);
});
