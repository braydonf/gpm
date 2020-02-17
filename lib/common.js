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
const path = require('path');
const readlink = util.promisify(fs.readlink);
const lstat = util.promisify(fs.lstat);
const readdir = util.promisify(fs.readdir);
const unlink = util.promisify(fs.unlink);
const rmdir = util.promisify(fs.rmdir);
const access = util.promisify(fs.access);
const mkdir = util.promisify(fs.mkdir);
const symlink = util.promisify(fs.symlink);

async function ensureDir(dir) {
  try {
    await access(dir, fs.constants.R_OK & fs.constants.W_OK);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;

    await mkdir(dir);
  }
}

async function ensureSymlink(target, dst) {
  let existing = null;
  let stats = null;

  try {
    stats = await lstat(dst);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;
  }

  if (stats && !stats.isSymbolicLink())
    throw new Error(`Existing installation at '${dst}'.`);

  try {
    existing = await readlink(dst);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;
  }

  if (existing && existing !== target)
    throw new Error(`Existing linked installation at '${dst}'.`);
  else if (existing)
    return null;

  return symlink(target, dst);
}

async function exists(dst) {
  let verified = false;

  try {
    await access(dst, fs.constants.R_OK);
    verified = true;
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;
  }

  return verified;
}

async function unlinkRecursive(dst) {
  let stats = null;

  try {
    stats = await lstat(dst);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;
    return;
  }

  if (stats.isDirectory()) {
    let names = null;

    try {
      names = await readdir(dst);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
      return;
    }

    for (const name of names)
      await unlinkRecursive(path.join(dst, name));

    try {
      await rmdir(dst);
    } catch (err) {
      if (err.code !== 'ENOENT')
        throw err;
      return;
    }
  }

  try {
    await unlink(dst);
  } catch (err) {
    if (err.code !== 'ENOENT')
      throw err;
    return;
  }
}

module.exports = {
  ensureDir,
  ensureSymlink,
  exists,
  unlinkRecursive
};
