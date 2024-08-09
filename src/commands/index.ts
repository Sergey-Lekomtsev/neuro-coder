import { Composer } from "grammy";

import hello from "./hello";
import nad from "./nad";

const composer = new Composer();

composer.command("hello", hello);

composer.command("nad", nad);

export default composer;
