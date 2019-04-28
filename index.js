#!/usr/bin/env node
const path = require('path');
const {promisify} = require('util');
const fs = require('fs');
const {EOL} = require('os');

const ora = require('ora');
const error = require('serialize-error');
const glob = promisify(require('glob'));
const chrono = require('chrono-node');
const truncate = require('cli-truncate');
const slugify = require('slugify');

const pad = (num, size) => ('0000' + num).substr(-size);
const size = num => `${num}`.length;

const ibid = /- ibid[\.?]/g;

(async function run() {
  const status = ora();

  try {
    status.start('Converting files');

    const cwd = process.cwd();
    const [input, output] = process.argv.slice(2).map(p => path.resolve(cwd, p));

    const files = await glob('*.txt', {cwd: input});

    files.map(file => {
      status.text = file;

      let body = fs.readFileSync(`${input}/${file}`, 'utf8');

      // Get the link index.
      const links = {};
      body = body.replace(/\[(\d+)\] (http\S+)/g, (match, i, http) => {
          links[i] = http;
          return '';
      });

      // Split input document into dates.
      body.split('________________').map(day => {
        // Index file?
        if (!day.trim().length) return;

        // Resolve ibid references.
        if (ibid.test(day)) {
          day = day.replace(ibid, (_match, offset) => {
            const sub = day.substr(0, offset);
            const refs = sub.match(new RegExp(`${EOL}(- [^${EOL}]*)`, 'g'));
            if (!refs) throw `Can't find ref in ${sub}`;
            return refs.reverse().find(r => !r.match(/ibid/)).trim() + EOL;
          });
        }

        // Use `chrono` on each first line of an entry (after trimming whitespace) and bail if `null` returned.
        let [first, ...rest] = day.trim().split(EOL);

        // Do we have a year?
        if (!first.match(/201/)) {
            throw `No year found in ${first}, ${file}`;
        }

        let date = chrono.parseDate(first);
        if (!date) throw `Date not found in "${day}"`;

        date = date.toISOString().substring(0, 10);

        // If you find at least `---` then generate a new entry for the date.
        rest.join(EOL).replace(/[-]{3,}/mg, '---').split('---').map((entry, i, arr) => {
          // Cleanup entry.
          entry = entry.replace(/[\r\n]{3,}/mg, [EOL, EOL].join(''));

          // Generate entry prefix?
          const prefix = arr.length > 1 ? pad(i + 1, size(arr.length)) + '-' : '';

          // Generate title.
          const title = truncate(entry.trim().split(EOL, 1)[0], 40).replace('…', '');
          const name = `${date}-${prefix}${slugify(title.replace(/[^\w\s]/gi, ''), {
            replacement: '_',
            lower: true,
          })}`;

          // Include link index.
          const l = entry.match(/\[(\d+)\]/g);
          if (l) {
            entry += EOL;
            l.forEach(i => {
              i = i.replace(/\D+/g, '');
              if (!links[i]) throw `Unknown index ${i}`;
              entry += `${EOL}[${i}] ${links[i]}`;
            });
          }

          const text = [first.trim(), entry.trim()].join([EOL, EOL].join(''));
          fs.writeFileSync(`${output}/${name}.txt`, text, 'utf8');
        });
      });
    });

    status.succeed('Done');
    process.exit(0);
  } catch (err) {
    status.fail(error(err));
    process.exit(1);
  }
})();
