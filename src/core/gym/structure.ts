/**
 * gym's structure (G1): domains, subjects, topics and variants, read from the folders and the
 * README indexes, with each topic's (or variant's) status front matter. Used by every topic
 * picker, the gym reader's tree and the revision list (G8).
 *
 * The rules are gym's README (and `scripts/check.py`):
 * - domains are the top-level folders except `log`, `templates`, `scripts`, `journal`,
 *   `library` and dot-folders; subjects are folders in a domain, topics folders in a subject;
 * - a topic's sub-folders other than `notes`, `problems`, `code` and `assets` are variants;
 *   a topic with variants records status in each variant, not in the topic;
 * - order: a parent README lists its children in study order; children it does not list
 *   follow, alphabetically;
 * - problems are `problems/NNN-<slug>.md` in a topic or variant, with front matter `source`,
 *   `difficulty`, `status` (open | solved | revisit) and `date`.
 */
import { firstHeading, normalizeNewlines, parseFrontMatter } from './frontmatter';
import { basename, dirname, joinPath, resolveLink } from './paths';

export const NON_DOMAINS: ReadonlySet<string> = new Set(['log', 'templates', 'scripts', 'journal', 'library']);
export const UNIT_PARTS: ReadonlySet<string> = new Set(['notes', 'problems', 'code', 'assets']);

export type TopicStatus = 'planned' | 'active' | 'done';
export type ProblemStatus = 'open' | 'solved' | 'revisit';

export interface GymUnit {
  kind: 'topic' | 'variant';
  /** `math/linear-algebra/eigenvalues`, or `ml/architectures/transformer/basic` for a variant */
  path: string;
  name: string;
  /** README title, or the folder name */
  title: string;
  domain: string;
  subject: string;
  /** the topic's path (the parent's for a variant) */
  topic: string;
  /** '' when the README has no (valid) status, and for topics with variants */
  status: TopicStatus | '';
  started: string;
  completed: string;
  /** variants of a topic, in index order */
  variants: GymUnit[];
  /** listed in the parent README */
  indexed: boolean;
}

export interface GymSubject {
  path: string;
  name: string;
  title: string;
  topics: GymUnit[];
  indexed: boolean;
}

export interface GymDomain {
  path: string;
  name: string;
  title: string;
  subjects: GymSubject[];
  indexed: boolean;
}

export interface GymProblem {
  /** `math/linear-algebra/eigenvalues/problems/002-trace.md` */
  path: string;
  /** topic or variant path */
  unit: string;
  /** `002` */
  number: string;
  slug: string;
  title: string;
  status: ProblemStatus | '';
  date: string;
  difficulty: string;
  source: string;
}

export interface GymStructure {
  domains: GymDomain[];
  /** every topic and variant, in tree order (a topic precedes its variants) */
  units: GymUnit[];
  problems: GymProblem[];
}

export type ReadText = (path: string) => Promise<string | null>;

const PROBLEM_FILE = /^(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const TOPIC_STATUS: ReadonlySet<string> = new Set(['planned', 'active', 'done']);
const PROBLEM_STATUS: ReadonlySet<string> = new Set(['open', 'solved', 'revisit']);

interface DirNode {
  files: Set<string>;
  dirs: Map<string, DirNode>;
}

function tree(paths: Iterable<string>): DirNode {
  const root: DirNode = { files: new Set(), dirs: new Map() };
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node.dirs.get(parts[i]);
      if (!next) node.dirs.set(parts[i], (next = { files: new Set(), dirs: new Map() }));
      node = next;
    }
    if (parts.length) node.files.add(parts[parts.length - 1]);
  }
  return root;
}

/** Link targets of a Markdown file, resolved to repository paths, in order (code excluded). */
export function linkTargets(file: string, text: string): string[] {
  const prose = text.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1.*$/gm, '').replace(/`[^`\n]*`/g, '');
  const out: string[] = [];
  for (const m of prose.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const r = resolveLink(file, m[1]);
    if (r) out.push(r.path);
  }
  return out;
}

/** Orders child names by their first link in the parent README; unlisted children follow. */
function orderByIndex(parent: string, names: string[], links: string[]): { name: string; indexed: boolean }[] {
  const rank = new Map<string, number>();
  links.forEach((l, i) => {
    for (const name of names) {
      const child = joinPath(parent, name);
      if ((l === child || l === `${child}/README.md`) && !rank.has(name)) rank.set(name, i);
    }
  });
  return names
    .map((name) => ({ name, indexed: rank.has(name) }))
    .sort((a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity) || a.name.localeCompare(b.name));
}

/**
 * Reads gym's structure from the list of repository paths and a text reader (the offline
 * mirror). Missing READMEs are tolerated: the folder name stands in for the title.
 */
export async function readStructure(paths: Iterable<string>, readText: ReadText): Promise<GymStructure> {
  const root = tree(paths);
  const readmes = new Map<string, string>();
  const read = async (dir: string, node: DirNode): Promise<string> => {
    if (!node.files.has('README.md')) return '';
    const p = joinPath(dir, 'README.md');
    let t = readmes.get(p);
    if (t === undefined) {
      t = normalizeNewlines((await readText(p)) ?? '');
      readmes.set(p, t);
    }
    return t;
  };
  const titleOf = (text: string, fallback: string) => firstHeading(parseFrontMatter(text).body) ?? fallback;

  const units: GymUnit[] = [];
  const problems: GymProblem[] = [];

  const readProblems = async (unitPath: string, node: DirNode) => {
    const dir = node.dirs.get('problems');
    if (!dir) return;
    for (const name of [...dir.files].sort()) {
      const m = PROBLEM_FILE.exec(name);
      if (!m) continue;
      const path = joinPath(unitPath, 'problems', name);
      const text = normalizeNewlines((await readText(path)) ?? '');
      const fm = parseFrontMatter(text);
      const f = fm.fields ?? {};
      problems.push({
        path,
        unit: unitPath,
        number: m[1],
        slug: m[2],
        title: firstHeading(fm.body) ?? m[2].replace(/-/g, ' '),
        status: PROBLEM_STATUS.has(f.status) ? (f.status as ProblemStatus) : '',
        date: /^\d{4}-\d{2}-\d{2}$/.test(f.date ?? '') ? f.date : '',
        difficulty: f.difficulty ?? '',
        source: f.source ?? '',
      });
    }
  };

  const makeUnit = async (kind: GymUnit['kind'], path: string, node: DirNode, indexed: boolean, ctx: { domain: string; subject: string; topic: string }): Promise<GymUnit> => {
    const text = await read(path, node);
    const f = parseFrontMatter(text).fields ?? {};
    return {
      kind,
      path,
      name: basename(path),
      title: titleOf(text, basename(path)),
      ...ctx,
      status: TOPIC_STATUS.has(f.status) ? (f.status as TopicStatus) : '',
      started: f.started ?? '',
      completed: f.completed ?? '',
      variants: [],
      indexed,
    };
  };

  const domains: GymDomain[] = [];
  const rootLinks = linkTargets('README.md', await read('', root));
  const domainNames = [...root.dirs.keys()].filter((d) => !d.startsWith('.') && !NON_DOMAINS.has(d));
  for (const { name: dName, indexed: dIndexed } of orderByIndex('', domainNames, rootLinks)) {
    const dNode = root.dirs.get(dName)!;
    const dText = await read(dName, dNode);
    const domain: GymDomain = { path: dName, name: dName, title: titleOf(dText, dName), subjects: [], indexed: dIndexed };
    domains.push(domain);
    const dLinks = linkTargets(`${dName}/README.md`, dText);
    for (const { name: sName, indexed: sIndexed } of orderByIndex(dName, [...dNode.dirs.keys()].filter((n) => !n.startsWith('.')), dLinks)) {
      const sPath = `${dName}/${sName}`;
      const sNode = dNode.dirs.get(sName)!;
      const sText = await read(sPath, sNode);
      const subject: GymSubject = { path: sPath, name: sName, title: titleOf(sText, sName), topics: [], indexed: sIndexed };
      domain.subjects.push(subject);
      const sLinks = linkTargets(`${sPath}/README.md`, sText);
      for (const { name: tName, indexed: tIndexed } of orderByIndex(sPath, [...sNode.dirs.keys()].filter((n) => !n.startsWith('.')), sLinks)) {
        const tPath = `${sPath}/${tName}`;
        const tNode = sNode.dirs.get(tName)!;
        const topic = await makeUnit('topic', tPath, tNode, tIndexed, { domain: dName, subject: sPath, topic: tPath });
        subject.topics.push(topic);
        units.push(topic);
        await readProblems(tPath, tNode);
        const variantNames = [...tNode.dirs.keys()].filter((n) => !UNIT_PARTS.has(n) && !n.startsWith('.'));
        if (!variantNames.length) continue;
        // a topic with variants records status in its variants (gym README, Variants)
        topic.status = '';
        topic.started = '';
        topic.completed = '';
        const tLinks = linkTargets(`${tPath}/README.md`, await read(tPath, tNode));
        for (const { name: vName, indexed: vIndexed } of orderByIndex(tPath, variantNames, tLinks)) {
          const vPath = `${tPath}/${vName}`;
          const vNode = tNode.dirs.get(vName)!;
          const variant = await makeUnit('variant', vPath, vNode, vIndexed, { domain: dName, subject: sPath, topic: tPath });
          topic.variants.push(variant);
          units.push(variant);
          await readProblems(vPath, vNode);
        }
      }
    }
  }
  return { domains, units, problems };
}

/** The topic or variant that contains a repository path (deepest match), if any. */
export function unitOf(structure: Pick<GymStructure, 'units'>, path: string): GymUnit | undefined {
  let best: GymUnit | undefined;
  for (const u of structure.units) {
    if ((path === u.path || path.startsWith(u.path + '/')) && (!best || u.path.length > best.path.length)) best = u;
  }
  return best;
}

/** True when `p` looks like a gym topic or variant path (lowercase, hyphenated, 3–4 levels). */
export function isTopicPathShape(p: string): boolean {
  const parts = p.split('/');
  return parts.length >= 3 && parts.length <= 4 && parts.every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)) && !NON_DOMAINS.has(parts[0]);
}

/** True when `p` looks like a problem path: `<unit>/problems/NNN-<slug>.md`. */
export function isProblemPathShape(p: string): boolean {
  const dir = dirname(p);
  return basename(dir) === 'problems' && isTopicPathShape(dirname(dir)) && PROBLEM_FILE.test(basename(p));
}
