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
const child_process = require('child_process');
const exec = util.promisify(child_process.exec);
const {execFile} = child_process;
const crypto = require('crypto');

async function listTags(git) {
  const cmd = `git ls-remote --tags ${git}`;
  const {stdout, stderr} = await exec(cmd);

  // Split and trim the last line.
  const items = stdout.trim().split('\n');

  const tags = {};

  for (const item of items) {
    const match = item.match(/^([a-f0-9]+)\trefs\/tags\/(.*)$/);

    const hash = match[1];
    let tag = match[2];
    let annotated = false;

    if (tag.includes('^{}')) {
      tag = tag.replace('^{}', '');
      annotated = true;
    }

    if (!tags[tag])
      tags[tag] = {};

    if (annotated)
      tags[tag].annotated = hash;
    else
      tags[tag].commit = hash;
  };

  return tags;
}

async function cloneRepo(tag, git, dst) {
  console.log(`Cloning: ${git} ${tag}`);
  let result = null;

  // Clone the remote repository with matching tag.
  const cmd = `git clone --depth 1 --branch ${tag} ${git} ${dst}`;
  result = await exec(cmd);

  return true;
}

async function verifyRepo(tag, commit, dst) {
  // Verify the signature.
  let result = null;

  if (tag)
    result = await exec(`git verify-tag ${tag}`, {cwd: dst});
  else
    result = await exec(`git verify-commit ${commit}`, {cwd: dst});

  return true;
}

async function archive(git, dst) {
  const cmd = `git archive -o ${dst} HEAD`;
  const {stdout, stderr} = await exec(cmd, {cwd: git});
}

async function listTree(dst) {
  return new Promise((resolve, reject) => {
    execFile(
      'git', ['ls-tree', '--full-tree', '-r', '--name-only', 'HEAD'],
      {cwd: dst},
      (err, stdout) => {
        if (err)
          reject(err);
        resolve(stdout.trim().split('\n').sort());
      });
  });
}

async function checksum(file, algo) {
  const stream = fs.createReadStream(file);
  const hash = crypto.createHash(algo);

  return new Promise((resolve, reject) => {
    stream.once('error', err => reject(err));
    stream.once('end', () => {
      hash.end();
      resolve(hash.digest());
    });
    stream.pipe(hash);
  });
}

/**
 * Verify tree hashes by running:
 * ```
 * git ls-tree --full-tree -r --name-only HEAD | LANG=C sort \
 *   | xargs -n 1 sha512sum | sha512sum
 * ```
 *
 * Inspired by Bitcoin Core commit:
 * fa89670d34ac7839e7e2fe6f59fdfd6cc76c4483
 */

async function treeHash(dst, algo) {
  const files = await listTree(dst);
  const ctx = crypto.createHash(algo);

  while (files.length > 0) {
    const f = files.shift();
    const digest = await checksum(f, algo);
    ctx.update(Buffer.from(digest.toString('hex'), 'utf8'));
    ctx.update(Buffer.from(`  ${f}\n`, 'utf8'));
  }

  return ctx.digest();
}

async function cloneFiles(git, dst) {
  const cmd = `git clone --depth=1 ${git} ${dst}`;
  const {stdout, stderr} = await exec(cmd);
}


module.exports = {
  listTags,
  cloneRepo,
  verifyRepo,
  archive,
  listTree,
  treeHash,
  checksum,
  cloneFiles
}
