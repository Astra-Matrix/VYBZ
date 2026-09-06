import { useSession } from "@/store/session";
import { SiteApp } from "@/site/SiteApp";

export function App() {
  const { backendEnabled } = useSession();
  if (!backendEnabled) {
    return (
      <div className="vz" style={{ display: "grid", placeItems: "center", minHeight: "100dvh", padding: 32, textAlign: "center" }}>
        <div>
          <p className="vz-eyebrow">Configuration</p>
          <h1 className="vz-h2">Backend not configured.</h1>
          <p className="vz-p">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. See docs/OPERATIONS.md.</p>
        </div>
      </div>
    );
  }
  return <SiteApp />;
}
