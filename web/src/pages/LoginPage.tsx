import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { AuthConfig } from "../lib/types";
import { useToast, useWorkspace } from "../app/Providers";
import { BrandMark } from "../components/BrandMark";
import { Banner, Button, Field, Input } from "../components/ui";

const LOCAL_DEV_LOGIN_TOKEN = "local-dev-login";

export function GoogleGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" style={{ flex: "none" }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.87-3.04.87-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.05l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.96 8.96 0 0 0 9 0 9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const { setEmail } = useWorkspace();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [loading, setLoading] = useState<"google" | "dev" | null>(null);
  const [error, setError] = useState<string | null>(
    params.get("error") === "unauthorized" ? "That account is not authorized for this workspace." : null,
  );
  const [email, setEmailInput] = useState("");

  useEffect(() => {
    document.title = "Sign in · Everstate";
    api.auth
      .config()
      .then(setConfig)
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : "Unable to load authentication settings."));
  }, []);

  const complete = async (result: { email?: string }) => {
    if (result?.email) {
      setEmail(result.email);
      try {
        sessionStorage.setItem("everstate_user_email", result.email);
      } catch {
        /* noop */
      }
    }
    toast("success", "Signed in", result?.email ? `Welcome, ${result.email}` : undefined);
    navigate("/", { replace: true });
  };

  const signInWithGoogle = async () => {
    if (!config) return;
    setLoading("google");
    setError(null);
    try {
      const { initializeApp, getApps } = await import("firebase/app");
      const { getAuth, GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
      const app = getApps()[0] ?? initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
      });
      const auth = getAuth(app);
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      const idToken = await credential.user.getIdToken();
      const result = await api.auth.session(idToken);
      await complete(result);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Google sign-in failed.";
      setError(message);
    } finally {
      setLoading(null);
    }
  };

  const signInAsDeveloper = async (identifier?: string) => {
    setLoading("dev");
    setError(null);
    try {
      const result = await api.auth.session(LOCAL_DEV_LOGIN_TOKEN);
      if (identifier?.trim() && result?.email) {
        setEmail(identifier.trim());
      }
      await complete({ email: identifier?.trim() || result?.email });
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : "Developer sign-in failed.";
      setError(message);
    } finally {
      setLoading(null);
    }
  };

  const googleAvailable = Boolean(config?.apiKey && config.apiKey !== "your_firebase_api_key_here");
  const domainList = Array.isArray(config?.allowedEmailDomains)
    ? config.allowedEmailDomains
    : String(config?.allowedEmailDomains ?? "")
        .split(",")
        .map((domain) => domain.trim())
        .filter(Boolean);
  const domains = domainList.length ? domainList.join(", ") : "your organization";

  return (
    <main className="login-page">
      <section className="login-story" aria-label="About Everstate">
        <svg className="login-orbit" viewBox="0 0 560 560" aria-hidden="true">
          <defs>
            <radialGradient id="orbit-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.4" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="280" cy="280" r="190" fill="url(#orbit-core)" opacity="0.35" />
          {[92, 148, 204, 256].map((radius) => (
            <circle
              key={radius}
              cx="280"
              cy="280"
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeOpacity={radius === 148 ? 0.35 : 0.18}
              strokeDasharray={radius === 204 ? "3 7" : undefined}
            />
          ))}
          <circle cx="280" cy="280" r="13" fill="currentColor" />
          <g className="orbit-node">
            <circle cx="280" cy="76" r="6" fill="currentColor" />
            <circle cx="280" cy="76" r="13" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          </g>
          <g className="orbit-node orbit-node-2">
            <circle cx="426" cy="356" r="5" fill="currentColor" />
            <circle cx="426" cy="356" r="11" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          </g>
          <g className="orbit-node orbit-node-3">
            <circle cx="132" cy="220" r="4" fill="currentColor" />
            <circle cx="132" cy="220" r="10" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          </g>
          <g className="orbit-node orbit-node-4">
            <circle cx="340" cy="462" r="4" fill="currentColor" />
            <circle cx="340" cy="462" r="10" fill="none" stroke="currentColor" strokeOpacity="0.4" />
          </g>
          <text x="292" y="72" fill="currentColor" fillOpacity="0.7" fontSize="10" fontFamily="Geist Mono, monospace" letterSpacing="1">ORG</text>
          <text x="438" y="352" fill="currentColor" fillOpacity="0.7" fontSize="10" fontFamily="Geist Mono, monospace" letterSpacing="1">TEAM</text>
          <text x="74" y="216" fill="currentColor" fillOpacity="0.7" fontSize="10" fontFamily="Geist Mono, monospace" letterSpacing="1">AGENT</text>
          <text x="352" y="458" fill="currentColor" fillOpacity="0.7" fontSize="10" fontFamily="Geist Mono, monospace" letterSpacing="1">USER</text>
        </svg>

        <div className="brand">
          <span className="brand-mark" style={{ inlineSize: 36, blockSize: 36, borderRadius: 11 }}>
            <BrandMark size={28} />
          </span>
          <span>
            <span className="brand-name" style={{ fontSize: "var(--text-title-3)" }}>Everstate</span>
            <span className="brand-sub">Agent memory</span>
          </span>
        </div>

        <div>
          <h1>
            Memory that learns while your agents <em>sleep.</em>
          </h1>
          <p className="lede">
            Everstate captures what your agents see and do, consolidates it overnight into reviewable memories, and serves
            them back in milliseconds — with no model call at recall time.
          </p>
          <div className="login-steps">
            <div className="login-step">
              <b>01 · Day</b>
              <strong>Capture</strong>
              <span>Chats, tool calls and sessions stream into an activity log.</span>
            </div>
            <div className="login-step">
              <b>02 · Night</b>
              <strong>Dream cycle</strong>
              <span>Gemini distills noise into durable, scoped memories.</span>
            </div>
            <div className="login-step">
              <b>03 · Always</b>
              <strong>Recall</strong>
              <span>Vector search answers in under 10 ms.</span>
            </div>
          </div>
        </div>

        <div className="login-foot">
          <span>Spanner · BigQuery · Gemini · Cloud Run</span>
          <span>Scoped by org → team → agent → user</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="eyebrow">Control center</div>
          <h2 className="login-title">Sign in</h2>
          <p className="login-sub">Use an authorized Google account or continue locally.</p>

          {error ? (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="error">{error}</Banner>
            </div>
          ) : null}

          <Button
            variant="primary"
            size="lg"
            loading={loading === "google"}
            disabled={!googleAvailable || loading !== null}
            onClick={signInWithGoogle}
            style={{ width: "100%" }}
          >
            {loading === "google" ? null : <GoogleGlyph />}
            Continue with Google
          </Button>
          {!googleAvailable ? (
            <p className="field-hint" style={{ marginTop: 8 }}>
              Set <code>FIREBASE_API_KEY</code> to enable Google sign-in.
            </p>
          ) : null}

          {config?.isLocalDev ? (
            <>
              <div className="divider-label">or</div>
              <Field label="Local identity" hint="Stored as the active user scope. Leave blank for the default developer identity.">
                <Input
                  value={email}
                  onChange={(event) => setEmailInput(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </Field>
              <Button
                size="lg"
                variant="secondary"
                icon="code"
                loading={loading === "dev"}
                disabled={loading !== null}
                onClick={() => signInAsDeveloper(email)}
                style={{ width: "100%", marginTop: 10 }}
              >
                Continue as local developer
              </Button>
            </>
          ) : null}

          <div className="auth-footer">
            <span>
              Allowed: <strong>{domains}</strong>
            </span>
            <span className="mono">v1.0</span>
          </div>
        </div>
      </section>
    </main>
  );
}
