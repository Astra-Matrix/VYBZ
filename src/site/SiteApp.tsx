import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./HomePage";
import { ProvenancePage, VaultPage, AgentsPage, PricingPage } from "./ProductPages";
import { DocsPage } from "./DocsPage";
import { SignInPage } from "./SignInPage";
import { ConsolePage } from "@/console/ConsolePage";

/** Paths owned by the platform site (public marketing, docs, legal, console). */
const SITE_PREFIXES = ["/provenance", "/vault", "/agents", "/pricing", "/docs", "/legal", "/signin", "/console"];

export function isSitePath(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true;
  return SITE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function SiteApp() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/provenance" element={<ProvenancePage />} />
      <Route path="/vault" element={<VaultPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/docs" element={<DocsPage />} />
      <Route path="/docs/:slug" element={<DocsPage />} />
      <Route path="/legal" element={<Navigate to="/legal/terms" replace />} />
      <Route path="/legal/:slug" element={<DocsPage legal />} />
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/console/*" element={<ConsolePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
