var spawn = require("cross-spawn");
var fs = require("fs");
var kebabCase = require("lodash.kebabcase");
var path = require("path");
var util = require("util");

var INTERNAL = /^\./; // Match "./client", "../something", etc.
var EXTERNAL = /^[a-z\-0-9\.]+$/; // Match "react", "path", "fs", "lodash.random", etc.

module.exports.check = function(request) {
  if (!request) {
    return;
  }

  var namespaced = request.charAt(0) === "@";
  var dep = request.split("/")
    .slice(0, namespaced ? 2 : 1)
    .join("/")
  ;

  // Ignore relative modules, which aren't installed by NPM
  if (!dep.match(EXTERNAL) && !namespaced) {
    return;
  }

  try {
    var pkgPath = require.resolve(path.join(process.cwd(), "package.json"));
    var pkg = require(pkgPath);

    // Remove cached copy for future checks
    delete require.cache[pkgPath];
  } catch(e) {
    throw e;
  }

  var hasDep = pkg.dependencies && pkg.dependencies[dep];
  var hasDevDep = pkg.devDependencies && pkg.devDependencies[dep];

  // Bail early if we've already installed this dependency
  if (hasDep || hasDevDep) {
    return;
  }

  // Ignore linked modules
  try {
    var stats = fs.lstatSync(path.join(process.cwd(), "node_modules", dep));

    if (stats.isSymbolicLink()) {
      return;
    }
  } catch(e) {
    // Module exists in node_modules, but isn't symlinked
  }

  // Ignore NPM global modules (e.g. "path", "fs", etc.)
  try {
    var resolved = require.resolve(dep);

    // Global modules resolve to their name, not an actual path
    if (resolved.match(EXTERNAL)) {
      return;
    }
  } catch(e) {
    // Module is not resolveable
  }

  return dep;
};

module.exports.checkBabel = function checkBabel() {
  try {
    var babelrc = require.resolve(path.join(process.cwd(), ".babelrc"));
  } catch (e) {
    // Babel isn't installed, don't install deps
    return;
  }

  // `babel-core` is required for `babel-loader`
  this.install(this.check("babel-core"));

  // Default plugins/presets
  var options = Object.assign({
    plugins: [],
    presets: [],
  }, JSON.parse(fs.readFileSync(babelrc, "utf8")));

  if (!options.env) {
    options.env = {};
  }

  if (!options.env.development) {
    options.env.development = {};
  }

  // Default env.development plugins/presets
  options.env.development = Object.assign({
    plugins: [],
    presets: [],
  }, options.env.development);

  // Accumulate all dependencies
  var deps = options.plugins.map(function(plugin) {
    return "babel-plugin-" + plugin;
  }).concat(options.presets.map(function(preset) {
    return "babel-preset-" + preset;
  })).concat(options.env.development.plugins.map(function(plugin) {
    return "babel-plugin-" + plugin;
  })).concat(options.env.development.presets.map(function(preset) {
    return "babel-preset-" + preset;
  }));

  // Check for & install dependencies
  deps.forEach(function(dep) {
    this.install(this.check(dep));
  }.bind(this));
};

module.exports.checkPackage = function checkPackage() {
  try {
    require.resolve(path.join(process.cwd(), "package.json"));

    return;
  } catch (e) {
    // package.json does not exist
  }

  console.info("Initializing `%s`...", "package.json");
  spawn.sync("npm", ["init -y"], { stdio: "inherit" });
};

module.exports.install = function install(dep, options) {
  if (!dep) {
    return;
  }

  var args = ["install"].concat([dep]).filter(Boolean);

  if (options) {
    for (option in options) {
      var arg = util.format("--%s", kebabCase(option));
      var value = options[option];

      if (value === false) {
        continue;
      }

      if (value === true) {
        args.push(arg);
      } else {
        args.push(util.format("%s='%s'", arg, value));
      }
    }
  }

  console.info("Installing `%s`...", dep);

  var output = spawn.sync("npm", args, { stdio: "inherit" });

  return output;
};
