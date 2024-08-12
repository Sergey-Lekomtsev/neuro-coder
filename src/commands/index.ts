import { Composer } from "grammy";

import hello from "./hello";
import clipmaker from "./clipmaker";
import leela from "./leela";

const composer = new Composer();

composer.command("hello", hello);

composer.command("clipmaker", clipmaker);

composer.command("leela", leela);

export default composer;
