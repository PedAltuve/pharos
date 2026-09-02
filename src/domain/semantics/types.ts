// Frozen inter-slice contract. Slice B MUST consume `SemanticProjection` unchanged:
// no wrapping, no added field, no serialization shim.

export type SemanticValue =
  | string
  | number
  | boolean
  | null
  | readonly SemanticValue[]
  | { readonly [key: string]: SemanticValue };

export type SemanticKeySet = Readonly<Record<string, true>>;

export type VariableClassification =
  | "representative"
  | "required_scenario"
  | "test_data";
export type SideEffectClass = "stateful" | "stateless";

export interface NormalizedConstraint {
  readonly kind: string; // schema-owned vocabulary; domain compares, never evaluates
  readonly value: SemanticValue;
}

export interface VariableDecl {
  readonly name: string; // equals its key
  readonly classification: VariableClassification;
  readonly constraints: Readonly<Record<string, NormalizedConstraint>>; // keyed by kind
  readonly secretReferenceId: string | null; // non-null => sensitive
  readonly nonSensitiveExample: SemanticValue | null;
}

export interface NormalizedActor {
  readonly type: string; // e.g. "guest"
  readonly identityRef: string | null; // reference only; never credentials
}

export interface NormalizedEntryPoint {
  readonly path: string; // origin-relative; host/port are runtime-resolved
  readonly query: Readonly<Record<string, string>> | null; // null => unconstrained; {} => must be empty
  readonly fragment: string | null;
}

export type NormalizedActionValue =
  | { readonly kind: "literal"; readonly value: SemanticValue }
  | { readonly kind: "variable"; readonly variable: string };

export interface OrderedJourneyAction {
  readonly action: string; // tool-independent intent verb, e.g. "select_policy"
  readonly target: string | null; // logical token or route — never a selector/locator
  readonly value: NormalizedActionValue | null;
}

export interface NormalizedCheckpoint {
  readonly id: string;
  readonly afterAction: string | null;
  readonly expectations: Readonly<Record<string, SemanticValue>>;
}

export type NormalizedCheckpoints =
  | {
      readonly ordering: "keyed";
      readonly entries: Readonly<Record<string, NormalizedCheckpoint>>;
    }
  | {
      readonly ordering: "ordered";
      readonly entries: readonly NormalizedCheckpoint[];
    };

export interface KeyedDeclaration {
  readonly id: string;
  readonly description: string | null;
}
export type OutcomeDecl = KeyedDeclaration;
export type VariationDecl = KeyedDeclaration;
export type RegressionDecl = KeyedDeclaration;

export interface NormalizedIsolationIntent {
  readonly strategy: string; // intent token, never an executable command (mechanics excluded)
  readonly scope: SemanticKeySet; // overlap = key intersection (lifecycle §7)
}

export interface ReadinessIntent {
  readonly sideEffectClass: SideEffectClass;
  readonly isolation: NormalizedIsolationIntent | null; // null legal only for stateless
}

export interface SemanticBundle {
  readonly purpose: string;
  readonly actor: NormalizedActor;
  readonly entryPoint: NormalizedEntryPoint;
  readonly actions: readonly OrderedJourneyAction[]; // ordered
  readonly checkpoints: NormalizedCheckpoints;
  readonly variables: Readonly<Record<string, VariableDecl>>;
  readonly outcomes: Readonly<Record<string, OutcomeDecl>>;
  readonly allowedVariation: Readonly<Record<string, VariationDecl>>;
  readonly prohibitedRegressions: Readonly<Record<string, RegressionDecl>>;
  readonly readinessIntent: ReadinessIntent;
}

export type SemanticProjection = SemanticBundle; // FROZEN — Slice B consumes unchanged

// Input contract. Schema-interpreted upstream; carries excluded fields that project() drops.
export type SemanticSource = SemanticSourceCore & {
  readonly [excludedField: string]: unknown;
};

export type SourceDeclarationList =
  | readonly (
      | string
      | { readonly id: string; readonly description?: string | null }
    )[]
  | Readonly<Record<string, { readonly description?: string | null }>>;

export interface SourceCheckpoint {
  readonly id: string;
  readonly afterAction?: string | null;
  readonly expectations: Readonly<Record<string, SemanticValue>>;
}

export interface SourceVariable {
  readonly name: string;
  readonly classification: VariableClassification;
  readonly constraints?:
    | readonly { readonly kind: string; readonly value: SemanticValue }[]
    | Readonly<Record<string, { readonly value: SemanticValue }>>
    | null;
  readonly secretReferenceId?: string | null;
  readonly nonSensitiveExample?: SemanticValue | null;
}

export interface SemanticSourceCore {
  readonly purpose: string;
  readonly actor: { readonly type: string; readonly identityRef?: string | null };
  readonly entryPoint: {
    readonly path: string;
    readonly query?: Readonly<Record<string, string>> | null;
    readonly fragment?: string | null;
  };
  readonly actions: readonly {
    readonly action: string;
    readonly target?: string | null;
    readonly value?: NormalizedActionValue | SemanticValue | null;
  }[];
  readonly checkpoints?: {
    readonly ordered?: boolean | null; // declared default: false => keyed
    readonly entries:
      | readonly SourceCheckpoint[]
      | Readonly<Record<string, SourceCheckpoint>>;
  } | null;
  readonly variables?:
    | readonly SourceVariable[]
    | Readonly<Record<string, SourceVariable>>
    | null;
  readonly outcomes?: SourceDeclarationList | null;
  readonly allowedVariation?: SourceDeclarationList | null;
  readonly prohibitedRegressions?: SourceDeclarationList | null;
  readonly readinessIntent: {
    readonly sideEffectClass: SideEffectClass;
    readonly isolation?: {
      readonly strategy: string;
      readonly scope?: readonly string[] | null;
    } | null;
  };
}
