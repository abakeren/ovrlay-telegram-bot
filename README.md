# OVRLAY Telegram Bot (Render.com)

## Deploy quick
1. Buat Web Service di https://render.com dari repo ini.
2. Environment Variables:
   - BOT_TOKEN = <token dari @BotFather>
   - CHAT_ID   = 7050797542
3. Start Command: (otomatis) `node bot.js`
4. Setelah live, test: `https://<app>.onrender.com/keywords.json`

## Perintah bot
- /add (format berbaris: title/price/image/aff/gender)
- /list
- /delete <slug>

Situs OVRLAY ganti JSON_URL ke endpoint di atas.
