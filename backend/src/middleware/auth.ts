import type { MiddlewareHandler } from "hono";
import { basicAuth } from "hono/basic-auth";

import { getBasicAuthCredentials } from "../services/configService.js";

// コールドスタート時に資格情報を取得開始。以降のリクエストでは解決済みの Promise を返す
const credentialsPromise = getBasicAuthCredentials().catch((err) => {
  console.error("Failed to load Basic Auth credentials:", err);
  throw err;
});

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const credentials = await credentialsPromise;
  return basicAuth({ username: credentials.username, password: credentials.password })(c, next);
};
