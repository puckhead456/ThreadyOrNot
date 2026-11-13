# Vendored text reader (Tesseract), wave K proposal R4

Opt-in OCR for scanned pages. **None of these files is precached or loaded with the app.** `js/ocr.js`
fetches them (same-origin) only when the maker taps "Try reading this scanned page", copies them into
the Cache Storage bucket `thready-ocr-v1`, and from then on reads them back from that bucket as Blob URLs
(works offline, never touches the network again). Each device downloads **one** of the two core
variants (SIMD when `WebAssembly.validate` accepts a SIMD probe, else the plain one): about 4.9 MB
(5,150,817 bytes) raw per device.

Downloaded 2026-11-12 from the official npm registry tarballs (SHA-1 of each tarball checked against the
registry's `dist.shasum`) and the official tesseract-ocr `tessdata_fast` repository. Nothing was built
or modified, except that `eng.traineddata` was gzipped here (`gzip -9 -n`) because tesseract.js reads
`<lang>.traineddata.gz`; the raw file's SHA-256 is listed too.

| file | from | version | bytes | SHA-256 |
|---|---|---|---|---|
| `tesseract.min.js` | npm `tesseract.js` `dist/tesseract.min.js` | 5.1.1 | 66,695 | `a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8` |
| `tesseract.min.js.LICENSE.txt` | same package, `dist/` | 5.1.1 | 149 | `cdf963ced7d25a0f98901a547647b4d6e2dbe0197fd78c87a059a87b0e542fe2` |
| `worker.min.js` | npm `tesseract.js` `dist/worker.min.js` | 5.1.1 | 123,724 | `aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc` |
| `worker.min.js.LICENSE.txt` | same package, `dist/` | 5.1.1 | 466 | `45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac` |
| `tesseract-core-simd-lstm.js` | npm `tesseract.js-core` | 5.1.1 | 124,396 | `4135a3f6f1cccf3bc92058c1273c49bb4cff6356e1ba15d1b8b4e76e9890526b` |
| `tesseract-core-simd-lstm.wasm` | npm `tesseract.js-core` | 5.1.1 | 2,859,709 | `66b601224a0c4a8977bc9d92dd39841189f9ca22cc4122fcd7208cdb0961eeef` |
| `tesseract-core-lstm.js` | npm `tesseract.js-core` | 5.1.1 | 124,391 | `fc54a973687325599214294ec90ea9665309cbdf6ca727c43a64651f24e923f7` |
| `tesseract-core-lstm.wasm` | npm `tesseract.js-core` | 5.1.1 | 2,859,424 | `5db58ea4d1bd4256be81e8ae3b4fa226c4625dfba1850b1b3308dbf3700e9929` |
| `eng.traineddata.gz` | `tesseract-ocr/tessdata_fast` `main/eng.traineddata`, gzipped here | tessdata_fast (4.1 LSTM) | 1,976,293 | `2a66ec904bc0e7657b27e200a874c01e1bc8a58b756cbbaa9afbae736fa50edc` |
| (raw `eng.traineddata`, not committed) | as above | | 4,113,088 | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| `LICENSE-Apache-2.0.txt` | npm `tesseract.js-core` `LICENSE` | 5.1.1 | 11,358 | `c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08` |

Sources:
- https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.1.tgz (shasum `7bfaca1c103ba0ce3ddf5e101f0692802a01f880`)
- https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-5.1.1.tgz (shasum `2b6f3ef28dd109bf4efdbc8fff70bd11adac8b85`)
- https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata

Served sizes (what a device actually transfers, one core variant): gzip -9 of the set is about 3.1 MB
(the wasm 1.06 MB, the traineddata already gzipped 1.98 MB, the three scripts about 0.1 MB); with Brotli
about 2.9 MB. GitHub Pages serves `.wasm` and `.js` compressed; the `.gz` is served as stored.

## Licences

- **tesseract.js** and **tesseract.js-core** (the naptha/tesseract.js authors and contributors) and
  **Tesseract OCR** with its `tessdata_fast` trained data (the tesseract-ocr authors) are licensed under
  the **Apache License, Version 2.0**; the full text, as shipped in both npm packages, is in
  `LICENSE-Apache-2.0.txt`.
- The minified bundles also contain small MIT / BSD-3-Clause pieces (buffer, ieee754, regenerator-runtime,
  zlib.js, is-url, …) whose notices ship beside them in `*.LICENSE.txt`, unchanged.

```
Licensed under the Apache License, Version 2.0 (the "License"); you may not use these files except in
compliance with the License. You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software distributed under the License is
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
```

No file here was modified. To update: bump the version in `js/ocr.js` (`VERSION`, `FILES` sizes), change
`CACHE` to `thready-ocr-v2` (install() deletes older `thready-ocr-*` buckets), and refresh this table.
