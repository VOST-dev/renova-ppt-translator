import { Hono } from "hono";
import { languageService } from "../services/languageService.js";

const languages = new Hono();

languages.get("/", async (c) => {
  const result = await languageService.listLanguages();
  return c.json({ languages: result });
});

export { languages };
