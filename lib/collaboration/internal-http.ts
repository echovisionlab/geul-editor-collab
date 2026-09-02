import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestListener, ServerResponse } from "node:http";
import {
  Code,
  ConnectError,
  type ConnectRouter,
  type Interceptor,
} from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { assertRelayInteractiveAIDocumentMutationRequest } from "@echovisionlab/geul-event";
import {
  InternalCollaborationRelayService,
  type RelayInteractiveAIDocumentMutationRequest,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";

const INTERNAL_SERVICE_HEADER = "X-Internal-Service";

export const INTERACTIVE_MUTATION_RELAY_PATH = `/${InternalCollaborationRelayService.typeName}/${InternalCollaborationRelayService.method.relayInteractiveAIDocumentMutation.name}`;

export interface InternalHttpOptions {
  internalServiceSecret: string;
  respondToHealthCheck(response: ServerResponse): void;
  relayInteractiveMutation(
    request: RelayInteractiveAIDocumentMutationRequest,
  ): Promise<void>;
}

function credentialDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function matchesInternalServiceCredential(
  provided: string | null,
  expected: string,
): boolean {
  const providedDigest = credentialDigest(provided ?? "");
  const expectedDigest = credentialDigest(expected);
  return provided !== null && timingSafeEqual(providedDigest, expectedDigest);
}

function internalServiceAuth(secret: string): Interceptor {
  return (next) => async (request) => {
    if (
      !matchesInternalServiceCredential(
        request.header.get(INTERNAL_SERVICE_HEADER),
        secret,
      )
    ) {
      throw new ConnectError(
        "internal service credential required",
        Code.Unauthenticated,
      );
    }
    return await next(request);
  };
}

function relayRoutes(
  router: ConnectRouter,
  relayInteractiveMutation: InternalHttpOptions["relayInteractiveMutation"],
): void {
  router.service(InternalCollaborationRelayService, {
    async relayInteractiveAIDocumentMutation(request) {
      try {
        assertRelayInteractiveAIDocumentMutationRequest(request);
      } catch (error) {
        throw new ConnectError(
          "invalid interactive AI document mutation relay",
          Code.InvalidArgument,
          undefined,
          undefined,
          error,
        );
      }
      await relayInteractiveMutation(request);
      return {};
    },
  });
}

function respondNotFound(response: ServerResponse): void {
  response.writeHead(404);
  response.end();
}

export function createInternalHttpHandler(
  options: InternalHttpOptions,
): RequestListener {
  if (options.internalServiceSecret.trim() === "") {
    throw new Error("internal service credential is required");
  }
  const connectHandler = connectNodeAdapter({
    interceptors: [internalServiceAuth(options.internalServiceSecret)],
    routes: (router) => relayRoutes(router, options.relayInteractiveMutation),
  });

  return (request, response) => {
    if (request.url === "/health" && request.method === "GET") {
      options.respondToHealthCheck(response);
      return;
    }
    if (request.url !== INTERACTIVE_MUTATION_RELAY_PATH) {
      respondNotFound(response);
      return;
    }
    connectHandler(request, response);
  };
}
