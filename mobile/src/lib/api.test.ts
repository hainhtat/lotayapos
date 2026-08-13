jest.mock("./session-store", () => ({
  getAccessToken: jest.fn(() => Promise.resolve("test-token")),
  clearAccessToken: jest.fn(() => Promise.resolve()),
}));

import { api, getAssignedParcel, getAssignedParcels, onUnauthorized } from "./api";
import { clearAccessToken, getAccessToken } from "./session-store";

function okJson(data: unknown, pagination?: { page: number; pageSize: number; total: number; totalPages: number }) {
  return Promise.resolve({
    ok: true,
    json: async () => ({ success: true, data, ...(pagination ? { pagination } : {}) }),
  });
}

describe("assigned parcel linked groups", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAccessToken as jest.Mock).mockResolvedValue("test-token");
    globalThis.fetch = jest.fn();
  });

  it("enriches the assigned list with linked-group id and member count", async () => {
    (globalThis.fetch as jest.Mock).mockImplementation(() =>
      okJson(
        [
          {
            id: "a",
            trackingNumber: "T-a",
            customerName: "A",
            address: "Same",
            codAmount: 1000,
            deliveryFee: 500,
            status: "ASSIGNED",
            linkGroup: { id: "group-1" },
          },
          {
            id: "b",
            trackingNumber: "T-b",
            customerName: "B",
            address: "Same",
            codAmount: 2000,
            deliveryFee: 1000,
            status: "ASSIGNED",
            linkGroup: { id: "group-1" },
          },
          {
            id: "c",
            trackingNumber: "T-c",
            customerName: "C",
            address: "Other",
            codAmount: 500,
            deliveryFee: 500,
            status: "ASSIGNED",
          },
        ],
        { page: 1, pageSize: 100, total: 3, totalPages: 1 },
      ),
    );

    const parcels = await getAssignedParcels();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/parcels?assignedToMe=true&page=1&pageSize=100"),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-token" }),
      }),
    );
    expect(parcels.find((parcel) => parcel.id === "a")).toMatchObject({
      linkedParcelGroupId: "group-1",
      linkedParcelCount: 2,
    });
    expect(parcels.find((parcel) => parcel.id === "c")).toMatchObject({
      linkedParcelGroupId: null,
      linkedParcelCount: undefined,
    });
  });

  it("pages through assigned parcels until totalPages is exhausted", async () => {
    (globalThis.fetch as jest.Mock)
      .mockImplementationOnce(() =>
        okJson(
          [{ id: "a", trackingNumber: "T-a", customerName: "A", address: "1", codAmount: 1, deliveryFee: 1, status: "ASSIGNED" }],
          { page: 1, pageSize: 100, total: 101, totalPages: 2 },
        ),
      )
      .mockImplementationOnce(() =>
        okJson(
          [{ id: "b", trackingNumber: "T-b", customerName: "B", address: "2", codAmount: 1, deliveryFee: 1, status: "ASSIGNED" }],
          { page: 2, pageSize: 100, total: 101, totalPages: 2 },
        ),
      );

    const parcels = await getAssignedParcels();
    expect(parcels.map((parcel) => parcel.id)).toEqual(["a", "b"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, expect.stringContaining("page=2&pageSize=100"), expect.any(Object));
  });

  it("uses detail link-group membership for linked parcel count", async () => {
    (globalThis.fetch as jest.Mock).mockImplementation(() =>
      okJson({
        id: "a",
        trackingNumber: "T-a",
        customerName: "A",
        address: "Same",
        codAmount: 1000,
        deliveryFee: 500,
        status: "OUT_FOR_DELIVERY",
        linkGroup: {
          id: "group-1",
          parcels: [
            { id: "a", trackingNumber: "T-a", status: "OUT_FOR_DELIVERY" },
            { id: "b", trackingNumber: "T-b", status: "ASSIGNED" },
          ],
        },
      }),
    );

    await expect(getAssignedParcel("a")).resolves.toMatchObject({
      linkedParcelGroupId: "group-1",
      linkedParcelCount: 2,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/parcels/a"),
      expect.any(Object),
    );
  });
});

describe("api unauthorized handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAccessToken as jest.Mock).mockResolvedValue("expired-token");
    globalThis.fetch = jest.fn();
  });

  it("clears the session and notifies listeners on authenticated 401", async () => {
    const listener = jest.fn();
    const unsubscribe = onUnauthorized(listener);
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Unauthorized" } }),
    });

    await expect(api("/parcels?assignedToMe=true")).rejects.toMatchObject({ status: 401 });
    expect(clearAccessToken).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("does not clear the session on login 401 without a stored token", async () => {
    (getAccessToken as jest.Mock).mockResolvedValue(null);
    const listener = jest.fn();
    const unsubscribe = onUnauthorized(listener);
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Invalid credentials" } }),
    });

    await expect(api("/auth/login", { method: "POST", body: "{}" })).rejects.toMatchObject({ status: 401 });
    expect(clearAccessToken).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
