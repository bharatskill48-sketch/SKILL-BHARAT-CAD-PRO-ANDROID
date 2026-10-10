# libarchive-wasm 1.2.0 — packaged runtime provenance

izCAD 2.0 packages the unmodified WebAssembly binary from
`libarchive-wasm@1.2.0/dist/libarchive.wasm`.

- Upstream tag: https://github.com/ofk/libarchive-wasm/tree/v1.2.0
- Tag commit: `2e72c66d92fb8aa5914d0ff2f9e29608e38f2294`
- Corresponding upstream binary:
  https://github.com/ofk/libarchive-wasm/blob/2e72c66d92fb8aa5914d0ff2f9e29608e38f2294/src/libarchive.wasm
- SHA-256 (npm binary and upstream tag binary were compared):
  `99889a4e7c3d1968303ef334a0ca89efffaf8867eb7cbd7c265602d8e0b50e63`
- Build dependency versions and options:
  https://github.com/ofk/libarchive-wasm/blob/2e72c66d92fb8aa5914d0ff2f9e29608e38f2294/lib/Dockerfile
- Static linker inputs:
  https://github.com/ofk/libarchive-wasm/blob/2e72c66d92fb8aa5914d0ff2f9e29608e38f2294/lib/build.bash

The build uses Emscripten 4.0.5 and statically links libarchive 3.7.7,
OpenSSL 3.4.1, zlib 1.3.1, bzip2 1.0.8, and XZ Utils liblzma 5.6.4.
Emscripten's JavaScript runtime, musl libc copyright notices, and LLVM
compiler-rt license are included separately. Its dlmalloc allocator is Doug
Lea's public-domain implementation (version 2.8.6, 29 August 2012); Emscripten's
modifications are covered by its own runtime license.
The JavaScript wrapper and C bridge have the upstream project's MIT license.
The npm metadata at 1.2.0 declares MIT; the tag's tree omits a standalone
license file. The maintainer's explicit MIT text is retained from this pinned
repository commit:
https://github.com/ofk/libarchive-wasm/blob/1d04437e404ffad8b3a490abb36234dbdff59afa/LICENSE

License texts and library-source copyright notices are included in the root
`LICENSE-*` files and in the app's offline `licenses/` assets. The BLAKE2 code
in libarchive is used under its Apache-2.0 option. The linked liblzma library
uses 0BSD; XZ's separately licensed command line programs and scripts are not
linked into this runtime.

The underlying sources are available at these exact release locations:

- https://github.com/libarchive/libarchive/releases/tag/v3.7.7
- https://github.com/openssl/openssl/releases/tag/openssl-3.4.1
- https://github.com/madler/zlib/releases/tag/v1.3.1
- https://sourceware.org/pub/bzip2/bzip2-1.0.8.tar.gz
- https://github.com/tukaani-project/xz/releases/tag/v5.6.4
- https://github.com/emscripten-core/emscripten/releases/tag/4.0.5

OpenSSL copyright notices:

Copyright (c) 1998-2025 The OpenSSL Project Authors

Copyright (c) 1995-1998 Eric A. Young, Tim J. Hudson

All rights reserved. OpenSSL 3.4.1 uses Apache License 2.0; its full license
is included as `LICENSE-OPENSSL-3.txt`.
