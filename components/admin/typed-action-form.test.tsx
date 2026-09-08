/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The wrapper exists because of a production incident (#193): a server
// action's throw reaches the admin as a digest page with no explanation.
// Its contract is therefore about what SURVIVES an error return — the
// message, the values the admin typed — and about not letting a second
// submit race the first.
vi.mock("@/lib/i18n/admin-client", async () => {
  const { ru } = await import("@/lib/i18n/admin-dictionaries");
  return { useAdminT: () => ru };
});

import { TypedActionForm } from "./typed-action-form";
import { ru } from "@/lib/i18n/admin-dictionaries";
import type { AdminFormState } from "@/app/admin/actions";

afterEach(cleanup);

function renderForm(
  action: (prev: AdminFormState, fd: FormData) => Promise<AdminFormState>,
  props: { resetOnSuccess?: boolean } = {},
) {
  render(
    <TypedActionForm action={action} {...props}>
      <input name="number" defaultValue="" aria-label="number" />
      <button type="submit">save</button>
    </TypedActionForm>,
  );
  return {
    field: screen.getByLabelText("number") as HTMLInputElement,
    submit: () => fireEvent.click(screen.getByText("save")),
  };
}

describe("TypedActionForm", () => {
  it("renders the error message inline and keeps what the admin typed", async () => {
    const action = vi.fn(
      async (): Promise<AdminFormState> => ({
        status: "error",
        code: "episode_number_taken",
      }),
    );
    const { field, submit } = renderForm(action);
    fireEvent.change(field, { target: { value: "1" } });

    await act(async () => {
      submit();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      ru.formErrors.episodeNumberTaken,
    );
    // The whole point of dispatching by hand: React 19 would have reset
    // this field to its defaultValue on a <form action> return.
    expect(field.value).toBe("1");
  });

  it("hands the action the form fields and the previous state", async () => {
    const seen: Array<{ prev: AdminFormState; number: FormDataEntryValue | null }> =
      [];
    const action = async (
      prev: AdminFormState,
      fd: FormData,
    ): Promise<AdminFormState> => {
      seen.push({ prev, number: fd.get("number") });
      return { status: "ok" };
    };
    const { field, submit } = renderForm(action);
    fireEvent.change(field, { target: { value: "7" } });

    await act(async () => {
      submit();
    });

    expect(seen).toEqual([{ prev: { status: "idle" }, number: "7" }]);
  });

  it("clears the fields after a successful create, and shows no error", async () => {
    const action = async (): Promise<AdminFormState> => ({ status: "ok" });
    const { field, submit } = renderForm(action, { resetOnSuccess: true });
    fireEvent.change(field, { target: { value: "2" } });

    await act(async () => {
      submit();
    });

    expect(field.value).toBe("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the saved values on an edit form (no reset)", async () => {
    const action = async (): Promise<AdminFormState> => ({ status: "ok" });
    const { field, submit } = renderForm(action);
    fireEvent.change(field, { target: { value: "3" } });

    await act(async () => {
      submit();
    });

    expect(field.value).toBe("3");
  });

  it("locks the controls while the action is in flight, so a double click cannot submit twice", async () => {
    let release: (state: AdminFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<AdminFormState>((resolve) => {
          release = resolve;
        }),
    );
    const { field, submit } = renderForm(action);

    await act(async () => {
      submit();
    });

    expect(field).toBeDisabled();
    submit();
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ status: "ok" });
    });
    expect(field).not.toBeDisabled();
  });
});
