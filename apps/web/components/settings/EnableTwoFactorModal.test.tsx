import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { FormProvider, type UseFormReturn, useFormContext } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EnableTwoFactorModal from "./EnableTwoFactorModal";

const api = vi.hoisted(() => ({ setup: vi.fn(), enable: vi.fn() }));
vi.mock("./TwoFactorAuthAPI", () => ({ default: api }));
vi.mock("@calcom/lib/hooks/useLocale", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@calcom/ui/components/toast", () => ({ showToast: vi.fn() }));
vi.mock("@calcom/features/components/controlled-dialog", () => ({
  Dialog: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: () => void }) => (
    <div>
      <button onClick={onOpenChange}>Dismiss dialog</button>
      {children}
    </div>
  ),
}));
vi.mock("@calcom/ui/components/dialog", () => ({
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@calcom/ui/components/button", () => ({
  Button: ({
    children,
    color: _color,
    loading: _loading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { color?: string; loading?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@calcom/ui/components/form", () => ({
  PasswordField: (props: InputHTMLAttributes<HTMLInputElement>) => <input aria-label="Password" {...props} />,
  Form: ({
    children,
    form,
    handleSubmit,
  }: {
    children: ReactNode;
    form: UseFormReturn<{ totpCode: string }>;
    handleSubmit: (values: { totpCode: string }) => void;
  }) => (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>{children}</form>
    </FormProvider>
  ),
}));
vi.mock("@components/auth/TwoFactor", () => ({
  default: () => {
    const { register } = useFormContext<{ totpCode: string }>();
    return <input aria-label="Authenticator code" {...register("totpCode")} />;
  },
}));

function setup() {
  const props = { open: true, onOpenChange: vi.fn(), onEnable: vi.fn(), onCancel: vi.fn() };
  render(<EnableTwoFactorModal {...props} />);
  return props;
}

async function enterCode() {
  fireEvent.input(screen.getByLabelText("Password"), { target: { value: "fixture-password" } });
  fireEvent.click(screen.getByText("continue"));
  fireEvent.click(await screen.findByTestId("goto-otp-screen"));
  fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
}

describe("2FA setup dialog completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = vi.fn(() => "blob:test-backup-codes");
    api.setup.mockResolvedValue({
      status: 200,
      json: async () => ({
        backupCodes: ["abcdefghij"],
        dataUri: "data:image/png;base64,",
        secret: "fixture",
      }),
    });
    api.enable.mockResolvedValue({ status: 200, json: async () => ({}) });
  });

  it("refreshes the parent when the completed backup-code screen is dismissed", async () => {
    const props = setup();
    await enterCode();
    await screen.findByTestId("backup-codes-close");
    expect(props.onEnable).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Dismiss dialog"));
    expect(props.onEnable).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("does not report completion when dismissed before enabling 2FA", () => {
    const props = setup();
    fireEvent.click(screen.getByText("Dismiss dialog"));
    expect(props.onOpenChange).toHaveBeenCalledTimes(1);
    expect(props.onEnable).not.toHaveBeenCalled();
  });

  it("does not report completion after a rejected authenticator code", async () => {
    api.enable.mockResolvedValue({ status: 400, json: async () => ({ error: "IncorrectTwoFactorCode" }) });
    const props = setup();
    await enterCode();
    await waitFor(() => expect(screen.getByTestId("error-submitting-code")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Dismiss dialog"));
    expect(props.onEnable).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledTimes(1);
  });
});
