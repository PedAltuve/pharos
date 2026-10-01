import type { AnyConsentRequest, ConsentStoreRefusal, OperatorConsentStore } from "../domain/ports/operator-consent.js";
import { err, ok, type Result } from "../shared/result.js";

/** Composition-only boundary. The caller must establish human origin before invoking decline. */
export class HostConsentDecision {
  constructor(private readonly dependencies: { readonly consentStore: OperatorConsentStore; readonly clock: () => number }) {}

  async inspect(requestId: string): Promise<Result<{ readonly request: AnyConsentRequest; readonly auditId: string }, ConsentStoreRefusal>> {
    const record = await this.dependencies.consentStore.getChallenge(requestId, this.dependencies.clock());
    if (!record.ok) return record;
    if (!record.value) return err({ rule: "consent-not-found", requestId });
    if (record.value.status !== "pending") return err({ rule: record.value.status === "declined" ? "consent-already-declined" : "consent-consumption-conflict", requestId });
    return ok({ request: record.value.request, auditId: record.value.auditId });
  }

  async decline(requestId: string): Promise<Result<{ readonly status: "declined"; readonly requestId: string; readonly reason: string; readonly auditId: string }, ConsentStoreRefusal>> {
    const result = await this.dependencies.consentStore.decline(requestId, "operator-declined", this.dependencies.clock());
    if (!result.ok) return result;
    if (result.value.status !== "declined") return err({ rule: "consent-consumption-conflict", requestId });
    const { status, reason, auditId } = result.value;
    return ok({ status, requestId: result.value.requestId, reason, auditId });
  }
}
