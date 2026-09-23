const { withAppBuildGradle } = require("@expo/config-plugins");

const marker = "// LOTAYA_RELEASE_SIGNING";

function addReleaseSigning(source) {
  if (source.includes(marker)) return source;

  const signingBlock = `    ${marker}\n    def lotayaReleaseKeystore = System.getenv("LOTAYA_ANDROID_KEYSTORE")\n    def lotayaReleaseStorePassword = System.getenv("LOTAYA_ANDROID_STORE_PASSWORD")\n    def lotayaReleaseKeyAlias = System.getenv("LOTAYA_ANDROID_KEY_ALIAS")\n    def lotayaReleaseKeyPassword = System.getenv("LOTAYA_ANDROID_KEY_PASSWORD")\n    def lotayaReleaseSigningConfigured = [lotayaReleaseKeystore, lotayaReleaseStorePassword, lotayaReleaseKeyAlias, lotayaReleaseKeyPassword].every { it }\n\n    signingConfigs {`;
  source = source.replace("    signingConfigs {", signingBlock);
  source = source.replace(
    "        debug {\n            storeFile file('debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n    }",
    `        debug {\n            storeFile file('debug.keystore')\n            storePassword 'android'\n            keyAlias 'androiddebugkey'\n            keyPassword 'android'\n        }\n        release {\n            if (lotayaReleaseSigningConfigured) {\n                storeFile file(lotayaReleaseKeystore)\n                storePassword lotayaReleaseStorePassword\n                keyAlias lotayaReleaseKeyAlias\n                keyPassword lotayaReleaseKeyPassword\n            }\n        }\n    }`,
  );
  source = source.replace(
    "            signingConfig signingConfigs.debug\n            def enableShrinkResources",
    "            signingConfig signingConfigs.release\n            def enableShrinkResources",
  );
  source += `\n\ngradle.taskGraph.whenReady { graph ->\n    def lotayaSigningReady = [System.getenv("LOTAYA_ANDROID_KEYSTORE"), System.getenv("LOTAYA_ANDROID_STORE_PASSWORD"), System.getenv("LOTAYA_ANDROID_KEY_ALIAS"), System.getenv("LOTAYA_ANDROID_KEY_PASSWORD")].every { it }\n    if (graph.allTasks.any { it.name.toLowerCase().contains("release") } && !lotayaSigningReady) {\n        throw new GradleException("Release signing is not configured. Run npm run signing:setup and keep mobile/.env.release.local available.")\n    }\n}\n`;

  if (!source.includes(marker) || !source.includes("signingConfig signingConfigs.release")) {
    throw new Error("Could not apply LOTAYA Android release signing configuration.");
  }
  return source;
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("LOTAYA Android signing supports Groovy build.gradle files only.");
    }
    mod.modResults.contents = addReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
