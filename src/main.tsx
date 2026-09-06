import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "@/App";
import { SessionProvider } from "@/store/session";
import "@fontsource/lexend/400.css";
import "@fontsource/lexend/500.css";
import "@fontsource/lexend/600.css";
import "@fontsource/lexend/700.css";
import "@/index.css";

const root = document.getElementById("root")!;
const app = (
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>
);

// Public pages ship prerendered markup (scripts/prerender.mjs); hydrate it.
// Everything else (console, sign in, dev server) mounts fresh.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
