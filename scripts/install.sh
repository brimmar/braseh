#!/bin/bash
set -euo pipefail

REPO="${BRASEH_REPO:-brimmar/braseh}"
INSTALL_DIR="${BRASEH_DIR:-$HOME/.local/bin}"

die() {
  echo "$@" >&2
  exit 1
}

detect_os_arch() {
  local os arch

  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$os" in
    linux) os="linux" ;;
    darwin) os="darwin" ;;
    *) die "Unsupported OS: $os" ;;
  esac

  arch=$(uname -m)
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) die "Unsupported architecture: $arch" ;;
  esac

  echo "${os}-${arch}"
}

download() {
  local url="$1"
  local dest="$2"

  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget &>/dev/null; then
    wget -qO "$dest" "$url"
  else
    die "neither curl nor wget found — install one of them first"
  fi
}

main() {
  local target
  target=$(detect_os_arch)

  local version="${1:-latest}"
  local binary="braseh-${target}"

  local base
  if [ "$version" = "latest" ]; then
    base="https://github.com/${REPO}/releases/latest/download"
  else
    base="https://github.com/${REPO}/releases/download/${version}"
  fi

  mkdir -p "$INSTALL_DIR"

  # Download next to the destination, verify, then mv: a failed or tampered
  # download never replaces a working binary.
  # Global, not local: the EXIT trap runs after main returns, under set -u.
  tmp=$(mktemp "${INSTALL_DIR}/.braseh.XXXXXX")
  trap 'rm -f "$tmp" "$tmp.sums"' EXIT

  echo "downloading braseh (${target})..."
  download "${base}/${binary}" "$tmp"
  download "${base}/checksums.txt" "$tmp.sums"

  local expected actual
  expected=$(awk -v f="$binary" '$2 == f || $2 == "*" f { print $1 }' "$tmp.sums")
  [ -n "$expected" ] || die "no checksum for ${binary} in checksums.txt"
  if command -v sha256sum &>/dev/null; then
    actual=$(sha256sum "$tmp" | awk '{ print $1 }')
  else
    actual=$(shasum -a 256 "$tmp" | awk '{ print $1 }')
  fi
  [ "$expected" = "$actual" ] || die "checksum mismatch for ${binary}: expected ${expected}, got ${actual}"

  chmod +x "$tmp"
  mv -f "$tmp" "${INSTALL_DIR}/braseh"

  echo "braseh installed to ${INSTALL_DIR}/braseh"

  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
    echo ""
    echo "  ${INSTALL_DIR} is not in your PATH."
    echo "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc):"
    echo "    export PATH=\"\$PATH:${INSTALL_DIR}\""
  fi
}

main "$@"
