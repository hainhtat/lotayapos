const { getDefaultConfig } = require("expo/metro-config");
const exclusionList = require("metro-config/private/defaults/exclusionList").default;

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Keep Jest files under app/ out of Expo Router / the JS bundle.
config.resolver.blockList = exclusionList([/.*\/app\/.*\.(test|spec)\.[jt]sx?$/]);

module.exports = config;
