import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Routes, Route, Navigate, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSession } from "@/store/session";
import { DynamicBackground } from "@/components/DynamicBackground";
import { PageTransition } from "@/components/PageTransition";
import { LandingPage } from "@/pages/LandingPage";
import { Onboarding } from "@/components/Onboarding";
import { ComposeSheet } from "@/components/ComposeSheet";
import { GenerateSheet } from "@/features/generate/GenerateSheet";
import { LibraryDropHost } from "@/components/LibraryDropHost";
import { GrainOverlay } from "@/components/GrainOverlay";
import { ReactiveFrame } from "@/components/ReactiveFrame";
import { VDock } from "@/components/vdock/VDock";
import { SuiteShell } from "@/shell/SuiteShell";
import { AlphaWelcomeTour } from "@/features/alpha/AlphaWelcomeTour";
import { SparkHost } from "@/features/sparks/SparkHost";
import { ListenRecorder } from "@/features/reception/ListenRecorder";
import { AlphaFeedbackFab } from "@/features/alpha/AlphaFeedbackFab";
import { suitePlaceholderRoutes } from "@/app/suitePlaceholderRoutes";
import { ensureEliteFxDefault } from "@/lib/display";
import { BRAND_BG, surfaceForPath } from "@/lib/surfaceTheme";
import { useResolvedCosmetics } from "@/lib/cosmetics";
import { BG_VARIANTS } from "@/lib/backgrounds";
import { Toast } from "@/components/Toast";
import { Confetti } from "@/components/Confetti";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BrandMark } from "@/components/Brand";
import { GeometricBackdrop } from "@/components/GeometricBackdrop";
import { cx } from "@/lib/utils";
import { ownerProfilePath } from "@/shell/navModel";
import { ConnectPage } from "@/pages/ConnectPage";
import { OpportunitiesPage } from "@/pages/OpportunitiesPage";
import { ProfileEditPage } from "@/pages/ProfileEditPage";
import { UserProfilePage } from "@/pages/UserProfilePage";
import { WalletPage } from "@/pages/WalletPage";
import { SocialHomePage } from "@/pages/SocialHomePage";
import { ProjectPage } from "@/pages/ProjectPage";
import { MessagesPage } from "@/pages/MessagesPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { MessagePopoutProvider } from "@/lib/messagePopout";
import { MessagePopoutHost } from "@/components/MessagePopout";
import { CamCallProvider } from "@/lib/camCall";
import { CamCallOverlay } from "@/components/CamCallOverlay";
import { VideoMessageHost } from "@/components/VideoMessageHost";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectRoomPage } from "@/pages/ProjectRoomPage";
import { RoomsPage } from "@/pages/RoomsPage";
import { RoomPage } from "@/pages/RoomPage";
import { CodexPage } from "@/pages/CodexPage";
import { CodexDocPage } from "@/pages/CodexDocPage";
import { AdminPage } from "@/pages/AdminPage";
import { ModPage } from "@/pages/ModPage";
import { ModApplyPage } from "@/pages/ModApplyPage";
import { StorePage } from "@/pages/StorePage";
import { LivePage } from "@/pages/LivePage";
import { LiveWatchPage } from "@/pages/LiveWatchPage";
import { CompanionPage } from "@/pages/CompanionPage";
import { SocialPage } from "@/pages/SocialPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ArtistPage } from "@/pages/ArtistPage";
import { VibesRadioHost } from "@/features/radio/VibesRadioHost";
import { ListenEarnHost } from "@/components/ListenEarnHost";
import { LibraryPage } from "@/pages/LibraryPage";
import { LivingMixPage } from "@/features/livingMix/LivingMixPage";
import { TrackDetailPage } from "@/pages/TrackDetailPage";
import { VisualizerTutorialPage } from "@/pages/VisualizerTutorialPage";
import { VisualizerStudioPage } from "@/pages/VisualizerStudioPage";
import { FLAGS } from "@/lib/flags";
import { isPreparePath, PrepareLocalApp } from "@/features/prepare/PrepareLocalApp";
import { DesktopLocalApp, isDesktopLocalPath } from "@/platform/desktop/DesktopLocalApp";
import { AndroidLocalApp, isAndroidLocalPath } from "@/platform/android/AndroidLocalApp";
import { StorefrontDashboardPage } from "@/pages/StorefrontDashboardPage";
import { StorefrontEditorPage } from "@/pages/StorefrontEditorPage";
import { StorefrontPackPage } from "@/pages/StorefrontPackPage";
import { MarketPage } from "@/pages/MarketPage";
import { MetadataEditorPage } from "@/features/tools/MetadataEditorPage";
import { ArtCheckPage } from "@/features/tools/ArtCheckPage";
import { MidiMakerPage } from "@/features/tools/MidiMakerPage";
import { MediaConverterPage } from "@/features/tools/MediaConverterPage";
import { CorrectPage } from "@/features/correction/CorrectPage";
import { TranslationLabPage } from "@/features/translation/TranslationLabPage";
import { PackMakerPage } from "@/features/packs/PackMakerPage";
import { PackUploadStage } from "@/features/packPipeline/PackUploadStage";
import { PackSalesStage } from "@/features/packPipeline/PackSalesStage";
import { StemMakerPage } from "@/features/stems/StemMakerPage";
import { InviteRedeemPage } from "@/features/alpha/InviteRedeemPage";
import { PasswordLockPage } from "@/features/alpha/PasswordLockPage";
import { hasAlphaAccess } from "@/lib/alphaAccess";
import { needsPasswordLock } from "@/lib/passwordLock";
import { resolveE2eFixture } from "@/app/e2eFixtures";
import { SiteApp, isSitePath } from "@/site/SiteApp";

// Vite inlines import.meta.env at build time, so this folds to `false` for production
// and the fixture module is tree-shaken out. Enable only via `npm run build:e2e`.
const E2E_FIXTURES_ENABLED = import.meta.env.VITE_E2E_FIXTURES === "on";

export function App() {
  const { ready, userId, email, profile, backendEnabled } = useSession();
  const [feedKey, setFeedKey] = useState(0);
  const [composeOpen, setComposeOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const surface = surfaceForPath(location.pathname);
  const cosmetics = useResolvedCosmetics(profile?.equippedCosmetics);
  const equippedScene = cosmetics.backdrop?.bg;
  const shellBg =
    equippedScene && BG_VARIANTS.some((v) => v.id === equippedScene)
      ? equippedScene
      : surface.bg;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--accent-rgb", surface.accent);
    root.dataset.surfaceMode = surface.mode ?? "audience";
    root.classList.add("accent-fade");
    ensureEliteFxDefault();
  }, [surface.accent, surface.mode]);

  // Studio "Use on next drop" â†’ /?compose=1 opens Compose with IndexedDB backdrop handoff
  useEffect(() => {
    if (searchParams.get("compose") !== "1") return;
    setComposeOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("compose");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Playwright fixtures bypass auth / backend gates, so they exist only in e2e builds.
  if (E2E_FIXTURES_ENABLED) {
    const fixture = resolveE2eFixture(location.pathname);
    if (fixture) return fixture;
  }

  // Suite UX — Cost Sentinel / AI minutes withdrawn (redirect before auth / backend gates).
  if (location.pathname === "/settings/costs") {
    return <Navigate to="/" replace />;
  }
  if (location.pathname === "/settings/credits") {
    return <Navigate to="/store" replace />;
  }

  // Platform site (Provenance + Vault + Console) owns "/" and its own prefixes.
  // The legacy creator app is reachable only behind VITE_FEATURE_LEGACY_CREATOR=on.
  if (backendEnabled && ready && isSitePath(location.pathname)) {
    return <SiteApp />;
  }
  if (backendEnabled && ready && !FLAGS.legacyCreator) {
    if (FLAGS.prepare && isPreparePath(location.pathname)) return <PrepareLocalApp />;
    if (isDesktopLocalPath(location.pathname)) return <DesktopLocalApp />;
    if (isAndroidLocalPath(location.pathname)) return <AndroidLocalApp />;
    return <Navigate to="/" replace />;
  }

  if (!backendEnabled) {
    if (FLAGS.prepare && isPreparePath(location.pathname)) {
      return <PrepareLocalApp />;
    }
    if (isDesktopLocalPath(location.pathname)) {
      return <DesktopLocalApp />;
    }
    if (isAndroidLocalPath(location.pathname)) {
      return <AndroidLocalApp />;
    }
    return <div className="flex min-h-[100dvh] items-center justify-center px-8 text-center text-white/60">VYBZ backend not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</div>;
  }
  if (!ready) return (
    <>
      <DynamicBackground variant={BRAND_BG} mode="static" />
      <div className="relative z-10 flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[rgb(var(--accent-rgb)/0.85)]" aria-label="Loading" />
      </div>
    </>
  );

  const isPublicDoc = location.pathname.startsWith("/codex") || location.pathname.startsWith("/legal");
  const isPublicStorefront =
    FLAGS.storefront &&
    (location.pathname.startsWith("/pack/") || location.pathname === "/market");
  if (!userId) {
    if (FLAGS.prepare && isPreparePath(location.pathname)) {
      return <PrepareLocalApp />;
    }
    if (isDesktopLocalPath(location.pathname)) {
      return <DesktopLocalApp />;
    }
    if (isAndroidLocalPath(location.pathname)) {
      return <AndroidLocalApp />;
    }
    if (isPublicStorefront) return <PublicPackShell />;
    if (isPublicDoc) return <PublicDocShell />;
    if (location.pathname === "/enter" || location.pathname.startsWith("/enter/")) {
      return <Onboarding />;
    }
    return <LandingPage />;
  }
  // Signed in — wait for profile before deciding username vs hub (avoids false UsernameSetup).
  if (!profile) {
    return <><DynamicBackground variant={BRAND_BG} mode="static" /><div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-veil-300" /></div></>;
  }
  // One-time master password lock (after alpha wipe) — before suite shell.
  if (needsPasswordLock(email, profile)) {
    if (isPublicDoc) return <PublicDocShell />;
    return <PasswordLockPage />;
  }
  // OR-023 hard gate: invite key (or admin) before username / suite shell.
  if (!hasAlphaAccess(profile)) {
    if (isPublicDoc) return <PublicDocShell />;
    return <InviteRedeemPage />;
  }
  // The artist name is collected in step 2 of the welcome tour rather than by a
  // full-page blocker, so the first thing after sign-in is a welcome. The tour
  // re-opens while the name is missing, so it cannot be skipped past.
  // `UsernameSetup` stays in the tree, imported by nothing.

  const routes = (
    <ErrorBoundary key={location.pathname}>
      <AnimatePresence mode="wait" initial={false}>
        <PageTransition routeKey={location.pathname}>
          <Routes location={location}>
        <Route path="/" element={<SocialHomePage onCompose={() => setComposeOpen(true)} />} />
        <Route path="/workspace" element={<WorkspaceGateway />} />
        <Route path="/enter" element={<Navigate to="/" replace />} />
        <Route path="/feed" element={<Navigate to="/" replace />} />
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/activity" element={<Navigate to="/live" replace />} />
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/opportunities" element={<OpportunitiesPage />} />
        <Route path="/projects" element={<ProjectsPage onBulkUpload={() => setComposeOpen(true)} />} />
        <Route path="/projects/:id" element={<ProjectRoomPage />} />
        <Route path="/social" element={<SocialPage />} />
        <Route path="/live" element={<LivePage />} />
        <Route path="/live/:id/companion" element={<CompanionPage />} />
        <Route path="/live/:id" element={<LiveWatchPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:id" element={<MessagesPage />} />
        {/* NotificationsPage existed but was never routed — unreachable until now. */}
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/rooms/:id" element={<RoomPage />} />
        <Route path="/profile" element={<LegacyProfileRedirect />} />
        <Route path="/profile/edit" element={<ProfileEditPage />} />
        <Route path="/make/dashboard" element={<PackSalesStage />} />
        <Route path="/make" element={<PackUploadStage />} />
        <Route path="/library/mix/:listId" element={<LivingMixPage />} />
        <Route path="/library/mix" element={<LivingMixPage />} />
        <Route path="/library" element={<LibraryPage key={feedKey} onCompose={() => setComposeOpen(true)} />} />
        <Route path="/tools/metadata" element={<MetadataEditorPage />} />
        <Route path="/tools/art-check" element={<ArtCheckPage />} />
        <Route path="/tools/midi" element={<MidiMakerPage />} />
        <Route path="/tools/convert" element={<MediaConverterPage />} />
        <Route path="/tools/correct" element={<CorrectPage />} />
        <Route path="/tools/translate" element={<TranslationLabPage />} />
        <Route path="/tools/pack-maker" element={<PackMakerPage />} />
        <Route path="/tools/stems" element={<StemMakerPage />} />
        <Route path="/track/:id" element={<TrackDetailPage />} />
        <Route path="/visuals/tutorial" element={<VisualizerTutorialPage />} />
        <Route path="/visuals/studio" element={<VisualizerStudioPage />} />
        {FLAGS.storefront ? (
          <>
            <Route path="/tools/packs" element={<StorefrontDashboardPage />} />
            <Route path="/tools/packs/new" element={<StorefrontEditorPage />} />
            <Route path="/tools/packs/:id/edit" element={<StorefrontEditorPage />} />
            <Route path="/pack/:slug" element={<StorefrontPackPage />} />
            <Route path="/market" element={<MarketPage />} />
          </>
        ) : null}
        <Route path="/settings/costs" element={<Navigate to="/profile/edit" replace />} />
        <Route path="/settings/credits" element={<Navigate to="/store" replace />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/mod" element={<ModPage />} />
        <Route path="/apply-mod" element={<ModApplyPage />} />
        <Route path="/store" element={<StorePage />} />
        {suitePlaceholderRoutes()}
        <Route path="/u/:id" element={<UserProfilePage />} />
        <Route path="/artist/:slug" element={<ArtistPage />} />
        <Route path="/p/:id" element={<ProjectPage />} />
        <Route path="/codex" element={<CodexPage />} />
        <Route path="/codex/:slug" element={<CodexDocPage />} />
        <Route path="/legal/:slug" element={<CodexDocPage />} />
        <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </PageTransition>
      </AnimatePresence>
    </ErrorBoundary>
  );

  return (
    <MessagePopoutProvider>
      <CamCallProvider>
        <DynamicBackground variant={shellBg} />
        <GrainOverlay />
        <div className="pointer-events-none fixed inset-0 -z-10 bg-paper-50/35" />
        <SuiteShell
          stage={routes}
          surfaceMode={surface.mode ?? "audience"}
          onCompose={() => setComposeOpen(true)}
          onGenerate={() => setGenerateOpen(true)}
          onBulkUpload={() => setComposeOpen(true)}
          dock={(
            <ErrorBoundary>
              {/* Hide dock under upload sheets so Release / originality CTAs stay tappable */}
              <div className={cx((composeOpen || generateOpen) && "invisible pointer-events-none")}>
                <VDock onCompose={() => setComposeOpen(true)} />
              </div>
            </ErrorBoundary>
          )}
        />
        <ComposeSheet open={composeOpen} onClose={() => setComposeOpen(false)} onPosted={() => setFeedKey((k) => k + 1)} />
        <GenerateSheet
          open={generateOpen}
          onClose={() => setGenerateOpen(false)}
          onQueued={() => setComposeOpen(true)}
        />
        <LibraryDropHost
          enabled={!composeOpen && !generateOpen}
          onIngested={() => setFeedKey((k) => k + 1)}
        />
        <VibesRadioHost audience="member" yieldToUser />
        <SparkHost />
        <ListenRecorder />
        <ListenEarnHost />
        <MessagePopoutHost />
        <CamCallOverlay />
        <VideoMessageHost />
        <ReactiveFrame />
        {userId ? <AlphaWelcomeTour userId={userId} username={profile?.username ?? null} /> : null}
        <AlphaFeedbackFab />
        <Toast /><Confetti />
      </CamCallProvider>
    </MessagePopoutProvider>
  );
}

function PublicPackShell() {
  const location = useLocation();
  const onMarket = location.pathname === "/market";
  return (
    <div
      className="public-scroll-frame public-ops-shell nexus-void relative flex h-[100dvh] w-full flex-col overflow-hidden text-white"
      data-public-shell="pack"
      data-testid="public-pack-shell"
    >
      <GeometricBackdrop intensity="subtle" />
      <header className="public-ops-header forge-glass relative z-40 mx-3 mt-3 flex shrink-0 items-center gap-3 px-4 py-3 sm:mx-4">
        <span className="forge-glass-edge" aria-hidden />
        <NavLink to="/market" className="relative z-[1] flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="font-display text-sm font-semibold text-white">VYBZ</span>
        </NavLink>
        <span className="public-ops-badge relative z-[1] ml-auto hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline">
          {onMarket ? "Shop" : "Pack"}
        </span>
        <NavLink to="/enter" className="relative z-[1] forge-cta-ghost min-h-[2.25rem] px-3 py-1.5 text-xs">
          Enter
        </NavLink>
      </header>
      <main
        className="relative z-10 mx-auto w-full max-w-4xl flex-1 overflow-auto px-3 pb-4 sm:px-4"
        data-testid="public-pack-main"
      >
        <ErrorBoundary key={location.pathname}>
          <Routes location={location}>
            <Route path="/market" element={<MarketPage publicShell />} />
            <Route path="/pack/:slug" element={<StorefrontPackPage publicShell />} />
            <Route path="*" element={<Navigate to="/market" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

function PublicDocShell() {
  const location = useLocation();
  return (
    <div
      className="public-scroll-frame public-ops-shell nexus-void relative flex h-[100dvh] w-full flex-col overflow-hidden text-white"
      data-public-shell="docs"
      data-testid="public-doc-shell"
    >
      <GeometricBackdrop intensity="subtle" />
      <header className="public-ops-header forge-glass relative z-40 mx-3 mt-3 flex shrink-0 items-center gap-3 px-4 py-3 sm:mx-4">
        <span className="forge-glass-edge" aria-hidden />
        <NavLink to="/codex" className="relative z-[1] flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="font-display text-sm font-semibold text-white">VYBZ</span>
        </NavLink>
        <span className="public-ops-badge relative z-[1] ml-auto hidden rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline">
          Codex · Astra Matrix, Inc.
        </span>
        <NavLink to="/enter" className="relative z-[1] forge-cta-ghost min-h-[2.25rem] px-3 py-1.5 text-xs">
          Enter
        </NavLink>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 overflow-hidden px-1 sm:px-2">
        <ErrorBoundary key={location.pathname}>
          <Routes location={location}>
            <Route path="/codex" element={<CodexPage />} />
            <Route path="/codex/:slug" element={<CodexDocPage />} />
            <Route path="/legal/:slug" element={<CodexDocPage />} />
            <Route path="*" element={<Navigate to="/codex" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}

/** Archived Workspace — wallet still lives here; hub/dashboard tabs fold into the Stage File. */
function WorkspaceGateway() {
  const [params] = useSearchParams();
  const { userId } = useSession();
  const tab = params.get("tab") ?? "hub";
  if (tab === "wallet") return <WalletPage />;
  if (tab === "live") return <Navigate to="/live" replace />;
  if (tab === "listen") return <Navigate to="/" replace />;
  if (tab === "connect") return <Navigate to="/connect" replace />;
  return <Navigate to={ownerProfilePath(userId)} replace />;
}

/** Legacy /profile → owner Stage File (dashboard is that object, not Workspace). */
function LegacyProfileRedirect() {
  const { userId } = useSession();
  return <Navigate to={ownerProfilePath(userId)} replace />;
}
