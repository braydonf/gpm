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
const cp = require('child_process');
const exec = util.promisify(cp.exec);
const {execFile, spawn} = cp;
const crypto = require('crypto');
const semver = require('../vendor/semver');

async function listTags(git) {
  const cmd = `git ls-remote --tags ${git}`;
  const {stdout} = await exec(cmd);

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

    tags[tag].name = tag;
  };

  return tags;
}

async function listBranches(git) {
  const cmd = `git ls-remote --heads ${git}`;
  const {stdout} = await exec(cmd);

  const items = stdout.trim().split('\n');

  const branches = {};

  for (const item of items) {
    const match = item.match(/^([a-f0-9]+)\trefs\/heads\/(.*)$/);

    const hash = match[1];
    const branch = match[2];

    branches[branch] = hash;
  }

  return branches;
}

function sortTags(tags, desc) {
  // Filter out all tags that are not version tags.
  const filtered = tags.filter(tag => tag.indexOf('v') === 0);

  // Determine comparison function.
  const cmp = desc ? semver.gt : semver.lt;

  // Sort lexicographically with the largest value at the beginning.
  const sorted = filtered.sort((a, b) => {
    if (a === b)
      return 0;
    else
      return cmp(a, b) ? 1 : -1;
  });

  return sorted;
}

function matchTag(tags, needed) {
  let matched = null;

  const sorted = sortTags(tags);

  for (const tag of sorted) {
    // Remove the leading 'v' version in the tag.
    const version = tag.replace('v', '');
    if (semver.satisfies(version, needed)) {
      matched = tag;
      break;
    }
  }

  return matched;
}

async function cloneRepo(tag, git, dst) {
  const cmd = `git clone --depth 1 --branch ${tag} ${git} ${dst}`;
  return await exec(cmd);
}

async function getHeadCommit(git) {
  const cmd = 'git rev-parse HEAD';

  const {stdout} = await exec(cmd, {cwd: git});

  return stdout.trim();
}

async function verifyRepo(tag, commit, dst, stdio) {
  let args = ['verify-tag', tag];
  if (!tag)
    args = ['verify-commit', commit];

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {cwd: dst, stdio: stdio});
    child.once('error', err => reject(err));
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Could not verify signature.'));
      }
    });
  });
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

async function treeHash(dst, base, algo) {
  const files = await listTree(dst);
  const ctx = crypto.createHash(algo);

  while (files.length > 0) {
    const filename = files.shift();
    const filepath = path.join(base, filename);
    const digest = await checksum(filepath, algo);
    ctx.update(Buffer.from(digest.toString('hex'), 'utf8'));
    ctx.update(Buffer.from(`  ${filename}\n`, 'utf8'));
  }

  return ctx.digest();
}

async function cloneFiles(git, dst) {
  const cmd = `git clone --depth=1 ${git} ${dst}`;
  await exec(cmd);
}

module.exports = {
  sortTags,
  listTags,
  listBranches,
  matchTag,
  cloneRepo,
  getHeadCommit,
  verifyRepo,
  listTree,
  treeHash,
  checksum,
  cloneFiles
};
