import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "react-toastify";
import { createAppQueryClient } from "@/app/providers";
import { errorMessage, notifyError, notifySuccess } from "./notifications";

describe("notifications", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows useful accessible error and success notifications", () => {
    const error = vi.spyOn(toast, "error").mockReturnValue("error-toast");
    const success = vi.spyOn(toast, "success").mockReturnValue("success-toast");
    notifyError(new Error("Wallet could not be updated"));
    notifySuccess("Rider saved");
    expect(error).toHaveBeenCalledWith("Wallet could not be updated", expect.objectContaining({ ariaLabel: "Wallet could not be updated" }));
    expect(success).toHaveBeenCalledWith("Rider saved", expect.objectContaining({ ariaLabel: "Rider saved" }));
    expect(errorMessage({})).toBe("Something went wrong. Please try again.");
  });

  it("routes every mutation failure through the global notification handler", async () => {
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("error-toast");
    const client = createAppQueryClient();
    const mutation = client.getMutationCache().build(client, { mutationFn: async () => { throw new Error("Save failed"); } });
    await expect(mutation.execute(undefined)).rejects.toThrow("Save failed");
    expect(errorToast).toHaveBeenCalledWith("Save failed", expect.any(Object));
  });
});
