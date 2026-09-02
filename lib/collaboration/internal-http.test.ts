import { create } from "@bufbuild/protobuf";
import { Code, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  AIDocumentDeleteBlockOperationSchema,
  AIDocumentDomain,
  AIDocumentLocaleSchema,
  AIDocumentOperationSchema,
  AIDocumentReferenceSchema,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  InteractiveAIDocumentMutationOrigin,
  InternalCollaborationRelayService,
  RelayInteractiveAIDocumentMutationRequestSchema,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInternalHttpHandler,
  INTERACTIVE_MUTATION_RELAY_PATH,
  matchesInternalServiceCredential,
} from "./internal-http.ts";

const SECRET = "test-only-internal-service-secret";
const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

const servers: Server[] = [];

function validRequest() {
  return create(RelayInteractiveAIDocumentMutationRequestSchema, {
    mutationId: "mutation-1",
    origin:
      InteractiveAIDocumentMutationOrigin.INTERACTIVE_AI_DOCUMENT_MUTATION_ORIGIN_MCP,
    document: create(AIDocumentReferenceSchema, {
      domain: AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST,
      reference: DOCUMENT_ID,
    }),
    locale: create(AIDocumentLocaleSchema, { code: "ko" }),
    expectedDocumentRevision: "revision-before",
    acceptedDocumentRevision: "revision-after",
    operations: [
      create(AIDocumentOperationSchema, {
        operation: {
          case: "deleteBlock",
          value: create(AIDocumentDeleteBlockOperationSchema, {
            blockHandle: "block-1",
          }),
        },
      }),
    ],
    actorMemberId: "22222222-2222-4222-8222-222222222222",
  });
}

async function startHandler(
  relayInteractiveMutation = vi.fn(async () => undefined),
) {
  const handler = createInternalHttpHandler({
    internalServiceSecret: SECRET,
    respondToHealthCheck(response) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"status":"ok"}');
    },
    relayInteractiveMutation,
  });
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test internal HTTP listener address is unavailable");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    relayInteractiveMutation,
  };
}

function credentialInterceptor(secret?: string): Interceptor {
  return (next) => async (request) => {
    if (secret !== undefined) {
      request.header.set("X-Internal-Service", secret);
    }
    return await next(request);
  };
}

function relayClient(baseUrl: string, secret?: string) {
  return createClient(
    InternalCollaborationRelayService,
    createConnectTransport({
      baseUrl,
      httpVersion: "1.1",
      interceptors: [credentialInterceptor(secret)],
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("internal collaboration HTTP boundary", () => {
  it("uses the exact generated Connect procedure path", () => {
    expect(INTERACTIVE_MUTATION_RELAY_PATH).toBe(
      "/api.intra.v1.InternalCollaborationRelayService/RelayInteractiveAIDocumentMutation",
    );
  });

  it("refuses to start with a blank internal service credential", () => {
    expect(() =>
      createInternalHttpHandler({
        internalServiceSecret: " ",
        respondToHealthCheck: vi.fn(),
        relayInteractiveMutation: vi.fn(async () => undefined),
      }),
    ).toThrow("internal service credential is required");
  });

  it("compares the one canonical internal credential without length leaks", () => {
    expect(matchesInternalServiceCredential(SECRET, SECRET)).toBe(true);
    expect(matchesInternalServiceCredential(null, SECRET)).toBe(false);
    expect(matchesInternalServiceCredential("short", SECRET)).toBe(false);
    expect(matchesInternalServiceCredential(`${SECRET} `, SECRET)).toBe(false);
    expect(
      matchesInternalServiceCredential(`${SECRET}, ${SECRET}`, SECRET),
    ).toBe(false);
  });

  it("serves only health and the exact generated Connect path", async () => {
    const { baseUrl } = await startHandler();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
    expect((await fetch(`${baseUrl}/health?verbose=true`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/missing`)).status).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}${INTERACTIVE_MUTATION_RELAY_PATH}/extra`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });

  it("rejects missing and wrong credentials before invoking the receiver", async () => {
    const { baseUrl, relayInteractiveMutation } = await startHandler();

    await expect(
      relayClient(baseUrl).relayInteractiveAIDocumentMutation(validRequest()),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
    await expect(
      relayClient(baseUrl, "wrong").relayInteractiveAIDocumentMutation(
        validRequest(),
      ),
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
    expect(relayInteractiveMutation).not.toHaveBeenCalled();
  });

  it("validates and forwards the exact accepted request once", async () => {
    const { baseUrl, relayInteractiveMutation } = await startHandler();
    const request = validRequest();

    await expect(
      relayClient(baseUrl, SECRET).relayInteractiveAIDocumentMutation(request),
    ).resolves.toBeDefined();
    expect(relayInteractiveMutation).toHaveBeenCalledOnce();
    expect(relayInteractiveMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutationId: request.mutationId,
        expectedDocumentRevision: request.expectedDocumentRevision,
        acceptedDocumentRevision: request.acceptedDocumentRevision,
        actorMemberId: request.actorMemberId,
      }),
    );
  });

  it("fails invalid input before invoking the receiver", async () => {
    const { baseUrl, relayInteractiveMutation } = await startHandler();
    const request = validRequest();
    request.mutationId = " ";

    await expect(
      relayClient(baseUrl, SECRET).relayInteractiveAIDocumentMutation(request),
    ).rejects.toMatchObject({ code: Code.InvalidArgument });
    expect(relayInteractiveMutation).not.toHaveBeenCalled();
  });

  it("returns receiver failures so API can issue the exact fallback fence", async () => {
    const relayInteractiveMutation = vi.fn(async () => {
      throw new Error("resident apply outcome unknown");
    });
    const { baseUrl } = await startHandler(relayInteractiveMutation);

    await expect(
      relayClient(baseUrl, SECRET).relayInteractiveAIDocumentMutation(
        validRequest(),
      ),
    ).rejects.toMatchObject({ code: Code.Internal });
    expect(relayInteractiveMutation).toHaveBeenCalledOnce();
  });
});
