import { API_URL } from "@/lib/env";

type CoachWsErrorCode =
  | "AUTH_REQUIRED"
  | "USAGE_LIMIT_REACHED"
  | "USAGE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "WS_ERROR";

export type CoachWsRequest = {
  token: string;
  conversation_id: string;
  content: string;
  tone_override?: string;
  objection_category?: string;
  coach_reply_mode?: string;
  precall_depth?: string;
  pre_call_depth?: string;
};

export type CoachWsDelta = { type: "delta"; text: string };

export type CoachWsComplete = {
  type: "complete";
  // Keep this permissive: backend says “same shape as POST /api/messages body”.
  // The conversation page already narrows/parses that shape.
  [k: string]: unknown;
};

export type CoachWsError = {
  type: "error";
  code?: CoachWsErrorCode | string;
  message: string;
};

type Handlers = {
  delta: Array<(d: CoachWsDelta) => void>;
  complete: Array<(c: CoachWsComplete) => void>;
  error: Array<(e: CoachWsError) => void>;
  open: Array<() => void>;
  close: Array<(ev: CloseEvent) => void>;
};

function httpBaseToWsBase(httpUrl: string): string {
  if (httpUrl.startsWith("https://")) {
    return `wss://${httpUrl.slice("https://".length)}`;
  }
  if (httpUrl.startsWith("http://")) {
    return `ws://${httpUrl.slice("http://".length)}`;
  }
  return httpUrl;
}

function trimSlash(s: string): string {
  return s.replace(/\/$/, "");
}

export function resolveCoachWsUrl(): string {
  return `${trimSlash(httpBaseToWsBase(API_URL))}/api/ws/coach`;
}

export type ConnectAndStreamArgs = {
  token: string;
  conversationId: string;
  content: string;
  options?: {
    toneOverride?: string | null;
    objectionCategory?: string | null;
    coachReplyMode?: string | null;
    precallDepth?: string | null;
  };
};

export type LiveWsClient = {
  onDelta: (cb: (d: CoachWsDelta) => void) => () => void;
  onComplete: (cb: (c: CoachWsComplete) => void) => () => void;
  onError: (cb: (e: CoachWsError) => void) => () => void;
  onOpen: (cb: () => void) => () => void;
  onClose: (cb: (ev: CloseEvent) => void) => () => void;
  close: () => void;
};

export function connectAndStream(args: ConnectAndStreamArgs): LiveWsClient {
  const handlers: Handlers = {
    delta: [],
    complete: [],
    error: [],
    open: [],
    close: [],
  };

  let socket: WebSocket | null = null;
  let closed = false;

  const emit = <K extends keyof Handlers>(
    key: K,
    ...args: Parameters<Handlers[K][number]>
  ) => {
    for (const cb of handlers[key]) {
      try {
        // @ts-expect-error — generic handler dispatch
        cb(...args);
      } catch {
        /* ignore */
      }
    }
  };

  const url = resolveCoachWsUrl();

  try {
    socket = new WebSocket(url);
  } catch (e) {
    queueMicrotask(() => {
      emit("error", {
        type: "error",
        code: "WS_ERROR",
        message: e instanceof Error ? e.message : "Failed to open WebSocket",
      });
    });
  }

  if (socket) {
    socket.onopen = () => {
      emit("open");
      const req: CoachWsRequest = {
        token: args.token,
        conversation_id: args.conversationId,
        content: args.content,
        ...(args.options?.toneOverride
          ? { tone_override: args.options.toneOverride }
          : {}),
        ...(args.options?.objectionCategory
          ? { objection_category: args.options.objectionCategory }
          : {}),
        ...(args.options?.coachReplyMode
          ? { coach_reply_mode: args.options.coachReplyMode }
          : {}),
        ...(args.options?.precallDepth
          ? { precall_depth: args.options.precallDepth }
          : {}),
      };
      try {
        socket?.send(JSON.stringify(req));
      } catch (e) {
        emit("error", {
          type: "error",
          code: "WS_ERROR",
          message: e instanceof Error ? e.message : "Failed to send WS payload",
        });
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
      }
    };

    socket.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(ev.data ?? ""));
      } catch {
        emit("error", {
          type: "error",
          code: "WS_ERROR",
          message: "Malformed WebSocket payload",
        });
        return;
      }

      if (!parsed || typeof parsed !== "object") return;
      const t = (parsed as any).type;
      if (t === "delta" && typeof (parsed as any).text === "string") {
        emit("delta", parsed as CoachWsDelta);
        return;
      }
      if (t === "complete") {
        emit("complete", parsed as CoachWsComplete);
        return;
      }
      if (t === "error" && typeof (parsed as any).message === "string") {
        emit("error", parsed as CoachWsError);
        return;
      }
    };

    socket.onclose = (ev) => {
      closed = true;
      emit("close", ev);
    };

    socket.onerror = () => {
      // Browser gives no details here; surface a stable error so caller can fallback.
      if (!closed) {
        emit("error", {
          type: "error",
          code: "WS_ERROR",
          message: "WebSocket error",
        });
      }
    };
  }

  const on = <K extends keyof Handlers>(key: K, cb: any) => {
    handlers[key].push(cb);
    return () => {
      const idx = handlers[key].indexOf(cb);
      if (idx >= 0) handlers[key].splice(idx, 1);
    };
  };

  return {
    onDelta: (cb) => on("delta", cb),
    onComplete: (cb) => on("complete", cb),
    onError: (cb) => on("error", cb),
    onOpen: (cb) => on("open", cb),
    onClose: (cb) => on("close", cb),
    close: () => {
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}

