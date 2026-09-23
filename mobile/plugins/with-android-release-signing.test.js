jest.mock("@expo/config-plugins", () => ({ withAppBuildGradle: jest.fn() }));
const { addReleaseSigning } = require("./with-android-release-signing");

const gradleFixture = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.debug
            def enableShrinkResources = 'false'
        }
    }
}`;

describe("LOTAYA Android release signing plugin", () => {
  it("replaces debug release signing and requires release credentials", () => {
    const result = addReleaseSigning(gradleFixture);

    expect(result).toContain("signingConfig signingConfigs.release");
    expect(result).toContain("LOTAYA_ANDROID_KEYSTORE");
    expect(result).toContain("Release signing is not configured");
    expect(result).not.toContain("release {\n            signingConfig signingConfigs.debug");
  });

  it("is idempotent", () => {
    const once = addReleaseSigning(gradleFixture);
    expect(addReleaseSigning(once)).toBe(once);
  });

  it("fails when Expo's Gradle template no longer matches", () => {
    expect(() => addReleaseSigning("android {}"))
      .toThrow("Could not apply LOTAYA Android release signing configuration");
  });
});
