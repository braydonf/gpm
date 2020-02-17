/*!
 * Copyright (c) 2019, Braydon Fuller
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const util = require('util');
const fs = require('fs');
const cp = require('child_process');
const path = require('path');
const semver = require('../vendor/semver');
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const copyFile = util.promisify(fs.copyFile);
const access = util.promisify(fs.access);
const unlink = util.promisify(fs.unlink);
const readdir = util.promisify(fs.readdir);
const rename = util.promisify(fs.rename);
const mkdir = util.promisify(fs.mkdir);
const {spawn} = cp;
const nodeGyp = path.resolve(__dirname, '../vendor/node-gyp/bin/node-gyp.js');
const glob = util.promisify(require('../vendor/glob'));

const Environment = require('./environment');
const constants = require('./constants');
const {
  ensureDir,
  ensureSymlink,
  exists,
  unlinkRecursive
} = require('./common');

const {
  cloneRepo,
  verifyRepo,
  listTags,
  listBranches,
  sortTags,
  matchTag,
  getHeadCommit
} = require('./git');

/**
 * Package
 * Exposes information and methods for installing
 * and building a package and dependencies.
 * @property {String} dir
 * @property {Object} info
 * @property {Environment} env
 */

class Package {
  /**
   * Initialize the package.
   * @param {String} dir
   * @param {Object} info
   * @param {Environment?} env
   * @returns {Promise}
   */

  constructor(options = {}) {
    this.dir = null;
    this.info = null;
    this.parent = null;
    this.env = new Environment();
    this.initProperties(options);
  }

  /**
   * Initialize the package from object with
   * the directory of the package and the package
   * definition (package.json).
   * @param {Object} options
   * @param {String} options.dir
   * @param {Object} options.info
   * @param {Object} options.env
   * @returns {Promise}
   */

  initProperties(options = {}) {
    if (options.dir != null)
      this.dir = options.dir;

    if (options.info != null)
      this.info = options.info;

    if (options.env != null)
      this.env = options.env;

    if (options.parent != null)
      this.parent = options.parent;

    return this;
  }

  /**
   * Will get an array of parents.
   * @param {String?} property
   * @param {Boolean?} inclusive
   * @returns {Array}
   */

  getParents(property, inclusive) {
    const parents = [];
    let current = this.parent;

    if (inclusive) {
      if (property)
        parents.push(this[property]);
      else
        parents.push(this);
    }

    while (current && current !== this) {
      if (property)
        parents.unshift(current[property]);
      else
        parents.unshift(current);

      current = current.parent;
    }

    return parents;
  }

  /**
   * Will get default initial package info.
   * @param {Object?} info
   * @returns {Promise}
   */

  async getInitDefault(info = {}) {
    if (!info.name)
      info.name = path.basename(this.dir);

    if (info.version == null)
      info.version = '1.0.0';

    if (info.main == null)
      info.main = 'index.js';

    if (info.scripts == null) {
      info.scripts = {
        test: 'echo \"Error: no test specified\" && exit 1'
      };
    }

    return info;
  }

  /**
   * Will write initial package.json file.
   * @param {Object?} info
   * @returns {Promise}
   */

  async init(info = {}) {
    if (this.info)
      throw new Error('Package already initialized.');

    info = await this.getInitDefault(info);
    await this.writePackage(info);

    return 0;
  }

  /**
   * Initialize the package from a directory. Optionally
   * it will recursively walk up directories to find the
   * package definition.
   * @param {Object} options
   * @param {String} options.dir
   * @param {Boolean?} options.walk
   * @param {Environment?} options.env
   * @param {Package?} options.parent
   * @returns {Promise}
   */

  async fromDirectory(options = {}) {
    const {dir, walk = true, env, parent} = options;
    let cwd = dir;
    let moddir = null;
    let data = null;

    while (data == null) {
      try {
        data = await readFile(path.join(cwd, 'package.json'), 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;

        if (data)
          break;

        const dirparent = path.resolve(cwd, '../');
        if (dirparent === cwd || !walk)
          break;
        else
          cwd = dirparent;
      }
    }

    let info = null;

    if (data) {
      info = JSON.parse(data);
      moddir = cwd;
    } else {
      moddir = dir;
    }

    return this.initProperties({
      dir: moddir,
      info: info,
      env: env,
      parent: parent
    });
  }

  static async fromDirectory(options) {
    return new Package().fromDirectory(options);
  }

  /**
   * Resolves the git remote url for a dependency for
   * the package with branch and version information.
   * @param {String} options.name
   * @param {String} options.src
   * @param {Boolean} options.global
   */

  resolveRemote(options) {
    const {name, src} = options;

    let remotes = null;

    if (!options.global)
      remotes = this.info.remotes;

    let git = null;
    const reg = /^(git\+(ssh\:\/\/|https\:\/\/|file\:\/\/)|git\:\/\/)(.*)$/;
    const matched = src.match(reg);

    function findVersion(branch) {
      let version = null;

      if (branch)
        version = branch.replace('semver:', '');

      if (version !== branch)
        branch = null;
      else
        version = null;

      return {branch, version};
    }

    // Handle sources.
    if (matched) {
      let url = null;

      if (matched[2])
        url = matched[2] + matched[3];
      else
        url = matched[1] + matched[3];

      const [host, extra] = url.split('#');
      const {branch, version} = findVersion(extra);

      git = host;

      return {git, version, branch};
    }

    // Handle remote sources.
    const [remote, id] = src.split(/\:(.*)/, 2);

    // Handle version only sources if the src
    // does not have remote and id.
    if (!id)
      return {git, version: src, branch: null};

    let [repo, extra] = id.split('#');
    const {branch, version} = findVersion(extra);

    if (!repo)
      repo = name;

    if (!remotes)
      throw new Error('Unknown remotes.');

    const host = remotes[remote];

    if (!host)
      throw new Error(`Unknown remote ${remote}.`);

    if (host.indexOf('git+file://') === 0) {
      let dir = host.replace('git+file://', '');

      if (!path.isAbsolute(dir)) {
        if (!this.env.basedir)
          throw new Error('Unknown base.');

        dir = path.resolve(this.env.basedir, dir);
      }

      git = `file://${dir}/${repo}/.git`;
    } else {
      git = `${host}/${repo}.git`;
    }

    return {git, version, branch};
  }

  /**
   * Will check for an existing installation.
   * @param {String} dst
   * @returns {Promise}
   */

  async existingVersion(dst) {
    let existingPkg = null;

    try {
      existingPkg = JSON.parse(
        await readFile(path.join(dst, 'package.json'), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    const info = {};

    if (existingPkg) {
      info.pkg = true;
      info.version = existingPkg.version;
      info.commit = existingPkg._commit;
    }

    return info;
  }

  /**
   * Will check if there is an existing version and if
   * that version will satisfy the install constraints.
   * @param {String} modulePath
   * @param {String} commit
   * @param {String} version
   * @returns {Promise}
   */

  async checkExisting(modulePath, commit, version) {
    const existing = await this.existingVersion(modulePath);

    if (existing.pkg) {
      if (commit) {
        if (existing.commit === commit)
          return [true, true];
      } else {
        if (semver.satisfies(existing.version, version))
          return [true, true];
      }
      return [true, false];
    }

    return [false, false];
  }

  /**
   * Will determine the installation path.
   * @param {String} options.name
   * @param {String} options.version
   * @param {String} options.commit
   * @param {String} options.global
   * @returns {Promise}
   */

  async determinePath(options) {
    const {name, version, commit} = options;

    let dirs = [];

    if (options.global)
      dirs.push(this.env.globalLibRoot);
    else
      dirs = this.getParents('dir', true);

    if (!dirs.length)
      throw new Error('Unknown dir.');

    const paths = {dstDir: null, dst: null};

    let satisfied = false;
    let conflict = null;

    for (const dir of dirs) {
      const mbase = path.join(dir, 'node_modules');
      const mpath = path.join(mbase, name);

      const [mexist, mokay] = await this.checkExisting(
        mpath, commit, version);

      if (mexist) {
        if (mokay) {
          satisfied = true;
          break;
        } else {
          conflict = mpath;
          continue;
        }
      } else {
        satisfied = true;
        paths.dstDir = mbase;
        paths.dst = mpath;
        break;
      }
    }

    if (!satisfied && conflict)
      throw new Error(`Existing '${name}' at '${conflict}.'`);

    return paths;
  }

  /**
   * Will discover the name and version for a git repository.
   * @param {String} git
   * @param {String} version
   * @param {String} branch
   * @returns {Promise}
   */

  async discoverRepo(git, version, branch) {
    const info = {name: null, version: null};
    let commit = null;
    let tag = null;

    if (branch) {
      const branches = await listBranches(git);
      if (!branches[branch])
        throw new Error(`Unknown branch '${branch}'.`);

      commit = branches[branch];
    } else {
      const tags = await listTags(git);
      const keys = sortTags(Object.keys(tags), true);

      if (version) {
        const match = matchTag(keys, version);
        if (!match)
          throw new Error(`Unknown tag for '${git}'.`);

        tag = tags[match];
      } else {
        let latest = null;

        for (const tag of keys) {
          const parsed = semver.parse(tag);

          if (parsed.prerelease.length > 0)
            continue;

          latest = tag;
        }

        if (latest)
          tag = tags[latest];
      }
    }

    const verified = this.getVerifiedPath(tag, commit);

    const hasVerified = await exists(verified);

    if (!hasVerified)
      await this.fetchVerified({git, tag, branch, dst: verified});

    const pkg = await Package.fromDirectory({
      dir: verified,
      walk: false,
      env: this.env,
      parent: null
    });

    if (!pkg.info)
      return info;

    info.name = pkg.info.name;
    info.version = pkg.info.version;

    return info;
  }

  /**
   * Will fetch a repository to cache and verify
   * the signature.
   * @param {Object} options
   * @param {String} options.git
   * @param {Object} options.tag
   * @param {String} options.tag.name
   * @param {String} options.tag.annotated
   * @param {String} options.tag.commit
   * @param {String} options.branch
   * @param {String} options.dst
   * @returns {Promise}
   */

  async fetchVerified(options) {
    const {git, tag, branch, dst} = options;
    const unverified = `${dst}-unverified`;

    if (branch) {
      if (!await exists(unverified))
        await cloneRepo(branch, git, unverified);

      await verifyRepo(null, branch, unverified, this.env.stdio);
    } else {
      if (!await exists(unverified))
        await cloneRepo(tag.name, git, unverified);

      if (tag.annotated)
        await verifyRepo(tag.name, null, unverified, this.env.stdio);
      else
        await verifyRepo(null, tag.commit, unverified, this.env.stdio);
    }

    await rename(unverified, dst);
  }

  /**
   * Will get the cache path for a verified repository.
   * @param {Object} tag
   * @param {String} tag.annotated
   * @param {String} tag.commit
   * @param {String} commit
   * @returns {String}
   */

  getVerifiedPath(tag, commit) {
    let verified = null;

    if (commit) {
      verified = path.join(this.env.cache, `${commit}`);
    } else if (tag.annotated) {
      verified = path.join(this.env.cache, `${tag.annotated}`);
    } else {
      if (!tag.commit)
        throw new Error('Unknown commit.');

      verified = path.join(this.env.cache, `${tag.commit}`);
    }

    return verified;
  }

  /**
   * Will install a module.
   * @param {String} options.name
   * @param {String} options.src
   * @param {String} options.global
   * @returns {Promise}
   */

  async installModule(options) {
    const {name, src} = options;

    const {git, version, branch} = this.resolveRemote({
      name: name,
      src: src,
      global: options.global
    });

    let branches = Object.create(null);
    let commit = null;
    let tags = Object.create(null);
    let tag = null;

    if (branch) {
      if (!git)
        throw new Error(`Unknown remote for '${name}'.`);

      branches = await listBranches(git);

      if (!branches[branch])
        throw new Error(`Unknown branch '${branch}'.`);

      commit = branches[branch];
    }

    const {dst, dstDir} = await this.determinePath({
      name: name,
      version: version,
      commit: commit,
      global: options.global
    });

    if (!dst)
      return null;

    if (!branch) {
      if (!git)
        throw new Error(`Unknown remote for '${name}'.`);

      tags = await listTags(git);
      const match = matchTag(Object.keys(tags), version);

      if (!match)
        throw new Error(`Unknown tag for '${name}'.`);

      tag = tags[match];
    }

    const verified = this.getVerifiedPath(tag, commit);
    const hasVerified = await exists(verified);

    if (!hasVerified) {
      this.env.log(
        `Cloning '${name}' from '${git}' at '${tag ? tag.name : branch}'.`);

      await this.fetchVerified({
        git: git,
        tag: tag,
        branch: branch,
        dst: verified
      });
    }

    const head = await getHeadCommit(verified);

    const pkg = await Package.fromDirectory({
      dir: verified,
      walk: false,
      env: this.env,
      parent: options.global ? null : this
    });

    this.env.log(`Copying '${name}' at '${head}' to '${dst}'.`);

    await ensureDir(dstDir);

    await pkg.copyPackage(verified, dst);

    await pkg.injectMeta({
      dst: dst,
      src: src,
      url: git,
      commit: head,
      branch: branch
    });

    return dst;
  }

  /**
   * Will uninstall a module.
   * @param {String} name
   * @returns {Promise}
   */

  async uninstallGlobalModule(name) {
    const dst = path.join(this.env.globalLibDir, name);

    this.env.log(`Uninstalling global library '${name}' at '${dst}'.`);

    await unlinkRecursive(dst);
  }

  /**
   * Will get all the dependencies that should be installed.
   * @param {Object?} options
   * @param {Boolean?} options.production
   * @returns {Object}
   */

  getDependencies(options = {}) {
    const dependencies = {};

    if (!this.info.dependencies && !this.info.devDependencies)
      return dependencies;

    if (this.info.dependencies) {
      for (const [name, src] of Object.entries(this.info.dependencies))
        dependencies[name] = src;
    }

    if (!options.production && this.info.devDependencies) {
      for (const [name, src] of Object.entries(this.info.devDependencies)) {
        if (dependencies[name] != null)
          throw new Error('Duplicate dependency ${name}.');
        else
          dependencies[name] = src;
      }
    }

    return dependencies;
  }

  /**
   * Will add and install packages and dependencies.
   * @param {Array?} sources
   * @param {Object?} options
   * @returns {Promise}
   */

  async install(sources = [], options = {}) {
    const deps = await this.determineSources(sources, {
      global: options.global
    });

    if (options.global && sources.length > 0) {
      for (const [name, src] of Object.entries(deps)) {
        const dst = await this.installModule({
          name,
          src,
          global: true
        });

        if (!dst)
          return 1;

        const pkg = await Package.fromDirectory({
          dir: dst,
          walk: false,
          env: this.env,
          parent: null
        });

        await pkg.installDependencies({production: true});

        await pkg.rebuild();

        await pkg.linkBin(null, {global: true});

        await pkg.linkDependenciesBin();
      }
    } else {
      await this.addToPackage(deps);

      await this.installDependencies({production: options.production});

      await this.rebuild();

      if (options.global)
        await this.linkGlobal();

      await this.linkBin(null, {
        global: options.global
      });

      await this.linkDependenciesBin();
    }

    return 0;
  }

  /**
   * Will remove and uninstall packages.
   * @param {Array?} sources
   * @param {Object?} options
   * @param {Boolean?} options.global
   * @param {Boolean?} options.production
   * @returns {Promise}
   */

  async uninstall(sources = [], options = {}) {
    if (options.global && sources.length > 0) {
      for (const source of sources) {
        const dst = path.join(this.env.globalLibDir, source);

        const pkg = await Package.fromDirectory({
          dir: dst,
          walk: false,
          env: this.env,
          parent: null
        });

        if (!pkg.info)
          throw new Error(`Package '${source}' not found.`);

        await pkg.unlinkBin(null, {global: true});

        await this.uninstallGlobalModule(source);
      }
    } else {
      await this.unlinkDependenciesBin(sources);

      if (options.global)
        await this.unlinkGlobal();

      await this.removeFromPackage(sources);

      await this.uninstallDependencies(options);
    }

    return 0;
  }

  /**
   * Will determine the dependency object from the sources.
   * @param {Array} sources
   * @returns {Promise}
   */

  async determineSources(sources, options) {
    const deps = {};

    if (!sources.length)
      return deps;

    for (const src of sources) {
      const {git, version, branch} = this.resolveRemote({
        src: `git+${src}`,
        global: options.global
      });

      const info = await this.discoverRepo(git, version, branch);

      if (branch)
        deps[info.name] = `git+${git}#${branch}`;
      else
        deps[info.name] = `git+${git}#semver:^${info.version}`;
    }

    return deps;
  }

  /**
   * Will read the package.json file.
   * @returns {Promise}
   */

  async readPackage() {
    let data = null;
    const filename = path.join(this.dir, 'package.json');

    try {
      data = await readFile(filename, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (!data)
      throw new Error(`Unknown package at ${filename}.`);

    return JSON.parse(data);
  }

  /**
   * Will write the package.json file.
   * @param {Object} info
   * @returns {Promise}
   */

  async writePackage(info) {
    const filename = path.join(this.dir, 'package.json');
    return writeFile(filename, JSON.stringify(info, null, 2) + '\n');
  }

  static sortDependencyEntries(a, b) {
    if (a[0] === b[0])
      return 0;
    else
      return a[0] < b[0] ? -1 : 1;
  }

  /**
   * Will add new dependencies to the package.json.
   * @param {Object}
   * @returns {Promise}
   */

  async addToPackage(deps) {
    const entries = Object.entries(deps);
    if (!entries.length)
      return;

    const info = await this.readPackage();

    if (!info.dependencies)
      info.dependencies = {};

    for (const [name] of entries)
      this.env.log(`Adding '${name}' to package.`);

    let dependencies = Object.entries(info.dependencies);
    dependencies = dependencies.concat(entries);
    dependencies.sort(Package.sortDependencyEntries);

    for (const [name, src] of dependencies)
      info.dependencies[name] = src;

    await this.writePackage(info);

    this.info = info;
  }

  /**
   * Will remove dependencies from the package.json.
   * @param {Array} sources
   * @returns {Promise}
   */

  async removeFromPackage(sources) {
    const info = await this.readPackage();

    if (!info.dependencies)
      throw new Error('No dependencies.');

    for (const source of sources) {
      if (!info.dependencies[source])
        throw new Error('Dependency not found.');

      this.env.log(`Removing '${source}' from package.`);

      delete info.dependencies[source];
    }

    const dependencies = Object.entries(info.dependencies);
    dependencies.sort(Package.sortDependencyEntries);

    info.dependencies = {};

    for (const [name, src] of dependencies)
      info.dependencies[name] = src;

    await this.writePackage(info);

    this.info = info;
  }

  /**
   * Will fetch, verify, install and build the dependencies
   * for the package.
   * @param {Object?} options
   * @param {Boolean?} options.production
   * @returns {Promise}
   */

  async installDependencies(options = {}) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    this.env.log(`Installing '${this.info.name}' at '${this.dir}'.`);

    const installed = [];
    const dependencies = this.getDependencies(options);

    for (const [name, src] of Object.entries(dependencies)) {
      const dst = await this.installModule({name, src});
      if (dst)
        installed.push(dst);
    }

    for (const next of installed) {
      const dep = await Package.fromDirectory({
        dir: next,
        walk: false,
        env: this.env,
        parent: this
      });

      await dep.installDependencies({production: true});
    }
  }

  /**
   * Will determine if a dependency is required as defined
   * by the package.
   * @param {String} name
   * @param {Object?} options
   * @param {Boolean?} options.production
   * @returns {Promise}
   */

  async isRequired(name, options) {
    const depdir = path.join(this.dir, 'node_modules', name);
    const pkg = await Package.fromDirectory({
      dir: depdir,
      walk: false,
      env: this.env,
      parent: this
    });

    if (!pkg.info)
      throw new Error(`Unknown package '${name}.'`);

    const version = pkg.info.version;
    const branch = pkg.info._branch;

    const checkPackage = async (dir, parent) => {
      const pkg = await Package.fromDirectory({
        dir: dir,
        walk: false,
        env: this.env,
        parent: parent
      });

      if (!pkg.info)
        return false;

      if (!pkg.info.dependencies)
        return false;

      const deps = this.getDependencies(options);

      for (const [depname, depsrc] of Object.entries(deps)) {
        if (depname !== name)
          continue;

        const remote = this.resolveRemote({
          name: depname,
          src: depsrc
        });

        if (branch) {
          if (branch === remote.branch)
            return true;
        } else {
          if (semver.satisfies(version, remote.version))
            return true;
        }
      }

      const moddir = path.join(dir, 'node_modules');

      let dependencies = [];

      try {
        dependencies = await readdir(moddir);
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
      }

      for (const dep of dependencies) {
        if (await checkPackage(path.join(moddir, dep), pkg))
          return true;
      }

      return false;
    };

    return checkPackage(this.dir);
  }

  /**
   * Will uninstall a dependency from installed dependencies.
   * @returns {Promise}
   * @param {Object?} options
   * @param {Boolean?} options.production
   * @returns {Promise}
   */

  async uninstallDependencies(options) {
    let dependencies = [];

    const moddir = path.join(this.dir, 'node_modules');

    try {
      dependencies = await readdir(moddir);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    for (const name of dependencies) {
      if (name.indexOf('.') === 0)
        continue;

      if (!await this.isRequired(name, options)) {
        const depdir = path.join(moddir, name);
        this.env.log(`Uninstalling '${name}' at ${depdir}.`);
        await unlinkRecursive(depdir);
      }
    }
  }

  /**
   * Read the ignore file for a package directory from
   * several possible sources and create an array of patterns
   * of files to ignore. The ignore file syntax follows
   * the same pattern rules as a Git ignore file. There can be
   * an ignore file unique per directory.
   * @see https://git-scm.com/docs/gitignore
   * @see https://docs.npmjs.com/misc/developers#keeping-files-out-of-your-package
   * @param {String} dir
   * @returns {Promise}
   */

  async getIgnorePatterns(dir) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    let data = '';
    let exists = false;

    for (const name of constants.IGNORE_FILES) {
      try {
        data = await readFile(path.join(dir, name), 'utf8');
        exists = true;
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
      }

      if (exists)
        break;
    }

    const patterns = [];

    for (const pattern of constants.ALWAYS_IGNORE)
      patterns.push({pattern, always: true, inverse: false});

    for (const pattern of constants.IGNORE_FILES)
      patterns.push({pattern, always: true, inverse: false});

    for (let line of data.split('\n')) {
      // Exclude comments.
      if (line.indexOf('#') === 0)
        continue;

      // Exclude any blank line.
      if (!line.trim())
        continue;

      // Exclude anything that should never be ignored.
      if (constants.NEVER_IGNORE.includes(line))
        continue;

      // There is separate logic for ignoring node_modules
      // based on bundled dependencies.
      if (line.indexOf('node_modules/') === 0)
        continue;

      // Determine if the pattern is inverse.
      const inverse = (line.indexOf('!') === 0);
      if (inverse)
        line = line.replace('!', '');

      patterns.push({pattern: line, always: false, inverse});
    }

    return patterns;
  }

  /**
   * Read the files to include for the package from the package
   * and create an array of patterns of files to keep. The syntax
   * follows the same pattern rules as a Git ignore file, however
   * it will keep the files instead of ignoring them.
   * @see https://docs.npmjs.com/files/package.json#files
   */

  async getKeepPatterns(src) {
    if (!Array.isArray(this.info.files))
      throw new Error('Package \'files\' is not an array.');

    const patterns = [];

    for (const pattern of constants.NEVER_IGNORE)
      patterns.push({pattern: pattern});

    for (let pattern of this.info.files) {
      if (constants.ALWAYS_IGNORE.includes(pattern))
        continue;

      const inverse = (pattern.indexOf('!') === 0);

      if (inverse)
        pattern = pattern.replace('!', '');

      patterns.push({pattern, inverse});
    }

    if (this.hasBundle())
      patterns.push({pattern: 'node_modules/', inverse: false});

    return patterns;
  }

  /**
   * Will determine if there are any bundled dependencies
   * as a part of the package.
   * @returns {Boolean}
   */

  hasBundle() {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    if (Array.isArray(this.info.bundleDependencies))
      return true;

    if (Array.isArray(this.info.bundledDependencies))
      return true;

    return false;
  }

  /**
   * Will determine if a file path is part of a
   * bundled dependency.
   * @param {String} base
   * @param {String} file
   * @returns {Array}
   */

  isBundleFile(base, file) {
    let bundleDependencies = [];

    if (this.info.bundledDependencies)
      bundleDependencies = this.info.bundledDependencies;

    if (this.info.bundleDependencies)
      bundleDependencies = this.info.bundleDependencies;

    if (!Array.isArray(bundleDependencies))
      throw new Error('Package \'bundledDependencies\' not an array.');

    file = file.replace(base, '');

    const match = file.match(/^\/node_modules\/([^\/]+)/);

    if (match) {
      const name = match[1];
      if (bundleDependencies.includes(name))
        return [true, true];
      else
        return [true, false];
    }

    return [false, false];
  }

  /**
   * Copies files from a git repository to a destination
   * directory filtering any ignored files.
   *
   * If the package.json includes a files property, only
   * those files will be copied.
   *
   * If there is an ignore file defined in the package, it
   * will copy all files except those that match the
   * ignored patterns.
   *
   * If there is both a files property and an ignore file,
   * the files property patterns will not be overridden.
   * However if a subdirectory includes an ignore file, it
   * will override the files pattern.
   *
   * @param {String} src
   * @param {String} dst
   * @returns {Promise}
   */

  async copyPackage(src, dst) {
    const keep = new Set();
    const ignore = new Set();

    let keepPatterns = [{pattern: '*'}];
    const hasKeepPatterns = (this.info.files != null);

    if (hasKeepPatterns)
      keepPatterns = await this.getKeepPatterns(src);

    for (const {pattern, inverse} of keepPatterns) {
      const files = await glob(pattern, {
        matchBase: true,
        root: src,
        cwd: src,
        absolute: true,
        dot: true
      });

      for (const file of files) {
        const [isModule, isBundle] = this.isBundleFile(src, file);

        if (isModule) {
          if (isBundle)
            keep.add(file);
          else
            ignore.add(file);
        } else {
          if (inverse)
            ignore.add(file);
          else
            keep.add(file);
        }
      }
    }

    const ignorePatterns = await this.getIgnorePatterns(src);

    for (const {pattern, always, inverse} of ignorePatterns) {
      const files = await glob(pattern, {
        matchBase: true,
        root: src,
        cwd: src,
        absolute: true,
        dot: true
      });

      // Do not override file patterns defined unless
      // it should always be ignored.
      if (!always &&
          hasKeepPatterns &&
          keep.has(this.env.normalizePath(file))) {
        continue;
      }

      for (const file of files) {
        if (inverse)
          keep.add(file);
        else
          ignore.add(file);
      }
    }

    const copyDirectory = async (from, to) => {
      const ignorePatterns = await this.getIgnorePatterns(from);

      for (const {pattern, inverse} of ignorePatterns) {
        const files = await glob(pattern, {
          matchBase: true,
          root: from,
          cwd: from,
          absolute: true,
          dot: true
        });

        for (const file of files) {
          if (inverse)
            keep.add(file);
          else
            ignore.add(file);
        }
      }

      const dirents = await readdir(from, {withFileTypes: true});

      await mkdir(to);

      for (const dirent of dirents) {
        const fromPath = path.join(from, dirent.name);

        if (!keep.has(this.env.normalizePath(fromPath)))
          continue;

        if (ignore.has(this.env.normalizePath(fromPath)))
          continue;

        const toPath = path.join(to, dirent.name);

        if (dirent.isDirectory()) {
          await copyDirectory(fromPath, toPath);
        } else {
          await copyFile(fromPath, toPath);
        }
      }
    };

    await copyDirectory(src, dst);
  }

  /**
   * Inject metadata into the package.json file
   * for a dependency. This is necessary for compatibility
   * purposes (`from` and `resolved`) and for use in keeping
   * track of the source (`commit` and `branch`).
   * @param {Object} meta
   * @param {String} meta.dst
   * @param {String} meta.src
   * @param {String} meta.url
   * @param {String} meta.commit
   * @param {String} meta.branch
   * @returns {Promise}
   */

  async injectMeta(meta) {
    const {dst, src, url, commit, branch} = meta;

    let data = null;
    const filename = path.join(dst, 'package.json');

    try {
      data = await readFile(filename, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (!data)
      throw new Error(`Unknown package at ${dst}.`);

    const info = JSON.parse(data);

    info._from = src;
    info._resolved = `git+${url}#${commit}`;
    info._commit = commit;

    if (branch)
      info._branch = branch;

    return writeFile(filename, JSON.stringify(info, null, 2) + '\n');
  }

  /**
   * Will determine if there is a native addon.
   * @param {String} dir
   * @returns {Promise}
   */

  async hasAddon(dir) {
    const gyp = path.join(dir, 'binding.gyp');
    let has = false;

    try {
      await access(gyp, fs.constants.R_OK);
      has = true;
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    return has;
  }

  /**
   * Will build the native addon for the package.
   * @param {String} dir
   * @returns {Promise}
   */

  async rebuildModule(dir) {
    if (!await this.hasAddon(dir))
      return null;

    return new Promise((resolve, reject) => {
      const child = spawn('node', [nodeGyp, 'rebuild'], {
        cwd: dir,
        stdio: this.env.stdio
      });

      child.once('exit', code => resolve(code));
      child.once('error', err => reject(err));
    });
  }

  /**
   * Will build the native addon for the package
   * and all dependencies.
   * @param {String?} dir
   * @returns {Promise}
   */

  async rebuild(dir) {
    if (!dir)
      dir = this.dir;

    this.env.log(`Building '${dir}'.`);

    let dependencies = [];

    const moddir = path.join(dir, 'node_modules');

    try {
      dependencies = await readdir(moddir);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    for (const dep of dependencies) {
      if (dep.indexOf('.') === 0)
        continue;

      await this.rebuild(path.join(moddir, dep));
    }

    return this.rebuildModule(dir);
  }

  /**
   * Will link library to the global library path.
   * @returns {Promise}
   */

  async linkGlobal() {
    const libdir = this.env.globalLibDir;
    await ensureDir(libdir);

    const libpath = path.join(libdir, this.info.name);
    this.env.log(
      `Linking global library '${this.info.name}' at '${libpath}'.`);
    await ensureSymlink(this.dir, libpath);
  }

  /**
   * Will unlink library from the global library path.
   * @returns {Promise}
   */

  async unlinkGlobal() {
    const libdir = this.env.globalLibDir;
    const libpath = path.join(libdir, this.info.name);
    this.env.log(
      `Unlinking global library '${this.info.name}' at '${libpath}'.`);
    await unlink(libpath);
  }

  /**
   * Will link executables to the location.
   * @param {String?} location
   * @param {Object?} options
   * @param {Boolean?} options.global
   * @returns {Promise}
   */

  async linkBin(location, options = {}) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    if (options.global)
      location = this.env.globalBinDir;

    if (location && this.info.bin) {
      for (const [name, rel] of Object.entries(this.info.bin)) {
        let libdir = this.dir;

        if (options.global)
          libdir = path.join(this.env.globalLibDir, this.info.name);

        const target = path.relative(location, path.join(libdir, rel));
        const bin = path.join(location, name);

        this.env.log(`Linking '${this.info.name}' at '${bin}'.`);

        await ensureDir(location);
        await ensureSymlink(target, bin);
        await this.env.createCmd(bin);
      }
    }
  }

  /**
   * Will link executables for the dependencies.
   * @returns {Promise}
   */

  async linkDependenciesBin() {
    let dependencies = [];

    const moddir = path.join(this.dir, 'node_modules');

    try {
      dependencies = await readdir(moddir);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (dependencies.length > 0) {
      const bindir = path.join(moddir, '.bin');

      for (const name of dependencies) {
        if (name.indexOf('.') === 0)
          continue;

        const depdir = path.join(moddir, name);
        const pkg = await Package.fromDirectory({
          dir: depdir,
          walk: false,
          env: this.env,
          parent: this
        });

        await pkg.linkBin(bindir);
      }
    }
  }

  /**
   * Will unlink executables from a location.
   * @param {String} location
   * @param {Object} options
   * @param {Boolean} options.global
   * @returns {Promise}
   */

  async unlinkBin(location, options = {}) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    if (options.global)
      location = this.env.globalBinDir;

    if (location && this.info.bin) {
      for (const [name] of Object.entries(this.info.bin)) {
        const bin = path.join(location, name);

        this.env.log(`Unlinking '${this.info.name}' at '${bin}'.`);

        try {
          await unlink(bin);
          await this.env.unlinkCmd(bin);
        } catch (err) {
          if (err.code !== 'ENOENT')
            throw err;
        }
      }
    }
  }

  /**
   * Will unlink executables from a location.
   * @param {Array} sources
   * @returns {Promise}
   */

  async unlinkDependenciesBin(sources) {
    let dependencies = [];

    const moddir = path.join(this.dir, 'node_modules');

    try {
      dependencies = await readdir(moddir);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
    }

    if (dependencies.length > 0) {
      const bindir = path.join(moddir, '.bin');

      for (const name of dependencies) {
        if (name.indexOf('.') === 0)
          continue;

        if (sources.includes(name)) {
          const depdir = path.join(moddir, name);
          const pkg = await Package.fromDirectory({
            dir: depdir,
            walk: false,
            env: this.env,
            parent: this
          });

          await pkg.unlinkBin(bindir);
        }
      }
    }
  }

  /**
   * Will run a script defined by the package.
   * @param {String} name
   * @param {Array?} extra
   * @param {Object?} envars
   * @returns {Promise}
   */

  async run(name, extra = [], envars = process.env) {
    if (!this.info)
      throw new Error(`Unknown package at '${this.dir}'.`);

    if (!this.info.scripts || !this.info.scripts[name])
      throw new Error(`Unknown script '${name}'.`);

    this.env.log(`Running '${name}' at '${this.dir}' for ` +
                 `'${this.info.name}@${this.info.version}'.`);
    this.env.log(`Command '${this.info.scripts[name]}'.`);

    let [cmd, ...args] = this.info.scripts[name].split(' ');

    args = args.concat(extra);

    await this.env.run(cmd, args, {
      cwd: this.dir,
      env: envars,
      extraPath: path.join(this.dir, 'node_modules', '.bin')
    });
  }
}

module.exports = Package;
