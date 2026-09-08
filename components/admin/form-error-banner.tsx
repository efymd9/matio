"use client";

import { useAdminT } from "@/lib/i18n/admin-client";
import type { AdminDict } from "@/lib/i18n/admin-dictionaries";
import type { AdminFormErrorCode, AdminFormState } from "@/app/admin/actions";

// One code → dict-key map for every form that consumes AdminFormState
// (show + actor + fork forms) so they can't drift: the Record type makes a
// new code without copy a compile error.
const ERROR_KEY: Record<AdminFormErrorCode, keyof AdminDict["formErrors"]> = {
  title_required: "titleRequired",
  name_required: "nameRequired",
  slug_required: "slugRequired",
  slug_invalid: "slugInvalid",
  slug_taken: "slugTaken",
  // Эпизоды (#193): номер занят/некорректен, маркеры интро.
  episode_number_invalid: "episodeNumberInvalid",
  episode_number_taken: "episodeNumberTaken",
  intro_markers_invalid: "introMarkersInvalid",
  unknown: "unknown",
  // Branching video (#143) — fork panel + publish guard.
  fork_window_out_of_range: "forkWindowOutOfRange",
  branch_parent_invalid: "branchParentInvalid",
  too_many_choices: "tooManyChoices",
  choice_target_required: "choiceTargetRequired",
  choice_target_invalid: "choiceTargetInvalid",
  choice_target_not_ready: "choiceTargetNotReady",
  duplicate_choice_target: "duplicateChoiceTarget",
  fork_needs_two_choices: "forkNeedsTwoChoices",
  fork_prompt_required: "forkPromptRequired",
  choice_label_required: "choiceLabelRequired",
  choice_target_not_branch: "choiceTargetNotBranch",
  publish_fork_incomplete: "publishForkIncomplete",
  publish_branch_not_ready: "publishBranchNotReady",
  publish_choice_target_not_branch: "publishChoiceTargetNotBranch",
  publish_branch_cycle: "publishBranchCycle",
};

export function FormErrorBanner({ state }: { state: AdminFormState }) {
  const t = useAdminT();
  if (state.status !== "error") return null;
  return (
    <p
      role="alert"
      className="rounded-lg border border-rust/25 bg-rust/[0.08] px-3 py-2 text-sm text-rust"
    >
      {t.formErrors[ERROR_KEY[state.code]]}
    </p>
  );
}
