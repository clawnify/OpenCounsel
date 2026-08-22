# Third-party notices

OpenCounsel bundles review column definitions from a third-party project.
They are redistributed under their own licence, reproduced in full below.

## Open Legal Products — mike-workflows

- Repository: https://github.com/Open-Legal-Products/mike-workflows
- Revision:   f5f9acedc9d851351cf6635f02bc3f9a7cc5d010
- Used at:    `tabular-review-workflows/*/table-columns.yaml` and `SKILL.md` frontmatter
- Bundled as: `src/server/packs.gen.json` (regenerate with `node scripts/refresh-packs.mjs`)

**Modifications.** Column definitions were converted from `table-columns.yaml` into
this app's column schema: `format` mapped to `type`, `name` to `question`, `prompt` to
`hint`, and stable keys derived from column names. The upstream `SKILL.md` instruction
bodies are **not** included — they direct the model to self-police its own citations and
to export `.xlsx`, whereas this app verifies every citation server-side and renders
results in its own grid.

### Licence

```
MIT License

Copyright (c) 2026 Mike

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
