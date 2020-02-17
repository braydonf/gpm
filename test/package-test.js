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
const fs = require('fs');
const path = require('path');
const lstat = util.promisify(fs.lstat);
const mkdir = util.promisify(fs.mkdir);

const Environment = require('../lib/environment');
const Package = require('../lib/package');

const {datadir, testdir, clean, testfile, unpack, envar} = require('./common');

describe('Package', function() {
  this.timeout(60000);

  const stdoutPath = `${testfile('stdout')}`;
  const stderrPath = `${testfile('stderr')}`;
  const tcleanup = [stdoutPath, stderrPath];
  const gdir = testdir('global', tcleanup);
  const tdir = testdir('modules', tcleanup);
  const hdir = testdir('home', tcleanup);

  let stdout = fs.createWriteStream(stdoutPath);
  let stderr = fs.createWriteStream(stderrPath);
  const stdin = process.stdin;

  if (envar(process.env.TEST_LOG)) {
    stdout = process.stdout;
    stderr = process.stderr;
  }

  const tarball = path.join(datadir, 'modules.tar.gz');
  const env = new Environment([stdin, stdout, stderr], hdir, gdir);
  const cleanup = [];

  async function ensure(dirs) {
    let last = null;
    for (let dir of dirs) {
      if (last)
        dir = path.join(last, dir);

      await mkdir(dir);
      last = dir;
    }
  }

  before(async () => {
    await ensure([gdir, 'lib', 'node_modules']);
    await mkdir(tdir);
    await unpack(tarball, tdir);
  });

  after(async () => {
    await clean(tcleanup);
  });

  afterEach(async () => {
    await clean(cleanup);
  });

  describe('resolveRemote()', () => {
    const hash = '3c0cfdd8445ec81386daa187feb2d32b9f4d89a1';

    const remotes = {
      local: `git+file://${datadir}`,
      onion: 'ssh://git@fszyuaceipjhnbyy44mtfmoocwzgzunmdu46votrm5c72poeeffa' +
        '.onion:22',
      gitlab: 'https://gitlab.com',
      github: 'https://github.com'
    };

    const vectors = [
      {
        input: {
          name: 'bdb',
          src: 'github:bcoin-org/bdb#semver:~1.1.7'
        },
        output: {
          git: 'https://github.com/bcoin-org/bdb.git',
          version: '~1.1.7',
          branch: null
        }
      },
      {
        input: {
          name: 'bdb',
          src: 'github:bcoin-org/bdb#v1.1.7'
        },
        output: {
          git: 'https://github.com/bcoin-org/bdb.git',
          version: null,
          branch: 'v1.1.7'
        }
      },
      {
        input: {
          name: 'bdb',
          src: `github:bcoin-org/bdb#${hash}`
        },
        output: {
          git: 'https://github.com/bcoin-org/bdb.git',
          version: null,
          branch: `${hash}`
        }
      },
      {
        input: {
          name: 'bdb',
          src: 'gitlab:bcoin-org/bdb#semver:~1.1.7'
        },
        output: {
          git: 'https://gitlab.com/bcoin-org/bdb.git',
          version: '~1.1.7',
          branch: null
        }
      },
      {
        input: {
          name: 'bcoin',
          src: 'onion:bcoin/bcoin#semver:~1.1.7'
        },
        output: {
          git: 'ssh://git@' +
            'fszyuaceipjhnbyy44mtfmoocwzgzunmdu46votrm5c72poeeffa' +
            '.onion:22/bcoin/bcoin.git',
          version: '~1.1.7',
          branch: null
        }
      },
      {
        input: {
          name: 'repo',
          src: 'local:repo#semver:~1.1.7'
        },
        output: {
          git: `file://${datadir}/repo/.git`,
          version: '~1.1.7',
          branch: null
        }
      },
      {
        input: {
          name: 'repo',
          src: 'local:#semver:~1.1.7'
        },
        output: {
          git: `file://${datadir}/repo/.git`,
          version: '~1.1.7',
          branch: null
        }
      },
      {
        input: {
          name: 'bcoin',
          src: 'git+https://github.com/bcoin-org/bcfg.git#semver:~2.0.0'
        },
        output: {
          git: 'https://github.com/bcoin-org/bcfg.git',
          version: '~2.0.0',
          branch: null
        }
      },
      {
        input: {
          name: 'bcoin',
          src: 'git+ssh://git@github.com/bcoin-org/bcoin.git#semver:~2.0.0'
        },
        output: {
          git: 'ssh://git@github.com/bcoin-org/bcoin.git',
          version: '~2.0.0',
          branch: null
        }
      },
      {
        input: {
          name: 'bcoin',
          src: 'git+https://github.com/bcoin-org/bcfg.git#v2.0.0'
        },
        output: {
          git: 'https://github.com/bcoin-org/bcfg.git',
          version: null,
          branch: 'v2.0.0'
        }
      },
      {
        input: {
          name: 'bcoin',
          src: `git+ssh://git@github.com/bcoin-org/bcoin.git#${hash}`
        },
        output: {
          git: 'ssh://git@github.com/bcoin-org/bcoin.git',
          version: null,
          branch: `${hash}`
        }
      },
      {
        input: {
          name: 'bcoin',
          src: 'git://github.com/bcoin-org/bcoin.git'
        },
        output: {
          git: 'git://github.com/bcoin-org/bcoin.git',
          version: null,
          branch: null
        }
      },
      {
        input: {
          name: 'bcoin',
          src: 'git://github.com/bcoin-org/bcoin.git#semver:~2.0.0'
        },
        output: {
          git: 'git://github.com/bcoin-org/bcoin.git',
          version: '~2.0.0',
          branch: null
        }
      },
      {
        input: {
          name: 'repo',
          src: '~1.1.7'
        },
        output: {
          git: null,
          version: '~1.1.7',
          branch: null
        }
      }
    ];

    for (const {input, output} of vectors) {
      it(`${input.src}`, () => {
        const mod = new Package({
          dir: datadir,
          info: {
            remotes: remotes,
            dependencies: {}
          },
          env: env
        });

        mod.info.dependencies[input.name] = input.src;

        const remote = mod.resolveRemote({name: input.name, src: input.src});
        assert.deepEqual(remote, output);
      });
    }
  });

  describe('fromDirectory()', () => {
    it('should locate and read package.json', async () => {
      const moddir = path.join(tdir, 'modules', 'foo', 'lib');
      const mod = await Package.fromDirectory({
        dir: moddir,
        walk: true,
        env: env,
        parent: null
      });

      assert.equal(mod.dir, path.join(tdir, 'modules', 'foo'));
      assert.deepEqual(mod.info, {
        name: 'foo',
        version: '1.0.0',
        main: './lib/index.js',
        remotes: {
          local: 'git+file://'
        },
        dependencies: {
          bar: 'local:bar#semver:^1.0.0',
          beep: 'local:beep#semver:^1.0.0',
          bloop: 'local:bloop#semver:^1.0.0'
        }
      });
    });
  });

  describe('install()', () => {
    async function exists(dst) {
      let stats = null;
      try {
        stats = await lstat(dst);
      } catch (err) {
        if (err.code !== 'ENOENT')
          throw err;
      }
      return stats ? true : false;
    }

    it('should install dependencies', async () => {
      const modules = testdir('install', cleanup);
      await mkdir(modules);
      await unpack(path.join(datadir, 'modules.tar.gz'), modules);
      const basedir = path.join(modules, 'modules');
      const moddir = path.join(basedir, 'foo');

      const env = new Environment([stdin, stdout, stderr], hdir, gdir, basedir);

      const pkg = await Package.fromDirectory({
        dir: moddir,
        walk: false,
        env: env
      });
      await pkg.install();
    });

    it('should install unflat dependencies', async () => {
      const modules = testdir('install-unflat', cleanup);
      await mkdir(modules);
      await unpack(path.join(datadir, 'unflat.tar.gz'), modules);
      const basedir = path.join(modules, 'unflat');
      const moddir = path.join(basedir, 'a');

      const env = new Environment([stdin, stdout, stderr], hdir, gdir, basedir);

      const pkg = await Package.fromDirectory({
        dir: moddir,
        walk: false,
        env: env
      });

      await pkg.install();

      const base = path.join(modules, 'unflat', 'a', 'node_modules',
                             'c', 'node_modules');
      const f1 = path.join(base, 'd', 'node_modules', 'f');
      const f2 = path.join(base, 'e', 'node_modules', 'f');
      const f3 = path.join(base, 'f');

      assert.equal(await exists(f1), false);
      assert.equal(await exists(f2), false);
      assert.equal(await exists(f3), true);
    });

    it('should install local globally', async () => {
      const gdir = testdir('global', cleanup);
      await ensure([gdir, 'lib', 'node_modules']);
      const modules = testdir('install-global', cleanup);
      await mkdir(modules);
      await unpack(path.join(datadir, 'modules.tar.gz'), modules);
      const basedir = path.join(modules, 'modules');
      const moddir = path.join(basedir, 'foo');

      const env = new Environment([stdin, stdout, stderr], hdir, gdir, basedir);

      const pkg = await Package.fromDirectory({
        dir: moddir,
        walk: false,
        env: env
      });

      await pkg.install([], {global: true});

      const libdir = Environment.libdir(gdir);

      assert.equal(await exists(libdir), true);
    });

    it('should install globally', async () => {
      const gdir = testdir('global', cleanup);
      await ensure([gdir, 'lib', 'node_modules']);
      const modules = testdir('install-global', cleanup);
      await mkdir(modules);
      await unpack(path.join(datadir, 'modules.tar.gz'), modules);
      const basedir = path.join(modules, 'modules');
      const moddir = path.join(basedir, 'foo');

      const env = new Environment([stdin, stdout, stderr], hdir, gdir, basedir);

      const pkg = new Package({env: env});

      await pkg.install([`file://${moddir}`], {global: true});

      const libdir = Environment.libdir(gdir);

      assert.equal(await exists(libdir), true);
    });
  });
});
