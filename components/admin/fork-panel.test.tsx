/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The fork panel's contract with the owner: what it submits (the field
// shape parseForkForm reads), how a typed error comes back inline, how a
// saved option is removed through its own action, and that the preview
// tells the truth about what the viewer will get.
const server = vi.hoisted(() => ({
  upsertEpisodeChoices: vi.fn(),
  deleteEpisodeChoice: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => ({
  upsertEpisodeChoices: server.upsertEpisodeChoices,
  deleteEpisodeChoice: server.deleteEpisodeChoice,
}));

vi.mock("@/lib/i18n/admin-client", async () => {
  const { ru } = await import("@/lib/i18n/admin-dictionaries");
  return { useAdminT: () => ru };
});

// Base UI's Select is a portal + pointer-driven popup; what the panel relies
// on is only its value/onValueChange contract, so a native <select> stands in.
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { ru } from "@/lib/i18n/admin-dictionaries";
import { ForkPanel, type ForkPanelOption } from "./fork-panel";

const OPTIONS: ForkPanelOption[] = [
  { id: "ep-1", number: 1, title: "First", status: "ready", branchOfEpisodeId: null },
  { id: "b-1", number: 901, title: "Kiss", status: "ready", branchOfEpisodeId: "ep-2" },
  { id: "b-2", number: 902, title: "Hug", status: "processing", branchOfEpisodeId: "ep-2" },
  { id: "ep-3", number: 3, title: "Third", status: "ready", branchOfEpisodeId: null },
];

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ForkPanel>["values"]> = {},
) {
  return render(
    <ForkPanel
      episodeId="ep-2"
      seasonId="s-1"
      showId="show-1"
      values={{
        branchOfEpisodeId: null,
        forkPromptEn: "Kiss or hug?",
        forkPromptEs: "¿Beso o abrazo?",
        forkWindowSeconds: 12,
        choices: [
          { id: "c-1", toEpisodeId: "b-1", labelEn: "Kiss", labelEs: "Beso", isDefault: false },
          { id: "c-2", toEpisodeId: "b-2", labelEn: "Hug", labelEs: "Abrazo", isDefault: true },
        ],
        ...overrides,
      }}
      options={OPTIONS}
    />,
  );
}

const rows = () => screen.getAllByTestId("fork-choice-row");
const preview = () => screen.getByTestId("fork-preview");

beforeEach(() => {
  server.upsertEpisodeChoices.mockReset().mockResolvedValue({ status: "ok" });
  server.deleteEpisodeChoice.mockReset().mockResolvedValue({ status: "ok" });
});
afterEach(cleanup);

describe("ForkPanel", () => {
  it("renders the saved fork and previews it as the viewer sees it", () => {
    renderPanel();
    expect(rows()).toHaveLength(2);
    expect(preview()).toHaveTextContent("Kiss or hug?");
    expect(preview()).toHaveTextContent("Kiss");
    expect(preview()).toHaveTextContent("Hug");
    expect(preview()).toHaveTextContent(ru.fork.previewTimer(12));
    // The option labels name branches and unfinished videos.
    expect(screen.getAllByText(/E902 · Hug/)[0]).toHaveTextContent(
      ru.fork.targetNotReady,
    );
  });

  it("switches the preview to Spanish", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "es" }));
    expect(preview()).toHaveTextContent("¿Beso o abrazo?");
    expect(preview()).toHaveTextContent("Abrazo");
    expect(preview()).not.toHaveTextContent("Kiss or hug?");
  });

  it("follows the prompt as it is typed", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(ru.fork.promptEn), {
      target: { value: "Stay or go?" },
    });
    expect(preview()).toHaveTextContent("Stay or go?");
  });

  it("adds options up to three and drops an unsaved one locally", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: ru.fork.addChoice }));
    expect(rows()).toHaveLength(3);
    expect(
      screen.queryByRole("button", { name: ru.fork.addChoice }),
    ).toBeNull();

    const removeButtons = screen.getAllByRole("button", { name: ru.fork.removeChoice });
    fireEvent.click(removeButtons[2]);
    expect(rows()).toHaveLength(2);
    expect(server.deleteEpisodeChoice).not.toHaveBeenCalled();
  });

  it("removes a saved option through its own action and keeps it on error", async () => {
    renderPanel();
    const [first] = screen.getAllByRole("button", { name: ru.fork.removeChoice });
    await act(async () => {
      fireEvent.click(first);
    });
    expect(server.deleteEpisodeChoice).toHaveBeenCalledWith("c-1", "ep-2", "s-1", "show-1");
    expect(rows()).toHaveLength(1);

    server.deleteEpisodeChoice.mockResolvedValue({
      status: "error",
      code: "fork_needs_two_choices",
    });
    const [last] = screen.getAllByRole("button", { name: ru.fork.removeChoice });
    await act(async () => {
      fireEvent.click(last);
    });
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      ru.formErrors.forkNeedsTwoChoices,
    );
  });

  it("submits the field shape the server action parses", async () => {
    renderPanel();
    // Mark the first option as default, then save.
    fireEvent.click(screen.getAllByRole("radio")[0]);
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: ru.fork.save }).closest("form")!);
    });

    expect(server.upsertEpisodeChoices).toHaveBeenCalledTimes(1);
    const args = server.upsertEpisodeChoices.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(["ep-2", "s-1", "show-1"]);
    const fd = args[4] as FormData;
    expect(fd.get("branchOfEpisodeId")).toBe("");
    expect(fd.get("forkPromptEn")).toBe("Kiss or hug?");
    expect(fd.get("forkPromptEs")).toBe("¿Beso o abrazo?");
    expect(fd.get("forkWindowSeconds")).toBe("12");
    expect(fd.getAll("choiceTarget")).toEqual(["b-1", "b-2"]);
    expect(fd.getAll("choiceLabelEn")).toEqual(["Kiss", "Hug"]);
    expect(fd.getAll("choiceLabelEs")).toEqual(["Beso", "Abrazo"]);
    expect(fd.get("defaultChoice")).toBe("0");
    expect(screen.getByText(ru.fork.saved)).toBeTruthy();
  });

  it("shows the server's typed error inline and keeps what was typed", async () => {
    server.upsertEpisodeChoices.mockResolvedValue({
      status: "error",
      code: "choice_target_not_branch",
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(ru.fork.promptEn), {
      target: { value: "Stay or go?" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: ru.fork.save }).closest("form")!);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      ru.formErrors.choiceTargetNotBranch,
    );
    expect(
      (screen.getByLabelText(ru.fork.promptEn) as HTMLInputElement).value,
    ).toBe("Stay or go?");
  });

  it("previews a single option as a silent transition, none as linear or an ending", async () => {
    renderPanel({
      forkPromptEn: "",
      forkPromptEs: "",
      choices: [
        { id: "c-1", toEpisodeId: "ep-3", labelEn: "", labelEs: "", isDefault: false },
      ],
    });
    expect(preview()).toHaveTextContent(ru.fork.previewAuto("E3 · Third"));

    // A saved row: its removal goes through the action before it vanishes.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ru.fork.removeChoice }));
    });
    expect(preview()).toHaveTextContent(ru.fork.previewLinear);

    // The parent select is the first combobox on the page.
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "ep-1" },
    });
    expect(preview()).toHaveTextContent(ru.fork.previewEnding);
  });
});
