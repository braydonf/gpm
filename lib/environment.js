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
const path = require('path');
const os = require('os');
const fs = require('fs');
const mkdir = util.promisify(fs.mkdir);
const access = util.promisify(fs.access);
const writeFile = util.promisify(fs.writeFile);
const unlink = util.promisify(fs.unlink);
const cp = require('child_process');
const {spawn} = cp;

/**
 * Environment
 * @property {Object} global
 * @property {Object} home
 * @property {Object} cache
 * @property {Object} stdio
 */

class Environment {
  /**
   * Initialize the environment.
   * @param {Object} stdio
   * @param {String} home
   * @param {String} global
   * @param {String} basedir
   * @returns {Promise}
   */

  constructor(stdio, home, global, basedir) {
    this.global = null;
    this.globalLibRoot = null;
    this.globalLibDir = null;
    this.globalBinDir = null;

    this.home = null;
    this.cache = null;

    this.basedir = null;

    this.stdio = [
      process.stdin,
      process.stdout,
      process.stderr
    ];

    this.initProperties(stdio, home, global, basedir);
  }

  /**
   * Initialize the environment properties.
   * @param {Object} stdio
   * @param {String} home
   * @param {String} global
   * @param {String} basedir
   * @returns {Promise}
   */

  initProperties(stdio, home, global, basedir) {
    if (stdio != null)
      this.stdio = stdio;

    // Setup global.
    if (global != null) {
      this.global = global;
    } else if (process.env.PREFIX) {
      this.global = process.env.PREFIX;
    } else {
      this.global = path.dirname(process.execPath);

      if (!isWin32()) {
        this.global = path.dirname(this.global);

        if (process.env.DESTDIR)
          this.global = path.join(process.env.DESTDIR, this.global);
      }
    }

    // Setup global paths.
    this.globalLibRoot = Environment.libroot(this.global);
    this.globalLibDir = Environment.libdir(this.global);
    this.globalBinDir = Environment.bindir(this.global);

    // Setup home.
    if (home != null)
      this.home = home;
    else
      this.home = path.join(os.homedir(), './.gpk');

    this.cache = path.join(this.home, './cache');

    // Setup git file base directory.
    if (basedir != null)
      this.basedir = basedir;
    else if (process.env.GPK_BASE_DIR)
      this.basedir = process.env.GPK_BASE_DIR;
  }

  /**
   * Returns the global bin path based on
   * the environment.
   * @param {String} base
   * @param {String}
   */

  static bindir(base) {
    if (!isWin32())
      return path.join(base, './bin');

    return base;
  }

  /**
   * Returns the global library path root based on
   * the environment.
   * @param {String} base
   * @param {String}
   */

  static libroot(base) {
    if (!isWin32())
      return path.join(base, './lib/');

    return base;
  }

  /**
   * Returns the global library path based on
   * the environment.
   * @param {String} base
   * @param {String}
   */

  static libdir(base) {
    if (!isWin32())
      return path.join(base, './lib/node_modules');

    return path.join(base, 'node_modules');
  }

  /**
   * For Windows a command script is generated
   * as the shebang of the target executable is
   * not honored.
   * @param {String} target
   * @returns {Promise}
   */

  async createCmd(target) {
    if (!isWin32())
      return;

    let body = ':: File created by gpk.\r\n';
    body += '@ECHO OFF\r\n';
    body += `node "${target}" %*\r\n`;

    await writeFile(`${target}.cmd`, body);
  }

  async unlinkCmd(target) {
    if (!isWin32())
      return null;

    return unlink(`${target}.cmd`);
  }

  /**
   * Ensure that necessary home directories exist.
   * @returns {Promise}
   */

  async ensure() {
    async function init(dir) {
      try {
        await access(dir, fs.constants.R_OK & fs.constants.W_OK);
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
        else
          await mkdir(dir);
      }
    }

    await init(this.home);
    await init(this.cache);
  }

  /**
   * Will run a command and arguments with the supplied
   * directory, environment variables and an additional
   * location added to the path.
   * @param {String} cmd
   * @param {Array} args
   * @param {Object} options
   * @param {Object} options.cwd
   * @param {Object} options.env
   * @param {String} options.extraPath
   */

  async run(cmd, args, options) {
    const env = Object.assign({}, options.env);

    let PATH = env.PATH;
    if (isWin32())
      PATH = env.Path;

    if (options.extraPath)
      PATH = `${options.extraPath}${isWin32() ? ';' : ':'}${PATH}`;

    if (isWin32())
      env.Path = PATH;
    else
      env.PATH = PATH;

    return new Promise((resolve, reject) => {
      let shell = false;

      if (isWin32())
        shell = true;

      const child = spawn(cmd, args, {
        shell: shell,
        cwd: options.cwd,
        stdio: this.stdio,
        env: env
      });

      child.once('exit', code => resolve(code));
      child.once('error', err => reject(err));
    });
  }

  /**
   * Will normalize a path to have forward slashes
   * for directories.
   * @param {String} str
   * @returns {String}
   */

  normalizePath(str) {
    if (!isWin32())
      return str;

    return str.replace(/\\/g, '/');
  }

  /**
   * Write to configured output.
   * @param {String} data
   */

  stdout(data) {
    this.stdio[1].write(data);
  }

  /**
   * Write to configured error output.
   * @param {String} data
   */

  stderr(data) {
    this.stdio[2].write(data);
  }

  /**
   * Log at info level.
   * @param {String} data
   */

  log(data) {
    this.stdout(`gpk: \x1b[34m[info]\x1b[39m ${data}\n`);
  }

  /**
   * Log at warn level.
   * @param {String} data
   */

  warn(data) {
    this.stdout(`gpk: \x1b[35m[warn]\x1b[39m ${data}\n`);
  }

  /**
   * Log at debug level.
   * @param {String} data
   */

  debug(data) {
    this.stdout(`gpk: \x1b[36m[debug]\x1b[39m ${data}\n`);
  }

  /**
   * Log at error level.
   * @param {String} data
   */

  error(data) {
    this.stderr(`gpk: \x1b[31m[error]\x1b[39m ${data}\n`);
  }
}

function isWin32() {
  return (process.platform === 'win32');
}

module.exports = Environment;
