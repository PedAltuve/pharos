/** Time source injected at the application boundary; domain code never reads the host clock. */
export interface Clock {
  now(): Date;
}
