[English](THIRD_PARTY_NOTICES.md) | [Français](THIRD_PARTY_NOTICES.fr.md)

# Third-party notices

This repository builds and modifies the upstream project [`Haehnchen/vavoo-iptv-stream-proxy`](https://github.com/Haehnchen/vavoo-iptv-stream-proxy).

## Upstream project

- Project: `vavoo-iptv-stream-proxy`
- Author: Daniel Espendiller
- Copyright: © 2022 Daniel Espendiller
- License: MIT

The upstream source code is downloaded during the Docker build. Its original `LICENSE` file is retained inside the resulting image under `/app/LICENSE`.

The patch scripts in this repository contain limited source fragments used to locate, verify and modify the upstream implementation. Those fragments remain covered by the upstream MIT license and copyright notice.

## Upstream MIT license

```text
MIT License

Copyright (c) 2022 Daniel Espendiller

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

## Runtime dependencies

The upstream project installs its Node.js dependencies from the upstream lockfile. Their individual licenses remain available in their packages and package metadata. This notice does not replace those licenses.
