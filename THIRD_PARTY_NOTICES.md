# Third-Party Notices

## JobNavigator

The Eightfold adapter in `lib/adapters/eightfold.mjs` is a Leagle Job-native
Node implementation informed by protocol and selector behavior in:

- repository: JobNavigator;
- revision: `387b2c9bd7f1bd627c396c6dddc8d750ce3c4bfb`;
- source paths:
  - `backend/scraper/ats/generic.py`;
  - `backend/scraper/ats/_descriptions.py`;
- modifications: integrated with Leagle Job normalization, bounded pagination,
  same-origin API derivation, central `safeFetch`, Playwright network guards,
  synthetic fixtures and Leagle Job's no-auto-apply policy.

JobNavigator is licensed under the MIT License:

```text
MIT License

Copyright (c) 2026 JobNavigator Contributors

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
