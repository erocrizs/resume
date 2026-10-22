import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { rehypeResume } from './transform.ts';

const root = (path: string): string => fileURLToPath(new URL(`../${path}`, import.meta.url));

export const paths = {
  source: root('resume.md'),
  template: root('src/template.html'),
  styles: root('src/styles.css'),
  dist: root('dist'),
  html: root('dist/index.html'),
};

interface BuildOptions {
  /** Extra markup appended to <body>, e.g. the dev server's live-reload script. */
  inject?: string;
}

interface Profile {
  name: string;
  headline: string;
  jobTitle: string;
  summary: string;
  email?: string;
  locality?: string;
  links: string[];
  school?: string;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stripMarkdown = (text: string): string =>
  text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '').trim();

/** Trims text to a search-snippet length, preferring a sentence boundary, else a word boundary. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const sentence = clipped.match(/^.*[.!?](?=\s)/s)?.[0];
  if (sentence && sentence.length >= max / 2) return sentence;
  return `${clipped.slice(0, clipped.lastIndexOf(' ')).replace(/[,;:\s]+$/, '')}…`;
}

/** Pulls the facts used for <meta> tags and JSON-LD out of resume.md's header and summary. */
function readProfile(markdown: string): Profile {
  const lines = markdown.split(/\r?\n/);
  const name = stripMarkdown(lines.find((line) => line.startsWith('# '))?.slice(2) ?? '');
  const headline = stripMarkdown(lines.find((line) => /^\*\*.+\*\*$/.test(line.trim())) ?? '');
  const contact = lines.find((line) => line.includes('@') && line.includes(' · ')) ?? '';
  const summaryStart = lines.findIndex((line) => /^## Summary/i.test(line));
  const summary = stripMarkdown(lines.slice(summaryStart + 1).find((line) => line.trim() !== '') ?? '');
  const school = /— (.+?), \d{4}/.exec(
    lines.slice(lines.findIndex((line) => /^## Education/i.test(line)) + 1).find((l) => l.trim()) ?? '',
  )?.[1];

  return {
    name,
    headline,
    jobTitle: headline.split(' · ')[0],
    summary,
    email: /[\w.+-]+@[\w-]+\.[\w.]+/.exec(contact)?.[0],
    locality: stripMarkdown(contact.split(' · ')[0]),
    links: [...contact.matchAll(/\]\((https?:[^)]+)\)/g)].map((match) => match[1]),
    school,
  };
}

async function siteUrl(): Promise<string> {
  const pkg = JSON.parse(await readFile(root('package.json'), 'utf8')) as { homepage?: string };
  return (pkg.homepage ?? '').replace(/\/?$/, '/');
}

export async function build({ inject = '' }: BuildOptions = {}): Promise<void> {
  const [markdown, template, styles, url] = await Promise.all([
    readFile(paths.source, 'utf8'),
    readFile(paths.template, 'utf8'),
    readFile(paths.styles, 'utf8'),
    siteUrl(),
  ]);

  const content = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeResume)
      .use(rehypeStringify)
      .process(markdown),
  );

  const profile = readProfile(markdown);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    jobTitle: profile.jobTitle,
    description: profile.summary,
    url,
    ...(profile.email && { email: `mailto:${profile.email}` }),
    ...(profile.locality && { address: { '@type': 'PostalAddress', addressLocality: profile.locality } }),
    ...(profile.school && { alumniOf: { '@type': 'CollegeOrUniversity', name: profile.school } }),
    sameAs: profile.links,
  };

  const values: Record<string, string> = {
    title: escapeHtml(`${profile.name} — ${profile.jobTitle}`),
    name: escapeHtml(profile.name),
    description: escapeHtml(truncate(profile.summary, 160)),
    url: escapeHtml(url),
    year: String(new Date().getFullYear()),
    styles,
    jsonLd: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
    content,
    inject,
  };
  const html = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);

  await mkdir(paths.dist, { recursive: true });
  await writeFile(paths.html, html);
  await writeFile(root('dist/.nojekyll'), '');
}

if (import.meta.main) {
  await build();
  console.log(`Built ${paths.html}`);
}
