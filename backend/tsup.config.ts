import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  bundle: true,
  // Lambda には node_modules がないのですべてバンドルする
  noExternal: [/.*/],
  // Node.js built-ins は外部のまま
  external: [/^node:/],
});
