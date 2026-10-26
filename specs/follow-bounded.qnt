// Small instance for exhaustive bounded checking. The simulator uses follow.
module follow_bounded {
  import followProtocol(threads = Set(1, 2), window = Set(1), recent = Set(1),
    eventLimit = 2, fetchLimit = 1, drainLimit = 64).* from "./follow"
  // These are local safety checks. Convergence needs the longer simulator drain.
  // Each rule's state is reached within 3 transitions. A recovered failed call takes
  // 4 (subscribe, reject, start and finish the lookup), so failedCallReverted is
  // checked on its own at 4.
  val boundedSafety = pendingIntentWins and acceptedUnfollow and missingChangesNothing and unknownStaysUnknown
}
