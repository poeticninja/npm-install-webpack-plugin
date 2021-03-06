var MemoryFS = require("memory-fs");
var path = require("path");
var webpack = require("webpack");

var installer = require("./installer");

var depFromErr = function(err) {
  if (!err) {
    return undefined;
  }

  /**
   * Supported package formats:
   * - path
   * - react-lite
   * - @cycle/core
   * - bootswatch/lumen/bootstrap.css
   * - lodash.random
   */
  var matches = /Cannot resolve module '([@\w\/\.-]+)' in/.exec(err);

  if (!matches) {
    return undefined;
  }

  return matches[1];
}

function NpmInstallPlugin(options) {
  this.compiler = null;
  this.options = options || {};
  this.resolving = {};

  installer.checkPackage();
  installer.checkBabel();
}

NpmInstallPlugin.prototype.apply = function(compiler) {
  this.compiler = compiler;

  // Recursively install missing dependencies so primary build doesn't fail
  compiler.plugin("watch-run", this.preInstall.bind(this));

  // Install externals that wouldn't normally be resolved
  compiler.options.externals.unshift(this.resolveExternal.bind(this));

  // Install loaders on demand
  compiler.resolvers.loader.plugin("module", this.resolveLoader.bind(this));

  // Install project dependencies on demand
  compiler.resolvers.normal.plugin("module", this.resolveModule.bind(this));
};

NpmInstallPlugin.prototype.preInstall = function(compilation, next) {
  var options = this.compiler.options;
  var plugins = options.plugins.filter(function(plugin) {
    return plugin.constructor !== NpmInstallPlugin;
  });

  var dryrun = webpack(Object.assign(
    {},
    { cache: {} },
    options
  ));

  dryrun.outputFileSystem = new MemoryFS();

  dryrun.run(function(err, stats) {
    next(err);
  });
};

NpmInstallPlugin.prototype.resolveExternal = function(context, request, callback) {
  // Only install direct dependencies, not sub-dependencies
  if (context.match("node_modules")) {
    return callback();
  }

  // Ignore !!bundle?lazy!./something
  if (request.match(/(\?|\!)/)) {
    return callback();
  }

  this.compiler.resolvers.normal.resolve(
    context,
    request,
    function(err, filepath) {
      if (err) {
        var dep = installer.check(depFromErr(err));

        if (dep) {
          installer.install(dep, this.options);
        }
      }

      callback();
    }.bind(this)
  );
};

NpmInstallPlugin.prototype.resolveLoader = function(result, next) {
  var loader = result.request;

  // Ensure loaders end with `-loader` (e.g. `babel` => `babel-loader`)
  if (!loader.match(/\-loader$/)) {
    loader += "-loader";
  }

  var dep = installer.check(loader);

  if (dep) {
    installer.install(dep, this.options);

    return this.resolveLoader(result, next);
  }

  return next();
};

NpmInstallPlugin.prototype.resolveModule = function(result, next) {
  // Only install direct dependencies, not sub-dependencies
  if (result.path.match("node_modules")) {
    return next();
  }

  if (this.resolving[result.request]) {
    return next();
  }

  this.resolving[result.request] = true;

  this.compiler.resolvers.normal.resolve(
    result.path,
    result.request,
    function(err, filepath) {
      this.resolving[result.request] = false;

      if (err) {
        var dep = installer.check(depFromErr(err));

        if (dep) {
          installer.install(dep, this.options);

          return this.resolveModule(result, next);
        }
      }

      return next();
    }.bind(this)
  );
};

module.exports = NpmInstallPlugin;
