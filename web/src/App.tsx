import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./lib/api";
import { AppShell, FullPageSpinner } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { ChatPage } from "./pages/ChatPage";
import { StudioPage } from "./pages/StudioPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";
import { useWorkspace } from "./app/Providers";

type AuthState = "loading" | "authenticated" | "anonymous";

function Protected({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const location = useLocation();
  const navigate = useNavigate();
  const { setEmail } = useWorkspace();

  useEffect(() => {
    let active = true;
    api.auth
      .me()
      .then((me) => {
        if (!active) return;
        if (me?.email) {
          setEmail(me.email);
          setState("authenticated");
        } else {
          setState("anonymous");
        }
      })
      .catch(() => {
        if (active) setState("anonymous");
      });
    const onUnauthorized = () => {
      setState("anonymous");
      navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
    };
    window.addEventListener("everstate:unauthorized", onUnauthorized);
    return () => {
      active = false;
      window.removeEventListener("everstate:unauthorized", onUnauthorized);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === "loading") return <FullPageSpinner />;
  if (state === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Protected>
      <AppShell>{children}</AppShell>
    </Protected>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Shell>
            <ChatPage />
          </Shell>
        }
      />
      <Route
        path="/studio"
        element={
          <Shell>
            <StudioPage />
          </Shell>
        }
      />
      <Route
        path="/how-it-works"
        element={
          <Shell>
            <HowItWorksPage />
          </Shell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
