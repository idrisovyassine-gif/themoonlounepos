const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || line.trim().startsWith("#") || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value.replace(/\\n/g, "\n");
  }
}

loadEnvFile();

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databasePath: process.env.DATABASE_PATH ? path.resolve(__dirname, "..", process.env.DATABASE_PATH) : path.join(__dirname, "..", "data", "pos.sqlite"),
  publicDir: path.join(__dirname, "..", "public"),
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS) || 14),
  telegramBotToken: String(process.env.TELEGRAM_BOT_TOKEN || "").trim(),
  telegramChatId: String(process.env.TELEGRAM_CHAT_ID || "").trim(),
  nodeEnv: process.env.NODE_ENV || "development"
};
