import {
  CollaborativeDocumentType,
  parseDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";

interface ConnectedDocument {
  getConnections(): Iterable<unknown>;
}

export interface EditSessionDocumentRegistryOptions<TDocument> {
  listDocuments(): Iterable<[string, TDocument]>;
  loadDocument(documentName: string): Promise<TDocument | null>;
  supportsVersionCheckpoints(type: CollaborativeDocumentType): boolean;
}

export interface EditSessionEntityScope {
  entityDocumentName: string;
  entityId: string;
  entityType: CollaborativeDocumentType;
  locale: string;
}

export class EditSessionDocumentRegistry<TDocument extends ConnectedDocument> {
  constructor(
    private readonly options: EditSessionDocumentRegistryOptions<TDocument>,
  ) {}

  parse(
    documentName: string,
  ): ReturnType<typeof parseDocumentName> | undefined {
    try {
      return parseDocumentName(documentName);
    } catch {
      return undefined;
    }
  }

  scope(documentName: string): EditSessionEntityScope | undefined {
    const parsed = this.parse(documentName);
    if (!parsed || !this.options.supportsVersionCheckpoints(parsed.type)) {
      return undefined;
    }
    return {
      entityDocumentName: documentName,
      entityId: parsed.entityId,
      entityType: parsed.type,
      locale: parsed.locale,
    };
  }

  checkpointDocuments(entityDocumentName: string): Array<{
    documentName: string;
    document: TDocument;
  }> {
    const documents: Array<{
      documentName: string;
      document: TDocument;
    }> = [];
    for (const [documentName, document] of this.options.listDocuments()) {
      const scope = this.scope(documentName);
      if (scope?.entityDocumentName === entityDocumentName) {
        documents.push({ documentName, document });
      }
    }
    return documents;
  }

  async sourceDocument(
    entityDocumentName: string,
  ): Promise<{ documentName: string; document: TDocument } | undefined> {
    const resident = this.checkpointDocuments(entityDocumentName)[0];
    if (resident) {
      return resident;
    }
    const document = await this.options.loadDocument(entityDocumentName);
    if (!document) {
      return undefined;
    }
    return { documentName: entityDocumentName, document };
  }

  sourceDocumentIsCurrent(
    entityDocumentName: string,
    documentName: string,
  ): boolean {
    return documentName === entityDocumentName;
  }

  allForEntity(
    entityDocumentName: string,
  ): Array<{ documentName: string; document: TDocument }> {
    const documents: Array<{ documentName: string; document: TDocument }> = [];
    for (const [documentName, document] of this.options.listDocuments()) {
      if (documentName === entityDocumentName && this.parse(documentName)) {
        documents.push({ documentName, document });
      }
    }
    return documents;
  }

  persistenceQueueKey(documentName: string): string {
    return documentName;
  }

  hasConnectedEditor(entityDocumentName: string): boolean {
    return this.checkpointDocuments(entityDocumentName).some(
      ({ document }) =>
        !document.getConnections()[Symbol.iterator]().next().done,
    );
  }
}
