#!/bin/sh
# Installs Rumi on macOS or Linux: downloads the latest release (it carries its own Node), checks its checksum,
# unpacks it to ~/.local/share/rumi-app and links the `rumi` command into ~/.local/bin.
#   curl -fsSL https://github.com/muzaffermahi/rumi/releases/latest/download/install.sh | sh
# Options (environment): RUMI_VERSION=0.5.0 to pin a version, RUMI_INSTALL_DIR and RUMI_BIN_DIR to change places.
set -eu

REPO="muzaffermahi/rumi"
DIR="${RUMI_INSTALL_DIR:-$HOME/.local/share/rumi-app}"
BIN="${RUMI_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() { printf 'rumi install: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "needs $1"; }
need curl
need tar

case "$(uname -s)" in
  Darwin) os=mac; ext=zip; need unzip ;;
  Linux) os=linux; ext=tar.gz ;;
  *) fail "this script is for macOS and Linux. On Windows, use install.ps1." ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) fail "unsupported processor $(uname -m)" ;;
esac
[ "$os" = linux ] && [ "$arch" = arm64 ] && fail "no Linux arm64 build yet. Install Node 22+ and run: npm install -g rumi-app"

file="Rumi-$os-$arch.$ext"
if [ -n "${RUMI_DOWNLOAD_BASE:-}" ]; then base="$RUMI_DOWNLOAD_BASE"; elif [ -n "${RUMI_VERSION:-}" ]; then base="https://github.com/$REPO/releases/download/v$RUMI_VERSION"; else base="https://github.com/$REPO/releases/latest/download"; fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say "Downloading $file…"
curl -fsSL "$base/$file" -o "$tmp/$file" || fail "could not download $base/$file"
curl -fsSL "$base/$file.sha256" -o "$tmp/$file.sha256" || fail "could not download the checksum"
expected="$(cut -d' ' -f1 < "$tmp/$file.sha256")"
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$tmp/$file" | cut -d' ' -f1)"; else actual="$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)"; fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $file; the download may be damaged. Try again."

say "Installing to $DIR…"
mkdir -p "$tmp/out"
if [ "$ext" = zip ]; then unzip -q "$tmp/$file" -d "$tmp/out"; else tar -xzf "$tmp/$file" -C "$tmp/out"; fi
# Stop a running Rumi before replacing it; your documents and settings in ~/.rumi are kept.
[ -x "$DIR/node/bin/node" ] && "$DIR/node/bin/node" "$DIR/app/bin/rumi.mjs" stop >/dev/null 2>&1 || true
rm -rf "$DIR"
mkdir -p "$(dirname "$DIR")"
mv "$tmp/out/Rumi-$os-$arch" "$DIR"
# macOS marks downloads as quarantined; this build is not notarized yet.
[ "$os" = mac ] && xattr -dr com.apple.quarantine "$DIR" 2>/dev/null || true

mkdir -p "$BIN"
cat > "$BIN/rumi" <<EOF
#!/bin/sh
exec "$DIR/node/bin/node" "$DIR/app/bin/rumi.mjs" "\$@"
EOF
chmod +x "$BIN/rumi"

say ""
say "Rumi $("$BIN/rumi" --version) is installed."
case ":$PATH:" in
  *":$BIN:"*) say "Run: rumi" ;;
  *) say "Add $BIN to your PATH (for example in ~/.zshrc or ~/.bashrc):"
     say "  export PATH=\"$BIN:\$PATH\""
     say "Then run: rumi" ;;
esac
