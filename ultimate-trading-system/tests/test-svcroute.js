// THE ROUTE THAT REACHES THE REPORTING PROGRAM, and the backup that could not
// bring it back.
//
// On 2026-08-31 the Compute tab's machine reading and its service cards went
// blank. Both are served by uts-service-control on 127.0.0.1:8095 and reached
// at /uts/svc/, and that nginx location had stopped existing. It had never
// been in the website branch: service-control/install.sh wrote it into
// /etc/nginx/sites-enabled/www.buitendyk.ca.conf, which is a SYMLINK to the
// sites-available file a website deploy installs. So it lived in a file
// another deploy owns, and at 05:45:00 that day a website deploy overwrote it.
//
// Two faults, one test file. The block must ship in the branch that installs
// the config, and the installer's backup must be a copy rather than a second
// pointer at the file it is meant to protect.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INSTALL = fs.readFileSync(path.join(ROOT, 'service-control', 'install.sh'), 'utf8');

module.exports = {
  // `cp -a` on a symlink copies the LINK. The backup taken on 2026-08-24 was a
  // second pointer at the live file, so when that file was overwritten the
  // "backup" showed the overwritten contents too and there was nothing to
  // restore from.
  theInstallersBackupIsACopyAndNotASecondPointerAtTheSameFile() {
    assert.ok(/cp -aL /.test(INSTALL),
      'the backup must follow the symlink (cp -aL) — cp -a on a link copies the link, not the file');
    assert.ok(!/cp -a "\$\{NGINX_CONF\}"/.test(INSTALL),
      'the old cp -a of the symlink is still there, so the backup is still not a backup');
    assert.ok(/readlink -f "\$\{NGINX_CONF\}"/.test(INSTALL),
      'the backup must be named for the resolved file, or it lands beside a symlink pretending to be the original');
    assert.ok(/-L "\$\{BACKUP\}"/.test(INSTALL) && /refusing to edit/.test(INSTALL),
      'if the backup still comes out a symlink the installer must refuse rather than edit unprotected');
  },

  // It edits a file the website deploy owns, so writing there can only ever be
  // temporary. The durable copy is in the website branch and the installer
  // must say so, because the next person to read this will wonder why the
  // block appears in two places.
  theInstallerSaysItsRouteIsOnlyAFallback() {
    assert.ok(INSTALL.includes('/etc/nginx/sites-enabled/www.buitendyk.ca.conf'),
      'the installer must still name the file it edits');
    assert.ok(/website branch/.test(INSTALL),
      'the installer must name where the block really lives, or the duplication reads as an accident');
    assert.ok(/grep -q 'location \/uts\/svc\/'/.test(INSTALL),
      'it must check before writing, so a config that already ships the block is left alone');
  },

  // The one thing that actually keeps the Compute tab working. This reads the
  // config THIS repository can see; the shipped copy lives in the website
  // branch, so when that is not checked out here the test says what it could
  // not check rather than passing quietly.
  // The one thing that actually keeps the Compute tab working. The shipped
  // config lives in the WEBSITE branch, not this one, so this reads it out of
  // git rather than off the working tree -- and when git cannot answer it says
  // what it could not check instead of passing quietly, because a hollow pass
  // on this exact question is how the route went missing for a day.
  theRouteIsInTheConfigTheWebsiteDeployShips() {
    const { execFileSync } = require('child_process');
    let conf = null;
    for (const ref of ['origin/website', 'website']) {
      try {
        conf = execFileSync('git', ['show', `${ref}:www.buitendyk.ca/nginx/www.buitendyk.ca.conf`],
          { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        break;
      } catch (_) { conf = null; }
    }
    if (conf == null) {
      // eslint-disable-next-line no-console
      console.log('    NOT CHECKED: the website branch is not reachable from here, so whether '
        + '/uts/svc/ is routed could not be read. It is the only thing that keeps the Compute tab\'s '
        + 'machine reading and service cards alive.');
      return;
    }
    assert.ok(conf.includes('location /uts/svc/'),
      'the website branch ships the site config and does not route /uts/svc/ — the Compute tab\'s machine '
      + 'reading and service cards cannot reach the reporting program on 8095, and the next website deploy '
      + 'would take the route away again');
    assert.ok(/proxy_pass http:\/\/127\.0\.0\.1:8095\//.test(conf),
      'the route must reach the reporting program on 8095, not the trading service on 8094');
    const svcAt = conf.indexOf('location /uts/svc/');
    assert.ok(/auth_basic/.test(conf.slice(svcAt, svcAt + 900)),
      'the route must sit behind the same site password as every other location, not open a way around it');
  },
};
