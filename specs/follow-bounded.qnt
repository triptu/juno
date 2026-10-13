// Small instance for exhaustive bounded checking. The simulator uses follow.
module follow_bounded {
  import followProtocol(threads = Set(1, 2), window = Set(1), recent = Set(1),
    eventLimit = 2, fetchLimit = 1, drainLimit = 64).* from "./follow"
  // These are local safety checks. Convergence needs the longer simulator drain.
  val boundedSafety = pendingIntentWins and acceptedUnfollow and failedCallReverted and missingChangesNothing and unknownStaysUnknown
}
