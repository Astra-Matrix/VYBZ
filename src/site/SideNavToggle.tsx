// Sidebar navigation that collapses into a single labelled button on small
// screens. On wide screens the button is hidden and the list is always shown.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";

export function SideNavToggle({ children, fallback = "Menu" }: { children: ReactNode; fallback?: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(fallback);
  const list = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
    const active = list.current?.querySelector("a.active");
    setLabel(active?.textContent?.trim() || fallback);
  }, [location.pathname, fallback]);

  return (
    <>
      <button type="button" className="vz-side-toggle" aria-expanded={open} aria-controls="vz-side-nav" onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        <ChevronDown size={16} aria-hidden style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </button>
      <div id="vz-side-nav" ref={list} className={`vz-side-nav${open ? " open" : ""}`}>{children}</div>
    </>
  );
}
