const source = require("../../i18n.json");

exports.i18n = {
  defaultLocale: source.locale.source,
  locales: source.locale.targets.concat([source.locale.source]),
};
