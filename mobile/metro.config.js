// The app imports ../shared (texts, data types, money and date helpers) — the same code the website uses. Metro has to be told that
// this folder outside the app may be read (it reaches it through the node_modules/@mawah/shared link that npm makes).
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../shared")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
