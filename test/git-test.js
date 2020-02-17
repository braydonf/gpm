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

/* eslint-env mocha */

'use strict';

const assert = require('assert');
const util = require('util');
const path = require('path');
const fs = require('fs');
const mkdir = util.promisify(fs.mkdir);

const {
  listTags,
  matchTag,
  cloneRepo,
  verifyRepo,
  treeHash,
  cloneFiles
} = require('../lib/git');

const {datadir, testdir, clean, unpack} = require('./common');

describe('Git', () => {
  const repo = path.join(datadir, 'repo.tar.gz');
  const tcleanup = [];
  const tdir = testdir('repo', tcleanup);
  const cleanup = [];

  before(async () => {
    await mkdir(tdir);
    await unpack(repo, tdir);
  });

  after(async () => {
    await clean(tcleanup);
  });

  afterEach(async () => {
    await clean(cleanup);
  });

  describe('listTags()', () => {
    it('should find all tags', async () => {
      const git = path.join(tdir, 'repo', '.git');

      const tags = await listTags(git);
      assert.deepEqual(tags, {
        'v1.0.0': {
          annotated: 'dff7f77c1a6f17cefec11342a6e410ab83c8488a',
          commit: '35c9aaaffc27f295981e996a24a0cb9cd7a84ecb',
          name: 'v1.0.0'
        },
        'v1.1.0': {
          annotated: '94071e59398891cb2cfd183045237c2494923459',
          commit: '36ea09f31e77f24a796722adfa51eb62dac043fa',
          name: 'v1.1.0'
        },
        'v2.0.0': {
          annotated: '0ab87dcfe1dc8c327b1d8b8e9fa78bb1839ea86f',
          commit: '294acab444f9742a7c1d0de273b7a412e7809e52',
          name: 'v2.0.0'
        },
        'v2.1.0': {
          commit: '3d2115aa2e86d8c08ce1639d177757aa1ce85799',
          name: 'v2.1.0'
        }
      });
    });
  });

  describe('matchTag()', () => {
    it('should find matching semver tags', async () => {
      const tags = ['v1.0.0', 'v1.1.0', 'v2.0.0'];

      let tag = null;

      tag = matchTag(tags, '^1.0.0');
      assert.equal(tag, 'v1.1.0');

      tag = matchTag(tags, '^1.1.0');
      assert.equal(tag, 'v1.1.0');

      tag = matchTag(tags, '^2.0.0');
      assert.equal(tag, 'v2.0.0');
    });
  });

  describe('cloneRepo()/verifyRepo()', () => {
    it('should clone and verify signature', async () => {
      let err = null;
      const git = path.join(tdir, 'repo', '.git');
      const tag = 'v1.1.0';
      const dst = testdir('clone', cleanup);

      try {
        await cloneRepo(tag, git, dst);
      } catch (e) {
        err = e;
      }

      assert(!err);

      try {
        await verifyRepo(tag, null, dst);
      } catch (e) {
        err = e;
      }

      assert(!err);
    });

    it('should clone and verify lightweight tag', async () => {
      let err = null;
      const git = path.join(tdir, 'repo', '.git');

      // The tag was created lightweight via `git tag v2.1.0` instead of
      // `git tag -a v2.1.0 -m "v2.1.0"`. Thus the command `git verify-tag`
      // can not be used.
      const tag = 'v2.1.0';
      const commit = '3d2115aa2e86d8c08ce1639d177757aa1ce85799';
      const dst = testdir('clonelight', cleanup);

      try {
        await cloneRepo(tag, git, dst);
      } catch (e) {
        err = e;
      }

      assert(!err);

      try {
        await verifyRepo(null, commit, dst);
      } catch (e) {
        err = e;
      }

      assert(!err);
    });
  });

  describe('treeHash()', () => {
    it('should compute a sha512 tree of git tree', async () => {
      const git = path.join(tdir, 'repo', '.git');
      const base = path.join(tdir, 'repo');

      let err = null;
      let digest = null;

      try {
        digest = await treeHash(git, base, 'sha512');
      } catch (e) {
        err = e;
      }

      assert(!err);
      assert(digest);

      const expected = 'HAFoBqk0L6u9GPuBJL5tkynyBLiKO8QYCGNpkk0Nfysq' +
            'Wlk7MkMmd8GBHWQJVBOVGhdTEsBK7HnCrfdTI5Pmbg==';

      assert(digest);
      assert.equal(digest.toString('base64'), expected);
    });
  });

  describe('cloneFiles()', () => {
    it('should clone files to destination', async () => {
      let err = null;
      const git = path.join(tdir, 'repo', '.git');
      const dst = testdir('clonefiles', cleanup);

      try {
        await cloneFiles(git, dst);
      } catch (e) {
        err = e;
      }

      assert(!err);
    });
  });
});
