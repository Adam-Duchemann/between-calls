const process = require("node:process");
const path = require("node:path");
const { i18n } = require("./locale-config");

/** @type {import("next-i18next").UserConfig} */
const config = {
  i18n,
  fallbackLng: {
    default: ["en"],
    zh: ["zh-CN"],
  },
  reloadOnPrerender: process.env.NODE_ENV !== "production",
  localePath: path.resolve(__dirname, "./locales"),
};

module.exports = config;
