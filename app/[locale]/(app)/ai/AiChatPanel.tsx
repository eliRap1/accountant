"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Send, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import EstimatesDisclaimer from "@/components/app/legal/EstimatesDisclaimer";
import SnapshotDisclosure from "@/components/app/ai/SnapshotDisclosure";
import { ensureDisclaimer } from "@/lib/ai/prompt";

// IL Tax Advisor chat panel.
//
// Why not `@ai-sdk/react`'s `useChat`: that package is not installed in
// this repo (we only have `ai` and `@ai-sdk/openai`). The dependency
// budget for Phase D is locked. We implement the same surface using
// `readUIMessageStream` directly + a small `useState` machine. The
// resulting client surface is approximately:
//   - messages:     UIMessage[]
//   - status:       'idle' | 'submitting' | 'streaming' | 'error'
//   - sendMessage:  (text) => Promise<void>
//   - stop:         () => void
//
// Disclaimer: every assistant message is run through `ensureDisclaimer`
// BEFORE it's committed to the rendered list so the user never sees an
// unsuffixed answer, even on stop / error paths. The api/ai/chat route
// also does this on `onFinish` for the persisted copy.

type Props = {
  initialMessages?: UIMessage[];
  conversationId?: string | null;
  snapshotPreview?: string | null;
};

type ChatStatus = "idle" | "submitting" | "streaming" | "error";

function newId(): string {
  // Cryptographically-secure when available, fallback for SSR contexts.
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function textOfMessage(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export default function AiChatPanel({
  initialMessages = [],
  conversationId = null,
  snapshotPreview = null,
}: Props) {
  const t = useTranslations("app.ai");
  const locale = useLocale();
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Auto-scroll on new chunks. Cheap because UIMessages are referen-
    // tially identity-stable within a streaming pass — only the latest
    // assistant message mutates.
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (status === "submitting" || status === "streaming") return;

    setErrorCode(null);
    const userMsg: UIMessage = {
      id: newId(),
      role: "user",
      parts: [{ type: "text", text: trimmed }],
    };
    const placeholder: UIMessage = {
      id: newId(),
      role: "assistant",
      parts: [{ type: "text", text: "" }],
    };
    const baseline = [...messages, userMsg];
    setMessages([...baseline, placeholder]);
    setInput("");
    setStatus("submitting");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: baseline,
          conversationId,
          locale,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setErrorCode(errBody.error ?? "unknown_error");
        setStatus("error");
        setMessages((prev) => prev.slice(0, -1)); // drop empty assistant
        return;
      }
      if (!res.body) {
        setErrorCode("empty_response");
        setStatus("error");
        return;
      }

      setStatus("streaming");
      const chunkStream = res.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(
          uiMessageChunkParser(),
        ) as unknown as ReadableStream<UIMessageChunk>;
      const stream = readUIMessageStream<UIMessage>({
        stream: chunkStream,
        message: placeholder,
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.warn("[AiChatPanel] stream error", err);
        },
      });

      for await (const updated of stream) {
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = updated;
          return copy;
        });
      }

      // Final guard: make sure the rendered assistant message carries
      // the disclaimer (the api route does the same for the persisted
      // copy, but the live stream may have ended before the suffix was
      // appended — defence in depth).
      setMessages((prev) => {
        const copy = prev.slice();
        const last = copy[copy.length - 1];
        if (!last || last.role !== "assistant") return prev;
        const currentText = textOfMessage(last);
        const safe = ensureDisclaimer(currentText, locale);
        if (safe === currentText) return prev;
        copy[copy.length - 1] = {
          ...last,
          parts: [{ type: "text", text: safe }],
        };
        return copy;
      });
      setStatus("idle");
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setStatus("idle");
        return;
      }
      // eslint-disable-next-line no-console
      console.error("[AiChatPanel] send_failed", err);
      setErrorCode("network_error");
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStatus("idle");
  }

  const busy = status === "submitting" || status === "streaming";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <EstimatesDisclaimer variant="banner" />

      {snapshotPreview ? (
        <SnapshotDisclosure preview={snapshotPreview} />
      ) : null}

      <section
        className="glass-strong relative flex flex-col gap-3 rounded-2xl border border-white/5 p-4"
        aria-label={t("chatLabel")}
      >
        <header className="flex items-center gap-2 border-b border-white/5 pb-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold text-slate-100">
              {t("title")}
            </h2>
            <p className="text-xs text-slate-400">{t("subtitle")}</p>
          </div>
        </header>

        <div
          ref={scrollRef}
          className="flex max-h-[60vh] min-h-[260px] flex-col gap-3 overflow-y-auto pe-1"
        >
          {messages.length === 0 ? (
            <EmptyGreeting greeting={t("greeting")} />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}
        </div>

        <AnimatePresence>
          {errorCode ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
              role="alert"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <span>
                {errorCode === "quota_exceeded"
                  ? t("errors.quotaExceeded")
                  : errorCode === "ai_gateway_disabled"
                    ? t("errors.gatewayDisabled")
                    : errorCode === "unauthorized"
                      ? t("errors.unauthorized")
                      : t("errors.generic")}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="flex items-center gap-2 border-t border-white/5 pt-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("inputPlaceholder")}
            disabled={busy}
            className="flex-1 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none focus:ring-1 focus:ring-emerald-400/30 disabled:opacity-50"
            aria-label={t("inputLabel")}
          />
          {busy ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/15"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("stop")}
            </button>
          ) : (
            <button
              type="submit"
              disabled={input.trim().length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 shadow-[0_8px_30px_-12px_rgba(16,185,129,0.7)] transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden />
              {t("send")}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

function EmptyGreeting({ greeting }: { greeting: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-slate-400">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-md text-base text-slate-200">{greeting}</p>
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = textOfMessage(message);
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      role="article"
    >
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-emerald-500/15 text-emerald-50"
            : "bg-slate-950/60 text-slate-100 border border-white/5"
        }`}
      >
        {text || (isUser ? "" : "…")}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// Stream parser
// ----------------------------------------------------------------------
//
// The route returns the AI SDK v6 UI Message Stream format — a
// newline-delimited sequence of JSON chunks served as text/event-stream
// (per `UI_MESSAGE_STREAM_HEADERS`). `readUIMessageStream` expects a
// `ReadableStream<UIMessageChunk>` — we parse the text-stream into
// JSON chunks via this TransformStream factory.
function uiMessageChunkParser(): TransformStream<string, unknown> {
  let buffer = "";
  return new TransformStream<string, unknown>({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        // SSE-style "data: { ... }" prefix is stripped if present; the
        // raw v6 stream uses bare JSON-per-line, but we accept either.
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!payload || payload === "[DONE]") continue;
        try {
          controller.enqueue(JSON.parse(payload));
        } catch {
          // Ignore malformed lines — the stream contract is line-
          // delimited JSON; an unparseable line is a transport hiccup.
        }
      }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (!trimmed) return;
      try {
        controller.enqueue(JSON.parse(trimmed));
      } catch {
        /* swallow */
      }
    },
  });
}
