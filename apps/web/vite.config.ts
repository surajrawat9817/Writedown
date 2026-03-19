import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

function normalizeBase(input: string | undefined): string {
  const raw = input && input.trim().length ? input.trim() : "/";
  if (raw === "/") return "/";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export default defineConfig(() => {
  const inferredRepo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const base = normalizeBase(process.env.VITE_BASE ?? (inferredRepo ? `/${inferredRepo}/` : "/"));

  return {
    base,
    plugins: [react()],
    resolve: {
      extensions: [".tsx", ".ts", ".jsx", ".js", ".json"]
    },
    server: {
      port: 5174
    }
  };
});
