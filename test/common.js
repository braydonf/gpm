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

const {resolve} = require('path');
const {tmpdir} = require('os');
const {randomBytes} = require('crypto');
const path = require('path');
const util = require('util');
const cp = require('child_process');
const exec = util.promisify(cp.exec);
const fs = require('fs');
const rmdir = util.promisify(fs.rmdir);
const readdir = util.promisify(fs.readdir);
const lstat = util.promisify(fs.lstat);
const unlink = util.promisify(fs.unlink);

const datadir = resolve(__dirname, './data');

function testdir(name, cleanup) {
  const dir = `${tmpdir()}/gpk-test-${name}-${randomBytes(4).toString('hex')}`;

  if (cleanup)
    cleanup.push(dir);

  return dir;
}

async function clean(paths) {
  for (const p of paths)
    await rimraf(p);

  paths.length = 0;
}

function testfile(name) {
  return `${tmpdir()}/gpk-test-${randomBytes(4).toString('hex')}-${name}`;
}

async function unpack(tar, dst) {
  const cmd = `tar xf ${tar} -C ${dst}`;
  await exec(cmd);
}

async function rimraf(p) {
  if (p.indexOf(tmpdir()) !== 0)
    throw new Error(`Path not allowed: '${p}'.`);

  const stats = await lstat(p);

  if (stats && stats.isDirectory()) {
    const files = await readdir(p);

    for (let i = 0; i < files.length; i++)
      await rimraf(path.join(p, files[i]));

    return await rmdir(p);
  }

  return await unlink(p);
}

function envar(x) {
  if (!x)
    return false;

  return JSON.parse(x);
}

module.exports = {
  datadir,
  testdir,
  clean,
  testfile,
  unpack,
  envar,
  rimraf
};
