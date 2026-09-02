import { createServer } from "node:http";
import type { RequestListener, ServerResponse } from "node:http";
import type { Server } from "@hocuspocus/server";
import { env } from "../../env.ts";
import { startIngestProjectionSubscriber } from "../../events/ingest-projection-subscriber.ts";
import { startContentUpdatedSubscriber } from "../../events/content-updated-subscriber.ts";
import { startEventSubscriber } from "../../events/subscriber.ts";
import { startTranscodeSubscriber } from "../../events/transcode-subscriber.ts";
import { startTranslationSubscriber } from "../../events/translation-subscriber.ts";
import {
  closeMessaging,
  stopMessagingConsumers,
} from "../postgresql/messaging.ts";
import { logger } from "../logger.ts";
import {
  emitServiceFailed,
  emitServiceReady,
  emitServiceStopping,
} from "../system-logging.ts";
import { createCollabServer, shutdownCollabServer } from "./server.ts";
import { createInteractiveMutationRelayReceiver } from "./interactive-mutation-server.ts";
import { withShutdownTimeout } from "./shutdown-timeout.ts";
import { errorMessage } from "./error-message.ts";
import {
  createInternalHttpHandler,
  type InternalHttpOptions,
} from "./internal-http.ts";

interface InternalServer {
  listen(port: number, callback: () => void): void;
  close(callback: (error?: Error) => void): void;
}

export interface CollabRuntime {
  createInternalServer(listener: RequestListener): InternalServer;
  onProcessEvent(
    event: "SIGINT" | "SIGTERM" | "uncaughtException" | "unhandledRejection",
    listener: (value: unknown) => unknown,
  ): void;
  exit(code: number): never;
}

interface RunningCollabService {
  shutdown(): Promise<void>;
}

interface StartupState {
  ready: boolean;
  stopping?: boolean;
  error?: string;
}

const defaultRuntime: CollabRuntime = {
  createInternalServer(listener) {
    return createServer(listener);
  },
  onProcessEvent(event, listener) {
    process.on(event, listener as never);
  },
  exit(code) {
    process.exit(code);
  },
};

function fatalStartupError(
  runtime: CollabRuntime,
  state: StartupState,
  error: unknown,
): never {
  state.error = errorMessage(error);
  emitServiceFailed(error);
  return runtime.exit(1);
}

function respondToHealthCheck(
  response: ServerResponse,
  state: StartupState,
): void {
  let status = "starting";
  if (state.ready) {
    status = "ok";
  } else if (state.error) {
    status = "error";
  } else if (state.stopping) {
    status = "stopping";
  }
  const body = state.ready ? { status } : { status, error: state.error };
  response.writeHead(state.ready ? 200 : 503, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(body));
}

function registerFatalProcessHandlers(
  runtime: CollabRuntime,
  state: StartupState,
): void {
  runtime.onProcessEvent("uncaughtException", (value) => {
    const error = value instanceof Error ? value : new Error(String(value));
    state.error = error.message;
    emitServiceFailed(error);
    runtime.exit(1);
  });
  runtime.onProcessEvent("unhandledRejection", (reason) => {
    state.error = errorMessage(reason);
    emitServiceFailed(reason);
    runtime.exit(1);
  });
}

async function startSubscribers(
  runtime: CollabRuntime,
  state: StartupState,
  server: Server,
): Promise<void> {
  const subscribers = [
    ["event subscriber", () => startEventSubscriber(server)],
    ["content updated subscriber", () => startContentUpdatedSubscriber(server)],
    ["transcode subscriber", () => startTranscodeSubscriber(server)],
    ["translation subscriber", () => startTranslationSubscriber(server)],
    [
      "ingest projection subscriber",
      () => startIngestProjectionSubscriber(server),
    ],
  ] as const;

  for (const [name, start] of subscribers) {
    try {
      await start();
      logger.info(`${name.charAt(0).toUpperCase()}${name.slice(1)} started`);
    } catch (error) {
      fatalStartupError(runtime, state, error);
    }
  }
}

function relayInteractiveMutationHandler(
  server: Server,
  configured?: InternalHttpOptions["relayInteractiveMutation"],
): InternalHttpOptions["relayInteractiveMutation"] {
  if (configured) return configured;
  const receiver = createInteractiveMutationRelayReceiver(server);
  return (request) => receiver.relay(request);
}

export async function startCollabService(
  runtime: CollabRuntime = defaultRuntime,
  server: Server = createCollabServer(),
  configuredRelay?: InternalHttpOptions["relayInteractiveMutation"],
): Promise<RunningCollabService> {
  const state: StartupState = { ready: false };
  const relayInteractiveMutation = relayInteractiveMutationHandler(
    server,
    configuredRelay,
  );
  const internalServer = runtime.createInternalServer(
    createInternalHttpHandler({
      internalServiceSecret: env.TOKEN_SIGNING_SECRET,
      respondToHealthCheck: (response) => respondToHealthCheck(response, state),
      relayInteractiveMutation,
    }),
  );
  internalServer.listen(env.HEALTH_PORT, () => {
    logger.info("Internal collaboration server started", {
      port: env.HEALTH_PORT,
    });
  });

  registerFatalProcessHandlers(runtime, state);

  try {
    await server.listen();
  } catch (error) {
    fatalStartupError(runtime, state, error);
  }
  logger.info("Collab server started", { port: env.PORT });

  await startSubscribers(runtime, state, server);
  state.ready = true;
  emitServiceReady();

  let shutdownPromise: Promise<void> | undefined;
  const running: RunningCollabService = {
    shutdown() {
      shutdownPromise ??= (async () => {
        emitServiceStopping();
        state.ready = false;
        state.stopping = true;
        const errors: unknown[] = [];
        for (const close of [
          () => stopMessagingConsumers(env.SHUTDOWN_TIMEOUT_MS),
          () => shutdownCollabServer(server),
          () => closeMessaging(),
          () =>
            withShutdownTimeout(
              new Promise<void>((resolve, reject) => {
                internalServer.close((error) =>
                  error ? reject(error) : resolve(),
                );
              }),
              "Internal collaboration server shutdown",
            ),
        ]) {
          try {
            await close();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length > 0) {
          const error = new AggregateError(
            errors,
            "Collaboration service shutdown failed",
          );
          emitServiceFailed(error);
          throw error;
        }
      })();
      return shutdownPromise;
    },
  };

  const exitAfterShutdown = () => {
    void running.shutdown().then(
      () => runtime.exit(0),
      (error: unknown) => {
        state.error = errorMessage(error);
        runtime.exit(1);
      },
    );
  };
  runtime.onProcessEvent("SIGINT", exitAfterShutdown);
  runtime.onProcessEvent("SIGTERM", exitAfterShutdown);
  return running;
}
