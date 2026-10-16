/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeleteJobApplicationState } from "@/app/admin/careers/actions";
import { JobApplicationDeleteForm } from "./job-application-delete-form";

// The delete of a job application (#376): confirmed in a dialog, then the
// bound action runs; a typed failure is said inline instead of the masked
// error page.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(answer: DeleteJobApplicationState) {
  const action = vi.fn(async () => answer);
  render(
    <JobApplicationDeleteForm
      action={action}
      label="Delete application"
      confirm="Delete this application?"
      failed="Couldn't delete the application."
    />,
  );
  return { action, button: screen.getByRole("button", { name: "Delete application" }) };
}

describe("JobApplicationDeleteForm", () => {
  it("does nothing when the confirmation is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { action, button } = setup({ ok: true });

    fireEvent.click(button);

    expect(window.confirm).toHaveBeenCalledWith("Delete this application?");
    expect(action).not.toHaveBeenCalled();
  });

  it("runs the action once confirmed, and says nothing on success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { action, button } = setup({ ok: true });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a typed failure is shown inline", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { button } = setup({ ok: false, error: "failed" });

    await act(async () => {
      fireEvent.click(button);
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't delete the application.",
    );
  });
});
