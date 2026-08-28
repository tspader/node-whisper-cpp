import { fileURLToPath } from "node:url";

export { ensureModel } from "../tools/model";

export const wav = fileURLToPath(new URL("../asset/jfk.wav", import.meta.url));
