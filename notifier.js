const axios = require('axios');

class TelegramNotifier {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.chat = process.env.TELEGRAM_CHAT_ID;
    this.base = this.token ? `https://api.telegram.org/bot${this.token}/sendMessage` : null;
  }
  async send(text) {
    if (!this.base || !this.chat) return false;
    try {
      await axios.post(this.base, { chat_id: this.chat, text }, { timeout: 8000 });
      return true;
    } catch (e) { console.error('Telegram send failed:', e.message || e); return false; }
  }
}

class DiscordNotifier {
  constructor() { this.webhook = process.env.DISCORD_WEBHOOK_URL; }
  async send(text) {
    if (!this.webhook) return false;
    try {
      await axios.post(this.webhook, { content: text }, { timeout: 8000 });
      return true;
    } catch (e) { console.error('Discord webhook failed:', e.message || e); return false; }
  }
}

class WebhookNotifier {
  constructor() { this.url = process.env.WEBHOOK_URL; }
  async send(payload) {
    if (!this.url) return false;
    try {
      await axios.post(this.url, payload, { timeout: 8000 });
      return true;
    } catch (e) { console.error('Webhook send failed:', e.message || e); return false; }
  }
}

module.exports = { TelegramNotifier, DiscordNotifier, WebhookNotifier };
