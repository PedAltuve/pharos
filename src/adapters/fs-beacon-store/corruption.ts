/**
 * Raised for the disk conditions D4 declares unrecoverable at read time —
 * never for a documented BeaconStoreRefusal, which is always a Result value.
 */
export class BeaconStoreCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeaconStoreCorruptionError";
  }
}
