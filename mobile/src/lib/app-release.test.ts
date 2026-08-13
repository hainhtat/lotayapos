import {fetchRiderAppRelease,isNewerRelease} from "./app-release";

describe("rider APK sideload updates",()=>{
  it("compares dotted versions",()=>{
    expect(isNewerRelease("0.1.0","0.1.1")).toBe(true);
    expect(isNewerRelease("0.1.0","0.1.0")).toBe(false);
    expect(isNewerRelease("0.2.0","0.1.9")).toBe(false);
  });

  it("accepts a version manifest with an http APK URL",async()=>{
    const fetcher=jest.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({version:"0.2.0",apkUrl:"https://lotaya.mmds.site/app/lotaya-rider.apk"})});
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",fetcher)).resolves.toEqual({
      version:"0.2.0",
      apkUrl:"https://lotaya.mmds.site/app/lotaya-rider.apk",
    });
  });

  it("rejects http and off-host APK URLs",async()=>{
    const http=jest.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({version:"0.2.0",apkUrl:"http://lotaya.mmds.site/app/lotaya-rider.apk"})});
    const other=jest.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({version:"0.2.0",apkUrl:"https://evil.example/lotaya-rider.apk"})});
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",http)).resolves.toBeNull();
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",other)).resolves.toBeNull();
  });

  it("rejects a manifest without a download URL",async()=>{
    const fetcher=jest.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({version:"0.2.0"})});
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",fetcher)).resolves.toBeNull();
  });

  it("rejects non-http APK URLs and failed lookups",async()=>{
    const javascript=jest.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({version:"0.2.0",apkUrl:"javascript:alert(1)"})});
    const file=jest.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({version:"0.2.0",apkUrl:"file:///tmp/lotaya-rider.apk"})});
    const failed=jest.fn().mockResolvedValue({ok:false,json:()=>Promise.resolve({})});
    const crashed=jest.fn().mockRejectedValue(new Error("offline"));
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",javascript)).resolves.toBeNull();
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",file)).resolves.toBeNull();
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",failed)).resolves.toBeNull();
    await expect(fetchRiderAppRelease("https://lotaya.mmds.site/app/version.json",crashed)).resolves.toBeNull();
  });
});
