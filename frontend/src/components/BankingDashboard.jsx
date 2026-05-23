/**
 * BankingDashboard.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3 — Complete Customer Dashboard
 *
 * Fully integrated with:
 *   ├─ transfer.controller.ts   — POST /api/v1/transfers/initiate
 *   │                             GET  /api/v1/transfers
 *   │                             GET  /api/v1/transfers/:transactionId
 *   ├─ authentication.service.ts — LoginResponse shape, accessToken, refreshToken
 *   ├─ websocket.gateway.ts      — namespace /api/v1/realtime
 *   │                             events: balance:updated, transaction:updated,
 *   │                             notification, connection, subscribed
 *   │                             emit:  subscribe:balance, subscribe:transaction
 *   ├─ upi-payment.service.ts    — UpiPaymentResult: transactionId, rrn,
 *   │                             txHash, blockchainStatus, message, timestamp
 *   ├─ schema.prisma             — TransactionStatus, BlockchainStatus enums,
 *   │                             Transaction, User, Account shapes
 *   ├─ app.module.ts             — CORS origin FRONTEND_URL, global prefix,
 *   │                             allowed headers: X-Idempotency-Key, X-Device-ID
 *   └─ auth.guard.ts             — Bearer token + X-Device-ID headers required
 *
 * Install dependencies:
 *   npm install socket.io-client uuid
 *
 * VITE env vars (create .env.local):
 *   VITE_API_URL=http://localhost:3000          ← matches PORT in .env.example
 *   VITE_WS_URL=http://localhost:3000           ← same host, WS on same port
 *   VITE_DEVICE_ID=web-dashboard-v1             ← sent as X-Device-ID header
 *
 * Usage:
 *   import BankingDashboard from './BankingDashboard';
 *
 *   // After successful login via AuthenticationService.login():
 *   const { accessToken, refreshToken, user } = loginResponse; // LoginResponse shape
 *
 *   <BankingDashboard
 *     accessToken={accessToken}
 *     refreshToken={refreshToken}
 *     userId={user.id}
 *     upiHandle={user.upiHandle}
 *     kycStatus={user.kycStatus}
 *     accountId={account.id}         // from GET /api/v1/accounts after login
 *     initialBalance={account.currentBalance}
 *     currency={account.currency}    // "MYSIM" per schema default
 *   />
 *
 * Save to: src/pages/Dashboard.jsx  OR  src/components/BankingDashboard.jsx
 */

import {
  useState, useEffect, useRef, useCallback, useMemo, useReducer,
} from "react";
import { v4 as uuidv4 } from "uuid";
import {
  ArrowUpRight, ArrowDownLeft, ShieldCheck, ShieldAlert, Clock,
  RefreshCw, AlertTriangle, CheckCircle2, XCircle, Loader2,
  Copy, Check, CreditCard, Link2, Bell, X, Eye, EyeOff, Send,
  Shield, LogOut, ChevronDown, Wifi, WifiOff, Hash,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// ENV — matches app.module.ts CORS origin (FRONTEND_URL) and .env.example PORT
// ─────────────────────────────────────────────────────────────────────────────
const BASE_URL  = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)
  || "http://localhost:3000";
const WS_URL    = (typeof import.meta !== "undefined" && import.meta.env?.VITE_WS_URL)
  || "http://localhost:3000";
// Namespace matches TransactionWebSocketGateway: namespace: '/api/v1/realtime'
const WS_NS     = "/api/v1/realtime";
// Matches localStorage key used in auth.guard.ts CORS device tracking
const DEVICE_ID = (typeof import.meta !== "undefined" && import.meta.env?.VITE_DEVICE_ID)
  || (() => {
    const stored = typeof localStorage !== "undefined" && localStorage.getItem("deviceId");
    if (stored) return stored;
    const id = "web-" + Math.random().toString(36).slice(2, 10);
    typeof localStorage !== "undefined" && localStorage.setItem("deviceId", id);
    return id;
  })();

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN STORAGE — mirrors AuthenticationService LoginResponse shape
// accessToken  → Authorization: Bearer <token>
// refreshToken → stored for silent renewal
// ─────────────────────────────────────────────────────────────────────────────
const TokenStore = {
  getAccess:   () => typeof localStorage !== "undefined" ? localStorage.getItem("accessToken")  : null,
  getRefresh:  () => typeof localStorage !== "undefined" ? localStorage.getItem("refreshToken") : null,
  setAccess:   (t) => typeof localStorage !== "undefined" && localStorage.setItem("accessToken", t),
  setRefresh:  (t) => typeof localStorage !== "undefined" && localStorage.setItem("refreshToken", t),
  clear:       () => {
    typeof localStorage !== "undefined" && localStorage.removeItem("accessToken");
    typeof localStorage !== "undefined" && localStorage.removeItem("refreshToken");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SANITISE — strip HTML injection, used on all text inputs before API calls
// ─────────────────────────────────────────────────────────────────────────────
const sanitise = (s) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/['"]/g, "").trim();

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATORS — mirrors backend validators-guards.ts patterns
// UPI_RE matches controller regex: /^[a-zA-Z0-9._-]{3,50}@mybank$/
// ─────────────────────────────────────────────────────────────────────────────
const UPI_RE = /^[a-zA-Z0-9._-]{3,50}@mybank$/;

function validateUpiHandle(h) {
  const v = sanitise(h);
  if (!v) return "UPI handle is required.";
  if (!UPI_RE.test(v)) return "Format: username@mybank (3–50 chars, alphanumeric)";
  return null;
}
function validateAmount(a) {
  const v = sanitise(a);
  if (!v) return "Amount is required.";
  const n = parseFloat(v);
  if (isNaN(n) || n <= 0) return "Enter a valid positive number.";
  // MIN 0.01 / MAX 100000 — matches upi-payment.service.ts constants
  if (n < 0.01) return "Minimum transfer is ₹0.01 MYSIM.";
  if (n > 100000) return "Maximum per transaction is ₹1,00,000 MYSIM.";
  // MAX_DECIMAL_PLACES = 6 from upi-payment.service.ts
  const dec = (v.split(".")[1] ?? "").length;
  if (dec > 6) return "Maximum 6 decimal places allowed.";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmtINR = (n) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(+n);

const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60)    return `${Math.floor(s)}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

// ─────────────────────────────────────────────────────────────────────────────
// HOOK — useApi
// Wraps fetch to match app.module.ts CORS allowedHeaders exactly:
//   Content-Type, Authorization, X-Idempotency-Key, X-Device-ID, X-Forwarded-For
// Handles 401 by attempting silent token refresh via AuthenticationService.
// ─────────────────────────────────────────────────────────────────────────────
function useApi(accessToken, onSessionExpired) {
  const tokenRef = useRef(accessToken);
  useEffect(() => { tokenRef.current = accessToken; }, [accessToken]);

  const call = useCallback(async (method, path, body = null, extraHeaders = {}) => {
    const doFetch = async (token) => {
      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        // X-Device-ID required by auth.guard.ts + transfer.controller.ts trackDeviceSession
        "X-Device-ID": DEVICE_ID,
        ...extraHeaders,
      };
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include", // for CORS credentials:true in app.module.ts
      });
      return res;
    };

    let res = await doFetch(tokenRef.current);

    // 401 — attempt silent token refresh (AuthenticationService.refreshAccessToken)
    if (res.status === 401) {
      const refreshToken = TokenStore.getRefresh();
      if (refreshToken) {
        try {
          const refreshRes = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Device-ID": DEVICE_ID },
            body: JSON.stringify({ refreshToken }),
            credentials: "include",
          });
          if (refreshRes.ok) {
            const { accessToken: newToken } = await refreshRes.json();
            TokenStore.setAccess(newToken);
            tokenRef.current = newToken;
            res = await doFetch(newToken);
          } else {
            TokenStore.clear();
            onSessionExpired?.();
            throw new Error("Session expired. Please log in again.");
          }
        } catch {
          TokenStore.clear();
          onSessionExpired?.();
          throw new Error("Session expired. Please log in again.");
        }
      } else {
        TokenStore.clear();
        onSessionExpired?.();
        throw new Error("Session expired. Please log in again.");
      }
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // NestJS returns { statusCode, message, error } — surface message field
      const msg = Array.isArray(data?.message)
        ? data.message.join(". ")
        : data?.message ?? `Request failed (HTTP ${res.status})`;
      throw new Error(msg);
    }
    return data;
  }, [onSessionExpired]);

  return { call };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK — useSocket
// Connects to TransactionWebSocketGateway:
//   namespace:  /api/v1/realtime       (websocket.gateway.ts line 30)
//   auth:       { token: accessToken } (handleConnection reads socket.handshake.auth.token)
//   transports: ['websocket','polling'] (matches gateway config)
// On connect: emits subscribe:balance with { accountId }
// ─────────────────────────────────────────────────────────────────────────────
function useSocket(accessToken, accountId) {
  const [wsStatus, setWsStatus] = useState("connecting");
  const socketRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!accessToken) { setWsStatus("disconnected"); return; }

    let socket;
    const connect = async () => {
      let io;
      try {
        // Try to import socket.io-client dynamically
        const mod = await import("socket.io-client").catch(() => null);
        io = mod?.io ?? mod?.default ?? window?.io;
        if (!io) { setWsStatus("error"); return; }
      } catch {
        // Fallback: global `io` injected via CDN script tag
        if (typeof window !== "undefined" && window.io) {
          io = window.io;
        } else {
          if (mountedRef.current) setWsStatus("error");
          return;
        }
      }

      socket = io(`${WS_URL}${WS_NS}`, {
        // auth.token is read by handleConnection in websocket.gateway.ts
        auth: { token: accessToken },
        transports: ["websocket", "polling"],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 15000,
        timeout: 10000,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        if (!mountedRef.current) return;
        setWsStatus("connected");
      });

      // Server emits 'connection' after auth — then subscribe to balance room
      // websocket.gateway.ts: socket.emit('connection', { status:'connected', userId })
      socket.on("connection", (payload) => {
        if (!mountedRef.current || !accountId) return;
        // subscribe:balance → handler in websocket.gateway.ts verifies account ownership
        socket.emit("subscribe:balance", { accountId });
      });

      socket.on("disconnect", (reason) => {
        if (!mountedRef.current) return;
        setWsStatus(reason === "io server disconnect" ? "disconnected" : "connecting");
      });

      socket.on("connect_error", () => {
        if (!mountedRef.current) return;
        setWsStatus("error");
      });
    };

    connect();
    return () => {
      mountedRef.current = false;
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [accessToken, accountId]);

  return { wsStatus, socketRef };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK — useClipboard
// ─────────────────────────────────────────────────────────────────────────────
function useClipboard() {
  const [copiedId, setCopiedId] = useState(null);
  const copy = useCallback((text, id) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {});
  }, []);
  return { copy, copiedId };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOK — useToasts
// Driven by websocket.gateway.ts 'notification' event:
//   { title, body, data, timestamp }
// Also used internally for payment confirmations.
// ─────────────────────────────────────────────────────────────────────────────
function useToasts(socketRef) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((title, body, variant = "info") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p.slice(-4), { id, title, body, variant }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5500);
  }, []);

  const dismiss = useCallback((id) => setToasts(p => p.filter(t => t.id !== id)), []);

  // Listen for server 'notification' events from WebSocketBroadcastService
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;
    const handler = ({ title, body }) => push(title, body, "server");
    socket.on("notification", handler);
    return () => socket.off("notification", handler);
  }, [socketRef, push]);

  return { toasts, push, dismiss };
}

// ─────────────────────────────────────────────────────────────────────────────
// UI — ConnectionPill
// Shows live Socket.io status matching wsStatus from useSocket
// ─────────────────────────────────────────────────────────────────────────────
function ConnectionPill({ status }) {
  const cfg = {
    connected:    { label: "Live",         cls: "text-emerald-400 border-emerald-400/25 bg-emerald-400/8" },
    connecting:   { label: "Connecting…",  cls: "text-amber-400  border-amber-400/25  bg-amber-400/8"  },
    disconnected: { label: "Offline",      cls: "text-red-400    border-red-400/25    bg-red-400/8"    },
    error:        { label: "WS Error",     cls: "text-red-400    border-red-400/25    bg-red-400/8"    },
  };
  const { label, cls } = cfg[status] ?? cfg.disconnected;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono border px-2 py-0.5 rounded-full ${cls}`}>
      {status === "connected"
        ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        : status === "connecting"
        ? <Loader2 size={9} className="animate-spin" />
        : <span className="w-1.5 h-1.5 rounded-full bg-red-400" />}
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI — BlockchainBadge
// Driven by BlockchainStatus enum from schema.prisma:
//   PENDING | ANCHORED | VERIFIED | FAILED | DISPUTED
// ─────────────────────────────────────────────────────────────────────────────
function BlockchainBadge({ status, txHash, onCopy, copiedId }) {
  const shortHash = txHash ? txHash.slice(0, 10) + "…" : null;
  if (status === "ANCHORED" || status === "VERIFIED") {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-mono font-semibold tracking-wider px-1.5 py-0.5 rounded border border-emerald-500/35 bg-emerald-500/8 text-emerald-400 uppercase">
        <ShieldCheck size={9} />
        {status === "VERIFIED" ? "Verified on-chain" : "Anchored"}
        {shortHash && (
          <button
            onClick={() => onCopy?.(txHash, `hash-${txHash?.slice(0,8)}`)}
            className="ml-1 text-emerald-600 hover:text-emerald-300 transition-colors"
            title={txHash}
          >
            {copiedId === `hash-${txHash?.slice(0,8)}` ? <Check size={8} /> : <Copy size={8} />}
          </button>
        )}
      </span>
    );
  }
  if (status === "FAILED" || status === "DISPUTED") {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-mono tracking-wider px-1.5 py-0.5 rounded border border-red-500/35 bg-red-500/8 text-red-400 uppercase">
        <ShieldAlert size={9} /> {status === "DISPUTED" ? "Disputed" : "Anchor failed"}
      </span>
    );
  }
  // PENDING
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-mono tracking-wider px-1.5 py-0.5 rounded border border-zinc-700/60 bg-zinc-800/50 text-zinc-500 uppercase">
      <Clock size={9} className="animate-pulse" /> Pending
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI — TxStatusBadge
// Driven by TransactionStatus enum from schema.prisma:
//   PENDING | PROCESSING | SETTLED | FAILED | ROLLED_BACK | CANCELLED
// ─────────────────────────────────────────────────────────────────────────────
function TxStatusBadge({ status }) {
  const cls = {
    SETTLED:     "text-emerald-400 border-emerald-500/30 bg-emerald-500/8",
    PROCESSING:  "text-amber-400   border-amber-500/30  bg-amber-500/8",
    PENDING:     "text-amber-400   border-amber-500/30  bg-amber-500/8",
    FAILED:      "text-red-400     border-red-500/30    bg-red-500/8",
    ROLLED_BACK: "text-red-400     border-red-500/30    bg-red-500/8",
    CANCELLED:   "text-zinc-500    border-zinc-600/30   bg-zinc-800/50",
  }[status] ?? "text-zinc-500 border-zinc-700/30 bg-zinc-800/50";
  return (
    <span className={`text-[9px] font-mono tracking-widest border px-1.5 py-0.5 rounded uppercase ${cls}`}>
      {status?.replace("_", " ") ?? "UNKNOWN"}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT — BalanceTile
//
// Subscribes to 'balance:updated' from WebSocketBroadcastService.notifyBalanceUpdate()
//   payload: { accountId: string, newBalance: string, timestamp: string }
// Matches websocket.gateway.ts broadcastBalanceUpdate() which emits to
//   account:<accountId> room AND user:<userId> room
// ─────────────────────────────────────────────────────────────────────────────
function BalanceTile({ initialBalance, currency, upiHandle, accountId, socketRef }) {
  const [balance,    setBalance]    = useState(parseFloat(initialBalance ?? 0));
  const [flashDir,   setFlashDir]   = useState(null); // "credit"|"debit"|null
  const [lastDelta,  setLastDelta]  = useState(null);
  const [masked,     setMasked]     = useState(false);
  const [liveAt,     setLiveAt]     = useState(null);
  const prevBalRef = useRef(parseFloat(initialBalance ?? 0));

  // Listen for balance:updated — event from broadcastBalanceUpdate() in gateway
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;

    const handler = (payload) => {
      // payload.accountId matches our accountId — guard against other users' events
      if (payload.accountId && payload.accountId !== accountId) return;
      const nb    = parseFloat(payload.newBalance);
      const delta = nb - prevBalRef.current;
      prevBalRef.current = nb;
      setBalance(nb);
      setLastDelta(delta);
      setFlashDir(delta >= 0 ? "credit" : "debit");
      setLiveAt(new Date(payload.timestamp ?? Date.now()));
      setTimeout(() => setFlashDir(null), 2000);
    };

    socket.on("balance:updated", handler);
    return () => socket.off("balance:updated", handler);
  }, [socketRef, accountId]);

  const ringCls =
    flashDir === "credit" ? "ring-2 ring-emerald-400/50 shadow-[0_0_20px_rgba(52,211,153,0.12)]"
    : flashDir === "debit"  ? "ring-2 ring-red-400/50    shadow-[0_0_20px_rgba(248,113,113,0.12)]"
    : "";

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-all duration-700 ${ringCls}`}>
      {/* Ambient grid */}
      <div className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.015) 1px,transparent 1px)", backgroundSize: "24px 24px" }} />
      {/* Green radial accent */}
      <div className="pointer-events-none absolute top-0 right-0 w-32 h-32 opacity-15"
        style={{ background: "radial-gradient(circle at top right,#34d399,transparent 65%)" }} />

      <div className="relative p-6">
        {/* Header row */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] font-mono text-zinc-500 tracking-[0.18em] uppercase mb-1">
              Available Balance
            </p>
            <p className="text-[10px] font-mono text-zinc-700">{upiHandle}</p>
          </div>
          <div className="flex items-center gap-2">
            {liveAt && (
              <span className="text-[9px] font-mono text-zinc-700">
                updated {timeAgo(liveAt)}
              </span>
            )}
            <button
              onClick={() => setMasked(m => !m)}
              className="p-1.5 rounded-lg border border-zinc-800 text-zinc-600 hover:text-zinc-300 hover:border-zinc-700 transition-all"
              aria-label={masked ? "Show balance" : "Hide balance"}
            >
              {masked ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>
        </div>

        {/* Balance number */}
        <div className="mb-1">
          <span className="font-mono text-base text-zinc-500 mr-2">{currency}</span>
          <span className={`font-mono text-4xl font-semibold tracking-tight transition-colors duration-700
            ${flashDir === "credit" ? "text-emerald-400"
              : flashDir === "debit" ? "text-red-400"
              : "text-white"}`}
          >
            {masked ? "•••••••" : fmtINR(balance)}
          </span>
        </div>

        {/* Delta flash line */}
        <div className={`h-4 transition-opacity duration-500 ${lastDelta !== null && flashDir ? "opacity-100" : "opacity-0"}`}>
          {lastDelta !== null && (
            <span className={`text-xs font-mono ${lastDelta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {lastDelta >= 0 ? "▲ +" : "▼ "}{fmtINR(Math.abs(lastDelta))} {currency}
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="mt-5 pt-4 border-t border-zinc-800/80 flex items-center justify-between">
          <span className="text-[9px] font-mono text-zinc-700 tracking-widest uppercase">
            Core Banking · Simulation
          </span>
          <span className="text-[9px] font-mono text-zinc-700">
            {accountId ? `····${accountId.slice(-6)}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT — UpiTransferForm
//
// Calls: POST /api/v1/transfers/initiate  (transfer.controller.ts:620)
// Body:  { receiverHandle, amount, description }   (InitiateTransferDTO)
// Headers sent (all required by auth.guard.ts + app.module.ts allowedHeaders):
//   Authorization:     Bearer <accessToken>
//   X-Idempotency-Key: UUIDv4 — generated fresh ON EACH click, never on render
//   X-Device-ID:       DEVICE_ID constant
// Response: UpiPaymentResult from upi-payment.service.ts:
//   { success, transactionId, rrn, txHash, blockchainStatus, message, timestamp }
// ─────────────────────────────────────────────────────────────────────────────
function UpiTransferForm({ call, onSuccess, pushToast, socketRef }) {
  const [fields, setFields]       = useState({ receiver: "", amount: "", description: "" });
  const [errors, setErrors]       = useState({});
  const [apiError, setApiError]   = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]       = useState(null);
  const [idemKeyDisplay, setIdemKeyDisplay] = useState(null);

  const set = (k) => (e) => {
    // Strip HTML injection from all inputs
    const clean = e.target.value.replace(/[<>]/g, "");
    setFields(p => ({ ...p, [k]: clean }));
    if (errors[k]) setErrors(p => ({ ...p, [k]: null }));
    if (apiError) setApiError(null);
  };

  const validate = () => {
    const errs = {};
    const upiErr = validateUpiHandle(fields.receiver);
    const amtErr = validateAmount(fields.amount);
    if (upiErr) errs.receiver = upiErr;
    if (amtErr) errs.amount   = amtErr;
    if (fields.description.length > 500) errs.description = "Max 500 characters.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError(null);
    setResult(null);
    if (!validate()) return;

    // ── CRITICAL: Generate fresh UUIDv4 idempotency key at button-click time ──
    // This matches the idempotency check in upi-payment.service.ts Phase 2.
    // Never reuse a key — each click gets a new one to prevent double-spend
    // while preserving replay safety within the 120-second cache window.
    const idempotencyKey = uuidv4();
    setIdemKeyDisplay(idempotencyKey);

    setSubmitting(true);
    try {
      // Headers match app.module.ts allowedHeaders and auth.guard.ts requirements
      const data = await call(
        "POST",
        "/api/v1/transfers/initiate",
        {
          // Body fields match InitiateTransferDTO in transfer.controller.ts
          receiverHandle: sanitise(fields.receiver),
          amount: parseFloat(sanitise(fields.amount)),
          description: sanitise(fields.description) || "UPI Transfer",
        },
        // X-Idempotency-Key wired into upi-payment.service.ts idempotency check
        { "X-Idempotency-Key": idempotencyKey },
      );

      setResult(data); // UpiPaymentResult shape

      // Subscribe newly created transaction to live updates from WebSocket gateway
      if (socketRef?.current && data.transactionId) {
        // subscribe:transaction → websocket.gateway.ts verifies ownership
        socketRef.current.emit("subscribe:transaction", { transactionId: data.transactionId });
      }

      // Bubble up to parent (Dashboard) so TransactionLog can prepend the new tx
      onSuccess?.(data);

      pushToast(
        "Payment Sent",
        `${sanitise(fields.amount)} ${""} → ${sanitise(fields.receiver)}`,
        "success",
      );

      setFields({ receiver: "", amount: "", description: "" });
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const input = (err) =>
    `w-full bg-zinc-950 border rounded-xl px-4 py-3 font-mono text-sm text-white placeholder-zinc-700 focus:outline-none transition-all ${
      err
        ? "border-red-500/50 focus:border-red-500/60 focus:ring-1 focus:ring-red-500/15"
        : "border-zinc-800 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/10"
    }`;

  if (result) return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 text-center">
      <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mx-auto mb-3">
        <CheckCircle2 className="text-emerald-400" size={18} />
      </div>
      <p className="font-mono font-semibold text-emerald-400 text-sm mb-1">Transfer Sent</p>
      <p className="text-zinc-500 text-xs font-mono mb-4 leading-relaxed">{result.message}</p>

      {/* Result summary — UpiPaymentResult fields */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-left space-y-2.5 mb-4">
        <InfoRow label="RRN"        value={result.rrn}    mono copyable />
        <InfoRow label="TX ID"      value={`${result.transactionId?.slice(0, 16)}…`} mono />
        <InfoRow label="Timestamp"  value={new Date(result.timestamp).toLocaleTimeString("en-IN")} mono />
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Blockchain</span>
          <BlockchainBadge status={result.blockchainStatus} txHash={result.txHash} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Idem Key</span>
          <span className="text-[9px] font-mono text-zinc-700 truncate max-w-[140px]">{idemKeyDisplay}</span>
        </div>
      </div>

      <button
        onClick={() => { setResult(null); setIdemKeyDisplay(null); }}
        className="text-xs font-mono text-zinc-600 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-700 rounded-lg px-4 py-2 transition-all"
      >
        New Transfer
      </button>
    </div>
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">

      {/* Receiver UPI Handle */}
      <div>
        <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-[0.16em] mb-2">
          Recipient UPI Handle
        </label>
        <input
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          maxLength={55}
          placeholder="username@mybank"
          value={fields.receiver}
          onChange={set("receiver")}
          className={input(errors.receiver)}
          aria-invalid={!!errors.receiver}
        />
        {errors.receiver && <FieldError msg={errors.receiver} />}
      </div>

      {/* Amount */}
      <div>
        <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-[0.16em] mb-2">
          Amount (MYSIM)
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono text-zinc-600 text-sm select-none">₹</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            max="100000"
            step="0.000001"
            placeholder="0.00"
            value={fields.amount}
            onChange={set("amount")}
            className={`${input(errors.amount)} pl-8`}
            aria-invalid={!!errors.amount}
          />
        </div>
        {errors.amount && <FieldError msg={errors.amount} />}
      </div>

      {/* Description */}
      <div>
        <label className="block text-[10px] font-mono text-zinc-500 uppercase tracking-[0.16em] mb-2">
          Note <span className="normal-case text-zinc-700">(optional · max 500 chars)</span>
        </label>
        <input
          type="text"
          maxLength={500}
          placeholder="e.g. Rent for May"
          value={fields.description}
          onChange={set("description")}
          className={input(errors.description)}
        />
        {errors.description && <FieldError msg={errors.description} />}
      </div>

      {/* API error — surfaces NestJS error messages */}
      {apiError && (
        <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/25 rounded-xl px-4 py-3">
          <XCircle className="text-red-400 shrink-0 mt-0.5" size={13} />
          <p className="text-xs font-mono text-red-400 leading-relaxed">{apiError}</p>
        </div>
      )}

      {/* Last idempotency key display — transparency / debug */}
      {idemKeyDisplay && !result && (
        <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800/80 rounded-lg px-3 py-2">
          <Link2 size={9} className="text-zinc-700 shrink-0" />
          <span className="text-[9px] font-mono text-zinc-700 truncate">
            idem: {idemKeyDisplay}
          </span>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className={`w-full flex items-center justify-center gap-2 rounded-xl py-3.5 font-mono font-semibold text-sm tracking-wide transition-all duration-200 ${
          submitting
            ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
            : "bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-zinc-950 shadow-lg shadow-emerald-500/15"
        }`}
      >
        {submitting
          ? <><Loader2 size={15} className="animate-spin" /> Processing…</>
          : <><Send size={14} /> Pay Now</>}
      </button>

      <p className="text-center text-[9px] font-mono text-zinc-700 leading-relaxed">
        Fresh UUIDv4 on each click · ACID SELECT FOR UPDATE · BankingAuditLedger.sol
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT — TransactionRow
// Renders one row from GET /api/v1/transfers response.
// Transaction shape from transfer.controller.ts getTransactionHistory():
//   { id, rrn, senderId, amount, currency, description, status,
//     blockchainStatus, txHash, createdAt, sender.upiHandle, receiver.upiHandle }
// ─────────────────────────────────────────────────────────────────────────────
function TransactionRow({ tx, currentUserId, copy, copiedId }) {
  const isSender    = tx.senderId === currentUserId;
  const counterparty = isSender ? tx.receiver?.upiHandle : tx.sender?.upiHandle;
  const amount      = parseFloat(tx.amount);

  return (
    <div className="group flex items-start gap-3 px-3 py-3 rounded-xl hover:bg-zinc-800/30 border border-transparent hover:border-zinc-800/50 transition-all">
      {/* Direction icon */}
      <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 border ${
        isSender
          ? "bg-red-500/8 border-red-500/20 text-red-400"
          : "bg-emerald-500/8 border-emerald-500/20 text-emerald-400"
      }`}>
        {isSender ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
      </div>

      {/* Middle */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className="text-xs font-mono text-zinc-300 truncate max-w-[140px]">
            {counterparty ?? "Unknown"}
          </span>
          <TxStatusBadge status={tx.status} />
        </div>

        {/* RRN — 12-char format: YYYY+DDD+6hex as per upi-payment.service.ts */}
        <div className="flex items-center gap-1 mb-1">
          <Hash size={8} className="text-zinc-700" />
          <span className="text-[9px] font-mono text-zinc-600 tracking-widest">
            {tx.rrn}
          </span>
          <button
            onClick={() => copy(tx.rrn, `rrn-${tx.id}`)}
            className="opacity-0 group-hover:opacity-100 text-zinc-700 hover:text-zinc-400 transition-all"
            title="Copy RRN"
          >
            {copiedId === `rrn-${tx.id}`
              ? <Check size={8} className="text-emerald-400" />
              : <Copy size={8} />}
          </button>
        </div>

        {tx.description && (
          <p className="text-[9px] font-mono text-zinc-700 truncate mb-1">{tx.description}</p>
        )}

        {/* Blockchain badge — driven by BlockchainStatus enum */}
        <BlockchainBadge
          status={tx.blockchainStatus}
          txHash={tx.txHash}
          onCopy={copy}
          copiedId={copiedId}
        />
      </div>

      {/* Right column */}
      <div className="text-right shrink-0">
        <p className={`font-mono font-semibold text-sm ${isSender ? "text-red-400" : "text-emerald-400"}`}>
          {isSender ? "−" : "+"}{fmtINR(amount)}
        </p>
        <p className="text-[9px] font-mono text-zinc-700 mt-0.5">{tx.currency ?? "MYSIM"}</p>
        <p className="text-[9px] font-mono text-zinc-700 mt-1">{timeAgo(tx.createdAt)}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT — TransactionLog
//
// Fetches: GET /api/v1/transfers?page=1&limit=12
// Response: { data: Transaction[], pagination: { page, limit, total, pages } }
//   (from transfer.controller.ts getTransactionHistory)
//
// After new payment: fetches GET /api/v1/transfers/:transactionId to get
//   the full object with sender/receiver relations, then prepends to list.
//
// Live updates: listens for 'transaction:updated' from broadcastTransactionUpdate()
//   payload: { transactionId, status, blockchainStatus?, timestamp, ...data }
//   Updates status + blockchainStatus in-place without refetch.
// ─────────────────────────────────────────────────────────────────────────────
function TransactionLog({ currentUserId, call, socketRef, newTxResult }) {
  const [txs,       setTxs]       = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [page,      setPage]      = useState(1);
  const [totalPages,setTotalPages]= useState(1);
  const [refreshing,setRefreshing]= useState(false);
  const { copy, copiedId } = useClipboard();

  // Fetch history from GET /api/v1/transfers — matches getTransactionHistory()
  const fetchHistory = useCallback(async (p = 1, silent = false) => {
    if (!silent) setLoading(p === 1);
    setError(null);
    try {
      const data = await call("GET", `/api/v1/transfers?page=${p}&limit=12`);
      if (p === 1) setTxs(data.data ?? []);
      else setTxs(prev => [...prev, ...(data.data ?? [])]);
      setTotalPages(data.pagination?.pages ?? 1);
      setPage(p);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [call]);

  useEffect(() => { fetchHistory(1); }, [fetchHistory]);

  // Prepend new tx after successful UpiTransferForm submission
  useEffect(() => {
    if (!newTxResult?.transactionId) return;
    // Fetch full TX object (includes sender/receiver relations)
    // GET /api/v1/transfers/:transactionId from getTransaction()
    call("GET", `/api/v1/transfers/${newTxResult.transactionId}`)
      .then(detail => {
        setTxs(prev => {
          if (prev.some(t => t.id === detail.id)) return prev;
          return [{ ...detail, amount: detail.amount?.toString() }, ...prev];
        });
      })
      .catch(() => {
        // Optimistic insert with data from UpiPaymentResult if fetch fails
        setTxs(prev => {
          if (prev.some(t => t.id === newTxResult.transactionId)) return prev;
          return [{
            id: newTxResult.transactionId,
            rrn: newTxResult.rrn,
            txHash: newTxResult.txHash,
            blockchainStatus: newTxResult.blockchainStatus,
            status: "SETTLED",
            amount: "0",
            currency: "MYSIM",
            description: "",
            senderId: currentUserId,
            createdAt: newTxResult.timestamp,
            sender: { upiHandle: "you" },
            receiver: { upiHandle: "—" },
          }, ...prev];
        });
      });
  }, [newTxResult, call, currentUserId]);

  // Live status updates via 'transaction:updated' event
  // Emitted by broadcastTransactionUpdate() in websocket.gateway.ts
  // payload: { transactionId, status, timestamp, blockchainStatus?, ... }
  useEffect(() => {
    const socket = socketRef?.current;
    if (!socket) return;
    const handler = (payload) => {
      setTxs(prev => prev.map(tx =>
        tx.id === payload.transactionId
          ? {
              ...tx,
              status: payload.status ?? tx.status,
              blockchainStatus: payload.blockchainStatus ?? tx.blockchainStatus,
            }
          : tx
      ));
    };
    socket.on("transaction:updated", handler);
    return () => socket.off("transaction:updated", handler);
  }, [socketRef]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHistory(1, true);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-mono font-semibold text-zinc-300">Transaction Log</h2>
          <p className="text-[9px] font-mono text-zinc-700 mt-0.5">
            Newest first · RRN + Blockchain status live
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 rounded-lg border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700 transition-all disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center py-14 gap-3">
          <Loader2 className="text-zinc-700 animate-spin" size={22} />
          <p className="text-[10px] font-mono text-zinc-700">Loading transactions…</p>
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 bg-red-500/8 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={13} />
          <div>
            <p className="text-xs font-mono text-red-400 font-semibold mb-0.5">Failed to load</p>
            <p className="text-[10px] font-mono text-red-400/70">{error}</p>
            <button
              onClick={() => fetchHistory(1)}
              className="text-[10px] font-mono text-red-400 underline mt-1"
            >
              Retry
            </button>
          </div>
        </div>
      ) : txs.length === 0 ? (
        <div className="text-center py-14">
          <div className="w-12 h-12 rounded-2xl border border-zinc-800 bg-zinc-900 flex items-center justify-center mx-auto mb-3">
            <CreditCard size={18} className="text-zinc-700" />
          </div>
          <p className="text-[10px] font-mono text-zinc-600">No transactions yet.</p>
          <p className="text-[9px] font-mono text-zinc-700 mt-1">Send your first UPI payment.</p>
        </div>
      ) : (
        <>
          <div className="space-y-0.5">
            {txs.map(tx => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                currentUserId={currentUserId}
                copy={copy}
                copiedId={copiedId}
              />
            ))}
          </div>
          {page < totalPages && (
            <button
              onClick={() => fetchHistory(page + 1)}
              className="w-full mt-3 py-2.5 text-[10px] font-mono text-zinc-600 hover:text-zinc-400 border border-zinc-800/80 hover:border-zinc-700 rounded-xl transition-all flex items-center justify-center gap-1.5"
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT — ToastStack
// Renders toasts from useToasts. Driven by:
//   - Server 'notification' events via websocket.gateway.ts sendNotification()
//   - Internal payment success/error events
// ─────────────────────────────────────────────────────────────────────────────
function ToastStack({ toasts, dismiss }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-72 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto bg-zinc-900 border border-zinc-700/80 rounded-xl px-4 py-3 shadow-2xl shadow-black/50"
          style={{ animation: "slideIn .3s ease forwards" }}
        >
          <div className="flex items-start gap-2">
            {t.variant === "success"
              ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
              : t.variant === "error"
              ? <XCircle size={12} className="text-red-400 shrink-0 mt-0.5" />
              : <Bell size={12} className="text-zinc-500 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono font-semibold text-white">{t.title}</p>
              {t.body && <p className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate">{t.body}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-zinc-700 hover:text-zinc-400 shrink-0 transition-colors">
              <X size={11} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MICRO COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function FieldError({ msg }) {
  return (
    <p className="flex items-center gap-1 text-[10px] font-mono text-red-400 mt-1.5">
      <AlertTriangle size={9} />
      {msg}
    </p>
  );
}

function InfoRow({ label, value, mono, copyable }) {
  const { copy, copiedId } = useClipboard();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        <span className={`text-[10px] ${mono ? "font-mono" : ""} text-zinc-300 text-right truncate`}>
          {value}
        </span>
        {copyable && (
          <button onClick={() => copy(value, `info-${label}`)} className="text-zinc-700 hover:text-zinc-400 transition-colors">
            {copiedId === `info-${label}` ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — BankingDashboard
//
// Props (all come from AuthenticationService.login() LoginResponse + account):
//   accessToken    string  — JWT from loginResponse.accessToken
//   refreshToken   string  — JWT from loginResponse.refreshToken
//   userId         string  — loginResponse.user.id
//   upiHandle      string  — loginResponse.user.upiHandle  e.g. "alice@mybank"
//   kycStatus      string  — loginResponse.user.kycStatus  KycStatus enum
//   accountId      string  — from account fetch after login
//   initialBalance string  — account.currentBalance (Prisma Decimal → string)
//   currency       string  — account.currency default "MYSIM" per schema
//   onLogout       fn      — called when session expires or user clicks logout
// ─────────────────────────────────────────────────────────────────────────────
export default function BankingDashboard({
  accessToken    = null,
  refreshToken   = null,
  userId         = "",
  upiHandle      = "",
  kycStatus      = "VERIFIED",
  accountId      = "",
  initialBalance = "0.00",
  currency       = "MYSIM",
  onLogout       = () => {},
}) {
  const [newTxResult, setNewTxResult] = useState(null);

  // Persist tokens passed from login into storage (for silent refresh)
  useEffect(() => {
    if (accessToken)  TokenStore.setAccess(accessToken);
    if (refreshToken) TokenStore.setRefresh(refreshToken);
  }, [accessToken, refreshToken]);

  const handleSessionExpired = useCallback(() => {
    TokenStore.clear();
    onLogout();
  }, [onLogout]);

  // API hook — wraps all fetch calls with auth + refresh logic
  const { call } = useApi(accessToken ?? TokenStore.getAccess(), handleSessionExpired);

  // Socket hook — connects to /api/v1/realtime, subscribes to balance room
  const { wsStatus, socketRef } = useSocket(
    accessToken ?? TokenStore.getAccess(),
    accountId,
  );

  // Toast hook — wires server notifications + internal events
  const { toasts, push: pushToast, dismiss } = useToasts(socketRef);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
        .banking-dash{font-family:'IBM Plex Sans',sans-serif}
        .banking-dash .font-mono,.banking-dash [class*="font-mono"]{font-family:'IBM Plex Mono',monospace}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        .animate-pulse{animation:pulse 2s ease-in-out infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
        .animate-spin{animation:spin .8s linear infinite}
        @keyframes slideIn{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}
        input[type=number]{-moz-appearance:textfield}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#27272a;border-radius:2px}
      `}</style>

      <div className="banking-dash min-h-screen bg-zinc-950 text-white">

        {/* Ambient background blobs */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
          <div className="absolute -top-48 -left-48 w-96 h-96 rounded-full opacity-[0.035]"
            style={{ background: "radial-gradient(circle,#34d399,transparent)" }} />
          <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full opacity-[0.025]"
            style={{ background: "radial-gradient(circle,#6366f1,transparent)" }} />
        </div>

        {/* ── HEADER ── */}
        <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur border-b border-zinc-900">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-13 flex items-center justify-between" style={{ height: 52 }}>
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-emerald-500 rounded-md flex items-center justify-center font-mono font-bold text-[10px] text-zinc-950">M</div>
              <span className="font-mono text-sm font-semibold text-zinc-300">MyBank</span>
              <span className="text-zinc-800 font-mono text-xs">/</span>
              <span className="text-zinc-600 font-mono text-xs hidden sm:inline">Dashboard</span>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-3">
              {/* KYC badge */}
              {kycStatus === "VERIFIED" && (
                <span className="hidden sm:flex items-center gap-1 text-[9px] font-mono text-emerald-600 tracking-wider uppercase">
                  <ShieldCheck size={10} /> KYC Verified
                </span>
              )}
              <ConnectionPill status={wsStatus} />
              {/* Avatar */}
              <div className="flex items-center gap-1.5">
                <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-[10px] font-mono text-zinc-400 uppercase">
                  {upiHandle?.[0] ?? "?"}
                </div>
                <span className="hidden sm:block text-[10px] font-mono text-zinc-600 max-w-[100px] truncate">
                  {upiHandle}
                </span>
              </div>
              {/* Logout */}
              <button
                onClick={() => { TokenStore.clear(); onLogout(); }}
                className="p-1.5 rounded-lg border border-zinc-800 text-zinc-700 hover:text-zinc-400 hover:border-zinc-700 transition-all"
                title="Log out"
              >
                <LogOut size={12} />
              </button>
            </div>
          </div>
        </header>

        {/* ── MAIN GRID ── */}
        <main className="relative max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">

            {/* ── LEFT — Transaction Log ── */}
            <div className="order-2 lg:order-1">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[9px] font-mono text-zinc-700 uppercase tracking-[0.2em]">Recent Activity</span>
                <div className="flex-1 h-px bg-zinc-900" />
              </div>
              <div className="rounded-2xl border border-zinc-900 bg-zinc-950/50 p-4">
                <TransactionLog
                  currentUserId={userId}
                  call={call}
                  socketRef={socketRef}
                  newTxResult={newTxResult}
                />
              </div>
            </div>

            {/* ── RIGHT — Balance + Form ── */}
            <div className="order-1 lg:order-2 flex flex-col gap-5">

              {/* Balance Tile */}
              <BalanceTile
                initialBalance={initialBalance}
                currency={currency}
                upiHandle={upiHandle}
                accountId={accountId}
                socketRef={socketRef}
              />

              {/* Transfer Form */}
              <div className="rounded-2xl border border-zinc-900 bg-zinc-950/50 p-5">
                <div className="flex items-center gap-2 mb-5">
                  <Send size={13} className="text-emerald-500" />
                  <h2 className="text-xs font-mono font-semibold text-zinc-300">Send Money</h2>
                </div>
                <UpiTransferForm
                  call={call}
                  onSuccess={(result) => setNewTxResult(result)}
                  pushToast={pushToast}
                  socketRef={socketRef}
                />
              </div>

              {/* Security footnote */}
              <div className="flex items-start gap-2 px-1">
                <Shield size={10} className="text-zinc-800 shrink-0 mt-0.5" />
                <p className="text-[9px] font-mono text-zinc-700 leading-relaxed">
                  Redis two-phase idempotency · Redlock · Prisma SERIALIZABLE ·
                  SELECT FOR UPDATE · BankingAuditLedger.sol
                </p>
              </div>
            </div>
          </div>
        </main>

        {/* ── TOASTS — driven by server notification events ── */}
        <ToastStack toasts={toasts} dismiss={dismiss} />
      </div>
    </>
  );
}
