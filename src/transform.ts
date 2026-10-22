// Rehype plugin that turns the flat HTML produced from resume.md into
// semantic, styleable markup. The Markdown itself stays plain: structure is
// inferred from the conventions resume.md already follows.
//
//   # Name                      -> <header class="masthead">
//   **Headline**                -> <p class="headline">
//   a · b · [link](...)         -> <ul class="contact">
//   ## Section                  -> <section class="section section--{slug}">
//   ### Org — Title             -> <article class="role">
//   date · place · note         -> role details, dates right-aligned
//   **Client** — note · dates   -> <div class="engagement"> with <h4>, same layout
//   - Stack: a, b, c.           -> <li class="stack"> with tag list

import type { Element, ElementContent, Root, RootContent, Text } from 'hast';
import { h } from 'hastscript';
import { toString } from 'hast-util-to-string';

const SEP = ' · ';
const DATE_RE = /^(?:[A-Z][a-z]{2} )?\d{4}(?: – (?:(?:[A-Z][a-z]{2} )?\d{4}|Present))?$/;

const isElement = (node: RootContent | ElementContent | undefined, tag?: string): node is Element =>
  node?.type === 'element' && (tag === undefined || node.tagName === tag);

export const slugify = (text: string): string =>
  text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Splits inline content on " · " into groups, keeping links and emphasis intact. */
function splitOnSeparator(children: ElementContent[]): ElementContent[][] {
  const groups: ElementContent[][] = [[]];
  for (const child of children) {
    if (child.type !== 'text') {
      groups.at(-1)!.push(child);
      continue;
    }
    child.value.split(SEP).forEach((part, i) => {
      if (i > 0) groups.push([]);
      if (part) groups.at(-1)!.push({ type: 'text', value: part });
    });
  }
  return groups
    .map((group) => trimGroup(group))
    .filter((group) => group.length > 0);
}

function trimGroup(group: ElementContent[]): ElementContent[] {
  const out = group.map((node) => (node.type === 'text' ? { ...node } : node));
  const first = out[0];
  const last = out.at(-1);
  if (first?.type === 'text') first.value = first.value.trimStart();
  if (last?.type === 'text') last.value = last.value.trimEnd();
  return out.filter((node) => node.type !== 'text' || node.value !== '');
}

/**
 * Builds a two-column header: the heading plus any non-date details on the
 * left, the date range on the right.
 */
function headerWithDates(className: string, heading: Element, meta: ElementContent[]): Element {
  const groups = splitOnSeparator(meta);
  const dates = groups.find((group) => DATE_RE.test(toString(h('span', group)).trim()));
  const details = groups.filter((group) => group !== dates);
  return h('header', { className: [className] }, [
    h('div', { className: ['header__main'] }, [
      heading,
      ...(details.length ? [h('p', { className: ['meta'] }, details.map((group) => h('span', group)))] : []),
    ]),
    ...(dates ? [h('p', { className: ['dates'] }, dates)] : []),
  ]);
}

function contactList(paragraph: Element): Element {
  const items = splitOnSeparator(paragraph.children).map((group) => {
    const text = toString(h('span', group)).trim();
    if (group.length === 1 && group[0].type === 'text' && /^\S+@\S+\.\S+$/.test(text)) {
      return h('li', [h('a', { href: `mailto:${text}` }, text)]);
    }
    for (const node of group) {
      if (isElement(node, 'a') && String(node.properties.href).startsWith('http')) {
        node.properties = { ...node.properties, rel: ['me'] };
      }
    }
    return h('li', group);
  });
  return h('ul', { className: ['contact'] }, items);
}

function splitRoleHeading(heading: Element): Element {
  const [org, ...rest] = toString(heading).split(' — ');
  const title = rest.join(' — ');
  return h('h3', { className: ['role__heading'] }, [
    h('span', { className: ['role__org'] }, org),
    ...(title ? [h('span', { className: ['role__title'] }, title)] : []),
  ]);
}

/** "**Client** — note · dates" paragraphs introduce a client engagement. */
function isEngagementLead(node: Element): boolean {
  if (!isElement(node, 'p')) return false;
  const [first, second] = node.children;
  return isElement(first, 'strong') && second?.type === 'text' && second.value.startsWith(' — ');
}

function engagementHeader(paragraph: Element): Element {
  const [name, rest] = paragraph.children as [Element, Text, ...ElementContent[]];
  const remainder: ElementContent[] = [
    { type: 'text', value: rest.value.replace(/^ — /, '') },
    ...paragraph.children.slice(2),
  ];
  return headerWithDates('engagement__header', h('h4', { className: ['engagement__name'] }, name.children), remainder);
}

function decorateLists(node: Element): void {
  for (const li of node.children) {
    if (!isElement(li, 'li')) continue;
    const text = toString(li).trim();
    const match = /^Stack:\s*(.+?)\.?$/.exec(text);
    if (!match) continue;
    li.properties = { ...li.properties, className: ['stack'] };
    li.children = [
      h('span', { className: ['stack__label'] }, 'Stack'),
      h('ul', { className: ['tags'], 'aria-label': 'Tech stack' },
        match[1].split(/,\s*/).map((tag) => h('li', tag))),
    ];
  }
}

function buildRole(nodes: Element[]): Element {
  const [heading, ...rest] = nodes;
  const meta = isElement(rest[0], 'p') && !isEngagementLead(rest[0]) ? rest.shift()!.children : [];
  const header = headerWithDates('role__header', splitRoleHeading(heading), meta);

  const body: Element[] = [];
  let engagement: Element | undefined;
  for (const node of rest) {
    if (isElement(node, 'ul')) decorateLists(node);
    if (isEngagementLead(node)) {
      engagement = h('div', { className: ['engagement'] }, [engagementHeader(node)]);
      body.push(engagement);
    } else if (engagement) {
      engagement.children.push(node);
    } else {
      body.push(node);
    }
  }
  return h('article', { className: ['role'] }, [header, ...body]);
}

function buildSection(heading: Element, nodes: Element[]): Element {
  const slug = slugify(toString(heading));
  heading.properties = { ...heading.properties, id: slug };

  // Content before the first ### stays as-is; each ### opens a role.
  const lead: Element[] = [];
  const roles: Element[][] = [];
  for (const node of nodes) {
    if (isElement(node, 'h3')) roles.push([node]);
    else if (roles.length) roles.at(-1)!.push(node);
    else {
      if (isElement(node, 'ul')) decorateLists(node);
      lead.push(node);
    }
  }

  return h('section', { className: ['section', `section--${slug}`], 'aria-labelledby': slug }, [
    heading,
    ...lead,
    ...roles.map(buildRole),
  ]);
}

export function rehypeResume() {
  return (tree: Root): void => {
    const nodes = tree.children.filter((node): node is Element => isElement(node));
    const firstSection = nodes.findIndex((node) => isElement(node, 'h2'));
    const intro = nodes.slice(0, firstSection === -1 ? nodes.length : firstSection);

    const [name, headline, contact, ...extra] = intro;
    const masthead = h('header', { className: ['masthead'] }, [
      name,
      ...(headline ? [h('p', { className: ['headline'] }, toString(headline))] : []),
      ...(contact ? [contactList(contact)] : []),
      ...extra,
    ]);

    const sections: Element[] = [];
    let current: { heading: Element; nodes: Element[] } | undefined;
    for (const node of nodes.slice(intro.length)) {
      if (isElement(node, 'h2')) {
        if (current) sections.push(buildSection(current.heading, current.nodes));
        current = { heading: node, nodes: [] };
      } else {
        current?.nodes.push(node);
      }
    }
    if (current) sections.push(buildSection(current.heading, current.nodes));

    tree.children = [masthead, h('main', sections)];
  };
}
