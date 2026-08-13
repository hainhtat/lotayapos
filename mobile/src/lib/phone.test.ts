import {callCustomer} from "./phone";
describe("customer calling",()=>{
  it("opens a sanitized tel URL when supported",async()=>{const launcher={canOpenURL:jest.fn().mockResolvedValue(true),openURL:jest.fn().mockResolvedValue(undefined)};expect(await callCustomer("09 123-456",launcher)).toBe("opened");expect(launcher.openURL).toHaveBeenCalledWith("tel:09123456")});
  it("reports missing and unavailable calling",async()=>{const launcher={canOpenURL:jest.fn().mockResolvedValue(false),openURL:jest.fn()};expect(await callCustomer(undefined,launcher)).toBe("missing");expect(await callCustomer("091",launcher)).toBe("unavailable")});
  it("contains launcher failures",async()=>expect(await callCustomer("091",{canOpenURL:jest.fn().mockRejectedValue(new Error("no")),openURL:jest.fn()})).toBe("error"));
});
