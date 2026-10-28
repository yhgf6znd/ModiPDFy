#!/usr/bin/env bash

set -euo pipefail

rust_toolchain="1.93.0"
wasm_pack_version="0.14.0"

if ! command -v rustup >/dev/null 2>&1; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "Cloudflare build requires curl to install the pinned Rust toolchain." >&2
    exit 1
  fi
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${HOME}/.cargo/bin:${PATH}"
fi

rustup toolchain install "${rust_toolchain}" --profile minimal --target wasm32-unknown-unknown --no-self-update

wasm_pack_installed_version="$(wasm-pack --version 2>/dev/null || true)"
if [[ "${wasm_pack_installed_version}" != "wasm-pack ${wasm_pack_version}" ]]; then
  cargo "+${rust_toolchain}" install wasm-pack --version "${wasm_pack_version}" --locked --force
fi

export RUSTUP_TOOLCHAIN="${rust_toolchain}"
npm run build:static
