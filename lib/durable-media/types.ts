import * as Y from "yjs";

export interface DurableMediaViolation {
  path: string;
  field: string;
}

export interface DurableMediaSanitization {
  state: Buffer;
  changed: boolean;
  removedFields: number;
}

export type SharedYType =
  Y.Doc["share"] extends Map<string, infer Type> ? Type : never;

type LazyYItem = {
  content?: {
    constructor?: { name?: string };
    type?: unknown;
  };
  right: LazyYItem | null;
};

export type LazyYRoot = {
  _map: Map<string, unknown>;
  _start: LazyYItem | null;
};

export type LazyRootKind = "map" | "text" | "xml" | "array";
