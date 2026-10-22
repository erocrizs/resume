# resume

Project for rendering Aemielvin Loremia's resume as a webpage.

[`resume.md`](resume.md) is the single source of truth. A small TypeScript build turns it into a styled static page, deployed to GitHub Pages at <https://cv.aems.xyz/>.

## Usage

Requires Node.js 24+ (TypeScript runs natively, no compile step).

```bash
npm install
npm run dev        # http://localhost:4321, rebuilds and reloads on change
npm run build      # writes dist/index.html
npm run typecheck
```

**PDF:** open the page in a Chromium-based browser and use **Print / Save as PDF**. The print stylesheet lays it out for US Letter with backgrounds enabled.

## How it works

- `src/build.ts` parses `resume.md` with remark/rehype, fills `src/template.html`, and inlines `src/styles.css`. Meta tags and JSON-LD come from the resume's header and summary.
- `src/transform.ts` adds semantic structure based on the conventions already in `resume.md`:
  - `### Org — Title` becomes a role, and the line after it is its dates/meta.
  - `**Client** — note · dates` starts a client engagement.
  - `- Stack: a, b, c.` becomes tags.
- Pushing to `main` runs `.github/workflows/pages.yml`, which builds the site and commits `dist/` to the `gh-pages` branch. Built files never land on `main`.
