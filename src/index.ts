require("dotenv").config();

import commands from "./commands";
import bot from "./core/bot";
import { development, production } from "./utils/launch";

bot.use(commands);

bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    console.error(err.error);
    // Отправьте сообщение пользователю о том, что произошла ошибка
    ctx.reply("Извините, произошла ошибка при обработке вашего запроса. Пожалуйста, попробуйте позже.").catch((e) => {
        console.error("Error sending error message to user:", e);
    });
});

process.env.NODE_ENV === "development" ? development(bot) : production(bot);

export {};
