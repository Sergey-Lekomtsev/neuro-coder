import { Bot } from "grammy";

if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not defined");
}

const bot = new Bot(String(process.env.BOT_TOKEN));

export default bot;
