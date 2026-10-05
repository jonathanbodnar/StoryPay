import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The owner's naming rules (Oct 5 2026), for everything people read:
//  - only StoryPay™ and (The) Bride Booking System™ carry a ™; every other
//    name lost its ("remove them saas wide everywhere");
//  - "Lead Finder" is two words;
//  - "Setup Guide" has both capitals.
const SRC = join(__dirname, '..', '..', 'src');
const TM = '(?:™|&trade;|\\\\u2122|&#8482;|&#x2122;)';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(tsx?|md|mdx|json)$/.test(name)) out.push(path);
  }
  return out;
}
const files = sourceFiles(SRC).map((path) => ({ file: path.slice(SRC.length + 1), text: readFileSync(path, 'utf8') }));
const offenders = (re: RegExp) => files.filter((f) => re.test(f.text)).map((f) => f.file);

describe('names, as the owner wants them written', () => {
  it('no ™ after Lead Finder, Lead Link, the Speed to Lead System or StoryVenue', () => {
    expect(offenders(new RegExp(`(Lead ?Finder|Lead Link|Speed to Lead System|StoryVenue)${TM}`))).toEqual([]);
    expect(offenders(/StoryVenue<sup[^>]*>\s*(TM|™)/)).toEqual([]);
  });

  it('StoryPay and the Bride Booking System keep theirs', () => {
    expect(offenders(new RegExp(`StoryPay${TM}`)).length).toBeGreaterThan(5);
    expect(offenders(new RegExp(`Bride Booking System${TM}`)).length).toBeGreaterThan(5);
  });

  it('“Lead Finder” is two words wherever a person reads it', () => {
    // On its own as a word (code names like LeadFinderCard, addresses and the
    // X-StoryVenue-LeadFinder mail header are not text), and outside comments.
    const word = /(?<![A-Za-z0-9_$<.\/\-@])LeadFinder(?![A-Za-z0-9_(])/;
    const inText = files.filter((f) => f.text.split('\n').some((line) => word.test(line) && !/^\s*(\/\/|\*|\/\*|--|\{\/\*)/.test(line) && !/\/\/[^'"`]*LeadFinder|\/\*\*?[^'"`]*LeadFinder/.test(line)));
    expect(inText.map((f) => f.file)).toEqual([]);
  });

  it('“Setup Guide” has both capitals', () => {
    expect(offenders(/Setup guide/)).toEqual([]);
  });
});
