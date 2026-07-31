import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { golden } from "@/lab/golden";

import { Button } from "./button";

// The shadcn/Base UI button as it actually renders against Matio's tokens.
// Knobs on the Default story; the two gallery stories exist so a change to
// `buttonVariants` is visible in one glance instead of six clicks.
const meta = {
  title: "UI/Button",
  component: Button,
  args: {
    children: "Watch now",
    onClick: fn(),
  },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "default",
        "outline",
        "secondary",
        "ghost",
        "destructive",
        "link",
      ],
    },
    size: {
      control: "select",
      options: ["default", "xs", "sm", "lg", "icon", "icon-sm", "icon-lg"],
    },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllVariants: Story = {
  play: async ({ canvasElement }) => golden(canvasElement, "button-variants"),
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {(
        ["default", "outline", "secondary", "ghost", "destructive", "link"] as const
      ).map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const AllSizes: Story = {
  play: async ({ canvasElement }) => golden(canvasElement, "button-sizes"),
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {(["xs", "sm", "default", "lg"] as const).map((size) => (
        <Button key={size} {...args} size={size}>
          {size}
        </Button>
      ))}
    </div>
  ),
};

// A disabled button that still fires onClick is a real bug that ships easily —
// `pointer-events-none` and the `disabled` attribute are two different things.
export const DisabledDoesNotFire: Story = {
  args: { disabled: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button");

    await expect(button).toBeDisabled();
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

