import {callCustomer,sanitizedCustomerPhone} from "./phone";
describe("customer calling",()=>{
  it("opens a sanitized tel URL when supported",async()=>{const launcher={canOpenURL:jest.fn().mockResolvedValue(true),openURL:jest.fn().mockResolvedValue(undefined)};expect(await callCustomer("09 123-456",launcher)).toBe("opened");expect(launcher.openURL).toHaveBeenCalledWith("tel:09123456")});
  it("reports missing and unavailable calling",async()=>{const launcher={canOpenURL:jest.fn().mockResolvedValue(false),openURL:jest.fn()};expect(await callCustomer(undefined,launcher)).toBe("missing");expect(await callCustomer("091",launcher)).toBe("unavailable")});
  it("contains launcher failures",async()=>expect(await callCustomer("091",{canOpenURL:jest.fn().mockRejectedValue(new Error("no")),openURL:jest.fn()})).toBe("error"));
  it("keeps copyable digits when calling is unavailable",()=>expect(sanitizedCustomerPhone("09 777-111222")).toBe("09777111222"));
  it("yields no copyable digits when the phone is missing",()=>{
    expect(sanitizedCustomerPhone(undefined)).toBe("");
    expect(sanitizedCustomerPhone("")).toBe("");
  });
});
